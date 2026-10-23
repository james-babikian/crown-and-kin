/*
 * The calendar readers (spec §14 rules 7 and 9, the architecture notes §5.7; D289, D290). A tree reads a calendar only when `options.calendar` names a calendar note. This file gives each
 * tree its date reader (`readerFor`) and keeps the calendars of the notes that trees name. A tree with no key gets the plain reader at once: no scan, no read, no wait. A key is
 * "requested": the first call starts one load of the note it names and answers the one "pending" reader (plain years, no warning) until the load ends; then the listeners hear of
 * it after a short wait, once for a burst of events. Which notes hold a `kin-calendar` fence is not known here: the host gives that list (`IndexOptions.notes`, from the fence
 * index). It is pure: the vault sits behind the small `CalendarVault` interface, so a test uses a fake vault and the plugin uses `src/obsidian/calendar-vault.ts`.
 */

import { CALENDAR_LANGUAGE, findBlocks } from '../core/block-locate';
import { parseCalendarBlock } from '../core/calendar-block';
import { fold } from '../core/date-text';
import { PLAIN_READER, compileCalendars, type Calendar, type CalendarProblem, type DateReader, type NameList } from '../core/dates';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import type { Tree } from '../core/types';
import { compileCapped } from './calendar-reader';

/** What the index needs of a vault. For 'cache' the second argument is the text of the note; for 'rename' it is the old path. */
export interface CalendarVault {
	read(path: string): Promise<string>;
	/** The path that a link names, seen from a note, or null. */
	resolve(link: string, fromPath: string): string | null;
	on(event: 'create' | 'rename' | 'delete' | 'cache', cb: (path: string, second?: string) => void): () => void;
	/** Settles when the metadata cache has finished its first pass (or after its own limit). */
	cacheReady(): Promise<void>;
}

/** What a tree view needs of the index (`TreeHost.dates`). */
export interface DatesHost {
	/** `holder` is the view that asks: its keys stay while it lives, so the cap never drops a key that a live view draws with. */
	readerFor(treePath: string, calendarLink?: string, holder?: object): DateReader;
	onChange(cb: () => void): () => void;
	/** The holder stopped asking (the view went away): its keys can leave when the list is full. */
	release?(holder: object): void;
}

/** What a window needs to read dates of one tree: the reader for the calendar link of the tree text, and (when the host has an index) the way to hear of a change of any reader. */
export type DatesFor = ((link: string | undefined) => DateReader) & { onChange?: DatesHost['onChange'] };

/** The `DatesFor` of the tree at `treePath`, on an index; `holder` is the view that draws with it. */
export const datesForTree = (index: DatesHost, treePath: string, holder?: object): DatesFor =>
	Object.assign((link: string | undefined) => index.readerFor(treePath, link, holder), { onChange: (cb: () => void) => index.onChange(cb) });

/** The reader of a parsed tree, or undefined when the host has no index (a unit fake): the plain reader then reads. */
export const readerOfTree = (dates: DatesFor | undefined, tree: Pick<Tree, 'options'>): DateReader | undefined => dates?.(tree.options.calendar);

/** The graph of a tree with the date reader of its calendar link (spec §14 rule 9); plain years without a reader. The windows derive a graph of the block they edit with this. */
export const deriveDated = (tree: Tree, dates: DatesFor | undefined): FamilyGraph => deriveFamilies(tree, { dates: readerOfTree(dates, tree) });

