/*
 * The route stage, the geometry half (stage S4). From the placed items and the ports it builds the nets of every
 * gap (couple lines, hops of passing lines, far dots, stems to hang passages, sibling bars), gives them lanes with a crossing-aware
 * order (lanes.ts), sizes the gaps and sets y. It runs once: the drawing (draw.ts) comes from the same nets that sized the gaps. Every
 * x it uses is an item x or a port x; the only choices it makes are the line of a passage inside its slot and the slot of a child port,
 * both from a short fixed table, and the lanes. Each numbered step is a function with typed inputs and outputs. S4 changes no `Item.x`;
 * the only plan field it writes is `Item.line`.
 * Folds (spec §13.10): a fold control is a mark on a family's stem. A control of a couple's dot hangs below the dot's net as zones of
 * that net (`foldZones`); a control of a bar family or a single parent stands at a fixed place in the gap (a fixed zone), its spot from
 * one placement of those controls on rows set far apart (`placeFoldSpots`: badges and tags of the same row push it).
 * The lane packing keeps every line out of the marks and every tap area off the others and off the tags, and the gap grows to hold the
 * marks above the sibling bars: so the spots are final when the lanes are, and nothing is placed twice.
 */
import type { FamilyGraph } from '../core/derive';
import type { FoldControl } from '../core/folds';
import { FOLD_EM, foldMark, placeFoldSpots, workExtent, type FoldInput } from './fold-spots';
import { isRoundel, lineMetrics, roundelAxis, tagHit, TIE, type LineMetrics } from './geometry';
import { net, orderNets, type Net, type Zone } from './lanes';
import { sideTagHit } from './layout';
import type { Geometry, PersonBox, Rect, UnionPoint } from './model';
import { hangX } from './place';
import { familyKeyOf, hangRow, portX, type Couple, type Family, type Item, type Leg, type Plan } from './plan-model';
import { markHalf, nearOf } from './ports';

/** A vertical line through a gap and how far other lines keep from it (a dot radius and 2 px; more for a stem with a fold control). */
export interface Vert {
	x: number;
	half: number;
}

/** What the route stage reads (the placed plan and the facts of the view). */
export interface RouteInput {
	plan: Plan;
	g: FamilyGraph;
	/** The geometry of the working frame. */
	geo: Geometry;
	/** Set for a sideways tree (the frame is turned); the tags are then placed by the pipeline. */
	side?: Geometry;
	tabbed?: ReadonlySet<string>;
	youTab?: string;
	ordinalCards?: readonly string[];
	/** The folds of the view (spec §13.10). */
	fold?: FoldInput;
}

/** The clear space a mark keeps below itself (a quarter em). With the bar band below it (`barDrop`, at least 1.05 em) this keeps a mark farther from the next row's badge circles than D137 asks (0.8 em), so no control is ever pushed by one. */
export const MARK_CLEAR_EM = 0.25;
/** A mark's zone is its drawn extent and this much more on every side (the stroke and the dot's 2 px of `near`). */
const MARK_PAD_PX = 2;
/**
 * Rows this far apart see only the obstacles of their own gap (the flat placement of the fold controls). The limit: a double has a
 * resolution of about `TIE` from y = 4.3e9, that is from row 4 300 at this step; the chain test `layout-flat-step` reaches 4 000 rows.
 */
const FLAT_STEP = 1e6;
/** The child-port slot tables of the Roundel, in em from the axis (spec §5.2): the axis, two places left of it, one right of it beyond the arms (the arms stand 0.3 em further out). A tabbed card (a "You" or ordinal tab) keeps the left places for the tab. */
const ROUNDEL_SLOTS_EM: readonly number[] = [0, -1.75, -2.5, 3.4];
const ROUNDEL_SLOTS_TABBED_EM: readonly number[] = [0, 3.4];
/** The child-port slots of a plain card, in leg steps from the middle: the middle, two places left, two right (sideways: one right, and only inside the tag insets). */
const PLAIN_SLOTS: readonly number[] = [0, -1, -2, 2, 3];
const SIDE_SLOTS: readonly number[] = [0, -1, -2, 2];

/** Step 1: the hang points. A couple's dot lies on its anchor's hang point; its gap is the row of that point. */
export interface HangPoints {
	/** By family key, and by union key for every couple with a hang point. */
	x: Map<string, number>;
	/** The gap (index of the row above it) a couple's dot lies in. */
	dotGap: Map<string, number>;
}

