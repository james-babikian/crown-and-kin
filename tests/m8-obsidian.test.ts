import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { describeDelete } from '../src/core/family-query';
import { parseDynasty } from '../src/core/parse';
import { newTitleId } from '../src/core/title-ops';
import { cardLabels, holderTable } from '../src/core/titles';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/view/plugin-modals';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { entryText, titleOnCard } from '../src/obsidian/sheet-titles';
import { freeName } from '../src/obsidian/table-note';
import {
	addFields,
	changedFields,
	draftChanged,
	emptyNames,
	formResult,
	formStart,
	holderText,
previewParts,
	rebase,
	rulerHint,
	savedListName,
	titleRows,
	valuesOf,
	windowOps,
	type HolderRow,
	type HolderValues,
	type TitleRow,
} from '../src/view/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { TITLES_UI, deleteText } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { lastMenu, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { golden, replaceOnce } from './acceptance/golden';
import { BODY_13 } from './acceptance/titles-support';
import { embed, fakeHandle, fakeHost, fillAllCards, openSheetOn, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { backButton, backToList, openPage, rowNames, rowTexts } from './lw-support';

/*
 * WP 8.3 (spec §13.3–§13.5, §13.0 items 6–8; D54–D63): the Titles window's draft and the one batch
 * of its Save, the holder form's `as` rule, the table note's name, the card labels in the tree view,
 * the More item, the Titles window on the fakes (Save, Cancel, one undo step, Delete, the table note),
 * and the Titles section of the edit sheet (Show on the card, Edit, Remove, the Delete person text).
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const graph = (body: string): FamilyGraph => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('the sample does not parse');
	return deriveFamilies(r.tree);
};
const G13 = graph(BODY_13);
const bodyOf = (r: ReturnType<typeof applyOp>) => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const keys = () => {
	let n = 0;
	return () => `k${n++}`;
};
const rowsOf = (g = G13) => titleRows(g, keys());
const titleOf = (rows: TitleRow[], id: string) => rows.find((t) => t.id === id)!;
const newId = (body: string) => (name: string, taken: ReadonlySet<string>) => newTitleId(body, name, taken);

// ---------- the pure parts ----------

describe('holder rows of the Titles window (spec §13.4)', () => {
	const duke = titleOf(rowsOf(), 'duke-of-valmont');
	const orsini = titleOf(rowsOf(), 'count-of-orsini');
	const text = (h: HolderRow) => holderText(G13, h.values);

	it('"Aldric II", the full name, the reign; a holder in the tree', () => {
		expect(text(duke.holders[1])).toEqual({ ruler: 'Aldric II', full: 'Aldric Valmont', reign: '1110–1150', inTree: true });
	});

	it('a name-only holder: the name as the ruler name, no full name, not in the tree', () => {
		expect(text(duke.holders[0])).toEqual({ ruler: 'Aldric I', reign: '1062–1110', inTree: false });
		expect(text(orsini.holders[0])).toEqual({ ruler: 'Orso the Old', reign: 'until 1090', inTree: false });
	});

	it('`as` is the ruler name (Ser Gareth Orsini → Gareth I); no number: the first word', () => {
		expect(text(duke.holders[3])).toEqual({ ruler: 'Gareth I', full: 'Ser Gareth Orsini', reign: '1158–1163', inTree: true });
		expect(text(duke.holders[2])).toEqual({ ruler: 'Roderick', full: 'Roderick Valmont', reign: '1150–1158', inTree: true });
	});

	it('a `person` that names nobody, with a `name`: shows by the name, not in the tree', () => {
		expect(text(orsini.holders[4])).toEqual({ ruler: 'Cosimo Orsini', reign: '1140–1145', inTree: false });
	});
});

describe('the holder form (spec §13.5): the ruler name and the preview', () => {
	it('starts with the written ruler name; the field is empty when the entry has no `as` (D131)', () => {
		expect(formStart({ person: 'roderick', from: '1150' }, false)).toEqual({ number: '', ruler: '', from: '1150', to: '', throughSpouse: false });
		expect(formStart({ person: 'gareth', as: 'Gareth', number: 'I' }, false).ruler).toBe('Gareth');
		expect(formStart({ name: 'Aldric', number: 'I' }, true)).toEqual({ number: 'I', ruler: '', from: '', to: '', throughSpouse: false, name: 'Aldric' });
	});

	it('the hint of the ruler field is the first word of the name, or the typed name of a holder who is not in the tree', () => {
		expect(rulerHint('Ser Gareth Orsini', undefined)).toBe('Ser');
		expect(rulerHint(undefined, 'Cosimo Orsini ')).toBe('Cosimo Orsini');
		expect(rulerHint(undefined, undefined)).toBe('');
	});

	it('a ruler name that did not change writes no `as` (and keeps a written one)', () => {
		const v = formResult({ person: 'darian' }, 'Ser Darian Harrow', { number: 'II', ruler: 'Ser', from: '', to: '' });
		expect(v).toEqual({ person: 'darian', number: 'II' });
		const g = formResult({ person: 'gareth', as: 'Gareth', number: 'I' }, 'Ser Gareth Orsini', { number: 'II', ruler: 'Gareth', from: '', to: '' });
		expect(g).toEqual({ person: 'gareth', as: 'Gareth', number: 'II' });
	});

	it('a changed ruler name writes `as` (with no number also the default); an empty field removes it; with a number the default removes it', () => {
		expect(formResult({ person: 'darian' }, 'Ser Darian Harrow', { number: 'II', ruler: 'Darian', from: '', to: '' }).as).toBe('Darian');
		expect(formResult({ person: 'gareth', as: 'Gareth' }, 'Ser Gareth Orsini', { number: '', ruler: 'Ser', from: '', to: '' }).as).toBe('Ser');
		expect(formResult({ person: 'gareth', as: 'Gareth' }, 'Ser Gareth Orsini', { number: 'II', ruler: 'Ser', from: '', to: '' }).as).toBeUndefined();
		expect(formResult({ person: 'gareth', as: 'Gareth' }, 'Ser Gareth Orsini', { number: '', ruler: ' ', from: '', to: '' }).as).toBeUndefined();
	});

	it('D131: with no number a typed text writes `as` even when it is the first word; the text of the start writes nothing', () => {
		const typed = (before: HolderValues, ruler: string, number = '') => formResult(before, 'Marta de Calvera', { number, ruler, from: '', to: '' });
		expect(typed({ person: 'marta' }, 'Marta').as).toBe('Marta');
		expect(typed({ person: 'marta' }, '').as).toBeUndefined();
		expect(typed({ person: 'marta', as: 'Marta Q' }, 'Marta Q')).toEqual({ person: 'marta', as: 'Marta Q' });
		expect(typed({ person: 'marta', as: 'Marta Q' }, 'Marta').as).toBe('Marta');
		expect(typed({ person: 'marta', as: 'Marta Q' }, 'Marta', 'II').as).toBeUndefined();
		expect(typed({ person: 'marta', number: 'I' }, 'Marta', 'I').as).toBeUndefined();
	});

	it('empty fields remove their keys; text is trimmed', () => {
		expect(formResult({ person: 'a', number: 'I', from: '1100', to: '1110' }, 'Aldo X', { number: ' ', ruler: '', from: ' 1101 ', to: '' })).toEqual({ person: 'a', from: '1101' });
	});

	it('the live preview: "Ser Darian Harrow shows as: Darian II"', () => {
		expect(previewParts('Ser Darian Harrow', { number: 'II', ruler: 'Darian', from: '', to: '' })).toEqual({ full: 'Ser Darian Harrow', shown: 'Darian II' });
		expect(previewParts('Ser Gareth Orsini', { number: 'II', ruler: 'Ser', from: '', to: '' }).shown).toBe('Ser II');
		// A holder who is not in the tree: the typed name, and the ruler name falls back to it.
		expect(previewParts(undefined, { number: 'I', ruler: '', from: '', to: '', name: 'Orso' })).toEqual({ full: 'Orso', shown: 'Orso I' });
	});

	it('D131: with no number the preview shows the written ruler name, else the full name, as the card will', () => {
		const none = { number: '', ruler: '', from: '', to: '' };
		expect(previewParts('Marta de Calvera', { ...none, ruler: 'Marta' }, { as: 'Marta' })).toEqual({ full: 'Marta de Calvera', shown: 'Marta' });
		expect(previewParts('Marta de Calvera', none)).toEqual({ full: 'Marta de Calvera', shown: 'Marta de Calvera' });
		expect(previewParts('Ser Gareth Orsini', none, {}).shown).toBe('Ser Gareth Orsini');
		// A typed text that differs from the start text is written, so the card will show it.
		expect(previewParts('Marta de Calvera', { ...none, ruler: 'Marta' }, {}).shown).toBe('Marta');
		// An empty field removes a written `as`.
		expect(previewParts('Marta de Calvera', none, { as: 'Marta' }).shown).toBe('Marta de Calvera');
		// With a number the empty field still shows the first word.
		expect(previewParts('Marta de Calvera', { ...none, number: 'II' }, {}).shown).toBe('Marta II');
	});

	it('changedFields: only changed keys, null for a removed key', () => {
		expect(changedFields({ person: 'a', number: 'I', from: '1' }, { person: 'a', number: 'II' })).toEqual({ number: 'II', from: null });
		expect(changedFields({ person: 'a' }, { person: 'a' })).toEqual({});
	});
});

describe('the Titles window draft: Save is one batch (spec §13.4, §13.0 item 6)', () => {
	it('an unchanged draft writes nothing', () => {
		const rows = rowsOf();
		expect(draftChanged(rows)).toBe(false);
		expect(windowOps(rows, newId(BODY_13))).toEqual([]);
	});

	it('add, rename, move, edit, add and remove holders, delete: edit-title, set-holders, delete-title, add-title, in that order (§13.17: add ops last)', () => {
		const rows = rowsOf();
		const duke = titleOf(rows, 'duke-of-valmont');
		const [h0, h1, h2, h3, h4, h5] = duke.holders;
		h2.values = { ...h2.values, to: '1157' };
		duke.holders = [h0, h1, h2, h3, h5, h4, { key: 'new', ref: null, base: null, values: { person: 'king-roderick', from: '1228' } }];
		titleOf(rows, 'king-of-the-vale').name = 'High King of the Vale';
		titleOf(rows, 'warden-of-the-marches').deleted = true;
		rows.push({ key: 'nt', id: null, name: 'Lord of Harrowmere', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		expect(draftChanged(rows)).toBe(true);
		const ops = windowOps(rows, newId(BODY_13));
		expect(ops.map((o) => o.kind)).toEqual(['edit-title', 'set-holders', 'delete-title', 'add-title']);
		// The same text as the WP 8.0 golden Save, except for the plural of the new title: the window no longer writes the list name (D201).
		const out = bodyOf(applyOp(BODY_13, { kind: 'batch', ops }));
		expect(out + '\n').toBe(replaceOnce(golden('13-window-save.yaml'), '    plural: Lords of Harrowmere\n', ''));
	});

	it('a new title with holders: add-title with a fresh id, then one set-holders with the new holders', () => {
		const rows = rowsOf();
		const holders: HolderRow[] = [
			{ key: 'a', ref: null, base: null, values: { person: 'elinor', number: 'I', from: '1180' } },
			{ key: 'b', ref: null, base: null, values: { name: 'Orso' } },
		];
		rows.push({ key: 'n1', id: null, name: 'Duke of Valmont', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders, baseRows: [] });
		rows.push({ key: 'n2', id: null, name: 'Duke of Valmont', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		const ops = windowOps(rows, newId(BODY_13));
		// Both ids unused in the body and by each other (§6.8).
		expect(ops).toEqual([
			{ kind: 'add-title', id: 'duke-of-valmont-2', name: 'Duke of Valmont' },
			{ kind: 'add-title', id: 'duke-of-valmont-3', name: 'Duke of Valmont' },
			{ kind: 'set-holders', title: 'duke-of-valmont-2', items: [{ add: { person: 'elinor', number: 'I', from: '1180' } }, { add: { name: 'Orso' } }] },
		]);
		const g = graph(bodyOf(applyOp(BODY_13, { kind: 'batch', ops })));
		expect(g.titles.find((t) => t.id === 'duke-of-valmont-2')?.holders.map((h) => h.person ?? h.name)).toEqual(['elinor', 'Orso']);
	});

	it('a move writes only the order: refs with no fields', () => {
		const rows = rowsOf();
		const king = titleOf(rows, 'king-of-the-vale');
		king.holders.reverse();
		const ops = windowOps(rows, newId(BODY_13));
		expect(ops).toHaveLength(1);
		const op = ops[0] as Extract<Op, { kind: 'set-holders' }>;
		expect(op.items.every((i) => 'ref' in i && !('fields' in i))).toBe(true);
		const g = graph(bodyOf(applyOp(BODY_13, ops[0])));
		expect(g.titles.find((t) => t.id === 'king-of-the-vale')!.holders.map((h) => h.person)).toEqual(['king-roderick', 'edmund', 'young-aldric']);
	});

	it('a deleted new title writes nothing; an empty name must be entered first', () => {
		const rows = rowsOf();
		rows.push({ key: 'n', id: null, name: '  ', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		expect(emptyNames(rows).map((t) => t.key)).toEqual(['n']);
		rows[rows.length - 1].deleted = true;
		expect(draftChanged(rows)).toBe(false);
		titleOf(rows, 'duke-of-valmont').name = '';
		expect(emptyNames(rows).map((t) => t.id)).toEqual(['duke-of-valmont']);
	});
});

describe('the draft follows a tree that changed under the window (stale Save, spec §6.1)', () => {
	it('a holder added elsewhere goes at the end; a holder the draft removed stays removed; a changed value stays', () => {
		const rows = rowsOf();
		const king = titleOf(rows, 'king-of-the-vale');
		king.holders.splice(1, 1); // Edmund removed in the draft.
		king.holders[0].values = { ...king.holders[0].values, to: '1211' };
		// Elsewhere: a new holder at the end of King of the Vale, and a new `from` on King Roderick.
		const other = BODY_13.replace('      - {person: king-roderick, from: 1228}\n', '      - {person: king-roderick, from: 1229}\n      - {name: Godwin}\n');
		const next = rebase(rows, rowsOf(graph(other)));
		const k = titleOf(next, 'king-of-the-vale');
		expect(k.key).toBe(king.key);
		expect(k.holders.map((h) => h.values.person ?? h.values.name)).toEqual(['young-aldric', 'king-roderick', 'Godwin']);
		expect(k.holders[0].values.to).toBe('1211');
		expect(k.holders[1].values.from).toBe('1229');
		const g = graph(bodyOf(applyOp(other, { kind: 'batch', ops: windowOps(next, newId(other)) })));
		expect(g.titles.find((t) => t.id === 'king-of-the-vale')!.holders.map((h) => `${h.person ?? h.name}:${h.to ?? ''}`)).toEqual(['young-aldric:1211', 'king-roderick:', 'Godwin:']);
	});

	it('a title deleted elsewhere leaves the draft; a new title stays', () => {
		const rows = rowsOf();
		rows.push({ key: 'n', id: null, name: 'Baron', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		const other = bodyOf(applyOp(BODY_13, { kind: 'delete-title', id: 'warden-of-the-marches' }));
		const next = rebase(rows, rowsOf(graph(other)));
		expect(next.map((t) => t.id)).toEqual(['duke-of-valmont', 'count-of-orsini', 'king-of-the-vale', null]);
	});
});

describe('the list name in the Titles window (D201: no field, the window never writes it)', () => {
	const DUKE_PLURAL = '    plural: Dukes of Valmont\n';
	const only = (rows: TitleRow[]) => {
		const ops = windowOps(rows, newId(BODY_13));
		return { ops, body: ops.length ? bodyOf(applyOp(BODY_13, { kind: 'batch', ops })) : BODY_13 };
	};

	it('a row has no plural: the window neither shows nor keeps the list name', () => {
		const rows = rowsOf();
		expect('plural' in titleOf(rows, 'duke-of-valmont')).toBe(false);
		expect('basePlural' in titleOf(rows, 'duke-of-valmont')).toBe(false);
	});

	it('a rename makes one edit-title with the name only; a written plural stays in the note (A.3)', () => {
		const rows = rowsOf();
		const king = titleOf(rows, 'king-of-the-vale');
		king.name = 'High King of the Vale';
		const duke = titleOf(rows, 'duke-of-valmont');
		duke.name = 'Grand Duke of Valmont';
		const { ops, body } = only(rows);
		expect(ops).toEqual([
			{ kind: 'edit-title', id: 'duke-of-valmont', name: 'Grand Duke of Valmont' },
			{ kind: 'edit-title', id: 'king-of-the-vale', name: 'High King of the Vale' },
		]);
		expect(ops.every((o) => !('plural' in o))).toBe(true);
		expect(body).toContain(DUKE_PLURAL.trimEnd());
		expect(body).toContain('name: High King of the Vale');
	});

	it('a new title: add-title with the name and the other forms of the name, never a plural', () => {
		const rows = rowsOf();
		rows.push({ key: 'a', id: null, name: 'Baron of Greyfen', baseName: null, maleName: 'Baron', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		rows.push({ key: 'c', id: null, name: 'Reeve', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		expect(windowOps(rows, newId(BODY_13))).toEqual([
			{ kind: 'add-title', id: 'baron-of-greyfen', name: 'Baron of Greyfen', maleName: 'Baron' },
			{ kind: 'add-title', id: 'reeve', name: 'Reeve' },
		]);
	});

	it('the saved list name is the name of the saved title, for the label of the table note', () => {
		const rows = rowsOf();
		const duke = titleOf(rows, 'duke-of-valmont');
		duke.name = 'Grand Duke';
		expect(savedListName(duke)).toBe('Duke of Valmont');
		expect(savedListName(titleOf(rows, 'warden-of-the-marches'))).toBe('Warden of the Marches');
	});

	it('a stale Save keeps an edited name; a name changed elsewhere comes through on an untouched title', () => {
		const rows = rowsOf();
		titleOf(rows, 'duke-of-valmont').name = 'Grand Duke';
		const other = replaceOnce(BODY_13, '    name: Count of Orsini\n', '    name: Count\n');
		const next = rebase(rows, rowsOf(graph(other)));
		expect(titleOf(next, 'duke-of-valmont').name).toBe('Grand Duke');
		expect(titleOf(next, 'count-of-orsini').name).toBe('Count');
		expect(windowOps(next, newId(other))).toEqual([{ kind: 'edit-title', id: 'duke-of-valmont', name: 'Grand Duke' }]);
	});
});

describe('the tick box "Holds the title through the spouse" in the holder draft (D195, contract A.2)', () => {
	it('a written key reads as ticked: true for the box, the id for a hand-written id', () => {
		expect(valuesOf({ person: 'a', index: 0, throughSpouse: true })).toEqual({ person: 'a', throughSpouse: 'true' });
		expect(valuesOf({ person: 'a', index: 0, throughSpouse: 'anna' })).toEqual({ person: 'a', throughSpouse: 'anna' });
		expect(valuesOf({ person: 'a', index: 0 })).toEqual({ person: 'a' });
		expect(formStart({ person: 'a', throughSpouse: 'anna' }, false).throughSpouse).toBe(true);
		expect(formStart({ person: 'a' }, false).throughSpouse).toBe(false);
	});

	it('ticking writes true, unticking removes the key, and a hand-written id stays while the box stays ticked', () => {
		const none = { number: '', ruler: '', from: '', to: '' };
		expect(formResult({ person: 'a' }, 'A', { ...none, throughSpouse: true }).throughSpouse).toBe('true');
		expect(formResult({ person: 'a', throughSpouse: 'true' }, 'A', { ...none, throughSpouse: false }).throughSpouse).toBeUndefined();
		expect(formResult({ person: 'a', throughSpouse: 'anna' }, 'A', { ...none, throughSpouse: true }).throughSpouse).toBe('anna');
		expect(formResult({ person: 'a', throughSpouse: 'anna' }, 'A', { ...none, throughSpouse: false }).throughSpouse).toBeUndefined();
	});

	it('the fields of an edit and of a new holder: the key is "through-spouse", after "to", null removes it', () => {
		expect(changedFields({ person: 'a' }, { person: 'a', throughSpouse: 'true' })).toEqual({ 'through-spouse': 'true' });
		expect(changedFields({ person: 'a', throughSpouse: 'true' }, { person: 'a' })).toEqual({ 'through-spouse': null });
		expect(changedFields({ person: 'a', throughSpouse: 'true' }, { person: 'a', throughSpouse: 'true' })).toEqual({});
		expect(Object.keys(addFields({ person: 'a', throughSpouse: 'true', to: '1100', from: '1090' }))).toEqual(['person', 'from', 'to', 'through-spouse']);
	});

	it('a tick writes the key into the note as a map entry, and an unticked box removes it again', () => {
		const rows = rowsOf();
		const king = titleOf(rows, 'king-of-the-vale');
		king.holders[1]!.values = { ...king.holders[1]!.values, throughSpouse: 'true' };
		const { ops, body } = (() => {
			const o = windowOps(rows, newId(BODY_13));
			return { ops: o, body: bodyOf(applyOp(BODY_13, { kind: 'batch', ops: o })) };
		})();
		expect(ops).toHaveLength(1);
		expect(body).toContain('through-spouse: true');
		const back = rowsOf(graph(body));
		titleOf(back, 'king-of-the-vale').holders[1]!.values = { ...titleOf(back, 'king-of-the-vale').holders[1]!.values };
		delete titleOf(back, 'king-of-the-vale').holders[1]!.values.throughSpouse;
		expect(bodyOf(applyOp(body, { kind: 'batch', ops: windowOps(back, newId(body)) }))).not.toContain('through-spouse');
	});
});

describe('the table note (D55, D60)', () => {
	it('the next free name, compared without case', () => {
		expect(freeName('Dukes of Valmont', new Set())).toBe('Dukes of Valmont');
		expect(freeName('Dukes of Valmont', new Set(['dukes of valmont.md']))).toBe('Dukes of Valmont 1');
		expect(freeName('Dukes of Valmont', new Set(['dukes of valmont.md', 'dukes of valmont 1.md']))).toBe('Dukes of Valmont 2');
	});
});

describe('the sheet texts (spec §13.4)', () => {
	const p = (id: string) => G13.byId.get(id)!;
	it('an entry: "Gareth I, 1158–1163"; the reign alone; nothing', () => {
		const duke = G13.titles.find((t) => t.id === 'duke-of-valmont')!;
		expect(entryText(duke.holders[3], 'Ser Gareth Orsini')).toBe('Gareth I, 1158–1163');
		expect(entryText(duke.holders[2], 'Roderick Valmont')).toBe('1150–1158');
		expect(entryText({ person: 'x', index: 0 }, 'X')).toBe(TITLES_UI.entryNone);
	});

	it('the title on the card (D62, D63): the selected title, else the first title unless a written title shows', () => {
		expect(titleOnCard(G13, p('young-aldric'))).toBe('king-of-the-vale');
		expect(titleOnCard(G13, p('edmund'))).toBe('duke-of-valmont');
		expect(titleOnCard(G13, p('bertrand'))).toBeUndefined();
		expect(titleOnCard(G13, p('king-roderick'))).toBe('king-of-the-vale');
	});

	it('Delete person adds the holder sentence (D57)', () => {
		const s = describeDelete(G13, 'gareth', {});
		expect(deleteText('Ser Gareth Orsini', s)).toContain('The plugin also removes Ser Gareth Orsini from the holders of 2 titles.');
		expect(deleteText('Elinor Harrow', describeDelete(G13, 'elinor', {})).join(' ')).not.toContain('holders');
	});
});

// ---------- the tree view, the Titles window and the sheet on the fakes ----------

/** A handle whose writes apply the op with the real `applyOp` and keep undo steps. */
function writingHandle(body = BODY_13): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	const undo: string[] = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		undo.push(h.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => {
		const prev = undo.pop();
		if (prev === undefined) return { ok: false, code: 'empty' };
		h.body = prev;
		return { ok: true, body: prev };
	}) as never);
	return h;
}

