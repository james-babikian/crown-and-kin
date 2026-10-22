/*
 * The ports of every card (the port stage of `derive` in plan.ts; the architecture notes §4.2.2, stage S2). From the skeleton it requests the
 * ports each card needs (hang ports for the families anchored there, leg ports toward the hang points of partners, side ports), lets
 * legs of one person to one side share a port (D228: one line, then a fork, rule L3), decides whether a card's edge holds its ports
 * (`fits`; if not, the card's hang points move to passages beside it: `overflowHangs`), and packs the ports along the edge.
 * The hang ports are packed from facts that cannot change between the two port runs (the walk's family order and `HangRoom`), so a hang
 * point the placement centred children under never moves afterwards (assumption A4; see `packPorts`).
 */
import { partnerOf, type FamilyGraph, type FamilyUnion } from '../core/derive';
import type { FoldControl } from '../core/folds';
import { foldExtent, foldMark } from './fold-spots';
import { lineMetrics, MIN_HIT, TIE, type LineMetrics } from './geometry';
import type { Geometry } from './model';
import type { Hang, Item, LegSpec, Port, Skeleton } from './plan-model';

/** Two verticals closer than this would touch a union dot (or each other): the dot's radius and 2 px. */
export const nearOf = (geo: Geometry): number => geo.unionSize / 2 + 2;

/**
 * The smallest distance between two plain verticals of one card (px): the checker's 1.5 px for "two lines" plus the stroke width
 * on each side. Lines do not scale with the font, so neither does this.
 */
export const LEG_MIN = 4;

/** How many leg steps the hang ports of one tagged card stand apart where the edge holds them: 24 px at 16 px text, so two stems read as two lines (WP-5f F1). */
const HANG_SPREAD = 2;

/** Which side of `from` the line to `to` goes. */
export type DirOf = (from: Item, to: Item) => 'left' | 'right';

/**
 * How far other verticals keep from a hang point whose stem carries a fold control: the mark's reach across the stem (a sign's half
 * length top to bottom, its half height sideways; a button's radius) and 2 px, never less than the dot's own `near`.
 */
export function markHalf(control: FoldControl | undefined, geo: Geometry, turned: boolean): number {
	const near = nearOf(geo);
	if (!control) return near;
	const k = foldMark(control, { x: 0, y: 0 }, geo.fontPx, turned);
	return Math.max(near, Math.max(Math.abs(k.x1), Math.abs(k.x2)) + k.r + 2);
}

/**
 * Half the width, along the edge, of a control's tap area (`foldExtent`): two hang points of one card whose stems carry controls
 * stand at least the two halves apart, so their tap areas never meet and the lane packing never has to stack them (which would
 * make the gap taller by a tap area for each). Sideways the tap area's extent along the stack axis counts.
 */
export function tapHalf(control: FoldControl, geo: Geometry, turned: boolean): number {
	const r = turned ? foldExtent(control, { x: 0, y: 0 }, geo.fontPx, true) : foldExtent(control, { x: 0, y: 0 }, geo.fontPx);
	return turned ? Math.max(-r.y, r.y + r.h) : Math.max(-r.x, r.x + r.w);
}

/** A key for the pair of partners of a union: unions of one couple (a betrothal, then a marriage) share it, and so share one bar. */
export const pairOf = (fu: FamilyUnion): string => {
	// The two ids in code-unit order, as a sort of the pair gives. It runs for every union in every port run, so it makes no array.
	const [a, b] = fu.partners;
	return a > b ? `${b}\n${a}` : `${a}\n${b}`;
};

/** `pairOf` of the union with this key. */
export const unionPairKey = (g: FamilyGraph, union: string): string => pairOf(g.unionByKey.get(union)!);

/** Whether two cards of one row are joined by a bar (side-by-side partners). */
export const barred = (spec: Skeleton, g: FamilyGraph, a: Item, b: Item): boolean => (g.unionsOf.get(a.id) ?? []).some((k) => spec.couples.get(k)!.kind === 'bar' && g.unionByKey.get(k)!.partners.includes(b.id));

/** The end card, in direction `dir`, of the unit of `it`: the run of cards joined by bars (side-by-side partners, and their side-by-side partners). A passage never parts a unit. */
export function unitEnd(spec: Skeleton, g: FamilyGraph, it: Item, dir: -1 | 1): Item {
	const row = spec.rows[it.row];
	let end = it;
	for (let k = end.at + dir; row[k]; k += dir) {
		if (row[k].kind === 'passage') continue;
		if (!barred(spec, g, end, row[k])) break;
		end = row[k];
	}
	return end;
}

