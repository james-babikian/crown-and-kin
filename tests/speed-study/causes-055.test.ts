import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { relationLookup } from '../../src/core/relations';
import { cardLabels, needsLabels } from '../../src/core/titles';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_FAR_RULE, clearLayoutCache } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { fitCardText } from '../../src/render/date-fit';
import { buildScene } from '../../src/render/dom/scene';
import { tagNameRoom } from '../../src/render/styles';
import { approxMeasure } from '../../src/render/svg-string';
import { farTagName } from '../../src/render/tree-info';
import { READABLE_NAME_PX, boxNearView } from '../../src/render/view-math';
import { newBlockState } from '../../src/view/block-state';
import { FIRST_LIMIT, PHONE_WHOLE_LIMIT } from '../../src/view/large-tree';
import { measuredLayout } from '../../src/view/measured-layout';
import { planRender, type RenderInputs } from '../../src/view/render-plan';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { FEl } from '../acceptance/fake-dom';
import { fixtureSource } from '../acceptance/load';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Part 12 of the 0.5.5 speed study (spec §0 D350): proof tests of the causes in an internal study. They pin what the
 * code does today; none of them asks for a change. The timings are in an internal script (node) and the harness logs.
 */

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'sans-serif', ui: 'sans-serif', bold: '600' };

