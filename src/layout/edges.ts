/**
 * Draws the lines of a finished layout: `routeEdges` is the last step of `layoutTree` (index.ts),
 * called after `layoutFamilies` has placed every card. It shares `lines.ts`'s plan with the
 * layout, so the lanes it draws in are exactly the ones the layout reserved room for.
 * `svg-string.ts` and `render/dom/scene.ts` draw the `EdgeDrawing` this file returns; they do not
 * compute geometry.
 */
import type { FamilyGraph, FamilyUnion } from '../core/derive';
import { isRoundel, lineMetrics, roundelAxis, roundelLineEnd } from './geometry';
import type { LineExtras } from './fold-spots';
import { addTo, planLines, tabbedCards, type Leg } from './lines';
import type { EdgeDrawing, EdgeMarker, EdgePath, FoldSpot, Geometry, Rect, StrokeKind, TreeLayout } from './model';
import { turnBack, turnEdges } from './turn';

const r = (n: number) => Math.round(n * 10) / 10;

/** em: how far right of the card middle a dotted side link lands on a Roundel card (B.3.3). */
const SIDE_LINK_EM = 3.4;

// The thin "implicit" style is only for unions that are not listed; a listed union with an
// unknown type (even the text `implicit`) draws like a marriage (spec §5.3).
function coupleKind(fu: FamilyUnion): StrokeKind {
	if (fu.implicit) return 'implicit';
	return fu.type === 'betrothal' || fu.type === 'concubinage' || fu.type === 'affair' ? fu.type : 'marriage';
}

/**
 * Family-tree style edges drawn from final card positions: a bar between side-by-side partners,
 * legs from other partners down to their union dot, a drop from the dot to a sibling bar, and a
 * drop to each child. Side links (adoptive, ward, rumoured, extra parents) are curves. Far
 * couples (D10) get no line between the partners; a union dot with children hangs below the
 * anchor partner.
 *
 * Where lines leave cards and which lane each runs in comes from `planLines`, the same plan the
 * layout used to size the gaps between rows. Legs run sideways only inside those gaps, each in
 * its own lane, so no leg passes behind a card, lies on another line, or runs through a dot.
 *
 * `anchors` (from the model order) names the partner a far couple's dot hangs below.
 *
 * A sideways layout (D24) is routed in the turned frame it was arranged in, and its lines are
 * turned back (`turn.ts`).
 *
 * M10 (F3, F4): `extras` names the people tagged for a hidden partner and the folded families. Each folded
 * family gets one stem, from its union point (or its one parent's card) to the spot of its "+ N" sign,
 * which is read from `layout.folds`; the planner keeps its dot, exit and room.
 */
export function routeEdges(g: FamilyGraph, layout: TreeLayout, anchors: Map<string, string> = new Map(), extras?: LineExtras): EdgeDrawing {
	const spots = new Map<string, FoldSpot>();
	if (extras?.folded?.length) for (const c of layout.folds ?? []) spots.set(c.key, c.spot);
	if (layout.orientation === 'sideways') {
		const turned = new Map([...spots].map(([k, s]) => [k, { x: s.y, y: s.x }]));
		return turnEdges(route(g, turnBack(layout), anchors, layout.geometry, extras, turned));
	}
	return route(g, layout, anchors, undefined, extras, spots);
}

