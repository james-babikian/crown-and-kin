import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { parseCalendarBlock } from '../../src/core/calendar-block';
import { compileCalendars } from '../../src/core/dates';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { attachDateLine } from '../../src/render/dom/date-line';
import { afterPress, holdLayoutOnPress } from '../../src/render/dom/press-hold';
import { FEl, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle } from '../acceptance/tree-view-fakes';
import { cycleNote } from '../support/calendar-vault';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D319 item 1: a help or readout line that changes when a field loses the focus must not move the buttons between the press and the release.
 * The fake DOM has no layout, so the tests prove the order of events: the line stays as it is until the click.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const cycles = compileCalendars(parseCalendarBlock(findBlocks(cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100), 'kin-calendar')[0].body, 'Note.md', 0).calendars, true);

/** A window frame with a field, its readout line and a button below. */
function frame() {
	const root = new FEl('div', { cls: 'dynasty-sheet' });
	const row = root.createDiv({ cls: 'dynasty-sheet-field' });
	const input = row.createEl('input');
	const button = root.createEl('button');
	const stop = holdLayoutOnPress(root as unknown as HTMLElement);
	const paint = attachDateLine(row as never, input as never, () => cycles);
	return { root, row, input, button, stop, paint, line: row.querySelector('[data-readout]')! };
}

describe('the grey date line (finding B-0041)', () => {
	it('with no press under way, it changes at the blur as before', () => {
		const f = frame();
		f.input.value = '20 Year of the 3 Cycle';
		dispatch(f.input, 'blur');
		expect(f.line.getText()).toContain('Cycle 3, Year 20');
	});

	it('with a press on a button under way, it stays as it is at the blur and changes at the click', () => {
		const f = frame();
		f.input.value = '20 Year of the 3 Cycle';
		dispatch(f.button, 'pointerdown');
		dispatch(f.input, 'blur');
		expect(f.line.getText()).toBe('');
		dispatch(f.button, 'click');
		expect(f.line.getText()).toContain('Cycle 3, Year 20');
	});

	it('it also changes a short time after the release when no click comes (a drag away from the button)', () => {
		const root = new FEl('div', { cls: 'dynasty-sheet' });
		const document = new Map<string, () => void>();
		Object.defineProperty(root, 'doc', { value: { addEventListener: (t: string, fn: () => void) => document.set(t, fn), removeEventListener: () => undefined } });
		const button = root.createEl('button');
		holdLayoutOnPress(root as never);
		const ran = vi.fn();
		dispatch(button, 'pointerdown');
		afterPress(button as never, 'a', ran);
		document.get('pointerup')!();
		runTimers(100);
		expect(ran).not.toHaveBeenCalled();
		runTimers(10_000);
		expect(ran).toHaveBeenCalledTimes(1);
	});

	it('a field that blurs twice during one press repaints once, with the text of the field at the click', () => {
		const f = frame();
		const paint = vi.fn();
		dispatch(f.button, 'pointerdown');
		afterPress(f.input as never, f.input, () => paint('first'));
		afterPress(f.input as never, f.input, () => paint('second'));
		expect(paint).not.toHaveBeenCalled();
		dispatch(f.button, 'click');
		expect(paint.mock.calls).toEqual([['second']]);
	});

	it('a failing held change does not stop the others, and the window is free again', () => {
		const f = frame();
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const ran = vi.fn();
		dispatch(f.button, 'pointerdown');
		afterPress(f.button as never, 'a', () => {
			throw new Error('x');
		});
		afterPress(f.button as never, 'b', ran);
		dispatch(f.button, 'click');
		expect(ran).toHaveBeenCalledTimes(1);
		expect(err).toHaveBeenCalled();
		afterPress(f.button as never, 'c', ran);
		expect(ran).toHaveBeenCalledTimes(2);
	});

	it('after the window stops its hold, a change runs at once', () => {
		const f = frame();
		f.stop();
		const ran = vi.fn();
		dispatch(f.button, 'pointerdown');
		afterPress(f.input as never, f.input, ran);
		expect(ran).toHaveBeenCalledTimes(1);
	});
});

