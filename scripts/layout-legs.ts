/*
 * The legs of couples on two rows, and the crossings they make (0.5 step 1(c), spec §5.3, D303). A leg is the line of the upper partner of
 * a near couple on two rows: it runs down through a passage in the lower partner's row to the union dot under the lower partner. The old
 * layout metric (`crossings` in `metrics.ts`) counts only pairs of parent-to-child drops, so it never saw a leg that crosses a trunk, a
 * sibling bar or a side-link curve. `legCrossings` counts those, straight lines and curves both; `twoRowLegs` says what each leg passes.
 * Used by `measureLayout`, the spike report, the counting scripts and the tests. A sideways layout is measured in the turned frame, so
 * that "down" always means toward the children (as `measureLines` does).
 */
import type { FamilyGraph } from '../src/core/derive';
import type { EdgeDrawing, EdgePath, TreeLayout } from '../src/layout/model';
import { turnBox, turnEdges, turnUnion } from '../src/layout/turn';

/** One straight piece of a drawn path (a curve is flattened into many). */
export interface Piece {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	/** The start or end is a joint inside a flattened curve, not a real end of the line. */
	joinStart?: boolean;
	joinEnd?: boolean;
}

/** The pieces of a path of M, H, V, L and C commands; a cubic curve is cut into 24 straight pieces. */
export function piecesOf(d: string): Piece[] {
	const out: Piece[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVLC])([^MHVLC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else if (cmd === 'V') {
			out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		} else if (cmd === 'L') {
			out.push({ x1: x, y1: y, x2: n[0], y2: n[1] });
			[x, y] = n;
		} else {
			let px = x;
			let py = y;
			const steps = 24;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const u = 1 - t;
				const qx = u * u * u * x + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4];
				const qy = u * u * u * y + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5];
				out.push({ x1: px, y1: py, x2: qx, y2: qy, ...(i > 1 ? { joinStart: true } : {}), ...(i < steps ? { joinEnd: true } : {}) });
				px = qx;
				py = qy;
			}
			[x, y] = [n[4], n[5]];
		}
	}
	return out.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 1e-9);
}

/** Two pieces cross inside both (not at or within half a px of an end of either): a crossing a reader sees. */
export function piecesCross(a: Piece, b: Piece): boolean {
	const dax = a.x2 - a.x1;
	const day = a.y2 - a.y1;
	const dbx = b.x2 - b.x1;
	const dby = b.y2 - b.y1;
	const den = dax * dby - day * dbx;
	if (Math.abs(den) < 1e-12) return false;
	const t = ((b.x1 - a.x1) * dby - (b.y1 - a.y1) * dbx) / den;
	const s = ((b.x1 - a.x1) * day - (b.y1 - a.y1) * dax) / den;
	const la = Math.hypot(dax, day);
	const lb = Math.hypot(dbx, dby);
	const e = 0.5;
	// Half a px from a real end does not count; a joint inside a curve is half-open (its start counts, its end belongs to the next piece),
	// so a line that crosses a curve at a joint is counted exactly once (G2 of 0.5 step 1c).
	const inside = (u: number, len: number, joinStart?: boolean, joinEnd?: boolean) =>
		(joinStart ? u >= 0 : u * len > e) && (joinEnd ? u < 1 : (1 - u) * len > e);
	return inside(t, la, a.joinStart, a.joinEnd) && inside(s, lb, b.joinStart, b.joinEnd);
}

const COUPLE = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);

/** The family a drawn path belongs to: its union, or its parents (a parent alone, a side link). */
function familyOf(p: EdgePath): string {
	if (p.union !== undefined) return `u:${p.union}`;
	// A side link (a curve) without a union is a family of its own: its parents and its child.
	return `p:${[...(p.parents ?? p.people)].sort().join('|')}${p.child !== undefined && p.d.includes('C') ? `>${p.child}` : ''}`;
}

