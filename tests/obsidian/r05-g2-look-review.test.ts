import { beforeEach, describe, expect, it } from 'vitest';
import { revealTarget } from '../../src/obsidian/modal-layout';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/* G2 review of r05/look-fix: proofs of defects in the shared reveal target. */

useFakeDom({ window: true });

beforeEach(() => resetDom());

describe('G2 revealTarget', () => {
	it('the Childless tick box reveals the field that holds its hint (edit-sheet-form.ts detailsBody + checkField)', () => {
		// The same structure as detailsBody: the checks field holds the row, the two tick boxes (each a `.dynasty-sheet-field` label) and the on-focus hint.
		const modal = new FEl('div');
		const checks = modal.createDiv({ cls: ['dynasty-sheet-field', 'is-wide', 'dynasty-checks-field'] });
		const row = checks.createDiv({ cls: 'dynasty-checks' });
		const label = row.createEl('label', { cls: 'dynasty-sheet-field dynasty-sheet-check dynasty-check' });
		const box = label.createEl('input', { attr: { type: 'checkbox' } });
		const hint = checks.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: 'Hint' });
		const target = revealTarget(box as never, modal as never) as unknown as FEl;
		// The hint must be inside the element that is scrolled into view.
		expect(target.contains(hint as never)).toBe(true);
	});

	it('a field taller than the scroll box (not the whole window) is revealed by its control', () => {
		const modal = new FEl('div');
		modal.clientHeight = 600; // the window, with title and foot
		const body = modal.createDiv({ cls: 'dynasty-sheet-body' });
		body.clientHeight = 240; // the scroll box, with the keyboard open on a phone
		const field = body.createDiv({ cls: 'dynasty-cal-start' });
		field.offsetHeight = 320; // taller than the scroll box, shorter than the window
		const input = field.createEl('input');
		expect(revealTarget(input as never, modal as never)).toBe(input);
	});
});
