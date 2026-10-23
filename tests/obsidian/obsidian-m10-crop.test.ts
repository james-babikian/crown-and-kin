import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import type { Op } from '../../src/core/edit';
import { automaticCrop, type CropFraction } from '../../src/core/portrait-crop';
import { applyOp } from '../../src/core/yaml-edit';
import { CROP_COPY_PX, dragCrop, openCropTool, sideOf, sliderOf, toolSizes, cropWheelFactor } from '../../src/obsidian/crop-tool';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import type { CropResult } from '../../src/obsidian/crop-tool';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO, type PictureStore } from '../../src/obsidian/picture-store';
import { CROP_UI, PICTURES_UI, WINDOW_UI } from '../../src/render/ui-text';
import { VIEWER_UI } from '../../src/render/viewer-text';
import { FEl, device, dispatch, fakeWin, pointer, resetDom, wheel } from '../acceptance/fake-dom';
import { lastMenu, notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { pickerRowFor } from '../acceptance/m11-support';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * WP 10.3a (M10 rules C1–C8, spec §13.13, D79, D90, D91): the crop in the picture store (cut
 * square, key, export), the crop tool's gestures and results, and the edit sheet's "Select the part"
 * button with the D91 rules for the draft field `portraitCrop`.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	// D212 crop-tool: a 1024 × 768 window gives the frame of 280 px that the numbers below use: (768 - 96 - 280) / 1.4 = 280, the area 392 px.
	device.width = 1024;
	device.height = 768;
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1).toLowerCase()), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) await tick();
}

function storeApp(files: VaultFile[]) {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

// ---------- the store (C8) ----------

/** The seam with a record of every encode: the cut square and the output size. */
function recordingIO() {
	const encodes: { crop: { sx: number; sy: number; sw: number; sh: number }; out: { w: number; h: number }; round: boolean }[] = [];
	const io: PictureIO = {
		read: async () => {
			const b = pngHead(400, 600);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		decode: async () => ({ width: 400, height: 600, source: {} as CanvasImageSource, close() {} }),
		encode: async (_s, crop, out, round) => {
			encodes.push({ crop, out, round });
			return new Blob([new Uint8Array(100)], { type: 'image/png' });
		},
		rgba: async (_s, w, h) => new Uint8ClampedArray(w * h * 4),
		coarse: () => false,
		dpr: () => 1,
	};
	return { io, encodes };
}

const PORTRAIT: CopyBox = { w: 40, h: 40, fit: 'portrait' };
const isCopy = (x: unknown): x is PictureCopy => !!x && typeof x === 'object' && 'url' in x;

describe('C8: the crop in the picture store', () => {
	it('no crop cuts the upper-centre square; a crop cuts cropSquare(crop) of the picture', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		const a = await store.transient(f, PORTRAIT);
		const b = await store.transient(f, { ...PORTRAIT, crop: { left: 0.1, top: 0.4, side: 0.5 } });
		expect(isCopy(a) && isCopy(b)).toBe(true);
		expect(encodes.map((e) => e.crop)).toEqual([
			{ sx: 0, sy: 0, sw: 400, sh: 400 },
			{ sx: 40, sy: 240, sw: 200, sh: 200 },
		]);
		expect(encodes.every((e) => e.round)).toBe(true);
	});

	it('a crop that leaves the picture is moved as cropSquare does (sample tree 14, Odette)', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		await store.transient(f, { ...PORTRAIT, crop: { left: 0.9, top: 0.9, side: 0.8 } });
		expect(encodes[0].crop).toEqual({ sx: 80, sy: 280, sw: 320, sh: 320 });
	});

	it('the key holds the crop: the same box with two crops is two copies; the same crop is one', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		const one = { ...PORTRAIT, crop: { left: 0.1, top: 0.4, side: 0.5 } };
		const two = { ...PORTRAIT, crop: { left: 0.2, top: 0.4, side: 0.5 } };
		const c1 = (await store.acquire(f, one)) as PictureCopy;
		const c2 = (await store.acquire(f, two)) as PictureCopy;
		const c1b = (await store.acquire(f, { ...one, crop: { ...one.crop } })) as PictureCopy;
		expect(encodes).toHaveLength(2);
		expect(c1.url).toBe(c1b.url);
		expect(c1.url).not.toBe(c2.url);
	});

	it('a crop of 4-decimal text that reads the same is the same key', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		await store.acquire(f, { ...PORTRAIT, crop: { left: 0.1, top: 0.4, side: 0.5 } });
		await store.acquire(f, { ...PORTRAIT, crop: { left: 0.100001, top: 0.4, side: 0.5 } });
		expect(encodes).toHaveLength(1);
	});

	it('peek finds a copy only for the same crop; a box with no crop keeps its old key', async () => {
		const f = file('a.png');
		const { io } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		const crop = { left: 0.1, top: 0.4, side: 0.5 };
		await store.acquire(f, { ...PORTRAIT, crop });
		expect(store.peek(f, { ...PORTRAIT, crop })).not.toBeNull();
		expect(store.peek(f, PORTRAIT)).toBeNull();
		await store.acquire(f, PORTRAIT);
		expect(store.peek(f, PORTRAIT)).not.toBeNull();
	});

	it('a crop on a "meet" copy is ignored (the whole picture, one key)', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		const box: CopyBox = { w: 100, h: 100, fit: 'meet' };
		await store.acquire(f, box);
		await store.acquire(f, { ...box, crop: { left: 0.1, top: 0.4, side: 0.5 } });
		expect(encodes).toHaveLength(1);
		expect(encodes[0].crop).toEqual({ sx: 0, sy: 0, sw: 400, sh: 600 });
		expect(encodes[0].round).toBe(false);
	});

	it('exportCopy takes the crop for a portrait (the saved picture)', async () => {
		const f = file('a.png');
		const { io, encodes } = recordingIO();
		const store = createPictureStore(storeApp([f]) as never, io);
		const uri = await store.exportCopy(f, { w: 96, h: 96, fit: 'portrait', crop: { left: 0.1, top: 0.4, side: 0.5 } });
		expect(typeof uri).toBe('string');
		expect(encodes[0].crop).toEqual({ sx: 40, sy: 240, sw: 200, sh: 200 });
		await store.exportCopy(f, { w: 96, h: 96, fit: 'portrait' });
		expect(encodes[1].crop).toEqual({ sx: 0, sy: 0, sw: 400, sh: 400 });
	});
});

