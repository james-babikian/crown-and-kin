import { describe, expect, it } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { bodyLineOffset, errorTextLine } from '../../src/core/error-line';
import { hardErrorText, type HardError } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';

/*
 * D346 item 5, D350: "Show the tree text" goes to the text line that the error box names. `errorTextLine` gives the text
 * line of the box; `bodyLineOffset` finds the start of the tree text on that line in the note: a block at the top, after
 * front matter, inside a quote and inside a list item.
 */

const FENCE = '```';

/** The 0-based note line and the column of an offset, as CodeMirror counts them. */
function where(text: string, offset: number): { line: number; ch: number } {
	const before = text.slice(0, offset).split(/\r\n|\r|\n/);
	return { line: before.length - 1, ch: before[before.length - 1].length };
}

/** The error of a body that does not parse. */
function errorOf(body: string): HardError {
	const r = parseDynasty(body);
	if (r.ok) throw new Error('the body parses');
	return r.error;
}

/** The note line and column where the cursor goes for the error of block 0 of `note`. */
function cursorFor(note: string): { line: number; ch: number; box: string } {
	const block = findBlocks(note)[0]!;
	const error = errorOf(block.body);
	const line = errorTextLine(error, block.body);
	const offset = line === null ? block.bodyStart : bodyLineOffset(note, block, line);
	return { ...where(note, offset), box: hardErrorText(error, block.body) };
}

// The owner's example (D350): a tree text whose 5th text line has an error.
const FIFTH = ['people:', '  - id: aldric', '    name: Aldric', '    sex: m', '   name: Thea'];

describe('errorTextLine: the text line that the error box names', () => {
	it('a tree text whose 5th text line has an error: text line 5, the line that the box names', () => {
		const body = FIFTH.join('\n');
		const error = errorOf(body);
		expect(errorTextLine(error, body)).toBe(5);
		expect(hardErrorText(error, body).startsWith('Text line 5 of the tree text has an error.')).toBe(true);
	});

	it('an error on the first text line', () => {
		const body = ['people: a: b', 'houses: x'].join('\n');
		const error = errorOf(body);
		expect(errorTextLine(error, body)).toBe(1);
		expect(hardErrorText(error, body).startsWith('Text line 1 of the tree text has an error.')).toBe(true);
		const note = [`${FENCE}kin`, body, FENCE].join('\n');
		expect(cursorFor(note)).toMatchObject({ line: 1, ch: 0 });
	});

	it('an error on a middle text line (a repeated field)', () => {
		const body = ['people:', '  - id: a', '    name: A', '    name: B', '  - id: b', '    name: C'].join('\n');
		expect(errorTextLine(errorOf(body), body)).toBe(4);
	});

	it('the parser names the text line after the last (an open bracket): the last text line, as the box says', () => {
		const body = ['people:', '  - id: a', '    name: [Aldric'].join('\n');
		const error = errorOf(body);
		expect(errorTextLine(error, body)).toBe(3);
		expect(hardErrorText(error, body).startsWith('Text line 3 of the tree text has an error.')).toBe(true);
		// A body that ends with a line break has no empty text line after it.
		expect(errorTextLine({ code: 'yaml-invalid', line: 9, detail: 'x' }, `${body}\n`)).toBe(3);
	});

	it('no text line: null (the cursor goes to the start of the block text)', () => {
		expect(errorTextLine({ code: 'yaml-invalid', detail: 'x' }, 'a: [')).toBeNull();
		expect(errorTextLine({ code: 'not-a-map' }, '- a\n- b')).toBeNull();
		expect(errorTextLine(errorOf('- a\n- b'), '- a\n- b')).toBeNull();
	});
});

