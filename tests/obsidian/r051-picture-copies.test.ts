import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TFile as VaultFile } from 'obsidian';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { COPIES_BUDGET, OPEN_LIMIT_MS, STALE_DAYS, createPictureCopies, type CopyBackend, type CopyId, type PictureCopies } from '../../src/obsidian/picture-copies';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO } from '../../src/obsidian/picture-store';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { clock, resetDom, settle, untilDone } from '../acceptance/fake-dom';
import { TFile, resetObsidian } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { embed, fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D318: the small drawn copies of the portraits and the arms are kept on the device between starts. The storage is an in-memory fake
 * (`CopyBackend`), so the checks cover the keys, the limits and the failures without IndexedDB. The cold-start check uses the seam of the speed study:
 * every job costs JOB_MS, and a touch device runs one job at a time.
 */
useFakeDom({ window: true });
afterEach(() => vi.restoreAllMocks());

const JOB_MS = 80;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const now = () => performance.now();

function file(path: string, size = 1000, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new TFile(path, name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: name.slice(0, dot), stat: { mtime, ctime: 1, size } }) as unknown as VaultFile;
}

/** A key-value store in memory, with switches for the faults a device can show. */
function fakeBackend() {
	const data = new Map<string, unknown>();
	const b = {
		data,
		writes: 0,
		gets: 0,
		failWrite: false,
		hang: false,
		async keys() {
			return [...data.keys()];
		},
		async get(k: string) {
			b.gets++;
			if (b.hang) return new Promise<unknown>(() => undefined);
			return data.get(k);
		},
		async write(puts: { key: string; value: unknown }[], dels: string[]) {
			if (b.failWrite) throw new Error('QuotaExceededError');
			b.writes++;
			for (const p of puts) data.set(p.key, p.value);
			for (const k of dels) data.delete(k);
		},
	};
	return b satisfies CopyBackend & Record<string, unknown>;
}

/** One session of the copies over a backend; the writes run at once instead of in idle time. */
function session(b: CopyBackend | null, over: { vault?: string; exists?: (p: string) => boolean; budget?: number; open?: () => Promise<CopyBackend | null>; limit?: number; openLimit?: number; now?: () => number } = {}) {
	const warns: unknown[] = [];
	const copies = createPictureCopies({
		vault: over.vault ?? 'vault-a',
		open: over.open ?? (async () => b),
		exists: over.exists ?? (() => true),
		budget: over.budget,
		later: (fn) => void queueMicrotask(fn),
		warn: (e) => warns.push(e),
		findLimitMs: over.limit ?? 1000,
		openLimitMs: over.openLimit,
		now: over.now,
	});
	return { copies, warns };
}

const bytes = pngHead(400, 600);
function fakeIO(coarse: boolean, jobMs = JOB_MS) {
	const reads = new Map<string, number>();
	const io: PictureIO = {
		async read(f) {
			reads.set(f.path, (reads.get(f.path) ?? 0) + 1);
			await sleep(jobMs);
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		},
		async decode() {
			return { width: 400, height: 600, source: {} as CanvasImageSource, close() {} };
		},
		async encode() {
			return new Blob([new Uint8Array(7000)], { type: 'image/png' });
		},
		// A solid picture, so that the arms have an outline to keep.
		async rgba(_s, w, h) {
			return new Uint8ClampedArray(w * h * 4).fill(255);
		},
		coarse: () => coarse,
		dpr: () => 3,
	};
	return { io, reads };
}

const appOf = () => ({
	metadataCache: { getFirstLinkpathDest: () => null },
	vault: { getAbstractFileByPath: () => null },
	fileManager: {},
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
});

const PORTRAIT: CopyBox = { w: 128, h: 128, fit: 'portrait', onDevice: true };
const ARMS: CopyBox = { w: 96, h: 120, fit: 'meet', onDevice: true };
const face = file('Arms and Portraits/portrait-eleanor.png');
const shield = file('Arms and Portraits/coa-avenoy.png');

const asCopy = (c: unknown): PictureCopy => {
	expect(c && typeof c === 'object' && 'url' in (c as object)).toBe(true);
	return c as PictureCopy;
};

/** Draws the two pictures in one session and lets the copies reach the storage. */
async function firstStart(b: CopyBackend, files: { f: VaultFile; box: CopyBox }[] = [{ f: face, box: PORTRAIT }, { f: shield, box: ARMS }]) {
	const { io, reads } = fakeIO(false, 1);
	const { copies } = session(b);
	const store = createPictureStore(appOf() as never, io, copies);
	for (const x of files) asCopy(await store.acquire(x.f, x.box)).release();
	await copies.flush();
	return { reads, store };
}

