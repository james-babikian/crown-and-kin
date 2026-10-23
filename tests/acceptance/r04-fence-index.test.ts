import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFenceVault, fakeStore, turns, until, type FakeFenceVault, type FakeStore } from '../support/fake-fence-vault';
import { loadFenceIndex, type FenceIndex, type FenceOptions } from '../support/r04-contract';

/*
 * 0.4 WP-3a, step T0, package F: the fence index and its events (the index contract 1.2, 1.4, 1.5; test list 7.3 and 7.4; gate findings M1 and M2).
 * The vault is a fake with events that the test fires, reads that the test holds back, and a cache that opens when the test says so (tests/support/fake-fence-vault.ts).
 * The store tests (the saved value, broken values, the limits, the saves) are in r04-fence-store.test.ts.
 * Written from the contract, before the code existed; package F is built and the tests run.
 */

const KIN = '```kin\npeople:\n  - id: a\n    name: A\n```\n';
const CAL = '```kin-calendar\ncalendars: []\n```\n';
const BOTH = `${KIN}\n${CAL}`;
const JS = '```js\nlet x = 1;\n```\n';
const PLAIN = 'Just some text.\n';

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function make(vault: FakeFenceVault, store: FakeStore = fakeStore(), o?: FenceOptions): Promise<{ idx: FenceIndex; store: FakeStore }> {
	const { createFenceIndex } = await loadFenceIndex();
	return { idx: createFenceIndex(vault, store, o), store };
}

/** Starts the index and waits until the verify pass has ended. */
async function run(idx: FenceIndex): Promise<void> {
	const started = idx.start();
	started.catch(() => undefined);
	await until(() => idx.complete);
}

