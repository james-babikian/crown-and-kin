// 0.2.5 WP-B1 (CONTRACT B.3.4, B.3.10, B.5 test 7): the text card (sideways) and the "You" tab in the layout.
// Heights, the tab rect inside the drawing for every card form, the small tree of the relation finder, the tab against union signs,
// fold spots and far-couple tags in a sideways layout, and the text card's ignorance of pictures.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { findRelation, lineSubgraph, type RelationLine } from '../src/core/relations';
import { parseDynasty } from '../src/core/parse';
import { cardForm, drawnGeometry, geometryFor, youTabRect } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, clearLayoutCache, layoutTree, pictureSets } from '../src/layout/index';
import type { Geometry, LayoutSettings } from '../src/layout/model';
import { sampleSources } from './acceptance/m11-support';

const graphs = sampleSources().flatMap((s) => {
	const parsed = parseDynasty(s.source);
	return parsed.ok ? [{ id: s.id, g: deriveFamilies(parsed.tree) }] : [];
});

describe('the text card heights', () => {
	it('ON 58 / 77, OFF 46 / 61', () => {
		for (const [f, on, off] of [[12, 58, 46], [16, 77, 61]] as const) {
			const geo = cardForm(geometryFor(f), 'sideways');
			const s = (o: Partial<LayoutSettings>): LayoutSettings => ({ ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', ...o });
			expect(drawnGeometry(geo, s({ relationLine: true })).cardH).toBe(on);
			expect(drawnGeometry(geo, s({})).cardH).toBe(off);
		}
	});

	it('the layout ignores the picture lists: no arms or portrait flag on any card, same layout with and without them', () => {
		for (const { id, g } of graphs.filter((x) => ['07b', '14'].includes(x.id))) {
			const lists = pictureSets(g, true);
			expect(lists.arms.length + lists.portraits.length, `${id} has pictures`).toBeGreaterThan(0);
			const geo = cardForm(geometryFor(12), 'sideways');
			clearLayoutCache();
			const withLists = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', ...lists }, 'font');
			clearLayoutCache();
			const without = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways' }, 'font');
			for (const p of withLists.layout.persons.values()) {
				expect(p.arms).toBeUndefined();
				expect(p.portrait).toBeUndefined();
			}
			expect(JSON.stringify([...withLists.layout.persons])).toBe(JSON.stringify([...without.layout.persons]));
			expect(withLists.layout.geometry.crown).toBeUndefined();
			expect(withLists.layout.geometry.reach).toBeUndefined();
		}
	});
});

type FormCase = { name: string; geo: (f: number) => Geometry; settings: (g: FamilyGraph) => Partial<LayoutSettings>; pictures: boolean; sideways: boolean };
const cases: FormCase[] = [
	{ name: 'Roundel with pictures', geo: (f) => cardForm(geometryFor(f), 'down'), settings: () => ({ portraits: ['x'], arms: ['y'] }), pictures: true, sideways: false },
	{ name: 'Roundel without pictures', geo: (f) => cardForm(geometryFor(f), 'down'), settings: () => ({}), pictures: false, sideways: false },
	{ name: 'text card (sideways)', geo: (f) => cardForm(geometryFor(f), 'sideways'), settings: () => ({ orientation: 'sideways' }), pictures: false, sideways: true },
];

describe('tab rect inside the drawing bounds', () => {
	for (const c of cases) {
		for (const f of [12, 16]) {
			it(`${c.name}, ${f} px: the tab of every card has y >= 0 and lies inside the layout`, () => {
				for (const { id, g } of graphs) {
					const first = g.people[0].id;
					clearLayoutCache();
					const L = layoutTree(g, c.geo(f), { ...DEFAULT_LAYOUT_SETTINGS, foldControls: true, ...c.settings(g), youTab: first }, 'font').layout;
					expect(L.youTab).toBe(first);
					for (const p of L.persons.values()) {
						const r = youTabRect(L.geometry, c.pictures);
						const x0 = p.x + r.x - 0.75;
						const y0 = p.y + r.y - 0.75;
						expect(y0, `${id} ${p.id} top`).toBeGreaterThanOrEqual(-1e-9);
						expect(x0, `${id} ${p.id} left`).toBeGreaterThanOrEqual(-1e-9);
						expect(p.x + r.x + r.w + 0.75, `${id} ${p.id} right`).toBeLessThanOrEqual(L.width + 1e-9);
						expect(p.y + r.y + r.h + 0.75, `${id} ${p.id} bottom`).toBeLessThanOrEqual(L.height + 1e-9);
					}
				}
			});
		}
	}

	it('with no youTab the same layout has no reach (no picture) and no tab', () => {
		for (const c of cases.filter((x) => !x.pictures)) {
			const g = graphs[0].g;
			clearLayoutCache();
			const L = layoutTree(g, c.geo(12), { ...DEFAULT_LAYOUT_SETTINGS, ...c.settings(g) }, 'font').layout;
			expect(L.youTab, c.name).toBeUndefined();
			expect(L.geometry.reach, c.name).toBeUndefined();
			expect(Math.min(...[...L.persons.values()].map((p) => (c.sideways ? p.y : p.y))), c.name).toBe(0);
		}
	});

	it('the first card sits `reach` in: down along y, sideways along the stack axis (real y)', () => {
		for (const c of cases) {
			const g = graphs.find((x) => x.id === '01')!.g;
			clearLayoutCache();
			const L = layoutTree(g, c.geo(12), { ...DEFAULT_LAYOUT_SETTINGS, ...c.settings(g), youTab: g.people[0].id }, 'font').layout;
			const reach = L.geometry.reach!;
			expect(reach, c.name).toBeGreaterThan(0);
			expect(Math.min(...[...L.persons.values()].map((p) => p.y)), c.name).toBe(reach);
			if (!c.sideways) expect(Math.min(...[...L.persons.values()].map((p) => p.x)), c.name).toBe(0);
		}
	});
});

describe('the reach is a uniform shift', () => {
	it('sideways: the tab only moves every card, union and tag by `reach` along the stack axis; routing is the same', () => {
		for (const { id, g } of graphs.filter((x) => ['07', '04', '12'].includes(x.id))) {
			const geo = cardForm(geometryFor(12), 'sideways');
			const s: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', foldControls: true };
			clearLayoutCache();
			const plain = layoutTree(g, geo, s, 'font');
			clearLayoutCache();
			const tabbed = layoutTree(g, geo, { ...s, youTab: g.people[0].id }, 'font');
			const reach = tabbed.layout.geometry.reach!;
			for (const [pid, p] of plain.layout.persons) {
				const q = tabbed.layout.persons.get(pid)!;
				expect([q.x, q.y, q.w, q.h], `${id} ${pid}`).toEqual([p.x, expect.closeTo(p.y + reach, 6), p.w, p.h]);
			}
			for (const [k, u] of plain.layout.unions) {
				const q = tabbed.layout.unions.get(k)!;
				expect([q.x, q.y], `${id} ${k}`).toEqual([u.x, expect.closeTo(u.y + reach, 6)]);
			}
			expect(tabbed.layout.height).toBeCloseTo(plain.layout.height + reach, 9);
			expect(tabbed.layout.width).toBeCloseTo(plain.layout.width, 9);
			expect(tabbed.edges.paths.length).toBe(plain.edges.paths.length);
			expect(tabbed.edges.markers.length).toBe(plain.edges.markers.length);
		}
	});

	it('down: the Roundel with a tab moves every card down by `reach` and nothing sideways', () => {
		for (const { id, g } of graphs.filter((x) => ['07', '04', '12'].includes(x.id))) {
			const geo = cardForm(geometryFor(12), 'down');
			clearLayoutCache();
			const plain = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS }, 'font');
			clearLayoutCache();
			const tabbed = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, youTab: g.people[0].id }, 'font');
			const reach = tabbed.layout.geometry.reach!;
			expect(reach).toBe(8);
			for (const [pid, p] of plain.layout.persons) {
				const q = tabbed.layout.persons.get(pid)!;
				expect([q.x, q.y], `${id} ${pid}`).toEqual([p.x, expect.closeTo(p.y + reach, 6)]);
			}
			expect(tabbed.layout.height).toBeCloseTo(plain.layout.height + reach, 9);
		}
	});
});

