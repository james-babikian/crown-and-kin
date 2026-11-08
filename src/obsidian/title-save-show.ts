/*
 * "Save and show" for a title that is not saved yet (spec §13.4, D334 Q4). The Line section of a new title cannot draw a line, so it holds the
 * note "Save the title first" and this button: it saves the window and then shows the line of the new title on the tree. The file also finds
 * the id that the Save gave to the title, because the line is shown by id.
 */

import type { Op } from '../core/edit';
import { SUCCESSION_UI } from '../render/ui-text';
import { draftId, idChanged } from '../view/id-draft';
import { titleIdRow, type TitleRow } from '../view/titles-draft';
import { guarded } from './start-guard';
import { textButton } from './window-parts';

/** The note and the button in the Line section of a new title; `save` is the window's Save with "show" set for this title. */
export function newTitleLine(body: HTMLElement, save: () => Promise<void>): void {
	// The row of a saved title (D338 point 4): the sentence at the left, a compact button at the right.
	const row = body.createDiv({ cls: ['dynasty-line-head', 'dynasty-succ-new'] });
	row.createDiv({ cls: ['dynasty-sheet-none', 'dynasty-succ-msg'], text: SUCCESSION_UI.newTitleLine, attr: { 'data-msg': 'new-title' } });
	textButton(row, ['dynasty-btn', 'dynasty-succ-save-show'], SUCCESSION_UI.saveAndShow, () => guarded('the Titles window could not save', () => void save().catch((e) => console.error('Crown and Kin: the Titles window could not save', e))), {
		icon: 'eye',
		focus: 'succ-save-show',
	});
}

/** The id that the title with row key `key` has after the write `ops`, or null when the title is gone. A new title has the id of its `add-title` op. */
export function shownId(rows: readonly TitleRow[], key: string, ops: readonly Op[]): string | null {
	const row = rows.find((t) => t.key === key);
	if (!row || row.deleted) return null;
	if (row.id !== null) return idChanged(titleIdRow(row)) ? draftId(titleIdRow(row)) : row.id;
	// `windowOps` writes one `add-title` for each new row, in the order of the rows.
	const added = ops.filter((o): o is Extract<Op, { kind: 'add-title' }> => o.kind === 'add-title');
	const news = rows.filter((t) => t.id === null && !t.deleted);
	return added[news.indexOf(row)]?.id ?? null;
}
