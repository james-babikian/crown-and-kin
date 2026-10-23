import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { FENCE_STORE_KEY, fenceOptionsForDevice, obsidianFenceStore, obsidianFenceVault, saveWhenLeaving } from '../../src/obsidian/fence-vault';
import { createFenceIndex } from '../../src/view/fence-index';
import { fakeFenceVault, fakeLocalStorage, fakeStore, until } from '../support/fake-fence-vault';

/*
 * 0.4 WP-3a, package F: the real adaptor of the fence index (`src/obsidian/fence-vault.ts`) on a small fake app, and the save when the page hides
 * (supervisor ruling: `FenceIndex.flush()`, called at `pagehide` and at `visibilitychange` to hidden). Not in the T0 set; added by the builder of package F.
 */

type Handler = (...args: unknown[]) => void;

const file = (path: string, mtime = 5, size = 7): TFile => Object.assign(new (TFile as unknown as new (p: string, e: string) => TFile)(path, 'md'), { stat: { mtime, size } }) as TFile;

/** An app with the few members that the adaptor uses. */
function fakeApp(sections: Record<string, string[] | null> = {}) {
	const files = new Map<string, TFile>();
	const handlers: { bus: 'vault' | 'meta'; name: string; fn: Handler }[] = [];
	const reads: string[] = [];
	const texts = new Map<string, string>();
	const add = (path: string, text = '', mtime = 5, size = text.length): TFile => {
		const f = file(path, mtime, size);
		files.set(path, f);
		texts.set(path, text);
		return f;
	};
	const bus = (kind: 'vault' | 'meta') => ({
		on(name: string, fn: Handler) {
			const ref = { bus: kind, name, fn };
			handlers.push(ref);
			return ref;
		},
		offref(ref: unknown) {
			const i = handlers.indexOf(ref as (typeof handlers)[number]);
			if (i >= 0) handlers.splice(i, 1);
		},
	});
	const app = {
		vault: {
			...bus('vault'),
			getMarkdownFiles: () => [...files.values()],
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			cachedRead: async (f: TFile) => {
				reads.push(f.path);
				return texts.get(f.path) ?? '';
			},
		},
		metadataCache: {
			...bus('meta'),
			getFileCache: (f: TFile) => (sections[f.path] === undefined ? null : sections[f.path] === null ? { sections: undefined } : { sections: sections[f.path]!.map((type) => ({ type })) }),
		},
	};
	const fire = (b: 'vault' | 'meta', name: string, ...args: unknown[]) => handlers.filter((h) => h.bus === b && h.name === name).forEach((h) => h.fn(...args));
	return { app: app as never, add, fire, reads, handlers, texts };
}

const open = { seen: () => true, done: () => true, limitMs: 100 };

describe('the fence vault on a fake app (the index contract 1.2)', () => {
	it('lists the notes with the stamp numbers, and reads from the cache of the vault', async () => {
		const a = fakeApp();
		a.add('A.md', 'abc', 11, 3);
		a.add('B.md', 'x', 12, 1);
		const v = obsidianFenceVault(a.app, open);
		expect(v.files()).toEqual([
			{ path: 'A.md', mtime: 11, size: 3 },
			{ path: 'B.md', mtime: 12, size: 1 },
		]);
		await expect(v.read('A.md')).resolves.toBe('abc');
		await expect(v.read('none.md')).rejects.toThrow();
	});

	it('says yes for a section that can hold a block, no for the others, unknown for a note with no cache entry', () => {
		const a = fakeApp({ 'code.md': ['paragraph', 'code'], 'list.md': ['list'], 'plain.md': ['paragraph', 'heading'], 'empty.md': null });
		['code.md', 'list.md', 'plain.md', 'empty.md', 'fresh.md'].forEach((p) => a.add(p));
		const v = obsidianFenceVault(a.app, open);
		expect(['code.md', 'list.md', 'plain.md', 'empty.md', 'fresh.md'].map((p) => v.sectionState(p))).toEqual(['yes', 'yes', 'no', 'no', 'unknown']);
		expect(v.sectionState('not-a-note.md')).toBe('no');
	});

	it('passes the events on with a stamp record: cache with the text, rename with the old path, and removes the listener', () => {
		const a = fakeApp();
		const f = a.add('A.md', '', 9, 4);
		const v = obsidianFenceVault(a.app, open);
		const got: unknown[][] = [];
		const offs = (['cache', 'create', 'modify', 'rename', 'delete'] as const).map((ev) => v.on(ev, (...args) => got.push([ev, ...args])));
		a.fire('meta', 'changed', f, 'the text', {});
		a.fire('vault', 'create', f);
		a.fire('vault', 'modify', f);
		a.fire('vault', 'rename', f, 'Old.md');
		a.fire('vault', 'delete', f);
		const rec = { path: 'A.md', mtime: 9, size: 4 };
		expect(got).toEqual([
			['cache', rec, 'the text'],
			['create', rec],
			['modify', rec],
			['rename', rec, undefined, 'Old.md'],
			['delete', rec],
		]);
		a.fire('vault', 'create', { path: 'pic.png', extension: 'png' });
		expect(got.length).toBe(5);
		offs.forEach((off) => off());
		expect(a.handlers.length).toBe(0);
	});

	it('cacheDone follows the gate, not the start limit', () => {
		const a = fakeApp();
		const v = obsidianFenceVault(a.app, { seen: () => true, done: () => false, limitMs: 10 });
		expect(v.cacheDone()).toBe(false);
	});

	it('cacheReady settles at once when the gate has seen the cache, on "resolved" otherwise, and at the limit at last', async () => {
		vi.useFakeTimers();
		try {
			const a = fakeApp();
			let seen = false;
			const v = obsidianFenceVault(a.app, { seen: () => seen, done: () => seen, limitMs: 500 });
			let ended = 0;
			void v.cacheReady().then(() => ended++);
			await vi.advanceTimersByTimeAsync(100);
			expect(ended).toBe(0);
			a.fire('meta', 'resolved');
			await vi.advanceTimersByTimeAsync(0);
			expect(ended).toBe(1);
			expect(a.handlers.length).toBe(0);
			void v.cacheReady().then(() => ended++);
			await vi.advanceTimersByTimeAsync(600);
			expect(ended).toBe(2);
			seen = true;
			await v.cacheReady();
		} finally {
			vi.useRealTimers();
		}
	});

	it('the store is the local storage of the vault under the key of the contract', () => {
		const ls = fakeLocalStorage();
		const store = obsidianFenceStore(ls.app as never);
		expect(store.load()).toBeNull();
		store.save({ v: 1, n: 0, f: {}, s: null });
		expect(ls.savesOf(FENCE_STORE_KEY)).toEqual([{ v: 1, n: 0, f: {}, s: null }]);
		expect(FENCE_STORE_KEY).toBe('crown-and-kin-fence-index');
		ls.failSave = true;
		expect(() => store.save({})).toThrow();
	});

	it('the options: ten reads a slice on a coarse pointer, the defaults otherwise', () => {
		const g = globalThis as { window?: { matchMedia?: unknown } };
		const old = g.window?.matchMedia;
		try {
			g.window!.matchMedia = (q: string) => ({ matches: q === '(pointer: coarse)' });
			expect(fenceOptionsForDevice()).toEqual({ readsPerSlice: 10 });
			g.window!.matchMedia = () => ({ matches: false });
			expect(fenceOptionsForDevice()).toEqual({});
			g.window!.matchMedia = undefined;
			expect(fenceOptionsForDevice()).toEqual({});
		} finally {
			g.window!.matchMedia = old;
		}
	});
});

