import { beforeEach, describe, expect, it } from 'vitest';

import { clearFieldError, clearWindowError, fieldError, windowError } from '../../src/obsidian/sheet-parts';
import { FEl, fakeDoc, resetDom } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * The one rule for an error: an error about one field stands under that field and the field takes the error edge (aria-invalid);
 * an error about the whole window stands under the header. The header never moves.
 */

useFakeDom({ window: true });

beforeEach(() => resetDom());

/** A row as the windows draw it: label, control (maybe in a box), then a hint. */
function row(body: FEl, name: string, boxed = false) {
	const field = body.createDiv({ cls: 'dynasty-sheet-field', attr: { 'data-field': name } });
	field.createEl('label', { text: name });
	const holder = boxed ? field.createDiv('dynasty-select') : field;
	const input = holder.createEl('input', { attr: { id: `${name}-id` } });
	field.createDiv({ cls: 'dynasty-sheet-hint', text: 'hint' });
	return { field, input };
}

describe('the error of one field', () => {
	it('stands directly under the control, before the hint, in the error style, as an alert', () => {
		const body = new FEl('div');
		const { field, input } = row(body, 'name');
		const text = fieldError(input as never, 'Enter a name.') as unknown as FEl;
		expect(field.children.map((c) => c.getText() || c.tag)).toEqual(['name', 'input', 'Enter a name.', 'hint']);
		expect(text.hasClass('dynasty-sheet-error')).toBe(true);
		expect(text.getAttribute('role')).toBe('alert');
		expect(text.hidden).toBe(false);
	});

	it('marks the field invalid and joins it to the text, and keeps the ids that were there', () => {
		const body = new FEl('div');
		const { input } = row(body, 'name');
		input.setAttribute('aria-describedby', 'hint-1');
		const text = fieldError(input as never, 'Enter a name.') as unknown as FEl;
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe(`hint-1 ${text.getAttribute('id')}`);
	});

	it('gives the field the focus, unless the window says no', () => {
		const body = new FEl('div');
		const a = row(body, 'name').input;
		const b = row(body, 'other').input;
		fieldError(a as never, 'x');
		expect(fakeDoc.activeElement).toBe(a);
		fieldError(b as never, 'y', { focus: false });
		expect(fakeDoc.activeElement).toBe(a);
	});

	it('stands after the box that holds the control (a select with its chevron), not inside it', () => {
		const body = new FEl('div');
		const { field, input } = row(body, 'type', true);
		fieldError(input as never, 'Choose one.');
		expect(field.children.map((c) => c.classes.has('dynasty-select') || c.classes.has('dynasty-sheet-error'))).toEqual([false, true, true, false]);
	});

	it('changes its text on a second call and does not make a second line', () => {
		const body = new FEl('div');
		const { field, input } = row(body, 'name');
		const first = fieldError(input as never, 'One.');
		const second = fieldError(input as never, 'Two.');
		expect(second).toBe(first);
		expect(field.querySelectorAll('.dynasty-field-error')).toHaveLength(1);
		expect(first.getText()).toBe('Two.');
		expect(input.getAttribute('aria-describedby')).toBe(first.getAttribute('id'));
	});

	it('is taken away with the invalid mark and the id in the list; the other ids stay', () => {
		const body = new FEl('div');
		const { field, input } = row(body, 'name');
		input.setAttribute('aria-describedby', 'hint-1');
		fieldError(input as never, 'Enter a name.');
		clearFieldError(input as never);
		expect(field.querySelector('.dynasty-field-error')).toBeNull();
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBe('hint-1');
		const bare = row(body, 'bare').input;
		fieldError(bare as never, 'x');
		clearFieldError(bare as never);
		expect(bare.getAttribute('aria-describedby')).toBeNull();
		expect(() => clearFieldError(bare as never)).not.toThrow();
	});

	it('makes a new line when the window drew its form again and the old line went with it', () => {
		const body = new FEl('div');
		const { field, input } = row(body, 'name');
		const old = fieldError(input as never, 'One.');
		old.remove();
		const fresh = fieldError(input as never, 'Two.');
		expect(fresh).not.toBe(old);
		expect(field.querySelectorAll('.dynasty-field-error')).toHaveLength(1);
		expect(input.getAttribute('aria-describedby')).toBe(fresh.getAttribute('id'));
	});
});

describe('the error of the whole window', () => {
	it('stands under the header and does not move it', () => {
		const body = new FEl('div');
		const head = body.createDiv('dynasty-head');
		body.createDiv('dynasty-section');
		const line = windowError(body as never, 'The note changed.') as unknown as FEl;
		expect(body.children[0]).toBe(head);
		expect(body.children[1]).toBe(line);
		expect(line.getText()).toBe('The note changed.');
		expect(line.getAttribute('role')).toBe('alert');
	});

	it('stands at the top of a body with no header, and after a header that the window names', () => {
		const bare = new FEl('div');
		bare.createDiv('dynasty-section');
		const line = windowError(bare as never, 'x') as unknown as FEl;
		expect(bare.children[0]).toBe(line);

		const body = new FEl('div');
		const first = body.createDiv('dynasty-back-row');
		const named = body.createDiv('dynasty-lw-head');
		const second = windowError(body as never, 'y', named as never) as unknown as FEl;
		expect(body.children).toEqual([first, named, second]);
	});

	it('is one line: a second call changes the text, and it can be taken away', () => {
		const body = new FEl('div');
		body.createDiv('dynasty-head');
		const a = windowError(body as never, 'One.');
		const b = windowError(body as never, 'Two.');
		expect(b).toBe(a);
		expect(body.querySelectorAll('.dynasty-window-error')).toHaveLength(1);
		clearWindowError(body as never);
		expect(body.querySelector('.dynasty-window-error')).toBeNull();
	});
});
