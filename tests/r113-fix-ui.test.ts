import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import * as UI from '../src/render/ui-text';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { HousesWindow } from '../src/obsidian/houses-window';
import { closePluginModals } from '../src/view/plugin-modals';
import { FEl, clock, fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp, openFullScreen } from './acceptance/tree-view-fakes';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';
import { backToList, openPage, pageOf } from './lw-support';

/*
 * Version 0.2.3, fix round "windows, texts, house page" (review of 0.2.3: RB1, RB2, spec review items 2 and 15, the
 * STE editor rewrites, the visual-qa findings, X10, the small items of review B).
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
	const esc = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
	const m = new RegExp(`^\\s*${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
	if (!m) throw new Error(`no CSS rule for ${selector}`);
	return m[1];
}

const BODY = ['houses:', '  - {id: valmont, name: House Valmont}', 'people:', '  - {id: a, name: Aldric, house: valmont, title: Duke}', '  - {id: b, name: Bran, parents: [a]}', ''].join('\n');

describe('Spec review item 2: the full-screen window is a named dialog', () => {
	it('has role dialog, aria-modal and the label that points to its title', async () => {
		const { modal } = await openFullScreen(BODY);
		const modalEl = (modal as unknown as { modalEl: FEl }).modalEl;
		expect(modalEl.getAttribute('role')).toBe('dialog');
		expect(modalEl.getAttribute('aria-modal')).toBe('true');
		const id = modalEl.getAttribute('aria-labelledby') ?? '';
		expect(id).not.toBe('');
		const title = modalEl.all().find((e) => e.getAttribute('id') === id);
		expect(title?.getText()).toBe(UI.FULL_UI.dialog);
	});
});

describe('RB1 and C8: the name of a button starts with its visible text', () => {
	it('the More item Save as picture', () => {
		expect(UI.SAVE_UI.moreLabel.startsWith(UI.SAVE_UI.more)).toBe(true);
	});

	it('every item of the More list, the text pairs of the toolbar: the label starts with the visible text where text is shown', () => {
		for (const [text, label] of [
			[UI.TITLES_UI.more, UI.TITLES_UI.moreLabel],
			[UI.FINDER_UI.relation, UI.FINDER_UI.relationLabel],
			[UI.SAVE_UI.more, UI.SAVE_UI.moreLabel],
		] as const) expect(label.startsWith(text)).toBe(true);
	});
});

describe('The house page button and the ID line (visual-qa)', () => {
	it('the Make a note button wraps its text and grows, like the other sheet buttons', () => {
		const r = rule('.dynasty-sheet button.dynasty-hp-make-note');
		expect(r).toMatch(/min-height:\s*44px/);
		expect(r).toMatch(/height:\s*auto/);
		expect(r).toMatch(/white-space:\s*normal/);
		expect(r).toMatch(/overflow-wrap:\s*break-word/);
		// The body is a flex column: without this the button shrinks to min-height and the text leaves it.
		expect(r).toMatch(/flex:\s*none/);
	});

	it('the ID line is never smaller than 12 px', () => {
		// D218: the Small role, which keeps a 12 px floor on a computer (01-base.css).
		expect(rule('.dynasty-sheet-id')).toContain('font-size: var(--dynasty-type-small)');
		expect(css).toContain('--dynasty-type-small: max(12px, var(--font-ui-smaller))');
	});
});

describe('The STE editor rewrites', () => {
	it('the texts', () => {
		expect(UI.ID_UI.anchor).toBe(
			'The plugin cannot save. The tree text writes an ID in this window with a YAML anchor (&name) or alias (*name). These marks copy text from another place in the tree text. Edit the ID in the tree text yourself. The note did not change. Your changes are still in the window.',
		);
		expect(UI.FOCUS_UI.unpinLabel('Aldric')).toBe('Remove pin: do not open this tree on the family of Aldric each time');
		expect(UI.FOCUS_UI.pinLabel('Aldric')).toBe('Pin focus here: always open this tree on the family of Aldric');
		expect(UI.FLOW.pickerSearchLabel).toBe('Find a person');
		expect(UI.SETTINGS_UI.cacheDesc).toBe('The plugin remembers how it arranged each tree. This makes trees open quickly. If a tree looks wrong, select Arrange again.');
	});

	it('the visible text starts the name of Pin focus here and Remove pin', () => {
		expect(UI.FOCUS_UI.pinLabel('X').startsWith(`${UI.FOCUS_UI.pin}:`)).toBe(true);
		expect(UI.FOCUS_UI.unpinLabel('X').startsWith(`${UI.FOCUS_UI.unpin}:`)).toBe(true);
	});
});

describe('X10: one constant for a text that two places show', () => {
	it('the stale text of the Houses and the Titles windows, the note button, the person placeholders', () => {
		expect(UI.HOUSES.stale).toBe(UI.TITLES_UI.stale);
		expect(UI.HOUSE_PAGE_UI.makeNote).toBe(UI.TITLES_UI.makeNote);
		expect(UI.FULL_UI.findPlaceholder).toBe(UI.FOCUS_UI.pickerPlaceholder);
		expect(UI.FINDER_UI.placeholder).toBe(UI.FOCUS_UI.pickerPlaceholder);
	});

	it('the source has each of these strings one time', () => {
		const src = ['ui-text', 'view-text', 'succession-text'].map((f) => readFileSync(new URL(`../src/render/${f}.ts`, import.meta.url), 'utf8')).join(' ');
		for (const s of ['The tree changed after you opened this window.', "'Make a note with this table'", "'Type a name'", 'The plugin updates the tree links to the renamed note.', 'The trees have no links to the renamed note.']) {
			expect(src.split(s).length - 1, s).toBe(1);
		}
	});
});

describe('Small items of review B', () => {
	it('the question layer of the edit sheet has a name that points to its title', async () => {
		const sheet = EditSheet.create({} as never, { handle: writingHandle(BODY) as never, personId: 'b', sourcePath: 'n.md' })!;
		sheet.open();
		const modalEl = (sheet as unknown as { modalEl: FEl }).modalEl;
		const input = modalEl.querySelector('.dynasty-sheet-input')!;
		type(input, 'Bran the Younger');
		(sheet as unknown as { close(): void }).close();
		await settle();
		const layer = modalEl.querySelector('.dynasty-sheet-confirm')!;
		expect(layer).not.toBeNull();
		const id = layer.getAttribute('aria-labelledby') ?? '';
		expect(id).not.toBe('');
		expect(layer.all().find((e) => e.getAttribute('id') === id)?.getText()).toBe(UI.SHEET.discardTitle);
	});

	it('a refused Save in the Houses window keeps an earlier "the tree changed" message', async () => {
		const body = ['houses:', '  - {id: valmont, name: House Valmont}', '  - {id: thorne, name: House Thorne}', 'people:', '  - {id: a, name: Aldric, house: valmont}', ''].join('\n');
		const h = writingHandle(body);
		const win = HousesWindow.create(fakeApp() as never, { handle: h as never, sourcePath: 'n.md' })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		// 0.2.5 (D134): Change ID is on the edit page of the house; a refused Save opens that page and shows the reason there.
		await click(openPage(content, 'valmont').querySelector('.dynasty-id-open'));
		const idWin = (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;
		type(idWin.querySelector('.dynasty-id-input')!, 'house-valmont');
		await click(idWin.querySelector('.dynasty-id-use'));
		backToList(content);
		await click(content.querySelector('.dynasty-house-add'));
		type(pageOf(content).querySelector('textarea')!, 'House Valmont');
		(win as unknown as { showError(t: string): void }).showError(UI.HOUSES.stale);
		await click(content.querySelector('.dynasty-sheet-save'));
		expect(content.querySelector('.dynasty-lw-page[data-house="valmont"] .dynasty-id-new-problem')!.getText()).toBe(UI.ID_UI.taken);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(UI.HOUSES.stale);
	});
});