/**
 * The side a leg or side line takes from its card: toward its target; but a side link to a child in the same row leaves from the far
 * end, so that its curve (which loops back to the child's top edge) crosses the stack gap at an angle and not along it, where the
 * bar of a stacked couple lies and the "?" of a rumoured link would find no clear place (as 0.3.0 drew it).
 */
export const lineSide = (dirOf: DirOf, from: Item, p: Pick<Port, 'kind' | 'target' | 'dir'>): 'left' | 'right' => {
	if (!p.target) return p.dir === 'left' ? 'left' : 'right';
	const toward = dirOf(from, p.target);
	if (p.kind === 'side' && p.target.row === from.row) return toward === 'left' ? 'right' : 'left';
	return toward;
};

/** The ports of one tree before the packing: by card, and what each family, leg and stem got. */
export interface Requests {
	byCard: Map<string, Port[]>;
	hangs: Map<string, Hang>;
	legPort: Map<LegSpec, Port>;
	/** The line from a single parent's card to the hang passage of their family, by family key. */
	stemPort: Map<string, Port>;
}

/** The port requests of every card: see the file header. `leanOf` is the walk's guess of each line's side (the same in both runs), `dirOf` the side to pack by. */
export function requestPorts(spec: Skeleton, g: FamilyGraph, geo: Geometry, side: Geometry | undefined, dirOf: DirOf): Requests {
	const { items, couples, anchors } = spec;
	const near = nearOf(geo);
	const byCard = new Map<string, Port[]>();
	const hangs = new Map<string, Hang>();
	const legPort = new Map<LegSpec, Port>();
	const stemPort = new Map<string, Port>();
	const familyOf = new Map(spec.families.map((f) => [f.key, f]));
	// The family of a parent alone, by parent (its key is `soloKey(parent)`; a lookup by that key made a string for every person).
	const soloOf = new Map(spec.families.filter((f) => f.union === undefined).map((f) => [f.parents[0], f]));
	const linked = new Set(g.secondary.map((s) => s.unionKey));
	const request = (item: Item, p: Omit<Port, 'item' | 'offset' | 'half' | 'shared'> & { half?: number }): Port => {
		const port: Port = { item, offset: 0, half: near, shared: [p.key], ...p };
		const list = byCard.get(item.id);
		if (list) list.push(port);
		else byCard.set(item.id, [port]);
		return port;
	};
	/** A hang port: on the family's or couple's hang passage when it has one (then the parent's line is a leg), else on the card. */
	const hangPort = (item: Item, key: string): Port => {
		const control = familyOf.get(key)?.control;
		const half = markHalf(control, geo, !!side);
		const tap = control ? { tap: tapHalf(control, geo, !!side) } : {};
		const passage = spec.hangPassages.get(key);
		if (!passage) return request(item, { kind: 'hang', key, dir: 'centre', half, ...tap });
		return { item: passage, offset: passage.w / 2, kind: 'hang', key, dir: 'centre', half, shared: [key], ...tap };
	};
	// The unions of one couple share a bar: its pair key is made once for each of them (a Map lookup by a new string hashes it every time).
	const barSlots = new Map<string, string[]>();
	const barPair = new Map<string, string>();
	for (const fu of g.unions) {
		if (couples.get(fu.key)!.kind !== 'bar') continue;
		const pair = unionPairKey(g, fu.key);
		barPair.set(fu.key, pair);
		const list = barSlots.get(pair);
		if (list) list.push(fu.key);
		else barSlots.set(pair, [fu.key]);
	}
	for (const id of g.people.map((p) => p.id)) {
		const item = items.get(id)!;
		for (const key of g.unionsOf.get(id) ?? []) {
			const c = couples.get(key)!;
			const fu = g.unionByKey.get(key)!;
			if (c.kind === 'bar') {
				if (fu.partners[0] !== id) continue;
				const [l, r] = c.a.at < c.b.at ? [c.a, c.b] : [c.b, c.a];
				const keys = barSlots.get(barPair.get(key)!)!;
				hangs.set(key, { kind: 'bar', left: l, right: r, slot: keys.indexOf(key), count: keys.length });
				continue;
			}
			// A dot hangs below its anchor when it joins two legs or carries something (children or a side link).
			if (anchors.get(key) === id && (c.kind === 'dot' || familyOf.has(key) || linked.has(key))) hangs.set(key, { kind: 'port', port: hangPort(item, key) });
			// A far couple keeps only the anchor's stem to a hang passage (`markFar`); a dot couple has a leg for every partner off the hang point.
			const leg = c.legs.find((l) => l.person === id);
			if (!leg) continue;
			const other = items.get(partnerOf(fu, id))!;
			const target = leg.passages.length ? leg.passages[0] : (spec.hangPassages.get(key) ?? other);
			legPort.set(leg, request(item, { kind: 'leg', key, dir: dirOf(item, target), target }));
		}
		const solo = soloOf.get(id);
		if (solo) {
			hangs.set(solo.key, { kind: 'port', port: hangPort(item, solo.key) });
			const passage = spec.hangPassages.get(solo.key);
			if (passage) stemPort.set(solo.key, request(item, { kind: 'leg', key: solo.key, dir: dirOf(item, passage), target: passage }));
		}
	}
	for (const s of spec.sideLinks) {
		if (s.union) continue;
		const child = items.get(s.child)!;
		for (const p of s.parents) request(items.get(p)!, { kind: 'side', key: `side:${s.child}|${p}`, dir: lineSide(dirOf, items.get(p)!, { kind: 'side', target: child, dir: 'centre' }), target: child });
	}
	return { byCard, hangs, legPort, stemPort };
}

