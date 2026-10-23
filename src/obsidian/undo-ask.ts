/*
 * The command "Undo last tree edit" (spec §6.1, D8, D284). It undoes the last edit of the active note at once. If the last
 * edit is in another note, it names that note and asks first, so a tap cannot change a note that the user does not see.
 * If that edit cannot be undone any more, it refuses at once with a Notice and asks nothing.
 */

import { Notice, type App } from 'obsidian';
import { REMOVE, WRITE_TEXT } from '../render/ui-text';
import type { Handle, HandleRegistry } from './block-handle';
import { choose } from './choice-modal';

/** The name of a note as the user knows it: the last part of the path, with no ".md". */
export function noteBaseName(path: string): string {
	const last = path.slice(path.lastIndexOf('/') + 1);
	return last.replace(/\.md$/i, '');
}

// A second tap of the command must not stack a second question.
let asking = false;

/** The Notice for a refused undo: today's three refusals (spec §6.1). */
function refusal(code: string): string {
	return code === 'empty' ? WRITE_TEXT.undoEmpty : code === 'missing' ? WRITE_TEXT.undoMissing : WRITE_TEXT.undoChanged;
}

async function undoNow(h: Handle): Promise<void> {
	const out = await h.undo();
	// The note can be renamed while the question is open: the handle then has the new path.
	if (out.ok) new Notice(WRITE_TEXT.undoDoneIn(noteBaseName(h.key.path)));
	else new Notice(refusal(out.code));
}

/** The command. Nothing here throws: a fault shows the "cannot undo" Notice. */
export async function undoLastEditCommand(app: App, handles: HandleRegistry): Promise<void> {
	try {
		const active = app.workspace.getActiveFile()?.path ?? null;
		const h = handles.undoTarget(active);
		if (!h) {
			new Notice(WRITE_TEXT.undoEmpty);
			return;
		}
		if (h.key.path !== active) {
			// Spec §6.1: an edit that was undone already (Ctrl+Z) or a changed block refuses at once; a question first would only end in the same refusal.
			if (!h.canUndo) {
				new Notice(WRITE_TEXT.undoChanged);
				return;
			}
			if (asking) return;
			asking = true;
			let yes: boolean | null;
			try {
				yes = await choose<boolean>(app, {
					name: 'undo-ask',
					title: WRITE_TEXT.undoAskTitle(noteBaseName(h.key.path)),
					text: WRITE_TEXT.undoAskText(noteBaseName(h.key.path)),
					choices: [{ value: true, label: REMOVE.undo, cta: true }],
				});
			} finally {
				asking = false;
			}
			if (!yes) return;
			// The question can stay open for a long time: a later edit or an undo may have made another handle the target of that note.
			if (handles.undoTarget(h.key.path) !== h) {
				new Notice(WRITE_TEXT.undoChanged);
				return;
			}
		}
		await undoNow(h);
	} catch (e) {
		console.error('Crown and Kin: cannot undo', e);
		new Notice(WRITE_TEXT.undoChanged);
	}
}
