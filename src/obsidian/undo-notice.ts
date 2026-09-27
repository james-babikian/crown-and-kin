/*
 * The Notice with an Undo button that a removal (a parent, a partnership, a person, a house) shows
 * after it writes. It is the one place that wires a Notice's button to `Handle.undo`.
 */

import { Notice } from 'obsidian';
import { REMOVE, WRITE_TEXT } from '../render/ui-text';
import { sameBody } from '../core/block-match';
import type { Handle } from './block-handle';
import { trackModal } from './plugin-modals';

const UNDO_NOTICE_MS = 10_000;

/**
 * The Notice after a destructive action (spec §6.1, §6.7): the text and an Undo button that uses
 * the plugin undo. Undo acts only while the block is still what this action wrote (or what a link
 * update after a rename made of it); otherwise it refuses, as the "Undo last tree edit" command does.
 */
export function undoNotice(text: string, handle: Handle, written: string, onUndone?: () => void): Notice {
	const frag = createFragment((f) => {
		f.createSpan({ cls: 'dynasty-undo-text', text });
	});
	const notice = new Notice(frag, UNDO_NOTICE_MS);
	const el = notice.messageEl ?? notice.noticeEl;
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
	const forget = trackModal(notice, end);
	// If Obsidian ends the Notice another way, it must not count as an open window for ever.
	setTimeout(forget, UNDO_NOTICE_MS + 1_000);
	button.addEventListener('click', (e) => {
		// A click on a Notice closes it; the button acts first.
		e.stopPropagation();
		if (!live) return;
		end();
		void (async () => {
			try {
				// A link update after a rename (a maintenance write) does not count as a change of the tree.
				const now = typeof handle.followed === 'function' ? handle.followed(written) : written;
				if (!sameBody(handle.body, now)) {
					new Notice(WRITE_TEXT.undoChanged);
					return;
				}
				const out = await handle.undo();
				if (out.ok) {
					new Notice(WRITE_TEXT.undoDone);
					onUndone?.();
				} else new Notice(out.code === 'missing' ? WRITE_TEXT.undoMissing : out.code === 'empty' ? WRITE_TEXT.undoEmpty : WRITE_TEXT.undoChanged);
			} catch (err) {
				console.error('Dynasty Tree: cannot undo', err);
				new Notice(WRITE_TEXT.undoChanged);
			}
		})();
	});
	return notice;
}
