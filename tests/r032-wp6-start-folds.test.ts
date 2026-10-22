import { describe, expect, it } from 'vitest';

import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { focusSubgraph } from '../src/core/focus-subgraph';
import { foldFamilies, foldHidden } from '../src/core/folds';
import { parseDynasty } from '../src/core/parse';
import type { LaidOut, Rect } from '../src/layout/model';
import { partnersAndChildren } from '../src/render/tree-info';
import { approxMeasure } from '../src/render/svg-string';
import { carryState, newBlockState, type BlockState } from '../src/view/block-state';
import { autoFoldPatch, setFolds, stillAuto } from '../src/view/fold-view';
import { outsideBox, sidewaysView, signRights } from '../src/view/focus-mode';
import { measuredLayout } from '../src/view/measured-layout';
import { planRender, type RenderInputs, type StateChanges, type TreePlan } from '../src/view/render-plan';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { startFolds, wholeFacts, wholeFactsOf } from '../src/view/start-folds';
import { allFixtures } from './acceptance/load';

// WP-6 (D257): the families that the whole tree draws far away start folded in every focus view of the phone held upright. The rule is `src/view/start-folds.ts`;
// `planRender` keeps the automatic folds apart from the owner's own (`autoFolds`, `autoFor`); the first view makes the names smaller until a "+ N" sign is whole.

const FONTS = { px: 16, text: 'Segoe UI, Helvetica, Arial, sans-serif', ui: 'Segoe UI, Helvetica, Arial, sans-serif', bold: '600' };
const sample = (id: string) => allFixtures().find((f) => f.id === id)!.source;
const parsedOf = (id: string) => {
	const parsed = parseDynasty(sample(id));
	if (!parsed.ok) throw new Error(`sample ${id} does not parse`);
	return { tree: parsed.tree, whole: deriveFamilies(parsed.tree) };
};
const focusGraph = (tree: ReturnType<typeof parsedOf>['tree'], focus: string, n = 3) => deriveFamilies(focusSubgraph(tree, focus, n)!.tree);

/** The inputs of the full-screen view on a phone held upright (the left-to-right tree), with `state`. */
function phone(id: string, state: BlockState, over: Partial<RenderInputs> = {}): RenderInputs {
	return {
		parsed: parseDynasty(sample(id)),
		settings: DEFAULT_SETTINGS,
		state,
		coarse: true,
		phone: true,
		full: { focus: null, target: null },
		orientation: 'sideways',
		pendingTarget: null,
		stopChecked: false,
		stopped: () => false,
		fonts: () => FONTS,
		clock: () => 0,
		...over,
	};
}

/** Applies the changes of a render to `st`, as `TreeView.applyChanges` does. */
function apply(st: BlockState, c: StateChanges): void {
	Object.assign(st, c.block);
}

/** A block state that focuses `focus`. */
function focused(focus: string): BlockState {
	const st = newBlockState();
	st.focus = { id: focus };
	return st;
}

/** Every person of every sample (07b left out: it is 07 with pictures) as the focus person in turn, at 3 generations; made once for the tests that read it. */
let swept: { views: number; changed: number; views07: number; changed07: number; unstable: number; bad: string[] } | null = null;
function sweep() {
	if (swept) return swept;
	const w = { views: 0, changed: 0, views07: 0, changed07: 0, unstable: 0, bad: [] as string[] };
	for (const f of allFixtures()) {
		const parsed = parseDynasty(f.source);
		if (!parsed.ok || f.id === '07b') continue;
		const whole = deriveFamilies(parsed.tree);
		const fa = wholeFacts(whole);
		for (const p of whole.people) {
			const sub = focusSubgraph(parsed.tree, p.id, 3);
			if (!sub) continue;
			const g = deriveFamilies(sub.tree);
			const got = startFolds(whole, () => fa, g, p.id);
			w.views++;
			if (got.length) w.changed++;
			if (f.id === '07') {
				w.views07++;
				if (got.length) w.changed07++;
				if (JSON.stringify(startFolds(whole, () => fa, g, p.id)) !== JSON.stringify(got)) w.unstable++;
			}
			const ancestors = new Set<string>();
			for (const todo = [p.id]; todo.length; ) for (const a of g.placementParents.get(todo.pop()!) ?? []) {
				if (ancestors.has(a)) continue;
				ancestors.add(a);
				todo.push(a);
			}
			// The signs of one view add up to the people the folds remove (fix round): no person is counted twice.
			if (got.length && foldHidden(g, new Set(got.map((c) => c.key))).size !== got.reduce((a, c) => a + c.count, 0)) w.bad.push(`${f.id} ${p.id} signs`);
			for (const sf of got) {
				const hidden = foldHidden(g, new Set([sf.key]));
				if (hidden.has(p.id) || sf.key.includes(JSON.stringify(p.id)) || [...ancestors].some((a) => hidden.has(a)) || sf.count !== hidden.size) w.bad.push(`${f.id} ${p.id} ${sf.key}`);
			}
		}
	}
	swept = w;
	return w;
}