/** Reads the x of every hang point from the item positions, and the gap of every couple's dot. */
export function hangPoints(plan: Plan, geo: Geometry): HangPoints {
	const x = new Map<string, number>();
	const dotGap = new Map<string, number>();
	for (const c of plan.couples.values()) {
		if (!c.hang) continue;
		x.set(c.union, hangX(c.hang, geo));
		dotGap.set(c.union, hangRow(c.hang));
	}
	for (const f of plan.families) if (!f.union) x.set(f.key, hangX(f.hang, geo));
	return { x, dotGap };
}

/** The gap a family's trunk runs in: above its children's row; a folded family's stem (no child) runs in the gap below its hang point. */
export const stemGap = (plan: Plan, f: Family): number => (f.kids.length ? plan.items.get(f.kids[0])!.row - 1 : hangRow(f.hang));

/** The verticals of each row's bottom edge: the trunks (hang points) and all of them (also the leg ports). */
interface RowVerts {
	trunks: Vert[][];
	verts: Vert[][];
}

/** Step 2a: the verticals that leave each row: hang passages' middles, the ports of the cards, and the dots on bars. */
function rowVerticals(plan: Plan, hp: HangPoints, geo: Geometry, side: Geometry | undefined): RowVerts {
	const familyOf = new Map(plan.families.map((f) => [f.key, f]));
	const trunks: Vert[][] = plan.rows.map(() => []);
	const verts: Vert[][] = plan.rows.map(() => []);
	for (const row of plan.rows) {
		for (const it of row) {
			if (it.kind === 'passage') {
				if (it.carries?.kind !== 'hang') continue;
				it.line = it.x + it.w / 2;
				const v = { x: it.line, half: markHalf(familyOf.get(it.carries.family)?.control, geo, !!side) };
				trunks[it.row].push(v);
				verts[it.row].push(v);
				continue;
			}
			for (const p of plan.exits.get(it.id) ?? []) {
				const v: Vert = { x: portX(p), half: p.half };
				verts[it.row].push(v);
				if (p.kind === 'hang') trunks[it.row].push(v);
			}
		}
	}
	for (const c of plan.couples.values()) {
		if (c.hang?.kind !== 'bar') continue;
		const v: Vert = { x: hp.x.get(c.union)!, half: markHalf(familyOf.get(c.union)?.control, geo, !!side) };
		trunks[c.hang.left.row].push(v);
		verts[c.hang.left.row].push(v);
	}
	return { trunks, verts };
}

/** Step 2b: how the passages of one leg follow each other: the x its port starts at, and the next passage after each. */
function legChains(plan: Plan): { previousX: Map<Item, number>; nextPassage: Map<Item, Item> } {
	const previousX = new Map<Item, number>();
	const nextPassage = new Map<Item, Item>();
	for (const c of plan.couples.values()) {
		for (const leg of c.legs) {
			leg.passages.forEach((p, i) => {
				if (i) nextPassage.set(leg.passages[i - 1], p);
				else previousX.set(p, portX(leg.port));
			});
		}
	}
	return { previousX, nextPassage };
}

/** The verticals of a row sorted by x, with the widest reach among them, so that a slot reads only the window it can touch. */
interface SortedVerts {
	list: Vert[];
	reach: number;
}

const sortVerts = (list: readonly Vert[]): SortedVerts => ({ list: [...list].sort((a, b) => a.x - b.x), reach: list.reduce((m, v) => Math.max(m, v.half), 0) });

/** The verticals whose reach touches [lo, hi]: a binary search for the first, then the run. */
function vertsIn(s: SortedVerts, lo: number, hi: number): Vert[] {
	let a = 0;
	let b = s.list.length;
	// Bounded: every pass halves the range [a, b).
	while (a < b) {
		const m = (a + b) >> 1;
		if (s.list[m].x < lo - s.reach) a = m + 1;
		else b = m;
	}
	const out: Vert[] = [];
	for (let i = a; i < s.list.length && s.list[i].x <= hi + s.reach; i++) out.push(s.list[i]);
	return out;
}

/** How far `x` is from the nearest of the verticals, past their reach (negative: inside one). */
const clearanceFrom = (x: number, from: readonly Vert[]): number => from.reduce((m, v) => Math.min(m, Math.abs(v.x - x) - v.half), Infinity);

