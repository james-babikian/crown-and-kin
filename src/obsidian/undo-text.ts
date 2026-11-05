/*
 * The words after an Undo (D330 UX-17). The undo entry of a write carries a label (`core/block-write.ts`); this turns the label into the final text of the text
 * tables. A write with no label, and a label with no final text, give the generic text that the caller passes in. Nothing here reads or writes a note.
 */

import type { UndoLabel } from '../core/block-write';
import { CHANGE_UI } from '../render/change-text';
import { REMOVE, WRITE_TEXT } from '../render/ui-text';

/**
 * The text that says what an Undo changed back. `note` is the name of the note, for the one text that names it (the change to a person: "in “note”");
 * with no note that text is the generic `fallback`. The other texts name the people only.
 */
export function undoneText(label: UndoLabel | undefined, note: string | null, fallback: string): string {
	if (!label) return fallback;
	const [a = '', b = '', c = ''] = label.names;
	switch (label.kind) {
		case 'change':
			return note === null ? fallback : WRITE_TEXT.undoDoneChange(a, note);
		case 'added-child':
			return CHANGE_UI.undoneAddedChild(a, b, label.type ?? 'birth');
		case 'added-parent':
			return c === '' ? CHANGE_UI.undoneAddedParent(a, b, label.type ?? 'birth') : CHANGE_UI.undoneAddedParentAndMarriage(a, b, label.type ?? 'birth', c);
		case 'added-partner':
			return CHANGE_UI.undoneAddedPartner(a, b);
		case 'deleted':
			return REMOVE.undoneDelete(a);
		case 'marked-me':
			return CHANGE_UI.undoneMarkedMe(a);
		case 'unmarked-me':
			return CHANGE_UI.undoneUnmarkedMe(a);
		default:
			return fallback;
	}
}
