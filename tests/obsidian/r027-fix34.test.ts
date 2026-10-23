import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf } from '../../src/core/succession';
import { carryState, newBlockState } from '../../src/view/block-state';
import { closePluginModals } from '../../src/view/plugin-modals';
import { draftSpec, successionOf } from '../../src/view/titles-draft';
import { HEIR_LOOK } from '../../src/render/styles';
import { SETTINGS_UI, SHEET, SUCCESSION_UI as T } from '../../src/render/ui-text';
import { FEl, clock, device, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { choose, ctl, openWin, page } from '../support/r027-window-support';
import { click, type } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Version 0.2.7, fix round of WP3 and WP4 (rulings A, B, C, F, G, H, I): the unreadable value, the unreadable year, the
 * summary sentence of the line, `carryState`, the heir look and the new texts.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A made-up tree: one title `crown` with `extra` keys, ruler rex from 1100, three children. */
function mini(extra: string): string {
	return [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		...extra.split('\n').map((l) => `    ${l}`),
		'    holders:',
		'      - {person: rex, from: 1100}',
		'people:',
		'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
		'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
		'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
		'  - {id: late, name: Late Ardent, sex: m, born: 1150, parents: [rex]}',
		'',
	].join('\n');
}

const saveButton = (o: ReturnType<typeof openWin>) => o.content.querySelector('button[data-focus="save"]');
const optionTexts = (sel: FEl) => sel.querySelectorAll('option').map((x) => x.getText());

describe('A: a value that the plugin cannot read', () => {
	it('desktop: the dropdown has a first option "Unknown value (VALUE)" that stays chosen', () => {
		const o = openWin(mini('succession: salic'));
		const select = ctl(page(o, 'crown'), 'rule')!.querySelector('select')!;
		expect(select.value).toBe('?');
		expect(optionTexts(select)[0]).toBe('Unknown value (salic)');
		expect(optionTexts(select)).toHaveLength(1 + 1 + 5);
		expect(o.win.isDirty()).toBe(false);
	});

	it('desktop: choosing None removes the bad rule on Save, and the option goes', async () => {
		const o = openWin(mini('succession: salic'));
		const p = page(o, 'crown');
		choose(p, 'rule', '');
		expect(o.win.isDirty()).toBe(true);
		expect(optionTexts(ctl(p, 'rule')!.querySelector('select')!)[0]).toBe(T.ruleNone);
		await click(saveButton(o));
		expect(o.handle.body).not.toContain('succession:');
	});

	it('desktop: choosing another rule replaces the bad rule', async () => {
		const o = openWin(mini('succession: salic'));
		const p = page(o, 'crown');
		choose(p, 'rule', 'eldest-child');
		await click(saveButton(o));
		expect(o.handle.body).toContain('succession: eldest-child');
	});

	it('desktop: a list in the note shows its flow text', () => {
		const o = openWin(mini('succession: [eldest-child, 3]'));
		expect(optionTexts(ctl(page(o, 'crown'), 'rule')!.querySelector('select')!)[0]).toBe('Unknown value ([eldest-child, 3])');
	});

	it('desktop: "who can inherit", "the right comes from" and "illegitimate" have the option too', () => {
		const o = openWin(mini('succession: eldest-child\ninherit: foo\ninherit-through: bar\ninherit-illegitimate: baz'));
		const p = page(o, 'crown');
		for (const [key, text] of [['inherit', 'foo'], ['through', 'bar'], ['illegitimate', 'baz']] as const) {
			const select = ctl(p, key)!.querySelector('select')!;
			expect(select.value, key).toBe('?');
			expect(optionTexts(select)[0], key).toBe(`Unknown value (${text})`);
		}
	});

	it('the text without a value reads "Unknown value"', () => {
		expect(T.unknownValue(null)).toBe('Unknown value');
		expect(T.unknownValue('salic')).toBe('Unknown value (salic)');
	});

	it('phone: each bad value shows first in its own list, and a choice in the list calls pick (phone-rules-native)', async () => {
		device.width = 390;
		device.coarse = true;
		const o = openWin(mini('succession: eldest-child\ninherit: foo\ninherit-through: bar\ninherit-illegitimate: baz'));
		const p = page(o, 'crown');
		for (const [key, text] of [['inherit', 'foo'], ['through', 'bar'], ['illegitimate', 'baz']] as const) {
			const select = ctl(p, key)!.querySelector('select')!;
			expect(select.value, key).toBe('?');
			expect(optionTexts(select)[0], key).toBe(`Unknown value (${text})`);
		}
		choose(p, 'illegitimate', 'no');
		expect(o.win.isDirty()).toBe(true);
		await click(saveButton(o));
		expect(o.handle.body).not.toContain('baz');
	});
});

describe('B: a year that the plugin cannot read', () => {
	const bad = () => mini('succession: eldest-child\nyear: [1100, 1105]');

	it('the draft has no year and keeps the bad text apart, so draftSpec matches specOf', () => {
		const r = parseDynasty(bad());
		if (!r.ok) throw new Error('parse');
		const title = deriveFamilies(r.tree).titles[0];
		const draft = successionOf(title);
		expect(draft.year).toBe('');
		expect(draft.yearBad).toBe('[1100, 1105]');
		expect(draftSpec(draft).year).toBeUndefined();
		expect(draftSpec(draft)).toEqual(specOf(title));
	});

	it('the Year field starts empty, with the bad text as a hint', () => {
		const o = openWin(bad());
		const p = page(o, 'crown');
		expect(p.querySelector('input.dynasty-succ-year')!.value).toBe('');
		expect(p.querySelector('[data-hint="year-bad"]')!.getText()).toBe(T.yearBad('[1100, 1105]'));
		expect(o.win.isDirty()).toBe(false);
	});

	it('Save writes no year until the owner types one', async () => {
		const o = openWin(bad());
		const p = page(o, 'crown');
		choose(p, 'rule', 'youngest-child');
		await click(saveButton(o));
		expect(o.handle.body).toContain('year: [1100, 1105]');
		expect(o.handle.body).toContain('succession: youngest-child');
	});

	it('a typed year replaces the bad one and hides the hint', async () => {
		const o = openWin(bad());
		const p = page(o, 'crown');
		type(p.querySelector('input.dynasty-succ-year')!, '1120');
		expect((p.querySelector('[data-hint="year-bad"]') as FEl).hidden).toBe(true);
		await click(saveButton(o));
		expect(o.handle.body).toContain('year: 1120');
		expect(o.handle.body).not.toContain('[1100, 1105]');
	});

	it('the text has the sentence', () => {
		expect(T.yearBad('[1, 2]')).toBe('The plugin cannot read the year in the note: [1, 2]. If you type a year here, the plugin replaces it.');
	});
});

describe('C: the summary sentence of the line', () => {
	it('the region has a name and no aria-live; one summary sentence has the aria-live', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		const region = p.querySelector('.dynasty-succ-line')!;
		expect(region.getAttribute('role')).toBe('region');
		expect(region.getAttribute('aria-label')).toBe(T.heading);
		expect(region.getAttribute('aria-live')).toBeNull();
		const live = p.querySelectorAll('[aria-live]');
		expect(live).toHaveLength(1);
		expect(live[0].getText()).toBe('3 heirs');
	});

	it('says "1 heir" for one heir and the no-heir text for none', () => {
		const one = page(openWin(mini('succession: eldest-child'), { succession: { limit: () => 1, oldAge: () => 110 } }), 'crown');
		expect(one.querySelector('[data-succ="summary"]')!.getText()).toBe('1 heir');
		expect(T.heirCount(4)).toBe('4 heirs');
		const none = page(openWin(mini('succession: eldest-child\nheirs-of-body: true').replace('person: rex', 'person: kid')), 'crown');
		expect(none.querySelector('[data-succ="summary"]')!.getText()).toBe(T.noHeir);
	});

	it('the summary element stays when the section draws again, and is empty with no line', () => {
		const o = openWin(mini(''));
		const p = page(o, 'crown');
		const live = p.querySelector('[data-succ="summary"]')!;
		expect(live.getText()).toBe('');
		choose(p, 'rule', 'eldest-child');
		expect(p.querySelector('[data-succ="summary"]')).toBe(live);
		expect(live.getText()).toBe('3 heirs');
	});
});