/**
 * The places of a passage's slot to try, in order: the line's own previous vertical (a straight pass, no hop), the middle of the slot,
 * then outward from it in `near` steps, then the edges of the slot and of every blocked stretch inside it (so a clear place is found
 * whenever one exists; the slot is as wide as the widest blocked stretch, `slotWidths` in plan.ts).
 */
function slotPlaces(it: Item, own: number | undefined, near: number, blocked: readonly Vert[]): number[] {
	const places: number[] = [];
	if (own !== undefined && own >= it.x - TIE && own <= it.x + it.w + TIE) places.push(own);
	for (let k = 0; k * near < it.w / 2 - TIE; k++) places.push(it.x + it.w / 2 + k * near, it.x + it.w / 2 - k * near);
	places.push(it.x, it.x + it.w);
	for (const v of blocked) for (const edge of [v.x - v.half, v.x + v.half]) if (edge > it.x + TIE && edge < it.x + it.w - TIE) places.push(edge);
	return places;
}

/**
 * A choice of a place by the rule "the first clear one, else the one with the most clearance". `clear` is false when the second
 * branch was taken: the caller reports that as a fallback hit.
 */
interface Choice {
	x: number;
	clear: boolean;
}

/**
 * The first place clear of every vertical of the gap above (the reach of each included). If none is: among the places clear of the
 * `firm` verticals (the hang trunks, whose reach holds a dot or a fold mark that no line may touch) the one with the most clearance
 * from all of them, the leg ports and the lines of the passages as well (a place that is clear of the trunks only could end a hair
 * from a leg port); if no place is clear of the trunks, the one with the most clearance from all. A tie keeps the
 * earlier place.
 */
function clearestPlace(places: readonly number[], from: readonly Vert[], firm: readonly Vert[] = from): Choice {
	const first = places.find((x) => clearanceFrom(x, from) >= -TIE);
	if (first !== undefined) return { x: first, clear: true };
	const firmOk = places.filter((x) => clearanceFrom(x, firm) >= -TIE);
	const pool = firmOk.length ? firmOk : places;
	return { x: pool.reduce((a, b) => (clearanceFrom(b, from) > clearanceFrom(a, from) + TIE ? b : a)), clear: false };
}

/** Called for each place that no clear place was found for: the kind of the fallback and the id of the passage or the child. */
export type OnFallback = (kind: 'passage' | 'child', id: string) => void;

/**
 * Step 2: the line of every passage of a passing couple: the place in its slot clear of every vertical that runs through the whole
 * gap above it (the hang points of the row above, the leg ports of its cards and the lines of its passages), rows top down. A leg
 * port of the row above needs no clearance in the lane order (the lane packer puts its net above the hop, `SAME_X_COST`), but the
 * line itself keeps `near` from it: two verticals closer than that are two lines on one stretch to the eye. A hang passage's line is
 * its middle. Returns the trunk verticals of each row. `onFallback` hears of each passage whose slot had no clear place.
 */
export function passageLines(plan: Plan, hp: HangPoints, geo: Geometry, side: Geometry | undefined, onFallback?: OnFallback): Vert[][] {
	const near = nearOf(geo);
	const step = lineMetrics(geo).legStep;
	const { trunks, verts } = rowVerticals(plan, hp, geo, side);
	const { previousX, nextPassage } = legChains(plan);
	for (const row of plan.rows) {
		const above = row.length && row[0].row > 0 ? row[0].row - 1 : -1;
		const vertsAbove = sortVerts(above < 0 ? [] : verts[above]);
		const trunksSorted = sortVerts(above < 0 ? [] : trunks[above]);
		for (const it of row) {
			if (it.kind !== 'passage' || it.carries?.kind !== 'pass') continue;
			const own = previousX.get(it);
			// The line's own previous vertical is not an obstacle to itself.
			const mine = (v: Vert) => own === undefined || Math.abs(v.x - own) > TIE;
			const all = vertsIn(vertsAbove, it.x, it.x + it.w).filter(mine);
			// A line that runs beside a vertical keeps a leg step from it where the slot allows (two ports of one card stand so far apart); else the first clear place.
			// The verticals a leg step beyond the slot's edges count too, and the ends of their leg-step stretches are places to try.
			const wide = vertsIn(vertsAbove, it.x - step, it.x + it.w + step).filter(mine).map((v) => ({ x: v.x, half: Math.max(v.half, step) }));
			const places = slotPlaces(it, own, near, [...all, ...wide]);
			const roomy = places.find((x, i) => clearanceFrom(x, i === 0 && own !== undefined && x === own ? all : wide) >= -TIE);
			const choice = roomy !== undefined ? { x: roomy, clear: true } : clearestPlace(places, all, vertsIn(trunksSorted, it.x, it.x + it.w));
			if (!choice.clear) onFallback?.('passage', it.id);
			it.line = choice.x;
			trunks[it.row].push({ x: it.line, half: near });
			verts[it.row].push({ x: it.line, half: near });
			const next = nextPassage.get(it);
			if (next) previousX.set(next, it.line);
		}
	}
	return trunks;
}