describe('the small tree of the relation finder', () => {
	function line(): { g: FamilyGraph; line: RelationLine } {
		for (const { g } of graphs.filter((x) => x.id === '12' || x.id === '01' || x.id === '06')) {
			for (const a of g.people.slice(0, 12)) {
				for (const b of g.people.slice(-12)) {
					if (a.id === b.id) continue;
					const r = findRelation(g, a.id, b.id);
					const l = r.kind === 'named' ? r.relations[0].relation.line : r.kind === 'chain' ? r.line : undefined;
					if (l && l.people.length >= 3) return { g, line: l };
				}
			}
		}
		throw new Error('no relation line in the sample trees');
	}

	it('youTab on a person of the line gives that card the tab and `reach` by form; a person outside gives neither', () => {
		const { g, line: l } = line();
		const small = lineSubgraph(g, l);
		const outside = g.people.find((p) => !l.people.includes(p.id))!.id;
		expect(small.byId.has(outside)).toBe(false);
		for (const c of cases) {
			const geo = c.geo(12);
			const s = (youTab: string): LayoutSettings => ({ ...DEFAULT_LAYOUT_SETTINGS, far: NEVER_FAR_RULE, ...c.settings(small), youTab });
			clearLayoutCache();
			const inLine = layoutTree(small, geo, s(l.people[1]), 'font').layout;
			expect(inLine.youTab, c.name).toBe(l.people[1]);
			expect(inLine.geometry.reach, c.name).toBe(drawnGeometry(geo, s(l.people[1])).reach);
			if (!c.pictures) expect(inLine.geometry.reach, c.name).toBeGreaterThan(0);
			clearLayoutCache();
			const away = layoutTree(small, geo, s(outside), 'font').layout;
			expect(away.youTab, c.name).toBeUndefined();
			expect(away.geometry.reach, c.name).toBe(c.pictures ? drawnGeometry(geo, { ...s(outside), youTab: undefined }).reach : undefined);
		}
	});
});

