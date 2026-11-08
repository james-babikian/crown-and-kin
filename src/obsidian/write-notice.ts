/*
 * The Notice with Undo that the Titles window and the Houses window show after Save has closed the window (spec §13.4, D334 Q4). It says what
 * the Save did: a delete first, then an ID change, else the items the Save wrote (new or changed). The window gives the names and the texts;
 * this file chooses the words and wires the Undo button through `undoNotice`.
 */

import { REMOVE, ID_UI } from '../render/ui-text';
import { isIdOp } from '../view/id-draft';
import type { Op } from '../core/edit';
import type { Handle } from './block-handle';
import { undoNotice } from './undo-notice';

/** The texts a window gives: one for a delete and one for a Save that wrote items (both take the names). */
export interface WriteNoticeTexts {
	deleted: (names: string[]) => string;
	saved: (names: string[]) => string;
}

/**
 * The Undo notice after a good write. A delete says what went (and "also" when more was written), an ID change says how many, else the Save
 * says what it wrote. A Save that wrote no item shows nothing.
 */
export function afterWriteNotice(handle: Handle, body: string, ops: Op[], deleted: string[], saved: string[], texts: WriteNoticeTexts): void {
	const idCount = ops.filter(isIdOp).length;
	if (deleted.length) {
		const others = ops.length > deleted.length;
		undoNotice(others ? `${texts.deleted(deleted)} ${REMOVE.undoAlso}` : texts.deleted(deleted), handle, body);
	} else if (idCount) {
		undoNotice(ops.length > idCount ? `${ID_UI.changed(idCount)} ${REMOVE.undoAlso}` : ID_UI.changed(idCount), handle, body);
	} else if (saved.length) {
		undoNotice(texts.saved(saved), handle, body);
	}
}
