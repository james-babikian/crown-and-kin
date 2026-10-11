import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { pickPerson } from '../src/obsidian/person-picker';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { SUCCESSION_UI } from '../src/render/succession-text';
import { SETTINGS_UI, WINDOW_UI } from '../src/render/ui-text';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, fakeHost } from './acceptance/tree-view-fakes';

/*
 * 0.2.8 typography round, package T2a (D218 items 1 to 6, 8, 9; D216 item 3): the person window, Find, the picture picker and the crop
 * tool. The DOM is checked in the fake DOM; the style rules are read from the chunks in `styles/`.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const chunk = (name: string): string => readFileSync(fileURLToPath(new URL(`../styles/${name}`, import.meta.url)), 'utf8');

/** The text of a style sheet with the comments taken out, so that a rule is not found inside a comment. */
const bare = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const BODY = `people:
  - {id: plain, name: Plain Person, born: 1100}
  - {id: shield, name: Shield Person, born: 1110, arms: "[[shield.png]]"}
  - {id: linked, name: Linked Person, born: 1120, link: "[[Linked Person]]"}
`;

function openSheet(id: string) {
	const handle = fakeHandle('Trees/Tree.md', BODY);
	const file = Object.assign(new (VaultFile as unknown as new (path: string, extension: string) => VaultFile)('Linked Person.md', 'md'), { name: 'Linked Person.md', basename: 'Linked Person' });
	const app = {
		fileManager: { generateMarkdownLink: () => '[[x]]' },
		vault: { getAbstractFileByPath: () => null, getFiles: () => [] },
		metadataCache: { getFirstLinkpathDest: () => file },
		workspace: { openLinkText: vi.fn(), getLeaf: vi.fn() },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	const sheet = EditSheet.create(app as never, { handle: handle as never, personId: id, sourcePath: 'Trees/Tree.md' })!;
	sheet.open();
	return { content: (sheet as unknown as { contentEl: FEl }).contentEl };
}

describe('N21: the link that adds a portrait or personal arms (D218 item 8)', () => {
	it('says "Add portrait or arms" for a person with no portrait and no personal arms', () => {
		const add = openSheet('plain').content.querySelector('.dynasty-openall .dynasty-add-portrait')!;
		expect(add.getText()).toBe('Add portrait or arms');
		expect(add.hidden).toBe(false);
	});

	it('says "Add portrait" when the person has personal arms already', () => {
		const add = openSheet('shield').content.querySelector('.dynasty-openall .dynasty-add-portrait')!;
		expect(add.getText()).toBe('Add portrait');
		expect(WINDOW_UI.addPortraitHasArms).toBe('Add portrait');
	});
});

describe('N24 and N22: the summaries of the closed sections (D218 item 6, D216 item 3)', () => {
	it('the closed Actions section has no summary', () => {
		const sum = openSheet('plain').content.querySelector('section[data-section="actions"] .dynasty-section-sum')!;
		expect(sum.getText()).toBe('');
	});

	it('the closed Notes section with no linked note and no notes says "No notes"', () => {
		const sum = openSheet('plain').content.querySelector('section[data-section="notes"] .dynasty-section-sum')!;
		expect(sum.getText()).toBe('No notes');
	});

	it('the closed Notes section with a linked note still names it', () => {
		const sum = openSheet('linked').content.querySelector('section[data-section="notes"] .dynasty-section-sum')!;
		expect(sum.getText()).toBe('Linked note: Linked Person');
	});
});

describe('Find: the relation word is italic (D218 item 4)', () => {
	const SRC = 'options:\n  me: a\npeople:\n  - {id: a, name: Ann, born: 1100}\n  - {id: b, name: Bob, parents: [a], born: 1130, died: 1190, title: Count}\n';

	function subs() {
		const r = parseDynasty(SRC);
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		void pickPerson(fakeHost().app as never, g, new Set(), 'Type', 'Find', false, null, null, { sourcePath: 'n.md', me: 'a' });
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as {
			getSuggestions(q: string): unknown[];
			renderSuggestion(item: unknown, el: FEl): void;
		};
		return p.getSuggestions('').map((item) => {
			const el = new FEl('div');
			p.renderSuggestion(item, el);
			return el.querySelector('.dynasty-picker-sub')!;
		});
	}

	it('puts the relation word in <i> and the years and the title in plain text', () => {
		const bob = subs()[1]!;
		expect(bob.getText()).toBe('Child · 1130–1190 · Count');
		expect(bob.querySelector('i')!.getText()).toBe('Child');
		expect(bob.children.filter((c) => c.tag !== 'i').map((c) => c.getText()).join('')).toBe(' · 1130–1190 · Count');
	});

	it('a row with no relation word has no <i>', () => {
		const r = parseDynasty('people:\n  - {id: a, name: Ann, born: 1100}\n');
		if (!r.ok) throw new Error('parse');
		void pickPerson(fakeHost().app as never, deriveFamilies(r.tree), new Set(), 'Type', 'Find', false, null, null, { sourcePath: 'n.md' });
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as {
			getSuggestions(q: string): unknown[];
			renderSuggestion(item: unknown, el: FEl): void;
		};
		const el = new FEl('div');
		p.renderSuggestion(p.getSuggestions('')[0], el);
		const sub = el.querySelector('.dynasty-picker-sub')!;
		expect(sub.getText()).toBe('b. 1100');
		expect(sub.querySelector('i')).toBeNull();
	});
});

describe('texts (D218 text fixes)', () => {
	it('the setting about arms says that a card always shows personal arms (D206)', () => {
		expect(SETTINGS_UI.armsOnCardsDesc).toContain('A card always shows personal arms.');
	});

	it('no succession text says "edit sheet" or uses "marked" for the Illegitimate box', () => {
		const all = JSON.stringify(SUCCESSION_UI, (_k, v: unknown) => (typeof v === 'function' ? String((v as (...a: string[]) => string)('A', 'B')) : v));
		expect(all).not.toMatch(/edit sheet/i);
		expect(all).not.toMatch(/marked as illegitimate|are not marked|the mark does not/i);
		expect(SUCCESSION_UI.branchNote).toContain('in the person window');
		expect(SUCCESSION_UI.illLabel).toBe('Children with the box “Illegitimate” ticked');
	});
});

describe('the style rules of the typography round (D218 items 1 to 5)', () => {
	const MINE = ['01-base.css', '10-edit-sheet.css', '11-sheet-family.css', '12-choice-steps.css', '13-person-picker.css', '24-crop-tool.css', '27-id-window-picker.css'];

	it('no chunk of the package uses a medium, 650 or 700 weight', () => {
		for (const name of MINE) {
			const css = bare(chunk(name));
			expect(css, name).not.toMatch(/font-weight:\s*(?:var\(--font-medium\)|var\(--bold-weight\)|500|600|650|700|bold)(?![\w-])/);
		}
	});

	it('no chunk of the package sets a font size as a fixed number or a raw Obsidian role, except the guards of the fields', () => {
		for (const name of MINE) {
			const css = bare(chunk(name));
			const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
			const loose = sizes.filter((s) => !/^(var\(--dynasty-type-(?:title|heading|control|text|small)\)|inherit|var\(--font-text-size\))$/.test(s) && !/^max\(16px, var\(--dynasty-type-control\)\)$/.test(s));
			expect(loose, name).toEqual([]);
		}
	});

	it('italic is set only for the relation words of the rows (and never in 10 and 13 for a note)', () => {
		const lines = [...bare(chunk('10-edit-sheet.css')).matchAll(/([^{}]+)\{[^}]*font-style:\s*italic/g)].map((m) => m[1]!.trim());
		expect(lines).toEqual(['.dynasty-row-sub i']);
		const picker = [...bare(chunk('13-person-picker.css')).matchAll(/([^{}]+)\{[^}]*font-style:\s*italic/g)].map((m) => m[1]!.trim());
		expect(picker).toEqual(['.dynasty-picker-sub i']);
	});

	it('a link is regular, with no underline at rest and a thin underline on hover for a pointer that hovers', () => {
		const base = bare(chunk('01-base.css'));
		expect(base).toMatch(/\.dynasty-link \{[^}]*font-weight: var\(--font-normal\)[^}]*text-decoration: none/);
		expect(base).toMatch(/@media \(hover: hover\) \{\s*\.dynasty-link:hover \{[^}]*text-decoration-thickness: 1px/);
		const sheet = bare(chunk('10-edit-sheet.css'));
		expect(sheet).not.toMatch(/underline dotted/);
		expect(sheet).not.toMatch(/text-decoration-thickness:\s*1\.5px/);
	});

	it('"Show the line" and "4 more" are links in a sentence: a thin light underline at rest, in one rule', () => {
		const sheet = bare(chunk('10-edit-sheet.css'));
		const at = sheet.indexOf('.dynasty-head-rel .dynasty-showline,\n.dynasty-head-rel .dynasty-more {');
		expect(at).toBeGreaterThan(-1);
		const body = sheet.slice(sheet.indexOf('{', at), sheet.indexOf('}', at));
		expect(body).toContain('text-decoration: underline solid');
		expect(body).toContain('color-mix(in srgb, var(--dynasty-link) 45%, transparent)');
	});

	it('"Open all" and "Close all" are muted on the phone too', () => {
		const sheet = bare(chunk('10-edit-sheet.css'));
		const phone = sheet.slice(sheet.indexOf('.dynasty-sheet.is-phone .dynasty-openall button {'));
		const body = phone.slice(0, phone.indexOf('}'));
		expect(body).not.toContain('color');
	});

	it('names are in the text font and semibold: the header, the Family rows, Find', () => {
		const sheet = bare(chunk('10-edit-sheet.css'));
		expect(sheet).toMatch(/\.dynasty-head-name \{[^}]*font-family: var\(--font-text\)[^}]*font-weight: var\(--font-semibold\)[^}]*letter-spacing: 0/);
		expect(sheet).toMatch(/\.dynasty-row-title\.dynasty-family-name \{[^}]*font-family: var\(--font-text\)[^}]*font-size: var\(--dynasty-type-heading\)[^}]*font-weight: var\(--font-semibold\)/);
		expect(sheet).toMatch(/\.dynasty-head-meta \{[^}]*font-family: var\(--font-text\)/);
		const picker = bare(chunk('13-person-picker.css'));
		expect(picker).toMatch(/\.dynasty-picker-name \{[^}]*font-family: var\(--font-text\)[^}]*font-size: var\(--dynasty-type-heading\)[^}]*font-weight: var\(--font-semibold\)/);
		expect(picker).toMatch(/\.dynasty-picker-sub \{[^}]*font-family: var\(--font-text\)[^}]*font-size: var\(--dynasty-type-text\)/);
	});

	it('the open-branch row is quiet roman text, not italic', () => {
		const sheet = bare(chunk('20-titles-holders.css'));
		const at = sheet.indexOf('.dynasty-sheet .dynasty-row.is-open-branch .dynasty-row-title');
		const body = sheet.slice(sheet.indexOf('{', at), sheet.indexOf('}', at));
		expect(body).toContain('font-style: normal');
		expect(body).toContain('color: var(--dynasty-muted)');
	});

	it('the phone surfaces take the phone values of the five roles', () => {
		const base = bare(chunk('01-base.css'));
		const at = base.indexOf('body.is-phone,');
		const body = base.slice(at, base.indexOf('}', at));
		for (const sel of ['.modal.is-phone', '.prompt.dynasty-picker.is-phone']) expect(body).toContain(sel);
		expect(body).toContain('--dynasty-type-title: 22px');
	});

	it('every button rule inside the window keeps the .dynasty-sheet prefix (the theme styles every button)', () => {
		const sheet = bare(chunk('10-edit-sheet.css'));
		expect(sheet).toMatch(/\.dynasty-sheet \.dynasty-openall button\.dynasty-open-note \{[^}]*color: var\(--dynasty-link\)/);
		expect(sheet).toMatch(/\.dynasty-sheet \.dynasty-openall button\.dynasty-add-portrait \{/);
	});

	it('the closed Actions section takes no row for an empty summary', () => {
		expect(bare(chunk('10-edit-sheet.css'))).toMatch(/\.dynasty-section-sum:empty \{\s*display: none/);
	});
});
