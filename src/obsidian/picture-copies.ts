/*
 * The small drawn copies of portraits and arms, kept on the device between starts (spec §0 D318). Without them every cold start reads
 * and decodes each whole picture file again, which takes about 0.8 s for a 4 MB portrait on an iPhone. With them, a picture that has a
 * copy shows with the list and takes no job slot of the picture store.
 *
 * Rules the code does not show at once:
 * - The key holds the vault, the file path, the file's mtime and size, the drawn kind, the drawn pixel size and the device pixel ratio,
 *   and the chosen part of a portrait. A changed file has another key, so it is a miss and never an old picture.
 * - One record per copy, and one index record per vault that lists the keys with their sizes, oldest use first. A miss costs no read,
 *   because the index says that the copy is not there. A write puts the copies, the index and the removals in one transaction.
 * - Writes and removals wait for idle time and go together, so a burst of new copies is one transaction.
 * - The total is limited (`COPIES_BUDGET` for each vault): the copy used longest ago leaves first. A copy whose file has a newer
 *   version, or has left the vault, leaves too.
 * - The bytes are stored as an `ArrayBuffer` and a type, not as a `Blob`: old WebKit versions lose a `Blob` in IndexedDB.
 * - Each vault index also records the last day the vault used its copies. When the database opens, the copies and index of any other vault
 *   not used for `STALE_DAYS` days are removed, so a vault that is never opened again does not keep room for ever.
 * - Nothing here throws into the plugin. If storage is missing, blocked, full or damaged, the copies stay off for the rest of the session,
 *   with one warning, and the store makes every copy as before. A first open that is only slow costs a miss for the pictures that ask
 *   in the meantime, and the copies work from the moment it succeeds.
 *
 * Known limit: a file whose content changes while its size and its modified time stay the same shows the old copy, as the memory list does.
 */

import type { ArmsOutline } from '../layout/arms-outline';

/** The total bytes of the copies kept for one vault. */
export const COPIES_BUDGET = 8_000_000;
/** A read of one record that takes longer than this counts as a miss, and the copies stay off: a picture must never wait for a stuck database. */
export const FIND_LIMIT_MS = 1000;
/** The first open of the database and the read of the index may take longer (a cold start on a phone); counted from the first request. */
export const OPEN_LIMIT_MS = 3000;
/** The copies of a vault that was not used for this many days are removed when another vault opens the database. */
export const STALE_DAYS = 60;
const DAY_MS = 86_400_000;

/** What names one drawn copy. `sig` is the file's mtime and size; `part` is the chosen part of a portrait ('' = the automatic part). */
export interface CopyId {
	path: string;
	sig: string;
	kind: 'portrait' | 'arms';
	w: number;
	h: number;
	dpr: number;
	part: string;
}

/** A copy as the store uses it. `outline` is the shape of an arms picture (null = known to show nothing); portraits have none. */
export interface StoredCopy {
	blob: Blob;
	w: number;
	h: number;
	outline?: ArmsOutline | null;
}

/** The copies kept on the device (D318). No method throws. */
export interface PictureCopies {
	/** The copy for `id`, or null (no copy, a damaged copy, storage off or too slow). */
	find(id: CopyId): Promise<StoredCopy | null>;
	/** Keeps a copy that was just drawn; the write waits for idle time. */
	save(id: CopyId, copy: StoredCopy): void;
	/** The file at `path` changed, went or was renamed: its copies leave. */
	forget(path: string): void;
	/** Does all the waiting writes now (plugin unload, tests). */
	flush(): Promise<void>;
}

/** The storage underneath: a key-value store with one atomic write. The real one is IndexedDB (`picture-copies-idb.ts`); tests use a fake. */
export interface CopyBackend {
	get(key: string): Promise<unknown>;
	/** Every key in the store. */
	keys(): Promise<string[]>;
	write(puts: { key: string; value: unknown }[], dels: string[]): Promise<void>;
}

/** What `createPictureCopies` needs from outside. */
export interface CopyOptions {
	/** The vault's name for the keys: two vaults never share a copy. */
	vault: string;
	/** Opens the storage; null when the device has none. */
	open(): Promise<CopyBackend | null>;
	/** True if the vault has a file at this path (used only once, to drop the copies of files that are gone). */
	exists(path: string): boolean;
	budget?: number;
	/** Runs `fn` in idle time. */
	later?(fn: () => void): void;
	/** Tells the one warning of a session. */
	warn?(e: unknown): void;
	/** The limit for a record read. */
	findLimitMs?: number;
	/** The limit for the first open and the index read. */
	openLimitMs?: number;
	/** The time in milliseconds; the tests give a fixed one. */
	now?(): number;
}

/** What one record holds in storage. */
interface Kept {
	type: string;
	data: ArrayBuffer;
	w: number;
	h: number;
	outline?: ArmsOutline | null;
}

