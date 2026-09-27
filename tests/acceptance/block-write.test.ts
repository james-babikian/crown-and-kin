import { describe, expect, it } from 'vitest';
import type { PlanWrite, UndoStack } from '../../src/core/block-write';
import * as impl from '../../src/core/block-write';
import { golden, replaceOnce } from './golden';
import { fixtureNote, topLevelBlocks } from './load';

// Spec §6.1 "Stale check" and "Plugin undo (D8)", the work plan §3.4. The edit functions here are plain
// text replacements, so these tests do not depend on yaml-edit.

const planWrite: PlanWrite = impl.planWrite;
const createUndoStack: () => UndoStack = impl.createUndoStack;

const NOTE = fixtureNote('09');
const SECOND = topLevelBlocks(NOTE)[1].replace(/\n$/, '');
const CALLOUT = [
	'people:',
	'  - id: osric',
	'    name: Osric Quill         # an end-of-line comment',
	'    sex: m',
	'',
	'  - id: hugh',
	'    name: Hugh Quill',
	'    parents: [osric]',
].join('\n');

const swap = (from: string, to: string) => (body: string) => ({ ok: true as const, body: replaceOnce(body, from, to) });

describe('planWrite: locate → compare → edit → new text (§6.1 steps 1–6)', () => {
	it('changes only the body of the second plain block; the first block is byte for byte the same', () => {
		const r = planWrite(NOTE, 4, SECOND, swap('Ysolde Fenn', 'Ysolde Harrow'));
		expect(r).toEqual({
			ok: true,
			newText: golden('09-note-second-block-name.md'),
			newBody: replaceOnce(SECOND, 'Ysolde Fenn', 'Ysolde Harrow'),
			oldBody: SECOND,
		});
	});

	it('gives the edit the body without the callout prefix, and puts the prefix back', () => {
		const seen: string[] = [];
		const r = planWrite(NOTE, 1, CALLOUT, (body) => {
			seen.push(body);
			return { ok: true, body: replaceOnce(body, 'Hugh Quill', 'Hugh of Greyfen') };
		});
		expect(seen).toEqual([CALLOUT]);
		expect(r).toMatchObject({ ok: true, newText: golden('09-note-callout-name.md'), oldBody: CALLOUT });
	});

	it('keeps CRLF line endings', () => {
		const crlf = NOTE.replace(/\n/g, '\r\n');
		const r = planWrite(crlf, 4, SECOND, swap('Ysolde Fenn', 'Ysolde Harrow'));
		expect(r).toMatchObject({ ok: true, newText: golden('09-note-second-block-name.md').replace(/\n/g, '\r\n') });
		if (r.ok) expect(r.newBody).not.toContain('\r');
	});

	it('an edit that returns the same body gives the same text', () => {
		expect(planWrite(NOTE, 0, topLevelBlocks(NOTE)[0].replace(/\n$/, ''), (body) => ({ ok: true, body }))).toMatchObject({ ok: true, newText: NOTE });
	});
});

