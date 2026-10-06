/*
 * Finds the men who are only a rumoured parent (spec §5.1 step 1, D140 "a lone rumoured parent"). The rows step puts such a
 * man in the row of his child's lower placement parent, and the order step seats him beside that parent. Both ask this
 * module, so that they agree on who is lone.
 */

import { placedChildren, type FamilyGraph } from './derive';

/**
 * The lone rumoured parents of a tree, each with the children he is a rumoured parent of (in `g.secondary` order). A person is
 * lone when he has no placement parent, no partner and no placed child, and the child has at least one placement parent.
 */
export function loneRumouredRoots(g: FamilyGraph): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const e of g.secondary) {
		if (e.type !== 'rumoured') continue;
		if (!g.placementParents.get(e.child)?.length) continue;
		for (const p of e.parents) {
			if (!g.placementParents.has(p) || g.placementParents.get(p)!.length || (g.unionsOf.get(p) ?? []).length || placedChildren(g, p).length) continue;
			const kids = out.get(p);
			if (kids) kids.push(e.child);
			else out.set(p, [e.child]);
		}
	}
	return out;
}