/** Step 3: the nets of the upper band. */
export interface UpperNets {
	upper: Net[][];
	/** The hops of each leg, in order from its port; the leg then joins its couple's dot net. */
	hops: Map<Leg, Net[]>;
	/** The dot net of each couple with a hang point (a far dot: a net of length 0), and the stem net of each single parent with a hang passage. */
	dotOf: Map<string, Net>;
	/** Verticals that pass a whole gap (a passing line that goes straight through): forbidden for child ports of the row below. */
	through: Vert[][];
}

/** The hops of one leg (a net in the gap above each passage where the line changes x) and the x where the leg arrives at the dot. */
function legHops(plan: Plan, union: string, leg: Leg): { pieces: Net[]; end: number } {
	const pieces: Net[] = [];
	let x = portX(leg.port);
	let row = plan.items.get(leg.person)!.row;
	for (const p of leg.passages) {
		// The hop from the current x to the passage, in the gap above the passage's row; a straight pass needs no net.
		const px = p.line!;
		if (Math.abs(px - x) > TIE) pieces.push(net({ gap: row, lo: Math.min(x, px), hi: Math.max(x, px), key: `hop:${union}|${leg.person}|${row}`, kind: 'hop', topVerts: [x], downVerts: [px] }));
		x = px;
		row = p.row;
	}
	return { pieces, end: x };
}

/** Step 3: the dot nets of the couples (with the hops of their legs) and the stem nets of single parents with a hang passage. */
export function upperNets(plan: Plan, g: FamilyGraph, hp: HangPoints, geo: Geometry): UpperNets {
	const R = plan.rows.length;
	const near = nearOf(geo);
	const upper: Net[][] = Array.from({ length: R }, () => []);
	const through: Vert[][] = Array.from({ length: R }, () => []);
	const hops = new Map<Leg, Net[]>();
	const dotOf = new Map<string, Net>();
	const familyOf = new Map(plan.families.map((f) => [f.key, f]));
	const linked = new Set(g.secondary.map((s) => s.unionKey));
	const hasTrunk = (key: string) => familyOf.has(key) || linked.has(key);
	for (const c of plan.couples.values()) {
		if (c.kind === 'bar' || !c.hang || c.hang.kind !== 'port') continue;
		const xd = hp.x.get(c.union)!;
		const gap = hp.dotGap.get(c.union)!;
		const down = hasTrunk(c.union) ? [xd] : [];
		// The anchor's own line runs straight through the dot when the hang point is on its card; on a hang passage it comes as a leg.
		const top = c.hang.port.item.kind === 'card' ? [xd] : [];
		let lo = xd;
		let hi = xd;
		for (const leg of c.legs) {
			const { pieces, end } = legHops(plan, c.union, leg);
			hops.set(leg, pieces);
			for (const n of pieces) upper[n.gap].push(n);
			top.push(end);
			lo = Math.min(lo, end);
			hi = Math.max(hi, end);
		}
		const kind = c.kind === 'far' ? 'far' : 'dot';
		const dot = net({ gap, lo, hi, key: `${kind}:${c.union}`, kind, topVerts: top, downVerts: down });
		dotOf.set(c.union, dot);
		upper[gap].push(dot);
	}
	for (const f of plan.families) {
		if (!f.stem) continue;
		const xd = hp.x.get(f.key)!;
		const x = portX(f.stem.port);
		const n = net({ gap: plan.items.get(f.parents[0])!.row, lo: Math.min(x, xd), hi: Math.max(x, xd), key: `stem:${f.key}`, kind: 'stem', topVerts: [x], downVerts: [xd] });
		dotOf.set(f.key, n);
		upper[n.gap].push(n);
	}
	// A passage in a row is a vertical through the gap above it (for child ports of that row).
	for (const row of plan.rows) for (const it of row) if (it.kind === 'passage' && it.carries?.kind === 'pass') through[it.row - 1].push({ x: it.line!, half: near });
	return { upper, hops, dotOf, through };
}

