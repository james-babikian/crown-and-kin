/*
 * The Notice with an Undo button that a removal (a parent, a partnership, a person, a house) shows
 * after it writes. It is the one place that wires a Notice's button to `Handle.undo`.
 */

import { Notice } from 'obsidian';
import { noticeText, setNameText } from '../render/dom/name-marks';
import { REMOVE, WRITE_TEXT } from '../render/ui-text';
import { sameBody } from '../core/block-match';
import type { UndoLabel } from '../core/block-write';
import type { Handle } from './block-handle';
import { undoneText } from './undo-text';
import { trackModal } from '../view/plugin-modals';

const UNDO_NOTICE_MS = 10_000;

/**
 * The one Undo rule (spec §6.1, §6.7), for the Notice and for the text line of the edit window: the handle undoes its last write only while the
 * block is still what the action wrote (or what a link update after a rename made of it). `depth` is the undo depth right after the action; when
 * it is given and another write stands above it, the body can look the same again (a pin set and removed), so the rule refuses too. A refusal
 * shows its Notice and gives false; the undo gives true.
 */
export async function undoIfUnchanged(handle: Handle, written: string, depth: number | null = null): Promise<boolean> {
	return (await undoWithLabel(handle, written, depth)) !== null;
}

/** `undoIfUnchanged` with the label of the undone write (null when it refused; `label` is absent for a write that said nothing about itself). */
export async function undoWithLabel(handle: Handle, written: string, depth: number | null = null): Promise<{ label?: UndoLabel } | null> {
	try {
		// A link update after a rename (a maintenance write) does not count as a change of the tree.
		const now = typeof handle.followed === 'function' ? handle.followed(written) : written;
		const size = handle.undoSize;
		if (!sameBody(handle.body, now) || (depth !== null && typeof size === 'number' && size !== depth)) {
			new Notice(WRITE_TEXT.undoChanged);
			return null;
		}
		const out = await handle.undo();
		if (!out.ok) {
			new Notice(out.code === 'missing' ? WRITE_TEXT.undoMissing : out.code === 'empty' ? WRITE_TEXT.undoEmpty : WRITE_TEXT.undoChanged);
			return null;
		}
		return out.label ? { label: out.label } : {};
	} catch (err) {
		console.error('Crown and Kin: cannot undo', err);
		new Notice(WRITE_TEXT.undoChanged);
		return null;
	}
}

/**
 * The Notice after a destructive action (spec §6.1, §6.7): the text and an Undo button that uses
 * the plugin undo. Undo acts only while the block is still what this action wrote (or what a link
 * update after a rename made of it); otherwise it refuses, as the "Undo last tree edit" command does.
 */
export function undoNotice(text: string, handle: Handle, written: string, onUndone?: () => void, doneText: string = WRITE_TEXT.undoDone): Notice {
	const frag = createFragment((f) => {
		setNameText(f.createSpan({ cls: 'dynasty-undo-text' }), text);
	});
	const notice = new Notice(frag, UNDO_NOTICE_MS);
	const el = notice.messageEl;
	el.addClass('dynasty-undo-notice');
	const button = el.createEl('button', { cls: 'dynasty-undo-button', text: REMOVE.undo, attr: { type: 'button' } });
	// Once the Notice is hidden (Undo, its time, a click, the plugin unload) the button does nothing.
	let live = true;
	const hide = notice.hide.bind(notice);
	const end = (): void => {
		if (!live) return;
		live = false;
		forget();
		hide();
	};
	// Obsidian hides a Notice at its time through `hide`, so this also ends it then.
	notice.hide = end;
	// Like a modal: the plugin unload hides it, so its Undo cannot write after that.
	const forget = trackModal(notice, end, true);
	// If Obsidian ends the Notice another way, it must not count as an open window for ever.
	window.setTimeout(forget, UNDO_NOTICE_MS + 1_000);
	button.addEventListener('click', (e) => {
		// A click on a Notice closes it; the button acts first.
		e.stopPropagation();
		if (!live) return;
		end();
		void (async () => {
			const done = await undoWithLabel(handle, written);
			if (!done) return;
			try {
				// The label of the undone write gives the words that say what changed; a write with no final text keeps the text the caller gave.
				new Notice(noticeText(undoneText(done.label, null, doneText)));
				onUndone?.();
			} catch (err) {
				console.error('Crown and Kin: cannot undo', err);
				new Notice(WRITE_TEXT.undoChanged);
			}
		})();
	});
	return notice;
}
