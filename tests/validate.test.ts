import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { isParentType, isPlacementType, isUnionType, parentKind, type Tree } from '../src/core/types';
import { cleanParents, push, validateTree } from '../src/core/validate';

function tree(src: string): Tree {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}
const all = (src: string) => deriveFamilies(tree(src)).issues;
const codes = (src: string) => all(src).map((i) => i.code);
const p = (id: string, extra = '') => `  - id: ${id}\n    name: ${id.toUpperCase()}\n${extra}`;

describe('validateTree: blocking', () => {
	it('reports a duplicate person id once, keeps the first person', () => {
		const v = validateTree(tree(`people:\n${p('a')}  - id: a\n    name: Second\n  - id: a\n    name: Third\n`));
		expect(v.people.map((x) => x.name)).toEqual(['A']);
		expect(v.issues).toEqual([{ code: 'duplicate-person-id', level: 'blocking', params: { id: 'a', name: 'A' }, ids: ['a'] }]);
	});

	it('reports a duplicate union id once and still draws both unions', () => {
		const src = `people:\n${p('a')}${p('b')}${p('c')}unions:\n  - {id: w, partners: [a, b]}\n  - {id: w, partners: [a, c]}\n`;
		expect(all(src)).toEqual([{ code: 'duplicate-union-id', level: 'blocking', params: { id: 'w' }, ids: ['a', 'b', 'c'] }]);
		expect(deriveFamilies(tree(src)).unions).toHaveLength(2);
	});
});

describe('validateTree: references', () => {
	it('one missing-parent per missing id, not per entry', () => {
		expect(codes(`people:\n${p('c', '    parents: [ghost, ghost, {id: ghost, type: adoptive}]\n')}`)).toEqual(['missing-parent']);
	});

	it('self-parent once, and the link is not used', () => {
		const g = deriveFamilies(tree(`people:\n${p('a', '    parents: [a, {id: a, type: adoptive}]\n')}`));
		expect(g.issues.map((i) => i.code)).toEqual(['self-parent']);
		expect(g.placementParents.get('a')).toEqual([]);
	});

	it('one missing-partner per missing id; the union is not drawn', () => {
		const src = `people:\n${p('a')}unions:\n  - partners: [ghost, nobody]\n  - partners: [a, nobody]\n`;
		expect(all(src).map((i) => [i.code, i.params.ref])).toEqual([
			['missing-partner', 'ghost'],
			['missing-partner', 'nobody'],
			['missing-partner', 'nobody'],
		]);
		expect(deriveFamilies(tree(src)).unions).toEqual([]);
	});

	it('a union with the same person twice gives only union-same-partner, even when that person is missing', () => {
		expect(codes('unions:\n  - partners: [ghost, ghost]\n')).toEqual(['union-same-partner']);
	});

	it('a union with 1 or 3 partners gives only union-partner-count', () => {
		expect(all('unions:\n  - partners: [a]\n  - {partners: [x, y, z], type: odd}\n').map((i) => [i.code, i.params.count])).toEqual([
			['union-partner-count', 1],
			['union-partner-count', 3],
		]);
	});

	it('missing house, start and focus', () => {
		expect(codes(`options: {start: x, focus: y}\npeople:\n${p('a', '    house: nowhere\n')}`)).toEqual(['missing-start', 'missing-focus', 'missing-house']);
	});

	it('duplicate house id: a warning, and the first house wins', () => {
		const src = `houses:\n  - {id: h, name: First}\n  - {id: h, name: Second}\n  - {id: h, name: Third}\n`;
		const g = deriveFamilies(tree(src));
		expect(g.issues).toEqual([{ code: 'duplicate-house-id', level: 'warning', params: { id: 'h', house: 'First' }, ids: ['h'] }]);
		expect(g.houses.get('h')!.name).toBe('First');
	});
});

describe('validateTree: union field on a person', () => {
	const couple = `${p('a')}${p('b')}${p('c')}`;

	it('an id that names no union gives missing-union only', () => {
		expect(codes(`people:\n${couple}${p('k', '    parents: [a, b]\n    union: nope\n')}unions:\n  - {id: w, partners: [a, b]}\n`)).toEqual(['missing-union']);
	});

	it('an existing union of other people gives union-not-of-parents', () => {
		const src = `people:\n${couple}${p('k', '    parents: [a, b]\n    union: other\n')}unions:\n  - {id: w, partners: [a, b]}\n  - {id: other, partners: [a, c]}\n`;
		expect(all(src)).toEqual([{ code: 'union-not-of-parents', level: 'warning', params: { person: 'K', ref: 'other' }, ids: ['k'] }]);
		expect(deriveFamilies(tree(src)).primaryUnion.get('k')).toBe('u0');
	});

	it('also when the parents have no listed union, or the child has one parent', () => {
		const u = 'unions:\n  - {id: other, partners: [a, c]}\n';
		expect(codes(`people:\n${couple}${p('k', '    parents: [a, b]\n    union: other\n')}${u}`)).toEqual(['union-not-of-parents']);
		expect(codes(`people:\n${couple}${p('k', '    parents: [b]\n    union: other\n')}${u}`)).toEqual(['union-not-of-parents']);
	});

	it('no issue when the union is one of the parents', () => {
		const src = `people:\n${couple}${p('k', '    parents: [a, b]\n    union: first\n')}unions:\n  - {id: first, partners: [a, b]}\n  - {id: second, partners: [b, a]}\n`;
		expect(all(src)).toEqual([]);
		expect(deriveFamilies(tree(src)).primaryUnion.get('k')).toBe('u0');
	});
});

