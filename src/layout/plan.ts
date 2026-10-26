/*
 * The plan stage (the architecture notes §4.2.2, stage S2). `buildSkeleton` takes the graph, the rows and the order and builds the layered
 * items (cards and passages) in their blocks, the couples (bar, dot or far) with their legs, the families and the side links: nothing
 * here depends on a position. `derive` adds what follows from the skeleton: the ports of every card (ports.ts), the hang point of
 * every family and couple, the slot width of every passage and the minimum gaps of every row. It runs after every change of the
 * skeleton (the far-by-distance rounds) and once more after the placement with the sides of the legs taken from the positions; the
 * hang ports do not move between the runs (see `packPorts`).
 */
import type { FamilyGraph, FamilyUnion } from '../core/derive';
import { partnerOf } from '../core/derive';
import type { FoldControl } from '../core/folds';
import { sideByWalk, type ModelOrder } from '../core/order';
import { FOLD_BADGE_EM, type FoldInput } from './fold-spots';
import { lineMetrics, relationExtra, sideTagDepth, sidewaysPartnerGap, tallExtra } from './geometry';
import { armsByRule, isFarByStructure, isFarCouple, type FarProbe } from './layout';
import type { FarCoupleRule, Geometry, LayoutSettings } from './model';
import { familyKeyOf, soloKey, type Couple, type CoupleSpec, type Family, type FamilySpec, type Hang, type Item, type Plan, type Port, type SideLink, type Skeleton } from './plan-model';
import { barred, forkLegs, hangRooms, markHalf, nearOf, overflowHangs, packPorts, unionPairKey, requestPorts, unitEnd, type DirOf } from './ports';
import { consistentRows } from './row-blocks';

/** What the plan stage needs beyond the graph: the rows, the order, the geometry of the working frame, the far rule and the settings. */
export interface PlanInput {
	g: FamilyGraph;
	coreGen: Map<string, number>;
	order: ModelOrder;
	/** The geometry of the working frame (the turned geometry for a sideways tree). */
	geo: Geometry;
	/** The drawn sideways geometry, when the tree is sideways (the frame is turned). */
	side?: Geometry;
	far: FarCoupleRule;
	settings: LayoutSettings;
	/** The folds of the view (spec §13.10): the whole graph, the hidden partners (tags), the folded families (stems) and the controls. */
	fold?: FoldInput;
	/** The couples that the far-by-distance rounds have made far so far: a skeleton built again (after a release) starts with them far. */
	farKeys?: ReadonlySet<string>;
}

/** What the far rule reads of an item: its place along the row, its width and its row (the generation). */
const probe = (it: Item): FarProbe => ({ x: it.x, w: it.w, gen: it.row });

/** The rows of a skeleton from its blocks, and every item's index in its row: run after any change of the blocks. */
export function reindex(s: Skeleton): void {
	s.rows = s.rowBlocks.map((list) => list.flatMap((bi) => s.blocks[bi]));
	s.rows.forEach((row) => row.forEach((it, i) => (it.at = i)));
}

/** The anchor of a couple: the lower partner on two rows (the dot and the passage are in that row); on one row the walk's emitter. The one decision site. */
export function anchorOf(fu: FamilyUnion, a: Item, b: Item, order: ModelOrder): string {
	if (a.row !== b.row) return a.row > b.row ? a.id : b.id;
	return order.anchors.get(fu.key)!;
}

/** The side of `to` seen from `from` by the walk's proxy (`sideByWalk`): the guess of every line's side before the placement. */
export const walkSide = (s: Skeleton): DirOf => (from, to) => sideByWalk(from, to, (b) => s.blockIndex.get(b)!);

