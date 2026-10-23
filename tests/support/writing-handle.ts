/*
 * A fake block handle that really applies the ops it is given (`applyOp` on its body), and the sample note of House Valmont that the
 * Houses window, house page and edit sheet tests share. Used by `obsidian-m10-notes` and `r028-n23-open-linked-note`, which each had a copy.
 */

import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';

/** Two houses with arms colour, three links of different kind and one partnership with two children. */
export const VALMONT_BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
  - id: orsini
    name: House Orsini
  - id: empty
    name: House Empty
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    born: "1200"
  - id: bran
    name: Bran Valmont
    house: valmont
    link: "[[Bran Valmont]]"
  - id: cara
    name: Cara Valmont
    house: valmont
    link: "https://example.com/cara"
  - id: dora
    name: Dora Valmont
    house: valmont
    link: "[[People/Dora]]"
  - id: ines
    name: Ines Orsini
    house: orsini
    link: "[[Ines Orsini]]"
unions:
  - partners: [aldric, ines]
parents:
  - child: bran
    parent: aldric
  - child: dora
    parent: aldric
`;

/** A handle on `Trees/Tree.md` whose `write` applies each op to the body and records it; `undo` gives the first body back. */
export function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Trees/Tree.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => ({ ok: true, body: body })) as never);
	return h;
}

/** A handle on `n.md` whose writes apply the op to its body, with a one-step undo, as the real handle does. */
export function undoStackHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
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
