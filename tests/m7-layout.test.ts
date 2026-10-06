import { describe, expect, it } from 'vitest';
import type { FamilyGraph, FamilyUnion } from '../src/core/derive';
import { cardText, drawnGeometry, geometryFor, relationExtra, relationY, tallExtra, withRelationLine } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import type { EdgeDrawing, EdgePath, LayoutSettings } from '../src/layout/model';
import { build, fixture } from './helpers';

// WP7.2 (spec §13.1 D40, §13.2 D47): the relation text line in every layout and card size, the M7 fields
// on lines and markers, the finder's small-tree patches (rumoured placement, childless implicit union).

const ALL = ['01', '02', '03', '04', '05', '06', '07', '08', '10', '11'];
const SIDE: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' };

describe('D40: the relation text line makes every card one small text line taller', () => {
	it('relationExtra is one 0.85 em text line at the card line height, whole px', () => {
		expect(relationExtra(geometryFor(16, 'normal'))).toBe(Math.round(1.2 * 0.85 * 16));
		expect(relationExtra(geometryFor(16, 'compact'))).toBe(Math.round(1.1 * 0.85 * 16));
		expect(relationExtra(geometryFor(20, 'normal'))).toBe(Math.round(1.2 * 0.85 * 20));
	});

	it('withRelationLine and drawnGeometry add it once, in every orientation', () => {
		const geo = geometryFor(16, 'normal');
		const on = withRelationLine(geo, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
		expect(on.cardH).toBe(geo.cardH + relationExtra(geo));
		expect(on.relationLine).toBe(true);
		expect(withRelationLine(on, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true })).toBe(on);
		expect(withRelationLine(geo, DEFAULT_LAYOUT_SETTINGS)).toBe(geo);
		for (const s of [DEFAULT_LAYOUT_SETTINGS, SIDE]) {
			const d = drawnGeometry(geo, { ...s, relationLine: true });
			expect(d.cardH).toBe(geo.cardH + relationExtra(geo));
			expect(d.relationLine).toBe(true);
			expect(drawnGeometry(d, { ...s, relationLine: true }).cardH).toBe(d.cardH);
			expect(drawnGeometry(geo, s).cardH).toBe(geo.cardH);
		}
	});

	for (const [name, settings] of [
		['down', DEFAULT_LAYOUT_SETTINGS],
		['sideways', SIDE],
	] as const) {
		for (const size of ['normal', 'compact'] as const) {
			it(`${name}, ${size} cards: every card is taller by relationExtra; a tall card stays tall`, () => {
				const { g } = build(fixture('07'));
				const geo = geometryFor(16, size);
				const tallCards = g.people.slice(0, 5).map((p) => p.id);
				clearLayoutCache();
				const off = layoutTree(g, geo, { ...settings, tallCards }, 'test');
				const on = layoutTree(g, geo, { ...settings, tallCards, relationLine: true }, 'test');
				expect(on.layout.geometry.relationLine).toBe(true);
				expect(on.layout.geometry.cardH).toBe(off.layout.geometry.cardH + relationExtra(geo));
				expect(on.layout.geometry.cardW).toBe(off.layout.geometry.cardW);
				for (const [id, box] of on.layout.persons) {
					const before = off.layout.persons.get(id)!;
					expect(box.gen).toBe(before.gen);
					// Sideways a tall card is also taller: its column runs from top to bottom.
					expect(box.h, id).toBe(before.h + relationExtra(geo));
					expect(!!box.tallName, id).toBe(tallCards.includes(id));
					expect(box.tallTitle, id).toBeUndefined();
				}
				// D2: sibling order and rows are the same.
				expect(on.layout.rows).toEqual(off.layout.rows);
			});
		}
	}

	it('relationLine false or absent gives the layout of today, and the cache key of today', () => {
		const { g } = build(fixture('03'));
		const geo = geometryFor(16, 'normal');
		clearLayoutCache();
		const a = layoutTree(g, geo, DEFAULT_LAYOUT_SETTINGS, 'test');
		clearLayoutCache();
		const b = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: false }, 'test');
		expect(b).toEqual(a);
		expect(a.layout.geometry.relationLine).toBeUndefined();
		expect(layoutKey(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: false }, 'f')).toBe(layoutKey(g, geo, DEFAULT_LAYOUT_SETTINGS, 'f'));
		expect(layoutKey(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true }, 'f')).not.toBe(layoutKey(g, geo, DEFAULT_LAYOUT_SETTINGS, 'f'));
		expect(layoutKey(g, geo, { ...SIDE, relationLine: true }, 'f')).not.toBe(layoutKey(g, geo, SIDE, 'f'));
		// The cache keeps the two apart.
		const on = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true }, 'test');
		expect(on.layout.geometry.cardH).toBe(a.layout.geometry.cardH + relationExtra(geo));
		expect(layoutTree(g, geo, DEFAULT_LAYOUT_SETTINGS, 'test').layout.geometry.cardH).toBe(geo.cardH);
	});
});

