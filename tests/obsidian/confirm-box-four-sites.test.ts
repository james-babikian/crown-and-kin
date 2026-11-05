import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { confirmBox } from '../../src/obsidian/window-parts';
import { SHEET } from '../../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { stripNotDisabled, type, writingHandle } from '../support/windows-sheets-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The shared question box (`confirmBox` in window-parts.ts) must be able to draw each of the four boxes that the windows draw
 * today, with the same elements, classes, ids and text: two of them name themselves for a screen reader (`aria-labelledby`),
 * two do not. The `legacy*` functions are the code of the four sites as it stood when the shared box was added; the edit sheet
 * is also read from its real window.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	vi.spyOn(Math, 'random').mockReturnValue(0.123456);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

interface Shape {
	tag: string;
	classes: string[];
	attrs: [string, string][];
	text: string;
	children: Shape[];
}

const shape = (el: FEl): Shape => ({ tag: el.tag, classes: [...el.classes], attrs: [...el.attrs.entries()], text: el.text, children: el.children.map(shape) });
const modal = (): FEl => new FEl('div');
/** The index of the button that has the focus, counted over all buttons of the layer in document order. */
const focused = (layer: FEl): number => {
	const all: FEl[] = [];
	const walk = (e: FEl) => (e.tag === 'button' ? all.push(e) : e.children.forEach(walk));
	walk(layer);
	return all.indexOf(fakeDoc.activeElement as FEl);
};
const nothing = () => undefined;

// ---------- the four sites, as they stood ----------

/** `edit-sheet-base.ts` `showConfirm`. */
function legacySheet(modalEl: FEl, c: { title: string; text: string[]; confirm: string; confirmCls: string; keep?: string }): FEl {
	const layer = modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
	const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
	const titleEl = box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: c.title });
	const titleId = `dynasty-sheet-confirm-${Math.random().toString(36).slice(2, 8)}`;
	titleEl.setAttribute('id', titleId);
	layer.setAttribute('aria-labelledby', titleId);
	for (const t of c.text) box.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
	const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
	const keep = row.createEl('button', { cls: 'dynasty-sheet-keep', text: c.keep ?? SHEET.keepEditing, attr: { type: 'button' } });
	row.createEl('button', { cls: ['mod-warning', c.confirmCls], text: c.confirm, attr: { type: 'button' } });
	keep.focus();
	return layer;
}

/** `small-form.ts` `close`, the question "Discard changes?". */
function legacySmallForm(modalEl: FEl, text: string): FEl {
	const layer = modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
	const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
	box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: SHEET.discardTitle });
	box.createDiv({ cls: 'dynasty-sheet-confirm-text', text });
	const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
	const keep = row.createEl('button', { cls: 'dynasty-sheet-keep', text: SHEET.keepEditing, attr: { type: 'button' } });
	row.createEl('button', { cls: ['mod-warning', 'dynasty-sheet-discard'], text: SHEET.discard, attr: { type: 'button' } });
	keep.focus();
	return layer;
}

/** `edit-sheet-actions.ts` `askSameName`. */
function legacySameName(modalEl: FEl, title: string, link: string, make: string): FEl {
	const layer = modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
	const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
	box.createDiv({ cls: 'dynasty-sheet-confirm-title', text: title });
	const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
	const cancel = row.createEl('button', { cls: 'dynasty-sheet-keep', text: 'Cancel', attr: { type: 'button' } });
	row.createEl('button', { cls: 'dynasty-note-ask-link', text: link, attr: { type: 'button' } });
	row.createEl('button', { cls: 'dynasty-note-ask-new', text: make, attr: { type: 'button' } });
	cancel.focus();
	return layer;
}

interface ListButton {
	label: string;
	detail?: string;
	cls: string;
}

