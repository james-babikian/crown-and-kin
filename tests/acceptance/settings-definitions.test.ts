import { beforeEach, describe, expect, it, vi } from 'vitest';

import DynastyTreePlugin from '../../src/obsidian/main';
import { SETTING_GROUPS, type SettingRow } from '../../src/obsidian/settings-rows';
import { DynastySettingTab, type SettingsHost } from '../../src/obsidian/settings-tab';
import { SETTINGS_UI } from '../../src/render/ui-text';
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/view/settings';
import { FEl, dispatch, resetDom, settle } from './fake-dom';
import { Setting, SettingGroup, notices, resetObsidian, settingRows, type DropdownComponent, type Plugin as FakePlugin, type ToggleComponent } from './fake-obsidian';
import { fakeApp } from './tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-1d: the settings page from the declarative list of Obsidian 1.13 (`getSettingDefinitions()`) and from the old tab of
 * Obsidian 1.11 and 1.12 (`display()`). Both are drawn from the one list in `settings-rows.ts`. The fake Obsidian has the base
 * class of 1.11 (no `getSettingDefinitions`), so the old path runs on it as it runs on 1.11; the declarative path is run by
 * the test as Obsidian 1.13 runs it: a group with a heading and a class, a Setting for each item, and `render` on it.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
});

interface Def {
	name: string;
	desc: string;
	render: (setting: Setting, group: SettingGroup) => void | (() => void);
	control?: unknown;
	action?: unknown;
}
interface GroupDef {
	type: string;
	heading: string;
	cls: string;
	items: Def[];
}

function stubHost(settings: DynastySettings = DEFAULT_SETTINGS) {
	const changes: Partial<DynastySettings>[] = [];
	const cleared: number[] = [];
	const host = {
		settings,
		changeSettings: async (c: Partial<DynastySettings>) => void changes.push(c),
		clearCaches: () => void cleared.push(1),
	} as unknown as SettingsHost;
	return { host, changes, cleared };
}

const groupDefs = (tab: DynastySettingTab): GroupDef[] => tab.getSettingDefinitions() as unknown as GroupDef[];

/** Draws the definitions as Obsidian 1.13 does. It returns the cleanup functions that the `render` calls gave back. */
function drawDefinitions(tab: DynastySettingTab, into: FEl): (() => void)[] {
	const cleanups: (() => void)[] = [];
	for (const g of groupDefs(tab)) {
		const group = new SettingGroup(into).setHeading(g.heading).addClass(g.cls);
		for (const def of g.items) {
			group.addSetting((s) => {
				s.setName(def.name).setDesc(def.desc);
				const cleanup = def.render(s, group);
				if (typeof cleanup === 'function') cleanups.push(cleanup);
			});
		}
	}
	return cleanups;
}

/** The tree below an element as one text: tags, classes, attributes, text and form state. */
function shape(el: FEl): string {
	const attrs = [...el.attrs].map(([k, v]) => `${k}=${v}`).sort().join(',');
	const own = `${el.tag}.${[...el.classes].sort().join('.')}[${attrs}]{${el.text}|${el.value}|${el.checked}}`;
	return `${own}(${el.children.map(shape).join(' ')})`;
}

const flatRows = (): SettingRow[] => SETTING_GROUPS.flatMap((g) => [...g.rows]);