// ---------- the tool's numbers (C4) ----------

describe('C4: the tool\'s steps', () => {
	it('the slider curve: side = 10^(-z), z from 0 to 1', () => {
		expect(sideOf(0)).toBe(1);
		expect(sideOf(1)).toBeCloseTo(0.1, 12);
		expect(sideOf(0.5)).toBeCloseTo(Math.sqrt(0.1), 12);
		expect(sliderOf(1)).toBe(0);
		expect(sliderOf(0.1)).toBeCloseTo(1, 12);
		for (const side of [0.1, 0.25, 0.5, 1]) expect(sideOf(sliderOf(side))).toBeCloseTo(side, 12);
		// Out-of-range and broken input stays in the range.
		expect(sliderOf(0.01)).toBe(1);
		expect(sliderOf(Number.NaN)).toBe(0);
		expect(sideOf(7)).toBeCloseTo(0.1, 12);
		expect(sideOf(Number.NaN)).toBe(1);
	});

	it('the wheel factor is exp(-deltaY x 0.002)', () => {
		expect(cropWheelFactor(0)).toBe(1);
		expect(cropWheelFactor(-100)).toBeCloseTo(Math.exp(0.2), 12);
		expect(cropWheelFactor(100)).toBeCloseTo(Math.exp(-0.2), 12);
		expect(cropWheelFactor(Number.NaN)).toBe(1);
	});

	it('a drag of (dx, dy) screen px moves the crop by (-dx, -dy) x side x short / frame picture px', () => {
		const start: CropFraction = { left: 0.2, top: 0.2, side: 0.5 };
		// side 0.5 x 400 = 200 px in a frame of 280 px: 200 / 280 picture px per screen px.
		const c = dragCrop(start, 28, 56, 280, 400, 600);
		expect(c.left).toBeCloseTo(0.2 - (28 * (200 / 280)) / 400, 12);
		expect(c.top).toBeCloseTo(0.2 - (56 * (200 / 280)) / 600, 12);
		expect(c.side).toBe(0.5);
		// A drag past the edge stops at the picture.
		expect(dragCrop(start, -100000, -100000, 280, 400, 600)).toEqual({ left: 0.5, top: 1 - 200 / 600, side: 0.5 });
		expect(dragCrop(start, 100000, 100000, 280, 400, 600)).toEqual({ left: 0, top: 0, side: 0.5 });
		expect(dragCrop(start, 5, 5, 0, 400, 600)).toBe(start);
	});

	it('the frame is smaller than the area, and both fit a phone', () => {
		const phone = toolSizes(true, 390, 844);
		expect(phone.frame).toBeGreaterThanOrEqual(140);
		expect(phone.area).toBeGreaterThan(phone.frame);
		// D212 crop-tool: the area takes the full width of a phone.
		expect(phone.area).toBeLessThanOrEqual(390);
		expect(phone.area).toBeGreaterThanOrEqual(390 - 2);
		const short = toolSizes(true, 390, 400);
		expect(short.frame).toBe(140);
		const desk = toolSizes(false, 1280, 800);
		// D212 crop-tool: a large window, 48 px from the edges: (800 - 96 - 280) / 1.4 px.
		expect(desk.frame).toBe(302);
		expect(toolSizes(false, 1280, 2000).frame).toBe(480);
		expect(toolSizes(true, Number.NaN, Number.NaN).frame).toBeGreaterThan(0);
	});
});

