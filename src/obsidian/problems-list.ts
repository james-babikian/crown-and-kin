/*
 * The problem list that opens from the badge of the toolbar (spec §8, D330 CH-02, UX-20). The popover is the list itself: a title row (the triangle and the words), the
 * hint, and one row for each problem. A row that names people is a button that shows them; a row that has a place where the user can correct it also has a second
 * button, "Open Oswin Valmont" or "Open House Harrow", which opens that window. Nothing here changes a note.
 */

import type { FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import { issueText } from '../core/messages';
import { setNameText } from '../render/dom/name-marks';
import type { IconFn } from '../render/dom/widgets';
import { PROBLEMS_HINT, PROBLEMS_OPEN, PROBLEMS_POPUP_BUTTON, SHEET, problemsPopupLine, problemsTitle } from '../render/ui-text';

/** The person or the house whose window is the place to correct a problem. */
export interface ProblemTarget {
	kind: 'person' | 'house';
	id: string;
	name: string;
}

/**
 * Where a problem can be corrected: the house of an arms picture problem, or of any problem whose first ID is a house of the tree that no person has (a colour that reads as
 * no colour, an ID used twice; K-15); else the first person that the problem is about. A problem about no person or house in the tree (an error of the tree text, a missing ID)
 * has no window to open, so it gets no second button.
 */
export function problemTarget(issue: CodedIssue, whole: FamilyGraph | null): ProblemTarget | null {
	if (!whole) return null;
	const first = issue.ids?.[0] ?? '';
	const house = whole.houses.get(first);
	if (house && (issue.params.owner === 'arms' || !whole.byId.has(first))) return { kind: 'house', id: house.id, name: house.name };
	if (issue.params.owner === 'arms') return null;
	for (const id of issue.ids ?? []) {
		const person = whole.byId.get(id);
		if (person) return { kind: 'person', id, name: person.name };
	}
	return null;
}

/** What the list needs from the view. */
export interface ProblemsSpec {
	issues: readonly CodedIssue[];
	whole: FamilyGraph | null;
	/** The people of a problem that the view can show now (in focus mode a problem can be about people who are not drawn). */
	peopleOf: (issue: CodedIssue) => string[];
	/** The popover or sheet closes first; then the view shows these people. */
	show: (people: string[]) => void;
	/** The popover or sheet closes first; then the window of the target opens. */
	open: (target: ProblemTarget) => void;
	close: () => void;
	icon: IconFn;
	/** A sheet from the bottom (the full-screen view of a phone) has a row with the title and Close; the swipe of a sheet starts there. */
	sheet: boolean;
}

/**
 * Draws the small pop-up of the phone list in a note: one text line with the warning mark and one button that opens the full-screen view. The long list is in that
 * view, not here: a note has no room for it. Returns the button, for the keyboard.
 */
export function drawProblemsPopup(el: HTMLElement, s: { count: number; icon: IconFn; showFull: () => void }): HTMLElement {
	const line = el.createDiv({ cls: ['dynasty-problems-summary'] });
	s.icon(line.createSpan({ cls: 'dynasty-problems-mark', attr: { 'aria-hidden': 'true' } }), 'alert-triangle');
	line.createSpan({ text: problemsPopupLine(s.count) });
	const button = el.createEl('button', { cls: ['dynasty-btn', 'dynasty-problems-full'], text: PROBLEMS_POPUP_BUTTON, attr: { type: 'button' } });
	button.addEventListener('click', s.showFull);
	return button;
}

/** Draws the title row, the hint and the rows into `el`. Returns the first button, for the keyboard. */
export function drawProblems(el: HTMLElement, s: ProblemsSpec): HTMLElement | null {
	const head = el.createDiv({ cls: s.sheet ? 'dynasty-sheet-head' : 'dynasty-problems-head' });
	const title = head.createDiv({ cls: ['dynasty-popover-title', 'dynasty-problems-title'], attr: { role: 'heading', 'aria-level': '2' } });
	s.icon(title.createSpan({ cls: 'dynasty-problems-mark', attr: { 'aria-hidden': 'true' } }), 'alert-triangle');
	title.createSpan({ text: problemsTitle(s.issues.length) });
	if (s.sheet) head.createEl('button', { cls: ['dynasty-link', 'dynasty-sheet-close'], text: SHEET.close, attr: { type: 'button' } }).addEventListener('click', s.close);
	const rows = s.issues.map((issue) => ({ issue, people: s.peopleOf(issue), target: problemTarget(issue, s.whole) }));
	if (rows.some((r) => r.people.length || r.target)) el.createDiv({ cls: 'dynasty-problems-hint', text: PROBLEMS_HINT });
	const list = el.createEl('ul', { cls: 'dynasty-problems-list' });
	for (const { issue, people, target } of rows) {
		const li = list.createEl('li', { cls: issue.level === 'blocking' ? 'dynasty-problem is-blocking' : 'dynasty-problem' });
		if (people.length) setNameText(li.createEl('button', { cls: 'dynasty-problem-button' }), issueText(issue)).addEventListener('click', () => s.show(people));
		else setNameText(li.createSpan({ cls: 'dynasty-problem-text' }), issueText(issue));
		if (target) setNameText(li.createEl('button', { cls: ['dynasty-link', 'dynasty-problem-open'], attr: { type: 'button', 'aria-label': PROBLEMS_OPEN.label(target.name) } }), PROBLEMS_OPEN.button(target.name)).addEventListener('click', () => s.open(target));
	}
	return el.querySelector<HTMLElement>('.dynasty-problem-button, .dynasty-problem-open');
}
