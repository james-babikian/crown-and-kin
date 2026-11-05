import { describe, expect, it, vi } from 'vitest';

import { deriveFamilies } from '../../src/core/derive';
import { foldFamilies } from '../../src/core/folds';
import { parseDynasty } from '../../src/core/parse';
import { newBlockState, type BlockState } from '../../src/view/block-state';
import { FIRST_LIMIT, PHONE_WHOLE_LIMIT, SECOND_LIMIT } from '../../src/view/large-tree';
import { planRender, type RenderInputs, type RenderPlan, type TreePlan } from '../../src/view/render-plan';
import { DEFAULT_SETTINGS } from '../../src/view/settings';

// WP-1d (b): `planRender` decides a render with no DOM. These tests call it on plain data: a small tree, the size gates, a focus, a folded family, the
// phone list, a stopped draw, and the rule that it changes none of its inputs.

const FONTS = { px: 16, text: 'sans-serif', ui: 'sans-serif', bold: '600' };

/** Five people in three generations: a and b are the parents of c and d; c is the parent of e. */
const FAMILY = `people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c, name: C, parents: [a, b]}
  - {id: d, name: D, parents: [a, b]}
  - {id: e, name: E, parents: [c]}
`;

/** A tree of `n` people in one row: the count is what matters for the gates. */
const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

/** Inputs for a computer: an embed in a note, a fine pointer, nothing remembered for the block. */
function inputs(text: string, over: Partial<RenderInputs> = {}): RenderInputs {
	return {
		parsed: parseDynasty(text),
		settings: DEFAULT_SETTINGS,
		state: newBlockState(),
		coarse: false,
		phone: false,
		full: null,
		orientation: 'down',
		pendingTarget: null,
		stopChecked: false,
		stopped: () => false,
		fonts: () => FONTS,
		clock: () => 0,
		...over,
	};
}

function treeOf(plan: RenderPlan): TreePlan {
	expect(plan.kind).toBe('tree');
	return plan as TreePlan;
}

/** The fold key of the family of a and b. */
function familyKey(): string {
	const parsed = parseDynasty(FAMILY);
	if (!parsed.ok) throw new Error('sample does not parse');
	return foldFamilies(deriveFamilies(parsed.tree))[0].key;
}

describe('planRender: the tree kinds', () => {
	it('a small tree: the whole tree, no focus, no bar, the time budget on', () => {
		const { plan, stateChanges } = planRender(inputs(FAMILY));
		const t = treeOf(plan);
		expect(t.g).toBe(t.whole);
		expect(t.sub).toBeNull();
		expect(t.focusId).toBeNull();
		expect(t.count).toBe(5);
		expect(t.budget).toBe(true);
		expect(t.relationsFor).toBeNull();
		expect(t.canFold).toBe(true);
		expect(t.onStop).toEqual({ kind: 'slow', limit: 0 });
		expect(t.laidBase).toMatchObject({ sweeps: 4, foldControls: true });
		expect(t.familyKey).toBe('');
		expect(t.drawnKey).toBe('');
		// The focus rules ran and chose the whole tree, so the block remembers an automatic focus of none.
		expect(stateChanges).toMatchObject({ block: { autoFocus: null, autoMark: null }, stopChecked: true, sessionChanged: false });
	});

	it('the clock is read once, after the derive', () => {
		const clock = vi.fn(() => 42);
		const { plan } = planRender(inputs(FAMILY, { clock }));
		expect(clock).toHaveBeenCalledTimes(1);
		expect((plan as TreePlan).t1).toBe(42);
	});

	it('a marked person gives the relation lookup and, with the setting on, the plate in the layout', () => {
		const text = `options:\n  me: c\n${FAMILY}`;
		const on = treeOf(planRender(inputs(text)).plan);
		expect(on.relationsFor).toBe('c');
		expect(on.laidBase.relationLine).toBe(true);
		const off = treeOf(planRender(inputs(text, { settings: { ...DEFAULT_SETTINGS, showRelations: false } })).plan);
		expect(off.relationsFor).toBe('c');
		expect(off.laidBase.relationLine).toBeUndefined();
		expect(off.laidBase.youTab).toBe('c');
	});

	it('a tree that does not parse gives an error; the full-screen view closes instead', () => {
		const bad = inputs('people: [');
		expect(planRender(bad).plan.kind).toBe('error');
		expect(planRender({ ...bad, full: { focus: null, target: null } }).plan.kind).toBe('invalid-full');
	});

	it('a block with no people gives the empty kind', () => {
		const { plan } = planRender(inputs('people: []\n'));
		expect(plan.kind).toBe('empty');
	});

	it('the phone list case: a tree in a note on a phone is a list, and no fonts are read', () => {
		const fonts = vi.fn(() => FONTS);
		const { plan, stateChanges } = planRender(inputs(FAMILY, { coarse: true, phone: true, fonts }));
		expect(plan.kind).toBe('list');
		expect(fonts).not.toHaveBeenCalled();
		expect(stateChanges).toEqual({ block: {}, sessionChanged: false });
		// The full-screen view of a phone draws a tree.
		expect(planRender(inputs(FAMILY, { coarse: true, phone: true, full: { focus: null, target: null } })).plan.kind).toBe('tree');
	});
});