/** The card items in the blocks of the order, with their sizes and flags, and the blocks of each row (D2: sibling blocks in document order). */
function cardItems(input: PlanInput, gen: Map<string, number>, personBlocks: string[][]): Pick<Skeleton, 'items' | 'blocks' | 'rowBlocks'> {
	const { g, geo, side, settings, fold } = input;
	// Card sizes: as in 0.3.0 (D29, D37, D61, D81). Sideways a tall card is longer along the stack axis (wider in the turned frame).
	const has = (id: string) => g.byId.has(id);
	const long = new Set((settings.longNames ?? []).filter(has));
	const tall = new Set([...(settings.tallCards ?? []).filter(has), ...long]);
	const tallT = new Set((settings.tallTitles ?? []).filter(has));
	const nameExtra = tall.size ? tallExtra(side ?? geo) : 0;
	const titleExtra = tallT.size ? relationExtra(side ?? geo) : 0;
	const more = (id: string) => (tall.has(id) ? nameExtra * (long.has(id) ? 2 : 1) : 0) + (tallT.has(id) ? titleExtra : 0);
	const extra = tall.size > 0 || tallT.size > 0;
	const cw = (id: string) => (side && extra ? geo.cardW + more(id) : geo.cardW);
	const ch = (id: string) => (!side && extra ? geo.cardH + more(id) : geo.cardH);
	const noPictures = geo.form === 'text'; // as 0.3.0: pictures follow the card form, not the direction (supervisor ruling at the switch, the decision notes "0.3.1")
	const withArms = noPictures ? new Set<string>() : armsByRule(g, settings, fold);
	const withPortrait = noPictures ? new Set<string>() : new Set(settings.portraits ?? []);
	const flags = (id: string): Item['flags'] => ({
		...(tall.has(id) ? { tallName: true as const } : {}),
		...(long.has(id) ? { longName: true as const } : {}),
		...(tallT.has(id) ? { tallTitle: true as const } : {}),
		...(withArms.has(id) ? { arms: true as const } : {}),
		...(withPortrait.has(id) ? { portrait: true as const } : {}),
	});
	const items = new Map<string, Item>();
	const blocks: Item[][] = personBlocks.map((b, i) =>
		b.map((id) => {
			const it: Item = { id, kind: 'card', row: gen.get(id)!, w: cw(id), h: ch(id), x: 0, block: i, at: 0, flags: flags(id) };
			items.set(id, it);
			return it;
		}),
	);
	const maxGen = Math.max(-1, ...gen.values());
	const rowBlocks: number[][] = Array.from({ length: maxGen + 1 }, () => []);
	blocks.forEach((b, i) => rowBlocks[b[0].row].push(i));
	// D2: the blocks of one family's children take the slots they occupy in document order.
	const families0: string[][] = [...g.unions.map((u) => u.children), ...g.soloChildren.values()].filter((k) => k.length);
	for (const kids of families0) {
		if (kids.length < 2) continue;
		const row = rowBlocks[gen.get(kids[0])!];
		const want = [...new Set(kids.map((k) => items.get(k)!.block))];
		const slots = want.map((b) => row.indexOf(b)).sort((a, b) => a - b);
		slots.forEach((slot, i) => (row[slot] = want[i]));
	}
	return { items, blocks, rowBlocks };
}

/**
 * `list` with the members of each group put in order of their rank (the highest first where `descending` holds for the group's first
 * member), each group's members keeping the places that the group had in the list: the other members do not move.
 */
function nestedOrder<T>(list: readonly T[], groupOf: (x: T) => string, rankOf: (x: T) => number, descending: (x: T) => boolean): T[] {
	const groups = new Map<string, number[]>();
	list.forEach((x, i) => {
		const k = groupOf(x);
		const at = groups.get(k);
		if (at) at.push(i);
		else groups.set(k, [i]);
	});
	const out = [...list];
	for (const places of groups.values()) {
		if (places.length < 2) continue;
		const sign = descending(list[places[0]]) ? -1 : 1;
		const sorted = places.map((i) => list[i]).sort((a, b) => sign * (rankOf(a) - rankOf(b)));
		places.forEach((i, k) => (out[i] = sorted[k]));
	}
	return out;
}

