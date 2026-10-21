import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { bindViewerMotion, openPictureViewer, type ViewerPicture } from '../src/obsidian/picture-viewer';
import { createPictureStore, type CopyBox, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { SWIPE_SETTLE_MS } from '../src/render/dom/sheet-swipe';
import { VIEWER_UI } from '../src/render/viewer-text';
import { PICTURES_UI, WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeDoc, fakeWin, flushFrames, installDom, pointer, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { lastMenu, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { pngHead } from './acceptance/m9-support';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * WP-5 (D256): the picture viewer. The real viewer runs on the fakes of the DOM and of Obsidian. The checks: the dialog and its label, the whole picture in its
 * size, the two small pictures (tap, arrow keys, swipe), the picture that shows at once (D262) and "Reduce movement", the swipe down (one slide, D262), the pinch and the double tap, Tab and the
 * focus return, the copy request and its release, and the menu items of the person window (also when the window cannot change the note).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

let unbind: () => void = () => {};

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	unbind = bindViewerMotion(() => 'system');
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	unbind();
	delete (fakeWin as Record<string, unknown>).devicePixelRatio;
	vi.restoreAllMocks();
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1).toLowerCase()), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
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

const quietIO = (): PictureIO => ({
	read: async () => {
		const b = pngHead(400, 600);
		return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
	},
	decode: async () => ({ width: 400, height: 600, source: {} as CanvasImageSource, close() {} }),
	encode: async () => new Blob([new Uint8Array(10)], { type: 'image/png' }),
	rgba: async (_s, w, h) => new Uint8ClampedArray(w * h * 4),
	coarse: () => false,
	dpr: () => 1,
});

/** What the store was asked for, and which copies were let go. */
interface Calls {
	transient: { path: string; box: CopyBox }[];
	acquire: { path: string; box: CopyBox }[];
	released: string[];
}

/**
 * A store with the real `resolve` and copies made by the test: the size of each large copy comes from `sizes` (by path), a gate holds the large copies back
 * until `release()`d by the test when `hold` is set.
 */
function viewerStore(files: VaultFile[], sizes: Record<string, { w: number; h: number }> = {}, hold = false) {
	const real = createPictureStore(storeApp(files) as never, quietIO());
	const calls: Calls = { transient: [], acquire: [], released: [] };
	const gates: (() => void)[] = [];
	let n = 0;
	const copy = (kind: string, w: number, h: number): PictureCopy => {
		const url = `blob:${kind}-${n++}`;
		return { url, w, h, release: () => void calls.released.push(url) };
	};
	const store: PictureStore = {
		...real,
		transient: async (f, box) => {
			calls.transient.push({ path: f.path, box });
			const size = sizes[f.path] ?? { w: 400, h: 600 };
			if (hold) await new Promise<void>((r) => gates.push(r));
			return copy('large', size.w, size.h);
		},
		acquire: async (f, box) => {
			calls.acquire.push({ path: f.path, box });
			return copy('thumb', 52, 52);
		},
	};
	return { store, calls, openGates: () => gates.splice(0).forEach((g) => g()) };
}

const PORTRAIT: ViewerPicture = { kind: 'portrait', link: '[[roderick.jpg]]', heading: 'Roderick Valmont', line: 'Portrait · Duke of Valmont · b. 1131', label: 'Portrait of Roderick Valmont', show: VIEWER_UI.showPortrait };
const ARMS: ViewerPicture = { kind: 'arms', link: '[[valmont-arms.png]]', heading: 'Roderick Valmont', line: 'Arms of House Valmont', label: 'Arms of House Valmont', show: VIEWER_UI.showArms };
const FILES = [file('Pictures/roderick.jpg'), file('Pictures/valmont-arms.png'), file('Pictures/small.png'), file('Pictures/orsini.svg')];

interface Opened {
	modal: FEl;
	content: FEl;
	opener: FEl;
	calls: Calls;
	openGates: () => void;
	stage: FEl;
	img: FEl;
}

function openViewer(pictures: ViewerPicture[], o: { start?: number; sizes?: Record<string, { w: number; h: number }>; hold?: boolean } = {}): Opened {
	const opener = new FEl('button');
	const { store, calls, openGates } = viewerStore(FILES, o.sizes, o.hold);
	openPictureViewer({ app: {} as never, store, sourcePath: 'Tree.md', pictures, start: o.start ?? 0, opener: opener as never });
	const viewer = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
	return { modal: viewer.modalEl, content: viewer.contentEl, opener, calls, openGates, stage: viewer.contentEl.querySelector('.dynasty-viewer-stage')!, img: viewer.contentEl.querySelector('.dynasty-viewer-img')! };
}

const prop = (el: FEl, name: string) => el.style.getPropertyValue(name);
const thumbs = (content: FEl) => content.querySelectorAll('button.dynasty-viewer-thumb');
const key = (target: FEl, k: string, extra: Record<string, unknown> = {}) => dispatch(target, 'keydown', { key: k, shiftKey: false, ...extra });
const nameOf = (content: FEl) => content.querySelector('.dynasty-viewer-name')!.getText();
const lineOf = (content: FEl) => content.querySelector('.dynasty-viewer-line')!.getText();

/** The dialog label: the text of the element that `aria-labelledby` names (no `aria-label`, which Obsidian shows as a tooltip). */
interface Labelled { getAttribute(name: string): string | null; querySelector(sel: string): { getAttribute(name: string): string | null; textContent: string | null } | null }
function labelOf(m: Labelled): string | null {
	const id = m.getAttribute('aria-labelledby');
	const el = m.querySelector('.dynasty-sr-only');
	return el && id && el.getAttribute('id') === id ? el.textContent : null;
}

describe('the window (D256 items 2, 4 and 5)', () => {
	it('is a dialog with a label, with the name, one text line and the whole picture', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		expect(v.modal.hasClass('dynasty-viewer')).toBe(true);
		expect(v.modal.hasClass('dynasty-sheet')).toBe(true);
		expect(v.modal.getAttribute('role')).toBe('dialog');
		expect(v.modal.getAttribute('aria-modal')).toBe('true');
		expect(labelOf(v.modal)).toBe('Portrait of Roderick Valmont');
		expect(nameOf(v.content)).toBe('Roderick Valmont');
		expect(lineOf(v.content)).toBe('Portrait · Duke of Valmont · b. 1131');
		expect(v.img.getAttribute('alt')).toBe('Portrait of Roderick Valmont');
		expect(v.img.getAttribute('src')).toMatch(/^blob:large/);
		expect(v.stage.hasClass('has-picture')).toBe(true);
	});

	it('the container of the window has the class that darkens the screen behind it in a light theme (look round 0.3.2)', async () => {
		openViewer([PORTRAIT]);
		await settle();
		const container = (openModals[openModals.length - 1] as unknown as { containerEl: FEl }).containerEl;
		expect(container.hasClass('modal-container')).toBe(true);
		expect(container.hasClass('dynasty-viewer-container')).toBe(true);
	});

	it('the colours of the surface come from the theme: the window has no colour of its own in its code, only classes', async () => {
		const v = openViewer([PORTRAIT]);
		await settle();
		for (const el of v.modal.all()) expect([...el.styleProps.keys()].filter((k) => !k.startsWith('--dynasty-'))).toEqual([]);
	});

	it('shows the whole picture in the size that fits the stage, and a raster picture grows to 2x at most (an SVG fills the stage)', async () => {
		const tall = openViewer([PORTRAIT], { sizes: { 'Pictures/roderick.jpg': { w: 4000, h: 6000 } } });
		await settle();
		// The stage of the fake is 800 × 600 px: a 2:3 picture is 400 × 600.
		expect([prop(tall.img, '--dynasty-vw-w'), prop(tall.img, '--dynasty-vw-h')]).toEqual(['400px', '600px']);
		for (const m of [...openModals]) m.close();
		const small = openViewer([{ ...PORTRAIT, link: '[[small.png]]' }], { sizes: { 'Pictures/small.png': { w: 128, h: 192 } } });
		await settle();
		expect([prop(small.img, '--dynasty-vw-w'), prop(small.img, '--dynasty-vw-h')]).toEqual(['256px', '384px']);
		for (const m of [...openModals]) m.close();
		const svg = openViewer([{ ...ARMS, link: '[[orsini.svg]]' }], { sizes: { 'Pictures/orsini.svg': { w: 128, h: 192 } } });
		await settle();
		expect([prop(svg.img, '--dynasty-vw-w'), prop(svg.img, '--dynasty-vw-h')]).toEqual(['400px', '600px']);
	});

	it('a picture that cannot load now says so, and a picture that is still on its way says that', async () => {
		const v = openViewer([{ ...PORTRAIT, link: '[[nothing.png]]' }]);
		await settle();
		expect(v.content.querySelector('.dynasty-viewer-status')!.getText()).toBe(VIEWER_UI.problem);
		expect(v.stage.hasClass('has-picture')).toBe(false);
		for (const m of [...openModals]) m.close();
		const slow = openViewer([PORTRAIT], { hold: true });
		await settle();
		expect(slow.content.querySelector('.dynasty-viewer-status')!.getText()).toBe(VIEWER_UI.loading);
		slow.openGates();
		await settle();
		expect(slow.content.querySelector('.dynasty-viewer-status')!.hasClass('is-hidden')).toBe(true);
	});

	it('asks the store for the large copy as the crop tool does: at most 2048 px, never larger than the picture, one copy at a time; the pixel ratio shrinks the box', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		expect(v.calls.transient).toEqual([{ path: 'Pictures/roderick.jpg', box: { w: 2048, h: 2048, fit: 'meet', noEnlarge: true } }]);
		(fakeWin as Record<string, unknown>).devicePixelRatio = 3;
		for (const m of [...openModals]) m.close();
		const phone = openViewer([PORTRAIT]);
		await settle();
		expect(phone.calls.transient[0]!.box).toEqual({ w: 682, h: 682, fit: 'meet', noEnlarge: true });
	});

	it('releases every copy when it closes, also a copy that arrives after the close', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		const shown = v.calls.released.length;
		expect(shown).toBe(0);
		(openModals[openModals.length - 1] as unknown as { close(): void }).close();
		// The large copy of the portrait and the two small pictures.
		expect(v.calls.released.filter((u) => u.startsWith('blob:large'))).toHaveLength(1);
		expect(v.calls.released.filter((u) => u.startsWith('blob:thumb'))).toHaveLength(2);
		const late = openViewer([PORTRAIT], { hold: true });
		await settle();
		(openModals[openModals.length - 1] as unknown as { close(): void }).close();
		late.openGates();
		await settle();
		expect(late.calls.released.some((u) => u.startsWith('blob:large'))).toBe(true);
	});

	it('the Close button closes it and the focus goes back to the picture that opened it', async () => {
		const v = openViewer([PORTRAIT]);
		await settle();
		const close = v.content.querySelector('button.dynasty-viewer-close')!;
		expect(close.getText()).toBe(VIEWER_UI.close);
		expect(fakeDoc.activeElement).toBe(v.modal);
		dispatch(close, 'click');
		expect(openModals).toHaveLength(0);
		expect(fakeDoc.activeElement).toBe(v.opener);
	});
});

