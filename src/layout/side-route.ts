/*
 * The routes of side-link curves through the gaps between the cards (D343 1 C). A side link (rumoured, adoptive, ward, begetter and the birth link of a
 * child under adoptive parents) is drawn by draw.ts as one S-curve from its parent to its child. When that curve would run over a card that is not one of
 * its own people, this stage draws it instead as a chain of S-curves in the gaps between the rows, with a straight vertical piece through the rows it
 * passes, at free places between the cards: clear of every other vertical line, union sign and routed side link, inside the picture, and (sideways) clear
 * of the room of a name tag. One vertical piece runs straight on through as many rows as its place is free in, so a long link is a few bends. A place
 * between two partners whose couple line runs there is used only when no other route is short enough. A route more than `DETOUR` times as long as the
 * plain curve or with more than `MAX_RUNS` straight runs is not used, a link across more than `MAX_ROWS` rows is not routed, and a link between two cards of
 * one row is not changed (no gap leads from one to the other): such a curve stays as it was (the known limit of spec §5.3). The links are routed in one fixed order (child, parents, kind), each clear of the routes before it, so the routes do not
 * depend on the order of the links in the plan. The stage reads the drawing so far and writes nothing into it.
 */
import { TIE } from './geometry';
import type { EdgePath, PersonBox, UnionPoint } from './model';
import type { RowYs } from './route';
import { pieceLength, segmentsOf, type Curve } from './rumour-spot';

/** A routed curve may be this many times as long as the plain curve; a longer detour is worse than the card it avoids. */
export const DETOUR = 1.8;
/** px: what a place between two partners joined by a couple line costs, when the route must use one (the curve crosses their line next to the sign). */
export const COUPLE_GAP_PENALTY = 80;
/** px: the test of the plain curve for cards cuts it into straight pieces that lie this near the curve, at most `CROSS_MAX_PIECES` of them. */
const CROSS_FLAT_PX = 0.25;
const CROSS_MAX_PIECES = 4096;
/** A card is inset by this many px for that test, so a curve that only grazes a corner does not count. */
const CROSS_INSET = 1;
/**
 * A vertical piece stays near the ideal of every row it passes (the straight line from parent to child): within this many card gaps (`comfort`), or this
 * part of the link's whole width, whichever is more; so a long link is a few bends, not one in every row.
 */
const STAY_GAPS = 4;
const STAY_PART = 3;
/** A run of rows starts with the free places within this many card gaps of its first row's ideal (else round the nearest free place). */
const START_GAPS = 16;
/** A route has at most this many straight runs through rows (one bend before each and one at the end); a route with more turns is busier than the card it avoids. */
export const MAX_RUNS = 4;
/**
 * A link that passes more than this many rows between its two ends keeps its plain curve: so a link costs at most these rows, however tall the tree. In
 * the sample trees and 300 random trees no side link passes more than 7 rows; only made-up trees with links across dozens of generations reach it.
 */
export const MAX_ROWS = 12;

/** What the router reads of the drawing: the cards, the rows, the lines and signs drawn so far, and the room it must leave. */
export interface RouteScene {
	persons: ReadonlyMap<string, PersonBox>;
	ys: RowYs;
	unions: ReadonlyMap<string, UnionPoint>;
	/** The straight lines drawn before the side links (couples, descent, fold stems): their vertical pieces are busy places. */
	others: readonly EdgePath[];
	/** The right edge of the picture's lines: a vertical piece stays inside the picture. */
	right: number;
	/** px: how far a vertical piece keeps at least from a card's edge, another vertical line and a sign. */
	pad: number;
	/** px: how far it keeps from a card's edge where the gap has room (a gap between two cards, or the middle of a narrower span), so that it never hugs a card. */
	comfort: number;
	/** Sideways: the cards that carry a name tag, and the room the tag takes after its card along the row (in the working frame). */
	tagged: ReadonlySet<string>;
	tagRoom: number;
}

/** One side link to route: its plain curve from (sx, sy) to (tx, ty) with control height `my`, the people whose cards it may touch, and its place in the order. */
export interface RouteAsk {
	sx: number;
	sy: number;
	tx: number;
	ty: number;
	my: number;
	own: ReadonlySet<string>;
	/** Orders the links of one drawing (the child, then the parents, then the kind); the router places them in this order, the numbers break a tie. */
	order: string;
	/** A link that keeps its plain curve whatever it crosses (a line of a begetter bundle): it is not routed, but bends keep off its flat middle. */
	keep?: boolean;
}