describe('a press that never ends (D319 repair round)', () => {
	it('a right-button press holds nothing, so a later change runs at once', () => {
		const root = new FEl('div', { cls: 'dynasty-sheet' });
		const input = root.createEl('input');
		holdLayoutOnPress(root as never);
		dispatch(root, 'pointerdown', { button: 2, pointerType: 'mouse' });
		const ran = vi.fn();
		afterPress(input as never, input, ran);
		expect(ran).toHaveBeenCalledTimes(1);
	});

	it('a touch or pen press (button 0) and a press with no button value still hold', () => {
		for (const init of [{ button: 0, pointerType: 'touch' }, { button: 0, pointerType: 'pen' }, {}]) {
			const root = new FEl('div', { cls: 'dynasty-sheet' });
			const input = root.createEl('input');
			holdLayoutOnPress(root as never);
			dispatch(root, 'pointerdown', init);
			const ran = vi.fn();
			afterPress(input as never, input, ran);
			expect(ran).not.toHaveBeenCalled();
		}
	});

	it('a left press with no release, no cancel and no click lets go at 1.5 s: held changes run, then a change runs at once', () => {
		const root = new FEl('div', { cls: 'dynasty-sheet' });
		const input = root.createEl('input');
		holdLayoutOnPress(root as never);
		dispatch(root, 'pointerdown', { button: 0, pointerType: 'mouse' });
		const ran = vi.fn();
		afterPress(input as never, input, ran);
		runTimers(1499);
		expect(ran).not.toHaveBeenCalled();
		runTimers(2);
		expect(ran).toHaveBeenCalledTimes(1);
		const later = vi.fn();
		afterPress(input as never, input, later);
		expect(later).toHaveBeenCalledTimes(1);
	});

	it('the release restarts the wait: the change runs 500 ms after the release, not 1.5 s after the press', () => {
		const root = new FEl('div', { cls: 'dynasty-sheet' });
		const document = new Map<string, () => void>();
		Object.defineProperty(root, 'doc', { value: { addEventListener: (t: string, fn: () => void) => document.set(t, fn), removeEventListener: () => undefined } });
		const button = root.createEl('button');
		holdLayoutOnPress(root as never);
		const ran = vi.fn();
		dispatch(button, 'pointerdown', { button: 0 });
		afterPress(button as never, 'a', ran);
		runTimers(1000);
		document.get('pointerup')!();
		runTimers(499);
		expect(ran).not.toHaveBeenCalled();
		runTimers(2);
		expect(ran).toHaveBeenCalledTimes(1);
	});
});

describe('the help text of a field (the Marker hint of the Calendars window)', () => {
	it('a hint that shows at the press stays until the click; a hint that is hidden is not touched', () => {
		const root = new FEl('div', { cls: 'dynasty-sheet' });
		const shown = root.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'] });
		const hidden = root.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'] });
		// The fake DOM has no layout: a hint with a parent box is visible, one with none is hidden.
		Object.assign(shown, { offsetParent: root });
		Object.assign(hidden, { offsetParent: null });
		const remove = root.createEl('button');
		holdLayoutOnPress(root as never);
		dispatch(remove, 'pointerdown');
		expect(shown.hasClass('is-held')).toBe(true);
		expect(hidden.hasClass('is-held')).toBe(false);
		dispatch(remove, 'click');
		expect(shown.hasClass('is-held')).toBe(false);
	});

	it('the style sheet shows a held hint, also when its field has lost the focus', async () => {
		const { readFileSync } = await import('node:fs');
		const css = readFileSync('styles/10-edit-sheet.css', 'utf8');
		expect(css).toMatch(/\.dynasty-sheet \.dynasty-sheet-hint\.is-on-focus\.is-held \{\s*display: block;/);
	});
});

describe('the windows hold their layout', () => {
	const BODY = 'people:\n  - id: aldric\n    name: Aldric Valmont\n    born: 1\n';

	it('the person window: a date typed in Born does not change its line until the click on a button', () => {
		const handle = fakeHandle('Tree.md', BODY);
		const sheet = EditSheet.create({} as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md', dates: () => cycles })!;
		sheet.open();
		const win = sheet as unknown as { contentEl: FEl; modalEl: FEl };
		const input = win.contentEl.querySelector('[data-field="born"] input')!;
		const line = win.contentEl.querySelector('[data-field="born"] [data-readout]')!;
		const button = win.modalEl.querySelector('button')!;
		input.value = '20 Year of the 3 Cycle';
		dispatch(button, 'pointerdown');
		dispatch(input, 'blur');
		expect(line.getText()).toBe('');
		dispatch(button, 'click');
		expect(line.getText()).toContain('Cycle 3, Year 20');
	});
});
