import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { insertTree, planInsert } from '../src/obsidian/insert-tree';
import { INSERT_UI } from '../src/render/ui-text';

// Review of WP6.3 (code-reviewer): Insert family tree (spec §5.9, D34) must give a tree that the
// plugin finds, wherever the cursor is.

const HINT = `# ${INSERT_UI.noteHint}`;

describe('review 6.3: Insert family tree', () => {
	it('after a paragraph line indented by 4 spaces (a lazy continuation line), the note has one tree', () => {
		// "    more" continues the paragraph "para"; it is not in a list or a code block.
		const p = planInsert('    more', '');
		const text = `para\n${p.text}`;
		const blocks = findBlocks(text);
		expect(blocks.map((b) => b.body.trimEnd())).toEqual([HINT]);
	});

	it('with the cursor inside a tree (source mode), the tree that is there does not change', () => {
		const tree = '```kin\npeople:\n  - id: a\n    name: A\n\n  - id: b\n    name: B\n```';
		let text = `${tree}\n\nAfter.`;
		// The cursor is on the empty line between person a and person b. (Build: the command, not the
		// planner alone, knows the note around the cursor, so the test runs the command.)
		const lines = () => text.split('\n');
		const off = (p: { line: number; ch: number }) => lines().slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
		insertTree({
			getCursor: () => ({ line: 4, ch: 0 }),
			getLine: (n: number) => lines()[n] ?? '',
			lineCount: () => lines().length,
			transaction: (t: { changes: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }[] }) => {
				const c = t.changes[0];
				text = text.slice(0, off(c.from)) + c.text + text.slice(off(c.to));
			},
		} as never);
		const blocks = findBlocks(text);
		// The same body as before the command (findBlocks gives the body without its last line break).
		expect(blocks[0].body).toBe(findBlocks(`${tree}\n\nAfter.`)[0].body);
		expect(blocks[0].body.trimEnd()).toBe('people:\n  - id: a\n    name: A\n\n  - id: b\n    name: B');
		// The new tree follows the closing fence of that tree.
		expect(blocks.map((b) => b.body.trimEnd())).toEqual([blocks[0].body.trimEnd(), HINT]);
		expect(blocks[1].openLine).toBeGreaterThan(blocks[0].closeLine!);
	});
});
