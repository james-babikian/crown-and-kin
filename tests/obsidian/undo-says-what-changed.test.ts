import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted answers for each step of a flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { createUndoStack, type UndoLabel } from '../../src/core/block-write';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import type { Handle, HandleRegistry } from '../../src/obsidian/block-handle';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { undoLastEditCommand } from '../../src/obsidian/undo-ask';
import { undoneText } from '../../src/obsidian/undo-text';
import { CHANGE_UI } from '../../src/render/change-text';
import { REMOVE, WRITE_TEXT } from '../../src/render/ui-text';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { writingHandle } from '../support/windows-sheets-support';

/*
 * D330 UX-17: the undo entry of a write carries a label that says what the write changed, and the words after an Undo name it ("The plugin undid the
 * addition of Rina Vane as a partner of Edmund Vane."). A write with no label, and a label with no final text, keep the generic text.
 */

useFakeDom({ window: true });

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

const BODY = [
	'people:',
	'  - {id: a, name: Aldric, sex: m, born: 1102}',
	'  - {id: b, name: Bran, parents: [a], born: 1130}',
	'  - {id: c, name: Cora, sex: f, born: 1131}',
	'  - {id: d, name: Dara, sex: f, born: 1160}',
	'',
].join('\n');

/** A handle with the real undo stack, so the label travels from the write to the undo as it does in the plugin. */
function labelledHandle(body: string): FakeHandle {
	const h = fakeHandle('n.md', body);
	const stack = createUndoStack();
	Object.defineProperty(h, 'undoSize', { get: () => stack.size });
	h.write.mockImplementation((async (op: Op, _kind?: string, label?: UndoLabel | ((effects: readonly string[]) => UndoLabel)) => {
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		const effects = r.effects ?? [];
		stack.push(h.body, r.body, typeof label === 'function' ? label(effects) : label);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects };
	}) as never);
	h.undo.mockImplementation((async () => {
		const step = stack.undo(h.body);
		if (!step.ok) return { ok: false, code: 'changed' };
		h.body = step.body;
		return { ok: true, body: step.body, ...(step.label ? { label: step.label } : {}) };
	}) as never);
	return h;
}

function open(h: FakeHandle, id: string): EditSheet {
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return s;
}
const modal = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;
const el = (s: EditSheet, sel: string) => modal(s).querySelector(sel)!;
const lineText = (s: EditSheet) => modal(s).querySelector('.dynasty-sheet-change .dynasty-sheet-change-text')?.getText();

describe('undoneText: the words for a label', () => {
	it('gives the final text of each kind, and the generic text for no label', () => {
		const generic = 'generic';
		expect(undoneText(undefined, 'note', generic)).toBe(generic);
		expect(undoneText({ kind: 'change', names: ['Edric Valmont'] }, 'note', generic)).toBe(WRITE_TEXT.undoDoneChange('Edric Valmont', 'note'));
		expect(WRITE_TEXT.undoDoneChange('Edric Valmont', '01-three-generations')).toBe('The plugin undid the change to Edric Valmont in “01-three-generations”.');
		expect(undoneText({ kind: 'added-partner', names: ['Rina Vane', 'Edmund Vane'] }, null, generic)).toBe('The plugin undid the addition of Rina Vane as a partner of Edmund Vane.');
		expect(undoneText({ kind: 'added-child', type: 'adoptive', names: ['Oswin Valmont', 'Edmund Vane and Rina Vane'] }, null, generic)).toBe(
			'The plugin undid the addition of Oswin Valmont as an adoptive child of Edmund Vane and Rina Vane.',
		);
		expect(undoneText({ kind: 'added-parent', type: 'birth', names: ['Rina Vane', 'Oswin Valmont'] }, null, generic)).toBe('The plugin undid the addition of Rina Vane as a parent of Oswin Valmont.');
		expect(undoneText({ kind: 'added-parent', type: 'birth', names: ['Rina Vane', 'Oswin Valmont', 'Edmund Vane'] }, null, generic)).toBe(
			'The plugin undid the addition of Rina Vane as a parent of Oswin Valmont. It also removed the marriage of Rina Vane and Edmund Vane.',
		);
		expect(undoneText({ kind: 'deleted', names: ['Edric Valmont'] }, null, generic)).toBe('The plugin undid the deletion of Edric Valmont.');
		expect(undoneText({ kind: 'marked-me', names: ['Edric Valmont'] }, null, generic)).toBe('The plugin undid the mark “This is me” on Edric Valmont.');
		expect(undoneText({ kind: 'unmarked-me', names: ['Edric Valmont'] }, null, generic)).toBe('The plugin undid the removal of the mark “This is me” from Edric Valmont.');
	});

	it('a change to a person names the note, so with no note it keeps the generic text', () => {
		expect(undoneText({ kind: 'change', names: ['Edric Valmont'] }, null, 'generic')).toBe('generic');
	});
});

