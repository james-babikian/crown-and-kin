import { describe, expect, it } from 'vitest';

import { deleteText, SETTINGS_UI, SUCCESSION_UI as T } from '../../src/render/ui-text';
import { DEFAULT_SETTINGS, OLD_AGE, SUCCESSION_LENGTH, normaliseSettings, parseWhole, settingsChanges } from '../../src/view/settings';
import { DynastySettingTab, type SettingsHost } from '../../src/obsidian/settings-tab';
import { FEl, dispatch, installDom, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian, settingRows, type TextComponent } from '../acceptance/fake-obsidian';

/*
 * Version 0.2.7, WP3 (contract E.6, J.8, K.3): the two settings of the line of succession, their tab rows, and the
 * delete text for named heirs and excluded people.
 */

describe('the settings', () => {
	it('have the defaults 5 and 110', () => {
		expect(DEFAULT_SETTINGS.successionLength).toBe(5);
		expect(DEFAULT_SETTINGS.oldAge).toBe(110);
		expect(SUCCESSION_LENGTH).toEqual({ min: 1, max: 20 });
		expect(OLD_AGE).toEqual({ min: 0, max: 1000 });
	});

	it('keep a whole number in the range and give the default for the rest', () => {
		expect(normaliseSettings({ successionLength: 12, oldAge: 80 })).toMatchObject({ successionLength: 12, oldAge: 80 });
		expect(normaliseSettings({ successionLength: 1, oldAge: 0 })).toMatchObject({ successionLength: 1, oldAge: 0 });
		expect(normaliseSettings({ successionLength: 20, oldAge: 1000 })).toMatchObject({ successionLength: 20, oldAge: 1000 });
		for (const bad of [0, 21, -3, 2.5, '7', null, NaN, Infinity, [5], {}]) expect(normaliseSettings({ successionLength: bad }).successionLength, String(bad)).toBe(5);
		for (const bad of [-1, 1001, 99.5, '110', null, NaN, undefined]) expect(normaliseSettings({ oldAge: bad }).oldAge, String(bad)).toBe(110);
	});

	it('a stored file of 0.2.6 has neither key and gets the defaults', () => {
		const s = normaliseSettings({ embedHeightDesktop: 640, showDates: false });
		expect(s.successionLength).toBe(5);
		expect(s.oldAge).toBe(110);
	});

	it('a change of one of them is a change for the views', () => {
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, successionLength: 7 })).toEqual(['successionLength']);
		expect(settingsChanges(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, oldAge: 0 })).toEqual(['oldAge']);
	});

	it('read a typed whole number in the range, with spaces around it', () => {
		expect(parseWhole(' 12 ', SUCCESSION_LENGTH)).toBe(12);
		expect(parseWhole('20', SUCCESSION_LENGTH)).toBe(20);
		expect(parseWhole('21', SUCCESSION_LENGTH)).toBeNull();
		expect(parseWhole('0', SUCCESSION_LENGTH)).toBeNull();
		expect(parseWhole('0', OLD_AGE)).toBe(0);
		expect(parseWhole('1000', OLD_AGE)).toBe(1000);
		expect(parseWhole('1001', OLD_AGE)).toBeNull();
		for (const bad of ['', 'five', '5.5', '-1', '1e2', '5 years']) expect(parseWhole(bad, OLD_AGE), bad).toBeNull();
	});
});

