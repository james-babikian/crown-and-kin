/*
 * The settings page (spec §9, D33): the settings in groups under short headings. The list of settings is in `settings-rows.ts`.
 * Obsidian 1.13 and later calls `getSettingDefinitions()` (so its settings search finds each setting) and does not call `display()`
 * when that list is not empty. Obsidian 1.11 and 1.12 know only `display()`, which draws the same groups with SettingGroup (the lowest
 * version of the plugin is 1.11, D283). Both paths build each row with `buildRow`, so a row looks and acts the same in both.
 */

import { Notice, PluginSettingTab, Setting, SettingGroup, debounce, type App, type Plugin, type SettingDefinitionItem } from 'obsidian';
import { BREAK_WORDS_MAX, parseDesktopHeight, parseWhole } from '../view/settings';
import { SETTING_GROUPS, patch, type AreaRow, type ButtonRow, type DropdownRow, type HeightRow, type NumberRow, type SettingRow, type ToggleRow } from './settings-rows';
import type { DynastySettings } from '../view/settings';

/** What the tab needs from the plugin. */
export interface SettingsHost extends Plugin {
	readonly settings: DynastySettings;
	/** Stores a change and tells every tree view (spec §9). */
	changeSettings(change: Partial<DynastySettings>): Promise<void>;
	/** Empties the layout cache (spec §9 "Clear layout cache"). */
	clearCaches(): void;
}

/** Obsidian does not join a setting's name to its control; a screen reader needs the name on the control itself. */
function name(control: HTMLElement | null | undefined, label: string): void {
	control?.setAttribute('aria-label', label);
}

/** The desktop height and the break list are stored this long after the last key press (or at once on blur; the height also on Enter). */
const HEIGHT_TYPING_MS = 400;

/** The class of each group. */
const GROUP_CLASS = 'dynasty-setting-group';
/** The class of the tab: the styles of the fields hang on it. */
const TAB_CLASS = 'dynasty-settings';