/**
 * The passages of every couple on two rows: the line of the upper partner gets a place in every row it passes. In the lower partner's
 * row it stands right beside the end card of that partner's unit (the run of cards joined by bars) on the side of the upper partner;
 * in a row between, it is a block of its own at the walk position of the lower block, never between two blocks that a bar joins.
 */
function passagesOf(s: Skeleton, g: FamilyGraph, near: number): void {
	const cardsOf = (bi: number) => s.blocks[bi].filter((it) => it.kind === 'card');
	const joined = (bi: number, bj: number) => {
		const a = cardsOf(bi);
		const b = cardsOf(bj);
		return a.length > 0 && b.length > 0 && barred(s, g, a[a.length - 1], b[0]);
	};
	const between: { item: Item; after: number; c: CoupleSpec }[] = [];
	// The unions of one couple (a betrothal and a marriage) nest around the lower partner's hang points: the line to the farthest hang
	// point is the outer one, so its passage stands farthest from that partner. A passage is put in beside the end card (or into the
	// row between) one after the other, so the unions of one couple are taken in the order that gives that nesting; every other
	// couple keeps its place in the list.
	const lowerOf = (c: CoupleSpec) => (c.a.row < c.b.row ? c.b : c.a);
	const hangAt = (c: CoupleSpec) => s.hangOrder.get(lowerOf(c).id)?.indexOf(c.union) ?? -1;
	const twoRows = [...s.couples.values()].filter((c) => c.kind === 'dot' && c.a.row !== c.b.row);
	const pairOf = (c: CoupleSpec) => unionPairKey(g, c.union);
	const sideOfCouple = (c: CoupleSpec): 'left' | 'right' => {
		const [upper, lower] = c.a.row < c.b.row ? [c.a, c.b] : [c.b, c.a];
		const [left, right] = [unitEnd(s, g, lower, -1), unitEnd(s, g, lower, 1)];
		return lower === left && lower !== right ? 'left' : lower === right && lower !== left ? 'right' : s.blockIndex.get(upper.block)! < s.blockIndex.get(lower.block)! ? 'left' : 'right';
	};
	// Beside the end card on the left a later passage stands nearer the card than an earlier one, so the first is the one for the highest hang point; on the right it is the other way round.
	const inOrder = nestedOrder(twoRows, pairOf, hangAt, (c) => sideOfCouple(c) === 'left');
	for (const c of inOrder) {
		const [upper, lower] = c.a.row < c.b.row ? [c.a, c.b] : [c.b, c.a];
		const [left, right] = [unitEnd(s, g, lower, -1), unitEnd(s, g, lower, 1)];
		const sideOf = sideOfCouple(c);
		const passages: Item[] = [];
		for (let r = upper.row + 1; r <= lower.row; r++) {
			const p: Item = { id: `~${c.union}|${r}`, kind: 'passage', row: r, w: 2 * near, h: 0, x: 0, block: -1, at: 0, carries: { kind: 'pass', union: c.union } };
			s.items.set(p.id, p);
			if (r === lower.row) {
				// Right beside the unit's end card (a block can go on past the unit: a third spouse two cards along), never inside the unit.
				const end = sideOf === 'left' ? left : right;
				p.block = end.block;
				const b = s.blocks[end.block];
				b.splice(b.indexOf(end) + (sideOf === 'left' ? 0 : 1), 0, p);
			} else {
				p.block = s.blocks.length;
				s.blocks.push([p]);
				s.blockIndex.set(p.block, s.blockIndex.get(lower.block)!);
				between.push({ item: p, after: lower.block, c });
			}
			passages.push(p);
		}
		c.legs.push({ family: c.union, person: upper.id, passages });
	}
	// In a row between the passages of one couple stand left to right in the order of the lines' ports (the highest hang point first on the left).
	for (const { item, after } of nestedOrder(between, (e) => `${e.item.row}|${pairOf(e.c)}`, (e) => hangAt(e.c), () => true)) {
		const row = s.rowBlocks[item.row];
		let k = row.findIndex((bi) => s.blockIndex.get(bi)! > s.blockIndex.get(after)!);
		if (k < 0) k = row.length;
		// Never between two blocks that a bar joins (side-by-side partners of two sibling blocks): past the end of their unit. Bounded: k only grows and stops at row.length.
		while (k > 0 && k < row.length && joined(row[k - 1], row[k])) k++;
		row.splice(k, 0, item.block);
	}
}