/** The index as the plugin and the Calendars window use it. */
export interface CalendarIndex extends DatesHost {
	/** False until `start()` has run (it only subscribes to events). */
	readonly ready: boolean;
	/** Subscribes to the vault events; settles at once. Calling it again returns the same promise. */
	start(): Promise<void>;
	/** Stops the events and the timers. */
	dispose(): void;
	/** The calendar notes that a chooser can offer: the notes the host knows hold a fence, with the notes loaded here, sorted by file name and then path. */
	notes(): string[];
	/** True when the list of the host is complete (the fence index finished its pass); true when the host gives no such sign. */
	notesComplete(): boolean;
	/** The calendar note that a tree uses: `[]` without a link, else the note that the link names if it holds a block. */
	usedNotes(treePath: string, calendarLink?: string): string[];
	/** The path that a link names, seen from a note, or null. */
	resolve(link: string, fromPath: string): string | null;
	/** Reads one note again now (after the Calendars window wrote it); the note stays loaded until the next burst of changes. */
	reload(path: string): Promise<void>;
	/** The calendars of one loaded note, in written order. */
	calendarsOf(path: string): Calendar[];
	/** The name lists of the plain years of one loaded note, in written order (spec §14 rule 13). */
	plainListsOf(path: string): NameList[];
}

/** The wait before the listeners hear of a change, in ms (a burst of events is one change). */
export const CHANGE_WAIT_MS = 300;

/** How many idle keys (a tree path with a link) the index keeps; the least recently asked idle key goes first. A key that a live view holds, or that was asked a short time ago, is not idle. */
export const MAX_KEYS = 200;

/** How long a key that no view holds (a window asked) counts as in use after its last ask, in ms: the keys of one pass of draws are all in use, and so no new key of the pass drops one of them. */
export const IDLE_MS = 2000;

/** Settings of the index; the defaults are the real ones. */
export interface IndexOptions {
	waitMs?: number;
	/** The notes that hold a `kin-calendar` fence (`fence.notes('cal')`); read at each call. */
	notes?: () => string[];
	/** True when `notes` is complete (`fence.complete`). */
	complete?: () => boolean;
}

interface Entry {
	calendars: Calendar[];
	/** The name lists of the plain years (key `plain`, spec §14 rule 13); empty when the note has none. */
	plain: NameList[];
	/** The note has a `plain` key in a block: with no calendar it is still a calendar note (spec §14 rule 13). */
	hasPlain: boolean;
	issues: CodedIssue[];
	/** The text of the entry for a quick "did it change" test. */
	sig: string;
	/** The note text the entry was made from: a rename makes the entry again for the new path (the path is in the id of each calendar) with no read. */
	text: string;
}

/** What the index knows of one requested key. */
interface KeyState {
	readonly treePath: string;
	/** The link as written, trimmed. */
	readonly link: string;
	/** The note the link names now, null when it names none. */
	path: string | null;
	/** True when the load has ended (the note is read, missing, or could not be read); false while the answer is the pending reader. */
	done: boolean;
	/** The last read of the note threw: the next event of the note tries again. */
	failed: boolean;
	/** The views that asked and are not gone: such a key is never dropped by the cap. */
	readonly holders: Set<object>;
	/** When the key was asked last (ms): an ask without a holder keeps the key a short time. */
	asked: number;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1).toLowerCase();