/** The places on a child's top edge where its drop may come down, in order of preference. */
function dropSlots(b: Item, geo: Geometry, m: LineMetrics, side: Geometry | undefined, tabbed: ReadonlySet<string> | undefined, youTab: string | undefined): number[] {
	if (!side && isRoundel(geo)) return (tabbed?.has(b.id) || b.id === youTab ? ROUNDEL_SLOTS_TABBED_EM : ROUNDEL_SLOTS_EM).map((e) => b.x + roundelAxis(geo) + e * geo.fontPx);
	const offs = (side ? SIDE_SLOTS : PLAIN_SLOTS).map((k) => k * m.legStep).filter((o) => !side || Math.abs(o) <= b.w / 2 - m.tagInset);
	return offs.map((o) => b.x + b.w / 2 + o);
}

/**
 * An only child's drop goes where its trunk is, as near as its top edge allows: a text card (sideways) anywhere between the tag insets, a plain
 * card as far as its slot table reaches. That is a straight line whenever the trunk meets that stretch. A Roundel keeps its axis and its few
 * places (its table is not a stretch), so it adds none. The slots of the table stay behind it as the next choices.
 */
function straightDrop(b: Item, trunk: number, slots: readonly number[], m: LineMetrics, side: Geometry | undefined, roundel: boolean): number[] {
	if (roundel) return [];
	const lo = side ? b.x + m.tagInset : Math.min(...slots);
	const hi = side ? b.x + b.w - m.tagInset : Math.max(...slots);
	return lo <= hi ? [Math.min(Math.max(trunk, lo), hi)] : [];
}

/**
 * Step 4: child ports: the first slot of the child's table that is clear of every foreign vertical in the gap above (the trunks of
 * the other families with children, the passing lines, and the lines of other couples that leave the row above); if none is clear, the slot farthest beyond the reach of the nearest
 * foreign vertical (a residual choice, never a search beyond the table; `onFallback` hears of it). A drop runs below the sibling bars,
 * under every mark of the upper band, so a foreign trunk needs only `near` there; a folded family's stem ends at its sign and never
 * reaches the drops.
 */
export function childPorts(plan: Plan, hp: HangPoints, through: Vert[][], geo: Geometry, side: Geometry | undefined, tabbed: ReadonlySet<string> | undefined, youTab: string | undefined, onFallback?: OnFallback): Map<string, number> {
	const near = nearOf(geo);
	const m = lineMetrics(geo);
	const trunksIn: Vert[][] = Array.from({ length: plan.rows.length }, () => []);
	for (const f of plan.families) if (f.kids.length) trunksIn[stemGap(plan, f)].push({ x: hp.x.get(f.key)!, half: near });
	// A line that leaves a card for a dot ends in the gap; a drop on its x would read as its continuation.
	const legsIn: { x: number; key: string }[][] = plan.rows.map((row) => row.flatMap((it) => (plan.exits.get(it.id) ?? []).filter((p) => p.kind !== 'hang').map((p) => ({ x: portX(p), key: p.key }))));
	const dropX = new Map<string, number>();
	for (const f of plan.families) {
		if (!f.kids.length) continue;
		const gap = stemGap(plan, f);
		const own = hp.x.get(f.key)!;
		const foreign = [...trunksIn[gap].filter((t) => Math.abs(t.x - own) > TIE), ...through[gap], ...legsIn[gap].filter((l) => l.key !== f.key).map((l) => ({ x: l.x, half: near }))];
		for (const k of f.kids) {
			const slots = dropSlots(plan.items.get(k)!, geo, m, side, tabbed, youTab);
			if (f.kids.length === 1) slots.unshift(...straightDrop(plan.items.get(k)!, own, slots, m, side, !side && isRoundel(geo)));
			const choice = clearestPlace(slots, foreign);
			if (!choice.clear) onFallback?.('child', k);
			dropX.set(k, choice.x);
		}
	}
	return dropX;
}

