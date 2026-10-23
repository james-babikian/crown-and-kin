// Fakes for the tests of package C (0.4 WP-3a, step T0): a vault for the calendar index as the index contract 4.1 gives it (no `list`, no `sectionState`; `on('cache')` passes the text),
// a fake app for the Calendars window and the chooser, and the typed loaders of the modules whose signatures change. Written from the contract, before the code exists.
import { vi } from 'vitest';
import { TFile as VaultFile } from 'obsidian';
import { FEl, dispatch } from '../acceptance/fake-dom';
import { lastMenu, openModals } from '../acceptance/fake-obsidian';

export { cycleNote, eraNote } from './calendar-vault';

// ---------- the calendar vault of the contract ----------

export type CalEvent = 'create' | 'rename' | 'delete' | 'cache';

/** The vault of the calendar index after package C (the index contract 4.1): `read`, `resolve`, `on`, `cacheReady`. For 'cache' the second argument is the text; for 'rename' it is the old path. */
export interface CalVaultLike {
	read(path: string): Promise<string>;
	resolve(link: string, fromPath: string): string | null;
	on(event: CalEvent, cb: (path: string, second?: string) => void): () => void;
	cacheReady(): Promise<void>;
}

export interface FakeCalVault extends CalVaultLike {
	/** The notes, path to text. */
	notes: Map<string, string>;
	/** A link text to the path it opens. A link whose note is not in `notes` opens nothing. */
	links: Map<string, string>;
	reads: string[];
	resolveCalls: number;
	/** Paths whose read fails. */
	failing: Set<string>;
	/** Opens `cacheReady()`. */
	cacheDone(): void;
	listenerCount(event: CalEvent): number;
	emit(event: CalEvent, path: string, second?: string): void;
	/** A changed note, as Obsidian tells it: `changed` with the text. */
	edit(path: string, text: string): void;
	/** A new note: `create`, then `changed` with the text. */
	add(path: string, text: string): void;
	remove(path: string): void;
	/** The note moves; the link texts in `links` that named it are not changed (a test sets them). */
	rename(from: string, to: string): void;
	/** Holds back the next read of `path`; `release(text)` ends it with the text it saw when it started (or the one given). */
	hold(path: string): { readonly started: boolean; release(text?: string): void };
}

/** Makes a fake calendar vault. `cacheReady: false` leaves the metadata cache not ready until `cacheDone()`. */
export function calVault(files: Record<string, string> = {}, links: Record<string, string> = {}, cacheReady = true): FakeCalVault {
	const handlers = new Map<CalEvent, Set<(path: string, second?: string) => void>>();
	const holds = new Map<string, { resolve(t: string): void; snapshot: string; started: boolean }>();
	let open: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (open = resolve));
	if (cacheReady) open();
	const v: FakeCalVault = {
		notes: new Map(Object.entries(files)),
		links: new Map(Object.entries(links)),
		reads: [],
		resolveCalls: 0,
		failing: new Set(),
		read(path) {
			v.reads.push(path);
			if (v.failing.has(path)) return Promise.reject(new Error('cannot read'));
			const text = v.notes.get(path);
			const waiting = holds.get(path);
			if (waiting) {
				holds.delete(path);
				waiting.started = true;
				waiting.snapshot = text ?? '';
				return new Promise<string>((resolve) => (waiting.resolve = resolve));
			}
			if (text === undefined) return Promise.reject(new Error('no such note'));
			return Promise.resolve(text);
		},
		resolve(link) {
			v.resolveCalls++;
			const path = v.links.get(link);
			return path !== undefined && v.notes.has(path) ? path : null;
		},
		on(event, cb) {
			const set = handlers.get(event) ?? new Set();
			handlers.set(event, set);
			set.add(cb);
			return () => set.delete(cb);
		},
		cacheReady: () => gate,
		cacheDone: () => open(),
		listenerCount: (event) => handlers.get(event)?.size ?? 0,
		emit(event, path, second) {
			for (const cb of [...(handlers.get(event) ?? [])]) cb(path, second);
		},
		edit(path, text) {
			v.notes.set(path, text);
			v.emit('cache', path, text);
		},
		add(path, text) {
			v.notes.set(path, text);
			v.emit('create', path);
			v.emit('cache', path, text);
		},
		remove(path) {
			v.notes.delete(path);
			v.emit('delete', path);
		},
		rename(from, to) {
			const text = v.notes.get(from);
			if (text === undefined) throw new Error(`no note ${from}`);
			v.notes.delete(from);
			v.notes.set(to, text);
			v.emit('rename', to, from);
		},
		hold(path) {
			const p: { resolve(t: string): void; snapshot: string; started: boolean } = { resolve: () => undefined, snapshot: '', started: false };
			holds.set(path, p);
			return {
				get started() {
					return p.started;
				},
				release: (text) => p.resolve(text ?? p.snapshot),
			};
		},
	};
	return v;
}

// ---------- the loaders of the modules whose signatures change ----------

/** The options of the calendar index after package C: `notes` is the list of the fence notes (`fence.notes('cal')`). `complete` is an ASSUMED name (see the report). */
export interface CalIndexOptions {
	waitMs?: number;
	pause?: () => Promise<void>;
	notes?: () => string[];
	complete?: () => boolean;
}