/** `list-window.ts` `showConfirm`. */
function legacyListWindow(modalEl: FEl, kind: string, title: string, text: string[], buttons: ListButton[]): FEl {
	const layer = modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
	const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
	const scroll = box.createDiv({ cls: 'dynasty-sheet-confirm-scroll' });
	const titleEl = scroll.createDiv({ cls: 'dynasty-sheet-confirm-title', text: title });
	const titleId = `dynasty-${kind}-confirm-${Math.random().toString(36).slice(2, 8)}`;
	titleEl.setAttribute('id', titleId);
	layer.setAttribute('aria-labelledby', titleId);
	for (const t of text) scroll.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
	const choices = buttons.some((b) => b.detail !== undefined) ? box.createDiv({ cls: 'dynasty-choice-options' }) : null;
	const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
	let first: FEl | null = null;
	for (const b of buttons) {
		const el = (b.detail !== undefined && choices ? choices : row).createEl('button', { cls: b.cls.split(' '), attr: { type: 'button' } });
		if (b.detail !== undefined) {
			el.createSpan({ cls: 'dynasty-choice-label', text: b.label });
			el.createSpan({ cls: 'dynasty-choice-detail', text: b.detail });
		} else el.setText(b.label);
		first ??= el;
	}
	first?.focus();
	return layer;
}

// ---------- the same boxes from the shared builder ----------

