/*
 * The relation finder's line on a drawn tree (spec §13.2, D47): which lines, union signs, far-couple
 * tags and cards are on the line, and which are faded. `render/dom/scene.ts` and `render/svg-string.ts`
 * both call `lineLook`, so the plugin and the headless pictures mark the same parts. It reads only the
 * finished layout and lines (`EdgePath.union/parents/child`, `EdgeMarker.union`); it never lays out.
 *
 * A line that carries the relation only in part is split: a sibling bar is marked only from the trunk
 * to the drops of the children on the line, and a couple's bar only from the partner on the line to
 * the union sign, so the highlight never runs past the people it joins.
 */
import type { FamilyGraph } from '../core/derive';
import type { EdgeDrawing, EdgePath, FarTag, StrokeKind, TreeLayout } from '../layout/model';

/** The finder's line as `SceneOptions.line` and `SvgOptions.line` give it. */
export interface LineMarks {
	people: ReadonlySet<string>;
	unions: ReadonlySet<string>;
	/** `${parent}\0${child}` of every parent link on the line. */
	links: ReadonlySet<string>;
	/** "Show in the whole tree": every part that is not on the line is faded. */
	fade?: boolean;
}

/** How one part is drawn: on the line (`dynasty-on-line`), faded (`dynasty-faded`), or as usual. */
export type LineState = 'on' | 'faded' | undefined;

/** One line to draw: a whole `EdgePath`, or a piece of one that was split. */
export interface DrawnPath {
	d: string;
	kind: StrokeKind;
	state: LineState;
}

/** What `lineLook` returns: the lines in drawing order, and the state of each marker, card and tag. */
export interface LineLook {
	/** The lines to draw, in order. With a line: the other lines first, then the ones on the line, so crossings never hide it. */
	paths: DrawnPath[];
	/** The state of each marker of `edges.markers`, same index. */
	markers: LineState[];
	card: (id: string) => LineState;
	tag: (tag: FarTag) => LineState;
}

type Axis = 'x' | 'y';
interface Sub {
	x: number;
	y: number;
	cmd: 'H' | 'V';
	to: number;
}

/** The subpaths of a straight path the layout wrote (`M x y` then one `H` or `V` each). Null for a curve or anything else. */
function straight(d: string): Sub[] | null {
	const out: Sub[] = [];
	const re = /M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g;
	let used = 0;
	for (const m of d.matchAll(re)) {
		if (m.index !== used) return null;
		used += m[0].length;
		out.push({ x: Number(m[1]), y: Number(m[2]), cmd: m[3] as 'H' | 'V', to: Number(m[4]) });
	}
	return used === d.length && out.length ? out : null;
}

const subD = (s: Sub) => `M${s.x} ${s.y}${s.cmd}${s.to}`;
const axisOf = (s: Sub): Axis => (s.cmd === 'H' ? 'x' : 'y');
/** A piece `lo`–`hi` of the straight run `s`, along its own axis. */
const piece = (s: Sub, lo: number, hi: number) => (s.cmd === 'H' ? `M${lo} ${s.y}H${hi}` : `M${s.x} ${lo}V${hi}`);

/** Splits the run `s` into pieces: those inside `on` and the rest. */
function split(s: Sub, on: [number, number][]): { on: string[]; off: string[] } {
	const from = axisOf(s) === 'x' ? s.x : s.y;
	const [lo, hi] = from <= s.to ? [from, s.to] : [s.to, from];
	const spans = on
		.map(([a, b]): [number, number] => [Math.max(lo, Math.min(a, b)), Math.min(hi, Math.max(a, b))])
		.filter(([a, b]) => b - a > 0.05)
		.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const sp of spans) {
		const last = merged[merged.length - 1];
		if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
		else merged.push([...sp]);
	}
	const out = { on: merged.map(([a, b]) => piece(s, a, b)), off: [] as string[] };
	let at = lo;
	for (const [a, b] of merged) {
		if (a - at > 0.05) out.off.push(piece(s, at, a));
		at = b;
	}
	if (hi - at > 0.05) out.off.push(piece(s, at, hi));
	return out;
}