describe('validateTree: values', () => {
	it('unknown placement, parent type and union type; any sex value is valid (D12)', () => {
		const src = `people:\n${p('a')}${p('b', '    sex: x\n    placement: rumoured\n    parents: [{id: a, type: godparent}]\n')}unions:\n  - {partners: [a, b], type: handfasting}\n`;
		// 0.2.8 I13: "handfasting" is no near-typo of a known type, so it is drawn as a marriage with no warning.
		expect(all(src).map((i) => [i.code, i.params.value])).toEqual([
			['unknown-parent-type', 'godparent'],
			['unknown-placement', 'rumoured'],
		]);
	});

	it('any sex value is valid and kept; only the spellings of contract 0.2.7 J.4 give the warning sex-spelling (D12, K.9)', () => {
		const src = `people:\n${p('a', '    sex: m\n')}${p('b', '    sex: f\n')}${p('c', '    sex: x\n')}${p('d', '    sex: M\n')}${p('e', '    sex: nonbinary\n')}${p('f', '    sex: 3\n')}`;
		const g = deriveFamilies(tree(src));
		// `M` is the only spelling here: one warning, naming D with the written value; every value stays as written.
		expect(g.issues.map((i) => [i.code, i.params.person, i.params.value, i.ids])).toEqual([['sex-spelling', 'D', 'M', ['d']]]);
		expect(g.people.map((x) => x.sex)).toEqual(['m', 'f', 'x', 'M', 'nonbinary', '3']);
	});

	it('sex-spelling: M, F, male, man, female, woman, m. and f. in any case; no other value, and no m or f', () => {
		for (const sex of ['M', 'F', 'male', 'Male', 'MALE', 'man', 'Man', 'female', 'Female', 'woman', 'm.', 'f.']) {
			const g = deriveFamilies(tree(`people:\n${p('a', `    sex: "${sex}"\n`)}`));
			expect(g.issues.map((i) => [i.code, i.params.value, i.ids]), sex).toEqual([['sex-spelling', sex, ['a']]]);
			expect(g.people[0].sex, sex).toBe(sex);
		}
		for (const sex of ['m', 'f', 'x', 'nonbinary', 'other', '3', 'mf', 'boy']) {
			expect(all(`people:\n${p('a', `    sex: "${sex}"\n`)}`), sex).toEqual([]);
		}
	});

	it('sex-spelling: one warning for each person, none for a duplicate person that is skipped', () => {
		const src = `people:\n${p('a', '    sex: male\n')}${p('b', '    sex: Female\n')}  - id: a\n    name: Second\n    sex: man\n`;
		const issues = all(src);
		expect(issues.filter((i) => i.code === 'sex-spelling').map((i) => i.ids)).toEqual([['a'], ['b']]);
		expect(issues.map((i) => i.code).sort()).toEqual(['duplicate-person-id', 'sex-spelling', 'sex-spelling']);
	});

	it('an unknown parent type counts as birth, also for the parent limit', () => {
		const src = `people:\n${p('a')}${p('b')}${p('x')}${p('c', '    parents: [a, b, {id: x, type: step}]\n')}`;
		const g = deriveFamilies(tree(src));
		expect(g.issues.map((i) => i.code)).toEqual(['unknown-parent-type', 'too-many-parents']);
		expect(g.secondary).toEqual([{ child: 'c', type: 'birth', parents: ['x'] }]);
	});

	it('the same parent written twice with the same type is used once, without an issue', () => {
		const g = deriveFamilies(tree(`people:\n${p('a')}${p('c', '    parents: [a, a]\n')}`));
		expect(g.issues).toEqual([]);
		expect(g.placementParents.get('c')).toEqual(['a']);
	});

	it('placement without parents of that type falls back to birth parents', () => {
		const g = deriveFamilies(tree(`people:\n${p('a')}${p('c', '    parents: [a]\n    placement: adoptive\n')}`));
		expect(g.issues).toMatchObject([{ code: 'placement-without-parents', params: { person: 'C', placement: 'adoptive' } }]);
		expect(g.placementParents.get('c')).toEqual(['a']);
	});

	it('m and f are the known sexes; nothing written is fine', () => {
		expect(codes(`people:\n${p('a', '    sex: m\n')}${p('b', '    sex: f\n')}${p('c')}`)).toEqual([]);
	});
});

