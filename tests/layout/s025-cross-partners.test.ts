// 0.2.5 WP-A2 (D142, fix A): a man with two partners must not make the lines of his children's groups cross. When the one
// married-in spouse of a woman is a man with more partners, his partners stand in the order of his unions. Made-up trees only.
import { describe, expect, it } from 'vitest';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { measureLayout } from '../../scripts/metrics';
import { build } from '../support/helpers';
import { CROSS_TWIN } from '../support/s025-cross-twin';

function lay(src: string) {
	const { g, gen, order } = build(src);
	const { layout } = arrangeTree(g, gen, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
	return { g, layout, order, metrics: measureLayout(g, layout) };
}
const mid = (l: ReturnType<typeof lay>, id: string) => l.layout.persons.get(id)!.x + l.layout.persons.get(id)!.w / 2;

const ARNE_BERIT = '  - {partners: [arne, berit], type: marriage}\n';
const ARNE_EDDA = '  - {partners: [arne, edda], type: marriage}\n';
const ARNE_ULLA = '  - {partners: [arne, ulla], type: marriage}\n';

/** The twin with a third wife, ulla (a free root with a son knut); `wives` is the order of arne's unions in the list. */
function threeWives(wives: ('berit' | 'edda' | 'ulla')[]) {
	const line = { berit: ARNE_BERIT, edda: ARNE_EDDA, ulla: ARNE_ULLA };
	const people = [
		'  - {id: ulla, name: Ulla Strand, sex: f, born: 738}\n',
		'  - {id: knut, name: Knut Fir, house: fir, sex: m, born: 760, parents: [arne, ulla]}\n',
	].join('');
	return CROSS_TWIN.replace('\nunions:', people + '\nunions:').replace(ARNE_BERIT + ARNE_EDDA, wives.map((w) => line[w]).join(''));
}

describe('a man with two partners (D142 fix A)', () => {
	it('no two descent lines of the same row cross', () => {
		expect(lay(CROSS_TWIN).metrics.crossings).toBe(0);
	});

	it('the partner of the first union stands left of the man, the partner of the second union right of him; both unions are bars', () => {
		const l = lay(CROSS_TWIN);
		expect(mid(l, 'berit')).toBeLessThan(mid(l, 'arne'));
		expect(mid(l, 'arne')).toBeLessThan(mid(l, 'edda'));
		for (const fu of l.g.unions.filter((u) => u.partners.includes('arne'))) expect(l.layout.unions.get(fu.key)!.bar).toBe(true);
	});

	it('the children groups follow the order of the unions (spec 4.3)', () => {
		const l = lay(CROSS_TWIN);
		expect(mid(l, 'finn')).toBeLessThan(mid(l, 'gerd'));
	});

	it('siblings keep the entered order', () => {
		expect(lay(CROSS_TWIN).metrics.siblingOrderViolations).toBe(0);
	});

	it('the block order is berit, arne, edda', () => {
		const block = build(CROSS_TWIN).order.blocks.find((b) => b.includes('arne'))!;
		expect(block).toEqual(['berit', 'arne', 'edda']);
	});

	it('when the wife\'s union is the last one, the row is as before: the earlier partner, the man, then the wife', () => {
		const swapped = CROSS_TWIN.replace(ARNE_BERIT + ARNE_EDDA, ARNE_EDDA + ARNE_BERIT);
		const block = build(swapped).order.blocks.find((b) => b.includes('arne'))!;
		expect(block).toEqual(['edda', 'arne', 'berit']);
	});

	describe('three partners (known limit: only the case that the blood wife is first is solved)', () => {
		it('berit, edda, ulla: no crossing', () => {
			expect(lay(threeWives(['berit', 'edda', 'ulla'])).metrics.crossings).toBe(0);
		});

		it('berit, ulla, edda: no crossing', () => {
			expect(lay(threeWives(['berit', 'ulla', 'edda'])).metrics.crossings).toBe(0);
		});

		it('the other four orders are never worse than the two crossings that they had before the fix', () => {
			for (const wives of [
				['edda', 'berit', 'ulla'],
				['edda', 'ulla', 'berit'],
				['ulla', 'berit', 'edda'],
				['ulla', 'edda', 'berit'],
			] as const) expect(lay(threeWives([...wives])).metrics.crossings).toBeLessThanOrEqual(2);
		});
	});
});
