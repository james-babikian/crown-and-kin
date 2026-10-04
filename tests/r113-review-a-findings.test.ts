import { describe, expect, it } from 'vitest';
import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { dashOf } from '../src/core/yaml-list';
import { isRefusal, parse as parseSource } from '../src/core/yaml-patch';
import type { Node, YAMLSeq } from 'yaml';

// Review of version 0.2.3, area A (core). Each test is a proof of one finding. They fail on release-0.2.3.
// RA1..RA4 name the findings of the report. The inputs worked (or were refused) in v0.2.2 as noted.

function ok(body: string, op: Op): string {
	const r = applyOp(body, op);
	if (!r.ok) throw new Error(`refused ${r.code}: ${r.detail ?? ''}`);
	return r.body;
}

describe('RA1: a line of spaces that belongs to a block scalar (v0.2.2 wrote these; 0.2.3 refuses or leaves it behind)', () => {
	// `notes: |` with content at 6 columns, then a line of 8 spaces: the line is text of the scalar
	// (the editor leaves it when someone presses Enter inside the indented text).
	const scalar = (style: string) => `people:\n  - id: p1\n    name: One\n    notes: ${style}\n      line one\n        \n  - id: p2\n    name: Two\n`;

	for (const style of ['|', '|-', '>']) {
		it(`add-person after a person whose notes are "${style}" with a line of spaces is written`, () => {
			const out = ok(scalar(style), { kind: 'add-person', id: 'zz', fields: { name: 'Z' }, at: { kind: 'after', id: 'p1' } });
			expect(out).toContain('  - id: zz\n    name: Z\n  - id: p2');
		});
		it(`set-person-fields notes on "${style}" with a line of spaces is written`, () => {
			const out = ok(scalar(style), { kind: 'set-person-fields', id: 'p1', fields: { notes: 'changed' } });
			expect(out).toContain('changed');
		});
		it(`delete-person removes the whole item, with no line of spaces left behind, for "${style}"`, () => {
			expect(ok(scalar(style), { kind: 'delete-person', id: 'p1' })).toBe('people:\n  - id: p2\n    name: Two\n');
		});
		it(`set-person-fields notes: null removes the key, with no line of spaces left behind, for "${style}"`, () => {
			expect(ok(scalar(style), { kind: 'set-person-fields', id: 'p1', fields: { notes: null } })).toBe('people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\n');
		});
	}
});

describe('RA2: a comment about the next person is deleted with the item before it (v0.2.2 refused these; 0.2.3 writes and loses the comment)', () => {
	// The last key of p2 is a block map or list that ends with a comment indented deeper than the
	// key. The comment line that follows it, at the dash column of the next item, is owned by p3
	// (`itemStart` says so), but the range of the node swallows it.
	const body = 'people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\n    parents:\n      - id: p1\n        type: ward\n        # deep\n  # about p3\n  - id: p3\n    name: Three\n';

	it('delete-person keeps "# about p3"', () => {
		expect(ok(body, { kind: 'delete-person', id: 'p2' })).toContain('# about p3');
	});
	it('remove-parent of the last parent keeps "# about p3"', () => {
		expect(ok(body, { kind: 'remove-parent', child: 'p2', parent: 'p1', type: 'ward' })).toContain('# about p3');
	});
	it('remove-union of the only union keeps the "# end comment" at column 0 after a comment inside the union (also lost in v0.2.2)', () => {
		const b = 'people:\n  - id: p1\n    name: One\n  - id: p2\n    name: Two\nunions:\n  - partners: [p1, p2]\n    type: marriage\n    # in union\n# end comment\n';
		expect(ok(b, { kind: 'remove-union', union: { index: 0, partners: ['p1', 'p2'] } })).toContain('# end comment');
	});
	it('delete-person keeps a comment at column 0 that follows the deep comment', () => {
		expect(ok(body.replace('  # about p3', '# about p3'), { kind: 'delete-person', id: 'p2' })).toContain('# about p3');
	});
});

describe('RA3: removing two neighbouring pairs of a flow map written over several lines leaves an empty line', () => {
	for (const eol of ['\n', '\r\n']) {
		it(`born and title (the last two pairs), ${eol === '\n' ? 'LF' : 'CRLF'}`, () => {
			const body = 'people:\n  - id: p0\n    name: Zero\n  - {\n      id: p1,\n      name: One,\n      born: 1100,\n      title: Duke\n    }\n'.replace(/\n/g, eol);
			const out = ok(body, { kind: 'set-person-fields', id: 'p1', fields: { born: null, title: null } });
			expect(out.replace(/\r/g, '')).not.toMatch(/\n[ \t]*\n/);
		});
	}
});

describe('RA4: dashOf takes a "-" at the end of a comment line for the dash of the item', () => {
	it('a comment line between the dash and the keys that ends with a hyphen: delete-person works', () => {
		const body = 'people:\n  - id: p0\n    name: Zero\n  -\n    # see Jean-\n    id: p1\n    name: One\n  - id: p2\n    name: Two\n';
		expect(ok(body, { kind: 'delete-person', id: 'p1' })).toBe('people:\n  - id: p0\n    name: Zero\n  - id: p2\n    name: Two\n');
	});
	it('dashOf points at the dash', () => {
		const text = 'people:\n  - id: p0\n    name: Zero\n  -\n    # see Jean-\n    id: p1\n    name: One\n';
		const p = parseSource(text);
		if (isRefusal(p)) throw new Error('parse');
		const top = p.src.doc.contents as unknown as { items: { value: YAMLSeq }[] };
		const seq = top.items[0].value;
		const at = dashOf(p.src, seq.items[1] as Node);
		expect(text.slice(p.src.lineStart(at), at + 1)).toBe('  -');
	});
});
