import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { DEFAULT_SETTINGS, YOUNG_DEATH_AGE, normaliseSettings } from '../src/obsidian/settings';
import { SETTINGS_UI, SHEET } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { click, stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Version 0.2.7, WP4 view (contract M.5, M.7, M.8): the checkbox "No children" of the edit sheet writes the person key
 * `childless` the way "Illegitimate" writes `illegitimate`; the setting `youngDeathAge`.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	device.coarse = false;
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => vi.restoreAllMocks());

const BODY = ['people:', '  - {id: rex, name: Rex Ardent, born: 1070, died: 1120}', '  - {id: kid, name: Kid Ardent, parents: [rex], died: 1109, childless: true}', ''].join('\n');

function open(body: string, personId: string) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
	s.open();
	return { h, modal: (s as unknown as { modalEl: FEl }).modalEl };
}

describe('the checkbox "No children" of the edit sheet', () => {
	it('comes after "Illegitimate", with its hint', () => {
		const { modal } = open(BODY, 'rex');
		const fields = modal.querySelectorAll('.dynasty-sheet-check').map((f) => f.getAttribute('data-field'));
		expect(fields).toEqual(['illegitimate', 'childless']);
		const row = modal.querySelector('[data-field="childless"]')!;
		expect(row.getText()).toBe(SHEET.childless);
		expect(SHEET.childless).toBe('No children');
		const hint = row.parentElement!.querySelector('.dynasty-sheet-hint')!;
		expect(hint.getText()).toBe(SHEET.childlessHint);
		expect(row.querySelector('input')!.getAttribute('aria-describedby')).toBe(hint.getAttribute('id'));
	});

	it('shows the stored key as ticked', () => {
		const { modal } = open(BODY, 'kid');
		expect(modal.querySelector('[data-field="childless"] input')!.checked).toBe(true);
		expect(modal.querySelector('[data-field="illegitimate"] input')!.checked).toBe(false);
	});

	it('a tick writes `childless: true` after `died` and a clear removes it; nothing else changes', async () => {
		const a = open(BODY, 'rex');
		const box = a.modal.querySelector('[data-field="childless"] input')!;
		box.checked = true;
		dispatch(box, 'change');
		await click(a.modal.querySelector('.dynasty-sheet-save'));
		expect(a.h.body).toContain('childless: true');
		const afterRex = a.h.body.split('\n').find((l) => l.includes('id: rex'))!;
		expect(afterRex).toContain('childless: true');
		expect(afterRex).toContain('died: 1120');
		closePluginModals();
		const b = open(a.h.body, 'rex');
		const off = b.modal.querySelector('[data-field="childless"] input')!;
		off.checked = false;
		dispatch(off, 'change');
		await click(b.modal.querySelector('.dynasty-sheet-save'));
		expect(b.h.body).toBe(BODY);
	});

	it('an unchanged box writes nothing', async () => {
		const a = open(BODY, 'kid');
		await click(a.modal.querySelector('.dynasty-sheet-save'));
		expect(a.h.body).toBe(BODY);
	});
});

describe('the setting "Age for open branches"', () => {
	it('is 0 by default and keeps a whole number from 0 to 1000', () => {
		expect(DEFAULT_SETTINGS.youngDeathAge).toBe(0);
		expect(YOUNG_DEATH_AGE).toEqual({ min: 0, max: 1000 });
		expect(normaliseSettings({ youngDeathAge: 18 }).youngDeathAge).toBe(18);
		expect(normaliseSettings({ youngDeathAge: 1000 }).youngDeathAge).toBe(1000);
		for (const bad of [-1, 1001, 1.5, '18', null, NaN]) expect(normaliseSettings({ youngDeathAge: bad }).youngDeathAge).toBe(0);
	});

	it('has the texts of the contract', () => {
		expect(SETTINGS_UI.youngDeathAge).toBe('Age for open branches');
		expect(SETTINGS_UI.youngDeathAgeDesc).toBe('For a person who died younger than this age, the line of succession shows no open branch. The birth year and the death year must be known. Use 0 to show every open branch.');
	});
});