describe('validateTree: cycles', () => {
	it('finds a cycle through ward and rumoured links and names it in order', () => {
		const src = `people:\n${p('a', '    parents: [{id: c, type: rumoured}]\n')}${p('b', '    parents: [a]\n')}${p('c', '    parents: [{id: b, type: ward}]\n')}`;
		const cycle = all(src).find((i) => i.code === 'cycle')!;
		expect(cycle.ids).toEqual(['a', 'b', 'c']);
		expect(cycle.params).toEqual({ people: ['A', 'B', 'C'], dropped: 'A', parent: 'C' });
	});

	it('handles a line of descent 20,000 people long without overflowing the stack', () => {
		const n = 20000;
		const lines = ['people:', '  - {id: p0, name: P0, parents: [p19999]}'];
		for (let i = 1; i < n; i++) lines.push(`  - {id: p${i}, name: P${i}, parents: [p${i - 1}]}`);
		const g = deriveFamilies(tree(lines.join('\n')));
		expect(g.issues.map((i) => i.code)).toEqual(['cycle']);
		expect(g.issues[0].ids).toHaveLength(n);
	});
});

describe('deriveFamilies: issue order', () => {
	it('carries the parse issues first', () => {
		expect(codes(`houses:\n  - {id: h, color: }\npeople:\n  - text\n${p('a', '    house: x\n')}`)).toEqual(['house-color-null', 'entry-not-map', 'missing-house']);
	});
});

describe('deriveFamilies: couple keys (review F1)', () => {
	it('does not throw on ids with a lone surrogate, for listed and implicit unions', () => {
		expect(() => all('people:\n  - id: "\uD800"\n  - id: c\nunions:\n  - partners: ["\uD800", c]\n')).not.toThrow();
		expect(() => all('people:\n  - id: "\uDC00"\n  - id: c\n  - id: k\n    parents: ["\uDC00", c]\n')).not.toThrow();
	});

	it('keeps two couples apart when their ids contain "|"', () => {
		const g = deriveFamilies(
			tree('people:\n  - id: "a|b"\n  - id: c\n  - id: a\n  - id: "b|c"\n  - {id: k1, parents: ["a|b", c]}\n  - {id: k2, parents: [a, "b|c"]}\n'),
		);
		expect(g.primaryUnion.get('k1')).not.toBe(g.primaryUnion.get('k2'));
		expect(g.unions.map((u) => u.children)).toEqual([['k1'], ['k2']]);
	});
});

describe('push (shared list-map helper)', () => {
	it('creates the list on the first value and appends after that, in order', () => {
		const m = new Map<string, number[]>();
		push(m, 'a', 1);
		push(m, 'b', 2);
		push(m, 'a', 3);
		expect([...m]).toEqual([
			['a', [1, 3]],
			['b', [2]],
		]);
	});
});

describe('type guards (types.ts)', () => {
	it('know the written types and nothing else', () => {
		expect(['birth', 'adoptive', 'ward', 'rumoured', 'foster', '', undefined, 3].map(isParentType)).toEqual([true, true, true, true, false, false, false, false]);
		expect(['birth', 'adoptive', 'ward', 'rumoured', undefined].map(isPlacementType)).toEqual([true, true, true, false, false]);
		expect(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit', null].map(isUnionType)).toEqual([true, true, true, true, false, false]);
	});

	it('parentKind keeps a known type and reads anything else as birth', () => {
		expect(parentKind('ward')).toBe('ward');
		expect(parentKind('Ward')).toBe('birth');
		expect(parentKind(undefined)).toBe('birth');
	});
});

describe('cleanParents (shared by validation and the family queries)', () => {
	it('drops self and missing links, reads unknown types as birth, keeps each id and type once, and reports in written order', () => {
		const heard: string[] = [];
		const parents = [
			{ id: 'me', type: 'birth' },
			{ id: 'a', type: 'foster' },
			{ id: 'ghost', type: 'birth' },
			{ id: 'a', type: 'birth' },
			{ id: 'b', type: 'ward' },
			{ id: 'b', type: 'adoptive' },
		];
		const out = cleanParents('me', parents, (id) => id === 'a' || id === 'b' || id === 'me', (why, r) => heard.push(`${why}:${r.id}`));
		expect(out).toEqual([
			{ id: 'a', type: 'birth' },
			{ id: 'b', type: 'ward' },
			{ id: 'b', type: 'adoptive' },
		]);
		expect(heard).toEqual(['self:me', 'unknown-type:a', 'missing:ghost']);
	});
});