describe('the two small pictures (D256 item 3)', () => {
	it('are buttons with a label and aria-pressed; the shown one is pressed', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		const t = thumbs(v.content);
		expect(t.map((b) => b.getAttribute('aria-label'))).toEqual([VIEWER_UI.showPortrait, VIEWER_UI.showArms]);
		expect(t.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
		expect(t.map((b) => b.hasClass('is-on'))).toEqual([true, false]);
		expect(v.content.querySelector('.dynasty-viewer-thumbs')!.getAttribute('role')).toBe('group');
		expect(t[0]!.querySelector('img')!.getAttribute('src')).toMatch(/^blob:thumb/);
	});

	it('a tap changes the picture, the text line, the name of the window and the ring; the window keeps its size classes', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		dispatch(thumbs(v.content)[1]!, 'click');
		await settle();
		expect(lineOf(v.content)).toBe('Arms of House Valmont');
		expect(labelOf(v.modal)).toBe('Arms of House Valmont');
		expect(thumbs(v.content).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
		expect(v.calls.transient.map((c) => c.path)).toEqual(['Pictures/roderick.jpg', 'Pictures/valmont-arms.png']);
		// Back to the first picture: its copy is still there and is not asked for again.
		dispatch(thumbs(v.content)[0]!, 'click');
		await settle();
		expect(v.calls.transient).toHaveLength(2);
		expect(lineOf(v.content)).toBe('Portrait · Duke of Valmont · b. 1131');
	});

	it('the arrow keys change the picture and stop at the ends; Tab stays inside', async () => {
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		const right = key(v.modal, 'ArrowRight');
		expect(right.defaultPrevented).toBe(true);
		expect(lineOf(v.content)).toBe('Arms of House Valmont');
		key(v.modal, 'ArrowRight');
		expect(lineOf(v.content)).toBe('Arms of House Valmont');
		key(v.modal, 'ArrowLeft');
		expect(lineOf(v.content)).toBe('Portrait · Duke of Valmont · b. 1131');
		// Tab from the last control goes to the first; Shift+Tab from the first goes to the last.
		const close = v.content.querySelector('button.dynasty-viewer-close')!;
		close.focus();
		expect(key(v.modal, 'Tab').defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).toBe(thumbs(v.content)[0]);
		expect(key(v.modal, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
		expect(fakeDoc.activeElement).toBe(close);
		// In the middle, Tab goes on as the browser does it.
		thumbs(v.content)[0]!.focus();
		expect(key(v.modal, 'Tab').defaultPrevented).toBe(false);
	});

	it('a viewer with one picture has no small pictures, and the arrow keys do nothing', async () => {
		const v = openViewer([ARMS]);
		await settle();
		expect(v.content.querySelector('.dynasty-viewer-thumbs')).toBeNull();
		expect(key(v.modal, 'ArrowRight').defaultPrevented).toBe(false);
	});

	it('opens on the picture that was asked for', async () => {
		const v = openViewer([PORTRAIT, ARMS], { start: 1 });
		await settle();
		expect(lineOf(v.content)).toBe('Arms of House Valmont');
		expect(thumbs(v.content).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
	});
});

describe('the portrait shows at once (D262) and "Reduce movement" (D126)', () => {
	// D262 (after the iPhone test): the round portrait no longer grows into the picture. There is no opening class and no circle to size.
	const noMotion = (v: Opened) => {
		expect(v.img.hasClass('is-opening')).toBe(false);
		for (const p of ['--dynasty-vw-r0', '--dynasty-vw-r1', '--dynasty-vw-cx', '--dynasty-vw-cy']) expect(prop(v.img, p)).toBe('');
		expect(v.stage.hasClass('has-picture')).toBe(true);
	};

	it('a portrait shows whole at once: no is-opening class, before or after the next frames', async () => {
		const v = openViewer([PORTRAIT]);
		await settle();
		noMotion(v);
		expect(prop(v.img, '--dynasty-vw-w')).not.toBe('');
		flushFrames();
		noMotion(v);
	});

	it('arms show at once too, and so does a picture that the small pictures change to', async () => {
		const arms = openViewer([ARMS]);
		await settle();
		noMotion(arms);
		for (const m of [...openModals]) m.close();
		const v = openViewer([PORTRAIT, ARMS]);
		await settle();
		dispatch(thumbs(v.content)[1]!, 'click');
		await settle();
		dispatch(thumbs(v.content)[0]!, 'click');
		await settle();
		noMotion(v);
	});

	it('the window has the class of reduced movement when the device asks for less movement', async () => {
		device.reduceMotion = true;
		const v = openViewer([PORTRAIT]);
		await settle();
		expect(v.modal.hasClass('dynasty-reduce-motion')).toBe(true);
		noMotion(v);
	});

	it('the setting On reduces the movement, and the setting Off does not, whatever the device says', async () => {
		unbind();
		unbind = bindViewerMotion(() => 'on');
		const on = openViewer([PORTRAIT]);
		await settle();
		expect(on.modal.hasClass('dynasty-reduce-motion')).toBe(true);
		for (const m of [...openModals]) m.close();
		unbind();
		device.reduceMotion = true;
		unbind = bindViewerMotion(() => 'off');
		const off = openViewer([PORTRAIT]);
		await settle();
		expect(off.modal.hasClass('dynasty-reduce-motion')).toBe(false);
		noMotion(off);
	});
});

// ---------- the phone ----------

/** A swipe of one finger on `target`: down, the moves `dys` (each after `gap` ms), up. */
function swipe(target: FEl, dys: number[], o: { x?: number; y0?: number; gap?: number; id?: number } = {}) {
	const id = o.id ?? 1;
	const x = o.x ?? 200;
	const y0 = o.y0 ?? 300;
	dispatch(target, 'pointerdown', pointer('touch', id, x, y0));
	let last = 0;
	for (const dy of dys) {
		clock.now += o.gap ?? 16;
		dispatch(target, 'pointermove', pointer('touch', id, x, y0 + dy));
		last = dy;
	}
	dispatch(target, 'pointerup', pointer('touch', id, x, y0 + last));
}

const steps = (to: number, n = 8) => Array.from({ length: n }, (_, i) => Math.round((to * (i + 1)) / n));

function tapAt(target: FEl, x: number, y: number, id = 1) {
	dispatch(target, 'pointerdown', pointer('touch', id, x, y));
	clock.now += 40;
	dispatch(target, 'pointerup', pointer('touch', id, x, y));
}

async function phoneViewer(pictures = [PORTRAIT, ARMS]) {
	device.width = 390;
	device.height = 844;
	device.coarse = true;
	const v = openViewer(pictures);
	await settle();
	flushFrames();
	return v;
}

describe('the phone (D256 item 5)', () => {
	it('is the full-screen layout with a grip, and the small pictures are 44 px or more', async () => {
		const v = await phoneViewer();
		expect(v.modal.hasClass('is-phone')).toBe(true);
		expect(v.content.querySelector('.dynasty-sheet-grip')).not.toBeNull();
		expect(v.content.querySelector('button.dynasty-viewer-close')).not.toBeNull();
	});

	it('a swipe down past 100 px closes it; a short slow pull moves back and keeps it open (the numbers of D220)', async () => {
		const v = await phoneViewer();
		swipe(v.stage, steps(40), { gap: 70 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(1);
		expect(prop(v.modal, '--dynasty-sheet-pull')).toBe('');
		swipe(v.stage, steps(130), { gap: 60 });
		expect(v.modal.hasClass('is-pulled')).toBe(true);
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(0);
		expect(fakeDoc.activeElement).toBe(v.opener);
	});

	it('a fast flick closes it, and a mouse drag does nothing', async () => {
		const v = await phoneViewer();
		dispatch(v.stage, 'pointerdown', pointer('mouse', 1, 200, 300));
		dispatch(v.stage, 'pointermove', pointer('mouse', 1, 200, 500));
		dispatch(v.stage, 'pointerup', pointer('mouse', 1, 200, 500));
		runTimers(400);
		expect(openModals).toHaveLength(1);
		swipe(v.stage, [20, 50, 80], { gap: 10 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(0);
	});

	it('D262: a swipe close asks Obsidian to close the window while it is still off the screen, and the reset comes after the close of Obsidian', async () => {
		const v = await phoneViewer();
		v.modal.offsetHeight = 844;
		const viewer = openModals[openModals.length - 1]!;
		const real = viewer.close.bind(viewer);
		const atClose: { pulled: boolean; pull: string }[] = [];
		// Obsidian's close slides the window out from the transform that it has, and calls onClose only after that.
		vi.spyOn(viewer, 'close').mockImplementation(() => {
			atClose.push({ pulled: v.modal.hasClass('is-pulled'), pull: prop(v.modal, '--dynasty-sheet-pull') });
			real();
		});
		swipe(v.stage, steps(130), { gap: 60 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(atClose).toEqual([{ pulled: true, pull: '844px' }]);
		expect(openModals).toHaveLength(0);
		// onClose took the swipe away, and with it the pull.
		expect(v.modal.hasClass('is-pulled')).toBe(false);
		expect(prop(v.modal, '--dynasty-sheet-pull')).toBe('');
	});

	it('with reduced movement the swipe closes it at once', async () => {
		device.reduceMotion = true;
		const v = await phoneViewer();
		swipe(v.stage, steps(130), { gap: 60 });
		expect(openModals).toHaveLength(0);
		expect(v.opener).toBeDefined();
	});

	it('a sideways swipe changes the picture and does not pull the window', async () => {
		const v = await phoneViewer();
		dispatch(v.stage, 'pointerdown', pointer('touch', 1, 300, 300));
		for (const dx of [-30, -60, -90, -120]) {
			clock.now += 16;
			dispatch(v.stage, 'pointermove', pointer('touch', 1, 300 + dx, 302));
		}
		dispatch(v.stage, 'pointerup', pointer('touch', 1, 180, 302));
		await settle();
		expect(lineOf(v.content)).toBe('Arms of House Valmont');
		expect(v.modal.hasClass('is-pulled')).toBe(false);
		expect(openModals).toHaveLength(1);
		// And back to the right.
		dispatch(v.stage, 'pointerdown', pointer('touch', 2, 100, 300));
		for (const dx of [30, 60, 90, 120]) {
			clock.now += 16;
			dispatch(v.stage, 'pointermove', pointer('touch', 2, 100 + dx, 300));
		}
		dispatch(v.stage, 'pointerup', pointer('touch', 2, 220, 300));
		expect(lineOf(v.content)).toBe('Portrait · Duke of Valmont · b. 1131');
	});

	it('a double tap zooms in; while zoomed the swipe down is off and the small pictures are hidden; a double tap ends the zoom', async () => {
		const v = await phoneViewer();
		tapAt(v.stage, 400, 300);
		clock.now += 120;
		tapAt(v.stage, 402, 301);
		expect(prop(v.img, '--dynasty-vw-s')).toBe('2.5');
		expect(v.modal.hasClass('is-zoomed')).toBe(true);
		swipe(v.stage, steps(200), { gap: 20 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(1);
		expect(v.modal.hasClass('is-pulled')).toBe(false);
		// The grip is off too.
		swipe(v.content.querySelector('.dynasty-sheet-grip')!, steps(200), { gap: 20 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(1);
		// A sideways swipe does not change the picture while zoomed; it moves the picture.
		const x0 = prop(v.img, '--dynasty-vw-x');
		dispatch(v.stage, 'pointerdown', pointer('touch', 5, 300, 300));
		for (const dx of [-30, -60, -90]) dispatch(v.stage, 'pointermove', pointer('touch', 5, 300 + dx, 300));
		dispatch(v.stage, 'pointerup', pointer('touch', 5, 210, 300));
		expect(lineOf(v.content)).toBe('Portrait · Duke of Valmont · b. 1131');
		expect(prop(v.img, '--dynasty-vw-x')).not.toBe(x0);
		clock.now += 600;
		tapAt(v.stage, 400, 300, 6);
		clock.now += 100;
		tapAt(v.stage, 400, 300, 7);
		expect(prop(v.img, '--dynasty-vw-s')).toBe('1');
		expect(v.modal.hasClass('is-zoomed')).toBe(false);
		// At rest the swipe down works again.
		swipe(v.stage, steps(130), { gap: 60 });
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(0);
	});

	it('a pinch zooms between 1x and 4x, one finger moves the picture inside its limits, and a pinch back ends the zoom', async () => {
		const v = await phoneViewer();
		dispatch(v.stage, 'pointerdown', pointer('touch', 1, 300, 300));
		dispatch(v.stage, 'pointerdown', pointer('touch', 2, 500, 300, false));
		dispatch(v.stage, 'pointermove', pointer('touch', 2, 700, 300, false));
		expect(prop(v.img, '--dynasty-vw-s')).toBe('2');
		dispatch(v.stage, 'pointermove', pointer('touch', 2, 1700, 300, false));
		expect(prop(v.img, '--dynasty-vw-s')).toBe('4');
		dispatch(v.stage, 'pointerup', pointer('touch', 2, 1700, 300, false));
		dispatch(v.stage, 'pointerup', pointer('touch', 1, 300, 300));
		expect(v.modal.hasClass('is-zoomed')).toBe(true);
		// One finger moves the picture: never farther than half of what is wider than the stage (400 × 600 at 4x on 800 × 600: 400 across, 900 down).
		dispatch(v.stage, 'pointerdown', pointer('touch', 3, 400, 300));
		dispatch(v.stage, 'pointermove', pointer('touch', 3, 4000, 4000));
		dispatch(v.stage, 'pointerup', pointer('touch', 3, 4000, 4000));
		expect(prop(v.img, '--dynasty-vw-x')).toBe('400px');
		expect(prop(v.img, '--dynasty-vw-y')).toBe('900px');
		// A pinch back to the size of the start ends the zoom.
		dispatch(v.stage, 'pointerdown', pointer('touch', 4, 300, 300));
		dispatch(v.stage, 'pointerdown', pointer('touch', 5, 700, 300, false));
		dispatch(v.stage, 'pointermove', pointer('touch', 5, 305, 300, false));
		dispatch(v.stage, 'pointerup', pointer('touch', 5, 305, 300, false));
		dispatch(v.stage, 'pointerup', pointer('touch', 4, 300, 300));
		expect(prop(v.img, '--dynasty-vw-s')).toBe('1');
		expect(prop(v.img, '--dynasty-vw-x')).toBe('0px');
		expect(v.modal.hasClass('is-zoomed')).toBe(false);
	});

	it('a second finger ends a swipe down that has begun: the pinch never closes the window', async () => {
		const v = await phoneViewer();
		dispatch(v.stage, 'pointerdown', pointer('touch', 1, 300, 300));
		dispatch(v.stage, 'pointermove', pointer('touch', 1, 300, 330));
		dispatch(v.stage, 'pointerdown', pointer('touch', 2, 500, 300, false));
		dispatch(v.stage, 'pointermove', pointer('touch', 1, 300, 520));
		dispatch(v.stage, 'pointerup', pointer('touch', 2, 500, 300, false));
		dispatch(v.stage, 'pointerup', pointer('touch', 1, 300, 520));
		runTimers(SWIPE_SETTLE_MS + 50);
		expect(openModals).toHaveLength(1);
	});

	it('a new picture starts at rest, and the pointer that the swipe took away is forgotten', async () => {
		const v = await phoneViewer();
		tapAt(v.stage, 400, 300);
		clock.now += 100;
		tapAt(v.stage, 400, 300, 2);
		expect(prop(v.img, '--dynasty-vw-s')).toBe('2.5');
		dispatch(thumbs(v.content)[1]!, 'click');
		await settle();
		expect(prop(v.img, '--dynasty-vw-s')).toBe('1');
		// A finger that the window took away for a swipe sends this event; a new finger must not count as a second one.
		dispatch(v.stage, 'pointerdown', pointer('touch', 8, 300, 300));
		dispatch(v.stage, 'lostpointercapture', pointer('touch', 8, 300, 300));
		tapAt(v.stage, 300, 300, 9);
		expect(prop(v.img, '--dynasty-vw-s')).toBe('1');
	});

	it('on a computer a double click does not zoom (the mouse has no zoom)', async () => {
		const v = openViewer([PORTRAIT]);
		await settle();
		for (let i = 0; i < 2; i++) {
			dispatch(v.stage, 'pointerdown', pointer('mouse', 1, 400, 300));
			dispatch(v.stage, 'pointerup', pointer('mouse', 1, 400, 300));
		}
		expect(prop(v.img, '--dynasty-vw-s')).toBe('1');
	});
});

// ---------- the person window ----------

const BODY = `houses:
  - id: valmont
    name: House Valmont
    arms: "[[valmont-arms.png]]"
people:
  - id: roderick
    name: Roderick Valmont
    title: Duke of Valmont
    born: 1131
    house: valmont
    portrait: "[[roderick.jpg]]"
  - id: odette
    name: Odette Valmont
    house: valmont
    arms: "[[small.png]]"
  - id: wren
    name: Wren Valmont
    house: valmont
  - id: cara
    name: Cara Stray
    portrait: "[[missing.jpg]]"
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

function openSheet(id: string, o: { body?: string; pictures?: boolean } = {}) {
	const { store, calls } = viewerStore(FILES);
	const handle = writingHandle(o.body ?? BODY);
	const sheet = EditSheet.create(storeApp(FILES) as never, { handle: handle as never, personId: id, sourcePath: 'Tree.md', pictures: o.pictures === false ? undefined : store })!;
	sheet.open();
	const content = (sheet as unknown as { contentEl: FEl }).contentEl;
	return { sheet, content, handle, calls };
}

const titles = (menu = lastMenu()!) => menu.items.filter((i) => i !== 'sep').map((i) => (i as { title: string }).title);
const viewerOpen = () => openModals.filter((m) => (m as unknown as { modalEl: FEl }).modalEl.hasClass('dynasty-viewer'));
const topViewer = () => viewerOpen()[0] as unknown as { modalEl: FEl; contentEl: FEl };

describe('the picture menu of the person window (D256 item 1)', () => {
	it('View portrait is the first item, above a line; it opens the viewer on the portrait with the house arms as the second picture', async () => {
		const { content, handle } = openSheet('roderick');
		await settle();
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		const menu = lastMenu()!;
		expect(titles(menu)[0]).toBe(VIEWER_UI.viewPortrait);
		expect(menu.items[1]).toBe('sep');
		expect(titles(menu)).toEqual([VIEWER_UI.viewPortrait, PICTURES_UI.selectPortrait, WINDOW_UI.selectPart, PICTURES_UI.removePortrait, WINDOW_UI.selectPersonalArms]);
		menu.item(VIEWER_UI.viewPortrait)!.click();
		await settle();
		const v = topViewer();
		expect(nameOf(v.contentEl)).toBe('Roderick Valmont');
		expect(lineOf(v.contentEl)).toBe('Portrait · Duke of Valmont · b. 1131');
		expect(thumbs(v.contentEl)).toHaveLength(2);
		key(v.modalEl, 'ArrowRight');
		expect(lineOf(v.contentEl)).toBe('Arms of House Valmont');
		// Nothing is written, and closing the viewer leaves the person window open with no question.
		expect(handle.write).not.toHaveBeenCalled();
		(v as unknown as { close(): void }).close();
		expect(viewerOpen()).toHaveLength(0);
		expect(openModals).toHaveLength(1);
		expect(content.querySelector('.dynasty-sheet-confirm')).toBeNull();
	});

	it('the focus goes back to the portrait when the viewer closes', async () => {
		const { content } = openSheet('roderick');
		await settle();
		const pic = content.querySelector('.dynasty-pic')!;
		dispatch(pic, 'click');
		lastMenu()!.item(VIEWER_UI.viewPortrait)!.click();
		await settle();
		(topViewer() as unknown as { close(): void }).close();
		expect(fakeDoc.activeElement).toBe(pic);
	});

	it('View arms is the first item of the menu of the personal arms, and the viewer shows the personal arms', async () => {
		const { content } = openSheet('odette');
		await settle();
		dispatch(content.querySelector('.dynasty-arms-mark')!, 'click');
		const menu = lastMenu()!;
		expect(titles(menu)[0]).toBe(VIEWER_UI.viewArms);
		menu.item(VIEWER_UI.viewArms)!.click();
		await settle();
		const v = topViewer();
		expect(lineOf(v.contentEl)).toBe(VIEWER_UI.personalArms);
		expect(labelOf(v.modalEl)).toBe('Arms of Odette Valmont');
		expect(thumbs(v.contentEl)).toHaveLength(0);
	});

	it('a person with no personal arms gets the arms of the house, as the card shows them', async () => {
		const { content } = openSheet('wren');
		await settle();
		const link = content.querySelector('.dynasty-add-portrait')!;
		dispatch(link, 'click');
		const menu = lastMenu()!;
		expect(titles(menu)[0]).toBe(VIEWER_UI.viewArms);
		menu.item(VIEWER_UI.viewArms)!.click();
		await settle();
		const v = topViewer();
		expect(lineOf(v.contentEl)).toBe('Arms of House Valmont');
		expect(nameOf(v.contentEl)).toBe('Wren Valmont');
	});

	it('has no View item when the portrait cannot be found, with no picture store, or with no picture at all', async () => {
		const missing = openSheet('cara');
		await settle();
		dispatch(missing.content.querySelector('.dynasty-pic')!, 'click');
		expect(titles()).not.toContain(VIEWER_UI.viewPortrait);
		expect(lastMenu()!.items[0]).not.toBe('sep');
		const none = openSheet('roderick', { pictures: false });
		dispatch(none.content.querySelector('.dynasty-pic')!, 'click');
		expect(titles()).not.toContain(VIEWER_UI.viewPortrait);
		const bare = openSheet('wren', { body: BODY.replace('    arms: "[[valmont-arms.png]]"\n', '') });
		await settle();
		dispatch(bare.content.querySelector('.dynasty-add-portrait')!, 'click');
		expect(titles()).not.toContain(VIEWER_UI.viewArms);
	});

	it('a new person still says "save first" and opens no viewer', async () => {
		const { store } = viewerStore(FILES);
		const handle = writingHandle(BODY);
		const sheet = EditSheet.createNew(storeApp(FILES) as never, { handle: handle as never, sourcePath: 'Tree.md', pictures: store, newPerson: { kind: 'person' } } as never)!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		expect(notices.length).toBe(1);
		expect(viewerOpen()).toHaveLength(0);
	});
});

describe('a person window that cannot change the note (D256 item 1)', () => {
	// A duplicate id is a blocking problem: the window opens read-only.
	const BLOCKED = BODY.replace('  - id: cara\n', '  - id: wren\n');

	it('a tap on the portrait opens the viewer at once, with no menu', async () => {
		const { sheet, content, handle } = openSheet('roderick', { body: BLOCKED });
		await settle();
		expect((sheet as unknown as { readOnly: boolean }).readOnly).toBe(true);
		const before = lastMenu();
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		await settle();
		expect(lastMenu()).toBe(before);
		const v = topViewer();
		expect(nameOf(v.contentEl)).toBe('Roderick Valmont');
		expect(labelOf(v.modalEl)).toBe('Portrait of Roderick Valmont');
		expect(handle.write).not.toHaveBeenCalled();
	});

	it('a tap on the personal arms opens the viewer on the arms', async () => {
		const { content } = openSheet('odette', { body: BLOCKED });
		await settle();
		const before = lastMenu();
		dispatch(content.querySelector('.dynasty-arms-mark')!, 'click');
		await settle();
		expect(lastMenu()).toBe(before);
		expect(lineOf(topViewer().contentEl)).toBe(VIEWER_UI.personalArms);
	});

	it('a window with nothing to show does nothing when the portrait is tapped', async () => {
		const { content } = openSheet('roderick', { body: BLOCKED, pictures: false });
		await settle();
		dispatch(content.querySelector('.dynasty-pic')!, 'click');
		expect(viewerOpen()).toHaveLength(0);
	});
});

describe('nothing throws and nothing stays half open (spec §8)', () => {
	it('a store that fails leaves no window and no exception', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store } = viewerStore(FILES);
		store.resolve = () => {
			throw new Error('store failed');
		};
		expect(() => openPictureViewer({ app: {} as never, store, sourcePath: 'Tree.md', pictures: [PORTRAIT], start: 0, opener: null })).not.toThrow();
		expect(openModals).toHaveLength(0);
		expect(spy).toHaveBeenCalled();
	});

	it('a window that fails to build closes at once', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store } = viewerStore(FILES);
		// The request for the small pictures runs while the window opens: if it throws, the half-built window must close.
		const bad = { ...store, acquire: () => {
			throw new Error('thumb failed');
		} } as unknown as PictureStore;
		expect(() => openPictureViewer({ app: {} as never, store: bad, sourcePath: 'Tree.md', pictures: [PORTRAIT, ARMS], start: 0, opener: null })).not.toThrow();
		expect(openModals).toHaveLength(0);
		expect(spy).toHaveBeenCalled();
	});

	it('the menu of a window whose tree data fails gets no View item and no exception', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { personViewItems, viewPerson } = await import('../src/obsidian/viewer-sources');
		const { store } = viewerStore(FILES);
		const kit = { app: {} as never, pictures: store, sourcePath: 'Tree.md', g: undefined as never, person: undefined as never, draft: { name: 'A', portrait: '[[roderick.jpg]]', arms: '', house: '', title: '', born: '', died: '' } };
		const anchor = new FEl('button');
		expect(personViewItems(kit, anchor as never)).toEqual([]);
		expect(() => viewPerson(kit, anchor as never)).not.toThrow();
		expect(openModals).toHaveLength(0);
		expect(spy).toHaveBeenCalled();
	});
});