describe('F: carryState keeps one temporary view', () => {
	const finder = { first: 'a', second: 'b', index: 0, whole: false, steps: false };

	it('a finder in `to` wins over a Show view in `from`', () => {
		const from = newBlockState();
		from.succession = { title: 't' };
		const to = newBlockState();
		to.finder = finder;
		carryState(from, to);
		expect(to.finder).toBe(finder);
		expect(to.succession).toBeNull();
	});

	it('a Show view in `to` wins over a finder in `from`', () => {
		const from = newBlockState();
		from.finder = finder;
		const to = newBlockState();
		to.succession = { title: 'u' };
		carryState(from, to);
		expect(to.succession).toEqual({ title: 'u' });
		expect(to.finder).toBeNull();
	});

	it('with none in `to`, it takes the Show view or the finder of `from`', () => {
		const a = newBlockState();
		a.succession = { title: 't' };
		const toA = newBlockState();
		carryState(a, toA);
		expect(toA.succession).toEqual({ title: 't' });
		const b = newBlockState();
		b.finder = finder;
		const toB = newBlockState();
		carryState(b, toB);
		expect(toB.finder).toBe(finder);
		expect(toB.succession).toBeNull();
	});
});

describe('G: the saved picture has the look of the screen', () => {
	it('HEIR_LOOK is one border of 2 px and no ring (0.2.8, I35 as changed by D212), and styles.css has the same number', () => {
		expect(HEIR_LOOK.border).toBe(2);
		expect('ring' in HEIR_LOOK).toBe(false);
		const css = readFileSync('styles.css', 'utf8');
		expect(css).not.toContain('dynasty-heir-ring');
		expect(css.slice(css.indexOf('.dynasty-card.dynasty-heir .dynasty-card-bg {\n\tstroke: var(--interactive-accent)')).split('}')[0]).toContain(`stroke-width: ${HEIR_LOOK.border};`);
	});
});

