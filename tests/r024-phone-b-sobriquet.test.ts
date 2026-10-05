import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Obsidian's own matcher is replaced by a plain one: every word of the query must be inside the text, in lower case.
vi.mock('obsidian', async () => ({
	...(await import('./acceptance/fake-obsidian')),
	prepareFuzzySearch: (query: string) => {
		const words = query.toLowerCase().split(/\s+/).filter(Boolean);
		return (text: string) => {
			const lower = text.toLowerCase();
			return words.every((w) => lower.includes(w)) ? { score: -text.length, matches: [] } : null;
		};
	},
}));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { pickPerson } from '../src/obsidian/person-picker';
import { entryText } from '../src/obsidian/sheet-titles';
import { holderText } from '../src/obsidian/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { MAYBE_TEXT } from '../src/render/tree-info';
import { SHEET } from '../src/render/ui-text';
import { build } from './helpers';
import { FEl, clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHost, type Host } from './acceptance/tree-view-fakes';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * 0.2.4 phone-B, D122 (spec §13.19 rule 5): the sobriquet in the windows. The person list shows it after the name in curly
 * marks and in regular weight, and its search matches the text; the holder lists show it after the ruler text; the edit
 * sheet has a field for it (shows the model value, writes the typed text as typed). D123 (rule 6): the edit sheet shows the
 * `maybe` paragraph under the relation to the marked person. All names are made up.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

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
		const src = readFileSync(fileURLToPath(new URL('../src/obsidian/person-picker.ts', import.meta.url)), 'utf8');
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
		await click(el.querySelector('.dynasty-more'));
		await click(el.querySelector('.dynasty-more-titles'));
		const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl };
		expect(win).toBeDefined();
		// The window draws again after the click, so the box is looked up again.
		const box = () => win.contentEl.querySelector('.dynasty-title-box[data-title="duke"]')!;
		await click(box().querySelector('.dynasty-title-toggle'));
		const names = box().querySelectorAll('.dynasty-holder-name').map((n) => n.getText());
		expect(names).toEqual(['Aldric II “the Wise”', 'Bran I', 'Orso the Old I', 'Aldric “the Wise”']);
		const sob = box().querySelector('.dynasty-holder-name .dynasty-picker-sob')!;
		expect(sob.getText()).toBe(' “the Wise”');
		// The name button keeps its own label (the plugin does not say the sobriquet to a screen reader).
		expect(box().querySelector('button.dynasty-holder-name')!.getAttribute('aria-label')).not.toMatch(/Wise/);
	});
});

// ---------- the edit sheet ----------

function open(body: string, personId: string) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
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
		expect(input.getAttribute('autocapitalize')).toBe('none');
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

const relationBox = (modal: FEl) => modal.querySelector('.dynasty-relation-summary')!;

describe('D123: the edit sheet shows what a rumoured link could change', () => {
	it('half-brother who would be a full brother: the paragraph follows the relation to you', () => {
		const { modal } = open(REL(['  - {id: gareth, name: Gareth, sex: m, parents: [roland, mara]}']), 'gareth');
		const box = relationBox(modal);
		expect(box.querySelector('.dynasty-relation-main')!.getText()).toBe('Relation to you: Half-brother.');
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheet('brother'));
		// Under the relation, before the button that shows the line.
		const kids = box.children.map((c) => c.getAttribute('class') ?? [...c.classes].join(' '));
		expect(kids.findIndex((k) => k.includes('dynasty-relation-maybe'))).toBeGreaterThan(kids.findIndex((k) => k.includes('dynasty-relation-main')));
	});

	it('a sister who would be a half-sister (two different rumoured fathers): the same paragraph, the other word', () => {
		const { modal } = open(REL(['  - {id: sibyl, name: Sibyl, sex: f, parents: [mara, {id: quinn, type: rumoured}]}']), 'sibyl');
		const box = relationBox(modal);
		expect(box.querySelector('.dynasty-relation-main')!.getText()).toBe('Relation to you: Sister.');
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe(MAYBE_TEXT.sheet('half-sister'));
	});

	it('no rumour that matters: no paragraph', () => {
		const { modal } = open(REL(['  - {id: alis, name: Alis, sex: f, parents: [mara]}']), 'alis');
		expect(relationBox(modal).querySelector('.dynasty-relation-maybe')).toBeNull();
	});

	it('the marked person has no paragraph', () => {
		const { modal } = open(REL([]), 'edda');
		expect(relationBox(modal).querySelector('.dynasty-relation-maybe')).toBeNull();
		expect(relationBox(modal).querySelector('.dynasty-relation-main')!.getText()).toBe('This is you.');
	});
});
