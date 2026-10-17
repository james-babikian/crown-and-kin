/*
 * The "?" search of a rumoured line (the architecture notes §4.2): the search of the 0.3.0 router (E8/E9) as the card-and-line build uses it. The
 * search order is the old one: the middle of the line, then along it, then the alternative pieces of the trunk, then the clearest point,
 * then any point off the cards. One change from 0.3.0: besides the cards, the "?" keeps clear of every box it is given, so a tag or a
 * sign never sits under it. There are no counters and no module state; the last fallback reads the cards through the grid like the
 * others (it scanned every card).
 */

import { TIE } from './geometry';

/** A straight piece of a line: x1, y1, x2, y2. */
export type Seg = [number, number, number, number];
/** Start x, start y, middle y, end x, end y of a curve whose control points share the middle y (a straight line has start x = end x). */
export type Curve = [number, number, number, number, number];
/** A place in the drawing. */
export type Spot = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** A curve is cut into this many straight pieces for the distance tests. */
const CURVE_PIECES = 16;
/** The "?" keeps this far (px) from every other line, and this far from every dot (a dot's radius is counted in the second). */
const LINE_CLEAR_PX = 10;
const DOT_CLEAR_PX = 16;
/** The middle of a curve (its parameter), where every search starts. */
const MIDDLE = 0.5;
/** Along the curve the search takes this many steps each way from the middle, each a fortieth of the curve. */
const ALONG_STEPS = 24;
const ALONG_STEP_T = 0.025;
/** On the alternative pieces of the trunk the search takes this many places along each piece. */
const ALT_STEPS = 20;
/** The clearest point is searched at the fortieths of the curve (not at its two ends); it looks this far (px) for lines, and `DOT_RADIUS_PX` more for dots, which count that much less. */
const CLEAREST_STEPS = 40;
const CLEAREST_REACH_PX = 40;
const DOT_RADIUS_PX = 6;
/** The last fallback walks this many places along the curve; a card is looked for within this many times the card room. */
const FALLBACK_STEPS = 200;
const FALLBACK_REACH = 4;
/** The grid of the index: cell size (px) and the numbers that make one key of two cell indexes (the offset keeps them positive, the stride is larger than any offset index). */
const GRID_CELL_PX = 64;
const GRID_OFFSET = 1e6;
const GRID_STRIDE = 2000003;
/** Character codes the path reader tests: the digits, the minus and plus signs, the point, the letter e and the space. */
const CHAR_SPACE = 32;
const CHAR_0 = 48;
const CHAR_9 = 57;
const CHAR_MINUS = 45;
const CHAR_PLUS = 43;
const CHAR_POINT = 46;
const CHAR_E = 101;

/** The point of a curve at `t` (0 to 1). */
export function bezier([sx, sy, my, tx, ty]: Curve, t: number): Spot {
	const u = 1 - t;
	return { x: u * u * u * sx + 3 * u * u * t * sx + 3 * u * t * t * tx + t * t * t * tx, y: u * u * u * sy + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * ty };
}

const isDigit = (c: number): boolean => c >= CHAR_0 && c <= CHAR_9;

/** Reads the numbers that follow a command letter from `i`; returns them and the index after them. */
function readNumbers(d: string, from: number): { n: number[]; next: number } {
	const n: number[] = [];
	let i = from;
	// Bounded: every pass moves `i` forward or leaves the loop.
	while (i < d.length) {
		const c = d.charCodeAt(i);
		if (c === CHAR_SPACE) {
			i++;
			continue;
		}
		if (!(isDigit(c) || c === CHAR_MINUS || c === CHAR_POINT)) break;
		let j = i + 1;
		for (; j < d.length; j++) {
			const c2 = d.charCodeAt(j);
			if (!(isDigit(c2) || c2 === CHAR_POINT || c2 === CHAR_E || ((c2 === CHAR_MINUS || c2 === CHAR_PLUS) && d.charCodeAt(j - 1) === CHAR_E))) break;
		}
		n.push(+d.slice(i, j));
		i = j;
	}
	return { n, next: i };
}

