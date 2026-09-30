import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow, houseOps, loadHouses, rowsOf } from '../src/obsidian/houses-window';
import { matchPictures, pickPicture, pictureLink, safePictureName, vaultPictures } from '../src/obsidian/picture-picker';
import { HEADER_STORE_KEY, NO_READ_BYTES, NO_READ_BYTES_COARSE, createPictureStore, type CopyBox, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { LinkUpdater, renameKind } from '../src/obsidian/rename-links';
import { DEFAULT_SETTINGS, normaliseSettings } from '../src/obsidian/settings';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { PICTURES_UI, RENAME_UI, deviceNotice, renamedText } from '../src/render/ui-text';
import { FEl, dispatch, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { isoFile, pngHead } from './acceptance/m9-support';
import { pickerRowFor } from './acceptance/m11-support';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * WP 9.3a (M9 contract O1, O3, O4, O6–O10, B1, B2, B8, B10–B16): the picture store beyond the
 * acceptance checks (generations, invalidate, transient copies, shared reads, the header results
 * kept across sessions, the size limit without a read, the queue held alone by a saved picture),
 * the picture picker, arms and colours in the Houses window, the portrait in the edit sheet, picture
 * renames and the "Show portraits on cards" setting.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

/** A vault file as the store sees it. */
function file(path: string, size = 1000, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime, ctime: 1, size } }) as VaultFile;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function until(done: () => boolean, what: string): Promise<void> {
	for (let k = 0; k < 200; k++) {
		if (done()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** The browser seam with counters (as in the acceptance test m9-store). */
function fakeIO(bytesOf: Map<string, Uint8Array>, o: { coarse?: boolean; hold?: boolean; blobBytes?: number; holdRead?: boolean } = {}) {
	const state = { reads: 0, decodes: 0, open: 0, maxOpen: 0, encodes: 0, rgba: 0, release: [] as (() => void)[], readRelease: [] as (() => void)[] };
	const io: PictureIO = {
		async read(f) {
			state.reads++;
			if (o.holdRead) await new Promise<void>((r) => state.readRelease.push(r));
			const b = bytesOf.get(f.path) ?? new Uint8Array();
			return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
		},
		async decode() {
			state.decodes++;
			if (o.hold) await new Promise<void>((r) => state.release.push(r));
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
				},
			};
		},
		async encode() {
			state.encodes++;
			return new Blob([new Uint8Array(o.blobBytes ?? 5000)], { type: 'image/png' });
		},
		async rgba(_s, w, h) {
			state.rgba++;
			const px = new Uint8ClampedArray(w * h * 4);
			for (let i = 0; i < px.length; i += 4) px.set([200, 16, 46, 255], i);
			return px;
		},
		coarse: () => !!o.coarse,
		dpr: () => 2,
	};
	return { io, state };
}

/** An app whose links find the files by path or path end; local storage in a map. */
function storeApp(files: VaultFile[], local = new Map<string, unknown>()) {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: (k: string) => local.get(k) ?? null,
		saveLocalStorage: (k: string, v: unknown) => void local.set(k, JSON.parse(JSON.stringify(v))),
		local,
	};
}

const BOX: CopyBox = { w: 24, h: 24, fit: 'portrait' };
const isCopy = (x: unknown): x is PictureCopy => !!x && typeof x === 'object' && 'url' in x;