const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};
const top = () => openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl; constructor: { name: string } };
const cardText = (root: FEl, id: string, cls: string) =>
	root
		.querySelectorAll(`.dynasty-card[data-person="${id}"] .${cls}`)
		.map((e) => e.getText())
		.join(' ');

describe('card labels in the tree view (spec §13.3, §13.5)', () => {
	it('the name text line "Roderick I", the title text line with the reign, the accessible name from the label', async () => {
		const { el } = await embed(BODY_13, { handle: writingHandle() });
		expect(cardText(el, 'roderick', 'dynasty-card-name')).toBe('Roderick I');
		expect(cardText(el, 'roderick', 'dynasty-card-title')).toContain('(r.');
		const label = cardLabels(G13).get('roderick')!;
		expect(el.querySelector('.dynasty-card[data-person="roderick"]')!.getAttribute('aria-label')).toBe(`Roderick I, Duke of Valmont ${label.reign}, 1112–1175`);
		expect(cardText(el, 'young-aldric', 'dynasty-card-name')).toBe('Aldric III');
	});

	it('"Show dates on cards" off lays the tree out again: no reign on any card', async () => {
		const host = fakeHost() as Host & { settings?: typeof DEFAULT_SETTINGS };
		host.settings = { ...DEFAULT_SETTINGS };
		const { el, view } = await embed(BODY_13, { handle: writingHandle(), host });
		expect(el.querySelectorAll('.dynasty-card-title').some((t) => t.getText().includes('(r.'))).toBe(true);
		const prev = host.settings;
		host.settings = { ...prev, showDates: false };
		view.onSettingsChange(prev);
		await settle();
		const now = view.containerEl as unknown as FEl;
		fillAllCards(now);
		expect(now.querySelectorAll('.dynasty-card-title').length).toBeGreaterThan(0);
		expect(now.querySelectorAll('.dynasty-card-title').some((t) => t.getText().includes('(r.'))).toBe(false);
		expect(now.querySelector('.dynasty-root')!.hasClass('dynasty-no-dates')).toBe(true);
	});

	it('a tree with no titles keeps the M7 cards (the title text line is the written title)', async () => {
		const plain = 'people:\n  - id: a\n    name: Aldo Ardent\n    title: Duke\n';
		const { el } = await embed(plain, { handle: writingHandle(plain) });
		expect(cardText(el, 'a', 'dynasty-card-title')).toBe('Duke');
		expect(el.querySelector('.dynasty-card[data-person="a"]')!.getAttribute('aria-label')).toBe('Aldo Ardent, Duke');
	});
});

