import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { OUTLINE_GRID, armsGap } from '../../src/layout/arms-outline';
import { createLivePictures } from '../../src/obsidian/live-pictures';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO } from '../../src/obsidian/picture-store';
import { ARMS_GAP_CLASS, type PictureSlot } from '../../src/render/dom/pictures';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D219: the outline of the arms picture. The store reads it once, while the first copy of the file is made (the same decode, one 128-cell draw), keeps it by
 * the file's path and signature, and the live pictures draw the gap round the arms from it as soon as the copy shows; a picture whose outline is not known
 * has no gap.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const f = new File(path, 'png');
	return Object.assign(f, { name, basename: name.slice(0, -4), stat: { mtime, ctime: 1, size: 1000 } }) as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(done: () => boolean, what: string): Promise<void> {
	for (let k = 0; k < 200; k++) {
		if (done()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** A 400 x 600 picture whose shield is a heater (flat top, point at the bottom); `rgba` gives the alpha of that shape on the grid it is asked for. */
function fakeIO(o: { failRgba?: boolean; clear?: boolean } = {}) {
	const state = { decodes: 0, rgba: 0, grids: [] as [number, number][] };
	const io: PictureIO = {
		async read() {
			const b = pngHead(400, 600);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		async decode() {
			state.decodes++;
			return { width: 400, height: 600, source: {} as CanvasImageSource, close() {} };
		},
		async encode() {
			return new Blob([new Uint8Array(500)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			state.rgba++;
			state.grids.push([w, h]);
			if (o.failRgba) throw new Error('tainted');
			const px = new Uint8ClampedArray(w * h * 4);
			if (o.clear) return px;
			for (let y = 0; y < h; y++) {
				for (let x = 0; x < w; x++) {
					const u = (x + 0.5) / w;
					const v = (y + 0.5) / h;
					const half = v < 0.5 ? 0.45 : 0.45 * (1 - (v - 0.5) / 0.5);
					if (v > 0.05 && Math.abs(u - 0.5) < half) px[(y * w + x) * 4 + 3] = 255;
				}
			}
			return px;
		},
		coarse: () => false,
		dpr: () => 1,
	};
	return { io, state };
}

const app = (files: VaultFile[]) => ({
	metadataCache: { getFirstLinkpathDest: (p: string) => files.find((f) => f.path === p) ?? null },
	vault: { getAbstractFileByPath: () => null, getFiles: () => files },
	loadLocalStorage: () => null,
	saveLocalStorage: () => undefined,
});

const ARMS: CopyBox = { w: 20, h: 24, fit: 'meet' };

describe('the picture store reads the outline of arms (D219)', () => {
	it('a copy of an arms picture also makes the outline: on a grid whose longer side is 128, one draw, no second decode', async () => {
		const f = file('v.png');
		const { io, state } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		expect(store.outlineOf!(f)).toBeNull();
		const copy = await store.acquire(f, ARMS);
		expect((copy as PictureCopy).url).toBeTruthy();
		const o = store.outlineOf!(f)!;
		expect(o).not.toBeNull();
		expect(state.decodes).toBe(1);
		expect(state.rgba).toBe(1);
		expect(state.grids[0]).toEqual([85, OUTLINE_GRID]);
		expect([o.w, o.h]).toEqual([85, OUTLINE_GRID]);
		expect(o.d.startsWith('M')).toBe(true);
		expect(o.d.endsWith('Z')).toBe(true);
	});

	it('a second copy of the same file, at another size, does not draw the outline again', async () => {
		const f = file('v.png');
		const { io, state } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		await store.acquire(f, ARMS);
		await store.acquire(f, { ...ARMS, w: 40, h: 48 });
		expect(state.decodes).toBe(2);
		expect(state.rgba).toBe(1);
	});

	it('a portrait copy and a transient copy make no outline; a copy for the saved picture does', async () => {
		const f = file('v.png');
		const { io, state } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		await store.acquire(f, { w: 24, h: 24, fit: 'portrait' });
		await store.transient(f, ARMS);
		expect(state.rgba).toBe(0);
		expect(store.outlineOf!(f)).toBeNull();
		const uri = await store.exportCopy(f, { w: 80, h: 96, fit: 'meet' });
		expect(typeof uri).toBe('string');
		expect(state.rgba).toBe(1);
		expect(store.outlineOf!(f)).not.toBeNull();
	});

	it('a changed file (a new signature) and invalidate forget the outline', async () => {
		const f = file('v.png');
		const { io } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		await store.acquire(f, ARMS);
		expect(store.outlineOf!(f)).not.toBeNull();
		expect(store.outlineOf!(file('v.png', 2))).toBeNull();
		store.invalidate('v.png');
		expect(store.outlineOf!(f)).toBeNull();
	});

	it('a canvas that cannot be read, and a clear picture, give no outline and still a copy', async () => {
		for (const o of [{ failRgba: true }, { clear: true }]) {
			const f = file('v.png');
			const { io } = fakeIO(o);
			const store = createPictureStore(app([f]) as never, io);
			const copy = await store.acquire(f, ARMS);
			expect((copy as PictureCopy).url).toBeTruthy();
			expect(store.outlineOf!(f)).toBeNull();
		}
	});
});

describe('the live pictures draw the gap from the outline (D219)', () => {
	function slotFor(): PictureSlot {
		const el = new FEl('g', { cls: 'dynasty-arms' });
		return { kind: 'arms', lod: 'full', person: 'a', owner: { house: 'v' }, rect: { x: 100, y: -20, w: 20, h: 24 }, el: el as unknown as SVGGElement, gap: 3.2 };
	}

	it('the gap path comes with the copy, under the picture, sized by the slot\'s gap; it goes when the slot leaves the view', async () => {
		const f = file('v.png');
		const { io } = fakeIO();
		const store = createPictureStore(app([f]) as never, io);
		const slot = slotFor();
		const live = createLivePictures([slot], store, () => f);
		const group = slot.el as unknown as FEl;
		expect(group.children).toHaveLength(0);
		live.update({ x: 0, y: -50, w: 400, h: 400 }, 'full', 1);
		await until(() => live.images === 1, 'the picture');
		expect(group.children.map((c) => c.tag)).toEqual(['path', 'image']);
		const gap = group.children[0]!;
		expect(gap.hasClass(ARMS_GAP_CLASS)).toBe(true);
		const o = store.outlineOf!(f)!;
		// The grid is 85 x 128 cells in a box 20 x 24: 24 / 128 = 0.1875 px per cell, centred sideways; the path is in layout px, with no transform; the stroke is twice 3.2 px wide.
		expect(gap.getAttribute('transform')).toBeNull();
		expect(gap.getAttribute('d')).toBe(armsGap(o, slot.rect, 3.2).d);
		expect(gap.getAttribute('d')!.startsWith('M')).toBe(true);
		const xs = [...gap.getAttribute('d')!.matchAll(/(-?[d.]+) (-?[d.]+)/g)].map((m) => Number(m[1]));
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(100 + (20 - 85 * 0.1875) / 2 - 0.01);
		expect(Math.max(...xs)).toBeLessThanOrEqual(120 - (20 - 85 * 0.1875) / 2 + 0.01);
		expect(Number(gap.getAttribute('stroke-width'))).toBe(6.4);
		live.update({ x: 5000, y: 5000, w: 10, h: 10 }, 'full', 1);
		expect(group.children).toHaveLength(0);
		live.destroy();
	});

	it('with no outline there is a picture and no gap', async () => {
		const f = file('v.png');
		const { io } = fakeIO({ failRgba: true });
		const store = createPictureStore(app([f]) as never, io);
		const slot = slotFor();
		const live = createLivePictures([slot], store, () => f);
		live.update({ x: 0, y: -50, w: 400, h: 400 }, 'full', 1);
		await until(() => live.images === 1, 'the picture');
		expect((slot.el as unknown as FEl).children.map((c) => c.tag)).toEqual(['image']);
		live.destroy();
	});
});