describe('planRender: the size gates (spec §7.7)', () => {
	it('a large tree over the first limit shows the bar with the button; a tap on it draws the tree', () => {
		const { plan } = planRender(inputs(flat(FIRST_LIMIT + 1)));
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'ask', limit: FIRST_LIMIT }, barCount: FIRST_LIMIT + 1, count: FIRST_LIMIT + 1 });
		const tapped = newBlockState();
		tapped.largeTapped = true;
		expect(planRender(inputs(flat(FIRST_LIMIT + 1), { state: tapped })).plan.kind).toBe('tree');
	});

	it('a tree at the first limit draws', () => {
		expect(planRender(inputs(flat(FIRST_LIMIT))).plan.kind).toBe('tree');
	});

	it('a tree over the second limit shows the bar with no button, also after a tap', () => {
		const tapped = newBlockState();
		tapped.largeTapped = true;
		const { plan } = planRender(inputs(flat(SECOND_LIMIT + 1), { state: tapped }));
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'top', limit: SECOND_LIMIT } });
	});

	it('the full-screen view of a phone has the lower top', () => {
		const { plan } = planRender(inputs(flat(PHONE_WHOLE_LIMIT + 1), { coarse: true, phone: true, full: { focus: { id: null }, target: null } }));
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'top', limit: PHONE_WHOLE_LIMIT } });
	});

	it('a focus family that passes the top shows the bar for the family', () => {
		const people = Array.from({ length: SECOND_LIMIT + 2 }, (_, i) => `  - {id: p${i}, name: P${i}${i > 0 ? `, parents: [p0]` : ''}}`).join('\n');
		const text = `options:\n  focus: p0\n  generations: 2\npeople:\n${people}\n`;
		const { plan } = planRender(inputs(text));
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'top', limit: SECOND_LIMIT, family: true }, barCount: SECOND_LIMIT + 2, count: SECOND_LIMIT + 2 });
	});

	it('a stopped draw: the bar with no button comes at once, and a whole tree has the time budget', () => {
		const stopped = vi.fn(() => true);
		const { plan } = planRender(inputs(flat(10), { stopped }));
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'slow', limit: 0 }, barCount: 10 });
		expect(stopped).toHaveBeenCalledWith(10);
		expect(treeOf(planRender(inputs(flat(10))).plan).budget).toBe(true);
	});

	it('a focus family has no time budget', () => {
		const t = treeOf(planRender(inputs(`options:\n  focus: c\n${FAMILY}`)).plan);
		expect(t.budget).toBe(false);
	});
});