async function openTitles(handle = writingHandle()) {
	const host = fakeHost() as Host & { app: Record<string, unknown> };
	const { el } = await embed(handle.body, { handle, host });
	// 0.2.8 (G.13): Titles have a button of their own on the computer; they are no item of More there.
	const item = el.querySelector('.dynasty-titles-button');
	expect(item?.getAttribute('aria-label')).toBe(TITLES_UI.moreLabel);
	await click(item);
	const win = openModals.find((m) => (m as unknown) instanceof TitlesWindow) as unknown as { contentEl: FEl; modalEl: FEl } | undefined;
	expect(win).toBeDefined();
	return { el, host, handle, win: win!, content: win!.contentEl };
}

/** The edit page of a title: the window opens on the list, and a page is a second step (D134). */
const titleBox = (content: FEl, id: string) => {
	if (backButton(content)) backToList(content);
	return openPage(content, id);
};

describe('the Titles window on the fakes (spec §13.4)', () => {
	it('opens from More → Titles; lists the titles of the tree with their holder counts', async () => {
		const { content } = await openTitles();
		expect(rowNames(content)).toEqual(G13.titles.map((t) => t.name));
		expect(rowTexts(content).find((t) => t.startsWith('Duke of Valmont'))).toContain('7 holders');
	});

	it('Show holders lists the holders in order; a move and Save make one write, which one undo restores', async () => {
		const { content, handle } = await openTitles();
		const rows = titleBox(content, 'king-of-the-vale').querySelectorAll('.dynasty-holder-row');
		expect(rows.map((r) => r.querySelector('.dynasty-holder-name')!.getText())).toEqual(['Aldric III', 'Edmund I', 'Roderick Valmont']);
		expect(titleBox(content, 'king-of-the-vale').querySelector('.dynasty-lw-pagehead .dynasty-head-name')!.getText()).toBe('King of the Vale');
		// Move earlier is off on the first holder, Move later on the last (the menu "more" of each row).
		await click(rows[0].querySelector('.dynasty-holder-more'));
		expect(lastMenu()!.item(TITLES_UI.moveEarlier)!.disabled).toBe(true);
		await click(rows[2].querySelector('.dynasty-holder-more'));
		expect(lastMenu()!.item(TITLES_UI.moveLater)!.disabled).toBe(true);
		await click(rows[0].querySelector('.dynasty-holder-more'));
		lastMenu()!.item(TITLES_UI.moveLater)!.click();
		const after = content.querySelectorAll('.dynasty-lw-page .dynasty-holder-name').map((n) => n.getText());
		expect(after).toEqual(['Edmund I', 'Aldric III', 'Roderick Valmont']);
		expect(handle.ops).toHaveLength(0);
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.ops[0].kind).toBe('batch');
		expect(graph(handle.body).titles.find((t) => t.id === 'king-of-the-vale')!.holders.map((h) => h.person)).toEqual(['edmund', 'young-aldric', 'king-roderick']);
		expect(openModals.some((m) => (m as unknown) instanceof TitlesWindow)).toBe(false);
		await handle.undo();
		expect(handle.body).toBe(BODY_13);
	});

	it('the Names section has the name, the name for a man and the name for a woman, and no list name (D201); a rename is one write that one undo restores', async () => {
		const { content, handle } = await openTitles();
		const box = titleBox(content, 'duke-of-valmont');
		expect(box.querySelector('.dynasty-title-plural')).toBeNull();
		const name = box.querySelector('.dynasty-title-name textarea')!;
		expect(name.value).toBe('Duke of Valmont');
		expect(name.getAttribute('placeholder')).toBe(TITLES_UI.namePlaceholder);
		name.value = 'Grand Duke of Valmont';
		dispatch(name, 'input');
		expect(content.querySelector('.dynasty-lw-pagehead .dynasty-head-name')!.getText()).toBe('Grand Duke of Valmont');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		// The written plural stays (A.3).
		expect(handle.body).toBe(replaceOnce(BODY_13, '    name: Duke of Valmont\n', '    name: Grand Duke of Valmont\n'));
		await handle.undo();
		expect(handle.body).toBe(BODY_13);
	});

	it('Cancel with changes writes nothing; Esc with changes asks first', async () => {
		const { content, handle, win } = await openTitles();
		const name = titleBox(content, 'duke-of-valmont').querySelector('.dynasty-title-name textarea')!;
		name.value = 'Grand Duke of Valmont';
		dispatch(name, 'input');
		// The first close leaves the page (D.3.8); the second one asks.
		(win as unknown as { close(): void }).close();
		expect(win.modalEl.querySelector('.dynasty-sheet-confirm')).toBeNull();
		(win as unknown as { close(): void }).close();
		expect(win.modalEl.querySelector('.dynasty-sheet-confirm')!.getText()).toContain(TITLES_UI.discardText);
		await click(win.modalEl.querySelector('.dynasty-sheet-discard'));
		expect(handle.ops).toHaveLength(0);
		expect(openModals.some((m) => (m as unknown) instanceof TitlesWindow)).toBe(false);
	});

	it('Delete asks with the holders and the cards that change, then Save deletes the title (one write)', async () => {
		const { content, handle, win } = await openTitles();
		await click(titleBox(content, 'king-of-the-vale').querySelector('.dynasty-title-delete'));
		const ask = win.modalEl.querySelector('.dynasty-sheet-confirm')!.getText();
		expect(ask).toContain(TITLES_UI.deleteTitle('King of the Vale'));
		expect(ask).toContain(TITLES_UI.deleteHolders(4));
		expect(ask).toContain(TITLES_UI.deleteCards(2));
		await click(win.modalEl.querySelector('.dynasty-confirm-delete-title'));
		expect(content.querySelector('.dynasty-lw-row[data-title="king-of-the-vale"]')).toBeNull();
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		const g = graph(handle.body);
		expect(g.titles.map((t) => t.id)).not.toContain('king-of-the-vale');
		// The card-titles that named it went in the same write (§13.3).
		expect(handle.body).not.toContain('card-title: king-of-the-vale');
		expect(notices.some((n) => n.startsWith(TITLES_UI.deleted(['King of the Vale'])))).toBe(true);
	});

	it('Make a note with this table: the next free name in the folder for new notes, the saved list; the tree does not change', async () => {
		const { content, host, handle } = await openTitles();
		const create = vi.fn(async () => ({}));
		(host.app.vault as unknown as Record<string, unknown>).create = create;
		host.app.fileManager = { getNewFileParent: () => ({ isRoot: () => false, path: 'Lists', children: [{ name: 'Dukes of Valmont.md' }] }) };
		await click(titleBox(content, 'duke-of-valmont').querySelector('.dynasty-title-note'));
		expect(create).toHaveBeenCalledWith('Lists/Dukes of Valmont 1.md', holderTable(G13, G13.titles[0]));
		expect(notices).toContain(TITLES_UI.noteMade('Dukes of Valmont 1'));
		expect(handle.ops).toHaveLength(0);
	});

	it('with unsaved changes, the table note asks first', async () => {
		const { content, host, win } = await openTitles();
		const create = vi.fn(async () => ({}));
		(host.app.vault as unknown as Record<string, unknown>).create = create;
		host.app.fileManager = { getNewFileParent: () => ({ isRoot: () => true, path: '/', children: [] }) };
		await click(titleBox(content, 'duke-of-valmont').querySelector('.dynasty-holder-more'));
		lastMenu()!.item(TITLES_UI.remove)!.click();
		await click(content.querySelector('.dynasty-lw-page .dynasty-title-note'));
		expect(create).not.toHaveBeenCalled();
		expect(win.modalEl.querySelector('.dynasty-sheet-confirm')!.getText()).toContain(TITLES_UI.noteText);
		await click(win.modalEl.querySelector('.dynasty-confirm-note'));
		// The saved list: all 7 holders, not the draft's 6.
		expect(create).toHaveBeenCalledWith('Dukes of Valmont.md', holderTable(G13, G13.titles[0]));
	});

	it('Edit opens the holder form; its Save changes the draft only', async () => {
		const { content, handle } = await openTitles();
		await click(titleBox(content, 'duke-of-valmont').querySelectorAll('.dynasty-holder-more')[2]);
		lastMenu()!.item(TITLES_UI.edit)!.click();
		const form = top();
		expect(form.modalEl.hasClass('dynasty-holder-form')).toBe(true);
		const number = form.contentEl.querySelector('[data-field="number"] input')!;
		// D131: the field is empty when the entry has no `as`; the first word is its hint.
		const ruler = form.contentEl.querySelector('[data-field="ruler"] input')!;
		expect(ruler.value).toBe('');
		expect(ruler.getAttribute('placeholder')).toBe('Roderick');
		number.value = 'I';
		dispatch(number, 'input');
		expect(form.contentEl.querySelector('.dynasty-holder-preview')!.getText()).toBe(TITLES_UI.preview('Roderick Valmont', 'Roderick I'));
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(0);
		expect(content.querySelectorAll('.dynasty-lw-page .dynasty-holder-name')[2].getText()).toBe('Roderick I');
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toBe(BODY_13.replace('      - {person: roderick, from: 1150, to: 1158}\n', '      - {person: roderick, number: I, from: 1150, to: 1158}\n'));
	});

	it('D131: a holder who is not in the tree: the ruler field stays empty and its hint follows the name field; a typed ruler name is kept', async () => {
		const { content } = await openTitles();
		await click(titleBox(content, 'count-of-orsini').querySelectorAll('.dynasty-holder-more')[0]);
		lastMenu()!.item(TITLES_UI.edit)!.click();
		const form = top();
		const ruler = form.contentEl.querySelector('[data-field="ruler"] input')!;
		const name = form.contentEl.querySelector('[data-field="holder-name"] input')!;
		expect(ruler.value).toBe('');
		expect(ruler.getAttribute('placeholder')).toBe('Orso the Old');
		name.value = 'Orso the Elder';
		dispatch(name, 'input');
		expect(ruler.value).toBe('');
		expect(ruler.getAttribute('placeholder')).toBe('Orso the Elder');
		ruler.value = 'Orso';
		dispatch(ruler, 'input');
		name.value = 'Orso the Eldest';
		dispatch(name, 'input');
		expect(ruler.value).toBe('Orso');
		expect(form.contentEl.querySelector('.dynasty-holder-preview')!.getText()).toBe(TITLES_UI.preview('Orso the Eldest', 'Orso'));
	});
});