/** A routed side link: the path text after its start point, its pieces in path order (a vertical piece has the same x at both ends) and their lengths. */
export interface SideRoute {
	d: string;
	pieces: Curve[];
	lengths: number[];
}

/** The routes of the side links of one drawing (`sideRouter`). */
export interface SideRouter {
	/**
	 * The routes of the links, in the order asked; undefined for a link whose plain curve runs over no foreign card (it stays as it is), whose ends are
	 * in one row, or that has no route short enough. The same links asked again (the second drawing) get the same routes. `num` writes a number.
	 */
	routeAll(asks: readonly RouteAsk[], num: (n: number) => number): (SideRoute | undefined)[];
	/** The route of one link (a drawing with one side link). */
	route(sx: number, sy: number, tx: number, ty: number, my: number, own: ReadonlySet<string>, num: (n: number) => number): SideRoute | undefined;
}

/** The pieces of a route, for each whether it runs straight (a `V`) or bends across a gap (a `C`), their lengths, and the rows it passes with its x there. */
interface Leg {
	pieces: Curve[];
	straight: boolean[];
	lengths: number[];
	placed: [Row, number][];
}

/** One stop of a row: the free span between two cards (`lo` to `hi`), whether a couple line and its sign lie in it, and the cards on its two sides. */
interface Stop {
	lo: number;
	hi: number;
	couple: boolean;
	left?: string;
	right?: string;
}

/** A search that never uses a span that a foreign couple line crosses; `met` says whether it passed one by. */
interface Avoid {
	met: boolean;
}

/** A free span of a row, from x to x. */
type Span = [number, number];

/** A sideways piece of another line (a couple lane, a bar, a leg). */
interface Lane {
	y: number;
	x1: number;
	x2: number;
}

/** The rows of a drawing, the lanes of each gap (index: the row below the gap; the last is the gap below the last row; by y) and whether the busy places are read. */
interface Grid {
	rows: Row[];
	lanes: Lane[][];
	filled: boolean;
}

/** What one row holds for the router: its band, its cards left to right, the x of every vertical line and sign in its band (sorted), and its stops left to right. */
interface Row {
	top: number;
	bottom: number;
	cards: PersonBox[];
	busy: number[];
	stops: Stop[];
}

