/*
 * Works out the left-to-right order of people and unions on each row (spec §5.1 step 2): a
 * depth-first walk from the founders that keeps spouses beside each other and siblings in the
 * order of the `people` list (D2). The layout code calls `computeModelOrder` with the family graph
 * from `derive.ts` and the generations from `generations.ts`. A man who is only a rumoured parent
 * (`rumoured-roots.ts`, D140) is seated at the right end of the block of his child's parent.
 */

import { partnerOf, type FamilyGraph } from './derive';
import { loneRumouredRoots } from './rumoured-roots';

/** One entry of the left-to-right order: a person card, or a union's dot. */
export type OrderItem = { kind: 'person'; id: string } | { kind: 'union'; key: string };

/** The left-to-right order of people and unions the layout should try to keep. */
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

	// D140: a lone rumoured parent stands beside the placement parent of his child who is in his row. The parent is
	// looked up in this graph, so a man whose child or parent is folded away is placed like a founder.
	const seatedAfter = new Map<string, string[]>();
	const seated = new Set<string>();
	for (const [root, kids] of loneRumouredRoots(g)) {
		const parent = (g.placementParents.get(kids[0]) ?? []).find((q) => gen.get(q) === gen.get(root));
		if (parent === undefined) continue;
		seated.add(root);
		const list = seatedAfter.get(parent);
		if (list) list.push(root);
		else seatedAfter.set(parent, [root]);
	}

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

	// The walk keeps its own stack: a long line of descent would overflow the call stack. Each task
	// is looked at only when it is taken from the stack, as the recursive walk would reach it.
	type Task = { kind: 'visit'; id: string } | { kind: 'family'; id: string } | { kind: 'union'; key: string; from: string } | { kind: 'solo'; id: string };
	const stack: Task[] = [];
	/** Puts tasks on the stack so the first of them is done first. */
	const then = (tasks: Task[]) => {
		for (let k = tasks.length - 1; k >= 0; k--) stack.push(tasks[k]);
	};
	const visits = (ids: readonly string[]): Task[] => ids.map((id) => ({ kind: 'visit', id }));

	const step = (id: string) => {
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
			if (spouseLeft && others.get(s)!.length) {
				// D142: the partners of the husband s stand in the order of his unions, so that the groups of children, which
				// follow that order (spec §4.3), do not cross. She keeps her place beside him; a later partner stands on his far side.
				const unionIndex = (p: string) => unionsOf(s).findIndex((k) => g.unionByKey.get(k)!.partners.includes(p));
				const ordered = [id, ...others.get(s)!].sort((x, y) => unionIndex(x) - unionIndex(y));
				const at = ordered.indexOf(id);
				if (at < ordered.length - 1) row = [...ordered.slice(0, at + 1), s, ...ordered.slice(at + 1)];
			}
		} else if (spouses.length > 1) {
			const [first, ...rest] = spouses;
			row = [...others.get(first)!.slice().reverse(), first, id];
			for (const s of rest) row.push(s, ...others.get(s)!);
		} else {
			row = [id];
		}
		// The newcomers stand at the right end, so that the bar of a couple is never cut.
		for (const p of [...row]) for (const r of seatedAfter.get(p) ?? []) if (!visited.has(r) && !row.includes(r)) row.push(r);
		for (const p of row) {
			visited.add(p);
			items.push({ kind: 'person', id: p });
		}
		blocks.push(row);

		// Row order (not the focus person first), so the groups of children follow the partnership dots left to right (spec �4.3).
		then(row.map((p) => ({ kind: 'family', id: p })));
	};

	const visit = (id: string) => {
		stack.push({ kind: 'visit', id });
		for (let task = stack.pop(); task; task = stack.pop()) {
			switch (task.kind) {
				case 'visit':
					step(task.id);
					break;
				case 'family':
					then([...unionsOf(task.id).map((key): Task => ({ kind: 'union', key, from: task.id })), { kind: 'solo', id: task.id }]);
					break;
				case 'union':
					if (belongsToOther(task.key, task.from)) break;
					emitUnion(task.key, task.from);
					then(visits(g.unionByKey.get(task.key)!.children));
					break;
				case 'solo':
					then(visits(g.soloChildren.get(task.id) ?? []));
					break;
			}
		}
	};

	// Founders first (roots not married to someone with parents), then anyone left over. A seated man waits for his
	// parent's block; if that is never reached, the last loop still draws him.
	const hasBloodPartner = (id: string) => unionsOf(id).some((k) => !isRoot(partnerOf(g.unionByKey.get(k)!, id)));
	for (const p of g.people) if (isRoot(p.id) && !hasBloodPartner(p.id) && !seated.has(p.id)) visit(p.id);
	for (const p of g.people) if (!seated.has(p.id)) visit(p.id);
	for (const p of g.people) visit(p.id);
	for (const u of g.unions) emitUnion(u.key);

	return { items, blocks, anchors };
}
