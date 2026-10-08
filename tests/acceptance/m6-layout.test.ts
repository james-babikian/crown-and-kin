import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import type { Tree } from '../../src/core/types';
import { drawnGeometry, geometryFor, tagTop } from '../../src/layout/geometry';
import { clearLayoutCache, layoutKey, layoutTree } from '../../src/layout/index';
import type { EdgeDrawing, Geometry, LaidOut, LayoutSettings, TreeLayout } from '../../src/layout/model';
import { lineProblems, randomTree } from '../random-trees';
import { recordLayout } from './layout-record';
import { allFixtures } from './load';
import { DESCENT_KINDS, pathPoints } from './paths';
import { FONT_FAMILY, SETTINGS } from './pipeline';
import {
	barProblems,
	boundsProblems,
	columnProblems,
	farRuleProblems,
	firstViewTagProblems,
	lineProblems as sideLineProblems,
	overlap,
	overlapProblems,
	rowGapProblems,
	siblingOrderProblems,
	tagProblems,
	visibleTags,
} from './sideways-checks';
import { specModel } from './spec-model';

// Milestone 6 layout contract (src/layout/model.ts):
// - D26 (spec §0, §5.3): `EdgeMarker.unionType` — for a `union` marker, the partnership type as
//   written (§4.1: `type`, default `marriage`; an unknown value is kept as written). Implicit
//   union markers and rumour markers have none. In every layout (down, sideways).
// - D29 (spec §0, §5.2, D24), D37: `LayoutSettings.tallCards` — in every layout (down, sideways),
//   exactly the listed people's cards are one name text line taller;
//   every other card keeps its size. It is part of the cache key (sorted).
//
// The expected union types are read from the block text with the `yaml` package, not from the
// plugin's parser, so this test does not trust the implementation's own reading.

const GEO = geometryFor(16);
const DOWN: LayoutSettings = SETTINGS;
const SIDE: LayoutSettings = { ...SETTINGS, orientation: 'sideways' };
const E = 0.5;

/** Time limit for tests that lay out sample tree 7 several times. */
const HEAVY_MS = 60_000;

interface Laid extends LaidOut {
	tree: Tree;
	g: FamilyGraph;
}

function parse(source: string): Tree {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`Unexpected hard error ${r.error.code}: ${r.error.detail ?? ''}`);
	return r.tree;
}

function lay(source: string, settings: LayoutSettings, geo: Geometry = GEO): Laid {
	const tree = parse(source);
	const g = deriveFamilies(tree);
	const { layout, edges } = layoutTree(g, geo, settings, FONT_FAMILY);
	return { tree, g, layout, edges };
}

const first = (list: string[]) => list.slice(0, 5);

// ---------- D26: unionType ----------

const NOTHING = ['', '~', 'null', 'Null', 'NULL'];

/** `unions[i].type` as written in the block (failsafe: every scalar is its text); absent → marriage (§4.1). */
function writtenTypes(source: string): (string | undefined)[] {
	const data = parseYaml(source, { schema: 'failsafe' }) as { unions?: unknown } | null;
	const unions = Array.isArray(data?.unions) ? (data.unions as unknown[]) : [];
	return unions.map((u) => {
		if (u === null || typeof u !== 'object' || Array.isArray(u)) return undefined;
		const t = (u as Record<string, unknown>).type;
		return typeof t === 'string' && !NOTHING.includes(t) ? t : 'marriage';
	});
}

const at = (x: number, y: number) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
	m.set(k, [...(m.get(k) ?? []), v]);
}

/**
 * Every `union` marker carries the written type of the listed union whose point it sits on;
 * `implicit-union` and `rumour` markers carry none. Returns the problems and the drawn types.
 */
