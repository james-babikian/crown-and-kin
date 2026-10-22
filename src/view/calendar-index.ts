/*
 * The calendar index (spec §14 rules 7 and 9, the architecture notes §5.7). It knows which notes of the vault hold a `kin-calendar` block, keeps the
 * calendars of each, and gives each tree its date reader (`readerFor`). It is pure: the vault sits behind the small `CalendarVault`
 * interface, so a test uses a fake vault and the plugin uses the adaptor in `src/obsidian/calendar-vault.ts`. The first scan reads the notes
 * whose cached sections can hold a block (and the notes with no cache yet); the index is `ready` only after the metadata cache has finished.
 * Until then every reader is the one "pending" reader, which reads plain years only, so a tree draws at once. A change of any calendar note
 * is told to the listeners after a short wait, once for a burst of events.
 */

import { CALENDAR_LANGUAGE, findBlocks } from '../core/block-locate';
import { parseCalendarBlock } from '../core/calendar-block';
import { fold } from '../core/date-text';
import { compileCalendars, findCrossNoteDuplicates, type Calendar, type CalendarProblem, type DateReader, type NameList } from '../core/dates';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import type { Tree } from '../core/types';
import { compileCapped } from './calendar-reader';

/** What the index needs of a vault. */
export interface CalendarVault {
	/** The paths of the Markdown notes. */
	list(): string[];
	read(path: string): Promise<string>;
	/** Does the metadata cache say the note has a section that can hold a block (code, callout, blockquote, list)? 'unknown': the cache has no entry yet. */
	sectionState(path: string): 'yes' | 'no' | 'unknown';
	/** The path that a link names, seen from a note, or null. */
	resolve(link: string, fromPath: string): string | null;
	on(event: 'create' | 'modify' | 'rename' | 'delete' | 'cache', cb: (path: string, oldPath?: string) => void): () => void;
	/** Settles when the metadata cache has finished its first pass. */
	cacheReady(): Promise<void>;
}

/** What a tree view needs of the index (`TreeHost.dates`). */
export interface DatesHost {
	readerFor(treePath: string, calendarLink?: string): DateReader;
	onChange(cb: () => void): () => void;
}

/** What a window needs to read dates of one tree: the reader for the calendar link of the tree text, and (when the host has an index) the way to hear of a change of any reader. */
export type DatesFor = ((link: string | undefined) => DateReader) & { onChange?: DatesHost['onChange'] };

/** The `DatesFor` of the tree at `treePath`, on an index. */
export const datesForTree = (index: DatesHost, treePath: string): DatesFor => Object.assign((link: string | undefined) => index.readerFor(treePath, link), { onChange: (cb: () => void) => index.onChange(cb) });

/** The reader of a parsed tree, or undefined when the host has no index (a unit fake): the plain reader then reads. */
export const readerOfTree = (dates: DatesFor | undefined, tree: Pick<Tree, 'options'>): DateReader | undefined => dates?.(tree.options.calendar);

/** The graph of a tree with the date reader of its calendar link (spec §14 rule 9); plain years without a reader. The windows derive a graph of the block they edit with this. */
export const deriveDated = (tree: Tree, dates: DatesFor | undefined): FamilyGraph => deriveFamilies(tree, { dates: readerOfTree(dates, tree) });

/** The index as the plugin and the Calendars window use it. */
export interface CalendarIndex extends DatesHost {
	/** False until the first scan and the metadata cache have finished. */
	readonly ready: boolean;
	/** Starts the scan and the vault events; settles when the index is ready. Calling it again returns the same promise. */
	start(): Promise<void>;
	/** Stops the events and the waiting timer. */
	dispose(): void;
	/** The paths of the notes that hold a `kin-calendar` block, sorted. */
	notes(): string[];
	/** The calendar notes that a tree uses: the note its `calendar` link names (if it holds a block), else every calendar note. */
	usedNotes(treePath: string, calendarLink?: string): string[];
	/** The path that a link names, seen from a note, or null. */
	resolve(link: string, fromPath: string): string | null;
	/** Reads one note again now (after the Calendars window wrote it). */
	reload(path: string): Promise<void>;
	/** The calendars of one note, in written order. */
	calendarsOf(path: string): Calendar[];
	/** The name lists of the plain years of one note, in written order (spec §14 rule 13). */
	plainListsOf(path: string): NameList[];
}

