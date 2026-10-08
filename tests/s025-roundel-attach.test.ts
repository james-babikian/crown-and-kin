// 0.2.5 WP-B1 (CONTRACT B.3.5, B.5 test 9): the placement attaches a child by its AXIS (0.25 em right of the card middle in the Roundel),
// so a single child still hangs straight under its parents. The test compares two layouts of one tree under the same row code (it hard-codes no count).
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardForm, childAttach, geometryFor, roundelAxis } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import { sampleSources } from './acceptance/m11-support';

describe('childAttach', () => {
	it('is 0.25 em for the Roundel and 0 for every other form', () => {
		for (const f of [12, 16]) {
			const normal = geometryFor(f);
			expect(childAttach(cardForm(normal, 'down'))).toBeCloseTo(0.25 * f, 9);
			expect(childAttach(cardForm(normal, 'down'))).toBeCloseTo(roundelAxis(normal) - normal.cardW / 2, 9);
			expect(childAttach(normal)).toBe(0);
			expect(childAttach(cardForm(normal, 'sideways'))).toBe(0);
		}
	});
});

function straightDrops(f: number, roundel: boolean) {
	let straight = 0;
	let total = 0;
	let width = 0;
	for (const s of sampleSources()) {
		const parsed = parseDynasty(s.source);
		if (!parsed.ok) continue;
		const g = deriveFamilies(parsed.tree);
		clearLayoutCache();
		const geo = roundel ? cardForm(geometryFor(f), 'down') : geometryFor(f);
		const L = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS }, 'font').layout;
		width += L.width;
		const attach = roundel ? 0.25 * f : 0;
		for (const fu of g.unions) {
			if (fu.children.length !== 1) continue;
			const c = L.persons.get(fu.children[0])!;
			const u = L.unions.get(fu.key)!;
			total++;
			if (Math.abs(u.x - (c.x + c.w / 2 + attach)) < 0.5) straight++;
		}
	}
	return { straight, total, width };
}

describe('children are attached by their axis (B.3.5)', () => {
	for (const f of [12, 16]) {
		it(`${f} px: at least as many one-child drops are straight to the axis as were straight to the middle; width grows by less than 1 %`, () => {
			const before = straightDrops(f, false);
			const after = straightDrops(f, true);
			expect(before.straight, 'the sample trees have straight one-child drops').toBeGreaterThan(0);
			expect(after.total).toBe(before.total);
			expect(after.straight).toBeGreaterThanOrEqual(before.straight);
			expect(after.width).toBeLessThan(before.width * 1.01);
		});
	}

	it('a plain geometry (no form) has no attach and no reach', () => {
		const s = sampleSources().find((x) => x.id === '07')!;
		const parsed = parseDynasty(s.source);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		clearLayoutCache();
		const classic = layoutTree(g, geometryFor(12), { ...DEFAULT_LAYOUT_SETTINGS }, 'font').layout;
		expect(Math.min(...[...classic.persons.values()].map((p) => p.y))).toBe(0);
		expect(classic.geometry.reach).toBeUndefined();
	});
});
