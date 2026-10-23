import { EditorState, Text } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * WP-H2, P3: the Live Preview helper (`src/obsidian/live-preview.ts`) scans the whole note for blocks. In a note of 1 MB
 * that cost a few ms for each key press. The scan now waits until the user has stopped typing for TYPING_WAIT_MS; a
 * change of the visible part of the note still scans at once. @codemirror/language comes from Obsidian at run time, so the
 * test gives its own with `useLanguage`, and the editor view is a plain object with a real CodeMirror text.
 */

const parsedLength = vi.hoisted(() => ({ value: 0 }));
const forceParsing = vi.hoisted(() => vi.fn(() => true));
const findBlocksSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/core/block-locate', async (importOriginal) => {
	const real = await importOriginal<typeof import('../../src/core/block-locate')>();
	findBlocksSpy.mockImplementation(real.findBlocks);
	return { ...real, findBlocks: findBlocksSpy };
});

import { TallBlockParser, useLanguage } from '../../src/obsidian/live-preview';

useLanguage({ forceParsing, syntaxTree: () => ({ length: parsedLength.value }) });

const noteLines = ['# Title', ...Array.from({ length: 50 }, (_, i) => `Text ${i}`), '```kin', 'people:', '  - id: a', '    name: A', '```', 'After'];
const doc = Text.of(noteLines);

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

/*
 * G2b: the plugin's own write to the note (`applyToEditor` in src/obsidian/block-handle.ts) is dispatched with
 * `userEvent: 'input.crown-and-kin'`. `isUserEvent('input')` was true for it, so it waited like typing; `isTyping` now leaves it out.
 */
describe('G2b: the plugin write', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', globalThis);
		parsedLength.value = 20;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	it('a write with the plugin user event "input.crown-and-kin" scans at once', () => {
		const p = makeParser();
		vi.advanceTimersByTime(1);
		findBlocksSpy.mockClear();
		p.update(changed('input.crown-and-kin'));
		vi.advanceTimersByTime(1);
		expect(findBlocksSpy).toHaveBeenCalledTimes(1);
	});
});
