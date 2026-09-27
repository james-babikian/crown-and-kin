import type { FamilyGraph } from '../core/derive';
import type { ModelOrder } from '../core/order';

/** The children a block's walk reached through one of its unions, or through one member alone. */
interface Group {
	key: string;
	union?: string;
	solo?: string;
	blocks: number[];
}

/**
 * The model order's blocks, with each person's single-parent family moved to that person's
 * outer side of the couple families of their block (WP3.4). The model order puts a person's
 * single-parent children after all their couple children, so for the left partner of a couple
 * the line from their card crossed the couple's trunk.
 *
 * Only whole subtrees move, and only single-parent families: the couple families of a block keep
 * the order of their unions (spec §4.3), and every family keeps its own sibling order (D2). The
 * spec fixes no order between a person's couple families and their single-parent family.
 *
 * Each family is given the x its line leaves the block from, in card slots: a member's own slot
 * for a single-parent family, halfway between two partners in the block, or a quarter slot beside
 * the anchor towards a partner outside the block (whose side is guessed from the walk: earlier
 * blocks are to the left). A single-parent family goes to the place among the couple families
 * where the fewest of them are on the wrong side of it; on a tie, where the fewest of the
 * person's own couple families are, then the one furthest right. So a left partner's
 * single-parent children go left of the couple's children, a right partner's go right, and a
 * person between two spouses has them between the two marriages' children.
 */
export function soloFamiliesOutside(g: FamilyGraph, order: ModelOrder): string[][] {
	const blocks = order.blocks;
	const blockOf = new Map<string, number>();
	const slot = new Map<string, number>();
	blocks.forEach((b, i) =>
		b.forEach((p, j) => {
			blockOf.set(p, i);
			slot.set(p, j);
		}),
	);
	const soloParent = new Map<string, string>();
	for (const [p, kids] of g.soloChildren) for (const k of kids) soloParent.set(k, p);

	// The walk that built the order: each block was reached from the block of the parent whose
	// family visited it first (a union's anchor, or the single parent).
	const groups: Group[][] = blocks.map(() => []);
	const roots: number[] = [];
	let moves = false;
	blocks.forEach((b, i) => {
		const head = b.find((p) => (g.placementParents.get(p) ?? []).length > 0);
		const solo = head === undefined ? undefined : soloParent.get(head);
		const union = head === undefined || solo !== undefined ? undefined : g.primaryUnion.get(head);
		const from = solo ?? (union === undefined ? undefined : order.anchors.get(union));
		const parent = from === undefined ? undefined : blockOf.get(from);
		if (parent === undefined || parent >= i) {
			roots.push(i);
			return;
		}
		const key = solo !== undefined ? `s|${solo}` : `u|${union}`;
		let group = groups[parent].find((x) => x.key === key);
		if (!group) {
			group = { key, union, solo, blocks: [] };
			groups[parent].push(group);
			if (solo !== undefined) moves = true;
		}
		group.blocks.push(i);
	});
	if (!moves) return blocks;

	const arrange = (bi: number): Group[] => {
		const list = groups[bi];
		const couples = list.filter((x) => x.union !== undefined);
		const solos = list.filter((x) => x.solo !== undefined);
		if (!couples.length || !solos.length) return [...couples, ...solos.sort((a, b) => slot.get(a.solo!)! - slot.get(b.solo!)!)];
		const from = couples.map((x) => {
			const [a, b] = g.unionByKey.get(x.union!)!.partners;
			if (blockOf.get(a) === bi && blockOf.get(b) === bi) return (slot.get(a)! + slot.get(b)!) / 2;
			const [inside, outside] = blockOf.get(a) === bi ? [a, b] : [b, a];
			return slot.get(inside)! + ((blockOf.get(outside) ?? Infinity) < bi ? -0.25 : 0.25);
		});
		const place = new Map<Group, number>();
		for (const s of solos) {
			const x = slot.get(s.solo!)!;
			const own = couples.map((c) => g.unionByKey.get(c.union!)!.partners.includes(s.solo!));
			let best = 0;
			let bestCost = [Infinity, Infinity];
			for (let k = 0; k <= couples.length; k++) {
				// Crossings with all couple families first, then with the person's own.
				const cost = [0, 0];
				from.forEach((f, i) => {
					if (i < k ? f > x : f < x) {
						cost[0]++;
						if (own[i]) cost[1]++;
					}
				});
				if (cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] <= bestCost[1])) {
					best = k;
					bestCost = cost;
				}
			}
			place.set(s, best);
		}
		const out: Group[] = [];
		for (let k = 0; k <= couples.length; k++) {
			out.push(...solos.filter((s) => place.get(s) === k).sort((a, b) => slot.get(a.solo!)! - slot.get(b.solo!)!));
			if (k < couples.length) out.push(couples[k]);
		}
		return out;
	};

	// Pre-order walk without recursion: a line of descent can be very long.
	const walk = (arrangeGroups: (bi: number) => Group[]) => {
		const out: string[][] = [];
		const stack = [...roots].reverse();
		while (stack.length) {
			const bi = stack.pop()!;
			out.push(blocks[bi]);
			const next = arrangeGroups(bi).flatMap((x) => x.blocks);
			for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
		}
		return out;
	};
	// Safety net: the walk above rebuilds core/order's walk from its result. If that ever fails to give
	// back the model order (a case its rules do not foresee), keep the model order unchanged.
	if (walk((bi) => groups[bi]).some((b, i) => b !== blocks[i])) return blocks;
	return walk(arrange);
}
