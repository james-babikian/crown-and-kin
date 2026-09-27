import type { FamilyGraph } from './derive';
import { partnerOf } from './derive';
import type { ParentKind, UnionRef } from './edit';
import type { DeleteSummary, DescribeDelete, FamilyOf, FamilyView, ParentLink, PartnerLink, PickerExclusions } from './family';
import { PARENT_TYPES, PLACEMENT_TYPES } from './types';

/*
 * Read-only questions about one person's family (spec §6.3, §6.4, §6.6, §6.7), answered from the
 * derived graph. Parent links are read as written, not as drawn: a link that validation dropped to
 * break a cycle still counts, because the ops and the pickers work on what is written.
 */

/** Unknown parent types are read as birth, as validation does (§8). */
export function parentKind(type: string | undefined): ParentKind {
	return type !== undefined && (PARENT_TYPES as readonly string[]).includes(type) ? (type as ParentKind) : 'birth';
}

/** Parent entries that name someone else in the tree, in written order, once per id and type. */
export function writtenParents(g: FamilyGraph, id: string): ParentLink[] {
	const person = g.byId.get(id);
	if (!person) return [];
	const out: ParentLink[] = [];
	const seen = new Set<string>();
	for (const r of person.parents) {
		if (r.id === id || !g.byId.has(r.id)) continue;
		const type = parentKind(r.type);
		const key = `${r.id}\0${type}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({ id: r.id, type });
	}
	return out;
}

/** Everyone reachable from `id` through parent links of any type, in one direction. */
function reach(g: FamilyGraph, id: string, down: boolean): Set<string> {
	const next = new Map<string, string[]>();
	for (const p of g.people) {
		for (const r of writtenParents(g, p.id)) {
			const [from, to] = down ? [r.id, p.id] : [p.id, r.id];
			const list = next.get(from);
			if (list) list.push(to);
			else next.set(from, [to]);
		}
	}
	const found = new Set<string>();
	const stack = [id];
	while (stack.length) {
		for (const n of next.get(stack.pop()!) ?? []) {
			if (found.has(n)) continue;
			found.add(n);
			stack.push(n);
		}
	}
	return found;
}

export const descendantsOf = (g: FamilyGraph, id: string) => reach(g, id, true);
export const ancestorsOf = (g: FamilyGraph, id: string) => reach(g, id, false);

/** The person's sibling group (§4.3, §6.5): the children of their primary union, or of their one placement parent. */
export function siblingGroup(g: FamilyGraph, id: string): string[] | null {
	const key = g.primaryUnion.get(id);
	if (key !== undefined) return g.unionByKey.get(key)?.children ?? null;
	const placed = g.placementParents.get(id) ?? [];
	if (placed.length === 1) return g.soloChildren.get(placed[0]) ?? null;
	return null;
}

export const familyOf: FamilyOf = (g, id) => {
	if (!g.byId.has(id)) return null;
	const parents = writtenParents(g, id);

	const partners: PartnerLink[] = [];
	const choices: string[] = [];
	for (const key of g.unionsOf.get(id) ?? []) {
		const fu = g.unionByKey.get(key);
		if (!fu) continue;
		const partner = partnerOf(fu, id);
		if (!choices.includes(partner)) choices.push(partner);
		if (fu.implicit || fu.unionIndex === undefined) {
			partners.push({ partner, union: null, type: null });
			continue;
		}
		const union: UnionRef = { index: fu.unionIndex, partners: [fu.partners[0], fu.partners[1]] };
		if (fu.text !== undefined) union.text = fu.text;
		const link: PartnerLink = { partner, union, type: fu.type };
		if (fu.start !== undefined) link.start = fu.start;
		if (fu.end !== undefined) link.end = fu.end;
		partners.push(link);
	}

	const group = siblingGroup(g, id);
	let siblings: FamilyView['siblings'] = null;
	if (group && group.length > 1) {
		const index = group.indexOf(id);
		siblings = { group: [...group], index, canMoveEarlier: index > 0, canMoveLater: index < group.length - 1 };
	}

	const count = (t: ParentKind) => parents.filter((r) => r.type === t).length;
	return {
		parents,
		partners,
		siblings,
		placementTypes: PLACEMENT_TYPES.filter((t) => count(t) > 0),
		fullTypes: PARENT_TYPES.filter((t) => count(t) >= 2),
		otherParentChoices: choices,
	};
};

export const pickerExclusions: PickerExclusions = (g, id, action, parentType) => {
	switch (action) {
		case 'add-parent': {
			const type = parentType ?? 'birth';
			const out = descendantsOf(g, id);
			out.add(id);
			for (const r of writtenParents(g, id)) if (r.type === type) out.add(r.id);
			return out;
		}
		case 'add-child': {
			const out = ancestorsOf(g, id);
			out.add(id);
			return out;
		}
		case 'add-spouse':
			return new Set([id]);
		default:
			return new Set();
	}
};

export const describeDelete: DescribeDelete = (g, id, options) => {
	const summary: DeleteSummary = {
		unions: g.unions.filter((u) => !u.implicit && u.partners.includes(id)).length,
		childLinks: g.people.filter((p) => p.id !== id && p.parents.some((r) => r.id === id)).length,
		clearsStart: options?.start === id,
		clearsFocus: options?.focus === id,
	};
	return summary;
};