/** Step 5: the nets of the lower band: the sibling bar of every family with children, from its trunk to its drops. */
export function barNets(plan: Plan, hp: HangPoints, dropX: ReadonlyMap<string, number>): { lower: Net[][]; barOf: Map<string, Net> } {
	const lower: Net[][] = plan.rows.map(() => []);
	const barOf = new Map<string, Net>();
	for (const f of plan.families) {
		if (!f.kids.length) continue;
		const x0 = hp.x.get(f.key)!;
		const drops = f.kids.map((k) => dropX.get(k)!);
		const n = net({ gap: stemGap(plan, f), lo: Math.min(x0, ...drops), hi: Math.max(x0, ...drops), key: `bar:${f.key}`, kind: 'bar', topVerts: [x0], downVerts: drops, owners: f.parents });
		lower[n.gap].push(n);
		barOf.set(f.key, n);
	}
	return { lower, barOf };
}

/** The tag takes the widest stretch of a card's bottom edge between two ports (or a port and the edge), an inset away from each (down). */
export function tagZoneOf(plan: Plan, id: string, m: LineMetrics): { x: number; w: number } {
	const it = plan.items.get(id)!;
	const stops = [m.tagInset, ...(plan.exits.get(id) ?? []).map((p) => p.offset), it.w - m.tagInset];
	let best: [number, number] = [stops[0], stops[0]];
	for (let i = 1; i < stops.length; i++) {
		const lo = stops[i - 1] + (i === 1 ? 0 : m.tagInset);
		const hi = stops[i] - (i === stops.length - 1 ? 0 : m.tagInset);
		if (hi - lo > best[1] - best[0] + TIE) best = [lo, hi];
	}
	return { x: it.x + (best[0] + best[1]) / 2, w: best[1] - best[0] };
}

/**
 * The zones of a control whose stem is at `x` and whose spot is `dy` below the line it hangs on: its visible mark (plus its pad and the
 * clear space below) and its tap area (`foldExtent`, as the spot rules see it in this frame).
 */
export function controlZones(c: FoldControl, x: number, dy: number, geo: Geometry, side: Geometry | undefined): Zone[] {
	const em = geo.fontPx;
	const k = foldMark(c, { x, y: dy }, em, !!side);
	const mark: Zone = { lo: Math.min(k.x1, k.x2) - k.r - MARK_PAD_PX, hi: Math.max(k.x1, k.x2) + k.r + MARK_PAD_PX, top: Math.min(k.y1, k.y2) - k.r - MARK_PAD_PX, bottom: Math.max(k.y1, k.y2) + k.r + MARK_CLEAR_EM * em, kind: 'mark' };
	// The tap area as the spot rules see it: the sideways sign is long along the layout's x, which is y here (`placeFoldSpots`, `areaOf`).
	const r = workExtent(c, { x, y: dy }, em, !!side);
	const hit: Zone = { lo: r.x, hi: r.x + r.w, top: r.y, bottom: r.y + r.h, kind: 'hit' };
	return [mark, hit];
}

/** Step 6: the fold controls as zones. */
interface FoldZones {
	/** The fixed zones of each gap: the controls of bar families and single parents, and the tag tap areas (down). */
	fixed: Zone[][];
	/** The spot of every fixed control: its x and its distance below the top of its gap. */
	fixedSpot: Map<string, { x: number; dy: number }>;
}

/**
 * Sideways: the zone of a tag on the real bottom edge of a card, from the card's real left edge (the turned frame's `h` is the real
 * width): the width between the insets, or, when a partner stacked below is joined by a bar, the left half short of the bar's dot.
 */
export function sideTagZone(plan: Plan, id: string, geo: Geometry): { x: number; w: number } {
	const m = lineMetrics(geo);
	const it = plan.items.get(id)!;
	const lo = m.tagInset;
	// The unions of one pair share a bar, so the first bar to a partner farther along the row decides.
	let bar: Couple | undefined;
	for (const c of plan.couples.values()) {
		if (bar || c.kind !== 'bar' || (c.a !== it && c.b !== it)) continue;
		if ((c.a === it ? c.b : c.a).x > it.x) bar = c;
	}
	if (!bar) return { x: (lo + it.h - m.tagInset) / 2, w: it.h - 2 * m.tagInset };
	const hi = Math.min(it.h / 2, Math.min(bar.a.h, bar.b.h) / 2 - Math.max(m.tagInset, geo.unionSize / 2 + 2));
	return { x: (lo + hi) / 2, w: hi - lo };
}

