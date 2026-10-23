import { describe, expect, it } from 'vitest';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { build } from '../support/helpers';
import { randomTree } from '../support/random-trees';

// Review 3.4 scratch: the cards of a row keep the model order exactly.
// WP-4b (class c, D239/D243): this test once proved that the blocks outside single-parent subtrees kept the model order, because
// `soloFamiliesOutside` (solo-side.ts, deleted at the switch) moved the families of one parent alone. Since W3 the walk itself puts those families
// in their place (`familyOrder`), so the claim is now whole: in every row the cards stand left to right in the order of the walk, with no exception.
const N = Number(process.env.RANDOM_TREES ?? 400);
describe('review 3.4 scratch: order', () => {
	it('the cards of every row stand in the order of the walk, single-parent families included', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= N; seed++) {
			const { g, gen, order } = build(randomTree(seed));
			const place = new Map<string, number>();
			order.items.forEach((item, k) => {
				if (item.kind === 'person') place.set(item.id, k);
			});
			const { layout } = arrangeTree(g, gen, NORMAL_GEOMETRY, { sweeps: 4, far: DEFAULT_FAR_RULE });
			for (const row of layout.rows) {
				const asWalked = [...row].sort((a, b) => place.get(a)! - place.get(b)!);
				if (row.some((id, i) => id !== asWalked[i])) bad.push(`seed ${seed}: ${row.join()} against ${asWalked.join()}`);
			}
		}
		expect(bad.slice(0, 5), `${bad.length} of ${N} trees`).toEqual([]);
	});
});
