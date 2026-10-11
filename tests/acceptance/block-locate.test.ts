import { describe, expect, it } from 'vitest';
import type { FindBlocks, LocatedBlock, OrdinalForSection, ReplaceBody } from '../../src/core/block-locate';
import * as impl from '../../src/core/block-locate';
import { replaceOnce } from './golden';
import { fixtureNote, topLevelBlocks } from './load';

// Spec §6.1 "Locating the block" and §10 "block location (prefixes, nested fences, ordinals)".
// The expected values are written from the spec and CommonMark fence rules, not from the code.

const findBlocks: FindBlocks = impl.findBlocks;
const ordinalForSection: OrdinalForSection = impl.ordinalForSection;
const replaceBody: ReplaceBody = impl.replaceBody;

const NOTE = fixtureNote('09');
const TOP = topLevelBlocks(NOTE).map((b) => b.replace(/\n$/, ''));

interface Expect {
	ordinal: number;
	openLine: number;
	closeLine: number | null;
	prefix: string;
	body: string;
}

/** The six blocks of fixture 9. Line numbers count from 0; the example at lines 93–99 is skipped. */
const FIXTURE_9: Expect[] = [
	{ ordinal: 0, openLine: 13, closeLine: 87, prefix: '', body: TOP[0] },
	{
		ordinal: 1,
		openLine: 106,
		closeLine: 115,
		prefix: '> ',
		body: [
			'people:',
			'  - id: osric',
			'    name: Osric Quill         # an end-of-line comment',
			'    sex: m',
			'',
			'  - id: hugh',
			'    name: Hugh Quill',
			'    parents: [osric]',
		].join('\n'),
	},
	{
		ordinal: 2,
		openLine: 121,
		closeLine: 126,
		prefix: '> > ',
		body: ['people:', '  - id: wat', '    name: "Wat of Greyfen"', '    born: 1120   # the year he took service'].join('\n'),
	},
	{
		ordinal: 3,
		openLine: 134,
		closeLine: 142,
		prefix: '  ',
		body: ['options:', '  height: 400', '', 'people:', '  - id: joan-marsh', '    name: Joan Marsh', '    sex: f'].join('\n'),
	},
	{ ordinal: 4, openLine: 147, closeLine: 156, prefix: '', body: TOP[1] },
	{ ordinal: 5, openLine: 160, closeLine: 164, prefix: '', body: TOP[2] },
];

function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
	return starts;
}

/**
 * The contract says the range covers "the body lines only, without the fence lines". It does not
 * say whether the first line's prefix or the last line's ending are inside, so both are allowed.
 */
function expectBodyRange(text: string, b: LocatedBlock): void {
	const starts = lineStarts(text);
	const first = starts[b.openLine + 1] ?? text.length;
	const after = b.closeLine === null ? text.length : starts[b.closeLine];
	expect(b.bodyStart).toBeGreaterThanOrEqual(first);
	expect(b.bodyStart).toBeLessThanOrEqual(first + b.prefix.length);
	expect(b.bodyEnd).toBeGreaterThanOrEqual(b.bodyStart);
	expect(b.bodyEnd).toBeLessThanOrEqual(after);
	if (b.body !== '' && b.closeLine !== null) expect(b.bodyEnd).toBeGreaterThanOrEqual(after - b.eol.length);
}

const shape = (b: LocatedBlock) => ({ ordinal: b.ordinal, openLine: b.openLine, closeLine: b.closeLine, prefix: b.prefix, body: b.body });

function only(text: string): LocatedBlock {
	const blocks = findBlocks(text);
	expect(blocks).toHaveLength(1);
	return blocks[0];
}