/**
 * A path as straight pieces; its curves are cut into short pieces. A hand-made reader of the router's own path strings (M, H, V, C and
 * numbers separated by one space): a regular expression and a split made most of the garbage of a large tree.
 */
export function segmentsOf(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	let i = 0;
	// Bounded: every pass reads one command letter and moves `i` past it.
	while (i < d.length) {
		const cmd = d[i++];
		const read = readNumbers(d, i);
		const n = read.n;
		i = read.next;
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push([x, y, n[0], y]);
			x = n[0];
		} else if (cmd === 'V') {
			out.push([x, y, x, n[0]]);
			y = n[0];
		} else {
			let prev = { x, y };
			for (let k = 1; k <= CURVE_PIECES; k++) {
				const p = bezier([x, y, n[1], n[4], n[5]], k / CURVE_PIECES);
				out.push([prev.x, prev.y, p.x, p.y]);
				prev = p;
			}
			[x, y] = [n[4], n[5]];
		}
	}
	return out;
}

/**
 * True if `p` is more than `r` and `TIE` from the box of the segment, so more than `r` and `TIE` from the segment: a cheap test before `distance`.
 * Every comparison of a distance with a size (10 px, 16 px, the card room) and with the best so far allows `TIE`, so that round-off of 1e-11 px
 * never turns a place clear or unclear (the architecture notes §4.2.4).
 */
const beyond = (p: Spot, [x1, y1, x2, y2]: Seg, r: number) => p.x < Math.min(x1, x2) - r - TIE || p.x > Math.max(x1, x2) + r + TIE || p.y < Math.min(y1, y2) - r - TIE || p.y > Math.max(y1, y2) + r + TIE;

/** How far `p` is from the segment. */
export function distance(p: Spot, [x1, y1, x2, y2]: Seg): number {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = dx * dx + dy * dy;
	const t = len ? Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / len)) : 0;
	return Math.hypot(p.x - x1 - t * dx, p.y - y1 - t * dy);
}

/** How far `p` is from the box `b` (0 inside it). */
const boxGap = (p: Spot, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.w), Math.max(b.y - p.y, 0, p.y - b.y - b.h));

/**
 * A grid of cells over boxes: `add` puts an index in every cell its box touches; `near` gives the indexes whose boxes touch a query box,
 * once each, in ascending order, so a search that walks them takes its choices in the same order as one that walks the whole list.
 */
class BoxGrid {
	private cells = new Map<number, number[]>();
	private key(cx: number, cy: number): number {
		return (cx + GRID_OFFSET) * GRID_STRIDE + (cy + GRID_OFFSET);
	}
	add(i: number, x0: number, y0: number, x1: number, y1: number): void {
		const c = GRID_CELL_PX;
		for (let cx = Math.floor((x0 - TIE) / c); cx <= Math.floor((x1 + TIE) / c); cx++) {
			for (let cy = Math.floor((y0 - TIE) / c); cy <= Math.floor((y1 + TIE) / c); cy++) {
				const k = this.key(cx, cy);
				const list = this.cells.get(k);
				if (list) list.push(i);
				else this.cells.set(k, [i]);
			}
		}
	}
	near(x0: number, y0: number, x1: number, y1: number): number[] {
		const c = GRID_CELL_PX;
		const seen = new Set<number>();
		for (let cx = Math.floor((x0 - TIE) / c); cx <= Math.floor((x1 + TIE) / c); cx++) {
			for (let cy = Math.floor((y0 - TIE) / c); cy <= Math.floor((y1 + TIE) / c); cy++) for (const i of this.cells.get(this.key(cx, cy)) ?? []) seen.add(i);
		}
		return [...seen].sort((a, b) => a - b);
	}
}

/**
 * The lines, dots and boxes (cards, tags, fold marks) of one drawing, each in a grid, for the search of the "?" spots (it used to scan
 * every one of them for each rumoured line, so a tree of rumoured parents grew with the square of its people). The answers keep the
 * original indexes; a dot added later gets the next one.
 */