describe('the picture store (O3, O4, B11–B15)', () => {
	it('B11: invalidate during a decode: the request gives null and nothing is kept; the bitmap is closed', async () => {
		const f = file('a.png');
		const { io, state } = fakeIO(new Map([['a.png', pngHead(400, 600)]]), { hold: true });
		const store = createPictureStore(storeApp([f]) as never, io);
		const p = store.acquire(f, BOX);
		await until(() => state.release.length > 0, 'the decode');
		store.invalidate('a.png');
		state.release.shift()!();
		expect(await p).toBeNull();
		expect(state.open).toBe(0);
		expect(store.stats.entries).toBe(0);
		expect(store.stats.bytes).toBe(0);
	});

	it('invalidate: a copy no one uses goes (its URL is revoked); a copy in use stays until its release; peek finds neither', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const a = file('a.png');
		const b = file('b.png');
		const { io } = fakeIO(new Map([['a.png', pngHead(400, 600)], ['b.png', pngHead(400, 600)]]));
		const store = createPictureStore(storeApp([a, b]) as never, io);
		const ca = (await store.acquire(a, BOX)) as PictureCopy;
		const cb = (await store.acquire(b, BOX)) as PictureCopy;
		cb.release();
		expect(store.stats.entries).toBe(2);
		store.invalidate('b.png');
		expect(revoke).toHaveBeenCalledWith(cb.url);
		store.invalidate('a.png');
		expect(revoke).not.toHaveBeenCalledWith(ca.url);
		expect(store.peek(a, BOX)).toBeNull();
		expect(store.stats.inUse).toBe(1);
		ca.release();
		ca.release();
		expect(revoke).toHaveBeenCalledWith(ca.url);
		expect(store.stats).toMatchObject({ bytes: 0, entries: 0, inUse: 0 });
		// A new request makes a new copy.
		expect(isCopy(await store.acquire(a, BOX))).toBe(true);
	});

	it('a transient copy is not kept; its release revokes the URL once', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const f = file('a.png');
		const { io } = fakeIO(new Map([['a.png', pngHead(400, 600)]]));
		const store = createPictureStore(storeApp([f]) as never, io);
		const c = (await store.transient(f, { w: 96, h: 96, fit: 'portrait' })) as PictureCopy;
		expect(isCopy(c)).toBe(true);
		expect(store.stats).toMatchObject({ bytes: 0, entries: 0, inUse: 0, openBitmaps: 0 });
		c.release();
		c.release();
		expect(revoke.mock.calls.filter((x) => x[0] === c.url)).toHaveLength(1);
	});

	it('copies are box × min(max(dpr, 1), 3): two boxes are two copies; the same box is one', async () => {
		const f = file('a.png');
		const { io, state } = fakeIO(new Map([['a.png', pngHead(400, 600)]]));
		const store = createPictureStore(storeApp([f]) as never, io);
		const one = (await store.acquire(f, { w: 20, h: 24, fit: 'meet' })) as PictureCopy;
		// dpr 2: the arms fit into 40 × 48 px with their own proportions (400 × 600 → 32 × 48).
		expect([one.w, one.h]).toEqual([32, 48]);
		await store.acquire(f, { w: 20, h: 24, fit: 'meet' });
		await store.acquire(f, { w: 40, h: 48, fit: 'meet' });
		expect(state.decodes).toBe(2);
		expect(store.stats.entries).toBe(2);
	});

	it('B14: a check and a copy of the same file share one read; the check result comes from those bytes', async () => {
		const f = file('photo.jpg');
		const { io, state } = fakeIO(new Map([['photo.jpg', isoFile('heic', ['mif1', 'heic'], [[4032, 3024]])]]), { holdRead: true });
		const store = createPictureStore(storeApp([f]) as never, io);
		const copy = store.acquire(f, BOX);
		await until(() => state.readRelease.length > 0, 'the read');
		const check = store.check(f);
		state.readRelease.shift()!();
		const want = { ok: false, code: 'picture-not-image', file: 'photo.jpg', format: 'HEIC' };
		expect(await copy).toEqual(want);
		expect(await check).toEqual(want);
		expect(state.reads).toBe(1);
		expect(state.decodes).toBe(0);
	});

	it('B14: header results are kept across sessions by path, time and size (at most 2000); a changed file is read again', async () => {
		const local = new Map<string, unknown>();
		const f = file('huge.png');
		const bytes = new Map([['huge.png', pngHead(9000, 6000)]]);
		const one = fakeIO(bytes);
		const first = createPictureStore(storeApp([f], local) as never, one.io);
		expect(await first.check(f)).toMatchObject({ code: 'picture-too-large', pixels: 54 });
		runTimers(2000);
		expect(local.has(HEADER_STORE_KEY)).toBe(true);
		const two = fakeIO(bytes);
		const second = createPictureStore(storeApp([f], local) as never, two.io);
		expect(await second.check(f)).toMatchObject({ code: 'picture-too-large', pixels: 54 });
		expect(two.state.reads).toBe(0);
		const changed = file('huge.png', 1000, 2);
		expect(await second.check(changed)).toMatchObject({ code: 'picture-too-large' });
		expect(two.state.reads).toBe(1);
	});

	it('A6: a file over 256 MB on disk (64 MB with a coarse pointer) is too large without a read, and without a number', async () => {
		const big = file('big.png', NO_READ_BYTES + 1);
		const mid = file('mid.png', NO_READ_BYTES_COARSE + 1);
		for (const coarse of [false, true]) {
			const { io, state } = fakeIO(new Map(), { coarse });
			const store = createPictureStore(storeApp([big, mid]) as never, io);
			expect(await store.check(big)).toEqual({ ok: false, code: 'picture-too-large', file: 'big.png' });
			expect(await store.acquire(big, BOX)).toEqual({ ok: false, code: 'picture-too-large', file: 'big.png' });
			if (coarse) expect(await store.check(mid)).toEqual({ ok: false, code: 'picture-too-large', file: 'mid.png' });
			expect(state.reads).toBe(0);
		}
	});

	it('O4, B13: a saved picture waits for the running decodes and then holds the queue alone', async () => {
		const a = file('a.png');
		const b = file('b.png');
		const c = file('c.png');
		const { io, state } = fakeIO(new Map(['a.png', 'b.png', 'c.png'].map((n) => [n, pngHead(400, 600)])), { hold: true });
		const store = createPictureStore(storeApp([a, b, c]) as never, io);
		const first = store.acquire(a, BOX);
		await until(() => state.release.length === 1, 'the first decode');
		const saved = store.exportCopy(b, { w: 64, h: 64, fit: 'meet' });
		const later = store.acquire(c, BOX);
		await tick();
		// Not coarse, so a second copy could run now; the saved picture waits, and so does the copy behind it.
		expect(state.decodes).toBe(1);
		state.release.shift()!();
		await first;
		await until(() => state.release.length === 1, 'the saved picture decode');
		expect(state.decodes).toBe(2);
		state.release.shift()!();
		expect(await saved).toMatch(/^data:image\/png;base64,/);
		await until(() => state.release.length === 1, 'the last decode');
		state.release.shift()!();
		expect(isCopy(await later)).toBe(true);
		expect(state.maxOpen).toBe(1);
	});

	it('pixels: the 64 × 64 RGBA of the arms, the bitmap closed; null for a picture with a problem', async () => {
		const f = file('arms.png');
		const bad = file('arms.heic');
		const { io, state } = fakeIO(new Map([['arms.png', pngHead(400, 600)], ['arms.heic', isoFile('heic', ['mif1', 'heic'], [[40, 30]])]]));
		const store = createPictureStore(storeApp([f, bad]) as never, io);
		const px = await store.pixels(f);
		expect(px?.length).toBe(64 * 64 * 4);
		expect(state.open).toBe(0);
		expect(await store.pixels(bad)).toBeNull();
	});

	it('clear: every URL is revoked; nothing more is made; onChange hears `changed` until then', async () => {
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		const f = file('a.png');
		const { io } = fakeIO(new Map([['a.png', pngHead(400, 600)]]));
		const store = createPictureStore(storeApp([f]) as never, io);
		const heard: string[][] = [];
		const stop = store.onChange((p) => heard.push([...p]));
		store.changed(['a.png']);
		stop();
		store.changed(['b.png']);
		expect(heard).toEqual([['a.png']]);
		const c = (await store.acquire(f, BOX)) as PictureCopy;
		store.clear();
		expect(revoke).toHaveBeenCalledWith(c.url);
		expect(await store.acquire(f, BOX)).toBeNull();
		expect(store.stats.entries).toBe(0);
	});
});

