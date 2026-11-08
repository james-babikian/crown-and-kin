import { describe, expect, it } from 'vitest';
import { createUndoStack, planWrite } from '../../src/core/block-write';
import { smallestChange } from '../../src/core/block-match';
import type { Op } from '../../src/core/edit';
import { HELP_COMMENT, HELP_LINE } from '../../src/core/help-comment';
import { INSERT_UI } from '../../src/render/ui-text';
import { applyOp } from '../../src/core/yaml-edit';

// D335: the first person of a new tree takes the help comment of "Insert family tree" away, and nothing else.

const ADD: Op = { kind: 'add-person', id: 'ada', fields: { name: 'Ada' } };
const PERSON = 'people:\n  - id: ada\n    name: Ada';

const edit = (src: string, op: Op = ADD) => {
	const r = applyOp(src, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};

describe('the help comment of an empty tree goes with the first person (D335)', () => {
	it('the sentence equals the text the command writes', () => {
		expect(HELP_COMMENT).toBe(INSERT_UI.noteHint);
		expect(HELP_LINE).toBe(`# ${INSERT_UI.noteHint}`);
	});

	it('a body of the help comment only becomes the new person only', () => {
		expect(edit(HELP_LINE)).toBe(PERSON);
	});

	it('a final line break stays', () => {
		expect(edit(`${HELP_LINE}\n`)).toBe(`${PERSON}\n`);
	});

	it('a CRLF body keeps its line endings', () => {
		const out = edit(`${HELP_LINE}\r\n`);
		expect(out).toBe(`${PERSON.replace(/\n/g, '\r\n')}\r\n`);
		expect(out).not.toContain('To add');
	});

	// The same write on the text without the help line: the rest of the result is the same, byte for byte.
	const withoutHelp = (src: string) => src.replace(`${HELP_LINE}\r\n`, '').replace(`${HELP_LINE}\n`, '');

	it('a CRLF body with a line before the comment loses only that line', () => {
		const src = `houses:\r\n  - id: h\r\n    name: Harrow\r\n${HELP_LINE}\r\n`;
		const out = edit(src);
		expect(out).not.toContain('To add');
		expect(out.split('\n').slice(0, -1).every((l) => l.endsWith('\r'))).toBe(true);
		expect(out).toBe(edit(withoutHelp(src)));
	});

	it('a block with front text loses only the help line; the other comments stay', () => {
		const src = `# My house\nhouses:\n  - id: h\n    name: Harrow\n# kept note\n${HELP_LINE}\n`;
		const out = edit(src);
		expect(out).toContain('# My house\nhouses:');
		expect(out).toContain('# kept note\n');
		expect(out).not.toContain('To add');
		expect(out).toBe(edit(withoutHelp(src)));
	});

	it('a help line above other comments leaves them in place', () => {
		const src = `${HELP_LINE}\n# second\n`;
		expect(edit(src)).toBe(`# second\n${PERSON}\n`);
	});

	it('an empty people list loses the help line too', () => {
		expect(edit(`people: []\n${HELP_LINE}\n`)).toBe('people: [{id: ada, name: Ada}]\n');
	});

	it('the write changes only the help line and the new person', () => {
		const src = `# front\nhouses:\n  - id: h\n    name: Harrow\n${HELP_LINE}\n`;
		const out = edit(src);
		// Everything before the help line is untouched, and the rest equals the write without the line.
		expect(out.startsWith('# front\nhouses:\n  - id: h\n    name: Harrow\n')).toBe(true);
		expect(out).toBe(edit(withoutHelp(src)));
		expect(smallestChange(src, out).from).toBeGreaterThanOrEqual('# front\nhouses:\n  - id: h\n    name: Harrow'.length);
	});
});

describe('a line that is not the exact help line stays', () => {
	const stays = (line: string) => expect(edit(`${line}\n`)).toBe(`${line}\n${PERSON}\n`);

	it('a changed sentence', () => stays(`${HELP_LINE} Thanks.`));
	it('a similar sentence', () => stays('# To add the first person, select "Add first person".'));
	it('a trailing space', () => stays(`${HELP_LINE} `));
	it('a missing space after the hash', () => stays(`#${HELP_COMMENT}`));
	it('a second hash', () => stays(`## ${HELP_COMMENT}`));
	it('an indented copy', () => stays(`  ${HELP_LINE}`));
	it('the sentence in other case', () => stays(HELP_LINE.toUpperCase()));
	it('the user\'s own comment', () => stays('# my own comment'));

	it('a copy that is not on its own line (after a key)', () => {
		const src = `people: [] ${HELP_LINE}\n`;
		const out = edit(src);
		expect(out).toContain(HELP_COMMENT);
		expect(out).toContain('id: ada');
	});

	it('a help line after a text value is a comment and goes; the value stays', () => {
		const src = `houses:\n  - id: h\n    name: |\n      x\n${HELP_LINE}\n`;
		const out = edit(src);
		expect(out).toContain('name: |\n      x\n');
		expect(out).not.toContain('To add');
	});

	it('two copies both stay, since the plugin cannot tell its own', () => {
		const src = `${HELP_LINE}\n${HELP_LINE}\n`;
		expect(edit(src)).toBe(`${src}${PERSON}\n`);
	});

	it('two copies, one changed: the exact one goes', () => {
		const src = `${HELP_LINE}\n${HELP_LINE}!\n`;
		expect(edit(src)).toBe(`${HELP_LINE}!\n${PERSON}\n`);
	});
});

describe('only the first person removes it', () => {
	it('a tree with a person already keeps the help line', () => {
		const src = `${HELP_LINE}\npeople:\n  - id: a\n    name: A\n`;
		const out = edit(src, { kind: 'add-person', id: 'b', fields: { name: 'B' } });
		expect(out).toBe(`${src}  - id: b\n    name: B\n`);
	});

	it('another edit of an empty tree keeps the help line', () => {
		const src = `${HELP_LINE}\nhouses:\n  - id: h\n    name: Harrow\n`;
		const out = edit(src, { kind: 'edit-house', id: 'h', fields: { name: 'Quill' } } as Op);
		expect(out).toContain(HELP_LINE);
	});

	it('a batch of two new people removes it once', () => {
		const out = edit(`${HELP_LINE}\n`, { kind: 'batch', ops: [ADD, { kind: 'add-person', id: 'bo', fields: { name: 'Bo' } }] });
		expect(out).toBe(`${PERSON}\n  - id: bo\n    name: Bo\n`);
	});
});

describe('the write is one change that Undo restores (D335)', () => {
	const note = `# N\n\`\`\`kin\n${HELP_LINE}\n\`\`\`\n`;

	it('the note text changes in one span and the old body returns with Undo', () => {
		const r = planWrite(note, 0, HELP_LINE, (body) => {
			const e = applyOp(body, ADD);
			return e.ok ? e : { ok: false, reason: e.code };
		});
		if (!r.ok) throw new Error(r.code);
		expect(r.newText).toBe(`# N\n\`\`\`kin\n${PERSON}\n\`\`\`\n`);
		const change = smallestChange(note, r.newText);
		expect(note.slice(0, change.from) + change.text + note.slice(change.to)).toBe(r.newText);
		const undo = createUndoStack();
		undo.push(r.oldBody, r.newBody);
		const back = undo.undo(r.newBody);
		if (!back.ok) throw new Error(back.code);
		expect(back.body).toBe(HELP_LINE);
	});
});
