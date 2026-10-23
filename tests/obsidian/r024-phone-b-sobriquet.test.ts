import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian's own matcher is replaced by a plain one: every word of the query must be inside the text, in lower case.
vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveFamilies } from '../../src/core/derive';
import type { RelationOptions } from '../../src/core/relations';
import { parseDynasty } from '../../src/core/parse';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { closePluginModals } from '../../src/view/plugin-modals';
import { pickPerson } from '../../src/obsidian/person-picker';
import { entryText } from '../../src/obsidian/sheet-titles';
import { holderText } from '../../src/view/titles-draft';
import { TitlesWindow } from '../../src/obsidian/titles-window';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { MAYBE_TEXT } from '../../src/render/tree-info';
import { SHEET, WINDOW_UI } from '../../src/render/ui-text';
import { build } from '../support/helpers';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHost, type Host } from '../acceptance/tree-view-fakes';
import { openPage } from '../support/lw-support';
import { click, stripNotDisabled, type, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.4 phone-B, D122 (spec §13.19 rule 5): the sobriquet in the windows. The person list shows it after the name in curly
 * marks and in regular weight, and its search matches the text; the holder lists show it after the ruler text; the edit
 * sheet has a field for it (shows the model value, writes the typed text as typed). D123 (rule 6): the edit sheet shows the
 * `maybe` paragraph under the relation to the marked person. All names are made up.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	device.coarse = false;
	FullScreenModal.openViews.clear();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => vi.restoreAllMocks());

// ---------- the person list ----------

interface PickerLike {
	getSuggestions(q: string): { kind: string; person?: { id: string; name: string } }[];
	renderSuggestion(item: unknown, el: FEl): void;
}

const PEOPLE = ['people:', '  - {id: aldric, name: Aldric Valmont, sobriquet: the Wise}', '  - {id: bran, name: Bran Orsini}', '  - {id: cora, name: Cora Valmont, sobriquet: "“Lionheart”"}', ''].join('\n');

function openPicker(body = PEOPLE, you: string | null = null): PickerLike {
	void pickPerson({} as never, build(body).g, new Set(), 'Type', 'Find', false, you);
	return openModals[openModals.length - 1] as unknown as PickerLike;
}

const row = (p: PickerLike, id: string): FEl => {
	const el = new FEl('div');
	const item = p.getSuggestions('').find((i) => i.person?.id === id);
	p.renderSuggestion(item, el);
	return el;
};

describe('D122: the person list shows the sobriquet', () => {
	it('the row is the name, then the sobriquet in curly marks in its own span', () => {
		const p = openPicker();
		const name = row(p, 'aldric').querySelector('.dynasty-picker-name')!;
		expect(name.getText()).toBe('Aldric Valmont “the Wise”');
		const sob = name.querySelector('.dynasty-picker-sob')!;
		expect(sob.getText()).toBe(' “the Wise”');
	});

	it('a typed pair of marks in the key is taken off once, then the plugin adds its own', () => {
		const p = openPicker();
		expect(row(p, 'cora').querySelector('.dynasty-picker-sob')!.getText()).toBe(' “Lionheart”');
	});

	it('a person with no sobriquet has no such span', () => {
		const p = openPicker();
		expect(row(p, 'bran').querySelector('.dynasty-picker-sob')).toBeNull();
	});

	it('the sobriquet follows the ruler name (the existing suffix span)', () => {
		const body = ['titles:', '  - id: duke', '    name: Duke', '    holders:', '      - {person: aldric, number: II, as: Aldric}', 'people:', '  - {id: aldric, name: Ser Aldric Valmont, sobriquet: the Wise}', ''].join('\n');
		const name = row(openPicker(body), 'aldric').querySelector('.dynasty-picker-name')!;
		expect(name.children.map((c) => c.classes.has('dynasty-picker-suffix') ? 'suffix' : c.classes.has('dynasty-picker-sob') ? 'sob' : '?')).toEqual(['suffix', 'sob']);
		expect(name.getText()).toBe('Ser Aldric Valmont (Aldric II) “the Wise”');
	});

	it('the "You" row also shows it', () => {
		const p = openPicker(PEOPLE, 'aldric');
		expect(row(p, 'aldric').querySelector('.dynasty-picker-name')!.getText()).toBe('You: Aldric Valmont “the Wise”');
	});

	it('the search matches the text of the sobriquet, with or without the marks of the row', () => {
		const p = openPicker();
		const ids = (q: string) => p.getSuggestions(q).filter((i) => i.kind === 'person').map((i) => i.person!.id);
		expect(ids('wise')).toEqual(['aldric']);
		expect(ids('the wise')).toEqual(['aldric']);
		expect(ids('lionheart')).toEqual(['cora']);
		expect(ids('valmont').sort()).toEqual(['aldric', 'cora']);
		expect(ids('zzz')).toEqual([]);
	});

	it('the card labels come from `needsLabels` and not from a count of titles (a tree with sobriquets and no titles)', () => {
		const src = readFileSync(fileURLToPath(new URL('../../src/obsidian/person-picker.ts', import.meta.url)), 'utf8');
		expect(src).toMatch(/needsLabels\(g\)/);
		expect(src).not.toMatch(/titles\?\.length/);
	});
});

