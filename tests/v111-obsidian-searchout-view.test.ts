import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { pickPicture, pickerScroller } from '../src/obsidian/picture-picker';
import { FEl, device, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { cssRules } from './acceptance/m11-support';

/*
 * 0.2.1 WP6a, D102 (spec §13.16 rule 10): the search field of the picture list is not inside the
 * scrolling list. It sits in a bar between the header and the sheet body, which is the scroller. On the
 * iPhone the scroller that held the focused field scrolled by its full length when the keyboard opened.
 * Run: npx vitest run tests/v111-obsidian-searchout-view.test.ts
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	device.coarse = false;
	device.width = 1280;
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

const VAULT = ['Art/Arms/lion.png', 'Art/Arms/eagle.svg', 'Other/x.png', 'root.png'].map(file);

function app() {
	return {
		metadataCache: { getFirstLinkpathDest: (path: string) => VAULT.find((f) => f.path === path || f.path.endsWith(`/${path}`)) ?? null },
		vault: { getAbstractFileByPath: (p: string) => VAULT.find((f) => f.path === p) ?? null, getFiles: () => VAULT },
		fileManager: { generateMarkdownLink: (f: VaultFile) => `![[${f.name}]]` },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

type Picker = { contentEl: FEl; modalEl: FEl; close(): void };

function pick(o: { current?: VaultFile | null; remove?: string } = {}) {
	void pickPicture(app() as never, { sourcePath: 'Trees/Tree.md', title: 'Select', current: o.current ?? null, remove: o.remove });
	return openModals[openModals.length - 1] as unknown as Picker;
}

const search = (m: Picker) => m.contentEl.querySelector('.dynasty-picture-search')!;
const scroller = (m: Picker) => pickerScroller(m.modalEl as never) as unknown as FEl;
const rows = (m: Picker) => m.contentEl.querySelectorAll('[role="treeitem"], [role="option"]');

/** What iOS did on the phone: it scrolls the nearest scroller that holds the focused field, to its end. */
function iosScrollsHolderOfFocus(m: Picker): void {
	const holder = (fakeDoc.activeElement as FEl | null)?.closest('.dynasty-sheet-body');
	if (holder) holder.scrollTop = 328;
	void m;
}

/** A visualViewport double whose resize listeners the test fires, as the keyboard does. */
function keyboardViewport() {
	const listeners: Record<string, (() => void)[]> = {};
	const vv = {
		height: 874,
		offsetTop: 0,
		addEventListener: (t: string, fn: () => void) => (listeners[t] = [...(listeners[t] ?? []), fn]),
		removeEventListener: () => {},
	};
	(fakeWin as unknown as Record<string, unknown>).visualViewport = vv;
	return {
		open: () => {
			vv.height = 573;
			for (const fn of listeners.resize ?? []) fn();
		},
	};
}

describe('D102: the structure', () => {
	it.each([
		['the computer', false, 1280],
		['the phone', true, 390],
	])('on %s the search field is not inside the scroller', (_name, coarse, width) => {
		device.coarse = coarse;
		device.width = width;
		const m = pick();
		const body = scroller(m);
		expect(body.hasClass('dynasty-sheet-body')).toBe(true);
		expect(body.contains(search(m))).toBe(false);
		expect(search(m).closest('.dynasty-sheet-body')).toBeNull();
		expect(body.contains(m.contentEl.querySelector('.dynasty-picture-list'))).toBe(true);
	});

	it('the content is the top (the heading, the hint and the search bar), then the scroller, then the footer, in this order', () => {
		const m = pick();
		const kids = m.contentEl.children.map((c) => [...c.classes].find((n) => /^dynasty-(picture-top|foot|sheet-body)$/.test(n))).filter(Boolean);
		expect(kids).toEqual(['dynasty-picture-top', 'dynasty-sheet-body', 'dynasty-foot']);
		expect(search(m).parentElement?.parentElement?.hasClass('dynasty-picture-top')).toBe(true);
		expect(search(m).parentElement?.hasClass('dynasty-picture-searchbar')).toBe(true);
	});

	it('the search field keeps its label and its link to the list; the list keeps its roles', () => {
		const m = pick({ remove: 'Remove arms' });
		const s = search(m);
		expect(s.getAttribute('aria-label')).toBeTruthy();
		expect(s.getAttribute('aria-controls')).toBe('dynasty-picture-list');
		expect(m.contentEl.querySelector('.dynasty-picture-list')?.getAttribute('role')).toBe('tree');
		expect(rows(m).every((r) => r.getAttribute('role') === 'treeitem')).toBe(true);
		s.value = 'lion';
		dispatch(s, 'input');
		expect(m.contentEl.querySelector('.dynasty-picture-list')?.getAttribute('role')).toBe('listbox');
		expect(search(m).parentElement?.hasClass('dynasty-picture-searchbar')).toBe(true);
	});

	it('typing draws the search list inside the scroller; the field stays in the bar', () => {
		const m = pick();
		const s = search(m);
		s.value = 'png';
		dispatch(s, 'input');
		expect(scroller(m).querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
		expect(scroller(m).contains(s)).toBe(false);
	});
});

describe('D102: the scroller does not move when the field gets the focus', () => {
	it('on the computer, with the focus at open, the scroller stays at 0', async () => {
		const m = pick({ remove: 'Remove arms' });
		expect(fakeDoc.activeElement).toBe(search(m));
		iosScrollsHolderOfFocus(m);
		runTimers(1000);
		await settle();
		expect(scroller(m).scrollTop).toBe(0);
	});

	it('on the phone, a tap on the field and the keyboard resize leave the scroller at 0', async () => {
		device.coarse = true;
		device.width = 390;
		const kb = keyboardViewport();
		const m = pick({ remove: 'Remove arms' });
		runTimers(1000);
		expect(fakeDoc.activeElement).not.toBe(search(m));
		dispatch(search(m), 'pointerdown');
		search(m).focus();
		iosScrollsHolderOfFocus(m);
		kb.open();
		iosScrollsHolderOfFocus(m);
		runTimers(1000);
		await settle();
		expect(fakeDoc.activeElement).toBe(search(m));
		expect(scroller(m).scrollTop).toBe(0);
	});

	it('the field is outside the scroller, so a scrolled list does not take it away', () => {
		const m = pick();
		scroller(m).scrollTop = 500;
		expect(scroller(m).contains(search(m))).toBe(false);
		expect(search(m).parentElement?.parentElement?.parentElement).toBe(m.contentEl);
	});

	it('the first visualViewport resize still puts the scroller to the top', () => {
		device.coarse = true;
		device.width = 390;
		const kb = keyboardViewport();
		const m = pick();
		runTimers(300);
		scroller(m).scrollTop = 40;
		kb.open();
		expect(scroller(m).scrollTop).toBe(0);
	});
});

describe('D102: the style', () => {
	const css = readFileSync('styles.css', 'utf8');
	const rule = (sel: string) => cssRules(css).filter((r) => r.selectors.includes(sel));

	it('the bar does not shrink or scroll, and uses theme variables only', () => {
		const bar = rule('.dynasty-picture-searchbar');
		expect(bar).toHaveLength(1);
		const body = bar[0].body;
		expect(body).toMatch(/flex:\s*none/);
		expect(body).not.toMatch(/overflow/);
		expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
		// The sheet header has a border under it, so the bar has one too.
		expect(body).toMatch(/border-bottom:\s*1px solid var\(--background-modifier-border\)/);
	});

	it('the sheet body stays the only scroller of the picker', () => {
		expect(rule('.dynasty-sheet-body')[0].body).toMatch(/overflow-y:\s*auto/);
		expect(cssRules(css).filter((r) => r.selectors.some((s) => s.includes('dynasty-picture-searchbar')) && /overflow/.test(r.body))).toHaveLength(0);
	});
});
