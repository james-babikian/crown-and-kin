import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { parseDynasty } from '../src/core/parse';
import { containerPrefix, fenceAround, insertTree, planInsert, propertiesEnd } from '../src/obsidian/insert-tree';
import { INSERT_UI } from '../src/render/ui-text';

// WP6.3: the command Insert family tree (spec §5.9, D34): an empty tree with a help comment at the
// cursor, in the container of the cursor's line (callout, list item), with the cursor on the line
// after the closing fence, so the note shows "Add first person".

const HINT = `# ${INSERT_UI.noteHint}`;

type Pos = { line: number; ch: number };

/** A small editor over a string: what insertTree uses of Obsidian's Editor. */
function editor(text: string, from: Pos, to: Pos = from) {
	const state = { text, cursor: from as Pos, transactions: 0 };
	const lines = () => state.text.split('\n');
	const offset = (p: Pos) => lines().slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
	return {
		state,
		getCursor: (which?: 'from' | 'to') => (which === 'to' ? to : from),
		getLine: (n: number) => lines()[n] ?? '',
		lineCount: () => lines().length,
		transaction(t: { changes: { from: Pos; to: Pos; text: string }[]; selection: { from: Pos } }) {
			state.transactions++;
			const c = t.changes[0];
			state.text = state.text.slice(0, offset(c.from)) + c.text + state.text.slice(offset(c.to));
			state.cursor = t.selection.from;
		},
	};
}

function run(text: string, from: Pos, to?: Pos) {
	const e = editor(text, from, to);
	insertTree(e as never);
	return e.state;
}

/** The note has exactly one tree, with only the help comment: it parses with no people. */
function expectOneEmptyTree(text: string, prefix = '') {
	const blocks = findBlocks(text);
	expect(blocks).toHaveLength(1);
	expect(blocks[0].body.trimEnd()).toBe(HINT);
	expect(blocks[0].prefix).toBe(prefix);
	const r = parseDynasty(blocks[0].body);
	expect(r.ok && r.tree.people.length).toBe(0);
	return blocks[0];
}

describe('planInsert', () => {
	it('an empty line: fence, help comment, fence, then the cursor line', () => {
		const p = planInsert('', '');
		expect(p.text).toBe(['```dynasty', HINT, '```', ''].join('\n'));
		expect(p.cursor).toEqual({ line: 3, ch: 0 });
	});

	it('text before the cursor stays on its line, with a blank line before the tree', () => {
		const p = planInsert('House Thorne holds the north.', '');
		expect(p.text).toBe(['House Thorne holds the north.', '', '```dynasty', HINT, '```', ''].join('\n'));
		expect(p.cursor).toEqual({ line: 5, ch: 0 });
	});

	it('text after the cursor moves below the tree, after the cursor line', () => {
		const p = planInsert('Before ', 'after.');
		expect(p.text).toBe(['Before', '', '```dynasty', HINT, '```', '', 'after.'].join('\n'));
		expect(p.cursor).toEqual({ line: 5, ch: 0 });
	});

	it('a callout line: every line keeps "> ", the blank lines keep ">"', () => {
		expect(planInsert('> ', '').text).toBe(['> ```dynasty', `> ${HINT}`, '> ```', '>'].join('\n'));
		const p = planInsert('> Some text', '');
		expect(p.text).toBe(['> Some text', '>', '> ```dynasty', `> ${HINT}`, '> ```', '>'].join('\n'));
		expect(p.cursor).toEqual({ line: 5, ch: 1 });
		expect(planInsert('> > ', '').text.split('\n')[1]).toBe(`> > ${HINT}`);
		// ">" with no space is written with one, as the plugin writes callout lines.
		expect(planInsert('>', '').text.split('\n')[0]).toBe('> ```dynasty');
	});

	it('a list item: the fence goes after the marker, the next lines at the content column', () => {
		expect(planInsert('- ', '').text).toBe(['- ```dynasty', `  ${HINT}`, '  ```', ''].join('\n'));
		expect(planInsert('-', '').text.split('\n')[0]).toBe('- ```dynasty');
		expect(planInsert('12. ', '').text.split('\n')[1]).toBe(`    ${HINT}`);
		expect(planInsert('  * ', '').text.split('\n')[1]).toBe(`    ${HINT}`);
		const p = planInsert('- Houses of the north', '');
		expect(p.text).toBe(['- Houses of the north', '', '  ```dynasty', `  ${HINT}`, '  ```', ''].join('\n'));
	});

	it('a list item in a callout', () => {
		expect(planInsert('> - ', '').text).toBe(['> - ```dynasty', `>   ${HINT}`, '>   ```', '>'].join('\n'));
	});

	it('five or more spaces after a list marker count as one (CommonMark)', () => {
		expect(containerPrefix('-      x').rest).toBe('  ');
	});

	it('a plain indented line is no container: the fence is not indented (the decision notes WP6.3 fix round)', () => {
		expect(containerPrefix('   text')).toEqual({ first: '', rest: '' });
		expect(containerPrefix('> ')).toEqual({ first: '> ', rest: '> ' });
		expect(containerPrefix('>     text')).toEqual({ first: '> ', rest: '> ' });
	});

	it('a code fence in a list item: fenceAround finds it from its content and its fence lines', () => {
		const lines = ['- Code:', '  ```js', '  x', '  ```', 'After.'];
		const inside = { open: 1, openPrefix: '  ', close: 3, prefix: '  ' };
		expect([0, 1, 2, 3, 4].map((i) => fenceAround(lines, i))).toEqual([null, inside, inside, inside, null]);
		expect(fenceAround(['~~~~', '```', 'x'], 2)).toEqual({ open: 0, openPrefix: '', close: null, prefix: '' });
	});

	it('propertiesEnd: the closing line of the note properties, only for a line in them', () => {
		const lines = ['---', 'title: Valmont', '...', 'Body', '---'];
		expect([0, 1, 2, 3].map((i) => propertiesEnd(lines, i))).toEqual([2, 2, 2, null]);
		expect(propertiesEnd(['---', 'title: x'], 1)).toBeNull();
		expect(propertiesEnd(['text', '---', 'a', '---'], 2)).toBeNull();
	});
});