/** What is found about one leg of a couple on two rows. */
export interface LegFinding {
	union: string;
	kind: string;
	upper: string;
	lower: string;
	/** Cards of the lower row (the lower partner left out) whose middle lies under the leg's last sideways run. */
	passesUnder: number;
	/** The leg's passage stands outside every card of the lower row: the line goes round the edge of the tree. */
	edge: boolean;
	/** Length of the leg's last sideways run, in px. */
	run: number;
	/** Straight lines of other families that the leg crosses. */
	crossings: string[];
	/** Side-link curves (rumoured, adoptive, ...) of other families that the leg crosses. */
	curveCrossings: string[];
}

/** A finished layout and its lines in the frame where "down" is toward the children: a sideways layout is turned back. */
function upright(layout: TreeLayout, edges: EdgeDrawing): { layout: TreeLayout; edges: EdgeDrawing } {
	if (layout.orientation !== 'sideways') return { layout, edges };
	const persons = new Map([...layout.persons].map(([id, b]) => [id, turnBox(b)]));
	const unions = new Map([...layout.unions].map(([key, u]) => [key, turnUnion(u)]));
	return { layout: { ...layout, persons, unions }, edges: turnEdges(edges) };
}

/** The legs of every near couple on two rows of a finished layout, with what they pass and cross. */
export function twoRowLegs(g: FamilyGraph, drawn: TreeLayout, drawnEdges: EdgeDrawing): LegFinding[] {
	const { layout, edges } = upright(drawn, drawnEdges);
	const out: LegFinding[] = [];
	const lines = edges.paths.map((p) => ({ p, fam: familyOf(p), pieces: piecesOf(p.d), curve: p.d.includes('C') }));
	for (const l of lines) {
		const p = l.p;
		if (!COUPLE.has(p.kind) || p.people.length !== 2 || p.parents?.length !== 1 || p.union === undefined) continue;
		const u = layout.unions.get(p.union);
		const fu = g.unionByKey.get(p.union);
		if (!u || !fu || u.far || u.bar) continue;
		const [a, b] = fu.partners.map((id) => layout.persons.get(id));
		if (!a || !b || a.gen === b.gen) continue;
		const [upper, lower] = a.gen < b.gen ? [a, b] : [b, a];
		// The lower partner's own line is the short drop to the dot; the leg is the upper partner's line.
		if (p.parents[0] !== upper.id) continue;
		const sideways = l.pieces.filter((s) => s.y1 === s.y2);
		const last = sideways[sideways.length - 1];
		let passesUnder = 0;
		let edge = false;
		let run = 0;
		if (last) {
			const lo = Math.min(last.x1, last.x2);
			const hi = Math.max(last.x1, last.x2);
			run = hi - lo;
			const row = (layout.rows[lower.gen] ?? []).map((id) => layout.persons.get(id)!).filter(Boolean);
			passesUnder = row.filter((c) => c.id !== lower.id && c.x + c.w / 2 > lo && c.x + c.w / 2 < hi).length;
			const passage = last.x1;
			edge = row.length > 0 && (passage < Math.min(...row.map((c) => c.x)) || passage > Math.max(...row.map((c) => c.x + c.w)));
		}
		const crossings: string[] = [];
		const curveCrossings: string[] = [];
		for (const o of lines) {
			if (o === l || o.fam === l.fam) continue;
			let n = 0;
			for (const s of l.pieces) for (const t of o.pieces) if (piecesCross(s, t)) n++;
			for (let i = 0; i < n; i++) (o.curve ? curveCrossings : crossings).push(`${o.p.kind} [${o.p.people.join(',')}]`);
		}
		out.push({ union: p.union, kind: p.kind, upper: upper.id, lower: lower.id, passesUnder, edge, run, crossings, curveCrossings });
	}
	return out;
}

/** The crossings that the legs of couples on two rows make with the lines of other families, straight lines and side-link curves both. */
export function legCrossings(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): number {
	return twoRowLegs(g, layout, edges).reduce((n, l) => n + l.crossings.length + l.curveCrossings.length, 0);
}
