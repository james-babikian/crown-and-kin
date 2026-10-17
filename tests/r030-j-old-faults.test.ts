import { describe, expect, it } from 'vitest';
import { findBlocks, replaceBody } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';

/*
 * 0.3 package J: unit tests for the old faults F1, F3 and F4 that the random notes of package D found (the proofs are
 * in `r030-d-random-notes.test.ts`). F5 (the apostrophe in single-quoted YAML) is tested next to its proof in
 * `r030-d-random-vault.test.ts`. The spec is §6.1; the rule for F1 and F4 is CommonMark.
 */

const shape = (text: string) => findBlocks(text).map((b) => [b.openLine, b.closeLine, b.prefix, b.body]);
const TREE = ['  >      ```kin', '  >      people: []', '  >      ```'];

describe('F1: a list item that holds a callout that holds a list, all opened on one marker line', () => {
	it('finds the fence, with the prefix of the callout and the inner list item', () => {
		expect(shape(['- > -    item', ...TREE, ''].join('\n'))).toEqual([[1, 3, '  >      ', 'people: []']]);
	});

	it('writes back with the same prefix and keeps every byte outside the body', () => {
		const text = ['intro', '- > -    item', ...TREE, 'outro', ''].join('\n');
		const b = findBlocks(text)[0];
		const next = replaceBody(text, b, 'people: []\nx-a: 1');
		expect(next).toBe(['intro', '- > -    item', TREE[0], TREE[1], '  >      x-a: 1', TREE[2], 'outro', ''].join('\n'));
		expect(findBlocks(next)[0].body).toBe('people: []\nx-a: 1');
	});

	it('also works with a numbered inner item, a deeper callout and a second tree below', () => {
		const text = ['- > 1.    item', '  >       ```kin', '  >       a: 1', '  >       ```', '', '```kin', 'b: 2', '```'].join('\n');
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
		const deep = ['- > > -    item', '  > >      ```kin', '  > >      a: 1', '  > >      ```'].join('\n');
		expect(shape(deep)).toEqual([[1, 3, '  > >      ', 'a: 1']]);
	});

	it('an indented line below with the inner content column ends the code in the same way: a line with 4 more columns is not a fence', () => {
		const text = ['- > -    item', '  >          ```kin', '  >          a: 1', '  >          ```'].join('\n');
		expect(findBlocks(text)).toEqual([]);
	});

	it('a fence on the marker line itself stays unread and does not throw', () => {
		expect(() => findBlocks('- > ```kin\n  > a: 1\n  > ```\n')).not.toThrow();
		expect(findBlocks('- > ```kin\n  > a: 1\n  > ```\n')).toEqual([]);
	});

	it('a line that is not a list item with a callout is unchanged: a code line that starts with ">" after 4 columns is code', () => {
		expect(findBlocks(['- a', '', '      > -  x', '  >   ```kin', '  >   a: 1', '  >   ```'].join('\n')).map((b) => b.body)).toEqual(['a: 1']);
	});
});

describe('F3: a lone CR next to an empty line', () => {
	const edit = (text: string, name: string) => {
		const body = findBlocks(text)[0].body;
		return planWrite(text, 0, body, (b) => ({ ok: true, body: b.replace('name: A', `name: ${name}`) }));
	};

	it('an edit next to an empty line is accepted and no line is lost', () => {
		const text = '```kin\npeople:\n  - id: a\r    name: A\n\nx-end: 1\n```\n';
		const plan = edit(text, 'Ab');
		expect(plan.ok).toBe(true);
		if (!plan.ok) return;
		expect(plan.newText.split(/\r\n|\r|\n/)).toEqual(['```kin', 'people:', '  - id: a', '    name: Ab', '', 'x-end: 1', '```', '']);
		// Bytes outside the changed line are as they were.
		expect(plan.newText.startsWith('```kin\npeople:\n  - id: a\r')).toBe(true);
		expect(plan.newText.endsWith('\n\nx-end: 1\n```\n')).toBe(true);
	});

	it('also when the new line is the last body line before the closing fence', () => {
		const text = '```kin\npeople:\r  - id: a\r    name: A\n```\n';
		const plan = edit(text, 'Ab');
		expect(plan.ok).toBe(true);
		if (plan.ok) expect(plan.newText).toContain('name: Ab');
	});

	it('LF only, CRLF only and mixed LF/CRLF notes keep their breaks', () => {
		for (const eol of ['\n', '\r\n']) {
			const text = ['```kin', 'people:', '  - id: a', '    name: A', '', 'x-end: 1', '```', ''].join(eol);
			const plan = edit(text, 'Ab');
			expect(plan.ok).toBe(true);
			if (plan.ok) expect(plan.newText).toBe(text.replace('name: A', 'name: Ab'));
		}
		const mixed = '```kin\r\npeople:\n  - id: a\r\n    name: A\n\r\nx-end: 1\n```\r\n';
		const plan = edit(mixed, 'Ab');
		expect(plan.ok).toBe(true);
		// The changed line takes the break of the line above it (CRLF); every other break stays.
		if (plan.ok) expect(plan.newText).toBe('```kin\r\npeople:\n  - id: a\r\n    name: Ab\r\n\r\nx-end: 1\n```\r\n');
	});

	it('a new line between lines with other breaks takes the break of its neighbour when that is safe', () => {
		const text = '```kin\npeople:\r\n  - id: a\r\n    name: A\r\nx: 1\n```\n';
		const b = findBlocks(text)[0];
		expect(replaceBody(text, b, 'people:\n  - id: a\n    name: A\n    y: 2\nx: 1')).toBe('```kin\npeople:\r\n  - id: a\r\n    name: A\r\n    y: 2\r\nx: 1\n```\n');
	});
});