export class RumourIndex {
	private segGrid = new BoxGrid();
	private dotGrid = new BoxGrid();
	private cardGrid = new BoxGrid();
	constructor(
		readonly all: Seg[],
		readonly dots: Spot[],
		readonly cards: Box[],
	) {
		all.forEach(([x1, y1, x2, y2], i) => this.segGrid.add(i, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)));
		dots.forEach((d, i) => this.dotGrid.add(i, d.x, d.y, d.x, d.y));
		cards.forEach((b, i) => this.cardGrid.add(i, b.x, b.y, b.x + b.w, b.y + b.h));
	}
	/** Adds a dot (a "?" already placed). */
	addDot(d: Spot): void {
		this.dotGrid.add(this.dots.push(d) - 1, d.x, d.y, d.x, d.y);
	}
	/** The lines whose box meets the box. The caller tests the exact distance. */
	segsIn(x0: number, y0: number, x1: number, y1: number): number[] {
		return this.segGrid.near(x0, y0, x1, y1).filter((i) => {
			const [ax, ay, bx, by] = this.all[i];
			return Math.max(ax, bx) >= x0 - TIE && Math.min(ax, bx) <= x1 + TIE && Math.max(ay, by) >= y0 - TIE && Math.min(ay, by) <= y1 + TIE;
		});
	}
	/** The dots inside the box. */
	dotsIn(x0: number, y0: number, x1: number, y1: number): number[] {
		return this.dotGrid.near(x0, y0, x1, y1).filter((i) => this.dots[i].x >= x0 - TIE && this.dots[i].x <= x1 + TIE && this.dots[i].y >= y0 - TIE && this.dots[i].y <= y1 + TIE);
	}
	/** The boxes whose grid cells meet the box (the caller tests the exact gap). */
	cardsIn(x0: number, y0: number, x1: number, y1: number): number[] {
		return this.cardGrid.near(x0, y0, x1, y1);
	}
}

/** What the "?" must keep clear of besides lines and dots: every card by `room`, and where else it may sit. */
export interface RumourRoom {
	room: number;
	/** Straight pieces of the rumoured line's trunk the "?" may sit on when the line itself has no room; `own`: the segment ranges (trunk, line) it may touch. */
	alt?: { segs: Seg[]; own: [number, number][] };
}

/** The tests of the search on one index: is a place clear of the cards, of the dots, of the other lines. */
interface Probes {
	offCards: (p: Spot) => boolean;
	clear: (p: Spot) => boolean;
	clearAll: (p: Spot, ok: (i: number) => boolean) => boolean;
	/** Whether segment `i` is not part of the rumoured line itself. */
	other: (i: number) => boolean;
}

/**
 * Only what lies near a point is looked at: nothing farther than `LINE_CLEAR_PX` (`DOT_CLEAR_PX` for a dot) from a point changes whether
 * it is clear. The grids give those by the point, not by the box of the curve's ends, which for a long link would hold half the drawing.
 */
function probesOf(ix: RumourIndex, own: [number, number], room: number): Probes {
	const { all, dots, cards } = ix;
	const other = (i: number) => i < own[0] || i >= own[1];
	const offCards = (p: Spot) => ix.cardsIn(p.x - room, p.y - room, p.x + room, p.y + room).every((i) => boxGap(p, cards[i]) >= room - TIE);
	const dotsClear = (p: Spot) => ix.dotsIn(p.x - DOT_CLEAR_PX, p.y - DOT_CLEAR_PX, p.x + DOT_CLEAR_PX, p.y + DOT_CLEAR_PX).every((i) => Math.hypot(p.x - dots[i].x, p.y - dots[i].y) > DOT_CLEAR_PX + TIE);
	// `ok` names the segments the place may touch: a place on the trunk's alternative is clear of every line but the curve's own pieces.
	const clearAll = (p: Spot, ok: (i: number) => boolean) => ix.segsIn(p.x - LINE_CLEAR_PX, p.y - LINE_CLEAR_PX, p.x + LINE_CLEAR_PX, p.y + LINE_CLEAR_PX).every((i) => ok(i) || beyond(p, all[i], LINE_CLEAR_PX) || distance(p, all[i]) > LINE_CLEAR_PX + TIE) && dotsClear(p) && offCards(p);
	return { offCards, clear: (p) => clearAll(p, (i) => !other(i)), clearAll, other };
}

