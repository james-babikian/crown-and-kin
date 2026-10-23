// A fake of the vault adaptor of the fence index (the index contract 1.2, 0.4 WP-3a, step T0), with the tools a test needs: events that the test fires, reads that can be held back or fail,
// the cache gates (`cacheReady` and `cacheDone` are two different things), `files()` with a stamp, a fake store, and a fake `localStorage` of the vault (Obsidian's
// `app.loadLocalStorage` and `app.saveLocalStorage`). It is written from the contract. Nothing in `src` is imported: the types below copy the contract, so this file compiles before the build.

/** One Markdown note as `files()` lists it (the index contract 1.2). */
export interface FenceFile {
	path: string;
	mtime: number;
	size: number;
}

export type SectionState = 'yes' | 'no' | 'unknown';
export type FenceEvent = 'cache' | 'create' | 'modify' | 'rename' | 'delete';
export type FenceHandler = (f: FenceFile, text?: string, oldPath?: string) => void;

/** The vault adaptor of the contract (`FenceVault`). */
export interface FenceVaultLike {
	files(): FenceFile[];
	read(path: string): Promise<string>;
	sectionState(path: string): SectionState;
	cacheDone(): boolean;
	on(ev: FenceEvent, cb: FenceHandler): () => void;
	cacheReady(): Promise<void>;
	idle(): Promise<void>;
}

/** The store of the contract (`FenceStore`): the vault's local storage. `save` throws on failure. */
export interface FenceStoreLike {
	load(): unknown;
	save(v: unknown): void;
}

/** A reader that a test holds back: `release` lets it end. */
export interface Held {
	/** True when the index has started the read. */
	readonly started: boolean;
	/** Ends the read with `text` (default: the text the note had when the read started, which is what a late read would see). */
	release(text?: string): void;
	/** Ends the read with a failure. */
	fail(message?: string): void;
}

export interface FakeFenceVault extends FenceVaultLike {
	readonly texts: Map<string, string>;
	readonly stats: Map<string, { mtime: number; size: number }>;
	/** Every `read` call, in order. */
	readonly reads: string[];
	/** How often the index asked for idle time. */
	idleCalls: number;
	/** What `sectionState` says for a path; a path with no entry gets the answer worked out from its text. */
	readonly sections: Map<string, SectionState>;
	/** Paths whose `read` fails. */
	readonly failing: Set<string>;
	/** Runs at the start of every `read`, before it answers. */
	onRead: ((path: string) => void) | null;
	/** Lets `cacheReady()` settle, and sets what `cacheDone()` says (true: the cache finished; false: the start limit passed with the cache not done). */
	openCache(done?: boolean): void;
	/** Holds back the next read of `path`. */
	hold(path: string): Held;
	/** How many handlers are registered for an event. */
	listenerCount(ev: FenceEvent): number;
	/** Fires an event by hand. */
	emit(ev: FenceEvent, f: FenceFile, text?: string, oldPath?: string): void;
	/** The file record of a path (throws for a path that is not there). */
	file(path: string): FenceFile;
	/** A new note, as Obsidian shows it: `create`, then `changed` with the text (`cache: false` leaves the `changed` out). */
	add(path: string, text: string, o?: { cache?: boolean }): void;
	/** A changed note: `modify`, then `changed` with the text (`cache: false` leaves the `changed` out). The mtime and the size change. */
	edit(path: string, text: string, o?: { cache?: boolean }): void;
	/** A deleted note. */
	remove(path: string): void;
	/** A renamed note: the text, the mtime and the size stay; the note moves to the end of `files()`; Obsidian fires no `changed` for a rename. */
	rename(from: string, to: string): void;
	/** A change while the plugin did not run: the text and the stamp change, no event. */
	setQuietly(path: string, text: string): void;
	/** The same notes with the same stamps and a new, quiet vault: what the next start of the plugin finds. */
	clone(o?: FakeFenceOptions): FakeFenceVault;
}

