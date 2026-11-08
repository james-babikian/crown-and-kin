import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted answers for each step of a flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { NEW_SHEET, SHEET, WRITE_TEXT } from '../../src/render/ui-text';
import { NEW_HOUSE } from '../../src/view/sheet-draft';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { writingHandle } from '../support/windows-sheets-support';

/*
 * D330 W-02, CX-11 (one rule for an error: under its field with the error edge, or under the header), O-13 (Close after a write), O-14 (Cancel asks as Esc does),
 * UX-22 (one heading for a new person), CX-18 (the phone bar title is one text line) and the label of Save while a write runs.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - {id: a, name: Aldric, sex: m, born: 1102}', '  - {id: b, name: Bran, parents: [a], born: 1130}', '  - {id: c, name: Cora, sex: f, born: 1131}', ''].join('\n');

function open(id: string) {
	const h = writingHandle(BODY);
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return { h, s };
}
function openNew(rel: unknown, name?: string) {
	const h = writingHandle(BODY);
	const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: rel, ...(name ? { initialName: name } : {}) } as never)!;
	s.open();
	return { h, s };
}
const modalOf = (s: unknown) => (s as { modalEl: FEl }).modalEl;
const type = (m: FEl, field: string, value: string) => {
	const input = m.querySelector(`[data-field="${field}"] input`) as FEl;
	input.value = value;
	dispatch(input, 'input');
	return input;
};
const leftButton = (m: FEl) => m.querySelector('.dynasty-sheet-cancel')!;

describe('an error about one field stands under that field (W-02)', () => {
	it('a new person with no name: the line stands under the Name field, the field has the error edge and the focus, and nothing stands above the header', () => {
		const { s } = openNew({ kind: 'person' });
		const m = modalOf(s);
		dispatch(m.querySelector('.dynasty-sheet-save')!, 'click');
		const field = m.querySelector('[data-field="name"]')!;
		const input = field.querySelector('input') as FEl;
		const error = field.querySelector('.dynasty-field-error')!;
		expect(error.getText()).toBe(SHEET.needName);
		expect(error.getAttribute('role')).toBe('alert');
		// Directly after the field, in the field's own box.
		expect(field.children[field.children.indexOf(input) + 1]).toBe(error);
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toContain(error.getAttribute('id')!);
		// The header is the first part of the body: no error line stands above it, and the window has no error about the whole window.
		const body = m.querySelector('.dynasty-sheet-body')!;
		expect(body.children.find((c) => c.hasClass('dynasty-sheet-error'))).toBeUndefined();
		expect(m.querySelector('.dynasty-window-error')).toBeNull();
		expect(body.querySelector('.dynasty-head')).not.toBeNull();
	});

	it('typing in the field takes the error away', () => {
		const { s } = openNew({ kind: 'person' });
		const m = modalOf(s);
		dispatch(m.querySelector('.dynasty-sheet-save')!, 'click');
		const input = type(m, 'name', 'E');
		expect(m.querySelector('.dynasty-field-error')).toBeNull();
		expect(input.getAttribute('aria-invalid')).toBeNull();
	});

	it('a new house with no name: the line stands under the name of the new house', () => {
		const { s } = open('a');
		const m = modalOf(s);
		const house = m.querySelector('[data-field="house"] select') as FEl;
		house.value = NEW_HOUSE;
		dispatch(house, 'change');
		dispatch(m.querySelector('.dynasty-sheet-save')!, 'click');
		const field = m.querySelector('[data-field="new-house-name"]')!;
		expect(field.querySelector('.dynasty-field-error')!.getText()).toBe(SHEET.needHouseName);
		expect(field.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
	});

	it('an error about the whole window (a refused write) stands under the header, once, and the header does not move', async () => {
		const { h, s } = open('a');
		const m = modalOf(s);
		type(m, 'name', 'Aldrik');
		h.write.mockImplementationOnce((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'cycle' } })) as never);
		const head = m.querySelector('.dynasty-head')!;
		const body = head.parentElement!;
		const before = body.children.indexOf(head);
		dispatch(m.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		const line = m.querySelector('.dynasty-window-error')!;
		expect(line.getText()).toBe(WRITE_TEXT.cycle);
		expect(body.children[body.children.indexOf(head) + 1]).toBe(line);
		expect(body.children.indexOf(head)).toBe(before);
		expect(m.querySelectorAll('.dynasty-window-error')).toHaveLength(1);
		// A change in a field takes it away.
		type(m, 'name', 'Aldrick');
		expect(m.querySelector('.dynasty-window-error')).toBeNull();
	});
});

describe('the left button (O-13, O-14)', () => {
	it('says Cancel while the window only edits, and Close once it wrote something', async () => {
		const { s } = open('a');
		const m = modalOf(s);
		expect(leftButton(m).getText()).toBe(SHEET.cancel);
		answers.push('existing', { kind: 'person', id: 'c' }, 'marriage');
		dispatch(m.querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		// The window drew again after the write: the button still says Close.
		expect(leftButton(modalOf(s)).getText()).toBe(SHEET.close);
	});

	it('Cancel with a typed change asks the question that Esc asks; "Continue to edit" keeps the window; Cancel with no change closes', async () => {
		const { s } = open('a');
		const m = modalOf(s);
		type(m, 'sobriquet', 'the Bold');
		dispatch(leftButton(m), 'click');
		const box = m.querySelector('.dynasty-sheet-confirm')!;
		expect(box.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(openModals).toHaveLength(1);
		dispatch(box.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(m.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(openModals).toHaveLength(1);
		dispatch(leftButton(m), 'click');
		dispatch(m.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(openModals).toHaveLength(0);

		const again = open('a');
		dispatch(leftButton(modalOf(again.s)), 'click');
		expect(openModals).toHaveLength(0);
	});

	it('after a write with a typed change, Close asks too', async () => {
		const { s } = open('a');
		const m = modalOf(s);
		answers.push('existing', { kind: 'person', id: 'c' }, 'marriage');
		dispatch(m.querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		type(modalOf(s), 'sobriquet', 'the Bold');
		dispatch(leftButton(modalOf(s)), 'click');
		expect(modalOf(s).querySelector('.dynasty-sheet-confirm')).not.toBeNull();
	});

	it('the label of Save goes through the shell: "Wait" while a write runs, "Save" after', () => {
		const { s } = open('a');
		const save = modalOf(s).querySelector('.dynasty-sheet-save')!;
		(s as unknown as { showSaving(on: boolean): void }).showSaving(true);
		expect(save.getText()).toBe(SHEET.saveWait);
		(s as unknown as { showSaving(on: boolean): void }).showSaving(false);
		expect(save.getText().startsWith(SHEET.save)).toBe(true);
	});
});

describe('one heading for a new person (UX-22)', () => {
	it('a new person has the heading "New person" and the placeholder in the Name field; nothing says "Enter a name below"', () => {
		const { s } = openNew({ kind: 'person' });
		const m = modalOf(s);
		expect(m.querySelector('.dynasty-head-name')!.getText()).toBe(NEW_SHEET.titlePerson);
		expect(m.querySelector('[data-field="name"] input')!.getAttribute('placeholder')).toBe(NEW_SHEET.namePlaceholder);
		expect(NEW_SHEET.namePlaceholder).toBe('For example: Edmund Vane');
		expect(m.getText()).not.toContain('Enter a name below');
		// The detail line has nothing to say for a person with no relative: it takes no room.
		expect(m.querySelector('.dynasty-head-meta')).toBeNull();
	});

	it('a new child has the heading "New child" and, under it, whose child; the heading becomes the name when it is typed, and the detail line does not change', () => {
		const { s } = openNew({ kind: 'child', parent: 'a', other: null });
		const m = modalOf(s);
		expect(m.querySelector('.dynasty-head-name')!.getText()).toBe(NEW_SHEET.titleChild);
		const meta = () => m.querySelector('.dynasty-head-meta')!.getText();
		expect(meta()).toBe('Child of Aldric');
		type(m, 'name', 'Edda');
		expect(m.querySelector('.dynasty-head-name')!.getText()).toBe('Edda');
		expect(meta()).toBe('Child of Aldric');
	});

	// B-0064, D336: the rule `.dynasty-grid > .is-wide` is in the CSS (new-person-name-placeholder-fits); here the form puts the class on both windows.
	it('Name and Sobriquet have a row each (is-wide) in the window of a new person and in the window of a person in the tree', () => {
		for (const m of [modalOf(openNew({ kind: 'person' }).s), modalOf(open('a').s)]) {
			for (const field of ['name', 'sobriquet']) expect(m.querySelector(`[data-field="${field}"]`)!.hasClass('is-wide'), field).toBe(true);
			// The other short fields keep two in a row.
			for (const field of ['born', 'died']) expect(m.querySelector(`[data-field="${field}"]`)!.hasClass('is-wide'), field).toBe(false);
		}
	});

	it('a person in the tree keeps its name and an unnamed person says so', () => {
		const { s } = open('a');
		expect(modalOf(s).querySelector('.dynasty-head-name')!.getText()).toBe('Aldric');
		expect(modalOf(s).querySelector('[data-field="name"] input')!.getAttribute('placeholder')).toBeNull();
	});
});
