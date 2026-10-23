import { describe, expect, it } from 'vitest';
import type { LocatedBlock } from '../../src/core/block-locate';
import { findBlocks, ordinalForSection, replaceBody } from '../../src/core/block-locate';

const shape = (b: LocatedBlock) => ({ openLine: b.openLine, closeLine: b.closeLine, prefix: b.prefix, body: b.body });
const only = (text: string) => {
	const blocks = findBlocks(text);
	expect(blocks).toHaveLength(1);
	return blocks[0];
};

describe('findBlocks: fences', () => {
	it('reads the body between the fences, with offsets of the body lines only', () => {
		const text = 'intro\n```kin\na: 1\nb: 2\n```\nafter';
		const b = only(text);
		expect(shape(b)).toEqual({ openLine: 1, closeLine: 4, prefix: '', body: 'a: 1\nb: 2' });
		expect(text.slice(b.bodyStart, b.bodyEnd)).toBe('a: 1\nb: 2');
		expect(b.eol).toBe('\n');
	});

	it('takes the first word of the info string, case-sensitive, like Obsidian', () => {
		expect(findBlocks('```kin extra words\na: 1\n```')).toHaveLength(1);
		expect(findBlocks('```  kin\na: 1\n```')).toHaveLength(1);
		expect(findBlocks('```Dynasty\na: 1\n```')).toEqual([]);
		expect(findBlocks('```dynasty-x\na: 1\n```')).toEqual([]);
	});

	it('a backtick info string with a backtick is not a fence', () => {
		expect(findBlocks('```kin`\n```kin\nb: 2\n```').map(shape)).toEqual([{ openLine: 1, closeLine: 3, prefix: '', body: 'b: 2' }]);
	});

	it('a closing fence indented by 4 or more is body text', () => {
		expect(only('```kin\nnotes: |\n    ```\n```\n').body).toBe('notes: |\n    ```');
	});

	it('skips fences inside front matter', () => {
		const text = '---\ntitle: x\n```kin\n---\n```kin\na: 1\n```\n';
		expect(findBlocks(text).map((b) => b.openLine)).toEqual([4]);
	});

	it('a line of front matter dashes that never closes is not front matter', () => {
		expect(findBlocks('---\n```kin\na: 1\n```')).toHaveLength(1);
	});

	it('blocks after a skipped fence of another language get ordinals from 0', () => {
		const text = '~~~~\n~~~kin\n~~~~\n```kin\na\n```\n~~~kin\nb\n~~~';
		expect(findBlocks(text).map((b) => [b.ordinal, b.openLine])).toEqual([
			[0, 3],
			[1, 6],
		]);
	});

	it('handles an empty note and text without blocks', () => {
		expect(findBlocks('')).toEqual([]);
		expect(findBlocks('just prose\n')).toEqual([]);
	});
});

describe('findBlocks: blocks with no closing fence', () => {
	it('run to the end of the note; a final line break does not add an empty line', () => {
		expect(only('```kin\na: 1\n').body).toBe('a: 1');
		expect(only('```kin\na: 1\n\n').body).toBe('a: 1\n');
		expect(only('```kin\na: 1').body).toBe('a: 1');
	});

	it('a fence on the last line has an empty body', () => {
		for (const text of ['```kin', '```kin\n']) {
			const b = only(text);
			expect(b.body).toBe('');
			expect(b.bodyStart).toBe(b.bodyEnd);
		}
	});

	it('in a callout, the block ends where the callout ends', () => {
		const text = '> ```kin\n> a: 1\n\n```kin\nb: 2\n```';
		expect(findBlocks(text).map(shape)).toEqual([
			{ openLine: 0, closeLine: null, prefix: '> ', body: 'a: 1' },
			{ openLine: 3, closeLine: 5, prefix: '', body: 'b: 2' },
		]);
	});
});