function route(g: FamilyGraph, layout: TreeLayout, anchors: Map<string, string>, side?: Geometry, extras?: LineExtras, spots?: ReadonlyMap<string, FoldSpot>): EdgeDrawing {
	const paths: EdgePath[] = [];
	const markers: EdgeMarker[] = [];
	const box = (id: string) => layout.persons.get(id)!;
	const geo = layout.geometry;
	const m = lineMetrics(geo);
	const plan = planLines({ g, persons: layout.persons, rows: layout.rows, unions: layout.unions, anchors, geo, side, extras, tabbed: tabbedCards(layout.youTab, layout.ordinalCards) });

	// Below the last row: under its tallest card (D37).
	const last = layout.rows[layout.rows.length - 1] ?? [];
	const lastRowTop = layout.rowGaps.length ? layout.rowGaps[layout.rowGaps.length - 1].bottom : 0;
	const lastBottom = last.length ? Math.max(...last.map((id) => box(id).y + box(id).h)) : lastRowTop + geo.cardH;
	const gapTop = (k: number) => (k < layout.rowGaps.length ? layout.rowGaps[k].top : lastBottom);
	const laneY = (gap: number, lane: number) => gapTop(gap) + m.coupleLane0 + lane * m.coupleLaneStep;

	// Couples.
	const legsOf = new Map<string, Leg[]>();
	for (const leg of plan.legs) addTo(legsOf, leg.union, leg);
	// One bar for a couple with several unions side by side, in the style of the last one listed
	// (the latest partnership); each union still has its own dot on it.
	const pairOf = (fu: FamilyUnion) => [...fu.partners].sort().join('\n');
	const barOf = new Map<string, { kind: StrokeKind; union: string }>();
	for (const fu of g.unions) if (layout.unions.get(fu.key)!.bar) barOf.set(pairOf(fu), { kind: coupleKind(fu), union: fu.key });
	for (const fu of g.unions) {
		const u = layout.unions.get(fu.key)!;
		const kind = coupleKind(fu);
		const people = [...fu.partners];
		// A far couple's only line runs from the anchor to the dot; it does not connect the partners.
		const legPeople = (person: string) => (u.far ? [person] : people);
		if (u.bar) {
			const [a, b] = fu.partners.map(box);
			const [left, right] = a.x < b.x ? [a, b] : [b, a];
			const pair = pairOf(fu);
			const shared = barOf.get(pair);
			if (shared) paths.push({ d: `M${r(left.x + left.w)} ${r(u.y)}H${r(right.x)}`, kind: shared.kind, people, union: shared.union });
			barOf.delete(pair);
		} else if (!plan.dots.has(fu.key)) continue;
		const legs = legsOf.get(fu.key) ?? [];
		for (const leg of legs) {
			const p = box(leg.person);
			let d = `M${r(leg.startX)} ${r(p.y + p.h)}`;
			for (const hop of leg.hops) d += `V${r(laneY(hop.gap, hop.lane))}H${r(hop.x)}`;
			// Two legs reaching the dot from the same side: the farther one stops where it meets the nearer.
			const other = legs.find((l) => l !== leg);
			let endX = u.x;
			if (other && Math.sign(other.entryX - u.x) === Math.sign(leg.entryX - u.x) && Math.abs(other.entryX - u.x) < Math.abs(leg.entryX - u.x)) endX = other.entryX;
			d += `V${r(u.y)}`;
			if (endX !== leg.entryX) d += `H${r(endX)}`;
			// `parents` names the partner the leg leaves from (M7: the finder's line takes legs one by one).
			paths.push({ d, kind, people: legPeople(leg.person), union: fu.key, parents: [leg.person] });
		}
		markers.push(fu.implicit ? { x: u.x, y: u.y, kind: 'implicit-union', union: fu.key } : { x: u.x, y: u.y, kind: 'union', unionType: fu.type, union: fu.key });
	}

	// 0.2.5 (B.3.5): a drop that lands on the Roundel's axis stops at the ring of the medallion, or at the top of the arms, and never
	// reaches into them. A drop off the axis, and every drop of another card form, ends on the top edge as before.
	const roundel = !side && isRoundel(geo);
	const dropEnd = (id: string, x: number): number => {
		if (!roundel) return 0;
		const b = box(id);
		return Math.abs(x - (b.x + roundelAxis(geo))) < 0.5 ? roundelLineEnd(geo, { arms: !!b.arms, portrait: !!b.portrait }) : 0;
	};

	// Descent: a trunk to the family's sibling bar, then a drop to each child.
	// A child placed under adoptive or ward parents hangs by a line in that parent type's style;
	// `illegitimate` applies to birth parents only (spec §4.1).
	// A `rumoured` placement exists only in the relation finder's small tree (M7, `lineSubgraph`).
	const dropKind = (k: string): StrokeKind => {
		const type = g.placementType.get(k);
		if (type === 'adoptive' || type === 'ward' || type === 'rumoured') return type;
		return g.byId.get(k)!.illegitimate ? 'illegitimate' : 'descent';
	};
	// Each rumoured line with a `child` gets one "?" marker, in path order (`from`: the first path the
	// marker's search may lie on, when that is not the rumoured line itself; `alt`: the other places
	// it may sit on, on the path `trunk`, when the line itself has no room).
	const rumours: { path: number; curve: Curve; from?: number; alt?: Seg[]; trunk?: number }[] = [];
	for (const f of plan.families) {
		const top = box(f.kids[0]).y;
		const barY = top - m.barDrop - f.lane * m.barLaneStep;
		const fromY = f.union ? layout.unions.get(f.union)!.y : box(f.parents[0]).y + box(f.parents[0]).h;
		const kinds = f.kids.map(dropKind);
		// The shared trunk takes a special style only when every child in the family has it.
		const trunkKind = kinds.every((k) => k === kinds[0]) ? kinds[0] : 'descent';
		const trunk = `M${r(f.fromX)} ${r(fromY)}V${r(barY)}${f.maxX > f.minX ? `M${r(f.minX)} ${r(barY)}H${r(f.maxX)}` : ''}`;
		const family = f.union ? { parents: [...f.parents], union: f.union } : { parents: [...f.parents] };
		const trunkAt = paths.length;
		paths.push({ d: trunk, kind: trunkKind, people: [...f.parents, ...f.kids], ...family });
		f.kids.forEach((k, i) => {
			const end = box(k).y - dropEnd(k, f.dropX[i]);
			paths.push({ d: `M${r(f.dropX[i])} ${r(barY)}V${r(end)}`, kind: kinds[i], people: [k, ...f.parents], ...family, parents: [...f.parents], child: k });
			if (kinds[i] !== 'rumoured') return;
			// A drop in line with its trunk: the "?" may sit anywhere from the parents down to the child.
			const straight = Math.abs(f.dropX[i] - f.fromX) < 0.5;
			const y0 = straight ? fromY : barY;
			const y1 = end;
			const curve: Curve = [f.dropX[i], y0, (y0 + y1) / 2, f.dropX[i], y1];
			if (straight) {
				rumours.push({ path: paths.length - 1, curve, from: trunkAt });
				return;
			}
			// A drop is only `barDrop` long, too short for the "?" sideways or at a small font. Then it sits
			// on the sibling bar between the trunk and this drop, or on the stem above an only child.
			const alt: Seg[] = [[f.fromX, barY, f.dropX[i], barY]];
			if (f.kids.length === 1) alt.push([f.fromX, fromY, f.fromX, barY]);
			rumours.push({ path: paths.length - 1, curve, alt, trunk: trunkAt });
		});
	}

	// M10 (F4): the stem of a folded family ends at the spot of its sign. It is written to 1/1000 px so that it ends where the sign is.
	const fine = (n: number) => Math.round(n * 1000) / 1000;
	for (const st of plan.stems) {
		const spot = spots?.get(st.key);
		if (!spot) continue;
		const fromY = st.union ? layout.unions.get(st.union)!.y : box(st.parents[0]).y + box(st.parents[0]).h;
		// One parent whose exit is not the card's middle: the stem jogs to the sign's place half way.
		const jog = Math.abs(st.fromX - spot.x) > 0.05 ? `V${fine((fromY + spot.y) / 2)}H${fine(spot.x)}` : '';
		const d = `M${fine(st.fromX)} ${fine(fromY)}${jog}V${fine(spot.y)}`;
		paths.push({ d, kind: 'descent', people: [...st.parents], ...(st.union ? { union: st.union } : {}), parents: [...st.parents] });
	}

	// Side links: curves into the child's top, offset from the main drop. A curve from a dot
	// between two side-by-side partners first drops below their cards, so it clears their corners.
	for (const s of g.secondary) {
		const cb = box(s.child);
		// Sideways the edge is only a card height long: at small fonts 14 px would reach its corner.
		// 0.2.5 (B.3.3): in the Roundel the link lands right of the shield and the arms, 7 px left of the D14 sign.
		const tx = cb.x + cb.w / 2 + (side ? Math.min(14, cb.w / 2 - m.tagInset) : roundel ? SIDE_LINK_EM * geo.fontPx : 14);
		const ty = cb.y;
		const sources: { x: number; y: number; drop?: number; people: string[] }[] = [];
		if (s.unionKey) {
			const u = layout.unions.get(s.unionKey)!;
			const partners = g.unionByKey.get(s.unionKey)!.partners;
			const a = box(partners[0]);
			sources.push({ x: u.x, y: u.y, drop: u.bar ? gapTop(a.gen) + m.coupleLane0 : undefined, people: [...partners, s.child] });
		} else {
			for (const p of s.parents) {
				const pb = box(p);
				// To a lower row it drops below the band of far-couple tags first, or a long curve cuts through a
				// neighbour's tag. To the same row or a row above, a drop would send it back up through its own tag.
				// Below the row, not only below this card: a taller card beside it (D37) must not be cut.
				const drop = cb.gen > pb.gen ? gapTop(pb.gen) + m.coupleLane0 : undefined;
				sources.push({ x: plan.sideExits.get(`${s.child}|${p}`) ?? pb.x + pb.w / 2, y: pb.y + pb.h, drop, people: [p, s.child] });
			}
		}
		for (const src of sources) {
			const sy = src.drop ?? src.y;
			const my = (sy + ty) / 2;
			const kind = (s.type === 'birth' ? 'birth-link' : s.type) as StrokeKind;
			const head = src.drop === undefined ? '' : `V${r(sy)}`;
			const link = s.unionKey ? { union: s.unionKey } : {};
			paths.push({ d: `M${r(src.x)} ${r(src.y)}${head}C${r(src.x)} ${r(my)} ${r(tx)} ${r(my)} ${r(tx)} ${r(ty)}`, kind, people: src.people, ...link, parents: [...s.parents], child: s.child });
			if (s.type === 'rumoured') rumours.push({ path: paths.length - 1, curve: [src.x, sy, my, tx, ty] });
		}
	}

	// The "?" of a rumoured parent goes where no other line and no dot is near it.
	const segs = paths.map((p) => segmentsOf(p.d));
	const all = segs.flat();
	const firstSeg: number[] = [];
	let count = 0;
	for (const s of segs) {
		firstSeg.push(count);
		count += s.length;
	}
	const dots = markers.map((mk) => ({ x: mk.x, y: mk.y }));
	const cards = [...layout.persons.values()];
	// The plugin draws the "?" circle 0.5 em wide in radius, the headless pictures 8 px; 2 px more keeps it off the card's edge.
	const cardRoom = Math.max(8, 0.5 * geo.fontPx) + 2;
	const range = (i: number): [number, number] => [firstSeg[i], firstSeg[i] + segs[i].length];
	for (const { path, curve, from, alt, trunk } of rumours) {
		const near = { cards, room: cardRoom, alt: alt && trunk !== undefined ? { segs: alt, own: [range(trunk), range(path)] } : undefined };
		const spot = rumourSpot(curve, all, [firstSeg[from ?? path], firstSeg[path] + segs[path].length], dots, !!side, near);
		dots.push(spot);
		markers.push({ ...spot, kind: 'rumour' });
	}

	return { paths, markers };
}

