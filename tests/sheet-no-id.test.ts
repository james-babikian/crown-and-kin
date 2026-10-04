import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers for each step of a flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet, mapIds } from '../src/obsidian/edit-sheet';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { noticeList, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * Review 0.1.1 area E, finding 1 (the decision notes "Version 0.1.1", area E ruling 1): a person with no
 * written `id` is named `~N` after their place in the list. Every sheet action that needs a stable
 * id gives them one in the same write, and the sheet follows the new id.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	// The fake DOM has no `:not(:disabled)` (moveSibling puts the focus back with it).
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

// Aldric has an id; Bran (~2) and Cora (~3) have none. A new id is numbered (D104): the first is p1.
const NO_IDS = ['people:', '  - id: a', '    name: Aldric', '  - name: Bran', '    parents: [a]', '  - name: Cora', '    parents: [a]', ''].join('\n');

function open(h: FakeHandle, id: string): EditSheet {
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return s;
}

const modal = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;
const el = (s: EditSheet, sel: string) => modal(s).querySelector(sel)!;
const shownName = (s: EditSheet) => (el(s, '[data-field="name"] input') as FEl).value;
const personId = (s: EditSheet) => (s as unknown as { data: { person: { id: string } } }).data.person.id;

function type(s: EditSheet, field: string, value: string): void {
	const input = el(s, `[data-field="${field}"] input`) as FEl;
	input.value = value;
	dispatch(input, 'input');
}

function tree(body: string) {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('parse');
	return { tree: r.tree, g: deriveFamilies(r.tree) };
}

/** The sheet the last flow opened (a new-person sheet). */
const newest = () => openModals[openModals.length - 1] as unknown as EditSheet;

describe('a person with no id: the sheet gives them one when an action needs it', () => {
	it('Move later, then Save: the id goes in the move write, and Save edits the same person', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~2');
		dispatch(el(sheet, '.dynasty-move-later'), 'click');
		await settle();
		// One write: the id first, then the move by that id.
		expect(h.ops).toHaveLength(1);
		expect(h.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'set-person-fields', id: '~2', fields: { id: 'p1' } }, { kind: 'move-sibling', id: 'p1', direction: 'later' }] });
		expect(h.body).toContain('  - name: Cora\n    parents: [a]\n  - id: p1\n    name: Bran\n');
		expect(personId(sheet)).toBe('p1');
		expect(shownName(sheet)).toBe('Bran');
		// The tree view shows the moved person under the new id.
		expect(h.state.lastEdited).toBe('p1');
		type(sheet, 'title', 'Master of Horse');
		dispatch(el(sheet, '.dynasty-sheet-save'), 'click');
		await settle();
		const people = tree(h.body).tree.people;
		expect(people.find((p) => p.name === 'Bran')?.title).toBe('Master of Horse');
		expect(people.find((p) => p.name === 'Cora')?.title).toBeUndefined();
	});

	it('a field change in the draft goes in the same write, under the new id', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~3');
		type(sheet, 'born', '1102');
		dispatch(el(sheet, '.dynasty-move-earlier'), 'click');
		await settle();
		const ops = (h.ops[0] as { ops: Op[] }).ops;
		expect(ops.map((o) => o.kind)).toEqual(['set-person-fields', 'set-person-fields', 'move-sibling']);
		expect(ops[1]).toEqual({ kind: 'set-person-fields', id: 'p1', fields: { born: '1102' } });
		expect(tree(h.body).g.byId.get('p1')?.born).toBe('1102');
	});

	it('Add child with a new person: the child names the parent by the new id; a child with the same name as the parent gets the next number', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~3');
		// Cora has no partners: the flow asks only "new or existing".
		answers.push('new');
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		const child = newest();
		expect(child).not.toBe(sheet);
		type(child, 'name', 'Cora');
		dispatch(el(child, '.dynasty-sheet-save'), 'click');
		await settle();
		const { g } = tree(h.body);
		expect(g.byId.get('p1')?.name).toBe('Cora');
		expect(g.byId.get('p2')?.name).toBe('Cora');
		expect(g.byId.get('p2')?.parents).toEqual([{ id: 'p1', type: 'birth' }]);
		// No reference names nobody (a written `~3` would).
		expect(g.issues.filter((i) => i.code.startsWith('missing-') && i.code !== 'missing-id')).toEqual([]);
		// The first sheet follows its person.
		expect(personId(sheet)).toBe('p1');
		expect(shownName(sheet)).toBe('Cora');
	});

	it('Save and add another child: the next child has the same parent, by the new id', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~2');
		answers.push('new');
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		const child = newest();
		type(child, 'name', 'Dara');
		dispatch(el(child, '.dynasty-sheet-save-another'), 'click');
		await settle();
		type(child, 'name', 'Edric');
		dispatch(el(child, '.dynasty-sheet-save'), 'click');
		await settle();
		const { g } = tree(h.body);
		expect(g.byId.get('p2')?.name).toBe('Dara');
		expect(g.byId.get('p3')?.name).toBe('Edric');
		expect(g.byId.get('p2')?.parents).toEqual([{ id: 'p1', type: 'birth' }]);
		expect(g.byId.get('p3')?.parents).toEqual([{ id: 'p1', type: 'birth' }]);
	});

	it('Add parent with a new person: the new parent is put before the child and linked to the child by the new id', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~2');
		answers.push('birth', 'new');
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		const parent = newest();
		type(parent, 'name', 'Elin');
		dispatch(el(parent, '.dynasty-sheet-save'), 'click');
		await settle();
		const { tree: t, g } = tree(h.body);
		expect(t.people.map((p) => p.id)).toEqual(['a', 'p2', 'p1', '~4']);
		expect(g.byId.get('p1')?.parents.map((l) => l.id)).toEqual(['a', 'p2']);
		expect(personId(sheet)).toBe('p1');
	});

	it('Add partner with a person in the tree who has no id either: both get an id', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~3');
		answers.push('existing', { kind: 'person', id: '~2' }, 'marriage');
		dispatch(el(sheet, '.dynasty-add-partner'), 'click');
		await settle();
		const { tree: t } = tree(h.body);
		expect(t.unions.map((u) => u.partners)).toEqual([['p1', 'p2']]);
		expect(t.people.map((p) => p.id)).toEqual(['a', 'p2', 'p1']);
		expect(personId(sheet)).toBe('p1');
		// The partner is shown with the new id.
		expect(h.state.lastEdited).toBe('p2');
	});

	it('Pin focus here writes the new id as the focus', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~2');
		dispatch(el(sheet, '.dynasty-pin'), 'click');
		await settle();
		expect(tree(h.body).tree.options.focus).toBe('p1');
		// The sheet now offers Remove pin for the same person.
		expect(modal(sheet).querySelector('.dynasty-unpin')).toBeTruthy();
	});

	it('Remove parent, then Undo: the sheet shows the same person again under the old ~N', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~3');
		dispatch(el(sheet, '.dynasty-remove-parent'), 'click');
		await settle();
		expect(personId(sheet)).toBe('p1');
		const notice = noticeList[noticeList.length - 1];
		dispatch(notice.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(h.body).toBe(NO_IDS);
		expect(personId(sheet)).toBe('~3');
		expect(shownName(sheet)).toBe('Cora');
		expect(modal(sheet).hasClass('is-read-only')).toBe(false);
	});

	it('Save without a move writes no id', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = open(h, '~3');
		type(sheet, 'title', 'Lady');
		dispatch(el(sheet, '.dynasty-sheet-save'), 'click');
		await settle();
		expect(h.ops).toEqual([{ kind: 'set-person-fields', id: '~3', fields: { title: 'Lady' } }]);
	});
});