describe('the picture picker (O6, B2)', () => {
	const pics = [file('Pictures/valmont-arms.png'), file('orsini.svg'), file('Notes/a.md'), file('Pictures/x.heic'), file('Pictures/aldric.jpg')];

	it('lists the pictures the plugin can show, by name; the search needs every word; the link has no "!"', () => {
		const app = storeApp(pics);
		expect(vaultPictures(app as never).map((f) => f.path)).toEqual(['Pictures/aldric.jpg', 'orsini.svg', 'Pictures/valmont-arms.png']);
		expect(matchPictures(vaultPictures(app as never), 'pict ARMS').map((f) => f.path)).toEqual(['Pictures/valmont-arms.png']);
		expect(pictureLink(app as never, pics[0], 'Tree.md')).toBe('[[valmont-arms.png]]');
	});

	it('file names from a device: unsafe characters go; a name with no picture extension gets the one of its bytes', () => {
		expect(safePictureName('IMG_0001.JPG', 'jpeg')).toBe('IMG_0001.JPG');
		expect(safePictureName('image', 'jpeg')).toBe('image.jpg');
		expect(safePictureName('a/b:c#d.png', 'png')).toBe('a-b-c-d.png');
		expect(safePictureName('', 'webp')).toBe('picture.webp');
	});

	it('B2: the device Notices name the format, or the pixels', () => {
		expect(deviceNotice({ ok: false, code: 'picture-not-image', file: 'x.heic', format: 'HEIC' })).toBe('The plugin cannot show this HEIC picture. Save the picture as PNG or JPEG. Then select it again.');
		expect(deviceNotice({ ok: false, code: 'picture-not-image', file: 'x.pdf' })).toBe('This file is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.');
		expect(deviceNotice({ ok: false, code: 'picture-too-large', file: 'x.png', pixels: 54 })).toBe('This picture is too large (54 million pixels). Use a picture with 40 million pixels or less.');
		expect(deviceNotice({ ok: false, code: 'picture-too-large', file: 'x.png' })).toBe('This picture is too large. Use a picture with 40 million pixels or less.');
	});

	const pickerOf = () => openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl; close(): void; fromDevice(f: unknown): Promise<void> };
	const rowsIn = (m: { contentEl: FEl }) => m.contentEl.querySelectorAll('[role="treeitem"], [role="option"]');
	const rowName = (r: FEl) => r.attrs.has('aria-expanded') ? r.getAttribute('aria-label')! : (r.querySelector('.dynasty-picture-name')?.getText() ?? r.getText());

	// M11 (D92, D93): the list is a folder view. It has no selected row and no large preview at open, the folder
	// "Pictures" is closed, and a first tap on a picture selects it (the details are in tests/m11-picker-view.test.ts).
	it('the first row adds a picture from the device; the folders are closed at open; a first tap on a picture selects it, a second tap chooses it', async () => {
		const app = storeApp(pics);
		const { io } = fakeIO(new Map([['Pictures/aldric.jpg', pngHead(400, 600)]]));
		const store = createPictureStore(app as never, io);
		const got = pickPicture(app as never, { sourcePath: 'Tree.md', store, title: 'Select a portrait for Aldric' });
		const m = pickerOf();
		expect(rowsIn(m).map(rowName)).toEqual([PICTURES_UI.fromDevice, 'Open the folder Pictures', 'orsini.svg']);
		expect(rowsIn(m).filter((r) => r.getAttribute('aria-selected') === 'true')).toEqual([]);
		await settle();
		expect(m.contentEl.querySelector('.dynasty-picture-preview-img')).toBeNull();
		dispatch(rowsIn(m)[1], 'click');
		expect(rowsIn(m).map(rowName)).toEqual([PICTURES_UI.fromDevice, 'Close the folder Pictures', 'aldric.jpg', 'valmont-arms.png', 'orsini.svg']);
		const target = pickerRowFor(m.contentEl, 'Pictures/valmont-arms.png');
		dispatch(target, 'click');
		expect(pickerRowFor(m.contentEl, 'Pictures/valmont-arms.png').getAttribute('aria-selected')).toBe('true');
		dispatch(pickerRowFor(m.contentEl, 'Pictures/valmont-arms.png'), 'click');
		expect(await got).toBe('[[valmont-arms.png]]');
		expect(openModals).toHaveLength(0);
	});

	it('Cancel gives null', async () => {
		const got = pickPicture(storeApp(pics) as never, { sourcePath: 'Tree.md', title: 'x' });
		dispatch(pickerOf().contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(await got).toBeNull();
	});

	it('D69, B2: a device picture is checked, written at once into the attachment folder and chosen; a HEIC gives its Notice and no file', async () => {
		const app = storeApp(pics) as ReturnType<typeof storeApp> & Record<string, unknown>;
		const made: [string, number][] = [];
		Object.assign(app.fileManager, { getAvailablePathForAttachment: async (name: string) => `Attachments/${name}` });
		Object.assign(app.vault, {
			createBinary: async (path: string, data: ArrayBuffer) => {
				made.push([path, data.byteLength]);
				return file(path);
			},
		});
		const got = pickPicture(app as never, { sourcePath: 'Tree.md', title: 'x' });
		const m = pickerOf();
		const heic = isoFile('heic', ['mif1', 'heic'], [[4032, 3024]]);
		await m.fromDevice({ name: 'IMG_1.HEIC', size: heic.length, arrayBuffer: async () => heic.buffer });
		expect(notices).toEqual([deviceNotice({ ok: false, code: 'picture-not-image', file: 'IMG_1.HEIC', format: 'HEIC' })]);
		expect(made).toEqual([]);
		const png = pngHead(400, 600);
		await m.fromDevice({ name: 'image', size: png.length, arrayBuffer: async () => png.buffer });
		expect(made).toEqual([['Attachments/image.png', png.length]]);
		expect(notices[1]).toBe(PICTURES_UI.added('image.png', 'Attachments'));
		expect(await got).toBe('[[image.png]]');
	});
});

