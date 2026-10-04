/*
 * The settings page (spec §9, D33): the settings in groups under short headings. Obsidian 1.11 and
 * later draw a group with SettingGroup; older versions get a heading row above the group.
 */

import { Notice, PluginSettingTab, Setting, SettingGroup, debounce, type App, type Plugin } from 'obsidian';
import { SETTINGS_UI } from '../render/ui-text';
import { GENERATIONS, PHONE_HEIGHTS, parseDesktopHeight, type DynastySettings } from './settings';

/** What the tab needs from the plugin. */
export interface SettingsHost extends Plugin {
	readonly settings: DynastySettings;
	/** Stores a change and tells every tree view (spec §9). */
	changeSettings(change: Partial<DynastySettings>): Promise<void>;
	/** Empties the layout cache (spec §9 "Clear layout cache"). */
	clearCaches(): void;
}

type Group = (add: (build: (s: Setting) => void) => void) => void;

/** Obsidian does not join a setting's name to its control; a screen reader needs the name on the control itself (P4). */
function name(control: HTMLElement | null | undefined, label: string): void {
	control?.setAttribute('aria-label', label);
}

/** The desktop height is stored this long after the last key press (or at once on blur or Enter). */
const HEIGHT_TYPING_MS = 400;

/** The plugin's settings page, built fresh each time it is shown. */
export class DynastySettingTab extends PluginSettingTab {
	/** Stores a desktop height that still waits for the typing to stop. */
	private pending: (() => void) | null = null;

	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		super(app, host);
	}

	override display(): void {
		const el = this.containerEl;
		el.empty();
		el.addClass('dynasty-settings');
		const t = SETTINGS_UI;
		const s = this.host.settings;
		this.group(el, t.groups.height, (add) => {
			add((row) => {
				row.setName(t.heightDesktop).setDesc(t.heightDesktopDesc);
				row.addText((text) => {
					text.inputEl.addClass('dynasty-setting-height');
					name(text.inputEl, t.heightDesktop);
					text.inputEl.setAttribute('inputmode', 'numeric');
					text.setValue(String(s.embedHeightDesktop));
					// "1200" passes through "120": a value is stored only when the typing stops, not at each key press.
					const store = () => {
						const n = parseDesktopHeight(text.getValue());
						if (n !== null) void this.host.changeSettings({ embedHeightDesktop: n });
					};
					const later = debounce(store, HEIGHT_TYPING_MS, true);
					this.pending = () => later.run?.();
					// A microtask first, so changes that come in one task count as one.
					text.onChange(() => void Promise.resolve().then(() => later()));
					const now = () => {
						later.cancel?.();
						store();
						// A value out of range is not stored: the field shows the stored value again.
						text.setValue(String(this.host.settings.embedHeightDesktop));
					};
					text.inputEl.addEventListener('blur', now);
					text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
						if (e.key === 'Enter') now();
					});
				});
			});
			add((row) => {
				row.setName(t.heightPhone).setDesc(t.heightPhoneDesc);
				row.addDropdown((d) => {
					name(d.selectEl, t.heightPhone);
					const values: number[] = [...PHONE_HEIGHTS];
					if (!values.includes(s.embedHeightPhone)) values.push(s.embedHeightPhone);
					for (const v of values.sort((a, b) => a - b)) d.addOption(String(v), `${v}%`);
					d.setValue(String(s.embedHeightPhone));
					d.onChange((v) => void this.host.changeSettings({ embedHeightPhone: Number(v) }));
				});
			});
		});
		this.group(el, t.groups.cards, (add) => {
			add((row) => {
				row.setName(t.cardSize).setDesc(t.cardSizeDesc);
				row.addDropdown((d) => {
					name(d.selectEl, t.cardSize);
					d.addOption('normal', t.cardNormal);
					d.addOption('compact', t.cardCompact);
					d.setValue(s.cardSize);
					d.onChange((v) => void this.host.changeSettings({ cardSize: v === 'compact' ? 'compact' : 'normal' }));
				});
			});
			add((row) => {
				row.setName(t.dates).setDesc(t.datesDesc);
				row.addToggle((tg) => {
					name(tg.toggleEl, t.dates);
					name(tg.toggleEl.querySelector('input'), t.dates);
					tg.setValue(s.showDates);
					tg.onChange((v) => void this.host.changeSettings({ showDates: v }));
				});
			});
			add((row) => {
				row.setName(t.relations).setDesc(t.relationsDesc);
				row.addToggle((tg) => {
					name(tg.toggleEl, t.relations);
					name(tg.toggleEl.querySelector('input'), t.relations);
					tg.setValue(s.showRelations);
					tg.onChange((v) => void this.host.changeSettings({ showRelations: v }));
				});
			});
			add((row) => {
				row.setName(t.portraits).setDesc(t.portraitsDesc);
				row.addToggle((tg) => {
					name(tg.toggleEl, t.portraits);
					name(tg.toggleEl.querySelector('input'), t.portraits);
					tg.setValue(s.showPortraits);
					tg.onChange((v) => void this.host.changeSettings({ showPortraits: v }));
				});
			});
		});
		this.group(el, t.groups.housePage, (add) => {
			add((row) => {
				row.setName(t.houseGeneration).setDesc(t.houseGenerationDesc);
				row.addToggle((tg) => {
					name(tg.toggleEl, t.houseGeneration);
					name(tg.toggleEl.querySelector('input'), t.houseGeneration);
					tg.setValue(s.showHouseGeneration);
					tg.onChange((v) => void this.host.changeSettings({ showHouseGeneration: v }));
				});
			});
		});
		this.group(el, t.groups.focus, (add) => {
			add((row) => {
				row.setName(t.generations).setDesc(t.generationsDesc);
				row.addDropdown((d) => {
					name(d.selectEl, t.generations);
					for (let n = GENERATIONS.min; n <= GENERATIONS.max; n++) d.addOption(String(n), String(n));
					d.setValue(String(s.focusGenerations));
					d.onChange((v) => void this.host.changeSettings({ focusGenerations: Number(v) }));
				});
			});
		});
		this.group(el, t.groups.links, (add) => {
			add((row) => {
				row.setName(t.links).setDesc(t.linksDesc);
				row.addToggle((tg) => {
					name(tg.toggleEl, t.links);
					name(tg.toggleEl.querySelector('input'), t.links);
					tg.setValue(s.updateLinks);
					tg.onChange((v) => void this.host.changeSettings({ updateLinks: v }));
				});
			});
		});
		this.group(el, t.groups.repair, (add) => {
			add((row) => {
				row.setName(t.cache).setDesc(t.cacheDesc);
				row.addButton((b) => {
					b.setButtonText(t.cacheButton);
					b.onClick(() => {
						this.host.clearCaches();
						new Notice(t.cacheDone);
					});
				});
			});
		});
	}

	override hide(): void {
		this.pending?.();
		this.pending = null;
		super.hide();
	}

	/** One group under a heading (D33). */
	private group(el: HTMLElement, heading: string, fill: Group): void {
		// SettingGroup is in Obsidian 1.11 and later; the manifest allows older versions.
		if (typeof SettingGroup === 'function') {
			const g = new SettingGroup(el).setHeading(heading).addClass('dynasty-setting-group');
			fill((build) => g.addSetting(build));
			return;
		}
		new Setting(el).setName(heading).setHeading().setClass('dynasty-setting-heading');
		fill((build) => build(new Setting(el)));
	}
}