/** What a test needs of the calendar index (the public names stay; the index contract 4.1). */
export interface CalIndexLike {
	readonly ready: boolean;
	start(): Promise<void>;
	dispose(): void;
	notes(): string[];
	usedNotes(treePath: string, link?: string): string[];
	resolve(link: string, fromPath: string): string | null;
	reload(path: string): Promise<void>;
	calendarsOf(path: string): { name: string }[];
	plainListsOf(path: string): unknown[];
	readerFor(treePath: string, link?: string): { ready: boolean; key: string; problems: { key: string }[]; hasLists: boolean; read(text: string | undefined): unknown };
	onChange(cb: () => void): () => void;
}

/** Makes the real calendar index on a fake vault. The call is cast: the types of `vault` and `options` are those of the contract, not of the code of today. */
export async function makeIndex(vault: CalVaultLike, options: CalIndexOptions = {}): Promise<CalIndexLike> {
	const { createCalendarIndex } = await import('../../src/view/calendar-index');
	return (createCalendarIndex as unknown as (v: CalVaultLike, o: CalIndexOptions) => CalIndexLike)(vault, { pause: async () => undefined, ...options });
}

// ---------- the fake app of the window and the chooser ----------

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Lets pending promises and zero timers run. */
export async function settleReal(turns = 12): Promise<void> {
	for (let i = 0; i < turns; i++) await tick();
}

/** An app with notes in a map: `read`, `process`, `create`, the root folder; `fileToLinktext` gives the file name without ".md". */
export function fakeCalApp(files: Record<string, string>) {
	const notes = new Map(Object.entries(files));
	const created: string[] = [];
	const file = (path: string): VaultFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		return Object.assign(new File(path, 'md'), { name, basename: name.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
	};
	const folders = new Set<string>();
	const root = () => ({ path: '/', name: '', isRoot: () => true, children: [...notes.keys()].filter((p) => !p.includes('/')).map((p) => ({ name: p, path: p })) });
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (notes.has(p) ? file(p) : folders.has(p) ? { path: p, children: [], isRoot: () => false } : null),
			read: async (f: { path: string }) => notes.get(f.path) ?? '',
			cachedRead: async (f: { path: string }) => notes.get(f.path) ?? '',
			process: async (f: { path: string }, fn: (t: string) => string) => {
				const next = fn(notes.get(f.path) ?? '');
				notes.set(f.path, next);
				return next;
			},
			create: vi.fn(async (path: string, data: string) => {
				notes.set(path, data);
				created.push(path);
				return file(path);
			}),
			createFolder: vi.fn(async (p: string) => void folders.add(p)),
			getRoot: root,
			getFiles: () => [...notes.keys()].map(file),
			getMarkdownFiles: () => [...notes.keys()].map(file),
		},
		metadataCache: { fileToLinktext: (f: { path: string }) => f.path.replace(/\.md$/, '').split('/').pop()!, getFirstLinkpathDest: () => null },
		workspace: { getActiveFile: () => null as { path: string } | null },
	};
	return { app, notes, created };
}

/** The notes of a notes map that hold a `kin-calendar` fence, sorted by path: what `fence.notes('cal')` would give the index. */
export const calendarNotesOf = (notes: Map<string, string>): string[] => [...notes].filter(([, t]) => t.includes('```kin-calendar')).map(([p]) => p).sort();

// ---------- the controls of the window ----------

export const control = (c: FEl, name: string): FEl => {
	const el = c.querySelector(`[data-focus="${name}"]`);
	if (!el) throw new Error(`no control ${name}`);
	return el;
};
export const calField = (c: FEl, name: string): FEl => control(c, `cal:${name}`);

/** The keys of the calendars that the window shows now, in order (the draft keys count on while the window is open, so the first calendar of a second note is not 0). */
export const calendarKeys = (c: FEl): string[] =>
	c
		.querySelectorAll('[data-calendar]')
		.map((e) => e.getAttribute('data-calendar') ?? '')
		.filter((k) => k !== 'plain');

/** The name of the first calendar that the window shows. */
export const firstCalendarName = (c: FEl): string => String(calField(c, `${calendarKeys(c)[0]}-name`).value);
export const hasField = (c: FEl, name: string): boolean => c.querySelector(`[data-focus="cal:${name}"]`) !== null;

/** Writes a value into a field, as the user types it. */
export const typeInto = (c: FEl, name: string, value: string): void => {
	const el = calField(c, name);
	el.value = value;
	dispatch(el, 'input');
};

/** A click on the first element that matches, then the pending work. */
export const press = async (c: FEl, selector: string): Promise<void> => {
	const el = c.querySelector(selector);
	if (!el) throw new Error(`no ${selector}`);
	dispatch(el, 'click');
	await settleReal();
};

export const saveWindow = (c: FEl) => press(c, '.dynasty-sheet-save');
export const lastModal = (): { contentEl: FEl; modalEl: FEl; close(): void } => openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl; close(): void };
export { lastMenu, openModals };
