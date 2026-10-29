/*
 * The route stage, the drawing half (stage S4). From the lanes and the y of every row (route.ts) it writes the
 * boxes and union points (`TreeLayout`) and the paths and markers (`EdgeDrawing`): couple lines through their dots, trunks, bars and
 * drops, the stems of folded families to their signs, the side links as curves, the "?" of a rumoured parent (the
 * search of rumour-spot.ts), the far tags, and the size of the picture. `routeTree` composes the steps of both halves. It reads the plan
 * and the nets and writes no plan field.
 */
import { partnerOf, type FamilyGraph, type FamilyUnion } from '../core/derive';
import { FOLD_EM, workExtent, type FoldInput } from './fold-spots';
import { barClear, isRoundel, lineMetrics, MIN_HIT, roundelAxis, roundelLineEnd, tagHit, TIE, type LineMetrics } from './geometry';
import type { Net, Zone } from './lanes';
import type { EdgeDrawing, EdgeMarker, EdgePath, FarTag, Geometry, PersonBox, PlacedFoldControl, StrokeKind, TreeLayout, UnionPoint } from './model';
import { familyKeyOf, hangRow, portX, type Couple, type Family, type Plan } from './plan-model';
import { barNets, childPorts, foldZones, hangPoints, packLanes, passageLines, rowHeights, rowYs, sideTagZone, tagZoneOf, upperNets, type HangPoints, type OnFallback, type RouteInput, type RowYs, type UpperNets } from './route';
import { nearOf, pairOf } from './ports';
import { RumourIndex, rumourSpot, segmentsOf, type Curve, type Seg } from './rumour-spot';

/** em: how far right of the card middle a dotted side link lands on a Roundel card. */
const SIDE_LINK_EM = 3.4;
/** px: how far right of the card middle a side link lands on a text card. */
const SIDE_LINK_PX = 14;
/** A drop this near the Roundel's axis ends at the medallion ring, not at the card's edge (half a stroke width). */
const ON_AXIS = 0.5;
/** The "?" disc: half an em in radius in the plugin, at least 8 px in the headless pictures; it keeps 2 px more from every card's edge. */
const RUMOUR_RADIUS_EM = 0.5;
const RUMOUR_RADIUS_MIN_PX = 8;
const RUMOUR_EDGE_PX = 2;
/** Paths are written to a tenth of a px, a stem to a thousandth so that it ends where its sign is. */
const PATH_ROUND = 10;
const STEM_ROUND = 1000;
const r1 = (n: number) => Math.round(n * PATH_ROUND) / PATH_ROUND;
const fine = (n: number) => Math.round(n * STEM_ROUND) / STEM_ROUND;
const exact = (n: number) => n;
/** How a drawing step writes a number into a path. */
type Num = (n: number) => number;

function coupleKind(fu: FamilyUnion): StrokeKind {
	if (fu.implicit) return 'implicit';
	return fu.type === 'betrothal' || fu.type === 'concubinage' || fu.type === 'affair' ? fu.type : 'marriage';
}

/** The routed tree in the working frame. */
export interface Routed {
	layout: TreeLayout;
	edges: EdgeDrawing;
	/** The tag zone of each tagged card (from the card's left edge), for the sideways tags. */
	tagZones: Map<string, { x: number; w: number }>;
	/** The fold controls with their spots in the working frame (the pipeline turns them). */
	folds?: PlacedFoldControl[];
}

/**
 * Sideways (D24), in the turned frame: how far below the top of the row the bar of a couple meets the cards. The middle, unless a tag hangs from
 * the upper partner: its tap area is at least `MIN_HIT` wide and the zone of a short card (small fonts) is narrower, so the area reaches over the
 * middle and over the bar's dot. The bar then moves right, until the dot clears the area by `barClear`; it stays on both cards.
 */
export function barDepth(plan: Plan, c: Couple, geo: Geometry, side: Geometry | undefined): number {
	const middle = Math.min(c.a.h, c.b.h) / 2;
	const upper = c.a.x < c.b.x ? c.a : c.b;
	if (!side || !plan.tagged.has(upper.id)) return middle;
	const zone = sideTagZone(plan, upper.id, geo);
	const need = zone.x + Math.max(MIN_HIT, zone.w) / 2 + barClear(geo);
	return Math.max(middle, Math.min(need, Math.min(c.a.h, c.b.h) - barClear(geo)));
}

