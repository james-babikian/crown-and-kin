import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { bindViewerMotion, openPictureViewer, type ViewerPicture } from '../../src/obsidian/picture-viewer';
import { createPictureStore, type PictureIO } from '../../src/obsidian/picture-store';
import { VIEWER_UI } from '../../src/render/viewer-text';
import { FEl, clock, device, dispatch, fakeWin, flushFrames, pointer, resetDom, settle, windowListenerCount } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

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
const FILES = [file('P/a.jpg'), file('P/b.png')];
const appOf = () => ({
	metadataCache: { getFirstLinkpathDest: (p: string) => FILES.find((f) => f.path.endsWith(p)) ?? null },
	vault: { getAbstractFileByPath: () => null, getFiles: () => FILES },
	fileManager: { generateMarkdownLink: () => '' },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
});

const A: ViewerPicture = { kind: 'portrait', link: '[[a.jpg]]', heading: 'A', line: 'l', label: 'Portrait of A', show: VIEWER_UI.showPortrait };
const B: ViewerPicture = { kind: 'arms', link: '[[b.png]]', heading: 'A', line: 'l', label: 'Arms of A', show: VIEWER_UI.showArms };

/** The real store with counted object URLs. */
function realStore(o: { w: number; h: number; encode?: () => Promise<Blob>; gate?: Promise<void> }) {
	const live = new Set<string>();
	let n = 0;
	vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
		const u = `blob:t${n++}`;
		live.add(u);
		return u;
	});
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void live.delete(u));
	const io: PictureIO = {
		read: async () => {
			const b = pngHead(o.w, o.h);
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		decode: async () => ({ width: o.w, height: o.h, source: {} as CanvasImageSource, close() {} }),
		encode: async () => {
			if (o.gate) await o.gate;
			if (o.encode) return o.encode();
			return new Blob([new Uint8Array(10)], { type: 'image/png' });
		},
		rgba: async (_s, w, h) => new Uint8ClampedArray(w * h * 4),
		coarse: () => false,
		dpr: () => (fakeWin as unknown as { devicePixelRatio?: number }).devicePixelRatio ?? 1,
	};
	return { store: createPictureStore(appOf() as never, io), live };
}

function open(store: ReturnType<typeof realStore>['store'], pics: ViewerPicture[], start = 0) {
	const opener = new FEl('button');
	openPictureViewer({ app: {} as never, store, sourcePath: 'T.md', pictures: pics, start, opener: opener as never });
	const v = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl; close(): void };
	return { v, img: v.contentEl.querySelector('.dynasty-viewer-img')!, stage: v.contentEl.querySelector('.dynasty-viewer-stage')! };
}
const prop = (el: FEl, name: string) => el.style.getPropertyValue(name);

describe('review: copies and listeners (all hold)', () => {
	it('normal open/close leaves no transient URL and no window listener', async () => {
		const base = windowListenerCount();
		const { store, live } = realStore({ w: 400, h: 600 });
		const { v } = open(store, [A, B]);
		await settle();
		await settle();
		v.close();
		store.clear();
		expect([...live]).toEqual([]);
		expect(windowListenerCount()).toBe(base);
	});

	it('close in the middle of the load leaves no URL', async () => {
		let go!: () => void;
		const gate = new Promise<void>((r) => (go = r));
		const { store, live } = realStore({ w: 400, h: 600, gate });
		const { v } = open(store, [A, B]);
		await settle();
		v.close();
		go();
		await settle();
		await settle();
		store.clear();
		expect([...live]).toEqual([]);
	});

	it('quick change of picture then close leaves no URL', async () => {
		let go!: () => void;
		const gate = new Promise<void>((r) => (go = r));
		const { store, live } = realStore({ w: 400, h: 600, gate });
		const { v } = open(store, [A, B]);
		await settle();
		const k = (key: string) => dispatch(v.modalEl, 'keydown', { key, shiftKey: false });
		k('ArrowRight');
		k('ArrowLeft');
		k('ArrowRight');
		go();
		await settle();
		await settle();
		v.close();
		store.clear();
		expect([...live]).toEqual([]);
	});

	it('a failing encode shows the problem text and leaves no URL', async () => {
		const { store, live } = realStore({
			w: 400,
			h: 600,
			encode: async () => {
				throw new Error('boom');
			},
		});
		const { v } = open(store, [A]);
		await settle();
		await settle();
		expect(v.contentEl.querySelector('.dynasty-viewer-status')!.getText()).toBe(VIEWER_UI.problem);
		v.close();
		store.clear();
		expect([...live]).toEqual([]);
	});
});

