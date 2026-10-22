import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { TreeView } from '../src/obsidian/tree-view';
import { createPictureStore, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { bindViewerMotion } from '../src/obsidian/picture-viewer';
import { FEl, clock, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { pngHead } from './acceptance/m9-support';
import { desktop, fakeHandle, fakeHost, openFullScreen, phone, type Host } from './acceptance/tree-view-fakes';

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
let unbind: () => void = () => {};
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
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
const SRC = [
	'houses:',
	'  - id: valmont',
	'    name: House Valmont',
	'    color: "#8b1e3f"',
	'    arms: "[[valmont-arms.png]]"',
	'people:',
	'  - {id: ann, name: Ann Valmont, house: valmont, portrait: "[[ann.jpg]]", born: 1100}',
	'  - {id: bob, name: Bob Valmont, house: valmont, parents: [ann], born: 1130}',
	'',
].join('\n');

async function view(host: Host, parent: FEl, handle: ReturnType<typeof fakeHandle> | null, src = SRC) {
	const registry: Record<string, () => unknown> = handle ? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false } : { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	const el = new FEl('div');
	parent.appendChild(el);
	const info = { lineStart: 0, lineEnd: src.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => {} };
	const v = new TreeView(host as never, el as never, src, { kind: 'embed', ctx } as never);
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
const viewers = () => openModals.filter((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-viewer'));
const card = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"]`)! as FEl;
const foreignParent = (cls = 'markdown-embed') => new FEl('div', { cls });

/*
 * G2 review of r033/b2-c1 (aa892f7f). Each `it` marked (Fn) proves a finding that the fix round closed; the others are controls.
 */

describe('C1: a view that the plugin retired (plugin turned off) keeps no card action', () => {
	it('(F1): after retire(), a click on a card of an editable embed opens no viewer and no window', async () => {
		desktop();
		const { el, v } = await view(hostWithPictures(), new FEl('div'), fakeHandle('n.md', SRC));
		const c = card(el, 'ann');
		v.retire();
		dispatch(c, 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(0);
	});

	it('(F1): after retire(), a click on a card of a tree in an embed opens no viewer', async () => {
		desktop();
		const { el, v } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		const c = card(el, 'ann');
		v.retire();
		dispatch(c, 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(0);
	});

	it('control: before retire(), the same click opens the viewer in the embed', async () => {
		desktop();
		const { el } = await view(hostWithPictures(), foreignParent(), fakeHandle('n.md', SRC));
		dispatch(card(el, 'ann'), 'click', { button: 0, clientX: -10, clientY: -10 });
		await settle();
		expect(viewers()).toHaveLength(1);
	});
});

const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

describe('B2: the Focus button in the bar of a very large tree', () => {
	async function largeFull() {
		phone();
		const o = await openFullScreen(flat(1501), { host: fakeHost() });
		return o.root as FEl;
	}

	it('(F2): Enter on Focus with a focus on clears it and the keyboard focus is on the new Focus button', async () => {
		const root = await largeFull();
		dispatch(root.querySelector('.dynasty-focus')!, 'click', { button: 0, clientX: 0, clientY: 0, detail: 0 });
		await settle();
		resizeAll();
		flushFrames();
		expect(root.querySelector('.dynasty-large-bar')).not.toBeNull();
		expect(fakeDoc.activeElement).toBe(root.querySelector('.dynasty-focus'));
	});

	it('(F3): the Focus button in that bar has no aria-pressed (D263 B2 removed it from every other Focus button)', async () => {
		const root = await largeFull();
		dispatch(root.querySelector('.dynasty-focus')!, 'click', { button: 0, clientX: 0, clientY: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
		expect(root.querySelector('.dynasty-large-bar')).not.toBeNull();
		expect(root.querySelector('.dynasty-focus')!.getAttribute('aria-pressed')).toBeNull();
	});

	it('control: the Focus button of a drawn tree has no aria-pressed, with or without a focus', async () => {
		phone();
		const o = await openFullScreen(flat(20), { host: fakeHost() });
		expect((o.root as FEl).querySelector('.dynasty-focus')!.getAttribute('aria-pressed')).toBeNull();
	});
});