/** The families: the children of every union and of every parent alone, with the fold control on their stem, plus the folded families with no shown child. */
function familiesOf(g: FamilyGraph, items: Map<string, Item>, anchors: Map<string, string>, fold: FoldInput | undefined): FamilySpec[] {
	const families: FamilySpec[] = [];
	const controlOf = new Map<string, FoldControl>();
	for (const c of fold?.controls ?? []) controlOf.set(familyKeyOf(c), c);
	const withControl = (f: FamilySpec): FamilySpec => {
		const c = controlOf.get(f.key);
		return c && c.parents.every((p) => items.has(p)) ? { ...f, control: c } : f;
	};
	for (const fu of g.unions) if (fu.children.length) families.push(withControl({ key: fu.key, union: fu.key, parents: [...fu.partners], kids: [...fu.children], anchor: anchors.get(fu.key)! }));
	for (const [parent, kids] of g.soloChildren) if (kids.length) families.push(withControl({ key: soloKey(parent), parents: [parent], kids: [...kids], anchor: parent }));
	const known = new Set(families.map((f) => f.key));
	for (const c of fold?.folded ?? []) {
		const key = familyKeyOf(c);
		if (known.has(key) || !c.parents.every((p) => items.has(p))) continue;
		if (c.union !== undefined && !g.unionByKey.has(c.union)) continue;
		known.add(key);
		families.push({ key, ...(c.union !== undefined ? { union: c.union } : {}), parents: [...c.parents], kids: [], anchor: c.union !== undefined ? anchors.get(c.union)! : c.parents[0], control: c });
	}
	return families;
}

/** Builds the skeleton: see the file header. */
export function buildSkeleton(input: PlanInput): Skeleton {
	const { g, coreGen, order, geo, far, fold } = input;
	const rowsOf = consistentRows(g, coreGen, order.blocks);
	// Folds: a row with no shown person takes no room (spec §13.10): the generations of the shown people are renumbered without gaps.
	const usedGens = [...new Set(rowsOf.gen.values())].sort((a, b) => a - b);
	const gen = new Map([...rowsOf.gen].map(([id, v]) => [id, usedGens.indexOf(v)]));
	const { items, blocks, rowBlocks } = cardItems(input, gen, rowsOf.blocks);
	const s: Skeleton = { rows: [], blocks, rowBlocks, items, blockIndex: new Map(blocks.map((_, i) => [i, i])), anchors: new Map(), tagged: new Set(fold?.partners.keys() ?? []), hangOrder: order.familyOrder, families: [], couples: new Map(), sideLinks: [], hangPassages: new Map() };
	reindex(s);
	// Couples: side by side means consecutive in the row's order of cards, whatever the blocks (a married pair of two sibling blocks is
	// as side by side as a pair placed together: the 0.3.0 rule, and the `beside` of compact.ts). A far couple by generations (D11) has
	// no line; one by distance is marked after the placement (`farByDistance`). Nothing is placed yet (every x is 0), so here only the
	// generation half of `isFarCouple` can hold.
	const adjacent = (a: Item, b: Item) => a.row === b.row && Math.abs(a.at - b.at) === 1;
	for (const fu of g.unions) {
		const [a, b] = fu.partners.map((p) => items.get(p)!);
		s.anchors.set(fu.key, anchorOf(fu, a, b, order));
		const kind: CoupleSpec['kind'] = adjacent(a, b) ? 'bar' : input.farKeys?.has(fu.key) || isFarCouple(probe(a), probe(b), a.block === b.block, false, far, geo.cardW) ? 'far' : 'dot';
		s.couples.set(fu.key, { union: fu.key, a, b, kind, legs: [] });
	}
	// D303, far by structure: a second loop, because `unitEnd` reads every couple of a card (the bars are all set above). The kinds are collected
	// first and set after, so that one couple's change cannot decide the test of the next.
	const inside: string[] = [];
	for (const c of s.couples.values()) {
		if (c.kind !== 'dot') continue;
		const lower = c.a.row < c.b.row ? c.b : c.a;
		if (isFarByStructure(probe(c.a), probe(c.b), unitEnd(s, g, lower, -1) !== lower && unitEnd(s, g, lower, 1) !== lower, far)) inside.push(c.union);
	}
	for (const key of inside) s.couples.get(key)!.kind = 'far';
	passagesOf(s, g, nearOf(geo));
	// A same-row couple that is not side by side: the partner that is not the anchor gets a leg.
	for (const c of s.couples.values()) {
		if (c.kind !== 'dot' || c.a.row !== c.b.row) continue;
		const other = s.items.get(partnerOf(g.unionByKey.get(c.union)!, s.anchors.get(c.union)!))!;
		c.legs.push({ family: c.union, person: other.id, passages: [] });
	}
	reindex(s);
	// A shown person with a hidden partner has a tag like one with a far partner (spec §13.10).
	for (const c of s.couples.values()) if (c.kind === 'far') s.tagged.add(c.a.id).add(c.b.id);
	s.families = familiesOf(g, items, s.anchors, fold);
	s.sideLinks = g.secondary.map((x) => ({ child: x.child, type: x.type, parents: [...x.parents], ...(x.unionKey ? { union: x.unionKey } : {}) }));
	return s;
}