describe('fixture 9: every block, in text order (§6.1, §10 item 9)', () => {
	it('finds the six blocks with the right ordinal, lines, prefix and body', () => {
		expect(findBlocks(NOTE).map(shape)).toEqual(FIXTURE_9);
	});

	it('uses the note line ending', () => {
		for (const b of findBlocks(NOTE)) expect(b.eol).toBe('\n');
	});

	it('gives body ranges that cover the body lines only', () => {
		for (const b of findBlocks(NOTE)) expectBodyRange(NOTE, b);
	});

	it('skips the dynasty example inside the longer ```` fence', () => {
		expect(findBlocks(NOTE).some((b) => b.openLine === 94)).toBe(false);
		expect(ordinalForSection(NOTE, 93, 99, 'people:\n  - id: example\n    name: Example Person\n')).toBeNull();
	});

	it('replaceBody with the same body returns the identical text, for every block', () => {
		for (const b of findBlocks(NOTE)) expect(replaceBody(NOTE, b, b.body)).toBe(NOTE);
	});
});

describe('replaceBody puts the prefix back (§6.1)', () => {
	it('in a callout: only body lines change, and every new line gets "> "', () => {
		const b = findBlocks(NOTE)[1]!;
		const newBody = replaceOnce(b.body, '    name: Hugh Quill', '    name: Hugh of Greyfen\n    born: 1150\n    sex: m');
		const expected = replaceOnce(NOTE, '>     name: Hugh Quill\n', '>     name: Hugh of Greyfen\n>     born: 1150\n>     sex: m\n');
		expect(replaceBody(NOTE, b, newBody)).toBe(expected);
	});

	it('in a callout inside a callout: every body line gets "> > "', () => {
		const b = findBlocks(NOTE)[2]!;
		const newBody = b.body + '\n  - id: ada\n    name: Ada';
		const expected = replaceOnce(NOTE, '> >     born: 1120   # the year he took service\n', '> >     born: 1120   # the year he took service\n> >   - id: ada\n> >     name: Ada\n');
		expect(replaceBody(NOTE, b, newBody)).toBe(expected);
	});

	it('in a list item: every body line gets the indentation', () => {
		const b = findBlocks(NOTE)[3]!;
		const newBody = replaceOnce(b.body, 'height: 400', 'height: 450');
		expect(replaceBody(NOTE, b, newBody)).toBe(replaceOnce(NOTE, '    height: 400\n', '    height: 450\n'));
	});

	it('an unchanged blank line keeps its exact text; the rest of the note stays byte for byte', () => {
		// The blank body line in the callout is written ">" in the note; the list item's is empty.
		for (const ordinal of [1, 3]) {
			const b = findBlocks(NOTE)[ordinal]!;
			const newBody = b.body.replace('people:', 'people: # edited');
			const out = replaceBody(NOTE, b, newBody);
			const oldLines = NOTE.split('\n');
			const newLines = out.split('\n');
			expect(newLines.length).toBe(oldLines.length);
			const changed = newLines.map((l, i) => (l === oldLines[i] ? -1 : i)).filter((i) => i >= 0);
			expect(changed).toHaveLength(1);
			expect(newLines[changed[0]]).toBe(`${b.prefix}people: # edited`);
		}
	});

	it('a blank line written "> " (with a space) survives an edit of another line', () => {
		const text = '> [!note]\n> ```dynasty\n> a: 1\n> \n> b: 2\n> ```\n';
		const b = only(text);
		expect(b.body).toBe('a: 1\n\nb: 2');
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'a: 1\n\nb: 3')).toBe('> [!note]\n> ```dynasty\n> a: 1\n> \n> b: 3\n> ```\n');
	});

	it('a new blank line gets the prefix without trailing spaces', () => {
		// Decision (the contract does not fix it): a new blank body line is written as the prefix with
		// trailing whitespace removed, as Obsidian writes a blank line in a callout (">").
		const text = '> [!note]\n> ```dynasty\n> a: 1\n> b: 2\n> ```\n';
		expect(replaceBody(text, only(text), 'a: 1\n\nb: 2')).toBe('> [!note]\n> ```dynasty\n> a: 1\n>\n> b: 2\n> ```\n');
		const list = '- item\n\n  ```dynasty\n  a: 1\n  b: 2\n  ```\n';
		expect(replaceBody(list, only(list), 'a: 1\n\nb: 2')).toBe('- item\n\n  ```dynasty\n  a: 1\n\n  b: 2\n  ```\n');
	});

	it('the fence lines are never modified', () => {
		const text = '> ````dynasty\n> a: 1\n> `````   \n';
		const b = only(text);
		expect(replaceBody(text, b, 'a: 2')).toBe('> ````dynasty\n> a: 2\n> `````   \n');
	});
});

