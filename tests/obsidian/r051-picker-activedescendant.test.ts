import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { FEl, device, dispatch, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { pickerModule } from '../acceptance/m11-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D320 (0.5.1): a screen reader follows only the focused element, so the picture picker names the cursor row (aria-activedescendant)
 * on whichever element has the focus: the search field on a computer, the window itself on a touch-first device.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => {
	vi.restoreAllMocks();
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}
const VAULT = ['Art/Arms/lion.png', 'Art/Arms/eagle.svg', 'root.png'].map(file);

const app = {
	metadataCache: { getFirstLinkpathDest: () => null },
	vault: { getAbstractFileByPath: (p: string) => VAULT.find((f) => f.path === p) ?? null, getFiles: () => VAULT },
	fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
	loadLocalStorage: () => null,
	saveLocalStorage: () => {},
};

type Picker = { contentEl: FEl; modalEl: FEl };
async function open(): Promise<Picker> {
	const M = (await pickerModule()) as { pickPicture: (a: never, o: never) => Promise<unknown> };
	void M.pickPicture(app as never, { sourcePath: 'Trees/Tree.md', title: 'Select' } as never);
	return openModals[openModals.length - 1] as unknown as Picker;
}
const hasCursor = (m: Picker) => m.contentEl.querySelectorAll('[role="treeitem"], [role="option"]').some((r) => r.hasClass('is-cursor'));
const key = (target: FEl, k: string) => dispatch(target, 'keydown', { key: k });

describe('picture picker: the element that has the focus names the cursor row', () => {
	it('touch-first: after ArrowDown on the focused window, the window names the active row', async () => {
		device.coarse = true;
		const m = await open();
		expect(fakeDoc.activeElement).toBe(m.modalEl);
		key(m.modalEl, 'ArrowDown');
		expect(hasCursor(m)).toBe(true);
		expect((fakeDoc.activeElement as FEl).getAttribute('aria-activedescendant'), 'the focused element names no active row').toBeTruthy();
	});

	it('computer: after ArrowDown in the search field, the field names the active row and the window does not', async () => {
		device.coarse = false;
		const m = await open();
		const search = m.contentEl.querySelector('.dynasty-picture-search')!;
		expect(fakeDoc.activeElement).toBe(search);
		key(search, 'ArrowDown');
		expect(hasCursor(m)).toBe(true);
		expect(search.getAttribute('aria-activedescendant')).toBeTruthy();
		expect(m.modalEl.getAttribute('aria-activedescendant')).toBeNull();
	});
});
