// Design gate 0.2.2 (code-reviewer): tests that pin the corrections to the contract of the id operations and
// `nextPersonId`. They were red until WP1 was built; they now pass and guard the built code.
import { describe, expect, it } from 'vitest';
import { nextPersonId } from '../src/core/id-gen';
import { issueText } from '../src/core/messages';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import type { Op } from '../src/core/edit';

const batch = (...ops: Op[]): Op => ({ kind: 'batch', ops });
const issues = (body: string) => {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('parse');
	return r.tree;
};
// A real refusal, not the "Unknown edit." of an op that is not built yet.
const refused = (r: ReturnType<typeof applyOp>) => !r.ok && r.detail !== 'Unknown edit.';

describe('G1 nextPersonId (ids with more than 15 digits are ignored, and the result is never in `taken`)', () => {
	// The design gate showed that the bare rule returns the same id twice here; the contract now has the loop.
	it('never returns an id that is in `taken`', () => {
		const taken = new Set(['p999999999999999']);
		const first = nextPersonId(taken);
		taken.add(first);
		const second = nextPersonId(taken);
		expect(second, `first ${first}, second ${second}`).not.toBe(first);
		expect(taken.has(second)).toBe(false);
	});
});

describe('G2 set-title-id in a batch with a holder removal: the card-title cleanup must still run', () => {
	const body = `titles:
  - id: crown
    name: Crown
    holders: [x]
people:
  - {id: x, name: X, card-title: crown}
`;
	it('X no longer holds the title, so no card-title is left (not even under the new id)', () => {
		const r = applyOp(body, batch({ kind: 'set-holders', title: 'crown', items: [] }, { kind: 'set-title-id', id: 'crown', newId: 'king' }));
		expect(r.ok, JSON.stringify(r)).toBe(true);
		if (r.ok) expect(r.body).not.toContain('card-title');
	});
});

describe('G3 a dangling reference to the new id must not be taken over', () => {
	const body = `houses:
  - {id: valmont, name: Valmont}
people:
  - {id: a, name: A, house: valmont}
  - {id: b, name: B, house: crown}
`;
	it('set-house-id valmont to crown is refused: B already writes house: crown and would silently join Valmont', () => {
		const r = applyOp(body, { kind: 'set-house-id', id: 'valmont', newId: 'crown' });
		expect(refused(r), JSON.stringify(r)).toBe(true);
	});
	const titles = `titles:
  - {id: crown, name: Crown, holders: [a]}
people:
  - {id: a, name: A}
  - {id: b, name: B, card-title: king}
`;
	it('set-title-id crown to king is refused: B writes card-title: king (not held) and would gain a title', () => {
		const r = applyOp(titles, { kind: 'set-title-id', id: 'crown', newId: 'king' });
		expect(refused(r), JSON.stringify(r)).toBe(true);
	});
	it('delete-house with keep, then set-house-id to the deleted id, in one batch: refused', () => {
		const two = `houses:
  - {id: a, name: A}
  - {id: b, name: B}
people:
  - {id: p1, name: P1, house: a}
`;
		const r = applyOp(two, batch({ kind: 'delete-house', id: 'a', people: 'keep' }, { kind: 'set-house-id', id: 'b', newId: 'a' }));
		expect(refused(r), JSON.stringify(r)).toBe(true);
	});
});

describe('G4 a new house and a renamed house in one Save', () => {
	const body = `houses:
  - {id: valmont, name: Valmont}
people:
  - {id: a, name: A, house: valmont}
`;
	it('set-house-id before add-house: both apply, the new house gets crown-2', () => {
		const r = applyOp(body, batch({ kind: 'set-house-id', id: 'valmont', newId: 'crown' }, { kind: 'add-house', name: 'Crown' }));
		expect(r.ok, JSON.stringify(r)).toBe(true);
		if (r.ok) expect(r.created).toEqual(['crown-2']);
	});
});

describe('G5 the "has no id" example for a person must not be an id that is taken', () => {
	it('with p1 to p3 in the tree the example is p4', () => {
		const body = `people:
  - {id: p1, name: One}
  - {id: p2, name: Two}
  - {id: p3, name: Three}
  - {name: Four}
`;
		const t = issues(body);
		const found = t.issues.find((i) => i.code === 'missing-id');
		const text = found ? issueText(found) : '';
		expect(text).toContain('id: p4');
	});
});

describe('G6 persons with no written id still get their house changed (rewrite by position, not by id)', () => {
	it('set-house-id changes house of a person written without id', () => {
		const body = `houses:
  - {id: valmont, name: Valmont}
people:
  - {name: Nameless, house: valmont}
  - {id: b, name: B, house: valmont}
`;
		const r = applyOp(body, { kind: 'set-house-id', id: 'valmont', newId: 'crown' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
		if (r.ok) expect(r.body.match(/house: crown/g)?.length).toBe(2);
	});
});

describe('G7 a no-op id and an old id with characters the new rule forbids', () => {
	it('newId equal to the old id is a no-op, even when the old id has capitals', () => {
		const body = `houses:
  - {id: House_Valmont, name: Valmont}
people:
  - {id: a, name: A, house: House_Valmont}
`;
		const r = applyOp(body, { kind: 'set-house-id', id: 'House_Valmont', newId: 'House_Valmont' });
		expect(r.ok, JSON.stringify(r)).toBe(true);
		if (r.ok) expect(r.body).toBe(body);
	});
});
