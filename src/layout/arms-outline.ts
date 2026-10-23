/*
 * The outline of an arms picture, for the gap round it (spec D219). The gap in the colour of the page follows the shape of the picture itself (the
 * pixels that are not transparent), so a heater, a round, a lozenge, a banner or a square picture each get a gap that fits. The plugin's picture store
 * reads the picture's alpha channel once (a 128-pixel grid), `traceOutline` turns it into a closed path, and the outline is kept for the picture. A card
 * draws that path, placed in its arms box, filled and stroked in the page colour; the stroke (round joins, twice the gap wide) is what grows the shape by the gap,
 * so no filter and no work per frame is needed. Pure: no DOM, no vault; the scene, the saved picture and the picture store call it.
 */

import type { Rect } from './model';

/** The outline of one picture: a path in grid units, and the grid size `w` x `h`. The picture fills the box 0..w, 0..h. */
export interface ArmsOutline {
	w: number;
	h: number;
	/** Closed polygons (`M…L…Z`), several when the picture has several parts; draw with the even-odd rule. */
	d: string;
}

/** The longer side of the grid on which the alpha channel is read. 128 cells put the error of the edge under a tenth of a pixel on a card at four times zoom. */
export const OUTLINE_GRID = 128;
/** A pixel counts as part of the picture from this alpha (0 to 255) on; the edge lies where the alpha crosses it. */
const THRESHOLD = 128;
/** Parts smaller than this many cells are specks of noise, not shapes. */
const MIN_AREA = 4;
/** How far, in cells, the simplified path may leave the traced one. */
const TOLERANCE = 0.2;

/** The grid for a picture of `w` x `h` pixels: the longer side is `OUTLINE_GRID`, the other keeps the proportion. */
export function outlineGrid(w: number, h: number): { w: number; h: number } {
	if (!(w > 0 && h > 0)) return { w: 1, h: 1 };
	const k = OUTLINE_GRID / Math.max(w, h);
	return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

const rounded = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Traces the shape in an alpha grid. `rgba` is `w` x `h` RGBA pixels (as `getImageData` gives them); only the alpha is read. Gives null when
 * nothing is drawn (a clear picture). The edge is placed between the pixels by the alpha, so an anti-aliased round stays round.
 */
export function traceOutline(rgba: ArrayLike<number>, w: number, h: number): ArmsOutline | null {
	if (!(w >= 1 && h >= 1) || rgba.length < w * h * 4) return null;
	// One empty cell all round, so every contour closes.
	const lw = w + 2;
	const lh = h + 2;
	const field = new Uint8Array(lw * lh);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) field[(y + 1) * lw + x + 1] = rgba[(y * w + x) * 4 + 3]!;
	const inside = (i: number, j: number) => field[j * lw + i] >= THRESHOLD;

	// An edge of the grid has the id 2 * (j * lw + i) for the edge from (i, j) to (i + 1, j) and the next number for the edge down to (i, j + 1).
	const across = (i: number, j: number, down: boolean) => 2 * (j * lw + i) + (down ? 1 : 0);
	const links = new Map<number, number[]>();
	const join = (a: number, b: number) => {
		(links.get(a) ?? links.set(a, []).get(a)!).push(b);
		(links.get(b) ?? links.set(b, []).get(b)!).push(a);
	};
	for (let j = 0; j < lh - 1; j++) {
		for (let i = 0; i < lw - 1; i++) {
			const tl = inside(i, j);
			const tr = inside(i + 1, j);
			const br = inside(i + 1, j + 1);
			const bl = inside(i, j + 1);
			if (tl === tr && tr === br && br === bl) continue;
			const top = across(i, j, false);
			const right = across(i + 1, j, true);
			const bottom = across(i, j + 1, false);
			const left = across(i, j, true);
			const crossing = [tl !== tr, tr !== br, bl !== br, tl !== bl];
			if (crossing.filter(Boolean).length === 2) {
				const [a, b] = [top, right, bottom, left].filter((_, k) => crossing[k]);
				join(a, b);
				continue;
			}
			// A saddle: the middle decides whether the two inside corners are joined.
			const middle = (field[j * lw + i] + field[j * lw + i + 1] + field[(j + 1) * lw + i + 1] + field[(j + 1) * lw + i]) / 4 >= THRESHOLD;
			if (tl !== middle) join(left, top);
			if (tr !== middle) join(top, right);
			if (br !== middle) join(right, bottom);
			if (bl !== middle) join(bottom, left);
		}
	}

	const point = (id: number): [number, number] => {
		const down = (id & 1) === 1;
		const at = id >> 1;
		const i = at % lw;
		const j = (at - i) / lw;
		const a = field[at];
		const b = field[down ? at + lw : at + 1];
		const t = (THRESHOLD - a) / (b - a);
		// A cell of the grid is a pixel; its value belongs to its middle.
		return down ? [i - 0.5, j - 0.5 + t] : [i - 0.5 + t, j - 0.5];
	};

	const seen = new Set<number>();
	const parts: string[] = [];
	for (const start of links.keys()) {
		if (seen.has(start)) continue;
		const ring: [number, number][] = [];
		let prev = -1;
		let cur = start;
		while (!seen.has(cur)) {
			seen.add(cur);
			ring.push(point(cur));
			const next = links.get(cur)!.find((n) => n !== prev && !seen.has(n));
			if (next === undefined) break;
			prev = cur;
			cur = next;
		}
		if (ring.length < 3 || Math.abs(areaOf(ring)) < MIN_AREA) continue;
		const slim = simplify(ring);
		if (slim.length < 3) continue;
		parts.push(`M${slim.map(([x, y]) => `${rounded(x)} ${rounded(y)}`).join('L')}Z`);
	}
	return parts.length ? { w, h, d: parts.join('') } : null;
}

