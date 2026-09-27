import type { FamilyGraph } from '../core/derive';
import { barClear, lineMetrics, sideTagDepth, tagTop, type LineMetrics } from './geometry';
import type { Geometry, PersonBox, UnionPoint } from './model';

/**
 * Where every couple leg and sibling bar runs, decided from card x positions and generations
 * only. Placement uses the plan to size each gap between rows; edge routing uses the same plan
 * to draw. Nothing here depends on y, so both get the same answer.
 *
 * No two families share a stretch of line: every vertical line in a gap (a trunk from a union
 * dot or a single parent, a leg, a drop to a child) has its own x, and every sideways run has its
 * own lane.
 */

/** A sideways run inside gap `gap` (below row `gap`) at couple lane `lane`, ending at `x`. */
export interface Hop {
	gap: number;
	lane: number;
	x: number;
}

/** A line from the bottom of a partner's card down to the union dot. */
export interface Leg {
	union: string;
	person: string;
	startX: number;
	/** Jogs through the gaps above the dot's gap, to columns between the cards of the next row. */
	hops: Hop[];
	/** x where the leg reaches the dot's gap and runs sideways to the dot. */
	entryX: number;
}

export interface FamilyLine {
	parents: string[];
	kids: string[];
	union?: string;
	/** x where the trunk leaves the union dot or the single parent's card. */
	fromX: number;
	/** x where each child's drop meets the child's card: its centre, unless another family's trunk is there. */
	dropX: number[];
	/** The gap the sibling bar is in: the one above the children's row. */
	gap: number;
	minX: number;
	maxX: number;
	lane: number;
}

export interface TagZone {
	x: number;
	w: number;
	/** Sideways: the part of the edge the hit area may use, when it is not the zone itself. */
	hit?: { x: number; w: number };
}

export interface LinePlan {
	legs: Leg[];
	/** Union key → gap and couple lane of its dot. Absent for side-by-side couples and dot-less far couples. */
	dots: Map<string, { gap: number; lane: number }>;
	/** Union key → final x of its dot, where it differs from where placement put it. */
	dotX: Map<string, number>;
	families: FamilyLine[];
	/** Where a side link from a single parent leaves that parent's card: `${child}|${parent}`. */
	sideExits: Map<string, number>;
	/** The part of a card's bottom edge a far-couple tag may use (sideways: x from the card's left edge). */
	tagZones: Map<string, TagZone>;
	/** Couple lanes and sibling-bar lanes used in each gap (index = row above the gap). */
	coupleLanes: number[];
	barLanes: number[];
	/** Rightmost x a leg uses; routing around the end of a row can go past the last card. */
	maxX: number;
}

export interface PlanInput {
	g: FamilyGraph;
	persons: Map<string, PersonBox>;
	rows: string[][];
	unions: Map<string, UnionPoint>;
	anchors: Map<string, string>;
	geo: Geometry;
	/**
	 * D24: the sideways card geometry, when `persons` and `unions` are in the turned frame
	 * (`turn.ts`). Lines then leave a card from its real right edge, which is only a card height
	 * long, and a far-couple tag hangs from its real bottom edge into the gap before the next card
	 * of its row, where only the columns of routed legs could cross it.
	 */
	side?: Geometry;
}