// ---------- the tool (C1–C6) ----------

/** A store whose transient copy is the whole 400 × 600 picture; records the boxes and the releases. */
function toolStore(o: { problem?: boolean; size?: { w: number; h: number } } = {}) {
	const log = { boxes: [] as CopyBox[], released: 0, made: 0 };
	const size = o.size ?? { w: 400, h: 600 };
	const store = {
		transient: async (_f: VaultFile, box: CopyBox) => {
			log.boxes.push(box);
			await tick();
			if (o.problem) return { ok: false as const, code: 'picture-not-image' as const, file: 'a.png' };
			log.made++;
			let done = false;
			return {
				url: 'blob:whole',
				w: size.w,
				h: size.h,
				release() {
					if (done) return;
					done = true;
					log.released++;
				},
			} satisfies PictureCopy;
		},
	} as unknown as PictureStore;
	return { store, log };
}

function openTool(o: { start?: CropFraction | null; store?: PictureStore } = {}) {
	const t = toolStore();
	let result: CropResult | null = null;
	void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: o.store ?? t.store, personName: 'Roderick Valmont', start: o.start ?? null }).then((r) => (result = r));
	const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl; close(): void };
	const q = (sel: string) => modal.contentEl.querySelector(sel)!;
	return { ...t, modal, q, result: () => result, area: q('.dynasty-crop-area') };
}

const prop = (el: FEl, name: string) => Number.parseFloat(el.style.getPropertyValue(name));

