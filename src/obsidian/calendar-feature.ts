/*
 * The calendars of the plugin (spec §14), as `main.ts` registers them: the scan of the calendar notes when the vault is ready, the draw of the open
 * trees again when the index changes (only a tree whose reader key changed draws; the others do nothing), the `kin-calendar` block in a note and the
 * command that opens the Calendars window. `main.ts` owns the index (`TreeHost.dates`); this file only wires it to Obsidian.
 */

import type { Plugin } from 'obsidian';
import { CALENDAR_UI } from '../render/calendar-text';
import type { CalendarIndex } from '../view/calendar-index';
import { calendarBlockProcessor } from './calendar-block-view';
import { openCalendars } from './calendar-window';
import type { TreeView } from './tree-view';

/** What this file needs of the plugin: the open tree views. */
export interface CalendarPlugin extends Plugin {
	readonly views: Set<TreeView>;
}

/**
 * Draws the open trees again after a change of the index. A tree that nobody sees (another tab, a closed fold) waits one timer turn each, behind the
 * trees on screen, as a change of a setting does (`main.ts`).
 */
export function redrawForDates(views: Iterable<TreeView>, later: (fn: () => void, turn: number) => void): void {
	const all = [...views];
	const hidden = all.filter((v) => v.offScreen);
	for (const v of all) if (!hidden.includes(v)) v.datesChanged();
	hidden.forEach((v, i) => later(() => v.datesChanged(), i));
}

/** Starts the index when the vault is ready, follows its changes and stops it when the plugin unloads. */
export function registerCalendars(plugin: CalendarPlugin, index: CalendarIndex): void {
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const later = (fn: () => void, turn: number) => {
		const t = setTimeout(() => {
			timers.delete(t);
			fn();
		}, turn);
		timers.add(t);
	};
	const off = index.onChange(() => {
		try {
			redrawForDates(plugin.views, later);
		} catch (e) {
			console.error('Crown and Kin: cannot draw the trees again after a change of the calendars', e);
		}
	});
	plugin.register(() => {
		off();
		for (const t of timers) clearTimeout(t);
		timers.clear();
		index.dispose();
	});
	plugin.registerMarkdownCodeBlockProcessor('kin-calendar', calendarBlockProcessor(plugin.app, index));
	// The command opens the window for the tree of the note that is open: its calendar note, if it names one.
	plugin.addCommand({
		id: 'open-calendars',
		name: CALENDAR_UI.command,
		callback: () => {
			const path = plugin.app.workspace.getActiveFile()?.path ?? '';
			const view = [...plugin.views].find((v) => v.notePath === path && !v.isFull);
			void openCalendars(plugin.app, index, { treePath: path, link: view?.calendarLink });
		},
	});
	// The vault list is complete only when the layout is ready. A host with no vault list or no metadata cache (a unit fake) has no calendar notes.
	const { vault, metadataCache } = plugin.app;
	if (typeof vault?.getMarkdownFiles !== 'function' || typeof metadataCache?.on !== 'function') return;
	plugin.app.workspace.onLayoutReady(() => void index.start());
}
