import { describe, expect, it } from 'vitest';
import type { FamilyGraph } from '../src/core/derive';
import { findRelation, lineSubgraph } from '../src/core/relations';
import type { RelationLine } from '../src/core/relations';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { lineLook, type LineLook, type LineMarks } from '../src/render/line-highlight';
import { build, fixture } from './helpers';
import { randomTree } from './random-trees';

// Code review of M7 layout and render (scratch branch scratch/review-m7-render). Each test fails on
// milestone-7 99c53ad and shows one defect of the relation finder's line or the "?" marker.

const GEO = geometryFor(16, 'normal');
const SIDE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', sidewaysCards: 'normal' };

const marks = (line: RelationLine, fade: boolean): LineMarks => ({
	people: new Set(line.people),
	unions: new Set(line.unions),
	links: new Set(line.links.map((l) => `${l.parent}\0${l.child}`)),
	fade,
});

function lay(g: FamilyGraph, settings: LayoutSettings): LaidOut {
	clearLayoutCache();
	return layoutTree(g, GEO, settings, 'test');
}

type P = { x: number; y: number };
type S = { a: P; b: P; curve: boolean; path: number; first: boolean };
const TOL = 1;

function segsOf(d: string, path: number): S[] {
	const out: S[] = [];
	let x = 0;
	let y = 0;
	let first = true;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') {
			[x, y] = n;
			first = true;
			continue;
		}
		const to = cmd === 'H' ? { x: n[0], y } : cmd === 'V' ? { x, y: n[0] } : { x: n[4], y: n[5] };
		out.push({ a: { x, y }, b: to, curve: cmd === 'C', path, first });
		first = false;
		({ x, y } = to);
	}
	return out;
}

function onSeg(p: P, s: S): boolean {
	if (Math.hypot(p.x - s.a.x, p.y - s.a.y) < TOL || Math.hypot(p.x - s.b.x, p.y - s.b.y) < TOL) return true;
	if (s.curve) return false;
	return p.x >= Math.min(s.a.x, s.b.x) - TOL && p.x <= Math.max(s.a.x, s.b.x) + TOL && p.y >= Math.min(s.a.y, s.b.y) - TOL && p.y <= Math.max(s.a.y, s.b.y) + TOL;
}

/**
 * Where the highlighted line of `line` has a gap: a parent link or a union of the line whose two people
 * are not joined by pieces drawn `on`. A link through a far couple (D10) counts as joined when the
 * parent's tag is on and the union sign is joined to the child by on pieces (§13.2: the tags carry it).
 * Also a union sign that is off at the top of an on trunk.
 */
function lineGaps(g: FamilyGraph, laid: LaidOut, line: RelationLine, fade: boolean): { gaps: string[]; look: LineLook } {
	const look = lineLook(g, laid.layout, laid.edges, marks(line, fade));
	const segs = look.paths.flatMap((p, i) => (p.state === 'on' ? segsOf(p.d, i) : []));
	const parent = segs.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	const join = (i: number, j: number) => (parent[find(i)] = find(j));
	for (let i = 0; i < segs.length; i++) {
		for (let j = 0; j < segs.length; j++) if (i !== j && (onSeg(segs[i].a, segs[j]) || onSeg(segs[i].b, segs[j]))) join(i, j);
	}
	const near = (pred: (p: P) => boolean) => new Set(segs.flatMap((s, i) => (pred(s.a) || pred(s.b) ? [find(i)] : [])));
	const card = (id: string) => {
		const b = laid.layout.persons.get(id)!;
		return near((p) => p.x >= b.x - TOL && p.x <= b.x + b.w + TOL && p.y >= b.y - TOL && p.y <= b.y + b.h + TOL);
	};
	const point = (q: P) => new Set(segs.flatMap((s, i) => (onSeg(q, s) ? [find(i)] : [])));
	const meet = (a: Set<number>, b: Set<number>) => [...a].some((c) => b.has(c));
	const markerOf = (u: string) => laid.edges.markers.findIndex((m) => m.union === u);
	const gaps: string[] = [];
	for (const l of line.links) {
		if (meet(card(l.parent), card(l.child))) continue;
		const u = g.primaryUnion.get(l.child);
		const fu = u ? g.unionByKey.get(u) : undefined;
		if (u && fu?.partners.includes(l.parent) && laid.layout.unions.get(u)!.far) {
			const other = fu.partners.find((x) => x !== l.parent)!;
			const tag = laid.layout.farTags.get(l.parent);
			const m = markerOf(u);
			const dot = laid.edges.markers[m];
			if (tag && tag.spouses.includes(other) && look.tag(tag) === 'on' && look.markers[m] === 'on' && meet(point(dot), card(l.child))) continue;
		}
		gaps.push(`link ${l.parent} > ${l.child}`);
	}
	for (const key of line.unions) {
		const fu = g.unionByKey.get(key)!;
		if (laid.layout.unions.get(key)!.far) continue;
		if (!meet(card(fu.partners[0]), card(fu.partners[1]))) gaps.push(`union ${key}`);
	}
	laid.edges.markers.forEach((m, i) => {
		if (m.kind !== 'union') return;
		const trunk = laid.edges.paths.find((p) => p.union === m.union && p.child === undefined && (p.parents?.length ?? 0) > 1);
		if (!trunk) return;
		const stem = trunk.d.includes('M', 1) ? trunk.d.slice(0, trunk.d.indexOf('M', 1)) : trunk.d;
		if (look.paths.some((p) => p.state === 'on' && p.d === stem) && look.markers[i] !== 'on') gaps.push(`sign of ${m.union} is ${look.markers[i]} over an on trunk`);
	});
	return { gaps, look };
}

