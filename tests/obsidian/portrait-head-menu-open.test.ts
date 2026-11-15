import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { createPictureStore, type PictureCopy, type PictureStore } from '../../src/obsidian/picture-store';
import { FEl, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { lastMenu, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { vaultFile as file } from '../support/rename-vault';
import { bareWritingHandle as writingHandle } from '../support/writing-handle';

/*
 * The portrait in the head of the person window stayed dark on the iPhone while the portrait menu was open.
 * Part 1: the plugin code does nothing to the portrait when the menu opens (same node, same address, no copy released, no new copy asked).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const BODY = `houses:
  - id: valmont
    name: House Valmont
    arms: "[[valmont-arms.png]]"
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    portrait: "[[aldric.jpg]]"
`;

function setup(body = BODY) {
	const files: VaultFile[] = [file('Pictures/valmont-arms.png'), file('Pictures/aldric.jpg')];
	const app = {
		metadataCache: { getFirstLinkpathDest: (path: string) => files.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null, getFiles: () => files },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	const released: string[] = [];
	let asked = 0;
	const copy = (): PictureCopy => {
		const url = `blob:c${asked++}`;
		return { url, w: 80, h: 80, release: () => released.push(url) };
	};
	const store: PictureStore = {
		...createPictureStore(app as never),
		acquire: async () => copy(),
		transient: async () => copy(),
		pixels: async () => new Uint8ClampedArray(64 * 64 * 4).fill(255),
	};
	const handle = writingHandle(body);
	const sheet = EditSheet.create(app as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md', pictures: store })!;
	sheet.open();
	const content = (sheet as unknown as { contentEl: FEl }).contentEl;
	return { sheet, content, released, asked: () => asked };
}

describe('the portrait of the head while the portrait menu is open', () => {
	it('a tap on the portrait leaves the image node, its address and its copy as they were', async () => {
		const { content, released, asked } = setup();
		await settle();
		const pic = content.querySelector('.dynasty-pic')!;
		const img = content.querySelector('.dynasty-pic-img')!;
		const src = img.getAttribute('src');
		const asksBefore = asked();
		dispatch(pic, 'click');
		expect(lastMenu()).toBeDefined();
		await settle();
		expect(content.querySelector('.dynasty-pic-img'), 'the same image node').toBe(img);
		expect(img.getAttribute('src')).toBe(src);
		expect(pic.hasClass('has-picture')).toBe(true);
		expect(pic.hasClass('is-none')).toBe(false);
		expect(released, 'no copy was released').toEqual([]);
		expect(asked(), 'no new copy was asked for').toBe(asksBefore);
	});
});

/*
 * Part 2: the style rule. `.dynasty-pic:hover::after` paints a shade over the round picture. On an iPhone a tap leaves `:hover` on the tapped button until the next
 * tap elsewhere, and the portrait menu is open exactly then (proven on the phone: a snippet that hides the shade keeps the portrait visible). The shade belongs to a mouse only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text before the `{` of every block that encloses `at`, outermost first, with comments taken out. */
function enclosing(css: string, at: number): string[] {
	const out: string[] = [];
	let depth = 0;
	for (let i = at; i >= 0; i--) {
		if (css[i] === '}') depth++;
		else if (css[i] === '{') {
			if (depth === 0) {
				const start = Math.max(css.lastIndexOf('}', i), css.lastIndexOf('{', i - 1), css.lastIndexOf(';', i)) + 1;
				out.unshift(css.slice(start, i).trim());
			} else depth--;
		}
	}
	return out;
}

describe('the hover shade of the head portrait', () => {
	it('is inside @media (hover: hover) and (pointer: fine), so a tap on a touch screen does not leave it painted while the menu is open', () => {
		const css = readFileSync(fileURLToPath(new URL('../../styles/10-edit-sheet.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const at = css.indexOf('.dynasty-pic:hover::after');
		expect(at).toBeGreaterThan(0);
		const wraps = enclosing(css, at).filter((s) => s.startsWith('@media'));
		expect(wraps, 'enclosing at-rules').toEqual(['@media (hover: hover) and (pointer: fine)']);
	});

	it('the helper finds the guard of `.dynasty-link:hover`, which is inside @media (hover: hover) in 01-base.css', () => {
		const css = readFileSync(fileURLToPath(new URL('../../styles/01-base.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const wraps = enclosing(css, css.indexOf('.dynasty-link:hover')).filter((s) => s.startsWith('@media'));
		expect(wraps.some((w) => /hover:\s*hover/.test(w))).toBe(true);
	});
});
