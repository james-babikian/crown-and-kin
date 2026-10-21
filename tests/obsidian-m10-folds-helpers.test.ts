import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { foldFamilies } from '../src/core/folds';
import { parseDynasty } from '../src/core/parse';
import { cutBack, planFolds, withFolds } from '../src/view/fold-view';
import { fixtureNote, topLevelBlocks } from './acceptance/load';

/*
 * WP 10.3c: the pure helpers of the tree view for folds (`src/view/fold-view.ts`): the plan of one
 * draw (F1), the layout settings that carry it, and the cut back of a fold's tap area (F7).
 */

const graph = () => {
	const r = parseDynasty(topLevelBlocks(fixtureNote('15'))[0]);
	if (!r.ok) throw new Error('fixture 15 does not parse');
	return deriveFamilies(r.tree);
};

const key = (g: ReturnType<typeof graph>, ...parents: string[]) => foldFamilies(g).find((f) => [...f.parents].sort().join() === parents.sort().join())!.key;

describe('planFolds (F1)', () => {
	it('a view that cannot fold has an empty plan, whatever the folds are', () => {
		const g = graph();
		const plan = planFolds(g, g, new Set([key(g, 'osric', 'mathilde')]), false, null);
		expect(plan.hidden.size).toBe(0);
		expect(plan.foldedList).toEqual([]);
	});

	it('the effective folds hide the people of the fold; the lists are sorted', () => {
		const g = graph();
		const a = key(g, 'osric', 'mathilde');
		const plan = planFolds(g, g, new Set([a]), true, null);
		expect(plan.hidden.size).toBe(75);
		expect(plan.hiddenList).toEqual([...plan.hiddenList].sort());
		expect(plan.foldedList).toEqual([a]);
	});

	it('while the finder shows a line, the folds that hide its people are left out (the block keeps them)', () => {
		const g = graph();
		const folds = new Set([key(g, 'osric', 'mathilde'), key(g, 'agnes', 'ulric')]);
		const plan = planFolds(g, g, folds, true, ['lucan']);
		// Lucan is below B (Agnes and Ulric) and below the cousin family; A does not hide him alone.
		expect(plan.effective.has(key(g, 'agnes', 'ulric'))).toBe(false);
		expect(plan.hidden.has('lucan')).toBe(false);
		expect(folds.size).toBe(2);
	});

	it('a folded key whose family is not in the drawn graph stays out of the layout list', () => {
		const g = graph();
		const plan = planFolds(g, g, new Set(['["no","such"]']), true, null);
		expect(plan.foldedList).toEqual([]);
		expect(plan.hidden.size).toBe(0);
	});
});

describe('withFolds', () => {
	it('adds the lists that are not empty and foldControls where the view can fold; a plain tree has the old key', () => {
		const g = graph();
		const none = planFolds(g, g, new Set(), true, null);
		expect(withFolds({ sweeps: 4 } as never, none, false)).toEqual({ sweeps: 4 });
		expect(withFolds({ sweeps: 4 } as never, none, true)).toEqual({ sweeps: 4, foldControls: true });
		const one = planFolds(g, g, new Set([key(g, 'osric', 'mathilde')]), true, null);
		const out = withFolds({ sweeps: 4, foldHidden: ['old'] } as never, one, true);
		expect(out.foldHidden).toEqual(one.hiddenList);
		expect(out.foldedFamilies).toEqual(one.foldedList);
		expect(out.foldControls).toBe(true);
	});
});

describe('cutBack (F7)', () => {
	const visible = { x: 90, y: 90, w: 20, h: 20 };
	const box = { x: 78, y: 78, w: 44, h: 44 };

	it('no other tap area: the box stays', () => {
		expect(cutBack(box, visible, [])).toEqual(box);
		expect(cutBack(box, visible, [{ x: 300, y: 300, w: 10, h: 10 }])).toEqual(box);
	});

	it('a tap area on one side cuts the box on that side, with the largest part kept, and the visible mark stays inside', () => {
		const below = { x: 60, y: 112, w: 80, h: 30 };
		const out = cutBack(box, visible, [below]);
		expect(out).toEqual({ x: 78, y: 78, w: 44, h: 34 });
		expect(out.y + out.h).toBeLessThanOrEqual(below.y);
		expect(out.y + out.h).toBeGreaterThanOrEqual(visible.y + visible.h);
		const right = cutBack(box, visible, [{ x: 112, y: 70, w: 30, h: 60 }]);
		expect(right).toEqual({ x: 78, y: 78, w: 34, h: 44 });
	});

	it('a tap area that covers the visible mark cannot cut the box below the mark: the box stays', () => {
		expect(cutBack(box, visible, [{ x: 85, y: 85, w: 30, h: 30 }])).toEqual(box);
	});

	it('two neighbours cut two sides', () => {
		const out = cutBack(box, visible, [
			{ x: 112, y: 70, w: 30, h: 60 },
			{ x: 70, y: 112, w: 60, h: 30 },
		]);
		expect(out).toEqual({ x: 78, y: 78, w: 34, h: 34 });
	});
});
