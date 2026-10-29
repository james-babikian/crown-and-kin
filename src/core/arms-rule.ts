/**
 * The "Arms on cards" rule (D206): which cards show arms. One function, `armsCardIds`, serves the cards of the layout
 * and the saved picture, so both show the same set. The phone list does not use it (D209 item 6: only its top row shows arms). The rule needs only the graph.
 */
import { drawnParents, type FamilyGraph } from './derive';

/** The two values of the setting "Arms on cards": the few people of D206, or every card that has arms. */
type ArmsMode = 'few' | 'all';

/**
 * The ids of the people whose card shows arms, house arms or personal arms. A person with personal arms is always in the set. With `'all'`,
 * so is every person who has a house. With `'few'` (D206) a person with a house is in the set when
 * (1) no birth or adoptive parent of the person has the same house (the first of the house in the tree, a founder of a cadet branch too;
 *     a parent id that names nobody, a rumoured parent and a ward parent do not count), or
 * (2) the person is the `person` of a holder entry of any title in the `titles` list (the free `title` text of a person does not count).
 * A partnership has no effect. The set says who may show arms; the caller still checks that the arms exist and that the picture loads.
 */
export function armsCardIds(g: FamilyGraph, mode: ArmsMode): Set<string> {
	const out = new Set<string>();
	for (const p of g.people) if (p.arms) out.add(p.id);
	if (mode === 'all') {
		for (const p of g.people) if (p.house !== undefined) out.add(p.id);
		return out;
	}
	const holders = new Set<string>();
	for (const t of g.titles) for (const h of t.holders) if (h.person !== undefined) holders.add(h.person);
	for (const p of g.people) {
		if (p.house === undefined) continue;
		const sameHouseParent = drawnParents(g, p.id).some((q) => (q.type === 'birth' || q.type === 'adoptive') && g.byId.get(q.id)?.house === p.house);
		if (!sameHouseParent || holders.has(p.id)) out.add(p.id);
	}
	return out;
}
