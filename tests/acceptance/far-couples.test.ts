import { describe, expect, it } from 'vitest';
import type { TreeLayout } from '../../src/layout/model';
import { fixtureSource } from './load';
import { geometry, layOut } from './pipeline';
import { COUPLE_KINDS, hangsFrom } from './paths';

// D10 and spec §5.3 "Couple, far", with the spec default thresholds (3 card widths, 1 generation).

const person = (id: string, parents?: string[]) => `  - {id: ${id}, name: ${id.toUpperCase()}${parents ? `, parents: [${parents.join(', ')}]` : ''}}`;
/** `first` and four younger siblings, so `first` is at one end of a run of five cards. */
const brood = (first: string, prefix: string, parents: string[]) => [first, ...[2, 3, 4, 5].map((n) => `${prefix}${n}`)].map((id) => person(id, parents));
const block = (people: string[], unions: string[][]) => ['people:', ...people, 'unions:', ...unions.map((u) => `  - {partners: [${u.join(', ')}]}`)].join('\n') + '\n';

const centre = (layout: TreeLayout, id: string) => {
	const b = layout.persons.get(id)!;
	return b.x + b.w / 2;
};

function expectFar(source: string, a: string, b: string, child: string) {
	const { g, layout, edges } = layOut(source);
	const fu = g.unions.find((u) => u.partners.includes(a) && u.partners.includes(b))!;
	const u = layout.unions.get(fu.key)!;
	expect(u.far).toBe(true);
	expect(u.bar).toBe(false);
	// No connecting line between the partners.
	expect(edges.paths.filter((p) => COUPLE_KINDS.includes(p.kind) && p.people.includes(a) && p.people.includes(b))).toEqual([]);
	// Each partner has a tag naming the other, with a hit area of at least 44×44 px (§7.5).
	for (const [me, other] of [
		[a, b],
		[b, a],
	]) {
		const tag = layout.farTags.get(me);
		expect(tag, `tag on ${me}`).toBeDefined();
		expect(tag!.person).toBe(me);
		expect(tag!.spouses).toEqual([other]);
		expect(tag!.hit.w).toBeGreaterThanOrEqual(44);
		expect(tag!.hit.h).toBeGreaterThanOrEqual(44);
	}
	// The couple's children still hang from the union dot.
	expect(fu.children).toEqual([child]);
	expect(hangsFrom(edges, layout, u, child, geometry().unionSize)).toBe(true);
}

describe('far couples: D10, spec §5.3', () => {
	it('partners in different blocks, more than 3 card widths apart, get tags instead of a line', () => {
		const source = block(
			[person('r1'), person('r2'), person('s1'), person('s2'), ...brood('a', 'a', ['r1', 'r2']), ...brood('b', 'b', ['s1', 's2']), person('k', ['a', 'b'])],
			[
				['r1', 'r2'],
				['s1', 's2'],
				['a', 'b'],
			],
		);
		const { layout } = layOut(source);
		// Precondition: the tree really puts them in one row, far apart.
		expect(layout.persons.get('a')!.gen).toBe(layout.persons.get('b')!.gen);
		expect(Math.abs(centre(layout, 'a') - centre(layout, 'b'))).toBeGreaterThan(3 * geometry().cardW);
		expectFar(source, 'a', 'b', 'k');
	});

	it('partners more than one generation apart get tags instead of a line', () => {
		// u marries n, the granddaughter of u's brother p.
		const source = block(
			[person('r1'), person('r2'), person('u', ['r1', 'r2']), person('p', ['r1', 'r2']), person('ps'), person('q', ['p', 'ps']), person('qs'), person('n', ['q', 'qs']), person('k', ['u', 'n'])],
			[
				['r1', 'r2'],
				['p', 'ps'],
				['q', 'qs'],
				['u', 'n'],
			],
		);
		const { layout } = layOut(source);
		expect(layout.persons.get('n')!.gen - layout.persons.get('u')!.gen).toBe(2);
		expect(layout.persons.get('k')!.gen).toBe(layout.persons.get('n')!.gen + 1);
		expectFar(source, 'u', 'n', 'k');
	});

	it('a person with two far spouses has one tag listing both, in union order', () => {
		const source = block(
			[
				...['r', 's', 't'].flatMap((h) => [person(`${h}1`), person(`${h}2`)]),
				...brood('x', 'x', ['r1', 'r2']),
				...brood('y', 'y', ['s1', 's2']),
				...brood('z', 'z', ['t1', 't2']),
			],
			[
				['r1', 'r2'],
				['s1', 's2'],
				['t1', 't2'],
				['x', 'y'],
				['x', 'z'],
			],
		);
		const { layout } = layOut(source);
		for (const s of ['y', 'z']) expect(Math.abs(centre(layout, 'x') - centre(layout, s))).toBeGreaterThan(3 * geometry().cardW);
		expect(layout.farTags.get('x')?.spouses).toEqual(['y', 'z']);
		expect(layout.farTags.get('y')?.spouses).toEqual(['x']);
		expect(layout.farTags.get('z')?.spouses).toEqual(['x']);
	});
});

describe('near couples: D10, spec §5.3', () => {
	it('a couple side by side is not far and has no tags', () => {
		const { g, layout, edges } = layOut(block([person('a'), person('b'), person('k', ['a', 'b'])], [['a', 'b']]));
		const fu = g.unions[0];
		expect(layout.unions.get(fu.key)).toMatchObject({ far: false, bar: true });
		expect(layout.farTags.size).toBe(0);
		expect(edges.paths.some((p) => p.kind === 'marriage' && p.people.includes('a') && p.people.includes('b'))).toBe(true);
	});

	for (const id of ['01', '02']) {
		it(`fixture ${id}: every spouse married in, so no far couples and no tags`, () => {
			const { layout } = layOut(fixtureSource(id));
			for (const u of layout.unions.values()) expect(u.far).toBe(false);
			expect(layout.farTags.size).toBe(0);
		});
	}
});
