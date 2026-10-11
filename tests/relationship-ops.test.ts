import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import type { EditResult, Op } from '../src/core/edit';
import { parseDynasty, textWithoutComments } from '../src/core/parse';
import { familyOf } from '../src/core/family-query';
import { applyOp } from '../src/core/yaml-edit';
import { nextIdFor } from './helpers';

// Unit tests for the relationship ops (spec §6.2–§6.8) on YAML the golden files do not cover:
// flow-map people, flow lists, comments between items, CRLF, aliases, single-string parents.

function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
const edit = (src: string, op: Op) => body(applyOp(src, op));
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
function tree(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
}
const ids = (src: string) => tree(src).people.map((p) => p.id);

const PAIR = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n';

describe('add-person', () => {
	it('into an empty body creates the people section', () => {
		expect(edit('', { kind: 'add-person', id: 'x', fields: { name: 'X' } })).toBe('people:\n  - id: x\n    name: X');
	});

	it('keys in §4.1 order, parents as a flow sequence in the §4.2 form', () => {
		const out = edit(PAIR, {
			kind: 'add-person',
			id: 'c',
			fields: { notes: 'n', name: 'C', illegitimate: true, born: '1102', sex: 'f', placement: 'adoptive' },
			parents: [{ id: 'a', type: 'birth' }, { id: 'b', type: 'adoptive' }],
		});
		expect(out).toBe(PAIR + '  - id: c\n    name: C\n    sex: f\n    born: 1102\n    parents: [a, {id: b, type: adoptive}]\n    placement: adoptive\n    illegitimate: true\n    notes: n\n');
	});

	it('ids and values that need quotes get them', () => {
		const out = edit(PAIR, { kind: 'add-person', id: '0042', fields: { name: 'a: b', link: '[[Foo]]' }, parents: [{ id: 'a', type: 'birth' }] });
		expect(out).toContain('  - id: "0042"\n    name: "a: b"\n    parents: [a]\n    link: "[[Foo]]"');
		expect(tree(out).people[2]).toMatchObject({ id: '0042', name: 'a: b', link: '[[Foo]]' });
	});

	it('a multi-line value never writes a fence line', () => {
		const out = edit(PAIR, { kind: 'add-person', id: 'c', fields: { name: 'C', notes: 'x\n```\ny' } });
		expect(out.split('\n').some((l) => /^\s*```/.test(l))).toBe(false);
		expect(tree(out).people[2].notes).toBe('x\n```\ny');
	});

	it('into a block list of flow-map people: a block map at the same dash column', () => {
		const src = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}\n';
		expect(edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' }, at: { kind: 'after', id: 'a' } })).toBe(
			'people:\n  - {id: a, name: A}\n  - id: c\n    name: C\n  - {id: b, name: B}\n',
		);
	});

	it('into a flow people list: a flow map', () => {
		const src = 'people: [{id: a, name: A}, {id: b, name: B}]\n';
		expect(edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: [{ id: 'a', type: 'ward' }], at: { kind: 'before', id: 'b' } })).toBe(
			'people: [{id: a, name: A}, {id: c, name: C, parents: [{id: a, type: ward}]}, {id: b, name: B}]\n',
		);
	});

	it('before a person goes above the comments that person owns', () => {
		const src = 'people:\n  - id: a\n    name: A\n  # about b\n  - id: b\n    name: B\n';
		expect(edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' }, at: { kind: 'before', id: 'b' } })).toBe(
			'people:\n  - id: a\n    name: A\n  - id: c\n    name: C\n  # about b\n  - id: b\n    name: B\n',
		);
	});

	it('refusals: id-taken, unknown parent, bad values, limit', () => {
		expect(code(PAIR, { kind: 'add-person', id: 'a', fields: { name: 'A2' } })).toBe('id-taken');
		expect(code(PAIR, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: [{ id: 'zz', type: 'birth' }] })).toBe('unknown-person');
		expect(code(PAIR, { kind: 'add-person', id: 'c', fields: {} })).toBe('bad-value');
		expect(code(PAIR, { kind: 'add-person', id: ' c', fields: { name: 'C' } })).toBe('bad-value');
		expect(code(PAIR, { kind: 'add-person', id: 'c', fields: { name: 'C' }, at: { kind: 'after', id: 'zz' } })).toBe('unknown-person');
		const three = PAIR + '  - id: d\n    name: D\n';
		expect(code(three, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: ['a', 'b', 'd'].map((id) => ({ id, type: 'birth' as const })) })).toBe('limit');
	});

	it('CRLF bodies stay CRLF', () => {
		const src = PAIR.replace(/\n/g, '\r\n');
		const out = edit(src, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: [{ id: 'a', type: 'birth' }], at: { kind: 'after-siblings', parents: ['a'] } });
		expect(out).toBe('people:\r\n  - id: a\r\n    name: A\r\n  - id: c\r\n    name: C\r\n    parents: [a]\r\n  - id: b\r\n    name: B\r\n');
	});
});

