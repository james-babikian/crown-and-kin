import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { FEl, clock, device, dispatch, fakeDoc, resetDom, runTimers } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.5.1 repair (owner: "never put a cursor in a field"). On a computer, Obsidian moves the focus to the first control of a window
 * right after `onOpen`. Every person window, new or saved, on every device, ends with no field focused: the window itself has the
 * focus (its dialog element), so a screen reader reads the title and Tab goes to the first control. A field that the user chose
 * (a press or a key in the window) keeps the focus.
 */

useFakeDom({ window: true });

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

describe('the focus of a person window', () => {
	const settle = async (): Promise<void> => {
		await Promise.resolve();
		await Promise.resolve();
		runTimers(300);
	};

	it('a new person: the window takes the focus back from "Open all" and no field has it', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		const modal = openLikeObsidian(s);
		await settle();
		expect(fakeDoc.activeElement).toBe(modal);
		expect(modal.getAttribute('tabindex')).toBe('-1');
	});

	it('does not take the focus from a field the user chose', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'person' } } as never)!;
		const modal = openLikeObsidian(s);
		const other = modal.querySelector('[data-field="sobriquet"] input')!;
		dispatch(modal, 'pointerdown');
		other.focus();
		await settle();
		expect(fakeDoc.activeElement).toBe(other);
	});

	it('a saved person on a computer: no field has the focus either', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		const modal = openLikeObsidian(s);
		await settle();
		expect(fakeDoc.activeElement).toBe(modal);
	});

	it('a saved person on a touch screen: the window has the focus, no field', async () => {
		device.coarse = true;
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		const modal = openLikeObsidian(s);
		await settle();
		expect(fakeDoc.activeElement).toBe(modal);
	});

	it('after the window closed, a late timer does not take the focus again', async () => {
		const h = writingHandle(BODY);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		const modal = openLikeObsidian(s);
		s.close();
		const other = fakeDoc.body;
		other.focus?.();
		const before = fakeDoc.activeElement;
		await settle();
		expect(fakeDoc.activeElement).toBe(before);
		expect(before).not.toBe(modal);
	});
});