describe('the one list of settings', () => {
	it('holds every stored setting once, and no other key', () => {
		const keys = flatRows().flatMap((r) => ('key' in r ? [r.key] : []));
		expect([...keys].sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('has the eight groups of the settings page, in order', () => {
		const g = SETTINGS_UI.groups;
		expect(SETTING_GROUPS.map((x) => x.heading)).toEqual([g.view, g.cards, g.relations, g.succession, g.housePage, g.focus, g.links, g.repair]);
	});

	it('has the order and the texts of the settings page', () => {
		const t = SETTINGS_UI;
		const names = SETTING_GROUPS.map((g) => g.rows.map((r) => r.name));
		expect(names).toEqual([
			[t.heightDesktop, t.phoneDirection, t.reduceMotion],
			[t.armsOnCards, t.breakWords, t.dates, t.relations, t.portraits],
			[t.oneParentUnknown, t.manyParents],
			[t.successionLength, t.oldAge, t.youngDeathAge],
			[t.houseGeneration],
			[t.generations],
			[t.links],
			[t.cache],
		]);
		const descs = SETTING_GROUPS.map((g) => g.rows.map((r) => r.desc));
		expect(descs[0]).toEqual([t.heightDesktopDesc, t.phoneDirectionDesc, t.reduceMotionDesc]);
		expect(descs[1]).toEqual([t.armsOnCardsDesc, t.breakWordsDesc, t.datesDesc, t.relationsDesc, t.portraitsDesc]);
		expect(descs[2]).toEqual([t.oneParentUnknownDesc, t.manyParentsDesc]);
		expect(descs[3]).toEqual([t.successionLengthDesc, t.oldAgeDesc, t.youngDeathAgeDesc]);
		expect(descs[4]).toEqual([t.houseGenerationDesc]);
		expect(descs[5]).toEqual([t.generationsDesc]);
		expect(descs[6]).toEqual([t.linksDesc]);
		expect(descs[7]).toEqual([t.cacheDesc]);
	});

	it('gives each drop-down its choices, with the default among them, and falls back on the default for an unknown value', () => {
		const t = SETTINGS_UI;
		const drops = flatRows().flatMap((r) => (r.kind === 'dropdown' ? [r] : []));
		expect(drops.map((d) => d.key)).toEqual(['phoneDirection', 'reduceMotion', 'armsOnCards', 'focusGenerations']);
		const byKey = (k: string) => drops.find((d) => d.key === k)!;
		expect(byKey('phoneDirection').options).toEqual([['sideways', t.directionSideways], ['down', t.directionDown]]);
		expect(byKey('reduceMotion').options).toEqual([['system', t.reduceFollow], ['on', t.reduceOn], ['off', t.reduceOff]]);
		expect(byKey('armsOnCards').options).toEqual([['few', t.armsFew], ['all', t.armsAll]]);
		expect(byKey('focusGenerations').options.map((o) => o[0])).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
		for (const d of drops) {
			expect(d.options.map((o) => o[0]), d.key).toContain(String(DEFAULT_SETTINGS[d.key]));
			if (d.key !== 'focusGenerations') expect(d.change('no such value'), d.key).toEqual({ [d.key]: DEFAULT_SETTINGS[d.key] });
		}
		expect(byKey('focusGenerations').change('7')).toEqual({ focusGenerations: 7 });
		expect(byKey('reduceMotion').change('off')).toEqual({ reduceMotion: 'off' });
	});

	it('has a number range and a class for each number row, and a default inside the range', () => {
		const rows = flatRows().flatMap((r) => (r.kind === 'number' ? [r] : []));
		expect(rows.map((r) => [r.key, r.cls, r.range])).toEqual([
			['successionLength', 'dynasty-setting-succession-length', { min: 1, max: 20 }],
			['oldAge', 'dynasty-setting-old-age', { min: 0, max: 1000 }],
			['youngDeathAge', 'dynasty-setting-young-death-age', { min: 0, max: 1000 }],
		]);
		for (const r of rows) {
			expect(DEFAULT_SETTINGS[r.key]).toBeGreaterThanOrEqual(r.range.min);
			expect(DEFAULT_SETTINGS[r.key]).toBeLessThanOrEqual(r.range.max);
		}
	});
});

describe('getSettingDefinitions (Obsidian 1.13 and later)', () => {
	it('gives one group for each group of the list, with the heading, the class, and every setting with its name and description', () => {
		const tab = new DynastySettingTab({} as never, stubHost().host);
		const groups = groupDefs(tab);
		expect(groups.map((g) => g.type)).toEqual(Array(8).fill('group'));
		expect(groups.map((g) => g.heading)).toEqual(SETTING_GROUPS.map((g) => g.heading));
		expect(groups.every((g) => g.cls === 'dynasty-setting-group')).toBe(true);
		for (const [i, g] of groups.entries()) {
			expect(g.items.map((d) => [d.name, d.desc])).toEqual(SETTING_GROUPS[i].rows.map((r) => [r.name, r.desc]));
			// Each setting is drawn by its own code, so the label of the control and the typing rules are the same as on the old page.
			for (const d of g.items) {
				expect(typeof d.render).toBe('function');
				expect(d.control).toBeUndefined();
				expect(d.action).toBeUndefined();
			}
		}
	});

	it('does not read the settings before a row is drawn (Obsidian asks for the list when the tab is added)', () => {
		const host = { get settings(): never { throw new Error('read too early'); } } as unknown as SettingsHost;
		expect(() => groupDefs(new DynastySettingTab({} as never, host))).not.toThrow();
	});

	it('draws the same page as display() draws on Obsidian 1.11, for default values and for other values', () => {
		const other: DynastySettings = { ...DEFAULT_SETTINGS, embedHeightDesktop: 640, showDates: false, phoneDirection: 'down', reduceMotion: 'off', armsOnCards: 'all', breakWords: 'Long-na-munda', successionLength: 9, oldAge: 0, youngDeathAge: 30, focusGenerations: 7, updateLinks: false };
		for (const settings of [DEFAULT_SETTINGS, other]) {
			const oldTab = new DynastySettingTab({} as never, stubHost(settings).host);
			oldTab.display();
			const old = (oldTab.containerEl as unknown as FEl).children.map(shape);
			const declarative = new FEl('div');
			drawDefinitions(new DynastySettingTab({} as never, stubHost(settings).host), declarative);
			expect(declarative.children.map(shape)).toEqual(old);
			expect(old).toHaveLength(8);
		}
	});

	it('gives the page the class that the styles hang on, in the constructor and when a row is drawn', () => {
		const tab = new DynastySettingTab({} as never, stubHost().host);
		expect(tab.containerEl.hasClass('dynasty-settings')).toBe(true);
		const other = new DynastySettingTab({} as never, stubHost().host);
		other.containerEl.removeClass('dynasty-settings');
		drawDefinitions(other, new FEl('div'));
		expect(other.containerEl.hasClass('dynasty-settings')).toBe(true);
	});

	it('stores a change of a switch and of a drop-down through the host, as the old page does', async () => {
		const { host, changes } = stubHost();
		drawDefinitions(new DynastySettingTab({} as never, host), new FEl('div'));
		const row = (name: string) => settingRows.find((r) => r.nameEl.getText() === name)!;
		(row(SETTINGS_UI.dates).components[0] as ToggleComponent).fire(false);
		(row(SETTINGS_UI.generations).components[0] as DropdownComponent).fire('5');
		(row(SETTINGS_UI.armsOnCards).components[0] as DropdownComponent).fire('all');
		(row(SETTINGS_UI.manyParents).components[0] as ToggleComponent).fire(false);
		await settle();
		expect(changes).toEqual([{ showDates: false }, { focusGenerations: 5 }, { armsOnCards: 'all' }, { warnManyParents: false }]);
	});

	it('runs the button of the repair group: it empties the cache and shows the notice', () => {
		const { host, cleared } = stubHost();
		drawDefinitions(new DynastySettingTab({} as never, host), new FEl('div'));
		const row = settingRows.find((r) => r.nameEl.getText() === SETTINGS_UI.cache)!;
		expect(row.controlEl.querySelector('button')!.getText()).toBe(SETTINGS_UI.cacheButton);
		(row.components[0] as unknown as { fire(): void }).fire();
		expect(cleared).toEqual([1]);
		expect(notices).toEqual([SETTINGS_UI.cacheDone]);
	});

	it('stores typing that waits when Obsidian removes the row, once, and not again when the tab closes', async () => {
		const { host, changes } = stubHost();
		const tab = new DynastySettingTab({} as never, host);
		const cleanups = drawDefinitions(tab, new FEl('div'));
		// The height, the break list and the three numbers give a cleanup each.
		expect(cleanups).toHaveLength(5);
		const input = settingRows.find((r) => r.nameEl.getText() === SETTINGS_UI.successionLength)!.controlEl.querySelector('input')! as FEl;
		input.value = '9';
		for (const c of cleanups) c();
		await settle();
		expect(changes).toEqual([{ successionLength: 9 }]);
		tab.hide();
		await settle();
		expect(changes).toEqual([{ successionLength: 9 }]);
	});

	it('does not store the old text of a row that was drawn again (a search draws the rows again)', async () => {
		const { host, changes } = stubHost();
		const tab = new DynastySettingTab({} as never, host);
		const first = drawDefinitions(tab, new FEl('div'));
		const firstField = settingRows.find((r) => r.nameEl.getText() === SETTINGS_UI.oldAge)!.controlEl.querySelector('input')! as FEl;
		firstField.value = '30';
		// Obsidian removes the first rows (their cleanup stores the 30), then draws new rows.
		for (const c of first) c();
		drawDefinitions(tab, new FEl('div'));
		await settle();
		expect(changes).toEqual([{ oldAge: 30 }]);
		changes.length = 0;
		// Closing the tab stores only what the new rows hold: the new rows hold nothing typed.
		tab.hide();
		await settle();
		expect(changes).toEqual([]);
	});

	it('keeps the rules of a number field: a text out of range is not stored, and the field shows the stored number again', async () => {
		const { host, changes } = stubHost();
		drawDefinitions(new DynastySettingTab({} as never, host), new FEl('div'));
		const input = settingRows.find((r) => r.nameEl.getText() === SETTINGS_UI.successionLength)!.controlEl.querySelector('input')! as FEl;
		expect(input.getAttribute('aria-label')).toBe(SETTINGS_UI.successionLength);
		expect(input.getAttribute('inputmode')).toBe('numeric');
		input.value = '99';
		dispatch(input, 'blur');
		await settle();
		expect(changes).toEqual([]);
		expect(input.value).toBe('5');
	});
});

describe('the old page (Obsidian 1.11 and 1.12)', () => {
	it('is built by display() when the base class has no getSettingDefinitions, and display() does not ask for the definitions', () => {
		// The fake base class is the base class of 1.11: it has neither getSettingDefinitions nor update.
		const base = Object.getPrototypeOf(DynastySettingTab.prototype) as Record<string, unknown>;
		expect(base.getSettingDefinitions).toBeUndefined();
		const tab = new DynastySettingTab({} as never, stubHost().host);
		const spy = vi.spyOn(tab, 'getSettingDefinitions');
		tab.display();
		expect(spy).not.toHaveBeenCalled();
		expect(tab.containerEl.children).toHaveLength(8);
		expect(tab.containerEl.hasClass('dynasty-settings')).toBe(true);
		expect((tab.containerEl as unknown as FEl).querySelectorAll('.setting-item-name').map((n) => n.getText())).toEqual(flatRows().map((r) => r.name));
	});

	it('draws again without a second copy of the groups', () => {
		const tab = new DynastySettingTab({} as never, stubHost().host);
		tab.display();
		tab.display();
		expect(tab.containerEl.children).toHaveLength(8);
	});
});

describe('the real plugin', () => {
	it('stores a change made through the definitions with the same save as the old page', async () => {
		const plugin = new DynastyTreePlugin(fakeApp() as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		fake.stored = null;
		await fake.load();
		expect(fake.settingTabs).toHaveLength(1);
		const tab = fake.settingTabs[0] as unknown as DynastySettingTab;
		expect(groupDefs(tab)).toHaveLength(8);
		drawDefinitions(tab, new FEl('div'));
		(settingRows.find((r) => r.nameEl.getText() === SETTINGS_UI.links)!.components[0] as ToggleComponent).fire(false);
		await settle();
		expect(plugin.settings.updateLinks).toBe(false);
		expect(fake.saved[fake.saved.length - 1]).toEqual({ ...plugin.settings, settingsVersion: 1 });
	});
});