describe('line endings (§6.1: a write keeps the note line ending)', () => {
	const CRLF = NOTE.replace(/\n/g, '\r\n');

	it('a CRLF note gives the same blocks, bodies joined with \\n, and eol \\r\\n', () => {
		const blocks = findBlocks(CRLF);
		expect(blocks.map(shape)).toEqual(FIXTURE_9);
		for (const b of blocks) {
			expect(b.eol).toBe('\r\n');
			expect(b.body).not.toContain('\r');
			expectBodyRange(CRLF, b);
		}
	});

	it('ordinalForSection works on a CRLF note, with a CRLF source', () => {
		for (const e of FIXTURE_9) expect(ordinalForSection(CRLF, e.openLine, e.closeLine!, e.body.replace(/\n/g, '\r\n') + '\r\n')).toBe(e.ordinal);
	});

	it('replaceBody keeps CRLF on every line, including new ones', () => {
		for (const b of findBlocks(CRLF)) expect(replaceBody(CRLF, b, b.body)).toBe(CRLF);
		const b = findBlocks(CRLF)[1]!;
		const newBody = replaceOnce(b.body, '    name: Hugh Quill', '    name: Hugh of Greyfen\n    born: 1150');
		const expected = replaceOnce(NOTE, '>     name: Hugh Quill\n', '>     name: Hugh of Greyfen\n>     born: 1150\n').replace(/\n/g, '\r\n');
		expect(replaceBody(CRLF, b, newBody)).toBe(expected);
	});
});

describe('fences: ``` and ~~~ of any length (§6.1)', () => {
	for (const ch of ['`', '~']) {
		for (const len of [3, 4, 5]) {
			const f = ch.repeat(len);
			it(`${f}dynasty closes only on ${ch} × ${len} or more, never on a shorter fence or the other character`, () => {
				const other = (ch === '`' ? '~' : '`').repeat(len);
				const shorter = len > 3 ? `${ch.repeat(len - 1)}\n` : '';
				const text = `${f}dynasty\na: 1\n${shorter}${other}\n${f}${ch}\nafter\n`;
				const b = only(text);
				expect(b.body).toBe(`a: 1\n${shorter}${other}`);
				expect(b.openLine).toBe(0);
				expect(b.closeLine).toBe(len > 3 ? 4 : 3);
				expect(replaceBody(text, b, 'a: 2')).toBe(`${f}dynasty\na: 2\n${f}${ch}\nafter\n`);
			});
		}
	}

	it('a closing fence may have trailing spaces', () => {
		expect(shape(only('```dynasty\na: 1\n```   \nafter\n'))).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: '', body: 'a: 1' });
	});

	it('a fence line with an info string never closes a fence (CommonMark)', () => {
		expect(only('```dynasty\na: 1\n```js\n```\n').body).toBe('a: 1\n```js');
	});

	it('two backticks are not a fence, and other languages are not dynasty blocks', () => {
		expect(findBlocks('``dynasty\na: 1\n``\n')).toEqual([]);
		expect(findBlocks('```dynastyx\na: 1\n```\n')).toEqual([]);
		expect(findBlocks('```python\nx = 1\n```\n```dynasty\na: 1\n```\n').map(shape)).toEqual([
			{ ordinal: 0, openLine: 3, closeLine: 5, prefix: '', body: 'a: 1' },
		]);
	});

	it('an empty block has an empty body, and a body can be written into it', () => {
		const text = 'x\n```dynasty\n```\ny\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 1, closeLine: 2, prefix: '', body: '' });
		expect(b.bodyStart).toBe(b.bodyEnd);
		expect(replaceBody(text, b, '')).toBe(text);
		expect(replaceBody(text, b, 'people: []')).toBe('x\n```dynasty\npeople: []\n```\ny\n');
		const quoted = '> ```dynasty\n> ```\n';
		expect(replaceBody(quoted, only(quoted), 'people: []')).toBe('> ```dynasty\n> people: []\n> ```\n');
	});

	it('a block with no closing fence runs to the end of the note', () => {
		const text = '# T\n\n```dynasty\npeople:\n  - id: a\n    name: A';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 2, closeLine: null, prefix: '', body: 'people:\n  - id: a\n    name: A' });
		expectBodyRange(text, b);
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'people: []')).toBe('# T\n\n```dynasty\npeople: []');
	});

	it('an unclosed block after a closed one gets the next ordinal', () => {
		const text = '```dynasty\na: 1\n```\n\n~~~dynasty\nb: 2';
		expect(findBlocks(text).map(shape)).toEqual([
			{ ordinal: 0, openLine: 0, closeLine: 2, prefix: '', body: 'a: 1' },
			{ ordinal: 1, openLine: 4, closeLine: null, prefix: '', body: 'b: 2' },
		]);
	});
});

