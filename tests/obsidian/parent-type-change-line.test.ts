import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUndoStack, type UndoLabel } from '../../src/core/block-write';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { undoneText } from '../../src/obsidian/undo-text';
import { CHANGE_UI, parentTypeWord } from '../../src/render/change-text';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { noticeList, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { stripNotDisabled } from '../support/windows-sheets-support';

/*
 * B-0054 (D335): a change of the kind of a parent link in the Family section says what it changed in the change line, with Undo, as Add partner and a
 * removal do. The left button then says Close (O-13). The Undo label names the people only.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - {id: m, name: Marek Orsini}', '  - {id: r, name: Roderick Orsini, parents: [{id: m, type: rumoured}]}', ''].join('\n');

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

function open(h: FakeHandle, id: string) {
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return { s, modal: (s as unknown as { modalEl: FEl }).modalEl };
}

describe('the change line after a parent-type change', () => {
	it('says the change with Undo, the left button says Close, and no Notice stands over the window', async () => {
		const { modal } = open(labelledHandle(BODY), 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		const line = modal.querySelector('.dynasty-sheet-change')!;
		expect(line.querySelector('.dynasty-sheet-change-text')!.getText()).toBe(CHANGE_UI.changedParentType('Marek Orsini', 'Roderick Orsini', 'rumoured', 'adoptive'));
		expect(CHANGE_UI.changedParentType('Marek Orsini', 'Roderick Orsini', 'rumoured', 'adoptive')).toBe('The plugin changed Marek Orsini from a rumoured parent to an adoptive parent of Roderick Orsini.');
		expect(line.querySelector('.dynasty-sheet-change-undo')).not.toBeNull();
		expect(modal.querySelector('.dynasty-sheet-cancel')!.getText()).toBe('Close');
		expect(noticeList).toEqual([]);
		expect(modal.querySelector('[data-parent="m"] select'), 'the select stays in the page').toBe(sel);
	});

	it('a second change replaces the line, and begetter and birth have words', async () => {
		const { modal } = open(labelledHandle(BODY), 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'birth';
		dispatch(sel, 'change');
		await settle();
		sel.value = 'begetter';
		dispatch(sel, 'change');
		await settle();
		expect(modal.querySelectorAll('.dynasty-sheet-change').length).toBe(1);
		expect(modal.querySelector('.dynasty-sheet-change-text')!.getText()).toBe('The plugin changed Marek Orsini from a birth parent to a begetter of Roderick Orsini.');
	});

	it('Undo gives the type back and the line names the people and the old type', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		dispatch(modal.querySelector('.dynasty-sheet-change-undo')!, 'click');
		await settle();
		expect(h.body).toBe(BODY);
		expect(modal.querySelector('.dynasty-sheet-change-text')!.getText()).toBe('The plugin changed Marek Orsini back to a rumoured parent of Roderick Orsini.');
		expect(modal.querySelector('[data-parent="m"]')!.getAttribute('data-type')).toBe('rumoured');
	});

	it('a write that fails shows no change line', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		h.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { code: 'limit' } })) as never);
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		expect(modal.querySelector('.dynasty-sheet-change-text')).toBeNull();
	});
});

describe('undoneText for a changed parent type', () => {
	it('names the people and the old type, and an unknown type in quote marks', () => {
		expect(undoneText({ kind: 'changed-parent-type', type: 'rumoured', names: ['Marek Orsini', 'Roderick Orsini'] }, null, 'generic')).toBe('The plugin changed Marek Orsini back to a rumoured parent of Roderick Orsini.');
		expect(undoneText({ kind: 'changed-parent-type', type: 'x', names: ['Marek Orsini', 'Roderick Orsini'] }, null, 'generic')).toBe('The plugin changed Marek Orsini back to a parent of the type “x” of Roderick Orsini.');
		expect(undoneText({ kind: 'changed-parent-type', names: ['Marek Orsini', 'Roderick Orsini'] }, null, 'generic')).toBe('generic');
	});

	it('has an article for every type word', () => {
		expect(['birth', 'adoptive', 'ward', 'rumoured', 'begetter', 'x'].map(parentTypeWord)).toEqual(['a birth parent', 'an adoptive parent', 'a guardian', 'a rumoured parent', 'a begetter', 'a parent of the type “x”']);
	});
});