// ---------- the Houses window and the edit sheet ----------

const HOUSES_BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
    arms: "[[valmont-arms.png]]"
  - id: thorne
    name: House Thorne
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    portrait: "[[aldric.jpg]]"
  - id: wren
    name: Wren Thorne
    house: thorne
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

/** A store whose copies and pixels are fakes; `resolve` is the real rule on a small vault. */
function windowStore(files: VaultFile[], o: { pixels?: Uint8ClampedArray | null } = {}) {
	const app = storeApp(files);
	const released: string[] = [];
	let n = 0;
	const copy = (): PictureCopy => {
		const url = `blob:c${n++}`;
		return { url, w: 80, h: 80, release: () => released.push(url) };
	};
	const store: PictureStore = {
		...createPictureStore(app as never, fakeIO(new Map()).io),
		acquire: async () => copy(),
		transient: async () => copy(),
		pixels: async () => (o.pixels === undefined ? new Uint8ClampedArray(64 * 64 * 4).fill(255) : o.pixels),
	};
	return { app, store, released };
}

describe('the Houses window: arms and their colours (spec §13.6, O7, B8)', () => {
	const files = [file('Pictures/valmont-arms.png'), file('Pictures/aldric.jpg'), file('Pictures/thorne.png')];

	function open(o: { pixels?: Uint8ClampedArray | null } = {}) {
		const { app, store, released } = windowStore(files, o);
		const handle = writingHandle(HOUSES_BODY);
		const win = HousesWindow.create(app as never, { handle: handle as never, sourcePath: 'Tree.md', pictures: store })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const row = (id: string) => content.querySelector(`.dynasty-house-row[data-house="${id}"]`)!;
		return { app, store, released, handle, win, content, row };
	}

	it('each row shows its arms before the name; a house with no arms has the dashed box with its accessible name', async () => {
		const { content, row } = open();
		await settle();
		const arms = row('valmont').querySelector('.dynasty-house-arms')!;
		expect(arms.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
		const empty = row('thorne').querySelector('.dynasty-house-arms')!;
		expect(empty.hasClass('is-empty')).toBe(true);
		expect(empty.getAttribute('aria-label')).toBe('Select the arms of House Thorne');
		// The name input is still the first input of the row (the arms box is a button).
		expect(row('thorne').querySelector('input')!.value).toBe('House Thorne');
		expect(content.querySelectorAll('.dynasty-house-row').length).toBe(2);
	});

	it('loadHouses and houseOps: Remove arms and Select arms are one batch; a new house can have arms', () => {
		const l = loadHouses(HOUSES_BODY);
		if (l.kind !== 'ok') throw new Error('parse');
		expect(l.data.houses.map((h) => h.arms)).toEqual(['[[valmont-arms.png]]', null]);
		const rows = rowsOf(l.data);
		expect(houseOps(rows)).toEqual([]);
		rows[0].arms = null;
		rows[1].arms = '[[thorne.png]]';
		rows.push({ key: 'n', id: null, name: 'House Ashby', colour: null, arms: '[[ashby.png]]', base: null, deleted: null });
		expect(houseOps(rows)).toEqual([
			{ kind: 'edit-house', id: 'valmont', arms: null },
			{ kind: 'edit-house', id: 'thorne', arms: '[[thorne.png]]' },
			{ kind: 'add-house', name: 'House Ashby', arms: '[[ashby.png]]' },
		]);
		rows[1].arms = '   ';
		expect(houseOps(rows).filter((o) => o.kind === 'edit-house' && o.id === 'thorne')).toEqual([]);
	});

	it('Remove arms and Select arms for two houses, then Save: one write that changes only the arms lines', async () => {
		const { content, row, handle } = open();
		await settle();
		dispatch(row('valmont').querySelector('.dynasty-house-swatch')!, 'click');
		dispatch(content.querySelector('.dynasty-house-remove-arms')!, 'click');
		expect(row('valmont').querySelector('.dynasty-house-arms')!.hasClass('is-empty')).toBe(true);
		dispatch(row('thorne').querySelector('.dynasty-house-arms')!, 'click');
		const picker = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		// M11 (D92): this house has no arms yet, so the folder "Pictures" is closed: open it first.
		const target = pickerRowFor(picker.contentEl, 'Pictures/thorne.png');
		dispatch(target, 'click');
		dispatch(picker.contentEl.querySelector('.dynasty-picture-select')!, 'click');
		await settle();
		const before = handle.body;
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', arms: null }, { kind: 'edit-house', id: 'thorne', arms: '[[thorne.png]]' }] });
		expect(handle.body).toBe(before.replace('    arms: "[[valmont-arms.png]]"\n', '').replace('    name: House Thorne\n', '    name: House Thorne\n    arms: "[[thorne.png]]"\n'));
	});

	it('D68: with arms, "Colours from the arms" comes first with the exact colours, then "House colours"; a colour of the arms is written like D32', async () => {
		const { content, row, handle } = open();
		await settle();
		dispatch(row('valmont').querySelector('.dynasty-house-swatch')!, 'click');
		await settle();
		const labels = content.querySelectorAll('.dynasty-house-palette .dynasty-sheet-label').map((l) => l.getText());
		expect(labels).toEqual([PICTURES_UI.armsHeading, 'Colour of House Valmont', PICTURES_UI.coloursFromArms, PICTURES_UI.houseColours]);
		const armsColour = content.querySelector('.dynasty-house-arms-colour')!;
		expect(armsColour.getAttribute('data-colour')).toBe('#ffffff');
		expect(armsColour.getAttribute('aria-label')).toBe('Colour 1 from the arms');
		expect(content.querySelectorAll('.dynasty-house-colour').length).toBe(12);
		dispatch(armsColour, 'click');
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', color: '#ffffff' }] });
	});

	it('when the plugin cannot read the pixels, the window says so and shows the normal colours', async () => {
		const { content, row } = open({ pixels: null });
		await settle();
		dispatch(row('valmont').querySelector('.dynasty-house-swatch')!, 'click');
		await settle();
		expect(content.querySelector('.dynasty-house-arms-none')!.getText()).toBe('The plugin cannot read the colours of this picture.');
		expect(content.querySelectorAll('.dynasty-house-colour').length).toBe(12);
	});

	it('closing the window releases its arms copies', async () => {
		const { win, released } = open();
		await settle();
		(win as unknown as { finish(): void }).finish();
		expect(released.length).toBe(1);
	});
});

describe('the edit sheet: the portrait (spec §13.7, O7)', () => {
	const files = [file('Pictures/aldric.jpg'), file('Pictures/new.png')];

	function open(id: string) {
		const { app, store, released } = windowStore(files);
		const handle = writingHandle(HOUSES_BODY);
		const sheet = EditSheet.create(app as never, { handle: handle as never, personId: id, sourcePath: 'Tree.md', pictures: store })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		return { sheet, content, handle, released };
	}

	it('the portrait is at the top of the sheet, as a transient copy released when the sheet closes', async () => {
		const { content, sheet, released } = open('aldric');
		await settle();
		const fields = content.querySelectorAll('.dynasty-sheet-field').map((f) => f.getAttribute('data-field'));
		expect(fields.slice(0, 2)).toEqual(['portrait', 'name']);
		expect(content.querySelector('.dynasty-sheet-portrait-img')!.getAttribute('src')).toMatch(/^blob:/);
		expect(content.querySelector('.dynasty-remove-portrait')!.getText()).toBe(PICTURES_UI.removePortrait);
		sheet.close();
		expect(released).toHaveLength(1);
	});

	it('Remove portrait, then Save: only that person\'s portrait line changes', async () => {
		const { content, handle } = open('aldric');
		await settle();
		dispatch(content.querySelector('.dynasty-remove-portrait')!, 'click');
		expect(content.querySelector('.dynasty-remove-portrait')).toBeNull();
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'aldric', fields: { portrait: null } }]);
		expect(handle.body).toBe(HOUSES_BODY.replace('    portrait: "[[aldric.jpg]]"\n', ''));
	});

	it('Select portrait (the picker), then Save: one text line is added', async () => {
		const { content, handle } = open('wren');
		await settle();
		expect(content.querySelector('.dynasty-sheet-portrait-frame')!.hasClass('is-none')).toBe(true);
		dispatch(content.querySelector('.dynasty-select-portrait')!, 'click');
		const picker = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		// M11 (D92): this person has no portrait yet, so the folder "Pictures" is closed: open it first.
		dispatch(pickerRowFor(picker.contentEl, 'Pictures/new.png'), 'click');
		dispatch(pickerRowFor(picker.contentEl, 'Pictures/new.png'), 'click');
		await settle();
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'wren', fields: { portrait: '[[new.png]]' } }]);
		expect(handle.body).toBe(HOUSES_BODY.replace('    house: thorne\n', '    house: thorne\n    portrait: "[[new.png]]"\n'));
	});

	it('B1: a missing file gives the dashed frame and the warning text in the sheet', async () => {
		const { app, store } = windowStore([]);
		const handle = writingHandle(HOUSES_BODY);
		const sheet = EditSheet.create(app as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md', pictures: store })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		expect(content.querySelector('.dynasty-sheet-portrait-frame')!.hasClass('is-missing')).toBe(true);
		expect(content.querySelector('.dynasty-sheet-portrait-problem')!.getText()).toContain('aldric.jpg');
	});
});

