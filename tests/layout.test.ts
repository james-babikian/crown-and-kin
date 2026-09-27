import { describe, expect, it } from 'vitest';
import { NORMAL_GEOMETRY } from '../src/layout/geometry';
import { DEFAULT_FAR_RULE, layoutFamilies } from '../src/layout/layout';
import { measureLayout } from '../scripts/metrics';
import { placeInOrder } from '../src/layout/pava';
import { build, fixture } from './helpers';

describe('placeInOrder', () => {
	it('keeps targets that already satisfy the gaps', () => {
		expect(placeInOrder([0, 100, 300], [0, 50, 50])).toEqual([0, 100, 300]);
	});
	it('spreads colliding items symmetrically', () => {
		expect(placeInOrder([100, 100], [0, 50])).toEqual([75, 125]);
	});
});

describe('layoutFamilies (custom placement)', () => {
	const lay = (f: string) => {
		const { g, gen, order } = build(fixture(f));
		const layout = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
		return { g, layout };
	};

	for (const f of ['01', '02', '03', '04', '06', '07', '08', '11']) {
		it(`fixture ${f}: every person once, no overlaps, siblings in order`, () => {
			const { g, layout } = lay(f);
			expect(layout.persons.size).toBe(g.people.length);
			for (const row of layout.rows) {
				for (let i = 1; i < row.length; i++) {
					const a = layout.persons.get(row[i - 1])!;
					const b = layout.persons.get(row[i])!;
					expect(b.x).toBeGreaterThanOrEqual(a.x + a.w + NORMAL_GEOMETRY.nodeGap - 0.01);
				}
			}
			expect(measureLayout(g, layout).siblingOrderViolations).toBe(0);
		});
	}

	it('fixture 2: all three wives sit beside Edmund, each marriage with its children', () => {
		const { g, layout } = lay('02');
		const row = layout.rows[1];
		const i = row.indexOf('edmund');
		expect(row.slice(i - 1, i + 3)).toEqual(['agnes', 'edmund', 'beatrix', 'clarice']);
		const unions = g.unionsOf.get('edmund')!.map((k) => g.unionByKey.get(k)!);
		expect(unions.map((u) => u.children.length)).toEqual([2, 1, 2]);
	});

	it('fixture 11: a brother and sister who marry sit side by side with a marriage bar', () => {
		const { g, layout } = lay('11');
		const key = g.unionsOf.get('varian')!.find((k) => g.unionByKey.get(k)!.partners.includes('yseult'))!;
		expect(layout.unions.get(key)!.bar).toBe(true);
		expect(layout.persons.get('osric')!.gen).toBe(3);
	});

	it('fixture 8: the adopted heir sits under his adoptive parents', () => {
		const { layout } = lay('08');
		const tomas = layout.persons.get('tomas')!;
		const aldric = layout.persons.get('aldric')!;
		const isolde = layout.persons.get('isolde')!;
		const between = (aldric.x + isolde.x + isolde.w) / 2;
		expect(Math.abs(tomas.x + tomas.w / 2 - between)).toBeLessThan(tomas.w);
	});
});
