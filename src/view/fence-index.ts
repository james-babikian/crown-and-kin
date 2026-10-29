/*
 * The fence index. It knows which notes of the vault hold a `kin` fence (a tree) and which hold a `kin-calendar` fence (a calendar), so that the plugin does not
 * scan the whole vault at each task. It is a hint, not a proof: callers that write still check the text. The state is kept per note with a stamp (modified time and size). A saved copy in the
 * local storage of the vault lets the next start skip every note that did not change; vault events keep the index up to date while Obsidian runs. Pure logic: the vault, the store and the
 * idle wait come in as arguments (`src/obsidian/fence-vault.ts` is the real adaptor).
 */

import { CALENDAR_LANGUAGE, KIN_LANGUAGE, findBlocks } from '../core/block-locate';
import { makeStoreValue, pathKey, readStoreValue, stampOf, type FenceFlag, type StampPair } from './fence-store';

/** The section types of the metadata cache that can hold a fenced block (a fence, or a callout, quote or list item around one). */
export const BLOCK_SECTIONS: ReadonlySet<string> = new Set(['code', 'callout', 'blockquote', 'list']);

/** One Markdown note as the vault lists it. */
export interface FenceFile {
	path: string;
	mtime: number;
	size: number;
}

/** What the index needs of the vault. */
export interface FenceVault {
	/** Every Markdown note, from memory, with no read. */
	files(): FenceFile[];
	read(path: string): Promise<string>;
	/** Whether the metadata cache lists a section that can hold a block in the note. */
	sectionState(path: string): 'yes' | 'no' | 'unknown';
	/** The metadata cache finished (not only the start limit passed). */
	cacheDone(): boolean;
	/** `cache` is the metadata cache event `changed`, with the text of the note. */
	on(ev: 'cache' | 'create' | 'modify' | 'rename' | 'delete', cb: (f: FenceFile, text?: string, oldPath?: string) => void): () => void;
	cacheReady(): Promise<void>;
	idle(): Promise<void>;
}

/** The place for the saved copy. `save` throws when the storage fails. */
export interface FenceStore {
	load(): unknown;
	save(v: unknown): void;
}

/** Numbers that tests and the adaptor can change. */
export interface FenceOptions {
	readsPerSlice?: number;
	sliceMs?: number;
	safetyMs?: number;
	saveWaitMs?: number;
}

/** The fence index. */
export interface FenceIndex {
	/** Runs once; later calls give the same promise. It never rejects. */
	start(): Promise<void>;
	/** Stops the events and the timers, and saves once. */
	dispose(): void;
	/** Saves now (page hide, app in the background). */
	flush(): void;
	/** The check of the whole vault ended and nothing is left to check. */
	readonly complete: boolean;
	has(path: string, kind: 'kin' | 'cal'): boolean;
	/** Sorted. Before `complete` it is what the saved copy and the events know, limited to the notes that exist. */
	notes(kind: 'kin' | 'cal'): string[];
	/** Notes whose answer is not proved. */
	unsure(): ReadonlySet<string>;
	/** The set of notes of a kind changed (after a 300 ms wait for a burst). */
	onChange(cb: () => void): () => void;
}

/** Whether a note text holds a tree fence and whether it holds a calendar fence. Case-sensitive, by the fence rules of `core/block-locate.ts`. */
export function fenceFlags(text: string): { kin: boolean; cal: boolean } {
	// A regular expression on the fence marker would miss a fence info that follows a no-break, form feed or ideographic space.
	if (!text.includes('kin')) return { kin: false, cal: false };
	return {
		kin: findBlocks(text, KIN_LANGUAGE).length > 0,
		cal: text.includes(CALENDAR_LANGUAGE) && findBlocks(text, CALENDAR_LANGUAGE).length > 0,
	};
}