// ---------- renames (O8, B16) ----------

describe('picture renames (O8, B16)', () => {
	it('renameKind: md to md is a note; a shown picture format to a shown picture format is a picture; anything else is nothing', () => {
		expect(renameKind('a/x.md', 'b/y.md')).toBe('note');
		expect(renameKind('a/x.png', 'a/y.png')).toBe('picture');
		expect(renameKind('a/x.png', 'a/x.jpg')).toBe('picture');
		expect(renameKind('a/x.png', 'a/x.md')).toBeNull();
		expect(renameKind('a/x.heic', 'a/y.heic')).toBeNull();
		expect(renameKind('a/x.pdf', 'a/y.pdf')).toBeNull();
	});

	it('texts: a picture rename says "picture"; a folder rename with both says "notes and pictures"', () => {
		expect(RENAME_UI.progressFor('note')).toBe(RENAME_UI.progress);
		expect(RENAME_UI.noLinksFor('note')).toBe(RENAME_UI.noLinks);
		expect(RENAME_UI.progressFor('picture')).toBe('The plugin updates the tree links to the renamed picture. This can take some time.');
		expect(renamedText([{ from: 'a.png', picture: true }, { from: 'b', picture: false }])).toBe('2 renamed notes and pictures');
		expect(renamedText([{ from: 'a' }, { from: 'b' }])).toBe('2 renamed notes');
	});

	/** A small vault of notes and pictures for the real LinkUpdater. */
	function vault(files: Record<string, string>, pictures: string[]) {
		const texts = new Map(Object.entries(files));
		const all = new Map<string, VaultFile>();
		for (const p of [...texts.keys(), ...pictures]) all.set(p, file(p));
		const stemOf = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => all.get(p) ?? null,
				getMarkdownFiles: () => [...all.values()].filter((f) => f.extension === 'md'),
				getFiles: () => [...all.values()],
				read: async (f: VaultFile) => texts.get(f.path) ?? '',
				cachedRead: async (f: VaultFile) => texts.get(f.path) ?? '',
				process: async (f: VaultFile, fn: (t: string) => string) => {
					const next = fn(texts.get(f.path) ?? '');
					texts.set(f.path, next);
					return next;
				},
			},
			metadataCache: {
				on: () => ({}),
				offref: () => {},
				getFirstLinkpathDest(linkpath: string) {
					const want = linkpath.toLowerCase();
					for (const [p, f] of all) if (p.toLowerCase() === want || p.toLowerCase().endsWith(`/${want}`) || stemOf(p) === want || stemOf(p).endsWith(`/${want}`)) return f;
					return null;
				},
				fileToLinktext: (f: VaultFile) => (f.extension === 'md' ? f.path.replace(/\.md$/i, '') : f.path).split('/').pop()!,
				getFileCache: () => null,
			},
			workspace: { getLeavesOfType: () => [] },
		};
		const handles = new HandleRegistry(app as never);
		const updater = new LinkUpdater(app as never, handles, () => true, { resolved: 0, quiet: 0, cap: 50 });
		const rename = async (from: string, to: string) => {
			const f = all.get(from)!;
			all.delete(from);
			f.path = to;
			Object.assign(f, { name: to.split('/').pop(), extension: to.split('.').pop() });
			all.set(to, f);
			if (texts.has(from)) {
				texts.set(to, texts.get(from)!);
				texts.delete(from);
			}
			handles.renamed(from, to);
			updater.renamed(f, from);
			await updater.idle();
		};
		return { texts, rename };
	}

	const NOTE = ['```dynasty', 'houses:', '  - id: v', '    name: V', '    arms: "[[old-arms.png]]"', 'people:', '  - id: a', '    name: A', '    portrait: "![[Pictures/old-arms.png|A]]"', '    link: "[[x.png]]"', '```', ''].join('\n');

	it('a picture rename updates arms and portrait with the extension kept; the Notice counts the values', async () => {
		const v = vault({ 'Tree.md': NOTE }, ['Pictures/old-arms.png', 'x.png']);
		await v.rename('Pictures/old-arms.png', 'Pictures/new-arms.png');
		const t = v.texts.get('Tree.md')!;
		expect(t).toContain('    arms: "[[new-arms.png]]"');
		// The fake's `fileToLinktext` gives the shortest form; the "!" and the alias stay.
		expect(t).toContain('    portrait: "![[new-arms.png|A]]"');
		expect(t).toContain('    link: "[[x.png]]"');
		expect(notices).toEqual([RENAME_UI.updated(2, 1)]);
	});

	it('B16: the rename of a note "x.png.md" never changes a link to the picture "x.png"', async () => {
		const v = vault({ 'Tree.md': NOTE.replace('    link: "[[x.png]]"', '    link: "[[x.png]]"\n  - id: b\n    name: B\n    portrait: "[[x.png]]"'), 'x.png.md': 'A note.' }, ['x.png']);
		await v.rename('x.png.md', 'y.md');
		expect(v.texts.get('Tree.md')).toContain('    portrait: "[[x.png]]"');
		expect(v.texts.get('Tree.md')).toContain('    link: "[[x.png]]"');
		expect(notices).toEqual([]);
	});
});

describe('the setting "Show portraits on cards" (O10)', () => {
	it('is on by default; a stored false stays; a bad value is the default', () => {
		expect(DEFAULT_SETTINGS.showPortraits).toBe(true);
		expect(normaliseSettings({ showPortraits: false }).showPortraits).toBe(false);
		expect(normaliseSettings({ showPortraits: 'no' }).showPortraits).toBe(true);
	});
});
