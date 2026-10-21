/*
 * Works out the left-to-right order of people and unions on each row (spec §5.1 step 2): a
 * depth-first walk from the founders that keeps spouses beside each other and siblings in the
 * order of the `people` list (D2). The layout (`layout/pipeline.ts`) and the house page
 * (`house-page.ts`, D243 item 2) both read it, so the page lists a generation in the order the tree
 * draws it. The walk has three rules (the card-and-line build, D239) and one result for the plan:
 *   W1 a couple whose partners stand on two rows is anchored to the lower partner (D239);
 *   W2 partners in one block but not side by side: the outer partner anchors;
 *   W2b partners of one row in two blocks, of no other house: the partner with fewer families of children anchors (the first to reach the union at a tie);
 *   W3 the families of one person are emitted in the order of their hang points on the card.
 * `ModelOrder.familyOrder` records the W3 order for the plan. A man who is only a rumoured parent
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
	/**
	 * For each union, the partner from whose place the walk emitted its children. The plan decides the anchor
	 * of a couple itself from the rows; it takes this partner only for partners on one row.
	 */
	anchors: Map<string, string>;
	/**
	 * For each person, the keys of their families in the order of their hang points along the card (W3): union
	 * keys, and `soloKey(id)` for the children of that person alone. The groups of children follow this order.
	 */
	familyOrder: Map<string, string[]>;
}

/** A place in the walk: a block (by its index in the walk's block list) and a position inside it. */
export interface Place {
	block: number;
	at: number;
}

/** The key of the family of one parent alone (a union family has its union key). */
export const soloKey = (parent: string): string => `solo:${parent}`;

/**
 * The side of `to` seen from `from`: in one block by the position; else the block that the walk
 * reached earlier (the smaller walk index) lies to the left. The walk uses it to order a person's
 * families, the plan to guess the side of a leg before the placement: one rule, so the two agree.
 */
export const sideByWalk = (from: Place, to: Place, indexOf: (block: number) => number): 'left' | 'right' =>
	from.block === to.block ? (to.at < from.at ? 'left' : 'right') : indexOf(to.block) < indexOf(from.block) ? 'left' : 'right';

/** A partner that the walk has not reached yet stands to the right of everything reached so far. */
const NOT_REACHED = Infinity;
/** A family whose line comes from one side sorts just before or just after the person's own place; half a step keeps it between the neighbours. */
const BESIDE = 0.5;
/** Rows that the far rule of D10 allows between partners by default: a couple farther apart has no line. */
const DEFAULT_FAR_GENERATIONS = 1;

/** Seats each lone rumoured root (D140) after the placement parent of his child who is in his row. */
function seatLoneRoots(g: FamilyGraph, gen: Map<string, number>): { seatedAfter: Map<string, string[]>; seated: Set<string> } {
	// The parent is looked up in this graph, so a man whose child or parent is folded away is placed like a founder.
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
	return { seatedAfter, seated };
}

/**
 * The row of a block: `id`, the spouses who married in through them and those spouses' other married-in
 * partners, in the order that keeps the bars of the couples uncut (D142, spec §4.3).
 */
function blockRow(g: FamilyGraph, id: string, spouses: string[], others: Map<string, string[]>): string[] {
	if (spouses.length === 0) return [id];
	if (spouses.length > 1) {
		const [first, ...rest] = spouses;
		const row = [...others.get(first)!.slice().reverse(), first, id];
		for (const s of rest) row.push(s, ...others.get(s)!);
		return row;
	}
	const s = spouses[0];
	const spouseLeft = g.byId.get(id)!.sex === 'f' && g.byId.get(s)!.sex !== 'f';
	const row = spouseLeft ? [...others.get(s)!.slice().reverse(), s, id] : [id, s, ...others.get(s)!];
	if (spouseLeft && others.get(s)!.length) {
		// D142: the partners of the husband s stand in the order of his unions, so that the groups of children, which
		// follow that order (spec §4.3), do not cross. She keeps her place beside him; a later partner stands on his far side.
		const unionIndex = (p: string) => (g.unionsOf.get(s) ?? []).findIndex((k) => g.unionByKey.get(k)!.partners.includes(p));
		const ordered = [id, ...others.get(s)!].sort((x, y) => unionIndex(x) - unionIndex(y));
		const at = ordered.indexOf(id);
		if (at < ordered.length - 1) return [...ordered.slice(0, at + 1), s, ...ordered.slice(at + 1)];
	}
	return row;
}

/**
 * Depth-first walk from the founders in document order: each person, their married-in spouses
 * beside them, then each person's families in the order of their hang points, each with its
 * children in sibling order. `farGenerations` is the row distance of the far rule (D10): a partner
 * farther away has no line, so the family hangs from the person's own place.
 *
 * Exempt from the size rule of the architecture notes §4.2.7 (`tests/layout-size-rule.test.ts` holds its size): 122 code lines and 55 branches in 0.3.1 (0.3.0: 113 and 50). The walk is a
 * stack machine whose tasks share the closures over its state; a split is a later clean-up.
 */
