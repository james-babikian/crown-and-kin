import { describe, expect, it } from 'vitest';
import type { EdgePath, StrokeKind } from '../../src/layout/model';
import { geometry, layOut } from './pipeline';
import { COUPLE_KINDS, DESCENT_KINDS, hangsFrom } from './paths';

const lines = (...xs: string[]) => xs.join('\n') + '\n';

/*
 * The decision notes "What `EdgePath.people` lists": a family's trunk lists the parents and all its
 * children; a drop lists one child and its placement parents. For an only child the two have the
 * same people, so both helpers find both lines; they must then share the style anyway.
 */
const trunkOf = (paths: EdgePath[], parents: string[], children: string[]) =>
	paths.filter((p) => DESCENT_KINDS.includes(p.kind) && [...parents, ...children].every((id) => p.people.includes(id)));
const dropTo = (paths: EdgePath[], child: string, siblings: string[] = []) =>
	paths.filter((p) => DESCENT_KINDS.includes(p.kind) && p.people.includes(child) && !siblings.some((s) => p.people.includes(s)));
const kinds = (paths: EdgePath[]) => [...new Set(paths.map((p) => p.kind))].sort();

describe('primary union when a couple has two unions: spec §4.3', () => {
	const src = lines(
		'people:',
		'  - {id: a, name: A}',
		'  - {id: b, name: B}',
		'  - {id: c, name: C, parents: [a, b], union: first}',
		'  - {id: d, name: D, parents: [a, b]}',
		'unions:',
		'  - {id: first, partners: [a, b], type: betrothal}',
		'  - {id: second, partners: [a, b]}',
	);

	it("each child hangs from its own union's dot", () => {
		const { g, layout, edges } = layOut(src);
		const first = layout.unions.get(g.unions.find((u) => u.id === 'first')!.key)!;
		const second = layout.unions.get(g.unions.find((u) => u.id === 'second')!.key)!;
		const tol = geometry().unionSize;
		expect(hangsFrom(edges, layout, first, 'c', tol)).toBe(true);
		expect(hangsFrom(edges, layout, second, 'd', tol)).toBe(true);
		// Only decidable from the drawing when the two dots are not drawn on the same spot.
		if (Math.hypot(first.x - second.x, first.y - second.y) > tol) {
			expect(hangsFrom(edges, layout, first, 'd', tol)).toBe(false);
			expect(hangsFrom(edges, layout, second, 'c', tol)).toBe(false);
		}
	});
});

describe('cycles through any parent type still lay out: spec §8', () => {
	for (const type of ['ward', 'rumoured', 'adoptive']) {
		it(`a loop through a ${type} link`, () => {
			const { layout } = layOut(
				lines('people:', '  - {id: a, name: A, parents: [c]}', '  - {id: b, name: B, parents: [a]}', `  - {id: c, name: C, parents: [{id: b, type: ${type}}]}`),
			);
			expect([...layout.persons.keys()].sort()).toEqual(['a', 'b', 'c']);
		});
	}
});