/** What anchors the ports of a card, taken from facts that cannot change between the two port runs (see `packPorts`). */
export interface HangRoom {
	/** The number of leg and side lines of the card (before legs share a port): the group leaves room for all of them on either side. */
	legs: number;
	/** The corner the hang group of a tagged card takes: the side with fewer lines by the walk's guess. */
	cornerLeft: boolean;
	/** How far from the card's left and right edge every port stays: the tag inset, or more where a mark on the bar to a side-by-side partner, or the card's own marks beside that bar's trunk, reach. */
	keepLeft: number;
	keepRight: number;
}

/**
 * The room of each card: the number of its lines and the corner by the walk's guess (`leanOf`, the same in both runs), and the
 * insets. A port keeps its reach (`half`) from every vertical, and the trunk of a bar beside the card is a vertical that no port
 * of the card owns: the inset on that side is the largest reach of the card's ports plus the bar's reach, less half the gap; and
 * the bar's own mark reaches into the card by its reach less half the gap.
 */
export function hangRooms(spec: Skeleton, req: Requests, g: FamilyGraph, geo: Geometry, side: Geometry | undefined, leanOf: DirOf, m: LineMetrics): Map<string, HangRoom> {
	const keep = new Map<string, { left: number; right: number }>();
	const keepOf = (id: string) => {
		const k = keep.get(id) ?? { left: m.tagInset, right: m.tagInset };
		keep.set(id, k);
		return k;
	};
	const familyOf = new Map(spec.families.map((f) => [f.key, f]));
	const widest = (id: string) => {
		let w = 0;
		for (const p of req.byCard.get(id) ?? []) w = Math.max(w, p.half);
		return w;
	};
	// The reach of a bar's trunk: the largest mark of the unions of its pair (they share one bar), read once for every pair.
	// The unions of one couple are all bars or none is (side by side is a fact of the pair), so only the bars are read.
	const barHalfOf = new Map<string, number>();
	const barPair = new Map<string, string>();
	for (const c of spec.couples.values()) {
		if (c.kind !== 'bar') continue;
		const pair = unionPairKey(g, c.union);
		barPair.set(c.union, pair);
		barHalfOf.set(pair, Math.max(barHalfOf.get(pair) ?? 0, markHalf(familyOf.get(c.union)?.control, geo, !!side)));
	}
	for (const c of spec.couples.values()) {
		if (c.kind !== 'bar') continue;
		const [l, r] = c.a.at < c.b.at ? [c.a, c.b] : [c.b, c.a];
		const gap = (l.block === r.block ? geo.coupleGap : geo.nodeGap) / 2;
		const barHalf = barHalfOf.get(barPair.get(c.union)!)!;
		keepOf(l.id).right = Math.max(keepOf(l.id).right, barHalf - gap, widest(l.id) + barHalf - gap);
		keepOf(r.id).left = Math.max(keepOf(r.id).left, barHalf - gap, widest(r.id) + barHalf - gap);
	}
	const out = new Map<string, HangRoom>();
	for (const [id, list] of req.byCard) {
		let left = 0;
		let right = 0;
		for (const p of list) {
			if (p.kind === 'hang') continue;
			if (lineSide(leanOf, p.item, p) === 'left') left++;
			else right++;
		}
		out.set(id, { legs: left + right, cornerLeft: left <= right, keepLeft: keepOf(id).left, keepRight: keepOf(id).right });
	}
	return out;
}

