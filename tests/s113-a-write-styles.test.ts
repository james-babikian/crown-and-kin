import { describe, expect, it } from 'vitest';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';

// Proof tests of review s113-a (version 0.2.3, area A). Each test must pass once the defect is
// fixed. A refused write is safe (the note is not touched) but the owner cannot do the edit.

function ok(body: string, op: Op): string {
	const r = applyOp(body, op);
	if (!r.ok) throw new Error(`${r.code}: ${r.detail ?? ''}`);
	return r.body;
}

describe('A1: a new list section next to a list whose dash is followed by more than one space', () => {
	// `-   id:` is what yq and PyYAML write with indent 4: the keys start 4 columns after the dash.
	const people = 'people:\n  -   id: a\n      name: A\n  -   id: b\n      name: B\n';

	it('add-house works', () => {
		expect(ok(people, { kind: 'add-house', name: 'Dos' })).toContain('id: dos');
	});
	it('add-title works', () => {
		expect(ok(people, { kind: 'add-title', id: 'duke', name: 'Duke' })).toContain('id: duke');
	});
	it('add-union with a type works (two keys in the new unions item)', () => {
		expect(ok(people, { kind: 'add-union', partners: ['a', 'b'], type: 'affair' })).toContain('affair');
	});
	it('add-parent with a second birth parent (automatic marriage) works', () => {
		const body = 'people:\n  -   id: a\n      name: A\n      parents: [b]\n  -   id: b\n      name: B\n  -   id: c\n      name: C\n';
		expect(ok(body, { kind: 'add-parent', child: 'a', parent: 'c', type: 'birth' })).toContain('partners');
	});
	it('also with the key on the line after a lone dash and a 4-column indent', () => {
		const body = 'people:\n  -\n      id: a\n      name: A\n';
		expect(ok(body, { kind: 'add-house', name: 'Dos' })).toContain('id: dos');
	});
});

describe('A2: a comment right after the dash of a list item', () => {
	const body = 'people:\n  - id: a\n    name: A\n  - # the heir\n    id: b\n    name: B\n';
	it('add-person at the end works when the first item has the comment', () => {
		const first = 'people:\n  - # the heir\n    id: b\n    name: B\n';
		expect(ok(first, { kind: 'add-person', id: 'n', fields: { name: 'N' } })).toContain('id: n');
	});
	it('add-person before the item works', () => {
		expect(ok(body, { kind: 'add-person', id: 'n', fields: { name: 'N' }, at: { kind: 'before', id: 'b' } })).toContain('id: n');
	});
	it('delete-person of the first of two items works', () => {
		const two = 'people:\n  - # the heir\n    id: b\n    name: B\n  - id: c\n    name: C\n';
		const out = ok(two, { kind: 'delete-person', id: 'b' });
		expect(out).toContain('id: c');
		expect(out).not.toContain('id: b');
	});
});

describe('A3: an item whose last text is a comment line or an empty value with a comment', () => {
	const next = '  - id: z\n    name: Z\n';
	const mk = (item: string) => `people:\n  - id: s\n    name: S\n${item}${next}  - id: t\n    name: T\n`;

	it('delete-person: parents block list followed by a comment line', () => {
		const out = ok(mk('  - id: p\n    name: P\n    parents:\n      - s\n      # check this\n'), { kind: 'delete-person', id: 'p' });
		expect(out).toContain('id: z');
	});
	it('delete-person: an empty value with an end-of-line comment (born:  # unknown)', () => {
		const out = ok(mk('  - id: p\n    name: P\n    born:  # unknown\n'), { kind: 'delete-person', id: 'p' });
		expect(out).toContain('id: z');
	});
	it('add-person after such a person', () => {
		const out = ok(mk('  - id: p\n    name: P\n    born:  # unknown\n'), { kind: 'add-person', id: 'n', fields: { name: 'N' }, at: { kind: 'after', id: 'p' } });
		expect(out).toContain('id: n');
	});
	it('delete-house: the unquoted colour slip `color: #8b1e3f` (spec section 8) as the last key', () => {
		const body = 'houses:\n  - id: v\n    name: V\n    color: #8b1e3f\n  - id: o\n    name: O\n';
		const out = ok(body, { kind: 'delete-house', id: 'v', people: 'keep' });
		expect(out).toContain('id: o');
	});
	it('move-sibling: gives a real refusal text, not "Patches overlap."', () => {
		const body = 'people:\n  - id: r\n    name: R\n  - id: a\n    name: A\n    parents: [r]\n    born:  # unknown\n  - id: b\n    name: B\n    parents: [r]\n';
		const r = applyOp(body, { kind: 'move-sibling', id: 'a', direction: 'later' });
		expect(r.ok).toBe(true);
	});
	it('add-title does not leave two blank lines before the new section', () => {
		const body = 'houses:\n  - id: v\n    name: V\n    color: #8b1e3f\n\npeople:\n  - id: a\n    name: A\n';
		expect(ok(body, { kind: 'add-title', id: 't', name: 'Duke' })).not.toMatch(/\n\n\n/);
	});
});

describe('A4: a block scalar whose header line has a comment', () => {
	it('set-person-fields on notes keeps the comment and writes the text', () => {
		const body = 'people:\n  - id: a\n    name: A\n    notes: |- # keep this\n      line one\n      line two\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { notes: 'changed' } });
		expect(out).toContain('# keep this');
		expect(out).toContain('changed');
	});
	it('also for a folded scalar', () => {
		const body = 'people:\n  - id: a\n    name: >- # keep this\n      Aldric\n      Valmont\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { name: 'Aldric' } });
		expect(out).toContain('# keep this');
	});
});

describe('A3 (more): the same cause with other last keys', () => {
	const next = '  - id: z\n    name: Z\n';
	const mk = (item: string) => `people:\n  - id: s\n    name: S\n${item}${next}`;
	it('delete-person: last key is a block map with a comment line below', () => {
		expect(ok(mk('  - id: p\n    name: P\n    extra:\n      k: v\n      # c\n'), { kind: 'delete-person', id: 'p' })).toContain('id: z');
	});
	it('delete-person: last key is a block list of maps with a comment line below', () => {
		expect(ok(mk('  - id: p\n    name: P\n    kids:\n      - a: 1\n      # c\n'), { kind: 'delete-person', id: 'p' })).toContain('id: z');
	});
	it('set-person-fields: adds born after a last key that is an empty value with an end-of-line comment', () => {
		expect(ok(mk('  - id: p\n    name: P\n    extra:\n      k: # c\n'), { kind: 'set-person-fields', id: 'p', fields: { born: '1100' } })).toContain('born');
	});
});

describe('A5 (note): a removed last key of a multi-line flow map leaves a line of spaces', () => {
	it('set-person-fields born null', () => {
		const body = 'people:\n  - {\n      id: a,\n      name: A, # keep\n      born: 1100\n    }\n';
		const out = ok(body, { kind: 'set-person-fields', id: 'a', fields: { born: null } });
		expect(out).toContain('# keep');
		expect(out.split('\n').filter((l) => l !== '' && l.trim() === '')).toEqual([]);
	});
});
