// 0.2.7 WP4 geometry (CONTRACT F.4): `LayoutSettings.ordinalCards` in the layout key, the reach it makes, `TreeLayout.ordinalCards`, and the line
// planner: a card with a tab takes the drop places of the "You" card, so no line meets an ordinal tab. Ids only; the texts are never in a layout.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { FamilyGraph } from '../src/core/derive';
import { computeGenerations } from '../src/core/generations';
import { computeModelOrder } from '../src/core/order';
import { parseDynasty } from '../src/core/parse';
import { cardForm, drawnGeometry, gapHeight, geometryFor, ordinalTabRect, roundelAxis } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutKey, layoutTree } from '../src/layout/index';
import { planLines, tabbedCards } from '../src/layout/lines';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { sampleSources } from './acceptance/m11-support';
import { build } from './helpers';

const SRC = [
	'people:',
	'  - {id: a, name: Aldric}',
	'  - {id: b, name: Brenna}',
	'  - {id: c, name: Cedric, parents: [a, b]}',
	'  - {id: d, name: Dora, parents: [a, b]}',
	'  - {id: e, name: Edric, parents: [a, b]}',
	'  - {id: f, name: Fenna, parents: [c]}',
	'',
].join('\n');
const g = build(SRC).g;
const geo = cardForm(geometryFor(16), 'down');
const sideGeo = cardForm(geometryFor(16), 'sideways');
const base: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS };
const key = (s: Partial<LayoutSettings>, gg: FamilyGraph = g) => layoutKey(gg, geo, { ...base, ...s }, 'font');
const lay = (s: Partial<LayoutSettings>, gg: FamilyGraph = g, geometry = geo): LaidOut => {
	clearLayoutCache();
	return layoutTree(gg, geometry, { ...base, ...(geometry.form === 'text' ? { orientation: 'sideways' as const } : {}), ...s }, 'font');
};

describe('F.4: the layout key', () => {
	it('the ids are in the key; another set of ids gives another key', () => {
		const none = key({});
		const ab = key({ ordinalCards: ['c', 'd'] });
		expect(ab).not.toBe(none);
		expect(key({ ordinalCards: ['c'] })).not.toBe(ab);
		expect(key({ ordinalCards: ['c', 'e'] })).not.toBe(ab);
	});

	it('the order and a repeated id make no difference', () => {
		expect(key({ ordinalCards: ['d', 'c'] })).toBe(key({ ordinalCards: ['c', 'd'] }));
		expect(key({ ordinalCards: ['c', 'd', 'c'] })).toBe(key({ ordinalCards: ['c', 'd'] }));
	});

	it('absent when empty: no option, undefined, [] and ids of nobody in the graph all give the key of a normal layout', () => {
		const none = key({});
		expect(key({ ordinalCards: undefined })).toBe(none);
		expect(key({ ordinalCards: [] })).toBe(none);
		expect(key({ ordinalCards: ['nobody'] })).toBe(none);
	});

	it('an id of nobody in the graph is dropped, the others stay', () => {
		expect(key({ ordinalCards: ['c', 'nobody'] })).toBe(key({ ordinalCards: ['c'] }));
	});

	it('the "You" tab and the ordinal cards are two parts of the key', () => {
		expect(key({ youTab: 'c', ordinalCards: ['d'] })).not.toBe(key({ youTab: 'c' }));
		expect(key({ youTab: 'c', ordinalCards: ['d'] })).not.toBe(key({ youTab: 'd', ordinalCards: ['c'] }));
	});

	it('two layouts with other ids do not share a cache entry', () => {
		clearLayoutCache();
		const one = layoutTree(g, geo, { ...base, ordinalCards: ['c'] }, 'font');
		const two = layoutTree(g, geo, { ...base, ordinalCards: ['d'] }, 'font');
		expect(one).not.toBe(two);
		expect(one.layout.ordinalCards).toEqual(['c']);
		expect(two.layout.ordinalCards).toEqual(['d']);
		expect(layoutTree(g, geo, { ...base, ordinalCards: ['c'] }, 'font')).toBe(one);
	});
});

