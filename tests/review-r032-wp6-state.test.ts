import { describe, expect, it } from 'vitest';

import { parseDynasty } from '../src/core/parse';
import { approxMeasure } from '../src/render/svg-string';
import { carryState, newBlockState, type BlockState } from '../src/view/block-state';
import { measuredLayout } from '../src/view/measured-layout';
import { planRender, type RenderInputs, type StateChanges, type TreePlan } from '../src/view/render-plan';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { allFixtures } from './acceptance/load';

// G2 review of WP-6 (D257): faults found in the state steps of the automatic folds.

const FONTS = { px: 16, text: 'Segoe UI, Helvetica, Arial, sans-serif', ui: 'Segoe UI, Helvetica, Arial, sans-serif', bold: '600' };
const sample = (id: string) => allFixtures().find((f) => f.id === id)!.source;

function inputs(st: BlockState, over: Partial<RenderInputs> = {}): RenderInputs {
	return {
		parsed: parseDynasty(sample('07')),
		settings: DEFAULT_SETTINGS,
		state: st,
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
const apply = (st: BlockState, c: StateChanges) => Object.assign(st, c.block);

describe('review WP-6: the automatic folds of a focus', () => {
	it('R1: the phone on its side (tree top to bottom) does not keep the automatic folds of an old focus when the focus changes', () => {
		const st = newBlockState();
		st.focus = { id: 'edmund-valmont' };
		apply(st, planRender(inputs(st)).stateChanges);
		expect(st.autoFolds?.size).toBe(3);
		// The owner turns the phone and taps a child of Edmund: a new focus, drawn top to bottom.
		st.focus = { id: 'blanche-valmont-2' };
		const down = planRender(inputs(st, { orientation: 'down' }));
		apply(st, down.stateChanges);
		const plan = down.plan as TreePlan;
		// Nothing folds in the down direction (D257), and never a family of the focus person: Blanche and Wystan Harrow.
		expect(plan.foldPlan.foldedList).toEqual([]);
		expect(plan.foldPlan.hidden.size).toBe(0);
	});

	it('R2: carryState keeps the automatic-fold memory that the new state already holds', () => {
		const to = newBlockState();
		to.autoFor = 'focus:edmund-valmont:3';
		to.autoFolds = new Set();
		const from = newBlockState();
		carryState(from, to);
		// A field that the new state already holds stays (the rule of carryState); the owner opened every automatic fold, so a loss here folds them again.
		expect(to.autoFor).toBe('focus:edmund-valmont:3');
	});

	it('R3: the counts of the signs of one focus view add up to the people the folds remove', () => {
		const st = newBlockState();
		st.focus = { id: 'juliana-veyle' };
		// Two of the folded families hide the same person, so two signs count that person.
		const plan = planRender(inputs(st)).plan as TreePlan;
		const { laid } = measuredLayout(plan.g, plan.geo, plan.laidBase, { fonts: { text: FONTS.text, ui: FONTS.ui, bold: FONTS.bold }, measure: approxMeasure, showDates: true, showPortraits: false });
		const shown = (laid.layout.folds ?? []).filter((c) => c.folded).reduce((a, c) => a + c.count, 0);
		const gone = plan.g.people.length - laid.layout.persons.size;
		expect(shown).toBe(gone);
	});
});