/** The index of the first row whose band ends below `y` (the rows are top to bottom and do not overlap). */
function rowFrom(rows: readonly Row[], y: number): number {
	let lo = 0;
	let hi = rows.length;
	// Bounded: the span of the binary search halves on every pass.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (rows[mid].bottom <= y + TIE) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** The index of the first stop of a row that ends right of `x` (or at `x`, with `at`). */
function stopIndex(stops: readonly Stop[], x: number, at = false): number {
	let lo = 0;
	let hi = stops.length;
	// Bounded: the span of the binary search halves on every pass.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (stops[mid].hi < x || (!at && stops[mid].hi === x)) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** The index of the first number of a sorted list that is more than `x` (or equal to it, with `at`). */
function firstAbove(list: readonly number[], x: number, at = false): number {
	let lo = 0;
	let hi = list.length;
	// Bounded: the span of the binary search halves on every pass.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (list[mid] < x || (!at && list[mid] === x)) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** The index of the first card of a row (left to right) whose right edge is right of `x`; the cards of a row do not overlap, so their right edges are in order too. */
function cardIndex(cards: readonly PersonBox[], x: number): number {
	let lo = 0;
	let hi = cards.length;
	// Bounded: the span of the binary search halves on every pass.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (cards[mid].x + cards[mid].w <= x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** The index of the first lane (by y) below `y`. */
function laneFrom(lanes: readonly Lane[], y: number): number {
	let lo = 0;
	let hi = lanes.length;
	// Bounded: the span of the binary search halves on every pass.
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (lanes[mid].y <= y) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * The place in `[a, b]` nearest `ideal` that is not within `pad` of any of the busy x (sorted; a busy x exactly `pad` away is allowed); undefined when there
 * is none. It walks the busy places outward from the ideal only as far as they block, so a row full of lines costs no more than the lines near the ideal.
 */
export function nearestFree(a: number, b: number, ideal: number, busy: readonly number[], pad: number): number | undefined {
	if (a > b) return undefined;
	const c = Math.min(b, Math.max(a, ideal));
	let right = c;
	for (let k = firstAbove(busy, c - pad); k < busy.length && busy[k] - pad < right; k++) right = Math.max(right, busy[k] + pad);
	let left = c;
	for (let k = firstAbove(busy, c + pad, true) - 1; k >= 0 && busy[k] + pad > left; k--) left = Math.min(left, busy[k] - pad);
	const l = left >= a ? left : undefined;
	const r = right <= b ? right : undefined;
	if (l === undefined) return r;
	// The left place wins a tie, as a scan from the left would choose.
	return r !== undefined && Math.abs(r - ideal) < Math.abs(l - ideal) - TIE ? r : l;
}

/** The stops of a row of sorted cards: the spans between them (sideways, the room of a tag after its card is not free), with the couple signs (sorted x) in each. */
function stopsOf(cards: readonly PersonBox[], couples: readonly number[], scene: RouteScene): Stop[] {
	const out: Stop[] = [];
	let at = -Infinity;
	let left: string | undefined;
	const holds = (lo: number, hi: number) => {
		const k = firstAbove(couples, lo);
		return k < couples.length && couples[k] < hi;
	};
	for (const c of cards) {
		out.push({ lo: at, hi: c.x, couple: holds(at, c.x), ...(left !== undefined ? { left } : {}), right: c.id });
		at = c.x + c.w + (scene.tagged.has(c.id) ? scene.tagRoom : 0);
		left = c.id;
	}
	out.push({ lo: at, hi: Infinity, couple: holds(at, Infinity), ...(left !== undefined ? { left } : {}) });
	return out;
}

/** The rows of the scene top to bottom (index: the generation), with their cards left to right, made once, when the first curve needs them. */
function rowsOf(scene: RouteScene): Row[] {
	const rows: Row[] = scene.ys.rowTop.map((top, r) => ({ top, bottom: top + scene.ys.rowH[r], cards: [], busy: [], stops: [] }));
	for (const b of scene.persons.values()) rows[b.gen].cards.push(b);
	for (const row of rows) row.cards.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return rows;
}

/**
 * Fills the busy places and the stops of every row, once, when the first curve needs a route, and puts the lanes (the sideways pieces of the other lines)
 * into the lanes of their gaps: it reads every line drawn so far once, and each vertical piece goes to the rows its band meets.
 */
function fillRows(rows: readonly Row[], lanes: Lane[][], scene: RouteScene): void {
	const mark = (x: number, y1: number, y2: number) => {
		for (let r = rowFrom(rows, y1); r < rows.length && rows[r].top < y2; r++) if (rows[r].bottom > y1) rows[r].busy.push(x);
	};
	for (const p of scene.others) {
		for (const [x1, y1, x2, y2] of segmentsOf(p.d)) {
			if (x1 === x2 && y1 !== y2) mark(x1, Math.min(y1, y2), Math.max(y1, y2));
			else if (y1 === y2 && x1 !== x2) lanes[rowFrom(rows, y1)].push({ y: y1, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
		}
	}
	const couples: number[][] = rows.map(() => []);
	for (const u of scene.unions.values()) {
		// A union sign is as busy as a vertical line.
		mark(u.x, u.y, u.y);
		const r = rowFrom(rows, u.y);
		if (u.bar && r < rows.length && rows[r].top < u.y) couples[r].push(u.x);
	}
	rows.forEach((row, r) => {
		row.busy.sort((a, b) => a - b);
		row.stops = stopsOf(row.cards, couples[r].sort((a, b) => a - b), scene);
	});
	for (const list of lanes) list.sort((a, b) => a.y - b.y || a.x1 - b.x1 || a.x2 - b.x2);
}

/** Whether the couple line in stop `s` belongs to people other than the link's own two parents (the plain curve starts at its own parents' line). */
const foreignCouple = (s: Stop, own: ReadonlySet<string>): boolean => s.couple && !(s.left !== undefined && s.right !== undefined && own.has(s.left) && own.has(s.right));

/** The room in stop `s` for a vertical piece: inside the picture, and at least `comfort` in from both cards where it has room (the middle of a narrower span). */
function roomIn(s: Stop, scene: RouteScene): { lo: number; hi: number; keep: number } {
	const lo = Math.max(s.lo, 0);
	const hi = Math.min(s.hi, scene.right);
	return { lo, hi, keep: Math.min(scene.comfort, (hi - lo) / 2) };
}

/** The score of a vertical piece in stop `s` near `ideal` (its distance from the ideal, plus the cost of a couple line), or undefined when the stop has no free place. */
function scoreIn(s: Stop, row: Row, scene: RouteScene, ideal: number, avoid: Avoid | undefined, own: ReadonlySet<string>): { x: number; score: number } | undefined {
	const couple = foreignCouple(s, own);
	if (avoid && couple) {
		avoid.met = true;
		return undefined;
	}
	const { lo, hi, keep } = roomIn(s, scene);
	const x = nearestFree(lo + scene.pad, hi - scene.pad, Math.min(hi - keep, Math.max(lo + keep, ideal)), row.busy, scene.pad);
	return x === undefined ? undefined : { x, score: Math.abs(x - ideal) + (couple ? COUPLE_GAP_PENALTY : 0) };
}

/**
 * The place in a row for a vertical piece near `ideal`; with `avoid`, never a span that a foreign couple line crosses, else such a span costs `COUPLE_GAP_PENALTY`.
 * The stops are tried outward from the ideal and the search ends where a stop's distance alone is more than the best score; of two places with the same
 * score the left one wins, as a scan of every stop from the left would choose.
 */
function spotIn(row: Row, scene: RouteScene, ideal: number, avoid: Avoid | undefined, own: ReadonlySet<string>): number | undefined {
	const { stops } = row;
	const bound = (s: Stop) => Math.max(0, Math.max(s.lo, 0) - ideal, ideal - Math.min(s.hi, scene.right));
	let best = Infinity;
	let bestAt = -1;
	let x: number | undefined;
	let i = stopIndex(stops, ideal, true);
	let j = i - 1;
	for (let n = 0; n < stops.length; n++) {
		const bi = i < stops.length ? bound(stops[i]) : Infinity;
		const bj = j >= 0 ? bound(stops[j]) : Infinity;
		if (Math.min(bi, bj) > best + TIE) break;
		const k = bi <= bj ? i++ : j--;
		const got = scoreIn(stops[k], row, scene, ideal, avoid, own);
		if (got && (got.score < best - TIE || (got.score <= best + TIE && k < bestAt))) {
			best = got.score;
			bestAt = k;
			x = got.x;
		}
	}
	return x;
}

/**
 * The free spans of a row within `from` to `to`: the stops (one that a foreign couple line crosses only without `avoid`), at least `comfort` in from their
 * cards and inside the picture, less `pad` round every busy place.
 */
function freeSpans(row: Row, scene: RouteScene, from: number, to: number, avoid: Avoid | undefined, own: ReadonlySet<string>): Span[] {
	const out: Span[] = [];
	const { busy, stops } = row;
	const pad = scene.pad;
	for (let k = stopIndex(stops, from); k < stops.length && stops[k].lo < to; k++) {
		if (avoid && foreignCouple(stops[k], own)) {
			avoid.met = true;
			continue;
		}
		// The room of `roomIn`, written out: this runs for every row a route passes.
		const lo = Math.max(stops[k].lo, 0);
		const hi = Math.min(stops[k].hi, scene.right);
		const edge = Math.max(Math.min(scene.comfort, (hi - lo) / 2), pad);
		let a = Math.max(from, lo + edge);
		const b = Math.min(to, hi - edge);
		for (let j = firstAbove(busy, a - pad); j < busy.length && busy[j] - pad < b && a <= b; j++) {
			if (busy[j] - pad >= a) out.push([a, busy[j] - pad]);
			a = Math.max(a, busy[j] + pad);
		}
		if (a <= b) out.push([a, b]);
	}
	return out;
}

/** The spans that both lists hold (each list sorted, its spans apart). */
function overlap(p: readonly Span[], q: readonly Span[]): Span[] {
	const out: Span[] = [];
	let j = 0;
	for (const [a, b] of p) {
		// Bounded: j only grows, up to the length of q.
		while (j < q.length && q[j][1] < a) j++;
		for (let k = j; k < q.length && q[k][0] <= b; k++) if (Math.max(a, q[k][0]) <= Math.min(b, q[k][1])) out.push([Math.max(a, q[k][0]), Math.min(b, q[k][1])]);
	}
	return out;
}

/** The place in the spans nearest `aim` (the left one on a tie). */
function nearestIn(spans: readonly Span[], aim: number): number {
	let best = Math.min(spans[0][1], Math.max(spans[0][0], aim));
	for (const [a, b] of spans) {
		const x = Math.min(b, Math.max(a, aim));
		if (Math.abs(x - aim) < Math.abs(best - aim) - TIE) best = x;
	}
	return best;
}

/**
 * The control height of a bend from (x0, y0) to (x1, y1) across a gap: the middle of the widest free band between the lanes that the bend runs along. An
 * S-curve is flat round its control height, so with the plain middle it could run beside a lane for its whole length (sideways the gaps are narrow).
 */
function bendY(grid: Grid, x0: number, y0: number, x1: number, y1: number): number {
	const lo = Math.min(y0, y1);
	const hi = Math.max(y0, y1);
	let best = (lo + hi) / 2;
	let size = -1;
	let prev = lo;
	for (let g = rowFrom(grid.rows, lo + TIE); g <= Math.min(rowFrom(grid.rows, hi - TIE), grid.rows.length); g++) {
		const lanes = grid.lanes[g];
		for (let k = laneFrom(lanes, lo + TIE); k < lanes.length && lanes[k].y < hi - TIE; k++) {
			const h = lanes[k];
			if (h.x2 <= Math.min(x0, x1) || h.x1 >= Math.max(x0, x1)) continue;
			if (h.y - prev > size + TIE) {
				size = h.y - prev;
				best = (prev + h.y) / 2;
			}
			prev = h.y;
		}
	}
	// With no lane on the way the plain middle stays; else the band after the last lane counts too.
	if (size >= 0 && hi - prev > size + TIE) best = (prev + hi) / 2;
	return best;
}

/** Whether the straight piece from (x1, y1) to (x2, y2) enters the box (Liang-Barsky clipping). */
function segmentMeets(x1: number, y1: number, x2: number, y2: number, l: number, t: number, r: number, b: number): boolean {
	let lo = 0;
	let hi = 1;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const sides = [-dx, x1 - l, dx, r - x1, -dy, y1 - t, dy, b - y1];
	for (let k = 0; k < sides.length; k += 2) {
		const p = sides[k];
		const q = sides[k + 1];
		if (p === 0) {
			if (q < 0) return false;
			continue;
		}
		const u = q / p;
		if (p < 0) lo = Math.max(lo, u);
		else hi = Math.min(hi, u);
		if (lo > hi) return false;
	}
	return true;
}

/**
 * Whether a card of `rows` that is not one of `own` (inset by `CROSS_INSET`) meets the box from (l, t) to (r, b); with `chord`, whether it meets the
 * straight piece from (l, t) to (r, b) instead (the box is then the piece's own box).
 */
function cardMeets(rows: readonly Row[], l: number, t: number, r: number, b: number, own: ReadonlySet<string>, chord: boolean): boolean {
	const left = Math.min(l, r) - CROSS_INSET;
	const right = Math.max(l, r) + CROSS_INSET;
	const top = Math.min(t, b) - CROSS_INSET;
	const bottom = Math.max(t, b) + CROSS_INSET;
	for (let k = rowFrom(rows, top); k < rows.length && rows[k].top < bottom; k++) {
		const cards = rows[k].cards;
		for (let c = cardIndex(cards, left); c < cards.length && cards[c].x < right; c++) {
			const q = cards[c];
			if (own.has(q.id) || q.y + CROSS_INSET >= bottom || q.y + q.h - CROSS_INSET <= top) continue;
			if (!chord || segmentMeets(l, t, r, b, q.x + CROSS_INSET, q.y + CROSS_INSET, q.x + q.w - CROSS_INSET, q.y + q.h - CROSS_INSET)) return true;
		}
	}
	return false;
}

/**
 * True if the plain S-curve runs over a card that is not one of `own`. The curve is halved until each half lies within `CROSS_FLAT_PX` of its chord, and
 * each chord is tested whole against the cards of the rows it meets, so a curve that cuts a card's corner is found wherever it cuts it. A half whose
 * points have no foreign card in their box is not cut further, so only the parts near a card cost work. The halves wait on one flat stack of numbers,
 * eight for each.
 */
function crossesCard(rows: readonly Row[], { sx, sy, my, tx, ty, own }: RouteAsk): boolean {
	const stack: number[] = [sx, sy, sx, my, tx, my, tx, ty];
	const flat = 16 * CROSS_FLAT_PX * CROSS_FLAT_PX;
	for (let n = 0; n < CROSS_MAX_PIECES && stack.length; n++) {
		const at = stack.length - 8;
		const x0 = stack[at];
		const y0 = stack[at + 1];
		const x1 = stack[at + 2];
		const y1 = stack[at + 3];
		const x2 = stack[at + 4];
		const y2 = stack[at + 5];
		const x3 = stack[at + 6];
		const y3 = stack[at + 7];
		stack.length = at;
		// A piece lies inside the box of its four points: with no foreign card in that box, it meets none.
		const top = Math.min(y0, y1, y2, y3);
		const bottom = Math.max(y0, y1, y2, y3);
		if (!cardMeets(rows, Math.min(x0, x1, x2, x3), top, Math.max(x0, x1, x2, x3), bottom, own, false)) continue;
		// Flat when both inner control points lie near the chord (the bound of Willcocks: 16 times the square of the distance).
		const ux = Math.max((3 * x1 - 2 * x0 - x3) ** 2, (3 * x2 - x0 - 2 * x3) ** 2);
		const uy = Math.max((3 * y1 - 2 * y0 - y3) ** 2, (3 * y2 - y0 - 2 * y3) ** 2);
		if (ux + uy <= flat || stack.length / 8 + n >= CROSS_MAX_PIECES - 2) {
			if (cardMeets(rows, x0, y0, x3, y3, own, true)) return true;
			continue;
		}
		const ax = (x0 + x1) / 2;
		const ay = (y0 + y1) / 2;
		const bx = (x1 + x2) / 2;
		const by = (y1 + y2) / 2;
		const cx = (x2 + x3) / 2;
		const cy = (y2 + y3) / 2;
		const dx = (ax + bx) / 2;
		const dy = (ay + by) / 2;
		const ex = (bx + cx) / 2;
		const ey = (by + cy) / 2;
		const mx = (dx + ex) / 2;
		const mY = (dy + ey) / 2;
		// The second half goes on the stack first, so the halves are tested from the start of the curve.
		stack.push(mx, mY, ex, ey, cx, cy, x3, y3, x0, y0, ax, ay, dx, dy, mx, mY);
	}
	return false;
}

/** The row whose band holds `y`, if any. */
function rowAt(rows: readonly Row[], y: number): Row | undefined {
	const r = rows[rowFrom(rows, y - 2 * TIE)];
	return r !== undefined && r.top < y + TIE ? r : undefined;
}

/**
 * The route of a curve through the rows `through` (in path order), with which pieces run straight; undefined when a row has no free place, or the route
 * grows longer than `limit` or needs more than `MAX_RUNS` runs. A run of rows starts with the free places near its first row's ideal (the straight line
 * from parent to child) and goes on while one of them is free in the next row and near that row's ideal; its piece then stands at the place nearest the
 * ideal of the run's middle.
 */
function legOf(grid: Grid, scene: RouteScene, ask: RouteAsk, ends: [Row | undefined, Row | undefined], through: readonly Row[], avoid: Avoid | undefined, limit: number): Leg | undefined {
	const { sx, sy, tx, ty, own } = ask;
	const up = ty < sy;
	const leg: Leg = { pieces: [], straight: [], lengths: [], placed: [] };
	let cx = sx;
	let cy = sy;
	let length = 0;
	const add = (x: number, y: number, straight: boolean) => {
		const c: Curve = [cx, cy, straight ? (cy + y) / 2 : bendY(grid, cx, cy, x, y), x, y];
		leg.pieces.push(c);
		leg.straight.push(straight);
		leg.lengths.push(pieceLength(c));
		length += leg.lengths[leg.lengths.length - 1];
		cx = x;
		cy = y;
	};
	// Up: the curve leaves through its own card, so its first bend is in the gap above that card's row; it enters the child's card from below.
	if (up && ends[0] !== undefined) add(sx, ends[0].top, true);
	const ideal = (row: Row) => sx + ((tx - sx) * ((row.top + row.bottom) / 2 - sy)) / (ty - sy || 1);
	const stay = Math.max(STAY_GAPS * scene.comfort, Math.abs(tx - sx) / STAY_PART);
	const start = Math.min(stay, START_GAPS * scene.comfort);
	// The free spans near the ideal of a row, within the spans still open (only those are read: the run narrows them fast).
	const near = (row: Row, lo: number, hi: number) => freeSpans(row, scene, Math.max(lo, ideal(row) - stay), Math.min(hi, ideal(row) + stay), avoid, own);
	let runs = 0;
	for (let i = 0; i < through.length; ) {
		if (++runs > MAX_RUNS) return undefined;
		const at = ideal(through[i]);
		let spans = near(through[i], at - start, at + start);
		// No place near the ideal with room: the run starts round the nearest free place (it may hug a card, or cross a couple line in the second search).
		const x0 = spans.length ? nearestIn(spans, at) : spotIn(through[i], scene, at, avoid, own);
		if (x0 === undefined) return undefined;
		if (!spans.length) spans = near(through[i], x0 - start, x0 + start);
		let j = i + 1;
		for (; j < through.length && spans.length; j++) {
			const next = overlap(spans, near(through[j], spans[0][0], spans[spans.length - 1][1]));
			if (!next.length) break;
			spans = next;
		}
		const x = j > i + 1 ? nearestIn(spans, (at + ideal(through[j - 1])) / 2) : x0;
		add(x, up ? through[i].bottom : through[i].top, false);
		add(x, up ? through[j - 1].top : through[j - 1].bottom, true);
		for (let r = i; r < j; r++) leg.placed.push([through[r], x]);
		// The pieces still to come are at least as long as the straight way from here to the child.
		if (length + Math.hypot(tx - cx, ty - cy) > limit + TIE) return undefined;
		i = j;
	}
	const last = up ? ends[1] : undefined;
	if (last !== undefined) add(tx, last.bottom, false);
	add(tx, ty, last !== undefined);
	return length > limit + TIE ? undefined : leg;
}

/** Puts the vertical pieces of a route into the busy places of their rows, so the routes after it keep clear of them. */
function occupy(leg: Leg): void {
	for (const [row, x] of leg.placed) row.busy.splice(firstAbove(row.busy, x), 0, x);
}

/** Orders two links: by their `order`, then by their numbers. */
function byOrder(a: RouteAsk, b: RouteAsk): number {
	if (a.order !== b.order) return a.order < b.order ? -1 : 1;
	return a.sx - b.sx || a.sy - b.sy || a.tx - b.tx || a.ty - b.ty || a.my - b.my;
}

/** Whether two asks are the same link (the second drawing asks again). */
const sameAsk = (a: RouteAsk, b: RouteAsk): boolean => a.order === b.order && a.sx === b.sx && a.sy === b.sy && a.tx === b.tx && a.ty === b.ty && a.my === b.my;

/** The path text of a route after its start point. A bend is written as a curve even when its two ends share an x, so every side link stays a path with a curve (the line highlight reads that). */
function write(leg: Leg, num: (n: number) => number): SideRoute {
	let d = '';
	leg.pieces.forEach(([x0, , mid, x1, y1], i) => {
		d += leg.straight[i] ? `V${num(y1)}` : `C${num(x0)} ${num(mid)} ${num(x1)} ${num(mid)} ${num(x1)} ${num(y1)}`;
	});
	return { d, pieces: leg.pieces, lengths: leg.lengths };
}

/** The route of one link whose plain curve runs over a foreign card (see `SideRouter.routeAll`). */
function legFor(grid: Grid, scene: RouteScene, ask: RouteAsk): Leg | undefined {
	const { sx, sy, tx, ty, my } = ask;
	const rows = grid.rows;
	const up = ty < sy;
	const ends: [Row | undefined, Row | undefined] = [rowAt(rows, sy), rowAt(rows, ty)];
	if (up && ends[0] !== undefined && ends[0] === ends[1]) return undefined;
	const through: Row[] = [];
	for (let r = rowFrom(rows, Math.min(sy, ty) - TIE); r < rows.length && rows[r].bottom <= Math.max(sy, ty) + TIE; r++) if (rows[r].top >= Math.min(sy, ty) - TIE && rows[r] !== ends[0] && rows[r] !== ends[1]) through.push(rows[r]);
	if (up) through.reverse();
	// Down with no row between: the curve lies in one gap and crossed no card after all. Up with no row between from a union under the child's own row:
	// a link between two cards of one row, which no gap leads through (a route would run along under the whole row, through its tags).
	if (!through.length && (!up || ends[0] === undefined)) return undefined;
	if (through.length > MAX_ROWS) return undefined;
	const limit = DETOUR * pieceLength([sx, sy, my, tx, ty]);
	// A route that passes no couple line wins when it is short enough; else the nearest places, a couple line costing a detour of COUPLE_GAP_PENALTY.
	const avoid = { met: false };
	const clear = legOf(grid, scene, ask, ends, through, avoid, limit);
	// A search that passed no couple line by would find the same route again.
	return clear ?? (avoid.met ? legOf(grid, scene, ask, ends, through, undefined, limit) : undefined);
}

/**
 * Puts the flat middle of a curve from x0 to x1 with control height `y` into the lanes of its gap (by y): a bend of a later route keeps away from it, so two
 * curves never run along each other in one gap.
 */
function addLane(grid: Grid, x0: number, x1: number, y: number): void {
	if (x0 === x1) return;
	const lanes = grid.lanes[rowFrom(grid.rows, y)];
	lanes.splice(laneFrom(lanes, y), 0, { y, x1: Math.min(x0, x1), x2: Math.max(x0, x1) });
}

/**
 * The router of one drawing. It reads the rows when the first curve is tested, and the busy places and the lanes when the first curve needs a route. The
 * links that stay plain are known first: their flat middles are lanes for every bend; a route's bends become lanes for the routes after it.
 */
export function sideRouter(scene: RouteScene): SideRouter {
	let grid: Grid | undefined;
	// The drawing is made twice when it has a rumoured line (rounded, and exact for the "?" search): the second asks for the same routes.
	const done = new Map<string, { ask: RouteAsk; leg: Leg | undefined }[]>();
	const found = (a: RouteAsk) => done.get(a.order)?.find((e) => sameAsk(e.ask, a));
	const routeAll = (asks: readonly RouteAsk[], num: (n: number) => number): (SideRoute | undefined)[] => {
		const todo = asks.filter((a) => !found(a)).sort(byOrder);
		if (todo.length && !grid) {
			const rows = rowsOf(scene);
			grid = { rows, lanes: Array.from({ length: rows.length + 1 }, () => []), filled: false };
		}
		const g = grid;
		const crossing = g ? todo.map((a) => !a.keep && crossesCard(g.rows, a)) : [];
		todo.forEach((a, k) => {
			if (g && !crossing[k]) addLane(g, a.sx, a.tx, a.my);
		});
		todo.forEach((ask, k) => {
			if (found(ask) || !g) return;
			if (crossing[k] && !g.filled) {
				fillRows(g.rows, g.lanes, scene);
				g.filled = true;
			}
			const leg = crossing[k] ? legFor(g, scene, ask) : undefined;
			const list = done.get(ask.order);
			if (list) list.push({ ask, leg });
			else done.set(ask.order, [{ ask, leg }]);
			if (leg) {
				occupy(leg);
				leg.pieces.forEach(([x0, , mid, x1], i) => {
					if (!leg.straight[i]) addLane(g, x0, x1, mid);
				});
			} else if (crossing[k]) addLane(g, ask.sx, ask.tx, ask.my);
		});
		return asks.map((a) => {
			const leg = found(a)?.leg;
			return leg && write(leg, num);
		});
	};
	return { routeAll, route: (sx, sy, tx, ty, my, own, num) => routeAll([{ sx, sy, tx, ty, my, own, order: '' }], num)[0] };
}
