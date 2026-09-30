import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));

import type { TFile as VaultFile } from 'obsidian';
import type { createLivePictures } from '../../src/obsidian/live-pictures';
import type { CopyBox, PictureCopy, PictureIO, PictureStore } from '../../src/obsidian/picture-store';
import type { PictureSlot } from '../../src/render/dom/pictures';
import { FEl, fakeWin, flushFrames, installDom, runTimers } from './fake-dom';
import { TFile } from './fake-obsidian';
import { pngHead, jpegHead, isoFile } from './m9-support';

/*
 * The memory and queue checks of spec §13.6, §13.7 and §13.8 ("Memory (unit check)", "The large
 * picture is never decoded (a unit check on the decode queue)") and §13.0 item 3 ("Size first",
 * "Small copies", "Decode queue", "Live pictures"), through the test seam of the M9 obsidian
 * contract: `createPictureStore(app, io)` (O1, O3, O4, B11, B13) and `createLivePictures` (O5,
 * B15, B18). The browser parts (read, decode, encode) are fakes that count what happens. These
 * tests wait for WP 9.3a and WP 9.3b.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

type Store = PictureStore;
type CreateStore = (app: unknown, io?: PictureIO) => Store;

const STORE_PATH = '../../src/obsidian/picture-store';
const LIVE_PATH = '../../src/obsidian/live-pictures';
async function createStore(): Promise<CreateStore> {
	const m = (await import(/* @vite-ignore */ STORE_PATH).catch((e: unknown) => {
		throw new Error(`src/obsidian/picture-store.ts does not exist yet (WP 9.3a): ${String(e)}`);
	})) as { createPictureStore?: CreateStore };
	if (typeof m.createPictureStore !== 'function') throw new Error('src/obsidian/picture-store.ts does not export createPictureStore yet (WP 9.3a)');
	return m.createPictureStore;
}
async function createLive(): Promise<typeof createLivePictures> {
	const m = (await import(/* @vite-ignore */ LIVE_PATH).catch((e: unknown) => {
		throw new Error(`src/obsidian/live-pictures.ts does not exist yet (WP 9.3b): ${String(e)}`);
	})) as { createLivePictures?: typeof createLivePictures };
	if (typeof m.createLivePictures !== 'function') throw new Error('src/obsidian/live-pictures.ts does not export createLivePictures yet (WP 9.3b)');
	return m.createLivePictures;
}

// ---------- Fakes ----------