describe('the holder form: the tick box and the text fields (D195, D196 item 1, contract A.2)', () => {
	async function formOf(titleId: string, index: number) {
		const { content, handle } = await openTitles();
		await click(titleBox(content, titleId).querySelectorAll('.dynasty-holder-more')[index]);
		lastMenu()!.item(TITLES_UI.edit)!.click();
		return { content, handle, form: top() };
	}

	it('a person in the tree has the tick box with its hint; ticking writes through-spouse: true in one write, and one undo restores the note', async () => {
		const { content, handle, form } = await formOf('duke-of-valmont', 2);
		const box = form.contentEl.querySelector('[data-field="through-spouse"] input')!;
		expect(box.getAttribute('type')).toBe('checkbox');
		expect(box.disabled).toBe(false);
		expect(box.checked).toBe(false);
		expect(form.contentEl.querySelector('[data-field="through-spouse"] label')!.getText()).toBe(TITLES_UI.holderTickLabel);
		expect(form.contentEl.querySelector('[data-field="through-spouse"] .dynasty-sheet-hint')!.getText()).toBe(TITLES_UI.holderTickHint);
		box.checked = true;
		dispatch(box, 'change');
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(0);
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toContain('through-spouse: true');
		await handle.undo();
		expect(handle.body).toBe(BODY_13);
	});

	it('a holder who is not in the tree has the box off, with the reason under it', async () => {
		const { form } = await formOf('count-of-orsini', 0);
		const box = form.contentEl.querySelector('[data-field="through-spouse"] input')!;
		expect(box.disabled).toBe(true);
		expect(box.checked).toBe(false);
		expect(form.contentEl.querySelector('[data-field="through-spouse"] .dynasty-sheet-hint')!.getText()).toBe(TITLES_UI.holderTickDisabled);
	});

	it('the name fields of the form do not start with a capital and do not correct the text (D196 item 1)', async () => {
		const { form } = await formOf('count-of-orsini', 0);
		for (const name of ['holder-name', 'ruler', 'number']) {
			const input = form.contentEl.querySelector(`[data-field="${name}"] input`)!;
			expect(input.getAttribute('autocapitalize'), name).toBe('off');
			expect(input.getAttribute('autocorrect'), name).toBe('off');
		}
	});

	it('the Titles page has no field for the list name (D201) and its name fields do not start with a capital', async () => {
		const { content } = await openTitles();
		const page = titleBox(content, 'duke-of-valmont');
		expect(page.querySelector('.dynasty-title-plural')).toBeNull();
		expect(page.querySelector('[data-field="plural"]')).toBeNull();
		for (const cls of ['dynasty-title-name', 'dynasty-title-male', 'dynasty-title-female']) {
			expect(page.querySelector(`.${cls} textarea`)!.getAttribute('autocapitalize'), cls).toBe('off');
		}
	});
});

