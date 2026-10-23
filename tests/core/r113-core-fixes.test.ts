import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Op } from '../../src/core/edit';
import { REFUSAL_TEXT } from '../../src/core/refusal-text';
import { applyOp } from '../../src/core/yaml-edit';
import { parseBody } from '../../src/core/parse';

// Fix round of version 0.2.3 (core): the review findings RA1 to RA4 and the single copy of the
// refusal sentences (X10). The proofs of the reviewer are in `r113-review-a-findings.test.ts`.

function ok(body: string, op: Op): string {
	const r = applyOp(body, op);
	if (!r.ok) throw new Error(`refused ${r.code}: ${r.detail ?? ''}`);
	expect(parseBody(r.body).ok).toBe(true);
	return r.body;
}

const crlf = (s: string) => s.replace(/\n/g, '\r\n');

describe('RA1: a line of spaces inside a block scalar', () => {
	const item = (notes: string) => `people:\n  - id: p1\n    name: One\n    notes: ${notes}\n  - id: p2\n    name: Two\n`;

	it('add-person after a person whose scalar ends the body with a line of spaces and no final line break', () => {
		const body = 'people:\n  - id: p1\n    name: One\n    notes: |\n      line one\n        ';
		const out = ok(body, { kind: 'add-person', id: 'zz', fields: { name: 'Z' }, at: { kind: 'after', id: 'p1' } });
		expect(out).toBe(body + '\n  - id: zz\n    name: Z');
	});
	it('set-person-fields notes on that last scalar replaces the whole scalar, spaces included', () => {
		const body = 'people:\n  - id: p1\n    name: One\n    notes: |\n      line one\n        \n';
		expect(ok(body, { kind: 'set-person-fields', id: 'p1', fields: { notes: 'changed' } })).toBe('people:\n  - id: p1\n    name: One\n    notes: |-\n      changed\n');
	});
	it('keeps every line of spaces when the item is not the one that changes', () => {
		const body = item('|\n      line one\n        \n      line two\n        ');
		const out = ok(body, { kind: 'set-person-fields', id: 'p2', fields: { name: 'Zwei' } });
		expect(out).toBe(body.replace('Two', 'Zwei'));
	});
	it('delete-person with CRLF line breaks leaves nothing behind', () => {
		const body = crlf(item('|\n      line one\n        '));
		expect(ok(body, { kind: 'delete-person', id: 'p1' })).toBe(crlf('people:\n  - id: p2\n    name: Two\n'));
	});
	it('add-person with CRLF line breaks writes after the line of spaces', () => {
		const body = crlf(item('>\n      line one\n        '));
		const out = ok(body, { kind: 'add-person', id: 'zz', fields: { name: 'Z' }, at: { kind: 'after', id: 'p1' } });
		expect(out).toContain(crlf('        \n  - id: zz\n    name: Z\n  - id: p2'));
	});
	it('a "|+" scalar keeps its lines of spaces', () => {
		const body = item('|+\n      line one\n        \n\n');
		expect(ok(body, { kind: 'set-person-fields', id: 'p2', fields: { name: 'Zwei' } })).toBe(body.replace('Two', 'Zwei'));
	});
	it('a line of spaces after a comment that follows the scalar is not text of it: the new item goes before it', () => {
		const body = 'people:\n  - id: p1\n    name: One\n    notes: |\n      line one\n    # about p1\n    \n  - id: p2\n    name: Two\n';
		const out = ok(body, { kind: 'add-person', id: 'zz', fields: { name: 'Z' }, at: { kind: 'after', id: 'p1' } });
		expect(out).toBe('people:\n  - id: p1\n    name: One\n    notes: |\n      line one\n    # about p1\n  - id: zz\n    name: Z\n    \n  - id: p2\n    name: Two\n');
	});
});

