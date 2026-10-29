/*
 * The nets of a gap between two rows and their lanes (stage S4). A net is a horizontal piece (a couple line with
 * its dot, a hop of a passing line, a far dot of length 0, a sibling bar, a single parent's stem to a hang passage) with the verticals
 * that reach it from above and leave it downward, and zones: rectangles that hang on the net (a fold control's visible mark, which no
 * foreign line may cross, and its tap area, which no other tap area or tag may meet). Lane packing gives every net of a band the first
 * lane, in a crossing-aware order, where its line, its zones and the band's fixed zones (the controls of bar families and single
 * parents, the tags) are all clear. Every comparison of positions has the one tie rule `TIE`, and the order in which the nets are taken
 * is a total order that does not depend on the order they are given in.
 */
import { TIE } from './geometry';

/** A zone on a net or in a band: a rectangle over [lo, hi] along the row, from `top` to `bottom` across it (down positive, relative to the net's line, or to the band's origin for a fixed zone). */
export interface Zone {
	lo: number;
	hi: number;
	top: number;
	bottom: number;
	/** `mark`: a visible mark, which no foreign line crosses; `hit`: a tap area, which no other tap area meets. */
	kind: 'mark' | 'hit';
}

/** A horizontal piece in a gap. */
export interface Net {
	gap: number;
	lo: number;
	hi: number;
	/** Names the net; unique among the nets of a gap. The order of nets that start at one place is the order of their keys. */
	key: string;
	kind: 'dot' | 'far' | 'hop' | 'bar' | 'stem';
	/** The parents of the net's family (a sibling bar): bars of two families with a parent in common stay `kinGap` apart, so that they never read as one family. */
	owners?: readonly string[];
	/** x of the verticals that reach the net from above, and of those that leave it downward. */
	topVerts: number[];
	downVerts: number[];
	lane: number;
	zones: Zone[];
}

/** A net with no zones, the lane not yet given. */
export const net = (n: Omit<Net, 'lane' | 'zones'>): Net => ({ ...n, lane: 0, zones: [] });

/** A vertical this far inside a net's end still crosses it; at its very end it meets it (half a stroke width). */
const INSIDE = 0.5;

/** The cost of two verticals on one line (never taken while any crossing-only order exists): more than the verticals a gap can hold. */
const SAME_X_COST = 1e6;

/** The rectangle of a zone or a net's stretch, as the clash tests read it. */
type Stretch = { lo: number; hi: number };
type Rect4 = Stretch & { top: number; bottom: number };

/** Whether a net's line within `near` of a stretch along the row would touch what stands there. */
const alongside = (a: Stretch, b: Stretch, near: number) => a.lo - near <= b.hi + TIE && b.lo - near <= a.hi + TIE;

/** Whether two rectangles meet (an edge-to-edge touch within `TIE` is not a meeting). */
const meets = (a: Rect4, b: Rect4) => a.lo < b.hi - TIE && b.lo < a.hi - TIE && a.top < b.bottom - TIE && b.top < a.bottom - TIE;

/** A zone of a net at a lane, or a fixed zone, as an absolute rectangle across the band (from the band's origin). */
const at = (z: Zone, y: number): Rect4 & { kind: Zone['kind'] } => ({ lo: z.lo, hi: z.hi, top: y + z.top, bottom: y + z.bottom, kind: z.kind });

/**
 * The nets in the order they take their lanes: by where they start, then by key. Two starts within `TIE` of each other are one place,
 * and "within TIE" is followed along the sorted starts (a chain of near starts is one place), so the order is a total order that
 * the order of the input never changes. Keys are unique, so no two nets tie.
 */
export function netOrder(nets: readonly Net[]): Net[] {
	const byStart = [...nets].sort((a, b) => a.lo - b.lo);
	const place = new Map<Net, number>();
	let current = 0;
	byStart.forEach((n, i) => {
		if (i && n.lo - byStart[i - 1].lo > TIE) current++;
		place.set(n, current);
	});
	return [...nets].sort((a, b) => place.get(a)! - place.get(b)! || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * For each net, the nets that must take their lane first: those that lie nearer lane 0. Of two nets whose lines would lie alongside,
 * the one above is the one whose order costs fewer crossings (a vertical of the lower net reaching it from above crosses the upper net
 * where it spans that x; a vertical leaving the upper net downward crosses the lower net where it spans that x), and a net reached
 * from above within `near` of where another net is left downward is always above it (`SAME_X_COST`).
 */
function precedence(list: readonly Net[], room: (a: Net, b: Net) => number, near: number, grow: 'down' | 'up'): Map<Net, Net[]> {
	const inside = (x: number, n: Net) => x > n.lo + INSIDE + TIE && x < n.hi - INSIDE - TIE;
	const same = (up: Net, down: Net) => up.downVerts.filter((x) => down.topVerts.some((y) => Math.abs(x - y) < near - TIE)).length;
	const cost = (up: Net, down: Net) => down.topVerts.filter((x) => inside(x, up)).length + up.downVerts.filter((x) => inside(x, down)).length + SAME_X_COST * same(up, down);
	const first = new Map<Net, Net[]>(list.map((n) => [n, []]));
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const [a, b] = [list[i], list[j]];
			if (!alongside(a, b, room(a, b))) continue;
			const ab = cost(a, b);
			const ba = cost(b, a);
			if (ab === ba) continue;
			const upper = ab < ba ? a : b;
			const lowerNet = upper === a ? b : a;
			if (grow === 'down') first.get(lowerNet)!.push(upper);
			else first.get(upper)!.push(lowerNet);
		}
	}
	return first;
}