describe('C1–C6: the crop tool', () => {
	it('asks for a copy of at most 2048 px on the long side, fit "meet", and shows it under a round frame', async () => {
		const { log, q, area } = openTool();
		expect(q('.dynasty-crop-save').disabled).toBe(true);
		await settle();
		expect(log.boxes).toEqual([{ w: CROP_COPY_PX, h: CROP_COPY_PX, fit: 'meet' }]);
		expect(q('.dynasty-crop-img').getAttribute('src')).toBe('blob:whole');
		expect(area.hasClass('has-picture')).toBe(true);
		expect(q('.dynasty-crop-frame')).not.toBeNull();
		expect(q('.dynasty-crop-save').disabled).toBe(false);
		// The automatic part of a 400 x 600 picture: the full width from the top, the frame shows 400 px.
		const frame = 280;
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(frame / 400, 5);
		expect(prop(area, '--dynasty-crop-tx')).toBeCloseTo((392 - frame) / 2, 1);
		expect(prop(area, '--dynasty-crop-ty')).toBeCloseTo((392 - frame) / 2, 1);
	});

	it('with a fast pixel ratio the box is smaller by the same factor, so the copy stays at 2048 px', async () => {
		(fakeWin as unknown as { devicePixelRatio: number }).devicePixelRatio = 2;
		try {
			const { log } = openTool();
			await settle();
			expect(log.boxes[0].w).toBe(1024);
		} finally {
			delete (fakeWin as unknown as { devicePixelRatio?: number }).devicePixelRatio;
		}
	});

	it('the start part is shown (clamped); the automatic part is the start when none is given', async () => {
		const { q, area } = openTool({ start: { left: 0.1, top: 0.4, side: 0.5 } });
		await settle();
		// side 0.5 -> 200 px across the 280 px frame: scale 1.4; left 40 px, top 240 px.
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(1.4, 5);
		expect(prop(area, '--dynasty-crop-tx')).toBeCloseTo(56 - 40 * 1.4, 1);
		expect(prop(area, '--dynasty-crop-ty')).toBeCloseTo(56 - 240 * 1.4, 1);
		expect(Number((q('.dynasty-crop-slider') as unknown as { value: string }).value)).toBeCloseTo(sliderOf(0.5), 6);
	});

	it('Save with the automatic part gives null and closes the tool', async () => {
		const a = openTool();
		await settle();
		dispatch(a.q('.dynasty-crop-save'), 'click');
		await settle();
		expect(a.result()).toEqual({ kind: 'save', crop: null });
		expect(openModals).toHaveLength(0);
	});

	it('Zoom in and Zoom out change the part by 1.25 and 0.8 about the frame centre', async () => {
		const { q, area, modal } = openTool();
		await settle();
		const buttons = modal.contentEl.querySelectorAll('.dynasty-crop-zoom .dynasty-crop-button');
		expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([CROP_UI.zoomOut, CROP_UI.zoomIn]);
		dispatch(buttons[1], 'click');
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(1.25 * (280 / 400), 5);
		dispatch(buttons[0], 'click');
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(280 / 400, 5);
		dispatch(q('.dynasty-crop-save'), 'click');
	});

	it('one pointer drags the picture: the result is a save with the moved part', async () => {
		let out: CropResult | null = null;
		const t = toolStore();
		void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: { left: 0.2, top: 0.2, side: 0.5 } }).then((r) => (out = r));
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		const area = modal.contentEl.querySelector('.dynasty-crop-area')!;
		await settle();
		dispatch(area, 'pointerdown', pointer('touch', 1, 100, 100));
		dispatch(area, 'pointermove', pointer('touch', 1, 128, 156));
		dispatch(area, 'pointerup', pointer('touch', 1, 128, 156));
		dispatch(modal.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		const want = dragCrop({ left: 0.2, top: 0.2, side: 0.5 }, 28, 56, 280, 400, 600);
		expect(out).toEqual({ kind: 'save', crop: want });
	});

	it('a pointer that was not pressed on the area does not move the picture; a second mouse button is ignored', async () => {
		const { area } = openTool({ start: { left: 0.2, top: 0.2, side: 0.5 } });
		await settle();
		const before = area.style.getPropertyValue('--dynasty-crop-tx');
		dispatch(area, 'pointermove', pointer('mouse', 1, 128, 156));
		dispatch(area, 'pointerdown', { ...pointer('mouse', 2, 100, 100), button: 2 });
		dispatch(area, 'pointermove', pointer('mouse', 2, 150, 150));
		expect(area.style.getPropertyValue('--dynasty-crop-tx')).toBe(before);
	});

	it('two pointers: the distance ratio zooms about the midpoint and the picture point under it stays', async () => {
		const { q, area } = openTool({ start: { left: 0.2, top: 0.2, side: 0.5 } });
		await settle();
		dispatch(area, 'pointerdown', pointer('touch', 1, 176, 196, false));
		dispatch(area, 'pointerdown', pointer('touch', 2, 216, 196, false));
		// The fingers move apart to double the distance about the same midpoint (196, 196).
		dispatch(area, 'pointermove', pointer('touch', 1, 156, 196, false));
		dispatch(area, 'pointermove', pointer('touch', 2, 236, 196, false));
		// The second move doubled 40 -> 60 (x1.5), the first 40 -> 60 too (from 216 - 156); the total is checked by the side.
		dispatch(area, 'pointerup', pointer('touch', 1, 156, 196, false));
		dispatch(area, 'pointerup', pointer('touch', 2, 236, 196, false));
		const slider = Number((q('.dynasty-crop-slider') as unknown as { value: string }).value);
		expect(slider).toBeGreaterThan(sliderOf(0.5));
		// After the fingers lift, a move changes nothing.
		const tx = area.style.getPropertyValue('--dynasty-crop-tx');
		dispatch(area, 'pointermove', pointer('touch', 1, 300, 300, false));
		expect(area.style.getPropertyValue('--dynasty-crop-tx')).toBe(tx);
	});

	it('the wheel zooms by exp(-deltaY x 0.002) about the pointer, and does not scroll the window', async () => {
		const { area, q } = openTool({ start: { left: 0.2, top: 0.2, side: 0.5 } });
		await settle();
		const e = dispatch(area, 'wheel', wheel(0, -100, 196, 196));
		expect(e.defaultPrevented).toBe(true);
		const slider = Number((q('.dynasty-crop-slider') as unknown as { value: string }).value);
		expect(slider).toBeCloseTo(sliderOf(0.5 / Math.exp(0.2)), 6);
	});

	it('the slider sets side = 10^(-z) about the frame centre', async () => {
		const { area, q } = openTool();
		await settle();
		const slider = q('.dynasty-crop-slider') as unknown as FEl;
		slider.value = '0.5';
		dispatch(slider, 'input');
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(280 / (Math.sqrt(0.1) * 400), 4);
		slider.value = '1';
		dispatch(slider, 'input');
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(280 / (0.1 * 400), 4);
	});

	it('keys: arrows move the picture by 2 % of the frame (Shift 10 %); + and = zoom in, - zooms out by 1.1', async () => {
		const { area } = openTool({ start: { left: 0.3, top: 0.3, side: 0.5 } });
		await settle();
		const tx = () => prop(area, '--dynasty-crop-tx');
		const t0 = tx();
		// The picture moves left: the part moves right by 2 % of the frame = 5.6 screen px.
		const e = dispatch(area, 'keydown', { key: 'ArrowLeft', shiftKey: false });
		expect(e.defaultPrevented).toBe(true);
		expect(t0 - tx()).toBeCloseTo(5.6, 1);
		dispatch(area, 'keydown', { key: 'ArrowRight', shiftKey: true });
		expect(tx() - (t0 - 5.6)).toBeCloseTo(28, 1);
		const s0 = prop(area, '--dynasty-crop-scale');
		dispatch(area, 'keydown', { key: '+' });
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(s0 * 1.1, 4);
		dispatch(area, 'keydown', { key: '-' });
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(s0, 4);
		dispatch(area, 'keydown', { key: '=' });
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(s0 * 1.1, 4);
		const other = dispatch(area, 'keydown', { key: 'a' });
		expect(other.defaultPrevented).toBe(false);
	});

	it('Reset returns to the automatic part, does not close the tool, and is never disabled', async () => {
		const { q, modal, area } = openTool({ start: { left: 0.1, top: 0.4, side: 0.5 } });
		await settle();
		const reset = q('.dynasty-crop-reset');
		expect(reset.disabled).toBe(false);
		expect(reset.getAttribute('aria-label')).toBe('Reset: select the automatic part again');
		dispatch(reset, 'click');
		expect(openModals).toContain(modal as never);
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(280 / 400, 5);
		expect(prop(area, '--dynasty-crop-ty')).toBeCloseTo(56, 1);
	});

	it('Reset then Save gives null', async () => {
		let out: CropResult | null = null;
		const t = toolStore();
		void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: { left: 0.1, top: 0.4, side: 0.5 } }).then((r) => (out = r));
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		await settle();
		dispatch(modal.contentEl.querySelector('.dynasty-crop-reset')!, 'click');
		dispatch(modal.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		expect(out).toEqual({ kind: 'save', crop: null });
	});

	it('Cancel, Escape (close) and a press outside give cancel, ask nothing, and release the copy once', async () => {
		for (const how of ['button', 'close']) {
			resetObsidian();
			let out: CropResult | null = null;
			const t = toolStore();
			void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: null }).then((r) => (out = r));
			const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl; close(): void };
			await settle();
			if (how === 'button') dispatch(modal.contentEl.querySelector('.dynasty-crop-cancel')!, 'click');
			else modal.close();
			await settle();
			expect(out).toEqual({ kind: 'cancel' });
			expect(t.log.released).toBe(1);
			expect(openModals).toHaveLength(0);
		}
	});

	it('closing before the copy arrives gives cancel and releases the late copy', async () => {
		let out: CropResult | null = null;
		const t = toolStore();
		void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: null }).then((r) => (out = r));
		const modal = openModals[openModals.length - 1] as unknown as { close(): void };
		modal.close();
		await settle();
		expect(out).toEqual({ kind: 'cancel' });
		expect(t.log.released).toBe(t.log.made);
	});

	it('a picture with a problem shows the text, keeps Save disabled, and Reset still works without throwing', async () => {
		const t = toolStore({ problem: true });
		void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: null });
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		await settle();
		expect(modal.contentEl.querySelector('.dynasty-crop-status')!.getText()).toBe(CROP_UI.problem);
		expect(modal.contentEl.querySelector('.dynasty-crop-save')!.disabled).toBe(true);
		expect(() => dispatch(modal.contentEl.querySelector('.dynasty-crop-reset')!, 'click')).not.toThrow();
	});

	it('the hint follows the pointer: two fingers on a touch device, the mouse wheel otherwise', () => {
		device.coarse = true;
		let m = openTool();
		expect(m.q('.dynasty-crop-hint').getText()).toBe('Move the picture with one finger. Zoom with two fingers.');
		resetObsidian();
		device.coarse = false;
		m = openTool();
		expect(m.q('.dynasty-crop-hint').getText()).toBe('Drag the picture to move it. Use the mouse wheel or the slider to zoom.');
	});

	it('every button has a tooltip label; the window is the phone layout below 600 px', async () => {
		device.width = 390;
		const { modal, q } = openTool();
		expect(modal.modalEl.hasClass('is-phone')).toBe(true);
		for (const b of modal.contentEl.querySelectorAll('button')) expect(b.getAttribute('aria-label'), b.getText()).toBeTruthy();
		expect(q('.dynasty-crop-save').getAttribute('aria-label')).toBe('Save');
		expect(q('.dynasty-crop-cancel').getAttribute('aria-label')).toBe('Cancel');
		// On the phone the bar with Reset, Cancel and Save is the last part of the body.
		const body = modal.contentEl.querySelector('.dynasty-crop-body')!;
		expect(body.children[body.children.length - 1].hasClass('dynasty-crop-bar')).toBe(true);
		expect(modal.modalEl.style.getPropertyValue('--dynasty-crop-frame')).toMatch(/^\d+px$/);
		await settle();
	});

	it('is the computer window above 600 px', () => {
		const { modal } = openTool();
		expect(modal.modalEl.hasClass('is-phone')).toBe(false);
		expect(modal.modalEl.hasClass('dynasty-crop')).toBe(true);
	});

	it('the automatic part is the start when the picture is wide (centre), and Save unchanged gives null', async () => {
		let out: CropResult | null = null;
		const t = toolStore({ size: { w: 600, h: 400 } });
		void openCropTool({ app: {} as never, file: file('Pictures/a.png'), store: t.store, personName: 'A', start: automaticCrop(600, 400) }).then((r) => (out = r));
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		await settle();
		dispatch(modal.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		expect(out).toEqual({ kind: 'save', crop: null });
	});
});