/** Two event targets with a document whose visibility the test sets. */
function leaveTargets() {
	const listeners = new Map<string, Set<() => void>>();
	const target = () => ({
		addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
		removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
	});
	const doc = Object.assign(target(), { visibilityState: 'visible' as DocumentVisibilityState });
	const win = target();
	const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn());
	return { targets: { win, doc } as never, doc, fire, count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) };
}

describe('the save when the page goes away (supervisor ruling: flush on pagehide and on visibilitychange to hidden)', () => {
	it('pagehide flushes; a change to hidden flushes; a change to visible does not', () => {
		const index = { flush: vi.fn() };
		const t = leaveTargets();
		saveWhenLeaving(index, t.targets);
		t.fire('pagehide');
		expect(index.flush).toHaveBeenCalledTimes(1);
		t.doc.visibilityState = 'visible';
		t.fire('visibilitychange');
		expect(index.flush).toHaveBeenCalledTimes(1);
		t.doc.visibilityState = 'hidden';
		t.fire('visibilitychange');
		expect(index.flush).toHaveBeenCalledTimes(2);
	});

	it('the function that it returns removes both listeners', () => {
		const index = { flush: vi.fn() };
		const t = leaveTargets();
		const off = saveWhenLeaving(index, t.targets);
		expect(t.count()).toBe(2);
		off();
		expect(t.count()).toBe(0);
		t.doc.visibilityState = 'hidden';
		t.fire('visibilitychange');
		t.fire('pagehide');
		expect(index.flush).not.toHaveBeenCalled();
	});

	it('a flush that throws is logged and does not escape', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			const t = leaveTargets();
			saveWhenLeaving(
				{
					flush: () => {
						throw new Error('boom');
					},
				},
				t.targets,
			);
			expect(() => t.fire('pagehide')).not.toThrow();
			expect(err).toHaveBeenCalledTimes(1);
		} finally {
			err.mockRestore();
		}
	});

	it('with the real index: a change that waits for the 10 s save is written at once by the flush, and not after dispose', async () => {
		vi.useFakeTimers();
		try {
			const vault = fakeFenceVault({ 'p.md': 'Plain.\n' });
			const store = fakeStore();
			const idx = createFenceIndex(vault, store);
			void idx.start();
			await until(() => idx.complete);
			const before = store.saves.length;
			vault.add('t.md', '```kin\npeople:\n```\n');
			await vi.advanceTimersByTimeAsync(500);
			expect(store.saves.length).toBe(before);
			const t = leaveTargets();
			saveWhenLeaving(idx, t.targets);
			t.doc.visibilityState = 'hidden';
			t.fire('visibilitychange');
			expect(store.saves.length).toBe(before + 1);
			expect(store.last()!.f).toEqual({ 't.md': 1 });
			// The 10 s timer of that change is gone: it does not write a second time.
			await vi.advanceTimersByTimeAsync(20_000);
			expect(store.saves.length).toBe(before + 1);
			idx.dispose();
			const after = store.saves.length;
			t.fire('pagehide');
			expect(store.saves.length).toBe(after);
		} finally {
			vi.useRealTimers();
		}
	});

	it('flush before the stamps of the saved copy are in memory writes nothing (it would erase them)', async () => {
		vi.useFakeTimers();
		try {
			const first = fakeFenceVault({ 'k.md': '```kin\npeople:\n```\n' });
			const store = fakeStore();
			const one = createFenceIndex(first, store);
			void one.start();
			await until(() => one.complete);
			one.dispose();
			const saved = store.saves.length;
			const again = first.clone({ cacheReady: false });
			const two = createFenceIndex(again, store);
			void two.start();
			await vi.advanceTimersByTimeAsync(50);
			two.flush();
			two.dispose();
			expect(store.saves.length).toBe(saved);
		} finally {
			vi.useRealTimers();
		}
	});
});