/**
 * Sideways, in the turned frame: how far in from the card's edge the tag tap area of the next column starts. It is `tagInset`, but a card with
 * a partner stacked below keeps its tag in the left half (`sideTagZone`), and its area (at least `MIN_HIT` wide) then starts a little less far in.
 */
function nextTagIn(geo: Geometry): number {
	const m = lineMetrics(geo);
	return Math.min(m.tagInset, (m.tagInset + geo.cardH / 2 - barClear(geo)) / 2 - MIN_HIT / 2);
}

/**
 * Sideways: the gap between two columns of cards holds the tap areas of its fold controls, which must not reach the tag areas of the next
 * column (invariant I6, spec 7.5). The lanes of a gap grow with the signs, not with the tap areas, which are wider at small fonts, so this
 * adds to every gap a mark zone that ends where the lowest tap area ends (less what the sibling-bar lanes below it hold anyway). `rowYs` reads it.
 */
export function withTapRoom(upper: readonly (readonly Net[])[], fixed: readonly (readonly Zone[])[], lanes: { lowerLanes: number[] }, geo: Geometry): Zone[][] {
	const m = lineMetrics(geo);
	const next = nextTagIn(geo);
	return fixed.map((zones, gap) => {
		const hits = [...zones.filter((z) => z.kind === 'hit').map((z) => z.bottom), ...upper[gap].flatMap((n) => n.zones.filter((z) => z.kind === 'hit').map((z) => m.coupleLane0 + n.lane * m.coupleLaneStep + z.bottom))];
		if (!hits.length) return [...zones];
		const below = Math.max(0, lanes.lowerLanes[gap] - 1) * m.barLaneStep + m.barDrop;
		return [...zones, { lo: 0, hi: 0, top: 0, bottom: Math.max(...hits) - next - below, kind: 'mark' as const }];
	});
}

/** Step 9: the boxes of the cards and the union points (a bar's point on the bar, a dot's on its net's lane, a far couple's without a hang point below its anchor). */
export function boxes(plan: Plan, g: FamilyGraph, hp: HangPoints, dotOf: ReadonlyMap<string, Net>, ys: RowYs, geo?: Geometry, side?: Geometry): { persons: Map<string, PersonBox>; unions: Map<string, UnionPoint>; rows: string[][] } {
	const persons = new Map<string, PersonBox>();
	const rows: string[][] = plan.rows.map((row) => row.filter((it) => it.kind === 'card').map((it) => it.id));
	for (const row of plan.rows) for (const it of row) if (it.kind === 'card') persons.set(it.id, { id: it.id, x: it.x, y: ys.rowTop[it.row], w: it.w, h: it.h, gen: it.row, ...it.flags });
	const unions = new Map<string, UnionPoint>();
	for (const fu of g.unions) {
		const c = plan.couples.get(fu.key)!;
		if (c.hang?.kind === 'bar') {
			const [a, b] = fu.partners.map((p) => persons.get(p)!);
			unions.set(fu.key, { key: fu.key, x: hp.x.get(fu.key)!, y: a.y + (geo && side ? barDepth(plan, c, geo, side) : Math.min(a.h, b.h) / 2), bar: true, far: false });
			continue;
		}
		const dot = dotOf.get(fu.key);
		const anchor = persons.get(plan.anchors.get(fu.key)!)!;
		if (dot) unions.set(fu.key, { key: fu.key, x: hp.x.get(fu.key)!, y: ys.laneY(dot.gap, dot.lane), bar: false, far: c.kind === 'far' });
		else unions.set(fu.key, { key: fu.key, x: anchor.x + anchor.w / 2, y: ys.laneY(anchor.gen, 0), bar: false, far: c.kind === 'far' });
	}
	return { persons, unions, rows };
}

