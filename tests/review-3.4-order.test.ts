import { describe, expect, it } from 'vitest';
import { soloFamiliesOutside } from '../src/layout/solo-side';
import { build } from './helpers';
import { randomTree } from './random-trees';

// Review 3.4 scratch: blocks outside single-parent subtrees keep the model order exactly.
const N = Number(process.env.RANDOM_TREES ?? 400);
describe('review 3.4 scratch: order', () => {
	it('couple families and their subtrees keep the model order', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= N; seed++) {
			const { g, order } = build(randomTree(seed));
			const out = soloFamiliesOutside(g, order);
			const blockOf = new Map<string, number>();
			order.blocks.forEach((b, i) => b.forEach((p) => blockOf.set(p, i)));
			const soloParent = new Map<string, string>();
			for (const [p, kids] of g.soloChildren) for (const k of kids) soloParent.set(k, p);
			const inSolo = (i: number): boolean => {
				const head = order.blocks[i].find((p) => (g.placementParents.get(p) ?? []).length > 0);
				if (head === undefined) return false;
				if (soloParent.has(head)) return true;
				const u = g.primaryUnion.get(head);
				const from = u === undefined ? undefined : order.anchors.get(u);
				const pb = from === undefined ? undefined : blockOf.get(from);
				return pb !== undefined && pb < i && inSolo(pb);
			};
			const keep = new Set(order.blocks.filter((_, i) => !inSolo(i)));
			const a = order.blocks.filter((b) => keep.has(b));
			const b = out.filter((x) => keep.has(x));
			if (a.some((x, i) => x !== b[i])) bad.push(`seed ${seed}`);
			// Deterministic.
			expect(soloFamiliesOutside(g, order)).toEqual(out);
		}
		expect(bad).toEqual([]);
	});
});