// ---------- the holder lists ----------

const TITLED = [
	'titles:',
	'  - id: duke',
	'    name: Duke',
	'    holders:',
	'      - {person: aldric, number: II, from: 1110, to: 1150}',
	'      - {person: bran, number: I, from: 1150, to: 1160}',
	'      - {name: Orso the Old, number: I}',
	'      - {person: aldric, from: 1160}',
	'people:',
	'  - {id: aldric, name: Aldric Valmont, sobriquet: the Wise}',
	'  - {id: bran, name: Bran Orsini}',
	'',
].join('\n');

describe('D122: the holder lists', () => {
	it('the sheet entry: the ruler text, the sobriquet in curly marks, then the reign', () => {
		expect(entryText({ person: 'aldric', number: 'II', from: '1110', to: '1150', index: 0 }, 'Aldric Valmont', 'the Wise')).toBe('Aldric II “the Wise”, 1110–1150');
	});

	it('the sheet entry with no sobriquet is as before; an entry with no number has no ruler text and so no sobriquet', () => {
		expect(entryText({ person: 'aldric', number: 'II', from: '1110', to: '1150', index: 0 }, 'Aldric Valmont')).toBe('Aldric II, 1110–1150');
		expect(entryText({ person: 'aldric', from: '1160', index: 3 }, 'Aldric Valmont', 'the Wise')).toBe('from 1160');
	});

	it('`holderText` gives the bare sobriquet of a holder in the tree, and none to a holder who is not', () => {
		const g = deriveFamilies((parseDynasty(TITLED) as { ok: true; tree: never }).tree);
		expect(holderText(g, { person: 'aldric', number: 'II' })).toMatchObject({ ruler: 'Aldric II', sobriquet: 'the Wise', inTree: true });
		expect(holderText(g, { person: 'bran', number: 'I' })).not.toHaveProperty('sobriquet');
		expect(holderText(g, { name: 'Orso the Old', number: 'I' })).not.toHaveProperty('sobriquet');
		// A person id that names nobody, with a name: not in the tree, so no sobriquet.
		expect(holderText(g, { person: 'nobody', name: 'Cosimo', number: 'I' })).not.toHaveProperty('sobriquet');
	});

	it('the Titles window shows the sobriquet after the ruler text, on the same line, in its own span', async () => {
		const handle = writingHandle(TITLED);
		const { el } = await embed(TITLED, { handle, host: fakeHost() as Host });
		await click(el.querySelector('.dynasty-titles-button'));
		const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl };
		expect(win).toBeDefined();
		// The holders show on the edit page of the title (D134).
		const page = openPage(win.contentEl, 'duke');
		const names = page.querySelectorAll('.dynasty-holder-name').map((n) => n.getText());
		expect(names).toEqual(['Aldric II “the Wise”', 'Bran I', 'Orso the Old I', 'Aldric Valmont “the Wise”']);
		const sob = page.querySelector('.dynasty-holder-name .dynasty-picker-sob')!;
		expect(sob.getText()).toBe(' “the Wise”');
		// D130 item 8: the label span holds the ruler text and the sobriquet, so the space before the sobriquet is kept.
		expect(sob.parentElement!.hasClass('dynasty-holder-label')).toBe(true);
		// The name button keeps its own label (the plugin does not say the sobriquet to a screen reader).
		expect(page.querySelector('button.dynasty-holder-name')!.getAttribute('aria-label')).not.toMatch(/Wise/);
	});
});

// ---------- the edit sheet ----------

function open(body: string, personId: string, relationOptions?: RelationOptions) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md', ...(relationOptions ? { relationOptions } : {}) })!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	return { h, s, modal };
}

const SHEET_BODY = [
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    sobriquet: "“the Wise”"',
	'  - id: bran',
	'    name: Bran Orsini',
	'  - id: cora',
	'    name: Cora Valmont',
	'    sobriquet: the Bold',
	'    parents: [aldric]',
	'',
].join('\n');