/** Step 10a: the couple lines: a bar between side-by-side partners (one for all unions of the pair, in the style of the first), else every partner's line to the dot, and the union sign. */
export function drawCouples(plan: Plan, g: FamilyGraph, nets: UpperNets, persons: ReadonlyMap<string, PersonBox>, unions: ReadonlyMap<string, UnionPoint>, ys: RowYs, num: Num = r1): { paths: EdgePath[]; markers: EdgeMarker[] } {
	const paths: EdgePath[] = [];
	const markers: EdgeMarker[] = [];
	const barStyle = new Map<string, { kind: StrokeKind; union: string }>();
	for (const fu of g.unions) if (plan.couples.get(fu.key)!.kind === 'bar') barStyle.set(pairOf(fu), { kind: coupleKind(fu), union: fu.key });
	for (const fu of g.unions) {
		const c = plan.couples.get(fu.key)!;
		const u = unions.get(fu.key)!;
		const kind = coupleKind(fu);
		const people = [...fu.partners];
		if (c.kind === 'bar') {
			const [l, r] = c.a.at < c.b.at ? [c.a, c.b] : [c.b, c.a];
			const shared = barStyle.get(pairOf(fu));
			if (shared) paths.push({ d: `M${num(l.x + l.w)} ${num(u.y)}H${num(r.x)}`, kind: shared.kind, people, union: shared.union });
			barStyle.delete(pairOf(fu));
		} else if (c.hang?.kind === 'port') {
			const dot = nets.dotOf.get(fu.key)!;
			// The anchor's own line: straight down from its card through the dot (when the hang point is on the card).
			if (c.hang.port.item.kind === 'card') {
				const anchor = persons.get(c.hang.port.item.id)!;
				paths.push({ d: `M${num(u.x)} ${num(anchor.y + anchor.h)}V${num(u.y)}`, kind, people: c.kind === 'far' ? [anchor.id] : people, union: fu.key, parents: [anchor.id] });
			}
			for (const leg of c.legs) {
				const p = persons.get(leg.person)!;
				let d = `M${num(portX(leg.port))} ${num(p.y + p.h)}`;
				let x = portX(leg.port);
				for (const n of [...nets.hops.get(leg)!, dot]) {
					const y = ys.laneY(n.gap, n.lane);
					const to = n === dot ? u.x : Math.abs(n.lo - x) <= TIE ? n.hi : n.lo;
					d += `V${num(y)}`;
					if (Math.abs(to - x) > TIE) d += `H${num(to)}`;
					x = to;
				}
				paths.push({ d, kind, people: c.kind === 'far' ? [leg.person] : people, union: fu.key, parents: [leg.person] });
			}
		} else continue;
		markers.push(fu.implicit ? { x: u.x, y: u.y, kind: 'implicit-union', union: fu.key } : { x: u.x, y: u.y, kind: 'union', unionType: fu.type, union: fu.key });
	}
	return { paths, markers };
}

/** A rumoured drop or side link whose "?" is searched after the drawing (`rumourMarkers`). */
export interface Rumour {
	path: number;
	curve: Curve;
	from?: number;
	alt?: Seg[];
	trunk?: number;
}

/** Where a family's trunk starts: the union point of a couple, the card bottom of a single parent, or the stem net's lane for a parent with a hang passage. */
function trunkTop(f: Family, nets: UpperNets, persons: ReadonlyMap<string, PersonBox>, unions: ReadonlyMap<string, UnionPoint>, ys: RowYs): number {
	if (f.union) return unions.get(f.union)!.y;
	const stem = nets.dotOf.get(f.key);
	if (stem) return ys.laneY(stem.gap, stem.lane);
	const b = persons.get(f.parents[0])!;
	return b.y + b.h;
}

