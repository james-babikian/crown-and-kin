/**
 * Milestone 5 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Focus mode (spec §5.6, D3, D18). `focus-subgraph.ts` implements `FocusSubgraph` (WP5.1).
 * The pin (D18) needs no new op: `SetOption { key: 'focus' }` in `edit.ts` writes and removes
 * `options.focus`.
 */
import type { Tree, TreeOptions } from './types';

/** Focus mode default generations (spec §9); `options.generations` overrides it per tree. */
export const DEFAULT_FOCUS_GENERATIONS = 3;

/**
 * Who is in the focus family of `focus` with `n` generations (spec §5.6):
 * - the focus person;
 * - their siblings: every other child of any of the focus person's parents (any parent type);
 * - ancestors: parents through any parent type, up to `n` generations above the focus person;
 * - descendants: children through any parent type, up to `n` generations below;
 *   (the four groups above are the "core")
 * - the partners of every core person in a listed union of any type (one step);
 * - the placement parents of every core person who has at least one parent (any type) in the
 *   family before this step (core plus listed partners): both placement parents that `deriveFamilies` uses for that person are added,
 *   so a shown child is drawn where the whole tree draws it (never under one parent of a couple,
 *   never under a secondary parent). This is how implicit co-parents come in: only through a
 *   shared child who is shown. One pass; the added people's own relatives are not added.
 * Nobody else. Partners of partners are not added. Siblings do not depend on `n` (at `n` = 0:
 * the focus person, siblings and their listed partners). Ids that name no person are ignored
 * everywhere (not added, not counted).
 */
export interface FocusSubgraphResult {
	/**
	 * A tree with only the focus family, ready for `deriveFamilies` and layout:
	 * - `people` keeps the original order and `index` values (sibling order, D2);
	 * - parent links (one rule for everybody, core or not): let P be the placement parents that
	 *   `deriveFamilies` uses for the person in the whole tree. If P is not empty and all of P are
	 *   inside, the person keeps every parent link that the whole tree draws (after cycle breaking)
	 *   to a parent inside. If P is empty, the person keeps the drawn links to parents inside
	 *   (rumoured lines only). Otherwise the person has no parents in the subgraph (drawn as a
	 *   root). So everybody is placed exactly as in the whole tree, or not under anyone; a link
	 *   the whole tree does not draw (dropped to break a cycle) is never drawn;
	 * - `unions` keeps only unions whose partners are all inside it, as the original objects
	 *   with their original `index` (edits from a focus view address the right union);
	 * - `houses` unchanged; `options` unchanged except `start`, which is the focus id;
	 * - `issues` is empty: the whole tree's issues are shown, not the subgraph's.
	 */
	tree: Tree;
	/**
	 * For each person in the focus family: the number of direct relatives (parent, child or
	 * partner, implicit co-parents included) whose relation the subgraph does not draw, because
	 * the relative is outside the family or a drawn parent link was dropped by the rule above (a
	 * link the whole tree does not draw either, for example after cycle breaking, never counts;
	 * with duplicate ids the first entry wins, as in `deriveFamilies`). These
	 * cards get the `+` badge (§5.6). People with no such relative are absent from the map.
	 */
	hidden: Map<string, number>;
}

/**
 * `n` for a tree (spec §5.6, §9): `options.generations` if it is a whole number ≥ 0, else the
 * setting if it is one, else `DEFAULT_FOCUS_GENERATIONS`.
 */
export type FocusGenerationsFor = (options: TreeOptions, setting?: number) => number;

/**
 * The focus family of `focus` with `n` generations up and down (`n` ≥ 0; a non-integer or
 * negative `n` counts as `DEFAULT_FOCUS_GENERATIONS`). Returns `null` if no person has the id
 * `focus`. Pure and deterministic; never throws (spec §8), also for parent cycles and dangling ids.
 */
export type FocusSubgraph = (tree: Tree, focus: string, n: number) => FocusSubgraphResult | null;