export function planLines({ g, persons, rows, unions, anchors, geo, side }: PlanInput): LinePlan {
	const m = lineMetrics(geo);
	const box = (id: string) => persons.get(id)!;
	const centre = (b: PersonBox) => b.x + b.w / 2;
	// Two vertical lines closer than this would touch a union dot (or each other).
	const near = geo.unionSize / 2 + 2;
	const dotUsed = new Set(g.secondary.flatMap((s) => (s.unionKey ? [s.unionKey] : [])));
	const hasDot = (key: string) => {
		const u = unions.get(key)!;
		const fu = g.unionByKey.get(key)!;
		return !u.bar && (!u.far || fu.children.length > 0 || dotUsed.has(key));
	};
	const anchorOf = (key: string) => box(anchors.get(key) ?? g.unionByKey.get(key)!.partners[0]);
	const dotGap = (key: string) => Math.max(...g.unionByKey.get(key)!.partners.map((p) => box(p).gen));

	// x taken by a vertical line in each gap (trunks from dots and single parents).
	const reserved = new Map<number, number[]>();
	const isFree = (gap: number, x: number) => !(reserved.get(gap) ?? []).some((t) => Math.abs(t - x) < near);
	const reserve = (gap: number, x: number) => reserved.set(gap, [...(reserved.get(gap) ?? []), x]);

	// 1. Union dots. A dot between side-by-side partners stays in their gap; other dots move
	//    outwards from their anchor, a step at a time, until no other trunk is there.
	const dotX = new Map<string, number>();
	const ux = (key: string) => dotX.get(key) ?? unions.get(key)!.x;
	for (const fu of g.unions) {
		const u = unions.get(fu.key)!;
		if (u.bar) reserve(box(fu.partners[0]).gen, u.x);
	}
	// A far couple's dot hangs below a corner of the anchor's card when the anchor is in the dot's row (step 2).
	// Sideways, the tag is not on the edge the lines leave from, so the dot needs no corner.
	const farAtCorner = (key: string) => !side && unions.get(key)!.far && hasDot(key) && anchorOf(key).gen === dotGap(key);
	for (const fu of g.unions) {
		if (!hasDot(fu.key) || farAtCorner(fu.key)) continue;
		const gap = dotGap(fu.key);
		const dir = ux(fu.key) >= centre(anchorOf(fu.key)) ? 1 : -1;
		let x = unions.get(fu.key)!.x;
		while (!isFree(gap, x)) x += dir * m.legStep;
		if (x !== unions.get(fu.key)!.x) dotX.set(fu.key, x);
		reserve(gap, x);
	}

	// 2. Exits: where each line leaves the bottom of a card. Tagged cards keep the middle for the tag.
	const tagged = new Set<string>();
	for (const fu of g.unions) if (unions.get(fu.key)!.far) fu.partners.forEach((p) => tagged.add(p));
	const legExit = new Map<string, number>(); // `${union}|${person}`
	const exitsIn = new Map<number, number[]>(); // leg exits by gap
	const soloExit = new Map<string, number>();
	const sideExits = new Map<string, number>();
	const tagZones = new Map<string, TagZone>();
	for (const p of g.people) {
		const b = box(p.id);
		const cx = centre(b);
		const gap = b.gen;
		const legs = (g.unionsOf.get(p.id) ?? []).filter((k) => hasDot(k) && (!unions.get(k)!.far || anchorOf(k).id === p.id));
		const sides = g.secondary.filter((s) => !s.unionKey && s.parents.includes(p.id));
		const solo = (g.soloChildren.get(p.id) ?? []).length > 0;
		const sideOf = (k: string): 'left' | 'right' => (ux(k) >= cx ? 'right' : 'left');
		if (side) {
			const slot = edgeSlots(b, legs.length + sides.length + (solo ? 1 : 0), m, near, (x) => isFree(gap, x), () => reserved.get(gap) ?? []);
			if (solo) {
				const x = slot('left');
				soloExit.set(p.id, x);
				reserve(gap, x);
			}
			for (const k of legs) {
				const x = slot(sideOf(k));
				legExit.set(`${k}|${p.id}`, x);
				exitsIn.set(gap, [...(exitsIn.get(gap) ?? []), x]);
			}
			for (const s of sides) sideExits.set(`${s.child}|${p.id}`, slot(centre(box(s.child)) >= cx ? 'right' : 'left'));
			if (tagged.has(p.id)) {
				// The tag hangs from the real bottom edge. A partner stacked directly below is joined by a
				// bar from the middle of that edge, so the tag then keeps to the left half.
				// Rows get their final y only after planning, so this zone is measured from the card's left edge.
				const below = (g.unionsOf.get(p.id) ?? []).find((k) => unions.get(k)!.bar && g.unionByKey.get(k)!.partners.some((q) => q !== p.id && box(q).x > b.x));
				// The visible tag keeps to the left half; its hit area may reach on to the bar, which
				// placement moved right at small fonts so that the hit area is wide enough.
				const lo = m.tagInset;
				if (below === undefined) tagZones.set(p.id, { x: (lo + b.h - m.tagInset) / 2, w: b.h - 2 * m.tagInset });
				else {
					const reach = unions.get(below)!.y - b.y - barClear(side);
					const hi = Math.min(b.h / 2, reach);
					tagZones.set(p.id, { x: (lo + hi) / 2, w: hi - lo, hit: { x: (lo + reach) / 2, w: reach - lo } });
				}
			}
		} else if (tagged.has(p.id)) {
			const next = { left: 0, right: 0 };
			const inner = { left: b.x, right: b.x + b.w };
			const slot = (side: 'left' | 'right') => {
				let x: number;
				do x = side === 'left' ? b.x + m.exitInset + next[side]++ * m.exitStep : b.x + b.w - m.exitInset - next[side]++ * m.exitStep;
				while (!isFree(gap, x));
				inner[side] = x;
				return x;
			};
			for (const k of legs) {
				const x = slot(sideOf(k));
				legExit.set(`${k}|${p.id}`, x);
				exitsIn.set(gap, [...(exitsIn.get(gap) ?? []), x]);
				if (farAtCorner(k)) {
					dotX.set(k, x);
					reserve(gap, x);
				}
			}
			const fewer = () => (next.left <= next.right ? 'left' : 'right');
			if (solo) {
				const x = slot(fewer());
				soloExit.set(p.id, x);
				reserve(gap, x);
			}
			for (const s of sides) sideExits.set(`${s.child}|${p.id}`, slot(fewer()));
			const lo = next.left ? inner.left + m.tagInset : b.x + m.tagInset;
			const hi = next.right ? inner.right - m.tagInset : b.x + b.w - m.tagInset;
			tagZones.set(p.id, { x: (lo + hi) / 2, w: hi - lo });
		} else {
			const next = { left: 1, right: 1 };
			// The centre belongs to a single parent's trunk; without one, the first line takes it.
			let centreFree = true;
			const slot = (side: 'left' | 'right') => {
				if (centreFree && isFree(gap, cx)) {
					centreFree = false;
					return cx;
				}
				let x: number;
				do x = cx + (side === 'left' ? -1 : 1) * next[side]++ * m.legStep;
				while (!isFree(gap, x));
				return x;
			};
			if (solo) {
				const x = slot('left');
				soloExit.set(p.id, x);
				reserve(gap, x);
			}
			for (const k of legs) {
				const x = slot(sideOf(k));
				legExit.set(`${k}|${p.id}`, x);
				exitsIn.set(gap, [...(exitsIn.get(gap) ?? []), x]);
			}
			for (const s of sides) sideExits.set(`${s.child}|${p.id}`, slot(next.left <= next.right ? 'left' : 'right'));
		}
	}

	// 3. Columns a leg can drop through in each row: between two cards, or past either end.
	const bars = new Set<string>();
	for (const fu of g.unions) {
		if (!unions.get(fu.key)!.bar) continue;
		const [a, b] = fu.partners.map(box);
		bars.add(a.x < b.x ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
	}
	let maxX = 0;
	// A column through row k runs from a lane in the gap above to a lane in the gap below: it must
	// miss the trunks of both gaps and the columns of the rows next to it.
	const taken = new Map<number, number[]>();
	const hit = (k: number, x: number) => (taken.get(k) ?? []).some((t) => Math.abs(t - x) < near);
	// Legs leave cards in row k-1 into the same gap as well.
	const clearOfExits = (gap: number, x: number) => !(exitsIn.get(gap) ?? []).some((t) => Math.abs(t - x) < near);
	const free = (k: number, x: number) => isFree(k - 1, x) && isFree(k, x) && clearOfExits(k - 1, x) && !hit(k - 1, x) && !hit(k, x) && !hit(k + 1, x);
	const take = (k: number, x: number) => taken.set(k, [...(taken.get(k) ?? []), x]);
	// Sideways, a tag and its hit area hang into the gap after its card, and a column crosses that
	// whole gap: it passes below the hit area, `exitStep / 2` clear of it.
	const tagFrom = side ? tagTop(side, 0) - m.exitStep / 2 : 0;
	const tagTo = side ? sideTagDepth(side) + m.exitStep / 2 : 0;
	const inTag = (b: PersonBox, x: number) => !!side && tagged.has(b.id) && x > b.x + b.w + tagFrom && x < b.x + b.w + tagTo;
	const column = (k: number, cur: number, target: number): number | undefined => {
		const row = rows[k].map(box);
		if (free(k, cur) && row.every((b) => (cur <= b.x - geo.nodeGap / 2 || cur >= b.x + b.w + geo.nodeGap / 2) && !inTag(b, cur))) {
			take(k, cur);
			return undefined;
		}
		const candidates: { x: number; penalty: number }[] = [];
		const first = row[0];
		const last = row[row.length - 1];
		const endPad = side && tagged.has(last.id) ? Math.max(geo.nodeGap / 2, tagTo) : geo.nodeGap / 2;
		// Past either end of the row there is always room, one step further out for each leg.
		for (let i = 0; ; i++) {
			const x = last.x + last.w + endPad + i * m.legStep;
			if (free(k, x)) {
				candidates.push({ x, penalty: 0 });
				break;
			}
		}
		for (let i = 0; first.x - geo.nodeGap / 2 - i * m.legStep >= 0; i++) {
			const x = first.x - geo.nodeGap / 2 - i * m.legStep;
			if (free(k, x)) {
				candidates.push({ x, penalty: 0 });
				break;
			}
		}
		for (let i = 1; i < row.length; i++) {
			const a = row[i - 1];
			const b = row[i];
			const mid = (a.x + a.w + b.x) / 2;
			const room = (b.x - a.x - a.w) / 2 - m.exitStep / 2;
			// Between two partners, pass beside their union dot, not through it, and only if nothing better exists.
			const bar = bars.has(`${a.id}|${b.id}`);
			const toward = target >= mid ? 1 : -1;
			const offsets = bar ? [toward * geo.unionSize, -toward * geo.unionSize] : [0, m.exitStep, -m.exitStep, 2 * m.exitStep, -2 * m.exitStep];
			if (side && tagged.has(a.id)) {
				// Only the part of the gap below a's tag is free.
				const lo = a.x + a.w + tagTo;
				const hi = b.x - m.exitStep / 2;
				const base = bar ? mid : (lo + hi) / 2;
				// A gap sized for exactly one leg below the tag has lo = hi, up to rounding.
				const off = offsets.find((o) => base + o >= lo - 0.01 && base + o <= hi + 0.01 && free(k, base + o));
				if (off !== undefined) candidates.push({ x: base + off, penalty: bar ? 2 * a.w : 0 });
				continue;
			}
			const off = offsets.find((o) => Math.abs(o) <= room && free(k, mid + o));
			if (off !== undefined) candidates.push({ x: mid + off, penalty: bar ? 2 * a.w : 0 });
		}
		let best = candidates[0];
		let bestCost = Infinity;
		for (const c of candidates) {
			const cost = Math.abs(c.x - cur) + Math.abs(c.x - target) + c.penalty;
			if (cost < bestCost) {
				best = c;
				bestCost = cost;
			}
		}
		take(k, best.x);
		maxX = Math.max(maxX, best.x);
		return best.x;
	};

	// 4. Legs, and the sideways runs that need a couple lane.
	interface Run {
		gap: number;
		lo: number;
		hi: number;
		set: (lane: number) => void;
	}
	const runs: Run[] = [];
	const legs: Leg[] = [];
	const dots = new Map<string, { gap: number; lane: number }>();
	for (const fu of g.unions) {
		if (!hasDot(fu.key)) continue;
		const u = unions.get(fu.key)!;
		const gap = dotGap(fu.key);
		const x0 = ux(fu.key);
		const from = u.far ? [anchorOf(fu.key)] : fu.partners.map(box);
		const mine: Leg[] = [];
		for (const p of from) {
			const startX = legExit.get(`${fu.key}|${p.id}`)!;
			const leg: Leg = { union: fu.key, person: p.id, startX, hops: [], entryX: startX };
			for (let k = p.gen + 1; k <= gap && k < rows.length; k++) {
				const x = column(k, leg.entryX, x0);
				if (x === undefined) continue;
				const hop: Hop = { gap: k - 1, lane: 0, x };
				runs.push({ gap: k - 1, lo: Math.min(leg.entryX, x), hi: Math.max(leg.entryX, x), set: (lane) => (hop.lane = lane) });
				leg.hops.push(hop);
				leg.entryX = x;
			}
			mine.push(leg);
		}
		legs.push(...mine);
		const dot = { gap, lane: 0 };
		dots.set(fu.key, dot);
		const xs = [x0, ...mine.map((l) => l.entryX)];
		runs.push({ gap, lo: Math.min(...xs), hi: Math.max(...xs), set: (lane) => (dot.lane = lane) });
	}
	const coupleLanes = pack(runs, rows.length, m.laneMargin);

	// 5. Sibling bars, one lane per overlapping family (spec §5.3: 12 px apart).
	const families: FamilyLine[] = [];
	const addFamily = (fromX: number, parents: string[], kids: string[], union?: string) => {
		if (!kids.length) return;
		const gap = box(kids[0]).gen - 1;
		const others = [...(reserved.get(gap) ?? [])];
		const own = others.indexOf(fromX);
		if (own >= 0) others.splice(own, 1);
		// A child sits under another family's trunk: its drop meets the card beside the centre.
		const dropX = kids.map((k) => {
			const b = box(k);
			// Sideways the edge a drop meets is only a card height long.
			const offsets = side ? [0, -m.legStep, -2 * m.legStep, 2 * m.legStep].filter((o) => Math.abs(o) <= b.w / 2 - m.tagInset) : [0, -m.legStep, -2 * m.legStep, 2 * m.legStep, 3 * m.legStep];
			for (const off of offsets) {
				const x = centre(b) + off;
				if (!others.some((t) => Math.abs(t - x) < near)) return x;
			}
			// Sideways the few places above are soon taken: the spot on the edge furthest from every trunk.
			if (side) return clearestSpot(b, m, [], others, near);
			return centre(b);
		});
		families.push({ parents, kids, union, fromX, dropX, gap, minX: Math.min(fromX, ...dropX), maxX: Math.max(fromX, ...dropX), lane: 0 });
	};
	for (const fu of g.unions) addFamily(ux(fu.key), [...fu.partners], fu.children, fu.key);
	for (const [parent, kids] of g.soloChildren) addFamily(soloExit.get(parent)!, [parent], kids);
	const barLanes = new Array<number>(rows.length).fill(0);
	const byGap = new Map<number, FamilyLine[]>();
	for (const f of families) byGap.set(f.gap, [...(byGap.get(f.gap) ?? []), f]);
	for (const [gap, list] of byGap) {
		list.sort((a, b) => a.minX - b.minX);
		const below = orderBars(list);
		const done = new Set<FamilyLine>();
		let used = 0;
		while (done.size < list.length) {
			// Left to right, but a bar only after the bars that must lie below it; lowest free lane above them.
			const f = list.find((x) => !done.has(x) && below.get(x)!.every((y) => done.has(y))) ?? list.find((x) => !done.has(x))!;
			let lane = Math.max(-1, ...below.get(f)!.filter((y) => done.has(y)).map((y) => y.lane)) + 1;
			while (list.some((y) => done.has(y) && y.lane === lane && barsClash(y, f))) lane++;
			f.lane = lane;
			done.add(f);
			used = Math.max(used, lane + 1);
		}
		if (gap >= 0) barLanes[gap] = used;
	}

	return { legs, dots, dotX, families, sideExits, tagZones, coupleLanes, barLanes, maxX };
}

/**
 * D24: where the lines leave one card's edge when that edge is only a card height long (the real
 * right edge of a sideways card). The first line takes the middle; each next one steps outwards on
 * its preferred side, then on the other, keeping 0.5 em clear of the corners. When more lines
 * leave than fit at the usual step, the step shrinks so that every line still leaves the card
 * itself, each at its own place.
 */
function edgeSlots(b: PersonBox, n: number, m: LineMetrics, near: number, free: (x: number) => boolean, trunks: () => number[]): (pref: 'left' | 'right') => number {
	const half = b.w / 2 - m.tagInset;
	const cx = b.x + b.w / 2;
	const step = Math.min(m.legStep, half / Math.max(1, Math.ceil((n - 1) / 2)));
	const used: number[] = [];
	const ok = (x: number) => free(x) && used.every((u) => Math.abs(u - x) >= step - 1e-6);
	return (pref) => {
		const dir = pref === 'left' ? -1 : 1;
		const candidates = [cx];
		for (const d of [dir, -dir]) for (let i = 1; i * step <= half + 1e-6; i++) candidates.push(cx + d * i * step);
		const x = candidates.find(ok) ?? clearestSpot(b, m, used, trunks(), near);
		used.push(x);
		return x;
	};
}

/**
 * When every usual place on a sideways card's short edge is taken: the spot (0.5 em clear of the
 * corners) that keeps `near` from every trunk and dot if it can, and is then furthest from the
 * other lines.
 */
function clearestSpot(b: PersonBox, m: LineMetrics, lines: number[], trunks: number[], near: number): number {
	const half = b.w / 2 - m.tagInset;
	const cx = b.x + b.w / 2;
	let best = cx;
	let score = [-1, -1];
	for (let t = -half; t <= half + 1e-6; t += 0.5) {
		const x = cx + t;
		const toTrunk = Math.min(Infinity, ...trunks.map((u) => Math.abs(u - x)));
		const s = [Math.min(toTrunk, near), Math.min(toTrunk, ...lines.map((u) => Math.abs(u - x)))];
		if (s[0] > score[0] + 1e-9 || (Math.abs(s[0] - score[0]) < 1e-9 && s[1] > score[1] + 1e-9)) {
			best = x;
			score = s;
		}
	}
	return best;
}

/** Two sibling bars that cannot share a lane (10 px apart at least). */
const barsClash = (a: FamilyLine, b: FamilyLine) => a.minX - 10 <= b.maxX && b.minX - 10 <= a.maxX;

/**
 * For two overlapping sibling bars in one gap, which goes above the other. The upper family's
 * drops cross the lower bar where they fall inside it, and the lower family's trunk crosses the
 * upper bar where it falls inside that. The order with fewer crossings wins; on a tie there is no
 * rule, and bars take lanes left to right as before. This keeps a single parent's trunk off the
 * bar of the same parent's couple children when those children spread out under the parent's card.
 */
function orderBars(list: FamilyLine[]): Map<FamilyLine, FamilyLine[]> {
	const inside = (x: number, f: FamilyLine) => x > f.minX + 0.5 && x < f.maxX - 0.5;
	const cost = (upper: FamilyLine, lower: FamilyLine) => upper.dropX.filter((x) => inside(x, lower)).length + (inside(lower.fromX, upper) ? 1 : 0);
	const below = new Map(list.map((f) => [f, [] as FamilyLine[]]));
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const [a, b] = [list[i], list[j]];
			if (!barsClash(a, b)) continue;
			const ab = cost(a, b);
			const ba = cost(b, a);
			if (ab < ba) below.get(a)!.push(b);
			else if (ba < ab) below.get(b)!.push(a);
		}
	}
	return below;
}

/** First-fit lanes per gap, left to right; runs in one lane keep `margin` apart. Returns lanes used per gap. */
function pack(runs: { gap: number; lo: number; hi: number; set: (lane: number) => void }[], gaps: number, margin: number): number[] {
	const used = new Array<number>(gaps).fill(0);
	const byGap = new Map<number, typeof runs>();
	for (const r of runs) byGap.set(r.gap, [...(byGap.get(r.gap) ?? []), r]);
	for (const [gap, list] of byGap) {
		list.sort((a, b) => a.lo - b.lo);
		const laneEnd: number[] = [];
		for (const r of list) {
			let lane = laneEnd.findIndex((end) => end + margin < r.lo);
			if (lane === -1) lane = laneEnd.length;
			laneEnd[lane] = r.hi;
			r.set(lane);
		}
		used[gap] = laneEnd.length;
	}
	return used;
}