/** The order of the notes in a list: by file name, then by path. */
export const byNameThenPath = (a: string, b: string): number => {
	const x = nameOf(a);
	const y = nameOf(b);
	return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

/** Reads the `kin-calendar` blocks of a note text; null when the note has none. */
function entryOf(text: string, path: string): Entry | null {
	// The cheap test first: most notes have no calendar block.
	if (!text.includes(CALENDAR_LANGUAGE)) return null;
	const blocks = findBlocks(text, CALENDAR_LANGUAGE);
	if (!blocks.length) return null;
	const calendars: Calendar[] = [];
	const plain: NameList[] = [];
	const issues: CodedIssue[] = [];
	let hasPlain = false;
	blocks.forEach((b, i) => {
		const read = parseCalendarBlock(b.body, path, i);
		calendars.push(...read.calendars);
		if (read.plain) {
			hasPlain = true;
			plain.push(...read.plain);
		}
		issues.push(...read.issues);
	});
	// The lists are in the signature (a list-only edit is a change); a note with no `plain` key keeps the signature of 0.3.2.
	return { calendars, plain, hasPlain, issues, text, sig: JSON.stringify([calendars, issues.length, ...(hasPlain ? [plain] : [])]) };
}

const keyOf = (treePath: string, link: string): string => `${link}\u0000${treePath}`;

/** The index behind `createCalendarIndex`. */
class Index implements CalendarIndex {
	private readonly waitMs: number;
	private readonly entries = new Map<string, Entry>();
	/** The requested keys, the least recently asked first (a Map keeps the order of insertion). */
	private readonly keys = new Map<string, KeyState>();
	/** Which keys name each path. */
	private readonly targets = new Map<string, Set<string>>();
	/** Notes that a window reloaded: they stay loaded until the next burst, so the window and the key it writes see them. */
	private readonly pinned = new Set<string>();
	/** The newest event or read of each path: an older read that finishes later is dropped (M2). */
	private readonly latest = new Map<string, number>();
	/** The loads under way, so that two keys that name one note cost one read. */
	private readonly loading = new Map<string, Promise<void>>();
	/** Paths with a create or rename event: a key whose last read failed tries again for these at the next burst. */
	private readonly retry = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribe: (() => void)[] = [];
	private disposed = false;
	private attached = false;
	private started: Promise<void> | null = null;
	private version = 0;
	private counter = 0;
	private timer: number | null = null;
	private resolveTimer: number | null = null;
	/** The readers handed out: the same instance while the content stays the same. */
	private readonly readers = new Map<string, { version: number; sig: string; reader: DateReader }>();
	private readonly pending = compileCalendars([], false);

	constructor(
		private readonly vault: CalendarVault,
		private readonly options: IndexOptions,
	) {
		this.waitMs = options.waitMs ?? CHANGE_WAIT_MS;
	}

	get ready(): boolean {
		return this.started !== null;
	}

	notesComplete(): boolean {
		return this.options.complete?.() ?? true;
	}

	private fire(): void {
		this.timer = null;
		for (const cb of [...this.listeners]) {
			try {
				cb();
			} catch (e) {
				console.error('Crown and Kin: a calendar listener failed', e);
			}
		}
	}

	/** Something that a reader shows changed: the readers work out again, and the listeners hear of it after the wait. */
	private changed(): void {
		this.version++;
		if (this.disposed) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.pinned.clear();
			this.prune();
			this.fire();
		}, this.waitMs);
	}

	/** Takes out the loaded notes that no key names and no window holds. */
	private prune(): void {
		for (const path of [...this.entries.keys()]) if (!this.targets.has(path) && !this.pinned.has(path)) this.entries.delete(path);
	}

	private touch(path: string): number {
		const n = ++this.counter;
		this.latest.set(path, n);
		return n;
	}

	/** Reads a note and stores or drops its entry. A read that a newer event or read of the same path outran is dropped. Throws when the read fails. */
	private async read(path: string): Promise<void> {
		const n = this.touch(path);
		const text = await this.vault.read(path);
		if (this.disposed || this.latest.get(path) !== n) return;
		this.store(path, text);
	}

	/** Parses a text of a note and stores or drops its entry; a change of what the readers show is told. */
	private store(path: string, text: string): void {
		const next = entryOf(text, path);
		const prev = this.entries.get(path);
		if (!next) {
			if (prev) {
				this.entries.delete(path);
				this.changed();
			}
			return;
		}
		this.entries.set(path, next);
		if (prev?.sig !== next.sig) this.changed();
	}

	/** One read for each path at a time: a second caller waits for the first. */
	private loadOnce(path: string): Promise<void> {
		const under = this.loading.get(path);
		if (under) return under;
		const run = this.read(path).finally(() => this.loading.delete(path));
		this.loading.set(path, run);
		return run;
	}

	/** Points a key at the note its link names now (or at none), and keeps `targets` in step. */
	private retarget(k: string, st: KeyState, path: string | null): void {
		if (st.path === path) return;
		if (st.path !== null) {
			const set = this.targets.get(st.path);
			set?.delete(k);
			if (set && !set.size) this.targets.delete(st.path);
		}
		st.path = path;
		if (path !== null) this.targets.set(path, (this.targets.get(path) ?? new Set()).add(k));
	}

	/** Loads the note that a key names, once; the key is done when the read ends, well or not. */
	private async ensure(k: string): Promise<void> {
		const st = this.keys.get(k);
		if (!st) return;
		try {
			await this.vault.cacheReady();
			if (this.disposed || this.keys.get(k) !== st) return;
			await this.settle(k, st);
		} catch (e) {
			console.error('Crown and Kin: cannot load the calendar note', e);
			st.failed = true;
		}
		if (this.disposed || this.keys.get(k) !== st) return;
		st.done = true;
		this.changed();
	}

	/** Resolves the link of a key and reads the note unless it is known. */
	private async settle(k: string, st: KeyState): Promise<void> {
		const path = this.vault.resolve(st.link, st.treePath);
		this.retarget(k, st, path);
		st.failed = false;
		if (path === null || this.entries.has(path)) return;
		try {
			await this.loadOnce(path);
		} catch {
			// A note that cannot be read now (a sync is writing it) is "missing" until the next event of the note.
			st.failed = true;
		}
	}

	/** The one re-resolve of the keys for a burst of create, rename and delete events: a link can name another note now. */
	private scheduleResolve(): void {
		if (this.resolveTimer !== null || this.disposed) return;
		this.resolveTimer = window.setTimeout(() => {
			this.resolveTimer = null;
			void this.resolveKeys();
		}, this.waitMs);
	}

	private async resolveKeys(): Promise<void> {
		const retry = new Set(this.retry);
		this.retry.clear();
		for (const [k, st] of [...this.keys]) {
			if (this.disposed || !st.done || this.keys.get(k) !== st) continue;
			const path = this.vault.resolve(st.link, st.treePath);
			if (path === st.path && !(st.failed && path !== null && retry.has(path))) continue;
			try {
				await this.settle(k, st);
			} catch (e) {
				console.error('Crown and Kin: cannot load the calendar note', e);
				st.failed = true;
			}
			this.changed();
		}
	}

	private attach(): void {
		// The plugin can be turned off before the layout is ready: a late start must register nothing.
		if (this.attached || this.disposed) return;
		this.attached = true;
		const { vault } = this;
		this.unsubscribe.push(
			vault.on('cache', (path, text) => {
				this.touch(path);
				// A note that no key names is not read: the list of notes comes from the fence index.
				if (!this.targets.has(path) && !this.entries.has(path)) return;
				if (typeof text === 'string') this.store(path, text);
				for (const k of this.targets.get(path) ?? []) {
					const st = this.keys.get(k);
					if (st && (!st.done || st.failed)) {
						st.done = true;
						st.failed = false;
						this.changed();
					}
				}
			}),
			vault.on('create', (path) => {
				if (this.targets.has(path)) this.retry.add(path);
				this.scheduleResolve();
			}),
			vault.on('rename', (path, old) => {
				if (old !== undefined) {
					this.touch(old);
					const moved = this.entries.get(old);
					if (moved) {
						this.entries.delete(old);
						const again = entryOf(moved.text, path);
						if (again) this.entries.set(path, again);
					}
					if (this.pinned.delete(old)) this.pinned.add(path);
				}
				this.touch(path);
				this.retry.add(path);
				// A link can name another note after a rename, also when no calendar changed.
				this.version++;
				this.scheduleResolve();
			}),
			vault.on('delete', (path) => {
				this.touch(path);
				if (this.entries.delete(path)) this.changed();
				this.scheduleResolve();
			}),
		);
	}

	start(): Promise<void> {
		this.started ??= (async () => this.attach())();
		return this.started;
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer !== null) window.clearTimeout(this.timer);
		if (this.resolveTimer !== null) window.clearTimeout(this.resolveTimer);
		this.timer = this.resolveTimer = null;
		for (const off of this.unsubscribe.splice(0)) off();
		this.listeners.clear();
	}

	notes(): string[] {
		return [...new Set([...(this.options.notes?.() ?? []), ...this.entries.keys()])].sort(byNameThenPath);
	}

	usedNotes(treePath: string, link?: string): string[] {
		const text = link?.trim();
		if (!text) return [];
		const path = this.vault.resolve(text, treePath);
		return path !== null && this.entries.has(path) ? [path] : [];
	}

	/**
	 * The least recently asked idle keys go when there are too many; the notes that no key names go with them. A key in use is never dropped, also when more than MAX_KEYS trees
	 * are open: dropping it would make its next draw start a new load, and the loads would redraw the views without end.
	 */
	private evict(): void {
		if (this.keys.size <= MAX_KEYS) return;
		const now = Date.now();
		let dropped = false;
		for (const [k, st] of [...this.keys]) {
			if (this.keys.size <= MAX_KEYS) break;
			if (st.holders.size || now - st.asked < IDLE_MS) continue;
			this.keys.delete(k);
			this.readers.delete(k);
			this.retarget(k, st, null);
			dropped = true;
		}
		if (dropped) this.prune();
	}

	release(holder: object): void {
		for (const st of this.keys.values()) st.holders.delete(holder);
		this.evict();
	}

	/** The calendars, the plain-year lists and the problems of the note that a key names. */
	private build(st: KeyState): { calendars: Calendar[]; plain: NameList[]; problems: CalendarProblem[] } {
		const entry = st.path === null ? undefined : this.entries.get(st.path);
		const calendars = entry?.calendars ?? [];
		// A note with only a `plain` key is a calendar note (spec §14 rule 13); a note with neither is "missing", as in 0.3.3.
		const missing = !entry || !(calendars.length || entry.hasPlain);
		// Of two lists with one folded name the first is kept (the window refuses such a pair on Save, but a note can be edited by hand).
		const heard = new Set<string>();
		const plain = (entry?.plain ?? []).filter((l) => !heard.has(fold(l.name)) && !!heard.add(fold(l.name)));
		return { calendars, plain, problems: missing ? [{ key: 'calendar-note-missing', note: st.link }] : [] };
	}

	readerFor(treePath: string, calendarLink?: string, holder?: object): DateReader {
		const link = calendarLink?.trim();
		if (!link) return PLAIN_READER;
		this.attach();
		const k = keyOf(treePath, link);
		let st = this.keys.get(k);
		if (st) {
			this.keys.delete(k);
			this.keys.set(k, st);
		} else {
			st = { treePath, link, path: null, done: false, failed: false, holders: new Set(), asked: Date.now() };
			this.keys.set(k, st);
			this.evict();
			void this.ensure(k);
		}
		if (holder) st.holders.add(holder);
		st.asked = Date.now();
		if (!st.done) return this.pending;
		const kept = this.readers.get(k);
		if (kept?.version === this.version) return kept.reader;
		const { calendars, plain, problems } = this.build(st);
		const sig = JSON.stringify(plain.length ? [calendars, problems, plain] : [calendars, problems]);
		if (kept?.sig === sig) {
			kept.version = this.version;
			return kept.reader;
		}
		const reader = compileCapped(calendars, true, problems, plain);
		this.readers.set(k, { version: this.version, sig, reader });
		return reader;
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	resolve(link: string, from: string): string | null {
		return this.vault.resolve(link, from);
	}

	async reload(path: string): Promise<void> {
		this.pinned.add(path);
		this.touch(path);
		const text = await this.vault.read(path);
		this.store(path, text);
		// The pin ends with the next burst, also when the text did not change.
		this.changed();
	}

	calendarsOf(path: string): Calendar[] {
		return this.entries.get(path)?.calendars ?? [];
	}

	plainListsOf(path: string): NameList[] {
		return this.entries.get(path)?.plain ?? [];
	}
}

/** Makes the calendar index of a vault. */
export const createCalendarIndex = (vault: CalendarVault, options: IndexOptions = {}): CalendarIndex => new Index(vault, options);
