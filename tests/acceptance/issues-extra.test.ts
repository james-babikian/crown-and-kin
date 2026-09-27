import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import type { CodedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';

// Issue codes of src/core/issues.ts that fixture 5 does not cover, on small inline trees (spec §8).

function derive(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return deriveFamilies(r.tree);
}
const issues = (source: string): CodedIssue[] => derive(source).issues;
const tally = (xs: CodedIssue[]) => xs.map((i) => `${i.level}:${i.code}`).sort();
const lines = (...xs: string[]) => xs.join('\n') + '\n';

const COUPLES = [
	'people:',
	'  - {id: a, name: A}',
	'  - {id: b, name: B}',
	'  - {id: c, name: C}',
	'  - {id: d, name: D}',
];

describe('reference codes', () => {
	it("union-not-of-parents: `union` names a union that belongs to another couple", () => {
		const src = lines(...COUPLES, '  - {id: x, name: X, parents: [a, b], union: cd}', 'unions:', '  - {id: ab, partners: [a, b]}', '  - {id: cd, partners: [c, d]}');
		const found = issues(src);
		expect(tally(found)).toEqual(['warning:union-not-of-parents']);
		expect(found[0].ids ?? []).toContain('x');
		expect(found[0].params).toMatchObject({ ref: 'cd' });
	});

	it('the child still hangs from the union of its own parents (§4.3 fallback)', () => {
		const src = lines(...COUPLES, '  - {id: x, name: X, parents: [a, b], union: cd}', 'unions:', '  - {id: ab, partners: [a, b]}', '  - {id: cd, partners: [c, d]}');
		const g = derive(src);
		expect(g.unions.find((u) => u.id === 'ab')!.children).toEqual(['x']);
		expect(g.unions.find((u) => u.id === 'cd')!.children).toEqual([]);
	});
});

describe('structure codes', () => {
	it('self-parent: a person listed as their own parent (and nothing else)', () => {
		const found = issues(lines('people:', '  - {id: a, name: A, parents: [a]}'));
		expect(tally(found)).toEqual(['warning:self-parent']);
		expect(found[0].ids ?? []).toContain('a');
	});

	it('self-parent through a non-birth type is the same problem', () => {
		expect(tally(issues(lines('people:', '  - {id: a, name: A, parents: [{id: a, type: ward}]}')))).toEqual(['warning:self-parent']);
	});

	it('duplicate-house-id is a warning, not an edit-blocking error', () => {
		const found = issues(lines('houses:', '  - {id: h, name: House One}', '  - {id: h, name: House Two}', 'people:', '  - {id: a, name: A, house: h}'));
		expect(tally(found)).toEqual(['warning:duplicate-house-id']);
		expect(found[0].params).toMatchObject({ id: 'h' });
	});
});

describe('shape codes', () => {
	for (const section of ['people', 'houses', 'unions']) {
		it(`entry-not-map: a plain value inside ${section}`, () => {
			const rest = section === 'people' ? [] : ['people:', '  - {id: a, name: A}'];
			const found = issues(lines(`${section}:`, '  - just some words', ...rest));
			expect(tally(found)).toEqual(['warning:entry-not-map']);
			expect(found[0].params).toMatchObject({ section });
		});
	}

	it('missing-id: a person with no id', () => {
		const found = issues(lines('people:', '  - {id: a, name: A}', '  - name: Nameless'));
		expect(tally(found)).toEqual(['warning:missing-id']);
		expect(found[0].params).toMatchObject({ section: 'people' });
	});

	it('missing-id: a house with no id', () => {
		const found = issues(lines('houses:', '  - name: House Nowhere', 'people:', '  - {id: a, name: A}'));
		expect(tally(found)).toEqual(['warning:missing-id']);
		expect(found[0].params).toMatchObject({ section: 'houses' });
	});

	const shapes: [string, string[]][] = [
		['people', ['people:', '  a: {name: A}']],
		['houses', ['houses:', '  h: {name: House H}']],
		['unions', ['unions:', '  partners: [a, b]']],
		['options', ['options: [start, focus]']],
	];
	for (const [section, body] of shapes) {
		it(`section-wrong-shape: ${section} has the wrong shape`, () => {
			const found = issues(lines(...body));
			expect(tally(found)).toEqual(['warning:section-wrong-shape']);
			expect(found[0].params).toMatchObject({ section });
		});
	}
});

describe('primary union when a couple has two unions: spec §4.3', () => {
	const src = lines(
		...COUPLES.slice(0, 3),
		'  - {id: c, name: C, parents: [a, b], union: first}',
		'  - {id: d, name: D, parents: [a, b]}',
		'unions:',
		'  - {id: first, partners: [a, b], type: betrothal}',
		'  - {id: second, partners: [a, b]}',
	);

	it('a child whose `union` names the first goes under the first; one without `union` under the last-listed', () => {
		const g = derive(src);
		const first = g.unions.find((u) => u.id === 'first')!;
		const second = g.unions.find((u) => u.id === 'second')!;
		expect(g.primaryUnion.get('c')).toBe(first.key);
		expect(g.primaryUnion.get('d')).toBe(second.key);
		expect(first.children).toEqual(['c']);
		expect(second.children).toEqual(['d']);
		expect(g.issues).toEqual([]);
	});
});

describe('cycle through any parent type: spec §8', () => {
	// a is b's parent, b is c's parent, c is a's parent; one of the three links has the given type.
	const loop = (type: string) =>
		lines('people:', '  - {id: a, name: A, parents: [c]}', '  - {id: b, name: B, parents: [a]}', `  - {id: c, name: C, parents: [{id: b, type: ${type}}]}`);

	for (const type of ['ward', 'rumoured', 'adoptive']) {
		it(`a loop through a ${type} link is a cycle naming all three people`, () => {
			const found = issues(loop(type));
			expect(tally(found)).toEqual(['warning:cycle']);
			expect([...(found[0].ids ?? [])].sort()).toEqual(['a', 'b', 'c']);
		});
	}
});
