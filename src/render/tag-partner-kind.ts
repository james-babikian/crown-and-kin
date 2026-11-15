/*
 * The kind line under a name in the partner list of a several-partner name tag (D355). The tag has no sign, so this list is the
 * only place on the tree that shows the kind. It reads the whole tree, so a partner that a fold hides is named like any other.
 */

import { partnerOf, type FamilyGraph, type FamilyUnion } from '../core/derive';
import { unionKindsText } from './sheet-text';

/** The kinds of every union of `person` with `partner`, in `unionsOf` order of `whole`: "Marriage", "Betrothal, Marriage". */
export function tagPartnerKind(whole: FamilyGraph, person: string, partner: string): string {
	const unions = (whole.unionsOf.get(person) ?? []).map((k) => whole.unionByKey.get(k)).filter((fu): fu is FamilyUnion => fu !== undefined && partnerOf(fu, person) === partner);
	return unionKindsText(unions);
}