describe('nested fences are skipped (§6.1)', () => {
	it('a dynasty fence inside a longer backtick fence is text', () => {
		const text = '````markdown\n```dynasty\na: 1\n```\n````\n```dynasty\nb: 2\n```\n';
		expect(findBlocks(text).map(shape)).toEqual([{ ordinal: 0, openLine: 5, closeLine: 7, prefix: '', body: 'b: 2' }]);
		expect(ordinalForSection(text, 0, 4, 'a: 1\n')).toBeNull();
		expect(ordinalForSection(text, 5, 7, 'b: 2\n')).toBe(0);
	});

	it('a backtick dynasty fence inside a tilde fence is text, and the other way round', () => {
		expect(findBlocks('~~~\n```dynasty\na: 1\n```\n~~~\n')).toEqual([]);
		expect(findBlocks('```\n~~~dynasty\na: 1\n~~~\n```\n')).toEqual([]);
	});

	it('a dynasty fence inside a longer fence in a callout is text', () => {
		expect(findBlocks('> ````md\n> ```dynasty\n> a: 1\n> ```\n> ````\n')).toEqual([]);
	});
});

describe('containers: callouts and list items (§6.1)', () => {
	it('a numbered list item: the prefix is its three-space indentation', () => {
		const text = '1. First\n   ```dynasty\n   a: 1\n   ```\n2. Second\n';
		expect(shape(only(text))).toEqual({ ordinal: 0, openLine: 1, closeLine: 3, prefix: '   ', body: 'a: 1' });
		expect(replaceBody(text, only(text), 'a: 2\nb: 3')).toBe('1. First\n   ```dynasty\n   a: 2\n   b: 3\n   ```\n2. Second\n');
	});

	it('a nested list item: the prefix is four spaces', () => {
		const text = '- outer\n  - inner\n\n    ```dynasty\n    a: 1\n    ```\n';
		expect(shape(only(text))).toEqual({ ordinal: 0, openLine: 3, closeLine: 5, prefix: '    ', body: 'a: 1' });
	});

	it('a callout inside a list item: the prefix is "  > "', () => {
		const text = '- item\n  > [!note]\n  > ```dynasty\n  > a: 1\n  > ```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 2, closeLine: 4, prefix: '  > ', body: 'a: 1' });
		expect(replaceBody(text, b, 'a: 2')).toBe('- item\n  > [!note]\n  > ```dynasty\n  > a: 2\n  > ```\n');
	});
});