const EDMUND = 'edmund-valmont';
const THEA_KEY = '["thea-valmont","varian-veyle"]';
const BLANCHE_KEY = '["blanche-valmont-2","wystan-harrow"]';
const NERYS_KEY = '["nerys-orsini","sigmund-valmont"]';

describe('the rule: which families start folded', () => {
	const s = parsedOf('07');
	const facts = wholeFacts(s.whole);

	it('Edmund Valmont: three families, with the counts of the preview (+12, +1, +2)', () => {
		const got = startFolds(s.whole, () => facts, focusGraph(s.tree, EDMUND), EDMUND);
		expect(got).toEqual([
			{ key: THEA_KEY, count: 12 },
			{ key: BLANCHE_KEY, count: 1 },
			{ key: NERYS_KEY, count: 2 },
		]);
	});

	it('Perrine Drakemoor: the children fitted already, and C1 still folds 19 people', () => {
		const got = startFolds(s.whole, () => facts, focusGraph(s.tree, 'perrine-drakemoor'), 'perrine-drakemoor');
		expect(got).toEqual([{ key: '["viviane-drakemoor","wendel-castellane"]', count: 19 }]);
	});

	it('the family of the focus person and of the ancestors never folds, and a count is the people the fold removes, for every person of every sample', () => {
		expect(sweep().bad).toEqual([]);
	});

	it('the facts of the whole tree are worked out only when a candidate exists, and once for each parse', () => {
		let asked = 0;
		// A focus on a person at the top of the tree: no partner with parents is cut away.
		const root = s.whole.people.find((p) => !(s.whole.placementParents.get(p.id)?.length))!;
		startFolds(s.whole, () => (asked++, facts), focusGraph(s.tree, root.id, 1), root.id);
		expect(asked).toBe(0);
		expect(wholeFactsOf(s.tree, s.whole)).toBe(wholeFactsOf(s.tree, s.whole));
	});

	it('the focus views that change: 108 of 389 in sample tree 7 and 125 of 752 over all samples (07b left out), the same in a second run', () => {
		const w = sweep();
		expect({ views: w.views07, changed: w.changed07 }).toEqual({ views: 389, changed: 108 });
		expect({ views: w.views, changed: w.changed }).toEqual({ views: 752, changed: 125 });
		expect(w.unstable).toBe(0);
	});
});

