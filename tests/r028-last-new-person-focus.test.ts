import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { EditSheet } from '../src/obsidian/edit-sheet';
import { FEl, clock, device, fakeDoc, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { stripNotDisabled, writingHandle } from './s113-c-support';

/*
 * Last fix round of 0.2.8, flow review. On a computer, Obsidian moves the focus to the first control of a window right
 * after `onOpen` (a device with a physical keyboard). In a new-person window that control is "Open all", so typing went
 * nowhere. The window must give the focus back to the Name field after that step. F7 (0.3.1): an existing person's window
 * does the same on a computer; a touch screen or a phone keeps the focus where it is, so the keyboard stays closed.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
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

const BODY = ['people:', '  - id: a', '    name: Aldric', ''].join('\n');

/** Opens a window the way Obsidian does on a computer: `open()` runs `onOpen`, then the first control gets the focus. */
function openLikeObsidian(s: EditSheet): FEl {
	s.open();
	const modal = (s as unknown as { modalEl: FEl }).modalEl;
	const first = modal.querySelector('button')!;
	first.focus();
	return modal;
}

describe('the focus of a new-person window', () => {
	it('is on the Name field after Obsidian moved it to "Open all"', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		const modal = openLikeObsidian(s);
		expect(fakeDoc.activeElement).not.toBe(modal.querySelector('[data-field="name"] input'));
		await Promise.resolve();
		await Promise.resolve();
		expect(fakeDoc.activeElement).toBe(modal.querySelector('[data-field="name"] input'));
	});

	it('does not take the focus from a field the user already chose', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		const modal = openLikeObsidian(s);
		const other = modal.querySelector('[data-field="sobriquet"] input')!;
		other.focus();
		await Promise.resolve();
		await Promise.resolve();
		expect(fakeDoc.activeElement).toBe(other);
	});

	it('F7: an existing person on a computer starts in Name, too', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		const modal = openLikeObsidian(s);
		await Promise.resolve();
		await Promise.resolve();
		expect(fakeDoc.activeElement).toBe(modal.querySelector('[data-field="name"] input'));
	});

	it('an existing person on a touch screen keeps the focus where Obsidian put it', async () => {
		device.coarse = true;
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		const modal = openLikeObsidian(s);
		const first = fakeDoc.activeElement;
		await Promise.resolve();
		await Promise.resolve();
		expect(fakeDoc.activeElement).toBe(first);
		expect(fakeDoc.activeElement).not.toBe(modal.querySelector('[data-field="name"] input'));
	});
});
