import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { HousesWindow } from '../src/obsidian/houses-window';
import { pickPicture, type PickResult } from '../src/obsidian/picture-picker';
import { createPictureStore, type PictureCopy, type PictureIO, type PictureStore } from '../src/obsidian/picture-store';
import { PICTURES_UI } from '../src/render/ui-text';
import { FEl, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { openPage } from './lw-support';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * 0.2.1 WP3, D97 (spec §13.6, §13.13): the Remove row in the picture lists for arms and for a portrait.
 * The picker answers `remove` as well as `choose` and `cancel`; the Houses window and the edit sheet
 * clear the value in the open window, and Save writes it. D92 to D95 stay true with the row.
 * Run: npx vitest run tests/v111-obsidian-remove.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	device.coarse = false;
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const VAULT = ['Art/Arms/lion.png', 'Art/Arms/eagle.svg', 'Other/x.png', 'root.png'].map(file);

function app(files: VaultFile[] = VAULT) {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

type Picker = { contentEl: FEl; modalEl: FEl; close(): void };
const openPicker = () => openModals[openModals.length - 1] as unknown as Picker;

function pick(o: { current?: VaultFile | null; remove?: string; files?: VaultFile[] } = {}) {
	let result: PickResult | undefined;
	const done = pickPicture(app(o.files) as never, { sourcePath: 'Trees/Tree.md', title: 'Select', current: o.current ?? null, remove: o.remove }).then((v) => (result = v));
	return { m: openPicker(), done, result: () => result };
}

const list = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-list')!;
const rowEls = (m: Picker) => list(m).querySelectorAll('[role="treeitem"], [role="option"]');
const search = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-search')!;
const removeRow = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-remove');
const rowLabel = (r: FEl) => r.querySelector('.dynasty-picture-name')?.getText() ?? r.getAttribute('aria-label') ?? r.getText();
const key = (m: Picker, k: string) => dispatch(search(m), 'keydown', { key: k });
const type = (m: Picker, text: string) => {
	const s = search(m);
	s.value = text;
	dispatch(s, 'input');
};
const activeId = (m: Picker) => search(m).getAttribute('aria-activedescendant');

describe('D97: the Remove row in the picker', () => {
	it('with no `remove` text the list has no Remove row', () => {
		const { m } = pick();
		expect(removeRow(m)).toBeNull();
		expect(rowEls(m).map(rowLabel)[0]).toBe(PICTURES_UI.fromDevice);
	});

	it('with a `remove` text it is the first row, above the device row, with that text', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		const rows = rowEls(m);
		expect(rows[0]).toBe(removeRow(m));
		expect(rowLabel(rows[0])).toBe('Remove arms');
		expect(rowLabel(rows[1])).toBe(PICTURES_UI.fromDevice);
		expect(rows.length).toBe(1 + 1 + 3 + 0);
		const portrait = pick({ remove: PICTURES_UI.removePortrait });
		expect(rowLabel(rowEls(portrait.m)[0])).toBe('Remove portrait');
	});

	it('a tap on the row answers `remove`, closes the list and writes nothing', async () => {
		const { m, done } = pick({ remove: PICTURES_UI.removeArms, current: VAULT[0] });
		dispatch(removeRow(m)!, 'click');
		expect(await done).toEqual({ kind: 'remove' });
		expect(openModals).toHaveLength(0);
	});

	it('it shows while the search field has text, and a tap on it still answers `remove`', async () => {
		const { m, done } = pick({ remove: PICTURES_UI.removeArms });
		type(m, 'lion');
		expect(rowEls(m)[0]).toBe(removeRow(m));
		expect(rowEls(m)[0].getAttribute('role')).toBe('option');
		expect(rowEls(m).map(rowLabel)).toEqual(['Remove arms', PICTURES_UI.fromDevice, 'lion.png']);
		type(m, '');
		expect(rowEls(m)[0].getAttribute('role')).toBe('treeitem');
		dispatch(removeRow(m)!, 'click');
		expect(await done).toEqual({ kind: 'remove' });
	});

	it('Cancel still answers `cancel` and a chosen picture still answers `choose`', async () => {
		const first = pick({ remove: PICTURES_UI.removeArms });
		dispatch(first.m.contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(await first.done).toEqual({ kind: 'cancel' });
		resetObsidian();
		const second = pick({ remove: PICTURES_UI.removeArms, current: VAULT[3] });
		dispatch(second.m.contentEl.querySelector('.dynasty-picture-select')!, 'click');
		expect(await second.done).toEqual({ kind: 'choose', link: '[[root.png]]' });
	});

	it('keys: Down with no cursor goes to the row, Enter removes', async () => {
		const { m, done } = pick({ remove: PICTURES_UI.removeArms });
		const e = key(m, 'ArrowDown');
		expect(e.defaultPrevented).toBe(true);
		expect(activeId(m)).toBe('dynasty-picture-row-remove');
		expect(removeRow(m)!.hasClass('is-cursor')).toBe(true);
		key(m, 'Enter');
		expect(await done).toEqual({ kind: 'remove' });
	});

	it('keys: from the row Down goes to the device row; from the device row Up comes back; Up from the row wraps to the last row', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		key(m, 'ArrowDown');
		key(m, 'ArrowDown');
		expect(activeId(m)).toBe(rowEls(m)[1].getAttribute('id'));
		expect(removeRow(m)!.hasClass('is-cursor')).toBe(false);
		key(m, 'ArrowUp');
		expect(activeId(m)).toBe('dynasty-picture-row-remove');
		key(m, 'ArrowUp');
		const rows = rowEls(m);
		expect(activeId(m)).toBe(rows[rows.length - 1].getAttribute('id'));
		// Down from the last row goes to the Remove row, so the Arrow keys reach it from both ends.
		key(m, 'ArrowDown');
		expect(activeId(m)).toBe('dynasty-picture-row-remove');
	});

	it('Enter on the device row still opens the file choice', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		const clicked = vi.fn();
		Object.assign(m.contentEl.querySelector('.dynasty-picture-file')!, { click: clicked });
		key(m, 'ArrowDown');
		key(m, 'ArrowDown');
		key(m, 'Enter');
		expect(clicked).toHaveBeenCalledTimes(1);
	});

	it('Enter on the current picture, where the cursor starts, still chooses it', async () => {
		const { m, done } = pick({ remove: PICTURES_UI.removeArms, current: VAULT[0] });
		key(m, 'Enter');
		expect(await done).toEqual({ kind: 'choose', link: '[[lion.png]]' });
	});

	it('Space and the side Arrow keys on the row do nothing and are left to the search field', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		key(m, 'ArrowDown');
		for (const k of [' ', 'ArrowLeft', 'ArrowRight']) expect(key(m, k).defaultPrevented, k).toBe(false);
		expect(activeId(m)).toBe('dynasty-picture-row-remove');
		expect(openModals).toHaveLength(1);
	});

	it('D92 to D95 stay: folders closed at open, nothing selected until a tap, no cursor, Select off', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		expect(rowEls(m).map(rowLabel)).toEqual(['Remove arms', PICTURES_UI.fromDevice, 'Open the folder Art', 'Open the folder Other', 'root.png']);
		expect(rowEls(m).filter((r) => r.getAttribute('aria-selected') === 'true')).toEqual([]);
		expect(activeId(m)).toBeNull();
		expect((m.contentEl.querySelector('.dynasty-picture-select') as unknown as HTMLButtonElement).disabled).toBe(true);
		// A tap on a picture selects it, as without the row; the Remove row is never the selected row.
		dispatch(rowEls(m).find((r) => rowLabel(r) === 'root.png')!, 'click');
		expect(rowEls(m).filter((r) => r.getAttribute('aria-selected') === 'true').map(rowLabel)).toEqual(['root.png']);
		expect(removeRow(m)!.hasClass('is-selected')).toBe(false);
	});

	it('D95: on a touch-first device the search field never gets the focus, with the row too', () => {
		device.coarse = true;
		const spy = vi.spyOn(FEl.prototype, 'focus');
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		runTimers(1000);
		expect(fakeDoc.activeElement).not.toBe(search(m));
		expect(spy.mock.contexts.some((c) => c === search(m))).toBe(false);
	});

	it('the row is at least 44 px high by the same rule as the other rows', () => {
		const { m } = pick({ remove: PICTURES_UI.removeArms });
		expect(removeRow(m)!.hasClass('dynasty-picture-row')).toBe(true);
	});

	it('a list of 2 000 pictures opens in under 300 ms with the row', () => {
		const many = Array.from({ length: 2000 }, (_, i) => file(`Art/Folder ${i % 100}/picture ${i}.png`));
		const t0 = performance.now();
		const { m } = pick({ remove: PICTURES_UI.removeArms, files: many, current: many[5] });
		const ms = performance.now() - t0;
		expect(removeRow(m)).not.toBeNull();
		expect(ms).toBeLessThan(300);
	});
});

