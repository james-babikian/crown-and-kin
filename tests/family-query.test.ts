import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { ancestorsOf, describeDelete, descendantsOf, familyOf, parentKind, pickerExclusions, siblingGroup, writtenParents } from '../src/core/family-query';
import { parseDynasty } from '../src/core/parse';

// Unit tests for the family questions (spec §6.3, §6.4, §6.6, §6.7) on cases the acceptance
// tests do not reach: cycles already in the data, unknown parent types, duplicates, id-less people.

function graph(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const CYCLE = `people:
  - id: a
    name: A
    parents: [{id: c, type: ward}]
  - id: b
    name: B
    parents: [a]
  - id: c
    name: C
    parents: [b, b, {id: b, type: foster}, ghost, c]
  - name: No id
    parents: [a]
`;

describe('family questions', () => {
	it('parents as written: missing and self links left out, unknown types read as birth, duplicates once', () => {
		const g = graph(CYCLE);
		expect(writtenParents(g, 'c')).toEqual([{ id: 'b', type: 'birth' }]);
		expect(parentKind('foster')).toBe('birth');
		expect(parentKind(undefined)).toBe('birth');
		expect(writtenParents(g, 'nobody')).toEqual([]);
	});

	it('a cycle already in the data does not loop, and its dropped link still counts', () => {
		const g = graph(CYCLE);
		expect(g.issues.some((i) => i.code === 'cycle')).toBe(true);
		expect([...descendantsOf(g, 'a')].sort()).toEqual(['a', 'b', 'c', '~4']);
		expect([...ancestorsOf(g, 'b')].sort()).toEqual(['a', 'b', 'c']);
		expect(pickerExclusions(g, 'a', 'add-parent', 'ward').has('c')).toBe(true);
	});

	it('an id-less person has a family view under its generated id', () => {
		const g = graph(CYCLE);
		const f = familyOf(g, '~4')!;
		expect(f.parents).toEqual([{ id: 'a', type: 'birth' }]);
		expect(f.siblings).toEqual({ group: ['b', '~4'], index: 1, canMoveEarlier: true, canMoveLater: false });
		// The link that closed the cycle (c → a) is not drawn, so a has no group to move in.
		expect(siblingGroup(g, 'a')).toBeNull();
		expect(familyOf(g, 'a')!.siblings).toBeNull();
	});

	it('unknown people: null view, only themself excluded, nothing to delete', () => {
		const g = graph(CYCLE);
		expect(familyOf(g, 'zz')).toBeNull();
		expect([...pickerExclusions(g, 'zz', 'add-child')]).toEqual(['zz']);
		expect(pickerExclusions(g, 'a', 'focus').size).toBe(0);
		expect(describeDelete(g, 'zz', {})).toEqual({ unions: 0, childLinks: 0, clearsStart: false, clearsFocus: false });
	});

	it('partners: a pair with two unions is listed twice but offered once; start and end come along', () => {
		const g = graph(`people:
  - id: a
    name: A
  - id: b
    name: B
  - id: c
    name: C
  - id: k
    name: K
    parents: [a, c]
unions:
  - partners: [b, a]
    type: betrothal
    start: '1100'
  - id: second
    partners: [a, b]
    end: 1120
`);
		const f = familyOf(g, 'a')!;
		expect(f.partners).toEqual([
			{ partner: 'b', union: { index: 0, partners: ['b', 'a'], text: "partners: [b, a] type: betrothal start: '1100'" }, type: 'betrothal', start: '1100' },
			{ partner: 'b', union: { index: 1, partners: ['a', 'b'], text: 'id: second partners: [a, b] end: 1120' }, type: 'marriage', end: '1120' },
			{ partner: 'c', union: null, type: null },
		]);
		expect(f.otherParentChoices).toEqual(['b', 'c']);
	});
});