describe('insertTree in an editor', () => {
	it('inserts at the cursor as one change, and the note then has one empty tree', () => {
		const s = run('# House Thorne\n\n\nThe end.', { line: 2, ch: 0 });
		expect(s.transactions).toBe(1);
		expect(s.text).toBe(['# House Thorne', '', '```dynasty', HINT, '```', '', 'The end.'].join('\n'));
		const b = expectOneEmptyTree(s.text);
		// The cursor is on the line after the closing fence (Live Preview draws "Add first person").
		expect(s.cursor).toEqual({ line: b.closeLine! + 1, ch: 0 });
	});

	it('in the middle of a text line', () => {
		const s = run('House Thorne holds the north.', { line: 0, ch: 13 });
		expect(s.text).toBe(['House Thorne', '', '```dynasty', HINT, '```', '', 'holds the north.'].join('\n'));
		const b = expectOneEmptyTree(s.text);
		expect(s.cursor.line).toBe(b.closeLine! + 1);
	});

	it('replaces a selection over several lines', () => {
		const s = run('keep A\nremove\nremove B keep', { line: 0, ch: 5 }, { line: 2, ch: 9 });
		expect(s.text).toBe(['keep', '', '```dynasty', HINT, '```', '', 'keep'].join('\n'));
		expectOneEmptyTree(s.text);
	});

	it('in a callout: the block keeps the prefix, and the cursor stays in the callout', () => {
		const s = run('> [!note] Family\n> ', { line: 1, ch: 2 });
		const b = expectOneEmptyTree(s.text, '> ');
		expect(s.text.split('\n')[b.closeLine!]).toBe('> ```');
		expect(s.cursor).toEqual({ line: b.closeLine! + 1, ch: 1 });
	});

	it('in a list item', () => {
		const s = run('- Trees:\n- ', { line: 1, ch: 2 });
		const b = expectOneEmptyTree(s.text, '  ');
		expect(s.cursor.line).toBe(b.closeLine! + 1);
	});

	it('the cursor in a tree in a callout: the new tree goes after it, in the callout', () => {
		const text = '> ```dynasty\n> people:\n>   - id: a\n>     name: A\n> ```\n\nEnd.';
		const s = run(text, { line: 2, ch: 4 });
		const blocks = findBlocks(s.text);
		expect(blocks).toHaveLength(2);
		expect(blocks[0].body).toBe(findBlocks(text)[0].body);
		expect(blocks[1].prefix).toBe('> ');
		expect(blocks[1].body.trimEnd()).toBe(HINT);
		expect(s.cursor).toEqual({ line: blocks[1].closeLine! + 1, ch: 1 });
	});

	it('in a code block that never closes: the tree goes above its opening fence (review 1.0.1 E)', () => {
		const s = run('Intro\n```js\nlet a = 1;', { line: 2, ch: 3 });
		expect(s.text).toBe(['Intro', '```dynasty', HINT, '```', '', '```js', 'let a = 1;'].join('\n'));
		const b = expectOneEmptyTree(s.text);
		expect(s.cursor).toEqual({ line: b.closeLine! + 1, ch: 0 });
	});

	it('in a code block that never closes, in a callout list item: the same container', () => {
		const s = run('> - ```js\n>   x', { line: 1, ch: 3 });
		expect(s.text).toBe(['> - ```dynasty', `>   ${HINT}`, '>   ```', '>', '> - ```js', '>   x'].join('\n'));
		expect(s.cursor).toEqual({ line: 3, ch: 1 });
	});

	it('in the note properties: the tree goes after them, and they do not change (review 1.0.1 E)', () => {
		for (const close of ['---', '...']) {
			const s = run(`---\ntitle: Valmont\n${close}\nBody`, { line: 1, ch: 3 });
			expect(s.text).toBe(['---', 'title: Valmont', close, '```dynasty', HINT, '```', '', 'Body'].join('\n'));
			const b = expectOneEmptyTree(s.text);
			expect(s.cursor).toEqual({ line: b.closeLine! + 1, ch: 0 });
		}
		// On the opening line too.
		expect(run('---\na: b\n---', { line: 0, ch: 0 }).text).toBe(['---', 'a: b', '---', '```dynasty', HINT, '```', ''].join('\n'));
	});

	it('a second tree in a note with a tree: the first tree does not change', () => {
		const first = '```dynasty\npeople:\n  - id: a\n    name: A\n```\n';
		const s = run(`${first}\n`, { line: 6, ch: 0 });
		expect(s.text.startsWith(first)).toBe(true);
		const blocks = findBlocks(s.text);
		expect(blocks).toHaveLength(2);
		expect(blocks[1].body.trimEnd()).toBe(HINT);
	});
});