describe('ordinalForSection: the block Obsidian rendered (§6.1 identity, contract OrdinalForSection)', () => {
	it('the exact fence lines of each fixture 9 block', () => {
		for (const e of FIXTURE_9) expect(ordinalForSection(NOTE, e.openLine, e.closeLine!, e.body + '\n')).toBe(e.ordinal);
	});

	it('a range covering a whole callout or list item with one block', () => {
		expect(ordinalForSection(NOTE, 103, 115, FIXTURE_9[1].body + '\n')).toBe(1);
		expect(ordinalForSection(NOTE, 119, 126, FIXTURE_9[2].body + '\n')).toBe(2);
		expect(ordinalForSection(NOTE, 132, 143, FIXTURE_9[3].body + '\n')).toBe(3);
	});

	it('one block in the range is returned without comparing the source', () => {
		// Contract: "if there is one, return it". A changed body is caught later by the stale check.
		expect(ordinalForSection(NOTE, 103, 115, 'people: []\n')).toBe(1);
	});

	it('a container with two blocks: the source tells them apart', () => {
		const callout = '> [!note]\n> ```dynasty\n> a: 1\n> ```\n> Between.\n> ```dynasty\n> b: 2\n> ```\n';
		expect(ordinalForSection(callout, 0, 7, 'a: 1\n')).toBe(0);
		expect(ordinalForSection(callout, 0, 7, 'b: 2\n')).toBe(1);
		expect(ordinalForSection(callout, 0, 7, 'b: 2')).toBe(1);
		expect(ordinalForSection(callout.replace(/\n/g, '\r\n'), 0, 7, 'b: 2\r\n')).toBe(1);
		expect(ordinalForSection(callout, 0, 7, 'c: 3\n')).toBeNull();
		const list = '- item\n\n  ```dynasty\n  a: 1\n  ```\n\n  ```dynasty\n  b: 2\n  ```\n';
		expect(ordinalForSection(list, 0, 8, 'a: 1\n')).toBe(0);
		expect(ordinalForSection(list, 0, 8, 'b: 2\n')).toBe(1);
	});

	it('two blocks with identical bodies in one range: null (the view is read-only)', () => {
		const callout = '> [!note]\n> ```dynasty\n> a: 1\n> ```\n> Between.\n> ```dynasty\n> a: 1\n> ```\n';
		expect(ordinalForSection(callout, 0, 7, 'a: 1\n')).toBeNull();
		// Narrowed to one fence, the same text is found.
		expect(ordinalForSection(callout, 5, 7, 'a: 1\n')).toBe(1);
	});

	it('no block opens in the range: null', () => {
		expect(ordinalForSection(NOTE, 0, 12, 'x\n')).toBeNull();
		// Only body lines of block 0: its opening fence (line 13) is outside the range.
		expect(ordinalForSection(NOTE, 14, 86, FIXTURE_9[0].body + '\n')).toBeNull();
		expect(ordinalForSection(NOTE, 300, 310, 'x\n')).toBeNull();
	});
});

describe('unclosed blocks end at their container (contract LocatedBlock.closeLine)', () => {
	it('in a callout: the block ends where the callout ends', () => {
		const text = '> ```dynasty\n> a: 1\n\nProse\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: null, prefix: '> ', body: 'a: 1' });
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'a: 2\nb: 3')).toBe('> ```dynasty\n> a: 2\n> b: 3\n\nProse\n');
	});

	it('a block after the callout is found with the next ordinal', () => {
		const text = '> ```dynasty\n> a: 1\n\nProse\n\n```dynasty\nb: 2\n```\n';
		expect(findBlocks(text).map(shape)).toEqual([
			{ ordinal: 0, openLine: 0, closeLine: null, prefix: '> ', body: 'a: 1' },
			{ ordinal: 1, openLine: 5, closeLine: 7, prefix: '', body: 'b: 2' },
		]);
	});

	it('at the top level with a final line break: no empty body line (supervisor decision)', () => {
		const text = '```dynasty\na: 1\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: null, prefix: '', body: 'a: 1' });
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'a: 2')).toBe('```dynasty\na: 2\n');
	});
});

