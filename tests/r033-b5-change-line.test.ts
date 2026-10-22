import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers for each step of a flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { CHANGE_UI } from '../src/render/change-text';
import { REMOVE, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { notices as noticeTexts, openModals, resetObsidian } from './acceptance/fake-obsidian';
import type { FakeHandle } from './acceptance/tree-view-fakes';
import { writingHandle } from './s113-c-support';

/*
 * 0.3.3 B5 (spec §0 D267): after Add child, Add partner, Add parent and "This is me" the person window shows a text line below Details that says
 * what changed, with an Undo button. It stays until the window closes, a later action replaces it, and Undo keeps the window open.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - {id: a, name: Aldric, sex: m, born: 1102}', '  - {id: b, name: Bran, parents: [a], born: 1130}', '  - {id: c, name: Cora, sex: f, born: 1131}', '  - {id: d, name: Dara, sex: f, born: 1160}', ''].join('\n');

function open(h: FakeHandle, id: string): EditSheet {
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return s;
}

const modal = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;
const el = (s: EditSheet, sel: string) => modal(s).querySelector(sel)!;
/** The text line, or null while the live region (in the window from the build on) is empty. */
const line = (s: EditSheet) => {
	const region = modal(s).querySelector('.dynasty-sheet-change');
	return region?.querySelector('.dynasty-sheet-change-text') ? region : null;
};
const lineText = (s: EditSheet) => line(s)?.querySelector('.dynasty-sheet-change-text')?.getText();
const undoButton = (s: EditSheet) => modal(s).querySelector('.dynasty-sheet-change-undo');
const newest = () => openModals[openModals.length - 1] as unknown as EditSheet;
const notices = () => [...noticeTexts];

function type(s: EditSheet, field: string, value: string): void {
	const input = el(s, `[data-field="${field}"] input`) as FEl;
	input.value = value;
	dispatch(input, 'input');
}

describe('B5: the text line after an action that writes at once', () => {
	it('Add parent (a person in the tree): the line says what changed, below Details, with an Undo button', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		expect(line(sheet)).toBeNull();
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.addedParent('Cora', 'Dara', 'birth'));
		expect(lineText(sheet)).toBe('The plugin added Cora as a parent of Dara.');
		// Below Details: the next element after the Details section, in the body of the window.
		const details = el(sheet, '[data-section="details"]');
		const body = details.parentElement!;
		expect(body.children[body.children.indexOf(details) + 1]).toBe(line(sheet));
		// A polite live region; the button is a button with a name that begins with its text, and a screen reader reads it.
		expect(line(sheet)!.getAttribute('role')).toBe('status');
		expect(line(sheet)!.getAttribute('aria-live')).toBe('polite');
		const undo = undoButton(sheet)!;
		expect(undo.tag).toBe('button');
		expect(undo.getText()).toBe(REMOVE.undo);
		expect(undo.getAttribute('aria-label')!.startsWith('Undo')).toBe(true);
		// Not a Notice at the top.
		expect(notices().some((n) => n.includes('added Cora'))).toBe(false);
	});

	it('Add child (a person in the tree) and Add partner (a person in the tree) say their own text; a later action replaces the line', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'a');
		answers.push('existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Cora as a child of Aldric.');
		answers.push('existing', { kind: 'person', id: 'd' }, 'marriage');
		dispatch(el(sheet, '.dynasty-add-partner'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Dara as a partner of Aldric.');
		expect(modal(sheet).querySelectorAll('.dynasty-sheet-change')).toHaveLength(1);
	});

	it('Add parent, a new person: the window that started it comes back with the line', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'new');
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		const parent = newest();
		expect(parent).not.toBe(sheet);
		// Nothing was written yet, so the first window has no line.
		expect(line(sheet)).toBeNull();
		type(parent, 'name', 'Elin');
		dispatch(el(parent, '.dynasty-sheet-save'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Elin as a parent of Dara.');
		expect(undoButton(sheet)).not.toBeNull();
	});

	it('Add child and Add partner, a new person: the line names the new person', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'c');
		answers.push('new');
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		type(newest(), 'name', 'Thea');
		dispatch(el(newest(), '.dynasty-sheet-save'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Thea as a child of Cora.');
		answers.push('new');
		dispatch(el(sheet, '.dynasty-add-partner'), 'click');
		await settle();
		type(newest(), 'name', 'Odo');
		dispatch(el(newest(), '.dynasty-sheet-save'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Odo as a partner of Cora.');
	});

	it('the words follow the type of the parent link', () => {
		expect(CHANGE_UI.addedParent('Cora', 'Dara', 'adoptive')).toBe('The plugin added Cora as an adoptive parent of Dara.');
		expect(CHANGE_UI.addedChild('Dara', 'Cora and Odo', 'ward')).toBe('The plugin added Dara as a ward of Cora and Odo.');
		expect(CHANGE_UI.addedParent('Cora', 'Dara', 'other')).toBe('The plugin added Cora as a parent of Dara.');
	});

	it('This is me and its removal', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'a');
		dispatch(el(sheet, '.dynasty-mark-me'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin marked Aldric with “This is me”.');
		expect(undoButton(sheet)).not.toBeNull();
		dispatch(el(sheet, '.dynasty-unmark-me'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.unmarkedMe('Aldric'));
	});

	it('Undo reverts the action, keeps the window open, refreshes it and says so in the same place', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(h.body).not.toBe(BODY);
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		expect(h.body).toBe(BODY);
		expect(openModals).toContain(sheet);
		expect(lineText(sheet)).toBe(CHANGE_UI.undone);
		expect(undoButton(sheet)).toBeNull();
		// The Family section shows the restored data: Dara has no parent again.
		expect(modal(sheet).querySelectorAll('[data-family="parents"] .dynasty-family-row')).toHaveLength(0);
	});

	it('Undo refuses with the Notice of the undo rule when the block changed after the action', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		const written = h.body;
		// Somebody edits the note text: the block is not what the action wrote.
		h.body = `${written}# edited\n`;
		const undoCalls = h.undo.mock.calls.length;
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		expect(h.undo.mock.calls.length).toBe(undoCalls);
		expect(notices()).toContain(WRITE_TEXT.undoChanged);
		expect(h.body).toBe(`${written}# edited\n`);
		expect(openModals).toContain(sheet);
		// The line stays, so the reader sees what the action did.
		expect(lineText(sheet)).toBe('The plugin added Cora as a parent of Dara.');
	});

	it('the line says that Undo also removes the field changes that the same write saved', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		type(sheet, 'title', 'Countess');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(`The plugin added Cora as a parent of Dara. ${REMOVE.undoAlso}`);
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		expect(h.body).toBe(BODY);
	});

	it('the line stays when the window draws again after another change, and it is gone with the window', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		// A remove in place draws the form again.
		type(sheet, 'title', 'Countess');
		sheet.reload(h.body);
		expect(lineText(sheet)).toBe('The plugin added Cora as a parent of Dara.');
		sheet.close();
		await settle();
		const again = open(h, 'd');
		expect(line(again)).toBeNull();
	});

	it('a failed action shows no line', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'a');
		// Aldric is the parent of Bran already; the tree refuses the cycle when Bran is made the parent of Aldric.
		answers.push('birth', 'existing', { kind: 'person', id: 'b' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(line(sheet)).toBeNull();
	});
	it('fix round: the live region is in the window from the build on, empty, and there is one of it after the first text', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'd');
		const region = modal(sheet).querySelector('.dynasty-sheet-change')!;
		expect(region).not.toBeNull();
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.children).toHaveLength(0);
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Cora as a parent of Dara.');
		expect(modal(sheet).querySelectorAll('.dynasty-sheet-change')).toHaveLength(1);
	});

	it('fix round: Add child with a partner, where the child holds the link of this person already, names the parent who was added', async () => {
		const body = ['people:', '  - {id: a, name: Aldric, sex: m, born: 1102}', '  - {id: z, name: Zed, sex: m, born: 1100}', '  - {id: c, name: Cora, sex: f, born: 1105}', '  - {id: t, name: Thea, sex: f, born: 1130, parents: [z, {id: a, type: adoptive}]}', 'unions:', '  - {partners: [a, c], type: marriage}', ''].join('\n');
		const h = writingHandle(body);
		const sheet = open(h, 'a');
		answers.push('p0', 'existing', { kind: 'person', id: 't' }, 'adoptive');
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		expect(h.write).toHaveBeenCalledTimes(1);
		expect(lineText(sheet)).toBe('The plugin added Cora as an adoptive parent of Thea.');
	});

	it('fix round: Add parent that also adds a marriage names the marriage in the same sentence, and the Undo takes both away', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'b');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(h.body).toContain('marriage');
		expect(lineText(sheet)).toBe('The plugin added Cora as a parent of Bran. It also added a marriage of Cora and Aldric.');
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		expect(h.body).toBe(BODY);
	});

	it('fix round: a new parent that adds a marriage says so in the window that comes back', async () => {
		const h = writingHandle(BODY);
		const sheet = open(h, 'b');
		answers.push('birth', 'new');
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		type(newest(), 'name', 'Elin');
		dispatch(el(newest(), '.dynasty-sheet-save'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin added Elin as a parent of Bran. It also added a marriage of Elin and Aldric.');
	});
});