/** D228 (one line, then a fork): legs of one person to one side, whose dots lie in one gap and whose lines have one style, share a port. */
export function forkLegs(spec: Skeleton, req: Requests, g: FamilyGraph): void {
	for (const [id, list] of req.byCard) {
		const groups = new Map<string, Port>();
		const keep: Port[] = [];
		for (const p of list) {
			if (p.kind !== 'leg') {
				keep.push(p);
				continue;
			}
			const c = spec.couples.get(p.key);
			// A single parent's stem to a hang passage shares with nothing: it is the trunk itself.
			if (!c) {
				keep.push(p);
				continue;
			}
			const fu = g.unionByKey.get(p.key)!;
			// Only legs of one line kind share a stem (a betrothal and a marriage of one couple keep two lines, each in its own style).
			const kind = fu.implicit ? 'implicit' : fu.type;
			const gk = `${p.dir}|${Math.max(c.a.row, c.b.row)}|${kind}`;
			const lead = groups.get(gk);
			const leg = c.legs.find((l) => l.person === id)!;
			if (lead) {
				lead.shared.push(p.key);
				req.legPort.set(leg, lead);
			} else {
				groups.set(gk, p);
				keep.push(p);
			}
		}
		req.byCard.set(id, keep);
	}
}

/** The tag zone between the innermost ports of a tagged card: the smallest hit area and an inset on each side (spec §7.5). */
const tagZoneWidth = (m: LineMetrics) => MIN_HIT + 2 * m.tagInset;

/** The smallest distance between two consecutive ports: a leg's minimum, the reach of a hang port (its dot or mark), or the two tap areas of two controls. */
const stepMin = (a: Port, b: Port) => Math.max(LEG_MIN, a.kind === 'hang' ? a.half : 0, b.kind === 'hang' ? b.half : 0, a.tap !== undefined && b.tap !== undefined ? a.tap + b.tap : 0);

/** The room `count` lines need beside a hang group whose end port reaches `endHalf`, at `step` apart. */
const reserveOf = (count: number, step: number, endHalf: number) => (count ? (count - 1) * step + Math.max(step, endHalf) : 0);

/** The offsets of a group of ports from its first one: `step` apart, or more where a port's mark reaches farther (the larger of the two halves) or two tap areas would meet. */
function group(ports: Port[], step: number): number[] {
	const out: number[] = [];
	let at = 0;
	ports.forEach((p, j) => {
		if (j) at += Math.max(step, stepMin(ports[j - 1], p));
		out.push(at);
	});
	return out;
}

/**
 * The ports of one side, nearest target first (the order of the targets, ties in the order of the requests). Legs of one couple to its
 * anchor (a betrothal and a marriage of the same two people) are equally near; their lines nest around the anchor's hang points, so
 * their order along this edge is the reverse of the order of the hang points as they stand along the edge from left to right. `sign` is
 * 1 where the packing lays the list out from right to left (the left side of a card), -1 where it lays it out from left to right. Any
 * other order makes the two lines cross twice. The ports of one anchor and one distance take each other's places in that order; every
 * other port keeps its place (a port that serves legs to several anchors, by a fork, is moved by each anchor in turn, never by a comparison).
 */
function nearestFirst(list: Port[], farness: (p: Port) => number, spec: Skeleton, sign: 1 | -1): Port[] {
	if (list.length < 2) return list;
	const far = new Map(list.map((p) => [p, Math.abs(farness(p))]));
	const out = [...list].sort((a, b) => far.get(a)! - far.get(b)!);
	const anchorOf = (key: string) => spec.anchors.get(key);
	// The hang rank of a port's legs to one anchor: the lowest of them.
	const rank = (p: Port, anchor: string) => Math.min(...p.shared.filter((k) => anchorOf(k) === anchor).map((k) => spec.hangOrder.get(anchor)?.indexOf(k) ?? Infinity));
	const anchors = new Set<string>();
	for (const p of out) if (p.kind === 'leg') for (const k of p.shared) if (anchorOf(k) !== undefined) anchors.add(anchorOf(k)!);
	for (const anchor of anchors) {
		const byFar = new Map<number, number[]>();
		out.forEach((p, i) => {
			if (p.kind !== 'leg' || !p.shared.some((k) => anchorOf(k) === anchor)) return;
			const at = byFar.get(far.get(p)!);
			if (at) at.push(i);
			else byFar.set(far.get(p)!, [i]);
		});
		for (const places of byFar.values()) {
			if (places.length < 2) continue;
			const members = places.map((i) => out[i]);
			const ranked = members.map((p) => ({ p, r: rank(p, anchor) }));
			// A stable sort: ports of one rank (no hang point known) keep their order.
			ranked.sort((a, b) => sign * (a.r - b.r || 0));
			places.forEach((i, k) => (out[i] = ranked[k].p));
		}
	}
	return out;
}

