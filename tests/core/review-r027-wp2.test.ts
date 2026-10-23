// Code review of WP2 (0.2.7 succession engine and title keys). Each test is a proof of one finding; each fails on release-0.2.7 (03a8a1f).
import { describe, expect, it, vi } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionSpec } from '../../src/core/succession';
import * as keys from '../../src/core/succession-keys';
import { applyOp } from '../../src/core/yaml-edit';

// Count every call of `yearOf` (a pass-through), so the proofs of cost do not depend on the speed of the machine.
vi.mock('../../src/core/succession-keys', async (orig) => {
	const real = await orig<typeof import('../../src/core/succession-keys')>();
	return { ...real, yearOf: vi.fn(real.yearOf) };
});

const graphOf = (src: string): FamilyGraph => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return deriveFamilies(r.tree);
};
const yearOfCalls = () => vi.mocked(keys.yearOf).mock.calls.length;

describe('finding 1: the "old" check scans the whole tree once for each heir', () => {
	// Y is "now" (no year, no end of reign), so each heir with a born year makes `latestYear(g)` run again.
	const n = 300;
	const src = [
		'people:',
		'  - {id: r, name: R, sex: m, born: 1000}',
		...Array.from({ length: n }, (_, i) => `  - {id: c${i}, name: C${i}, sex: m, born: ${1010 + (i % 30)}, parents: [r]}`),
		'titles:',
		'  - id: duke',
		'  - name: Duke',
		'',
	].join('\n').replace('  - id: duke\n  - name: Duke', '  - id: duke\n    name: Duke\n    holders: [r]');

	it('costs the same number of year reads for 20 heirs as for 1 heir, plus a constant', () => {
		const g = graphOf(src);
		const t = g.titles[0];
		const spec: SuccessionSpec = { ...specOf(t), rule: 'eldest-child' };
		vi.mocked(keys.yearOf).mockClear();
		successionLine(g, t, spec, 1, 110);
		const one = yearOfCalls();
		vi.mocked(keys.yearOf).mockClear();
		successionLine(g, t, spec, 20, 110);
		const twenty = yearOfCalls();
		// One scan of the tree is about 2 * n reads (born and died of each person). Nineteen more heirs must not add nineteen scans.
		expect(twenty - one, `1 heir: ${one} reads, 20 heirs: ${twenty} reads`).toBeLessThan(2 * n);
	});
});

describe('finding 2: co-rulers are found with a loop inside a loop', () => {
	it('reads the years of the holders a number of times that grows with the holder count, not with its square', () => {
		const h = 400;
		const people = ['people:', ...Array.from({ length: h }, (_, i) => `  - {id: p${i}, name: P${i}, born: 1000}`)];
		const holders = Array.from({ length: h }, (_, i) => `      - {person: p${i}, from: 1200}`);
		const g = graphOf([...people, 'titles:', '  - id: duke', '    name: Duke', '    holders:', ...holders, ''].join('\n'));
		const t = g.titles[0];
		vi.mocked(keys.yearOf).mockClear();
		const res = successionLine(g, t, { ...specOf(t), rule: 'eldest-child' }, 5, 110);
		expect(res.coRulers.length).toBe(h - 1);
		expect(yearOfCalls(), `${h} holders, ${yearOfCalls()} year reads`).toBeLessThan(20 * h);
	});
});

describe('finding 3: leftOutNoSex counts people that the second pass of a house form includes', () => {
	const people = ['people:', '  - {id: r, name: R, sex: m, born: 1000}', '  - {id: c1, name: C1, sex: m, born: 1030, parents: [r]}', '  - {id: x, name: X, born: 1031, parents: [r]}'];
	const block = (inherit: string) => [...people, 'titles:', '  - id: duke', '    name: Duke', '    succession: eldest-child', `    inherit: ${inherit}`, '    holders: [r]', ''].join('\n');
	it('men-first-in-house puts the person with no sex in the line, so it leaves nobody out', () => {
		const g = graphOf(block('men-first-in-house'));
		const t = g.titles[0];
		const res = successionLine(g, t, specOf(t), 10, 110);
		expect(res.heirs).toEqual(['c1', 'x']);
		expect(res.leftOutNoSex).toBe(0);
	});
});

describe('finding 4: a comment on a list item is lost when the item is written with curly marks', () => {
	it('keeps "# dangling" when the list is moved', () => {
		const text = [
			'titles:',
			'  - id: duke',
			'    name: Duke',
			'    heir:',
			'      - “ghost” # dangling',
			'      - hugo',
			'    holders: [aldric]',
			'people:',
			'  - {id: aldric, name: Aldric}',
			'  - {id: hugo, name: Hugo}',
			'',
		].join('\n');
		const r = applyOp(text, { kind: 'edit-title', id: 'duke', heirs: ['hugo', 'ghost'] });
		// Either the comment stays or the edit is refused; it must not be dropped without a word.
		expect(r.ok ? r.body : 'refused').toMatch(/refused|# dangling/);
	});
});