export function computeModelOrder(g: FamilyGraph, gen: Map<string, number>, farGenerations: number = DEFAULT_FAR_GENERATIONS, whole: FamilyGraph = g): ModelOrder {
	const isRoot = (id: string) => g.placementParents.get(id)!.length === 0;
	const unionsOf = (id: string) => g.unionsOf.get(id) ?? [];
	/**
	 * How many families of children hang from a person's card: the unions with children and the children of one parent alone. Counted on
	 * `whole`, the graph before folds are cut out, so a fold of one family never moves the dot of another family of the same person.
	 */
	const familyLoad = (id: string) => (whole.unionsOf.get(id) ?? []).filter((key) => whole.unionByKey.get(key)!.children.length).length + ((whole.soloChildren.get(id) ?? []).length ? 1 : 0);
	const items: OrderItem[] = [];
	const blocks: string[][] = [];
	const visited = new Set<string>();
	const emittedUnions = new Set<string>();
	const anchors = new Map<string, string>();
	const familyOrder = new Map<string, string[]>();
	const { seatedAfter, seated } = seatLoneRoots(g, gen);

	// The block each person stands in (and its walk index), and the person with parents that it was built around.
	const blockOf = new Map<string, string[]>();
	const blockIndexOf = new Map<string, number>();
	const bloodOf = new Map<string, string>();

	const emitUnion = (key: string, anchor?: string) => {
		if (emittedUnions.has(key)) return;
		emittedUnions.add(key);
		items.push({ kind: 'union', key });
		anchors.set(key, anchor ?? g.unionByKey.get(key)!.partners[0]);
	};

	/** Whether the union reached from `from` is left for the other partner to emit. */
	const belongsToOther = (key: string, from: string) => {
		const fu = g.unionByKey.get(key)!;
		const other = partnerOf(fu, from);
		if (!fu.children.length) return false;
		// W1: on two rows the lower partner anchors the children. A lower partner who is a root is still visited
		// later (the last loops of the walk visit everyone), so the union is emitted there.
		const rowsBelow = (gen.get(other) ?? 0) - (gen.get(from) ?? 0);
		if (rowsBelow > 0) return true;
		if (rowsBelow < 0) return false;
		// W2: partners in one block but not side by side (a third spouse two cards along): the outer partner anchors the
		// children, so that their dot, which sits on the anchor's own line, lies outside the bars of the spouses between.
		// Every person has a block when their families are visited (`step` sets it before it queues them).
		const row = blockOf.get(from)!;
		if (row.includes(other) && Math.abs(row.indexOf(other) - row.indexOf(from)) > 1) {
			const blood = row.indexOf(bloodOf.get(from)!);
			return Math.abs(row.indexOf(other) - blood) > Math.abs(row.indexOf(from) - blood);
		}
		// When two houses intermarry, the children are drawn under the parent whose house most of them carry.
		// Reaching the union from the other parent first, we leave it for that parent.
		if (visited.has(other) || isRoot(other)) return false;
		const otherHouse = g.byId.get(other)!.house;
		// Houses that do not differ: the dot goes under the partner with fewer families of children, so that fewer hang points crowd one card and
		// the lines of the other partner's families do not run through them; at a tie the partner who reaches the union first keeps it.
		if (!otherHouse || otherHouse === g.byId.get(from)!.house) return familyLoad(other) < familyLoad(from);
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

	/**
	 * W3: the families of a person in the order of their hang points along the row (D177 item 9: the groups of children follow the
	 * order of the dots). First the spouses on the left in the block (the farthest first); then the partners in another block that
	 * the walk reached earlier; then the far partners (more than `farGenerations` rows away) and the children of one parent alone (their
	 * dot sits on this card's own line; list order, the one-parent family last); then the partners in another block reached later or not
	 * yet; then the spouses on the right (the nearest first). Inside a group the list order stays. With the dots on ports, no other order
	 * is free of a crossing.
	 */
	const familiesInOrder = (id: string): Task[] => {
		const row = blockOf.get(id)!;
		const at = row.indexOf(id);
		const here: Place = { block: blockIndexOf.get(id)!, at };
		const solo: Task = { kind: 'solo', id };
		const unions: Task[] = unionsOf(id).map((key): Task => ({ kind: 'union', key, from: id }));
		// A partner more than `farGenerations` rows away (a far couple, D10) and the children of one parent alone hang from ports with
		// no line, at the person's own place. Inside a group the list order stays (the sort is stable).
		const sortKey = (t: Task) => {
			if (t.kind !== 'union') return at;
			const other = partnerOf(g.unionByKey.get(t.key)!, id);
			if (Math.abs((gen.get(other) ?? 0) - (gen.get(id) ?? 0)) > farGenerations) return at;
			const there: Place = { block: blockIndexOf.get(other) ?? NOT_REACHED, at: row.indexOf(other) };
			// A spouse in the block sorts by their place (the farthest left first); a partner elsewhere just beside this person's own place.
			if (there.block === here.block) return there.at;
			return sideByWalk(here, there, (b) => b) === 'left' ? at - BESIDE : at + BESIDE;
		};
		const sorted = [...unions, solo].sort((p, q) => sortKey(p) - sortKey(q));
		familyOrder.set(id, sorted.map((t) => (t.kind === 'union' ? t.key : soloKey(id))));
		return sorted;
	};

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

		const row = blockRow(g, id, spouses, others);
		// The newcomers stand at the right end, so that the bar of a couple is never cut.
		for (const p of [...row]) for (const r of seatedAfter.get(p) ?? []) if (!visited.has(r) && !row.includes(r)) row.push(r);
		for (const p of row) {
			visited.add(p);
			items.push({ kind: 'person', id: p });
			blockOf.set(p, row);
			blockIndexOf.set(p, blocks.length);
			bloodOf.set(p, id);
		}
		blocks.push(row);

		// Row order (not the focus person first), so the groups of children follow the partnership dots left to right (spec §4.3).
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
					then(familiesInOrder(task.id));
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

	return { items, blocks, anchors, familyOrder };
}