/**
 * The placed nets of a band by lane, and the test "the lane `lane` is not free for net `n`", for a band whose lane `l` lies at `y(l)`,
 * with its `fixed` zones. A placed net `o` can only clash with a net at `lane` when their lines are less than `reach` apart (two zones
 * are at most two zone depths and a `near` from each other when they meet), so only the lanes within `window` of it are read: a net
 * on every lane, as one person with many partners makes, would otherwise make the packing cubic in the nets.
 */
function laneBlocker(nets: readonly Net[], fixed: readonly Zone[], room: (a: Net, b: Net) => number, near: number, step: number, y: (lane: number) => number): { blocked: (n: Net, lane: number) => boolean; add: (n: Net) => void } {
	const depth = Math.max(0, ...fixed.map((z) => Math.max(Math.abs(z.top), Math.abs(z.bottom))), ...nets.flatMap((n) => n.zones.map((z) => Math.max(Math.abs(z.top), Math.abs(z.bottom)))));
	const window = step > 0 ? Math.floor((2 * depth + near) / step) + 1 : Infinity;
	const byLane = new Map<number, Net[]>();
	let lanesUsed = 0;
	// A net's line (its lane y, `near` thick) crosses a mark zone when it lies inside the zone's rows and alongside its stretch.
	const lineInMark = (n: Net, yn: number, z: Rect4) => yn > z.top - near + TIE && yn < z.bottom + near - TIE && alongside(z, n, near);
	const clash = (o: Net, n: Net, lane: number, yn: number) => {
		const yo = y(o.lane);
		if (o.lane === lane && alongside(o, n, room(o, n))) return true;
		if (o.zones.some((k) => (k.kind === 'mark' ? lineInMark(n, yn, at(k, yo)) : n.zones.some((j) => j.kind === 'hit' && meets(at(j, yn), at(k, yo)))))) return true;
		return n.zones.some((k) => k.kind === 'mark' && lineInMark(o, yo, at(k, yn)));
	};
	return {
		blocked: (n, lane) => {
			const yn = y(lane);
			for (const z of fixed) {
				if (z.kind === 'mark' ? lineInMark(n, yn, z) : n.zones.some((k) => k.kind === 'hit' && meets(at(k, yn), z))) return true;
			}
			// The lane itself first: with a net on every lane it is where a lane is most often found taken.
			if (byLane.get(lane)?.some((o) => clash(o, n, lane, yn))) return true;
			for (let l = Math.max(0, lane - window); l <= Math.min(lanesUsed - 1, lane + window); l++) if (l !== lane && byLane.get(l)?.some((o) => clash(o, n, lane, yn))) return true;
			return false;
		},
		add: (n) => {
			const list = byLane.get(n.lane);
			if (list) list.push(n);
			else byLane.set(n.lane, [n]);
			lanesUsed = Math.max(lanesUsed, n.lane + 1);
		},
	};
}

/**
 * Gives the nets of one band lanes (`step` apart from `lane0`); returns the number of lanes used. Lane 0 is the top of a `down`
 * band and the bottom of an `up` band, and y counts from the band's origin in the band's direction. Two nets whose lines would lie
 * alongside each other take different lanes, in the order of `precedence`. The nets are taken in `netOrder`: each takes the first lane
 * after the nets that must come first where its line crosses no mark zone, its line and zones meet no fixed zone, and its tap
 * areas meet no placed tap area; a cycle of preferences is cut at the first net in that order.
 */
export function orderNets(nets: Net[], margin: number, near: number, grow: 'down' | 'up', step: number, lane0: number, fixed: readonly Zone[], kinGap = margin): number {
	if (!nets.length) return 0;
	const list = netOrder(nets);
	const room = (a: Net, b: Net) => (a.owners && b.owners?.some((o) => a.owners!.includes(o)) ? Math.max(margin, kinGap) : margin);
	const first = precedence(list, room, near, grow);
	const { blocked, add } = laneBlocker(list, fixed, room, near, step, (lane) => lane0 + lane * step);
	// Each net waits for the nets that must come first: `waiting` counts those not yet placed, `after` lists whom a placed net releases.
	const index = new Map(list.map((n, i) => [n, i]));
	const waiting = list.map((n) => first.get(n)!.length);
	const after: number[][] = list.map(() => []);
	list.forEach((n, i) => first.get(n)!.forEach((o) => after[index.get(o)!].push(i)));
	const placed = list.map(() => false);
	let used = 0;
	// Bounded: every pass of the loop places one net, so it runs `list.length` times.
	for (let count = 0; count < list.length; count++) {
		// The first net in the order whose predecessors are all placed; if a cycle leaves none, the first net not yet placed.
		let at = placed.findIndex((p, i) => !p && waiting[i] === 0);
		if (at < 0) at = placed.indexOf(false);
		const n = list[at];
		let lane = 0;
		for (const o of first.get(n)!) if (placed[index.get(o)!]) lane = Math.max(lane, o.lane + 1);
		// Bounded: every net placed and every fixed zone blocks a fixed stretch of lanes, so a free lane is found within that many.
		while (blocked(n, lane)) lane++;
		n.lane = lane;
		placed[at] = true;
		for (const i of after[at]) waiting[i]--;
		add(n);
		used = Math.max(used, lane + 1);
	}
	return used;
}