describe('findBlocks: containers', () => {
	it('callout markers without a space, and a blank callout line', () => {
		const b = only('>```kin\n>a: 1\n>\n>b: 2\n>```');
		expect(shape(b)).toEqual({ openLine: 0, closeLine: 4, prefix: '>', body: 'a: 1\n\nb: 2' });
	});

	it('a deeper quote marker inside the block is content', () => {
		expect(only('> ```kin\n> > a\n> ```').body).toBe('> a');
	});

	it('indentation: a top-level body line with less indentation than the fence keeps what it has', () => {
		const b = only('  ```kin\n  a: 1\n b: 2\nc: 3\n  ```');
		expect(b.body).toBe('a: 1\nb: 2\nc: 3');
	});

	it('in a list item, a less indented line ends the item and the block', () => {
		const b = only('- x\n  ```kin\n  a: 1\n b: 2\n  ```');
		expect(shape(b)).toEqual({ openLine: 1, closeLine: null, prefix: '  ', body: 'a: 1' });
	});

	it('an ordered list item and a callout in a list item', () => {
		expect(only('10. x\n    ```kin\n    a: 1\n    ```').prefix).toBe('    ');
		expect(only('- x\n  > ```kin\n  > a: 1\n  > ```').prefix).toBe('  > ');
	});
});

describe('CRLF notes', () => {
	it('bodies are joined with \\n and offsets skip the \\r', () => {
		const text = 'x\r\n```kin\r\na: 1\r\nb: 2\r\n```\r\n';
		const b = only(text);
		expect(b.body).toBe('a: 1\nb: 2');
		expect(b.eol).toBe('\r\n');
		expect(text.slice(b.bodyStart, b.bodyEnd)).toBe('a: 1\r\nb: 2');
	});

	it('an unclosed CRLF block: the final line break does not add a line', () => {
		expect(only('```kin\r\na: 1\r\n').body).toBe('a: 1');
	});
});

describe('ordinalForSection', () => {
	const text = '```kin\na\n```\n\n> [!note]\n> ```kin\n> b\n> ```\n>\n> ```kin\n> c\n> ```\n>\n> ```kin\n> c\n> ```\n';
	it('one block in the section: that block', () => {
		expect(ordinalForSection(text, 0, 2, 'anything')).toBe(0);
		expect(ordinalForSection(text, 5, 5, '')).toBe(1);
	});

	it('several blocks in a callout: the one whose body is the source', () => {
		expect(ordinalForSection(text, 4, 15, 'b')).toBe(1);
		expect(ordinalForSection(text, 4, 15, 'b\r\n')).toBe(1);
	});

	it('null when there is no block, no match, or two blocks with the same body', () => {
		expect(ordinalForSection(text, 3, 4, 'a')).toBeNull();
		expect(ordinalForSection(text, 4, 15, 'x')).toBeNull();
		expect(ordinalForSection(text, 4, 15, 'c')).toBeNull();
	});
});