describe('bodyLineOffset: the place of that text line in the note', () => {
	const top = (body: string[]) => [`${FENCE}kin`, ...body, FENCE, ''].join('\n');

	it('a block at the top of the note: the 5th text line is note line 5 (the fence is line 0)', () => {
		expect(cursorFor(top(FIFTH))).toMatchObject({ line: 5, ch: 0 });
	});

	it('a block after front matter', () => {
		const note = ['---', 'title: Valmont', 'tags: [tree]', '---', 'Intro', '', ...top(FIFTH).split('\n')].join('\n');
		// The fence is note line 6.
		expect(cursorFor(note)).toMatchObject({ line: 11, ch: 0 });
	});

	it('a block inside a quote: the cursor stands after the quote marks', () => {
		const note = ['> [!note] The tree', `> ${FENCE}kin`, ...FIFTH.map((l) => `> ${l}`), `> ${FENCE}`, ''].join('\n');
		expect(cursorFor(note)).toMatchObject({ line: 6, ch: 2 });
	});

	it('a block inside two quotes', () => {
		const note = [`> > ${FENCE}kin`, ...FIFTH.map((l) => `> > ${l}`), `> > ${FENCE}`].join('\n');
		expect(cursorFor(note)).toMatchObject({ line: 5, ch: 4 });
	});

	it('a block inside a list item: the cursor stands after the list indent', () => {
		const note = ['- The tree:', '', `  ${FENCE}kin`, ...FIFTH.map((l) => `  ${l}`), `  ${FENCE}`, ''].join('\n');
		expect(cursorFor(note)).toMatchObject({ line: 7, ch: 2 });
	});

	it('an error on the first, a middle and the last text line of a block in a list item', () => {
		const body = ['people:', '  - id: a', '    name: A', '  - id: b', '    name: B'];
		const note = ['Intro', '', '1. The tree:', `   ${FENCE}kin`, ...body.map((l) => `   ${l}`), `   ${FENCE}`].join('\n');
		const block = findBlocks(note)[0]!;
		expect(block.body).toBe(body.join('\n'));
		expect(where(note, bodyLineOffset(note, block, 1))).toEqual({ line: 4, ch: 3 });
		expect(where(note, bodyLineOffset(note, block, 3))).toEqual({ line: 6, ch: 3 });
		expect(where(note, bodyLineOffset(note, block, 5))).toEqual({ line: 8, ch: 3 });
		// Past the last text line: the last; before the first: the first.
		expect(where(note, bodyLineOffset(note, block, 9))).toEqual({ line: 8, ch: 3 });
		expect(where(note, bodyLineOffset(note, block, 0))).toEqual({ line: 4, ch: 3 });
	});

	it('the second block of a note, with Windows line breaks', () => {
		const one = [`${FENCE}kin`, 'people:', '  - {id: a, name: A}', FENCE];
		const two = [`${FENCE}kin`, ...FIFTH, FENCE];
		const note = [...one, '', ...two, ''].join('\r\n');
		const block = findBlocks(note)[1]!;
		const line = errorTextLine(errorOf(block.body), block.body)!;
		expect(line).toBe(5);
		// The second fence is note line 5.
		expect(where(note, bodyLineOffset(note, block, line))).toEqual({ line: 10, ch: 0 });
	});

	it('a blank text line inside a quote: the cursor stands at the end of its quote mark', () => {
		const note = [`> ${FENCE}kin`, '> people:', '>', '>   - id: a', `> ${FENCE}`].join('\n');
		const block = findBlocks(note)[0]!;
		expect(where(note, bodyLineOffset(note, block, 2))).toEqual({ line: 2, ch: 1 });
	});

	it('an empty block: the start of the block text', () => {
		const note = ['Intro', `${FENCE}kin`, FENCE, ''].join('\n');
		const block = findBlocks(note)[0]!;
		expect(bodyLineOffset(note, block, 3)).toBe(block.bodyStart);
	});

	it('a note that lost text lines under the block: the start of the block text', () => {
		const note = top(FIFTH);
		const block = findBlocks(note)[0]!;
		const cut = note.slice(0, block.bodyStart) + FIFTH.slice(0, 2).join('');
		expect(bodyLineOffset(cut, block, 5)).toBe(block.bodyStart);
	});
});