describe('the Titles section of the edit sheet (spec §13.4)', () => {
	async function sheetOf(id: string, handle = writingHandle()) {
		const { el } = await embed(handle.body, { handle });
		const sheet = await openSheetOn(el, id, 'mouse');
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		return { el, handle, sheet, content };
	}

	it('sits between the fields and Family; lists each title with its entries', async () => {
		const { content } = await sheetOf('roderick');
		// 0.2.8: Details, Family, Titles, Notes, Actions (the sections of the person window).
		const body = content.querySelector('.dynasty-sheet-body')!;
		expect(body.querySelectorAll('section.dynasty-section').map((c) => c.getAttribute('data-section'))).toEqual(['details', 'family', 'titles', 'notes', 'actions']);
		const sec = content.querySelector('[data-section="titles"]')!;
		expect(sec.querySelectorAll('.dynasty-title-entry').map((e) => e.querySelector('.dynasty-family-detail')!.getText())).toEqual(['1150–1158', 'Roderick I · from 1163']);
		// One title and no written title: no "Show on the card" (§13.4).
		expect(sec.querySelector('.dynasty-show-on-card')).toBeNull();
	});

	it('"Show on the card" on the first title removes the card-title line (one write)', async () => {
		const { content, handle } = await sheetOf('young-aldric');
		const sec = content.querySelector('[data-section="titles"]')!;
		expect(sec.querySelector('.dynasty-title-holding[data-title="king-of-the-vale"] .dynasty-title-on-card')!.getText()).toBe(TITLES_UI.onCard);
		await click(sec.querySelector('.dynasty-title-holding[data-title="duke-of-valmont"] .dynasty-show-on-card'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toBe(replaceOnce(BODY_13, '    name: Aldric Valmont\n    card-title: king-of-the-vale\n', '    name: Aldric Valmont\n'));
	});

	it('Remove writes at once, with a Notice with Undo', async () => {
		const { content, handle } = await sheetOf('gareth');
		await click(content.querySelector('[data-section="titles"] .dynasty-remove-holder'));
		expect(handle.ops).toHaveLength(1);
		expect(graph(handle.body).titles[0].holders.map((h) => h.person ?? h.name)).not.toContain('gareth');
		expect(notices.some((n) => n.startsWith(TITLES_UI.removed('Ser Gareth Orsini', 'Duke of Valmont')))).toBe(true);
	});

	it('Edit writes only the changed value of that entry; a block-map holder stays a block map', async () => {
		const { content, handle } = await sheetOf('gareth');
		await click(content.querySelector('[data-section="titles"] .dynasty-edit-holder'));
		const form = top();
		const to = form.contentEl.querySelector('[data-field="to"] input')!;
		to.value = '1164';
		dispatch(to, 'input');
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		expect(handle.body).toBe(replaceOnce(BODY_13, '        from: 1158\n        to: 1163\n', '        from: 1158\n        to: 1164\n'));
	});

	it('Add title → New title… → the form with the person\'s title text; one write adds the title and the holder', async () => {
		const { content, handle } = await sheetOf('bertrand');
		await click(content.querySelector('.dynasty-add-title'));
		const choice = top();
		const options = choice.contentEl.querySelectorAll('.dynasty-choice-option');
		expect(options.map((o) => o.querySelector('.dynasty-choice-label')!.getText())).toEqual([...G13.titles.map((t) => t.name), TITLES_UI.newTitleChoice]);
		await click(options[options.length - 1]);
		const form = top();
		const title = form.contentEl.querySelector('[data-field="title-name"] input')!;
		expect(title.value).toBe('Count Palatine of Orsini');
		const from = form.contentEl.querySelector('[data-field="from"] input')!;
		from.value = '1100';
		dispatch(from, 'input');
		await click(form.contentEl.querySelector('.dynasty-sheet-save'));
		expect(handle.ops).toHaveLength(1);
		const t = graph(handle.body).titles.find((x) => x.name === 'Count Palatine of Orsini');
		expect(t?.id).toBe('count-palatine-of-orsini');
		expect(t?.holders.map((h) => `${h.person}:${h.from}`)).toEqual(['bertrand:1100']);
	});
});