describe('list items and indentation', () => {
	it('a fence on the list-marker line: body lines use the content column', () => {
		const text = '- ```kin\n  a: 1\n  ```\n- next\n';
		const b = only(text);
		expect(shape(b)).toEqual({ openLine: 0, closeLine: 2, prefix: '  ', body: 'a: 1' });
		expect(replaceBody(text, b, 'a: 2\nb: 3')).toBe('- ```kin\n  a: 2\n  b: 3\n  ```\n- next\n');
		expect(shape(only('1. ```kin\n   a: 1\n   ```'))).toEqual({ openLine: 0, closeLine: 2, prefix: '   ', body: 'a: 1' });
	});

	it('an empty block on a list-marker line takes the content column as its prefix', () => {
		const text = '- ```kin\n  ```\n';
		expect(replaceBody(text, only(text), 'a: 1')).toBe('- ```kin\n  a: 1\n  ```\n');
	});

	it('tab-indented list items', () => {
		const text = '-\titem\n\n\t```kin\n\ta: 1\n\t\tb: 2\n\t```\n';
		const b = only(text);
		expect(shape(b)).toEqual({ openLine: 2, closeLine: 5, prefix: '\t', body: 'a: 1\n\tb: 2' });
		expect(replaceBody(text, b, 'a: 3\n\tb: 2')).toBe('-\titem\n\n\t```kin\n\ta: 3\n\t\tb: 2\n\t```\n');
	});

	it('a tab partly taken by the list marker: its remaining columns are spaces in the body', () => {
		const text = '- ```kin\n\tpeople:\n\t  - id: a\n \tb: 1\n  ```\n';
		const b = only(text);
		// The prefix is spaces for the columns taken, so a written line reads back as written.
		expect(shape(b)).toEqual({ openLine: 0, closeLine: 4, prefix: '  ', body: '  people:\n    - id: a\n  b: 1' });
		const next = '  people:\n    - id: a\n      name: A\n  b: 1';
		const out = replaceBody(text, b, next);
		expect(out).toBe('- ```kin\n\tpeople:\n\t  - id: a\n        name: A\n \tb: 1\n  ```\n');
		expect(only(out).body).toBe(next);
	});

	it('a tab that ends on the content column is taken whole', () => {
		expect(shape(only('1.  ```kin\n\ta: 1\n    ```'))).toEqual({ openLine: 0, closeLine: 2, prefix: '\t', body: 'a: 1' });
	});

	it('top-level fences may be indented up to 3 spaces; 4 is indented code', () => {
		expect(shape(only('   ```kin\n   a: 1\n   ```'))).toEqual({ openLine: 0, closeLine: 2, prefix: '   ', body: 'a: 1' });
		expect(findBlocks('    ```kin\n    a: 1\n    ```')).toEqual([]);
	});

	it('closing fences may be indented up to 3 spaces relative to the container', () => {
		expect(only('```kin\na: 1\n   ```\n').closeLine).toBe(2);
		expect(only('- x\n\n  ```kin\n  a: 1\n     ```\n').closeLine).toBe(4);
		expect(only('- x\n\n  ```kin\n  a: 1\n      ```\n  ```').closeLine).toBe(5);
	});

	it('an unclosed block in a list item ends where the list item ends', () => {
		const text = '- x\n\n  ```kin\n  a: 1\n\nnext paragraph\n```kin\nb: 2\n```';
		const blocks = findBlocks(text);
		expect(blocks.map(shape)).toEqual([
			{ openLine: 2, closeLine: null, prefix: '  ', body: 'a: 1\n' },
			{ openLine: 6, closeLine: 8, prefix: '', body: 'b: 2' },
		]);
		expect(replaceBody(text, blocks[0], 'a: 2')).toBe('- x\n\n  ```kin\n  a: 2\nnext paragraph\n```kin\nb: 2\n```');
	});

	it('a nested list item under a quote', () => {
		const text = '> - x\n>   ```kin\n>   a: 1\n>   ```';
		expect(shape(only(text))).toEqual({ openLine: 1, closeLine: 3, prefix: '>   ', body: 'a: 1' });
	});

	it('a fence line with an info string never closes a fence', () => {
		expect(only('```kin\n````js\n```').body).toBe('````js');
	});

	it('an empty body line round-trips', () => {
		const text = '```kin\n\n```';
		const b = only(text);
		expect(b.body).toBe('');
		expect(replaceBody(text, b, b.body)).toBe(text);
		expect(replaceBody(text, b, 'a: 1')).toBe('```kin\na: 1\n```');
	});
});