/** The tap area of a sideways tag in the turned frame (x and y swapped), for a card whose row starts at `rowTop`: as `sideTagHit` makes it in the finished layout. */
export function sideTagRect(plan: Plan, id: string, geo: Geometry, side: Geometry, rowTop: number): Rect {
	const it = plan.items.get(id)!;
	const zone = sideTagZone(plan, id, geo);
	const cards = plan.rows[it.row].filter((x) => x.kind === 'card');
	const next = cards[cards.indexOf(it) + 1];
	// The real rect: from the card's bottom edge `it.x + it.w` (a turned x) down to the next card's top, and `sideTagHit` wide along the edge.
	const real = sideTagHit({ x: rowTop + zone.x, w: zone.w }, it.x + it.w, next === undefined ? Infinity : next.x, side);
	return { x: real.y, y: real.x, w: real.h, h: real.w };
}

/** The cards, bar dots, single parents' hang x and tag areas on rows set `FLAT_STEP` apart: what `placeFoldSpots` reads for the fixed controls. */
function flatSpotInput(plan: Plan, hp: HangPoints, geo: Geometry, side: Geometry | undefined) {
	const m = lineMetrics(geo);
	const flat = new Map<string, PersonBox>();
	for (const row of plan.rows) for (const it of row) if (it.kind === 'card') flat.set(it.id, { id: it.id, x: it.x, y: it.row * FLAT_STEP, w: it.w, h: it.h, gen: it.row });
	const flatUnions = new Map<string, UnionPoint>();
	for (const c of plan.couples.values()) if (c.hang?.kind === 'bar') flatUnions.set(c.union, { key: c.union, x: hp.x.get(c.union)!, y: c.hang.left.row * FLAT_STEP + Math.min(c.hang.left.h, c.hang.right.h) / 2, bar: true, far: false });
	const soloX = new Map<string, number>();
	for (const f of plan.families) if (!f.union && f.hang.kind === 'port' && !f.stem) soloX.set(f.parents[0], hp.x.get(f.key)!);
	const tags = new Map<string, Rect>();
	// Sideways, a tag hangs from the real bottom edge, which in this (turned) frame is the card's right edge: its tap area stands beside the card, so only the spot rules read it.
	const sideTags = new Map<string, Rect>();
	for (const id of plan.tagged) {
		const it = plan.items.get(id)!;
		if (side) sideTags.set(id, sideTagRect(plan, id, geo, side, it.row * FLAT_STEP));
		else tags.set(id, tagHit(tagZoneOf(plan, id, m), it.row * FLAT_STEP + it.h, geo));
	}
	return { flat, flatUnions, soloX, tags, sideTags };
}

/**
 * The controls of bar families and of single parents whose trunk leaves the card are placed once with the same rules on rows set far
 * apart (so only the tags and badges of their own row and each other can push them) and become fixed zones of their gap; the
 * controls of dot couples, and of single parents whose hang point is on a passage (their stem net is the horizontal the trunk hangs
 * from), become zones of that net, `FOLD_EM.afterMarker` below it (the spot rule for a dot; the lane packing keeps that spot clear,
 * so the rules never push it). The tag tap areas (down) are fixed zones too, so a control's tap area never meets one.
 */
