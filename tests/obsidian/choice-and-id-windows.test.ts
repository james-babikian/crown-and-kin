import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { choose } from '../../src/obsidian/choice-modal';
import { openIdWindow } from '../../src/obsidian/id-window';
import { ID_UI } from '../../src/render/ui-text';
import { FEl, clock, device, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 O-12 (the choice step: both options plain with no fill, the title shown on a computer, one text line on a phone bar), O-11 (the ID window: the label above
 * a normal field, the reason right under the field with the error edge, the link, then the help) and CX-18.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const top = () => openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };
const phone = () => {
	device.coarse = true;
	device.width = 390;
	device.height = 844;
};

function askTwo() {
	const result = choose<string>({} as never, {
		name: 'test-step',
		title: 'Add a child',
		text: ['Add a child of Edmund Vane. Select a new person or a person who is in the tree.'],
		choices: [
			{ value: 'new', label: 'New person', detail: 'Enter the details.', cta: true },
			{ value: 'existing', label: 'Person in the tree' },
		],
	});
	return { result, m: top() };
}

describe('the choice step (O-12)', () => {
	it('both options have the same plain look: no main-button class on either; a tap goes on at once', async () => {
		const { result, m } = askTwo();
		const options = m.modalEl.querySelectorAll('.dynasty-choice-option');
		expect(options).toHaveLength(2);
		for (const o of options) expect(o.hasClass('mod-cta')).toBe(false);
		// The first option is the one that the keyboard focus is on.
		expect(m.modalEl.doc.activeElement).toBe(options[0]);
		dispatch(options[1]!, 'click');
		expect(await result).toBe('existing');
		expect(openModals).toHaveLength(0);
	});

	it('a computer window shows its title as the first line, in the tool role', () => {
		const { m } = askTwo();
		const title = m.modalEl.querySelector('.dynasty-sheet-title')!;
		expect(title.getText()).toBe('Add a child');
		expect(title.hasClass('dynasty-title')).toBe(true);
		expect(title.hasClass('is-tool')).toBe(true);
		expect(title.hasClass('dynasty-sr-only')).toBe(false);
		// The title stands before the body, in the window itself.
		const content = m.contentEl;
		expect(content.children.indexOf(title)).toBeLessThan(content.children.indexOf(m.modalEl.querySelector('.dynasty-sheet-body')!));
	});

	it('a phone shows the title in the bar on one text line (the bar-line hook), with no visible title in the body', () => {
		phone();
		const { m } = askTwo();
		const title = m.modalEl.querySelector('.dynasty-bar .dynasty-sheet-title')!;
		expect(title.hasClass('dynasty-bar-line')).toBe(true);
		expect(title.hasClass('is-wrapping')).toBe(false);
		expect(m.modalEl.querySelector('.dynasty-title')).toBeNull();
	});

	it('the Cancel button closes the step with null', async () => {
		const { result, m } = askTwo();
		dispatch(m.modalEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(await result).toBeNull();
	});
});

describe('the ID window (O-11)', () => {
	function openId(over: { value?: string; check?: (v: string) => 'empty' | 'characters' | 'taken' | null } = {}) {
		const log = { used: [] as string[], closed: [] as boolean[] };
		openIdWindow({} as never, {
			kind: 'house',
			item: 'House Valmont',
			key: 'valmont',
			value: over.value ?? 'valmont',
			check: over.check ?? ((v) => (v.trim() === '' ? 'empty' : /[^a-z0-9-]/i.test(v.trim()) ? 'characters' : null)),
			make: () => 'house-valmont',
			use: (v) => log.used.push(v),
			closed: (used) => log.closed.push(used),
		});
		return { w: top(), log };
	}

	it('stands in this order: the label, the field, the link "Make ID from the name", the help', () => {
		const { w } = openId();
		const row = w.modalEl.querySelector('.dynasty-id-row')!;
		const kids = row.children.map((c) => (c.hasClass('dynasty-sheet-field') ? 'field' : c.hasClass('dynasty-id-make') ? 'link' : c.hasClass('dynasty-sheet-hint') ? 'help' : 'other'));
		expect(kids).toEqual(['field', 'link', 'help']);
		const field = row.querySelector('.dynasty-sheet-field')!;
		expect(field.children.map((c) => c.tag)).toEqual(['label', 'input']);
		expect(field.querySelector('label')!.getText()).toBe('ID');
		expect(field.querySelector('label')!.getAttribute('for')).toBe(field.querySelector('input')!.getAttribute('id'));
		const link = row.querySelector('.dynasty-id-make')!;
		expect(link.getText()).toBe('Make ID from the name');
		expect(link.hasClass('dynasty-link')).toBe(true);
		expect(row.querySelector('.dynasty-sheet-hint')!.getText()).toBe(ID_UI.hint('house'));
		// The help is a description of the field.
		expect(field.querySelector('input')!.getAttribute('aria-describedby')).toBe(row.querySelector('.dynasty-sheet-hint')!.getAttribute('id'));
	});

	it('a refused id: the reason stands right under the field, the field has the error edge, "Use this ID" is off; a good id takes it away', () => {
		const { w } = openId();
		const input = w.modalEl.querySelector('.dynasty-id-input') as FEl;
		input.value = 'bad id';
		dispatch(input, 'input');
		const field = w.modalEl.querySelector('.dynasty-id-field')!;
		const problem = field.querySelector('.dynasty-id-problem')!;
		expect(problem.getText()).toBe(ID_UI.characters);
		expect(problem.hasClass('dynasty-field-error')).toBe(true);
		expect(field.children[field.children.indexOf(input) + 1]).toBe(problem);
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect((w.modalEl.querySelector('.dynasty-id-use') as unknown as { disabled: boolean }).disabled).toBe(true);
		input.value = 'valmont';
		dispatch(input, 'input');
		expect(w.modalEl.querySelector('.dynasty-id-problem')).toBeNull();
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect((w.modalEl.querySelector('.dynasty-id-use') as unknown as { disabled: boolean }).disabled).toBe(false);
	});

	it('an id that is refused when the window opens shows its reason at once, without taking the focus', () => {
		const { w } = openId({ value: 'bad id' });
		expect(w.modalEl.querySelector('.dynasty-id-problem')!.getText()).toBe(ID_UI.characters);
		expect(w.modalEl.doc.activeElement).toBe(w.modalEl);
	});

	it('the link makes the id from the name and takes the reason away; "Use this ID" hands over the id', async () => {
		const { w, log } = openId({ value: 'bad id' });
		dispatch(w.modalEl.querySelector('.dynasty-id-make')!, 'click');
		expect((w.modalEl.querySelector('.dynasty-id-input') as FEl).value).toBe('house-valmont');
		expect(w.modalEl.querySelector('.dynasty-id-problem')).toBeNull();
		dispatch(w.modalEl.querySelector('.dynasty-id-use')!, 'click');
		await settle();
		expect(log.used).toEqual(['house-valmont']);
		expect(log.closed).toEqual([true]);
	});

	it('a computer window shows its title as the first line, in the tool role', () => {
		const { w } = openId();
		const title = w.modalEl.querySelector('.dynasty-sheet-title')!;
		expect(title.getText()).toBe(ID_UI.windowTitle('House Valmont'));
		expect(title.hasClass('dynasty-title')).toBe(true);
		expect(title.hasClass('is-tool')).toBe(true);
	});

	it('a phone bar shows the title on one text line', () => {
		phone();
		const { w } = openId();
		expect(w.modalEl.querySelector('.dynasty-bar .dynasty-sheet-title')!.hasClass('dynasty-bar-line')).toBe(true);
	});

	// D334 Q6, D338 point 6: the bar says "ID"; the full name is the label of the field, right above it; the computer title is unchanged.
	it('a phone bar says "ID" and the full name is the label of the field, right above it', () => {
		phone();
		const { w } = openId();
		expect(w.modalEl.querySelector('.dynasty-bar .dynasty-sheet-title')!.getText()).toBe(ID_UI.label);
		const body = w.modalEl.querySelector('.dynasty-sheet-body')!;
		const field = body.querySelector('.dynasty-id-field')!;
		const label = field.querySelector('.dynasty-sheet-label')!;
		expect(label.getText()).toContain('House Valmont');
		expect(label.getText()).not.toBe(ID_UI.label);
		expect(field.children[0]).toBe(label);
		const input = field.querySelector('.dynasty-id-input')!;
		expect(field.children[1]).toBe(input);
		expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
		// The name above the field is not drawn twice, and the field keeps a meaningful accessible name that holds the visible label.
		expect(body.querySelector('.dynasty-id-itemname')).toBeNull();
		expect(input.getAttribute('aria-label')).toBe(ID_UI.aria('House Valmont'));
		expect(input.getAttribute('aria-label')).toContain(label.getText());
		expect(w.modalEl.getAttribute('aria-labelledby')).toBe(`${w.modalEl.querySelector('.dynasty-bar .dynasty-sheet-title')!.getAttribute('id')} ${label.getAttribute('id')}`);
	});

	it('a computer window keeps the label "ID" above the field; its title names the house', () => {
		const { w } = openId();
		expect(w.modalEl.querySelector('.dynasty-id-field .dynasty-sheet-label')!.getText()).toBe(ID_UI.label);
		expect(w.modalEl.querySelector('.dynasty-sheet-title')!.getText()).toBe(ID_UI.windowTitle('House Valmont'));
	});
});
