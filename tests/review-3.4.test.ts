import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { routeEdges } from '../src/layout/edges';
import { NORMAL_GEOMETRY, tagTop } from '../src/layout/geometry';
import { DEFAULT_FAR_RULE, layoutFamilies } from '../src/layout/layout';
import type { EdgeDrawing, FarCoupleRule, Rect, TreeLayout } from '../src/layout/model';
import { build } from './helpers';

// Review 3.4 scratch: line invariants on random and single-parent-heavy trees.

const COUPLE = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);

function lay(src: string, far: FarCoupleRule = DEFAULT_FAR_RULE) {
	const { g, gen, order } = build(src);
	const layout = layoutFamilies(g, gen, order, NORMAL_GEOMETRY, { sweeps: 4, far });
	return { g, layout, edges: routeEdges(g, layout, order.anchors) };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Straight segments of a path; a curve is sampled into short segments. */
function segments(d: string): Seg[] {
	const out: Seg[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(/[\s,]+/).map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H') {
			out.push({ x1: x, y1: y, x2: n[0], y2: y });
			x = n[0];
		} else if (cmd === 'V') {
			out.push({ x1: x, y1: y, x2: x, y2: n[0] });
			y = n[0];
		} else {
			const [c1x, c1y, c2x, c2y, ex, ey] = n;
			let px = x;
			let py = y;
			for (let i = 1; i <= 24; i++) {
				const t = i / 24;
				const s = 1 - t;
				const qx = s * s * s * x + 3 * s * s * t * c1x + 3 * s * t * t * c2x + t * t * t * ex;
				const qy = s * s * s * y + 3 * s * s * t * c1y + 3 * s * t * t * c2y + t * t * t * ey;
				out.push({ x1: px, y1: py, x2: qx, y2: qy });
				px = qx;
				py = qy;
			}
			[x, y] = [ex, ey];
		}
	}
	return out;
}

function crossesInterior(s: Seg, b: Rect): boolean {
	const e = 0.5;
	return Math.max(s.x1, s.x2) > b.x + e && Math.min(s.x1, s.x2) < b.x + b.w - e && Math.max(s.y1, s.y2) > b.y + e && Math.min(s.y1, s.y2) < b.y + b.h - e;
}

/** Lines that pass through a far-couple tag, other than the lines of that person's far couples. */
function linesThroughTags(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing): string[] {
	const bad: string[] = [];
	const geo = layout.geometry;
	for (const tag of layout.farTags.values()) {
		const pill = { x: tag.hit.x, y: tagTop(geo, tag.y), w: tag.hit.w, h: geo.tagH };
		for (const p of edges.paths) {
			const own = COUPLE.has(p.kind) && p.people.includes(tag.person) && tag.spouses.some((s) => p.people.includes(s));
			if (own) continue;
			if (segments(p.d).some((s) => crossesInterior(s, pill))) bad.push(`${p.kind} [${p.people.join(',')}] runs through ${tag.person}'s tag`);
		}
	}
	return bad;
}
import { randomTree } from './random-trees';

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function advTree(seed: number): string {
	const rand = rng(seed * 7 + 3);
	const n = 5 + Math.floor(rand() * 20);
	const people: string[] = []; const unions: string[] = [];
	for (let i = 0; i < n; i++) {
		const sex = rand() < 0.5 ? 'm' : 'f';
		let parents = '';
		if (i > 1 && rand() < 0.8) {
			const a = `p${Math.floor(rand() * i)}`;
			if (rand() < 0.5) parents = `, parents: [${a}]`;
			else { const b = `p${Math.floor(rand() * i)}`; parents = b === a ? `, parents: [${a}]` : `, parents: [${a}, ${b}]`; }
			if (rand() < 0.15) parents = parents.replace(/\[(p\d+)/, `[{id: $1, type: ${rand() < 0.5 ? 'adoptive' : 'ward'}}`);
		}
		people.push(`  - {id: p${i}, name: P${i}, sex: ${sex}${parents}${rand() < 0.3 ? ', illegitimate: true' : ''}}`);
		const k = rand() < 0.4 ? 1 + Math.floor(rand() * 2) : 0;
		for (let j = 0; j < k && i > 0; j++) unions.push(`  - {partners: [p${i}, p${Math.floor(rand() * i)}]}`);
	}
	return `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

const N = Number(process.env.RANDOM_TREES ?? 400);
const GENS: [string, (s: number) => string][] = [['random', randomTree], ['single-parent heavy', advTree]];
import { illegitimateSigns } from '../src/layout/illegitimate-sign';

describe('review 3.4', () => {
	it('F1: a side link to a child in the same row does not run back up through its own parent\'s far tag', () => {
		// P has a far wife W (three generations down) and is guardian of his sibling C, who sits in his row.
		const src = `
people:
  - {id: k, name: K}
  - {id: p, name: P, parents: [k]}
  - {id: c, name: C, parents: [k, {id: p, type: ward}]}
  - {id: y, name: Y, parents: [c]}
  - {id: z, name: Z, parents: [y]}
  - {id: w, name: W, parents: [z]}
unions:
  - partners: [p, w]
`;
		const { layout, edges, g } = lay(src);
		expect(layout.farTags.has('p')).toBe(true);
		expect(layout.persons.get('c')!.gen).toBe(layout.persons.get('p')!.gen);
		expect(linesThroughTags(g, layout, edges)).toEqual([]);
	});
});

describe('review 3.4 scratch: D14 oracle', () => {
	it('sign exactly when no dashed line ends on the card top', () => {
		const bad: string[] = [];
		for (const [name, gen] of GENS) {
			for (let seed = 1; seed <= N; seed++) {
				const { g, layout, edges } = lay(gen(seed));
				const signed = illegitimateSigns(g, edges);
				for (const p of g.people) {
					if (!p.illegitimate) continue;
					const b = layout.persons.get(p.id)!;
					const dashedIn = edges.paths.some((e) => e.kind === 'illegitimate' && segments(e.d).some((s) => s.x1 === s.x2 && s.x1 > b.x && s.x1 < b.x + b.w && Math.abs(Math.max(s.y1, s.y2) - b.y) < 0.5));
					if (dashedIn === signed.has(p.id)) bad.push(`${name} ${seed} ${p.id} dashed=${dashedIn} signed=${signed.has(p.id)}`);
				}
			}
		}
		expect(bad.slice(0, 10)).toEqual([]);
	});
});