// ---------- the edit sheet (C7, D91) ----------

const BODY = `houses:
  - id: valmont
    name: House Valmont
people:
  - id: roderick
    name: Roderick Valmont
    house: valmont
    portrait: "[[roderick.jpg]]"
    portrait-crop: "0.1 0.4 0.5"
  - id: odette
    name: Odette Valmont
    house: valmont
    portrait: "[[roderick.jpg]]"
  - id: gwen
    name: Gwen Valmont
    house: valmont
    portrait: "![[Pictures/roderick.jpg]]"
    portrait-crop: "0.2 0.2 0.4"
  - id: wren
    name: Wren Valmont
    house: valmont
`;

function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Tree.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	return h;
}

/** A store for the sheet: resolve is the real rule; a "meet" copy is the whole picture, a "portrait" copy is 80 × 80; every box is recorded. */
function sheetStore(files: VaultFile[]) {
	const app = storeApp(files);
	const boxes: CopyBox[] = [];
	let n = 0;
	const store: PictureStore = {
		...createPictureStore(app as never, recordingIO().io),
		transient: async (_f: VaultFile, box: CopyBox) => {
			boxes.push(box);
			return { url: `blob:c${n++}`, w: box.fit === 'meet' ? 400 : 80, h: box.fit === 'meet' ? 600 : 80, release() {} };
		},
	};
	return { app, store, boxes };
}

