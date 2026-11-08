import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { SaveWindow } from '../../src/obsidian/save-picture';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FINDER_UI, SAVE_UI } from '../../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, resetDom, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHost } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';
import { noteHandle } from '../support/writing-handle';

/*
 * B-0039: Obsidian shows an aria-label as a floating label. It must not stay over the first item of the More menu, and the radiogroup of
 * the Save-as-picture window takes its name from a hidden text.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const SOURCE = 'people:\n  - id: a\n    name: Ann\n';
const chunk = (name: string) => readFileSync(fileURLToPath(new URL(`../../styles/${name}`, import.meta.url)), 'utf8');

describe('the More button of the tree bar', () => {
	it('keeps its name, and the floating label of Obsidian goes when the menu opens', async () => {
		desktop();
		const e = await embed(SOURCE, { host: fakeHost(), handle: noteHandle(SOURCE) });
		const more = e.el.querySelector('.dynasty-more')!;
		expect(more.getAttribute('aria-label')).toBe(FINDER_UI.more);
		// Obsidian puts its label straight into the page body.
		const tip = fakeDoc.body.createDiv({ cls: ['tooltip', 'mod-top'] });
		const other = fakeDoc.body.createDiv({ cls: 'modal-container' });
		dispatch(more, 'click', { button: 0, clientX: 10, clientY: 10, detail: 1 });
		await settle();
		expect(e.el.querySelector('.dynasty-popover-more')).not.toBeNull();
		expect(fakeDoc.body.children).not.toContain(tip);
		expect(fakeDoc.body.children).toContain(other);
		expect(more.getAttribute('aria-label')).toBe(FINDER_UI.more);
	});
});

describe('the Save-as-picture window', () => {
	it('names the "Kind of file" group from a hidden text, with no aria-label', () => {
		const win = new SaveWindow({} as never, { save: () => undefined });
		(win as unknown as { scope: { register: () => void } }).scope = { register: () => undefined };
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const group = content.querySelector('.dynasty-save-kinds')!;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(group.getAttribute('aria-label')).toBeNull();
		const id = group.getAttribute('aria-labelledby')!;
		const label = group.querySelector('.dynasty-sr-only')!;
		expect(label.getAttribute('id')).toBe(id);
		expect(label.getText()).toBe(SAVE_UI.kindLabel);
		expect(chunk('23-legend-save.css')).toMatch(/\.dynasty-save-kinds\s*\{[^}]*position:\s*relative/);
	});
});