describe('replaceBody', () => {
	it('keeps unchanged lines byte for byte and prefixes changed ones', () => {
		const text = '> ```kin\n> a: 1\n>\n>b: 2\n> ```\n';
		const b = only(text);
		expect(b.body).toBe('a: 1\n\nb: 2');
		expect(replaceBody(text, b, 'a: 1\n\nb: 3')).toBe('> ```kin\n> a: 1\n>\n> b: 3\n> ```\n');
		expect(replaceBody(text, b, 'a: 0\n\nb: 2')).toBe('> ```kin\n> a: 0\n>\n>b: 2\n> ```\n');
	});

	it('after a bare ">", a changed line that starts with a space or tab gets one space more', () => {
		const text = '>```kin\n>people:\n>  - id: a\n>    name: A\n>```\n';
		const b = only(text);
		expect(b.body).toBe('people:\n - id: a\n   name: A');
		// The unchanged lines keep their bytes; the new line is written with ">" and one space.
		expect(replaceBody(text, b, 'people:\n - id: a\n   name: B')).toBe('>```kin\n>people:\n>  - id: a\n>    name: B\n>```\n');
		expect(replaceBody(text, b, 'people:\n - id: a\n\tx: 1\n   name: A')).toBe('>```kin\n>people:\n>  - id: a\n> \tx: 1\n>    name: A\n>```\n');
		expect(replaceBody(text, b, 'x: 1\n - id: a\n   name: A')).toBe('>```kin\n>x: 1\n>  - id: a\n>    name: A\n>```\n');
	});

	it('can add and remove lines', () => {
		const text = '```kin\na\nb\nc\n```';
		const b = only(text);
		expect(replaceBody(text, b, 'a\nc')).toBe('```kin\na\nc\n```');
		expect(replaceBody(text, b, 'a\nb\nx\ny\nc')).toBe('```kin\na\nb\nx\ny\nc\n```');
		expect(replaceBody(text, b, '')).toBe('```kin\n\n```');
	});

	it('the new body is read back as written, in every container', () => {
		const notes = [
			'```kin\na\n```',
			'> > ```kin\n> > a\n> > ```',
			'  ~~~kin\n  a\n  ~~~',
			'```kin\na',
			'```kin\na\n',
			'```kin',
			'```kin\n```',
			'>```kin\n>a\n>```',
			'>```kin\n>```',
			'> >```kin\n> >a\n> >```',
			'- ```kin\n\ta\n  ```',
		];
		const next = 'people:\n  - id: x\n\n    name: "X"';
		for (const text of notes) {
			const out = replaceBody(text, only(text), next);
			expect(only(out).body, text).toBe(next);
		}
	});

	it('writes into an unclosed block with no body lines', () => {
		expect(replaceBody('```kin', only('```kin'), 'a: 1')).toBe('```kin\na: 1');
		expect(replaceBody('```kin\n', only('```kin\n'), 'a: 1')).toBe('```kin\na: 1\n');
		expect(replaceBody('> ```kin\ntext', only('> ```kin\ntext'), 'a: 1')).toBe('> ```kin\n> a: 1\ntext');
	});

	it('uses the note line ending for new lines and accepts a CRLF body', () => {
		const text = '```kin\r\na\r\n```\r\n';
		expect(replaceBody(text, only(text), 'a\r\nb')).toBe('```kin\r\na\r\nb\r\n```\r\n');
	});
});

describe('mixed and lone-\\r line endings', () => {
	it('F5: untouched lines keep their own ending; new lines take the ending of the line above', () => {
		const note = 'x\n```kin\r\na: 1\r\nb: 2\r\nc: 3\r\n```\r\n';
		expect(replaceBody(note, only(note), 'a: 1\nb: 9\nc: 3')).toBe('x\n```kin\r\na: 1\r\nb: 9\r\nc: 3\r\n```\r\n');
		expect(replaceBody(note, only(note), 'a: 1\nb: 2\nb2: 5\nc: 3')).toBe('x\n```kin\r\na: 1\r\nb: 2\r\nb2: 5\r\nc: 3\r\n```\r\n');
		const mixed = '```kin\na: 1\r\nb: 2\n```';
		expect(replaceBody(mixed, only(mixed), 'a: 1\nb: 3')).toBe('```kin\na: 1\r\nb: 3\n```');
	});

	it('a lone \\r is a line break, as in CodeMirror', () => {
		const text = 'x\r```kin\ra: 1\r```\r';
		const b = only(text);
		expect(shape(b)).toEqual({ openLine: 1, closeLine: 3, prefix: '', body: 'a: 1' });
		expect(replaceBody(text, b, 'a: 2\nb: 3')).toBe('x\r```kin\ra: 2\rb: 3\r```\r');
		expect(only('```kin\ra: 1\r').body).toBe('a: 1');
	});
});