describe('RA2: a comment of the next item stays when the item before it goes', () => {
	const people = (comment: string) =>
		`people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\n    parents:\n      - id: p1\n        type: ward\n        # deep\n${comment}  - id: p3\n    name: Three\n`;

	it('delete-person keeps the deep comment out of the cut: only the comment inside the item goes', () => {
		expect(ok(people('  # about p3\n'), { kind: 'delete-person', id: 'p2' })).toBe('people:\n  - id: p1\n    name: One\n  # about p3\n  - id: p3\n    name: Three\n');
	});
	it('with CRLF line breaks', () => {
		expect(ok(crlf(people('  # about p3\n')), { kind: 'delete-person', id: 'p2' })).toBe(crlf('people:\n  - id: p1\n    name: One\n  # about p3\n  - id: p3\n    name: Three\n'));
	});
	it('a comment deeper than the dash stays with the item and goes with it', () => {
		const out = ok(people('    # still p2\n'), { kind: 'delete-person', id: 'p2' });
		expect(out).not.toContain('still p2');
		expect(out).toBe('people:\n  - id: p1\n    name: One\n  - id: p3\n    name: Three\n');
	});
	it('remove-parent of the last parent keeps a comment at the dash column', () => {
		const out = ok(people('  # about p3\n'), { kind: 'remove-parent', child: 'p2', parent: 'p1', type: 'ward' });
		expect(out).toBe('people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\n  # about p3\n  - id: p3\n    name: Three\n');
	});
	it('remove-parent of the last parent keeps a comment at the key column that follows the deeper one', () => {
		const out = ok(people('    # about the next key\n'), { kind: 'remove-parent', child: 'p2', parent: 'p1', type: 'ward' });
		expect(out).toContain('# about the next key');
		expect(out).not.toContain('# deep');
	});
	it('a blank line between the deep comment and the next comment stays in front of it', () => {
		const out = ok(people('\n  # about p3\n'), { kind: 'delete-person', id: 'p2' });
		expect(out).toBe('people:\n  - id: p1\n    name: One\n\n  # about p3\n  - id: p3\n    name: Three\n');
	});
	it('the section "unions" goes with its own comments and leaves the comment at column 0 after it', () => {
		const b = 'people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\nunions:\n  - partners: [p1, p2]\n    type: marriage\n    # in union\n# end comment\n';
		expect(ok(b, { kind: 'remove-union', union: { index: 0, partners: ['p1', 'p2'] } })).toBe('people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\n# end comment\n');
	});
	it('add-person after the last item still puts the item after its own deep comment', () => {
		const b = 'people:\n  - id: p1\n    name: One\n    parents:\n      - id: p0\n        type: ward\n        # deep\n# end\n';
		const out = ok(b, { kind: 'add-person', id: 'zz', fields: { name: 'Z' }, at: { kind: 'after', id: 'p1' } });
		expect(out).toBe('people:\n  - id: p1\n    name: One\n    parents:\n      - id: p0\n        type: ward\n        # deep\n  - id: zz\n    name: Z\n# end\n');
	});
});

describe('RA3: two or more neighbouring pairs of a multi-line flow map', () => {
	const map = (pairs: string[]) => `people:\n  - id: p0\n    name: Zero\n  - {\n${pairs.map((p) => '      ' + p).join(',\n')}\n    }\n`;
	const all = ['id: p1', 'name: One', 'born: 1100', 'title: Duke', 'house: h'];
	const remove = (keys: string[]) => ok(map(all), { kind: 'set-person-fields', id: 'p1', fields: Object.fromEntries(keys.map((k) => [k, null])) });
	const without = (keys: string[]) => map(all.filter((p) => !keys.includes(p.split(':')[0])));

	// The last pairs go with their lines. The comma after the last pair that stays is valid YAML; it stays.
	it('the last two', () => {
		expect(remove(['title', 'house'])).toBe(without(['title', 'house']).replace('born: 1100\n', 'born: 1100,\n'));
	});
	it('the last three', () => {
		expect(remove(['born', 'title', 'house'])).toBe(without(['born', 'title', 'house']).replace('name: One\n', 'name: One,\n'));
	});
	it('two in the middle', () => {
		expect(remove(['born', 'title'])).toBe(without(['born', 'title']));
	});
	it('two that do not touch', () => {
		expect(remove(['born', 'house'])).toBe(without(['born', 'house']));
	});
	it('a pair alone, as before', () => {
		expect(remove(['title'])).toBe(without(['title']));
		expect(remove(['house'])).toBe(without(['house']));
	});
	it('with CRLF line breaks', () => {
		const out = ok(crlf(map(all)), { kind: 'set-person-fields', id: 'p1', fields: { born: null, title: null } });
		expect(out).toBe(crlf(without(['born', 'title'])));
	});
});

describe('RA4: a hyphen at the end of a comment is not a dash', () => {
	it('a comment after the dash on its own line', () => {
		const body = 'people:\n  - id: p0\n    name: Zero\n  - # see Jean-\n    id: p1\n    name: One\n  - id: p2\n    name: Two\n';
		expect(ok(body, { kind: 'delete-person', id: 'p1' })).toBe('people:\n  - id: p0\n    name: Zero\n  - id: p2\n    name: Two\n');
	});
	it('comment lines that all end with a hyphen', () => {
		const body = 'people:\n  - id: p0\n    name: Zero\n  -\n    # one-\n    # two -\n    id: p1\n    name: One\n  - id: p2\n    name: Two\n';
		expect(ok(body, { kind: 'delete-person', id: 'p1' })).toBe('people:\n  - id: p0\n    name: Zero\n  - id: p2\n    name: Two\n');
	});
});

describe('X10: every refusal sentence of the core is written once', () => {
	it('no sentence of REFUSAL_TEXT appears as a literal in another file of src/core', () => {
		const dir = new URL('../../src/core/', import.meta.url);
		const found: string[] = [];
		for (const f of readdirSync(dir)) {
			if (!f.endsWith('.ts') || f === 'refusal-text.ts') continue;
			const text = readFileSync(new URL(f, dir), 'utf8');
			for (const s of Object.values(REFUSAL_TEXT)) if (text.includes(s)) found.push(`${f}: ${s}`);
		}
		expect(found).toEqual([]);
	});
	it('the sentences stay as they were', () => {
		expect(REFUSAL_TEXT.titleName).toBe('A title must have a name.');
		expect(REFUSAL_TEXT.personName).toBe('A person must have a name.');
		const r = applyOp('people:\n  - id: p1\n    name: One\n', { kind: 'add-title', id: 't', name: '' });
		expect(r.ok ? '' : r.detail).toBe('A title must have a name.');
	});
});
