// WP-Q (T.1, U7): a start that differs by round-off size (1e-11 px) must not move a card by more than 1e-9 px. Before the tie fix
// the dot side was `other.x >= anchor.x`, and ties are common, so round-off alone flipped a dot to the other side and moved cards.
// Run again after the placement step (U7): the step adds comparisons, and none of them may turn round-off into a visible move.
import { describe, expect, it } from 'vitest';
import { layoutFamilies } from '../src/layout/layout';
import { NORMAL_GEOMETRY } from '../src/layout/geometry';
import { build } from './helpers';
import { randomTree } from './random-trees';
import type { LayoutSettings } from '../src/layout/model';

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

describe('tie fix: round-off in the start does not move cards', () => {
	for (const orientation of [undefined, 'sideways' as const]) {
		it(`1 000 random trees, ${orientation ?? 'down'}`, () => {
			const bad: string[] = [];
			const extra = orientation ? { orientation } : {};
			for (let s = 1; s <= 1000; s++) {
				const { g, gen, order } = build(randomTree(s));
				const packed = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 0, far: FAR, ...extra } as LayoutSettings);
				const centre = (b: { x: number; y: number; w: number; h: number }) => (orientation ? b.y + b.h / 2 : b.x + b.w / 2);
				const init = new Map([...packed.persons].map(([id, b]) => [id, centre(b)]));
				let k = 0;
				const noisy = new Map([...init].map(([id, x]) => [id, x + 1e-11 * (((k++ * 7919) % 13) - 6)]));
				const a = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far: FAR, ...extra }, init);
				const b = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far: FAR, ...extra }, noisy);
				let worst = 0;
				for (const [id, p] of a.persons) {
					const q = b.persons.get(id)!;
					worst = Math.max(worst, Math.abs((orientation ? p.y : p.x) - (orientation ? q.y : q.x)));
				}
				if (worst > 1e-9) bad.push(`seed ${s}: ${worst.toExponential(2)} px`);
			}
			expect(bad.slice(0, 10), `${bad.length} of 1000 trees`).toEqual([]);
		});
	}
});
