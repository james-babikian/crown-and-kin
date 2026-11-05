import { beforeEach, describe, expect, it, vi } from 'vitest';
import { revealTarget } from '../../src/obsidian/modal-layout';
import { revealFocused } from '../../src/obsidian/sheet-parts';
import { FEl, resetDom, runTimers } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * R05 look repair 1: a field with a hint that shows on focus scrolls as a whole (label, control and hint), so the hint is not cut off
 * at the foot of the scroll box. A field taller than the window scrolls by its control.
 */

useFakeDom({ window: true });

beforeEach(() => resetDom());

function build() {
	const modal = new FEl('div');
	const content = modal.createDiv();
	const row = content.createDiv({ cls: 'dynasty-sheet-field' });
	const input = row.createEl('input');
	row.createDiv({ cls: ['dynasty-sheet-hint', 'is-on-focus'], text: 'Hint' });
	const bare = content.createEl('input');
	return { modal, content, row, input, bare };
}

describe('revealTarget', () => {
	it('is the field of the control', () => {
		const { row, input } = build();
		expect(revealTarget(input as never)).toBe(row);
	});

	it('is the control when it has no field', () => {
		const { bare } = build();
		expect(revealTarget(bare as never)).toBe(bare);
	});

	it('is the group of a start (the hint stands under the group)', () => {
		const modal = new FEl('div');
		const group = modal.createDiv({ cls: 'dynasty-cal-start' });
		const input = group.createDiv({ cls: 'dynasty-sheet-field' }).createEl('input');
		expect(revealTarget(input as never)).toBe(group);
	});

	it('is the control when the field is taller than the window', () => {
		const { modal, row, input } = build();
		modal.clientHeight = 300;
		row.offsetHeight = 420;
		expect(revealTarget(input as never, modal as never)).toBe(input);
	});
});

describe('revealFocused', () => {
	it('scrolls the whole field, with block nearest, after the delay', () => {
		const { modal, content, row, input } = build();
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		input.focus();
		revealFocused(modal as never, content as never, 300);
		expect(spy).not.toHaveBeenCalled();
		runTimers(301);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy.mock.contexts[0]).toBe(row);
		expect((spy.mock.calls[0] as unknown[])[0]).toEqual({ block: 'nearest' });
	});

	it('scrolls a control with no field by itself', () => {
		const { modal, content, bare } = build();
		const spy = vi.spyOn(FEl.prototype, 'scrollIntoView');
		bare.focus();
		revealFocused(modal as never, content as never);
		expect(spy.mock.contexts[0]).toBe(bare);
	});
});