function unionTypeProblems(source: string, l: { g: FamilyGraph; layout: TreeLayout; edges: EdgeDrawing }): { bad: string[]; drawn: string[] } {
	const types = writtenTypes(source);
	const bad: string[] = [];
	const want = new Map<string, string[]>();
	for (const fu of l.g.unions) {
		if (fu.implicit || fu.unionIndex === undefined) continue;
		const u = l.layout.unions.get(fu.key);
		const t = types[fu.unionIndex];
		if (u && t !== undefined) push(want, at(u.x, u.y), t);
	}
	const got = new Map<string, string[]>();
	const drawn: string[] = [];
	for (const m of l.edges.markers) {
		if (m.kind !== 'union') {
			if (m.unionType !== undefined) bad.push(`${m.kind} marker at ${at(m.x, m.y)} has unionType ${m.unionType}`);
			continue;
		}
		if (typeof m.unionType !== 'string') {
			bad.push(`union marker at ${at(m.x, m.y)} has no unionType`);
			continue;
		}
		push(got, at(m.x, m.y), m.unionType);
		drawn.push(m.unionType);
	}
	for (const [p, list] of got) {
		const rest = [...(want.get(p) ?? [])];
		for (const t of list) {
			const i = rest.indexOf(t);
			if (i < 0) bad.push(`union marker at ${p} says ${t}; the listed unions there are [${(want.get(p) ?? []).join(', ')}]`);
			else rest.splice(i, 1);
		}
	}
	return { bad, drawn };
}

const LAYOUTS: [string, LayoutSettings][] = [
	['down', DOWN],
	['sideways', SIDE],
];

