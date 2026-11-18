// Hostile and random notes never throw out of the group and couple reading, and keep its invariants (spec §8: never throw out of a public
// function for bad input; contract "Three own lines" §1, §4.1). 600 random notes full of children with three or more parents of mixed types, in
// both orders of their people, derive, get their rows and their walk, and are seated and derived again as a part of a tree.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { computeGenerations } from '../../src/core/generations';
import { withGroupSeats, isGroupSeat } from '../../src/core/group-seats';
import { computeModelOrder } from '../../src/core/order';
import { defaultHubs, parentVerdicts } from '../../src/core/parent-groups';
import { parseDynasty } from '../../src/core/parse';
import { randomParentSource } from '../support/parent-trees';

const SEEDS = Array.from({ length: 600 }, (_, i) => i + 1);

function graphOf(source: string, verdicts?: ReturnType<typeof parentVerdicts>): FamilyGraph | undefined {
	const parsed = parseDynasty(source);
	return parsed.ok ? deriveFamilies(parsed.tree, verdicts ? { verdicts } : {}) : undefined;
}

describe('random notes with many parents', () => {
	it('derive, rows, walk and seats never throw, and a group is in no union and no ward pair', () => {
		let groups = 0;
		let couples = 0;
		for (const seed of SEEDS) {
			const g = graphOf(randomParentSource(seed));
			if (!g) continue;
			const gen = computeGenerations(g);
			expect(gen.size, `seed ${seed}`).toBe(g.people.length);
			computeModelOrder(g, gen);
			for (const grp of g.parentGroups) {
				groups++;
				expect(g.primaryUnion.has(grp.child), `seed ${seed}`).toBe(false);
				expect(g.wardPairs.some((w) => w.child === grp.child), `seed ${seed}`).toBe(false);
				expect(g.unions.some((u) => u.children.includes(grp.child)), `seed ${seed}`).toBe(false);
				expect(grp.parents.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
			}
			couples += [...parentVerdicts(g).values()].filter((v) => v.verdict === 'couple').length;
			const seated = withGroupSeats(g, defaultHubs(g), new Set(g.parentGroups.map((x) => x.child)));
			for (const grp of g.parentGroups) {
				expect(new Set(seated.placementParents.get(grp.child)), `seed ${seed}`).toEqual(new Set(grp.parents));
				expect(seated.soloChildren.get(seated.placementParents.get(grp.child)![0])).toContain(grp.child);
			}
			expect(seated.unions.filter(isGroupSeat).every((u) => u.children.length === 0 && u.implicit), `seed ${seed}`).toBe(true);
			computeGenerations(seated);
		}
		// The generator must reach both readings often, or the test proves nothing.
		expect(groups).toBeGreaterThan(40);
		expect(couples).toBeGreaterThan(30);
	});

	it('a group verdict does not depend on the order of the people in the note', () => {
		let checked = 0;
		for (const seed of SEEDS.slice(0, 400)) {
			const source = randomParentSource(seed);
			const lines = source.split('\n');
			const at = lines.flatMap((l, i) => (/^ {2}- \{id: p\d+, name: /.test(l) ? [i] : []));
			const people = at.map((i) => lines[i]).reverse();
			at.forEach((i, k) => (lines[i] = people[k]));
			const a = graphOf(source);
			const b = graphOf(lines.join('\n'));
			// Which link closes a cycle depends on the order of the people (validation), so a note with a cycle is not a fair test of the verdict.
			if (!a || !b || a.issues.some((i) => i.code === 'cycle')) continue;
			checked++;
			const text = (g: FamilyGraph) => [...parentVerdicts(g)].map(([c, v]) => `${c}:${v.verdict}:${v.verdict === 'couple' ? [...v.pair].sort().join('+') : ''}`).sort().join(' ');
			expect(text(b), `seed ${seed}`).toBe(text(a));
		}
		expect(checked).toBeGreaterThan(100);
	});

	it('a part of a tree derived with the verdicts of its whole tree never throws', () => {
		for (const seed of SEEDS.slice(0, 300)) {
			const source = randomParentSource(seed);
			const whole = graphOf(source);
			if (!whole) continue;
			const lines = source.split('\n');
			// Drop every third person line: the links to them are reported and dropped.
			let k = 0;
			const part = lines.filter((l) => !/^ {2}- \{id: p\d+, name: /.test(l) || ++k % 3 !== 0).join('\n');
			const g = graphOf(part, parentVerdicts(whole));
			if (g) computeGenerations(g);
		}
	});
});