describe('the next person id (§6.8, D104)', () => {
	it('is above every person id and every reference, and is a string', () => {
		const src = 'options:\n  start: p12\npeople:\n  - id: ada\n    name: Ada\n  - id: p2\n    name: B\n    parents: [p5]\n';
		expect(nextIdFor(src)).toBe('p13');
	});

	it('gives p1 for text that is not a block', () => {
		expect(nextIdFor('a: [')).toBe('p1');
	});
});

describe('add-parent', () => {
	it('a single id where a list was expected becomes a list', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: a\n';
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'rumoured' })).toBe(PAIR + '  - id: c\n    name: C\n    parents: [a, {id: b, type: rumoured}]\n');
	});

	it('into a flow-map person', () => {
		const src = 'people:\n  - {id: a, name: A}\n  - {id: b, name: B}   # note\n';
		expect(edit(src, { kind: 'add-parent', child: 'b', parent: 'a', type: 'birth' })).toBe('people:\n  - {id: a, name: A}\n  - {id: b, name: B, parents: [a]}   # note\n');
	});

	it('an empty parents value is filled', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents:\n';
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'a', type: 'birth' })).toBe(PAIR + '  - id: c\n    name: C\n    parents: [a]\n');
	});

	it('a block list gets a block item after its end-of-line comments', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents:\n      - a   # first\n';
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'ward' })).toBe(PAIR + '  - id: c\n    name: C\n    parents:\n      - a   # first\n      - {id: b, type: ward}\n');
	});

	it('cycle through any parent type', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [{id: b, type: adoptive}]\n  - id: d\n    name: D\n    parents: [{id: c, type: ward}]\n';
		expect(code(src, { kind: 'add-parent', child: 'b', parent: 'd', type: 'rumoured' })).toBe('cycle');
		expect(code(src, { kind: 'add-parent', child: 'b', parent: 'b', type: 'birth' })).toBe('cycle');
		expect(code(src, { kind: 'add-parent', child: 'd', parent: 'b', type: 'rumoured' })).toBe('ok');
	});

	it('automatic marriage for birth and adoptive parents only', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [{id: a, type: ward}, {id: a, type: adoptive}]\n';
		const ward = applyOp(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'ward' });
		expect(ward.ok && ward.effects).toBeFalsy();
		const adoptive = applyOp(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'adoptive' });
		expect(adoptive.ok && adoptive.effects).toEqual(['auto-union']);
		expect(body(adoptive)).toContain('\nunions:\n  - partners: [a, b]\n    type: marriage');
		expect(body(applyOp(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'adoptive', autoUnion: false }))).not.toContain('unions');
	});

	it('the automatic marriage goes into a flow unions list', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a]\nunions: []\n';
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' })).toContain('unions: [{partners: [a, b], type: marriage}]');
	});

	it('a batch reports the effect once', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a]\n';
		const r = applyOp(src, { kind: 'batch', ops: [{ kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' }, { kind: 'set-person-fields', id: 'c', fields: { title: 'T' } }] });
		expect(r.ok && r.effects).toEqual(['auto-union']);
	});
});