/** The places along a path: its middle, then alternately each side of it, `steps` of them in all. */
const along = (at: (t: number) => Spot, steps: number): Spot[] => {
	const out: Spot[] = [];
	for (let i = 0; i <= steps; i++) out.push(at(MIDDLE + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (MIDDLE / Math.ceil(steps / 2))));
	return out;
};

/** The point of the curve that has the most room: a card-free point farthest from the other lines and the dots (nearer than the reach counts as the reach). */
function clearestOnCurve(curve: Curve, ix: RumourIndex, pr: Probes, start: Spot): Spot {
	const { all, dots } = ix;
	const reach = CLEAREST_REACH_PX;
	let best = start;
	let room = -1;
	for (let i = 2; i <= CLEAREST_STEPS - 2; i++) {
		const p = bezier(curve, i / CLEAREST_STEPS);
		if (!pr.offCards(p)) continue;
		// A loop, not a spread: a crowded drawing can have more lines here than an argument list takes.
		let d = reach;
		for (const s of ix.segsIn(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) if (pr.other(s) && !beyond(p, all[s], reach)) d = Math.min(d, distance(p, all[s]));
		for (const k of ix.dotsIn(p.x - reach - DOT_RADIUS_PX, p.y - reach - DOT_RADIUS_PX, p.x + reach + DOT_RADIUS_PX, p.y + reach + DOT_RADIUS_PX)) d = Math.min(d, Math.hypot(p.x - dots[k].x, p.y - dots[k].y) - DOT_RADIUS_PX);
		if (d > room + TIE) {
			room = d;
			best = p;
		}
	}
	return best;
}

/**
 * The "?" marker's spot on a rumour curve: its middle, or the nearest point along it clear of other lines, dots and cards. Sideways a
 * curve often crosses only one narrow gap between columns full of lanes; when no point is clear there, it takes the point furthest
 * from the other lines. A short drop with no clear point tries `near.alt` before that. The "?" never covers a card if any point it may
 * take is clear of the cards. `own` is the range of the curve's own segments in the index.
 */
export function rumourSpot(curve: Curve, ix: RumourIndex, own: [number, number], clearest: boolean, near: RumourRoom): Spot {
	const pr = probesOf(ix, own, near.room);
	for (let i = 0; i <= ALONG_STEPS; i++) {
		const p = bezier(curve, MIDDLE + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * ALONG_STEP_T);
		if (pr.clear(p)) return p;
	}
	const altSpots = (near.alt?.segs ?? []).flatMap(([x1, y1, x2, y2]) => along((t) => ({ x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }), ALT_STEPS));
	if (near.alt) {
		const mine = near.alt.own;
		const ok = (i: number) => mine.some(([a, b]) => i >= a && i < b);
		const spot = altSpots.find((p) => pr.clearAll(p, ok));
		if (spot) return spot;
	}
	const mid = bezier(curve, MIDDLE);
	if (!clearest) {
		if (pr.offCards(mid)) return mid;
	} else {
		const best = clearestOnCurve(curve, ix, pr, mid);
		if (pr.offCards(best)) return best;
	}
	// No place clear of the cards is also clear of the lines: the cards come first. A link between two cards of one row crosses only the
	// gap between them, so there it takes the gap's middle. Every place here is within `room` of a box, so the nearest box is in the grid
	// near it (the same answer as a scan of all boxes, much faster).
	const places = [...along((t) => bezier(curve, t), FALLBACK_STEPS), ...altSpots];
	const free = places.find(pr.offCards);
	if (free) return free;
	const reach = FALLBACK_REACH * near.room;
	const gap = (p: Spot) => ix.cardsIn(p.x - reach, p.y - reach, p.x + reach, p.y + reach).reduce((m, i) => Math.min(m, boxGap(p, ix.cards[i])), Infinity);
	return places.reduce((a, b) => (gap(b) > gap(a) + TIE ? b : a));
}
