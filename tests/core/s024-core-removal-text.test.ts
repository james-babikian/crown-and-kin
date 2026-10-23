import { describe, expect, it } from 'vitest';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';

// 0.2.4 fix of C2 and C3: the written text, not only "the write is not refused".

const body = (r: ReturnType<typeof applyOp>) => (r.ok ? r.body : `REFUSED ${r.code}`);

describe('s024 C2: a deeper comment after a key that follows a block scalar', () => {
	const src = 'people:\n  - id: p0\n    notes: |\n      text\n    born: 1\n      # deeper comment\n    died: 2\n';

	it('moves the comment to the key column, so it no longer joins the scalar', () => {
		const r = applyOp(src, { kind: 'set-person-fields', id: 'p0', fields: { born: null } });
		expect(body(r)).toBe('people:\n  - id: p0\n    notes: |\n      text\n    # deeper comment\n    died: 2\n');
		const p = parseDynasty(body(r));
		expect(p.ok && p.tree.people[0].notes).toBe('text');
	});

	it('keeps a blank line between the key and the comment (not after a `|+` scalar)', () => {
		const s = 'people:\n  - id: p0\n    notes: |\n      text\n    born: 1\n\n      # deeper comment\n';
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'p0', fields: { born: null } }))).toBe('people:\n  - id: p0\n    notes: |\n      text\n\n    # deeper comment\n');
	});

	it('leaves a comment at the key column where it is', () => {
		const s = 'people:\n  - id: p0\n    notes: |\n      text\n    born: 1\n    # own comment\n    died: 2\n';
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'p0', fields: { born: null } }))).toBe('people:\n  - id: p0\n    notes: |\n      text\n    # own comment\n    died: 2\n');
	});

	it('writes the same with CRLF line breaks', () => {
		const s = src.replace(/\n/g, '\r\n');
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'p0', fields: { born: null } }))).toBe(
			'people:\n  - id: p0\n    notes: |\n      text\n    # deeper comment\n    died: 2\n'.replace(/\n/g, '\r\n'),
		);
	});

	it('delete-person works for the last person after a `notes: |` block with a deeper comment', () => {
		const s = 'people:\n  - id: p0\n    name: A\n  - id: p1\n    notes: |\n      text\n      # in the text\n    name: B\n      # deeper\n';
		const r = applyOp(s, { kind: 'delete-person', id: 'p1' });
		expect(body(r)).toBe('people:\n  - id: p0\n    name: A\n');
	});

	it('removes a parent and keeps the comment', () => {
		const s = 'people:\n  - id: p1\n  - id: p2\n    notes: |-\n      only\n    parents: [p1]\n      # deeper comment\n';
		expect(body(applyOp(s, { kind: 'remove-parent', child: 'p2', parent: 'p1', type: 'birth' }))).toBe('people:\n  - id: p1\n  - id: p2\n    notes: |-\n      only\n    # deeper comment\n');
	});

	it('the text of the scalar itself is untouched, also a "#" line inside it', () => {
		const s = 'people:\n  - id: p0\n    notes: |\n      text\n      # in the text\n    born: 1\n';
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'p0', fields: { born: null } }))).toBe('people:\n  - id: p0\n    notes: |\n      text\n      # in the text\n');
	});
});

describe('s024 C3: blank lines after a key that follows a `|+` scalar', () => {
	const src = 'people:\n  - id: a\n    name: A\n    notes: |+\n      keep\n\n    house: h1\n\n    born: 1\nhouses:\n  - {id: h1, name: H}\n';

	it('takes the blank lines after the key with it', () => {
		const r = applyOp(src, { kind: 'set-person-fields', id: 'a', fields: { house: null } });
		expect(body(r)).toBe('people:\n  - id: a\n    name: A\n    notes: |+\n      keep\n\n    born: 1\nhouses:\n  - {id: h1, name: H}\n');
	});

	it('takes the blank lines before a deeper comment, and moves the comment', () => {
		const s = 'people:\n  - id: a\n    notes: |+\n      keep\n\n    house: h1\n\n      # c\n    born: 1\n';
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'a', fields: { house: null } }))).toBe('people:\n  - id: a\n    notes: |+\n      keep\n\n    # c\n    born: 1\n');
	});

	it('the blank line stays when the key before is not a `|+` scalar', () => {
		const s = 'people:\n  - id: a\n    notes: |\n      keep\n    house: h1\n\n    born: 1\n';
		expect(body(applyOp(s, { kind: 'set-person-fields', id: 'a', fields: { house: null } }))).toBe('people:\n  - id: a\n    notes: |\n      keep\n\n    born: 1\n');
	});
});

describe('s024 C2: delete-person that removes a stale key of another person', () => {
	it('removes the parent entry (and the stale placement) after a `notes: |` block with a deeper comment', () => {
		const s = 'people:\n  - id: p1\n    name: A\n  - id: p2\n    notes: |\n      text\n    parents: [p1]\n      # deeper comment\n';
		expect(body(applyOp(s, { kind: 'delete-person', id: 'p1' }))).toBe('people:\n  - id: p2\n    notes: |\n      text\n    # deeper comment\n');
	});
});