describe('D318: copies on the device, lookup and keys', () => {
	it('a copy from an earlier start shows with no read and no decode, and the arms keep their outline', async () => {
		const b = fakeBackend();
		const first = await firstStart(b);
		const outline = first.store.outlineOf!(shield);
		expect(outline).not.toBeNull();
		expect(first.reads.get(face.path)).toBe(1);
		const { io, reads } = fakeIO(true);
		const { copies } = session(b);
		const store = createPictureStore(appOf() as never, io, copies);
		const p = asCopy(await store.acquire(face, PORTRAIT));
		const a = asCopy(await store.acquire(shield, ARMS));
		expect(reads.size).toBe(0);
		expect([p.w, p.h]).toEqual([384, 384]);
		expect(a.w).toBeGreaterThan(0);
		expect(store.outlineOf!(shield)).toEqual(outline);
		expect(store.stats.entries).toBe(2);
	});

	it('a changed size or a changed modified time is a miss, never an old picture', async () => {
		const b = fakeBackend();
		await firstStart(b);
		for (const changed of [file(face.path, 1001, 1), file(face.path, 1000, 2)]) {
			const { io, reads } = fakeIO(false, 1);
			const store = createPictureStore(appOf() as never, io, session(b).copies);
			asCopy(await store.acquire(changed, PORTRAIT));
			expect(reads.get(face.path)).toBe(1);
		}
	});

	it('another vault never uses the copies of this vault', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const { io, reads } = fakeIO(false, 1);
		const store = createPictureStore(appOf() as never, io, session(b, { vault: 'vault-b' }).copies);
		asCopy(await store.acquire(face, PORTRAIT));
		expect(reads.get(face.path)).toBe(1);
	});

	it('another size or part is another copy; a request without onDevice (a picker row) is not kept', async () => {
		const b = fakeBackend();
		await firstStart(b, [{ f: face, box: { ...PORTRAIT, w: 56, h: 56 } }, { f: shield, box: { w: 40, h: 40, fit: 'meet' } }]);
		const { io, reads } = fakeIO(false, 1);
		const store = createPictureStore(appOf() as never, io, session(b).copies);
		asCopy(await store.acquire(face, PORTRAIT));
		asCopy(await store.acquire(face, { ...PORTRAIT, w: 56, h: 56 }));
		asCopy(await store.acquire(shield, { w: 40, h: 40, fit: 'meet' }));
		// The 56 px portrait was the hit: only the 128 px portrait was read. The arms were not kept (no onDevice), so they were read.
		expect(reads.get(face.path)).toBe(1);
		expect(reads.get(shield.path)).toBe(1);
	});

	const damage = (b: ReturnType<typeof fakeBackend>) => {
		for (const [k, v] of b.data) if (k.startsWith('c\u0000') && k.includes('portrait')) b.data.set(k, { ...(v as object), data: null });
	};
	const rowKeys = (b: ReturnType<typeof fakeBackend>) => ((b.data.get('i\u0000vault-a') as { rows: [string, number][] }).rows ?? []).map((r) => r[0]);

	it('a copy that is damaged in storage is a miss; the picture is made again and its new copy is a good one', async () => {
		const b = fakeBackend();
		await firstStart(b);
		damage(b);
		const { io, reads } = fakeIO(false, 1);
		const { copies } = session(b);
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await store.acquire(face, PORTRAIT));
		await copies.flush();
		expect(reads.get(face.path)).toBe(1);
		expect(rowKeys(b).length).toBe(2);
		const again = session(b);
		expect(await again.copies.find({ path: face.path, sig: '1:1000', kind: 'portrait', w: 384, h: 384, dpr: 3, part: '' })).not.toBeNull();
	});

	it('a damaged copy that is not made again leaves the storage and the index', async () => {
		const b = fakeBackend();
		await firstStart(b);
		damage(b);
		const { copies } = session(b);
		const rows = rowKeys(b).filter((k) => k.includes('portrait'));
		expect(rows.length).toBe(1);
		const [, , path, sig, kind, size, part] = rows[0].split('\u0000');
		const [w, h] = size.split('@')[0].split('x').map(Number);
		expect(await copies.find({ path, sig, kind: kind as 'portrait', w, h, dpr: 3, part })).toBeNull();
		await copies.flush();
		expect([...b.data.keys()].filter((k) => k.includes('portrait'))).toEqual([]);
		expect(rowKeys(b).length).toBe(1);
	});
});