describe('unions', () => {
	const KIDS = PAIR + '  - id: c\n    name: C\n    parents: [a, b]\nunions: [{partners: [a, b], start: 1100}]\n';

	it('a second union in a flow list names the first and keeps its children', () => {
		expect(edit(KIDS, { kind: 'add-union', partners: ['b', 'a'], type: 'affair' })).toBe(
			PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n    union: a-b\nunions: [{id: a-b, partners: [a, b], start: 1100}, {partners: [b, a], type: affair}]\n',
		);
	});

	it('edit and remove a union in a flow list; the stale ref is refused', () => {
		const ref = { index: 0, partners: ['b', 'a'] as [string, string] };
		expect(edit(KIDS, { kind: 'edit-union', union: ref, fields: { type: 'betrothal', start: null } })).toContain('unions: [{partners: [a, b], type: betrothal}]');
		expect(edit(KIDS, { kind: 'remove-union', union: ref })).toBe(PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n');
		expect(code(KIDS, { kind: 'remove-union', union: { index: 0, partners: ['a', 'c'] } })).toBe('unknown-union');
		expect(code(KIDS, { kind: 'edit-union', union: { index: 3, partners: ['a', 'b'] }, fields: { start: '1' } })).toBe('unknown-union');
		expect(code(KIDS, { kind: 'edit-union', union: ref, fields: { type: 'handfast' } })).toBe('bad-value');
	});

	describe('refs carry the union text (the decision notes "Union references after WP3.3 review")', () => {
		const THREE = PAIR + '  - id: c\n    name: C\nunions:\n  - partners: [a, b]\n    start: 1100\n  - partners: [a, b]   # second\n    start: 1110\n  - partners: [a, b]\n    start: 1120\n';
		const refs = () => familyOf(deriveFamilies(tree(THREE)), 'a')!.partners.map((l) => l.union!);

		it('an old ref that now points at a sibling union of the same couple is refused', () => {
			const [first, second, third] = refs();
			expect(second.text).toBe('partners: [a, b] start: 1110');
			const after = edit(THREE, { kind: 'remove-union', union: first });
			// The second ref's index now holds the third union: same partners, other text.
			expect(code(after, { kind: 'edit-union', union: second, fields: { end: '1130' } })).toBe('unknown-union');
			expect(code(after, { kind: 'remove-union', union: third })).toBe('unknown-union');
			expect(code(after, { kind: 'add-person', id: 'd', fields: { name: 'D' }, at: { kind: 'after-siblings', parents: ['a', 'b'], union: second } })).toBe('unknown-union');
			expect(code(after, { kind: 'add-parent', child: 'c', parent: 'a', type: 'birth', union: second })).toBe('unknown-union');
			// A fresh ref works; comments and spacing do not count.
			const fresh = familyOf(deriveFamilies(tree(after)), 'a')!.partners[0].union!;
			expect(code(after, { kind: 'edit-union', union: { ...fresh, text: '  partners: [a, b]   # other\n  start: 1110' }, fields: { end: '1130' } })).toBe('ok');
		});

		it('add-parent with a chosen union that is not the last names it on the child', () => {
			const [first, , third] = refs();
			const withA = edit(THREE, { kind: 'add-parent', child: 'c', parent: 'a', type: 'birth' });
			const out = edit(withA, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth', union: first });
			expect(out).toContain('    parents: [a, b]\n    union: a-b\n');
			expect(out).toContain('unions:\n  - id: a-b\n    partners: [a, b]\n');
			expect(deriveFamilies(tree(out)).unionByKey.get('u0')!.children).toEqual(['c']);
			// The last-listed union needs no key.
			expect(edit(withA, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth', union: third })).not.toContain('union:');
			// Placement parents that are not the pair: no key.
			expect(edit(THREE, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth', union: first })).not.toContain('union:');
		});
	});

	it('a child for an earlier union names it, and that union gets an id', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n    union: second\nunions:\n  - partners: [a, b]\n  - id: second\n    partners: [a, b]\n';
		const out = edit(src, { kind: 'add-person', id: 'd', fields: { name: 'D' }, parents: [{ id: 'a', type: 'birth' }, { id: 'b', type: 'birth' }], at: { kind: 'after-siblings', parents: ['a', 'b'], union: { index: 0, partners: ['a', 'b'] } } });
		expect(out).toContain('  - id: d\n    name: D\n    parents: [a, b]\n    union: a-b\n');
		expect(out).toContain('unions:\n  - id: a-b\n    partners: [a, b]\n');
		const g = deriveFamilies(tree(out));
		expect(g.unionByKey.get('u0')!.children).toEqual(['d']);
		expect(g.unionByKey.get('u1')!.children).toEqual(['c']);
	});
});

describe('parent links', () => {
	it('set-parent-type keeps an id as typed, and back to birth writes the plain form', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: ["a", b]\n';
		const adopted = edit(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'birth', to: 'adoptive' });
		expect(adopted).toContain('parents: [{id: "a", type: adoptive}, b]');
		expect(edit(adopted, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'adoptive', to: 'birth' })).toBe(src);
	});

	it('set-parent-type on a single id', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: a\n';
		expect(edit(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'birth', to: 'ward' })).toContain('    parents: [{id: a, type: ward}]');
	});

	it('refusals: missing link, full type, existing link', () => {
		const src = PAIR + '  - id: d\n    name: D\n  - id: c\n    name: C\n    parents: [a, b, {id: d, type: ward}]\n';
		expect(code(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'ward', to: 'birth' })).toBe('bad-value');
		expect(code(src, { kind: 'set-parent-type', child: 'c', parent: 'd', from: 'ward', to: 'birth' })).toBe('limit');
		expect(code(src, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'ward' })).toBe('bad-value');
		expect(code(src, { kind: 'add-parent', child: 'c', parent: 'a', type: 'birth' })).toBe('bad-value');
		expect(code(src, { kind: 'add-parent', child: 'c', parent: 'd', type: 'birth' })).toBe('limit');
	});

	it('remove-parent from a flow list, a block list and a single id', () => {
		const flow = PAIR + '  - id: c\n    name: C\n    parents: [a, {id: b, type: rumoured}]\n';
		expect(edit(flow, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'rumoured' })).toBe(PAIR + '  - id: c\n    name: C\n    parents: [a]\n');
		expect(edit(flow, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'birth' })).toBe(PAIR + '  - id: c\n    name: C\n    parents: [{id: b, type: rumoured}]\n');
		const block = PAIR + '  - id: c\n    name: C\n    parents:\n      # the father\n      - a\n      - b   # mother\n    title: T\n';
		expect(edit(block, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' })).toBe(PAIR + '  - id: c\n    name: C\n    parents:\n      # the father\n      - a\n    title: T\n');
		const single = PAIR + '  - id: c\n    name: C\n    parents: a\n';
		expect(edit(single, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'birth' })).toBe(PAIR + '  - id: c\n    name: C\n');
	});
});