type Seg = [number, number, number, number];
/** Start x, start y, middle y, end x, end y of a side-link curve (its control points share the middle y). */
type Curve = [number, number, number, number, number];

function bezier([sx, sy, my, tx, ty]: Curve, t: number): { x: number; y: number } {
	const u = 1 - t;
	return { x: u * u * u * sx + 3 * u * u * t * sx + 3 * u * t * t * tx + t * t * t * tx, y: u * u * u * sy + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * ty };
}

/** A path as straight pieces; its curves are cut into short pieces. */
function segmentsOf(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push([x, y, n[0], y]);
			x = n[0];
		} else if (cmd === 'V') {
			out.push([x, y, x, n[0]]);
			y = n[0];
		} else {
			let prev = { x, y };
			for (let i = 1; i <= 16; i++) {
				const p = bezier([x, y, n[1], n[4], n[5]], i / 16);
				out.push([prev.x, prev.y, p.x, p.y]);
				prev = p;
			}
			[x, y] = [n[4], n[5]];
		}
	}
	return out;
}

/** True if `p` is more than `r` from the box of the segment, so more than `r` from the segment: a cheap test before `distance`. */
const beyond = (p: { x: number; y: number }, [x1, y1, x2, y2]: Seg, r: number) => p.x < Math.min(x1, x2) - r || p.x > Math.max(x1, x2) + r || p.y < Math.min(y1, y2) - r || p.y > Math.max(y1, y2) + r;

