import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers for each step of a sheet flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { describeHouseIdChange } from '../src/core/house-ops';
import { nextPersonId } from '../src/core/id-gen';
import { REFUSAL_TEXT } from '../src/core/refusal-text';
import { parseBody, parseDynasty, readTree } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { HousesWindow, houseOps, loadHouses, rowsOf } from '../src/obsidian/houses-window';
import { danglingIds, idFromName, idOps, idProblemFor, idProblems, idRefusalText, type IdRow } from '../src/view/id-draft';
import { closePluginModals } from '../src/view/plugin-modals';
import { titlesDraftChanged, rebase, titleIdRow, titleRows, windowOps, withHolderIds } from '../src/view/titles-draft';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { HOUSES, ID_UI, REMOVE, SHEET, TITLES_UI, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { lastMenu, noticeList, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { backToList, backButton, openPage, pageOf } from './lw-support';
import { nextIdFor } from './helpers';

/*
 * Version 0.2.2, WP3 (spec §13.17): the numbered person id at the four places that make one, the Id
 * line of the edit sheet (D106), and the Id change of the Houses window and the Titles window (D109, D110).
 * The real windows run on the fakes; the handle's write applies the op with the real `applyOp`.
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
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	// The fake DOM has no `:not(:disabled)` (the sheet puts the focus back with it).
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

type Writing = FakeHandle & { ops: Op[] };

/** A handle whose writes apply the op to its body, with a one-step undo, as the real handle does. */
function writingHandle(body: string): Writing {
	const h = fakeHandle('n.md', body) as Writing;
	h.ops = [];
	const undo: string[] = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		undo.push(h.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
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

function type(input: FEl, text: string): void {
	input.value = text;
	dispatch(input, 'input');
}

// ---------------------------------------------------------------------------------------------
// Rule 1: one numbered id at every place that makes a person id

describe('a new person id is the same at the four places (§13.17 rule 1, D104)', () => {
	// p1 and p3 are written, p9 is named by a parent entry, and two people have no id.
	const TREE = ['people:', '  - id: p1', '    name: Aldric', '  - id: p3', '    name: Aldric', '    parents: [p1]', '  - name: Bran', '    parents: [p9]', '  - name: Cora', ''].join('\n');
	const EXPECTED = 'p10';

	it('newPersonId, withHolderIds, idsFor (the sheet) and the new-person write all give p10 for the same text', async () => {
		expect(nextIdFor(TREE)).toBe(EXPECTED);

		const parsed = parseBody(TREE);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, TREE));
		const unwritten = [...g.byId.keys()].filter((id) => id.startsWith('~'));
		expect(unwritten).toHaveLength(2);
		const holders: Op[] = [{ kind: 'set-holders', title: 'duke', items: [{ add: { person: unwritten[0] } }] }];
		const out = withHolderIds(holders, g, parsed.data);
		expect(out[0]).toEqual({ kind: 'set-person-fields', id: unwritten[0], fields: { id: EXPECTED } });

		// The sheet of an unwritten person gives them an id when an action needs it (idsFor).
		const h = writingHandle(TREE);
		const sheet = EditSheet.create({} as never, { handle: h as never, personId: unwritten[0], sourcePath: 'n.md' })!;
		sheet.open();
		const modal = (sheet as unknown as { modalEl: FEl }).modalEl;
		dispatch(modal.querySelector('.dynasty-pin')!, 'click');
		await settle();
		expect(h.body).toContain(`id: ${EXPECTED}\n    name: Bran`);

		// The new-person write of the sheet.
		const h2 = writingHandle(TREE);
		const host = fakeHost() as Host;
		const { el } = await embed(TREE, { handle: h2, host });
		await click(el.querySelector('.dynasty-add-person'));
		const add = openModals[openModals.length - 1] as unknown as EditSheet;
		const nameInput = (add as unknown as { modalEl: FEl }).modalEl.querySelector('[data-field="name"] input')!;
		type(nameInput, 'Aldric');
		await click((add as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-save'));
		expect(h2.body).toContain(`id: ${EXPECTED}\n    name: Aldric`);
	});

	it('two people with no id, named by one write, get two different numbers; the name never matters', async () => {
		const body = ['people:', '  - id: a', '    name: Aldric', '  - name: Bran', '  - name: Bran', ''].join('\n');
		const h = writingHandle(body);
		const sheet = EditSheet.create({} as never, { handle: h as never, personId: '~3', sourcePath: 'n.md' })!;
		sheet.open();
		// Add partner, an existing person: the sheet's person and the partner have no id.
		answers.push('existing', { kind: 'person', id: '~2' }, 'marriage');
		dispatch((sheet as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		const tree = parseDynasty(h.body);
		if (!tree.ok) throw new Error('parse');
		const ids = tree.tree.people.map((p) => p.id);
		expect(ids).toEqual(['a', 'p2', 'p1']);
		expect(new Set(ids).size).toBe(3);
	});

	it('nextPersonId from core is what every place uses (the name is not an input)', () => {
		expect(nextPersonId(new Set(['p4', 'aldric']))).toBe('p5');
		expect(nextIdFor('people:\n  - id: p4\n    name: X\n')).toBe('p5');
		expect(nextIdFor('people:\n  - id: p4\n    name: X\n')).toBe('p5');
	});
});

// ---------------------------------------------------------------------------------------------
// Rule 3: the Id line of the edit sheet

describe('the Id line of the edit sheet (§13.17 rule 3, D106)', () => {
	const BODY = ['people:', '  - id: p12', '    name: Aldric', '  - name: Bran', '    parents: [p12]', ''].join('\n');

	const open = (personId: string, h = writingHandle(BODY)) => {
		const sheet = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
		sheet.open();
		return { sheet, modal: (sheet as unknown as { modalEl: FEl }).modalEl };
	};

	it('shows "ID: p12" as the last element of the scrolling body, after Delete person, for a written id', () => {
		const { modal } = open('p12');
		const body = modal.querySelector('.dynasty-sheet-body')!;
		const line = body.querySelector('.dynasty-sheet-id');
		expect(line).not.toBeNull();
		expect(line!.getText()).toBe(SHEET.idLine('p12'));
		expect(SHEET.idLine('p12')).toBe('ID: p12');
		// 0.2.8: the line is the last element of the section Actions, after the row Delete person.
		const actions = body.querySelector('[data-section="actions"]')!;
		const items = actions.querySelectorAll('.dynasty-sheet-id, .dynasty-delete');
		expect(items[items.length - 1]).toBe(line);
		expect(items.indexOf(line!)).toBeGreaterThan(items.indexOf(actions.querySelector('.dynasty-delete')!));
		// Plain text: not a field, not a button, and not in the Save and Cancel bar.
		expect(line!.tag).toBe('div');
		expect(line!.querySelector('input')).toBeNull();
		expect(modal.querySelector('.dynasty-foot')!.querySelector('.dynasty-sheet-id')).toBeNull();
	});

	it('is not shown for a person with no written id', () => {
		const { modal } = open('~2');
		expect(modal.querySelector('.dynasty-sheet-id')).toBeNull();
	});

	it('is not shown on the sheet of a new person', () => {
		const sheet = EditSheet.createNew({} as never, { handle: writingHandle(BODY) as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		sheet.open();
		const modal = (sheet as unknown as { modalEl: FEl }).modalEl;
		expect(modal.hasClass('is-new')).toBe(true);
		expect(modal.querySelector('.dynasty-sheet-id')).toBeNull();
	});

	it('shows again when the sheet of a saved person is opened again, with the id that the write gave', async () => {
		const h = writingHandle(BODY);
		const first = open('~2', h);
		// An action that needs an id writes it first (the person had none).
		await click(first.modal.querySelector('.dynasty-pin'));
		const written = parseDynasty(h.body);
		if (!written.ok) throw new Error('parse');
		const id = written.tree.people.find((p) => p.name === 'Bran')!.id;
		expect(id).toBe('p13');
		const again = open(id, h);
		expect(again.modal.querySelector('.dynasty-sheet-id')!.getText()).toBe('ID: p13');
	});

	it('has a muted colour rule, selectable text and no field style in styles.css', () => {
		const css = readFileSync('styles.css', 'utf8');
		const rule = /\.dynasty-sheet-id \{([^}]*)\}/.exec(css);
		expect(rule).not.toBeNull();
		expect(rule![1]).toContain('color: var(--dynasty-muted)');
		expect(rule![1]).toContain('user-select: text');
		// No colour value is written into the rules of the Id field.
		expect(/#[0-9a-f]{3,8}\b|rgb\(/i.test(rule![1])).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------
// Rule 5: the draft logic (pure)

describe('the Id draft check (§13.17 rule 5)', () => {
	const row = (key: string, id: string | null, idDraft: string | undefined, name = key, deleted = false): IdRow => ({ key, id, idDraft, name, deleted });
	const check = (rows: IdRow[], dangling: string[] = []) => Object.fromEntries(idProblems('house', rows, dangling));

	it('an unchanged field is never checked (a hand-typed id stays valid)', () => {
		expect(check([row('a', 'House_Valmont', 'House_Valmont')])).toEqual({});
		expect(idOps('house', [row('a', 'House_Valmont', 'House_Valmont')])).toEqual([]);
		// Spaces at the ends are trimmed: the same id is no change.
		expect(idOps('house', [row('a', 'valmont', '  valmont ')])).toEqual([]);
	});

	it('refuses empty, other characters, a capital, no letter or digit, and an id in use', () => {
		const rows = [row('a', 'valmont', ''), row('b', 'orsini', 'Orsini'), row('c', 'thorne', '-'), row('d', 'rho', 'a b'), row('e', 'sigma', 'valmont')];
		expect(check(rows)).toEqual({ a: 'empty', b: 'characters', c: 'characters', d: 'characters', e: 'taken' });
	});

	it('idProblemFor checks a typed value for one row (the small window): the saved id and an unchanged value are allowed, the other rows count', () => {
		const rows = [row('a', 'valmont', 'valmont'), row('b', 'orsini', 'crown'), row('c', 'thorne', 'thorne')];
		const a = rows[0];
		expect(idProblemFor('house', rows, a, 'valmont', [])).toBeNull();
		expect(idProblemFor('house', rows, a, ' fresh ', [])).toBeNull();
		expect(idProblemFor('house', rows, a, 'orsini', [])).toBe('taken');
		expect(idProblemFor('house', rows, a, 'crown', [])).toBe('taken');
		expect(idProblemFor('house', rows, a, 'ghost', ['ghost'])).toBe('taken');
		expect(idProblemFor('house', rows, a, '', [])).toBe('empty');
		expect(idProblemFor('house', rows, a, 'Valmont', [])).toBe('characters');
		// The row itself is not changed by the question.
		expect(a.idDraft).toBe('valmont');
	});

	it('spaces at both ends are trimmed before the check and in the op', () => {
		expect(check([row('a', 'valmont', '  crown  ')])).toEqual({});
		expect(idOps('house', [row('a', 'valmont', '  crown  ')])).toEqual([{ kind: 'set-house-id', id: 'valmont', newId: 'crown' }]);
	});

	it('the saved ids of other rows, also rows marked for deletion, are taken', () => {
		expect(check([row('a', 'valmont', 'orsini'), row('b', 'orsini', 'orsini', 'b', true)])).toEqual({ a: 'taken' });
	});

	it('the draft ids of other rows are taken', () => {
		expect(check([row('a', 'valmont', 'crown'), row('b', 'orsini', 'crown')])).toEqual({ a: 'taken', b: 'taken' });
	});

	it('a swap and a chain are refused', () => {
		expect(check([row('a', 'a', 'b'), row('b', 'b', 'a')])).toEqual({ a: 'taken', b: 'taken' });
		expect(check([row('a', 'a', 'b'), row('b', 'b', 'c')])).toEqual({ a: 'taken' });
	});

	it('the id that a new row would get is taken, and the new row is marked too (3-both); a deleted row sends no id and no check', () => {
		const newRow = row('n', null, undefined, 'House Crown');
		expect(check([row('a', 'valmont', 'house-crown'), newRow])).toEqual({ a: 'taken', n: 'newName' });
		expect(check([row('a', 'valmont', 'Bad Id', 'a', true)])).toEqual({});
		expect(idOps('house', [row('a', 'valmont', 'crown', 'a', true)])).toEqual([]);
	});

	it('an id that people name and no item has (a dangling value) is taken', () => {
		expect(check([row('a', 'valmont', 'ghost')], ['ghost'])).toEqual({ a: 'taken' });
		const body = ['houses:', '  - id: valmont', '    name: V', 'people:', '  - {id: a, name: A, house: valmont}', '  - {id: b, name: B, house: ghost}', '  - {name: C, house: ghost}', ''].join('\n');
		const parsed = parseBody(body);
		if (!parsed.ok) throw new Error('parse');
		expect(danglingIds(parsed.data, 'house')).toEqual(['ghost']);
		const titles = ['titles:', '  - id: duke', '    name: Duke', 'people:', '  - {id: a, name: A, card-title: duke}', '  - {id: b, name: B, card-title: lost}', ''].join('\n');
		const t = parseBody(titles);
		if (!t.ok) throw new Error('parse');
		expect(danglingIds(t.data, 'title')).toEqual(['lost']);
	});

	it('"Make ID from the name" uses the draft name, not the saved id; an empty name does nothing', () => {
		const rows = [row('a', 'old-id', 'old-id', 'House Valmont'), row('b', 'house-orsini', 'house-orsini', 'House Orsini')];
		expect(idFromName('house', rows, rows[0], [])).toBe('house-valmont');
		// The own saved id does not count as taken.
		expect(idFromName('house', rows, row('b', 'house-orsini', 'x', 'House Orsini'), [])).toBe('house-orsini');
		// Another row's id does.
		expect(idFromName('house', rows, row('a', 'old-id', 'old-id', 'House Orsini'), [])).toBe('house-orsini-2');
		expect(idFromName('house', rows, row('a', 'old-id', 'old-id', '   '), [])).toBeNull();
		// A title with no usable letters is a "title".
		expect(idFromName('title', [row('t', 'x', 'x', '???')], row('t', 'x', 'x', '???'), [])).toBe('title');
	});

	it('refusal texts: id-taken and bad-value of an id op are never the stale text', () => {
		expect(idRefusalText('id-taken', undefined)).toBe(ID_UI.inUse);
		expect(idRefusalText('bad-value', 'A value of this id is a YAML anchor or alias. Edit the note text.')).toBe(ID_UI.anchor);
		expect(idRefusalText('bad-value', REFUSAL_TEXT.idCharacters)).toBe(ID_UI.notAllowed);
		expect(idRefusalText('unknown-house', undefined)).toBeNull();
		for (const text of [ID_UI.inUse, ID_UI.notAllowed, ID_UI.anchor]) {
			expect(text).not.toBe(HOUSES.stale);
			expect(text).not.toBe(TITLES_UI.stale);
		}
	});
});

// ---------------------------------------------------------------------------------------------
// Rule 5: the Houses window

const HOUSES_BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8c2f39"
  - id: orsini
    name: House Orsini
  - id: thorne
    name: House Thorne

people:
  - id: aldric
    name: Aldric Valmont
    house: valmont # the head
  - id: isolde
    name: Isolde Orsini
    house: orsini
  - id: lucan
    name: Lucan Orsini
    house: orsini
  - name: Nobody
    house: ghost

unions:
  - partners: [aldric, isolde]
`;

const housesWindows = () => openModals.filter((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow[];

async function openHouses(body = HOUSES_BODY, handle: Writing = writingHandle(body)) {
	const e = await embed(handle.body, { handle });
	const button = e.el.querySelector('.dynasty-houses-button')!;
	button.focus();
	dispatch(button, 'click');
	await settle();
	const win = housesWindows()[0];
	expect(win).toBeDefined();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { ...e, handle, win, content, modal };
}

/** The edit page of an item: the page on screen if it is that item's page, else the list row is tapped (Back first when another page shows). */
function gotoPage(content: FEl, id: string): FEl {
	const page = backButton(content) ? pageOf(content) : null;
	if (page && (page.getAttribute('data-house') === id || page.getAttribute('data-title') === id)) return page;
	if (page) backToList(content);
	return openPage(content, id);
}
const saveOf = (content: FEl) => content.querySelector('.dynasty-sheet-save')!;
const confirmOf = (modal: FEl) => modal.querySelector('.dynasty-sheet-confirm');
const confirmLines = (modal: FEl) => confirmOf(modal)!.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText());

/** The modal on top: the small Id window when one is open. */
const topModal = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
const fieldOf = (w: FEl) => w.querySelector('.dynasty-id-input')!;
const useOf = (w: FEl) => w.querySelector('.dynasty-id-use')!;
const problemOf = (w: FEl) => w.querySelector('.dynasty-id-problem')!.getText();

/** Taps "Change ID" on an edit page and returns the small window. */
async function openIdOf(page: FEl): Promise<FEl> {
	await click(page.querySelector('.dynasty-id-open'));
	const w = topModal();
	expect(w.hasClass('dynasty-id-window')).toBe(true);
	return w;
}

/** Types an id into the small window of an item and taps "Use this ID"; the page of the item stays open. */
async function setId(content: FEl, id: string, value: string): Promise<void> {
	const w = await openIdOf(gotoPage(content, id));
	type(fieldOf(w), value);
	await click(useOf(w));
}

/** The note "New ID: ..." on the page that shows now. */
const noteOf = (content: FEl) => pageOf(content).querySelector('.dynasty-id-new');
/** The name field of the page that shows now. */
const nameField = (content: FEl, cls: 'dynasty-house-name' | 'dynasty-title-name') => pageOf(content).querySelector(`.${cls} textarea`)!;
const idOpen = (content: FEl) => pageOf(content).querySelector('.dynasty-id-open');

describe('Houses window: the Id change (§13.17 rule 5, D109, D110)', () => {
	it('the list shows no Id field, no "Make id" button and no reason; each saved house page has "Change ID" before Delete, with its accessible name; a new house has none', async () => {
		const { content } = await openHouses();
		for (const q of ['.dynasty-id-row', '.dynasty-id-input', '.dynasty-id-make', '.dynasty-id-problem', '.dynasty-id-new', '.dynasty-id-open']) expect(content.querySelectorAll(q)).toHaveLength(0);
		for (const [id, name] of [['valmont', 'House Valmont'], ['orsini', 'House Orsini'], ['thorne', 'House Thorne']]) {
			const page = gotoPage(content, id);
			const button = page.querySelector('.dynasty-id-open')!;
			expect(button.querySelector('.dynasty-row-title')!.getText()).toBe('Change ID');
			expect(button.getAttribute('aria-label')).toBe(`Change ID: change the ID of ${name}`);
			expect(button.tag).toBe('button');
			// The button comes before Delete, in the section "Other actions".
			const row = button.parentElement!;
			expect(row.children.indexOf(button)).toBeLessThan(row.children.indexOf(row.querySelector('.dynasty-house-delete')!));
		}
		backToList(content);
		await click(content.querySelector('.dynasty-house-add'));
		expect(pageOf(content).querySelector('.dynasty-id-open')).toBeNull();
		// 44 px: the CSS rules of the buttons (the harness measures the real window).
		const css = readFileSync('styles.css', 'utf8');
		expect(/\.dynasty-sheet button\.dynasty-id-open \{[^}]*min-height: 44px/.test(css)).toBe(true);
		expect(/\.dynasty-sheet button\.dynasty-id-old \{[^}]*min-height: 44px/.test(css)).toBe(true);
		expect(/\.dynasty-sheet \.dynasty-id-field \.dynasty-sheet-input \{[^}]*min-height: 44px/.test(css)).toBe(true);
		// 0.2.8: every window of the family is 620 px wide on a computer.
		expect(/\.modal\.dynasty-sheet \{[^}]*width: min\(620px/.test(css)).toBe(true);
	});

	it('the accessible name of the button follows the name in the field', async () => {
		const { content } = await openHouses();
		gotoPage(content, 'valmont');
		type(nameField(content, 'dynasty-house-name'), 'Crown');
		expect(idOpen(content)!.getAttribute('aria-label')).toBe('Change ID: change the ID of Crown');
	});

	it('the small window has the title, the hint, the Id field with the id of the draft, "Make ID from the name", the buttons, and the focus is in the field', async () => {
		const { content, modal } = await openHouses();
		const w = await openIdOf(gotoPage(content, 'thorne'));
		expect(w.hasClass('dynasty-sheet')).toBe(true);
		expect(w.querySelector('.dynasty-sheet-title')!.getText()).toBe('ID of House Thorne');
		expect(w.querySelector('.dynasty-sheet-hint')!.getText()).toBe('The ID is a short name. The plugin uses it to find this house. Most users never change it.');
		expect(fieldOf(w).value).toBe('thorne');
		expect(fieldOf(w).getAttribute('aria-label')).toBe('ID of House Thorne');
		expect(w.querySelector('.dynasty-id-make')!.getText()).toBe('Make ID from the name');
		expect([w.querySelector('.dynasty-sheet-cancel')!, useOf(w)].map((b) => b.getText())).toEqual(['Cancel', 'Use this ID']);
		expect(problemOf(w)).toBe('');
		expect(fakeDoc.activeElement).toBe(fieldOf(w));
		// The small window is a modal over the Houses window, which does not change.
		expect(modal.querySelector('.dynasty-id-window')).toBeNull();
		expect(openModals).toHaveLength(2);
	});

	it('"Use this ID" puts the id into the draft, closes the small window and shows the note and "Keep old ID"; nothing is written', async () => {
		const { content, handle, win } = await openHouses();
		await setId(content, 'valmont', '  crown ');
		expect(openModals).toHaveLength(1);
		expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
		const keep = noteOf(content)!.querySelector('button')!;
		expect(keep.getText()).toBe('Keep old ID');
		expect(keep.getAttribute('aria-label')).toBe('Keep old ID: keep the old ID of House Valmont');
		expect(content.querySelectorAll('.dynasty-id-new')).toHaveLength(1);
		expect(handle.ops).toHaveLength(0);
		expect(win.isDirty()).toBe(true);
		// The page is drawn again and the focus goes back to the button that opened the small window.
		expect(fakeDoc.activeElement).toBe(idOpen(content));
	});

	it('"Keep old ID" sets the draft back to the saved id: no note, nothing unsaved', async () => {
		const { content, win } = await openHouses();
		await setId(content, 'valmont', 'crown');
		await click(noteOf(content)!.querySelector('button'));
		expect(noteOf(content)).toBeNull();
		expect(win.isDirty()).toBe(false);
		const w = await openIdOf(pageOf(content));
		expect(fieldOf(w).value).toBe('valmont');
	});

	it('opening "Change ID" again shows the draft id; Cancel keeps the draft', async () => {
		const { content, win } = await openHouses();
		await setId(content, 'valmont', 'crown');
		const w = await openIdOf(pageOf(content));
		expect(fieldOf(w).value).toBe('crown');
		type(fieldOf(w), 'something-else');
		await click(w.querySelector('.dynasty-sheet-cancel'));
		expect(openModals).toHaveLength(1);
		expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
		// Esc (close of the top modal) is Cancel too.
		const again = await openIdOf(pageOf(content));
		type(fieldOf(again), 'other');
		(openModals[openModals.length - 1] as unknown as { close: () => void }).close();
		expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
		expect(win.isDirty()).toBe(true);
	});

	it('"Use this ID" is off while a reason shows; the reason shows live; the saved id again removes the draft', async () => {
		const { content } = await openHouses();
		const w = await openIdOf(gotoPage(content, 'valmont'));
		const cases: [string, string][] = [
			['orsini', ID_UI.taken],
			['ghost', ID_UI.taken],
			['Crown', ID_UI.characters],
			['a b', ID_UI.characters],
			['-', ID_UI.characters],
			['', ID_UI.empty],
			['   ', ID_UI.empty],
		];
		for (const [value, reason] of cases) {
			type(fieldOf(w), value);
			expect(problemOf(w)).toBe(reason);
			expect(fieldOf(w).getAttribute('aria-invalid')).toBe('true');
			expect((useOf(w) as unknown as { disabled: boolean }).disabled).toBe(true);
			await click(useOf(w));
			// A press on the off button changes nothing: the small window stays, the page has no note.
			expect(openModals).toHaveLength(2);
			expect(noteOf(content)).toBeNull();
		}
		type(fieldOf(w), 'valmont');
		expect(problemOf(w)).toBe('');
		expect(fieldOf(w).getAttribute('aria-invalid')).toBeNull();
		expect((useOf(w) as unknown as { disabled: boolean }).disabled).toBe(false);
		await click(useOf(w));
		// The field equals the saved id: the window closes and there is no draft.
		expect(openModals).toHaveLength(1);
		expect(noteOf(content)).toBeNull();
	});

	it('the other drafts count as taken in the small window; a hand-typed id that did not change is never checked', async () => {
		const body = HOUSES_BODY.replace('id: thorne', 'id: House_Thorne');
		const { content, handle, win } = await openHouses(body);
		await setId(content, 'valmont', 'crown');
		const w = await openIdOf(gotoPage(content, 'orsini'));
		type(fieldOf(w), 'crown');
		expect(problemOf(w)).toBe(ID_UI.taken);
		// A swap cannot be made: the saved id of the other row is taken.
		type(fieldOf(w), 'valmont');
		expect(problemOf(w)).toBe(ID_UI.taken);
		await click(w.querySelector('.dynasty-sheet-cancel'));
		const t = await openIdOf(gotoPage(content, 'House_Thorne'));
		expect(fieldOf(t).value).toBe('House_Thorne');
		expect(problemOf(t)).toBe('');
		await click(useOf(t));
		expect(noteOf(content)).toBeNull();
		expect(handle.ops).toHaveLength(0);
		expect(win.isDirty()).toBe(true);
	});

	it('Save with a new id asks one question with the count, then writes one batch with the id op first; Undo restores the text', async () => {
		const { content, modal, handle } = await openHouses();
		gotoPage(content, 'valmont');
		type(nameField(content, 'dynasty-house-name'), 'House Crown');
		await setId(content, 'valmont', '  crown ');
		await click(saveOf(content));
		// One question, nothing written yet.
		expect(handle.ops).toHaveLength(0);
		expect(confirmLines(modal)).toEqual([ID_UI.confirmLine('House Crown', 'valmont', 'crown', ID_UI.places(1)), REMOVE.canUndo]);
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe('Change the ID?');
		expect(confirmOf(modal)!.querySelectorAll('button').map((b) => b.getText())).toEqual(['Do not change', 'Change the ID']);
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(1);
		const batch = handle.ops[0] as Extract<Op, { kind: 'batch' }>;
		expect(batch.kind).toBe('batch');
		// The id op first; the rename of the same row names the new id.
		expect(batch.ops).toEqual([
			{ kind: 'set-house-id', id: 'valmont', newId: 'crown' },
			{ kind: 'edit-house', id: 'crown', name: 'House Crown' },
		]);
		expect(handle.body).toContain('  - id: crown\n    name: House Crown\n');
		// The person's house changed and the YAML comment of that line stayed.
		expect(handle.body).toContain('    house: crown # the head\n');
		// The window closed; the Notice offers Undo.
		expect(openModals.includes(housesWindows()[0] as never)).toBe(false);
		const notice = noticeList[noticeList.length - 1];
		expect(notices[notices.length - 1]).toBe(`${ID_UI.changed(1)} ${REMOVE.undoAlso}`);
		dispatch(notice.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(handle.body).toBe(HOUSES_BODY);
	});

	it('the count says "2 people" and "no other place"; one question holds one line for each changed id', async () => {
		const { content, modal, handle } = await openHouses();
		await setId(content, 'orsini', 'house-orsini');
		await setId(content, 'thorne', 'house-thorne');
		await click(saveOf(content));
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe('Change the IDs?');
		expect(confirmLines(modal)).toEqual([
			ID_UI.confirmLine('House Orsini', 'orsini', 'house-orsini', ID_UI.places(2)),
			ID_UI.confirmLine('House Thorne', 'thorne', 'house-thorne', ID_UI.places(0)),
			REMOVE.canUndo,
		]);
		expect(modal.querySelectorAll('.dynasty-sheet-confirm')).toHaveLength(1);
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(1);
		expect((handle.ops[0] as Extract<Op, { kind: 'batch' }>).ops.map((o) => o.kind)).toEqual(['set-house-id', 'set-house-id']);
		expect(handle.body.match(/house: house-orsini/g)).toHaveLength(2);
		// A Notice that only changes ids says so, with Undo.
		expect(notices[notices.length - 1]).toBe(ID_UI.changed(2));
	});

	it('the count is taken on the whole tree, as the core counts it', () => {
		const l = loadHouses(HOUSES_BODY);
		if (l.kind !== 'ok') throw new Error('load');
		expect([describeHouseIdChange(l.data.g, 'valmont').people, describeHouseIdChange(l.data.g, 'orsini').people, describeHouseIdChange(l.data.g, 'thorne').people]).toEqual([1, 2, 0]);
		expect(l.data.dangling).toEqual(['ghost']);
	});

	it('Do not change, Esc and a press outside keep the draft and write nothing', async () => {
		const { content, modal, handle, win } = await openHouses();
		await setId(content, 'valmont', 'crown');
		await click(saveOf(content));
		expect(confirmOf(modal)).not.toBeNull();
		await click(confirmOf(modal)!.querySelector('.dynasty-id-keep'));
		expect(confirmOf(modal)).toBeNull();
		expect(handle.ops).toHaveLength(0);
		expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
		// Closing the question (Esc) is the same as Cancel: the question goes first, the page stays.
		await click(saveOf(content));
		expect(confirmOf(modal)).not.toBeNull();
		win.close();
		expect(confirmOf(modal)).toBeNull();
		expect(openModals.includes(win as never)).toBe(true);
		expect(backButton(content)).not.toBeNull();
		expect(handle.ops).toHaveLength(0);
		expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
	});

	it('a draft that is refused later (a new house would get the same id) shows once, in red in the note of the page with a red edge, and not in the error line; Save writes nothing', async () => {
		const { content, handle, win } = await openHouses();
		await setId(content, 'valmont', 'crown');
		backToList(content);
		await click(content.querySelector('.dynasty-house-add'));
		const freshKey = pageOf(content).getAttribute('data-house')!;
		type(nameField(content, 'dynasty-house-name'), 'Crown');
		backToList(content);
		gotoPage(content, 'valmont');
		expect(noteOf(content)!.querySelector('.dynasty-id-new-problem')!.getText()).toBe(ID_UI.taken);
		await click(saveOf(content));
		// D113 item 3: the reason shows once, on the page (the note and the red edge); the top line shows nothing.
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(noteOf(content)!.querySelector('.dynasty-id-new-problem')!.getText()).toBe(ID_UI.taken);
		expect(pageOf(content).hasClass('has-id-problem')).toBe(true);
		expect(confirmOf((win as unknown as { modalEl: FEl }).modalEl)).toBeNull();
		expect(openModals.includes(win as never)).toBe(true);
		expect(fakeDoc.activeElement).toBe(idOpen(content));
		expect(handle.ops).toHaveLength(0);
		// The new house gets another name: the reason goes away.
		backToList(content);
		gotoPage(content, freshKey);
		type(nameField(content, 'dynasty-house-name'), 'House Other');
		backToList(content);
		gotoPage(content, 'valmont');
		expect(noteOf(content)!.querySelector('.dynasty-id-new-problem')!.getText()).toBe('');
	});

	it('"Make ID from the name" puts the id of the draft name into the field and does nothing for an empty name', async () => {
		const { content } = await openHouses();
		gotoPage(content, 'thorne');
		type(nameField(content, 'dynasty-house-name'), 'The Crown House');
		const w = await openIdOf(pageOf(content));
		expect(w.querySelector('.dynasty-sheet-title')!.getText()).toBe('ID of The Crown House');
		await click(w.querySelector('.dynasty-id-make'));
		expect(fieldOf(w).value).toBe('the-crown-house');
		expect((useOf(w) as unknown as { disabled: boolean }).disabled).toBe(false);
		await click(useOf(w));
		gotoPage(content, 'valmont');
		type(nameField(content, 'dynasty-house-name'), '  ');
		const v = await openIdOf(pageOf(content));
		type(fieldOf(v), 'keep-me');
		await click(v.querySelector('.dynasty-id-make'));
		expect(fieldOf(v).value).toBe('keep-me');
	});

	it('an edit of colour and an id change together are one write; a stale body refuses without a partial write', async () => {
		const { content, modal, handle } = await openHouses();
		await setId(content, 'valmont', 'crown');
		// The palette is always on the page (no swatch to tap first).
		dispatch(pageOf(content).querySelector('.dynasty-house-colour[data-colour="#2f5d8c"]') ?? pageOf(content).querySelectorAll('.dynasty-house-colour')[3], 'click');
		await click(saveOf(content));
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(1);
		const kinds = (handle.ops[0] as Extract<Op, { kind: 'batch' }>).ops.map((o) => o.kind);
		expect(kinds).toEqual(['set-house-id', 'edit-house']);

		// Stale: the note changed under the window; the id write is refused as a whole.
		const second = await openHouses(HOUSES_BODY);
		await setId(second.content, 'orsini', 'house-orsini');
		await click(saveOf(second.content));
		second.handle.body = `${second.handle.body}# changed elsewhere\n`;
		second.handle.write.mockImplementationOnce((async () => ({ ok: false, code: 'stale' })) as never);
		await click(confirmOf(second.modal)!.querySelector('.dynasty-id-change'));
		expect(notices).toContain(WRITE_TEXT.staleWindow);
		expect(second.handle.body).toContain('house: orsini');
		expect(second.handle.body).not.toContain('house-orsini');
		// The draft id stays in the note of the page after the window read the new body.
		expect(noteOf(second.content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: house-orsini');
	});

	it('a refusal of the id op (id-taken, bad-value) shows its own text, never the stale text', async () => {
		for (const [refusal, text] of [
			[{ ok: false, code: 'id-taken' }, ID_UI.inUse],
			[{ ok: false, code: 'bad-value', detail: 'A value of this id is a YAML anchor or alias. Edit the note text.' }, ID_UI.anchor],
			[{ ok: false, code: 'bad-value', detail: REFUSAL_TEXT.idCharacters }, ID_UI.notAllowed],
		] as const) {
			resetDom();
			resetObsidian();
			const handle = writingHandle(HOUSES_BODY);
			handle.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal })) as never);
			const { content, modal, win } = await openHouses(HOUSES_BODY, handle);
			await setId(content, 'valmont', 'crown');
			await click(saveOf(content));
			await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
			expect(notices[notices.length - 1]).toBe(text);
			expect(notices).not.toContain(WRITE_TEXT.staleWindow);
			expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(text);
			// The window stays open and the draft stays.
			expect(openModals.includes(win as never)).toBe(true);
			expect(noteOf(content)!.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: crown');
		}
	});

	it('closing with unsaved changes asks first when only an Id draft differs (isDirty and houseOps)', () => {
		const l = loadHouses(HOUSES_BODY);
		if (l.kind !== 'ok') throw new Error('load');
		const rows = rowsOf(l.data);
		expect(houseOps(rows)).toEqual([]);
		rows[0].idDraft = 'crown';
		expect(houseOps(rows)).toEqual([{ kind: 'set-house-id', id: 'valmont', newId: 'crown' }]);
		// The old text again: nothing is unsaved.
		rows[0].idDraft = ' valmont ';
		expect(houseOps(rows)).toEqual([]);
	});

	it('closing the window with only a pending id asks first (Esc, after the page); "Keep old ID" then closes with no question', async () => {
		const { content, win, modal } = await openHouses();
		await setId(content, 'valmont', 'crown');
		// The first Esc leaves the page; it asks nothing yet.
		win.close();
		await settle();
		expect(backButton(content)).toBeNull();
		expect(confirmOf(modal)).toBeNull();
		win.close();
		await settle();
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(openModals.includes(win as never)).toBe(true);
		await click(confirmOf(modal)!.querySelector('.dynasty-sheet-keep'));
		gotoPage(content, 'valmont');
		await click(noteOf(content)!.querySelector('button'));
		// Leave the page again, then close: nothing is unsaved.
		win.close();
		await settle();
		expect(confirmOf(modal)).toBeNull();
		win.close();
		await settle();
		expect(openModals.includes(win as never)).toBe(false);
	});

	it('houseOps: the id ops come first; a deleted row sends none; new houses come last', () => {
		const l = loadHouses(HOUSES_BODY);
		if (l.kind !== 'ok') throw new Error('load');
		const rows = rowsOf(l.data);
		rows[0].idDraft = 'crown';
		rows[0].name = 'House Crown';
		rows[1].idDraft = 'house-orsini';
		rows[2].deleted = 'clear';
		rows[2].idDraft = 'whatever';
		rows.push({ key: 'n', id: null, name: 'House New', colour: null, arms: null, base: null, deleted: null });
		const ops = houseOps(rows);
		expect(ops.map((o) => o.kind)).toEqual(['set-house-id', 'set-house-id', 'edit-house', 'delete-house', 'add-house']);
		expect(ops[2]).toEqual({ kind: 'edit-house', id: 'crown', name: 'House Crown' });
		expect(ops[3]).toEqual({ kind: 'delete-house', id: 'thorne', people: 'clear' });
	});
});

// ---------------------------------------------------------------------------------------------
// Rule 5: the Titles window

const TITLES_BODY = `titles:
  - id: duke
    name: Duke
    holders:
      - {person: a, number: I}
      - {person: b, number: II}
  - id: baron
    name: Baron
people:
  - id: a
    name: Aldric
    card-title: duke
  - id: b
    name: Bran
    card-title: duke
  - id: c
    name: Cora
    card-title: lost
`;

const titlesWindows = () => openModals.filter((m) => (m as unknown) instanceof TitlesWindow) as unknown as TitlesWindow[];

async function openTitles(body = TITLES_BODY, handle: Writing = writingHandle(body)) {
	const host = fakeHost() as Host;
	const { el } = await embed(handle.body, { handle, host });
	await click(el.querySelector('.dynasty-titles-button'));
	const win = titlesWindows()[0];
	expect(win).toBeDefined();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { handle, win, content, modal };
}

describe('Titles window: the Id change (§13.17 rule 5, D109, D110)', () => {
	it('the list shows no Id field; each saved title page has "Change ID" before Delete with its accessible name; a new title has none', async () => {
		const { content } = await openTitles();
		for (const q of ['.dynasty-id-row', '.dynasty-id-input', '.dynasty-id-make', '.dynasty-id-open']) expect(content.querySelectorAll(q)).toHaveLength(0);
		const page = gotoPage(content, 'duke');
		const button = page.querySelector('.dynasty-id-open')!;
		expect(button.querySelector('.dynasty-row-title')!.getText()).toBe('Change ID');
		expect(button.getAttribute('aria-label')).toBe('Change ID: change the ID of Duke');
		// The button comes before Delete, in the section "Other actions".
		const row = button.parentElement!;
		expect(row.children.indexOf(button)).toBeLessThan(row.children.indexOf(row.querySelector('.dynasty-title-delete')!));
		backToList(content);
		await click(content.querySelector('.dynasty-title-add'));
		expect(pageOf(content).querySelector('.dynasty-id-open')).toBeNull();
	});

	it('the small window has the title, the hint for a title, the Id field and the buttons; "Use this ID" shows the note; "Keep old ID" removes it', async () => {
		const { content, win } = await openTitles();
		const w = await openIdOf(gotoPage(content, 'duke'));
		expect(w.querySelector('.dynasty-sheet-title')!.getText()).toBe('ID of Duke');
		expect(w.querySelector('.dynasty-sheet-hint')!.getText()).toBe('The ID is a short name. The plugin uses it to find this title. Most users never change it.');
		expect(fieldOf(w).value).toBe('duke');
		expect(fieldOf(w).getAttribute('aria-label')).toBe('ID of Duke');
		expect([w.querySelector('.dynasty-sheet-cancel')!, useOf(w)].map((b) => b.getText())).toEqual(['Cancel', 'Use this ID']);
		expect(fakeDoc.activeElement).toBe(fieldOf(w));
		type(fieldOf(w), 'king');
		await click(useOf(w));
		expect(openModals).toHaveLength(1);
		const note = noteOf(content)!;
		expect(note.querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: king');
		expect(note.querySelector('button')!.getAttribute('aria-label')).toBe('Keep old ID: keep the old ID of Duke');
		expect(win.isDirty()).toBe(true);
		// Open again: the draft id.
		const again = await openIdOf(pageOf(content));
		expect(fieldOf(again).value).toBe('king');
		await click(again.querySelector('.dynasty-sheet-cancel'));
		await click(noteOf(content)!.querySelector('button'));
		expect(noteOf(content)).toBeNull();
		expect(win.isDirty()).toBe(false);
	});

	it('Save with a new title id asks one question, then changes the id and card-title in one batch; a holder edit of the same title names the new id', async () => {
		const { content, modal, handle } = await openTitles();
		await setId(content, 'duke', 'duke-of-valmont');
		type(nameField(content, 'dynasty-title-name'), 'Duke of Valmont');
		// Move the first holder later: a set-holders op with refs. The holders are always on the page.
		await click(pageOf(content).querySelector('.dynasty-holder-more'));
		lastMenu()!.item(TITLES_UI.moveLater)!.click();
		await click(saveOf(content));
		expect(handle.ops).toHaveLength(0);
		expect(confirmLines(modal)).toEqual([ID_UI.confirmLine('Duke of Valmont', 'duke', 'duke-of-valmont', ID_UI.places(2)), REMOVE.canUndo]);
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(handle.ops).toHaveLength(1);
		const ops = (handle.ops[0] as Extract<Op, { kind: 'batch' }>).ops;
		expect(ops.map((o) => o.kind)).toEqual(['set-title-id', 'edit-title', 'set-holders']);
		expect(ops[0]).toEqual({ kind: 'set-title-id', id: 'duke', newId: 'duke-of-valmont' });
		expect((ops[2] as Extract<Op, { kind: 'set-holders' }>).title).toBe('duke-of-valmont');
		expect(handle.body).toContain('  - id: duke-of-valmont\n    name: Duke of Valmont\n');
		expect(handle.body.match(/card-title: duke-of-valmont/g)).toHaveLength(2);
		// The dangling value of Cora stayed as it was.
		expect(handle.body).toContain('card-title: lost');
		const notice = noticeList[noticeList.length - 1];
		dispatch(notice.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(handle.body).toBe(TITLES_BODY);
	});

	it('refused ids show the reason in the small window and keep "Use this ID" off; a dangling card-title value is taken', async () => {
		const { content, handle } = await openTitles();
		const w = await openIdOf(gotoPage(content, 'duke'));
		for (const [value, reason] of [['baron', ID_UI.taken], ['lost', ID_UI.taken], ['Duke', ID_UI.characters], ['', ID_UI.empty]] as const) {
			type(fieldOf(w), value);
			expect(problemOf(w)).toBe(reason);
			expect((useOf(w) as unknown as { disabled: boolean }).disabled).toBe(true);
			await click(useOf(w));
			expect(openModals).toHaveLength(2);
		}
		expect(noteOf(content)).toBeNull();
		expect(handle.ops).toHaveLength(0);
	});

	it('a draft that is refused later shows once, in the note of the page with a red edge, and not in the error line; Save writes nothing', async () => {
		const { content, handle, win } = await openTitles();
		await setId(content, 'baron', 'king');
		backToList(content);
		await click(content.querySelector('.dynasty-title-add'));
		type(nameField(content, 'dynasty-title-name'), 'King');
		backToList(content);
		gotoPage(content, 'baron');
		expect(noteOf(content)!.querySelector('.dynasty-id-new-problem')!.getText()).toBe(ID_UI.taken);
		await click(saveOf(content));
		// D113 item 3: the reason shows once, on the page (the note and the red edge); the top line shows nothing.
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe('');
		expect(noteOf(content)!.querySelector('.dynasty-id-new-problem')!.getText()).toBe(ID_UI.taken);
		expect(pageOf(content).hasClass('has-id-problem')).toBe(true);
		expect(openModals.includes(win as never)).toBe(true);
		expect(fakeDoc.activeElement).toBe(idOpen(content));
		expect(handle.ops).toHaveLength(0);
	});

	it('"Make ID from the name" uses the draft name; Cancel in the question writes nothing', async () => {
		const { content, modal, handle } = await openTitles();
		gotoPage(content, 'baron');
		type(nameField(content, 'dynasty-title-name'), 'Margrave of the Marches');
		const w = await openIdOf(pageOf(content));
		expect(w.querySelector('.dynasty-sheet-title')!.getText()).toBe('ID of Margrave of the Marches');
		await click(w.querySelector('.dynasty-id-make'));
		expect(fieldOf(w).value).toBe('margrave-of-the-marches');
		await click(useOf(w));
		await click(saveOf(content));
		expect(confirmLines(modal)[0]).toBe(ID_UI.confirmLine('Margrave of the Marches', 'baron', 'margrave-of-the-marches', ID_UI.places(0)));
		await click(confirmOf(modal)!.querySelector('.dynasty-id-keep'));
		expect(handle.ops).toHaveLength(0);
		expect(pageOf(content).querySelector('.dynasty-id-new-text')!.getText()).toBe('New ID: margrave-of-the-marches');
	});

	it('a refusal of the id op shows its own text, never the stale text', async () => {
		const handle = writingHandle(TITLES_BODY);
		handle.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'id-taken' } })) as never);
		const { content, modal } = await openTitles(TITLES_BODY, handle);
		await setId(content, 'baron', 'count');
		await click(saveOf(content));
		await click(confirmOf(modal)!.querySelector('.dynasty-id-change'));
		expect(notices[notices.length - 1]).toBe(ID_UI.inUse);
		expect(notices).not.toContain(WRITE_TEXT.staleWindow);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(ID_UI.inUse);
	});

	it('closing the window with only a pending id asks first (Esc, after the page)', async () => {
		const { content, win, modal } = await openTitles();
		await setId(content, 'baron', 'count');
		// The first Esc leaves the page; the second asks.
		win.close();
		await settle();
		expect(backButton(content)).toBeNull();
		expect(confirmOf(modal)).toBeNull();
		win.close();
		await settle();
		expect(confirmOf(modal)!.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(openModals.includes(win as never)).toBe(true);
	});

	it('closing with unsaved changes asks first when only an Id draft differs (titlesDraftChanged and windowOps)', () => {
		const parsed = parseBody(TITLES_BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, TITLES_BODY));
		let n = 0;
		const rows = titleRows(g, () => `t${n++}`);
		expect(titlesDraftChanged(rows)).toBe(false);
		const baron = rows.find((t) => t.id === 'baron')!;
		baron.idDraft = 'count';
		expect(titlesDraftChanged(rows)).toBe(true);
		expect(windowOps(rows, () => 'x')).toEqual([{ kind: 'set-title-id', id: 'baron', newId: 'count' }]);
		baron.idDraft = 'baron ';
		expect(titlesDraftChanged(rows)).toBe(false);
		expect(windowOps(rows, () => 'x')).toEqual([]);
	});

	it('windowOps: id ops first, then edits and holder lists, deletes, adds; refs name the new id; new titles avoid every draft id', () => {
		const parsed = parseBody(TITLES_BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, TITLES_BODY));
		let n = 0;
		const rows = titleRows(g, () => `t${n++}`);
		const duke = rows.find((t) => t.id === 'duke')!;
		duke.idDraft = 'king';
		duke.name = 'King';
		duke.holders.reverse();
		const baron = rows.find((t) => t.id === 'baron')!;
		baron.deleted = true;
		baron.idDraft = 'ignored';
		rows.push({ key: 'new', id: null, name: 'King', baseName: null, maleName: '', baseMaleName: null, femaleName: '', baseFemaleName: null, deleted: false, holders: [], baseRows: [] });
		const ops = windowOps(rows, (_name, taken) => (taken.has('king') ? 'king-2' : 'king'));
		expect(ops.map((o) => o.kind)).toEqual(['set-title-id', 'edit-title', 'set-holders', 'delete-title', 'add-title']);
		expect(ops[0]).toEqual({ kind: 'set-title-id', id: 'duke', newId: 'king' });
		const lists = ops[2] as Extract<Op, { kind: 'set-holders' }>;
		expect(lists.title).toBe('king');
		expect(lists.items.every((i) => 'ref' in i && i.ref.title === 'king')).toBe(true);
		expect((ops[4] as Extract<Op, { kind: 'add-title' }>).id).toBe('king-2');
		expect(titleIdRow(baron).deleted).toBe(true);
		// The real ops accept the whole batch, and the new title does not take the id of the changed one.
		const out = applyOp(TITLES_BODY, { kind: 'batch', ops });
		if (!out.ok) throw new Error(`refused: ${out.code}`);
		expect(out.body).not.toContain('card-title: duke');
	});

	it('a stale reload keeps an id that the user typed, and takes the new saved id for a row with no typed id', () => {
		const parsed = parseBody(TITLES_BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, TITLES_BODY));
		let n = 0;
		const rows = titleRows(g, () => `t${n++}`);
		rows.find((t) => t.id === 'duke')!.idDraft = 'king';
		const next = rebase(rows, titleRows(g, () => `t${n++}`));
		expect(next.find((t) => t.id === 'duke')!.idDraft).toBe('king');
		expect(next.find((t) => t.id === 'baron')!.idDraft).toBe('baron');
	});

	it('withHolderIds keeps the id ops first, before the ids it gives', () => {
		const body = ['titles:', '  - id: duke', '    name: Duke', 'people:', '  - id: a', '    name: Aldric', '  - name: Bran', ''].join('\n');
		const parsed = parseBody(body);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, body));
		const ops: Op[] = [
			{ kind: 'set-title-id', id: 'duke', newId: 'king' },
			{ kind: 'set-holders', title: 'king', items: [{ add: { person: '~2' } }] },
		];
		const out = withHolderIds(ops, g, parsed.data);
		expect(out.map((o) => o.kind)).toEqual(['set-title-id', 'set-person-fields', 'set-holders']);
		const done = applyOp(body, { kind: 'batch', ops: out });
		expect(done.ok).toBe(true);
	});
});

// A last guard: the number of ops that change ids is exactly the number of changed fields.
describe('id ops of a draft', () => {
	it('titles: an unchanged draft sends nothing', () => {
		const parsed = parseBody(TITLES_BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(readTree(parsed.doc, parsed.data, TITLES_BODY));
		let n = 0;
		expect(idOps('title', titleRows(g, () => `t${n++}`).map(titleIdRow))).toEqual([]);
	});
});