const DEFAULTS: Required<FenceOptions> = { readsPerSlice: 25, sliceMs: 12, safetyMs: 4000, saveWaitMs: 10_000 };
/** A burst of changes is told once after this wait. */
const BURST_MS = 300;
/** A build saves after this many reads. */
const SAVE_EVERY_READS = 300;
const MAX_ROUNDS = 5;
const NONE = { kin: false, cal: false };
const BIT = { kin: 1, cal: 2 } as const;

type Mark = 'cache' | 'touch' | 'gone' | 'moved';
interface Candidate {
	f: FenceFile;
	/** The sequence number of the path when the candidate was listed. */
	s: number;
}

class Fence implements FenceIndex {
	private readonly o: Required<FenceOptions>;
	private readonly entries = new Map<string, FenceFlag>();
	private readonly stamps = new Map<string, number>();
	/** Every event for a path raises its sequence number; a read that ends under another number is stale. */
	private readonly marks = new Map<string, { seq: number; kind: Mark }>();
	/** Paths that a `cache` event told about before the check ended. */
	private readonly seen = new Set<string>();
	private readonly toCheck = new Set<string>();
	private readonly unsureSet = new Set<string>();
	private readonly failed = new Set<string>();
	/** Notes with a `create` or `modify` event in this session, and notes whose stored stamp differs from the file: for these the cache may still hold the old text. */
	private readonly doubted = new Set<string>();
	private readonly timers = new Map<string, number>();
	private readonly listeners = new Set<() => void>();
	private readonly offs: (() => void)[] = [];
	private stored = new Map<number, number>();
	private lists: [string[] | null, string[] | null] = [null, null];
	private counter = 0;
	private startPromise: Promise<void> | null = null;
	private disposed = false;
	/** The stamps of the saved copy are in memory: from here on a save loses nothing. */
	private seeded = false;
	private passDone = false;
	private saveStopped = false;
	private sinceSave = 0;
	private saveTimer: number | null = null;
	private burstTimer: number | null = null;

	constructor(
		private readonly vault: FenceVault,
		private readonly store: FenceStore,
		o: FenceOptions = {},
	) {
		this.o = { ...DEFAULTS, ...o };
	}

	get complete(): boolean {
		return this.passDone && this.toCheck.size === 0;
	}

	start(): Promise<void> {
		this.startPromise ??= this.run();
		return this.startPromise;
	}

	has(path: string, kind: 'kin' | 'cal'): boolean {
		return ((this.entries.get(path) ?? 0) & BIT[kind]) !== 0;
	}

	notes(kind: 'kin' | 'cal'): string[] {
		const slot = kind === 'kin' ? 0 : 1;
		if (this.passDone && this.lists[slot]) return this.lists[slot].slice();
		const live = this.passDone ? null : new Set(this.vault.files().map((f) => f.path));
		const out: string[] = [];
		for (const [path, flag] of this.entries) if ((flag & BIT[kind]) !== 0 && (!live || live.has(path))) out.push(path);
		out.sort();
		if (this.passDone) this.lists[slot] = out;
		return out.slice();
	}

	unsure(): ReadonlySet<string> {
		return this.unsureSet;
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => void this.listeners.delete(cb);
	}

	flush(): void {
		if (!this.disposed) this.save();
	}

	dispose(): void {
		if (this.disposed) return;
		this.save();
		this.disposed = true;
		for (const off of this.offs.splice(0)) off();
		for (const t of this.timers.values()) window.clearTimeout(t);
		this.timers.clear();
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		if (this.burstTimer !== null) window.clearTimeout(this.burstTimer);
		this.saveTimer = this.burstTimer = null;
		this.listeners.clear();
	}

	// ---------- start and the check of the whole vault ----------

	private async run(): Promise<void> {
		try {
			if (this.disposed) return;
			this.subscribe();
			this.load();
			await this.vault.cacheReady();
			if (this.disposed) return;
			await this.vault.idle();
			if (this.disposed) return;
			await this.pass();
		} catch (e) {
			console.error('Crown and Kin: the note index stopped.', e);
		}
	}