/** A first run on `vault`, ended with `dispose`: what a later start finds in the store. */
async function firstRun(vault: FakeFenceVault, o?: FenceOptions): Promise<FakeStore> {
	const { idx, store } = await make(vault, fakeStore(), o);
	await run(idx);
	idx.dispose();
	return store;
}

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** n notes `f01.md` ... with JS fences: each one is read by a first start, so a test can hold one back. */
const filler = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${String(i + 1).padStart(2, '0')}.md`, JS]));

describe('verify pass: first start (the index contract 1.5, test 7.3)', () => {
	it('reads only the notes that have block sections, once each; 10 000 notes, 5 trees', async () => {
		const files: Record<string, string> = {};
		const trees = ['Trees/t1.md', 'Trees/t2.md', 'Trees/t3.md', 'Trees/t4.md', 'Trees/t5.md'];
		for (const t of trees) files[t] = KIN;
		const withCode: string[] = [];
		for (let i = 0; i < 2000; i++) {
			files[`code/c${i}.md`] = JS;
			withCode.push(`code/c${i}.md`);
		}
		for (let i = 0; i < 7995; i++) files[`text/n${i}.md`] = PLAIN;
		const vault = fakeFenceVault(files);
		const { idx } = await make(vault);
		await run(idx);
		expect(idx.complete).toBe(true);
		expect(vault.reads.length).toBe(2005);
		expect(new Set(vault.reads)).toEqual(new Set([...trees, ...withCode]));
		expect(vault.reads.some((p) => p.startsWith('text/'))).toBe(false);
		expect(idx.notes('kin')).toEqual(sorted(trees));
		expect(idx.notes('cal')).toEqual([]);
		for (const t of trees) expect(idx.has(t, 'kin')).toBe(true);
		expect(idx.has('code/c0.md', 'kin')).toBe(false);
		expect(idx.has('text/n0.md', 'kin')).toBe(false);
	});

	it('gives the interface a turn in idle time between slices of reads', async () => {
		const vault = fakeFenceVault(filler(300));
		const { idx } = await make(vault, fakeStore(), { readsPerSlice: 10 });
		await run(idx);
		expect(vault.reads.length).toBe(300);
		// One wait for the cache and one for the pass itself come first; then one at least in each slice.
		expect(vault.idleCalls).toBeGreaterThanOrEqual(28);
	});

	it('a cold cache (the start limit passed, the cache not done) reads every note once, also the ones the cache calls "no"', async () => {
		const files: Record<string, string> = { 'Trees/a.md': KIN, 'Trees/b.md': KIN, 'Trees/c.md': KIN };
		for (let i = 0; i < 2000; i++) files[`text/n${i}.md`] = PLAIN;
		const vault = fakeFenceVault(files, { cacheReady: false, cacheDone: false });
		// The half-built cache says "no" for these notes (the fake works the answer out from the text).
		expect(vault.sectionState('text/n0.md')).toBe('no');
		vault.openCache(false);
		const { idx } = await make(vault);
		await run(idx);
		expect(vault.reads.length).toBe(2003);
		expect(new Set(vault.reads).size).toBe(2003);
		expect(idx.notes('kin')).toEqual(['Trees/a.md', 'Trees/b.md', 'Trees/c.md']);
	});

	it('a note that the cache has no entry for yet ("unknown") is read, with or without a fence', async () => {
		const vault = fakeFenceVault({ 'a.md': PLAIN, 'b.md': KIN });
		vault.sections.set('a.md', 'unknown');
		vault.sections.set('b.md', 'unknown');
		const { idx } = await make(vault);
		await run(idx);
		expect([...vault.reads].sort()).toEqual(['a.md', 'b.md']);
		expect(idx.has('b.md', 'kin')).toBe(true);
	});

	it('keeps the two kinds apart, and a note with both is in both lists', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN, 'c.md': CAL, 'b.md': BOTH, 'p.md': PLAIN });
		const { idx } = await make(vault);
		await run(idx);
		expect(idx.notes('kin')).toEqual(['b.md', 'k.md']);
		expect(idx.notes('cal')).toEqual(['b.md', 'c.md']);
		expect([idx.has('k.md', 'cal'), idx.has('c.md', 'kin'), idx.has('b.md', 'kin'), idx.has('b.md', 'cal')]).toEqual([false, false, true, true]);
	});

	it('start() runs once: a second call returns the same promise', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN });
		const { idx } = await make(vault);
		const a = idx.start();
		const b = idx.start();
		expect(b).toBe(a);
		await until(() => idx.complete);
		expect(vault.reads).toEqual(['k.md']);
	});

	it('registers the events before it reads the store', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN });
		const seen: Record<string, number> = {};
		const store = fakeStore();
		const load = store.load.bind(store);
		store.load = () => {
			for (const ev of ['cache', 'create', 'modify', 'rename', 'delete'] as const) seen[ev] = vault.listenerCount(ev);
			return load();
		};
		const { idx } = await make(vault, store);
		await run(idx);
		expect(seen).toEqual({ cache: 1, create: 1, modify: 1, rename: 1, delete: 1 });
	});

	it('is not complete before the pass has ended, and the notes it knows so far are not lost', async () => {
		const vault = fakeFenceVault({ ...filler(3), 'k.md': KIN });
		const hold = vault.hold('f02.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		await turns();
		expect(idx.complete).toBe(false);
		hold.release();
		await until(() => idx.complete);
		expect(idx.notes('kin')).toEqual(['k.md']);
	});

	it('an empty vault is complete, with nothing in the lists', async () => {
		const { idx } = await make(fakeFenceVault({}));
		await run(idx);
		expect(idx.notes('kin')).toEqual([]);
		expect(idx.notes('cal')).toEqual([]);
		expect(idx.unsure().size).toBe(0);
	});
});

describe('verify pass: a valid store (the index contract 1.3 and 1.5, test 7.3)', () => {
	const trees = ['t1.md', 't2.md', 't3.md', 't4.md', 't5.md'];
	const bigVault = (): FakeFenceVault => {
		const files: Record<string, string> = Object.fromEntries(trees.map((t) => [t, KIN]));
		for (let i = 0; i < 1500; i++) files[`code/c${i}.md`] = JS;
		for (let i = 0; i < 3500; i++) files[`text/n${i}.md`] = PLAIN;
		return fakeFenceVault(files);
	};

	it('a restart with nothing changed reads at most 5 notes (here none), and never a note without block sections', async () => {
		const first = bigVault();
		const store = await firstRun(first);
		const again = first.clone();
		const { idx } = await make(again, store);
		await run(idx);
		expect(again.reads.length).toBeLessThanOrEqual(5);
		expect(again.reads.some((p) => p.startsWith('text/'))).toBe(false);
		expect(idx.notes('kin')).toEqual(sorted(trees));
	});

	it('knows the fence notes of the store before the pass ends (provisional lists), and fires no change when the pass confirms them', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'c.md': CAL, 'p.md': PLAIN });
		const store = await firstRun(first);
		const again = first.clone({ cacheReady: false });
		const { idx } = await make(again, store);
		const changed = vi.fn();
		idx.onChange(changed);
		void idx.start();
		await turns();
		expect(idx.complete).toBe(false);
		expect(idx.notes('kin')).toEqual(['k.md']);
		expect(idx.notes('cal')).toEqual(['c.md']);
		expect(idx.has('k.md', 'kin')).toBe(true);
		again.openCache();
		await until(() => idx.complete);
		await vi.advanceTimersByTimeAsync(2000);
		expect(changed).not.toHaveBeenCalled();
	});

	it('the provisional lists drop a path that is not in files() any more', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'gone.md': KIN });
		const store = await firstRun(first);
		const again = first.clone({ cacheReady: false });
		again.texts.delete('gone.md');
		again.stats.delete('gone.md');
		const { idx } = await make(again, store);
		void idx.start();
		await turns();
		expect(idx.notes('kin')).toEqual(['k.md']);
	});

	it('one note edited while the plugin did not run is read once, and nothing else', async () => {
		const first = fakeFenceVault({ ...filler(5), 'k.md': KIN, 'k2.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		again.setQuietly('k.md', PLAIN.repeat(1) + JS);
		const { idx } = await make(again, store);
		await run(idx);
		expect(again.reads).toEqual(['k.md']);
		expect(idx.notes('kin')).toEqual(['k2.md']);
	});

	it('a note edited while the plugin did not run, whose "changed" event came first, is not read', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'k2.md': KIN });
		const store = await firstRun(first);
		const again = first.clone({ cacheReady: false });
		again.setQuietly('k.md', CAL);
		const { idx } = await make(again, store);
		void idx.start();
		await turns();
		again.emit('cache', again.file('k.md'), CAL);
		again.openCache();
		await until(() => idx.complete);
		expect(again.reads).toEqual([]);
		expect(idx.notes('kin')).toEqual(['k2.md']);
		expect(idx.notes('cal')).toEqual(['k.md']);
	});

	// G2 part 3, item 7 and question A: after a start the cache can still give the old entry of a note that changed while Obsidian was closed, so a changed stamp is always read.
	it('a note edited while the plugin did not run is read even if the cache calls it "no"; its entry goes', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'k2.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		again.setQuietly('k.md', PLAIN);
		const { idx } = await make(again, store);
		await run(idx);
		expect(again.reads).toEqual(['k.md']);
		expect(idx.notes('kin')).toEqual(['k2.md']);
	});

	it('a note whose mtime changed but whose size did not counts as changed (the stamp is both)', async () => {
		const first = fakeFenceVault({ 'k.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		const same = KIN.replace('name: A', 'name: B');
		expect(same.length).toBe(KIN.length);
		again.setQuietly('k.md', same);
		const { idx } = await make(again, store);
		await run(idx);
		expect(again.reads).toEqual(['k.md']);
	});

	it('a note added while the plugin did not run is read when it has block sections, and not when it has none', async () => {
		const first = fakeFenceVault({ 'k.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		again.setQuietly('new-tree.md', KIN);
		again.setQuietly('new-text.md', PLAIN);
		const { idx } = await make(again, store);
		await run(idx);
		expect(again.reads).toEqual(['new-tree.md']);
		expect(idx.notes('kin')).toEqual(['k.md', 'new-tree.md']);
	});

	it('a note deleted while the plugin did not run is dropped, and the next store does not keep it', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'gone.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		again.texts.delete('gone.md');
		again.stats.delete('gone.md');
		const { idx } = await make(again, store);
		await run(idx);
		expect(idx.notes('kin')).toEqual(['k.md']);
		idx.dispose();
		const last = store.last()!;
		expect(Object.keys(last.f)).toEqual(['k.md']);
		expect(last.n).toBe(1);
	});

	it('a store that has stamps and entries of paths that are gone loses them at the end of the pass', async () => {
		const first = fakeFenceVault({ 'k.md': KIN, 'x.md': KIN, 'y.md': PLAIN });
		const store = await firstRun(first);
		const again = first.clone();
		for (const p of ['x.md', 'y.md']) {
			again.texts.delete(p);
			again.stats.delete(p);
		}
		const { idx } = await make(again, store);
		await run(idx);
		expect(store.last()!.n).toBe(1);
		expect(Object.keys(store.last()!.f)).toEqual(['k.md']);
	});
});

describe('verify pass: renames and the fixed point (the index contract 1.4 and 1.5, gate finding M1)', () => {
	it('M1: a note renamed during the pass, before the pass reached it, ends in the index under its new name', async () => {
		const vault = fakeFenceVault({ ...filler(10), 'target.md': KIN });
		const hold = vault.hold('f01.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.rename('target.md', 'moved.md');
		await turns();
		// The new path is not proved yet: it is unsure, and the pass is not complete.
		expect(idx.complete).toBe(false);
		expect(idx.unsure().has('moved.md')).toBe(true);
		expect(idx.unsure().has('target.md')).toBe(false);
		hold.release();
		await until(() => idx.complete);
		expect(idx.has('moved.md', 'kin')).toBe(true);
		expect(idx.has('target.md', 'kin')).toBe(false);
		expect(idx.notes('kin')).toEqual(['moved.md']);
		// The safety timer of the new path may still run; when it has ended, a calm vault has nothing unsure.
		await vi.advanceTimersByTimeAsync(5000);
		expect(idx.unsure().size).toBe(0);
		expect(idx.notes('kin')).toEqual(['moved.md']);
	});

	it('M1: a note renamed while the pass reads that very note ends in the index under its new name', async () => {
		const vault = fakeFenceVault({ 'target.md': KIN, ...filler(3) });
		const hold = vault.hold('target.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.rename('target.md', 'moved.md');
		hold.release();
		await until(() => idx.complete);
		expect(idx.notes('kin')).toEqual(['moved.md']);
		expect(idx.has('target.md', 'kin')).toBe(false);
	});

	it('M1: a folder renamed during the pass (one call for each note) loses no note', async () => {
		const files: Record<string, string> = filler(5);
		for (let i = 0; i < 40; i++) files[`old/t${i}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const hold = vault.hold('f01.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		for (let i = 0; i < 40; i++) vault.rename(`old/t${i}.md`, `new/t${i}.md`);
		hold.release();
		await until(() => idx.complete);
		expect(idx.notes('kin')).toEqual(sorted(Array.from({ length: 40 }, (_, i) => `new/t${i}.md`)));
	});

	it('a note that keeps being renamed cannot keep the pass for ever: after the last round the leftover paths are unsure and the pass is complete', async () => {
		const vault = fakeFenceVault({ 'r0.md': KIN, ...filler(2) });
		vault.onRead = (path) => {
			const m = /^r(\d+)\.md$/.exec(path);
			if (m) queueMicrotask(() => vault.rename(path, `r${Number(m[1]) + 1}.md`));
		};
		const { idx } = await make(vault);
		await run(idx);
		expect(idx.complete).toBe(true);
		expect(vault.reads.length).toBeLessThanOrEqual(12);
		expect(idx.unsure().size).toBeGreaterThanOrEqual(1);
		for (const p of idx.unsure()) expect(vault.texts.has(p)).toBe(true);
	});

	it('a stamped note renamed after the pass moves its entry and its stamp, with no read; a restart finds it with no read', async () => {
		const vault = fakeFenceVault({ 'a.md': KIN, 'p.md': PLAIN });
		const { idx, store } = await make(vault);
		await run(idx);
		const before = vault.reads.length;
		vault.rename('a.md', 'b.md');
		await turns();
		expect(vault.reads.length).toBe(before);
		expect(idx.has('b.md', 'kin')).toBe(true);
		expect(idx.has('a.md', 'kin')).toBe(false);
		expect(idx.notes('kin')).toEqual(['b.md']);
		expect(idx.unsure().size).toBe(0);
		idx.dispose();
		const again = vault.clone();
		const next = await make(again, store);
		await run(next.idx);
		expect(again.reads).toEqual([]);
		expect(next.idx.notes('kin')).toEqual(['b.md']);
	});

	it('a folder of 200 stamped notes renamed after the pass: no read, the lists follow, one change is told', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 200; i++) files[`old/t${i}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const { idx } = await make(vault);
		await run(idx);
		const reads = vault.reads.length;
		const changed = vi.fn();
		idx.onChange(changed);
		for (let i = 0; i < 200; i++) vault.rename(`old/t${i}.md`, `new/t${i}.md`);
		await vi.advanceTimersByTimeAsync(1000);
		expect(vault.reads.length).toBe(reads);
		expect(idx.notes('kin')).toEqual(sorted(Array.from({ length: 200 }, (_, i) => `new/t${i}.md`)));
		expect(changed).toHaveBeenCalledTimes(1);
	});

	it('lifecycle (a): a rename takes the old path out of unsure and cancels its safety timer', async () => {
		const vault = fakeFenceVault({ 'a.md': PLAIN, 'k.md': KIN });
		const { idx } = await make(vault, fakeStore(), { safetyMs: 1000 });
		await run(idx);
		vault.edit('a.md', JS, { cache: false });
		expect(idx.unsure().has('a.md')).toBe(true);
		const reads = vault.reads.length;
		vault.rename('a.md', 'b.md');
		expect(idx.unsure().has('a.md')).toBe(false);
		await vi.advanceTimersByTimeAsync(5000);
		expect(vault.reads.filter((p) => p === 'a.md').length).toBe(0);
		expect(vault.reads.length).toBeGreaterThanOrEqual(reads);
	});

	it('lifecycle (b) and (c): a deleted note leaves unsure and toCheck; a read of it that ends later puts nothing back', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN, ...filler(2) });
		const hold = vault.hold('k.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.remove('k.md');
		hold.release();
		await until(() => idx.complete);
		expect(idx.has('k.md', 'kin')).toBe(false);
		expect(idx.notes('kin')).toEqual([]);
		expect(idx.unsure().size).toBe(0);
	});
});

describe('late reads and failed reads (the index contract 1.4, gate finding M2, test 7.3)', () => {
	it('M2: a read of the pass that ends after a newer "changed" event does not overwrite it, and the note is not read again', async () => {
		const vault = fakeFenceVault({ 'late.md': KIN, ...filler(2) });
		const hold = vault.hold('late.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.edit('late.md', PLAIN);
		// The late read still brings the old text, with a fence.
		hold.release(KIN);
		await until(() => idx.complete);
		expect(idx.has('late.md', 'kin')).toBe(false);
		expect(vault.reads.filter((p) => p === 'late.md').length).toBe(1);
		expect(idx.unsure().size).toBe(0);
	});

	it('M2: a read of the pass that ends after a "modify" with no "changed" is discarded, and the note is checked again', async () => {
		const vault = fakeFenceVault({ 'late.md': KIN, ...filler(2) });
		const hold = vault.hold('late.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.edit('late.md', PLAIN, { cache: false });
		hold.release(KIN);
		await until(() => idx.complete);
		expect(idx.has('late.md', 'kin')).toBe(false);
		expect(idx.notes('kin')).toEqual([]);
	});

	it('M2: a read of the safety timer that ends after a newer "changed" event is discarded', async () => {
		const vault = fakeFenceVault({ 'p.md': PLAIN });
		const { idx } = await make(vault, fakeStore(), { safetyMs: 1000 });
		await run(idx);
		vault.edit('p.md', KIN, { cache: false });
		const hold = vault.hold('p.md');
		await vi.advanceTimersByTimeAsync(1100);
		expect(hold.started).toBe(true);
		vault.edit('p.md', PLAIN);
		hold.release(KIN);
		await turns();
		expect(idx.has('p.md', 'kin')).toBe(false);
		expect(idx.unsure().has('p.md')).toBe(false);
	});

	it('a read that fails: the path is unsure, gets no stamp and no entry change, and the pass is still complete', async () => {
		const vault = fakeFenceVault({ 'ok.md': KIN, 'bad.md': JS });
		vault.failing.add('bad.md');
		const { idx, store } = await make(vault);
		await run(idx);
		expect(idx.complete).toBe(true);
		expect(idx.unsure().has('bad.md')).toBe(true);
		expect(idx.unsure().has('ok.md')).toBe(false);
		idx.dispose();
		const keys = (store.last()!.s ? Buffer.from(store.last()!.s!, 'base64') : Buffer.alloc(0)).length / 8;
		expect(keys).toBe(1);
	});

	it('a read that failed is tried again at the next start', async () => {
		const first = fakeFenceVault({ 'ok.md': KIN, 'bad.md': KIN });
		first.failing.add('bad.md');
		const { idx, store } = await make(first);
		await run(idx);
		idx.dispose();
		const again = first.clone();
		const next = await make(again, store);
		await run(next.idx);
		expect(again.reads).toEqual(['bad.md']);
		expect(next.idx.notes('kin')).toEqual(['bad.md', 'ok.md']);
		expect(next.idx.unsure().size).toBe(0);
	});

	it('a failed read leaves the entry the store had: the note stays in the list until a read proves otherwise', async () => {
		const first = fakeFenceVault({ 'k.md': KIN });
		const store = await firstRun(first);
		const again = first.clone();
		again.setQuietly('k.md', KIN.replace('name: A', 'name: B'));
		again.failing.add('k.md');
		const { idx } = await make(again, store);
		await run(idx);
		expect(idx.has('k.md', 'kin')).toBe(true);
		expect(idx.unsure().has('k.md')).toBe(true);
	});

	it('a read that fails for a path that was renamed away meanwhile is ignored', async () => {
		const vault = fakeFenceVault({ 'x.md': KIN, ...filler(2) });
		const hold = vault.hold('x.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.rename('x.md', 'y.md');
		hold.fail();
		await until(() => idx.complete);
		expect(idx.unsure().has('x.md')).toBe(false);
		expect(idx.notes('kin')).toEqual(['y.md']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(idx.unsure().size).toBe(0);
	});

	it('a read that fails for a path that was deleted meanwhile is ignored', async () => {
		const vault = fakeFenceVault({ 'x.md': KIN, ...filler(2) });
		const hold = vault.hold('x.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		vault.remove('x.md');
		hold.fail();
		await until(() => idx.complete);
		expect(idx.unsure().size).toBe(0);
		expect(idx.notes('kin')).toEqual([]);
	});
});

describe('events after the pass (the index contract 1.4, test 7.4)', () => {
	async function calm(files: Record<string, string>, o?: FenceOptions) {
		const vault = fakeFenceVault(files);
		const made = await make(vault, fakeStore(), o);
		await run(made.idx);
		return { vault, ...made };
	}

	it('"changed" with a text sets the flags, without a read: a fence added, a fence taken out, a kind changed', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN, 'b.md': KIN, 'c.md': CAL });
		const reads = vault.reads.length;
		vault.edit('a.md', KIN);
		vault.edit('b.md', PLAIN);
		vault.edit('c.md', BOTH);
		expect(idx.has('a.md', 'kin')).toBe(true);
		expect(idx.has('b.md', 'kin')).toBe(false);
		expect([idx.has('c.md', 'kin'), idx.has('c.md', 'cal')]).toEqual([true, true]);
		expect(idx.notes('kin')).toEqual(['a.md', 'c.md']);
		expect(vault.reads.length).toBe(reads);
	});

	it('"changed" clears the note from unsure, and its safety timer', async () => {
		const { vault, idx } = await calm({ 'p.md': PLAIN }, { safetyMs: 1000 });
		vault.edit('p.md', KIN, { cache: false });
		expect(idx.unsure().has('p.md')).toBe(true);
		vault.emit('cache', vault.file('p.md'), KIN);
		expect(idx.unsure().has('p.md')).toBe(false);
		const reads = vault.reads.length;
		await vi.advanceTimersByTimeAsync(10_000);
		expect(vault.reads.length).toBe(reads);
		expect(idx.has('p.md', 'kin')).toBe(true);
	});

	it('"modify" with no "changed" reads the note once after safetyMs (4000 by default), not before', async () => {
		const { vault, idx } = await calm({ 'p.md': PLAIN });
		vault.edit('p.md', KIN, { cache: false });
		expect(idx.unsure().has('p.md')).toBe(true);
		await vi.advanceTimersByTimeAsync(3900);
		expect(vault.reads.filter((p) => p === 'p.md').length).toBe(0);
		await vi.advanceTimersByTimeAsync(200);
		expect(vault.reads.filter((p) => p === 'p.md').length).toBe(1);
		expect(idx.has('p.md', 'kin')).toBe(true);
		expect(idx.unsure().has('p.md')).toBe(false);
	});

	it('"modify" with a "changed" event does not read', async () => {
		const { vault } = await calm({ 'p.md': PLAIN });
		const reads = vault.reads.length;
		vault.edit('p.md', KIN);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(vault.reads.length).toBe(reads);
	});

	it('"create" with no "changed" is read after safetyMs when the cache says the note can hold a fence', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN }, { safetyMs: 500 });
		vault.add('new.md', KIN, { cache: false });
		expect(idx.unsure().has('new.md')).toBe(true);
		await vi.advanceTimersByTimeAsync(600);
		expect(vault.reads).toContain('new.md');
		expect(idx.has('new.md', 'kin')).toBe(true);
		expect(idx.unsure().size).toBe(0);
	});

	// G2 part 3, item 7: a `create` event with no `changed` event may come before the cache has the new text, so the safety timer reads the note whatever the cache says.
	it('the safety timer reads a new note even if the cache calls it "no"', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN }, { safetyMs: 500 });
		vault.add('new.md', PLAIN, { cache: false });
		await vi.advanceTimersByTimeAsync(600);
		expect(vault.reads).toContain('new.md');
		expect(idx.has('new.md', 'kin')).toBe(false);
		expect(idx.unsure().has('new.md')).toBe(false);
	});

	it('a new note from outside (create, then "changed" with the text) is in the index at once, with no read', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN });
		const reads = vault.reads.length;
		vault.add('synced.md', KIN);
		expect(idx.notes('kin')).toEqual(['synced.md']);
		expect(vault.reads.length).toBe(reads);
	});

	it('a deleted note leaves the lists and unsure, and its safety timer does not read it', async () => {
		const { vault, idx } = await calm({ 'a.md': KIN }, { safetyMs: 500 });
		vault.edit('a.md', KIN, { cache: false });
		const reads = vault.reads.length;
		vault.remove('a.md');
		expect(idx.has('a.md', 'kin')).toBe(false);
		expect(idx.notes('kin')).toEqual([]);
		expect(idx.unsure().size).toBe(0);
		await vi.advanceTimersByTimeAsync(5000);
		expect(vault.reads.length).toBe(reads);
	});

	it('dispose stops the events and the timers, and tells nobody afterwards', async () => {
		const { vault, idx, store } = await calm({ 'p.md': PLAIN }, { safetyMs: 500 });
		const changed = vi.fn();
		idx.onChange(changed);
		vault.edit('p.md', KIN, { cache: false });
		const reads = vault.reads.length;
		const saves = store.saves.length;
		idx.dispose();
		// It saves once, on dispose.
		expect(store.saves.length).toBe(saves + 1);
		for (const ev of ['cache', 'create', 'modify', 'rename', 'delete'] as const) expect(vault.listenerCount(ev)).toBe(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(vault.reads.length).toBe(reads);
		expect(changed).not.toHaveBeenCalled();
		expect(store.saves.length).toBe(saves + 1);
	});

	it('dispose in the middle of the pass stops the pass: no read after it', async () => {
		const vault = fakeFenceVault(filler(10));
		const hold = vault.hold('f03.md');
		const { idx } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		idx.dispose();
		const reads = vault.reads.length;
		hold.release();
		await turns();
		await vi.advanceTimersByTimeAsync(5000);
		expect(vault.reads.length).toBe(reads);
	});
});

describe('onChange (the index contract 1.2 and 1.4)', () => {
	async function calm(files: Record<string, string>) {
		const vault = fakeFenceVault(files);
		const made = await make(vault);
		await run(made.idx);
		await vi.advanceTimersByTimeAsync(1000);
		return { vault, ...made };
	}

	it('tells once when the first pass finds fence notes that the store did not know', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN });
		const { idx } = await make(vault);
		const changed = vi.fn();
		idx.onChange(changed);
		await run(idx);
		await vi.advanceTimersByTimeAsync(1000);
		expect(changed).toHaveBeenCalledTimes(1);
	});

	it('does not tell when the pass finds no fence note', async () => {
		const vault = fakeFenceVault({ 'p.md': PLAIN, 'j.md': JS });
		const { idx } = await make(vault);
		const changed = vi.fn();
		idx.onChange(changed);
		await run(idx);
		await vi.advanceTimersByTimeAsync(1000);
		expect(changed).not.toHaveBeenCalled();
	});

	it('a burst of changes is one call, after the 300 ms wait', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN });
		const changed = vi.fn();
		idx.onChange(changed);
		for (let i = 0; i < 10; i++) {
			vault.add(`n${i}.md`, KIN);
			await vi.advanceTimersByTimeAsync(20);
		}
		expect(changed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(400);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(idx.notes('kin').length).toBe(10);
	});

	it('does not tell for an edit that keeps the set of notes', async () => {
		const { vault, idx } = await calm({ 'a.md': KIN, 'b.md': PLAIN });
		const changed = vi.fn();
		idx.onChange(changed);
		vault.edit('a.md', KIN.replace('name: A', 'name: Z'));
		vault.edit('b.md', 'other plain text\n');
		await vi.advanceTimersByTimeAsync(2000);
		expect(changed).not.toHaveBeenCalled();
	});

	it('tells when a note gains a fence, loses one, is deleted or is renamed', async () => {
		const { vault, idx } = await calm({ 'a.md': KIN, 'b.md': PLAIN, 'c.md': CAL });
		const changed = vi.fn();
		idx.onChange(changed);
		vault.edit('b.md', KIN);
		await vi.advanceTimersByTimeAsync(400);
		expect(changed).toHaveBeenCalledTimes(1);
		vault.edit('a.md', PLAIN);
		await vi.advanceTimersByTimeAsync(400);
		expect(changed).toHaveBeenCalledTimes(2);
		vault.remove('c.md');
		await vi.advanceTimersByTimeAsync(400);
		expect(changed).toHaveBeenCalledTimes(3);
		vault.rename('b.md', 'bb.md');
		await vi.advanceTimersByTimeAsync(400);
		expect(changed).toHaveBeenCalledTimes(4);
	});

	it('the function that onChange returns takes the listener away', async () => {
		const { vault, idx } = await calm({ 'a.md': PLAIN });
		const changed = vi.fn();
		const off = idx.onChange(changed);
		off();
		vault.add('n.md', KIN);
		await vi.advanceTimersByTimeAsync(1000);
		expect(changed).not.toHaveBeenCalled();
	});
});
