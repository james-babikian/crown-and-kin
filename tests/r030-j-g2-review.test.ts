import { describe, expect, it } from 'vitest';
import { findBlocks, replaceBody } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';
import { findBlocks as findBlocksBefore } from './old-block-locate';

/*
 * G2 review of WP-J (scratch). The first two tests also run against the code of release-0.3.0
 * (`old-block-locate.ts`, a copy) to show that they are regressions of the branch.
 */

const shape = (f: typeof findBlocks, text: string) => f(text).map((b) => [b.openLine, b.closeLine, b.prefix, b.body]);

describe('R1 a callout opened on a list marker line ("- > q") forgets the list item for the lines below', () => {
	// CommonMark: "- " opens an item with content column 2. The fence line is indented 4, so it is 2 columns inside the item: a fence.
	const closed = ['- > Source', '    ```kin', '    people: []', '    ```', ''].join('\n');

	it('release-0.3.0 finds the tree (control)', () => {
		expect(shape(findBlocksBefore as never, closed)).toEqual([[1, 3, '    ', 'people: []']]);
	});

	it('the branch finds the tree', () => {
		expect(shape(findBlocks, closed)).toEqual([[1, 3, '    ', 'people: []']]);
	});

	it('numbered item: "1. > Source" and a fence indented 4', () => {
		const text = ['1. > Source', '    ```kin', '    people: []', '    ```', ''].join('\n');
		expect(shape(findBlocks, text)).toEqual([[1, 3, '    ', 'people: []']]);
	});
});

describe('R2 an unclosed fence in such a list item swallows the next tree', () => {
	// The fence is in the list item; the paragraph at the margin ends the item and the fence (CommonMark). The second tree is its own block.
	const text = ['- > Source', '  ```kin', '  people: []', 'A paragraph.', '', '```kin', 'people: [] # second', '```', ''].join('\n');

	it('release-0.3.0 finds two trees (control)', () => {
		expect(findBlocksBefore(text).map((b) => b.body)).toEqual(['people: []', 'people: [] # second']);
	});

	it('the branch finds two trees', () => {
		expect(findBlocks(text).map((b) => b.body)).toEqual(['people: []', 'people: [] # second']);
	});
});

describe('R3 F3: a lone CR that is a kept break next to an empty line', () => {
	it('removing the last body line leaves a blank last line behind a lone CR, and the closing fence line ends with LF: the edit is accepted', () => {
		// Lines: "a: 1" CR "" CR "b: 2" LF fence. The edit removes "b: 2"; the kept blank line is followed by the fence's LF, so CR + "" + LF reads as one CRLF.
		const text = '```kin\na: 1\r\rb: 2\n```\n';
		const b = findBlocks(text)[0];
		expect(b.body).toBe('a: 1\n\nb: 2');
		const plan = planWrite(text, 0, b.body, () => ({ ok: true, body: 'a: 1\n' }));
		expect(plan.ok, JSON.stringify(plan)).toBe(true);
		void replaceBody;
	});
});

describe('R4 a ">" after more than 4 columns behind a list marker is code, not a callout', () => {
	// "-" + 7 spaces: the content column is 2 and the rest is indented code ("    > x"). The fence below is 2 columns inside the item.
	const text = ['-       > x', '    ```kin', '    people: []', '    ```', ''].join('\n');

	it('release-0.3.0 finds the tree (control)', () => {
		expect(shape(findBlocksBefore as never, text)).toEqual([[1, 3, '    ', 'people: []']]);
	});

	it('the branch finds the tree', () => {
		expect(shape(findBlocks, text)).toEqual([[1, 3, '    ', 'people: []']]);
	});
});