describe('F.4: the layout', () => {
	it('a normal layout has no `ordinalCards` and no reach (a tree with no picture and no "You" tab)', () => {
		const L = lay({}).layout;
		expect('ordinalCards' in L).toBe(false);
		expect(L.geometry.reach).toBeUndefined();
		expect('ordinalCards' in lay({ ordinalCards: [] }).layout).toBe(false);
		expect(lay({ ordinalCards: [] }).layout.persons.get('a')!.y).toBe(0);
	});

	it('`TreeLayout.ordinalCards` holds the sorted ids that are people of the graph', () => {
		expect(lay({ ordinalCards: ['e', 'nobody', 'c', 'e'] }).layout.ordinalCards).toEqual(['c', 'e']);
	});

	it('the first row starts `reach` in, the reach of a "You" tab, in both card forms', () => {
		const tabbed = lay({ ordinalCards: ['c'] }).layout;
		const you = lay({ youTab: 'c' }).layout;
		expect(tabbed.geometry.reach).toBe(Math.ceil(0.55 * 16 + 1));
		expect(tabbed.geometry.reach).toBe(you.geometry.reach);
		expect(tabbed.persons.get('a')!.y).toBe(tabbed.geometry.reach);
		const side = lay({ ordinalCards: ['c'] }, g, sideGeo).layout;
		expect(side.geometry.reach).toBe(Math.ceil(0.9 * 16 + 1));
		expect(side.ordinalCards).toEqual(['c']);
		expect(side.orientation).toBe('sideways');
	});

	it('with a portrait the reach is the crown reach and holds the tab', () => {
		const L = lay({ ordinalCards: ['c'], portraits: ['c'] }).layout;
		const tab = ordinalTabRect(L.geometry, true, false, 4);
		expect(-tab.y).toBeLessThanOrEqual(L.geometry.reach!);
	});

	it('drawnGeometry (known before the layout runs) has the same reach', () => {
		const settings: LayoutSettings = { ...base, ordinalCards: ['c'] };
		expect(drawnGeometry(geo, settings).reach).toBe(lay({ ordinalCards: ['c'] }).layout.geometry.reach);
	});

	it('the layout of the same ids is the same twice (deterministic) and a card with an ordinal moves no other card', () => {
		const plain = lay({}).layout;
		const tabbed = lay({ ordinalCards: ['c', 'd', 'e'] }).layout;
		const shift = tabbed.geometry.reach!;
		for (const [id, b] of plain.persons) {
			const t = tabbed.persons.get(id)!;
			expect([t.x, t.y - shift, t.w, t.h], id).toEqual([b.x, b.y, b.w, b.h]);
		}
	});
});

// ---------- the line planner against the sample trees ----------

type Pt = [number, number];
/** Points along a path of M, H, V and C commands, about 1 px apart. */
function sample(d: string): Pt[] {
	const out: Pt[] = [];
	let x = 0;
	let y = 0;
	for (const [, cmd, args] of d.matchAll(/([MHVC])([^MHVC]*)/g)) {
		const n = args.trim().split(' ').map(Number);
		if (cmd === 'M') [x, y] = n;
		else if (cmd === 'H' || cmd === 'V') {
			const tx = cmd === 'H' ? n[0] : x;
			const ty = cmd === 'V' ? n[0] : y;
			const k = Math.max(1, Math.ceil(Math.hypot(tx - x, ty - y)));
			for (let i = 0; i <= k; i++) out.push([x + ((tx - x) * i) / k, y + ((ty - y) * i) / k]);
			[x, y] = [tx, ty];
		} else {
			const [sx, sy] = [x, y];
			for (let i = 0; i <= 60; i++) {
				const t = i / 60;
				const u = 1 - t;
				out.push([u * u * u * sx + 3 * u * u * t * n[0] + 3 * u * t * t * n[2] + t * t * t * n[4], u * u * u * sy + 3 * u * u * t * n[1] + 3 * u * t * t * n[3] + t * t * t * n[5]]);
			}
			[x, y] = [n[4], n[5]];
		}
	}
	return out;
}

const parse = (source: string): FamilyGraph => {
	const parsed = parseDynasty(source);
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
};

/** The drop of a child, as an offset from its card's axis: the `M x y V y2` path of the child. */
function dropOffsets(laid: LaidOut): Map<string, number> {
	const out = new Map<string, number>();
	for (const p of laid.edges.paths) {
		const m = /^M([\d.-]+) ([\d.-]+)V([\d.-]+)$/.exec(p.d);
		if (!m || p.child === undefined) continue;
		const b = laid.layout.persons.get(p.child)!;
		out.set(p.child, Number(m[1]) - (b.x + roundelAxis(laid.layout.geometry)));
	}
	return out;
}