describe('planRender: the focus', () => {
	it('a pin draws the focus family; the plan carries the keys of the saved view', () => {
		const t = treeOf(planRender(inputs(`options:\n  focus: c\n  generations: 0\n${FAMILY}`)).plan);
		expect(t.focusId).toBe('c');
		expect(t.focus).toBe('c');
		expect(t.sub).not.toBeNull();
		expect(t.g).not.toBe(t.whole);
		expect(t.g.people.map((p) => p.id)).not.toContain('e');
		expect(t.sub!.hidden.get('c')).toBe(3);
		expect(t.familyKey).toBe('focus:c:0');
		expect(t.drawnKey).toBe('focus:c:0');
	});

	it('the direction is in the drawn key, not in the family key', () => {
		const t = treeOf(planRender(inputs(`options:\n  focus: c\n${FAMILY}`, { orientation: 'sideways' })).plan);
		expect(t.drawnKey).toBe('sideways|focus:c:3');
		expect(t.familyKey).toBe('focus:c:3');
		expect(t.laidBase.orientation).toBe('sideways');
	});

	it('a session focus wins over the pin; one that names nobody ends', () => {
		const st = newBlockState();
		st.focus = { id: 'd' };
		expect(treeOf(planRender(inputs(`options:\n  focus: c\n${FAMILY}`, { state: st })).plan).focusId).toBe('d');
		const gone = newBlockState();
		gone.focus = { id: 'nobody' };
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: gone }));
		expect(treeOf(plan).focusId).toBeNull();
		expect(stateChanges.block.focus).toBeNull();
	});

	it('the own focus of a full-screen view skips the focus rules (the block is not asked, stopChecked stays)', () => {
		const { plan, stateChanges } = planRender(inputs(FAMILY, { full: { focus: { id: 'c' }, target: null } }));
		expect(treeOf(plan).focusId).toBe('c');
		expect(stateChanges.stopChecked).toBeUndefined();
		expect(stateChanges.block).toEqual({});
	});

	it('a person that the full-screen view must show but the family does not draw makes it show all people', () => {
		const { plan, stateChanges } = planRender(inputs(`options:\n  focus: c\n  generations: 0\n${FAMILY}`, { full: { focus: null, target: 'e' } }));
		expect(treeOf(plan).sub).toBeNull();
		expect(stateChanges.fullFocus).toEqual({ id: null });
	});

	it('a person just saved whom the family does not draw: the session shows all people, and the person is shown next', () => {
		const st = newBlockState();
		st.shown = { id: 'e', place: 'embed' };
		const { plan, stateChanges } = planRender(inputs(`options:\n  focus: c\n  generations: 0\n${FAMILY}`, { state: st }));
		expect(treeOf(plan).sub).toBeNull();
		expect(stateChanges).toMatchObject({ block: { shown: null, focus: { id: null } }, pendingTarget: ['e'], sessionChanged: true });
		// A saved person of the other kind of view stays for that view.
		const other = newBlockState();
		other.shown = { id: 'e', place: 'full' };
		expect(planRender(inputs(`options:\n  focus: c\n  generations: 0\n${FAMILY}`, { state: other })).stateChanges.block.shown).toBeUndefined();
	});
});

describe('planRender: the folds', () => {
	it('a folded family hides its children, and the layout settings carry it', () => {
		const st = newBlockState();
		st.folds = new Set([familyKey()]);
		const t = treeOf(planRender(inputs(FAMILY, { state: st })).plan);
		expect([...t.foldPlan.hidden].sort()).toEqual(['c', 'd', 'e']);
		expect(t.laidBase.foldHidden).toEqual(['c', 'd', 'e']);
		expect(t.laidBase.foldedFamilies).toEqual([familyKey()]);
	});

	it('the static phone preview never applies a fold', () => {
		const st = newBlockState();
		st.folds = new Set([familyKey()]);
		const t = treeOf(planRender(inputs(FAMILY, { state: st, coarse: true, phone: false })).plan);
		expect(t.canFold).toBe(false);
		expect(t.foldPlan.hidden.size).toBe(0);
	});

	it('a fold whose family is gone ends; the others stay', () => {
		const st = newBlockState();
		st.folds = new Set([familyKey(), 'no such family']);
		const { stateChanges } = planRender(inputs(FAMILY, { state: st }));
		expect(stateChanges.block.folds).toEqual(new Set([familyKey()]));
		const clean = newBlockState();
		clean.folds = new Set([familyKey()]);
		expect(planRender(inputs(FAMILY, { state: clean })).stateChanges.block.folds).toBeUndefined();
	});

	it('a person that a flow asked for opens the fold that hides them', () => {
		const st = newBlockState();
		st.folds = new Set([familyKey()]);
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: st, pendingTarget: ['e'] }));
		expect(treeOf(plan).foldPlan.hidden.has('e')).toBe(false);
		expect(stateChanges.block.folds?.size).toBe(0);
	});
});

