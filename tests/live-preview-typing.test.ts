import { EditorState, Text } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * WP-H2, P3: the Live Preview helper (`src/obsidian/live-preview.ts`) scans the whole note for blocks. In a note of 1 MB
 * that cost a few ms for each key press. The scan now waits until the user has stopped typing for TYPING_WAIT_MS; a
 * change of the visible part of the note still scans at once. @codemirror/language comes from Obsidian at run time, so the
 * test replaces it, and the editor view is a plain object with a real CodeMirror text.
 */

const parsedLength = vi.hoisted(() => ({ value: 0 }));
const forceParsing = vi.hoisted(() => vi.fn(() => true));
vi.mock('@codemirror/language', () => ({ forceParsing, syntaxTree: () => ({ length: parsedLength.value }) }));
const findBlocksSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/core/block-locate', async (importOriginal) => {
	const real = await importOriginal<typeof import('../src/core/block-locate')>();
	findBlocksSpy.mockImplementation(real.findBlocks);
	return { ...real, findBlocks: findBlocksSpy };
});

import { TallBlockParser, TYPING_WAIT_MS } from '../src/obsidian/live-preview';

const noteLines = ['# Title', ...Array.from({ length: 50 }, (_, i) => `Text ${i}`), '```kin', 'people:', '  - id: a', '    name: A', '```', 'After'];
const doc = Text.of(noteLines);
const blockEnd = doc.line(noteLines.indexOf('```') + 1).to;

/** An editor view with the whole note in view; the parser has read only the first lines. */
function makeParser() {
	const view = { state: { doc }, viewport: { from: 0, to: doc.length } };
	// The helper only reads `view`; the cast hides the many members of the real view that it does not use.
	return new TallBlockParser(view as never);
}
/** An update with one real CodeMirror transaction; `userEvent` is what CodeMirror records for the source of the change. */
function changed(userEvent?: string) {
	const tr = EditorState.create({ doc }).update({ changes: { from: 0, insert: 'x' }, ...(userEvent ? { userEvent } : {}) });
	return { docChanged: true, viewportChanged: false, transactions: [tr] } as never;
}
const typed = changed('input.type');
const scrolled = { docChanged: false, viewportChanged: true } as never;

describe('Live Preview helper: scan of the note (WP-H2, P3)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', globalThis);
		parsedLength.value = 20;
		forceParsing.mockClear();
		findBlocksSpy.mockClear();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('opening a note scans once, at once', () => {
		makeParser();
		vi.advanceTimersByTime(1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
		expect(forceParsing).toHaveBeenCalledTimes(1);
		expect(forceParsing).toHaveBeenCalledWith(expect.anything(), blockEnd, expect.any(Number));
	});

	it('typing does not scan for each key, and a tall tree is prepared after the wait', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		forceParsing.mockClear();
		// 40 key presses, 50 ms apart: each is closer than the wait to the one before.
		for (let i = 0; i < 40; i++) {
			p.update(typed);
			vi.advanceTimersByTime(50);
		}
		expect(findBlocksSpy).not.toHaveBeenCalled();
		expect(forceParsing).not.toHaveBeenCalled();
		vi.advanceTimersByTime(TYPING_WAIT_MS - 50 + 1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
		expect(forceParsing).toHaveBeenCalledWith(expect.anything(), blockEnd, expect.any(Number));
	});

	it('a change of the visible part scans at once, and the result is kept until the next text change', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		p.update(scrolled);
		vi.advanceTimersByTime(1);
		// The ranges of the first scan are still good, so the scroll costs no new scan.
		expect(forceParsing).toHaveBeenCalledTimes(2);
		expect(findBlocksSpy).not.toHaveBeenCalled();
		p.update(typed);
		p.update(scrolled);
		vi.advanceTimersByTime(1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
	});

	it('a scroll while the user types does not wait for the end of the typing', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		p.update(typed);
		vi.advanceTimersByTime(100);
		expect(findBlocksSpy).not.toHaveBeenCalled();
		p.update(scrolled);
		vi.advanceTimersByTime(1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
	});

	// A change that the user did not type happens once (the plugin writes the note, or a note opens): it scans at once.
	for (const [name, update] of [
		['a write by the plugin (no user event)', changed()],
		['an undo', changed('undo')],
		['a move of the text by the editor', changed('move.drop')],
	] as const) {
		it(`${name} scans at once, not after the wait`, () => {
			const p = makeParser();
			vi.advanceTimersByTime(1);
			findBlocksSpy.mockClear();
			p.update(update);
			vi.advanceTimersByTime(1);
			expect(findBlocksSpy).toHaveBeenCalledTimes(1);
		});
	}

	// "input" and "delete" with their kinds (type, paste, drop, backward, forward, cut) are the user's typing.
	for (const event of ['input.type', 'input.paste', 'input.complete', 'delete.backward', 'delete.forward', 'delete.cut']) {
		it(`${event} waits like typing`, () => {
			const p = makeParser();
			vi.advanceTimersByTime(1);
			findBlocksSpy.mockClear();
			p.update(changed(event));
			vi.advanceTimersByTime(TYPING_WAIT_MS - 1);
			expect(findBlocksSpy).not.toHaveBeenCalled();
			vi.advanceTimersByTime(2);
			expect(findBlocksSpy).toHaveBeenCalledTimes(1);
		});
	}

	it('a write by the plugin during typing ends the wait and scans at once', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		p.update(typed);
		vi.advanceTimersByTime(50);
		p.update(changed());
		vi.advanceTimersByTime(1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
	});

	it('destroy cancels a wait that is still open', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		p.update(typed);
		p.destroy();
		vi.advanceTimersByTime(TYPING_WAIT_MS * 2);
		expect(findBlocksSpy).not.toHaveBeenCalled();
	});
});