describe('D318: the limits', () => {
	const id = (path: string, sig = '1:1'): CopyId => ({ path, sig, kind: 'portrait', w: 96, h: 96, dpr: 3, part: '' });
	const blob = () => new Blob([new Uint8Array(7000)], { type: 'image/png' });
	const rowsOf = (b: ReturnType<typeof fakeBackend>) => ((b.data.get('i\u0000vault-a') as { rows: [string, number][] } | undefined)?.rows ?? []).map((r) => r[0].split('\u0000')[2]);

	it('the budget is 8 MB', () => expect(COPIES_BUDGET).toBe(8_000_000));

	it('the copy used longest ago leaves first when the budget is full', async () => {
		const b = fakeBackend();
		const { copies } = session(b, { budget: 30_000 });
		for (const p of ['a.png', 'b.png', 'c.png', 'd.png']) copies.save(id(p), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		expect(rowsOf(b)).toEqual(['a.png', 'b.png', 'c.png', 'd.png']);
		// A use of a.png makes b.png the oldest.
		expect(await copies.find(id('a.png'))).not.toBeNull();
		copies.save(id('e.png'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		expect(rowsOf(b)).toEqual(['c.png', 'd.png', 'a.png', 'e.png']);
		const total = (b.data.get('i\u0000vault-a') as { rows: [string, number][] }).rows.reduce((n, r) => n + r[1], 0);
		expect(total).toBeLessThanOrEqual(30_000);
		// The evicted record is gone from storage too.
		expect([...b.data.keys()].filter((k) => k.startsWith('c\u0000')).length).toBe(4);
		expect(await copies.find(id('b.png'))).toBeNull();
	});

	it('one copy larger than a quarter of the budget is not kept', async () => {
		const b = fakeBackend();
		const { copies } = session(b, { budget: 20_000 });
		copies.save(id('big.png'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		expect(rowsOf(b)).toEqual([]);
	});

	it('a newer version of a file replaces its older copy', async () => {
		const b = fakeBackend();
		const { copies } = session(b);
		copies.save(id('a.png', '1:1'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		copies.save(id('a.png', '2:1'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		expect(rowsOf(b)).toEqual(['a.png']);
		expect([...b.data.keys()].filter((k) => k.startsWith('c\u0000')).length).toBe(1);
		expect(await copies.find(id('a.png', '1:1'))).toBeNull();
		expect(await copies.find(id('a.png', '2:1'))).not.toBeNull();
	});

	it('the copies of a file that is not in the vault any more are dropped when they are seen; the others stay', async () => {
		const b = fakeBackend();
		const one = session(b);
		for (const p of ['gone.png', 'here.png']) one.copies.save(id(p), { blob: blob(), w: 96, h: 96 });
		await one.copies.flush();
		const two = session(b, { exists: (p) => p !== 'gone.png' });
		expect(await two.copies.find(id('here.png'))).not.toBeNull();
		await two.copies.flush();
		expect(rowsOf(b)).toEqual(['here.png']);
		expect([...b.data.keys()].some((k) => k.includes('gone.png'))).toBe(false);
	});

	it('invalidate (a changed, renamed or deleted picture file) drops its copies and cancels a copy that waits to be written', async () => {
		const b = fakeBackend();
		const { io } = fakeIO(false, 1);
		const { copies } = session(b);
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await store.acquire(face, PORTRAIT)).release();
		await copies.flush();
		expect(rowsOf(b)).toEqual([face.path]);
		asCopy(await store.acquire(shield, ARMS)).release();
		store.invalidate(shield.path);
		store.invalidate(face.path);
		await copies.flush();
		expect(rowsOf(b)).toEqual([]);
	});
});

describe('D318: a changed file hides its copies at once', () => {
	const id = (path: string): CopyId => ({ path, sig: '1:1', kind: 'portrait', w: 96, h: 96, dpr: 3, part: '' });
	const blob = () => new Blob([new Uint8Array(7000)], { type: 'image/png' });

	it('after forget, a find for the same key gives no copy, and the write removes the record', async () => {
		const b = fakeBackend();
		const { copies } = session(b);
		copies.save(id('a.png'), { blob: blob(), w: 96, h: 96 });
		copies.save(id('b.png'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
		copies.forget('a.png');
		expect(await copies.find(id('a.png'))).toBeNull();
		expect(await copies.find(id('b.png'))).not.toBeNull();
		await copies.flush();
		expect([...b.data.keys()].filter((k) => k.startsWith('c\u0000')).length).toBe(1);
		expect((b.data.get('i\u0000vault-a') as { rows: unknown[] }).rows.length).toBe(1);
	});

	it('a forget before the index was read hides the copies that the index then lists', async () => {
		const b = fakeBackend();
		const one = session(b);
		one.copies.save(id('a.png'), { blob: blob(), w: 96, h: 96 });
		await one.copies.flush();
		const two = session(b);
		two.copies.forget('a.png');
		expect(await two.copies.find(id('a.png'))).toBeNull();
		await two.copies.flush();
		expect([...b.data.keys()].filter((k) => k.startsWith('c\u0000'))).toEqual([]);
	});
});

describe('D318: a fault in the storage never reaches the plugin', () => {
	it('no IndexedDB on the device: no warning, and every picture is made as before', async () => {
		const { io, reads } = fakeIO(false, 1);
		const { copies, warns } = session(null);
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await store.acquire(face, PORTRAIT));
		asCopy(await store.acquire(shield, ARMS));
		await copies.flush();
		expect(reads.size).toBe(2);
		expect(warns).toEqual([]);
	});

	it('storage that cannot be opened: one warning, pictures as before', async () => {
		const { io, reads } = fakeIO(false, 1);
		const { copies, warns } = session(null, { open: async () => Promise.reject(new Error('SecurityError')) });
		const store = createPictureStore(appOf() as never, io, copies);
		for (const f of [face, shield]) asCopy(await store.acquire(f, f === face ? PORTRAIT : ARMS));
		await copies.flush();
		expect(reads.size).toBe(2);
		expect(warns.length).toBe(1);
	});

	it('a full storage (the write fails): one warning, the copy is still drawn, later pictures work', async () => {
		const b = fakeBackend();
		b.failWrite = true;
		const { io, reads } = fakeIO(false, 1);
		const { copies, warns } = session(b);
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await store.acquire(face, PORTRAIT));
		await copies.flush();
		asCopy(await store.acquire(shield, ARMS));
		await copies.flush();
		expect(reads.size).toBe(2);
		expect(warns.length).toBe(1);
		expect(b.data.size).toBe(0);
	});

	it('a stuck record read: the picture waits at most the limit, then it is made as before, and later pictures do not wait', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const { io, reads } = fakeIO(false, 1);
		const { copies, warns } = session(b, { limit: 30 });
		const store = createPictureStore(appOf() as never, io, copies);
		// The index is read first, then the storage stops answering.
		asCopy(await store.acquire(shield, ARMS));
		b.hang = true;
		asCopy(await untilDone(store.acquire(face, PORTRAIT)));
		expect(reads.get(face.path)).toBe(1);
		expect(warns.length).toBe(1);
		const gets = b.gets;
		asCopy(await store.acquire(file('x/other.png'), ARMS));
		expect(b.gets).toBe(gets);
		expect(warns.length).toBe(1);
	});

	it('a stuck first open: the picture waits at most the open limit, is made as before, and no warning is told', async () => {
		const b = fakeBackend();
		b.hang = true;
		const { io, reads } = fakeIO(false, 1);
		let at = 0;
		const { copies, warns } = session(b, { openLimit: 30, now: () => at });
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await untilDone(store.acquire(face, PORTRAIT)));
		expect(reads.get(face.path)).toBe(1);
		expect(warns).toEqual([]);
		// The limit counts from the first request: a later picture does not wait for it again.
		at = 40;
		asCopy(await store.acquire(shield, ARMS));
		expect(reads.get(shield.path)).toBe(1);
		expect(warns).toEqual([]);
	});

	it('a slow first open that then succeeds does not turn the copies off', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const { io, reads } = fakeIO(false, 1);
		let at = 0;
		const slow = () => new Promise<CopyBackend>((r) => window.setTimeout(() => r(b), 80));
		const { copies, warns } = session(b, { openLimit: 20, open: slow, now: () => at });
		const store = createPictureStore(appOf() as never, io, copies);
		asCopy(await untilDone(store.acquire(face, PORTRAIT)));
		expect(reads.get(face.path)).toBe(1);
		await untilDone(new Promise<void>((r) => window.setTimeout(r, 200)));
		at = 500;
		asCopy(await store.acquire(shield, ARMS));
		expect(reads.get(shield.path)).toBeUndefined();
		expect(warns).toEqual([]);
	});

	it('the open limit is longer than the record limit', () => expect(OPEN_LIMIT_MS).toBeGreaterThan(1000));

	it('a device that cannot make a link for a copy from the device: the request ends with no picture and no job runs', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const { io, reads } = fakeIO(false, 1);
		const store = createPictureStore(appOf() as never, io, session(b).copies);
		const make = URL.createObjectURL;
		URL.createObjectURL = () => {
			throw new Error('no links');
		};
		try {
			expect(await untilDone(store.acquire(face, PORTRAIT))).toBeNull();
			expect(reads.size).toBe(0);
		} finally {
			URL.createObjectURL = make;
		}
	});

	it('a device that cannot make a link for a new copy: the request ends with no picture', async () => {
		const { io } = fakeIO(false, 1);
		const store = createPictureStore(appOf() as never, io, session(null).copies);
		const make = URL.createObjectURL;
		URL.createObjectURL = () => {
			throw new Error('no links');
		};
		try {
			expect(await untilDone(store.acquire(face, PORTRAIT))).toBeNull();
		} finally {
			URL.createObjectURL = make;
		}
	});

	it('a copies object that rejects in find (outside its contract) does not stall the picture', async () => {
		const broken = { find: () => Promise.reject(new Error('x')), save: () => undefined, forget: () => undefined, flush: () => Promise.resolve() } as unknown as PictureCopies;
		const { io, reads } = fakeIO(false, 1);
		const store = createPictureStore(appOf() as never, io, broken);
		asCopy(await store.acquire(face, PORTRAIT));
		expect(reads.get(face.path)).toBe(1);
	});
});

describe('D318: the copies of a vault that is never opened again', () => {
	const DAY = 86_400_000;
	const id = (path: string): CopyId => ({ path, sig: '1:1', kind: 'portrait', w: 96, h: 96, dpr: 3, part: '' });
	const blob = () => new Blob([new Uint8Array(7000)], { type: 'image/png' });
	const keysOf = (b: ReturnType<typeof fakeBackend>, vault: string) => [...b.data.keys()].filter((k) => k.includes(`\u0000${vault}`));

	async function used(b: CopyBackend, vault: string, day: number) {
		const { copies } = session(b, { vault, now: () => day * DAY + 5 });
		copies.save(id('a.png'), { blob: blob(), w: 96, h: 96 });
		await copies.flush();
	}

	it('a vault not used for more than 60 days loses its copies and its index when another vault opens the database', async () => {
		const b = fakeBackend();
		await used(b, 'old', 0);
		await used(b, 'mid', 10);
		expect(keysOf(b, 'old').length).toBe(2);
		const { copies } = session(b, { vault: 'new', now: () => (STALE_DAYS + 5) * DAY });
		expect(await copies.find(id('a.png'))).toBeNull();
		await copies.flush();
		expect(keysOf(b, 'old')).toEqual([]);
		// 55 days: still within the limit.
		expect(keysOf(b, 'mid').length).toBe(2);
	});

	it('exactly 60 days is still kept; the own vault is never dropped, whatever its day says', async () => {
		const b = fakeBackend();
		await used(b, 'old', 0);
		const edge = session(b, { vault: 'new', now: () => STALE_DAYS * DAY });
		await edge.copies.find(id('a.png'));
		await edge.copies.flush();
		expect(keysOf(b, 'old').length).toBe(2);
		const own = session(b, { vault: 'old', now: () => 500 * DAY });
		expect(await own.copies.find(id('a.png'))).not.toBeNull();
		await own.copies.flush();
		expect(keysOf(b, 'old').length).toBe(2);
	});

	it('a use writes the day into the index, so a vault that is used often stays', async () => {
		const b = fakeBackend();
		await used(b, 'busy', 0);
		const again = session(b, { vault: 'busy', now: () => 70 * DAY });
		expect(await again.copies.find(id('a.png'))).not.toBeNull();
		await again.copies.flush();
		const other = session(b, { vault: 'new', now: () => 100 * DAY });
		await other.copies.find(id('a.png'));
		await other.copies.flush();
		expect(keysOf(b, 'busy').length).toBe(2);
	});
});

describe('D318: the cold start on a touch device', () => {
	/** The order of the phone list: the arms of the large row first, then its portrait, in the same turn. */
	async function arrivals(b: CopyBackend | null, armsKnown: boolean) {
		const { io, reads } = fakeIO(true);
		const { copies } = session(b);
		const store = createPictureStore(appOf() as never, io, copies);
		const t0 = now();
		const at = { arms: 0, portrait: 0 };
		const a = store.acquire(armsKnown ? shield : file('x/other-arms.png'), ARMS).then((c) => ((at.arms = now() - t0), c));
		const p = store.acquire(face, PORTRAIT).then((c) => ((at.portrait = now() - t0), c));
		await Promise.all([a, p]);
		return { at, reads };
	}

	it('the portrait with a copy shows at once, though the arms job (a new file) runs first and holds the only slot', async () => {
		const b = fakeBackend();
		await firstStart(b, [{ f: face, box: PORTRAIT }]);
		const before = await arrivals(null, false);
		const after = await arrivals(b, false);
		process.stderr.write(`[D318] portrait arrives after ${after.at.portrait.toFixed(0)} ms with a copy, ${before.at.portrait.toFixed(0)} ms without (arms job ${JOB_MS} ms)\n`);
		expect(before.at.portrait).toBeGreaterThanOrEqual(JOB_MS * 2 * 0.9);
		expect(after.reads.get(face.path)).toBeUndefined();
		expect(after.at.portrait).toBeLessThan(JOB_MS * 0.5);
		expect(before.at.portrait - after.at.portrait).toBeGreaterThanOrEqual(JOB_MS * 1.5);
		// The arms had no copy: they still wait for their own job.
		expect(after.at.arms).toBeGreaterThanOrEqual(JOB_MS * 0.9);
	});

	it('both pictures with copies: nothing is read and both show at once', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const after = await arrivals(b, true);
		expect(after.reads.size).toBe(0);
		expect(Math.max(after.at.arms, after.at.portrait)).toBeLessThan(JOB_MS * 0.5);
	});

	it('a request that is aborted while it looks for its copy gives null and makes no job', async () => {
		const b = fakeBackend();
		await firstStart(b);
		const { io, reads } = fakeIO(true);
		const store = createPictureStore(appOf() as never, io, session(b).copies);
		const ctl = new AbortController();
		const p = store.acquire(face, PORTRAIT, ctl.signal);
		ctl.abort();
		expect(await p).toBeNull();
		await sleep(JOB_MS * 2);
		expect(reads.size).toBe(0);
		expect(store.stats.entries).toBe(0);
	});
});

describe('D318: the phone list is not filled again when no picture link was missing', () => {
	beforeEach(() => {
		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		clearRelationCache();
		vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	});
	const SRC = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: bob, name: Bob, house: va, parents: [ann], born: 1130, portrait: "[[bob.png]]"}
`;
	const copy = () => ({ url: 'blob:x', w: 10, h: 10, release: () => {} });
	function store(known: () => boolean) {
		return {
			resolve: (link: string) => (known() ? { ok: true, file: { path: String(link).replace(/[[\]]/g, '') }, format: 'png' } : { ok: false, code: 'missing-picture', file: link }),
			check: async () => null,
			acquire: async () => copy(),
			onChange: () => () => {},
		};
	}
	async function listView(known: () => boolean) {
		phone();
		const host = fakeHost(DEFAULT_SETTINGS) as ReturnType<typeof fakeHost> & { startedUp: unknown; pictures: unknown };
		host.startedUp = { ready: () => true, cache: () => true };
		host.pictures = store(known);
		const { view } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		await settle();
		return view;
	}

	it('every link found: a start condition does not take the pictures out of their places', async () => {
		const view = await listView(() => true);
		const refill = vi.spyOn(view as never as { refillList(): void }, 'refillList');
		view.startUpDone();
		view.startUpDone();
		await settle();
		expect(refill).not.toHaveBeenCalled();
	});

	it('a link that is missing: the list is filled again; and again when the file is found', async () => {
		let known = false;
		const view = await listView(() => known);
		const refill = vi.spyOn(view as never as { refillList(): void }, 'refillList');
		view.startUpDone();
		await settle();
		expect(refill).toHaveBeenCalledTimes(1);
		known = true;
		view.startUpDone();
		await settle();
		expect(refill).toHaveBeenCalledTimes(2);
		// Now nothing is missing any more.
		view.startUpDone();
		await settle();
		expect(refill).toHaveBeenCalledTimes(2);
	});
});
