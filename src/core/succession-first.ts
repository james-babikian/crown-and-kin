/*
 * Two small readers of the holders of a title that the line of succession and the cadet hint share: the family world in the form
 * the spouse choice reads (spec §13.21 rule 13a), and the first holder (rule 14), which does not depend on the switch
 * "only descendants of the first holder".
 */

import { drawnParentMap, partnerOf, type FamilyGraph } from './derive';
import { resolveSpouse, type SpouseWorld } from './succession-keys';
import type { Holder } from './types';

/** The partners and the birth and adoptive parents of the family graph, in the form the partner choice reads (spec §13.21 rule 13a). */
export function spouseWorldOf(g: FamilyGraph): SpouseWorld {
	const drawn = drawnParentMap(g);
	return {
		partners: (id) =>
			(g.unionsOf.get(id) ?? []).map((key) => {
				const fu = g.unionByKey.get(key)!;
				return { id: partnerOf(fu, id), type: fu.type };
			}),
		claimParents: (id) => [...new Set((drawn.get(id) ?? []).filter((d) => d.type === 'birth' || d.type === 'adoptive').map((d) => d.id))],
		exists: (id) => g.byId.has(id),
	};
}

/**
 * The first holder (spec §13.21 rule 14): the first entry, in list order, whose person is in the tree; D195: its spouse if
 * the entry has the key and the spouse can be chosen. It does not depend on the switch "only descendants", so the hint of the
 * Titles window can name the first holder while the switch is off. `spouseAt` is the spouses that the line already chose.
 */
export function firstHolderOf(g: FamilyGraph, entries: readonly Holder[], spouseAt?: ReadonlyMap<number, string>): { index: number; id: string } | null {
	const index = entries.findIndex((e) => e.person !== undefined && g.byId.has(e.person));
	if (index < 0) return null;
	const entry = entries[index];
	const person = entry.person!;
	let spouse = spouseAt?.get(index);
	if (!spouseAt && entry.throughSpouse !== undefined) {
		const holderIds = entries.flatMap((h) => (h.person !== undefined && g.byId.has(h.person) ? [h.person] : []));
		const s = resolveSpouse(spouseWorldOf(g), person, entry.throughSpouse, holderIds);
		if (s.ok) spouse = s.id;
	}
	return { index, id: spouse ?? person };
}