describe('keys left stale by an op (the decision notes "Relationship-op details")', () => {
	const ADOPTED = PAIR + '  - id: c\n    name: C\n    parents: [a, {id: b, type: adoptive}]\n    placement: adoptive\n    notes: n\n';

	it('placement goes with the last parent of its type, through remove-parent, set-parent-type and delete-person', () => {
		const without = PAIR + '  - id: c\n    name: C\n    parents: [a]\n    notes: n\n';
		expect(edit(ADOPTED, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'adoptive' })).toBe(without);
		expect(edit(ADOPTED, { kind: 'set-parent-type', child: 'c', parent: 'b', from: 'adoptive', to: 'ward' })).toBe(
			PAIR + '  - id: c\n    name: C\n    parents: [a, {id: b, type: ward}]\n    notes: n\n',
		);
		expect(edit(ADOPTED, { kind: 'delete-person', id: 'b' })).toBe('people:\n  - id: a\n    name: A\n  - id: c\n    name: C\n    parents: [a]\n    notes: n\n');
	});

	it('placement stays while a parent of its type remains, and a placement that was already stale is not touched', () => {
		const two = PAIR + '  - id: c\n    name: C\n    parents: [{id: a, type: adoptive}, {id: b, type: adoptive}]\n    placement: adoptive\n';
		expect(edit(two, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'adoptive' })).toContain('    parents: [{id: a, type: adoptive}]\n    placement: adoptive\n');
		const stale = PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n    placement: ward\n';
		expect(edit(stale, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' })).toContain('    parents: [a]\n    placement: ward\n');
	});

	it('union goes when it no longer names a union of the placement parents', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n    union: second\nunions:\n  - partners: [a, b]\n  - id: second\n    partners: [a, b]\n';
		expect(edit(src, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' })).toContain('    parents: [a]\nunions:');
		expect(edit(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'birth', to: 'rumoured' })).toContain('    parents: [{id: a, type: rumoured}, b]\nunions:');
		// Still the same pair: the key stays.
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'a', type: 'rumoured' })).toContain('    union: second\n');
	});

	it('add-parent: a child under an adoptive pair who gains a birth parent moves, and union goes', () => {
		const src = PAIR + '  - id: d\n    name: D\n  - id: c\n    name: C\n    parents: [{id: a, type: adoptive}, {id: b, type: adoptive}]\n    union: ab\nunions:\n  - partners: [a, b]\n  - id: ab\n    partners: [a, b]\n';
		const out = edit(src, { kind: 'add-parent', child: 'c', parent: 'd', type: 'birth' });
		expect(out).toContain('    parents: [{id: a, type: adoptive}, {id: b, type: adoptive}, d]\nunions:');
		// With placement: adoptive the pair stays, and so does the key.
		const kept = src.replace('    union: ab\n', '    placement: adoptive\n    union: ab\n');
		expect(edit(kept, { kind: 'add-parent', child: 'c', parent: 'd', type: 'birth' })).toContain('    union: ab\n');
	});

	it('one person as a parent of two types: allowed, removed one type at a time, and all at once on delete', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a]\n';
		const both = edit(src, { kind: 'add-parent', child: 'c', parent: 'a', type: 'rumoured' });
		expect(both).toContain('    parents: [a, {id: a, type: rumoured}]\n');
		expect(edit(both, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'birth' })).toContain('    parents: [{id: a, type: rumoured}]\n');
		expect(edit(both, { kind: 'delete-person', id: 'a' })).toBe('people:\n  - id: b\n    name: B\n  - id: c\n    name: C\n');
	});

	it('in a batch, staleness is judged once on the final data', () => {
		const src = PAIR + '  - id: c\n    name: C\n    parents: [a, b]\n    union: u1\nunions:\n  - id: u1\n    partners: [a, b]\n  - id: u2\n    partners: [a, b]\n';
		const back = edit(src, { kind: 'batch', ops: [{ kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' }, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' }] });
		expect(back).toContain('    parents: [a, b]\n    union: u1\n');
		const gone = edit(src, { kind: 'batch', ops: [{ kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' }, { kind: 'set-person-fields', id: 'c', fields: { title: 'T' } }] });
		expect(gone).toContain('    title: T\n    parents: [a]\nunions:');
	});

	it('in a batch, people without a written id are never changed by the cleanup', () => {
		const src = 'people:\n  - id: a\n  - id: b\n  - name: X\n    parents: [{id: a, type: adoptive}]\n    placement: adoptive\n';
		const out = edit(src, { kind: 'batch', ops: [{ kind: 'remove-parent', child: '~3', parent: 'a', type: 'adoptive' }, { kind: 'set-person-fields', id: 'a', fields: { title: 'T' } }] });
		// Outside a batch the key would go; inside one the id-less person is left as the ops wrote it.
		expect(out).toContain('  - name: X\n    placement: adoptive\n');
	});

	it('union text keeps the spaces inside quoted values', () => {
		expect(textWithoutComments('start: "Spring  1102"   # c\n  end:   1110')).toBe('start: "Spring  1102" end: 1110');
	});

	it('add-person never adds a marriage', () => {
		const r = applyOp(PAIR, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: [{ id: 'a', type: 'birth' }, { id: 'b', type: 'birth' }] });
		expect(r.ok && r.effects).toBeFalsy();
		expect(body(r)).not.toContain('unions');
	});
});

describe('move-sibling', () => {
	const KIDS = 'people:\n  - id: p\n    name: P\n  # first child\n  - id: x\n    name: X   # eol\n    parents: [p]\n\n  - id: y\n    name: Y\n    parents: [p]\n';

	it('swaps whole items with the comments they own; a blank line stays in place', () => {
		expect(edit(KIDS, { kind: 'move-sibling', id: 'x', direction: 'later' })).toBe(
			'people:\n  - id: p\n    name: P\n  - id: y\n    name: Y\n    parents: [p]\n\n  # first child\n  - id: x\n    name: X   # eol\n    parents: [p]\n',
		);
	});

	it('in a flow people list, and refused at the end of the group', () => {
		const src = 'people: [{id: p, name: P}, {id: x, name: X, parents: [p]}, {id: y, name: Y, parents: [p]}]';
		expect(edit(src, { kind: 'move-sibling', id: 'y', direction: 'earlier' })).toBe('people: [{id: p, name: P}, {id: y, name: Y, parents: [p]}, {id: x, name: X, parents: [p]}]');
		expect(code(src, { kind: 'move-sibling', id: 'y', direction: 'later' })).toBe('no-sibling');
		expect(code(src, { kind: 'move-sibling', id: 'p', direction: 'later' })).toBe('no-sibling');
	});

	it('siblings apart in the list swap places; people between them stay', () => {
		const src = 'people:\n  - id: p\n    name: P\n  - id: x\n    name: X\n    parents: [p]\n  - id: q\n    name: Q\n  - id: y\n    name: Y\n    parents: [p]\n';
		expect(ids(edit(src, { kind: 'move-sibling', id: 'x', direction: 'later' }))).toEqual(['p', 'y', 'q', 'x']);
	});

	it('CRLF', () => {
		const out = edit(KIDS.replace(/\n/g, '\r\n'), { kind: 'move-sibling', id: 'y', direction: 'earlier' });
		expect(out.replace(/\r\n/g, '')).not.toContain('\n');
		expect(ids(out)).toEqual(['p', 'y', 'x']);
	});
});

describe('delete-person', () => {
	it('keeps the comments above the item, removes its own lines', () => {
		const src = 'people:\n  - id: a\n    name: A\n  # about b\n  - id: b\n    name: B   # eol\n    parents: [a]\n';
		expect(edit(src, { kind: 'delete-person', id: 'a' })).toBe('people:\n  # about b\n  - id: b\n    name: B   # eol\n');
		expect(edit(src, { kind: 'delete-person', id: 'b' })).toBe('people:\n  - id: a\n    name: A\n  # about b\n');
	});

	it('in flow lists, with options in a flow map', () => {
		const src = 'options: {start: a, height: 400}\npeople: [{id: a, name: A}, {id: b, name: B, parents: [a]}]\nunions: [{partners: [a, b]}]';
		expect(edit(src, { kind: 'delete-person', id: 'a' })).toBe('options: {height: 400}\npeople: [{id: b, name: B}]');
	});

	it('the only person: the people section goes', () => {
		expect(edit('people:\n  - id: a\n    name: A\n', { kind: 'delete-person', id: 'a' })).toBe('');
	});

	it('every union item that lists the person goes', () => {
		const src = PAIR + 'unions:\n  - partners: [a, b]\n  - partners: [b, a]\n    type: affair\n';
		expect(edit(src, { kind: 'delete-person', id: 'a' })).toBe('people:\n  - id: b\n    name: B\n');
	});
});

describe('comment ownership (review round 1)', () => {
	it('a deeper comment below an item is its own: removed with it, carried by a move; a comment at the dash column stays for the next item', () => {
		const src = 'people:\n  - id: p\n  - id: a\n    parents: [p]\n    # about a\n  # about b\n  - id: b\n    parents: [p]\n';
		expect(edit(src, { kind: 'delete-person', id: 'a' })).toBe('people:\n  - id: p\n  # about b\n  - id: b\n    parents: [p]\n');
		expect(edit(src, { kind: 'move-sibling', id: 'a', direction: 'later' })).toBe('people:\n  - id: p\n  # about b\n  - id: b\n    parents: [p]\n  - id: a\n    parents: [p]\n    # about a\n');
	});

	it('a deeper comment above an item after a blank line is nobody\'s and stays in place', () => {
		const src = 'people:\n  - id: p\n  - id: a\n    parents: [p]\n\n    # loose\n  - id: b\n    parents: [p]\n';
		expect(edit(src, { kind: 'move-sibling', id: 'b', direction: 'earlier' })).toBe('people:\n  - id: p\n  - id: b\n    parents: [p]\n\n    # loose\n  - id: a\n    parents: [p]\n');
	});

	it('in a multi-line flow list, a comment moves to the other line when only one item has one', () => {
		const src = 'people: [\n  {id: p},\n  {id: a, parents: [p]},\n  {id: b, parents: [p]} # about b\n]\n';
		expect(edit(src, { kind: 'move-sibling', id: 'b', direction: 'earlier' })).toBe('people: [\n  {id: p},\n  {id: b, parents: [p]}, # about b\n  {id: a, parents: [p]}\n]\n');
	});

	it('a move that would give a comment another owner is refused', () => {
		// Two items on one line: the comment belongs to the last of them and cannot follow b alone.
		const src = 'people: [\n  {id: p},\n  {id: a, parents: [p]}, {id: b, parents: [p]}, # about b\n]\n';
		const r = applyOp(src, { kind: 'move-sibling', id: 'b', direction: 'earlier' });
		expect(r.ok ? 'ok' : r.code).toBe('bad-value');
	});

	it('a flow item alone on its line goes with its line and its own comment', () => {
		const src = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [\n      a, # the father\n      b  # the mother\n    ]\n';
		expect(edit(src, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'birth' })).toBe('people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [\n      b  # the mother\n    ]\n');
		expect(edit(src, { kind: 'remove-parent', child: 'c', parent: 'b', type: 'birth' })).toBe('people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [\n      a # the father\n    ]\n');
	});

	it('flow items sharing a line with others: a comment on another line is never allowed to go', () => {
		const src = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: [a,\n      # note\n      {id: a, type: ward}, b]\n';
		const r = applyOp(src, { kind: 'delete-person', id: 'a' });
		expect(r.ok ? r.body : r.code).toMatch(/# note|bad-value/);
	});

	it('an item between two blank lines leaves one blank line', () => {
		const src = 'people:\n  - id: a\n\n  - id: b\n\n  - id: c\n';
		expect(edit(src, { kind: 'delete-person', id: 'b' })).toBe('people:\n  - id: a\n\n  - id: c\n');
	});
});

describe('a single parent map where a list was expected', () => {
	const BLOCK = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents:\n      id: a\n      type: ward\n';

	it('a block map becomes a flow list in the §4.2 form when it changes or grows', () => {
		expect(edit(BLOCK, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'ward', to: 'adoptive' })).toContain('    parents: [{id: a, type: adoptive}]\n');
		expect(edit(BLOCK, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' })).toContain('    parents: [{id: a, type: ward}, b]\n');
		expect(edit(BLOCK, { kind: 'remove-parent', child: 'c', parent: 'a', type: 'ward' })).toBe('people:\n  - id: a\n  - id: b\n  - id: c\n');
	});

	it('a map with an unknown key keeps its form on a type change, and cannot grow', () => {
		const src = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents: {id: a, type: ward, since: 1140}\n';
		expect(edit(src, { kind: 'set-parent-type', child: 'c', parent: 'a', from: 'ward', to: 'birth' })).toContain('    parents: {id: a, type: birth, since: 1140}\n');
		expect(edit(src, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' })).toContain('    parents: [{id: a, type: ward, since: 1140}, b]\n');
		const block = 'people:\n  - id: a\n  - id: b\n  - id: c\n    parents:\n      id: a\n      since: 1140\n';
		expect(code(block, { kind: 'add-parent', child: 'c', parent: 'b', type: 'birth' })).toBe('bad-value');
	});
});

describe('refusal details', () => {
	it('never a raw error text', () => {
		const r = applyOp('defs: &o {start: a}\noptions: *o\npeople:\n  - id: a\n  - id: b\n', { kind: 'delete-person', id: 'a' });
		expect(r.ok ? '' : r.detail).toBe('The options are written as a YAML alias. Edit the note text.');
	});
});

describe('aliases', () => {
	it('a person written as an alias is refused, not changed', () => {
		const src = 'people:\n  - &a {id: a, name: A}\n  - *a\n';
		// Two people with id a block editing (§8).
		expect(code(src, { kind: 'delete-person', id: 'a' })).toBe('blocked');
	});

	it('a removal that would orphan an alias is refused', () => {
		const src = 'people:\n  - id: a\n    name: &n Ann\n  - id: b\n    name: *n\n    parents: [a]\n';
		expect(code(src, { kind: 'delete-person', id: 'a' })).toBe('bad-value');
		expect(code(src, { kind: 'add-parent', child: 'a', parent: 'b', type: 'birth' })).toBe('cycle');
		expect(code(src, { kind: 'add-person', id: 'c', fields: { name: 'C' }, parents: [{ id: 'a', type: 'birth' }], at: { kind: 'after-siblings', parents: ['a'] } })).toBe('ok');
	});

	it('an aliased parent entry is found and removed', () => {
		const src = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n    parents: [&p a]\n  - id: c\n    name: C\n    parents: [*p]\n';
		expect(ids(edit(src, { kind: 'delete-person', id: 'c' }))).toEqual(['a', 'b']);
		expect(code(src, { kind: 'remove-parent', child: 'b', parent: 'a', type: 'birth' })).toBe('bad-value');
	});
});

describe('blocked trees', () => {
	it('every op is refused while editing is off', () => {
		const src = 'people:\n  - id: a\n    name: A\n  - id: a\n    name: A2\n';
		for (const op of [
			{ kind: 'add-person', id: 'x', fields: { name: 'X' } },
			{ kind: 'delete-person', id: 'a' },
			{ kind: 'move-sibling', id: 'a', direction: 'later' },
		] as Op[])
			expect(code(src, op)).toBe('blocked');
	});
});