describe('the text line of the person window after Undo', () => {
	it('Add partner: the line says which partner the Undo took away', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'a');
		answers.push('existing', { kind: 'person', id: 'd' }, 'marriage');
		dispatch(el(sheet, '.dynasty-add-partner'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.addedPartner('Dara', 'Aldric'));
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe('The plugin undid the addition of Dara as a partner of Aldric.');
		expect(modal(sheet).querySelector('.dynasty-sheet-change-undo')).toBeNull();
	});

	it('Add child: the line names the child and the parent', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'a');
		answers.push('existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.undoneAddedChild('Cora', 'Aldric', 'birth'));
	});

	it('Add parent with an automatic marriage: the line says that the marriage went too; without one it does not', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'b');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.addedParentAndMarriage('Cora', 'Bran', 'birth', 'Aldric'));
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.undoneAddedParentAndMarriage('Cora', 'Bran', 'birth', 'Aldric'));

		const h2 = labelledHandle(BODY);
		const sheet2 = open(h2, 'd');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet2, '.dynasty-add-parent'), 'click');
		await settle();
		dispatch(el(sheet2, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet2)).toBe(CHANGE_UI.undoneAddedParent('Cora', 'Dara', 'birth'));
	});

	it('Add parent, a new person: the line names the new parent', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'new');
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		const next = openModals[openModals.length - 1] as unknown as EditSheet;
		const name = (next as unknown as { modalEl: FEl }).modalEl.querySelector('[data-field="name"] input') as FEl;
		name.value = 'Elin';
		dispatch(name, 'input');
		dispatch((next as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.undoneAddedParent('Elin', 'Dara', 'birth'));
	});

	it('"This is me" and its removal say the mark', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'a');
		dispatch(el(sheet, '.dynasty-mark-me'), 'click');
		await settle();
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.undoneMarkedMe('Aldric'));
	});

	it('an undo that gives no label keeps the generic line', async () => {
		// The handle of `writingHandle` undoes without a label (an older kind of write): the line says the generic sentence.
		const h = writingHandle(BODY);
		const sheet = open(h, 'a');
		answers.push('existing', { kind: 'person', id: 'd' }, 'marriage');
		dispatch(el(sheet, '.dynasty-add-partner'), 'click');
		await settle();
		dispatch(el(sheet, '.dynasty-sheet-change-undo'), 'click');
		await settle();
		expect(lineText(sheet)).toBe(CHANGE_UI.undone);
	});
});

describe('the Notice after the delete of a person, and the command', () => {
	it('Undo of the delete notice says the deletion', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'd');
		dispatch(el(sheet, '.dynasty-delete-person'), 'click');
		await settle();
		dispatch(el(sheet, '.dynasty-confirm-delete'), 'click');
		await settle();
		expect(notices).toEqual([REMOVE.deleted('Dara')]);
		const notice = noticeList[0] as unknown as { messageEl: FEl };
		dispatch(notice.messageEl.querySelector('.dynasty-undo-button')!, 'click', { button: 0 });
		await settle();
		expect(notices).toEqual([REMOVE.deleted('Dara'), REMOVE.undoneDelete('Dara')]);
		expect(notices[1]).toBe('The plugin undid the deletion of Dara.');
	});

	it('"Undo last tree edit" names the person for a change to a person and the note, and keeps the generic text for a write with no label', async () => {
		const change = { key: { path: 'Trees/Alpha.md', ordinal: 0 }, canUndo: true, undo: async () => ({ ok: true, label: { kind: 'change', names: ['Edric Valmont'] } }) };
		const run = (h: unknown) => undoLastEditCommand({ workspace: { getActiveFile: () => ({ path: 'Trees/Alpha.md' }) } } as never, { undoTarget: () => h } as unknown as HandleRegistry);
		await run(change as unknown as Handle);
		expect(notices).toEqual(['The plugin undid the change to Edric Valmont in “Alpha”.']);
		notices.length = 0;
		await run({ ...change, undo: async () => ({ ok: true }) });
		expect(notices).toEqual([WRITE_TEXT.undoDoneIn('Alpha')]);
		notices.length = 0;
		await run({ ...change, undo: async () => ({ ok: true, label: { kind: 'added-partner', names: ['Rina Vane', 'Edmund Vane'] } }) });
		expect(notices).toEqual([CHANGE_UI.undoneAddedPartner('Rina Vane', 'Edmund Vane')]);
	});

	it('a Save of a person writes a change label with the name the tree shows after the undo (the saved name, not the draft)', async () => {
		const h = labelledHandle(BODY);
		const sheet = open(h, 'c');
		const name = el(sheet, '[data-field="name"] input') as FEl;
		name.value = 'Corinna';
		dispatch(name, 'input');
		dispatch(el(sheet, '.dynasty-sheet-save'), 'click');
		await settle();
		const label = (h.write.mock.calls[0] as unknown[])[2] as { label?: UndoLabel } | UndoLabel | undefined;
		expect(label).toEqual({ kind: 'change', names: ['Cora'] });
		const out = await h.undo();
		expect(out).toMatchObject({ ok: true, label: { kind: 'change', names: ['Cora'] } });
	});
});