describe('the sideways text card tab (plate OFF) against union signs, fold spots and far tags', () => {
	for (const f of [12, 16]) {
		it(`${f} px: the tab rect of every card meets no union sign, fold spot or far-couple tag pill`, () => {
			const hits: string[] = [];
			let checked = 0;
			let tags = 0;
			for (const { id, g } of graphs) {
				const geo = cardForm(geometryFor(f), 'sideways');
				clearLayoutCache();
				const L = layoutTree(g, geo, { ...DEFAULT_LAYOUT_SETTINGS, orientation: 'sideways', foldControls: true, youTab: g.people[0].id }, 'font').layout;
				const r = youTabRect(L.geometry, false);
				for (const p of L.persons.values()) {
					const tab = { x: p.x + r.x, y: p.y + r.y, w: r.w, h: r.h };
					for (const [k, u] of L.unions) {
						checked++;
						const rad = 0.625 * f;
						if (u.x + rad > tab.x && u.x - rad < tab.x + tab.w && u.y + rad > tab.y && u.y - rad < tab.y + tab.h) hits.push(`${id} union ${k} vs card ${p.id}`);
					}
					for (const c of L.folds ?? []) {
						const rad = 0.6 * f;
						if (c.spot.x + rad > tab.x && c.spot.x - rad < tab.x + tab.w && c.spot.y + rad > tab.y && c.spot.y - rad < tab.y + tab.h) hits.push(`${id} fold ${c.key} vs card ${p.id}`);
					}
					for (const t of L.farTags.values()) {
						tags++;
						const w = t.zoneW ?? t.hit.w;
						const pill = { x: t.x - w / 2, y: t.y - Math.round(0.1875 * f), w, h: L.geometry.tagH };
						if (pill.x < tab.x + tab.w && tab.x < pill.x + pill.w && pill.y < tab.y + tab.h && tab.y < pill.y + pill.h) hits.push(`${id} tag of ${t.person} vs tab of ${p.id}`);
					}
				}
			}
			expect(checked).toBeGreaterThan(0);
			expect(tags, 'the sample trees have far tags sideways').toBeGreaterThan(0);
			expect(hits.slice(0, 6), `${hits.length} meetings`).toEqual([]);
		});
	}
});
