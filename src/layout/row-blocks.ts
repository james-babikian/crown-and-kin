/**
 * The blocks as they are drawn and their rows (spec §5.1): `consistentRows` takes the model order's blocks and splits a married-in member who cannot share the
 * row of their block. `layout/layout.ts` calls it and re-exports it.
 */
import { placedChildren, type FamilyGraph } from '../core/derive';

/**
 * Rows the lines can rely on: each block sits exactly one row below the lower placement parent
 * of its member with parents, and no row is empty. Generations from `core/generations` already
 * satisfy this, except when its iteration stops without settling (for example a founder who
 * marries his own granddaughter); then a trunk would cross rows or point upwards. A married-in
 * member who cannot share the row of their block (they are its ancestor) leaves the block.
 */
export function consistentRows(g: FamilyGraph, coreGen: Map<string, number>, modelBlocks: string[][]): { gen: Map<string, number>; blocks: string[][] } {
	// M10 (F2): `coreGen` can hold people that folds hide; they must not keep a row empty. The generations of the shown people stay.
	if (coreGen.size !== g.people.length) coreGen = new Map([...coreGen].filter(([id]) => g.byId.has(id)));
	const hasParents = (p: string) => g.placementParents.get(p)!.length > 0;
	const isAncestor = (a: string, of: string) => {
		const seen = new Set<string>();
		const stack = [a];
		while (stack.length) {
			for (const c of placedChildren(g, stack.pop()!)) {
				if (c === of) return true;
				if (!seen.has(c)) {
					seen.add(c);
					stack.push(c);
				}
			}
		}
		return false;
	};
	const split = (keep: (block: string[], p: string) => boolean) =>
		modelBlocks.flatMap((b) => {
			const stay = b.filter((p) => keep(b, p));
			return [...(stay.length ? [stay] : []), ...b.filter((p) => !keep(b, p)).map((p) => [p])];
		});
	const settle = (blocks: string[][]) => {
		const gen = new Map(coreGen);
		for (let pass = 0; pass <= blocks.length; pass++) {
			let changed = false;
			for (const block of blocks) {
				const blood = block.find(hasParents);
				const want = blood === undefined ? gen.get(block[0])! : Math.max(...g.placementParents.get(blood)!.map((p) => gen.get(p)!)) + 1;
				for (const p of block) {
					if (gen.get(p) !== want) {
						gen.set(p, want);
						changed = true;
					}
				}
			}
			if (!changed) return gen;
		}
		return undefined;
	};
	let blocks = split((b, p) => {
		const blood = b.find(hasParents);
		return blood === undefined || p === blood || !isAncestor(p, blood);
	});
	let gen = settle(blocks);
	if (!gen) {
		// Rare loops through two marriages: every married-in member stands alone.
		blocks = split((b, p) => hasParents(p) || b.length === 1);
		gen = settle(blocks)!;
	}
	const dense = new Map([...new Set(gen.values())].sort((a, b) => a - b).map((v, i) => [v, i]));
	for (const [id, v] of gen) gen.set(id, dense.get(v)!);
	return { gen, blocks };
}