describe('D122: the sobriquet field of the edit sheet', () => {
	it('is the second field, after the name, with its label and its hint', () => {
		const { modal } = open(SHEET_BODY, 'bran');
		const fields = modal.querySelectorAll('.dynasty-sheet-field').map((f) => f.getAttribute('data-field'));
		expect(fields.indexOf('sobriquet')).toBe(fields.indexOf('name') + 1);
		const row = modal.querySelector('[data-field="sobriquet"]')!;
		expect(row.querySelector('label')!.getText()).toBe(SHEET.sobriquet);
		expect(row.querySelector('.dynasty-sheet-hint')!.getText()).toBe(SHEET.sobriquetHint);
		const input = row.querySelector('input')!;
		expect(row.querySelector('.dynasty-sheet-hint')!.getAttribute('id')).toBe(`${input.getAttribute('id')}-hint`);
		expect(input.getAttribute('aria-describedby')).toBe(`${input.getAttribute('id')}-hint`);
		// D196 item 1: no automatic capital, no correction.
		expect(input.getAttribute('autocapitalize')).toBe('off');
		expect(input.value).toBe('');
	});

	it('shows the model value: a pair of marks in the note is not in the field', () => {
		const { modal } = open(SHEET_BODY, 'aldric');
		expect(modal.querySelector('[data-field="sobriquet"] input')!.value).toBe('the Wise');
	});

	it('a field that did not change writes nothing, even when the note holds a pair of marks', async () => {
		const { h, modal } = open(SHEET_BODY, 'aldric');
		type(modal.querySelector('[data-field="name"] input')!, 'Aldric Valmont II');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.ops).toHaveLength(1);
		expect(h.ops[0]).toMatchObject({ kind: 'set-person-fields', fields: { name: 'Aldric Valmont II' } });
		expect(Object.keys((h.ops[0] as { fields: object }).fields)).toEqual(['name']);
		expect(h.body).toContain('sobriquet: "“the Wise”"');
	});

	it('writes the typed text as typed, after the name', async () => {
		const { h, modal } = open(SHEET_BODY, 'bran');
		type(modal.querySelector('[data-field="sobriquet"] input')!, 'the Younger');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.ops[0]).toMatchObject({ kind: 'set-person-fields', id: 'bran', fields: { sobriquet: 'the Younger' } });
		expect(h.body).toMatch(/name: Bran Orsini\n\s+sobriquet: the Younger/);
	});

	it('does not add or remove marks: a typed pair of marks is written as typed', async () => {
		const { h, modal } = open(SHEET_BODY, 'bran');
		type(modal.querySelector('[data-field="sobriquet"] input')!, '“the Younger”');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect((h.ops[0] as { fields: { sobriquet: string } }).fields.sobriquet).toBe('“the Younger”');
	});

	it('an emptied field removes the key', async () => {
		const { h, modal } = open(SHEET_BODY, 'cora');
		type(modal.querySelector('[data-field="sobriquet"] input')!, '  ');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.ops[0]).toMatchObject({ kind: 'set-person-fields', id: 'cora', fields: { sobriquet: null } });
		expect(h.body).toContain('name: Cora Valmont\n    parents: [aldric]');
	});

	it('the sheet of a new person has the field too, and the new person gets the key', async () => {
		const h = writingHandle(SHEET_BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		s.open();
		const modal = (s as unknown as { modalEl: FEl }).modalEl;
		type(modal.querySelector('[data-field="name"] input')!, 'Dagny Holt');
		type(modal.querySelector('[data-field="sobriquet"] input')!, 'the Quiet');
		await click(modal.querySelector('.dynasty-sheet-save'));
		expect(h.body).toMatch(/name: Dagny Holt\n\s+sobriquet: the Quiet/);
	});
});

// ---------- the `maybe` paragraph ----------

const REL = (extra: string[]) =>
	[
		'options:',
		'  me: edda',
		'people:',
		'  - {id: mara, name: Mara, sex: f}',
		'  - {id: roland, name: Roland, sex: m}',
		'  - {id: quinn, name: Quinn, sex: m}',
		'  - {id: edda, name: Edda, sex: f, parents: [mara, {id: roland, type: rumoured}]}',
		...extra,
		'',
	].join('\n');

// 0.2.8: the relation is one text line in the text column of the header, with the sentence of the "maybe" under it.
const relationBox = (modal: FEl) => modal.querySelector('.dynasty-head-text')!;
const widths = [
	['computer', 1280],
	['phone', 390],
] as const;

