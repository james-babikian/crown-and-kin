import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { openState, renderSections, resetOpenSections, type SectionSpec } from '../src/obsidian/window-sections';
import { buildShell } from '../src/obsidian/window-shell';
import { buildRow, iconLead, personLead } from '../src/obsidian/window-parts';
import { WINDOW_UI } from '../src/render/ui-text';
import { FEl, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';

/*
 * 0.2.8 P6: the three shared parts of the window family (contract C, G.1, G.13): the frame (`buildShell`), the sections with their
 * summaries and "Open all" (`renderSections`), and the row (`buildRow`, `personLead`). The windows have their own tests; these pin the
 * parts that every window shares.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	resetOpenSections();
});

afterEach(() => vi.restoreAllMocks());

/** The shell as the fake DOM sees it. */
interface FakeShell {
	body: FEl;
	bar: FEl | null;
	foot: FEl | null;
	titleEl: FEl;
	cancel: FEl;
	save: FEl | null;
	setTitle(text: string, always?: boolean): void;
	setBack(label: string | null, aria: string, run: () => void): void;
}

function frame(phone: boolean) {
	const modalEl = new FEl('div');
	if (phone) modalEl.addClass('is-phone');
	const contentEl = modalEl.createDiv();
	const log = { cancel: 0, save: 0 };
	const shell = buildShell({ modalEl: modalEl as never, contentEl: contentEl as never, title: 'Edit Aldric', onCancel: () => log.cancel++, onSave: () => log.save++ }) as unknown as FakeShell;
	return { modalEl, contentEl, shell, log };
}

describe('the shell: a footer on a computer, a bar on a phone', () => {
	it('a computer: the body, then the footer with Cancel and Save; no bar and no X (C04)', () => {
		const { contentEl, shell, log } = frame(false);
		expect(shell.bar).toBeNull();
		expect(shell.foot).not.toBeNull();
		expect(contentEl.querySelector('.dynasty-bar')).toBeNull();
		expect(shell.foot!.querySelectorAll('button').map((b) => b.getText())).toEqual(['Cancel', 'Save']);
		dispatch(shell.cancel, 'click');
		dispatch(shell.save!, 'click');
		expect(log).toEqual({ cancel: 1, save: 1 });
	});

	it('a phone: the bar has Cancel, the title and Save; the title shows at once only when the window asks for it', () => {
		const { shell, modalEl } = frame(true);
		expect(shell.foot).toBeNull();
		expect(shell.bar!.children.map((c) => c.getText())).toEqual(['Cancel', 'Edit Aldric', 'Save']);
		expect(modalEl.hasClass('is-bar')).toBe(true);
		expect(shell.bar!.hasClass('is-titled')).toBe(false);
		shell.setTitle('Aldric Valmont', true);
		expect(shell.bar!.hasClass('is-titled')).toBe(true);
		expect(shell.titleEl.getText()).toBe('Aldric Valmont');
	});

	it('a second page: "‹ Name" in the bar on a phone, a back link in the body on a computer, and Cancel again when there is no way back', () => {
		const phone = frame(true);
		const back = vi.fn();
		phone.shell.setBack('Aldric', 'Back to Aldric', back);
		expect(phone.shell.cancel.getAttribute('data-focus')).toBe('back');
		expect(phone.shell.cancel.getAttribute('aria-label')).toBe('Back to Aldric');
		dispatch(phone.shell.cancel, 'click');
		expect(back).toHaveBeenCalledTimes(1);
		expect(phone.log.cancel).toBe(0);
		phone.shell.setBack(null, '', () => undefined);
		expect(phone.shell.cancel.getText()).toBe('Cancel');
		dispatch(phone.shell.cancel, 'click');
		expect(phone.log.cancel).toBe(1);

		const desk = frame(false);
		desk.shell.setBack('Aldric', 'Back to Aldric', back);
		const link = desk.shell.body.querySelector('.dynasty-back')!;
		expect(link.getAttribute('data-focus')).toBe('back');
		expect(desk.shell.body.children[0]!.hasClass('dynasty-back-row')).toBe(true);
		dispatch(link, 'click');
		expect(back).toHaveBeenCalledTimes(2);
		desk.shell.setBack(null, '', () => undefined);
		expect(desk.shell.body.querySelector('.dynasty-back')).toBeNull();
	});
});

describe('the sections', () => {
	const specs = (log: string[]): SectionSpec[] => [
		{ key: 'one', title: 'Details', summary: 'Aldric', open: true, build: (b) => (log.push('one'), void b.createDiv({ text: 'first' })) },
		{ key: 'two', title: 'Family', summary: '2 parents', open: false, build: (b) => (log.push('two'), void b.createDiv({ text: 'second' })) },
	];

	it('each section is a button with its title and its summary; the body of a closed section is built and hidden from the reader', () => {
		const log: string[] = [];
		const host = new FEl('div');
		const view = renderSections(host as never, 'test', specs(log));
		expect(log).toEqual(['one', 'two']);
		const heads = host.querySelectorAll('.dynasty-section-head');
		expect(heads.map((h) => h.querySelector('.dynasty-section-title')!.getText())).toEqual(['Details', 'Family']);
		expect(heads.map((h) => h.querySelector('.dynasty-section-sum')!.getText())).toEqual(['Aldric', '2 parents']);
		expect(heads.map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
		expect(view.isOpen('one')).toBe(true);
		expect(view.isOpen('two')).toBe(false);
		dispatch(heads[1]!, 'click');
		expect(view.isOpen('two')).toBe(true);
		expect(heads[1]!.getAttribute('aria-expanded')).toBe('true');
	});

	it('Open all opens every section; when all are open it reads Close all and closes them', () => {
		const host = new FEl('div');
		const view = renderSections(host as never, 'test', specs([]));
		const all = host.querySelector('.dynasty-openall-button')!;
		expect(all.getText()).toBe(WINDOW_UI.openAll);
		dispatch(all, 'click');
		expect(view.isOpen('two')).toBe(true);
		expect(all.getText()).toBe(WINDOW_UI.closeAll);
		expect(all.getAttribute('aria-label')).toBe(WINDOW_UI.closeAllLabel);
		dispatch(all, 'click');
		expect(view.isOpen('one')).toBe(false);
		expect(view.isOpen('two')).toBe(false);
		expect(all.getText()).toBe(WINDOW_UI.openAll);
	});

	it('a window with one section has no Open all', () => {
		const host = new FEl('div');
		renderSections(host as never, 'test', [specs([])[0]!]);
		expect(host.querySelector('.dynasty-openall')).toBeNull();
	});

	it('the open state is kept for each kind of window; a window that draws again keeps what the user opened', () => {
		const first = new FEl('div');
		renderSections(first as never, 'person', specs([]));
		dispatch(first.querySelectorAll('.dynasty-section-head')[1]!, 'click');
		dispatch(first.querySelectorAll('.dynasty-section-head')[0]!, 'click');
		expect(openState('person', 'two')).toBe(true);
		expect(openState('person', 'one')).toBe(false);
		const again = new FEl('div');
		const view = renderSections(again as never, 'person', specs([]));
		expect(view.isOpen('two')).toBe(true);
		expect(view.isOpen('one')).toBe(false);
		// Another kind of window starts from the defaults.
		expect(renderSections(new FEl('div') as never, 'titles', specs([])).isOpen('one')).toBe(true);
	});

	it('setSummary changes the line of a section and leaves an equal text alone', () => {
		const host = new FEl('div');
		const view = renderSections(host as never, 'test', specs([]));
		view.setSummary('two', '1 parent');
		expect(view.el('two')!.querySelector('.dynasty-section-sum')!.getText()).toBe('1 parent');
		expect(view.el('missing')).toBeNull();
	});
});

describe('the row', () => {
	it('a tap row is one button with the lead, two text lines and a chevron; a plain row is a div with actions', () => {
		const host = new FEl('div');
		const tap = vi.fn();
		const r = buildRow(host as never, { tap, label: 'Open Aldric', lead: (row) => iconLead(row, 'crown') }) as unknown as { row: FEl; title: FEl; sub: FEl };
		r.title.setText('Aldric');
		r.sub.setText('1140–1210');
		expect(r.row.tag).toBe('button');
		expect(r.row.getAttribute('aria-label')).toBe('Open Aldric');
		expect(r.row.querySelector('.dynasty-row-chev')).not.toBeNull();
		dispatch(r.row, 'click');
		expect(tap).toHaveBeenCalledTimes(1);

		const plain = buildRow(host as never, {}) as unknown as { row: FEl; actions(): FEl };
		expect(plain.row.tag).toBe('div');
		expect(plain.row.querySelector('.dynasty-row-chev')).toBeNull();
		plain.actions().createEl('button', { text: 'x' });
		expect(plain.row.querySelector('.dynasty-row-actions button')).not.toBeNull();
		expect(buildRow(host as never, { tap: () => undefined, chevron: false }).row.querySelector('.dynasty-row-chev')).toBeNull();
	});

	it('the lead of a person is a round picture slot, hidden from the reader (G.1); a person with no picture has no lead and no initials (D213)', () => {
		const host = new FEl('div');
		const shown: string[] = [];
		const pictures = { has: (l: string | undefined) => l === '[[a.png]]', show: (_slot: unknown, link: string | undefined) => void shown.push(String(link)) };
		const lead = personLead(host as never, { name: 'Aldric Valmont', portrait: '[[a.png]]' }, pictures as never) as unknown as FEl;
		expect(lead.getAttribute('aria-hidden')).toBe('true');
		expect(lead.hasClass('is-picture')).toBe(true);
		expect(lead.hasClass('is-small')).toBe(true);
		expect(lead.querySelector('.dynasty-row-initials')).toBeNull();
		expect((personLead(host as never, { name: 'Aldric Valmont', portrait: '[[a.png]]' }, pictures as never, 44) as unknown as FEl).hasClass('is-large')).toBe(true);
		expect(shown).toEqual(['[[a.png]]', '[[a.png]]']);
		// No portrait, a link that the store cannot find, and no store: nothing is drawn.
		expect(personLead(host as never, { name: 'Aldric Valmont' }, pictures as never)).toBeNull();
		expect(personLead(host as never, { name: 'Aldric Valmont', portrait: '[[b.png]]' }, pictures as never)).toBeNull();
		expect(personLead(host as never, { name: 'Aldric Valmont', portrait: '[[a.png]]' }, undefined)).toBeNull();
		expect(host.querySelectorAll('.dynasty-row-lead')).toHaveLength(2);
	});

	it('a picture lead stands after the text, a mark (an icon) before it, so names line up with or without a picture (D213)', () => {
		const host = new FEl('div');
		const pictures = { has: () => true, show: () => undefined };
		const withPicture = buildRow(host as never, { lead: (row) => void personLead(row, { name: 'A', portrait: 'x' }, pictures as never) }) as unknown as { row: FEl };
		const kids = (row: FEl) => row.children.map((c) => (c.hasClass('dynasty-row-lead') ? 'lead' : c.hasClass('dynasty-row-text') ? 'text' : '?'));
		expect(kids(withPicture.row)).toEqual(['text', 'lead']);
		const withIcon = buildRow(host as never, { lead: (row) => void iconLead(row, 'crown') }) as unknown as { row: FEl };
		expect(kids(withIcon.row)).toEqual(['lead', 'text']);
		const without = buildRow(host as never, { lead: (row) => void personLead(row, { name: 'A' }, { has: () => false, show: () => undefined } as never) }) as unknown as { row: FEl };
		expect(kids(without.row)).toEqual(['text']);
	});
});