/** Counts the distance tests of the "?" search (the speed proof of 0.2.4 reads it). */
export const rumourWork = { distances: 0 };

function distance(p: { x: number; y: number }, [x1, y1, x2, y2]: Seg): number {
	rumourWork.distances++;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len)) : 0;
	return Math.hypot(p.x - x1 - t * dx, p.y - y1 - t * dy);
}

type Spot = { x: number; y: number };

/** How far `p` is from the box `b` (0 inside it). */
const boxGap = (p: Spot, b: Rect) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));

/** What the "?" must keep clear of besides lines and dots: every card by `room`, and where else it may sit. */
interface RumourRoom {
	cards: Rect[];
	room: number;
	/** Straight pieces of the rumoured line's trunk the "?" may sit on when the line itself has no room; `own`: the segment ranges (trunk, line) it may touch. */
	alt?: { segs: Seg[]; own: [number, number][] };
}

/**
 * The "?" marker's spot on a rumour curve: its middle, or the nearest point along it clear of
 * other lines, dots and cards. Sideways a curve often crosses only one narrow gap between columns
 * full of lanes; when no point is clear there, it takes the point furthest from the other lines.
 * A short drop with no clear point tries `near.alt` before that. The "?" never covers a card if
 * any point it may take is clear of the cards.
 * `all` holds the segments of every line; `own` is the range of the curve's own segments in it.
 */