const NUL = '\u0000';

/** Runs `fn` when the browser is idle; Safari has no `requestIdleCallback`, so a short timer stands in. */
function idle(fn: () => void): void {
	const w = window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
	if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 });
	else window.setTimeout(fn, 200);
}

/** Pure: the storage key of a copy. */
export function copyKey(vault: string, id: CopyId): string {
	return ['c', vault, id.path, id.sig, id.kind, `${id.w}x${id.h}@${Math.round(id.dpr * 100) / 100}`, id.part].join(NUL);
}

const indexKey = (vault: string) => `i${NUL}${vault}`;
const INDEX_PREFIX = `i${NUL}`;

/** The path, signature and slot (kind, size, part) of a key. */
function partsOf(key: string): { path: string; sig: string; slot: string } {
	const p = key.split(NUL);
	return { path: p[2] ?? '', sig: p[3] ?? '', slot: p.slice(4).join(NUL) };
}

function readRecord(raw: unknown): Kept | null {
	const r = raw as Partial<Kept> | null | undefined;
	if (!r || typeof r !== 'object' || typeof r.type !== 'string' || !r.data || typeof r.data.byteLength !== 'number') return null;
	if (!(typeof r.w === 'number' && r.w > 0 && typeof r.h === 'number' && r.h > 0)) return null;
	const o = r.outline;
	if (o !== undefined && o !== null && !(typeof o === 'object' && typeof o.w === 'number' && typeof o.h === 'number' && typeof o.d === 'string')) return null;
	return r as Kept;
}

function readIndex(raw: unknown): Map<string, number> {
	const rows = new Map<string, number>();
	const list = raw && typeof raw === 'object' ? (raw as { rows?: unknown }).rows : null;
	if (!Array.isArray(list)) return rows;
	for (const x of list) if (Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'number') rows.set(x[0], x[1]);
	return rows;
}

/** The day (a whole number) in which the index says that its vault last used its copies; null when it says nothing. */
function dayOf(raw: unknown): number | null {
	const d = raw && typeof raw === 'object' ? (raw as { day?: unknown }).day : null;
	return typeof d === 'number' && d >= 0 ? d : null;
}

const TIMEOUT = Symbol('timeout');

/** `p`, or TIMEOUT after `ms`. */
function raceLimit<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => resolve(TIMEOUT), ms);
		p.then(
			(v) => {
				window.clearTimeout(timer);
				resolve(v);
			},
			(e: unknown) => {
				window.clearTimeout(timer);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});
}


/** What waits to be written. */
interface Work {
	saves: { id: CopyId; copy: StoredCopy }[];
	gone: Set<string>;
	/** Keys that must leave the storage though their row is already out of the index. */
	dead: string[];
	sweep: boolean;
}

/** The write that follows from the work: the new index and the records to put and to delete. */
interface Plan {
	next: Map<string, number>;
	puts: Map<string, Kept>;
	dels: Set<string>;
}

function removeKey(plan: Plan, key: string): void {
	if (plan.next.delete(key)) plan.dels.add(key);
	plan.puts.delete(key);
}

/** Removes the copies that a change, a damaged record or the sweep of missing files names. */
function removeGone(plan: Plan, w: Work, exists: (path: string) => boolean): void {
	for (const k of w.dead) {
		plan.next.delete(k);
		plan.puts.delete(k);
		plan.dels.add(k);
	}
	for (const k of [...plan.next.keys()]) {
		const path = partsOf(k).path;
		if (w.gone.has(path) || (w.sweep && !exists(path))) removeKey(plan, k);
	}
}

/** Adds one new copy; an older copy of the same file at the same size and kind leaves. */
async function addSaved(plan: Plan, vault: string, budget: number, id: CopyId, copy: StoredCopy): Promise<void> {
	const key = copyKey(vault, id);
	let data: ArrayBuffer;
	try {
		data = await copy.blob.arrayBuffer();
	} catch {
		return;
	}
	// One copy must not take a large share of the room.
	if (data.byteLength > budget / 4) return;
	const mine = partsOf(key);
	for (const k of [...plan.next.keys()]) {
		const p = partsOf(k);
		if (k !== key && p.path === mine.path && p.slot === mine.slot) removeKey(plan, k);
	}
	plan.next.delete(key);
	plan.next.set(key, data.byteLength);
	plan.dels.delete(key);
	plan.puts.set(key, { type: copy.blob.type, data, w: copy.w, h: copy.h, ...(copy.outline !== undefined ? { outline: copy.outline } : {}) });
}

/** The copies used longest ago leave until the total fits. */
function evictOver(plan: Plan, budget: number): void {
	let total = 0;
	for (const n of plan.next.values()) total += n;
	for (const k of [...plan.next.keys()]) {
		if (total <= budget) break;
		total -= plan.next.get(k) ?? 0;
		removeKey(plan, k);
	}
}

