/*
 * The edit sheet (spec §6.3 fields, family, actions and commit model; §7.4 phone layout). Field
 * edits are a draft: Save writes once, only the changed fields; Cancel discards; any other way to
 * close asks first. A relationship action writes the draft in the same write. A new person is a
 * draft too: a sheet for them writes the person and the relationship together, on Save only.
 * The sheet reads the block from its handle, never from the rendered view, which the write replaces.
 * The Titles section (spec §13.4) is in `sheet-titles.ts`; its actions write like the relationship actions.
 * The portrait (spec §13.7) is a draft field too: a larger round picture at the top, with Select
 * portrait (the picture picker) and Remove portrait; its picture is a copy that the picture store
 * does not keep, released when the sheet closes. Select the part (spec §13.13) opens the crop tool
 * (`crop-tool.ts`); the part is the draft field `portraitCrop`, and the round picture shows it.
 *
 * Since 0.3.3 (WP-1 A1) the class is a chain of layers, one file for each part of the window, from the bottom:
 * - `edit-sheet-base.ts` `EditSheetBase`: the options, every field, open and close, unsaved changes, and the messages and questions. A call to a layer
 *   above is an `abstract` method there.
 * - `edit-sheet-portrait.ts`: the round portrait, the personal arms and the links under the header.
 * - `edit-sheet-form.ts`: the build of the window, the header and the fields of Details and Notes.
 * - `edit-sheet-family.ts`: the Family section and its rows.
 * - `edit-sheet-actions.ts`: the Actions section, Make a note, and the hosts of the add flows and the Titles section.
 * - `edit-sheet-writes.ts`: the draft as an operation, the write, Save and the reload.
 * - this file: `EditSheet`, which makes a sheet (`create`, `createNew`) and starts the sheet of a new person.
 * The draft logic that needs no window (`loadSheet`, the draft shape, the id helpers) is `view/sheet-draft.ts`.
 */

import type { App } from 'obsidian';
import type { NewRelation } from './family-flows';
import { EditSheetWrites } from './edit-sheet-writes';
import type { NewSheetOptions, PersonSheetOptions } from './edit-sheet-base';
export type { NewSheetOptions, PersonSheetOptions, SheetFolds, SheetOptions } from './edit-sheet-base';
import { loadSheet } from '../view/sheet-draft';

/** The modal that shows and edits one person's fields, family and relationship actions. */
export class EditSheet extends EditSheetWrites {
	/** Returns null if the person is not in the block (the view was out of date). */
	static create(app: App, o: PersonSheetOptions): EditSheet | null {
		const l = loadSheet(o.handle.body, o.personId, o.dates);
		return l.kind === 'ok' ? new EditSheet(app, o, l.data) : null;
	}

	/** A sheet for a new person; null if the block does not parse. */
	static createNew(app: App, o: NewSheetOptions): EditSheet | null {
		const l = loadSheet(o.parentSheet?.data.body ?? o.handle.body, null, o.dates);
		return l.kind === 'ok' ? new EditSheet(app, o, l.data) : null;
	}

	/** The control of this window that had the focus when a window for a new person opened (Add child, Add partner), as a `data-focus` mark. */
	private childMark: ReturnType<EditSheet['focusMark']> = null;

	protected openNew(rel: NewRelation, name?: string): void {
		this.childMark = this.focusMark();
		const sheet = EditSheet.createNew(this.app, { handle: this.o.handle, sourcePath: this.o.sourcePath, beforeWrite: this.o.beforeWrite, openNote: this.o.openNote, newPerson: rel, initialName: name, parentSheet: this, place: this.o.place, pictures: this.o.pictures, folds: this.o.folds, relationOptions: this.o.relationOptions, relationBlock: this.o.relationBlock, dates: this.o.dates });
		sheet?.open();
	}

	childClosed(): void {
		const mark = this.childMark;
		this.childMark = null;
		if (this.closing || !this.shown) return;
		// Obsidian gives the focus back to the element that had it when the new window opened; after a Save this window was built again and that element is gone.
		const doc = this.modalEl.doc ?? document;
		const active = doc.activeElement;
		if (active && active !== doc.body && active.isConnected) return;
		this.restoreFocus(mark ?? 'sheet');
	}
}