describe('review: sharpness on a screen with a pixel ratio above 1', () => {
	it('a 128 px picture on a pixel ratio 3 screen shows at 2x its pixels at most, counted in CSS px', async () => {
		(fakeWin as Record<string, unknown>).devicePixelRatio = 3;
		const { store } = realStore({ w: 128, h: 192 });
		const { img } = open(store, [A]);
		await settle();
		await settle();
		const w = Number.parseFloat(prop(img, '--dynasty-vw-w'));
		// ruling WP-5 fix: 2x in CSS px
		// The limit stays in CSS px, as in the spec: on a screen with ratio 3 the 256 CSS px still use 768 device px, which is the sharp case the screen allows.
		expect(w).toBeLessThanOrEqual(2 * 128);
	});
});

describe('review: a picture that is still on its way cannot be zoomed', () => {
	/** A phone viewer on two pictures; the second one is held back until `release()`. */
	async function held() {
		device.width = 390;
		device.height = 844;
		device.coarse = true;
		let hold = false;
		let release!: () => void;
		const { store } = realStore({
			w: 400,
			h: 600,
			encode: () => (hold ? new Promise<Blob>((r) => (release = () => r(new Blob([new Uint8Array(10)])))) : Promise.resolve(new Blob([new Uint8Array(10)]))),
		});
		const { v, stage, img } = open(store, [A, B]);
		await settle();
		await settle();
		flushFrames();
		hold = true;
		dispatch(v.modalEl, 'keydown', { key: 'ArrowRight', shiftKey: false });
		await settle();
		expect(v.contentEl.querySelector('.dynasty-viewer-status')!.getText()).toBe(VIEWER_UI.loading);
		return { v, stage, img, release: () => release() };
	}
	const doubleTap = (stage: FEl) => {
		for (const id of [1, 2]) {
			dispatch(stage, 'pointerdown', pointer('touch', id, 300, 300));
			clock.now += 40;
			dispatch(stage, 'pointerup', pointer('touch', id, 300, 300));
			clock.now += 100;
		}
	};

	it('a double tap on the loading text does not zoom (it hides the small pictures and switches the swipe down off)', async () => {
		const { v, stage } = await held();
		doubleTap(stage);
		expect(v.modalEl.hasClass('is-zoomed')).toBe(false);
	});

	it('the picture that arrives later shows at rest, not at the zoom of the empty stage', async () => {
		const { stage, img, release } = await held();
		doubleTap(stage);
		release();
		await settle();
		await settle();
		expect(stage.hasClass('has-picture')).toBe(true);
		expect(prop(img, '--dynasty-vw-s')).toBe('1');
	});
});

describe('review: the key of the store does not hold noEnlarge', () => {
	it('acquire with noEnlarge must not hand its small copy to a later acquire of the same box', async () => {
		const { store } = realStore({ w: 100, h: 100 });
		const f = FILES[0]!;
		const a = await store.acquire(f, { w: 500, h: 500, fit: 'meet', noEnlarge: true });
		const b = await store.acquire(f, { w: 500, h: 500, fit: 'meet' });
		// ruling WP-5 fix: `acquire` ignores `noEnlarge` (only `transient` honours it), so both copies have the one size of the key.
		expect((a as { w: number }).w).toBe(500);
		expect((b as { w: number }).w).toBe(500);
	});
});

describe('WP-5 fix: the viewer lives with the properties that Obsidian gives a Modal', () => {
	it('opens, builds the picture and uses the window of the modal, though win and doc are instance properties', async () => {
		const { store } = realStore({ w: 400, h: 600 });
		const { v, img } = open(store, [A, B]);
		const m = v as unknown as { win: unknown; doc: unknown };
		expect(m.win).toBe(fakeWin);
		expect(m.doc).toBeDefined();
		await settle();
		await settle();
		expect(v.contentEl.querySelector('.dynasty-viewer-status')!.hasClass('is-hidden')).toBe(true);
		expect(prop(img, '--dynasty-vw-w')).not.toBe('');
	});

	it('a nameless person gets the words "this person" in the labels', () => {
		expect(VIEWER_UI.portraitOf(VIEWER_UI.thisPerson)).toBe('Portrait of this person');
		expect(VIEWER_UI.problem).toBe('The plugin cannot show this picture. Close the window and try again.');
	});
});