/** A note text works out to 'yes' when the metadata cache would list a code, callout, quote or list section in it. */
const sectionOf = (text: string): SectionState => (/^[ \t]*(```|~~~|>|[-*+][ \t]|\d+[.)][ \t])/m.test(text) ? 'yes' : 'no');

/** Options of the fake. A vault starts with the cache ready and done. */
export interface FakeFenceOptions {
	cacheReady?: boolean;
	cacheDone?: boolean;
}

interface Pending {
	resolve(text: string): void;
	reject(e: Error): void;
	snapshot: string;
	started: boolean;
}

/** One clock for all fakes, so that a change in one vault never gets the mtime that another note of a cloned vault already has. */
let clock = 1000;

/** Makes a fake vault from path to text. Every note gets its own mtime. */
export function fakeFenceVault(initial: Record<string, string> = {}, o: FakeFenceOptions = {}): FakeFenceVault {
	let done = o.cacheDone ?? true;
	let open: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => (open = resolve));
	if (o.cacheReady ?? true) open();
	const handlers = new Map<FenceEvent, Set<FenceHandler>>();
	const holds = new Map<string, Pending>();
	const v: FakeFenceVault = {
		texts: new Map(Object.entries(initial)),
		stats: new Map(),
		reads: [],
		idleCalls: 0,
		sections: new Map(),
		failing: new Set(),
		onRead: null,
		files: () => [...v.texts.keys()].map((p) => v.file(p)),
		file(path) {
			const s = v.stats.get(path);
			const t = v.texts.get(path);
			if (!s || t === undefined) throw new Error(`no note ${path}`);
			return { path, mtime: s.mtime, size: s.size };
		},
		read(path) {
			v.reads.push(path);
			const text = v.texts.get(path);
			v.onRead?.(path);
			if (v.failing.has(path)) return Promise.reject(new Error('cannot read'));
			const waiting = holds.get(path);
			if (waiting) {
				holds.delete(path);
				waiting.started = true;
				waiting.snapshot = text ?? '';
				return new Promise<string>((resolve, reject) => {
					waiting.resolve = resolve;
					waiting.reject = reject;
				});
			}
			if (text === undefined) return Promise.reject(new Error('no such note'));
			return Promise.resolve(text);
		},
		sectionState(path) {
			return v.sections.get(path) ?? sectionOf(v.texts.get(path) ?? '');
		},
		cacheDone: () => done,
		cacheReady: () => gate,
		openCache(isDone = true) {
			done = isDone;
			open();
		},
		idle() {
			v.idleCalls++;
			return Promise.resolve();
		},
		on(ev, cb) {
			const set = handlers.get(ev) ?? new Set();
			handlers.set(ev, set);
			set.add(cb);
			return () => set.delete(cb);
		},
		listenerCount: (ev) => handlers.get(ev)?.size ?? 0,
		emit(ev, f, text, oldPath) {
			for (const cb of [...(handlers.get(ev) ?? [])]) cb(f, text, oldPath);
		},
		hold(path) {
			const p: Pending = { resolve: () => undefined, reject: () => undefined, snapshot: '', started: false };
			holds.set(path, p);
			return {
				get started() {
					return p.started;
				},
				release: (text) => p.resolve(text ?? p.snapshot),
				fail: (message = 'cannot read') => p.reject(new Error(message)),
			};
		},
		add(path, text, opt = {}) {
			v.setQuietly(path, text);
			v.emit('create', v.file(path));
			if (opt.cache !== false) v.emit('cache', v.file(path), text);
		},
		edit(path, text, opt = {}) {
			v.setQuietly(path, text);
			v.emit('modify', v.file(path));
			if (opt.cache !== false) v.emit('cache', v.file(path), text);
		},
		remove(path) {
			const f = v.file(path);
			v.texts.delete(path);
			v.stats.delete(path);
			v.emit('delete', f);
		},
		rename(from, to) {
			const text = v.texts.get(from);
			const stat = v.stats.get(from);
			if (text === undefined || !stat) throw new Error(`no note ${from}`);
			v.texts.delete(from);
			v.stats.delete(from);
			v.texts.set(to, text);
			v.stats.set(to, stat);
			v.emit('rename', v.file(to), undefined, from);
		},
		setQuietly(path, text) {
			v.texts.set(path, text);
			v.stats.set(path, { mtime: ++clock, size: text.length });
		},
		clone(opt = {}) {
			const c = fakeFenceVault({}, opt);
			for (const [p, t] of v.texts) c.texts.set(p, t);
			for (const [p, s] of v.stats) c.stats.set(p, { ...s });
			return c;
		},
	};
	for (const [p, t] of v.texts) v.stats.set(p, { mtime: ++clock, size: t.length });
	return v;
}

/** A fake store: it keeps a copy of what was saved, and it can be made to fail. */
export interface FakeStore extends FenceStoreLike {
	value: unknown;
	/** Every value that was saved, in order (copies). */
	readonly saves: unknown[];
	/** Every `save` call, also the ones that threw. */
	saveCalls: number;
	failSave: boolean;
	failLoad: boolean;
	/** The newest saved value, or undefined. */
	last(): FenceStoreValue | undefined;
}

/** The value of the contract (1.3). */
export interface FenceStoreValue {
	v: number;
	n: number;
	f: Record<string, 1 | 2 | 3>;
	s: string | null;
}

const copy = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** Makes a store that starts with `initial` (no value: a first start). */
export function fakeStore(initial?: unknown): FakeStore {
	const s: FakeStore = {
		value: copy(initial),
		saves: [],
		saveCalls: 0,
		failSave: false,
		failLoad: false,
		load() {
			if (s.failLoad) throw new Error('storage blocked');
			return copy(s.value);
		},
		save(value) {
			s.saveCalls++;
			if (s.failSave) throw new Error('storage full');
			s.value = copy(value);
			s.saves.push(copy(value));
		},
		last: () => s.saves[s.saves.length - 1] as FenceStoreValue | undefined,
	};
	return s;
}

// ---------- the stamp, written again from the contract (so a test does not use the code it tests) ----------

/** FNV-1a, 32 bits, unsigned, over the UTF-16 code units of a string (the index contract 1.3). The tests use ASCII paths, where this is the same as over bytes. */
export function fnv1a32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** The key of a path and the stamp of a file, as the contract defines them. */
export const pathKey = (path: string): number => fnv1a32(path);
export const stampOf = (f: FenceFile): number => fnv1a32(`${f.mtime}:${f.size}`);

/** Reads `s` of a saved value: the pairs `[pathKey, stamp]` in the order stored (little-endian uint32, 8 bytes each). */
export function decodePairs(value: FenceStoreValue): [number, number][] {
	if (value.s === null) return [];
	const bytes = Buffer.from(value.s, 'base64');
	const out: [number, number][] = [];
	for (let i = 0; i + 8 <= bytes.length; i += 8) out.push([bytes.readUInt32LE(i), bytes.readUInt32LE(i + 4)]);
	return out;
}

/** Writes `s` for a list of files, as the contract says: sorted by path key. Tests use it to hand-make a valid store. */
export function encodePairs(files: readonly FenceFile[], skip: ReadonlySet<string> = new Set()): { n: number; s: string | null } {
	const pairs = files.filter((f) => !skip.has(f.path)).map((f): [number, number] => [pathKey(f.path), stampOf(f)]);
	pairs.sort((a, b) => a[0] - b[0]);
	if (!pairs.length) return { n: 0, s: null };
	const bytes = Buffer.alloc(pairs.length * 8);
	pairs.forEach(([k, st], i) => {
		bytes.writeUInt32LE(k, i * 8);
		bytes.writeUInt32LE(st, i * 8 + 4);
	});
	return { n: pairs.length, s: bytes.toString('base64') };
}

// ---------- waiting for promises ----------

/** Lets pending promises run (no timers). */
export async function turns(n = 40): Promise<void> {
	for (let i = 0; i < n; i++) await Promise.resolve();
}

/** Waits, in promise turns only, until `cond` holds. Throws when it does not hold after `max` turns. */
export async function until(cond: () => boolean, max = 400_000): Promise<void> {
	for (let i = 0; i < max; i++) {
		if (cond()) return;
		await Promise.resolve();
	}
	throw new Error('the condition never held');
}

// ---------- the local storage of the vault (Obsidian: app.loadLocalStorage / app.saveLocalStorage) ----------

export interface FakeLocalStorage {
	readonly data: Map<string, unknown>;
	/** Every call, in order. A load that threw or a save that threw is in the list too. */
	readonly calls: { op: 'load' | 'save'; key: string; value?: unknown; threw?: boolean }[];
	/** True, or a function of the key: a save of that key throws. */
	failSave: boolean | ((key: string) => boolean);
	failLoad: boolean | ((key: string) => boolean);
	/** The two methods of Obsidian's `App`. */
	readonly app: { loadLocalStorage(key: string): unknown; saveLocalStorage(key: string, value: unknown): void };
	/** The values saved under a key, in order. */
	savesOf(key: string): unknown[];
	/** A store for the fence index on this storage (what `src/obsidian/fence-vault.ts` would give). */
	storeFor(key: string): FenceStoreLike;
}

const failing = (flag: boolean | ((key: string) => boolean), key: string): boolean => (typeof flag === 'function' ? flag(key) : flag);

/** A fake local storage: values are kept as JSON copies, as the browser does. */
export function fakeLocalStorage(initial: Record<string, unknown> = {}): FakeLocalStorage {
	const ls: FakeLocalStorage = {
		data: new Map(Object.entries(initial).map(([k, v]) => [k, copy(v)])),
		calls: [],
		failSave: false,
		failLoad: false,
		app: {
			loadLocalStorage(key) {
				if (failing(ls.failLoad, key)) {
					ls.calls.push({ op: 'load', key, threw: true });
					throw new Error('storage blocked');
				}
				ls.calls.push({ op: 'load', key });
				return copy(ls.data.get(key) ?? null);
			},
			saveLocalStorage(key, value) {
				if (failing(ls.failSave, key)) {
					ls.calls.push({ op: 'save', key, value: copy(value), threw: true });
					throw new Error('storage full');
				}
				ls.calls.push({ op: 'save', key, value: copy(value) });
				if (value === null || value === undefined) ls.data.delete(key);
				else ls.data.set(key, copy(value));
			},
		},
		savesOf: (key) => ls.calls.filter((c) => c.op === 'save' && c.key === key && !c.threw).map((c) => c.value),
		storeFor: (key) => ({
			load: () => ls.app.loadLocalStorage(key),
			save: (value) => ls.app.saveLocalStorage(key, value),
		}),
	};
	return ls;
}