describe('the automatic folds in planRender', () => {
	const family = (plan: ReturnType<typeof planRender>['plan']) => plan as TreePlan;

	it('opening a focus folds the far families, apart from the owner\'s folds, and the layout carries them', () => {
		const st = focused(EDMUND);
		const { plan, stateChanges } = planRender(phone('07', st));
		expect([...stateChanges.block.folds!].sort()).toEqual([THEA_KEY, BLANCHE_KEY, NERYS_KEY].sort());
		expect([...stateChanges.block.autoFolds!].sort()).toEqual([THEA_KEY, BLANCHE_KEY, NERYS_KEY].sort());
		expect(stateChanges.block.autoFor).toBe('focus:edmund-valmont:3');
		const t = family(plan);
		expect(t.foldPlan.foldedList.sort()).toEqual([THEA_KEY, BLANCHE_KEY, NERYS_KEY].sort());
		expect([...t.laidBase.foldedFamilies!].sort()).toEqual([THEA_KEY, BLANCHE_KEY, NERYS_KEY].sort());
		expect(t.foldPlan.hidden.size).toBe(12 + 1 + 2);
	});

	it('the count of a sign equals the people the fold removes from the drawn tree', () => {
		const st = focused(EDMUND);
		const t = family(planRender(phone('07', st)).plan);
		const all = deriveFamilies(focusSubgraph(parsedOf('07').tree, EDMUND, 3)!.tree);
		const { laid } = measuredLayout(t.g, t.geo, t.laidBase, { fonts: { text: FONTS.text, ui: FONTS.ui, bold: FONTS.bold }, measure: approxMeasure, showDates: true, showPortraits: false });
		const signs = (laid.layout.folds ?? []).filter((c) => c.folded);
		expect(signs.map((c) => c.count).sort((a, b) => a - b)).toEqual([1, 2, 12]);
		expect(all.people.length - laid.layout.persons.size).toBe(12 + 1 + 2);
	});

	it('the same focus does not decide again: a family that the owner opened stays open', () => {
		const st = focused(EDMUND);
		apply(st, planRender(phone('07', st)).stateChanges);
		// One tap on the "+ 12" sign: the key leaves the folds, and so the automatic folds.
		const open = new Set(st.folds);
		open.delete(THEA_KEY);
		setFolds(st, open);
		expect(st.autoFolds?.has(THEA_KEY)).toBe(false);
		expect(st.autoFolds?.size).toBe(2);
		const again = planRender(phone('07', st));
		expect(again.stateChanges.block.folds).toBeUndefined();
		expect(again.stateChanges.block.autoFor).toBeUndefined();
		expect(family(again.plan).foldPlan.foldedList).not.toContain(THEA_KEY);
		expect(family(again.plan).foldPlan.hidden.size).toBe(1 + 2);
	});

	it('a family that the owner folds again is the owner\'s own and stays after Clear focus', () => {
		const st = focused(EDMUND);
		apply(st, planRender(phone('07', st)).stateChanges);
		const open = new Set(st.folds);
		open.delete(THEA_KEY);
		setFolds(st, open);
		setFolds(st, new Set([...st.folds, THEA_KEY]));
		st.focus = { id: null };
		apply(st, planRender(phone('07', st)).stateChanges);
		expect([...st.folds]).toEqual([THEA_KEY]);
		expect(st.autoFolds?.size).toBe(0);
	});

	it('Clear focus takes the automatic folds out and keeps the owner\'s own', () => {
		const st = focused(EDMUND);
		// A family of sample 7 that is not far from anybody's focus on Edmund: it is in the whole tree and not among the three.
		const own = foldFamilies(parsedOf('07').whole).map((f) => f.key).find((k) => ![THEA_KEY, BLANCHE_KEY, NERYS_KEY].includes(k))!;
		st.folds = new Set([own]);
		apply(st, planRender(phone('07', st)).stateChanges);
		expect(st.folds.size).toBe(4);
		expect(st.folds.has(own)).toBe(true);
		st.focus = { id: null };
		const { stateChanges } = planRender(phone('07', st));
		apply(st, stateChanges);
		expect([...st.folds]).toEqual([own]);
		expect(st.autoFolds?.size).toBe(0);
		expect(st.autoFor).toBeNull();
	});

	it('another focus person takes the old automatic folds out and chooses its own', () => {
		const st = focused(EDMUND);
		apply(st, planRender(phone('07', st)).stateChanges);
		st.focus = { id: 'perrine-drakemoor' };
		apply(st, planRender(phone('07', st)).stateChanges);
		expect([...st.folds]).toEqual(['["viviane-drakemoor","wendel-castellane"]']);
		expect([...st.autoFolds!]).toEqual([...st.folds]);
		expect(st.autoFor).toBe('focus:perrine-drakemoor:3');
	});

	it('a new focus drawn top to bottom takes the old automatic folds out, adds none and keeps the own folds of the owner; a turn of the phone with the same focus keeps them', () => {
		const st = focused(EDMUND);
		const own = foldFamilies(parsedOf('07').whole).map((f) => f.key).find((k) => ![THEA_KEY, BLANCHE_KEY, NERYS_KEY].includes(k))!;
		st.folds = new Set([own]);
		apply(st, planRender(phone('07', st)).stateChanges);
		expect(st.folds.size).toBe(4);
		// The same focus, the phone on its side: the automatic folds stay and nothing is chosen again.
		const turned = planRender(phone('07', st, { orientation: 'down' }));
		expect(turned.stateChanges.block.folds).toBeUndefined();
		expect(family(turned.plan).foldPlan.foldedList).toHaveLength(4);
		// A child of Edmund becomes the focus while the phone is on its side.
		st.focus = { id: 'blanche-valmont-2' };
		const next = planRender(phone('07', st, { orientation: 'down' }));
		apply(st, next.stateChanges);
		expect([...st.folds]).toEqual([own]);
		expect(st.autoFolds?.size).toBe(0);
		expect(st.autoFor).toBeNull();
		// Upright again with that focus: its own far families fold now, once.
		const upright = planRender(phone('07', st));
		apply(st, upright.stateChanges);
		expect(st.autoFor).toBe('focus:blanche-valmont-2:3');
		expect(st.folds.has(own)).toBe(true);
	});

	it('carryState and the carry of a loose handle give the memory of the automatic folds only where the new state holds none', () => {
		const from = newBlockState();
		from.folds = new Set([THEA_KEY, 'owner']);
		from.autoFolds = new Set([THEA_KEY]);
		from.autoFor = 'focus:edmund-valmont:3';
		const empty = newBlockState();
		carryState(from, empty);
		expect([...empty.autoFolds!]).toEqual([THEA_KEY]);
		expect(empty.autoFor).toBe('focus:edmund-valmont:3');
		const held = newBlockState();
		held.folds = new Set(['kept']);
		held.autoFor = 'focus:perrine-drakemoor:3';
		held.autoFolds = new Set();
		carryState(from, held);
		expect(held.autoFor).toBe('focus:perrine-drakemoor:3');
		expect([...held.folds]).toEqual(['kept']);
	});

	it('a family that is folded already by the owner is not taken for an automatic fold', () => {
		const st = focused(EDMUND);
		st.folds = new Set([THEA_KEY]);
		const { stateChanges } = planRender(phone('07', st));
		expect([...stateChanges.block.autoFolds!].sort()).toEqual([BLANCHE_KEY, NERYS_KEY].sort());
		apply(st, stateChanges);
		st.focus = { id: null };
		apply(st, planRender(phone('07', st)).stateChanges);
		expect([...st.folds]).toEqual([THEA_KEY]);
	});

	it('a view that is not the phone held upright, or cannot fold, or shows the whole tree, starts nothing', () => {
		const down = planRender(phone('07', focused(EDMUND), { orientation: 'down' }));
		expect(down.stateChanges.block.folds).toBeUndefined();
		expect(family(down.plan).foldPlan.foldedList).toEqual([]);
		// A static preview in a note on a computer folds (canFold), but its direction is down.
		const embed = planRender(phone('07', focused(EDMUND), { full: null, coarse: false, phone: false, orientation: 'down' }));
		expect(embed.stateChanges.block.autoFolds).toBeUndefined();
		// Clear focus chose the whole tree (a phone would else open a tree of more than 100 people on its start person, D20).
		const none = newBlockState();
		none.focus = { id: null };
		const whole = planRender(phone('07', none));
		expect(whole.stateChanges.block.folds).toBeUndefined();
	});

	it('planRender changes none of its inputs and gives an equal answer twice', () => {
		const st = focused(EDMUND);
		const inputs = phone('07', st);
		const before = JSON.stringify([[...st.folds], st.focus, st.autoFolds, st.autoFor]);
		const a = planRender(inputs);
		const b = planRender(inputs);
		expect(JSON.stringify([[...st.folds], st.focus, st.autoFolds, st.autoFor])).toBe(before);
		expect(st.folds.size).toBe(0);
		expect(a.stateChanges).toEqual(b.stateChanges);
		expect(family(a.plan).foldPlan).toEqual(family(b.plan).foldPlan);
	});

	it('a person that a flow asked for under an automatic fold opens that fold, and it is no automatic fold any more', () => {
		const st = focused(EDMUND);
		apply(st, planRender(phone('07', st)).stateChanges);
		// Varian's descendants sit under the "+ 12": a flow asks for one of them.
		const g = focusGraph(parsedOf('07').tree, EDMUND);
		const hiddenByThea = [...foldHidden(g, new Set([THEA_KEY]))][0];
		const { plan, stateChanges } = planRender(phone('07', st, { full: { focus: null, target: hiddenByThea } }));
		expect(family(plan).foldPlan.foldedList).not.toContain(THEA_KEY);
		expect(stateChanges.block.autoFolds?.has(THEA_KEY)).toBe(false);
	});
});