describe('line styles of families: spec §5.3', () => {
	it('a family whose children are all illegitimate is dashed throughout', () => {
		const { edges } = layOut(
			lines(
				'people:',
				'  - {id: a, name: A}',
				'  - {id: b, name: B}',
				'  - {id: c1, name: C1, parents: [a, b], illegitimate: true}',
				'  - {id: c2, name: C2, parents: [a, b], illegitimate: true}',
				'unions:',
				'  - {partners: [a, b], type: affair}',
			),
		);
		const trunk = trunkOf(edges.paths, ['a', 'b'], ['c1', 'c2']);
		expect(trunk.length).toBeGreaterThan(0);
		expect(kinds(trunk)).toEqual(['illegitimate']);
		expect(kinds(dropTo(edges.paths, 'c1', ['c2']))).toEqual(['illegitimate']);
		expect(kinds(dropTo(edges.paths, 'c2', ['c1']))).toEqual(['illegitimate']);
	});

	it('a single parent with only illegitimate children: dashed throughout', () => {
		const { edges } = layOut(
			lines('people:', '  - {id: a, name: A}', '  - {id: c1, name: C1, parents: [a], illegitimate: true}', '  - {id: c2, name: C2, parents: [a], illegitimate: true}'),
		);
		const trunk = trunkOf(edges.paths, ['a'], ['c1', 'c2']);
		expect(trunk.length).toBeGreaterThan(0);
		expect(kinds(trunk)).toEqual(['illegitimate']);
		expect(kinds(dropTo(edges.paths, 'c1', ['c2']))).toEqual(['illegitimate']);
		expect(kinds(dropTo(edges.paths, 'c2', ['c1']))).toEqual(['illegitimate']);
	});

	it('a mixed family: solid trunk, dashed drop only to the illegitimate child', () => {
		const { edges } = layOut(
			lines(
				'people:',
				'  - {id: a, name: A}',
				'  - {id: b, name: B}',
				'  - {id: c1, name: C1, parents: [a, b]}',
				'  - {id: c2, name: C2, parents: [a, b], illegitimate: true}',
				'unions:',
				'  - {partners: [a, b]}',
			),
		);
		expect(kinds(trunkOf(edges.paths, ['a', 'b'], ['c1', 'c2']))).toEqual(['descent']);
		expect(kinds(dropTo(edges.paths, 'c1', ['c2']))).toEqual(['descent']);
		expect(kinds(dropTo(edges.paths, 'c2', ['c1']))).toEqual(['illegitimate']);
	});

	it('couple lines take the union type; co-parents with no union get an implicit line', () => {
		const { edges } = layOut(
			lines(
				'people:',
				'  - {id: lord, name: Lord}',
				'  - {id: bride, name: Bride}',
				'  - {id: consort, name: Consort}',
				'  - {id: lover, name: Lover}',
				'  - {id: wife, name: Wife}',
				'  - {id: f, name: F}',
				'  - {id: m, name: M}',
				'  - {id: kid, name: Kid, parents: [f, m]}',
				'unions:',
				'  - {partners: [lord, bride], type: betrothal}',
				'  - {partners: [lord, consort], type: concubinage}',
				'  - {partners: [lord, lover], type: affair}',
				'  - {partners: [lord, wife]}',
			),
		);
		const couple = (a: string, b: string) => kinds(edges.paths.filter((p) => COUPLE_KINDS.includes(p.kind) && p.people.includes(a) && p.people.includes(b)));
		const expected: [string, string, StrokeKind][] = [
			['lord', 'bride', 'betrothal'],
			['lord', 'consort', 'concubinage'],
			['lord', 'lover', 'affair'],
			['lord', 'wife', 'marriage'],
			['f', 'm', 'implicit'],
		];
		for (const [a, b, kind] of expected) expect(couple(a, b), `${a} + ${b}`).toEqual([kind]);
		expect(edges.markers.filter((x) => x.kind === 'implicit-union')).toHaveLength(1);
		expect(edges.markers.filter((x) => x.kind === 'union')).toHaveLength(4);
	});
});

describe('lines to children placed under adoptive or ward parents: spec §5.3, the decision notes', () => {
	it('a child placed under adoptive parents: its drop (and the only-child trunk) are adoptive', () => {
		const { edges } = layOut(
			lines(
				'people:',
				'  - {id: m, name: M}',
				'  - {id: f, name: F}',
				'  - {id: am, name: AM}',
				'  - {id: af, name: AF}',
				'  - id: kid',
				'    name: Kid',
				'    parents: [m, f, {id: am, type: adoptive}, {id: af, type: adoptive}]',
				'    placement: adoptive',
				'unions:',
				'  - {partners: [m, f]}',
				'  - {partners: [am, af]}',
			),
		);
		const drop = dropTo(edges.paths, 'kid').filter((p) => p.people.includes('am'));
		expect(drop.length).toBeGreaterThan(0);
		expect(kinds(drop)).toEqual(['adoptive']);
		expect(kinds(trunkOf(edges.paths, ['am', 'af'], ['kid']))).toEqual(['adoptive']);
		// The birth parents are a side line, not a drop.
		expect(edges.paths.some((p) => p.kind === 'birth-link' && p.people.includes('kid') && p.people.includes('m'))).toBe(true);
	});

	it('a child placed under a ward parent: its drop and trunk are ward', () => {
		const { edges } = layOut(lines('people:', '  - {id: g, name: Guardian}', '  - {id: w, name: Ward, parents: [{id: g, type: ward}]}'));
		const drop = dropTo(edges.paths, 'w');
		expect(drop.length).toBeGreaterThan(0);
		expect(kinds(drop)).toEqual(['ward']);
		expect(kinds(trunkOf(edges.paths, ['g'], ['w']))).toEqual(['ward']);
	});

	it('a couple with a birth child and an adopted child: plain trunk, adoptive drop only to the adopted one', () => {
		const { edges } = layOut(
			lines(
				'people:',
				'  - {id: am, name: AM}',
				'  - {id: af, name: AF}',
				'  - {id: own, name: Own, parents: [am, af]}',
				'  - {id: kid, name: Kid, parents: [{id: am, type: adoptive}, {id: af, type: adoptive}]}',
				'unions:',
				'  - {partners: [am, af]}',
			),
		);
		expect(kinds(trunkOf(edges.paths, ['am', 'af'], ['own', 'kid']))).toEqual(['descent']);
		expect(kinds(dropTo(edges.paths, 'own', ['kid']))).toEqual(['descent']);
		expect(kinds(dropTo(edges.paths, 'kid', ['own']))).toEqual(['adoptive']);
	});
});