describe('F.4: planLines gives a tabbed card the drop places of the "You" card', () => {
	const trees = sampleSources().map((s) => ({ id: s.id, g: parse(s.source) }));

	function run(gg: FamilyGraph, f: number, ordinalCards: string[]) {
		const roundel = cardForm(geometryFor(f), 'down');
		const pics = { portraits: gg.people.map((p) => p.id).sort() };
		clearLayoutCache();
		return layoutTree(gg, roundel, { ...base, ...pics, ordinalCards }, 'font');
	}

	/** Up to 5 children of the family with the most children, and every card whose drop another trunk moves off the axis. */
	function heirsOf(gg: FamilyGraph, f: number): string[] {
		const plain = run(gg, f, []);
		const off = [...dropOffsets(plain)].filter(([, o]) => Math.abs(o) > 0.5).map(([id]) => id);
		const families = [...gg.unions.map((u) => u.children), ...[...gg.soloChildren.values()]];
		const widest = families.sort((a, b) => b.length - a.length)[0] ?? [];
		return [...new Set([...widest.slice(0, 5), ...off])];
	}

	it('no drop of a tabbed card lies left of its axis, and no other card changes its drop', () => {
		let tabbedOff = 0;
		let heirs5 = 0;
		for (const f of [12, 16]) {
			for (const t of trees) {
				const cards = heirsOf(t.g, f);
				if (!cards.length) continue;
				const plain = dropOffsets(run(t.g, f, []));
				const withTabs = dropOffsets(run(t.g, f, cards));
				if (cards.length >= 5) heirs5++;
				for (const [id, off] of withTabs) {
					if (cards.includes(id)) {
						expect(off, `${t.id} ${f}px ${id}`).toBeGreaterThanOrEqual(-0.5);
						if (Math.abs(plain.get(id)! - off) > 0.5) tabbedOff++;
					} else expect(off, `${t.id} ${f}px ${id}`).toBeCloseTo(plain.get(id)!, 6);
				}
			}
		}
		// Sample tree 07 has cards whose drop another trunk moves left of the axis: with a tab they move.
		expect(tabbedOff).toBeGreaterThan(0);
		expect(heirs5).toBeGreaterThan(4);
	});

	it('no line meets an ordinal tab (5 heirs of one trunk and every card that a trunk moves)', () => {
		const bad: string[] = [];
		let tabs = 0;
		for (const f of [12, 16]) {
			for (const t of trees) {
				const cards = heirsOf(t.g, f);
				if (!cards.length) continue;
				const laid = run(t.g, f, cards);
				const rects = cards.map((id) => {
					const b = laid.layout.persons.get(id)!;
					const r = ordinalTabRect(laid.layout.geometry, !!b.portrait, !!b.arms, 4);
					tabs++;
					// The tab is drawn with a 1 px border: 0.5 px each side.
					// Below the card's top edge the tab lies on the card, which hides any line there (a side link runs under its own card); only the part above counts.
					return { id, x: b.x + r.x - 0.5, y: b.y + r.y - 0.5, w: r.w + 1, h: -r.y + 0.5 - 0.01 };
				});
				for (const p of laid.edges.paths) {
					for (const [x, y] of sample(p.d)) {
						const hit = rects.find((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
						if (hit) bad.push(`${t.id} ${f}px: ${p.kind} line meets the tab of ${hit.id} at ${x.toFixed(1)},${y.toFixed(1)}`);
					}
				}
			}
		}
		expect(tabs).toBeGreaterThan(20);
		expect(bad.slice(0, 5)).toEqual([]);
	});

	it('the plan that sized the gaps is the plan of the router: every gap holds the lanes planned with the layout`s tabbed set', () => {
		const bad: string[] = [];
		let compared = 0;
		for (const t of trees.filter((x) => ['07', '12', '15', '16'].includes(x.id))) {
			const cards = heirsOf(t.g, 16);
			const laid = run(t.g, 16, cards);
			const L = laid.layout;
			const order = computeModelOrder(t.g, computeGenerations(t.g));
			const plan = planLines({ g: t.g, persons: L.persons, rows: L.rows, unions: L.unions, anchors: order.anchors, geo: L.geometry, tabbed: tabbedCards(L.youTab, L.ordinalCards) });
			L.rowGaps.forEach((gap, k) => {
				compared++;
				const need = gapHeight(L.geometry, plan.coupleLanes[k], plan.barLanes[k]);
				if (gap.bottom - gap.top < need - 1e-6) bad.push(`${t.id}: gap ${k} holds ${gap.bottom - gap.top}, the lines need ${need}`);
			});
		}
		expect(compared).toBeGreaterThan(10);
		expect(bad).toEqual([]);
	});

	it('`tabbed` and `youTab` are the same for a single card; the "You" card and the ordinal cards are tabbed together', () => {
		// 0.3 (D231): with the added step no card of tree 07 has a drop that another trunk moves; tree 12 still has one.
		const t = trees.find((x) => x.id === '12')!;
		const plainLaid = run(t.g, 12, []);
		const L = plainLaid.layout;
		const order = computeModelOrder(t.g, computeGenerations(t.g));
		const input = { g: t.g, persons: L.persons, rows: L.rows, unions: L.unions, anchors: order.anchors, geo: L.geometry };
		const off = [...dropOffsets(plainLaid)].filter(([, o]) => Math.abs(o) > 0.5).map(([id]) => id);
		expect(off.length).toBeGreaterThan(0);
		const dropsOf = (plan: ReturnType<typeof planLines>) => plan.families.map((fam) => fam.dropX);
		expect(dropsOf(planLines({ ...input, tabbed: new Set([off[0]]) }))).toEqual(dropsOf(planLines({ ...input, youTab: off[0] })));
		expect(dropsOf(planLines({ ...input, tabbed: tabbedCards(off[0], off.slice(1)) }))).toEqual(dropsOf(planLines({ ...input, tabbed: new Set(off) })));
	});
});
