import { describe, expect, it } from 'vitest';
import type { PlanWrite } from '../../src/core/block-write';
import * as locate from '../../src/core/block-locate';
import * as write from '../../src/core/block-write';
import type { ApplyOp, EditResult, Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import { replaceOnce } from './golden';

// Insert family tree (spec §5.9, D34; the decision notes "M6 design gate", Insert): the command inserts
// an empty tree whose body is only a help comment, and the note shows "Add first person". The
// core part: that body parses as an empty tree with no problem, and `add-person` on it keeps the
// comment (§6.2: comments survive). The comment's wording belongs to WP6.3; these tests use a
// stand-in with the same shape (several full-line comments). As in the M3 test for a one-line
// comment ("a comment-only body keeps the comment above"), `people` goes directly below it.

const applyOp: ApplyOp = edit.applyOp;
/** The block with this ordinal, or null. */
const locateBlock = (text: string, ordinal: number) => locate.findBlocks(text)[ordinal] ?? null;
const planWrite: PlanWrite = write.planWrite;

const HELP = [
	'# This is an empty family tree.',
	'# Tap "Add first person" to start. Each person gets a text line like:',
	'#   - id: aldric',
	'#     name: Aldric Valmont',
].join('\n');

const first: Op = { kind: 'add-person', id: 'aldric', fields: { name: 'Aldric Valmont', sex: 'm' } };
const PERSON = 'people:\n  - id: aldric\n    name: Aldric Valmont\n    sex: m';

function ok(r: EditResult): string {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}

describe('an empty tree with a help comment (§5.9, D34)', () => {
	it('reads as a tree with no people and no issue, so the note shows "Add first person"', () => {
		const r = parseDynasty(HELP);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.tree.people).toEqual([]);
			expect(r.tree.issues).toEqual([]);
		}
	});

	it('add-person keeps every comment line; people goes below them', () => {
		expect(ok(applyOp(HELP, first))).toBe(`${HELP}\n${PERSON}`);
	});

	it('with a final newline, the body keeps one', () => {
		expect(ok(applyOp(`${HELP}\n`, first))).toBe(`${HELP}\n${PERSON}\n`);
	});

	it('the new person reads back', () => {
		const r = parseDynasty(ok(applyOp(HELP, first)));
		expect(r.ok && r.tree.people.map((p) => [p.id, p.name, p.sex])).toEqual([['aldric', 'Aldric Valmont', 'm']]);
	});

	it('inside a callout and a list item, the comment and the new lines keep the prefix', () => {
		const note = [
			'> [!note] A new tree',
			'> ```dynasty',
			...HELP.split('\n').map((l) => `> ${l}`),
			'> ```',
			'',
			'- Branch:',
			'',
			'  ```dynasty',
			...HELP.split('\n').map((l) => `  ${l}`),
			'  ```',
			'',
		].join('\n');
		const writeNote = (text: string, ordinal: number): string => {
			const block = locateBlock(text, ordinal);
			if (!block) throw new Error(`no block ${ordinal}`);
			const r = planWrite(text, ordinal, block.body, (b) => {
				const e = applyOp(b, first);
				return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
			});
			if (!r.ok) throw new Error(`write refused: ${r.code}`);
			return r.newText;
		};
		const person = (prefix: string) => PERSON.split('\n').map((l) => `${prefix}${l}\n`).join('');
		expect(writeNote(note, 0)).toBe(replaceOnce(note, '> #     name: Aldric Valmont\n> ```', `> #     name: Aldric Valmont\n${person('> ')}> \`\`\``));
		expect(writeNote(note, 1)).toBe(replaceOnce(note, '  #     name: Aldric Valmont\n  ```', `  #     name: Aldric Valmont\n${person('  ')}  \`\`\``));
	});
});
