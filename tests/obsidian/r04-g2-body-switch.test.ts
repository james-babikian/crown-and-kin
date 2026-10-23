import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { closePluginModals } from '../../src/view/plugin-modals';
import { clock, device, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { ctl, openWin, page } from '../support/r027-window-support';
import { type } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const NOTE = [
	'titles:',
	'  - id: duchy',
	'    name: Duchy',
	'    succession: eldest-child',
	'    holders:',
	'      - {person: robert, from: 1200}',
	'people:',
	'  - {id: henry, name: Henry Ardent, sex: m, born: 1140, died: 1190}',
	'  - {id: william, name: William Ardent, sex: m, born: 1165, parents: [henry]}',
	'  - {id: robert, name: Robert Ardent, sex: m, born: 1170, parents: [henry]}',
	'',
].join('\n');

describe('G2 part 4: the year field of the Rules section and the switch "Only descendants"', () => {
	it('a change of the year does not replace the switch under the finger (blur of the year field before a tap on the switch)', () => {
		const p = page(openWin(NOTE), 'duchy');
		const before = ctl(p, 'body')!.querySelector('input')!;
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1210');
		// The tap on the switch: its mouse down moves the focus away from the year field, which fires the blur.
		dispatch(year, 'blur');
		const after = ctl(p, 'body')!.querySelector('input')!;
		expect(after === before, 'the switch element was replaced').toBe(true);
	});

	it('the 300 ms timer of the year field does not replace the switch either', () => {
		const p = page(openWin(NOTE), 'duchy');
		const before = ctl(p, 'body')!.querySelector('input')!;
		type(ctl(p, 'year')!.querySelector('input')!, '1210');
		runTimers(400);
		expect(ctl(p, 'body')!.querySelector('input') === before, 'the switch element was replaced').toBe(true);
	});
});