/** Step 10b: descent: a single parent's stem to a hang passage, the trunk, the sibling bar and the drops; the rumoured drops are noted for their "?". */
export function drawDescent(plan: Plan, g: FamilyGraph, hp: HangPoints, nets: UpperNets, barOf: ReadonlyMap<string, Net>, dropX: ReadonlyMap<string, number>, persons: ReadonlyMap<string, PersonBox>, unions: ReadonlyMap<string, UnionPoint>, ys: RowYs, geo: Geometry, side: Geometry | undefined, num: Num = r1): { paths: EdgePath[]; rumours: Rumour[] } {
	const roundel = !side && isRoundel(geo);
	const paths: EdgePath[] = [];
	const rumours: Rumour[] = [];
	const dropKind = (k: string): StrokeKind => {
		const type = g.placementType.get(k);
		if (type === 'adoptive' || type === 'ward' || type === 'rumoured') return type;
		return g.byId.get(k)!.illegitimate ? 'illegitimate' : 'descent';
	};
	const dropEnd = (id: string, x: number): number => {
		if (!roundel) return 0;
		const b = persons.get(id)!;
		return Math.abs(x - (b.x + roundelAxis(geo))) < ON_AXIS - TIE ? roundelLineEnd(geo, { arms: !!b.arms, portrait: !!b.portrait }) : 0;
	};
	for (const f of plan.families) {
		const family = f.union ? { parents: [...f.parents], union: f.union } : { parents: [...f.parents] };
		const stem = f.stem ? nets.dotOf.get(f.key) : undefined;
		if (f.stem && stem) {
			const p = persons.get(f.stem.person)!;
			const y = ys.laneY(stem.gap, stem.lane);
			paths.push({ d: `M${num(portX(f.stem.port))} ${num(p.y + p.h)}V${num(y)}H${num(hp.x.get(f.key)!)}`, kind: 'descent', people: [...f.parents, ...f.kids], ...family });
		}
		// A folded family has no bar and no drop: its stem is drawn with the fold controls (`drawFolds`).
		if (!f.kids.length) continue;
		const bar = barOf.get(f.key)!;
		const by = ys.barY(bar.gap, bar.lane);
		const fromX = hp.x.get(f.key)!;
		const fromY = trunkTop(f, nets, persons, unions, ys);
		const kinds = f.kids.map(dropKind);
		const trunkKind = kinds.every((k) => k === kinds[0]) ? kinds[0] : 'descent';
		const trunk = `M${num(fromX)} ${num(fromY)}V${num(by)}${bar.hi - bar.lo > TIE ? `M${num(bar.lo)} ${num(by)}H${num(bar.hi)}` : ''}`;
		const trunkAt = paths.length;
		paths.push({ d: trunk, kind: trunkKind, people: [...f.parents, ...f.kids], ...family });
		f.kids.forEach((k, i) => {
			const x = dropX.get(k)!;
			const end = persons.get(k)!.y - dropEnd(k, x);
			paths.push({ d: `M${num(x)} ${num(by)}V${num(end)}`, kind: kinds[i], people: [k, ...f.parents], ...family, parents: [...f.parents], child: k });
			if (kinds[i] !== 'rumoured') return;
			const straight = Math.abs(x - fromX) < ON_AXIS - TIE;
			const y0 = straight ? fromY : by;
			const curve: Curve = [x, y0, (y0 + end) / 2, x, end];
			if (straight) rumours.push({ path: paths.length - 1, curve, from: trunkAt });
			else {
				const alt: Seg[] = [[fromX, by, x, by]];
				if (f.kids.length === 1) alt.push([fromX, fromY, fromX, by]);
				rumours.push({ path: paths.length - 1, curve, alt, trunk: trunkAt });
			}
		});
	}
	return { paths, rumours };
}

/** Step 10c: the fold controls at their spots (a fixed control at its flat spot below its gap's top, a dot control `afterMarker` below its dot) and the stem of every folded family down to its sign. */
export function drawFolds(plan: Plan, hp: HangPoints, nets: UpperNets, fixedSpot: ReadonlyMap<string, { x: number; dy: number }>, persons: ReadonlyMap<string, PersonBox>, unions: ReadonlyMap<string, UnionPoint>, ys: RowYs, geo: Geometry, fold: FoldInput | undefined): { folds?: PlacedFoldControl[]; paths: EdgePath[] } {
	if (!fold?.controls) return { paths: [] };
	const em = geo.fontPx;
	const familyOf = new Map(plan.families.map((f) => [f.key, f]));
	const folds: PlacedFoldControl[] = [];
	for (const c of fold.controls) {
		const f = familyOf.get(familyKeyOf(c));
		if (!f) continue;
		const at = fixedSpot.get(c.key);
		if (at) folds.push({ ...c, spot: { x: at.x, y: ys.gapTop(hangRow(f.hang)) + at.dy } });
		else {
			// A control on a lane: below its couple's dot, or below the stem net of a single parent whose hang point is on a passage.
			const n = nets.dotOf.get(f.key)!;
			folds.push({ ...c, spot: { x: hp.x.get(f.key)!, y: ys.laneY(n.gap, n.lane) + FOLD_EM.afterMarker * em } });
		}
	}
	const spotOf = new Map(folds.map((c) => [c.key, c.spot]));
	const paths: EdgePath[] = [];
	for (const f of plan.families) {
		if (f.kids.length || !f.control?.folded) continue;
		const spot = spotOf.get(f.control.key);
		if (!spot) continue;
		paths.push({ d: `M${fine(hp.x.get(f.key)!)} ${fine(trunkTop(f, nets, persons, unions, ys))}V${fine(spot.y)}`, kind: 'descent', people: [...f.parents], ...(f.union ? { union: f.union } : {}), parents: [...f.parents] });
	}
	return { folds, paths };
}

