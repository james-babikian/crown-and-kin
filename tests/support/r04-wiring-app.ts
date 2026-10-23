// A fake app and a plugin starter for the wiring tests of package W (0.4 WP-3a, step T0): `main.ts` with notes in a map, the metadata cache with events the test fires, a layout-ready that the test
// fires, the local storage of the vault (tests/support/fake-fence-vault.ts) and the fake window with its clock. Written from the contract, before the code exists.
import { vi } from 'vitest';
import { TFile } from 'obsidian';
import DynastyTreePlugin from '../../src/obsidian/main';
import { clock, runTimers, settle } from '../acceptance/fake-dom';
import type { Plugin as FakePlugin } from '../acceptance/fake-obsidian';
import { fakeApp as baseApp } from '../acceptance/tree-view-fakes';
import type { FakeLocalStorage } from './fake-fence-vault';

/** The keys of the two stores of the contract (the index contract 1.3 and 3). */
export const FENCE_KEY = 'crown-and-kin-fence-index';
export const PENDING_KEY_LOCAL = 'crown-and-kin-pending-renames';

const File = TFile as unknown as new (path: string, extension: string) => TFile;

type Handler = (...args: unknown[]) => void;

/** An app with notes in a map. `reads` lists every `cachedRead`. */
export function wiringApp(files: Record<string, string>, ls: FakeLocalStorage) {
	const base = baseApp();
	const texts = new Map(Object.entries(files));
	const tfiles = new Map<string, TFile>();
	let counter = 1000;
	const make = (path: string): TFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		const text = texts.get(path) ?? '';
		return Object.assign(new File(path, 'md'), { name, basename: name.replace(/\.md$/, ''), stat: { mtime: ++counter, ctime: 1, size: text.length } }) as TFile;
	};
	for (const p of texts.keys()) tfiles.set(p, make(p));
	const reads: string[] = [];
	const writes: string[] = [];
	const layoutCallbacks: (() => void)[] = [];
	const meta = new Map<string, { name: string; fn: Handler }[]>();
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const vault = Object.assign(base.vault, {
		getMarkdownFiles: () => [...tfiles.values()],
		getFiles: () => [...tfiles.values()],
		getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
		read: async (f: TFile) => texts.get(f.path) ?? '',
		cachedRead: async (f: TFile) => {
			reads.push(f.path);
			return texts.get(f.path) ?? '';
		},
		process: async (f: TFile, fn: (t: string) => string) => {
			const next = fn(texts.get(f.path) ?? '');
			if (next !== texts.get(f.path)) writes.push(f.path);
			texts.set(f.path, next);
			return next;
		},
	});
	const metadataCache = {
		on(name: string, fn: Handler) {
			const ref = { name, fn };
			meta.set(name, [...(meta.get(name) ?? []), ref]);
			return ref;
		},
		offref(ref: { name: string; fn: Handler }) {
			meta.set(
				ref.name,
				(meta.get(ref.name) ?? []).filter((r) => r !== ref),
			);
		},
		getFirstLinkpathDest(linkpath: string) {
			const want = stem(linkpath.replace(/\\/g, '/'));
			for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
			return null;
		},
		fileToLinktext: (f: TFile) => f.path.replace(/\.md$/i, '').split('/').pop()!,
		getFileCache: () => null,
		resolved: false,
	};
	const workspace = { ...base.workspace, onLayoutReady: (cb: () => void) => void layoutCallbacks.push(cb), getLeavesOfType: () => [] as unknown[] };
	const app = { ...base, vault, metadataCache, workspace, loadLocalStorage: ls.app.loadLocalStorage, saveLocalStorage: ls.app.saveLocalStorage };
	return {
		app,
		texts,
		tfiles,
		reads,
		writes,
		file: (path: string): TFile => tfiles.get(path)!,
		/** A new note that the vault knows (no event is fired). */
		put(path: string, text: string): TFile {
			texts.set(path, text);
			const f = make(path);
			tfiles.set(path, f);
			return f;
		},
		/** Obsidian renames a note: the file object gets the new path; the `rename` event is not fired. */
		move(from: string, to: string): TFile {
			const f = tfiles.get(from)!;
			tfiles.delete(from);
			f.path = to;
			tfiles.set(to, f);
			texts.set(to, texts.get(from)!);
			texts.delete(from);
			return f;
		},
		/** Layout ready: runs the callbacks that the plugin registered. */
		layoutReady(): void {
			for (const cb of layoutCallbacks.splice(0)) cb();
		},
		/** The metadata cache tells: `changed` (file, text) or `resolved`. */
		metaFire(name: string, ...args: unknown[]): void {
			if (name === 'resolved') metadataCache.resolved = true;
			for (const r of [...(meta.get(name) ?? [])]) r.fn(...args);
		},
		metaCount: (name: string): number => (meta.get(name) ?? []).length,
	};
}