describe('more fence and container forms (CommonMark, §6.1)', () => {
	it('a tab-indented list item: the prefix is the tab', () => {
		const text = '- item\n\t```dynasty\n\ta: 1\n\t```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 1, closeLine: 3, prefix: '\t', body: 'a: 1' });
		expect(replaceBody(text, b, 'a: 2\nb: 3')).toBe('- item\n\t```dynasty\n\ta: 2\n\tb: 3\n\t```\n');
	});

	it('a fence on the list-marker line: the body prefix is the content indentation; the fence line is kept', () => {
		const text = '- ```dynasty\n  a: 1\n  b: 2\n  ```\nafter\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: 3, prefix: '  ', body: 'a: 1\nb: 2' });
		expectBodyRange(text, b);
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'a: 1\nb: 3')).toBe('- ```dynasty\n  a: 1\n  b: 3\n  ```\nafter\n');
		const numbered = '1. ```dynasty\n   a: 1\n   ```\n';
		expect(shape(only(numbered))).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: '   ', body: 'a: 1' });
	});

	it('callout lines written ">" with no space: the prefix is ">"', () => {
		const text = '>```dynasty\n>a: 1\n>b: 2\n>```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: 3, prefix: '>', body: 'a: 1\nb: 2' });
		expect(replaceBody(text, b, 'a: 1\nb: 3')).toBe('>```dynasty\n>a: 1\n>b: 3\n>```\n');
	});

	it('a top-level fence indented 1 to 3 spaces is a block; its indentation is the prefix', () => {
		expect(shape(only(' ```dynasty\n a: 1\n ```\n'))).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: ' ', body: 'a: 1' });
		const text = '   ```dynasty\n   a:\n     b: 1\n   ```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: 3, prefix: '   ', body: 'a:\n  b: 1' });
		expect(replaceBody(text, b, 'a:\n  b: 2')).toBe('   ```dynasty\n   a:\n     b: 2\n   ```\n');
	});

	it('a top-level fence indented 4 spaces is indented code, not a block', () => {
		expect(findBlocks('    ```dynasty\n    a: 1\n    ```\n')).toEqual([]);
	});

	it('a closing fence may be indented up to 3 spaces; 4 spaces is body text', () => {
		expect(shape(only('```dynasty\na: 1\n   ```\nafter\n'))).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: '', body: 'a: 1' });
		expect(shape(only('```dynasty\na: 1\n    ```\n```\n'))).toEqual({ ordinal: 0, openLine: 0, closeLine: 3, prefix: '', body: 'a: 1\n    ```' });
	});

	it('the info string "dynasty foo" is a dynasty block', () => {
		expect(shape(only('```dynasty foo\na: 1\n```\n'))).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: '', body: 'a: 1' });
	});

	it('a block holding one blank line round-trips it', () => {
		const text = '```dynasty\n\n```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ ordinal: 0, openLine: 0, closeLine: 2, prefix: '', body: '' });
		expect(replaceBody(text, b, b.body)).toBe(text);
	});

	it('a ```` line with an info string inside a ``` fence is text; a later bare ```` closes the ``` fence', () => {
		// A naive nesting stack would open a fence at "````md" and let "````" close that instead.
		const text = '```dynasty\na: 1\n````md\nb: 2\n````\nprose\n```dynasty\nc: 3\n```\n';
		expect(findBlocks(text).map(shape)).toEqual([
			{ ordinal: 0, openLine: 0, closeLine: 4, prefix: '', body: 'a: 1\n````md\nb: 2' },
			{ ordinal: 1, openLine: 6, closeLine: 8, prefix: '', body: 'c: 3' },
		]);
	});
});
