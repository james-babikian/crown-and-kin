/*
 * The calendars of the plugin (spec §14), as `main.ts` registers them: the start of the calendar index when the vault is ready, the draw of the open
 * trees again when the index changes (only a tree whose reader key changed draws; the others do nothing), the `kin-calendar` block in a note and the
 * command that opens the Calendars window. `main.ts` owns the index (`TreeHost.dates`); this file only wires it to Obsidian.
 */

import type { Plugin } from 'obsidian';
import { CALENDAR_UI } from '../render/calendar-text';
import type { CalendarIndex } from '../view/calendar-index';
import { calendarBlockProcessor } from './calendar-block-view';
import { openCalendars } from './calendar-window';
import { guardStart } from './start-guard';
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

/** The part of a tree view that `treesOfNote` reads. */
type Placed = Pick<TreeView, 'notePath' | 'isFull' | 'stateKey' | 'offScreen'>;

/**
 * One view for each tree block of a note. In Reading view the hidden Live Preview editor draws the same block, so a block can have two views; they share the state key. The view
 * on screen stands for the block. A block that is on screen nowhere (a closed fold) still counts, so a note with two trees stays "two trees".
 */
export function treesOfNote<V extends Placed>(views: Iterable<V>, path: string): V[] {
	const blocks = new Map<string, V[]>();
	for (const v of views) {
		if (v.notePath !== path || v.isFull) continue;
		const same = blocks.get(v.stateKey);
		if (same) same.push(v);
		else blocks.set(v.stateKey, [v]);
	}
	return [...blocks.values()].map((same) => same.find((v) => !v.offScreen) ?? same[0]);
}

/** Starts the index when the vault is ready, follows its changes and stops it when the plugin unloads. */
export function registerCalendars(plugin: CalendarPlugin, index: CalendarIndex): void {
	const timers = new Set<number>();
	const later = (fn: () => void, turn: number) => {
		const t = window.setTimeout(() => {
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
		for (const t of timers) window.clearTimeout(t);
		timers.clear();
		index.dispose();
	});
	guardStart('the calendar block', () => plugin.registerMarkdownCodeBlockProcessor('kin-calendar', calendarBlockProcessor(plugin.app, index)));
	// The command opens the window for the tree of the note that is open. Only a note with exactly one tree lets the window write the key (D290): with two trees, which one is meant is not clear.
	plugin.addCommand({
		id: 'open-calendars',
		name: CALENDAR_UI.command,
		callback: () => {
			const path = plugin.app.workspace.getActiveFile()?.path ?? '';
			const here = treesOfNote(plugin.views, path);
			const tree = here.length === 0 ? null : here.length === 1 ? here[0].calendarTree() : { ...here[0].calendarTree(), setLink: null };
			void openCalendars(plugin.app, index, { tree });
		},
	});
	// The index only subscribes to the vault events when it starts (it reads no note). A host with no vault or no metadata cache (a unit fake) has no events.
	const { vault, metadataCache } = plugin.app;
	if (typeof vault?.getMarkdownFiles !== 'function' || typeof metadataCache?.on !== 'function') return;
	plugin.app.workspace.onLayoutReady(() => void index.start());
}