export function foldZones(plan: Plan, hp: HangPoints, dotOf: ReadonlyMap<string, Net>, geo: Geometry, side: Geometry | undefined, fold: FoldInput | undefined, rowH: number[]): FoldZones {
	const fixed: Zone[][] = Array.from({ length: plan.rows.length }, () => []);
	const fixedSpot = new Map<string, { x: number; dy: number }>();
	if (!fold?.controls?.length) return { fixed, fixedSpot };
	const familyOf = new Map(plan.families.map((f) => [f.key, f]));
	const onLane = (f: Family) => (f.union !== undefined && f.hang.kind === 'port') || f.stem !== undefined;
	const input = flatSpotInput(plan, hp, geo, side);
	// The tag tap areas of the cards (down), relative to the top of their gap.
	for (const [id, t] of input.tags) {
		const row = plan.items.get(id)!.row;
		const gapTop = row * FLAT_STEP + rowH[row];
		fixed[row].push({ lo: t.x, hi: t.x + t.w, top: t.y - gapTop, bottom: t.y + t.h - gapTop, kind: 'hit' });
	}
	const fixedControls = fold.controls.filter((c) => {
		const f = familyOf.get(familyKeyOf(c));
		return f && !onLane(f);
	});
	for (const r of placeFoldSpots(fixedControls, input.flat, input.flatUnions, [], geo.fontPx, { tags: side ? input.sideTags : input.tags, soloX: input.soloX, turned: !!side })) {
		const c = r.control;
		const f = familyOf.get(familyKeyOf(c))!;
		const gap = hangRow(f.hang);
		const dy = c.spot.y - (gap * FLAT_STEP + rowH[gap]);
		fixedSpot.set(c.key, { x: c.spot.x, dy });
		fixed[gap].push(...controlZones(c, c.spot.x, dy, geo, side));
	}
	for (const c of fold.controls) {
		const f = familyOf.get(familyKeyOf(c));
		if (!f || !onLane(f)) continue;
		const n = dotOf.get(f.key);
		if (n) n.zones.push(...controlZones(c, hp.x.get(f.key)!, FOLD_EM.afterMarker * geo.fontPx, geo, side));
	}
	return { fixed, fixedSpot };
}

/** Step 7: the lanes of every gap. The upper band counts from the top of the gap down, the lower band from the bottom up. */
export function packLanes(upper: Net[][], lower: Net[][], fixed: Zone[][], geo: Geometry): { upperLanes: number[]; lowerLanes: number[] } {
	const m = lineMetrics(geo);
	const near = nearOf(geo);
	return {
		upperLanes: upper.map((nets, gap) => orderNets(nets, m.laneMargin, near, 'down', m.coupleLaneStep, m.coupleLane0, fixed[gap])),
		lowerLanes: lower.map((nets) => orderNets(nets, m.laneMargin, near, 'up', m.barLaneStep, m.barDrop, [], geo.coupleGap)),
	};
}

/** Step 8: y. Rows share their top edge; a gap holds its upper band (lanes, dots and marks), then its bars (at least the row gap). */
export interface RowYs {
	rowTop: number[];
	rowH: number[];
	gapTop: (gap: number) => number;
	laneY: (gap: number, lane: number) => number;
	barY: (gap: number, lane: number) => number;
}

/** The height of every row: the tallest card in it, at least the card height. */
export const rowHeights = (plan: Plan, geo: Geometry): number[] => plan.rows.map((row) => Math.max(geo.cardH, ...row.map((it) => it.h)));

/** Sets the height of every row and gap from the lanes and the marks, and returns the y of every row, lane and bar. */
export function rowYs(plan: Plan, upper: Net[][], fixed: Zone[][], lanes: { upperLanes: number[]; lowerLanes: number[] }, geo: Geometry, side: Geometry | undefined): RowYs {
	const m = lineMetrics(geo);
	const R = plan.rows.length;
	const rowH = rowHeights(plan, geo);
	const markBottom = (n: Net) => Math.max(0, ...n.zones.filter((z) => z.kind === 'mark').map((z) => z.bottom));
	const upperBottom = upper.map((nets, gap) => Math.max(m.coupleLane0 + Math.max(0, lanes.upperLanes[gap] - 1) * m.coupleLaneStep + geo.unionSize / 2 + m.clearance, ...nets.map((n) => m.coupleLane0 + n.lane * m.coupleLaneStep + markBottom(n)), ...fixed[gap].filter((z) => z.kind === 'mark').map((z) => z.bottom)));
	const rowTop: number[] = [side ? 0 : (geo.reach ?? 0)];
	for (let r = 1; r < R; r++) rowTop[r] = rowTop[r - 1] + rowH[r - 1] + Math.max(geo.rowGap, upperBottom[r - 1] + Math.max(0, lanes.lowerLanes[r - 1] - 1) * m.barLaneStep + m.barDrop);
	const gapTop = (k: number) => rowTop[k] + rowH[k];
	return { rowTop, rowH, gapTop, laneY: (gap, lane) => gapTop(gap) + m.coupleLane0 + lane * m.coupleLaneStep, barY: (gap, lane) => rowTop[gap + 1] - m.barDrop - lane * m.barLaneStep };
}
