// The line of a couple that leaves its own card's bottom edge starts under that card's tag (a sideways tag stands over the start of the line to a
// partner stacked below, D344 1 A). The line checkers of the tag rule (a line never runs through a tag) let this one line pass, but only while the
// couple's dot stays clear below the pill (`OWN_STACK_DOT_CLEAR`): a dot under the pill would hide the partnership sign.
import { tagTop } from '../../src/layout/geometry';
import type { EdgePath, FarTag, TreeLayout } from '../../src/layout/model';

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** px: how far below the foot of the tag pill the top of the couple's dot must stay for the line under the tag to pass (9 px at 16 px, D344 1 A). */
export const OWN_STACK_DOT_CLEAR = 8;

/** True when one of `segs` is a vertical stretch that starts at the bottom edge `bottom` of the tag's card, within `slack`. */
export function startsAtCardBottom(segs: readonly Seg[], bottom: number, slack = 0.5): boolean {
	return segs.some((s) => Math.abs(s.x1 - s.x2) <= slack && Math.abs(Math.min(s.y1, s.y2) - bottom) <= slack);
}

/**
 * Sideways: true when the couple line `p` (its straight pieces `segs`) of the tag's person starts at the bottom edge of the tag's card, and the dot of
 * its union lies at least `OWN_STACK_DOT_CLEAR` below the pill. A line with no union point never passes.
 */
export function ownStackLine(layout: TreeLayout, tag: FarTag, p: EdgePath, segs: readonly Seg[]): boolean {
	const card = layout.persons.get(tag.person);
	const u = p.union === undefined ? undefined : layout.unions.get(p.union);
	if (layout.orientation !== 'sideways' || !card || !u || !p.people.includes(tag.person)) return false;
	if (!startsAtCardBottom(segs, card.y + card.h)) return false;
	const geo = layout.geometry;
	return u.y - geo.unionSize / 2 - (tagTop(geo, tag.y) + geo.tagH) >= OWN_STACK_DOT_CLEAR - 1e-6;
}
