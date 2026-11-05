import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildShell, cancelLabelFor } from '../../src/obsidian/window-shell';
import { SHEET } from '../../src/render/ui-text';
import { FEl, device, dispatch, fakeWin, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The shared rules of the window shell: the visible title of a computer window (its role), the left button (Close after a write, the
 * "Discard changes?" question), and the Save key with its key text. The frame itself is pinned in window-shell-footer-and-bar.test.ts.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => {
	delete (fakeWin as { navigator?: unknown }).navigator;
	vi.restoreAllMocks();
});

type Options = Partial<Parameters<typeof buildShell>[0]>;

function frame(phone: boolean, extra: Options = {}) {
	const modalEl = new FEl('div');
	if (phone) modalEl.addClass('is-phone');
	const contentEl = modalEl.createDiv();
	const log = { cancel: 0, save: 0 };
	const shell = buildShell({ modalEl: modalEl as never, contentEl: contentEl as never, title: 'Titles', onCancel: () => log.cancel++, onSave: () => log.save++, ...extra });
	return { modalEl, contentEl, shell: shell as unknown as FakeShell, log };
}

interface FakeShell {
	body: FEl;
	bar: FEl | null;
	foot: FEl | null;
	titleEl: FEl;
	cancel: FEl;
	save: FEl | null;
	setCancelLabel(text: string): void;
	setSaveLabel(text: string): void;
	setBack(label: string | null, aria: string, run: () => void): void;
	windowError(text: string, after?: FEl | null): FEl;
	clearWindowError(): void;
	dispose(): void;
}

const key = (modalEl: FEl, init: Record<string, unknown>) => dispatch(modalEl, 'keydown', { key: 'Enter', ...init });

describe('the title of a computer window', () => {
	it('is for a screen reader only unless the window asks for a role', () => {
		const { shell } = frame(false);
		expect(shell.titleEl.hasClass('dynasty-sr-only')).toBe(true);
		expect(shell.titleEl.hasClass('dynasty-title')).toBe(false);
	});

	it('shows in the tool role for the plugin\'s own windows and in the name role for a person or a couple', () => {
		const tool = frame(false, { titleRole: 'tool' }).shell.titleEl;
		expect([...tool.classes].sort()).toEqual(['dynasty-sheet-title', 'dynasty-title', 'is-tool']);
		expect(tool.getText()).toBe('Titles');
		const name = frame(false, { titleRole: 'name', title: 'Edmund Vane and Agnes Thorne' }).shell.titleEl;
		expect([...name.classes].sort()).toEqual(['dynasty-sheet-title', 'dynasty-title', 'is-name']);
	});

	it('is the title of the bar on a phone, whatever the role', () => {
		const { shell } = frame(true, { titleRole: 'tool' });
		expect(shell.titleEl.hasClass('dynasty-bar-title')).toBe(true);
		expect(shell.titleEl.hasClass('dynasty-title')).toBe(false);
	});
});

describe('the left button', () => {
	it('reads Cancel while the window edits and Close once it wrote something or only shows', () => {
		expect(cancelLabelFor('edit')).toBe(SHEET.cancel);
		expect(cancelLabelFor('wrote')).toBe(SHEET.close);
		expect(cancelLabelFor('show')).toBe(SHEET.close);
	});

	it('changes its label on a computer at once, and keeps it for a phone that shows the way back', () => {
		const desk = frame(false);
		desk.shell.setCancelLabel(SHEET.close);
		expect(desk.shell.cancel.getText()).toBe('Close');

		const phone = frame(true);
		phone.shell.setBack('Titles', 'Back to Titles', () => undefined);
		phone.shell.setCancelLabel(SHEET.close);
		expect(phone.shell.cancel.querySelector('.dynasty-bar-chevron')).not.toBeNull();
		phone.shell.setBack(null, '', () => undefined);
		expect(phone.shell.cancel.getText()).toBe('Close');
	});

	it('asks the question of Esc when a typed change would be lost, and closes at once when there is none', () => {
		let dirty = true;
		const ask = vi.fn();
		const { shell, log } = frame(false, { discard: { dirty: () => dirty, ask } });
		dispatch(shell.cancel, 'click');
		expect(ask).toHaveBeenCalledTimes(1);
		expect(log.cancel).toBe(0);
		dirty = false;
		dispatch(shell.cancel, 'click');
		expect(ask).toHaveBeenCalledTimes(1);
		expect(log.cancel).toBe(1);
	});

	it('asks the same question on a phone, but the way back on a second page never asks', () => {
		const ask = vi.fn();
		const back = vi.fn();
		const { shell, log } = frame(true, { discard: { dirty: () => true, ask } });
		dispatch(shell.cancel, 'click');
		expect(ask).toHaveBeenCalledTimes(1);
		shell.setBack('Titles', 'Back to Titles', back);
		dispatch(shell.cancel, 'click');
		expect(back).toHaveBeenCalledTimes(1);
		expect(ask).toHaveBeenCalledTimes(1);
		expect(log.cancel).toBe(0);
	});

	it('closes when the window cannot say whether it has changes (no exception, spec §8)', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { shell, log } = frame(false, {
			discard: {
				dirty: () => {
					throw new Error('broken');
				},
				ask: () => undefined,
			},
		});
		expect(() => dispatch(shell.cancel, 'click')).not.toThrow();
		expect(log.cancel).toBe(1);
	});
});