function areaOf(ring: readonly [number, number][]): number {
	let s = 0;
	for (let k = 0; k < ring.length; k++) {
		const [x0, y0] = ring[k];
		const [x1, y1] = ring[(k + 1) % ring.length];
		s += x0 * y1 - x1 * y0;
	}
	return s / 2;
}

/** The distance of `p` from the segment `a`-`b`. */
function farFrom(p: readonly number[], a: readonly number[], b: readonly number[]): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const len = dx * dx + dy * dy;
	const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on a closed ring: it is split at the point that is farthest from the first, so no corner is lost at the seam. */
function simplify(ring: readonly [number, number][]): [number, number][] {
	let far = 0;
	let best = -1;
	for (let k = 1; k < ring.length; k++) {
		const d = Math.hypot(ring[k][0] - ring[0][0], ring[k][1] - ring[0][1]);
		if (d > best) {
			best = d;
			far = k;
		}
	}
	const keep = new Set<number>([0, far]);
	const stack: [number, number][] = [
		[0, far],
		[far, ring.length],
	];
	while (stack.length) {
		const [lo, hi] = stack.pop()!;
		const a = ring[lo];
		const b = ring[hi % ring.length];
		let worst = -1;
		let at = -1;
		for (let k = lo + 1; k < hi; k++) {
			const d = farFrom(ring[k], a, b);
			if (d > worst) {
				worst = d;
				at = k;
			}
		}
		if (at >= 0 && worst > TOLERANCE) {
			keep.add(at);
			stack.push([lo, at], [at, hi]);
		}
	}
	return ring.filter((_, k) => keep.has(k));
}

/** What a card draws for the gap: the path in layout px, and the stroke width that grows the shape by the gap. */
export interface ArmsGap {
	d: string;
	strokeWidth: number;
}


/**
 * Places `outline` in the box `rect` of a card's arms picture (the picture is drawn there with "meet", in the middle) and sizes the stroke so that the gap is
 * `gap` layout px wide on every side. The coordinates are written out in layout px and the path has no transform: with a transform attribute the 55 paths of
 * a view cost about a millisecond more main-thread time in every frame of a pan (measured in Chrome on sample tree 07b); the path of one card is short.
 */
export function armsGap(outline: ArmsOutline, rect: Rect, gap: number): ArmsGap {
	const s = Math.min(rect.w / outline.w, rect.h / outline.h);
	const tx = rect.x + (rect.w - outline.w * s) / 2;
	const ty = rect.y + (rect.h - outline.h * s) / 2;
	const d = outline.d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x: string, y: string) => `${rounded(tx + Number(x) * s)} ${rounded(ty + Number(y) * s)}`);
	return { d, strokeWidth: Math.round(2 * gap * 100) / 100 };
}
