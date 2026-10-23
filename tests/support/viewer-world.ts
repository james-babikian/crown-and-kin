/*
 * The fake world that `r033-c1-card-viewer` and `r033-b2c1-g2` share (the picture viewer opened from a card, 0.3.3 C1): three vault pictures, a picture
 * store whose `resolve` is the real one and whose copies are made by the test, a host with that store, and a tree view of one block inside a parent
 * box. Each test file keeps its own sample note and calls `viewIn` with it.
 */

import { TFile as VaultFile } from 'obsidian';
import { TreeView } from '../../src/obsidian/tree-view';
import { createPictureStore, type PictureCopy, type PictureIO, type PictureStore } from '../../src/obsidian/picture-store';
import { FEl, flushFrames, resizeAll, settle } from '../acceptance/fake-dom';
import { openModals } from '../acceptance/fake-obsidian';
import { pngHead } from '../acceptance/m9-support';
import { fakeHandle, fakeHost, type Host } from '../acceptance/tree-view-fakes';

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

/** A vault picture file with a name, a size and a time. */
export function pictureFile(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, name.slice(dot + 1).toLowerCase()), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

export const FILES = [pictureFile('Pictures/ann.jpg'), pictureFile('Pictures/valmont-arms.png'), pictureFile('Pictures/bob-arms.png')];

export const quietIO = (): PictureIO => ({
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
export function store(): PictureStore {
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

/** A view of the block `src` with its box inside `parent` (an embed in another note when `parent` has the class markdown-embed). */
export async function viewIn(host: Host, parent: FEl, handle: ReturnType<typeof fakeHandle> | null, src: string) {
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

export function hostWithPictures(): Host {
	const host = fakeHost();
	(host as { pictures?: PictureStore }).pictures = store();
	return host;
}

export const foreignParent = (cls = 'markdown-embed') => new FEl('div', { cls });
export const viewers = () => openModals.filter((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-viewer'));
export const card = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"]`)! as FEl;
