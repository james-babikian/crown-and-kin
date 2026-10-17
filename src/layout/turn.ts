/*
 * D24 sideways layouts are arranged and routed in a turned frame: the `down` machinery runs
 * unchanged on cards whose extent along a generation is their real height, and every position is
 * then mirrored on the diagonal (x ↔ y). Generations become columns from left to right, and the
 * order along a generation (D2) becomes top to bottom. The mirror is exact: it only swaps numbers.
 * `pipeline.ts` calls these functions at the turned/sideways boundary.
 */
import type { EdgeDrawing, PersonBox, UnionPoint } from './model';

/** Mirrors a card's box on the diagonal: x ↔ y, w ↔ h; `tallName` and `tallTitle` stay. */
export const turnBox = (b: PersonBox): PersonBox => ({ ...b, x: b.y, y: b.x, w: b.h, h: b.w });

/** Mirrors a union point's position on the diagonal: x ↔ y. */
export const turnUnion = (u: UnionPoint): UnionPoint => ({ ...u, x: u.y, y: u.x });

/** Swaps x and y in an SVG path of M, H, V and C commands (the only ones the layout writes). */
export function turnPath(d: string): string {
	return d.replace(/([MHVC])([^MHVC]*)/g, (_, cmd: string, args: string) => {
		if (cmd === 'H') return `V${args}`;
		if (cmd === 'V') return `H${args}`;
		const n = args.trim().split(' ');
		const out: string[] = [];
		for (let i = 0; i + 1 < n.length; i += 2) out.push(n[i + 1], n[i]);
		return cmd + out.join(' ');
	});
}

/** Mirrors a whole `EdgeDrawing` back from the turned frame: every path with `turnPath`, every marker's x and y swapped. */
export function turnEdges(e: EdgeDrawing): EdgeDrawing {
	return { paths: e.paths.map((p) => ({ ...p, d: turnPath(p.d) })), markers: e.markers.map((m) => ({ ...m, x: m.y, y: m.x })) };
}