describe('planWrite refusals (§6.1 "On a mismatch … abort")', () => {
	it('stale: the user changed the block in source since it was read', () => {
		const typed = replaceOnce(NOTE, '    name: Ysolde Fenn\n    sex: f', '    name: Ysolde Fenn\n    sex: x');
		let called = false;
		const r = planWrite(typed, 4, SECOND, () => {
			called = true;
			return { ok: true, body: '' };
		});
		// `currentBody` lets the handle refresh the open sheet from the new data (§6.1).
		expect(r).toEqual({ ok: false, code: 'stale', currentBody: replaceOnce(SECOND, 'sex: f', 'sex: x') });
		expect(called).toBe(false);
	});

	it('stale: a difference of one trailing space is a mismatch', () => {
		expect(planWrite(NOTE, 4, SECOND + ' ', swap('Ysolde Fenn', 'Ysolde Harrow'))).toMatchObject({ ok: false, code: 'stale' });
	});

	it('stale: a change in another block does not make this block stale', () => {
		const other = replaceOnce(NOTE, 'name: Cedric Vane', 'name: Cedric Harrow');
		const r = planWrite(other, 4, SECOND, swap('Ysolde Fenn', 'Ysolde Harrow'));
		expect(r).toMatchObject({ ok: true, newText: replaceOnce(golden('09-note-second-block-name.md'), 'name: Cedric Vane', 'name: Cedric Harrow') });
	});

	it('missing: no block has that ordinal', () => {
		expect(planWrite(NOTE, 6, SECOND, swap('Ysolde Fenn', 'Ysolde Harrow'))).toMatchObject({ ok: false, code: 'missing' });
	});

	it('missing: the block was deleted from the note', () => {
		const cut = replaceOnce(NOTE, '~~~dynasty\npeople:\n  - id: cedric\n    name: Cedric Vane\n~~~\n', '');
		expect(planWrite(cut, 5, 'people:\n  - id: cedric\n    name: Cedric Vane', (body) => ({ ok: true, body }))).toMatchObject({
			ok: false,
			code: 'missing',
		});
	});

	it('stale, not a silent write to the wrong block, when the ordinals shift', () => {
		// The callout block is no longer a dynasty block, so the nested-callout block becomes ordinal 1.
		const cut = replaceOnce(NOTE, '> ```dynasty\n> people:\n>   - id: osric\n', '> ```text\n> people:\n>   - id: osric\n');
		expect(planWrite(cut, 1, CALLOUT, swap('Hugh Quill', 'Hugh of Greyfen'))).toMatchObject({ ok: false, code: 'stale' });
	});

	it('rejected: passes on the reason the edit gave', () => {
		expect(planWrite(NOTE, 4, SECOND, () => ({ ok: false, reason: 'blocked' }))).toEqual({ ok: false, code: 'rejected', reason: 'blocked' });
	});
});

describe('UndoStack (§6.1 "Plugin undo", D8)', () => {
	it('starts empty', () => {
		const u = createUndoStack();
		expect(u.size).toBe(0);
		expect(u.canUndo('a')).toBe(false);
		expect(u.undo('a')).toEqual({ ok: false, code: 'empty' });
	});

	it('undoes one write when the body is still what the plugin wrote', () => {
		const u = createUndoStack();
		u.push('before', 'after');
		expect(u.size).toBe(1);
		expect(u.canUndo('after')).toBe(true);
		expect(u.undo('after')).toEqual({ ok: true, body: 'before' });
		expect(u.size).toBe(0);
		expect(u.undo('before')).toEqual({ ok: false, code: 'empty' });
	});

	it('refuses with "changed" after a foreign edit, and keeps the entry', () => {
		const u = createUndoStack();
		u.push('before', 'after');
		expect(u.canUndo('after, then typed in source')).toBe(false);
		expect(u.undo('after, then typed in source')).toEqual({ ok: false, code: 'changed' });
		expect(u.size).toBe(1);
		// If the foreign edit is taken back, the plugin's own write is on top again.
		expect(u.undo('after')).toEqual({ ok: true, body: 'before' });
	});

	it('undoes several writes in reverse order', () => {
		const u = createUndoStack();
		u.push('a', 'b');
		u.push('b', 'c');
		u.push('c', 'd');
		expect(u.undo('d')).toEqual({ ok: true, body: 'c' });
		expect(u.undo('c')).toEqual({ ok: true, body: 'b' });
		expect(u.undo('b')).toEqual({ ok: true, body: 'a' });
		expect(u.undo('a')).toEqual({ ok: false, code: 'empty' });
	});

	it('keeps only the last 20 writes', () => {
		const u = createUndoStack();
		for (let i = 0; i < 25; i++) u.push(`b${i}`, `b${i + 1}`);
		expect(u.size).toBe(20);
		for (let i = 25; i > 5; i--) expect(u.undo(`b${i}`)).toEqual({ ok: true, body: `b${i - 1}` });
		expect(u.size).toBe(0);
		expect(u.undo('b5')).toEqual({ ok: false, code: 'empty' });
	});

	it('round trip: write through planWrite, then undo restores the note', () => {
		const u = createUndoStack();
		const w = planWrite(NOTE, 4, SECOND, swap('Ysolde Fenn', 'Ysolde Harrow'));
		if (!w.ok) throw new Error(`write refused: ${w.code}`);
		u.push(w.oldBody, w.newBody);
		const back = u.undo(w.newBody);
		if (!back.ok) throw new Error(`undo refused: ${back.code}`);
		const restore = planWrite(w.newText, 4, w.newBody, () => ({ ok: true, body: back.body }));
		expect(restore).toMatchObject({ ok: true, newText: NOTE });
	});
});