// ---------- the callers ----------

const BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
    arms: "[[lion.png]]"
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

const FILES = [file('Pictures/lion.png'), file('Pictures/aldric.jpg'), file('Pictures/thorne.png')];

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

/** A store whose copies are fakes; `resolve` is the real rule on the small vault. */
function windowStore() {
	const a = app(FILES);
	const io: PictureIO = { read: async () => new ArrayBuffer(0), decode: async () => null as never, encode: async () => null as never, coarse: () => false, dpr: () => 2 } as unknown as PictureIO;
	let n = 0;
	const copy = (): PictureCopy => ({ url: `blob:c${n++}`, w: 80, h: 80, release: () => {} });
	const store: PictureStore = { ...createPictureStore(a as never, io), acquire: async () => copy(), transient: async () => copy(), pixels: async () => new Uint8ClampedArray(64 * 64 * 4).fill(255) };
	return { a, store };
}

describe('D97: the Houses window uses the Remove row', () => {
	function open() {
		const { a, store } = windowStore();
		const handle = writingHandle(BODY);
		const win = HousesWindow.create(a as never, { handle: handle as never, sourcePath: 'Tree.md', pictures: store })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		// 0.2.5 (D134): the arms box button is on the edit page of the house.
		const row = (id: string) => openPage(content, id);
		return { content, row, handle };
	}

	it('the arms box of a house with arms opens a list with "Remove arms" first; a tap clears the arms in the window; Save writes it', async () => {
		const { content, row, handle } = open();
		await settle();
		dispatch(row('valmont').querySelector('.dynasty-house-arms')!, 'click');
		const picker = openPicker();
		expect(rowLabel(rowEls(picker)[0])).toBe('Remove arms');
		dispatch(removeRow(picker)!, 'click');
		await settle();
		expect(openModals.length).toBe(1);
		expect(content.querySelector('.dynasty-lw-page button.dynasty-house-arms')!.hasClass('is-empty')).toBe(true);
		// Nothing is written until Save.
		expect(handle.write).not.toHaveBeenCalled();
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'batch', ops: [{ kind: 'edit-house', id: 'valmont', arms: null }] }]);
		expect(handle.body).toBe(BODY.replace('    arms: "[[lion.png]]"\n', ''));
	});

	it('a house with no arms opens a list with no Remove row', async () => {
		const { row } = open();
		await settle();
		dispatch(row('thorne').querySelector('.dynasty-house-arms')!, 'click');
		expect(removeRow(openPicker())).toBeNull();
	});

	it('Cancel in the list changes nothing; the Remove arms button stays', async () => {
		const { content, row } = open();
		await settle();
		row('valmont');
		expect(content.querySelector('.dynasty-house-remove-arms')!.getText()).toBe(PICTURES_UI.removeArms);
		dispatch(content.querySelector('.dynasty-lw-page button.dynasty-house-arms')!, 'click');
		dispatch(openPicker().contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(content.querySelector('.dynasty-lw-page button.dynasty-house-arms')!.hasClass('is-empty')).toBe(false);
	});
});