describe('planRender: the finder and the Show view', () => {
	it('the finder draws the small tree of its line; an index that is too large goes back to 0', () => {
		const st = newBlockState();
		st.finder = { first: 'c', second: 'd', index: 9, whole: false, steps: false };
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: st }));
		const t = treeOf(plan);
		expect(t.finder?.state).toBe(st.finder);
		expect(t.finder?.line).not.toBeNull();
		expect(t.sub).toBeNull();
		expect(t.g).not.toBe(t.whole);
		expect(t.budget).toBe(false);
		expect(t.familyKey).toBe('finder:c>d:0:line|');
		expect(stateChanges.finderIndex).toBe(0);
		// The planner leaves the block's own finder state as it was.
		expect(st.finder.index).toBe(9);
	});

	it('a result that names a person who is gone closes; the touch preview draws none', () => {
		const st = newBlockState();
		st.finder = { first: 'c', second: 'nobody', index: 0, whole: false, steps: false };
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: st }));
		expect(treeOf(plan).finder).toBeNull();
		expect(stateChanges.block.finder).toBeNull();
		const live = newBlockState();
		live.finder = { first: 'c', second: 'd', index: 0, whole: false, steps: false };
		expect(treeOf(planRender(inputs(FAMILY, { state: live, coarse: true })).plan).finder).toBeNull();
	});

	it('a person that the full-screen view must show but the line does not draw makes the result show in the whole tree', () => {
		const st = newBlockState();
		st.finder = { first: 'c', second: 'd', index: 0, whole: false, steps: false };
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: st, full: { focus: null, target: 'e' } }));
		expect(stateChanges.finderWhole).toBe(true);
		expect(treeOf(plan).g).toBe(treeOf(plan).whole);
		expect(treeOf(plan).familyKey).toBe('finder:c>d:0:whole|');
	});

	it('a Show view for a title that is gone ends', () => {
		const st = newBlockState();
		st.succession = { title: 'no such title' };
		const { plan, stateChanges } = planRender(inputs(FAMILY, { state: st }));
		expect(treeOf(plan).succession).toBeNull();
		expect(stateChanges.block.succession).toBeNull();
	});
});

/** Freezes a value and what it holds, so that a write to it throws (the tests run in strict mode). */
function deepFreeze<T>(v: T): T {
	if (v && typeof v === 'object' && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
	}
	return v;
}

/** A copy with every function replaced by a mark: each derive makes its own closures (the date readers), and two equal graphs differ only there. */
function plain(v: unknown, seen = new Map<object, unknown>()): unknown {
	if (typeof v === 'function') return '[function]';
	if (!v || typeof v !== 'object') return v;
	if (seen.has(v)) return seen.get(v);
	if (v instanceof Map) {
		const out = new Map();
		seen.set(v, out);
		for (const [k, x] of v) out.set(k, plain(x, seen));
		return out;
	}
	if (v instanceof Set) return new Set(v);
	const out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {};
	seen.set(v, out);
	for (const [k, x] of Object.entries(v)) (out as Record<string, unknown>)[k] = plain(x, seen);
	return out;
}

describe('planRender: it changes none of its inputs', () => {
	it.each([
		['a plain tree', FAMILY, (s: BlockState) => s],
		[
			'a pin, a stale fold, a finder and a saved person',
			`options:\n  focus: c\n  generations: 0\n${FAMILY}`,
			(s: BlockState) => {
				s.folds = new Set([familyKey(), 'gone']);
				s.finder = { first: 'c', second: 'd', index: 9, whole: false, steps: false };
				s.shown = { id: 'e', place: 'embed' };
				return s;
			},
		],
	])('%s: two calls give equal results', (_name, text, prepare) => {
		const state = deepFreeze(prepare(newBlockState()));
		const folds = new Set(state.folds);
		const before = JSON.stringify(state, (_k, v) => (v instanceof Set ? [...v] : v));
		const same = inputs(text, { state });
		const first = planRender(same);
		const second = planRender(same);
		expect(plain(second)).toEqual(plain(first));
		expect(JSON.stringify(state, (_k, v) => (v instanceof Set ? [...v] : v))).toBe(before);
		expect(state.folds).toEqual(folds);
	});

	it('the parsed tree and the graph are not changed either', () => {
		const parsed = parseDynasty(FAMILY);
		if (parsed.ok) deepFreeze(parsed.tree);
		const { plan } = planRender(inputs(FAMILY, { parsed }));
		expect(plan.kind).toBe('tree');
	});
});