/** The plan of a tree before the placement: the skeleton, derived with the walk's guess of every line's side. */
export function planTree(input: PlanInput): Plan {
	const spec = buildSkeleton(input);
	return derive(spec, input.g, input.geo, input.side, walkSide(spec));
}

/**
 * The plan of a skeleton: the ports of every card (requested, forked, packed; a card whose edge is full gives its hang points to
 * passages beside it), the hang point of every family and couple, the slot widths and the minimum gaps. `dirOf` gives the side of
 * every line: the walk's guess before the placement, the positions after it.
 */
export function derive(spec: Skeleton, g: FamilyGraph, geo: Geometry, side: Geometry | undefined, dirOf: DirOf): Plan {
	const m = lineMetrics(geo);
	const leanOf = walkSide(spec);
	let req = requestPorts(spec, g, geo, side, dirOf);
	let rooms = hangRooms(spec, req, g, geo, side, leanOf, m);
	forkLegs(spec, req, g);
	// A card whose ports do not fit changes the skeleton (hang passages); the ports are then requested once more. The second request
	// cannot overflow again: every hang point of such a card is on a passage now, and the legs alone fit by the first test or never will.
	if (overflowHangs(spec, req, rooms, g, side, leanOf, m)) {
		reindex(spec);
		req = requestPorts(spec, g, geo, side, dirOf);
		rooms = hangRooms(spec, req, g, geo, side, leanOf, m);
		forkLegs(spec, req, g);
	}
	const exits = new Map<string, Port[]>();
	for (const id of g.people.map((p) => p.id)) {
		const list = req.byCard.get(id);
		if (!list) {
			exits.set(id, []);
			continue;
		}
		exits.set(id, packPorts(spec.items.get(id)!, list, spec.tagged.has(id) && !side, geo, spec, rooms.get(id)!, m));
	}
	const families: Family[] = spec.families.map((f) => {
		const stem = req.stemPort.get(f.key);
		return { ...f, hang: req.hangs.get(f.key)!, ...(stem ? { stem: { family: f.key, person: f.parents[0], passages: [], port: stem } } : {}) };
	});
	const couples = new Map<string, Couple>();
	for (const c of spec.couples.values()) {
		const hang = req.hangs.get(c.union);
		couples.set(c.union, { ...c, ...(hang ? { hang } : {}), legs: c.legs.map((l) => ({ ...l, port: req.legPort.get(l)! })) });
	}
	const sideLinks: SideLink[] = spec.sideLinks.map((s) => ({ ...s, ports: s.union ? [] : s.parents.map((p) => exits.get(p)!.find((q) => q.kind === 'side' && q.target?.id === s.child)!) }));
	slotWidths(spec, exits, req.hangs, geo, side);
	const minGap = minGapsOf(spec.rows, spec.tagged, g, geo, side, exits);
	return { ...spec, spec, families, couples, sideLinks, exits, minGap };
}

