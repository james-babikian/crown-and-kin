/*
 * What the three parts of the succession sections of the Titles window share (the rules, the people lists, the line): the host the
 * window gives, one small state object, and the few steps that every part uses. `succession-section.ts` makes the state; the parts in
 * `succession-rules-ui.ts`, `succession-people-ui.ts` and `succession-line-ui.ts` read and change it and ask for a redraw through
 * `redraw`, so that no part imports another part's redraw.
 */

import type { FamilyGraph } from '../core/derive';
import { successionLine, type SuccessionResult } from '../core/succession';
import { draftSpec, draftTitle, type SuccessionDraft, type TitleRow } from '../view/titles-draft';
import type { FirstHeirNoteInput } from './first-heir-note';
import type { PictureStore } from './picture-store';
import type { RowPictures } from './window-parts';
import { guarded } from './start-guard';

/** What the section needs from the window. */
export interface SectionHost {
	/** The family graph now: it changes when the window reloads. */
	g(): FamilyGraph;
	/** The draft row of the title; the section changes its `succ`. */
	row: TitleRow;
	/** The length of the line (the setting `successionLength`). */
	limit(): number;
	/** The age from which the line warns (the setting `oldAge`). */
	oldAge(): number;
	/** The age under which a death opens no branch (the setting `youngDeathAge`); 0 shows every open branch. */
	youngDeathAge(): number;
	/** True while the window has the phone layout: a field that gets the focus back then does not scroll the page. */
	phone(): boolean;
	/** The window of the page, for the timer (a note can be in a pop-out window). */
	win(): { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void };
	/** A change of the draft: the window clears its error line. */
	edited(): void;
	/** Runs a step so that it never leaves an exception in Obsidian (spec §8). */
	guard(fn: () => void): void;
	/** A tap on a name of a list of people: the window shows the card in the tree. */
	showCard(id: string): void;
	/** A tap on a row of the line opens the person; the window gives the way to do so (absent: the card shows in the tree). */
	openPerson?(id: string): void;
	/** The Show button. */
	show(): void;
	/** The person picker for a named heir or an excluded person. `skip` is the people it must not offer. Null: cancelled. */
	pick(kind: 'heir' | 'exclude', skip: ReadonlySet<string>): Promise<string | null>;
	/** The line or the rules changed: the closed sections show their summary line. */
	summaries?(s: { line: string; rules: string }): void;
	/** The pictures of the rows (portraits and initials); absent: initials only. */
	pictures?: PictureStore;
	/** The tree's note, for the pictures. */
	sourcePath?: string;
	/** The relation options (the setting "Assume an unknown second parent"): the note about the first heir names a relation. */
	relationOptions?(): FirstHeirNoteInput['options'];
}

/** The parts of the rules body that stay on the page between two choices. */
export interface RulesUi {
	/** Each pair is one choice and its hints. */
	rulePair: HTMLElement;
	inheritPair: HTMLElement | null;
	throughPair: HTMLElement | null;
	/** The pair of the year: the pairs "Who can inherit" and "Inherit through" stand before it. */
	yearPair: HTMLElement;
	illPair: HTMLElement;
	/** The box of the switches and the row of the switch "body", which exists only when the rule is real. */
	switches: HTMLElement;
	bodyRow: HTMLElement | null;
	grid: HTMLElement;
}

/** The two ways to draw the section again. `all` makes the bodies again and gives the focus back; `in-place` changes only what a choice changed. */
export type Redraw = { kind: 'all'; focus?: string } | { kind: 'in-place' };

/** The state of one succession view, shared by its three parts. */
export interface SectionState {
	host: SectionHost;
	/** The succession draft of the row. */
	s: () => SuccessionDraft;
	pictures: RowPictures;
	rulesEl: HTMLElement | null;
	lineEl: HTMLElement | null;
	result: SuccessionResult | null;
	timer: number | null;
	/** True while the Rules section is open. The window tells it (`rulesOpened`). */
	rulesOpen: boolean;
	/** The year that the line shows now (the year field redraws the line only when the draft year differs from it). */
	shown: string;
	/** The parts of the rules body that a choice can add, remove or change; a choice updates these in place. */
	ui: RulesUi | null;
	/** One short sentence that a screen reader says when the line changes. It stays outside the bodies, which draw again at each change. */
	live: HTMLElement | null;
	nameOf: (id: string) => string;
	rulerLabel: (id: string, year: number | null) => string;
	/** The one entry point for a redraw; `successionSection` sets it. */
	redraw: (how: Redraw) => void;
	/** Gives the closed sections their summary line; `successionSection` sets it. */
	summaries: () => void;
}

/** The text the note has for a key that the plugin cannot read, or null if the window cannot show it. */
export function badText(st: SectionState, key: 'succession' | 'inherit' | 'inherit-through' | 'inherit-illegitimate'): string | null {
	const host = st.host;
	const t = host.row.id === null ? undefined : host.g().titles?.find((x) => x.id === host.row.id);
	const raw = key === 'succession' ? t?.succession : key === 'inherit' ? t?.inherit : undefined;
	const text = (raw ?? t?.badKeys?.[key] ?? '').trim();
	return text === '' ? null : text;
}

/** Stops the timer of the year field. */
export function stopTimer(st: SectionState): void {
	if (st.timer !== null) st.host.win().clearTimeout(st.timer);
	st.timer = null;
}

/** The line for the draft, on the current graph. Null if the title is not in the tree. */
export function compute(st: SectionState): SuccessionResult | null {
	const host = st.host;
	return guarded(
		'cannot compute the line of succession',
		() => {
			const title = draftTitle(host.g(), host.row);
			return title ? successionLine(host.g(), title, draftSpec(st.s()), host.limit(), host.oldAge(), host.youngDeathAge()) : null;
		},
		null,
	);
}

/** A change of the draft that draws the bodies again; `focus` names the control that gets the focus. */
export function change(st: SectionState, fn: () => void, focus?: string): void {
	st.host.guard(() => {
		fn();
		st.host.edited();
		st.redraw({ kind: 'all', ...(focus !== undefined ? { focus } : {}) });
	});
}

/**
 * A choice in a dropdown: the dropdown that the user used stays on the page, and the focus does not move. On a phone, a select
 * that is destroyed and made again inside its own change event keeps its menu open, and a new select that gets the focus opens.
 */
export function changeInPlace(st: SectionState, fn: () => void): void {
	st.host.guard(() => {
		fn();
		st.host.edited();
		st.redraw({ kind: 'in-place' });
	});
}