/**
 * The look of the finder's `line` on the drawn tree (see the file header). The rules:
 * a couple's bar is on if a union of the pair is in `unions`; a leg of union u from partner X if u is
 * in `unions` or a line link joins X to a child of u; a trunk if a line link joins one of its parents
 * to one of its children; a drop or side link if a line link is (parent, child); a union sign if its
 * union is in `unions` or one of its legs, its part of the bar, a trunk or a side link from it is on;
 * a far tag of X if X is on the line and a union of X with one of the tag's partners is in `unions`.
 * A line link from the partner who is not a far couple's anchor turns on both tags and
 * the anchor's leg. Every leg of the lines ends on its union sign, so a leg is on or off as a whole.
 * Each rumoured line with a `child` has one "?" marker, in path order (`layout/draw.ts`); the marker
 * follows its line.
 */
export function lineLook(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing, line?: LineMarks): LineLook {
	if (!line) {
		return { paths: edges.paths.map((p) => ({ d: p.d, kind: p.kind, state: undefined })), markers: edges.markers.map(() => undefined), card: () => undefined, tag: () => undefined };
	}
	const off: LineState = line.fade ? 'faded' : undefined;
	const has = (parent: string, child: string) => line.links.has(`${parent}\0${child}`);
	const kidsOf = new Map<string, string[]>();
	for (const fu of g.unions) kidsOf.set(fu.key, [...fu.children]);
	for (const s of g.secondary) if (s.unionKey) kidsOf.get(s.unionKey)?.push(s.child);
	const pairKey = (a: string, b: string) => [a, b].sort().join('\0');
	const pairOn = new Set<string>();
	for (const key of line.unions) {
		const fu = g.unionByKey.get(key);
		if (fu) pairOn.add(pairKey(...fu.partners));
	}
	// A far couple's sign hangs below its anchor only (D10): a line link from the other partner reaches
	// it through the two tags and the anchor's leg, so those carry the line (spec §13.2).
	const anchorOf = new Map<string, string>();
	for (const p of edges.paths) if (p.union !== undefined && p.child === undefined && p.parents?.length === 1 && layout.unions.get(p.union)?.far) anchorOf.set(p.union, p.parents[0]);
	const farOn = new Set<string>();
	const farPairs = new Set<string>();
	for (const p of edges.paths) {
		const anchor = p.union === undefined ? undefined : anchorOf.get(p.union);
		if (p.child === undefined || anchor === undefined) continue;
		for (const x of p.parents ?? []) {
			if (!has(x, p.child) || x === anchor) continue;
			farOn.add(p.union!);
			farPairs.add(`${x}\0${anchor}`).add(`${anchor}\0${x}`);
		}
	}
	const legOn = (u: string, x: string) => line.unions.has(u) || farOn.has(u) || (kidsOf.get(u) ?? []).some((c) => has(x, c));
	// Unions whose sign is on: in `unions`, or reached by a leg, a part of a bar, a trunk or a side link on the line.
	const signOn = new Set<string>(line.unions);
	const dotAt = new Map<string, { x: number; y: number }>();
	for (const m of edges.markers) if (m.union !== undefined) dotAt.set(m.union, { x: m.x, y: m.y });

	const normal: DrawnPath[] = [];
	const onLine: DrawnPath[] = [];
	const pathOn: boolean[] = [];
	const add = (kind: StrokeKind, on: string[], rest: string[]) => {
		for (const d of rest) normal.push({ d, kind, state: off });
		for (const d of on) onLine.push({ d, kind, state: 'on' });
	};
	const whole = (p: EdgePath, on: boolean) => {
		pathOn.push(on);
		add(p.kind, on ? [p.d] : [], on ? [] : [p.d]);
	};
	const drops = edges.paths.filter((p) => p.child !== undefined && !p.d.includes('C'));

	for (const p of edges.paths) {
		if (p.child !== undefined) {
			// A drop to a child, or a side link.
			whole(p, (p.parents ?? []).some((x) => has(x, p.child!)));
		} else if (p.union !== undefined && p.parents === undefined) {
			// A couple's bar (a shared bar names the pair's last-listed union).
			const [a, b] = p.people;
			if (pairOn.has(pairKey(a, b))) {
				whole(p, true);
				continue;
			}
			const subs = straight(p.d);
			const spans: [number, number][] = [];
			if (subs && subs.length === 1) {
				const s = subs[0];
				const axis = axisOf(s);
				const ends = [axis === 'x' ? s.x : s.y, s.to];
				for (const key of g.unionsOf.get(a) ?? []) {
					const fu = g.unionByKey.get(key)!;
					if (!fu.partners.includes(b) || !layout.unions.get(key)?.bar) continue;
					const dot = dotAt.get(key);
					if (!dot) continue;
					for (const x of fu.partners) {
						if (!legOn(key, x)) continue;
						const box = layout.persons.get(x);
						if (!box) continue;
						// The partner's end of the bar is the one nearer its card's middle.
						const mid = axis === 'x' ? box.x + box.w / 2 : box.y + box.h / 2;
						const end = Math.abs(ends[0] - mid) <= Math.abs(ends[1] - mid) ? ends[0] : ends[1];
						spans.push([end, axis === 'x' ? dot.x : dot.y]);
						signOn.add(key);
					}
				}
			}
			if (!spans.length) {
				whole(p, false);
				continue;
			}
			const parts = split(subs![0], spans);
			pathOn.push(true);
			add(p.kind, parts.on, parts.off);
		} else if (p.union !== undefined && p.parents?.length === 1) {
			// A leg from one partner to the union sign (a trunk from a union names both partners).
			const on = legOn(p.union, p.parents[0]);
			if (on) signOn.add(p.union);
			whole(p, on);
		} else if (p.parents !== undefined) {
			// A trunk: from the union sign or the single parent down to the sibling bar.
			const kids = p.people.slice(p.parents.length);
			const onKids = kids.filter((c) => p.parents!.some((x) => has(x, c)));
			const subs = straight(p.d);
			if (!onKids.length || !subs || subs.length < 2) {
				whole(p, onKids.length > 0);
				continue;
			}
			const [stem, bar] = subs;
			const axis = axisOf(bar);
			const same = (q: EdgePath) => (q.parents ?? []).join('\0') === p.parents!.join('\0') && q.union === p.union;
			const at = [axis === 'x' ? stem.x : stem.y];
			for (const c of onKids) {
				const drop = drops.find((q) => q.child === c && same(q));
				const s = drop && straight(drop.d)?.[0];
				if (s) at.push(axis === 'x' ? s.x : s.y);
			}
			const parts = split(bar, [[Math.min(...at), Math.max(...at)]]);
			pathOn.push(true);
			add(p.kind, [subD(stem), ...parts.on], parts.off);
		} else whole(p, false);
	}
	// A trunk or side link on the line starts at its union's sign, so the sign is on as well (a pair's
	// other union may be the only one named in `unions`).
	edges.paths.forEach((p, i) => {
		const trunk = p.child === undefined && (p.parents?.length ?? 0) > 1;
		const side = p.child !== undefined && p.d.includes('C');
		if (pathOn[i] && p.union !== undefined && (trunk || side)) signOn.add(p.union);
	});

	// Each rumoured line with a child has one "?" marker, in path order.
	const rumourOn = edges.paths.flatMap((p, i) => (p.kind === 'rumoured' && p.child !== undefined ? [pathOn[i]] : []));
	let rumour = 0;
	const markers = edges.markers.map((m): LineState => {
		if (m.kind === 'rumour') return rumourOn[rumour++] ? 'on' : off;
		return m.union !== undefined && signOn.has(m.union) ? 'on' : off;
	});

	const tag = (t: FarTag): LineState => {
		const named = line.people.has(t.person) && (g.unionsOf.get(t.person) ?? []).some((k) => line.unions.has(k) && g.unionByKey.get(k)!.partners.some((x) => x !== t.person && t.spouses.includes(x)));
		return named || t.spouses.some((x) => farPairs.has(`${t.person}\0${x}`)) ? 'on' : off;
	};
	return { paths: [...normal, ...onLine], markers, card: (id) => (line.people.has(id) ? undefined : off), tag };
}
