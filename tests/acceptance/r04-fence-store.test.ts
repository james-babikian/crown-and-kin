import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePairs, encodePairs, fakeFenceVault, fakeStore, fnv1a32, pathKey, stampOf, turns, until, type FakeFenceVault, type FakeStore } from '../support/fake-fence-vault';
import { loadFenceIndex, type FenceIndex, type FenceOptions } from '../support/r04-contract';

/*
 * 0.4 WP-3a, step T0, package F: the stamp and the store of the fence index (the index contract 1.3, test list 7.2). The stored value is
 * `{ v: 1, n, f, s }`: `f` maps a path to 1 (kin), 2 (calendar) or 3 (both) for notes that hold a fence; `s` is the base64 of little-endian uint32 pairs
 * `[pathKey, stamp]` sorted by path key, 8 bytes each, for every note that was checked; `n` is the number of pairs. The expected values are worked out here from the contract
 * (`fnv1a32` is written again in tests/support/fake-fence-vault.ts), not with the code under test.
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

async function run(idx: FenceIndex): Promise<void> {
	const started = idx.start();
	started.catch(() => undefined);
	await until(() => idx.complete);
}

describe('the stamp and the saved value (the index contract 1.3)', () => {
	it('the contract values: an FNV-1a hash of 32 bits (a check of the helper the tests use)', () => {
		expect(fnv1a32('')).toBe(2166136261);
		expect(fnv1a32('a')).toBe(0xe40c292c);
		expect(fnv1a32('foobar')).toBe(0xbf9cf968);
	});

	it('after the first pass the value is { v: 1, n, f, s } with the flags and the sorted pairs', async () => {
		const vault = fakeFenceVault({ 'kin.md': KIN, 'cal.md': CAL, 'both.md': BOTH, 'plain.md': PLAIN, 'js.md': JS });
		const { idx, store } = await make(vault);
		await run(idx);
		const last = store.last();
		expect(last).toBeDefined();
		expect(last!.v).toBe(1);
		expect(last!.f).toEqual({ 'kin.md': 1, 'cal.md': 2, 'both.md': 3 });
		expect(last!.n).toBe(5);
		expect(typeof last!.s).toBe('string');
		const pairs = decodePairs(last!);
		expect(pairs.length).toBe(5);
		// Sorted by path key, ascending; every note of the vault has its pair.
		expect(pairs.map((p) => p[0])).toEqual([...pairs.map((p) => p[0])].sort((a, b) => a - b));
		const want = vault.files().map((f) => [pathKey(f.path), stampOf(f)]);
		expect(pairs).toEqual(want.sort((a, b) => a[0] - b[0]));
		expect(JSON.stringify(last).length).toBeLessThanOrEqual(500_000);
	});

	it('a note with block sections that holds no fence is stamped and has no entry in f; a note without block sections is stamped too', async () => {
		const vault = fakeFenceVault({ 'js.md': JS, 'plain.md': PLAIN, 'k.md': KIN });
		const { idx, store } = await make(vault);
		await run(idx);
		expect(Object.keys(store.last()!.f)).toEqual(['k.md']);
		expect(store.last()!.n).toBe(3);
	});

	it('the saved value is accepted by the next start: nothing is read again, the lists are the same', async () => {
		const vault = fakeFenceVault({ 'kin.md': KIN, 'cal.md': CAL, 'both.md': BOTH, 'js.md': JS, 'plain.md': PLAIN });
		const first = await make(vault);
		await run(first.idx);
		first.idx.dispose();
		const again = vault.clone();
		const next = await make(again, first.store);
		await run(next.idx);
		expect(again.reads).toEqual([]);
		expect(next.idx.notes('kin')).toEqual(['both.md', 'kin.md']);
		expect(next.idx.notes('cal')).toEqual(['both.md', 'cal.md']);
	});

	it('a store made by hand from the contract is read: the stamps are proved, so a note with those stamps is not read', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN, 'js.md': JS, 'p.md': PLAIN });
		const { n, s } = encodePairs(vault.files());
		const { idx } = await make(vault, fakeStore({ v: 1, n, f: { 'k.md': 1 }, s }));
		await run(idx);
		expect(vault.reads).toEqual([]);
		expect(idx.notes('kin')).toEqual(['k.md']);
	});
});

describe('a broken store is ignored whole; the start is a first start (the index contract 1.3)', () => {
	type Files = ReturnType<FakeFenceVault['files']>;
	const good = (files: Files) => encodePairs(files);
	const fillF = (n: number): Record<string, 1> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`zz${i}.md`, 1 as const]));

	// Each broken value claims that the plain note `claim.md` holds a kin fence. A store that is trusted shows the claim before the pass ends.
	const BROKEN: [string, (files: Files) => unknown][] = [
		['a different version', (files) => ({ v: 2, ...good(files), f: { 'claim.md': 1 } })],
		['no version', (files) => ({ ...good(files), f: { 'claim.md': 1 } })],
		['a flag of 4 in f', (files) => ({ v: 1, ...good(files), f: { 'claim.md': 4 } })],
		['a flag of 0 in f', (files) => ({ v: 1, ...good(files), f: { 'claim.md': 0 } })],
		['a text flag in f', (files) => ({ v: 1, ...good(files), f: { 'claim.md': '1' } })],
		['f is an array', (files) => ({ v: 1, ...good(files), f: [1] })],
		['f is missing', (files) => ({ v: 1, ...good(files) })],
		['f has more than 20 000 entries', (files) => ({ v: 1, ...good(files), f: { 'claim.md': 1, ...fillF(20_000) } })],
		['s is not base64', (files) => ({ v: 1, n: good(files).n, f: { 'claim.md': 1 }, s: '***not base64***' })],
		['s has the wrong length for n', (files) => ({ v: 1, n: good(files).n + 1, f: { 'claim.md': 1 }, s: good(files).s })],
		['s has a length that is not a multiple of 8', () => ({ v: 1, n: 1, f: { 'claim.md': 1 }, s: Buffer.alloc(4).toString('base64') })],
		['s is a number', (files) => ({ v: 1, n: good(files).n, f: { 'claim.md': 1 }, s: 5 })],
		['n is not a number', (files) => ({ v: 1, n: 'x', f: { 'claim.md': 1 }, s: good(files).s })],
		['a text instead of an object', () => 'junk'],
		['a number', () => 42],
		['an array', () => [1, 2, 3]],
	];

	const files = () => fakeFenceVault({ 'claim.md': PLAIN, 'k.md': KIN, 'js.md': JS });

	it.each(BROKEN)('%s: the claims of the store are not trusted before the pass ends, and the pass is a first start', async (_name, make_) => {
		const vault = files();
		const value = make_(vault.files());
		const again = vault.clone({ cacheReady: false });
		const { idx, store } = await make(again, fakeStore(value));
		void idx.start();
		await turns();
		expect(idx.notes('kin')).toEqual([]);
		again.openCache();
		await until(() => idx.complete);
		// A first start reads every note that has block sections.
		expect([...again.reads].sort()).toEqual(['js.md', 'k.md']);
		expect(idx.notes('kin')).toEqual(['k.md']);
		idx.dispose();
		// The next save overwrote the broken value with a good one.
		const last = store.last()!;
		expect(last.v).toBe(1);
		expect(last.f).toEqual({ 'k.md': 1 });
		expect(last.n).toBe(3);
	});

	it('control: the same claim in a valid store is trusted until the pass proves otherwise', async () => {
		const vault = files();
		const again = vault.clone({ cacheReady: false });
		const { idx } = await make(again, fakeStore({ v: 1, n: 0, f: { 'claim.md': 1 }, s: null }));
		void idx.start();
		await turns();
		expect(idx.notes('kin')).toEqual(['claim.md']);
		again.openCache();
		await until(() => idx.complete);
		// claim.md has no block sections and no stamp: the pass drops the claim without a read.
		expect(idx.notes('kin')).toEqual(['k.md']);
		expect(again.reads.includes('claim.md')).toBe(false);
	});

	it('a load that throws is a broken store: the start is a first start and does not throw', async () => {
		const vault = files();
		const store = fakeStore();
		store.failLoad = true;
		const { idx } = await make(vault, store);
		await expect((async () => run(idx))()).resolves.toBeUndefined();
		expect([...vault.reads].sort()).toEqual(['js.md', 'k.md']);
		expect(idx.notes('kin')).toEqual(['k.md']);
		store.failLoad = false;
		idx.dispose();
		expect(store.last()!.f).toEqual({ 'k.md': 1 });
	});

	it('no stored value at all (null) is a first start', async () => {
		const vault = files();
		const { idx } = await make(vault, fakeStore(null));
		await run(idx);
		expect([...vault.reads].sort()).toEqual(['js.md', 'k.md']);
	});
});

describe('the limits of the stored value (the index contract 1.3)', () => {
	it('a value that would pass 500 000 characters is saved with s = null; the next start is a first start', async () => {
		// 8 bytes a note give 10.7 characters of base64: 55 000 notes pass the limit.
		const files: Record<string, string> = { 'tree.md': KIN, 'code1.md': JS, 'code2.md': JS };
		for (let i = 0; i < 55_000; i++) files[`text/n${i}.md`] = PLAIN;
		const vault = fakeFenceVault(files);
		const { idx, store } = await make(vault);
		await run(idx);
		idx.dispose();
		const last = store.last()!;
		expect(last.s).toBeNull();
		expect(JSON.stringify(last).length).toBeLessThanOrEqual(500_000);
		// f is still saved: it is small.
		expect(last.f).toEqual({ 'tree.md': 1 });
		const again = vault.clone();
		const next = await make(again, store);
		await run(next.idx);
		expect([...again.reads].sort()).toEqual(['code1.md', 'code2.md', 'tree.md']);
		expect(next.idx.notes('kin')).toEqual(['tree.md']);
	});

	it('a value under the limit keeps s: 3 000 notes', async () => {
		const files: Record<string, string> = { 'tree.md': KIN };
		for (let i = 0; i < 3000; i++) files[`text/n${i}.md`] = PLAIN;
		const { idx, store } = await make(fakeFenceVault(files));
		await run(idx);
		idx.dispose();
		const last = store.last()!;
		expect(last.s).not.toBeNull();
		expect(decodePairs(last).length).toBe(last.n);
		expect(last.n).toBeGreaterThanOrEqual(2999);
	});

	it('more than 20 000 fence notes: no value with more than 20 000 entries is ever saved, and the index goes on in memory', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 20_001; i++) files[`t${i}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const { idx, store } = await make(vault);
		await run(idx);
		await vi.advanceTimersByTimeAsync(60_000);
		idx.dispose();
		for (const value of store.saves) expect(Object.keys((value as { f: object }).f).length).toBeLessThanOrEqual(20_000);
		expect(idx.notes('kin').length).toBe(20_001);
	});

	it('the 20 001st fence note makes the index stop saving f: nothing more is saved', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 20_000; i++) files[`t${i}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const { idx, store } = await make(vault);
		await run(idx);
		await vi.advanceTimersByTimeAsync(60_000);
		const saved = store.saveCalls;
		vault.add('extra.md', KIN);
		await vi.advanceTimersByTimeAsync(60_000);
		idx.dispose();
		expect(store.saveCalls).toBe(saved);
		expect(idx.has('extra.md', 'kin')).toBe(true);
	});

	it('exactly 20 000 fence notes are saved', async () => {
		const files: Record<string, string> = {};
		for (let i = 0; i < 20_000; i++) files[`t${i}.md`] = KIN;
		const { idx, store } = await make(fakeFenceVault(files));
		await run(idx);
		idx.dispose();
		expect(Object.keys(store.last()!.f).length).toBe(20_000);
	});
});

describe('a path key that collides counts as unstamped (the index contract 1.3)', () => {
	// Found by a search over random names; the first test proves it.
	const A = 'ifchgxk.md';
	const B = 'enwdcfy.md';

	it('the two names have the same FNV-1a hash (the test data is right)', () => {
		expect(pathKey(A)).toBe(pathKey(B));
		expect(A).not.toBe(B);
	});

	it('neither colliding note is saved in s; the others are', async () => {
		const vault = fakeFenceVault({ [A]: KIN, [B]: KIN, 'other.md': KIN });
		const { idx, store } = await make(vault);
		await run(idx);
		idx.dispose();
		const last = store.last()!;
		expect(last.n).toBe(1);
		expect(decodePairs(last).map((p) => p[0])).toEqual([pathKey('other.md')]);
		// The flags are still saved: the notes are known as fence notes.
		expect(last.f).toEqual({ [A]: 1, [B]: 1, 'other.md': 1 });
	});

	it('both are checked at each start (two reads at most); no other note is read', async () => {
		const first = fakeFenceVault({ [A]: KIN, [B]: KIN, 'other.md': KIN, 'p.md': PLAIN });
		const one = await make(first);
		await run(one.idx);
		one.idx.dispose();
		const again = first.clone();
		const next = await make(again, one.store);
		await run(next.idx);
		expect([...again.reads].sort()).toEqual([B, A].sort());
		expect(next.idx.notes('kin')).toEqual(['enwdcfy.md', 'ifchgxk.md', 'other.md']);
	});

	it('a change of one of the two is found at the next start', async () => {
		const first = fakeFenceVault({ [A]: KIN, [B]: KIN });
		const one = await make(first);
		await run(one.idx);
		one.idx.dispose();
		const again = first.clone();
		again.setQuietly(A, PLAIN + JS);
		const next = await make(again, one.store);
		await run(next.idx);
		expect(next.idx.notes('kin')).toEqual([B]);
	});
});

describe('when the saves happen (the index contract 1.3)', () => {
	async function calm(files: Record<string, string>, o?: FenceOptions) {
		const vault = fakeFenceVault(files);
		const made = await make(vault, fakeStore(), o);
		await run(made.idx);
		return { vault, ...made };
	}

	it('the pass saves when it ends', async () => {
		const { store } = await calm({ 'k.md': KIN });
		expect(store.saves.length).toBeGreaterThanOrEqual(1);
		expect(store.last()!.f).toEqual({ 'k.md': 1 });
	});

	it('a change is saved at most once in saveWaitMs (10 000 by default), and is saved by then', async () => {
		const { vault, idx, store } = await calm({ 'k.md': KIN, 'p.md': PLAIN });
		const base = store.saves.length;
		vault.edit('p.md', KIN);
		await vi.advanceTimersByTimeAsync(5000);
		expect(store.saves.length).toBeLessThanOrEqual(base + 1);
		for (let i = 0; i < 5; i++) {
			vault.add(`n${i}.md`, CAL);
			await vi.advanceTimersByTimeAsync(100);
		}
		await vi.advanceTimersByTimeAsync(30_000);
		expect(store.saves.length).toBeLessThanOrEqual(base + 2);
		expect(store.saves.length).toBeGreaterThan(base);
		const last = store.last()!;
		expect(Object.keys(last.f).sort()).toEqual(['k.md', 'n0.md', 'n1.md', 'n2.md', 'n3.md', 'n4.md', 'p.md']);
		expect(idx.notes('cal').length).toBe(5);
	});

	it('saveWaitMs can be changed by the option', async () => {
		const { vault, store } = await calm({ 'p.md': PLAIN }, { saveWaitMs: 1000 });
		const base = store.saves.length;
		vault.edit('p.md', KIN);
		await vi.advanceTimersByTimeAsync(2500);
		expect(store.saves.length).toBeGreaterThan(base);
		expect(store.last()!.f).toEqual({ 'p.md': 1 });
	});

	it('an interrupted build is saved after every 300 reads and on dispose; the next start goes on from there', async () => {
		const files: Record<string, string> = {};
		for (let i = 1; i <= 650; i++) files[`k${String(i).padStart(4, '0')}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const hold = vault.hold('k0631.md');
		const { idx, store } = await make(vault);
		void idx.start();
		await until(() => hold.started);
		// 630 reads ended: the saves after 300 and after 600 reads are in the store.
		expect(store.saves.length).toBeGreaterThanOrEqual(2);
		expect(idx.complete).toBe(false);
		const before = store.saves.length;
		idx.dispose();
		expect(store.saves.length).toBe(before + 1);
		const last = store.last()!;
		expect(last.n).toBeGreaterThanOrEqual(600);
		expect(last.n).toBeLessThanOrEqual(631);
		const again = vault.clone();
		const next = await make(again, store);
		await run(next.idx);
		// It goes on from the notes that are stamped; it does not read all 650 again.
		expect(again.reads.length).toBeLessThanOrEqual(650 - 600 + 1);
		expect(next.idx.notes('kin').length).toBe(650);
	});

	it('a save that throws is logged once and stops all saving for the session; the index goes on in memory', async () => {
		const vault = fakeFenceVault({ 'k.md': KIN, 'p.md': PLAIN });
		const store = fakeStore();
		store.failSave = true;
		const { idx } = await make(vault, store);
		await run(idx);
		expect(store.saveCalls).toBe(1);
		const logged = (console.error as unknown as { mock: { calls: unknown[] } }).mock.calls.length + (console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
		expect(logged).toBe(1);
		vault.edit('p.md', CAL);
		vault.add('new.md', KIN);
		await vi.advanceTimersByTimeAsync(60_000);
		idx.dispose();
		// No later attempt: the failed save ended all saving.
		expect(store.saveCalls).toBe(1);
		expect((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls.length + (console.warn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
		expect(idx.notes('kin')).toEqual(['k.md', 'new.md']);
		expect(idx.notes('cal')).toEqual(['p.md']);
	});

	it('a save that fails during a long build stops the saves of the build', async () => {
		const files: Record<string, string> = {};
		for (let i = 1; i <= 700; i++) files[`k${i}.md`] = KIN;
		const vault = fakeFenceVault(files);
		const store = fakeStore();
		store.failSave = true;
		const { idx } = await make(vault, store);
		await run(idx);
		expect(store.saveCalls).toBe(1);
		expect(idx.notes('kin').length).toBe(700);
	});
});