describe('the Save key on a computer', () => {
	it('shows the key text beside Save and names the button with its visible text and announces Control+Enter', () => {
		const { shell } = frame(false);
		const keys = shell.save!.querySelector('.dynasty-save-keys')!;
		expect(keys.getText()).toBe(SHEET.saveKeysCtrl);
		expect(shell.save!.getText()).toBe('Save Ctrl+Enter');
		expect(shell.save!.getAttribute('aria-label')).toBeNull();
		expect(shell.save!.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
	});

	it('shows Cmd+Enter on a Mac', () => {
		(fakeWin as { navigator?: unknown }).navigator = { platform: 'MacIntel' };
		const { shell } = frame(false);
		expect(shell.save!.querySelector('.dynasty-save-keys')!.getText()).toBe('Cmd+Enter');
		expect(shell.save!.getAttribute('aria-label')).toBeNull();
		expect(shell.save!.getAttribute('aria-keyshortcuts')).toBe('Meta+Enter');
	});

	it('shows no key on a phone, on a tablet, or on a window whose right button is not Save', () => {
		for (const shell of [frame(true).shell, frame(false, { saveLabel: 'Select' }).shell, frame(false, { saveKeys: false }).shell]) {
			expect(shell.save!.querySelector('.dynasty-save-keys')).toBeNull();
			expect(shell.save!.getAttribute('aria-keyshortcuts')).toBeNull();
		}
		device.coarse = true;
		const tablet = frame(false);
		expect(tablet.shell.save!.querySelector('.dynasty-save-keys')).toBeNull();
		expect(tablet.shell.save!.getText()).toBe('Save');
		key(tablet.modalEl, { ctrlKey: true });
		expect(tablet.log.save).toBe(0);
	});

	it('saves on Ctrl+Enter and on Cmd+Enter, and stops the key from doing anything else', () => {
		const { modalEl, log } = frame(false);
		expect(key(modalEl, { ctrlKey: true }).defaultPrevented).toBe(true);
		key(modalEl, { metaKey: true });
		expect(log.save).toBe(2);
	});

	it('does nothing for a plain Enter, Shift or Alt with it, an input method, a button that is off, or a question over the window', () => {
		const { modalEl, shell, log } = frame(false);
		key(modalEl, {});
		key(modalEl, { ctrlKey: true, shiftKey: true });
		key(modalEl, { ctrlKey: true, altKey: true });
		key(modalEl, { ctrlKey: true, isComposing: true });
		key(modalEl, { ctrlKey: true, keyCode: 229 });
		dispatch(modalEl, 'keydown', { key: 'a', ctrlKey: true });
		shell.save!.disabled = true;
		key(modalEl, { ctrlKey: true });
		shell.save!.disabled = false;
		const layer = modalEl.createDiv('dynasty-sheet-confirm');
		key(modalEl, { ctrlKey: true });
		expect(log.save).toBe(0);
		layer.remove();
		key(modalEl, { ctrlKey: true });
		expect(log.save).toBe(1);
	});

	it('stops listening when the shell lets go', () => {
		const { modalEl, shell, log } = frame(false);
		shell.dispose();
		key(modalEl, { ctrlKey: true });
		expect(log.save).toBe(0);
	});

	it('loses the key text while the label reads Wait, and gets it back with the plain Save', () => {
		const { shell } = frame(false);
		shell.setSaveLabel(SHEET.saveWait);
		expect(shell.save!.getText()).toBe('Wait');
		expect(shell.save!.getAttribute('aria-keyshortcuts')).toBeNull();
		shell.setSaveLabel(SHEET.save);
		expect(shell.save!.getText()).toBe('Save Ctrl+Enter');
		expect(shell.save!.getAttribute('aria-keyshortcuts')).toBe('Control+Enter');
	});
});

describe('the error about the whole window', () => {
	it('stands under the header, and a second call changes its text', () => {
		const { shell } = frame(false);
		const head = shell.body.createDiv('dynasty-head');
		shell.body.createDiv('dynasty-section');
		const line = shell.windowError('Cannot save.');
		expect(shell.body.children.map((c) => c.classes.has('dynasty-head') || c.classes.has('dynasty-window-error'))).toEqual([true, true, false]);
		expect(shell.body.children[0]).toBe(head);
		expect(shell.body.children[1]).toBe(line);
		expect(line.getAttribute('role')).toBe('alert');
		expect(line.hasClass('dynasty-sheet-error')).toBe(true);
		expect(shell.windowError('Another text.')).toBe(line);
		expect(line.getText()).toBe('Another text.');
		shell.clearWindowError();
		expect(shell.body.querySelector('.dynasty-window-error')).toBeNull();
	});
});
