// Contract 0.2.7 D.2 (WP2): the time of `successionLine`. It prints the times and checks the budgets with a factor of 10, so a loaded machine does not fail.
// Budgets on the cloud machine: 5 ms for one title on sample trees 07 and 07b, 50 ms on a generated tree of 5 000 people.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { successionLine, type SuccessionSpec } from '../src/core/succession';
import type { Title } from '../src/core/types';
import { fixture } from './helpers';

/** The factor over the D.2 budgets that the asserts allow (the budgets themselves are printed beside the times). */
const FACTOR = 10;
const BUDGET_SAMPLE_MS = 5;
const BUDGET_BIG_MS = 50;

const CASES: { name: string; spec: Partial<SuccessionSpec> }[] = [
	{ name: 'eldest-child', spec: { rule: 'eldest-child' } },
	{ name: 'siblings-first', spec: { rule: 'siblings-first' } },
	{ name: 'nearest-relative', spec: { rule: 'nearest-relative' } },
	{ name: 'heaviest: men-first-in-house + after', spec: { rule: 'nearest-relative', inherit: 'men-first-in-house', illegitimate: 'after' } },
];

function graphOf(source: string): FamilyGraph {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error('parse');
	return deriveFamilies(r.tree);
}

/** The best of `runs` calls in milliseconds (the first calls warm up the code). */
function time(g: FamilyGraph, title: Title, spec: SuccessionSpec, runs = 7): number {
	let best = Infinity;
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		successionLine(g, title, spec, 5, 110);
		best = Math.min(best, performance.now() - t0);
	}
	return best;
}

const specOf = (part: Partial<SuccessionSpec>): SuccessionSpec => ({ inherit: 'no-preference', illegitimate: 'no', adopted: false, ...part });

/** A deep house of about `size` people: a main line of `depth` generations, each couple with a main child and side children whose branches go on a few generations. */
function bigHouse(size: number, depth: number): string {
	let seed = 12345;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	const lines: string[] = [];
	let count = 0;
	const person = (id: string, sex: 'm' | 'f', born: number, parents: string[] = [], extra = '') => {
		count++;
		lines.push(`  - {id: ${id}, name: ${id}, sex: ${sex}, born: ${born}${extra}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
	};
	const perLevel = Math.ceil(size / depth) + 1;
	let side = 0;
	const holders: string[] = [];
	person('m0', 'm', 1000);
	for (let g = 0; g < depth; g++) {
		const born = 1000 + g * 25;
		const wife = `w${g}`;
		person(wife, 'f', born);
		person(`m${g + 1}`, 'm', born + 25, [`m${g}`, wife]);
		person(`x${g}`, 'f', born + 26, [`m${g}`, wife]);
		// The side branch of this generation: random fanout, up to five generations below the daughter x.
		const pool = [{ id: `x${g}`, born: born + 26, depth: 0 }];
		for (let n = perLevel - 3; n > 0; n--) {
			const parent = pool[Math.floor(rnd() * pool.length)];
			const id = `s${side++}`;
			const child = { id, born: parent.born + 20 + Math.floor(rnd() * 10), depth: parent.depth + 1 };
			person(id, rnd() < 0.5 ? 'm' : 'f', child.born, [parent.id], rnd() < 0.05 ? ', illegitimate: true' : '');
			if (child.depth < 5) pool.push(child);
		}
		holders.push(`      - {person: m${g}, from: ${born + 20}, to: ${born + 45}}`);
	}
	if (count < size) throw new Error('house too small: ' + count);
	return `people:\n${lines.join('\n')}\n\ntitles:\n  - id: crown\n    name: Crown\n    holders:\n${holders.join('\n')}\n`;
}

describe('successionLine speed (D.2)', () => {
	const rows: string[] = [];
	const check = (label: string, g: FamilyGraph, title: Title, budget: number) => {
		for (const c of CASES) {
			const ms = time(g, title, specOf(c.spec));
			rows.push(`${label.padEnd(18)} ${c.name.padEnd(38)} ${ms.toFixed(2).padStart(8)} ms   (budget ${budget} ms, limit of the test ${budget * FACTOR} ms)`);
			expect(ms, `${label} ${c.name}`).toBeLessThan(budget * FACTOR);
		}
	};

	it('sample trees 07 and 07b: one title with a rule', () => {
		const g07b = graphOf(fixture('07b'));
		const first = g07b.titles[0];
		// Sample tree 07 has the same people and no titles: it gets the holders of the first title of 07b.
		const g07 = graphOf(fixture('07'));
		const title07: Title = { id: first.id, name: first.name, plural: first.plural, holders: first.holders, index: 0, items: first.holders.length };
		expect(g07.people.length).toBeGreaterThan(300);
		check('07 (' + g07.people.length + ' people)', g07, title07, BUDGET_SAMPLE_MS);
		check('07b', g07b, first, BUDGET_SAMPLE_MS);
		expect(successionLine(g07b, first, specOf({ rule: 'eldest-child' }), 5, 110).kind).toBe('line');
	});

	it('a generated house of 5 000 people', () => {
		const g = graphOf(bigHouse(5000, 100));
		expect(g.people.length).toBeGreaterThanOrEqual(5000);
		const title = g.titles[0];
		// Ruler: the last holder of the main line, so every ancestor is on the climb.
		const r = successionLine(g, title, specOf({ rule: 'eldest-child' }), 5, 110);
		expect(r.kind).toBe('line');
		expect(r.ruler).toBe('m99');
		check(`big (${g.people.length})`, g, title, BUDGET_BIG_MS);
	});

	it('prints the times', () => {
		console.log('\n' + rows.join('\n'));
		expect(rows.length).toBe(CASES.length * 3);
	});
});