describe('mapIds', () => {
	it('maps person ids in ops and relations, never field values, texts or types', () => {
		const f = (s: string) => (s === '~3' ? 'cora' : s);
		const ops: Op[] = [
			{ kind: 'set-person-fields', id: '~3', fields: { name: '~3', notes: '~3' } },
			{ kind: 'add-person', id: 'x', fields: {}, parents: [{ id: '~3', type: 'birth' }], at: { kind: 'after-siblings', parents: ['~3', 'a'], union: { index: 0, partners: ['~3', 'a'], text: '~3' } } },
			{ kind: 'set-option', key: 'focus', value: '~3' },
			{ kind: 'add-union', partners: ['~3', 'a'], start: '~3' },
		];
		expect(mapIds(ops, f)).toEqual([
			{ kind: 'set-person-fields', id: 'cora', fields: { name: '~3', notes: '~3' } },
			{ kind: 'add-person', id: 'x', fields: {}, parents: [{ id: 'cora', type: 'birth' }], at: { kind: 'after-siblings', parents: ['cora', 'a'], union: { index: 0, partners: ['cora', 'a'], text: '~3' } } },
			{ kind: 'set-option', key: 'focus', value: 'cora' },
			{ kind: 'add-union', partners: ['cora', 'a'], start: '~3' },
		]);
		expect(mapIds({ kind: 'child', parent: '~3', other: null }, f)).toEqual({ kind: 'child', parent: 'cora', other: null });
	});
});
