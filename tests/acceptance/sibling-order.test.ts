import { describe, expect, it } from 'vitest';
import { allFixtures, fixtureSource } from './load';
import { layOut } from './pipeline';
import { specModel } from './spec-model';

// D2 and spec §4.3: siblings appear left to right in `people` order, per primary union or
// single placement parent. The groups come from the spec rules (spec-model.ts), not from derive.

describe('sibling order in every fixture: D2, spec §4.3, §5.1 step 3', () => {
	for (const f of allFixtures()) {
		it(`fixture ${f.id}: siblings' x positions increase in document order`, () => {
			const { tree, layout } = layOut(f.source);
			const model = specModel(tree);
			let checked = 0;
			for (const [family, kids] of model.families) {
				if (kids.length < 2) continue;
				const xs = kids.map((k) => layout.persons.get(k)!.x);
				for (let i = 1; i < xs.length; i++) {
					expect(xs[i], `${family}: ${kids[i - 1]} before ${kids[i]}`).toBeGreaterThan(xs[i - 1]);
				}
				checked++;
			}
			if (['01', '02', '03', '04', '05', '06', '07', '08', '09', '11'].includes(f.id)) expect(checked).toBeGreaterThan(0);
		});
	}
});

describe('children of several unions follow the union order: spec §4.3', () => {
	it("fixture 2: Agnes's children, then Beatrix's, then Clarice's", () => {
		const { layout } = layOut(fixtureSource('02'));
		const x = (id: string) => layout.persons.get(id)!.x;
		const groups = [['hugo', 'maud'], ['piers'], ['sybil', 'osric']];
		for (let i = 1; i < groups.length; i++) {
			expect(Math.min(...groups[i].map(x))).toBeGreaterThan(Math.max(...groups[i - 1].map(x)));
		}
	});
});
