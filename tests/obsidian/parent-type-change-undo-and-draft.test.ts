import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUndoStack, type UndoLabel } from '../../src/core/block-write';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { stripNotDisabled } from '../support/windows-sheets-support';

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

const BODY = ['# keep me', 'people:', '  - {id: m, name: Marek Orsini}  # the father', '  - {id: r, name: Roderick Orsini, mood: grim, parents: [{id: m, type: rumoured}]}', ''].join('\n');

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

describe('a parent-type change in the person window', () => {
	it('two changes then Undo steps back one at a time, text exact', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		const afterFirst = h.body;
		sel.value = 'birth';
		dispatch(sel, 'change');
		await settle();
		dispatch(modal.querySelector('.dynasty-sheet-change-undo')!, 'click');
		await settle();
		expect(h.body).toBe(afterFirst);
		expect(modal.querySelector('[data-parent="m"]')!.getAttribute('data-type')).toBe('adoptive');
		expect(modal.querySelector('.dynasty-sheet-change-undo')).toBeNull();
	});

	it('undo of the only change gives the exact original text', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		dispatch(modal.querySelector('.dynasty-sheet-change-undo')!, 'click');
		await settle();
		expect(h.body).toBe(BODY);
	});

	it('a refused second write keeps the first line', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		const first = modal.querySelector('.dynasty-sheet-change-text')!.getText();
		h.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { code: 'limit' } })) as never);
		sel.value = 'birth';
		dispatch(sel, 'change');
		await settle();
		expect(sel.value).toBe('adoptive');
		expect(modal.querySelector('.dynasty-sheet-change-text')!.getText()).toBe(first);
	});

	it('a parent and a child with no name show as the tree shows them', async () => {
		const h = labelledHandle(['people:', '  - {id: m}', '  - {id: r, parents: [{id: m, type: rumoured}]}', ''].join('\n'));
		const { modal } = open(h, 'r');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		expect(modal.querySelector('.dynasty-sheet-change-text')!.getText()).toBe('The plugin changed m from a rumoured parent to an adoptive parent of r.');
	});

	it('with an unsaved edit in the draft the type select is not rebuilt in its own change event (iOS)', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const input = modal.querySelector('[data-field="sobriquet"] input')!;
		input.value = 'the grim';
		dispatch(input, 'input');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		expect(modal.querySelector('[data-parent="m"] select')).toBe(sel);
	});

	it('the unsaved edit is saved with the type change and stays in its field', async () => {
		const h = labelledHandle(BODY);
		const { modal } = open(h, 'r');
		const input = modal.querySelector('[data-field="sobriquet"] input')!;
		input.value = 'the grim';
		dispatch(input, 'input');
		const sel = modal.querySelector('[data-parent="m"] select')!;
		sel.value = 'adoptive';
		dispatch(sel, 'change');
		await settle();
		expect(h.body).toContain('adoptive');
		expect(h.body).toContain('the grim');
		expect(modal.querySelector('[data-field="sobriquet"] input')!.value).toBe('the grim');
	});
});
