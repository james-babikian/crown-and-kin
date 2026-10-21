import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { closePluginModals } from '../src/view/plugin-modals';
import { resetOpenSections } from '../src/obsidian/window-sections';
import { TitlesWindow } from '../src/obsidian/titles-window';
import { FEl, clock, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_13 } from './acceptance/titles-support';
import { fakeHost } from './acceptance/tree-view-fakes';
import { backToList, openPage } from './lw-support';
import { writingHandle } from './s113-c-support';

/*
 * G2 review of 0.2.8 wave 2, area P6 (windows). Run: npx vitest run tests/review-r028-g2-windows.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	resetOpenSections();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

function openWin() {
	const handle = writingHandle(BODY_13);
	const host = fakeHost();
	const win = TitlesWindow.create(host.app as never, { handle: handle as never, sourcePath: 'n.md' })!;
	win.open();
	const w = win as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, handle, content: w.contentEl };
}

describe('section open state', () => {
	it('a saved title page opened first does not close the Names section of a new title', () => {
		const o = openWin();
		// A saved title: Names is closed by default (the fields stay hidden, the summary shows).
		const saved = openPage(o.content, 'duke-of-valmont');
		expect(saved.querySelector('[data-section="names"]')!.hasClass('is-open')).toBe(false);
		backToList(o.content);
		// The user never touched a section, but Add title now opens its page with Names closed: there is no field to type the name in.
		dispatch(o.content.querySelector('button.dynasty-lw-add')!, 'click');
		const page = o.content.querySelector('.dynasty-lw-page')!;
		expect(page.querySelector('[data-section="names"]')!.hasClass('is-open')).toBe(true);
	});
});

describe('Titles section summary of the person window', () => {
	it('the closed section shows the reign without brackets (an internal note: "The reign has no brackets")', async () => {
		const { titlesSummary } = await import('../src/obsidian/sheet-titles');
		const { parseDynasty } = await import('../src/core/parse');
		const { deriveFamilies } = await import('../src/core/derive');
		const src = 'titles:\n  - id: duke\n    name: Duke of Quill\n    holders:\n      - {person: aldric, from: 1100, to: 1140}\npeople:\n  - {id: aldric, name: Aldric}\n';
		const r = parseDynasty(src);
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		const text = titlesSummary({ data: () => ({ g, person: g.byId.get('aldric') }) } as never);
		expect(text).not.toMatch(/[()]/);
	});
});


describe('section open state, person window', () => {
	it('a new person opens with Details open (the name field), also after the user closed Details on another person', async () => {
		const { EditSheet } = await import('../src/obsidian/edit-sheet');
		const handle = writingHandle(BODY_13);
		const host = fakeHost();
		const first = EditSheet.create(host.app as never, { handle: handle as never, personId: 'aldric', sourcePath: 'n.md' } as never)!;
		first.open();
		const root = (first as unknown as { contentEl: FEl }).contentEl;
		// The user taps the title row of Details: it closes.
		dispatch(root.querySelector('[data-section="details"] .dynasty-section-head')!, 'click');
		expect(root.querySelector('[data-section="details"]')!.hasClass('is-open')).toBe(false);
		first.close();
		const fresh = EditSheet.createNew(host.app as never, { handle: handle as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		fresh.open();
		const el = (fresh as unknown as { contentEl: FEl }).contentEl;
		expect(el.querySelector('[data-section="details"]')!.hasClass('is-open')).toBe(true);
	});
});
