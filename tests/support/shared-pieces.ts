// The straight pieces that routed side links share (D343 1 C): the check of `side-routes-apart` and of the lines of a group.
import type { EdgePath } from '../../src/layout/model';

export const SIDE = ['rumoured', 'adoptive', 'ward', 'begetter', 'birth-link'];

/** The straight runs that follow a curve in a side-link path: `V` pieces down, `H` pieces sideways (the drawing is already turned); `last` marks the path's end piece. */
function runs(d: string, horizontal: boolean): { k: number; a: number; b: number; last: boolean }[] {
	const out: { k: number; a: number; b: number; last: boolean }[] = [];
	const re = /([MHVC])([^MHVC]*)/g;
	let m: RegExpExecArray | null;
	let x = 0;
	let y = 0;
	let afterC = false;
	while ((m = re.exec(d))) {
		const n = m[2].trim().split(/\s+/).map(Number);
		if (m[1] === 'M') [x, y] = n;
		else if (m[1] === 'C') {
			afterC = true;
			[x, y] = [n[4], n[5]];
		} else if (m[1] === (horizontal ? 'H' : 'V')) {
			const last = re.lastIndex >= d.length;
			if (afterC) out.push(horizontal ? { k: y, a: Math.min(x, n[0]), b: Math.max(x, n[0]), last } : { k: x, a: Math.min(y, n[0]), b: Math.max(y, n[0]), last });
			if (horizontal) x = n[0];
			else y = n[0];
		} else if (m[1] === 'H') x = n[0];
		else y = n[0];
	}
	return out;
}

/**
 * The pairs of routed side links that have a straight piece on the same line for more than 5 px. Two links to one child that both rise into its card
 * from below end on one straight piece under that card (as two plain curves end at one point); that piece is hidden and does not count.
 */
export function sharedPieces(paths: readonly EdgePath[], horizontal: boolean): string[] {
	const routed = paths.filter((p) => SIDE.includes(p.kind) && (p.d.match(/C/g) ?? []).length > 1);
	const rs = routed.map((p) => runs(p.d, horizontal));
	const out: string[] = [];
	for (let i = 0; i < routed.length; i++) {
		for (let j = i + 1; j < routed.length; j++) {
			const underChild = (a: { last: boolean }, b: { last: boolean }) => a.last && b.last && routed[i].child === routed[j].child;
			for (const a of rs[i]) for (const b of rs[j]) if (Math.abs(a.k - b.k) < 1 && Math.min(a.b, b.b) - Math.max(a.a, b.a) > 5 && !underChild(a, b)) out.push(`${routed[i].kind} ${routed[i].people} and ${routed[j].kind} ${routed[j].people} on ${a.k} for ${Math.min(a.b, b.b) - Math.max(a.a, b.a)} px`);
		}
	}
	return out;
}