describe('D40: cardText centres three small text lines; relationY moves up like the dates', () => {
	for (const size of ['normal', 'compact'] as const) {
		for (const tall of [false, true]) {
			it(`${size}${tall ? ', tall' : ''}`, () => {
				const plain = geometryFor(16, size);
				const geo = withRelationLine(plain, { ...DEFAULT_LAYOUT_SETTINGS, relationLine: true });
				const t = cardText(geo, tall);
				const lh = size === 'normal' ? 1.2 : 1.1;
				const smallLine = lh * t.smallSize;
				const h = geo.cardH + (tall ? tallExtra(geo) : 0);
				expect(t.relationBaseline).toBeCloseTo(t.datesBaseline + smallLine, 6);
				expect(t.datesBaseline).toBeCloseTo(t.titleBaseline + smallLine, 6);
				// Centred: the space above the name's line box equals the space below the relation's.
				const top = t.nameBaseline - lh * t.nameSize / 2 - 0.35 * t.nameSize;
				const bottom = h - (t.relationBaseline! - 0.35 * t.smallSize + smallLine / 2);
				expect(top).toBeCloseTo(bottom, 6);
				expect(relationY(t, true, true)).toBe(t.relationBaseline);
				expect(relationY(t, false, true)).toBe(t.datesBaseline);
				expect(relationY(t, true, false)).toBe(t.datesBaseline);
				expect(relationY(t, false, false)).toBe(t.titleBaseline);
				// Without the relation line, nothing changes.
				expect(cardText(plain, tall).relationBaseline).toBeUndefined();
				expect(relationY(cardText(plain, tall), true, true)).toBeUndefined();
			});
		}
	}

	it('without a relation line cardText is as before (the text block of two small lines)', () => {
		const geo = geometryFor(16, 'normal');
		const t = cardText(geo);
		expect(Object.keys(t)).not.toContain('relationBaseline');
		// D117: card 61 px, three text lines of 16.32 px (all text is 0.85 em); the name's baseline is 0.35 of its 13.6 px below the middle.
		expect(t.nameBaseline).toBeCloseTo((61 - 3 * 16.32) / 2 + 8.16 + 0.35 * 13.6, 6);
	});
});

describe('NEVER_FAR_RULE never splits a couple (the finder\'s small tree, D47)', () => {
	it('partners two generations apart keep a line', () => {
		const src = `people:
  - {id: a, name: A}
  - {id: b, name: B, parents: [a]}
  - {id: c, name: C, parents: [b]}
  - {id: d, name: D}
  - {id: e, name: E, parents: [c, d]}
unions:
  - {partners: [a, d]}
`;
		const { g } = build(src);
		const far = layoutTree(g, geometryFor(16, 'normal'), DEFAULT_LAYOUT_SETTINGS, 'test');
		const never = layoutTree(g, geometryFor(16, 'normal'), { ...DEFAULT_LAYOUT_SETTINGS, far: NEVER_FAR_RULE }, 'test');
		expect(NEVER_FAR_RULE).toEqual({ maxCardWidths: Infinity, maxGenerations: Infinity });
		expect([...far.layout.unions.values()].some((u) => u.far)).toBe(true);
		expect([...never.layout.unions.values()].some((u) => u.far)).toBe(false);
		expect(never.layout.farTags.size).toBe(0);
	});
});

/** The part each path is, from its M7 fields (see line-highlight.ts). */
function role(p: EdgePath): 'bar' | 'leg' | 'trunk' | 'drop' | 'side' {
	if (p.child !== undefined) return p.d.includes('C') ? 'side' : 'drop';
	if (p.union !== undefined && p.parents === undefined) return 'bar';
	if (p.union !== undefined && p.parents?.length === 1) return 'leg';
	return 'trunk';
}