function rumourSpot(curve: Curve, all: Seg[], own: [number, number], dots: Spot[], clearest: boolean, near: RumourRoom): Spot {
	const other = (i: number) => i < own[0] || i >= own[1];
	// Only what lies near the curve is looked at: it lies inside the box of its ends, and nothing farther than 40 px
	// (46 for a dot, which counts 6 px less) can change which point is clear or which is the clearest.
	const [sx, sy, , tx, ty] = curve;
	const box = { x0: Math.min(sx, tx) - 40, x1: Math.max(sx, tx) + 40, y0: Math.min(sy, ty) - 40, y1: Math.max(sy, ty) + 40 };
	const lines = all.filter(([x1, y1, x2, y2], i) => other(i) && Math.max(x1, x2) >= box.x0 && Math.min(x1, x2) <= box.x1 && Math.max(y1, y2) >= box.y0 && Math.min(y1, y2) <= box.y1);
	const nearDots = dots.filter((d) => d.x >= box.x0 - 6 && d.x <= box.x1 + 6 && d.y >= box.y0 - 6 && d.y <= box.y1 + 6);
	const nearCards = near.cards.filter((b) => b.x < box.x1 && b.x + b.w > box.x0 && b.y < box.y1 && b.y + b.h > box.y0);
	const offCards = (p: Spot) => near.cards.every((b) => boxGap(p, b) >= near.room);
	// For a point of the curve itself: a card that is 40 px from the curve's box is farther than `room` from the point.
	const offCurveCards = (p: Spot) => nearCards.every((b) => boxGap(p, b) >= near.room);
	const clearOf = (p: Spot, ok: (i: number) => boolean, segs: Seg[], ds: Spot[], offC: (q: Spot) => boolean) => segs.every((s, i) => ok(i) || beyond(p, s, 10) || distance(p, s) > 10) && ds.every((d) => Math.hypot(p.x - d.x, p.y - d.y) > 16) && offC(p);
	const clear = (p: Spot) => clearOf(p, () => false, lines, nearDots, offCurveCards);
	const along = (at: (t: number) => Spot, steps: number): Spot[] => {
		const out: Spot[] = [];
		for (let i = 0; i <= steps; i++) out.push(at(0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (0.5 / Math.ceil(steps / 2))));
		return out;
	};
	for (let i = 0; i <= 24; i++) {
		const t = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.025;
		const p = bezier(curve, t);
		if (clear(p)) return p;
	}
	const altSpots = (near.alt?.segs ?? []).flatMap(([x1, y1, x2, y2]) => along((t) => ({ x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }), 20));
	if (near.alt) {
		const mine = near.alt.own;
		const ok = (i: number) => mine.some(([a, b]) => i >= a && i < b);
		const spot = altSpots.find((p) => clearOf(p, ok, all, dots, offCards));
		if (spot) return spot;
	}
	const mid = bezier(curve, 0.5);
	if (!clearest) {
		if (offCurveCards(mid)) return mid;
	} else {
		let best = mid;
		let room = -1;
		for (let i = 2; i <= 38; i++) {
			const p = bezier(curve, i / 40);
			if (!offCurveCards(p)) continue;
			const d = Math.min(40, ...lines.map((s) => (beyond(p, s, 40) ? 40 : distance(p, s))), ...nearDots.map((q) => Math.hypot(p.x - q.x, p.y - q.y) - 6));
			if (d > room) {
				room = d;
				best = p;
			}
		}
		if (offCurveCards(best)) return best;
	}
	// No place clear of the cards is also clear of the lines: the cards come first. A link between two
	// cards of one row crosses only the gap between them, so there it takes the gap's middle.
	const places = [...along((t) => bezier(curve, t), 200), ...altSpots];
	const free = places.find(offCards);
	if (free) return free;
	const gap = (p: Spot) => Math.min(...near.cards.map((b) => boxGap(p, b)));
	return places.reduce((a, b) => (gap(b) > gap(a) ? b : a));
}