const lineOf = (g: FamilyGraph, first: string, second: string, index = 0): RelationLine => {
	const r = findRelation(g, first, second);
	if (r.kind === 'named') return r.relations[index].relation.line;
	if (r.kind === 'chain') return r.line;
	throw new Error(`no line for ${first} > ${second}`);
};

describe('review M7: the finder\'s line has no gaps in the whole tree (D47, spec §13.2)', () => {
	it('far couple: Gwen > Hugo (her mother\'s father) in sample tree 12 joins Dana to Gwen', () => {
		// Alan and Dana are a far couple (D10): the u5 sign hangs under Alan, and Dana has no line to it.
		const { g } = build(fixture('12'));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
		expect(laid.layout.unions.get('u5')!.far).toBe(true);
		const line = lineOf(g, 'gwen', 'hugo');
		expect(line.links.map((l) => `${l.parent}>${l.child}`)).toContain('dana>gwen');
		const { gaps, look } = lineGaps(g, laid, line, true);
		// The trunk under Alan's sign to Gwen is on, but the sign, Alan's leg and both tags are faded:
		// the accent line starts in the air under a faded card.
		const trunk = laid.edges.paths.find((p) => p.union === 'u5' && p.child === undefined && p.parents?.length === 2)!;
		expect(look.paths.find((p) => p.d === trunk.d.slice(0, trunk.d.indexOf('M', 1)))?.state).toBe('on');
		expect(look.tag(laid.layout.farTags.get('dana')!)).toBe('on');
		expect(gaps).toEqual([]);
	});

	it('two legs from one side: P1 > P2 in random tree 2 lights the stretch from the end of P1\'s leg to the sign', () => {
		// P0's and P1's legs reach the implicit union of P0 and P1 from the same side; P1's leg stops
		// where it meets P0's leg (edges.ts), so the last part to the sign belongs to P0's leg.
		const { g } = build(randomTree(2));
		const laid = lay(g, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
		const key = g.primaryUnion.get('p2')!;
		const dot = laid.layout.unions.get(key)!;
		const leg = laid.edges.paths.find((p) => p.union === key && p.parents?.length === 1 && p.parents[0] === 'p1')!;
		const end = Number(/H(-?[\d.]+)$/.exec(leg.d)![1]);
		expect(Math.abs(end - dot.x)).toBeGreaterThan(20);
		const line = lineOf(g, 'p1', 'p2');
		expect(line.links.map((l) => `${l.parent}>${l.child}`)).toEqual(['p1>p2']);
		const { gaps, look } = lineGaps(g, laid, line, true);
		// Every point between the leg's end and the sign lies on a piece drawn on.
		const on = look.paths.filter((p) => p.state === 'on').flatMap((p, i) => segsOf(p.d, i));
		const missing = [0.25, 0.5, 0.75].map((f) => ({ x: end + f * (dot.x - end), y: dot.y })).filter((q) => !on.some((s) => onSeg(q, s)));
		expect(missing).toEqual([]);
		expect(gaps).toEqual([]);
	});

	it('a couple with two unions: the sign over an on trunk is on (full siblings of two unions of one pair)', () => {
		// C1 names the betrothal; C2 takes the marriage (the pair's last union). The line of the full
		// siblings names the betrothal only, so the shared bar is fully on, the marriage's trunk is on,
		// and its sign stays faded.
		const { g } = build(`people:
  - {id: x, name: X, sex: m}
  - {id: y, name: Y, sex: f}
  - {id: c1, name: C1, parents: [x, y], union: a}
  - {id: c2, name: C2, parents: [x, y]}
unions:
  - {id: a, partners: [x, y], type: betrothal}
  - {id: b, partners: [x, y]}
`);
		const laid = lay(g, DEFAULT_LAYOUT_SETTINGS);
		const line = lineOf(g, 'c1', 'c2');
		expect(line.unions).toEqual(['u0']);
		const { gaps, look } = lineGaps(g, laid, line, true);
		const i = laid.edges.markers.findIndex((m) => m.union === 'u1');
		expect(look.markers[i]).toBe('on');
		expect(gaps).toEqual([]);
	});

	for (const [name, settings] of [
		['down', DEFAULT_LAYOUT_SETTINGS],
		['sideways', SIDE],
	] as const) {
		it(`sweep, ${name}: every link and union of every line of sample tree 12 and 60 random trees is joined`, () => {
			const found: string[] = [];
			const trees: [string, FamilyGraph][] = [['12', build(fixture('12')).g]];
			for (let seed = 1; seed <= 60; seed++) trees.push([`random ${seed}`, build(randomTree(seed)).g]);
			for (const [label, g] of trees) {
				const laid = lay(g, { ...settings, relationLine: true });
				const ids = g.people.map((p) => p.id);
				for (const a of label === '12' ? ids : ids.slice(0, 4)) {
					for (const b of ids) {
						if (a === b) continue;
						const r = findRelation(g, a, b);
						const lines = r.kind === 'named' ? r.relations.map((x) => x.relation.line) : r.kind === 'chain' ? [r.line] : [];
						for (const line of lines) for (const gap of lineGaps(g, laid, line, true).gaps) found.push(`${label}: ${a} > ${b}: ${gap}`);
					}
				}
			}
			expect(found.slice(0, 8)).toEqual([]);
		});
	}
});

describe('review M7: the "?" of a rumoured parent in the finder\'s small tree (D47, lineSubgraph)', () => {
	it('sideways: the "?" of Leo > Wynn (sample tree 12) does not cover Wynn\'s card', () => {
		const { g } = build(fixture('12'));
		const line = lineOf(g, 'leo', 'wynn');
		expect(line.links.some((l) => l.type === 'rumoured')).toBe(true);
		const small = lineSubgraph(g, line);
		const over: string[] = [];
		for (const font of [12, 16, 20]) {
			for (const settings of [SIDE, { ...SIDE, sidewaysCards: 'narrow' as const }]) {
				clearLayoutCache();
				const laid = layoutTree(small, geometryFor(font, 'normal'), { ...settings, far: NEVER_FAR_RULE }, 'test');
				// buildScene draws the marker as a circle of radius 0.5 em (renderSvg: 8 px).
				const r = 0.5 * font;
				for (const m of laid.edges.markers.filter((x) => x.kind === 'rumour')) {
					for (const b of laid.layout.persons.values()) {
						const d = Math.hypot(Math.max(b.x - m.x, 0, m.x - b.x - b.w), Math.max(b.y - m.y, 0, m.y - b.y - b.h));
						if (d < r) over.push(`${font} px ${settings.sidewaysCards}: "?" at ${m.x.toFixed(1)},${m.y.toFixed(1)} covers ${b.id} by ${(r - d).toFixed(1)} px`);
					}
				}
			}
		}
		expect(over).toEqual([]);
	});
});