describe('the settings tab', () => {
	function open(settings = DEFAULT_SETTINGS) {
		installDom();
		resetDom();
		resetObsidian();
		const changes: Partial<typeof settings>[] = [];
		const host = {
			settings,
			changeSettings: async (c: Partial<typeof settings>) => void changes.push(c),
			clearCaches: () => undefined,
		} as unknown as SettingsHost;
		const tab = new DynastySettingTab({} as never, host);
		tab.display();
		const rowOf = (name: string) => settingRows.find((r) => r.nameEl.getText() === name)!;
		return { tab, changes, rowOf };
	}

	it('has the two rows in the group Line of succession (F10a), with their names and descriptions', () => {
		const { rowOf } = open();
		const length = rowOf(SETTINGS_UI.successionLength);
		const age = rowOf(SETTINGS_UI.oldAge);
		expect(length.descEl.getText()).toBe(SETTINGS_UI.successionLengthDesc);
		expect(age.descEl.getText()).toBe(SETTINGS_UI.oldAgeDesc);
		const group = (row: typeof length) => row.settingEl.closest('.setting-group')!.querySelector('.setting-item-heading')!.getText();
		expect(group(length)).toBe(SETTINGS_UI.groups.succession);
		expect(group(age)).toBe(SETTINGS_UI.groups.succession);
		expect(length.controlEl.querySelector('input')!.value).toBe('5');
		expect(age.controlEl.querySelector('input')!.value).toBe('110');
		expect(length.controlEl.querySelector('input')!.getAttribute('aria-label')).toBe(SETTINGS_UI.successionLength);
	});

	it('stores a number in range when the field loses the focus, and shows the stored number for a bad text', async () => {
		const { changes, rowOf } = open();
		const input = rowOf(SETTINGS_UI.successionLength).controlEl.querySelector('input')! as FEl;
		input.value = '9';
		dispatch(input, 'input');
		dispatch(input, 'blur');
		expect(changes).toEqual([{ successionLength: 9 }]);
		input.value = '99';
		dispatch(input, 'input');
		dispatch(input, 'blur');
		expect(changes).toEqual([{ successionLength: 9 }]);
		expect(input.value).toBe('5');
	});

	it('stores a number after the typing stops (Obsidian calls the change handler of the field)', async () => {
		const { changes, rowOf } = open();
		(rowOf(SETTINGS_UI.oldAge).components[0] as unknown as TextComponent).fire('90');
		await settle();
		expect(changes).toEqual([{ oldAge: 90 }]);
	});

	it('stores the typed number when the tab is closed', () => {
		const { tab, changes, rowOf } = open();
		const input = rowOf(SETTINGS_UI.oldAge).controlEl.querySelector('input')! as FEl;
		input.value = '0';
		dispatch(input, 'input');
		tab.hide();
		expect(changes).toEqual([{ oldAge: 0 }]);
	});
});

describe('the delete text', () => {
	const base = { unions: 0, childLinks: 0, clearsStart: false, clearsFocus: false };

	it('says that the plugin removes the person as the named heir of N titles', () => {
		expect(deleteText('Kid', { ...base, heirs: 1 })).toEqual(['The plugin also removes Kid as the named heir of 1 title.', 'The plugin does not delete other people.']);
		expect(deleteText('Kid', { ...base, heirs: 3 })).toContain('The plugin also removes Kid as the named heir of 3 titles.');
	});

	it('says that the plugin removes the person from the excluded people of N titles', () => {
		expect(deleteText('Kid', { ...base, excluded: 1 })).toContain('The plugin also removes Kid from the excluded people of 1 title.');
		expect(deleteText('Kid', { ...base, excluded: 2 })).toContain('The plugin also removes Kid from the excluded people of 2 titles.');
	});

	it('puts both after the holders and before the start and focus sentences; says nothing for 0 or none', () => {
		const out = deleteText('Kid', { ...base, clearsStart: true, holders: { titles: 2, entries: 2 }, heirs: 2, excluded: 1 });
		expect(out).toEqual([
			'The plugin also removes Kid from the holders of 2 titles.',
			T.deleteHeir('Kid', 2),
			T.deleteExcluded('Kid', 1),
			'The tree starts at this person now. After the delete, it will start at a different person.',
			'The plugin does not delete other people.',
		]);
		expect(deleteText('Kid', { ...base, heirs: 0, excluded: 0 })).toEqual(['The plugin does not delete other people.']);
	});
});