/** The wait before the listeners hear of a change, in ms (a burst of events is one change). */
export const CHANGE_WAIT_MS = 300;

/** Settings of the index; the defaults are the real ones. */
export interface IndexOptions {
	waitMs?: number;
	/** Gives the event loop a turn between reads of the first scan (a phone reads one note at a time). */
	pause?: () => Promise<void>;
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
}

const ASCENDING = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** How often the first scan gives the event loop a turn. */
const SLICE = 25;

const pauseDefault = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
	return { calendars, plain, hasPlain, issues, sig: JSON.stringify([calendars, issues.length, ...(hasPlain ? [plain] : [])]) };
}

/** The index behind `createCalendarIndex`. */
class Index implements CalendarIndex {
	private readonly waitMs: number;
	private readonly pause: () => Promise<void>;
	private readonly entries = new Map<string, Entry>();
	/** Notes read while the cache had no entry for them: a cache event reads them again. */
	private readonly unknown = new Set<string>();
	/** The newest read of each path: an older read that finishes later is dropped. */
	private readonly latest = new Map<string, number>();
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribe: (() => void)[] = [];
	private done = false;
	private disposed = false;
	private started: Promise<void> | null = null;
	private version = 0;
	private counter = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	/** The readers handed out: the same instance while the content stays the same. */
	private readonly readers = new Map<string, { version: number; sig: string; reader: DateReader }>();
	private readonly pending = compileCalendars([], false);

	constructor(
		private readonly vault: CalendarVault,
		options: IndexOptions,
	) {
		this.waitMs = options.waitMs ?? CHANGE_WAIT_MS;
		this.pause = options.pause ?? pauseDefault;
	}

