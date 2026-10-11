import { describe, expect, it } from 'vitest';
import { createUndoStack, planWrite, UNDO_LIMIT } from '../src/core/block-write';
import { findBlocks } from '../src/core/block-locate';
import { applyOp } from '../src/core/yaml-edit';

const NOTE = '# N\n```dynasty\na: 1\n```\n\n> ```dynasty\n> b: 1\n> ```\n';

describe('planWrite', () => {
	it('writes the edited body into the right block', () => {
		const r = planWrite(NOTE, 1, 'b: 1', () => ({ ok: true, body: 'b: 2\nc: 3' }));
		expect(r).toEqual({ ok: true, newText: '# N\n```dynasty\na: 1\n```\n\n> ```dynasty\n> b: 2\n> c: 3\n> ```\n', newBody: 'b: 2\nc: 3', oldBody: 'b: 1' });
	});

	it('the new body is what the next locate reads, even if the edit returned CRLF', () => {
		const r = planWrite(NOTE, 0, 'a: 1', () => ({ ok: true, body: 'a: 2\r\nb: 3' }));
		if (!r.ok) throw new Error(r.code);
		expect(r.newBody).toBe('a: 2\nb: 3');
		expect(findBlocks(r.newText)[0]?.body).toBe(r.newBody);
	});

	it('stale gives the current body and does not call the edit', () => {
		let called = false;
		const edit = () => {
			called = true;
			return { ok: true as const, body: '' };
		};
		expect(planWrite(NOTE, 0, 'a: 0', edit)).toEqual({ ok: false, code: 'stale', currentBody: 'a: 1' });
		expect(called).toBe(false);
	});

	it('missing and rejected', () => {
		expect(planWrite(NOTE, 2, 'a: 1', () => ({ ok: true, body: '' }))).toEqual({ ok: false, code: 'missing' });
		expect(planWrite(NOTE, 0, 'a: 1', () => ({ ok: false, reason: 'blocked' }))).toEqual({ ok: false, code: 'rejected', reason: 'blocked' });
	});

	it('an edit that throws is a refusal, not an exception (§8)', () => {
		const r = planWrite(NOTE, 0, 'a: 1', () => {
			throw new Error('boom');
		});
		expect(r).toEqual({ ok: false, code: 'rejected', reason: 'boom' });
	});
});

describe('createUndoStack', () => {
	it('keeps the last 20 entries', () => {
		const u = createUndoStack();
		for (let i = 0; i < UNDO_LIMIT + 3; i++) u.push(`${i}`, `${i + 1}`);
		expect(u.size).toBe(UNDO_LIMIT);
		let body = `${UNDO_LIMIT + 3}`;
		for (let n = 0; n < UNDO_LIMIT; n++) {
			const r = u.undo(body);
			if (!r.ok) throw new Error(r.code);
			body = r.body;
		}
		expect(body).toBe('3');
		expect(u.undo(body)).toEqual({ ok: false, code: 'empty' });
	});

	it('refuses after a foreign change and keeps the entry', () => {
		const u = createUndoStack();
		u.push('a', 'b');
		expect(u.canUndo('b')).toBe(true);
		expect(u.canUndo('x')).toBe(false);
		expect(u.undo('x')).toEqual({ ok: false, code: 'changed' });
		expect(u.size).toBe(1);
	});

	it('rewrites every entry with map, in order, and still undoes', () => {
		const u = createUndoStack();
		u.push('a', 'b');
		u.push('b', 'c');
		const seen: string[] = [];
		u.map((body) => {
			seen.push(body);
			return body.toUpperCase();
		});
		expect(seen).toEqual(['a', 'b', 'b', 'c']);
		expect(u.size).toBe(2);
		expect(u.canUndo('c')).toBe(false);
		expect(u.undo('C')).toEqual({ ok: true, body: 'B' });
		expect(u.undo('B')).toEqual({ ok: true, body: 'A' });
	});
});

describe('planWrite checks the written note (review F1)', () => {
	const note = 'Intro\n\n```dynasty\npeople:\n- id: a\n  name: A\n  notes: |\n   old\n```\n\nMy prose.\n\n```dynasty\npeople:\n- id: z\n```\n';

	it('refuses a body whose line would close the fence and spill the tree into the note', () => {
		const r = planWrite(note, 0, findBlocks(note)[0]!.body, (b) => ({ ok: true, body: b.replace('   old', '   see:\n   ```\n   end') }));
		expect(r).toMatchObject({ ok: false, code: 'rejected' });
	});

	it('the same change through applyOp is written safely', () => {
		const r = planWrite(note, 0, findBlocks(note)[0]!.body, (b) => {
			const e = applyOp(b, { kind: 'set-person-fields', id: 'a', fields: { notes: 'see:\n```\nend' } });
			return e.ok ? { ok: true, body: e.body } : { ok: false, reason: e.code };
		});
		if (!r.ok) throw new Error(r.code);
		expect(findBlocks(r.newText).map((b) => b.body)).toEqual([r.newBody, 'people:\n- id: z']);
	});
});
