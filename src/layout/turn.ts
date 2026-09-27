/*
 * D24 sideways layouts are arranged and routed in a turned frame: the `down` machinery runs
 * unchanged on cards whose extent along a generation is their real height, and every position is
 * then mirrored on the diagonal (x ↔ y). Generations become columns from left to right, and the
 * order along a generation (D2) becomes top to bottom. The mirror is exact: it only swaps numbers.
 * `layout.ts` and `edges.ts` call these functions at the turned/sideways boundary.
 */
import { turnedGeometry } from './geometry';
import type { EdgeDrawing, PersonBox, TreeLayout, UnionPoint } from './model';

/** Mirrors a card's box on the diagonal: x ↔ y, w ↔ h. */
export const turnBox = (b: PersonBox): PersonBox => ({ id: b.id, x: b.y, y: b.x, w: b.h, h: b.w, gen: b.gen });

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

/**
 * A finished sideways layout back in the turned frame, for routing. Tags are not needed there:
 * the line plan finds them again from the far couples.
 */
export function turnBack(layout: TreeLayout): TreeLayout {
	const persons = new Map<string, PersonBox>();
	for (const [id, b] of layout.persons) persons.set(id, turnBox(b));
	const unions = new Map<string, UnionPoint>();
	for (const [key, u] of layout.unions) unions.set(key, turnUnion(u));
	return {
		persons,
		unions,
		rows: layout.rows,
		rowGaps: layout.rowGaps,
		orientation: 'sideways',
		farTags: new Map(),
		width: layout.height,
		height: layout.width,
		geometry: turnedGeometry(layout.geometry),
	};
}