function checkFields(g: FamilyGraph, edges: EdgeDrawing) {
	for (const p of edges.paths) {
		const r = role(p);
		const fu = p.union === undefined ? undefined : g.unionByKey.get(p.union);
		if (p.union !== undefined) expect(fu, p.union).toBeDefined();
		if (r === 'bar') {
			expect([...fu!.partners].sort()).toEqual([...p.people].sort());
			// A shared bar names the pair's last-listed union.
			const pair = g.unions.filter((u) => [...u.partners].sort().join() === [...fu!.partners].sort().join());
			expect(p.union).toBe(pair[pair.length - 1].key);
		} else if (r === 'leg') {
			expect(fu!.partners).toContain(p.parents![0]);
			expect(p.people).toContain(p.parents![0]);
		} else if (r === 'trunk') {
			expect(p.parents!.length).toBeGreaterThan(0);
			expect(p.people.slice(0, p.parents!.length)).toEqual(p.parents);
			if (fu) expect([...p.parents!].sort()).toEqual([...fu.partners].sort());
			else expect(p.parents).toHaveLength(1);
		} else if (r === 'drop') {
			expect(p.people[0]).toBe(p.child);
			expect(p.people.slice(1)).toEqual(p.parents);
			expect(g.placementParents.get(p.child!)).toEqual(expect.arrayContaining(p.parents!));
		} else {
			const s = g.secondary.find((x) => x.child === p.child && x.type === (p.kind === 'birth-link' ? 'birth' : p.kind) && x.parents.join() === p.parents!.join());
			expect(s, `${p.child} ${p.kind}`).toBeDefined();
			expect(p.union).toBe(s!.unionKey);
		}
	}
	for (const m of edges.markers) {
		if (m.kind === 'rumour') expect(m.union).toBeUndefined();
		else expect(g.unionByKey.get(m.union!)).toBeDefined();
	}
	// Every union with a dot has one marker with its key.
	const keys = edges.markers.filter((m) => m.union !== undefined).map((m) => m.union);
	expect(new Set(keys).size).toBe(keys.length);
	// Each rumoured line with a child has one "?" marker, in path order.
	expect(edges.markers.filter((m) => m.kind === 'rumour')).toHaveLength(edges.paths.filter((p) => p.kind === 'rumoured' && p.child !== undefined).length);
}

describe('M7 fields on every line and marker (EdgePath.union/parents/child, EdgeMarker.union)', () => {
	for (const id of ALL) {
		for (const [name, settings] of [
			['down', DEFAULT_LAYOUT_SETTINGS],
			['sideways', SIDE],
		] as const) {
			it(`sample tree ${id}, ${name}`, () => {
				const { g } = build(fixture(id));
				const { edges } = layoutTree(g, geometryFor(16, 'normal'), settings, 'test');
				checkFields(g, edges);
			});
		}
	}

	it('a couple with a betrothal, then a marriage, shares one bar that names the marriage', () => {
		const { g } = build(`people:
  - {id: a, name: A}
  - {id: b, name: B}
unions:
  - {partners: [a, b], type: betrothal}
  - {partners: [a, b]}
`);
		const { edges } = layoutTree(g, geometryFor(16, 'normal'), DEFAULT_LAYOUT_SETTINGS, 'test');
		const bars = edges.paths.filter((p) => role(p) === 'bar');
		expect(bars).toHaveLength(1);
		expect(bars[0].union).toBe('u1');
		expect(edges.markers.map((m) => m.union)).toEqual(['u0', 'u1']);
	});
});

/** The finder's small tree as `lineSubgraph` patches it: `child`'s only line link to `parent` is rumoured. */
function rumouredPlacement(g: FamilyGraph, child: string, parent: string): FamilyGraph {
	const placementParents = new Map(g.placementParents);
	placementParents.set(child, [parent]);
	const placementType = new Map(g.placementType);
	placementType.set(child, 'rumoured');
	const soloChildren = new Map(g.soloChildren);
	soloChildren.set(parent, [...(soloChildren.get(parent) ?? []), child]);
	return { ...g, placementParents, placementType, soloChildren, secondary: g.secondary.filter((s) => s.child !== child) };
}