describe('the pure steps of the automatic folds', () => {
	it('stillAuto keeps the keys that are folded, and returns the same set when all are', () => {
		const auto = new Set(['a', 'b']);
		expect(stillAuto(new Set(['a', 'b', 'c']), auto)).toBe(auto);
		expect([...stillAuto(new Set(['a']), auto)!]).toEqual(['a']);
		expect(stillAuto(new Set(['a']), undefined)).toBeUndefined();
	});

	it('keep changes nothing; clear with nothing automatic changes nothing; enter runs startKeys only for a new focus', () => {
		let ran = 0;
		const enter = { kind: 'enter' as const, key: 'f', startKeys: () => (ran++, ['x']) };
		expect(autoFoldPatch(new Set(['u']), undefined, undefined, { kind: 'keep' })).toEqual({});
		expect(autoFoldPatch(new Set(['u']), undefined, undefined, { kind: 'clear' })).toEqual({});
		expect(autoFoldPatch(new Set(['u', 'x']), new Set(['x']), 'f', enter)).toEqual({});
		expect(ran).toBe(0);
		const patch = autoFoldPatch(new Set(['u']), undefined, 'g', enter);
		expect([...patch.folds!].sort()).toEqual(['u', 'x']);
		expect([...patch.autoFolds!]).toEqual(['x']);
		expect(patch.autoFor).toBe('f');
		expect(ran).toBe(1);
	});
});