	get ready(): boolean {
		return this.done;
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

	private changed(now = false): void {
		this.version++;
		if (this.disposed) return;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		if (now) this.fire();
		else this.timer = setTimeout(() => this.fire(), this.waitMs);
	}

	/** Reads one note and stores or drops its entry. */
	private async load(path: string, state: 'yes' | 'no' | 'unknown' = this.vault.sectionState(path)): Promise<void> {
		const n = ++this.counter;
		this.latest.set(path, n);
		let text: string;
		try {
			text = await this.vault.read(path);
		} catch {
			// A note that cannot be read now (deleted, or a sync is writing it) has no calendars until the next event.
			if (this.latest.get(path) === n) this.drop(path);
			return;
		}
		if (this.latest.get(path) !== n || this.disposed) return;
		if (state === 'unknown') this.unknown.add(path);
		else this.unknown.delete(path);
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

	private drop(path: string): void {
		this.unknown.delete(path);
		this.latest.delete(path);
		if (this.entries.delete(path)) this.changed();
	}

	/** The first scan: the notes whose cached sections can hold a block, and the notes with no cache yet; ready only after the metadata cache has finished. */
	private async scan(): Promise<void> {
		let reads = 0;
		for (const path of this.vault.list()) {
			if (this.disposed) return;
			const state = this.vault.sectionState(path);
			if (state === 'no') continue;
			await this.load(path, state);
			if (++reads % SLICE === 0) await this.pause();
		}
		await this.vault.cacheReady();
		if (this.disposed) return;
		this.done = true;
		// The moment of ready changes the key of every reader: the open trees draw again at once.
		this.changed(true);
	}

	private listen(): void {
		const { vault } = this;
		// The plugin can be turned off before the layout is ready: a late start must register nothing.
		if (this.disposed) return;
		for (const ev of ['create', 'modify'] as const) this.unsubscribe.push(vault.on(ev, (p) => void this.load(p)));
		this.unsubscribe.push(
			vault.on('rename', (p, old) => {
				// A link can name another note after a rename, also when no calendar changed.
				this.version++;
				if (old !== undefined) this.drop(old);
				void this.load(p);
			}),
		);
		this.unsubscribe.push(vault.on('delete', (p) => this.drop(p)));
		this.unsubscribe.push(
			vault.on('cache', (p) => {
				// A note that gained a block while the app was closed: the first scan skipped it on the old answer of the cache.
				if (this.unknown.has(p) || (!this.entries.has(p) && vault.sectionState(p) === 'yes')) void this.load(p);
			}),
		);
	}

	start(): Promise<void> {
		this.started ??= (async () => {
			try {
				this.listen();
				await this.scan();
			} catch (e) {
				// A scan that failed leaves the trees on plain years; the next event reads the notes it meets.
				console.error('Crown and Kin: cannot scan the calendar notes', e);
			}
		})();
		return this.started;
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		for (const off of this.unsubscribe.splice(0)) off();
		this.listeners.clear();
	}

	notes(): string[] {
		return [...this.entries.keys()].sort(ASCENDING);
	}

	usedNotes(treePath: string, link?: string): string[] {
		const text = link?.trim();
		if (!text) return this.notes();
		const path = this.vault.resolve(text, treePath);
		return path !== null && this.entries.has(path) ? [path] : [];
	}

	/**
	 * The calendars, the plain-year lists and the problems of the notes that a tree uses. The plain-year lists come from every used note in index
	 * order; of lists with the same folded name the first is kept, and a later one in another note gives `calendar-duplicate` (spec §14 rule 13).
	 */
	private build(treePath: string, link: string | undefined): { calendars: Calendar[]; plain: NameList[]; problems: CalendarProblem[] } {
		const used = this.usedNotes(treePath, link);
		const calendars = used.flatMap((p) => this.entries.get(p)!.calendars);
		const plain: NameList[] = [];
		const problems: CalendarProblem[] = [];
		const firstNote = new Map<string, string>();
		for (const path of used) {
			for (const list of this.entries.get(path)!.plain) {
				const key = fold(list.name);
				const first = firstNote.get(key);
				if (first === undefined) {
					firstNote.set(key, path);
					plain.push(list);
				} else if (first !== path) problems.push({ key: 'calendar-duplicate', list: list.name, note: path, other: first });
			}
		}
		const text = link?.trim();
		// A note with only a `plain` key is a calendar note (spec §14 rule 13).
		if (text) return { calendars, plain, problems: calendars.length || used.some((p) => this.entries.get(p)!.hasPlain) ? problems : [{ key: 'calendar-note-missing', note: text }] };
		return { calendars, plain, problems: [...findCrossNoteDuplicates(calendars), ...problems] };
	}

	readerFor(treePath: string, calendarLink?: string): DateReader {
		if (!this.done) return this.pending;
		const cacheKey = `${calendarLink?.trim() ?? ''}\u0000${treePath}`;
		const kept = this.readers.get(cacheKey);
		if (kept?.version === this.version) return kept.reader;
		const { calendars, plain, problems } = this.build(treePath, calendarLink);
		const sig = JSON.stringify(plain.length ? [calendars, problems, plain] : [calendars, problems]);
		if (kept?.sig === sig) {
			kept.version = this.version;
			return kept.reader;
		}
		const reader = compileCapped(calendars, true, problems, plain);
		this.readers.set(cacheKey, { version: this.version, sig, reader });
		return reader;
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	resolve(link: string, from: string): string | null {
		return this.vault.resolve(link, from);
	}

	reload(path: string): Promise<void> {
		return this.load(path);
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