describe('D26: a union marker carries the written partnership type (contract EdgeMarker.unionType)', () => {
	for (const f of allFixtures()) {
		for (const [name, settings] of LAYOUTS) {
			it(`sample tree ${f.id}, ${name}`, { timeout: HEAVY_MS }, () => {
				const l = lay(f.source, settings);
				const { bad, drawn } = unionTypeProblems(f.source, l);
				expect(first(bad)).toEqual([]);
				// Not every listed union draws a dot (a far couple with no children has none), so only
				// check that the drawn ones were seen.
				const listed = l.g.unions.filter((u) => !u.implicit).length;
				expect(drawn.length > 0 && drawn.length <= listed).toBe(true);
			});
		}
	}

	it('sample tree 7 shows all four known types; sample tree 5 keeps its unknown "handfasting"', { timeout: HEAVY_MS }, () => {
		const seven = allFixtures().find((f) => f.id === '07')!;
		expect(new Set(unionTypeProblems(seven.source, lay(seven.source, DOWN)).drawn)).toEqual(new Set(['marriage', 'betrothal', 'concubinage', 'affair']));
		const five = allFixtures().find((f) => f.id === '05')!;
		expect(unionTypeProblems(five.source, lay(five.source, DOWN)).drawn).toContain('handfasting');
	});

	const COUPLES = [
		'people:',
		'  - {id: a1, name: A1, sex: m}',
		'  - {id: a2, name: A2, sex: f}',
		'  - {id: b1, name: B1, sex: m}',
		'  - {id: b2, name: B2, sex: f}',
		'  - {id: c1, name: C1, sex: m}',
		'  - {id: c2, name: C2, sex: f}',
		'  - {id: d1, name: D1, sex: m}',
		'  - {id: d2, name: D2, sex: f}',
		'  - {id: e1, name: E1, sex: m}',
		'  - {id: e2, name: E2, sex: f}',
		'  - {id: f1, name: F1, sex: m}',
		'  - {id: f2, name: F2, sex: f}',
		'  - {id: g1, name: G1, sex: m}',
		'  - {id: g2, name: G2, sex: f}',
		'  - {id: r, name: R, sex: m}',
		'  - {id: k1, name: K1, parents: [a1, a2]}',
		'  - {id: k2, name: K2, parents: [g1, g2, {id: r, type: rumoured}]}',
		'unions:',
		'  - {partners: [a1, a2]}',
		'  - {partners: [b1, b2], type: marriage}',
		'  - {partners: [c1, c2], type: betrothal}',
		'  - {partners: [d1, d2], type: concubinage}',
		'  - {partners: [e1, e2], type: affair}',
		'  - {partners: [f1, f2], type: handfasting}',
	].join('\n');

	for (const [name, settings] of LAYOUTS) {
		it(`each type on its own couple: absent → marriage, unknown kept; implicit and rumour markers have none (${name})`, () => {
			const l = lay(COUPLES, settings);
			const byPartner = (id: string) => {
				const fu = l.g.unions.find((u) => u.partners.includes(id))!;
				const u = l.layout.unions.get(fu.key)!;
				return l.edges.markers.filter((m) => Math.abs(m.x - u.x) <= E && Math.abs(m.y - u.y) <= E);
			};
			expect(byPartner('a1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'marriage']]);
			expect(byPartner('b1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'marriage']]);
			expect(byPartner('c1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'betrothal']]);
			expect(byPartner('d1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'concubinage']]);
			expect(byPartner('e1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'affair']]);
			expect(byPartner('f1').map((m) => [m.kind, m.unionType])).toEqual([['union', 'handfasting']]);
			// g1 and g2 have a child and no listed union: an implicit union.
			expect(byPartner('g1').map((m) => [m.kind, m.unionType])).toEqual([['implicit-union', undefined]]);
			const rumours = l.edges.markers.filter((m) => m.kind === 'rumour');
			expect(rumours.length).toBe(1);
			expect(rumours[0].unionType).toBeUndefined();
			expect(unionTypeProblems(COUPLES, l).bad).toEqual([]);
		});
	}

	it('two unions of one couple: each marker has its own union\'s type', () => {
		const src = [
			'people:',
			'  - {id: a, name: A, sex: m}',
			'  - {id: b, name: B, sex: f}',
			'  - {id: k1, name: K1, parents: [a, b], union: first}',
			'  - {id: k2, name: K2, parents: [a, b]}',
			'unions:',
			'  - {id: first, partners: [a, b], type: betrothal}',
			'  - {partners: [a, b], type: concubinage}',
		].join('\n');
		for (const [name, settings] of LAYOUTS) {
			const l = lay(src, settings);
			const { bad, drawn } = unionTypeProblems(src, l);
			expect(bad, name).toEqual([]);
			expect([...drawn].sort(), name).toEqual(['betrothal', 'concubinage']);
		}
	});
});

// ---------- D29: tallCards ----------

/**
 * One name text line: the card text line height times the name size (1 em), from the card
 * geometry of spec §5.8 (`src/layout/geometry.ts`: 1.2). The
 * layout may round it to whole px.
 */
// D117: the name text line is 0.85 em of the note font, like every other line of the card (0.2.3: 1 em).
const nameLine = (geo: Geometry) => 1.2 * 0.85 * geo.fontPx;

/** Where each person's own drop line ends, if it has one: the child first, then its placement parents. */
function dropEnds(l: Laid): Map<string, { x: number; y: number }[]> {
	const out = new Map<string, { x: number; y: number }[]>();
	const key = (ids: string[]) => [...ids].sort().join('|');
	for (const p of l.edges.paths) {
		if (!DESCENT_KINDS.includes(p.kind) || p.people.length < 2) continue;
		const [child, ...rest] = p.people;
		if (key(rest) !== key(l.g.placementParents.get(child) ?? [])) continue;
		const pts = pathPoints(p.d);
		push(out, child, pts[pts.length - 1]);
	}
	return out;
}

/** Every drop ends on its child's left edge, within the card's height (sideways: lines come from the left). */
function dropProblems(l: Laid): string[] {
	const bad: string[] = [];
	for (const [child, ends] of dropEnds(l)) {
		const b = l.layout.persons.get(child)!;
		for (const q of ends) {
			if (Math.abs(q.x - b.x) > E || q.y < b.y - E || q.y > b.y + b.h + E) bad.push(`drop to ${child} ends at ${q.x},${q.y}, not on its left edge x ${b.x}, y ${b.y}–${b.y + b.h}`);
		}
	}
	return bad;
}

function structure(l: Laid, geo: Geometry) {
	return {
		columns: first(columnProblems(l.g, l.layout)),
		overlaps: first(overlapProblems(l.layout)),
		siblingOrder: first(siblingOrderProblems(l.tree, l.layout)),
		bars: first(barProblems(l.g, l.layout)),
		rowGaps: first(rowGapProblems(l.layout)),
		farRule: first(farRuleProblems(l.g, l.layout, geo, SETTINGS.far)),
		tags: first(tagProblems(l.g, l.layout)),
		firstViewTags: first(firstViewTagProblems(l.layout, l.edges)),
		bounds: first(boundsProblems(l.g, l.layout, l.edges)),
		lines: first(sideLineProblems(l.g, l.layout, l.edges, visibleTags(l.g, l.layout, l.edges))),
		drops: first(dropProblems(l)),
	};
}
const NONE = { columns: [], overlaps: [], siblingOrder: [], bars: [], rowGaps: [], farRule: [], tags: [], firstViewTags: [], bounds: [], lines: [], drops: [] };

/** Exactly the tall people are one name text line taller; widths and every other card unchanged. */
function sizeProblems(tall: Laid, base: Laid, ids: ReadonlySet<string>): string[] {
	const bad: string[] = [];
	const lg = tall.layout.geometry;
	const extra = nameLine(lg);
	for (const [id, b] of tall.layout.persons) {
		const was = base.layout.persons.get(id)!;
		if (Math.abs(b.w - was.w) > E) bad.push(`${id}: width ${b.w}, was ${was.w}`);
		const want = ids.has(id) ? was.h + extra : was.h;
		if (Math.abs(b.h - want) > E) bad.push(`${id}: height ${b.h}, want ${ids.has(id) ? `${was.h} + one name text line (${extra})` : was.h}`);
	}
	return bad;
}

/** Tall sets for a sample: one person with a family, every other person, everyone. */
function tallSets(tree: Tree): [string, string[]][] {
	const ids = tree.people.map((p) => p.id);
	const withKids = tree.people.find((p) => tree.people.some((c) => c.parents.some((r) => r.id === p.id)))?.id ?? ids[0];
	return [
		['one parent', withKids ? [withKids] : []],
		['every other person', ids.filter((_, i) => i % 2 === 0)],
		['everyone', ids],
	];
}

describe('D29: tallCards makes exactly those sideways cards one name text line taller', () => {
	for (const f of allFixtures()) {
		it(`sample tree ${f.id}`, { timeout: HEAVY_MS }, () => {
			const base = lay(f.source, SIDE);
			expect(structure(base, GEO), 'without tall cards').toEqual(NONE);
			for (const [label, ids] of tallSets(base.tree)) {
				const l = lay(f.source, { ...SIDE, tallCards: ids });
				expect(l.layout.orientation, label).toBe('sideways');
				expect(l.layout.geometry, label).toEqual(base.layout.geometry);
				expect(first(sizeProblems(l, base, new Set(ids))), label).toEqual([]);
				// Sibling order (D2) and the columns do not change: only positions along the column move.
				expect(l.layout.rows, label).toEqual(base.layout.rows);
				expect(structure(l, GEO), label).toEqual(NONE);
				expect(first(unionTypeProblems(f.source, l).bad), label).toEqual([]);
			}
		});
	}

	it('the drawn size: a tall card is 16 px taller at 16 px (1.2 × 0.85 × 16 = 16.3, whole px allowed)', () => {
		const src = allFixtures().find((f) => f.id === '01')!.source;
		const id = parse(src).people[0].id;
		const base = lay(src, SIDE);
		const l = lay(src, { ...SIDE, tallCards: [id] });
		const extra = l.layout.persons.get(id)!.h - base.layout.persons.get(id)!.h;
		expect(extra).toBeGreaterThanOrEqual(15.8);
		expect(extra).toBeLessThanOrEqual(16.8);
	});

	for (const geo of [geometryFor(12), geometryFor(20)] as Geometry[]) {
		for (const id of ['03', '06']) {
			const at = `${id} at ${geo.fontPx} px`;
			it(`other fonts: sample tree ${at}`, () => {
				const src = allFixtures().find((f) => f.id === id)!.source;
				const settings: LayoutSettings = SIDE;
				const base = lay(src, settings, geo);
				expect(structure(base, geo), 'without tall cards').toEqual(NONE);
				const ids = base.tree.people.filter((_, i) => i % 3 === 0).map((p) => p.id);
				const l = lay(src, { ...settings, tallCards: ids }, geo);
				expect(first(sizeProblems(l, base, new Set(ids)))).toEqual([]);
				expect(l.layout.rows).toEqual(base.layout.rows);
				expect(structure(l, geo)).toEqual(NONE);
			});
		}
	}

	it('a tall partner stacked above the other, and a tall far-tagged card', () => {
		// x and z are stacked partners (a bar); x and y are far (tags), so tags hang from tall cards.
		const people = [
			'  - {id: r1, name: R1, sex: m}',
			'  - {id: r2, name: R2, sex: f}',
			'  - {id: s1, name: S1, sex: m}',
			'  - {id: s2, name: S2, sex: f}',
			'  - {id: x, name: X, sex: m, parents: [r1, r2]}',
			...Array.from({ length: 7 }, (_, i) => `  - {id: x${i + 2}, name: X${i + 2}, parents: [r1, r2]}`),
			'  - {id: z, name: Z, sex: f}',
			'  - {id: y, name: Y, sex: f, parents: [s1, s2]}',
			...Array.from({ length: 7 }, (_, i) => `  - {id: y${i + 2}, name: Y${i + 2}, parents: [s1, s2]}`),
			'  - {id: k, name: K, parents: [x, z]}',
		];
		const src = ['people:', ...people, 'unions:', '  - {partners: [r1, r2]}', '  - {partners: [s1, s2]}', '  - {partners: [x, z]}', '  - {partners: [x, y]}'].join('\n');
		const base = lay(src, SIDE);
		expect(base.layout.farTags.get('x')?.spouses).toEqual(['y']);
		const xz = base.g.unions.find((u) => u.partners.includes('x') && u.partners.includes('z'))!;
		expect(base.layout.unions.get(xz.key)?.bar).toBe(true);
		for (const ids of [['x'], ['z'], ['x', 'z', 'y'], ['k', 'r1']]) {
			const l = lay(src, { ...SIDE, tallCards: ids });
			expect(first(sizeProblems(l, base, new Set(ids))), ids.join()).toEqual([]);
			expect(structure(l, GEO), ids.join()).toEqual(NONE);
		}
	});

	it('an id that names nobody changes nothing; an empty list is the same as none', () => {
		const src = allFixtures().find((f) => f.id === '06')!.source;
		const base = lay(src, SIDE);
		for (const tallCards of [[], ['nobody'], ['nobody', 'else']]) {
			clearLayoutCache();
			const l = lay(src, { ...SIDE, tallCards });
			expect(recordLayout(l), JSON.stringify(tallCards)).toBe(recordLayout(base));
		}
	});
});

// ---------- D37: tall cards in every layout ----------

/** D2 in `down`: siblings from left to right in `people` order. */
function siblingOrderDown(l: Laid): string[] {
	const bad: string[] = [];
	for (const [family, kids] of specModel(l.tree).families) {
		for (let i = 1; i < kids.length; i++) {
			const a = l.layout.persons.get(kids[i - 1]);
			const b = l.layout.persons.get(kids[i]);
			if (a && b && !(b.x > a.x)) bad.push(`${family}: ${kids[i - 1]} is not left of ${kids[i]}`);
		}
	}
	return bad;
}

/**
 * `down` with tall cards (D37): only heights change. Every card keeps its x, width, row and place in
 * the row; the cards of a row share their top edge; each gap between rows starts under the row's
 * tallest card and keeps its height; bars meet both partners; drops end on the child's top edge; a
 * tag hangs from its own card's bottom edge and covers no other card; no straight line runs behind a
 * card or through a tag, and no dot lies on a foreign line.
 */
function downProblems(l: Laid, base: Laid): string[] {
	const bad: string[] = [];
	const { layout } = l;
	if (JSON.stringify(layout.rows) !== JSON.stringify(base.layout.rows)) bad.push('rows changed');
	for (const [id, b] of layout.persons) {
		const was = base.layout.persons.get(id)!;
		if (Math.abs(b.x - was.x) > E) bad.push(`${id}: x ${b.x}, was ${was.x}`);
	}
	for (const [key, u] of layout.unions) {
		const was = base.layout.unions.get(key)!;
		if (Math.abs(u.x - was.x) > E || u.bar !== was.bar || u.far !== was.far) bad.push(`union ${key} moved sideways or changed kind`);
	}
	layout.rows.forEach((row, r) => {
		const tops = new Set(row.map((id) => layout.persons.get(id)!.y));
		if (tops.size !== 1) bad.push(`row ${r}: cards do not share their top edge`);
		const bottom = Math.max(...row.map((id) => layout.persons.get(id)!.y + layout.persons.get(id)!.h));
		const gap = layout.rowGaps[r];
		if (!gap) return;
		const was = base.layout.rowGaps[r];
		if (Math.abs(gap.top - bottom) > E) bad.push(`gap ${r} starts at ${gap.top}, the row's tallest card ends at ${bottom}`);
		if (Math.abs(gap.bottom - gap.top - (was.bottom - was.top)) > E) bad.push(`gap ${r} is ${gap.bottom - gap.top} high, was ${was.bottom - was.top}`);
	});
	for (const fu of l.g.unions) {
		const u = layout.unions.get(fu.key)!;
		if (!u.bar) continue;
		const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
		for (const c of [a, b]) if (!(u.y > c.y + E && u.y < c.y + c.h - E)) bad.push(`bar of ${fu.partners} at y ${u.y} misses ${c.id} (${c.y}–${c.y + c.h})`);
	}
	for (const [child, ends] of dropEnds(l)) {
		const b = layout.persons.get(child)!;
		for (const q of ends) if (Math.abs(q.y - b.y) > E || q.x < b.x - E || q.x > b.x + b.w + E) bad.push(`drop to ${child} ends at ${q.x},${q.y}, not on its top edge`);
	}
	for (const tag of layout.farTags.values()) {
		const own = layout.persons.get(tag.person)!;
		if (Math.abs(tag.y - (own.y + own.h)) > E) bad.push(`${tag.person}'s tag is not at its card's bottom edge`);
		const pill = { x: tag.hit.x, y: tagTop(layout.geometry, tag.y), w: tag.hit.w, h: layout.geometry.tagH };
		for (const b of layout.persons.values()) if (b.id !== tag.person && overlap(pill, b)) bad.push(`${tag.person}'s tag covers ${b.id}`);
	}
	const bottoms = [...layout.persons.values()].map((b) => b.y + b.h);
	if (layout.height < Math.max(...bottoms) - E) bad.push('a card reaches below the drawing');
	bad.push(...overlapProblems(layout), ...lineProblems(l.g, layout, l.edges));
	return bad;
}

describe('D37: tallCards makes exactly those cards one name text line taller in down (computer)', () => {
	for (const f of allFixtures()) {
		it(`sample tree ${f.id}`, { timeout: HEAVY_MS }, () => {
			const base = lay(f.source, DOWN);
			for (const [label, ids] of tallSets(base.tree)) {
				const l = lay(f.source, { ...DOWN, tallCards: ids });
				expect(l.layout.orientation, label).toBe('down');
				expect(l.layout.geometry, label).toEqual(base.layout.geometry);
				expect(first(sizeProblems(l, base, new Set(ids))), label).toEqual([]);
				expect(first(downProblems(l, base)), label).toEqual([]);
				expect(first(siblingOrderDown(l)), label).toEqual([]);
				expect(first(unionTypeProblems(f.source, l).bad), label).toEqual([]);
			}
		});
	}

	for (const geo of [geometryFor(12), geometryFor(20)]) {
		it(`other fonts: sample trees 03 and 07 at ${geo.fontPx} px`, { timeout: HEAVY_MS }, () => {
			for (const id of ['03', '07']) {
				const src = allFixtures().find((f) => f.id === id)!.source;
				const base = lay(src, DOWN, geo);
				const ids = base.tree.people.filter((_, i) => i % 3 === 0).map((p) => p.id);
				const l = lay(src, { ...DOWN, tallCards: ids }, geo);
				expect(first(sizeProblems(l, base, new Set(ids))), id).toEqual([]);
				expect(first(downProblems(l, base)), id).toEqual([]);
			}
		});
	}

	it('random trees, every third person tall: the same rules', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 60; seed++) {
			const src = randomTree(seed);
			const base = lay(src, DOWN);
			const ids = base.g.people.filter((_, i) => i % 3 === 0).map((p) => p.id);
			const l = lay(src, { ...DOWN, tallCards: ids });
			bad.push(...[...sizeProblems(l, base, new Set(ids)), ...downProblems(l, base)].map((p) => `${seed}: ${p}`));
		}
		expect(first(bad)).toEqual([]);
	});

	it('a tall partner beside a short one: the bar sits halfway down the short card, and the gap starts under the tall one', () => {
		const src = ['people:', '  - {id: a, name: A, sex: m}', '  - {id: b, name: B, sex: f}', '  - {id: k, name: K, parents: [a, b]}', 'unions:', '  - {partners: [a, b]}'].join('\n');
		const base = lay(src, DOWN);
		const l = lay(src, { ...DOWN, tallCards: ['a'] });
		const [a, b, k] = ['a', 'b', 'k'].map((id) => l.layout.persons.get(id)!);
		expect(a.h).toBe(GEO.cardH + Math.round(nameLine(GEO)));
		expect(b.h).toBe(GEO.cardH);
		const u = [...l.layout.unions.values()][0];
		expect(u.y).toBe(b.y + b.h / 2);
		expect(l.layout.rowGaps[0].top).toBe(a.y + a.h);
		expect(k.y - base.layout.persons.get('k')!.y).toBe(a.h - b.h);
	});
});

describe('D37: tallCards makes exactly those sideways normal cards one name text line taller (full-screen view on the phone)', () => {
	for (const f of allFixtures()) {
		it(`sample tree ${f.id}`, { timeout: HEAVY_MS }, () => {
			const base = lay(f.source, SIDE);
			expect(structure(base, GEO), 'without tall cards').toEqual(NONE);
			for (const [label, ids] of tallSets(base.tree)) {
				const l = lay(f.source, { ...SIDE, tallCards: ids });
				expect(l.layout.orientation, label).toBe('sideways');
				expect(l.layout.geometry, label).toEqual(base.layout.geometry);
				expect(first(sizeProblems(l, base, new Set(ids))), label).toEqual([]);
				expect(l.layout.rows, label).toEqual(base.layout.rows);
				expect(structure(l, GEO), label).toEqual(NONE);
			}
		});
	}
});

describe('D37: drawnGeometry is the geometry the layout draws with', () => {
	for (const [name, settings] of LAYOUTS) {
		it(name, () => {
			const src = allFixtures().find((f) => f.id === '01')!.source;
			expect(drawnGeometry(GEO, settings)).toEqual(lay(src, settings).layout.geometry);
		});
	}
});

describe('D29: tallCards is part of the layout cache key, sorted (contract LayoutSettings)', () => {
	const src = allFixtures().find((f) => f.id === '06')!.source;
	const g = deriveFamilies(parse(src));
	const [a, b, c] = g.people.map((p) => p.id);

	for (const [name, settings] of LAYOUTS) {
		it(`${name}: a different set gives a different key; the order of the list does not matter; nobody = none`, () => {
			const none = layoutKey(g, GEO, settings, FONT_FAMILY);
			const ab = layoutKey(g, GEO, { ...settings, tallCards: [a, b] }, FONT_FAMILY);
			const ba = layoutKey(g, GEO, { ...settings, tallCards: [b, a] }, FONT_FAMILY);
			const ac = layoutKey(g, GEO, { ...settings, tallCards: [a, c] }, FONT_FAMILY);
			expect(ab).not.toBe(none);
			expect(ab).toBe(ba);
			expect(ac).not.toBe(ab);
			expect(layoutKey(g, GEO, { ...settings, tallCards: [] }, FONT_FAMILY)).toBe(none);
			expect(layoutKey(g, GEO, { ...settings, tallCards: ['nobody'] }, FONT_FAMILY)).toBe(none);
		});
	}

	it('a repeat call with an equal list returns the cached layout; another list does not', () => {
		clearLayoutCache();
		const one = layoutTree(g, GEO, { ...SIDE, tallCards: [a, b] }, FONT_FAMILY);
		expect(layoutTree(g, GEO, { ...SIDE, tallCards: [b, a] }, FONT_FAMILY)).toBe(one);
		const other = layoutTree(g, GEO, { ...SIDE, tallCards: [a, c] }, FONT_FAMILY);
		expect(other).not.toBe(one);
		expect(other.layout.persons.get(c)!.h).toBeGreaterThan(one.layout.persons.get(c)!.h);
	});
});