/**
 * A passage's slot is as wide as the widest reach of the hang verticals of any item of the row above (a card's hang ports with their
 * marks, a hang passage's port, a bar dot with its mark), so that the line always finds a place in it clear of those verticals
 * (which the placement cannot see), whatever that item's position: a blocked stretch is never wider than the slot, and the places
 * the route stage tries include every edge of a blocked stretch (`passageLines`).
 */
function slotWidths(spec: Skeleton, exits: ReadonlyMap<string, Port[]>, hangs: ReadonlyMap<string, Hang>, geo: Geometry, side: Geometry | undefined): void {
	const near = nearOf(geo);
	const spanOf = (it: Item): number => {
		if (it.kind === 'passage') return it.carries?.kind === 'hang' ? it.w : 2 * near;
		let hi = -Infinity;
		let lo = Infinity;
		for (const p of exits.get(it.id) ?? []) {
			if (p.kind !== 'hang') continue;
			hi = Math.max(hi, p.offset + p.half);
			lo = Math.min(lo, p.offset - p.half);
		}
		return hi === -Infinity ? 0 : hi - lo;
	};
	const rowSpan = spec.rows.map((row) => Math.max(2 * near, ...row.map(spanOf)));
	for (const f of spec.families) {
		const h = hangs.get(f.key);
		if (h?.kind === 'bar') rowSpan[h.left.row] = Math.max(rowSpan[h.left.row], 2 * markHalf(f.control, geo, !!side));
	}
	for (const row of spec.rows) for (const it of row) if (it.kind === 'passage' && it.carries?.kind === 'pass') it.w = rowSpan[it.row - 1];
}

/**
 * The smallest distance from each item's left edge to the previous item's (0 for the first of a row): partners side by side keep the
 * couple gap, other cards the node gap, a passage half a node gap from a card and a leg step from another passage; two cards also
 * keep the reach of their ports' marks apart. Sideways a tagged card keeps the room of its tag after it along the stack axis.
 */