describe('F4: a thematic break is not a list item', () => {
	const second = ['', '```kin', 'people: [] # second', '```', ''];
	const two = (rule: string) => [rule, '', '   ```kin', '   people: []', '```', ...second].join('\n');

	it('"- - -", "* * *" and "_ _ _" (with up to 3 leading spaces) close nothing and nest nothing: the fence is closed at the margin', () => {
		for (const rule of ['- - -', '* * *', '_ _ _', ' - - -', '   * * *', '-  -  -', '- - - -', '- -- -']) {
			expect(findBlocks(two(rule)).map((b) => b.body), rule).toEqual(['people: []', 'people: [] # second']);
		}
	});

	it('a thematic break after a list marker is a break inside the item', () => {
		const text = ['- - - -', '', '  ```kin', '  people: []', '  ```'].join('\n');
		expect(shape(text)).toEqual([[2, 4, '  ', 'people: []']]);
	});

	it('two items "- -" are still nested list items (two marks are not a break)', () => {
		// The fence is inside the inner item (content column 4), so a closing fence at the margin is 4 columns away... and still closes it.
		const text = ['- - item', '    ```kin', '    people: []', '    ```'].join('\n');
		expect(shape(text)).toEqual([[1, 3, '    ', 'people: []']]);
	});

	it('a break indented 4 or more columns is code, not a break', () => {
		const text = ['    - - -', '', '```kin', 'a: 1', '```'].join('\n');
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1']);
	});
});

describe('F1 repair (fix round): a quote opened on a marker line keeps the list item around it', () => {
	it('lines of the quote, then a fence at the item column: the item is back (the outer columns are restored)', () => {
		const text = ['- > Source', '  > more', '    ```kin', '    people: []', '    ```', ''].join('\n');
		expect(shape(text)).toEqual([[2, 4, '    ', 'people: []']]);
	});

	it('a quote line at the margin ends the item: the quote is a new one, and a fence indented 4 behind it is code', () => {
		expect(findBlocks(['- > Source', '> text', '    ```kin', '    people: []', '    ```'].join('\n'))).toEqual([]);
		expect(findBlocks(['- > Source', '  > more', '> text', '    ```kin', '    people: []'].join('\n'))).toEqual([]);
	});

	it('a quote line that starts left of the item column ends the item and its inner list, too', () => {
		// The item "1.  " has content column 6; the line "  >" has 2. The new quote has no list in it: 4 columns are code.
		expect(findBlocks(['  1.  > 1.  item', '  >     ~~~kin', '  >     people: []'].join('\n'))).toEqual([]);
	});

	it('a line of the fence that goes back to the margin ends the item, and the fence with it', () => {
		const text = ['* > * item', '  >     ````kin', '>      ~~~kin'].join('\n');
		const [b] = findBlocks(text);
		expect([b.openLine, b.closeLine, b.body]).toEqual([1, null, '']);
	});

	it('an unclosed fence in such an item ends at the paragraph at the margin; the next tree is its own', () => {
		const text = ['1. > Source', '   ```kin', '   a: 1', 'A paragraph.', '', '```kin', 'b: 2', '```', ''].join('\n');
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
	});

	it('a ">" more than 3 columns behind the item content is code, not a quote', () => {
		expect(shape(['-       > x', '    ```kin', '    a: 1', '    ```'].join('\n'))).toEqual([[1, 3, '    ', 'a: 1']]);
		expect(shape(['1.      > x', '    ```kin', '    a: 1', '    ```'].join('\n'))).toEqual([[1, 3, '    ', 'a: 1']]);
	});

	it('a ">" 3 spaces behind the marker is a quote; the item column is then 4', () => {
		const text = ['-   > - item', '    >     ```kin', '    >     a: 1', '    >     ```'].join('\n');
		expect(shape(text)).toEqual([[1, 3, '    >     ', 'a: 1']]);
	});

	it('two quotes in two list items, one after the other, each with its own tree', () => {
		const text = ['- > One', '  ```kin', '  a: 1', '  ```', '- > Two', '  ```kin', '  b: 2', '  ```'].join('\n');
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
	});

	it('a deeper callout on a marker line, then lines at each depth', () => {
		const text = ['- > > - x', '  > >   ```kin', '  > >   a: 1', '  > >   ```', '    ```kin', '    b: 2', '    ```'].join('\n');
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
	});
});