/**
 * The control y of a side link's curve that crosses gap `gap` from `sy` down to `ty`. The middle of the gap, as today; but where the curve's
 * middle (its flattest part) would lie within `near` of a sibling bar under it, the curve turns between the couple lines and the bars, so the
 * two do not run alongside each other (random 2 down, a dotted side link along an adoptive bar for 40 px).
 */
function turnY(gap: number, sx: number, sy: number, tx: number, ty: number, ys: RowYs, near: number, bands?: { upper: readonly (readonly Net[])[]; lower: readonly (readonly Net[])[] }): number {
	const my = (sy + ty) / 2;
	const bars = bands?.lower[gap] ?? [];
	const mx = (sx + tx) / 2;
	if (!bars.some((b) => Math.abs(ys.barY(gap, b.lane) - my) < near && mx > b.lo - near && mx < b.hi + near)) return my;
	const top = Math.max(sy, ...bands!.upper[gap].map((n) => ys.laneY(gap, n.lane)));
	const bottom = Math.min(...bars.map((b) => ys.barY(gap, b.lane)));
	// The curve's middle is an eighth of each end and three quarters of the control y: put it halfway between the two bands.
	return ((top + bottom) / 2 - (sy + ty) / 8) / 0.75;
}

/** Step 10d: side links as curves, as today (not routed): from the union dot, or from each parent's side port, to a point right of the child's middle. */
export function drawSideLinks(plan: Plan, g: FamilyGraph, persons: ReadonlyMap<string, PersonBox>, unions: ReadonlyMap<string, UnionPoint>, ys: RowYs, geo: Geometry, side: Geometry | undefined, m: LineMetrics, num: Num = r1, bands?: { upper: readonly (readonly Net[])[]; lower: readonly (readonly Net[])[] }): { paths: EdgePath[]; rumours: Rumour[] } {
	const roundel = !side && isRoundel(geo);
	const paths: EdgePath[] = [];
	const rumours: Rumour[] = [];
	const near = nearOf(geo);
	for (const s of plan.sideLinks) {
		const cb = persons.get(s.child)!;
		const tx = cb.x + cb.w / 2 + (side ? Math.min(SIDE_LINK_PX, cb.w / 2 - m.tagInset) : roundel ? SIDE_LINK_EM * geo.fontPx : SIDE_LINK_PX);
		const ty = cb.y;
		const sources: { x: number; y: number; drop?: number; gap?: number; people: string[] }[] = [];
		if (s.union) {
			const u = unions.get(s.union)!;
			const partners = g.unionByKey.get(s.union)!.partners;
			const a = persons.get(partners[0])!;
			sources.push({ x: u.x, y: u.y, ...(u.bar ? { drop: ys.gapTop(a.gen) + m.coupleLane0 } : {}), gap: a.gen, people: [...partners, s.child] });
		} else {
			for (const port of s.ports) {
				const pb = persons.get(port.item.id)!;
				sources.push({ x: portX(port), y: pb.y + pb.h, ...(cb.gen > pb.gen ? { drop: ys.gapTop(pb.gen) + m.coupleLane0 } : {}), gap: pb.gen, people: [port.item.id, s.child] });
			}
		}
		for (const src of sources) {
			const sy = src.drop ?? src.y;
			const my = src.drop !== undefined && cb.gen === src.gap! + 1 ? turnY(src.gap!, src.x, sy, tx, ty, ys, near, bands) : (sy + ty) / 2;
			const kind = (s.type === 'birth' ? 'birth-link' : s.type) as StrokeKind;
			const head = src.drop === undefined ? '' : `V${num(sy)}`;
			const link = s.union ? { union: s.union } : {};
			paths.push({ d: `M${num(src.x)} ${num(src.y)}${head}C${num(src.x)} ${num(my)} ${num(tx)} ${num(my)} ${num(tx)} ${num(ty)}`, kind, people: src.people, ...link, parents: [...s.parents], child: s.child });
			if (s.type === 'rumoured') rumours.push({ path: paths.length - 1, curve: [src.x, sy, my, tx, ty] });
		}
	}
	return { paths, rumours };
}

