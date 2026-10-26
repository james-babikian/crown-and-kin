import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Op } from '../../src/core/edit';
import { familyOf } from '../../src/core/family-query';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { openUnionEditor, type UnionValues } from '../../src/obsidian/union-edit';
import { loadSheet } from '../../src/view/sheet-draft';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

// G2 review of 1a-W. Proofs only; nothing in src/ changes.
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = async () => {
	for (let i = 0; i < 6; i++) await tick();
};
const NOTE = (union: string) => ['people:', '  - id: a', '    name: A', '  - id: b', '    name: B', 'unions:', `  - partners: [a, b]${union}`, ''].join('\n');

function openSheet(body: string) {
	const sent: Op[] = [];
	const handle = {
		body,
		state: { lastEdited: null, highlight: null },
		write: async (op: Op) => {
			sent.push(op);
			return { ok: false, code: 'missing' };
		},
	} as never;
	const sheet = EditSheet.create({} as never, { handle, personId: 'a', sourcePath: 'x.md' })!;
	const link = familyOf((loadSheet(body, 'a') as unknown as { data: { g: never } }).data.g, 'a')!.partners[0];
	(sheet as unknown as { editPartnership(l: unknown): void }).editPartnership(link);
	const modal = openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
	const select = (name: string) => modal.contentEl.querySelector(`[data-field="${name}"] select`) as FEl;
	const input = (name: string) => modal.contentEl.querySelector(`[data-field="${name}"] input`) as FEl;
	const save = () => dispatch(modal.modalEl.querySelectorAll('button').find((b) => b.getText() === 'Save') as FEl, 'click');
	return { handle, sheet, sent, select, input, save };
}

describe('review 1a-W', () => {
	it('a text with the name of an Object property is shown as that text, not as a function', () => {
		for (const raw of ['constructor', 'toString']) {
			const v: UnionValues = { type: 'marriage', start: '', end: '', endedBy: raw };
			openUnionEditor({} as never, 'A', 'B', v, async () => null);
			const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
			const sel = modal.contentEl.querySelector('[data-field="union-ended-by"] select') as FEl;
			const extra = sel.querySelectorAll('option').find((o) => o.getAttribute('value') === raw)!;
			expect(extra.getText(), raw).toBe(raw);
		}
	});

	it('values from the note that are not text: no change writes nothing, a pick writes', async () => {
		for (const raw of ['[divorce]', '5', 'true', '', '"  "', '{a: 1}', 'null', '~']) {
			const body = NOTE(`
    ended-by: ${raw}`);
			const a = openSheet(body);
			a.save();
			await settle();
			expect(a.sent, raw).toEqual([]);
			resetDom();
			resetObsidian();
			const b = openSheet(body);
			const sel = b.select('union-ended-by');
			sel.value = 'annulment';
			dispatch(sel, 'change');
			b.save();
			await settle();
			expect(b.sent.map((o) => (o as { fields?: unknown }).fields), raw).toEqual([{ 'ended-by': 'annulment' }]);
			resetDom();
			resetObsidian();
		}
	});

	it('picking Divorce on a note that has the alias divorced writes nothing (the alias stays)', async () => {
		const w = openSheet(NOTE('\n    ended-by: divorced'));
		const sel = w.select('union-ended-by');
		sel.value = 'divorce';
		dispatch(sel, 'change');
		w.save();
		await settle();
		// Supervisor ruling (G2 nit 2): the pick means the written value, so no op and no empty undo step.
		expect(w.sent).toHaveLength(0);
	});
});