describe('D97: the edit sheet uses the Remove row', () => {
	function open(id: string) {
		const { a, store } = windowStore();
		const handle = writingHandle(BODY);
		const sheet = EditSheet.create(a as never, { handle: handle as never, personId: id, sourcePath: 'Tree.md', pictures: store })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		return { content, handle };
	}

	it('a person with a portrait: "Remove portrait" is the first row; a tap clears the portrait in the sheet; Save writes it', async () => {
		const { content, handle } = open('aldric');
		await settle();
		dispatch(content.querySelector('.dynasty-select-portrait')!, 'click');
		const picker = openPicker();
		expect(rowLabel(rowEls(picker)[0])).toBe('Remove portrait');
		dispatch(removeRow(picker)!, 'click');
		await settle();
		expect(content.querySelector('.dynasty-remove-portrait')).toBeNull();
		expect(handle.write).not.toHaveBeenCalled();
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'aldric', fields: { portrait: null } }]);
		expect(handle.body).toBe(BODY.replace('    portrait: "[[aldric.jpg]]"\n', ''));
	});

	it('a person with no portrait: the list has no Remove row', async () => {
		const { content } = open('wren');
		await settle();
		dispatch(content.querySelector('.dynasty-select-portrait')!, 'click');
		expect(removeRow(openPicker())).toBeNull();
	});

	it('the Remove portrait button stays and works', async () => {
		const { content, handle } = open('aldric');
		await settle();
		dispatch(content.querySelector('.dynasty-remove-portrait')!, 'click');
		dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(handle.ops).toEqual([{ kind: 'set-person-fields', id: 'aldric', fields: { portrait: null } }]);
	});
});
