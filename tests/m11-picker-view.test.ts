import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { PICKER_ROW_PX, PREVIEW_BOX, PREVIEW_BOX_PX, PREVIEW_LOADS } from '../src/obsidian/picture-picker';
import type { PictureCopy } from '../src/obsidian/picture-store';
import { PICTURES_UI } from '../src/render/ui-text';
import { FEl, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, runFrame, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { cssRules, pickerModule, pickerUiOf } from './acceptance/m11-support';

/*
 * WP 11.0 (spec §13.14, D92 to D95; `picture-picker.ts` header): the picker view on
 * the fake DOM. The M11 exports of `picture-picker.ts` (`createRowPreviews`, `currentPictureOf`,
 * `isTouchFirst`) and `PICKER_UI` come with WP 11.3: until then these tests fail. Rows are found by their
 * ARIA roles and labels (the picker header fixes them), not by class names that it leaves open.
 * Run: npx vitest run tests/m11-picker-view.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => {
	vi.restoreAllMocks();
	delete (fakeWin as { visualViewport?: unknown }).visualViewport;
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

const SHOWN = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];

/** A vault: Art/Arms (2 pictures), Art/Portraits (1), Other (1), a picture at the root, and files that never show. */
const VAULT = ['Art/Arms/lion.png', 'Art/Arms/eagle.svg', 'Art/Portraits/aldric.jpg', 'Other/x.png', 'root.png', 'Notes/a.md', 'Art/notes.md', '.obsidian/hidden.png', 'Art/.git/inner.png', 'Only/x.heic'].map(file);
const pic = (path: string) => VAULT.find((f) => f.path === path)!;

function app(files = VAULT) {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

interface Asked {
	file: VaultFile;
	box: unknown;
	signal?: AbortSignal;
	resolve: (v: PictureCopy | { ok: false; code: string; file: string } | null) => void;
}

/** A store double: `acquire` waits until the test answers; every copy that it makes is counted when it is released. */
function fakeStore(files = VAULT) {
	const asked: Asked[] = [];
	const released: string[] = [];
	const made: string[] = [];
	let n = 0;
	const copy = (): PictureCopy => {
		const url = `blob:c${n++}`;
		made.push(url);
		return { url, w: 32, h: 32, release: () => released.push(url) };
	};
	const store = {
		resolve: (link: string) => {
			const f = files.find((x) => link.includes(x.name) && SHOWN.includes(x.extension));
			return f ? { ok: true, file: f, format: 'png' } : { ok: false, code: 'picture-missing', file: link };
		},
		acquire: (f: VaultFile, box: unknown, signal?: AbortSignal) => new Promise<PictureCopy | { ok: false; code: string; file: string } | null>((resolve) => asked.push({ file: f, box, signal, resolve })),
		stats: { inUse: 0 },
	};
	return { store, asked, released, made, copy };
}

type Picker = { contentEl: FEl; modalEl: FEl; close(): void };
const openPicker = () => openModals[openModals.length - 1] as unknown as Picker;

async function pick(o: { current?: VaultFile | null; store?: unknown; files?: VaultFile[] } = {}) {
	const M = (await pickerModule()) as { pickPicture: (a: never, o: never) => Promise<string | null> };
	let result: string | null | undefined;
	const done = M.pickPicture(app(o.files) as never, { sourcePath: 'Trees/Tree.md', title: 'Select', store: o.store, ...(o.current !== undefined ? { current: o.current } : {}) } as never).then((v) => (result = v));
	const m = openPicker();
	return { m, done, result: () => result };
}

// ---------- what the tests read from the DOM ----------

const list = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-list')!;
const rowEls = (m: Picker) => list(m).querySelectorAll('[role="treeitem"], [role="option"]');
const search = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-search')!;
const body = (m: Picker) => m.contentEl.querySelector('.dynasty-sheet-body')!;
const selectButton = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-select')!;
const isFolder = (r: FEl) => r.attrs.has('aria-expanded');
const isDevice = (r: FEl) => r.getText().includes(PICTURES_UI.fromDevice);
const nameOf = (r: FEl) => r.querySelector('.dynasty-picture-name')?.getText() ?? r.getText();

/** One string for each row: "device", the folder label ("Open the folder Art"), or the file name. */
function shape(m: Picker): string[] {
	return rowEls(m).map((r) => (isDevice(r) ? 'device' : isFolder(r) ? r.getAttribute('aria-label')! : nameOf(r)));
}
const byLabel = (m: Picker, label: string) => rowEls(m).find((r) => r.getAttribute('aria-label') === label)!;
const byName = (m: Picker, name: string) => rowEls(m).find((r) => !isFolder(r) && !isDevice(r) && nameOf(r) === name)!;
const selectedNames = (m: Picker) => rowEls(m).filter((r) => r.getAttribute('aria-selected') === 'true').map((r) => (isFolder(r) ? r.getAttribute('aria-label')! : isDevice(r) ? 'device' : nameOf(r)));
const type = (m: Picker, text: string) => {
	const s = search(m);
	s.value = text;
	dispatch(s, 'input');
};
/** The hidden file input opens the device's file choice with `click()`; a spy stands in for it. */
function fileChoice(m: Picker) {
	const clicked = vi.fn();
	Object.assign(m.contentEl.querySelector('.dynasty-picture-file')!, { click: clicked });
	return clicked;
}
const key = (target: FEl, k: string) => dispatch(target, 'keydown', { key: k });

describe('V2, V5, P2, P6: the folder view at open, with no current picture', () => {
	it('the device row first, then the folders with pictures (closed) and the pictures of the root; nothing is selected', async () => {
		const { m } = await pick();
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
		expect(selectedNames(m)).toEqual([]);
		expect(selectButton(m).disabled).toBe(true);
		expect(rowEls(m).filter(isFolder).map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
	});

	it('a folder row shows its name and its number of pictures, sub-folders included', async () => {
		const { m } = await pick();
		const art = byLabel(m, 'Open the folder Art');
		const other = byLabel(m, 'Open the folder Other');
		expect(art.getText()).toContain('Art');
		expect(art.getText()).toContain('3');
		expect(other.getText()).toContain('1');
	});

	it('the list is a tree, and every row is a treeitem; the folder rows say their level', async () => {
		const { m } = await pick();
		expect(list(m).getAttribute('role')).toBe('tree');
		expect(rowEls(m).every((r) => r.getAttribute('role') === 'treeitem')).toBe(true);
		for (const r of rowEls(m).filter(isFolder)) expect(r.getAttribute('aria-level')).not.toBeNull();
	});

	it('the large preview is gone', async () => {
		const { m } = await pick();
		expect(m.contentEl.querySelector('.dynasty-picture-preview')).toBeNull();
		expect(m.contentEl.querySelector('.dynasty-picture-preview-img')).toBeNull();
	});

	it('a vault with no picture shows the device row and the text "no pictures"', async () => {
		const { m } = await pick({ files: [file('Notes/a.md')] });
		expect(shape(m)).toEqual(['device']);
		expect(m.contentEl.getText()).toContain(PICTURES_UI.noPictures);
	});
});

describe('P5, P9, V1, V5: the current picture', () => {
	it('its folders are open, its row has the mark "In use" and is selected, and Select is enabled', async () => {
		const { m } = await pick({ current: pic('Art/Arms/lion.png') });
		expect(shape(m)).toEqual(['device', 'Close the folder Art', 'Close the folder Art/Arms', 'eagle.svg', 'lion.png', 'Open the folder Art/Portraits', 'Open the folder Other', 'root.png']);
		expect(selectedNames(m)).toEqual(['lion.png']);
		expect(byName(m, 'lion.png').getText()).toContain('In use');
		expect(byName(m, 'eagle.svg').getText()).not.toContain('In use');
		expect(selectButton(m).disabled).toBe(false);
	});

	it('the mark has the label "This picture is in use now"', async () => {
		const { m } = await pick({ current: pic('Art/Arms/lion.png') });
		const marked = byName(m, 'lion.png')
			.all()
			.some((e) => e.getAttribute('aria-label') === 'This picture is in use now' || e.getAttribute('title') === 'This picture is in use now');
		expect(marked).toBe(true);
	});

	it('a picture at the vault root leaves all folders closed', async () => {
		const { m } = await pick({ current: pic('root.png') });
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
		expect(selectedNames(m)).toEqual(['root.png']);
		expect(byName(m, 'root.png').getText()).toContain('In use');
	});

	it('a current file that the plugin cannot show, or that is missing, means no current picture: all closed, nothing selected', async () => {
		for (const current of [pic('Art/notes.md'), pic('Only/x.heic'), pic('.obsidian/hidden.png'), file('Gone/missing.png'), null]) {
			resetObsidian();
			const { m } = await pick({ current });
			expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
			expect(selectedNames(m)).toEqual([]);
			expect(selectButton(m).disabled).toBe(true);
			m.close();
		}
	});

	it('the list starts at the top: nothing scrolls a row into view at open', async () => {
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		const { m } = await pick({ current: pic('Art/Portraits/aldric.jpg') });
		runTimers(1000);
		await settle();
		expect(spy).not.toHaveBeenCalled();
		expect(body(m).scrollTop).toBe(0);
	});
});

describe('V5, P8: taps', () => {
	it('the first tap on the current picture selects nothing new and does not choose; the second tap chooses', async () => {
		const { m, done, result } = await pick({ current: pic('Art/Arms/lion.png') });
		dispatch(byName(m, 'lion.png'), 'click');
		await settle();
		expect(openModals).toHaveLength(1);
		expect(result()).toBeUndefined();
		expect(selectedNames(m)).toEqual(['lion.png']);
		dispatch(byName(m, 'lion.png'), 'click');
		expect(await done).toBe('[[lion.png]]');
		expect(openModals).toHaveLength(0);
	});

	it('a tap on a folder row opens it and moves nothing else; the label changes; a second tap closes it', async () => {
		const { m } = await pick();
		dispatch(byLabel(m, 'Open the folder Other'), 'click');
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Close the folder Other', 'x.png', 'root.png']);
		expect(byLabel(m, 'Close the folder Other').getAttribute('aria-expanded')).toBe('true');
		expect(selectedNames(m)).toEqual([]);
		dispatch(byLabel(m, 'Close the folder Other'), 'click');
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
		expect(openModals).toHaveLength(1);
	});

	it('a picture from a closed folder can be chosen after opening the folder: first tap selects, second chooses', async () => {
		const { m, done } = await pick();
		dispatch(byLabel(m, 'Open the folder Other'), 'click');
		dispatch(byName(m, 'x.png'), 'click');
		expect(selectedNames(m)).toEqual(['x.png']);
		expect(selectButton(m).disabled).toBe(false);
		expect(openModals).toHaveLength(1);
		dispatch(byName(m, 'x.png'), 'click');
		expect(await done).toBe('[[x.png]]');
	});

	it('a tap on another picture selects that one; Select chooses the selected picture', async () => {
		const { m, done } = await pick({ current: pic('Art/Arms/lion.png') });
		dispatch(byName(m, 'eagle.svg'), 'click');
		expect(selectedNames(m)).toEqual(['eagle.svg']);
		dispatch(selectButton(m), 'click');
		expect(await done).toBe('[[eagle.svg]]');
	});

	it('the selected picture stays selected when its folder closes, and Select still chooses it', async () => {
		const { m, done } = await pick({ current: pic('Art/Arms/lion.png') });
		dispatch(byLabel(m, 'Close the folder Art'), 'click');
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
		expect(selectedNames(m)).toEqual([]);
		expect(selectButton(m).disabled).toBe(false);
		dispatch(selectButton(m), 'click');
		expect(await done).toBe('[[lion.png]]');
	});

	it('a folder row is never selected', async () => {
		const { m } = await pick();
		dispatch(byLabel(m, 'Open the folder Art'), 'click');
		expect(selectedNames(m)).toEqual([]);
		expect(selectButton(m).disabled).toBe(true);
	});

	it('Cancel gives null and nothing else is chosen', async () => {
		const { m, done } = await pick({ current: pic('Art/Arms/lion.png') });
		dispatch(m.contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(await done).toBeNull();
	});

	it('a tap on the device row opens the device file choice at once', async () => {
		const { m } = await pick();
		const clicked = fileChoice(m);
		dispatch(rowEls(m).find(isDevice)!, 'click');
		expect(clicked).toHaveBeenCalled();
		expect(openModals).toHaveLength(1);
	});
});

describe('V5, P7: the search', () => {
	it('replaces the folder view with the flat list of matches, with the folder under the name and no folder row', async () => {
		const { m } = await pick({ current: pic('Art/Arms/lion.png') });
		type(m, 'png');
		expect(list(m).getAttribute('role')).toBe('listbox');
		expect(shape(m)).toEqual(['device', 'lion.png', 'root.png', 'x.png']);
		expect(rowEls(m).every((r) => r.getAttribute('role') === 'option')).toBe(true);
		expect(byName(m, 'lion.png').getText()).toContain('Art/Arms');
		expect(byName(m, 'root.png').getText()).toContain(PICTURES_UI.topFolder);
	});

	it('every word must match; the "In use" mark shows in the search list too; the selection stays', async () => {
		const { m } = await pick({ current: pic('Art/Arms/lion.png') });
		type(m, 'ARMS lion');
		expect(shape(m)).toEqual(['device', 'lion.png']);
		expect(byName(m, 'lion.png').getText()).toContain('In use');
		expect(selectedNames(m)).toEqual(['lion.png']);
	});

	it('clearing the search returns to the folder view with the folders as the owner left them', async () => {
		const { m } = await pick();
		dispatch(byLabel(m, 'Open the folder Other'), 'click');
		type(m, 'lion');
		expect(shape(m)).toEqual(['device', 'lion.png']);
		type(m, '');
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Close the folder Other', 'x.png', 'root.png']);
		expect(list(m).getAttribute('role')).toBe('tree');
	});

	it('a picture selected in the search stays selected when the search is cleared (its folder is closed: Select still works)', async () => {
		const { m, done } = await pick();
		type(m, 'eagle');
		dispatch(byName(m, 'eagle.svg'), 'click');
		type(m, '');
		expect(selectButton(m).disabled).toBe(false);
		dispatch(selectButton(m), 'click');
		expect(await done).toBe('[[eagle.svg]]');
	});

	it('no match shows the text; the device row stays', async () => {
		const { m } = await pick();
		type(m, 'zzzz');
		expect(shape(m)).toEqual(['device']);
		expect(m.contentEl.getText()).toContain(PICTURES_UI.noMatch);
	});

	it('more than 200 matches: 200 picture rows and the text that says there are more', async () => {
		const many = Array.from({ length: 250 }, (_, i) => file(`Big/pic${String(i).padStart(3, '0')}.png`));
		const { m } = await pick({ files: many });
		type(m, 'pic');
		expect(rowEls(m).filter((r) => !isDevice(r))).toHaveLength(200);
		expect(m.contentEl.getText()).toContain('The vault has more pictures with this name. Type more of the name.');
	});
});

describe('P8, V4: the keyboard', () => {
	const activeLabel = (m: Picker) => {
		const id = search(m).getAttribute('aria-activedescendant');
		const r = rowEls(m).find((x) => x.getAttribute('id') === id);
		return r ? (isDevice(r) ? 'device' : isFolder(r) ? r.getAttribute('aria-label') : nameOf(r)) : null;
	};

	it('Up and Down move through the visible rows and wrap; the search field keeps the focus (aria-activedescendant)', async () => {
		const { m } = await pick();
		const s = search(m);
		expect(key(s, 'ArrowDown').defaultPrevented).toBe(true);
		expect(activeLabel(m)).toBe('device');
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('Open the folder Art');
		key(s, 'ArrowDown');
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('root.png');
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('device');
		key(s, 'ArrowUp');
		expect(activeLabel(m)).toBe('root.png');
		expect(fakeDoc.activeElement).toBe(s);
	});

	it('Right opens a closed folder and Left closes an open one; Enter or Space on a folder toggles it', async () => {
		const { m } = await pick();
		const s = search(m);
		key(s, 'ArrowDown');
		key(s, 'ArrowDown');
		expect(key(s, 'ArrowRight').defaultPrevented).toBe(true);
		expect(shape(m)).toContain('Close the folder Art');
		expect(shape(m)).toContain('Open the folder Art/Arms');
		expect(activeLabel(m)).toBe('Close the folder Art');
		key(s, 'ArrowLeft');
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
		key(s, 'Enter');
		expect(shape(m)).toContain('Close the folder Art');
		key(s, ' ');
		expect(shape(m)).toContain('Open the folder Art');
		expect(openModals).toHaveLength(1);
	});

	it('the cursor stays on its row when the rows change (a search starts)', async () => {
		const { m } = await pick();
		const s = search(m);
		key(s, 'ArrowUp');
		expect(activeLabel(m)).toBe('root.png');
		type(m, 'png');
		expect(shape(m)).toEqual(['device', 'lion.png', 'root.png', 'x.png']);
		expect(activeLabel(m)).toBe('root.png');
		key(s, 'ArrowUp');
		expect(activeLabel(m)).toBe('lion.png');
	});

	it('at open the cursor is on the current picture; Down goes past folders (the selection stays) and onto a picture, which it selects; Enter then chooses it', async () => {
		const { m, done } = await pick({ current: pic('Art/Arms/lion.png') });
		const s = search(m);
		expect(activeLabel(m)).toBe('lion.png');
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('Open the folder Art/Portraits');
		expect(selectedNames(m)).toEqual([]);
		expect(selectButton(m).disabled).toBe(false);
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('Open the folder Other');
		key(s, 'ArrowDown');
		expect(activeLabel(m)).toBe('root.png');
		expect(selectedNames(m)).toEqual(['root.png']);
		expect(key(s, 'Enter').defaultPrevented).toBe(true);
		expect(await done).toBe('[[root.png]]');
	});

	it('Enter on the device row opens the device file choice and does not close the picker', async () => {
		const { m } = await pick();
		const clicked = fileChoice(m);
		const s = search(m);
		key(s, 'ArrowDown');
		key(s, 'Enter');
		expect(clicked).toHaveBeenCalled();
		expect(openModals).toHaveLength(1);
	});

	it('Space, Left and Right where they do nothing are not intercepted, so the search field still takes a space and moves its caret', async () => {
		const { m } = await pick();
		const s = search(m);
		expect(key(s, ' ').defaultPrevented).toBe(false);
		expect(key(s, 'ArrowLeft').defaultPrevented).toBe(false);
		expect(key(s, 'ArrowRight').defaultPrevented).toBe(false);
		key(s, 'ArrowUp'); // the cursor is on the last row, a picture
		expect(key(s, ' ').defaultPrevented).toBe(false);
		expect(key(s, 'ArrowRight').defaultPrevented).toBe(false);
		expect(key(s, 'ArrowLeft').defaultPrevented).toBe(false);
	});

	it('Enter with no cursor does nothing', async () => {
		const { m } = await pick();
		key(search(m), 'Enter');
		expect(openModals).toHaveLength(1);
	});

	it('the keys are heard on the whole window, not only on the search field; a key on the buttons is left alone', async () => {
		const { m } = await pick();
		const first = key(list(m), 'ArrowDown');
		expect(first.defaultPrevented).toBe(true);
		expect(activeLabel(m)).toBe('device');
		const cancel = m.contentEl.querySelector('.dynasty-sheet-cancel')!;
		expect(key(cancel, 'ArrowDown').defaultPrevented).toBe(false);
		expect(key(cancel, 'Enter').defaultPrevented).toBe(false);
		expect(key(selectButton(m), 'Enter').defaultPrevented).toBe(false);
		expect(openModals).toHaveLength(1);
	});

	it('Arrow keys keep the row in view; a tap or a folder toggle by tap does not scroll', async () => {
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		const { m } = await pick();
		dispatch(byLabel(m, 'Open the folder Other'), 'click');
		dispatch(byLabel(m, 'Close the folder Other'), 'click');
		dispatch(byName(m, 'root.png'), 'click');
		expect(spy).not.toHaveBeenCalled();
		key(search(m), 'ArrowDown');
		expect(spy).toHaveBeenCalled();
		expect(spy.mock.calls.every((c) => ((c as unknown[])[0] as { block?: string } | undefined)?.block === 'nearest')).toBe(true);
	});
});

describe('V3: the scroll rule (defect fix)', () => {
	it('the scroller is put back to the top at 0, 60 and 200 ms, until the owner scrolls, presses a key, types or touches', async () => {
		const { m } = await pick();
		const b = body(m);
		expect(b.scrollTop).toBe(0);
		b.scrollTop = 87;
		runTimers(1);
		expect(b.scrollTop).toBe(0);
		b.scrollTop = 40;
		runTimers(100);
		expect(b.scrollTop).toBe(0);
		b.scrollTop = 25;
		runTimers(300);
		expect(b.scrollTop).toBe(0);
	});

	it.each(['wheel', 'touchmove', 'pointerdown', 'keydown', 'input'])('after a %s by the owner the scroller is left alone', async (type) => {
		// The control: with no owner action, the same scroll is undone.
		const control = await pick();
		body(control.m).scrollTop = 60;
		runTimers(1);
		expect(body(control.m).scrollTop).toBe(0);
		resetDom();
		resetObsidian();
		const { m } = await pick();
		dispatch(search(m), type, { key: 'a' });
		const b = body(m);
		b.scrollTop = 60;
		runTimers(300);
		expect(b.scrollTop).toBe(60);
	});

	it('the first visualViewport resize puts the scroller to the top; the API may be missing', async () => {
		const listeners: Record<string, (() => void)[]> = {};
		(fakeWin as unknown as Record<string, unknown>).visualViewport = {
			height: 400,
			offsetTop: 0,
			addEventListener: (t: string, fn: () => void) => (listeners[t] = [...(listeners[t] ?? []), fn]),
			removeEventListener: () => {},
		};
		device.width = 390;
		const { m } = await pick();
		runTimers(300);
		const b = body(m);
		b.scrollTop = 33;
		for (const fn of listeners.resize ?? []) fn();
		expect(b.scrollTop).toBe(0);
		// A window with no visualViewport opens without an error.
		delete (fakeWin as { visualViewport?: unknown }).visualViewport;
		resetObsidian();
		const again = await pick();
		expect(rowEls(again.m).length).toBeGreaterThan(0);
	});
});

describe('D95, V4: the keyboard focus', () => {
	it('on the computer the search field has the focus at open, and takes it back when Obsidian moves it', async () => {
		device.coarse = false;
		const { m } = await pick();
		expect(fakeDoc.activeElement).toBe(search(m));
		m.contentEl.querySelector('.dynasty-sheet-cancel')!.focus();
		runTimers(300);
		expect(fakeDoc.activeElement).toBe(search(m));
	});

	it('on a touch-first device the search field never gets the focus: not at open, not by a later timer', async () => {
		device.coarse = true;
		const { m } = await pick();
		const focus = vi.spyOn(search(m), 'focus');
		expect(fakeDoc.activeElement).not.toBe(search(m));
		m.contentEl.querySelector('.dynasty-sheet-cancel')!.focus();
		runTimers(1000);
		await settle();
		expect(fakeDoc.activeElement).not.toBe(search(m));
		expect(focus).not.toHaveBeenCalled();
	});

	it('on a touch-first device the search field is never focused during open (a spy set before open sees no call)', async () => {
		device.coarse = true;
		const spy = vi.spyOn(FEl.prototype, 'focus');
		const { m } = await pick();
		runTimers(1000);
		expect(spy.mock.contexts.some((c) => c === search(m))).toBe(false);
	});

	it('isTouchFirst reads the coarse pointer of the given window; a missing or throwing matchMedia is false', async () => {
		const M = (await pickerModule()) as { isTouchFirst: (w: never) => boolean };
		device.coarse = true;
		expect(M.isTouchFirst(fakeWin as never)).toBe(true);
		device.coarse = false;
		expect(M.isTouchFirst(fakeWin as never)).toBe(false);
		expect(M.isTouchFirst({} as never)).toBe(false);
		expect(
			M.isTouchFirst({
				matchMedia: () => {
					throw new Error('no');
				},
			} as never),
		).toBe(false);
		expect(M.isTouchFirst({ matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) } as never)).toBe(true);
	});
});

describe('V1: currentPictureOf', () => {
	it('gives the file that the store resolves, and null for no link, no store, a problem, or an error', async () => {
		const M = (await pickerModule()) as { currentPictureOf: (s: unknown, l: string | null | undefined, p: string) => VaultFile | null };
		const { store } = fakeStore();
		expect(M.currentPictureOf(store, '[[lion.png]]', 'Tree.md')).toBe(pic('Art/Arms/lion.png'));
		expect(M.currentPictureOf(store, '[[gone.png]]', 'Tree.md')).toBeNull();
		expect(M.currentPictureOf(store, '[[a.md]]', 'Tree.md')).toBeNull();
		expect(M.currentPictureOf(store, null, 'Tree.md')).toBeNull();
		expect(M.currentPictureOf(store, undefined, 'Tree.md')).toBeNull();
		expect(M.currentPictureOf(store, '', 'Tree.md')).toBeNull();
		expect(M.currentPictureOf(undefined, '[[lion.png]]', 'Tree.md')).toBeNull();
		const broken = {
			resolve: () => {
				throw new Error('x');
			},
		};
		expect(M.currentPictureOf(broken, '[[lion.png]]', 'Tree.md')).toBeNull();
	});

	it('passes the link and the note path to the store\'s `resolve`, as the cards do', async () => {
		const M = (await pickerModule()) as { currentPictureOf: (s: unknown, l: string, p: string) => VaultFile | null };
		const resolve = vi.fn(() => ({ ok: false, code: 'picture-missing', file: 'x' }));
		M.currentPictureOf({ resolve }, '[[lion.png]]', 'Trees/Tree.md');
		expect(resolve).toHaveBeenCalledWith('[[lion.png]]', 'Trees/Tree.md');
	});
});

describe('V8: the texts', () => {
	it('PICKER_UI has the new texts', async () => {
		const U = (await pickerUiOf()) as { inUse: string; inUseLabel: string; openFolder: (p: string) => string; closeFolder: (p: string) => string; more: string };
		expect(U.inUse).toBe('In use');
		expect(U.inUseLabel).toBe('This picture is in use now');
		expect(U.openFolder('Art/Arms')).toBe('Open the folder Art/Arms');
		expect(U.closeFolder('Art/Arms')).toBe('Close the folder Art/Arms');
		expect(U.more).toBe('The vault has more pictures with this name. Type more of the name.');
	});

	it('the texts of the large preview and the 200-row list are gone from PICTURES_UI; the others stay', () => {
		const keys = Object.keys(PICTURES_UI);
		for (const gone of ['previewEmpty', 'previewProblem', 'previewLabel', 'more']) expect(keys, gone).not.toContain(gone);
		for (const stay of ['search', 'searchLabel', 'fromDevice', 'fromDeviceDetail', 'noMatch', 'noPictures', 'select', 'cancel', 'added', 'addFailed', 'topFolder']) expect(keys, stay).toContain(stay);
	});
});

// ---------- row previews (V6) ----------

const COPY_BOX = { w: 32, h: 32, fit: 'meet' };

interface LoaderKit {
	rp: { update(): void; rowsChanged(): void; dispose(): void; readonly loading: number; readonly held: number };
	asked: Asked[];
	released: string[];
	copy: () => PictureCopy;
	boxes: FEl[];
	tops: number[];
	shift: (dy: number) => void;
	setRows: (n: number) => void;
}

/** A preview loader on `n` rows of 44 px, in a scroller that shows 0 to 500 px. */
async function loader(n: number): Promise<LoaderKit> {
	const M = (await pickerModule()) as { createRowPreviews: (o: unknown) => LoaderKit['rp'] };
	const { store, asked, released, copy } = fakeStore();
	const scroller = new FEl('div');
	Object.assign(scroller, { getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 300, x: 0, y: 0, width: 300, height: 500 }) });
	let offset = 0;
	const tops: number[] = [];
	const boxes: FEl[] = [];
	const refs: { key: string; file: VaultFile; box: FEl }[] = [];
	const make = (i: number) => {
		tops[i] = i * 44;
		const box = new FEl('span');
		Object.assign(box, { getBoundingClientRect: () => ({ top: tops[i] + offset, bottom: tops[i] + offset + 44, left: 0, right: 300, x: 0, y: tops[i] + offset, width: 300, height: 44 }) });
		boxes[i] = box;
		refs[i] = { key: `picture:p${i}.png`, file: file(`p${i}.png`), box };
	};
	for (let i = 0; i < n; i++) make(i);
	let live = refs;
	const rp = M.createRowPreviews({ store, scroller, rows: () => live });
	return {
		rp,
		asked,
		released,
		copy,
		boxes,
		tops,
		shift: (dy) => (offset += dy),
		setRows: (k) => (live = refs.slice(0, k)),
	};
}

const imgOf = (box: FEl) => box.querySelector('img');

describe('V6: the row previews (createRowPreviews)', () => {
	it('the constants: a 32 px box, 44 px rows, 4 loads at once', () => {
		expect(PREVIEW_BOX_PX).toBe(32);
		expect(PREVIEW_BOX).toEqual(COPY_BOX);
		expect(PICKER_ROW_PX).toBe(44);
		expect(PREVIEW_LOADS).toBe(4);
	});

	it('an update loads the rows in view first, at most 4 at once, with the 32 px box that keeps the proportions', async () => {
		const k = await loader(30);
		k.rp.update();
		expect(k.asked.map((a) => a.file.name)).toEqual(['p0.png', 'p1.png', 'p2.png', 'p3.png']);
		expect(k.asked.every((a) => JSON.stringify(a.box) === JSON.stringify(COPY_BOX))).toBe(true);
		expect(k.asked.every((a) => a.signal !== undefined && !a.signal.aborted)).toBe(true);
		expect(k.rp.loading).toBe(4);
		k.rp.update();
		expect(k.asked).toHaveLength(4);
	});

	it('a ready copy puts an <img> with an empty alt in the box; the next row then starts', async () => {
		const k = await loader(30);
		k.rp.update();
		const c = k.copy();
		k.asked[0].resolve(c);
		await settle();
		const img = imgOf(k.boxes[0])!;
		expect(img).not.toBeNull();
		expect(img.getAttribute('src')).toBe(c.url);
		expect(img.getAttribute('alt')).toBe('');
		expect(k.rp.held).toBe(1);
		expect(k.asked.map((a) => a.file.name)).toEqual(['p0.png', 'p1.png', 'p2.png', 'p3.png', 'p4.png']);
		expect(k.rp.loading).toBe(4);
	});

	it('only the rows within one scroller height of the visible part load (rows 0 to 22 of 30); every one of them finishes', async () => {
		const k = await loader(30);
		k.rp.update();
		for (let i = 0; i < 100; i++) {
			const open = k.asked.filter((a) => !(a as Asked & { done?: boolean }).done);
			if (!open.length) break;
			for (const a of open) {
				(a as Asked & { done?: boolean }).done = true;
				a.resolve(k.copy());
			}
			await settle();
			k.rp.update();
		}
		expect(k.asked).toHaveLength(23);
		expect(k.rp.held).toBe(23);
		expect(imgOf(k.boxes[22])).not.toBeNull();
		expect(imgOf(k.boxes[23])).toBeNull();
	});

	it('a problem result leaves an empty frame with the class is-problem, no picture and no text; the store copy is not held', async () => {
		const k = await loader(1);
		k.rp.update();
		k.asked[0].resolve({ ok: false, code: 'picture-not-image', file: 'p0.png' });
		await settle();
		expect(k.boxes[0].hasClass('is-problem')).toBe(true);
		expect(imgOf(k.boxes[0])).toBeNull();
		expect(k.boxes[0].getText()).toBe('');
		expect(k.rp.held).toBe(0);
		expect(k.rp.loading).toBe(0);
	});

	it('a null result leaves the box empty and the next update asks again; the box is never marked as a problem', async () => {
		const k = await loader(1);
		k.rp.update();
		k.asked[0].resolve(null);
		await settle();
		expect(imgOf(k.boxes[0])).toBeNull();
		expect(k.boxes[0].hasClass('is-problem')).toBe(false);
		expect(k.rp.loading).toBe(0);
		k.rp.update();
		expect(k.asked).toHaveLength(2);
		expect(k.asked[1].file.name).toBe('p0.png');
	});

	it('a row that leaves the near range is cancelled; its copy is released and its <img> goes; the row loads again when it returns', async () => {
		const k = await loader(3);
		k.rp.update();
		const copies = k.asked.map(() => k.copy());
		k.asked[0].resolve(copies[0]);
		k.asked[1].resolve(copies[1]);
		await settle();
		expect(k.rp.held).toBe(2);
		k.shift(5000);
		k.rp.update();
		expect(k.asked[2].signal!.aborted).toBe(true);
		expect(k.released.sort()).toEqual([copies[0].url, copies[1].url].sort());
		expect(imgOf(k.boxes[0])).toBeNull();
		expect(imgOf(k.boxes[1])).toBeNull();
		expect(k.rp.held).toBe(0);
		expect(k.rp.loading).toBe(0);
		k.shift(-5000);
		k.rp.update();
		expect(k.asked.length).toBe(6);
	});

	it('rowsChanged cancels the loads and releases the copies of rows that are gone; the other rows stay', async () => {
		const k = await loader(3);
		k.rp.update();
		const c0 = k.copy();
		const c1 = k.copy();
		k.asked[0].resolve(c0);
		k.asked[1].resolve(c1);
		await settle();
		k.setRows(1);
		k.rp.rowsChanged();
		expect(k.released).toEqual([c1.url]);
		expect(k.asked[2].signal!.aborted).toBe(true);
		expect(k.asked[0].signal!.aborted).toBe(false);
		expect(imgOf(k.boxes[0])).not.toBeNull();
		expect(k.rp.held).toBe(1);
	});

	it('a copy that arrives for a row that was removed is released at once and never used', async () => {
		const k = await loader(2);
		k.rp.update();
		k.setRows(1);
		k.rp.rowsChanged();
		const late = k.copy();
		k.asked[1].resolve(late);
		await settle();
		expect(k.released).toContain(late.url);
		expect(imgOf(k.boxes[1])).toBeNull();
		expect(k.rp.held).toBe(0);
	});

	it('a copy of an old request (another load token) is released at once; the new request is used', async () => {
		const k = await loader(1);
		k.rp.update();
		k.shift(5000);
		k.rp.update();
		k.shift(-5000);
		k.rp.update();
		expect(k.asked).toHaveLength(2);
		const old = k.copy();
		const fresh = k.copy();
		k.asked[0].resolve(old);
		await settle();
		expect(k.released).toContain(old.url);
		expect(imgOf(k.boxes[0])).toBeNull();
		k.asked[1].resolve(fresh);
		await settle();
		expect(imgOf(k.boxes[0])!.getAttribute('src')).toBe(fresh.url);
		expect(k.released).not.toContain(fresh.url);
	});

	it('dispose cancels every load, releases every copy, and a copy that arrives later is released at once', async () => {
		const k = await loader(6);
		k.rp.update();
		const c = k.copy();
		k.asked[0].resolve(c);
		await settle();
		k.rp.dispose();
		expect(k.asked.every((a, i) => i === 0 || a.signal!.aborted)).toBe(true);
		expect(k.released).toContain(c.url);
		expect(k.rp.held).toBe(0);
		expect(k.rp.loading).toBe(0);
		const late = k.copy();
		k.asked[1].resolve(late);
		await settle();
		expect(k.released).toContain(late.url);
		expect(imgOf(k.boxes[1])).toBeNull();
		k.rp.update();
		expect(k.asked.length).toBeLessThanOrEqual(5);
	});

	it('every copy is released once, and none twice', async () => {
		const k = await loader(3);
		k.rp.update();
		for (const a of k.asked) a.resolve(k.copy());
		await settle();
		k.rp.dispose();
		k.rp.dispose();
		expect(k.released.sort()).toEqual([...new Set(k.released)].sort());
		expect(k.released).toHaveLength(3);
	});

	it('with no store the boxes stay empty and nothing loads', async () => {
		const M = (await pickerModule()) as { createRowPreviews: (o: unknown) => { update(): void; readonly loading: number } };
		const box = new FEl('span');
		const rp = M.createRowPreviews({ store: undefined, scroller: new FEl('div'), rows: () => [{ key: 'picture:a.png', file: file('a.png'), box }] });
		rp.update();
		expect(rp.loading).toBe(0);
		expect(imgOf(box)).toBeNull();
	});
});

describe('V6, spec §13.14: the previews in the picker', () => {
	it('the list is drawn at open with no load; the first load starts in the next frame, at most 4 at once', async () => {
		const kit = fakeStore();
		await pick({ current: pic('Art/Arms/lion.png'), store: kit.store });
		expect(kit.asked).toHaveLength(0);
		runFrame();
		await settle();
		expect(kit.asked.length).toBeGreaterThan(0);
		expect(kit.asked.length).toBeLessThanOrEqual(4);
		expect(kit.asked.every((a) => JSON.stringify(a.box) === JSON.stringify(COPY_BOX))).toBe(true);
	});

	it('the copies are released when the picker closes: no copy is held after Cancel', async () => {
		const kit = fakeStore();
		const { m } = await pick({ current: pic('Art/Arms/lion.png'), store: kit.store });
		runFrame();
		await settle();
		for (const a of kit.asked) a.resolve(kit.copy());
		await settle();
		expect(kit.made.length).toBeGreaterThan(0);
		dispatch(m.contentEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(kit.released.sort()).toEqual([...kit.made].sort());
	});

	it('a folder that closes cancels the loads of its rows and releases their copies', async () => {
		const kit = fakeStore();
		const { m } = await pick({ current: pic('Art/Arms/lion.png'), store: kit.store });
		runFrame();
		await settle();
		const first = kit.asked.slice();
		dispatch(byLabel(m, 'Close the folder Art'), 'click');
		runFrame();
		await settle();
		for (const a of first) {
			if (a.file.path.startsWith('Art/')) expect(a.signal!.aborted).toBe(true);
		}
	});

	it('a picture with a problem shows an empty frame, and the list is still usable', async () => {
		const kit = fakeStore();
		const { m, done } = await pick({ current: pic('Art/Arms/lion.png'), store: kit.store });
		runFrame();
		await settle();
		kit.asked[0].resolve({ ok: false, code: 'picture-not-image', file: kit.asked[0].file.path });
		await settle();
		expect(m.contentEl.querySelectorAll('.is-problem').length).toBeGreaterThan(0);
		dispatch(byName(m, 'lion.png'), 'click');
		dispatch(byName(m, 'lion.png'), 'click');
		expect(await done).toBe('[[lion.png]]');
	});

	it('the picker opens with names at once when the store never answers', async () => {
		const kit = fakeStore();
		const { m } = await pick({ store: kit.store });
		expect(shape(m)).toEqual(['device', 'Open the folder Art', 'Open the folder Other', 'root.png']);
	});
});

// ---------- V2, V5: the style sheet ----------

const RULES = cssRules(readFileSync('styles.css', 'utf8'));
const pickerRules = RULES.filter((r) => r.selectors.some((s) => s.includes('dynasty-picture')));

describe('V2, V5: the style sheet of the picker', () => {
	it('a rule for the picker rows has content-visibility: auto and contain-intrinsic-size: auto 44px', () => {
		const rule = pickerRules.find((r) => /content-visibility\s*:\s*auto/.test(r.body));
		expect(rule, 'a picker rule with content-visibility').toBeDefined();
		expect(rule!.body).toMatch(/contain-intrinsic-size\s*:\s*auto 44px/);
	});

	it('a picker row is at least 44 px high (spec §7.5)', () => {
		expect(pickerRules.some((r) => /min-height\s*:\s*44px/.test(r.body))).toBe(true);
	});

	it('the large preview and its phone rules are gone: no rule for the preview box, image, name or text, and no column-reverse', () => {
		const names = ['.dynasty-picture-preview-box', '.dynasty-picture-preview-img', '.dynasty-picture-preview-name', '.dynasty-picture-preview-text'];
		for (const r of pickerRules) {
			for (const s of r.selectors) {
				expect(
					names.some((n) => s.includes(n)),
					s,
				).toBe(false);
				expect(/\.dynasty-picture-preview(?![\w-])/.test(s), s).toBe(false);
			}
			expect(r.body, r.selectors.join(', ')).not.toMatch(/column-reverse/);
		}
	});
});