	private load(): void {
		let raw: unknown = null;
		try {
			raw = this.store.load();
		} catch {
			// A storage that fails is a first start.
		}
		let state = null;
		try {
			state = readStoreValue(raw);
		} catch {
			// The same.
		}
		if (!state) return;
		for (const [path, flag] of state.flags) this.entries.set(path, flag);
		this.stored = state.stamps;
	}

	private async pass(): Promise<void> {
		let cands = this.firstRound(this.vault.files());
		this.seeded = true;
		for (let round = 1; round <= MAX_ROUNDS; round++) {
			await this.checkAll(cands);
			if (this.disposed) return;
			cands = this.nextRound();
			if (!cands.length) break;
		}
		// What is left after the last round is not proved: it is told as unsure and the check ends.
		for (const c of cands) this.unsureSet.add(c.f.path);
		for (const path of this.toCheck) this.unsureSet.add(path);
		this.toCheck.clear();
		this.finish();
	}

	/** Sets the stamps that the saved copy proves, and lists the notes that need a check. Notes whose path key is shared by another note are never trusted. */
	private firstRound(files: readonly FenceFile[]): Candidate[] {
		const counts = new Map<number, number>();
		for (const f of files) {
			const key = pathKey(f.path);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		const out: Candidate[] = [];
		for (const f of files) {
			if (this.seen.has(f.path)) continue;
			const key = pathKey(f.path);
			const stamp = stampOf(f.mtime, f.size);
			const was = this.stored.get(key);
			if (counts.get(key) === 1 && was === stamp) this.stamps.set(f.path, stamp);
			else {
				// A stamp that differs: the note changed while the plugin did not run, and Obsidian may give the old cache entry.
				if (was !== undefined) this.doubted.add(f.path);
				out.push({ f, s: this.seqOf(f.path) });
			}
		}
		return out;
	}

	/** The notes that the last round left open: renamed or discarded ones, and ones that came after the list was made. */
	private nextRound(): Candidate[] {
		const live = new Set<string>();
		const out: Candidate[] = [];
		for (const f of this.vault.files()) {
			live.add(f.path);
			const open = !this.stamps.has(f.path) && !this.seen.has(f.path) && !this.failed.has(f.path);
			if (open || this.toCheck.has(f.path)) out.push({ f, s: this.seqOf(f.path) });
		}
		for (const path of [...this.toCheck]) {
			if (live.has(path)) continue;
			this.toCheck.delete(path);
			this.unsureSet.delete(path);
		}
		return out;
	}

	/** Checks the notes in slices; after a slice the interface gets a turn. */
	private async checkAll(cands: readonly Candidate[]): Promise<void> {
		let reads = 0;
		let t0 = performance.now();
		for (const c of cands) {
			if (this.disposed) return;
			const didRead = await this.checkOne(c, true);
			if (this.disposed) return;
			if (didRead) {
				reads++;
				if (++this.sinceSave >= SAVE_EVERY_READS) {
					this.sinceSave = 0;
					this.save();
				}
			}
			if (reads >= this.o.readsPerSlice || performance.now() - t0 >= this.o.sliceMs) {
				await this.vault.idle();
				reads = 0;
				t0 = performance.now();
			}
		}
	}

	private finish(): void {
		const live = new Set(this.vault.files().map((f) => f.path));
		for (const path of [...this.entries.keys()]) if (!live.has(path)) this.entries.delete(path);
		for (const path of [...this.stamps.keys()]) if (!live.has(path)) this.stamps.delete(path);
		this.seen.clear();
		this.lists = [null, null];
		this.passDone = true;
		this.save();
	}

	// ---------- the check of one note ----------

	/** True when the note was read. A result is used only if no event for the path came meanwhile. */
	private async checkOne(c: Candidate, pass: boolean): Promise<boolean> {
		const path = c.f.path;
		if (this.seqOf(path) !== c.s) {
			this.discard(path, pass);
			return false;
		}
		if (!this.mustRead(path)) {
			this.settle(path, NONE, c.f);
			return false;
		}
		let flags: { kin: boolean; cal: boolean };
		try {
			flags = fenceFlags(await this.vault.read(path));
		} catch {
			if (!this.disposed) this.readFailed(c, pass);
			return true;
		}
		if (this.disposed) return true;
		if (this.seqOf(path) !== c.s) this.discard(path, pass);
		else this.settle(path, flags, c.f);
		return true;
	}

	/**
	 * A cache that has finished and lists no section that can hold a block proves that the note has no fence, for a note that never had a stamp and had no event in this session.
	 * After an event or a changed stamp the cache may still list the old text, so the note is read. A cold or unknown cache proves nothing.
	 */
	private mustRead(path: string): boolean {
		return this.doubted.has(path) || !(this.vault.cacheDone() && this.vault.sectionState(path) === 'no');
	}

	/** The result is thrown away. The check of the whole vault asks again for a note that only a `create` or `modify` event touched; a `cache` event already brought the answer. */
	private discard(path: string, pass: boolean): void {
		if (pass && this.marks.get(path)?.kind === 'touch') this.toCheck.add(path);
	}

	private readFailed(c: Candidate, pass: boolean): void {
		const path = c.f.path;
		if (!this.vault.files().some((f) => f.path === path)) return;
		if (this.seqOf(path) !== c.s) {
			this.discard(path, pass);
			return;
		}
		this.stamps.delete(path);
		this.toCheck.delete(path);
		this.unsureSet.add(path);
		this.failed.add(path);
	}

	/** Records an answer that is proved: flags, stamp, and the end of every doubt about the path. */
	private settle(path: string, flags: { kin: boolean; cal: boolean }, f: FenceFile): void {
		this.setFlags(path, flags);
		this.stamps.set(path, stampOf(f.mtime, f.size));
		this.unsureSet.delete(path);
		this.toCheck.delete(path);
		this.failed.delete(path);
		this.doubted.delete(path);
		this.disarm(path);
	}

	// ---------- vault events ----------

	private subscribe(): void {
		const on = (ev: Parameters<FenceVault['on']>[0], fn: (f: FenceFile, text?: string, old?: string) => void) =>
			this.offs.push(
				this.vault.on(ev, (f, text, old) => {
					try {
						fn(f, text, old);
					} catch (e) {
						console.error('Crown and Kin: the note index could not follow a change.', e);
					}
				}),
			);
		on('cache', (f, text) => this.onCache(f, text));
		on('create', (f) => this.onTouch(f));
		on('modify', (f) => this.onTouch(f));
		on('rename', (f, _text, old) => this.onRename(f, old));
		on('delete', (f) => this.onDelete(f));
	}

	private onCache(f: FenceFile, text: string | undefined): void {
		if (text === undefined) {
			this.onTouch(f);
			return;
		}
		const path = f.path;
		this.mark(path, 'cache');
		if (!this.passDone) this.seen.add(path);
		this.settle(path, fenceFlags(text), f);
	}

	/** A `create` or `modify` event: the answer is stale until a `cache` event comes. If none comes, the safety timer reads the note. */
	private onTouch(f: FenceFile): void {
		this.mark(f.path, 'touch');
		this.doubted.add(f.path);
		this.stamps.delete(f.path);
		this.arm(f);
	}

	private onRename(f: FenceFile, old: string | undefined): void {
		if (old === undefined || old === f.path) return;
		const flag = this.entries.get(old);
		const stamp = this.stamps.get(old);
		const doubt = this.doubted.delete(old);
		this.mark(old, 'gone');
		this.forget(old);
		this.entries.delete(old);
		this.stamps.delete(old);
		this.mark(f.path, 'moved');
		if (doubt) this.doubted.add(f.path);
		if (flag !== undefined) this.entries.set(f.path, flag);
		if (flag !== undefined) this.changed();
		if (stamp !== undefined) {
			this.stamps.set(f.path, stamp);
			return;
		}
		// The old path was not checked yet: the new path inherits the doubt.
		this.toCheck.add(f.path);
		this.arm(f);
	}

	private onDelete(f: FenceFile): void {
		const path = f.path;
		this.mark(path, 'gone');
		this.forget(path);
		this.stamps.delete(path);
		this.seen.delete(path);
		this.doubted.delete(path);
		if (this.entries.delete(path)) this.changed();
	}

	private arm(f: FenceFile): void {
		this.disarm(f.path);
		this.unsureSet.add(f.path);
		this.timers.set(
			f.path,
			window.setTimeout(() => {
				this.timers.delete(f.path);
				void this.safety(f);
			}, this.o.safetyMs),
		);
	}

	private disarm(path: string): void {
		const t = this.timers.get(path);
		if (t === undefined) return;
		window.clearTimeout(t);
		this.timers.delete(path);
	}

	/** Takes a path out of every set that holds doubt about it. */
	private forget(path: string): void {
		this.disarm(path);
		this.unsureSet.delete(path);
		this.toCheck.delete(path);
		this.failed.delete(path);
	}

	/** No `cache` event came: read the note once, unless the cache says it cannot hold a block. */
	private async safety(f: FenceFile): Promise<void> {
		if (this.disposed) return;
		try {
			await this.checkOne({ f, s: this.seqOf(f.path) }, false);
		} catch (e) {
			console.error('Crown and Kin: the note index could not check a note.', e);
		}
	}

	private mark(path: string, kind: Mark): void {
		this.marks.set(path, { seq: ++this.counter, kind });
	}

	private seqOf(path: string): number {
		return this.marks.get(path)?.seq ?? 0;
	}

	// ---------- changes, listeners, saves ----------

	private setFlags(path: string, flags: { kin: boolean; cal: boolean }): void {
		const next = (flags.kin ? BIT.kin : 0) | (flags.cal ? BIT.cal : 0);
		if (next === (this.entries.get(path) ?? 0)) return;
		if (next === 0) this.entries.delete(path);
		else this.entries.set(path, next as FenceFlag);
		this.changed();
	}

	/** The set of fence notes changed: the lists are made again, listeners hear it once per burst, and a save follows. */
	private changed(): void {
		this.lists = [null, null];
		this.saveSoon();
		if (this.burstTimer !== null || this.disposed) return;
		this.burstTimer = window.setTimeout(() => {
			this.burstTimer = null;
			for (const cb of [...this.listeners]) {
				try {
					cb();
				} catch (e) {
					console.error('Crown and Kin: a listener of the note index failed.', e);
				}
			}
		}, BURST_MS);
	}

	private saveSoon(): void {
		if (this.saveStopped || !this.seeded || this.saveTimer !== null || this.disposed) return;
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.save();
		}, this.o.saveWaitMs);
	}

	/** Writes the copy. A failure is logged once and ends all saving of the session; the index goes on in memory. */
	private save(): void {
		// Before the stamps of the saved copy are in memory, a save would erase them.
		if (this.saveStopped || !this.seeded) return;
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		const value = makeStoreValue(this.entries, this.stampPairs());
		if (!value) return;
		try {
			this.store.save(value);
		} catch (e) {
			this.saveStopped = true;
			console.error('Crown and Kin: the note index could not be saved. It works for this session only.', e);
		}
	}

	/** Pairs of path key and stamp. A key that two checked notes share is left out; the next start checks both. */
	private stampPairs(): StampPair[] {
		const counts = new Map<number, number>();
		const keyed: StampPair[] = [];
		for (const [path, stamp] of this.stamps) {
			const key = pathKey(path);
			counts.set(key, (counts.get(key) ?? 0) + 1);
			keyed.push([key, stamp]);
		}
		return keyed.filter(([key]) => counts.get(key) === 1);
	}
}

/** Makes the fence index. Call `start()` once when the layout is ready. */
export function createFenceIndex(vault: FenceVault, store: FenceStore, o?: FenceOptions): FenceIndex {
	return new Fence(vault, store, o);
}
