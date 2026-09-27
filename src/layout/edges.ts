/**
 * Draws the lines of a finished layout: `routeEdges` is the last step of `layoutTree` (index.ts),
 * called after `layoutFamilies` has placed every card. It shares `lines.ts`'s plan with the
 * layout, so the lanes it draws in are exactly the ones the layout reserved room for.
 * `svg-string.ts` and `render/dom/scene.ts` draw the `EdgeDrawing` this file returns; they do not
 * compute geometry.
 */
import type { FamilyGraph, FamilyUnion } from '../core/derive';
import { lineMetrics } from './geometry';
import { addTo, planLines, type Leg } from './lines';
import type { EdgeDrawing, EdgeMarker, EdgePath, Geometry, StrokeKind, TreeLayout } from './model';
import { turnBack, turnEdges } from './turn';

const r = (n: number) => Math.round(n * 10) / 10;

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
 */
export function routeEdges(g: FamilyGraph, layout: TreeLayout, anchors: Map<string, string> = new Map()): EdgeDrawing {
	if (layout.orientation === 'sideways') return turnEdges(route(g, turnBack(layout), anchors, layout.geometry));
	return route(g, layout, anchors);
}

function route(g: FamilyGraph, layout: TreeLayout, anchors: Map<string, string>, side?: Geometry): EdgeDrawing {
	const paths: EdgePath[] = [];
	const markers: EdgeMarker[] = [];
	const box = (id: string) => layout.persons.get(id)!;
	const geo = layout.geometry;
	const m = lineMetrics(geo);
	const plan = planLines({ g, persons: layout.persons, rows: layout.rows, unions: layout.unions, anchors, geo, side });

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
	const barKind = new Map<string, StrokeKind>();
	for (const fu of g.unions) if (layout.unions.get(fu.key)!.bar) barKind.set(pairOf(fu), coupleKind(fu));
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
			if (barKind.has(pair)) paths.push({ d: `M${r(left.x + left.w)} ${r(u.y)}H${r(right.x)}`, kind: barKind.get(pair)!, people });
			barKind.delete(pair);
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
			paths.push({ d, kind, people: legPeople(leg.person) });
		}
		markers.push(fu.implicit ? { x: u.x, y: u.y, kind: 'implicit-union' } : { x: u.x, y: u.y, kind: 'union', unionType: fu.type });
	}

	// Descent: a trunk to the family's sibling bar, then a drop to each child.
	// A child placed under adoptive or ward parents hangs by a line in that parent type's style;
	// `illegitimate` applies to birth parents only (spec §4.1).
	const dropKind = (k: string): StrokeKind => {
		const type = g.placementType.get(k);
		if (type === 'adoptive' || type === 'ward') return type;
		return g.byId.get(k)!.illegitimate ? 'illegitimate' : 'descent';
	};
	for (const f of plan.families) {
		const top = box(f.kids[0]).y;
		const barY = top - m.barDrop - f.lane * m.barLaneStep;
		const fromY = f.union ? layout.unions.get(f.union)!.y : box(f.parents[0]).y + box(f.parents[0]).h;
		const kinds = f.kids.map(dropKind);
		// The shared trunk takes a special style only when every child in the family has it.
		const trunkKind = kinds.every((k) => k === kinds[0]) ? kinds[0] : 'descent';
		const trunk = `M${r(f.fromX)} ${r(fromY)}V${r(barY)}${f.maxX > f.minX ? `M${r(f.minX)} ${r(barY)}H${r(f.maxX)}` : ''}`;
		paths.push({ d: trunk, kind: trunkKind, people: [...f.parents, ...f.kids] });
		f.kids.forEach((k, i) => {
			paths.push({ d: `M${r(f.dropX[i])} ${r(barY)}V${r(box(k).y)}`, kind: kinds[i], people: [k, ...f.parents] });
		});
	}

	const rumours: { path: number; curve: Curve }[] = [];

	// Side links: curves into the child's top, offset from the main drop. A curve from a dot
	// between two side-by-side partners first drops below their cards, so it clears their corners.
	for (const s of g.secondary) {
		const cb = box(s.child);
		// Sideways the edge is only a card height long: at small fonts 14 px would reach its corner.
		const tx = cb.x + cb.w / 2 + (side ? Math.min(14, cb.w / 2 - m.tagInset) : 14);
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
			paths.push({ d: `M${r(src.x)} ${r(src.y)}${head}C${r(src.x)} ${r(my)} ${r(tx)} ${r(my)} ${r(tx)} ${r(ty)}`, kind, people: src.people });
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
	for (const { path, curve } of rumours) {
		const spot = rumourSpot(curve, all, [firstSeg[path], firstSeg[path] + segs[path].length], dots, !!side);
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

function distance(p: { x: number; y: number }, [x1, y1, x2, y2]: Seg): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len)) : 0;
	return Math.hypot(p.x - x1 - t * dx, p.y - y1 - t * dy);
}

/**
 * The "?" marker's spot on a rumour curve: its middle, or the nearest point along it clear of
 * other lines and dots. Sideways a curve often crosses only one narrow gap between columns full of
 * lanes; when no point is clear there, it takes the point furthest from the other lines.
 * `all` holds the segments of every line; `own` is the range of the curve's own segments in it.
 */
function rumourSpot(curve: Curve, all: Seg[], own: [number, number], dots: { x: number; y: number }[], clearest = false): { x: number; y: number } {
	const other = (i: number) => i < own[0] || i >= own[1];
	// Sideways, only lines near the curve are looked at (the curve lies inside the box of its ends).
	const [sx, sy, , tx, ty] = curve;
	const box = { x0: Math.min(sx, tx) - 40, x1: Math.max(sx, tx) + 40, y0: Math.min(sy, ty) - 40, y1: Math.max(sy, ty) + 40 };
	const lines = clearest ? all.filter(([x1, y1, x2, y2], i) => other(i) && Math.max(x1, x2) >= box.x0 && Math.min(x1, x2) <= box.x1 && Math.max(y1, y2) >= box.y0 && Math.min(y1, y2) <= box.y1) : all;
	// Not sideways, `lines` is every segment, so the curve's own segments are skipped here.
	const skip = (i: number) => !clearest && !other(i);
	const clear = (p: { x: number; y: number }) => lines.every((s, i) => skip(i) || distance(p, s) > 10) && dots.every((d) => Math.hypot(p.x - d.x, p.y - d.y) > 16);
	for (let i = 0; i <= 24; i++) {
		const t = 0.5 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.025;
		const p = bezier(curve, t);
		if (clear(p)) return p;
	}
	if (!clearest) return bezier(curve, 0.5);
	let best = bezier(curve, 0.5);
	let room = -1;
	for (let i = 2; i <= 38; i++) {
		const p = bezier(curve, i / 40);
		const d = Math.min(40, ...lines.map((s) => distance(p, s)), ...dots.map((q) => Math.hypot(p.x - q.x, p.y - q.y) - 6));
		if (d > room) {
			room = d;
			best = p;
		}
	}
	return best;
}
