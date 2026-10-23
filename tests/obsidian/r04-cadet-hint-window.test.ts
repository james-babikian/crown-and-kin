import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The person picker is not used here, but the window imports it.
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => null }));

import { closePluginModals } from '../../src/view/plugin-modals';
import { resetOpenSections } from '../../src/obsidian/window-sections';
import { SUCCESSION_UI as T } from '../../src/render/ui-text';
import { clock, device, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { choose, ctl, openWin, page } from '../support/r027-window-support';
import { type } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4, owner decision D291: the Titles window shows the cadet hint under the switch "Only descendants of the first holder can
 * inherit" only while the switch is off and someone in the line is of an older line than the first holder. The real window runs
 * on the fake DOM.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	resetOpenSections();
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

/** Duke Robert is the younger son of King Henry (dead); the elder brother William is alive. `extra` adds title keys. */
function tree(extra = '', holders = '      - {person: robert, from: 1200}'): string {
	return [
		'titles:',
		'  - id: duchy',
		'    name: Duchy',
		'    succession: eldest-child',
		...(extra ? extra.split('\n').map((l) => `    ${l}`) : []),
		'    holders:',
		holders,
		'people:',
		'  - {id: henry, name: Henry Ardent, sex: m, born: 1140, died: 1190}',
		'  - {id: william, name: William Ardent, sex: m, born: 1165, parents: [henry]}',
		'  - {id: robert, name: Robert Ardent, sex: m, born: 1170, parents: [henry]}',
		'  - {id: edith, name: Edith Ardent, sex: f, born: 1195, parents: [robert]}',
		'',
	].join('\n');
}

/** Opens the section "Rules of succession" with a tap on its title row (a closed section computes no cadet hint). */
const rules = (p: ReturnType<typeof page>) => {
	dispatch(p.querySelector('[data-section="rules"] .dynasty-section-head')!, 'click', { detail: 1 });
	return p;
};
const isOpen = (p: ReturnType<typeof page>) => p.querySelector('[data-section="rules"]')!.hasClass('is-open');
const cadet = (p: ReturnType<typeof page>) => ctl(p, 'body')!.querySelector('[data-hint="cadet"]');
const CADET = T.cadetHint('William Ardent', 'Robert');

describe('the cadet hint in the Titles window', () => {
	it('shows under the switch while the switch is off and the line holds someone of an older line', () => {
		const p = rules(page(openWin(tree()), 'duchy'));
		expect(cadet(p)!.getText()).toBe(CADET);
		// The switch is off: its own hint says what it would do, and the screen reader reads both hints.
		const row = ctl(p, 'body')!;
		const hints = row.querySelectorAll('.dynasty-rule-text .dynasty-sheet-hint');
		expect(hints.map((h) => h.getText())).toEqual([T.bodyHintOff('Robert'), CADET]);
		expect(row.querySelector('input')!.getAttribute('aria-describedby')).toBe(hints.map((h) => h.getAttribute('id')).join(' '));
	});

	it('goes when the switch is turned on, and shows the old hint', () => {
		const p = rules(page(openWin(tree()), 'duchy'));
		const box = ctl(p, 'body')!.querySelector('input')!;
		box.checked = true;
		dispatch(box, 'change');
		expect(cadet(p)).toBeNull();
		expect(ctl(p, 'body')!.getText()).toContain(T.bodyHint('Robert'));
		// Turning it off again brings the hint back.
		const again = ctl(p, 'body')!.querySelector('input')!;
		again.checked = false;
		dispatch(again, 'change');
		expect(cadet(p)!.getText()).toBe(CADET);
	});

	it('does not show when the switch is already on in the note', () => {
		const p = rules(page(openWin(tree('heirs-of-body: true')), 'duchy'));
		expect(cadet(p)).toBeNull();
		expect(ctl(p, 'body')!.getText()).toContain(T.bodyHint('Robert'));
	});

	it('does not show when the first holder is the eldest: the younger brother does not matter', () => {
		const p = rules(page(openWin(tree('', '      - {person: william, from: 1200}')), 'duchy'));
		expect(cadet(p)).toBeNull();
		expect(ctl(p, 'body')!.getText()).toContain(T.bodyHintOff('William'));
	});

	it('follows a change of the rule: with Men only the elder sister would not count, with no preference she does', () => {
		const note = tree().replace('  - {id: robert,', '  - {id: mary, name: Mary Ardent, sex: f, born: 1160, parents: [henry]}\n  - {id: robert,').replace('  - {id: william, name: William Ardent, sex: m, born: 1165, parents: [henry]}\n', '');
		const p = rules(page(openWin(note), 'duchy'));
		expect(cadet(p)!.getText()).toBe(T.cadetHint('Mary Ardent', 'Robert'));
		choose(p, 'inherit', 'men-only');
		expect(cadet(p)).toBeNull();
		choose(p, 'inherit', 'no-preference');
		expect(cadet(p)!.getText()).toBe(T.cadetHint('Mary Ardent', 'Robert'));
	});

	it('follows the year of the line: William died in 1185, so the hint shows for 1180 and goes for now', () => {
		const note = tree().replace('born: 1165, parents: [henry]', 'born: 1165, died: 1185, parents: [henry]');
		const p = rules(page(openWin(note.replace('from: 1200', 'from: 1170')), 'duchy'));
		expect(cadet(p)).toBeNull();
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1180');
		runTimers(400);
		expect(cadet(p)!.getText()).toBe(CADET);
		// The field is not made again, so the focus stays in it.
		expect(ctl(p, 'year')!.querySelector('input')).toBe(year);
		type(year, '');
		runTimers(400);
		expect(cadet(p)).toBeNull();
	});

	it('shows no hint for a title with no rule, and no switch', () => {
		const p = page(openWin(tree().replace('    succession: eldest-child\n', '')), 'duchy');
		expect(ctl(p, 'body')).toBeNull();
	});

	it('does not break the window when the cadet hint cannot be made', async () => {
		const mod = await import('../../src/core/succession-hint');
		const spy = vi.spyOn(mod, 'cadetHint').mockImplementation(() => {
			throw new Error('boom');
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const p = rules(page(openWin(tree()), 'duchy'));
		expect(cadet(p)).toBeNull();
		expect(ctl(p, 'body')!.getText()).toContain(T.bodyHintOff('Robert'));
		spy.mockRestore();
		err.mockRestore();
	});

	it('is not computed while the Rules section is closed: no run of the cadet hint, no extra run of the line', async () => {
		const hint = await import('../../src/core/succession-hint');
		const core = await import('../../src/core/succession');
		const spyCadet = vi.spyOn(hint, 'cadetHint');
		const spyLine = vi.spyOn(core, 'successionLine');
		const p = page(openWin(tree()), 'duchy');
		expect(cadet(p)).toBeNull();
		expect(spyCadet).not.toHaveBeenCalled();
		// A change of the rule while the section is closed: the window runs its own line once and nothing more.
		spyLine.mockClear();
		choose(p, 'inherit', 'no-preference');
		expect(spyCadet).not.toHaveBeenCalled();
		expect(spyLine.mock.calls.length).toBeLessThanOrEqual(1);
		expect(cadet(p)).toBeNull();
		// The section opens: the hint is computed once for the open section, and a change while it is open computes it again.
		rules(p);
		expect(isOpen(p)).toBe(true);
		expect(spyCadet).toHaveBeenCalledTimes(1);
		expect(cadet(p)!.getText()).toBe(CADET);
		// Closed again, then a change: nothing runs.
		rules(p);
		expect(isOpen(p)).toBe(false);
		spyCadet.mockClear();
		choose(p, 'inherit', 'men-first-in-house');
		expect(spyCadet).not.toHaveBeenCalled();
	});

	it('changes only the cadet span: the switch row, its input and the first hint stay when the hint comes and goes', () => {
		const note = tree().replace('born: 1165, parents: [henry]', 'born: 1165, died: 1185, parents: [henry]');
		const p = rules(page(openWin(note.replace('from: 1200', 'from: 1170')), 'duchy'));
		const row = ctl(p, 'body')!;
		const input = row.querySelector('input')!;
		const first = row.querySelector('[data-hint="first"]')!;
		expect(cadet(p)).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBe(first.getAttribute('id'));
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1180');
		runTimers(400);
		const span = cadet(p)!;
		expect(span.getText()).toBe(CADET);
		expect(ctl(p, 'body') === row && row.querySelector('input') === input && row.querySelector('[data-hint="first"]') === first).toBe(true);
		expect(input.getAttribute('aria-describedby')).toBe(`${first.getAttribute('id')} ${span.getAttribute('id')}`);
		// A change of the choice keeps the same span, and a year that removes the hint removes only that span.
		choose(p, 'inherit', 'no-preference');
		expect(cadet(p) === span).toBe(true);
		expect(ctl(p, 'body')!.querySelector('input') === input).toBe(true);
		type(year, '');
		runTimers(400);
		expect(cadet(p)).toBeNull();
		expect(ctl(p, 'body')!.querySelector('input') === input).toBe(true);
		expect(input.getAttribute('aria-describedby')).toBe(first.getAttribute('id'));
	});
});