describe('the finder\'s small tree: a rumoured placement is drawn as a rumoured line with a "?"', () => {
	const src = `people:
  - {id: g, name: Gareth}
  - {id: r, name: Roderick, parents: [{id: g, type: rumoured}]}
`;
	for (const [name, settings] of [
		['down', DEFAULT_LAYOUT_SETTINGS],
		['sideways', SIDE],
	] as const) {
		it(name, () => {
			const g = rumouredPlacement(build(src).g, 'r', 'g');
			clearLayoutCache();
			const { layout, edges } = layoutTree(g, geometryFor(16, 'normal'), { ...settings, far: NEVER_FAR_RULE }, 'test');
			expect(layout.persons.get('r')!.gen).toBe(layout.persons.get('g')!.gen + 1);
			const drop = edges.paths.find((p) => p.child === 'r')!;
			const trunk = edges.paths.find((p) => p.child === undefined && p.parents?.[0] === 'g')!;
			expect(drop.kind).toBe('rumoured');
			expect(trunk.kind).toBe('rumoured');
			expect(drop.parents).toEqual(['g']);
			const marks = edges.markers.filter((m) => m.kind === 'rumour');
			expect(marks).toHaveLength(1);
			// The "?" sits on the straight line from Gareth's card to Roderick's, between the two cards.
			const [pb, cb] = [layout.persons.get('g')!, layout.persons.get('r')!];
			const sideways = settings.orientation === 'sideways';
			const across = sideways ? marks[0].y : marks[0].x;
			const along = sideways ? marks[0].x : marks[0].y;
			const lineAt = sideways ? cb.y + cb.h / 2 : cb.x + cb.w / 2;
			expect(Math.abs(across - lineAt)).toBeLessThan(1);
			expect(along).toBeGreaterThan(sideways ? pb.x + pb.w : pb.y + pb.h);
			expect(along).toBeLessThan(sideways ? cb.x : cb.y);
			checkFields(g, edges);
		});
	}

	it('a rumoured child beside a birth sibling: only the rumoured drop is rumoured', () => {
		const g = rumouredPlacement(
			build(`people:
  - {id: g, name: Gareth}
  - {id: a, name: Anna, parents: [g]}
  - {id: r, name: Roderick, parents: [{id: g, type: rumoured}]}
`).g,
			'r',
			'g',
		);
		const { edges } = layoutTree(g, geometryFor(16, 'normal'), { ...DEFAULT_LAYOUT_SETTINGS, far: NEVER_FAR_RULE }, 'test');
		expect(edges.paths.find((p) => p.child === 'r')!.kind).toBe('rumoured');
		expect(edges.paths.find((p) => p.child === 'a')!.kind).toBe('descent');
		expect(edges.paths.find((p) => p.child === undefined && p.parents?.[0] === 'g')!.kind).toBe('descent');
		expect(edges.markers.filter((m) => m.kind === 'rumour')).toHaveLength(1);
		checkFields(g, edges);
	});
});

describe('the finder\'s small tree: an implicit union with no child is a plain connector', () => {
	/** Two co-parents whose child is not on the line: the implicit union stays, with no children. */
	function childless(src: string): FamilyGraph {
		const g = build(src).g;
		const key = 'i:["a","b"]';
		const fu: FamilyUnion = { key, partners: ['a', 'b'], type: 'implicit', implicit: true, children: [] };
		const unionsOf = new Map(g.unionsOf);
		for (const p of fu.partners) unionsOf.set(p, [...(unionsOf.get(p) ?? []), key]);
		return { ...g, unions: [...g.unions, fu], unionByKey: new Map([...g.unionByKey, [key, fu]]), unionsOf };
	}
	const cases = {
		'two founders': `people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n`,
		'two people with parents': `people:\n  - {id: p, name: P}\n  - {id: q, name: Q}\n  - {id: a, name: A, parents: [p]}\n  - {id: b, name: B, parents: [q]}\n`,
	};
	for (const [name, src] of Object.entries(cases)) {
		for (const [orientation, settings] of [
			['down', DEFAULT_LAYOUT_SETTINGS],
			['sideways', SIDE],
		] as const) {
			it(`${name}, ${orientation}`, () => {
				const g = childless(src);
				clearLayoutCache();
				const { edges } = layoutTree(g, geometryFor(16, 'normal'), { ...settings, far: NEVER_FAR_RULE }, 'test');
				const lines = edges.paths.filter((p) => p.union === 'i:["a","b"]');
				expect(lines.length).toBeGreaterThan(0);
				for (const p of lines) expect(p.kind).toBe('implicit');
				expect(new Set(lines.flatMap((p) => p.people))).toEqual(new Set(['a', 'b']));
				expect(lines.every((p) => p.child === undefined)).toBe(true);
				// No sign (D38), and no trunk: there is no child.
				const marker = edges.markers.find((m) => m.union === 'i:["a","b"]');
				expect(marker?.kind).toBe('implicit-union');
				expect(edges.paths.some((p) => role(p) === 'trunk' && p.union === 'i:["a","b"]')).toBe(false);
				checkFields(g, edges);
			});
		}
	}
});
