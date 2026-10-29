import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The person picker is not used here, but the window imports it.
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { closePluginModals } from '../../src/view/plugin-modals';
import { SUCCESSION_UI as T } from '../../src/render/ui-text';
import { clock, device, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { ctl, notes, openWin, page } from '../support/r027-window-support';
import { type } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D319 item 2a and item 3: the notes of the line of succession name a ruler as the heading and the holder list do, and the year field
 * redraws the line through the press hold. The real Titles window runs on the fake DOM.
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

/** A made-up tree: one title `crown` with `extra` keys and `holders`, and a small house. */
function mini(extra = '', holders = '      - {person: rex, from: 1100}', people = ''): string {
	return [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		...(extra ? extra.split('\n').map((l) => `    ${l}`) : []),
		'    holders:',
		holders,
		'people:',
		'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
		'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
		'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
		'  - {id: late, name: Late Ardent, sex: m, born: 1150, parents: [rex]}',
		'  - {id: elder, name: Elder Ardent, sex: m, born: 990}',
		'  - {id: lost, name: Lost Ardent, sex: m, born: 1101, died: 1110, parents: [rex]}',
		people,
		'',
	]
		.filter((l) => l !== '')
		.join('\n');
}


describe('D319 item 2a: one name for a ruler in all notes of the line (spec 13.21 rule 30)', () => {
	it('the outside-body note names both holders as the holder list does (full name when unnumbered)', () => {
		const people = '  - {id: lone, name: Lone Ardent, sex: m, born: 1080}';
		const o = openWin(mini('succession: eldest-child\nheirs-of-body: true', '      - {person: rex, from: 1050}\n      - {person: lone, from: 1100}', people));
		const p = page(o, 'crown');
		expect(notes(p, 'outside-body')).toEqual([T.outsideBody('Lone Ardent', 'Rex Ardent')]);
	});

	it('the no-year note of a reign names the holder as the heading and the holder list do', () => {
		const o = openWin(mini('succession: eldest-child\nyear: 1120', '      - {person: elder, from: spring}\n      - {person: rex, from: 1100}'));
		expect(notes(page(o, 'crown'), 'no-year-reign')).toEqual([T.noYearReign('Elder Ardent')]);
	});
});

describe('D319 item 2a: a numbered holder keeps the ruler text in the notes', () => {
	it('the no-year note names a numbered entry as the holder list does', () => {
		const o = openWin(mini('succession: eldest-child\nyear: 1120', '      - {person: elder, from: spring, number: 2}\n      - {person: rex, from: 1100}'));
		expect(notes(page(o, 'crown'), 'no-year-reign')).toEqual([T.noYearReign('Elder 2')]);
	});
});

describe('D319 item 3: the 300 ms year timer goes through the press hold', () => {
	it('a year typed, then a press on Show under way when the timer fires: the line stays until the click', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1101');
		dispatch(p.querySelector('button.dynasty-succ-show')!, 'pointerdown');
		runTimers(301);
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(T.lineAfter('Rex Ardent', null));
		dispatch(p.querySelector('button.dynasty-succ-show')!, 'click');
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).not.toBe(T.lineAfter('Rex Ardent', null));
	});

	it('with no press under way, the timer redraws the line as before', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		type(ctl(p, 'year')!.querySelector('input')!, '1101');
		runTimers(301);
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).not.toBe(T.lineAfter('Rex Ardent', null));
	});
});