/** Step 10e: the "?" of a rumoured parent: where no other line and no dot is near it. */
export function rumourMarkers(paths: readonly EdgePath[], markers: readonly EdgeMarker[], rumours: readonly Rumour[], persons: ReadonlyMap<string, PersonBox>, geo: Geometry, side: Geometry | undefined): EdgeMarker[] {
	if (!rumours.length) return [];
	const out: EdgeMarker[] = [];
	const segs = paths.map((p) => segmentsOf(p.d));
	const all = segs.flat();
	const firstSeg: number[] = [];
	let count = 0;
	for (const s of segs) {
		firstSeg.push(count);
		count += s.length;
	}
	const index = new RumourIndex(all, markers.map((mk) => ({ x: mk.x, y: mk.y })), [...persons.values()]);
	const cardRoom = Math.max(RUMOUR_RADIUS_MIN_PX, RUMOUR_RADIUS_EM * geo.fontPx) + RUMOUR_EDGE_PX;
	const range = (i: number): [number, number] => [firstSeg[i], firstSeg[i] + segs[i].length];
	for (const { path, curve, from, alt, trunk } of rumours) {
		const nearRoom = { room: cardRoom, ...(alt && trunk !== undefined ? { alt: { segs: alt, own: [range(trunk), range(path)] } } : {}) };
		const spot = rumourSpot(curve, index, [firstSeg[from ?? path], firstSeg[path] + segs[path].length], !!side, nearRoom);
		index.addDot(spot);
		out.push({ ...spot, kind: 'rumour' });
	}
	return out;
}

/** The far spouses of `id`, in union order; with folds, the far shown partners and the hidden ones together in the whole graph's order. */
export function farSpouses(g: FamilyGraph, plan: Plan, id: string, fold?: FoldInput): string[] {
	const out: string[] = [];
	const far = new Set<string>();
	for (const k of g.unionsOf.get(id) ?? []) {
		if (plan.couples.get(k)!.kind !== 'far') continue;
		const fu = g.unionByKey.get(k)!;
		far.add(partnerOf(fu, id));
	}
	const hidden = fold?.partners.get(id) ?? [];
	const whole = fold?.full ?? g;
	for (const k of whole.unionsOf.get(id) ?? []) {
		const fu = whole.unionByKey.get(k)!;
		const other = partnerOf(fu, id);
		if ((far.has(other) || hidden.includes(other)) && !out.includes(other)) out.push(other);
	}
	return out;
}

/** Step 11: the tags. Top to bottom: the part of the bottom edge between the innermost ports. Sideways: the zone on the real bottom edge (the pipeline places the tags from it); a partner stacked below (a bar) keeps it to the left half. */
export function tags(plan: Plan, g: FamilyGraph, ys: RowYs, geo: Geometry, side: Geometry | undefined, fold: FoldInput | undefined): { tagZones: Map<string, { x: number; w: number }>; farTags: Map<string, FarTag> } {
	const m = lineMetrics(geo);
	const tagZones = new Map<string, { x: number; w: number }>();
	const farTags = new Map<string, FarTag>();
	for (const id of plan.tagged) {
		const it = plan.items.get(id)!;
		if (side) {
			// One formula for the zone, with the spot rules (route.ts `sideTagZone`).
			tagZones.set(id, sideTagZone(plan, id, geo));
			continue;
		}
		const zone = tagZoneOf(plan, id, m);
		tagZones.set(id, zone);
		const y = ys.rowTop[it.row] + it.h;
		farTags.set(id, { person: id, spouses: farSpouses(g, plan, id, fold), x: zone.x, y, hit: tagHit(zone, y, geo), zoneW: Math.max(0, zone.w) });
	}
	return { tagZones, farTags };
}