describe.each(widths)('D123: the edit sheet shows what a rumoured link could change (%s)', (_name, width) => {
	/** The text of the relation: "Your half-brother, maybe full" (the first item of the joined text line), or the sentence of the marked person. */
	const relationText = (box: FEl) => {
		const line = box.querySelector('.dynasty-head-rel')!;
		return line.hasClass('is-me') ? line.getText() : line.querySelector('.dynasty-jitem')!.getText();
	};
	const your = (word: string) => WINDOW_UI.relationYour(word);

	beforeEach(() => {
		device.width = width;
	});

	it('half-brother who would be a full brother: the paragraph follows the relation to you', () => {
		const { modal } = open(REL(['  - {id: gareth, name: Gareth, sex: m, parents: [roland, mara]}']), 'gareth');
		const box = relationBox(modal);
		expect(relationText(box)).toBe(your('half-brother, maybe full'));
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheet('brother'));
		// Under the relation.
		const order = box.children.map((c) => [...c.classes].join(' '));
		const at = (cls: string) => order.findIndex((k) => k.includes(cls));
		expect(at('dynasty-relation-maybe')).toBeGreaterThan(at('dynasty-head-rel'));
	});

	// 0.2.8 F-KIN-08: the text line of the window carries the card text, so a relation with a maybe reads "Half-sister, maybe full".
	// D174 rule 3: Edda and Sibyl each list one birth parent and a rumoured parent, so both are incomplete: half-sisters, and two
	// different rumoured fathers change nothing (before D174: "Sister" with a "maybe half" paragraph).
	it('two different rumoured fathers (D174 rule 3): Half-sister and no paragraph', () => {
		const { modal } = open(REL(['  - {id: sibyl, name: Sibyl, sex: f, parents: [mara, {id: quinn, type: rumoured}]}']), 'sibyl');
		const box = relationBox(modal);
		expect(relationText(box)).toBe(your('half-sister'));
		expect(box.querySelector('.dynasty-relation-maybe')).toBeNull();
	});

	it('a sister who would be a half-sister (one rumoured third parent, D174 rule 4): the same paragraph, the other word', () => {
		const body = ['options:', '  me: fenna', 'people:', '  - {id: mara, name: Mara, sex: f}', '  - {id: dov, name: Dov, sex: m}', '  - {id: yann, name: Yann, sex: m}', '  - {id: fenna, name: Fenna, sex: f, parents: [dov, mara]}', '  - {id: elin, name: Elin, sex: f, parents: [dov, mara, {id: yann, type: rumoured}]}', ''].join('\n');
		const box = relationBox(open(body, 'elin').modal);
		expect(relationText(box)).toBe(your('sister, maybe half'));
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheet('half-sister'));
	});

	// D174: Alis lists only Mara; Edda lists Mara and a rumoured Roland. Setting on: half, and "maybe full" with the cause 'unlisted' (the
	// two sets with the rumour, {Mara} and {Mara, Roland}, differ). Off: half, with no paragraph (before D174: "Sister" with no paragraph).
	it('one listed parent against a rumoured parent: on, the paragraph for a parent who is not listed; off, Half-sister and no paragraph', () => {
		const body = REL(['  - {id: alis, name: Alis, sex: f, parents: [mara]}']);
		const on = relationBox(open(body, 'alis').modal);
		expect(relationText(on)).toBe(your('half-sister, maybe full'));
		expect(on.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheetUnlistedOther('sister'));
		closePluginModals();
		const off = relationBox(open(body, 'alis', { oneParentUnknown: false }).modal);
		expect(relationText(off)).toBe(your('half-sister'));
		expect(off.querySelector('.dynasty-relation-maybe')).toBeNull();
	});

	it('D174: two people who list only Mara: on, the paragraph for a parent who is not listed; off, Sister and no paragraph', () => {
		const body = ['options:', '  me: hild', 'people:', '  - {id: mara, name: Mara, sex: f}', '  - {id: hild, name: Hild, sex: f, parents: [mara]}', '  - {id: ines, name: Ines, sex: f, parents: [mara]}', ''].join('\n');
		const on = relationBox(open(body, 'ines').modal);
		expect(relationText(on)).toBe(your('half-sister, maybe full'));
		expect(on.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheetUnlistedSame('sister'));
		closePluginModals();
		const off = relationBox(open(body, 'ines', { oneParentUnknown: false }).modal);
		expect(relationText(off)).toBe(your('sister'));
		expect(off.querySelector('.dynasty-relation-maybe')).toBeNull();
	});

	it('no rumour and both parents listed: no paragraph', () => {
		const { modal } = open(REL(['  - {id: ari, name: Ari, sex: f}', '  - {id: bea, name: Bea, sex: f, parents: [mara, ari]}', '  - {id: cil, name: Cil, sex: f, parents: [mara, ari]}']), 'cil');
		expect(relationBox(modal).querySelector('.dynasty-relation-maybe')).toBeNull();
	});

	it('the marked person has no paragraph', () => {
		const { modal } = open(REL([]), 'edda');
		expect(relationBox(modal).querySelector('.dynasty-relation-maybe')).toBeNull();
		expect(relationText(relationBox(modal))).toBe('This is you.');
	});
});
