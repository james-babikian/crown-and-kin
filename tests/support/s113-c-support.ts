/*
 * Shared helpers of the 0.2.3 search round, area C (windows and sheets). Not a test file.
 * The real windows run on the fakes, as in `r112-review-d-id-window.test.ts`.
 */
import { expect } from 'vitest';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { FEl, dispatch, settle } from '../acceptance/fake-dom';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';

export type Writing = FakeHandle & { ops: Op[] };

/** A handle whose writes apply the op to its body, with a one-step undo, as the real handle does. */
export function writingHandle(body: string): Writing {
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

export const click = async (el: FEl | null) => {
	expect(el).not.toBeNull();
	dispatch(el!, 'click', { detail: 1 });
	await settle();
};

export function type(input: FEl, text: string): void {
	input.value = text;
	dispatch(input, 'input');
}

/** The fake DOM has no `:not(:disabled)`; the sheet puts the focus back with it. */
export function stripNotDisabled(qs: (this: FEl, sel: string) => FEl | null) {
	return function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	};
}