/** Routes a placed plan: the steps of route.ts and this file in order. `onFallback` hears of each passage line and child slot that had no clear place. */
export function routeTree({ plan, g, geo, side, tabbed, youTab, ordinalCards, fold }: RouteInput, onFallback?: OnFallback): Routed {
	const m = lineMetrics(geo);
	const hp = hangPoints(plan, geo);
	passageLines(plan, hp, geo, side, onFallback);
	const nets = upperNets(plan, g, hp, geo);
	const dropX = childPorts(plan, hp, nets.through, geo, side, tabbed, youTab, onFallback);
	const { lower, barOf } = barNets(plan, hp, dropX);
	const rowH = rowHeights(plan, geo);
	const zones = foldZones(plan, hp, nets.dotOf, geo, side, fold, rowH);
	const lanes = packLanes(nets.upper, lower, zones.fixed, geo);
	// Sideways the gaps also hold the tap areas of the controls (small fonts: the area is wider than the signs).
	const ys = rowYs(plan, nets.upper, side ? withTapRoom(nets.upper, zones.fixed, lanes, geo) : zones.fixed, lanes, geo, side);
	const { persons, unions, rows } = boxes(plan, g, hp, nets.dotOf, ys, geo, side);
	const draw = (num: Num) => ({ couples: drawCouples(plan, g, nets, persons, unions, ys, num), descent: drawDescent(plan, g, hp, nets, barOf, dropX, persons, unions, ys, geo, side, num), links: drawSideLinks(plan, g, persons, unions, ys, geo, side, m, num, { upper: nets.upper, lower }) });
	const { couples, descent, links } = draw(r1);
	const folds = drawFolds(plan, hp, nets, zones.fixedSpot, persons, unions, ys, geo, fold);
	const pathsOf = (d: ReturnType<typeof draw>) => [...d.couples.paths, ...d.descent.paths, ...folds.paths, ...d.links.paths];
	const paths = pathsOf({ couples, descent, links });
	// The rumours name their paths by index in the lists they came from: offset into the whole list.
	const rumours = [...descent.rumours.map((r) => shiftRumour(r, couples.paths.length)), ...links.rumours.map((r) => shiftRumour(r, couples.paths.length + descent.paths.length + folds.paths.length))];
	// The "?" search must read the exact lines, not the text rounded to a tenth of a px (I7): where there is a rumour, the lines are drawn again unrounded for it.
	const markers = [...couples.markers, ...rumourMarkers(rumours.length ? pathsOf(draw(exact)) : paths, couples.markers, rumours, persons, geo, side)];
	const { tagZones, farTags } = tags(plan, g, ys, geo, side, fold);
	const rowGaps = rows.slice(1).map((_, r) => ({ top: ys.gapTop(r), bottom: ys.rowTop[r + 1] }));
	// The picture holds every item, net, dot, tag and control (its largest mark and hit area, spec §13.10 F5b); the left margin for the controls is the placement's.
	const extents = (folds.folds ?? []).map((c) => workExtent(c, c.spot, geo.fontPx, !!side));
	// Only a line gets the half gap beyond it: a picture whose lines all stay between the cards ends at the last card's edge.
	const lineX = Math.max(0, ...nets.upper.flat().map((n) => n.hi), ...lower.flat().map((n) => n.hi));
	const width = Math.max(0, lineX + geo.nodeGap / 2, ...[...persons.values()].map((p) => p.x + p.w), ...extents.map((b) => b.x + b.w));
	// The gap below the last row has no next row to hold it: the picture holds every net there (the dots and stems of folded families) with its marks.
	const last = plan.rows.length - 1;
	const markBottom = (z: { kind: string; bottom: number }[]) => Math.max(0, ...z.filter((k) => k.kind === 'mark').map((k) => k.bottom));
	const lastBand = last < 0 ? [] : [...nets.upper[last].map((n) => ys.laneY(last, n.lane) + Math.max(geo.unionSize / 2, markBottom(n.zones))), ...zones.fixed[last].filter((z) => z.kind === 'mark').map((z) => ys.gapTop(last) + z.bottom)];
	const height = Math.max(0, ...[...persons.values()].map((p) => p.y + p.h), ...lastBand, ...[...nets.dotOf.keys()].filter((k) => unions.has(k)).map((k) => unions.get(k)!.y + geo.unionSize / 2), ...[...farTags.values()].map((t) => t.hit.y + t.hit.h), ...extents.map((b) => b.y + b.h));
	const layout: TreeLayout = { persons, unions, rows, rowGaps, farTags, width, height, geometry: geo, orientation: 'down', ...(youTab !== undefined ? { youTab } : {}), ...(ordinalCards?.length ? { ordinalCards } : {}), ...(folds.folds ? { folds: folds.folds } : {}) };
	return { layout, edges: { paths, markers }, tagZones, ...(folds.folds ? { folds: folds.folds } : {}) };
}

const shiftRumour = (r: Rumour, by: number): Rumour => ({ ...r, path: r.path + by, ...(r.from !== undefined ? { from: r.from + by } : {}), ...(r.trunk !== undefined ? { trunk: r.trunk + by } : {}) });