describe('the first view makes the names smaller until a "+ N" sign is whole', () => {
	const box = (x: number, y = 0, w = 100): Rect => ({ x, y, w, h: 40 });
	const phone390 = { w: 390, h: 844 };

	it('a sign past the right edge shrinks the names, never under 11 px', () => {
		const me = box(0);
		const plain = sidewaysView(phone390, 16, { me, partners: [], children: [{ card: box(130), partners: [] }], parents: [] }, 91, 754, box(0));
		expect(plain.view.scale * 16).toBeCloseTo(14, 5);
		// The sign ends 292 layout px from the person's left edge: 374 px of room gives names of 374 / 292 * 16 px = 20 px, so no change.
		const near = sidewaysView(phone390, 16, { me, partners: [], children: [{ card: box(130), partners: [], sign: 230 }], parents: [] }, 91, 754, box(0));
		expect(near.view.scale * 16).toBeCloseTo(14, 5);
		// A sign that ends 400 layout px from the left edge needs 374 / 400 * 16 = 14.96 px: no change either; at 460 px it needs 13.0 px.
		const wide = sidewaysView(phone390, 16, { me, partners: [], children: [{ card: box(130), partners: [], sign: 460 }], parents: [] }, 91, 754, box(0));
		expect(wide.view.scale * 16).toBeCloseTo((374 / 460) * 16, 3);
		// The right edge of the sign is then at the right margin (8 px) of the screen.
		const right = 195 + (460 - wide.view.cx) * wide.view.scale;
		expect(right).toBeLessThanOrEqual(390 - 8 + 0.01);
		// A sign that would need names under 11 px does not count: the cards alone decide (here they fit at 14 px).
		const far = sidewaysView(phone390, 16, { me, partners: [], children: [{ card: box(130), partners: [], sign: 900 }], parents: [] }, 91, 754, box(0));
		expect(far.view.scale * 16).toBeCloseTo(14, 5);
	});

	it('signRights gives the farthest right edge of a folded sign for each parent, and nothing for an open family', () => {
		const rights = signRights(
			[
				{ key: 'k1', parents: ['a', 'b'], folded: true, count: 12, spot: { x: 100, y: 10 } },
				{ key: 'k2', parents: ['a'], folded: false, count: 0, spot: { x: 50, y: 10 } },
			],
			16,
		);
		expect([...rights.keys()].sort()).toEqual(['a', 'b']);
		expect(rights.get('a')).toBeGreaterThan(100);
		expect(rights.get('a')).toBe(rights.get('b'));
		expect(signRights(undefined, 16).size).toBe(0);
	});

	it('Edmund Valmont on an upright phone (390 pt): both daughters whole in the first screen, the signs whole, names about 12.5 px', () => {
		const st = focused(EDMUND);
		const t = planRender(phone('07', st)).plan as TreePlan;
		const { laid } = measuredLayout(t.g, t.geo, t.laidBase, { fonts: { text: FONTS.text, ui: FONTS.ui, bold: FONTS.bold }, measure: approxMeasure, showDates: true, showPortraits: false });
		const first = (withSigns: boolean) => viewOf(t.g, laid, EDMUND, withSigns);
		const today = first(false);
		const built = first(true);
		const P = laid.layout.persons;
		const kids = partnersAndChildren(t.g, EDMUND).children.filter((c) => (t.g.placementParents.get(c) ?? []).includes(EDMUND) && P.has(c)).map((c) => P.get(c)! as Rect);
		expect(kids.length).toBe(2);
		const out = (v: typeof built.view) => outsideBox(v, { w: 390, h: 844 }, kids, 91, 754);
		expect(out(built.view)).toEqual({ up: 0, down: 0 });
		const px = built.view.scale * 16;
		expect(px).toBeGreaterThanOrEqual(11);
		expect(px).toBeCloseTo(12.5, 0);
		expect(px).toBeLessThan(today.view.scale * 16);
		// The sign of Thea's family is whole: its right edge is inside the screen with the side margin.
		const rights = signRights(laid.layout.folds, laid.layout.geometry.fontPx);
		const thea = rights.get('thea-valmont')!;
		expect(195 + (thea - built.view.cx) * built.view.scale).toBeLessThanOrEqual(390 - 8 + 0.01);
		// Today's first view cuts it.
		expect(195 + (thea - today.view.cx) * today.view.scale).toBeGreaterThan(390);
	});
});