export type WiringApp = ReturnType<typeof wiringApp>;

/** Moves the fake clock on, with a turn of real time at each step so that the promises of the plugin end. */
export async function advance(ms: number, step = 500): Promise<void> {
	for (let t = 0; t < ms; t += step) {
		runTimers(step);
		await settle();
	}
}

export interface BootOptions {
	files?: Record<string, string>;
	/** The content of data.json. */
	stored?: unknown;
	ls: FakeLocalStorage;
	/** `loadData` fails this many times (then answers `stored`); 'always': never answers. */
	loadFails?: number | 'always';
	/** Replace the fence index before the plugin loads (a unit fake of the contract's `FenceIndex`). */
	fence?: unknown;
}

/** Makes the plugin on a fake app and loads it (not yet layout-ready). `log` lists the writes of data.json and of the local storage in the order they happen. */
export async function bootPlugin(o: BootOptions) {
	const app = wiringApp(o.files ?? {}, o.ls);
	const log: string[] = [];
	const save = o.ls.app.saveLocalStorage;
	app.app.saveLocalStorage = (key: string, value: unknown) => {
		log.push(`local:${key}`);
		save(key, value);
	};
	const plugin = new DynastyTreePlugin(app.app as never, { id: 'crown-and-kin' } as never);
	const fake = plugin as unknown as FakePlugin;
	fake.stored = o.stored ?? null;
	let failures = o.loadFails === 'always' ? Number.POSITIVE_INFINITY : (o.loadFails ?? 0);
	const stored = o.stored ?? null;
	fake.loadData = async () => {
		if (failures > 0) {
			failures--;
			throw new Error('cannot read data.json');
		}
		return stored;
	};
	const saveData = fake.saveData.bind(fake);
	fake.saveData = async (data: unknown) => {
		log.push('data');
		return saveData(data);
	};
	// The fake Plugin of the acceptance folder has no `registerDomEvent`; Obsidian's has one, and the plugin may use it.
	(plugin as unknown as { registerDomEvent: unknown }).registerDomEvent = (target: { addEventListener(t: string, cb: unknown): void; removeEventListener(t: string, cb: unknown): void }, type: string, cb: unknown) => {
		target.addEventListener(type, cb);
		fake.register(() => target.removeEventListener(type, cb));
	};
	if (o.fence !== undefined) (plugin as unknown as { fence: unknown }).fence = o.fence;
	const restore = vi.spyOn(plugin.links, 'restore');
	const resume = vi.spyOn(plugin.links, 'resume');
	await fake.load();
	return { plugin, fake, app, log, restore, resume, ls: o.ls, clockNow: () => clock.now };
}

export type Booted = Awaited<ReturnType<typeof bootPlugin>>;

/** The data.json payloads that the plugin saved, newest last. */
export const savedFiles = (b: Booted): Record<string, unknown>[] => b.fake.saved as Record<string, unknown>[];
