import { partnerOf, type FamilyGraph } from './derive';

export type OrderItem = { kind: 'person'; id: string } | { kind: 'union'; key: string };

export interface ModelOrder {
	/** Every person and union, in the left-to-right order the layout should try to keep. */
	items: OrderItem[];
	/**
	 * Runs of people that must stay side by side in their row: a person plus the spouses who
	 * married into the tree through them (and those spouses' other partners who also married in).
	 */
	blocks: string[][];
	/** For each union, the partner whose family it was reached through; its children sit under them. */
	anchors: Map<string, string>;
}

/**
 * Depth-first walk from the founders in document order: each person, their married-in
 * spouses beside them, then each union's children in sibling order. This order is what keeps
 * spouses adjacent and siblings in succession order.
 */
export function computeModelOrder(g: FamilyGraph, gen: Map<string, number>): ModelOrder {
	const isRoot = (id: string) => g.placementParents.get(id)!.length === 0;
	const unionsOf = (id: string) => g.unionsOf.get(id) ?? [];
	const items: OrderItem[] = [];
	const blocks: string[][] = [];
	const visited = new Set<string>();
	const emittedUnions = new Set<string>();
	const anchors = new Map<string, string>();

	const emitUnion = (key: string, anchor?: string) => {
		if (emittedUnions.has(key)) return;
		emittedUnions.add(key);
		items.push({ kind: 'union', key });
		anchors.set(key, anchor ?? g.unionByKey.get(key)!.partners[0]);
	};

	/**
	 * When two houses intermarry, the children are drawn under the parent whose house most of
	 * them carry. Reaching the union from the other parent first, we leave it for that parent.
	 */
	const belongsToOther = (key: string, from: string) => {
		const fu = g.unionByKey.get(key)!;
		const other = partnerOf(fu, from);
		if (visited.has(other) || isRoot(other) || !fu.children.length) return false;
		const otherHouse = g.byId.get(other)!.house;
		if (!otherHouse || otherHouse === g.byId.get(from)!.house) return false;
		const matching = fu.children.filter((c) => g.byId.get(c)!.house === otherHouse).length;
		return matching * 2 > fu.children.length;
	};

	/** Married-in partners of `id` who should be drawn in the same block. */
	const marriedIn = (id: string, exclude: Set<string>) => {
		const out: string[] = [];
		for (const key of unionsOf(id)) {
			const s = partnerOf(g.unionByKey.get(key)!, id);
			if (!visited.has(s) && !exclude.has(s) && !out.includes(s) && isRoot(s) && gen.get(s) === gen.get(id)) out.push(s);
		}
		return out;
	};

	const visit = (id: string) => {
		if (visited.has(id)) return;
		visited.add(id);

		const taken = new Set([id]);
		const spouses = marriedIn(id, taken);
		spouses.forEach((s) => taken.add(s));
		// A married-in spouse's other married-in partners (e.g. a widow's first husband) sit on her far side.
		const others = new Map<string, string[]>();
		for (const s of spouses) {
			const o = marriedIn(s, taken);
			o.forEach((x) => taken.add(x));
			others.set(s, o);
		}

		let row: string[];
		if (spouses.length === 1) {
			const s = spouses[0];
			const spouseLeft = g.byId.get(id)!.sex === 'f' && g.byId.get(s)!.sex !== 'f';
			row = spouseLeft ? [...others.get(s)!.slice().reverse(), s, id] : [id, s, ...others.get(s)!];
		} else if (spouses.length > 1) {
			const [first, ...rest] = spouses;
			row = [...others.get(first)!.slice().reverse(), first, id];
			for (const s of rest) row.push(s, ...others.get(s)!);
		} else {
			row = [id];
		}
		for (const p of row) {
			visited.add(p);
			items.push({ kind: 'person', id: p });
		}
		blocks.push(row);

		const family = (pid: string) => {
			for (const key of unionsOf(pid)) {
				if (belongsToOther(key, pid)) continue;
				emitUnion(key, pid);
				g.unionByKey.get(key)!.children.forEach(visit);
			}
			(g.soloChildren.get(pid) ?? []).forEach(visit);
		};
		family(id);
		for (const p of row) if (p !== id) family(p);
	};

	// Founders first (roots not married to someone with parents), then anyone left over.
	const hasBloodPartner = (id: string) => unionsOf(id).some((k) => !isRoot(partnerOf(g.unionByKey.get(k)!, id)));
	for (const p of g.people) if (isRoot(p.id) && !hasBloodPartner(p.id)) visit(p.id);
	for (const p of g.people) visit(p.id);
	for (const u of g.unions) emitUnion(u.key);

	return { items, blocks, anchors };
}