/** The plugin's settings page. */
export class DynastySettingTab extends PluginSettingTab {
	/** What stores the typing that still waits for the typing to stop: one entry for each text field on the page. */
	private readonly waiting = new Set<() => void>();

	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		super(app, host);
		this.containerEl.addClass(TAB_CLASS);
	}

	/** Obsidian 1.13 and later: the groups and rows as data. Each row is drawn by `buildRow`, which reads the values when the row is drawn. */
	override getSettingDefinitions(): SettingDefinitionItem[] {
		return SETTING_GROUPS.map((g) => ({
			type: 'group' as const,
			heading: g.heading,
			cls: GROUP_CLASS,
			items: g.rows.map((row) => ({ name: row.name, desc: row.desc, render: (setting: Setting) => this.buildRow(row, setting) })),
		}));
	}

	/** Obsidian 1.11 and 1.12 (and a fallback on later versions): the same groups, drawn with SettingGroup. */
	override display(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass(TAB_CLASS);
		this.waiting.clear();
		for (const g of SETTING_GROUPS) {
			const group = new SettingGroup(el).setHeading(g.heading).addClass(GROUP_CLASS);
			for (const row of g.rows) group.addSetting((setting) => void this.buildRow(row, setting));
		}
	}

	override hide(): void {
		for (const run of [...this.waiting]) run();
		this.waiting.clear();
		super.hide();
	}

	/**
	 * One row. It returns a function that stores any typing that waits, for Obsidian 1.13 and later to call before it removes the row
	 * (a search can draw the rows again); `display()` does not use it.
	 */
	private buildRow(row: SettingRow, setting: Setting): (() => void) | undefined {
		setting.setName(row.name).setDesc(row.desc);
		// The styles hang on the tab class. If the page is drawn into another element, the group of the row gets the class too.
		this.containerEl.addClass(TAB_CLASS);
		setting.settingEl.closest('.setting-group')?.addClass(TAB_CLASS);
		switch (row.kind) {
			case 'toggle':
				this.toggleRow(row, setting);
				return undefined;
			case 'dropdown':
				this.dropdownRow(row, setting);
				return undefined;
			case 'button':
				this.buttonRow(row, setting);
				return undefined;
			case 'height':
				return this.heightRow(row, setting);
			case 'number':
				return this.numberRow(row, setting);
			case 'area':
				return this.areaRow(row, setting);
		}
	}

	private toggleRow(row: ToggleRow, setting: Setting): void {
		setting.addToggle((tg) => {
			name(tg.toggleEl, row.name);
			name(tg.toggleEl.querySelector('input'), row.name);
			tg.setValue(this.host.settings[row.key]);
			tg.onChange((v) => void this.host.changeSettings(patch(row.key, v)));
		});
	}

	private dropdownRow(row: DropdownRow, setting: Setting): void {
		setting.addDropdown((d) => {
			name(d.selectEl, row.name);
			for (const [value, text] of row.options) d.addOption(value, text);
			d.setValue(String(this.host.settings[row.key]));
			d.onChange((v) => void this.host.changeSettings(row.change(v)));
		});
	}

	private buttonRow(row: ButtonRow, setting: Setting): void {
		setting.addButton((b) => {
			b.setButtonText(row.label);
			b.onClick(() => {
				this.host.clearCaches();
				new Notice(row.notice);
			});
		});
	}

	/** Remembers what stores the waiting typing of a field. The returned function stores it once and forgets it. */
	private track(run: () => void): () => void {
		this.waiting.add(run);
		return () => {
			if (this.waiting.delete(run)) run();
		};
	}

	private heightRow(row: HeightRow, setting: Setting): () => void {
		let flushWaiting = () => {};
		setting.addText((text) => {
			text.inputEl.addClass('dynasty-setting-height');
			name(text.inputEl, row.name);
			text.inputEl.setAttribute('inputmode', 'numeric');
			text.setValue(String(this.host.settings[row.key]));
			// "1200" passes through "120": a value is stored only when the typing stops, not at each key press.
			const store = () => {
				const n = parseDesktopHeight(text.getValue());
				if (n !== null) void this.host.changeSettings(patch(row.key, n));
			};
			const later = debounce(store, HEIGHT_TYPING_MS, true);
			flushWaiting = () => later.run?.();
			// A microtask first, so changes that come in one task count as one.
			text.onChange(() => void Promise.resolve().then(() => later()));
			const now = () => {
				later.cancel?.();
				store();
				// A value out of range is not stored: the field shows the stored value again.
				text.setValue(String(this.host.settings[row.key]));
			};
			text.inputEl.addEventListener('blur', now);
			text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') now();
			});
		});
		return this.track(flushWaiting);
	}

	private areaRow(row: AreaRow, setting: Setting): () => void {
		let flushWaiting = () => {};
		setting.addTextArea((area) => {
			area.inputEl.addClass('dynasty-setting-break-words');
			area.inputEl.rows = 6;
			name(area.inputEl, row.name);
			area.setValue(this.host.settings[row.key]);
			// D118: the list is stored when the typing stops or the field loses the focus, not at each key press (each store lays the trees out again).
			const store = () => {
				// A typed text over the limit is cut here: a stored text over the limit counts as not valid.
				const text = area.getValue().slice(0, BREAK_WORDS_MAX);
				if (text !== this.host.settings[row.key]) void this.host.changeSettings(patch(row.key, text));
			};
			const later = debounce(store, HEIGHT_TYPING_MS, true);
			flushWaiting = () => {
				later.cancel?.();
				store();
			};
			area.onChange(() => void Promise.resolve().then(() => later()));
			area.inputEl.addEventListener('blur', () => flushWaiting());
		});
		return this.track(flushWaiting);
	}

	/**
	 * A text field for a whole number in a range. The number is stored when the typing stops or the field loses the focus;
	 * a text out of range is not stored, and the field shows the stored number again.
	 */
	private numberRow(row: NumberRow, setting: Setting): () => void {
		const current = () => this.host.settings[row.key];
		let flushWaiting = () => {};
		setting.addText((text) => {
			text.inputEl.addClass(row.cls);
			name(text.inputEl, row.name);
			text.inputEl.setAttribute('inputmode', 'numeric');
			text.setValue(String(current()));
			const save = () => {
				const n = parseWhole(text.getValue(), row.range);
				if (n !== null && n !== current()) void this.host.changeSettings(patch(row.key, n));
			};
			const later = debounce(save, HEIGHT_TYPING_MS, true);
			const flush = () => {
				later.cancel?.();
				save();
				text.setValue(String(current()));
			};
			flushWaiting = () => {
				later.cancel?.();
				save();
			};
			text.onChange(() => void Promise.resolve().then(() => later()));
			text.inputEl.addEventListener('blur', flush);
			text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') flush();
			});
		});
		return this.track(flushWaiting);
	}
}