/** The first view of `focus` as `TreeView.sidewaysFirst` makes it on a phone of 390 x 844 pt, with the insets of the 0.3.1 proof (top 91, bottom bar from 754). `withSigns` false is the view before D257. */
function viewOf(g: FamilyGraph, laid: LaidOut, focus: string, withSigns: boolean) {
	const P = laid.layout.persons;
	const boxes = (ids: string[]) => ids.flatMap((i) => (P.get(i) ? [P.get(i)! as Rect] : []));
	const near = (who: string, partners: string[]) => partners.filter((p) => !(laid.layout.farTags.get(who)?.spouses ?? []).includes(p));
	const fam = partnersAndChildren(g, focus);
	const signs = signRights(laid.layout.folds, laid.layout.geometry.fontPx);
	const kids = fam.children.filter((c) => (g.placementParents.get(c) ?? []).includes(focus) && P.has(c));
	return sidewaysView(
		{ w: 390, h: 844 },
		laid.layout.geometry.fontPx,
		{
			me: P.get(focus)! as Rect,
			partners: boxes(near(focus, fam.partners)),
			children: kids.flatMap((c) => boxes([c]).map((card) => ({ card, partners: boxes(near(c, partnersAndChildren(g, c).partners)), ...(withSigns ? { sign: signs.get(c) } : {}) }))),
			parents: boxes(g.placementParents.get(focus) ?? []),
		},
		91,
		754,
		{ x: 0, y: 0, w: 0, h: 0 },
	);
}