export function minGapsOf(rows: Item[][], tagged: ReadonlySet<string>, g: FamilyGraph, geo: Geometry, side: Geometry | undefined, exits: ReadonlyMap<string, Port[]>): number[][] {
	const m = lineMetrics(geo);
	const tagGap = side ? sideTagDepth(side) + m.exitStep : 0;
	// Plain loops: these run for every card of every row in every plan, and a spread of a mapped array costs more than the sum.
	const reachRight = (a: Item) => {
		let r = 0;
		for (const p of exits.get(a.id) ?? []) r = Math.max(r, p.offset + p.half - a.w);
		return r;
	};
	const reachLeft = (b: Item) => {
		let r = 0;
		for (const p of exits.get(b.id) ?? []) r = Math.max(r, p.half - p.offset);
		return r;
	};
	const isCouple = (a: Item, b: Item) => a.kind === 'card' && b.kind === 'card' && (g.unionsOf.get(a.id) ?? []).some((k) => g.unionByKey.get(k)!.partners.includes(b.id));
	/**
	 * Sideways, the signs of the partnerships of side-by-side partners are spread along their gap (two sign sizes apart, centred), so the outer
	 * sign stands (gap / 2 - (n - 1) sign sizes) from the edge of the partner beside it, and its line runs there. The "+" badge of that card
	 * is a disc of `FOLD_BADGE_EM` whose reach beyond the edge is the whole radius (corner radius 0), and a line never passes through it
	 * (spec §13.19). Partners in two sibling blocks have only the node gap: no room. The gap of any such pair with several partnerships is
	 * at least the room the signs and the badge need; a couple of one partnership (the sign in the middle) never needs more.
	 */
	const signsNeed = (a: Item, b: Item): number => {
		if (!side || a.kind !== 'card' || b.kind !== 'card') return 0;
		// Most cards have no second partnership: no count, no array (this runs for every pair of every row in every plan).
		const own = g.unionsOf.get(a.id);
		if (!own || own.length < 2) return 0;
		const n = own.filter((k) => g.unionByKey.get(k)!.partners.includes(b.id)).length;
		return n > 1 ? Math.max(sidewaysPartnerGap({ ...side, coupleGap: 0 }, n), Math.ceil(2 * (n - 1) * side.unionSize + 2 * FOLD_BADGE_EM * side.fontPx)) : 0;
	};
	const gapBetween = (a: Item, b: Item): number => {
		let base: number;
		if (a.kind === 'passage' && b.kind === 'passage') base = m.legStep;
		else if (a.kind === 'passage' || b.kind === 'passage') base = geo.nodeGap / 2;
		else base = Math.max(a.block === b.block && isCouple(a, b) ? geo.coupleGap : geo.nodeGap, reachRight(a) + reachLeft(b), signsNeed(a, b));
		return side && a.kind === 'card' && tagged.has(a.id) ? Math.max(base, tagGap) : base;
	};
	return rows.map((row) => row.map((it, i) => (i === 0 ? 0 : row[i - 1].w + gapBetween(row[i - 1], it))));
}

/**
 * After a placement: the unions that are far by distance (D11): partners in different blocks more than the rule's card widths apart
 * (card centre to card centre), on one row or on two. The caller marks them far and derives the plan again. `skip` holds the couples
 * that came back to near and stay near (`nearAgain`).
 */
export function farByDistance(plan: Plan, far: FarCoupleRule, cardW: number, skip: ReadonlySet<string> = new Set()): string[] {
	const out: string[] = [];
	for (const c of plan.couples.values()) {
		if (c.kind !== 'dot' || c.a.block === c.b.block || skip.has(c.union)) continue;
		if (isFarCouple(probe(c.a), probe(c.b), false, false, far, cardW)) out.push(c.union);
	}
	return out;
}

/**
 * After a placement: the couples among `keys` (made far by distance in an earlier round) whose partners are now within the limit. A
 * tag takes room and a far couple has no passage or leg, so the cards move together when a couple turns far; D11 says such a couple is
 * not far. The caller sets it near and never marks it far again, so every couple changes at most twice and the rounds end.
 */
export function nearAgain(plan: Plan, far: FarCoupleRule, cardW: number, keys: ReadonlySet<string>): string[] {
	const out: string[] = [];
	for (const k of keys) {
		const c = plan.couples.get(k)!;
		if (!isFarCouple(probe(c.a), probe(c.b), false, false, far, cardW)) out.push(k);
	}
	return out;
}

/** The couples that turned far by distance lose their legs and passages and get tags, in the skeleton. Going back to near is a new skeleton (`PlanInput.farKeys`). */
export function markFar(spec: Skeleton, keys: readonly string[]): void {
	for (const key of keys) {
		const c = spec.couples.get(key)!;
		c.kind = 'far';
		spec.tagged.add(c.a.id).add(c.b.id);
		for (const leg of c.legs) {
			for (const p of leg.passages) {
				const block = spec.blocks[p.block];
				block.splice(block.indexOf(p), 1);
				// A passage between the rows was a block of its own: the row forgets it (any far rule with more than one generation reaches this).
				if (!block.length) spec.rowBlocks[p.row].splice(spec.rowBlocks[p.row].indexOf(p.block), 1);
				spec.items.delete(p.id);
			}
		}
		// The anchor's own line to a hang passage stays: the far dot sits there.
		c.legs = c.legs.filter((l) => l.person === spec.anchors.get(key) && !l.passages.length);
	}
	reindex(spec);
}