/**
 * The ports of a card in the three parts of its edge: lines to the left, the hang group (in the walk's family order), lines to the right.
 * `backwards` names the side whose list the packing lays out against its usual direction (the far side of a tagged card steps in from the
 * corner, so its list runs the other way along the edge than the list of the same side of a card without a tag).
 */
function parts(item: Item, ports: Port[], spec: Skeleton, backwards?: 'left' | 'right') {
	const farness = (p: Port): number => {
		if (!p.target) return 0;
		const t = p.target;
		return t.row === item.row ? t.at - item.at : (spec.blockIndex.get(t.block) ?? t.block) - (spec.blockIndex.get(item.block) ?? item.block);
	};
	const order = spec.hangOrder.get(item.id) ?? [];
	return {
		lefts: nearestFirst(ports.filter((p) => p.dir === 'left'), farness, spec, backwards === 'left' ? -1 : 1),
		rights: nearestFirst(ports.filter((p) => p.dir === 'right'), farness, spec, backwards === 'right' ? 1 : -1),
		hangs: ports.filter((p) => p.dir === 'centre').sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
	};
}

/**
 * Whether a card's edge holds its ports at their smallest steps, with room for all its lines on either side of the hang group
 * (the lines' sides are not known before the placement) and, on a tagged card, the tag zone between the group and the far corner.
 * The packing (`packPorts`) uses the same shape with the preferred steps, so a card that fits is never squeezed.
 */
export function fits(item: Item, ports: Port[], tagged: boolean, room: HangRoom, spec: Skeleton, m: LineMetrics): boolean {
	const { lefts, rights, hangs } = parts(item, ports, spec);
	const nh = hangs.length;
	let span = 0;
	for (let j = 1; j < nh; j++) span += stepMin(hangs[j - 1], hangs[j]);
	const legs = room.legs;
	if (!tagged) {
		if (nh === 0) {
			const all = [...lefts, ...rights];
			let need = 0;
			for (let j = 1; j < all.length; j++) need += stepMin(all[j - 1], all[j]);
			return room.keepLeft + need + room.keepRight <= item.w + TIE;
		}
		const reserve = Math.max(reserveOf(legs, LEG_MIN, hangs[0].half), reserveOf(legs, LEG_MIN, hangs[nh - 1].half));
		return room.keepLeft + reserve + span + reserve + room.keepRight <= item.w + TIE;
	}
	const exitL = Math.max(m.exitInset, room.keepLeft);
	const exitR = Math.max(m.exitInset, room.keepRight);
	const end = room.cornerLeft ? hangs[0] : hangs[nh - 1];
	return exitL + reserveOf(legs, LEG_MIN, end?.half ?? 0) + span + tagZoneWidth(m) + reserveOf(legs, LEG_MIN, 0) + exitR <= item.w + TIE;
}

/**
 * The cards whose edge does not hold their ports give their hang points to passages beside the card (`Skeleton.hangPassages`, new
 * items right beside the end of the card's unit). A couple's passage stands on the side its partner's line comes from (by the walk's
 * guess, `leanOf`, the same in both runs), so the two lines meet at the dot from opposite sides; a couple whose partner stands inside
 * the card's unit keeps its hang point on the card (a passage beyond the unit's end would lie beyond both partners, and their lines
 * would run on one stretch). A single parent's passage goes to the side its place in the hang order gives (the first half left).
 * Along a side the hang order holds: the farthest first on the left, the nearest first on the right. The parent's own line to such a
 * hang point is then a leg. Returns whether anything changed (the caller requests the ports again); a card whose remaining ports still
 * do not fit is squeezed by `packPorts` (the last resort).
 */
