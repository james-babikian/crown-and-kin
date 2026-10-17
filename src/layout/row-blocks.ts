/**
 * The blocks as they are drawn and their rows (spec §5.1): `consistentRows` gives the plan stage the rows of the shown people and the model order's blocks.
 * `plan.ts` calls it for every skeleton it builds.
 */
import type { FamilyGraph } from '../core/derive';

/**
 * The rows of the shown people, numbered without gaps, and the walk's blocks. The generations of `core/generations` already put every person with
 * placement parents exactly one row below the lower of them (spec §5.1 step 1), and the walk joins only people of one row in a block (`core/order.ts`),
 * so nothing is moved here (assumption A17 of the architecture notes §4.2.5, an internal test).
 */
export function consistentRows(g: FamilyGraph, coreGen: Map<string, number>, modelBlocks: string[][]): { gen: Map<string, number>; blocks: string[][] } {
	// M10 (F2): `coreGen` can hold people that folds hide; they must not keep a row empty. The generations of the shown people stay.
	const gen = coreGen.size !== g.people.length ? new Map([...coreGen].filter(([id]) => g.byId.has(id))) : new Map(coreGen);
	const dense = new Map([...new Set(gen.values())].sort((a, b) => a - b).map((v, i) => [v, i]));
	for (const [id, v] of gen) gen.set(id, dense.get(v)!);
	return { gen, blocks: modelBlocks.map((b) => [...b]) };
}
