import type { EdgeDrawing, StrokeKind, TreeLayout, UnionPoint } from '../../src/layout/model';

export interface Pt {
	x: number;
	y: number;
}

/**
 * The points an SVG path passes through (segment end points; curve control points are skipped).
 * Handles absolute and relative M, L, H, V, C, S, Q, T, A and Z, so the tests do not depend on how
 * the router happens to write its paths.
 */
export function pathPoints(d: string): Pt[] {
	const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
	const pts: Pt[] = [];
	let i = 0;
	let cmd = '';
	let x = 0;
	let y = 0;
	let sx = 0;
	let sy = 0;
	const isCmd = (t: string | undefined) => t !== undefined && /^[a-zA-Z]$/.test(t);
	const num = () => Number(tokens[i++]);
	while (i < tokens.length) {
		if (isCmd(tokens[i])) cmd = tokens[i++];
		const rel = cmd !== cmd.toUpperCase();
		const bx = rel ? x : 0;
		const by = rel ? y : 0;
		switch (cmd.toUpperCase()) {
			case 'M':
			case 'L':
			case 'T': {
				x = bx + num();
				y = by + num();
				if (cmd.toUpperCase() === 'M') {
					sx = x;
					sy = y;
					// Later pairs after M are line segments.
					cmd = rel ? 'l' : 'L';
				}
				break;
			}
			case 'H':
				x = bx + num();
				break;
			case 'V':
				y = by + num();
				break;
			case 'C':
				i += 4;
				x = bx + num();
				y = by + num();
				break;
			case 'S':
			case 'Q':
				i += 2;
				x = bx + num();
				y = by + num();
				break;
			case 'A':
				i += 5;
				x = bx + num();
				y = by + num();
				break;
			case 'Z':
				x = sx;
				y = sy;
				if (!isCmd(tokens[i])) i = tokens.length;
				break;
			default:
				throw new Error(`Cannot read path "${d}"`);
		}
		pts.push({ x, y });
	}
	return pts;
}

/** Lines from a parent (or couple) down to a child, in any of their §5.3 styles. */
export const DESCENT_KINDS: StrokeKind[] = ['descent', 'illegitimate', 'adoptive', 'ward'];
export const COUPLE_KINDS: StrokeKind[] = ['marriage', 'betrothal', 'concubinage', 'affair', 'implicit'];

/**
 * True if the child's drop meets a descent line that starts at this union's dot: the drop's top
 * lies on a horizontal run (the sibling bar or the trunk itself) of a line leaving the dot.
 * `tol` is how far from the dot's centre a trunk may start (the dot's own size).
 */
export function hangsFrom(edges: EdgeDrawing, layout: TreeLayout, u: UnionPoint, child: string, tol: number): boolean {
	const c = layout.persons.get(child)!;
	const cx = c.x + c.w / 2;
	// A trunk also lists every child of its family (the decision notes), so the child's own drop is the
	// line that lists the fewest people. For an only child the two are alike, and either works.
	const mine = edges.paths.filter((p) => DESCENT_KINDS.includes(p.kind) && p.people.includes(child));
	if (!mine.length) return false;
	const fewest = Math.min(...mine.map((p) => p.people.length));
	const drops = mine.filter((p) => p.people.length === fewest);
	// The nearest point above the card on the child's column: the sibling bar, or the dot itself.
	const tops = drops.flatMap((p) => pathPoints(p.d).filter((q) => Math.abs(q.x - cx) <= 1 && q.y < c.y - 1));
	if (!tops.length) return false;
	const barY = Math.max(...tops.map((q) => q.y));
	const trunks = edges.paths.filter((p) => {
		if (!DESCENT_KINDS.includes(p.kind)) return false;
		const first = pathPoints(p.d)[0];
		return first !== undefined && Math.abs(first.x - u.x) <= tol && Math.abs(first.y - u.y) <= tol;
	});
	return trunks.some((t) => {
		const pts = pathPoints(t.d);
		const onBar = pts.filter((q) => Math.abs(q.y - barY) <= 1).map((q) => q.x);
		return onBar.length > 0 && Math.min(...onBar) - 1 <= cx && cx <= Math.max(...onBar) + 1;
	});
}
