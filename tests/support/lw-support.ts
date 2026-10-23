/*
 * Helpers for the tests of the Titles window and the Houses window as a list with an edit page (the 0.2.5 contract D.5.1).
 * They work on the fake DOM, which is not a browser: its `querySelector` knows a tag, classes, quoted attributes, a
 * descendant space, a comma list and `:scope >`. So the helpers use only those forms.
 */

import { type FEl, dispatch } from '../acceptance/fake-dom';

/** Every row button of the list now on screen, in order. */
export function listRows(content: FEl): FEl[] {
	return content.querySelectorAll('ul.dynasty-lw-list button.dynasty-lw-row');
}

/** The row of an item, found by its row key or by the saved id (`data-title` / `data-house`). */
export function rowOf(content: FEl, key: string): FEl {
	const row = listRows(content).find((r) => r.getAttribute('data-focus') === `row:${key}` || r.getAttribute('data-title') === key || r.getAttribute('data-house') === key);
	if (!row) throw new Error(`lw-support: no row for "${key}"; rows are ${listRows(content).map((r) => r.getAttribute('data-focus')).join(', ')}`);
	return row;
}

/** The Back button of an open edit page, or null on the list. */
export function backButton(content: FEl): FEl | null {
	return content.querySelector('button[data-focus="back"]');
}

/** The edit page on screen; it throws when the list shows. */
export function pageOf(content: FEl): FEl {
	const page = content.querySelector('.dynasty-lw-page');
	if (!page) throw new Error('lw-support: no edit page is open');
	return page;
}

/** Taps the row of an item (by key or saved id), checks that the Back button shows, and returns the edit page. */
export function openPage(content: FEl, key: string): FEl {
	dispatch(rowOf(content, key), 'click');
	if (!backButton(content)) throw new Error(`lw-support: no Back button after a tap on "${key}"`);
	return pageOf(content);
}

/** Taps Back on an edit page. */
export function backToList(content: FEl): void {
	const back = backButton(content);
	if (!back) throw new Error('lw-support: no Back button; the list shows');
	dispatch(back, 'click');
}

/** The search box of the list. */
export function searchBox(content: FEl): FEl {
	const box = content.querySelector('input.dynasty-lw-search');
	if (!box) throw new Error('lw-support: no search box; an edit page shows');
	return box;
}

/** Types `text` in the search box as one input event, as a user's whole entry would. */
export function searchFor(content: FEl, text: string): FEl {
	const box = searchBox(content);
	box.value = text;
	dispatch(box, 'input');
	return box;
}

/** The text of each row: name, state tag, second text line and reason line, joined with " | ". */
export function rowTexts(content: FEl): string[] {
	return listRows(content).map((r) =>
		r
			.querySelectorAll('.dynasty-lw-row-name, .dynasty-lw-state, .dynasty-lw-row-sum, .dynasty-lw-row-found')
			.map((e) => e.getText())
			.join(' | '),
	);
}

/** The name of each row. */
export function rowNames(content: FEl): string[] {
	return listRows(content).map((r) => r.querySelector('.dynasty-lw-row-name')?.getText() ?? '');
}

/** Presses a key on `target` as a keydown event (no modifier, no composition unless `init` says so). */
export function press(target: FEl, key: string, init: Record<string, unknown> = {}) {
	return dispatch(target, 'keydown', { key, isComposing: false, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
}