export function overflowHangs(spec: Skeleton, req: Requests, rooms: ReadonlyMap<string, HangRoom>, g: FamilyGraph, side: Geometry | undefined, leanOf: DirOf, m: LineMetrics): boolean {
	let changed = false;
	for (const [id, ports] of req.byCard) {
		const item = spec.items.get(id)!;
		const room = rooms.get(id)!;
		const tagged = spec.tagged.has(id) && !side;
		if (fits(item, ports, tagged, room, spec, m)) continue;
		const { hangs } = parts(item, ports, spec);
		if (!hangs.length) continue;
		// Right beside the end card of the card's unit on each side, never inside the unit (a bar between side-by-side partners).
		const ends = { left: unitEnd(spec, g, item, -1), right: unitEnd(spec, g, item, 1) };
		const blockL = spec.blocks[ends.left.block];
		const blockR = spec.blocks[ends.right.block];
		const leftAt = blockL.indexOf(ends.left);
		let rightAt = blockR.indexOf(ends.right) + 1;
		const inUnit = (it: Item) => it.row === item.row && it.at >= ends.left.at && it.at <= ends.right.at;
		hangs.forEach((p, i) => {
			const c = spec.couples.get(p.key);
			const partner = c ? (c.legs[0]?.passages.length ? c.legs[0].passages[c.legs[0].passages.length - 1] : c.a === item ? c.b : c.a) : undefined;
			if (partner && inUnit(partner)) return;
			const toLeft = partner ? leanOf(item, partner) === 'left' : i < hangs.length / 2;
			const end = toLeft ? ends.left : ends.right;
			const passage: Item = { id: `~hang:${p.key}`, kind: 'passage', row: item.row, w: 2 * p.half, h: 0, x: item.x, block: end.block, at: 0, carries: { kind: 'hang', family: p.key } };
			spec.items.set(passage.id, passage);
			if (toLeft) {
				blockL.splice(leftAt, 0, passage);
				if (blockR === blockL) rightAt++;
			} else blockR.splice(rightAt++, 0, passage);
			spec.hangPassages.set(p.key, passage);
			// A couple's anchor now reaches its dot by a leg like the other partner.
			if (c && !c.legs.some((l) => l.person === id)) c.legs.push({ family: p.key, person: id, passages: [] });
			changed = true;
		});
	}
	return changed;
}

/**
 * Positions of `count` ports from `anchor` in the direction `dir`: the first `gap` away, the others `step` apart, the row shrunk so that
 * the last one does not pass `limit`. The step shrinks first, to `LEG_MIN`; only then does the first gap shrink, to `gapMin` (the reach
 * of the port it follows). This is the same minimum that `fits` counts, so a card that fits is never squeezed.
 */
function line(anchor: number, dir: -1 | 1, count: number, step: number, limit: number, gap = 0, gapMin = gap): number[] {
	const room = Math.max(0, (limit - anchor) * dir);
	const s = count > 1 ? Math.max(LEG_MIN, Math.min(step, (room - gap) / (count - 1))) : step;
	const g = Math.max(gapMin, Math.min(gap, room - (count - 1) * s));
	return Array.from({ length: count }, (_, k) => anchor + dir * (g + k * s));
}

/** How many ports a stretch of `room` px holds at `LEG_MIN` apart when the first one stands at least `gap` from its start. */
const holds = (room: number, gap: number): number => (room < gap - TIE ? 0 : 1 + Math.floor((room - gap + TIE) / LEG_MIN));

/**
 * How far the first hang port of a group moves from `centre`: 0, unless the two stretches beside the group then hold fewer than the card's `total`
 * leg and side ports at `LEG_MIN` apart while another place holds them all (a short edge at small fonts: the architecture notes §4.2.6 class Q, the card
 * would be squeezed). The group then moves to the place nearest the centre that holds them, where one stretch ends at a whole number of
 * steps. This is the one exception to A4 (second fix round, item 7): the ports of such a card can differ between the two port runs (a fork
 * by side), so its hang point can move after the placement; every other card keeps its group where the placement saw it.
 */
function shiftToHold(centre: number, lo: number, hi: number, gapL: number, gapR: number, total: number): number {
	const capacity = (at: number) => holds(at - lo, gapL) + holds(hi - at, gapR);
	if (capacity(centre) >= total || hi - lo < gapL + gapR - TIE) return 0;
	let best = centre;
	for (let k = 0; k < total; k++) {
		for (const at of [lo + gapL + k * LEG_MIN, hi - gapR - k * LEG_MIN]) {
			if (at < lo + gapL - TIE || at > hi - gapR + TIE || capacity(at) < total) continue;
			if (best === centre || Math.abs(at - centre) < Math.abs(best - centre) - TIE) best = at;
		}
	}
	return best - centre;
}

/**
 * How many of `total` lines (ordered by target, left to right) stand to the left of a hang group: the `wanted` ones whose targets lie
 * left of it, unless the left stretch holds fewer (`left`) or the right stretch cannot hold the rest (`right`). A card whose two
 * stretches together hold fewer than `total` keeps `wanted` and is squeezed.
 */
