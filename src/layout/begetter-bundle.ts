/*
 * Several begetter lines of one person into one row of children (owner, D338 point 5, D341). The lines are unrouted curves from the begetter's bottom edge to
 * the top of each child; with one shape for all of them they run on one path, and their dashes meet out of step, so they look braided. This stage gives
 * each line of such a group its own height on the long run (a small gap between neighbours) and one dash phase there. A single line, and every other kind of
 * side link, is not changed. It only picks a control height and a dash offset: it adds no line and routes nothing, so the count of curves over cards is the
 * count of before (the rule "Side links are unrouted curves").
 */

/** px: the gap kept between two neighbouring lines of a group at the middle of the long run (spec §13.17, D338 point 5). */
export const BUNDLE_GAP_PX = 4;
/** px: the length of the dash pattern `14 3 2 3` of the begetter line (`STROKES.begetter` in render/styles.ts; a test keeps the two equal). */
export const BEGETTER_DASH_PERIOD = 22;
/** The weight of the control height at the middle of a curve whose two control points share one height: 3 t (1 - t) at t = 1/2. */
const MIDDLE_WEIGHT = 0.75;
const BISECT_ROUNDS = 40;
const ARC_STEPS = 48;
const TENTH = 10;

/** One side-link curve `M x0 y0 V sy C x0 my tx my tx ty` that may join a group. */
export interface BundleLine {
	/** The begetter and the row of the children: lines with the same value are a group (a group of one is left alone). */
	group: string;
	/** The child's id: the last tie-break, so the order of the people never decides. */
	child: string;
	x0: number;
	y0: number;
	sy: number;
	my: number;
	tx: number;
	ty: number;
}

/** The result for one line: its control height and its dash offset (0 when the group has no shared run). */
export interface BundlePlace {
	my: number;
	phase: number;
}

/** The point of the curve at the parameter u, as x and y. */
function pointAt(l: BundleLine, my: number, u: number): { x: number; y: number } {
	const v = 1 - u;
	return {
		x: l.x0 * (v * v * v + 3 * v * v * u) + l.tx * (3 * v * u * u + u * u * u),
		y: l.sy * v * v * v + 3 * my * v * v * u + 3 * my * v * u * u + l.ty * u * u * u,
	};
}

/** The length of the line from its start (the stub `V` included) to the point where its x is `xRef`. */
function lengthTo(l: BundleLine, my: number, xRef: number): number {
	const right = l.tx > l.x0;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < BISECT_ROUNDS; i++) {
		const mid = (lo + hi) / 2;
		if (pointAt(l, my, mid).x < xRef === right) lo = mid;
		else hi = mid;
	}
	const end = (lo + hi) / 2;
	let sum = l.sy - l.y0;
	let prev = pointAt(l, my, 0);
	for (let k = 1; k <= ARC_STEPS; k++) {
		const p = pointAt(l, my, (end * k) / ARC_STEPS);
		sum += Math.hypot(p.x - prev.x, p.y - prev.y);
		prev = p;
	}
	return sum;
}

/** The run that all lines of a one-way group share: the x range between the nearest start and the nearest end; undefined when there is none. */
function sharedRun(lines: readonly BundleLine[]): number | undefined {
	const right = lines[0].tx > lines[0].x0;
	const from = right ? Math.max(...lines.map((l) => l.x0)) : Math.min(...lines.map((l) => l.x0));
	const to = right ? Math.min(...lines.map((l) => l.tx)) : Math.max(...lines.map((l) => l.tx));
	return right ? (to - from > BUNDLE_GAP_PX ? (from + to) / 2 : undefined) : from - to > BUNDLE_GAP_PX ? (from + to) / 2 : undefined;
}

/**
 * The control height and the dash offset of each line (same index as `lines`). Inside a group the lines that run the same way are ranked by the width of
 * their span: the nearest child gets the lowest run, so no two lines of the group cross on the long run. Neighbours are `BUNDLE_GAP_PX` apart at the middle.
 */
export function bundleBegetters(lines: readonly BundleLine[]): BundlePlace[] {
	const out: BundlePlace[] = lines.map((l) => ({ my: l.my, phase: 0 }));
	const sets = new Map<string, number[]>();
	lines.forEach((l, i) => {
		if (l.tx === l.x0) return;
		const key = `${l.group}\0${l.tx > l.x0 ? 'right' : 'left'}`;
		sets.set(key, [...(sets.get(key) ?? []), i]);
	});
	for (const idx of sets.values()) {
		if (idx.length < 2) continue;
		const right = lines[idx[0]].tx > lines[idx[0]].x0;
		const span = (i: number) => Math.abs(lines[i].tx - lines[i].x0);
		const ranked = [...idx].sort((a, b) => span(a) - span(b) || (right ? lines[a].x0 - lines[b].x0 : lines[b].x0 - lines[a].x0) || (lines[a].child < lines[b].child ? -1 : lines[a].child > lines[b].child ? 1 : 0));
		const step = BUNDLE_GAP_PX / MIDDLE_WEIGHT;
		ranked.forEach((i, rank) => {
			const l = lines[i];
			const lo = Math.min(l.sy, l.ty);
			const hi = Math.max(l.sy, l.ty);
			out[i].my = Math.min(hi, Math.max(lo, l.my + ((ranked.length - 1) / 2 - rank) * step));
		});
		const ref = sharedRun(ranked.map((i) => lines[i]));
		if (ref === undefined) continue;
		const base = lengthTo(lines[ranked[0]], out[ranked[0]].my, ref);
		for (const i of ranked.slice(1)) {
			const behind = base - lengthTo(lines[i], out[i].my, ref);
			out[i].phase = Math.round((((behind % BEGETTER_DASH_PERIOD) + BEGETTER_DASH_PERIOD) % BEGETTER_DASH_PERIOD) * TENTH) / TENTH;
		}
	}
	return out;
}