/** A tree of `n` people in one row: the count is what the size gate reads. */
const flat = (n: number): string => `people:\n${Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}}`).join('\n')}\n`;

/** The inputs of a render in the phone's full-screen view after Clear focus (the session focus is "all people"). */
function phoneWholeTree(text: string, tapped: boolean): RenderInputs {
	const state = newBlockState();
	state.focus = { id: null };
	if (tapped) state.largeTapped = true;
	return {
		parsed: parseDynasty(text),
		settings: DEFAULT_SETTINGS,
		state,
		coarse: true,
		phone: true,
		full: { focus: { id: null }, target: null },
		orientation: 'sideways',
		pendingTarget: null,
		stopChecked: true,
		stopped: () => false,
		fonts: () => ({ px: 16, ...FONTS }),
		clock: () => 0,
	};
}

describe('the 2 000-person phone case shows the bar "Draw the tree", it does not block (spec §7.7, D226)', () => {
	it('a whole tree of 2 000 people in the phone full-screen view after Clear focus plans the bar with the button, not a tree', () => {
		const { plan } = planRender(phoneWholeTree(flat(2000), false));
		// The harness step waited 60 s for a scene that was never planned and wrote "the page was blocked".
		expect(plan).toMatchObject({ kind: 'bar', bar: { kind: 'ask', limit: FIRST_LIMIT }, barCount: 2000 });
	});

	it('after a tap on "Draw the tree" the same render draws the whole tree with the 15 s time budget', () => {
		const { plan } = planRender(phoneWholeTree(flat(2000), true));
		expect(plan).toMatchObject({ kind: 'tree', budget: true, sub: null });
		expect(2000).toBeLessThanOrEqual(PHONE_WHOLE_LIMIT);
	});

	it('1 000 people is under the first limit, so the phone draws it at once (the 2.7 s case of Part 5)', () => {
		expect(planRender(phoneWholeTree(flat(1000), false)).plan.kind).toBe('tree');
	});
});

describe('the cards near the first view need few of the relation words of a whole tree (sample tree 7)', () => {
	const parsed = parseDynasty(fixtureSource('07'));
	if (!parsed.ok) throw new Error('sample tree 7 does not parse');
	const whole = deriveFamilies(parsed.tree, { warnManyParents: false });
	// Sample tree 7 has no mark: the person in the middle of the list (the PERF_MARK convention of the perf steps).
	const me = whole.people[Math.floor(whole.people.length / 2)].id;

	it('the words of the cards near the first view are the same when only they are asked for (the lookup works out each person alone)', () => {
		clearLayoutCache();
		const geo = cardForm(geometryFor(16), 'down');
		const base: LayoutSettings = { sweeps: 4, far: DEFAULT_FAR_RULE, relationLine: true, foldControls: true };
		const laid = measuredLayout(whole, geo, base, { fonts: FONTS, measure: approxMeasure, labels: needsLabels(whole) ? cardLabels(whole) : undefined, showDates: true, showPortraits: true, marked: me }).laid;
		const scale = READABLE_NAME_PX / laid.layout.geometry.fontPx;
		const start = laid.layout.persons.get(me)!;
		const view = { x: start.x + start.w / 2 - 1280 / scale / 2, y: start.y - 24, w: 1280 / scale, h: 800 / scale };
		const near = [...laid.layout.persons.values()].filter((b) => boxNearView(b, view)).map((b) => b.id);
		expect(near.length).toBeGreaterThan(0);
		expect(near.length).toBeLessThan(laid.layout.persons.size);
		const all = relationLookup(whole, me).getMany(laid.layout.persons.keys());
		const few = relationLookup(whole, me).getMany(near);
		for (const id of near) expect(few.get(id)?.[0]?.lower).toBe(all.get(id)?.[0]?.lower);
	});
});

describe('the Compact tag of D345 1 A draws more name text than before (sample tree 7)', () => {
	/** The characters of the Compact tag names and the count of names cut, for a Compact text of `em` in a pill of `pillEm`. */
	function compactText(dir: 'down' | 'sideways', em: number, pillEm: number, labelled: boolean): { chars: number; cut: number; tags: number } {
		const parsed = parseDynasty(fixtureSource('07'));
		if (!parsed.ok) throw new Error('sample tree 7 does not parse');
		const g = deriveFamilies(parsed.tree, { warnManyParents: false });
		const labels = needsLabels(g) ? cardLabels(g) : undefined;
		clearLayoutCache();
		const base: LayoutSettings = { sweeps: 4, far: DEFAULT_FAR_RULE, ...(dir === 'sideways' ? { orientation: 'sideways' as const } : {}) };
		const laid = measuredLayout(g, cardForm(geometryFor(16), dir), base, { fonts: FONTS, measure: approxMeasure, labels, showDates: true, showPortraits: true }).laid;
		const f = laid.layout.geometry.fontPx;
		const font = `400 ${em * f}px sans-serif`;
		const m = (s: string) => approxMeasure(s, font);
		let chars = 0;
		let cut = 0;
		for (const tag of laid.layout.farTags.values()) {
			const name = farTagName(g, tag.spouses, labelled ? labels : undefined);
			const shown = fitCardText(name, undefined, tagNameRoom(tag.zoneW ?? tag.hit.w, (pillEm * f) / 2, m('⚭ '), 0), m, false);
			chars += [...shown].length;
			if (shown !== name) cut++;
		}
		return { chars, cut, tags: laid.layout.farTags.size };
	}

	it('sideways (the phone): the old Compact text (1.5 em in a 2 em pill) against D345 1 A (1 em in a 1.5 em pill)', () => {
		const before = compactText('sideways', 1.5, 2, false);
		const after = compactText('sideways', 1, 1.5, true);
		expect(after.tags).toBe(before.tags);
		// About 1.5 times the glyphs at the Compact level: every name was cut before, almost none is now.
		expect(after.chars).toBeGreaterThan(before.chars * 1.3);
		expect(after.cut).toBeLessThan(before.cut);
	});
});

describe('the picture slots of sample tree 07b add elements to the scene', () => {
	/** The count of elements of an eager scene of `text` (the lazy scene builds the same content, detached). */
	function elements(text: string): number {
		const parsed = parseDynasty(text);
		if (!parsed.ok) throw new Error('does not parse');
		const g = deriveFamilies(parsed.tree, { warnManyParents: false });
		clearLayoutCache();
		const labels = needsLabels(g) ? cardLabels(g) : undefined;
		const laid = measuredLayout(g, cardForm(geometryFor(16), 'down'), { sweeps: 4, far: DEFAULT_FAR_RULE }, { fonts: FONTS, measure: approxMeasure, labels, showDates: true, showPortraits: true }).laid;
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: FONTS, measure: approxMeasure, link: () => null, ...(labels ? { labels } : {}) });
		const all = (el: FEl): number => 1 + el.children.reduce((n, c) => n + all(c), 0);
		return all(root);
	}

	it('07b with arms and portraits has more scene elements than the same tree without them', () => {
		const withPictures = fixtureSource('07b');
		const without = withPictures.replace(/^\s*(arms|portrait|portraitCrop|crop): .*\n/gm, '').replace(/, (arms|portrait): "[^"]*"/g, '');
		expect(without).not.toMatch(/portrait:|arms:/);
		const a = elements(withPictures);
		const b = elements(without);
		expect(a).toBeGreaterThan(b);
		// The number goes to the report: `npx vitest run tests/speed-study/causes-055.test.ts` prints it.
		console.log(`scene elements: 07b ${a}, without pictures ${b}, +${a - b}`);
	});
});