const leftCount = (wanted: number, total: number, left: number, right: number): number => (left + right < total ? wanted : Math.min(left, Math.max(wanted, total - right)));

/**
 * The step of a group of hang ports: the largest at most `cap` and at least `floor` at which the group, with the wider smallest steps
 * of the pairs whose marks or tap areas reach farther (`stepMin`), still fits in `room`. When every pair takes the step itself this is
 * `room` shared by the pairs; a wider pair takes its own smallest step and the others share the rest.
 */
function fitStep(hangs: readonly Port[], room: number, cap: number, floor: number): number {
	const mins = hangs.slice(1).map((p, j) => stepMin(hangs[j], p)).sort((a, b) => b - a);
	let rest = room;
	for (let k = 0; k < mins.length; k++) {
		const step = rest / (mins.length - k);
		if (step >= mins[k]) return Math.min(cap, Math.max(floor, step));
		rest -= mins[k];
	}
	return floor;
}

/**
 * Packs the ports of one card along its bottom edge. The hang ports come first, from facts that cannot change between the two port
 * runs (the walk's family order and `room`: the number of lines of the card and the walk's guess of the corner), so a hang point
 * the placement centred children under never moves afterwards, and every leg has room on its side whatever side it takes: without
 * a tag the hang group is centred on the edge and leaves room for all the legs on both sides; with a tag (the middle of the edge is
 * the tag's) it stands at the corner the guess gives, inward of room for all the legs. The leg and side ports then step away from
 * the hang group, left targets left, the nearest target nearest (so no two lines of the card cross at the edge); on the far side of
 * a tagged card they step inward from the corner, as today. When the edge is short, the steps shrink to `LEG_MIN` and then the first
 * gap beside the hang group shrinks to the group's reach; if a side still cannot hold its lines, the line nearest the group goes to
 * the other side (its line then passes the group's trunk: a crossing, never a shared place). Only a card whose edge cannot hold its
 * lines at `LEG_MIN` at all (a hostile tree) is squeezed, never widened.
 */
