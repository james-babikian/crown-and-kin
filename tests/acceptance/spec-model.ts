import type { Tree } from '../../src/core/types';

/*
 * The relationships of spec §4.2 and §4.3, worked out here straight from the parsed tree so the
 * acceptance tests do not trust the implementation's own derivation. Cycle breaking (§8) is not
 * modelled: callers only use this where no cycle touches the people they check.
 */

const PLACEMENT = ['birth', 'adoptive', 'ward'];
const KNOWN_PARENT_TYPES = ['birth', 'adoptive', 'ward', 'rumoured'];

export interface SecondaryLink {
	parent: string;
	child: string;
	/** Parent type after the unknown-to-birth fallback. */
	type: string;
}

export interface SpecModel {
	/** Unique people in document order (first occurrence of an id wins). */
	people: string[];
	/** Sibling groups: primary union or single placement parent → children in document order. */
	families: Map<string, string[]>;
	/** Placement parents per person (§4.3). */
	placement: Map<string, string[]>;
	secondary: SecondaryLink[];
	/** Listed unions with two distinct existing partners, in list order. */
	unions: { index: number; id?: string; partners: [string, string] }[];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function specModel(tree: Tree): SpecModel {
	const byId = new Map<string, Tree['people'][number]>();
	for (const p of tree.people) if (!byId.has(p.id)) byId.set(p.id, p);
	const people = [...byId.keys()];

	const unions: SpecModel['unions'] = [];
	const byPair = new Map<string, SpecModel['unions']>();
	for (const u of tree.unions) {
		if (u.partners.length !== 2) continue;
		const [a, b] = u.partners;
		if (a === b || !byId.has(a) || !byId.has(b)) continue;
		const entry = { index: u.index, id: u.id, partners: [a, b] as [string, string] };
		unions.push(entry);
		const key = pairKey(a, b);
		byPair.set(key, [...(byPair.get(key) ?? []), entry]);
	}

	const families = new Map<string, string[]>();
	const placement = new Map<string, string[]>();
	const secondary: SecondaryLink[] = [];

	for (const p of byId.values()) {
		const byType = new Map<string, string[]>();
		for (const r of p.parents) {
			if (r.id === p.id || !byId.has(r.id)) continue;
			const type = KNOWN_PARENT_TYPES.includes(r.type) ? r.type : 'birth';
			byType.set(type, [...(byType.get(type) ?? []), r.id]);
		}
		let type = PLACEMENT.find((t) => byType.has(t));
		if (p.placement && PLACEMENT.includes(p.placement) && byType.has(p.placement)) type = p.placement;

		const placed = type ? byType.get(type)!.slice(0, 2) : [];
		placement.set(p.id, placed);
		for (const [t, ids] of byType) {
			for (const parent of t === type ? ids.slice(2) : ids) secondary.push({ parent, child: p.id, type: t });
		}

		let family: string | undefined;
		if (placed.length === 2) {
			const key = pairKey(placed[0], placed[1]);
			const listed = byPair.get(key);
			if (listed) {
				const u = (p.union !== undefined && listed.find((x) => x.id === p.union)) || listed[listed.length - 1];
				family = `u${u.index}`;
			} else {
				family = `i:${key}`;
			}
		} else if (placed.length === 1) {
			family = `s:${placed[0]}`;
		}
		if (family) families.set(family, [...(families.get(family) ?? []), p.id]);
	}

	return { people, families, placement, secondary, unions };
}
