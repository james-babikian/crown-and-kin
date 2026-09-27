import { Notice } from 'obsidian';
import { REMOVE, WRITE_TEXT } from '../render/ui-text';
import { sameBody, type Handle } from './block-handle';

/**
 * The Notice after a destructive action (spec §6.1, §6.7): the text and an Undo button that uses
 * the plugin undo. Undo acts only while the block is still what this action wrote (or what a link
 * update after a rename made of it); otherwise it refuses, as the "Undo last tree edit" command does.
 */
export function undoNotice(text: string, handle: Handle, written: string, onUndone?: () => void): Notice {
	const frag = createFragment((f) => {
		f.createSpan({ cls: 'dynasty-undo-text', text });
	});
	const notice = new Notice(frag, 10_000);
	const el = notice.messageEl ?? notice.noticeEl;
	el.addClass('dynasty-undo-notice');
	const button = el.createEl('button', { cls: 'dynasty-undo-button', text: REMOVE.undo, attr: { type: 'button' } });
	let used = false;
	button.addEventListener('click', (e) => {
		// A click on a Notice closes it; the button acts first.
		e.stopPropagation();
		if (used) return;
		used = true;
		notice.hide();
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