export function packPorts(item: Item, ports: Port[], tagged: boolean, geo: Geometry, spec: Skeleton, room: HangRoom, m = lineMetrics(geo)): Port[] {
	const near = nearOf(geo);
	const { keepLeft: insetL, keepRight: insetR } = room;
	// Most cards have one port: it stands at the middle of the edge, where the packing below would put it too (one decision site, less work).
	if (ports.length === 1 && !tagged && insetL === m.tagInset && insetR === m.tagInset) {
		ports[0].offset = item.w / 2;
		return ports;
	}
	const edge = item.w - insetL - insetR;
	const exitL = Math.max(m.exitInset, insetL);
	const exitR = Math.max(m.exitInset, insetR);
	const parted = parts(item, ports, spec, tagged ? (room.cornerLeft ? 'right' : 'left') : undefined);
	const hangs = parted.hangs;
	let { lefts, rights } = parted;
	const nh = hangs.length;
	const nLegs = room.legs;
	let hangOff: number[];
	let leftOff: number[];
	let rightOff: number[];
	if (!tagged && nh === 0) {
		// Nothing hangs here, so nothing depends on these places: the whole sequence is centred on the edge.
		const all = [...[...lefts].reverse(), ...rights];
		const step = Math.min(m.legStep, all.length > 1 ? edge / (all.length - 1) : m.legStep);
		const offs = all.map((_, i) => (insetL + item.w - insetR) / 2 + (i - (all.length - 1) / 2) * step);
		leftOff = offs.slice(0, lefts.length).reverse();
		rightOff = offs.slice(lefts.length);
		hangOff = [];
	} else if (!tagged) {
		// The group is centred, its step shrunk (never under `near`, so no two dots touch) to leave every leg a place on either side;
		// a port with a wider mark keeps the next port that much farther.
		const reserve = Math.max(reserveOf(nLegs, m.legStep, hangs[0].half), reserveOf(nLegs, m.legStep, hangs[nh - 1].half));
		const stepH = nh > 1 ? fitStep(hangs, edge - 2 * reserve, m.legStep, near) : 0;
		const span = group(hangs, stepH);
		const [gapL, gapR] = [Math.max(LEG_MIN, hangs[0].half), Math.max(LEG_MIN, hangs[nh - 1].half)];
		const sequence = [...[...lefts].reverse(), ...rights];
		const shift = shiftToHold((insetL + item.w - insetR) / 2 - span[nh - 1] / 2, insetL, item.w - insetR - span[nh - 1], gapL, gapR, sequence.length);
		hangOff = span.map((o) => o + (insetL + item.w - insetR) / 2 - span[nh - 1] / 2 + shift);
		// The group stays where it is (A4), unless its card would be squeezed. A side that holds fewer lines than its targets send gives the line nearest the group to the other side.
		const k = leftCount(lefts.length, sequence.length, holds(hangOff[0] - insetL, gapL), holds(item.w - insetR - hangOff[nh - 1], gapR));
		lefts = sequence.slice(0, k).reverse();
		rights = sequence.slice(k);
		leftOff = line(hangOff[0], -1, lefts.length, m.legStep, insetL, Math.max(m.legStep, hangs[0].half), gapL);
		rightOff = line(hangOff[nh - 1], 1, rights.length, m.legStep, item.w - insetR, Math.max(m.legStep, hangs[nh - 1].half), gapR);
	} else {
		const zone = tagZoneWidth(m);
		const endHalf = (p: Port | undefined) => p?.half ?? 0;
		// Two stems that leave one card 8 px apart (an exit step) read as one thick line that splits, and part to opposite sides they are
		// twin stems. The ports of a tagged card therefore stand a leg step (12 px) apart, as on a card without a tag, the lines to a side
		// by `line`, which shrinks the step where the edge is short. The hang ports of two families stand `HANG_SPREAD` leg steps apart
		// (the stems then read as two lines, and fewer lines cross) where the edge holds the group at that step with room for the lines
		// and the tag zone (the same shape as the placement below), else one leg step, else the exit step.
		const roomLeft = exitL + reserveOf(nLegs, LEG_MIN, room.cornerLeft ? endHalf(hangs[0]) : 0);
		const roomRight = exitR + reserveOf(nLegs, LEG_MIN, room.cornerLeft ? 0 : endHalf(hangs[nh - 1])) + zone;
		const spanFits = (offs: number[]) => nh > 0 && roomLeft + offs[nh - 1] + roomRight <= item.w + TIE;
		const spread = group(hangs, HANG_SPREAD * m.legStep);
		const wide = group(hangs, m.legStep);
		const span = spanFits(spread) ? spread : spanFits(wide) ? wide : group(hangs, m.exitStep);
		const spanEnd = nh ? span[nh - 1] : 0;
		if (room.cornerLeft) {
			// The group stands as far in as the lines to its left want, but never so far that the lines to its right and the tag zone do not fit.
			const wanted = exitL + reserveOf(nLegs, m.legStep, endHalf(hangs[0]));
			const most = item.w - exitR - reserveOf(nLegs, LEG_MIN, 0) - zone - spanEnd;
			const first = Math.max(exitL + reserveOf(nLegs, LEG_MIN, endHalf(hangs[0])), Math.min(wanted, most));
			hangOff = span.map((o) => first + o);
			leftOff = line(first, -1, lefts.length, m.legStep, exitL, Math.max(m.legStep, endHalf(hangs[0])), Math.max(LEG_MIN, endHalf(hangs[0])));
			rightOff = line(item.w - exitR, -1, rights.length, m.legStep, (nh ? hangOff[nh - 1] : first - m.legStep) + zone);
		} else {
			const wanted = item.w - exitR - reserveOf(nLegs, m.legStep, endHalf(hangs[nh - 1])) - spanEnd;
			const least = exitL + reserveOf(nLegs, LEG_MIN, 0) + zone;
			const first = Math.min(item.w - exitR - reserveOf(nLegs, LEG_MIN, endHalf(hangs[nh - 1])) - spanEnd, Math.max(wanted, least));
			hangOff = span.map((o) => first + o);
			rightOff = line(nh ? hangOff[nh - 1] : first, 1, rights.length, m.legStep, item.w - exitR, Math.max(m.legStep, endHalf(hangs[nh - 1])), Math.max(LEG_MIN, endHalf(hangs[nh - 1])));
			leftOff = line(exitL, 1, lefts.length, m.legStep, (nh ? hangOff[0] : first + m.legStep) - zone);
		}
	}
	// Every port stays on the card (the last resort for a card that does not fit, see above).
	const clamp = (o: number) => Math.min(item.w - insetR, Math.max(insetL, o));
	hangs.forEach((p, j) => (p.offset = clamp(hangOff[j])));
	lefts.forEach((p, k) => (p.offset = clamp(leftOff[k])));
	rights.forEach((p, k) => (p.offset = clamp(rightOff[k])));
	return [...lefts, ...hangs, ...rights].sort((a, b) => a.offset - b.offset);
}