describe('C7, D91: the person window and the part of the portrait', () => {
	const files = [file('Pictures/roderick.jpg'), file('Pictures/new.png')];

	function open(id: string, pictures = true) {
		const { app, store, boxes } = sheetStore(files);
		const handle = writingHandle(BODY);
		const sheet = EditSheet.create(app as never, { handle: handle as never, personId: id, sourcePath: 'Tree.md', pictures: pictures ? store : undefined })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		return { sheet, content, handle, boxes };
	}

	async function saveSheet(content: FEl) {
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
	}

	async function pickInPicker(path: string) {
		const picker = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		// M11 (D92): the folders are closed unless they hold the current picture, so open the folders of `path` first.
		dispatch(pickerRowFor(picker.contentEl, path), 'click');
		dispatch(pickerRowFor(picker.contentEl, path), 'click');
		await settle();
	}

	// 0.2.8 (Q6H A): the portrait in the header is one button that opens a short menu.
	const menuOf = (content: FEl) => {
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		return lastMenu()!;
	};
	const partItem = (content: FEl) => menuOf(content).item(WINDOW_UI.selectPart);
	const choose = (content: FEl, title: string) => menuOf(content).item(title)!.click();
	const topTool = () => openModals[openModals.length - 1] as unknown as { contentEl: FEl };

	it('the menu offers Select the part when the portrait can show, after Select portrait and before Remove portrait', async () => {
		const { content } = open('roderick');
		await settle();
		const m = menuOf(content);
		const titles = m.items.filter((i) => i !== 'sep').map((i) => (i as { title: string }).title);
		// D256: View portrait is the first item.
		expect(titles).toEqual([VIEWER_UI.viewPortrait, PICTURES_UI.selectPortrait, WINDOW_UI.selectPart, PICTURES_UI.removePortrait, WINDOW_UI.selectPersonalArms]);
		expect(WINDOW_UI.selectPart).toBe('Select the part of the portrait');
	});

	it('it does not show with no portrait, nor when the file is missing', async () => {
		const none = open('wren');
		await settle();
		expect(partItem(none.content)).toBeUndefined();
		expect(menuOf(none.content).item(PICTURES_UI.removePortrait)).toBeUndefined();
		resetObsidian();
		const { app, store } = sheetStore([]);
		const handle = writingHandle(BODY);
		const sheet = EditSheet.create(app as never, { handle: handle as never, personId: 'roderick', sourcePath: 'Tree.md', pictures: store })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		expect(partItem(content)).toBeUndefined();
	});

	it('a new person has no portrait menu: a tap on the picture says "save first"', async () => {
		const { app, store } = sheetStore(files);
		const handle = writingHandle(BODY);
		const sheet = EditSheet.createNew(app as never, { handle: handle as never, sourcePath: 'Tree.md', pictures: store, newPerson: { kind: 'person' } } as never)!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		expect(notices).toContain(WINDOW_UI.saveFirst);
		expect(openModals.filter((m) => (m as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-picker-list'))).toHaveLength(0);
	});

	it('the round portrait shows the draft part, and a new part makes a new copy', async () => {
		const { content, boxes } = open('roderick');
		await settle();
		expect(boxes.filter((b) => b.fit === 'portrait')[0].crop).toEqual({ left: 0.1, top: 0.4, side: 0.5 });
		choose(content, WINDOW_UI.selectPart);
		await settle();
		const tool = topTool();
		dispatch(tool.contentEl.querySelector('.dynasty-crop-reset')!, 'click');
		dispatch(tool.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		const portraits = boxes.filter((b) => b.fit === 'portrait');
		expect(portraits).toHaveLength(2);
		expect(portraits[1].crop).toBeUndefined();
	});

	it('the tool opens on the draft part, its Save is a draft edit, and the sheet Save writes only portrait-crop', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, WINDOW_UI.selectPart);
		await settle();
		const tool = topTool();
		const area = tool.contentEl.querySelector('.dynasty-crop-area')!;
		expect(prop(area, '--dynasty-crop-scale')).toBeCloseTo(1.4, 5);
		dispatch(tool.contentEl.querySelector('.dynasty-crop-button')!, 'click');
		dispatch(tool.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		expect(handle.write).not.toHaveBeenCalled();
		await saveSheet(content);
		expect(handle.ops).toHaveLength(1);
		const op = handle.ops[0] as { kind: string; fields: Record<string, unknown> };
		expect(Object.keys(op.fields)).toEqual(['portrait-crop']);
		expect(op.fields['portrait-crop']).toMatch(/^\d(\.\d+)? \d(\.\d+)? \d(\.\d+)?$/);
		// Roderick's line changed; Gwen's line stays.
		expect(handle.body.split('\n').filter((l) => l.includes('portrait-crop'))).toHaveLength(2);
		expect(handle.body).toContain('portrait-crop: "0.2 0.2 0.4"');
	});

	it('Cancel in the tool changes nothing: the sheet is not dirty', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, WINDOW_UI.selectPart);
		await settle();
		dispatch(topTool().contentEl.querySelector('.dynasty-crop-cancel')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.ops).toEqual([]);
	});

	it('Reset and Save in the tool for a person with a part removes it from the note', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, WINDOW_UI.selectPart);
		await settle();
		const tool = topTool();
		dispatch(tool.contentEl.querySelector('.dynasty-crop-reset')!, 'click');
		dispatch(tool.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'roderick', fields: { 'portrait-crop': null } }]);
		expect(handle.body).toBe(BODY.replace('    portrait-crop: "0.1 0.4 0.5"\n', ''));
	});

	it('D196 item 4: a picked portrait opens the crop tool at once; Cancel there keeps the new portrait with the automatic part (D91)', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, PICTURES_UI.selectPortrait);
		await pickInPicker('Pictures/new.png');
		const tool = topTool();
		expect(tool.contentEl.querySelector('.dynasty-crop-area')).not.toBeNull();
		dispatch(tool.contentEl.querySelector('.dynasty-crop-cancel')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'roderick', fields: { portrait: '[[new.png]]', 'portrait-crop': null } }]);
		expect(handle.body).toBe(BODY.replace('    portrait: "[[roderick.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', '    portrait: "[[new.png]]"\n'));
	});

	it('D91: Remove portrait clears the draft part; the save removes both keys', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, PICTURES_UI.removePortrait);
		expect(partItem(content)).toBeUndefined();
		await saveSheet(content);
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'roderick', fields: { portrait: null, 'portrait-crop': null } }]);
		expect(handle.body).toBe(BODY.replace('    portrait: "[[roderick.jpg]]"\n    portrait-crop: "0.1 0.4 0.5"\n', ''));
	});

	it('D91: a new link text for the same file keeps the part, and the write says so with portrait-crop', async () => {
		const { content, handle } = open('gwen');
		await settle();
		choose(content, PICTURES_UI.selectPortrait);
		// The picker writes "[[roderick.jpg]]"; the note has "![[Pictures/roderick.jpg]]": another text, the same file.
		await pickInPicker('Pictures/roderick.jpg');
		dispatch(topTool().contentEl.querySelector('.dynasty-crop-cancel')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'gwen', fields: { portrait: '[[roderick.jpg]]', 'portrait-crop': '0.2 0.2 0.4' } }]);
		expect(handle.body).toBe(BODY.replace('portrait: "![[Pictures/roderick.jpg]]"', 'portrait: "[[roderick.jpg]]"'));
	});

	it('D91: a person with no part who selects a new picture writes only the portrait', async () => {
		const { content, handle } = open('odette');
		await settle();
		choose(content, PICTURES_UI.selectPortrait);
		await pickInPicker('Pictures/new.png');
		dispatch(topTool().contentEl.querySelector('.dynasty-crop-cancel')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'odette', fields: { portrait: '[[new.png]]' } }]);
	});

	it('a part chosen for a new picture in the same sheet is written with it (one write)', async () => {
		const { content, handle } = open('roderick');
		await settle();
		choose(content, PICTURES_UI.selectPortrait);
		await pickInPicker('Pictures/new.png');
		const tool = topTool();
		expect(prop(tool.contentEl.querySelector('.dynasty-crop-area')!, '--dynasty-crop-scale')).toBeCloseTo(280 / 400, 5);
		dispatch(tool.contentEl.querySelectorAll('.dynasty-crop-zoom .dynasty-crop-button')[1], 'click');
		dispatch(tool.contentEl.querySelector('.dynasty-crop-save')!, 'click');
		await settle();
		await saveSheet(content);
		expect(handle.write).toHaveBeenCalledTimes(1);
		const fields = (handle.ops[0] as { fields: Record<string, unknown> }).fields;
		expect(fields.portrait).toBe('[[new.png]]');
		// Zoom in x1.25 about the frame centre of the automatic part of 400 x 600: side 0.8 (320 px), left 40 px, top 40 px.
		expect(fields['portrait-crop']).toBe('0.1 0.0667 0.8');
	});

	it('with no store the picture is not an option for a part: the menu has no Select the part', async () => {
		const { content } = open('roderick', false);
		await settle();
		expect(partItem(content)).toBeUndefined();
	});
});