/** The copies of one vault over `o.open()`. It opens the storage at the first use, never before. */
class DeviceCopies implements PictureCopies {
	private off = false;
	private backend: CopyBackend | null = null;
	private opening: Promise<boolean> | null = null;
	/** Key to bytes, in order of use (the first is the oldest). */
	private rows = new Map<string, number>();
	private readonly saves = new Map<string, { id: CopyId; copy: StoredCopy }>();
	private readonly forgets = new Set<string>();
	/** Keys to remove from the storage: their rows are out of `rows` already, so no copy of them can be read any more. */
	private readonly dead = new Set<string>();
	private ready = false;
	private firstAt: number | null = null;
	private pruneWanted = false;
	private touched = false;
	private sweepWanted = false;
	private sweepDone = false;
	private planned = false;
	private chain: Promise<void> = Promise.resolve();
	private readonly budget: number;
	private readonly indexAt: string;

	constructor(private readonly o: CopyOptions) {
		this.budget = o.budget ?? COPIES_BUDGET;
		this.indexAt = indexKey(o.vault);
	}

	private fail(e: unknown): void {
		if (!this.off) {
			this.off = true;
			try {
				(this.o.warn ?? ((x: unknown) => console.warn('Crown and Kin: the picture copies on this device are off', x)))(e);
			} catch {
				// A warning must never throw.
			}
		}
		this.saves.clear();
		this.forgets.clear();
		this.dead.clear();
	}

	private now(): number {
		return (this.o.now ?? Date.now)();
	}

	private start(): Promise<boolean> {
		if (this.opening) return this.opening;
		this.opening = (async () => {
			try {
				const b = await this.o.open();
				if (!b) {
					// No storage on this device is not a fault: no warning.
					this.off = true;
					return false;
				}
				this.backend = b;
				this.rows = readIndex(await b.get(this.indexAt));
				this.ready = true;
				this.pruneWanted = true;
				this.arrange();
				return true;
			} catch (e) {
				this.fail(e);
				return false;
			}
		})();
		return this.opening;
	}

	private pending(): boolean {
		return !this.off && (this.saves.size > 0 || this.forgets.size > 0 || this.dead.size > 0 || this.touched || this.pruneWanted || (this.sweepWanted && !this.sweepDone));
	}

	private arrange(): void {
		if (this.planned || this.off) return;
		this.planned = true;
		(this.o.later ?? idle)(() => {
			this.planned = false;
			void this.flush();
		});
	}

	/** Writes everything that waits as one transaction. */
	private async drain(): Promise<void> {
		if (!this.pending() || !(await this.start()) || !this.backend) return;
		if (this.pruneWanted) {
			this.pruneWanted = false;
			await this.prune(this.backend);
		}
		const w: Work = { saves: [...this.saves.values()], gone: new Set(this.forgets), dead: [...this.dead], sweep: this.sweepWanted && !this.sweepDone };
		const wasTouched = this.touched;
		this.saves.clear();
		this.forgets.clear();
		this.dead.clear();
		this.touched = false;
		if (w.sweep) this.sweepDone = true;
		const plan: Plan = { next: new Map(this.rows), puts: new Map(), dels: new Set() };
		removeGone(plan, w, (p) => this.o.exists(p));
		// The copies that must go are unreadable from here on, not only after the write.
		this.rows = new Map(plan.next);
		for (const s of w.saves) await addSaved(plan, this.o.vault, this.budget, s.id, s.copy);
		evictOver(plan, this.budget);
		if (plan.puts.size === 0 && plan.dels.size === 0 && !wasTouched) return;
		const list: { key: string; value: unknown }[] = [...plan.puts].map(([key, value]) => ({ key, value }));
		list.push({ key: this.indexAt, value: { v: 1, day: Math.floor(this.now() / DAY_MS), rows: [...plan.next] } });
		await this.backend.write(list, [...plan.dels]);
		this.rows = plan.next;
	}

	/** Removes the copies and the index of every other vault that was not used for `STALE_DAYS` days. */
	private async prune(b: CopyBackend): Promise<void> {
		try {
			const today = Math.floor(this.now() / DAY_MS);
			const keys = await b.keys();
			const dels: string[] = [];
			for (const k of keys) {
				if (!k.startsWith(INDEX_PREFIX) || k === this.indexAt) continue;
				const day = dayOf(await b.get(k));
				if (day !== null && today - day <= STALE_DAYS) continue;
				const own = `c${NUL}${k.slice(INDEX_PREFIX.length)}${NUL}`;
				dels.push(k, ...keys.filter((x) => x.startsWith(own)));
			}
			if (dels.length) await b.write([], dels);
		} catch {
			// A failed clean-up of other vaults must not switch off the copies of this one.
		}
	}

