/*
 * The two succession sections of the Titles window page (E, J, K, L): the
 * section "Line of succession" (the line that the draft gives, the button Show, the quiet notes) and the section "Rules of
 * succession" (the rule, who can inherit, the year, the switches, the named heirs and the excluded people). Both are drawn from
 * the `succ` fields of the draft row of one saved title and never write to the note; the window's Save does (`titles-draft.ts`).
 * The choices are dropdowns on every device; on a phone each one is the phone's own list (D208 item 3, phone-rules-native).
 * `titles-window.ts` makes one view for each edit page and puts its two bodies in the sections. This file makes the shared state and
 * the one `redraw` entry point and returns the view; the rules, the people lists and the line are in `succession-rules-ui.ts`,
 * `succession-people-ui.ts` and `succession-line-ui.ts`.
 */

import type { SuccessionResult } from '../core/succession';
import { rulerLabelOf } from '../view/succession-notes';
import { RowPictures } from './window-parts';
import { compute, stopTimer, type Redraw, type SectionHost, type SectionState } from './succession-state-ui';
import { drawRules, patchBody, patchRules, rulesSummary } from './succession-rules-ui';
import { drawLine, lineSummary } from './succession-line-ui';
import { refreshStates } from './succession-people-ui';

export { rulesSummary, successionHints } from './succession-rules-ui';

/** What the window does with a section it made. */
export interface SuccessionView {
	/** The Rules section opened or closed. The cadet hint is computed only while it is open (D282). */
	rulesOpened(open: boolean): void;
	/** Draws the two bodies again from the draft; `focus` names the control (`data-focus`) that gets the focus. */
	draw(focus?: string): void;
	/** The result of the line now (for tests and for the Show button). */
	result(): SuccessionResult | null;
	/** The body of the section "Line of succession". */
	renderLine(parent: HTMLElement): void;
	/** The body of the section "Rules of succession". */
	renderRules(parent: HTMLElement): void;
	/** The one text line under the title of the closed section "Line of succession": "1st Aldric · 2nd Bran". */
	lineSummary(): string;
	/** The one text line under the title of the closed section "Rules of succession": "Eldest child first · No preference". */
	rulesSummary(): string;
	/** Stops the timer of the year field and lets go of the pictures. */
	dispose(): void;
}

/** The state of a new view; the two entry points that need all three parts are set by `successionSection`. */
function newState(host: SectionHost): SectionState {
	const st: SectionState = {
		host,
		s: () => host.row.succ!,
		pictures: new RowPictures(host.pictures, host.sourcePath ?? ''),
		rulesEl: null,
		lineEl: null,
		result: null,
		timer: null,
		rulesOpen: false,
		shown: '',
		ui: null,
		live: null,
		nameOf: (id) => host.g().byId.get(id)?.name ?? id,
		rulerLabel: (id, year) => rulerLabelOf(host.g(), host.row.holders, id, year, st.nameOf(id)),
		redraw: () => undefined,
		summaries: () => host.summaries?.({ line: lineSummary(st), rules: rulesSummary(st.s()) }),
	};
	st.redraw = (how) => redraw(st, how);
	return st;
}

/** Draws the bodies again, or changes only what a choice changed; the one entry point for every part. */
function redraw(st: SectionState, how: Redraw): void {
	stopTimer(st);
	if (how.kind === 'in-place') {
		// What follows a choice in a dropdown: no dropdown is made again and the focus stays where it is.
		st.result = compute(st);
		st.shown = st.s().year;
		if (st.rulesEl && st.ui) patchRules(st, st.ui);
		if (st.lineEl) drawLine(st, false);
		refreshStates(st);
		st.summaries();
		return;
	}
	const mounted = st.rulesEl ?? st.lineEl;
	const doc = mounted?.doc;
	const had = how.focus ?? (doc?.activeElement && mounted?.contains(doc.activeElement) ? (doc.activeElement as HTMLElement).getAttribute('data-focus') : null);
	// The line is computed first: the notes under the named heirs read it.
	st.result = compute(st);
	if (st.rulesEl) drawRules(st, st.rulesEl);
	if (st.lineEl) drawLine(st, false);
	st.summaries();
	if (had) (st.rulesEl ?? st.lineEl)?.querySelector<HTMLElement>(`[data-focus="${had}"]`)?.focus({ preventScroll: st.host.phone() });
}

/** Makes the succession view of a saved title; the window puts `renderLine` and `renderRules` in its two sections. */
export function successionSection(host: SectionHost): SuccessionView {
	const st = newState(host);
	st.result = compute(st);
	return {
		draw: (focus) => st.redraw({ kind: 'all', ...(focus !== undefined ? { focus } : {}) }),
		rulesOpened(open) {
			if (open === st.rulesOpen) return;
			st.rulesOpen = open;
			// A section that opens gets its cadet hint now; the one that closes keeps the page as it is.
			if (open && st.ui) host.guard(() => patchBody(st, st.ui!));
		},
		result: () => st.result,
		renderLine(parent) {
			st.live = parent.createDiv({ cls: 'dynasty-succ-live', attr: { 'aria-live': 'polite', 'data-succ': 'summary' } });
			st.lineEl = parent.createDiv({ cls: 'dynasty-succ-linebody' });
			drawLine(st, false);
		},
		renderRules(parent) {
			st.rulesEl = parent;
			drawRules(st, parent);
		},
		lineSummary: () => lineSummary(st),
		rulesSummary: () => rulesSummary(st.s()),
		dispose: () => {
			stopTimer(st);
			st.pictures.release();
		},
	};
}
