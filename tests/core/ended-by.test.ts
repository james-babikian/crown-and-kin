/*
 * D306 (0.5 step 1a-A): the partnership key `ended-by`. `readEndedBy` reads it; the parser, the family graph and the
 * family query carry the raw trimmed text; `edit-union` writes it with a minimal diff. Unknown keys, unknown values,
 * comments and flow style survive. The read rules are an internal note §4 and §9 item 3.
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { EditResult, Op } from '../../src/core/edit';
import { familyOf } from '../../src/core/family-query';
import { parseDynasty } from '../../src/core/parse';
import { UNION_ORDER } from '../../src/core/relationship-ops';
import { ENDED_BY, readEndedBy } from '../../src/core/types';
import { applyOp } from '../../src/core/yaml-edit';

const edit = (src: string, op: Op): string => {
	const r: EditResult = applyOp(src, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const code = (src: string, op: Op) => {
	const r = applyOp(src, op);
	return r.ok ? 'ok' : r.code;
};
const read = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};

const PEOPLE = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n';
const REF = { index: 0, partners: ['a', 'b'] as [string, string] };
const set = (value: string | null): Op => ({ kind: 'edit-union', union: REF, fields: { 'ended-by': value } });
const block = (lines: string[]) => PEOPLE + 'unions:\n' + lines.map((l) => '  ' + l).join('\n') + '\n';

describe('readEndedBy', () => {
	it('lists the three values', () => {
		expect([...ENDED_BY]).toEqual(['divorce', 'annulment', 'death']);
	});

	it('reads a value in any case, trimmed', () => {
		expect(readEndedBy('divorce')).toBe('divorce');
		expect(readEndedBy('  Annulment ')).toBe('annulment');
		expect(readEndedBy('DEATH')).toBe('death');
	});

	it('reads the aliases divorced and annulled', () => {
		expect(readEndedBy('divorced')).toBe('divorce');
		expect(readEndedBy(' Annulled')).toBe('annulment');
	});

	it('gives null for anything else', () => {
		for (const raw of ['separation', '', '  ', 'dead', 'death of', '1', 'true', undefined, null]) expect(readEndedBy(raw), String(raw)).toBeNull();
	});
});

describe('the parser, the graph and the family query', () => {
	const src = block(['- partners: [a, b]', '  ended-by: " Divorce "', '- partners: [a, b]', '  ended-by: separation', '- partners: [a, b]']);

	it('keeps the raw trimmed text in Union.endedBy and nothing when the key is absent', () => {
		const unions = read(src).unions;
		expect(unions.map((u) => u.endedBy)).toEqual(['Divorce', 'separation', undefined]);
		expect('endedBy' in unions[2]).toBe(false);
	});

	it('reads a number, a boolean, a list and a map as text or as absent', () => {
		const unions = read(block(['- {partners: [a, b], ended-by: 5}', '- {partners: [a, b], ended-by: true}', '- {partners: [a, b], ended-by: [divorce]}', '- {partners: [a, b], ended-by: {x: 1}}', '- {partners: [a, b], ended-by: }'])).unions;
		expect(unions.map((u) => u.endedBy)).toEqual(['5', 'true', undefined, undefined, undefined]);
	});

	it('gives no warning for any value', () => {
		expect(read(src).issues).toEqual([]);
		const g = deriveFamilies(read(src));
		expect(g.issues.filter((i) => /ended/i.test(JSON.stringify(i)))).toEqual([]);
	});

	it('carries the text to FamilyUnion and PartnerLink for a listed union, not for an implicit one', () => {
		const g = deriveFamilies(read(src));
		expect(g.unions.map((u) => u.endedBy)).toEqual(['Divorce', 'separation', undefined]);
		expect(familyOf(g, 'a')!.partners.map((l) => l.endedBy)).toEqual(['Divorce', 'separation', undefined]);
	});

	it('an implicit union has no ended-by', () => {
		const g = deriveFamilies(read(PEOPLE + '  - id: c\n    name: C\n    parents: [a, b]\n'));
		const link = familyOf(g, 'a')!.partners[0];
		expect(link.union).toBeNull();
		expect(link.endedBy).toBeUndefined();
	});
});

describe('edit-union with ended-by', () => {
	it('puts ended-by in the write order after end', () => {
		expect(UNION_ORDER.slice(-2)).toEqual(['end', 'ended-by']);
	});

	it('adds the key in block style and changes no other line (an unknown key never decides the place: the key goes last)', () => {
		const src = block(['- partners: [a, b]  # first', '  type: marriage', '  start: 1100', '  end: 1130', '  note: kept']);
		const out = edit(src, set('divorce'));
		expect(out).toBe(block(['- partners: [a, b]  # first', '  type: marriage', '  start: 1100', '  end: 1130', '  note: kept', '  ended-by: divorce']));
		expect(edit(block(['- partners: [a, b]', '  start: 1100', '  end: 1130']), set('divorce'))).toBe(block(['- partners: [a, b]', '  start: 1100', '  end: 1130', '  ended-by: divorce']));
	});

	it('a new end goes before an ended-by that is there', () => {
		const src = block(['- partners: [a, b]', '  start: 1100', '  ended-by: divorce']);
		expect(edit(src, { kind: 'edit-union', union: REF, fields: { end: '1130' } })).toBe(block(['- partners: [a, b]', '  start: 1100', '  end: 1130', '  ended-by: divorce']));
	});

	it('adds the key to a flow map and keeps the flow style', () => {
		const src = PEOPLE + 'unions: [{partners: [a, b], start: 1100, end: 1130}]\n';
		expect(edit(src, set('annulment'))).toBe(PEOPLE + 'unions: [{partners: [a, b], start: 1100, end: 1130, ended-by: annulment}]\n');
	});

	it('writes each of the three values', () => {
		for (const v of ENDED_BY) expect(read(edit(block(['- partners: [a, b]']), set(v))).unions[0].endedBy).toBe(v);
	});

	it('changes the value in place and keeps the comment after it', () => {
		const src = block(['- partners: [a, b]', '  ended-by: divorce   # per the chronicle', '  end: 1130']);
		expect(edit(src, set('death'))).toBe(block(['- partners: [a, b]', '  ended-by: death   # per the chronicle', '  end: 1130']));
	});

	it('"Not known" removes the key and nothing else', () => {
		const src = block(['- partners: [a, b]', '  start: 1100', '  ended-by: divorce', '  note: kept']);
		expect(edit(src, set(null))).toBe(block(['- partners: [a, b]', '  start: 1100', '  note: kept']));
		expect(edit(PEOPLE + 'unions: [{partners: [a, b], ended-by: death}]\n', set(null))).toBe(PEOPLE + 'unions: [{partners: [a, b]}]\n');
	});

	it('"Not known" with no key is a no-op, byte for byte', () => {
		const src = block(['- partners: [a, b]', '  start: 1100']);
		expect(edit(src, set(null))).toBe(src);
		expect(edit(src, set('  '))).toBe(src);
	});

	it('"Not known" also removes an unknown written value and a key with a list', () => {
		expect(edit(block(['- partners: [a, b]', '  ended-by: separation']), set(null))).toBe(block(['- partners: [a, b]']));
		expect(edit(block(['- partners: [a, b]', '  ended-by: [x, y]']), set(null))).toBe(block(['- partners: [a, b]']));
	});

	it('a case-only difference of a known value is a no-op', () => {
		for (const written of ['Divorce', 'DIVORCE', '" divorce "', 'divorced']) {
			const src = block(['- partners: [a, b]', `  ended-by: ${written}`]);
			expect(edit(src, set('divorce')), written).toBe(src);
		}
	});

	it('another known value replaces a value in another case', () => {
		expect(edit(block(['- partners: [a, b]', '  ended-by: Divorce']), set('annulment'))).toBe(block(['- partners: [a, b]', '  ended-by: annulment']));
	});

	it('an unknown written value is kept by an edit of another key, and changed when the user picks a value', () => {
		const src = block(['- partners: [a, b]', '  ended-by: separation', '  start: 1100']);
		expect(edit(src, { kind: 'edit-union', union: REF, fields: { start: '1101' } })).toBe(block(['- partners: [a, b]', '  ended-by: separation', '  start: 1101']));
		expect(edit(src, { kind: 'edit-union', union: REF, fields: { type: 'betrothal' } })).toContain('ended-by: separation');
		expect(edit(src, set('death'))).toBe(block(['- partners: [a, b]', '  ended-by: death', '  start: 1100']));
	});

	it('a type change keeps the key', () => {
		const src = block(['- partners: [a, b]', '  type: marriage', '  ended-by: divorce']);
		const out = edit(src, { kind: 'edit-union', union: REF, fields: { type: 'betrothal' } });
		expect(out).toBe(block(['- partners: [a, b]', '  type: betrothal', '  ended-by: divorce']));
		expect(read(edit(out, { kind: 'edit-union', union: REF, fields: { type: null } })).unions[0].endedBy).toBe('divorce');
	});

	it('refuses a value that is not one of the three, and an alias', () => {
		const src = block(['- partners: [a, b]']);
		for (const v of ['separation', 'divorced', 'annulled', 'Divorce']) expect(code(src, set(v)), v).toBe('bad-value');
		expect(code(src, { kind: 'edit-union', union: REF, fields: { 'ended-by': 5 as unknown as string } })).toBe('bad-value');
	});

	it('writes ended-by and another key in one op, in the write order', () => {
		const src = block(['- partners: [a, b]']);
		const out = edit(src, { kind: 'edit-union', union: REF, fields: { 'ended-by': 'divorce', end: '1130', type: 'marriage' } });
		expect(out).toBe(block(['- partners: [a, b]', '  type: marriage', '  end: 1130', '  ended-by: divorce']));
	});

	it('keeps an unknown key next to ended-by and every other item of the note', () => {
		const src = '# top comment\n' + block(['- partners: [a, b]   # one', '  mood: stormy', '  ended-by: divorce', '  rank: 1', '- partners: [a, b]  # two', '  future-key: [1, 2]']) + 'extra: kept\n';
		const out = edit(src, { kind: 'edit-union', union: REF, fields: { end: '1130' } });
		expect(out).toContain('# top comment');
		expect(out).toContain('    mood: stormy\n    end: 1130\n    ended-by: divorce\n    rank: 1\n');
		expect(out).toContain('# two\n    future-key: [1, 2]');
		expect(out).toContain('extra: kept');
		const gone = edit(out, set(null));
		expect(gone).toContain('    mood: stormy\n    end: 1130\n    rank: 1\n');
		expect(gone).toContain('future-key: [1, 2]');
	});

	it('survives a remove-union of another item and an add-union', () => {
		const src = block(['- partners: [a, b]', '  ended-by: annulment', '- partners: [b, a]', '  type: affair']);
		const second = { index: 1, partners: ['b', 'a'] as [string, string] };
		expect(read(edit(src, { kind: 'remove-union', union: second })).unions[0].endedBy).toBe('annulment');
		expect(read(edit(src, { kind: 'add-union', partners: ['a', 'b'], type: 'betrothal' })).unions[0].endedBy).toBe('annulment');
	});

	it('reads back what it writes', () => {
		const src = block(['- partners: [a, b]']);
		const g = deriveFamilies(read(edit(src, set('death'))));
		expect(g.unions[0].endedBy).toBe('death');
	});
});
