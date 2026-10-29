/**
 * Decides which far-couple tags (spec D10) show a partnership sign inside the tag. A far couple with
 * children has a union dot below the anchor partner, and that dot is the sign. A far couple with no
 * children has no dot, so the tag carries the sign instead. `render/svg-string.ts` and
 * `render/dom/scene.ts` both call `farTagSigns`, so the headless picture and the live tree agree.
 */
import type { FamilyGraph } from '../core/derive';
import type { EdgeDrawing, TreeLayout } from './model';

/**
 * The partnership type to draw inside each tag, by the tag's person. A tag shows a sign only when it names
 * one partner, that one partnership is far, it was written (not implied by a child), and no union dot shows
 * for it. A tag for several partners ("2 partners") has no single type, so it shows none. A partner that a
 * fold hides is not in the layout, so that tag shows none either. The type is as written; renderers pick the
 * shape with `unionShape`, as for the dot of a near couple.
 */
export function farTagSigns(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): Map<string, string> {
	const out = new Map<string, string>();
	if (!layout.farTags.size) return out;
	const dotted = new Set(edges.markers.flatMap((m) => (m.union === undefined ? [] : [m.union])));
	for (const tag of layout.farTags.values()) {
		if (tag.spouses.length !== 1) continue;
		const spouse = tag.spouses[0];
		const keys = (g.unionsOf.get(tag.person) ?? []).filter((k) => g.unionByKey.get(k)!.partners.includes(spouse) && layout.unions.get(k)?.far === true);
		if (keys.length !== 1) continue;
		const fu = g.unionByKey.get(keys[0])!;
		if (fu.implicit || dotted.has(fu.key)) continue;
		out.set(tag.person, fu.type);
	}
	return out;
}