/** A vault file as the store sees it. */
function file(path: string, size = 1000): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new TFile(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size } }) as unknown as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(done: () => boolean, what: string): Promise<void> {
	for (let k = 0; k < 200; k++) {
		if (done()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** The browser seam, with counters: open bitmaps, decodes running now and at most, closes, encodes. */
function fakeIO(bytesOf: Map<string, Uint8Array>, o: { coarse?: boolean; blobBytes?: number; hold?: boolean } = {}) {
	const state = { reads: 0, decodes: 0, running: 0, maxRunning: 0, open: 0, maxOpen: 0, closed: 0, encodes: 0, release: [] as (() => void)[] };
	const io: PictureIO = {
		async read(f) {
			state.reads++;
			const b = bytesOf.get(f.path) ?? new Uint8Array();
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		async decode() {
			state.decodes++;
			state.running++;
			state.maxRunning = Math.max(state.maxRunning, state.running);
			if (o.hold) await new Promise<void>((r) => state.release.push(r));
			state.running--;
			state.open++;
			state.maxOpen = Math.max(state.maxOpen, state.open);
			let closed = false;
			return {
				width: 400,
				height: 600,
				source: {} as CanvasImageSource,
				close() {
					if (closed) return;
					closed = true;
					state.open--;
					state.closed++;
				},
			};
		},
		async encode() {
			state.encodes++;
			return new Blob([new Uint8Array(o.blobBytes ?? 7000)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			return new Uint8ClampedArray(w * h * 4);
		},
		coarse: () => !!o.coarse,
		dpr: () => 3,
	};
	return { io, state };
}

/** An app whose links find the files of `files` by name. */
function fakeApp(files: VaultFile[]) {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null },
		fileManager: {},
	};
}

const BOX: CopyBox = { w: 24, h: 24, fit: 'portrait' };
const isCopy = (x: unknown): x is PictureCopy => !!x && typeof x === 'object' && 'url' in x;

describe('O1: resolving a link (spec §13.0 item 3 "Problems")', () => {
	it('web address, missing file, extension, then the file', async () => {
		const files = [file('Pictures/a.png'), file('Pictures/b.heic'), file('Pictures/c.pdf')];
		const store = (await createStore())(fakeApp(files), fakeIO(new Map()).io);
		expect(store.resolve('https://example.com/a.png', 'Tree.md')).toEqual({ ok: false, code: 'picture-web' });
		expect(store.resolve('[[Pictures/missing.png]]', 'Tree.md')).toEqual({ ok: false, code: 'missing-picture', file: 'Pictures/missing.png' });
		expect(store.resolve('[[b.heic]]', 'Tree.md')).toEqual({ ok: false, code: 'picture-not-image', file: 'b.heic', format: 'HEIC' });
		expect(store.resolve('[[c.pdf]]', 'Tree.md')).toEqual({ ok: false, code: 'picture-not-image', file: 'c.pdf' });
		expect(store.resolve('![[a.png|A]]', 'Tree.md')).toMatchObject({ ok: true, format: 'png', file: files[0] });
	});
});

describe('O3, O4: small copies, the size check and the decode queue (spec §13.0 item 3; §13.6, §13.7 memory checks)', () => {
	it('a picture of more than 40 million pixels is never decoded (spec §13.6 acceptance)', async () => {
		const f = file('huge.png');
		const { io, state } = fakeIO(new Map([['huge.png', pngHead(9000, 6000)]]));
		const store = (await createStore())(fakeApp([f]), io);
		expect(await store.check(f)).toEqual({ ok: false, code: 'picture-too-large', file: 'huge.png', pixels: 54 });
		expect(await store.acquire(f, BOX)).toEqual({ ok: false, code: 'picture-too-large', file: 'huge.png', pixels: 54 });
		expect(state.decodes).toBe(0);
	});

	it('HEIC bytes under a .jpg name are not decoded; they are `picture-not-image` HEIC', async () => {
		const f = file('photo.jpg');
		const { io, state } = fakeIO(new Map([['photo.jpg', isoFile('heic', ['mif1', 'heic'], [[4032, 3024]])]]));
		const store = (await createStore())(fakeApp([f]), io);
		expect(await store.check(f)).toEqual({ ok: false, code: 'picture-not-image', file: 'photo.jpg', format: 'HEIC' });
		expect(state.decodes).toBe(0);
	});

	it('after a small copy is made, the full-size bitmap is closed; the store keeps only the encoded copy', async () => {
		const f = file('a.jpg');
		const { io, state } = fakeIO(new Map([['a.jpg', jpegHead(400, 600)]]), { blobBytes: 7000 });
		const store = (await createStore())(fakeApp([f]), io);
		const copy = await store.acquire(f, BOX);
		expect(isCopy(copy)).toBe(true);
		expect(state.decodes).toBe(1);
		expect(state.open).toBe(0);
		expect(store.stats.openBitmaps).toBe(0);
		expect(store.stats.entries).toBe(1);
		expect(store.stats.bytes).toBe(7000);
		expect(store.stats.inUse).toBe(1);
		// The same copy again comes from the store, with no second decode; `peek` finds it too (B15).
		const again = await store.acquire(f, BOX);
		expect(isCopy(again) && isCopy(copy) && again.url === copy.url).toBe(true);
		expect(state.decodes).toBe(1);
		expect(store.peek(f, BOX)?.url).toBe((copy as PictureCopy).url);
		(copy as PictureCopy).release();
		(again as PictureCopy).release();
		expect(store.stats.inUse).toBe(0);
	});

	it('the store holds at most 24 MB of encoded copies; a copy in use is never evicted', async () => {
		const names = Array.from({ length: 8 }, (_, i) => `p${i}.png`);
		const files = names.map((n) => file(n));
		const { io } = fakeIO(new Map(names.map((n) => [n, pngHead(400, 600)])), { blobBytes: 5_000_000 });
		const store = (await createStore())(fakeApp(files), io);
		const kept = (await store.acquire(files[0], BOX)) as PictureCopy;
		for (const f of files.slice(1)) {
			const c = (await store.acquire(f, BOX)) as PictureCopy;
			c.release();
			expect(store.stats.bytes).toBeLessThanOrEqual(24_000_000);
		}
		expect(store.stats.entries).toBeLessThanOrEqual(4);
		expect(store.peek(files[0], BOX)?.url).toBe(kept.url);
		kept.release();
	});

	it('one decode at a time on a touch-first device, at most 2 on others', async () => {
		for (const [coarse, most] of [
			[true, 1],
			[false, 2],
		] as const) {
			const names = ['a.png', 'b.png', 'c.png', 'd.png'];
			const files = names.map((n) => file(n));
			const { io, state } = fakeIO(new Map(names.map((n) => [n, pngHead(400, 600)])), { coarse, hold: true });
			const store = (await createStore())(fakeApp(files), io);
			const all = files.map((f) => store.acquire(f, BOX));
			for (let done = 0; done < files.length; done++) {
				await until(() => state.release.length > 0, 'a decode');
				expect(state.running, `coarse ${coarse}`).toBeLessThanOrEqual(most);
				state.release.shift()!();
			}
			await Promise.all(all);
			expect(state.maxRunning, `coarse ${coarse}`).toBe(most);
			expect(state.open).toBe(0);
		}
	});

	it('a request aborted before its decode starts returns null and decodes nothing (O4, B11)', async () => {
		const names = ['a.png', 'b.png'];
		const files = names.map((n) => file(n));
		const { io, state } = fakeIO(new Map(names.map((n) => [n, pngHead(400, 600)])), { coarse: true, hold: true });
		const store = (await createStore())(fakeApp(files), io);
		const first = store.acquire(files[0], BOX);
		const ctl = new AbortController();
		const second = store.acquire(files[1], BOX, ctl.signal);
		await until(() => state.release.length > 0, 'the first decode');
		ctl.abort();
		state.release.shift()!();
		expect(isCopy(await first)).toBe(true);
		expect(await second).toBeNull();
		expect(state.decodes).toBe(1);
		expect(store.stats.inUse).toBe(1);
	});

	it('Save as picture: one full-size picture at a time, each released before the next (spec §13.8 memory check)', async () => {
		const names = ['a.png', 'b.jpg', 'c.png'];
		const files = names.map((n) => file(n));
		const { io, state } = fakeIO(new Map(names.map((n) => [n, n.endsWith('.jpg') ? jpegHead(400, 600) : pngHead(400, 600)])));
		const store = (await createStore())(fakeApp(files), io);
		const out = await Promise.all(files.map((f) => store.exportCopy(f, { w: 96, h: 96, fit: 'meet' })));
		for (const x of out) expect(typeof x === 'string' && x.startsWith('data:image/png;base64,')).toBe(true);
		expect(state.maxOpen).toBe(1);
		expect(state.open).toBe(0);
		expect(store.stats.maxOpenBitmaps).toBeLessThanOrEqual(1);
	});
});

describe('O5, B18: at most 150 picture elements in each view (spec §13.7 memory check)', () => {
	it('400 portrait slots in the view: at most 150 <image> elements, one per slot at most', async () => {
		const create = await createLive();
		const group = new FEl('g');
		const slots: PictureSlot[] = Array.from({ length: 400 }, (_, i) => {
			const el = group.createSvg('g') as unknown as SVGGElement;
			const frame = (el as unknown as FEl).createSvg('circle', { cls: 'dynasty-portrait-frame' }) as unknown as SVGCircleElement;
			return { kind: 'portrait', lod: 'full', person: `p${i}`, rect: { x: (i % 20) * 30, y: Math.floor(i / 20) * 30, w: 24, h: 24 }, el, frame };
		});
		let n = 0;
		const store = {
			resolve: () => ({ ok: true }),
			check: async () => null,
			acquire: async () => ({ url: `blob:${n++}`, w: 72, h: 72, release() {} }),
			transient: async () => null,
			pixels: async () => null,
			exportCopy: async () => '',
			invalidate() {},
			clear() {},
			peek: () => null,
			stats: { bytes: 0, entries: 0, inUse: 0, openBitmaps: 0, maxOpenBitmaps: 0 },
		} as unknown as PictureStore;
		const live = create(slots, store, (s) => file(`${s.person}.png`));
		live.update({ x: 0, y: 0, w: 600, h: 600 }, 'full');
		// Animation frames and short timers may carry the work; 50 rounds are 0.8 s of fake time.
		for (let k = 0; k < 50; k++) {
			flushFrames();
			runTimers(16);
			await tick();
		}
		const images = (s: PictureSlot) => (s.el as unknown as FEl).all().filter((e) => e.tag === 'image').length;
		const count = slots.reduce((sum, s) => sum + images(s), 0);
		expect(count).toBeGreaterThan(0);
		expect(count).toBeLessThanOrEqual(150);
		expect(live.images).toBe(count);
		for (const s of slots) expect(images(s)).toBeLessThanOrEqual(1);
		live.destroy();
		expect(slots.reduce((sum, s) => sum + images(s), 0)).toBe(0);
	});
});
