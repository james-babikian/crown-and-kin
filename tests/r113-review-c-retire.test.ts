import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clock, dispatch, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle } from './acceptance/tree-view-fakes';

/*
 * Review round 0.2.3, area C, D3: after `TreeView.retire()` (the plugin is turned off while a tree is on the page)
 * the tree stays as a picture. No button of it may open a window of the plugin or break the picture.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const SRC = 'people:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont\n    parents: [aldric]\n';

describe('D3: a retired view', () => {
	for (const cls of ['dynasty-focus', 'dynasty-more', 'dynasty-fit', 'dynasty-legend-button', 'dynasty-expand']) {
		it(`the button .${cls} on the picture of a retired view opens no window of the plugin and keeps the picture`, async () => {
			desktop();
			const { el, view } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
			view.retire();
			const b = el.querySelector(`.${cls}`);
			expect(b).not.toBeNull();
			const errors: unknown[] = [];
			const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
			dispatch(b!, 'click', { button: 0, clientX: 10, clientY: 10 });
			await settle();
			spy.mockRestore();
			expect(errors).toEqual([]);
			expect(el.querySelector('.dynasty-error')).toBeNull();
			expect(openModals).toHaveLength(0);
		});
	}
});