describe('H, I: the texts', () => {
	it('H: the sentences of the named heirs, the age and the holder', () => {
		expect(T.heirNotAlive('Kid', null)).toBe('Kid is dead, so the plugin does not use Kid as a named heir.');
		expect(T.heirNotAlive('Kid', 1200)).toBe('Kid is not alive in 1200, so the plugin does not use Kid as a named heir.');
		expect(T.heirNotBorn('Kid', null)).toBe('Kid is not born yet, so the plugin does not use Kid as a named heir.');
		expect(T.heirNotBorn('Kid', 1200)).toBe('Kid is not born yet in 1200, so the plugin does not use Kid as a named heir.');
		expect(T.heirIsRuler('Kid')).toBe('Kid is the ruler of this line, so the plugin does not use Kid as a named heir.');
		expect(T.old('Kid', 1, null)).toBe('Kid is older than 1 year. If Kid is dead, add a death date.');
		expect(T.old('Kid', 110, 1200)).toBe('Kid is older than 110 years in 1200. If Kid is dead, add a death date.');
		expect(T.rulerNotInTree(null)).toBe('The holder of the title is not in the tree now. The plugin cannot show the line of succession.');
		expect(T.matrilinealHint).toContain('If you want brothers first, choose “Oldest generation first (lateral succession)” or “Nearest relative first (proximity of blood)” as the rule.');
	});

	it('I: an open branch row gives the death text, "death not confirmed", or no brackets', () => {
		expect(T.branchRow('Wren', 'c. 1141')).toBe('Open branch of Wren (died c. 1141): no children in the tree');
		for (const d of ['?', 'unknown', ' Maybe ', 'PERHAPS', 'possibly', 'uncertain']) {
			expect(T.branchRow('Wren', d), d).toBe('Open branch of Wren (death not confirmed): no children in the tree');
		}
		for (const d of ['yes', 'true', 'Dead', ' died ', 'deceased', '']) {
			expect(T.branchRow('Wren', d), d).toBe('Open branch of Wren: no children in the tree');
		}
	});

	it('I: the other texts', () => {
		expect(T.branchNote).toBe('A grey row shows a person who died and has no children in the tree. The person may have children that are not in the tree yet. If the person had no children, tick “No children” in the person window.');
		expect(T.moreBranches).toBe('and more open branches');
		expect(SHEET.childlessHint).toBe('If the person had no children, tick this box. The line of succession then shows no open branch for the person.');
		expect(SETTINGS_UI.youngDeathAgeDesc).toBe('For a person who died younger than this age, the line of succession shows no open branch. The note must give the birth year and the death year. Use a number from 0 to 1000. Use 0 to show every open branch.');
	});
});