	private async findNow(id: CopyId): Promise<StoredCopy | null> {
		if (!(await this.start()) || !this.backend) return null;
		const key = copyKey(this.o.vault, id);
		const bytes = this.rows.get(key);
		// A forget that waits for its write already hides the copies of the file, also those of an index that was read after it.
		if (bytes === undefined || this.forgets.has(id.path)) return null;
		const rec = readRecord(await this.backend.get(key));
		if (!rec) {
			this.rows.delete(key);
			this.dead.add(key);
			this.arrange();
			return null;
		}
		// A use moves the copy to the end of the list (the last to leave).
		this.rows.delete(key);
		this.rows.set(key, bytes);
		this.touched = true;
		this.sweepWanted = true;
		this.arrange();
		return { blob: new Blob([rec.data], { type: rec.type }), w: rec.w, h: rec.h, ...(rec.outline !== undefined ? { outline: rec.outline } : {}) };
	}

	/** Waits for the first open, but only until the limit that counts from the first request; a late success still turns the copies on. */
	private async opened(): Promise<boolean> {
		this.firstAt ??= this.now();
		const left = this.firstAt + (this.o.openLimitMs ?? OPEN_LIMIT_MS) - this.now();
		if (left <= 0) return false;
		const r = await raceLimit(this.start(), left);
		return r !== TIMEOUT && r;
	}

	async find(id: CopyId): Promise<StoredCopy | null> {
		if (this.off) return null;
		try {
			if (!this.ready && !(await this.opened())) return null;
			const got = await raceLimit(this.findNow(id), this.o.findLimitMs ?? FIND_LIMIT_MS);
			if (got !== TIMEOUT) return got;
			this.fail(new Error('the picture copies are too slow'));
		} catch (e) {
			this.fail(e);
		}
		return null;
	}

	save(id: CopyId, copy: StoredCopy): void {
		try {
			if (this.off) return;
			this.saves.set(copyKey(this.o.vault, id), { id, copy });
			this.sweepWanted = true;
			this.arrange();
		} catch (e) {
			this.fail(e);
		}
	}

	forget(path: string): void {
		try {
			if (this.off) return;
			// A copy still waiting to be written for the old file must not be written.
			for (const [k, v] of [...this.saves]) if (v.id.path === path) this.saves.delete(k);
			for (const k of [...this.rows.keys()]) {
				if (partsOf(k).path !== path) continue;
				this.rows.delete(k);
				this.dead.add(k);
			}
			this.forgets.add(path);
			this.arrange();
		} catch (e) {
			this.fail(e);
		}
	}

	flush(): Promise<void> {
		this.chain = this.chain.then(() => this.drain()).catch((e) => this.fail(e));
		return this.chain;
	}
}

/** Makes the copies of one vault. */
export function createPictureCopies(o: CopyOptions): PictureCopies {
	return new DeviceCopies(o);
}

/** A copy that does nothing: the store uses it when the device has no storage. */
export const NO_COPIES: PictureCopies = {
	find: () => Promise.resolve(null),
	save: () => undefined,
	forget: () => undefined,
	flush: () => Promise.resolve(),
};

/** What one copy request needs from the device: look for the copy first, keep it after it was drawn. */
export interface DeviceTicket {
	/**
	 * Looks for the copy. `hit` gets it, or `miss` runs (no copy, storage off, the request no longer wanted, or an arms copy without its outline,
	 * which the gap round the arms on a card needs). `restore` gets the outline of an arms copy before `hit` runs.
	 */
	start(stillWanted: () => boolean, restore: (o: ArmsOutline | null) => void, hit: (c: StoredCopy) => void, miss: () => void): void;
	/** Keeps a copy that was just drawn. An arms copy is kept only with its outline (`undefined` = not known yet). */
	keep(out: { blob: Blob; w: number; h: number }, outline: ArmsOutline | null | undefined): void;
}

/** The ticket for one request; null when the request is not kept on the device. */
export function deviceTicket(copies: PictureCopies, keep: boolean, id: CopyId | null): DeviceTicket | null {
	if (!keep || !id || copies === NO_COPIES) return null;
	return {
		start(stillWanted, restore, hit, miss) {
			// `find` never rejects; the second handler only keeps a faulty stand-in from stalling the picture.
			void copies.find(id).then(
				(c) => {
					if (!c || !stillWanted() || (id.kind === 'arms' && c.outline === undefined)) return miss();
					if (c.outline !== undefined) restore(c.outline);
					hit(c);
				},
				() => miss(),
			);
		},
		keep(out, outline) {
			if (id.kind === 'arms' && outline === undefined) return;
			copies.save(id, { blob: out.blob, w: out.w, h: out.h, ...(outline !== undefined ? { outline } : {}) });
		},
	};
}
