import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { TreeView } from '../src/obsidian/tree-view';
import { createPictureStore, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { bindViewerMotion } from '../src/obsidian/picture-viewer';
import { VIEWER_UI } from '../src/render/viewer-text';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, pointer, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { pngHead } from './acceptance/m9-support';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, sheets, type Host } from './acceptance/tree-view-fakes';

/*
 * 0.3.3 C1 (D269, completes D256 item 1): a tap or click on a card of a tree that cannot change the note (an embed in another note, a Canvas card, a hover
 * preview, a full-screen view with no block handle) opens the picture viewer at once when the person has a portrait or arms (the personal arms, else the arms of
 * the house). A card with no picture does nothing. An editable tree still opens the person window.
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
	vi.restoreAllMocks();
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1).toLowerCase()), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const FILES = [file('Pictures/ann.jpg'), file('Pictures/valmont-arms.png'), file('Pictures/bob-arms.png')];

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

/** The real `resolve` of the store over a few files, with copies made by the test. */
function store(): PictureStore {
	const app = {
		metadataCache: { getFirstLinkpathDest: (path: string) => FILES.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => FILES.find((f) => f.path === p) ?? null, getFiles: () => FILES },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	const real = createPictureStore(app as never, quietIO());
	let n = 0;
	const copy = (kind: string): PictureCopy => ({ url: `blob:${kind}-${n++}`, w: 400, h: 600, release: () => {} });
	return { ...real, transient: async () => copy('large'), acquire: async () => copy('thumb') };
}

// Ann has a portrait and her house has arms. Bob has the house arms only. Bea has personal arms and the house. Cyd has no picture. Dee has a portrait that is not in the vault.
const SRC = [
	'houses:',
	'  - id: valmont',
	'    name: House Valmont',
	'    color: "#8b1e3f"',
	'    arms: "[[valmont-arms.png]]"',
	'people:',
	'  - {id: ann, name: Ann Valmont, house: valmont, portrait: "[[ann.jpg]]", born: 1100}',
	'  - {id: bob, name: Bob Valmont, house: valmont, parents: [ann], born: 1130}',
	'  - {id: bea, name: Bea Valmont, house: valmont, parents: [ann], arms: "[[bob-arms.png]]", born: 1132}',
	'  - {id: cyd, name: Cyd Other, parents: [ann], born: 1134}',
	'  - {id: dee, name: Dee Other, parents: [ann], portrait: "[[gone.jpg]]", born: 1136}',
	'',
].join('\n');

/** A view of the block with its box inside `parent` (an embed in another note when `parent` has the class markdown-embed). */
async function view(host: Host, parent: FEl, handle: ReturnType<typeof fakeHandle> | null) {
	const registry: Record<string, () => unknown> = handle ? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false } : { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	const el = new FEl('div');
	parent.appendChild(el);
	const info = { lineStart: 0, lineEnd: SRC.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => {} };
	const v = new TreeView(host as never, el as never, SRC, { kind: 'embed', ctx } as never);
	v.load();
	await settle();
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 600;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
	return { el, v };
}

function hostWithPictures(): Host {
	const host = fakeHost();
	(host as { pictures?: PictureStore }).pictures = store();
	return host;
}

const foreignParent = (cls = 'markdown-embed') => new FEl('div', { cls });
const viewers = () => openModals.filter((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-viewer'));
const card = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"]`)!;
// The press is at a point outside every box of the fake DOM (they all start at 0, 0), so only the target of the press says which picture was pressed.
const mouseTap = (target: FEl) => {
	dispatch(target, 'pointerdown', pointer('mouse', 1, -10, -10));
	dispatch(target, 'pointerup', pointer('mouse', 1, -10, -10));
	dispatch(target, 'click', { button: 0, clientX: -10, clientY: -10 });
};
const touchTap = (target: FEl) => {
	dispatch(target, 'pointerdown', pointer('touch', 5, 300, 200));
	dispatch(target, 'pointerup', pointer('touch', 5, 300, 200));
};
const contentOf = (m: unknown) => (m as { contentEl: FEl }).contentEl;
const thumbs = (m: unknown) => contentOf(m).querySelectorAll('button.dynasty-viewer-thumb');

describe('a tree shown from another note (D269)', () => {
	it('a click on a card with a portrait opens the viewer at once, with the portrait and the arms of the house as the two small pictures', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'ann') as FEl);
		await settle();
		expect(viewers()).toHaveLength(1);
		expect(sheets()).toHaveLength(0);
		const c = contentOf(viewers()[0]);
		expect(c.querySelector('.dynasty-viewer-name')!.getText()).toBe('Ann Valmont');
		expect(thumbs(viewers()[0]).map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])).toEqual([
			[VIEWER_UI.showPortrait, 'true'],
			[VIEWER_UI.showArms, 'false'],
		]);
	});

	it('a person with only the arms of the house opens on those arms, with one picture', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'bob') as FEl);
		await settle();
		expect(viewers()).toHaveLength(1);
		expect(thumbs(viewers()[0])).toHaveLength(0);
		expect(contentOf(viewers()[0]).querySelector('.dynasty-viewer-line')!.getText()).toBe(VIEWER_UI.armsOf('House Valmont'));
	});

	it('personal arms come before the arms of the house', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'bea') as FEl);
		await settle();
		expect(viewers()).toHaveLength(1);
		expect(contentOf(viewers()[0]).querySelector('.dynasty-viewer-line')!.getText()).toBe(VIEWER_UI.personalArms);
	});

	it('a click on the arms of the card starts on the arms; a click elsewhere on the card starts on the portrait', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		const arms = new FEl('g', { cls: 'dynasty-arms' });
		card(el, 'ann').appendChild(arms);
		mouseTap(arms);
		await settle();
		expect(thumbs(viewers()[0]).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
	});

	it('the pictures take no pointer events, so a press whose place is inside the arms of the card also starts on the arms', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		const c = card(el, 'ann') as FEl;
		const arms = new FEl('g', { cls: 'dynasty-arms' });
		arms.clientWidth = 40;
		arms.clientHeight = 40;
		c.appendChild(arms);
		dispatch(c, 'click', { button: 0, clientX: 10, clientY: 10 });
		await settle();
		expect(thumbs(viewers()[0]).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
	});

	it('a card with no picture, and a card whose picture is not in the vault, do nothing', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'cyd') as FEl);
		mouseTap(card(el, 'dee') as FEl);
		await settle();
		expect(viewers()).toHaveLength(0);
		expect(sheets()).toHaveLength(0);
	});

	it('Enter on a focused card does the same', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		dispatch(card(el, 'ann'), 'keydown', { key: 'Enter' });
		await settle();
		expect(viewers()).toHaveLength(1);
		dispatch(card(el, 'cyd'), 'keydown', { key: 'Enter' });
		await settle();
		expect(viewers()).toHaveLength(1);
	});

	it('a touch tap opens one viewer, not two (the click after the tap is ignored)', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		const c = card(el, 'ann') as FEl;
		touchTap(c);
		dispatch(c, 'click', { button: 0, clientX: 300, clientY: 200 });
		await settle();
		expect(viewers()).toHaveLength(1);
	});

	it('a Canvas card and a hover preview work the same', async () => {
		for (const cls of ['canvas-node', 'hover-popover']) {
			resetDom();
			resetObsidian();
			desktop();
			const { el } = await view(hostWithPictures(), foreignParent(cls), null);
			mouseTap(card(el, 'bob') as FEl);
			await settle();
			expect(viewers(), cls).toHaveLength(1);
		}
	});

	it('without a picture store, nothing opens and nothing throws', async () => {
		desktop();
		const { el } = await view(fakeHost(), foreignParent(), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'ann') as FEl);
		await settle();
		expect(viewers()).toHaveLength(0);
	});

	it('a read-only full-screen view (no block handle, a phone) opens the viewer on a card tap too', async () => {
		phone();
		const { root } = await openFullScreen(SRC, { readOnly: true, host: hostWithPictures() });
		mouseTap(card(root, 'ann') as FEl);
		await settle();
		expect(viewers()).toHaveLength(1);
		expect(sheets()).toHaveLength(0);
	});
});

describe('a tree that can change the note keeps its tap (D269)', () => {
	it('a click on a card opens the person window, and no viewer', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), new FEl('div'), fakeHandle('n.md', SRC));
		mouseTap(card(el, 'ann') as FEl);
		await settle();
		expect(sheets()).toHaveLength(1);
		expect(viewers()).toHaveLength(0);
	});
});