describe('confirmBox draws each of the four boxes as its site draws it today', () => {
	it('the edit sheet box: the title names the box; title and text sit directly in the box', () => {
		const c = { title: 'Delete Aldric?', text: ['First line.', 'Second line.'], confirm: 'Delete', confirmCls: 'dynasty-delete-confirm' };
		const old = legacySheet(modal(), c);
		const oldFocus = focused(old);
		const made = confirmBox(modal() as never, {
			title: c.title,
			text: c.text,
			labelled: 'dynasty-sheet-confirm',
			buttons: [
				{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: nothing },
				{ label: c.confirm, cls: ['mod-warning', c.confirmCls], run: nothing },
			],
		});
		expect(shape(made.layer as never)).toEqual(shape(old));
		expect(focused(made.layer as never)).toBe(oldFocus);
		expect(oldFocus).toBe(0);
		expect(made.layer.getAttribute('aria-labelledby')).toBe(made.layer.querySelector('.dynasty-sheet-confirm-title')!.getAttribute('id'));
	});

	it('the small form box: no name for a screen reader, no id on the title', () => {
		const old = legacySmallForm(modal(), 'Your changes are lost.');
		const oldFocus = focused(old);
		const made = confirmBox(modal() as never, {
			title: SHEET.discardTitle,
			text: ['Your changes are lost.'],
			buttons: [
				{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: nothing },
				{ label: SHEET.discard, cls: ['mod-warning', 'dynasty-sheet-discard'], run: nothing },
			],
		});
		expect(shape(made.layer as never)).toEqual(shape(old));
		expect(made.layer.getAttribute('aria-labelledby')).toBeNull();
		expect(made.layer.querySelector('.dynasty-sheet-confirm-title')!.getAttribute('id')).toBeNull();
		expect(focused(made.layer as never)).toBe(oldFocus);
	});

	it('the same-name box: a title, no text, three buttons with plain class strings, no name', () => {
		const old = legacySameName(modal(), 'A note named Aldric exists.', 'Link it', 'Make Aldric 2');
		const made = confirmBox(modal() as never, {
			title: 'A note named Aldric exists.',
			buttons: [
				{ label: 'Cancel', cls: 'dynasty-sheet-keep', run: nothing },
				{ label: 'Link it', cls: 'dynasty-note-ask-link', run: nothing },
				{ label: 'Make Aldric 2', cls: 'dynasty-note-ask-new', run: nothing },
			],
		});
		expect(shape(made.layer as never)).toEqual(shape(old));
		expect(made.layer.getAttribute('aria-labelledby')).toBeNull();
		expect(focused(made.layer as never)).toBe(0);
	});

	it('the list window box with choices: a scroll part, a choice list before the actions, a name from the kind', () => {
		const buttons: ListButton[] = [
			{ label: 'Clear it', detail: 'The people lose the house.', cls: 'dynasty-choice-option dynasty-house-clear' },
			{ label: 'Keep it', detail: 'The people keep the house name.', cls: 'dynasty-choice-option dynasty-house-keep' },
			{ label: 'Cancel', cls: 'dynasty-sheet-keep' },
		];
		const old = legacyListWindow(modal(), 'houses', 'Delete House Valmont?', ['One line.', 'Two line.'], buttons);
		const oldFocus = focused(old);
		const made = confirmBox(modal() as never, {
			title: 'Delete House Valmont?',
			text: ['One line.', 'Two line.'],
			labelled: 'dynasty-houses-confirm',
			scroll: true,
			buttons: buttons.map((b) => ({ label: b.label, detail: b.detail, cls: b.cls.split(' '), run: nothing })),
		});
		expect(shape(made.layer as never)).toEqual(shape(old));
		expect(oldFocus).toBe(0);
		expect(focused(made.layer as never)).toBe(oldFocus);
		expect(made.layer.querySelector('.dynasty-choice-options')).not.toBeNull();
	});

	it('the list window box without choices has no choice list', () => {
		const buttons: ListButton[] = [
			{ label: 'Keep editing', cls: 'dynasty-sheet-keep' },
			{ label: 'Discard', cls: 'mod-warning dynasty-sheet-discard' },
		];
		const old = legacyListWindow(modal(), 'titles', 'Discard changes?', ['Lost.'], buttons);
		const made = confirmBox(modal() as never, {
			title: 'Discard changes?',
			text: ['Lost.'],
			labelled: 'dynasty-titles-confirm',
			scroll: true,
			buttons: buttons.map((b) => ({ label: b.label, cls: b.cls.split(' '), run: nothing })),
		});
		expect(shape(made.layer as never)).toEqual(shape(old));
		expect(made.layer.querySelector('.dynasty-choice-options')).toBeNull();
	});

	it('a click on a button calls its own run, and only that', () => {
		const a = vi.fn();
		const b = vi.fn();
		const made = confirmBox(modal() as never, {
			title: 'T',
			buttons: [
				{ label: 'A', cls: 'a', run: a },
				{ label: 'B', cls: 'b', run: b },
			],
		});
		dispatch(made.buttons[1] as never, 'click');
		expect([a.mock.calls.length, b.mock.calls.length]).toEqual([0, 1]);
		dispatch(made.buttons[0] as never, 'click');
		expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
	});

	it('the box is appended to the window it is given, and a box with no button takes no focus', () => {
		const host = modal();
		const made = confirmBox(host as never, { title: 'T', buttons: [] });
		expect(host.children).toEqual([made.layer]);
		expect(made.buttons).toEqual([]);
	});
});

describe('the real edit sheet draws the box that confirmBox can draw', () => {
	it('"Discard changes?" over the edit sheet', () => {
		const h = writingHandle(['people:', '  - id: a', '    name: Aldric', ''].join('\n'));
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		s.open();
		const m = (s as unknown as { modalEl: FEl }).modalEl;
		type(m.querySelector('[data-field="title"] input')!, 'Lord');
		s.close();
		const real = m.querySelector('.dynasty-sheet-confirm')!;
		const text = real.querySelectorAll('.dynasty-sheet-confirm-text').map((e) => e.text);
		const made = confirmBox(modal() as never, {
			title: real.querySelector('.dynasty-sheet-confirm-title')!.text,
			text,
			labelled: 'dynasty-sheet-confirm',
			buttons: [
				{ label: SHEET.keepEditing, cls: 'dynasty-sheet-keep', run: nothing },
				{ label: SHEET.discard, cls: ['mod-warning', 'dynasty-sheet-discard'], run: nothing },
			],
		});
		expect(shape(made.layer as never)).toEqual(shape(real));
		expect(text).toEqual([SHEET.discardText]);
	});
});
