import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

const answers: unknown[] = [];
vi.mock('../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { createUndoStack } from '../src/core/block-write';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { WRITE_TEXT } from '../src/render/ui-text';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * G2 review of r033/b1-b5 (B5): the Undo of the text line must undo the action the line names. The real handle undoes the LAST write of its stack
 * when the block equals what that write wrote (UndoStack.canUndo); the Notice lives 10 s, the line lives as long as the window.
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

/** A handle with the undo rule of the real one: the stack is checked against the body (`createUndoStack`, `BlockHandle.undo`). */
function realRuleHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	const stack = createUndoStack();
	// The real handle tells how many writes it can undo; the line reads it.
	Object.defineProperty(h, 'undoSize', { get: () => stack.size });
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		stack.push(h.body, r.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
	}) as never);
	h.undo.mockImplementation((async () => {
		if (stack.size === 0) return { ok: false, code: 'empty' };
		const step = stack.undo(h.body);
		if (!step.ok) return { ok: false, code: 'changed' };
		h.body = step.body;
		return { ok: true, body: step.body };
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
const undoButton = (s: EditSheet) => modal(s).querySelector('.dynasty-sheet-change-undo');

describe('G2 B5: the Undo of the line', () => {
	it('after the line, a pin and its removal bring the block back to the written text; Undo must undo the added parent, not the removal of the pin', async () => {
		const h = realRuleHandle(BODY);
		const sheet = open(h, 'd');
		answers.push('birth', 'existing', { kind: 'person', id: 'c' });
		dispatch(el(sheet, '.dynasty-add-parent'), 'click');
		await settle();
		const written = h.body;
		expect(written).not.toBe(BODY);
		dispatch(el(sheet, '.dynasty-pin'), 'click');
		await settle();
		expect(h.body).not.toBe(written);
		dispatch(el(sheet, '.dynasty-unpin'), 'click');
		await settle();
		// The tree text is what the Add parent wrote: the line is still true, and its button is still there.
		expect(h.body).toBe(written);
		expect(undoButton(sheet)).not.toBeNull();
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		// Ruling of the fix round: a later write stands above the one of the line, so the Undo refuses with the "changed" Notice and writes nothing.
		// It must not undo the removal of the pin (the last write of the stack), which the line does not name.
		expect(notices).toContain(WRITE_TEXT.undoChanged);
		expect(h.body).toBe(written);
		expect(h.undo).not.toHaveBeenCalled();
	});

	it('probe: Save and add another child twice: the first window shows the line of the second child; its Undo removes only the second child', async () => {
		const h = realRuleHandle(BODY);
		const sheet = open(h, 'a');
		answers.push('new');
		dispatch(el(sheet, '.dynasty-add-child'), 'click');
		await settle();
		const kid = openModals[openModals.length - 1] as unknown as EditSheet;
		for (const name of ['Thea', 'Odo']) {
			const input = el(kid, '[data-field="name"] input') as FEl;
			input.value = name;
			dispatch(input, 'input');
			dispatch(el(kid, '.dynasty-sheet-save-another'), 'click');
			await settle();
		}
		expect(modal(sheet).querySelector('.dynasty-sheet-change-text')?.getText()).toBe('The plugin added Odo as a child of Aldric.');
		dispatch(el(kid, '.dynasty-sheet-cancel'), 'click');
		await settle();
		dispatch(undoButton(sheet)!, 'click');
		await settle();
		expect(h.body).toContain('Thea');
		expect(h.body).not.toContain('Odo');
	});
});
