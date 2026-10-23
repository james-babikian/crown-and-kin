// Contract 0.2.7 M.5, M.6 (WP2c): the person key `childless`: reading, writing, key order, and the warning `childless-has-child`.
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { EditResult, Op } from '../../src/core/edit';
import { issueText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { PERSON_ORDER } from '../../src/core/yaml-patch';

function tree(src: string) {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse');
	return r.tree;
}
const body = (r: EditResult): string => {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
};
const set = (src: string, fields: Record<string, boolean | string | null>) => body(applyOp(src, { kind: 'set-person-fields', id: 'a', fields } as Op));
const issues = (src: string) => deriveFamilies(tree(src)).issues.filter((i) => i.code === 'childless-has-child');

describe('reading childless (M.5)', () => {
	it('is set only when true, and reads true and yes like illegitimate', () => {
		const t = tree('people:\n  - {id: a, name: A, childless: true}\n  - {id: b, name: B, childless: yes}\n  - {id: c, name: C, childless: false}\n  - {id: d, name: D, childless: maybe}\n  - {id: e, name: E}\n');
		expect(t.people.map((p) => p.childless)).toEqual([true, true, undefined, undefined, undefined]);
		// A tree without the key reads as before: no key `childless` on the person at all.
		expect('childless' in t.people[4]).toBe(false);
	});
	it('stands between illegitimate and union in the key order', () => {
		const i = PERSON_ORDER.indexOf('childless');
		expect(PERSON_ORDER.slice(i - 2, i + 2)).toEqual(['placement', 'illegitimate', 'childless', 'union']);
	});
});

describe('writing childless (M.5)', () => {
	const ONE = 'people:\n  - id: a\n    name: A\n';
	it('true adds the key after illegitimate and before union and link', () => {
		const src = 'people:\n  - id: a\n    name: A\n    illegitimate: true\n    union: u\n    link: "[[A]]"\n';
		expect(set(src, { childless: true })).toBe('people:\n  - id: a\n    name: A\n    illegitimate: true\n    childless: true\n    union: u\n    link: "[[A]]"\n');
		expect(set(ONE, { childless: true })).toBe('people:\n  - id: a\n    name: A\n    childless: true\n');
	});
	it('true leaves a text that already reads true, and false removes the key', () => {
		const yes = 'people:\n  - id: a\n    name: A\n    childless: yes # note\n';
		expect(set(yes, { childless: true })).toBe(yes);
		expect(set('people:\n  - id: a\n    name: A\n    childless: true # note\n    sex: m\n', { childless: false })).toBe('people:\n  - id: a\n    name: A\n    sex: m\n');
		expect(set(ONE, { childless: false })).toBe(ONE);
		expect(set('people:\n  - id: a\n    name: A\n    childless: false\n', { childless: true })).toBe('people:\n  - id: a\n    name: A\n    childless: true\n');
	});
	it('writes into a flow-style person and keeps the other keys', () => {
		expect(set('people:\n  - {id: a, name: A, sex: m}\n', { childless: true })).toBe('people:\n  - {id: a, name: A, sex: m, childless: true}\n');
	});
	it('refuses a text, never throws', () => {
		const r = applyOp(ONE, { kind: 'set-person-fields', id: 'a', fields: { childless: 'yes' } } as unknown as Op);
		expect(r).toMatchObject({ ok: false, code: 'bad-value' });
		if (!r.ok) expect(r.detail).toContain('childless');
	});
	it('add-person writes it in the key order', () => {
		const out = body(applyOp(ONE, { kind: 'add-person', id: 'c', fields: { name: 'C', childless: true, illegitimate: true, sex: 'm' } }));
		expect(out).toBe(ONE + '  - id: c\n    name: C\n    sex: m\n    illegitimate: true\n    childless: true\n');
		expect(tree(out).people[1].childless).toBe(true);
	});
});

describe('the warning childless-has-child (M.6)', () => {
	const P = (rows: string[]) => `people:\n${rows.map((r) => '  - ' + r).join('\n')}\n`;
	it('names the person and the first birth child, with the id of the person', () => {
		const w = issues(P(['{id: a, name: Aldric, died: 1200, childless: true}', '{id: k1, name: Kay, parents: [a]}', '{id: k2, name: Kim, parents: [a]}']));
		expect(w).toHaveLength(1);
		expect(w[0]).toMatchObject({ code: 'childless-has-child', level: 'warning', ids: ['a'], params: { person: 'Aldric', child: 'Kay' } });
		expect(issueText(w[0])).toBe('Aldric has “childless: true”, but Kay is a child of Aldric in the tree. Remove “childless: true”, or correct the parents of Kay.');
	});
	it('counts a birth link and a link with an unknown type', () => {
		expect(issues(P(['{id: a, name: A, died: 1200, childless: true}', '{id: k, name: K, parents: [{id: a, type: birth}]}']))).toHaveLength(1);
		expect(issues(P(['{id: a, name: A, died: 1200, childless: true}', '{id: k, name: K, parents: [{id: a, type: odd}]}']))).toHaveLength(1);
	});
	it('does not count an adoptive, ward or rumoured child', () => {
		for (const type of ['adoptive', 'ward', 'rumoured']) {
			expect(issues(P(['{id: a, name: A, died: 1200, childless: true}', `{id: k, name: K, parents: [{id: a, type: ${type}}]}`]))).toEqual([]);
		}
	});
	it('does not warn for a living person, a person without the key, or a person with the key false', () => {
		expect(issues(P(['{id: a, name: A, childless: true}', '{id: k, name: K, parents: [a]}']))).toEqual([]);
		expect(issues(P(['{id: a, name: A, died: alive, childless: true}', '{id: k, name: K, parents: [a]}']))).toEqual([]);
		expect(issues(P(['{id: a, name: A, died: 1200}', '{id: k, name: K, parents: [a]}']))).toEqual([]);
		expect(issues(P(['{id: a, name: A, died: 1200, childless: false}', '{id: k, name: K, parents: [a]}']))).toEqual([]);
	});
	it('does not warn when the person has no child, or a partnership only', () => {
		expect(issues('people:\n  - {id: a, name: A, died: 1200, childless: true}\n  - {id: b, name: B}\n\nunions:\n  - {partners: [a, b]}\n')).toEqual([]);
	});
	it('warns once for each person', () => {
		const w = issues(P(['{id: a, name: A, died: 1200, childless: true}', '{id: b, name: B, died: 1210, childless: true}', '{id: k, name: K, parents: [a, b]}']));
		expect(w.map((i) => i.ids)).toEqual([['a'], ['b']]);
	});
});
