import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, clock, fakeDoc, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { click, stripNotDisabled, type, writingHandle } from './s113-c-support';

/*
 * Search round 0.2.3, area C. Where does the keyboard focus go when a question over the edit sheet
 * closes without a choice? The Houses and Titles windows give it back to the control that had it
 * (`confirmFrom`); the edit sheet does not.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const BODY = ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n');

function open(body = BODY, id = 'b') {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	return { h, s, modal };
}

describe('focus after a question over the edit sheet closes without a choice', () => {
	it('"Continue to edit" in the Discard question: the focus stays in the sheet', async () => {
		const { s, modal } = open();
		// A draft change, then Esc (a press outside, the X button): the question opens, with the focus on its first button.
		type(modal.querySelector('[data-field="title"] input')!, 'Lord');
		s.close();
		const keep = modal.querySelector('.dynasty-sheet-confirm .dynasty-sheet-keep')!;
		expect(fakeDoc.activeElement).toBe(keep);
		await click(keep);
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		// The focused button is gone with the question: a browser puts the focus on the page body.
		expect(modal.contains(fakeDoc.activeElement)).toBe(true);
	});

	it('Cancel in the Delete question: the focus stays in the sheet', async () => {
		const { modal } = open();
		const del = modal.querySelector('.dynasty-delete-person')!;
		del.focus();
		await click(del);
		const keep = modal.querySelector('.dynasty-sheet-confirm .dynasty-sheet-keep')!;
		await click(keep);
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(modal.contains(fakeDoc.activeElement)).toBe(true);
	});
});
