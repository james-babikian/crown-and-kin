import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { Op } from '../../src/core/edit';
import { issueText, type CodedIssue } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import type { Person } from '../../src/core/types';
import { golden, replaceOnce } from './golden';
import { oldApplyOp, oldBuild } from './r027-old-builds';
import { blockOf, branchLine, graphOf, titleIn } from './r027-support';

/*
 * Version 0.2.7, the person key `childless` (spec D190, the 0.2.7 contract M.5 and M.6): how it is read (with `bool`),
 * the warning `childless-has-child` (text, params, when it appears), the write of `childless: true` and
 * `childless: false` in the person key order of M.5 (whole bodies in tests/golden/16-childless-*.yaml, written by
 * hand), and that the 0.2.6 and 0.1.1 builds keep the key on an edit (A.4, M.5). They wait for WP2c.
 * Run: npx vitest run tests/acceptance/r027-childless.test.ts
 */

// ---- helpers ----

/** A people list from items; the person items are flow maps, one per person. */
const peopleOf = (...items: string[]) => ['people:', ...items.map((p) => `  - ${p}`), ''].join('\n');
const read = (source: string) => {
	const r = parseDynasty(source);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return r.tree;
};
const issuesOf = (source: string): CodedIssue[] => deriveFamilies(read(source)).issues;
const warnings = (source: string) => issuesOf(source).filter((i) => i.code === ('childless-has-child' as string));
const has = (p: Person, key: string) => Object.prototype.hasOwnProperty.call(p, key);

// ---- reading (M.5) ----

describe('the person key childless: reading (M.5)', () => {
	const personWith = (value: string | null) => read(peopleOf(value === null ? '{id: a, name: A}' : `{id: a, name: A, childless: ${value}}`)).people[0];

	for (const value of ['true', 'True', 'TRUE', 'yes', 'Yes', '"true"', '"yes"', '" true "']) {
		it(`childless: ${value} reads as true`, () => {
			expect((personWith(value) as Person & { childless?: true }).childless).toBe(true);
		});
	}

	// The reader is `bool` (tolerate.ts): `on`, `1`, `Y` and the like read as off, like `illegitimate` (consistent, not a fault).
	for (const value of ['false', 'no', 'on', '1', 'Y', '"false"', '"maybe"', '""', '~']) {
		it(`childless: ${value} gives no field`, () => {
			expect(has(personWith(value), 'childless')).toBe(false);
		});
	}

	it('a person without the key has no field', () => {
		expect(has(personWith(null), 'childless')).toBe(false);
	});

	it('the key is valid on a living person and on a person with children: it is read and kept', () => {
		const tree = read(peopleOf('{id: a, name: A, childless: true}', '{id: b, name: B, childless: true, died: 1100}', '{id: c, name: C, parents: [b]}'));
		expect(tree.people.map((p) => (p as Person & { childless?: boolean }).childless)).toEqual([true, true, undefined]);
	});

	it('the key is not an unknown key: reading it adds no warning when there is no child', () => {
		expect(issuesOf(peopleOf('{id: a, name: A, childless: true, died: 1100}'))).toEqual([]);
	});
});

// ---- the warning childless-has-child (M.6) ----

describe('childless-has-child (M.6)', () => {
	it('text and params: NAME and the first child in written order, ids of the person', () => {
		const src = peopleOf(
			'{id: aldric, name: Aldric Valmont, sex: m, died: 1160, childless: true}',
			'{id: hugo, name: Hugo Valmont, sex: m, parents: [aldric]}',
			'{id: wren, name: Wren Valmont, sex: f, parents: [aldric]}',
		);
		const w = warnings(src);
		expect(w).toHaveLength(1);
		expect(w[0].level).toBe('warning');
		expect(w[0].params).toEqual({ person: 'Aldric Valmont', child: 'Hugo Valmont' });
		expect(w[0].ids).toEqual(['aldric']);
		expect(issueText(w[0])).toBe(
			'Aldric Valmont has “childless: true”, but Hugo Valmont is a child of Aldric Valmont in the tree. Remove “childless: true”, or correct the parents of Hugo Valmont.',
		);
	});

	it('the first child is the first in the order of the people list, not the youngest', () => {
		const src = peopleOf(
			'{id: aldric, name: Aldric Valmont, died: 1160, childless: true}',
			'{id: wren, name: Wren Valmont, born: 1150, parents: [aldric]}',
			'{id: hugo, name: Hugo Valmont, born: 1140, parents: [aldric]}',
		);
		expect(warnings(src).map((i) => i.params.child)).toEqual(['Wren Valmont']);
	});

	it('one warning for each person with the key, in the order of the people', () => {
		const src = peopleOf(
			'{id: a, name: A, died: 1100, childless: true}',
			'{id: b, name: B, died: 1101, childless: true}',
			'{id: x, name: X, parents: [b]}',
			'{id: y, name: Y, parents: [a]}',
		);
		expect(warnings(src).map((i) => [i.ids, i.params.person, i.params.child])).toEqual([
			[['a'], 'A', 'Y'],
			[['b'], 'B', 'X'],
		]);
	});

	it('a child with two birth parents who both carry the key gives a warning for each parent', () => {
		const src = peopleOf('{id: a, name: A, died: 1100, childless: true}', '{id: b, name: B, died: 1101, childless: true}', '{id: x, name: X, parents: [a, b]}');
		expect(warnings(src).map((i) => [i.ids, i.params.child])).toEqual([
			[['a'], 'X'],
			[['b'], 'X'],
		]);
	});

	it('a birth link written with its type, and a type that the plugin does not know (read as birth), count', () => {
		const typed = peopleOf('{id: a, name: A, died: 1100, childless: true}', '{id: x, name: X, parents: [{id: a, type: birth}]}');
		expect(warnings(typed)).toHaveLength(1);
		const unknown = peopleOf('{id: a, name: A, died: 1100, childless: true}', '{id: x, name: X, parents: [{id: a, type: godfather}]}');
		expect(warnings(unknown)).toHaveLength(1);
		expect(issuesOf(unknown).map((i) => i.code)).toContain('unknown-parent-type');
	});

	it('the flag illegitimate on the child changes nothing: the child is still a child', () => {
		const src = peopleOf('{id: a, name: A, died: 1100, childless: true}', '{id: x, name: X, illegitimate: true, parents: [a]}');
		expect(warnings(src)).toHaveLength(1);
	});

	for (const type of ['adoptive', 'ward', 'rumoured']) {
		it(`no warning when the only child is by a ${type} link`, () => {
			const src = peopleOf('{id: a, name: A, died: 1100, childless: true}', `{id: x, name: X, parents: [{id: a, type: ${type}}]}`);
			expect(warnings(src)).toEqual([]);
		});
	}

	it('the birth child is named when there is also a child by another link, whatever the order', () => {
		const src = peopleOf(
			'{id: a, name: A, died: 1100, childless: true}',
			'{id: w, name: W, parents: [{id: a, type: ward}]}',
			'{id: r, name: R, parents: [{id: a, type: rumoured}]}',
			'{id: p, name: P, parents: [{id: a, type: adoptive}]}',
			'{id: x, name: X, parents: [a]}',
		);
		expect(warnings(src).map((i) => i.params.child)).toEqual(['X']);
	});

	it('no warning when the key is false or absent, or when the person has no child', () => {
		const src = peopleOf('{id: a, name: A, died: 1100, childless: false}', '{id: b, name: B, died: 1101}', '{id: c, name: C, died: 1102, childless: true}', '{id: x, name: X, parents: [a, b]}');
		expect(warnings(src)).toEqual([]);
	});

	it('a partnership alone is no child', () => {
		const src = peopleOf('{id: a, name: A, died: 1100, childless: true}', '{id: b, name: B}') + 'unions:\n  - partners: [a, b]\n';
		expect(warnings(src)).toEqual([]);
	});

	// "Not for a living person" (M.6): a person with no `died`, or with a death text that means alive (J.7), is living.
	for (const died of [null, 'alive', 'living']) {
		it(`no warning for a living person (${died === null ? 'no died' : `died: ${died}`})`, () => {
			const src = peopleOf(`{id: a, name: A, ${died === null ? '' : `died: ${died}, `}childless: true}`, '{id: x, name: X, parents: [a]}');
			expect(warnings(src)).toEqual([]);
		});
	}

	// A dead person: any `died` text that is not an alive word, also a text with no year or a doubt.
	for (const died of ['1160', '"c. 1160"', '"before the war"', '"?"', 'unknown']) {
		it(`the warning appears for a dead person (died: ${died})`, () => {
			const src = peopleOf(`{id: a, name: A, died: ${died}, childless: true}`, '{id: x, name: X, parents: [a]}');
			expect(warnings(src).map((i) => i.ids)).toEqual([['a']]);
		});
	}

	it('the warning does not stop the line of succession: the key is ignored for a person who has a child', () => {
		// P is dead with `childless: true` but has the child Q, who is alive: Q is an heir, and P is no open branch.
		const people = [
			'{id: c, name: C, sex: m, born: 1090, died: 1150}',
			'{id: r, name: R, sex: m, born: 1120, parents: [c]}',
			'{id: p, name: P, sex: m, born: 1122, died: 1140, childless: true, parents: [c]}',
			'{id: q, name: Q, sex: m, born: 1130, parents: [p]}',
		];
		const g = graphOf(blockOf(people, ['{person: c, from: 1120, to: 1150}', '{person: r, from: 1150}']));
		const res = branchLine(g, titleIn(g), 20);
		expect(res.heirs).toEqual(['q']);
		expect(res.openBranches.map((b) => b.id)).not.toContain('p');
		expect(g.issues.filter((i) => i.code === ('childless-has-child' as string)).map((i) => i.ids)).toEqual([['p']]);
	});
});

// ---- the write (M.5) ----

describe('the person key childless: the write in the person key order (M.5)', () => {
	const BASE = golden('16-childless-base.yaml').replace(/\n$/, '');
	const fieldsOp = (id: string, fields: Record<string, unknown>): Op => ({ kind: 'set-person-fields', id, fields } as unknown as Op);
	const body = (r: ReturnType<typeof edit.applyOp>): string => {
		if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
		return r.body;
	};
	const set = (text: string, id: string, value: boolean) => body(edit.applyOp(text, fieldsOp(id, { childless: value })));

	it('the base text reads without a warning', () => {
		expect(issuesOf(BASE)).toEqual([]);
	});

	it('true goes after illegitimate and before union; the comment stays on the line of illegitimate (golden)', () => {
		expect(set(BASE, 'aldric', true) + '\n').toBe(golden('16-childless-aldric.yaml'));
	});

	it('true goes after died and before notes (golden)', () => {
		expect(set(BASE, 'dag', true) + '\n').toBe(golden('16-childless-dag.yaml'));
	});

	it('true goes after parents when the person has no placement and no illegitimate', () => {
		expect(set(BASE, 'bryn', true)).toBe(replaceOnce(BASE, '    died: 1108\n    parents: [wulf]\n', '    died: 1108\n    parents: [wulf]\n    childless: true\n'));
	});

	it('true goes after the name when nothing else stands before it', () => {
		expect(set(BASE, 'eli', true)).toBe(replaceOnce(BASE, '    name: Eli Valmont\n', '    name: Eli Valmont\n    childless: true\n'));
	});

	it('true goes before link', () => {
		expect(set(BASE, 'fenn', true)).toBe(replaceOnce(BASE, '    name: Fenn Valmont\n    link:', '    name: Fenn Valmont\n    childless: true\n    link:'));
	});

	it('true is written plain, never quoted', () => {
		expect(set(BASE, 'eli', true)).toContain('\n    childless: true\n');
		expect(set(BASE, 'eli', true)).not.toMatch(/childless: ["']/);
	});

	it('illegitimate goes before an existing childless (the order is illegitimate, then childless)', () => {
		expect(body(edit.applyOp(BASE, fieldsOp('hale', { illegitimate: true })))).toBe(replaceOnce(BASE, '    died: 1121\n    childless: true\n', '    died: 1121\n    illegitimate: true\n    childless: true\n'));
	});

	it('placement goes before an existing childless', () => {
		const withParent = replaceOnce(BASE, '    died: 1121\n    childless: true\n', '    died: 1121\n    parents: [wulf]\n    childless: true\n');
		expect(body(edit.applyOp(withParent, fieldsOp('hale', { placement: 'birth' })))).toBe(
			replaceOnce(withParent, '    parents: [wulf]\n    childless: true\n', '    parents: [wulf]\n    placement: birth\n    childless: true\n'),
		);
	});

	for (const id of ['aldric', 'bryn', 'dag', 'eli', 'fenn']) {
		it(`${id}: true, then false, gives back the original text, byte for byte`, () => {
			const written = set(BASE, id, true);
			expect(written).not.toBe(BASE);
			expect(set(written, id, false)).toBe(BASE);
		});
	}

	it('false on a person without the key changes nothing', () => {
		expect(set(BASE, 'eli', false)).toBe(BASE);
	});

	it('true on a person whose text already reads true changes nothing (yes stays yes)', () => {
		expect(set(BASE, 'gwen', true)).toBe(BASE);
		expect(set(BASE, 'hale', true)).toBe(BASE);
	});

	it('false removes the key, also when it is written as yes, and takes its line comment with it', () => {
		expect(set(BASE, 'gwen', false)).toBe(replaceOnce(BASE, '    childless: yes            # written by hand\n', ''));
		expect(set(BASE, 'hale', false)).toBe(replaceOnce(BASE, '    childless: true\n', ''));
	});

	it('another field of the same person leaves the key in place', () => {
		expect(body(edit.applyOp(BASE, fieldsOp('hale', { name: 'Hale the Last' })))).toBe(replaceOnce(BASE, 'name: Hale Valmont', 'name: Hale the Last'));
		expect(body(edit.applyOp(BASE, fieldsOp('gwen', { died: '1125' })))).toBe(replaceOnce(BASE, 'died: 1120', 'died: 1125'));
	});

	it('a write of childless and another field together keeps the order', () => {
		expect(body(edit.applyOp(BASE, fieldsOp('eli', { childless: true, died: '1150' })))).toBe(replaceOnce(BASE, '    name: Eli Valmont\n', '    name: Eli Valmont\n    died: 1150\n    childless: true\n'));
	});
});

// ---- older builds keep the key (A.4, M.5) ----

describe('the person key childless: the 0.2.6 and 0.1.1 builds keep it on an edit (M.5)', () => {
	const KEY = '    childless: true';
	const NOTE = golden('16-childless-base.yaml').replace(/\n$/, '');
	/** The lines of the body that hold the key, with the id of the person above them. */
	const holders = (text: string): string[] => {
		const out: string[] = [];
		let id = '';
		for (const line of text.split('\n')) {
			const m = /^ {2}- id: (\w+)/.exec(line);
			if (m) id = m[1];
			if (/^ {4}childless:/.test(line)) out.push(`${id}: ${line.trim().replace(/\s+#.*$/, '')}`);
		}
		return out;
	};
	const BEFORE = ['gwen: childless: yes', 'hale: childless: true'];

	for (const tag of ['v0.2.6', 'v0.1.1']) {
		const dir = oldBuild(tag);
		const ops: Record<string, unknown>[] = [
			{ kind: 'set-person-fields', id: 'hale', fields: { name: 'Hale the Last' } },
			{ kind: 'set-person-fields', id: 'hale', fields: { died: '1125' } },
			{ kind: 'set-person-fields', id: 'hale', fields: { illegitimate: true } },
			{ kind: 'set-person-fields', id: 'gwen', fields: { notes: 'A note.' } },
			{ kind: 'set-person-fields', id: 'eli', fields: { sex: 'f' } },
			{ kind: 'set-option', key: 'start', value: 'wulf' },
		];
		it.skipIf(dir === null)(`${tag}: the key lines stay (and their persons) after ${ops.length} different edits`, async () => {
			const applyOld = await oldApplyOp(dir!);
			expect(holders(NOTE)).toEqual(BEFORE);
			for (const op of ops) {
				const r = applyOld(NOTE, op);
				expect(r.ok, JSON.stringify(op)).toBe(true);
				if (!r.ok) continue;
				expect(holders(r.body), JSON.stringify(op)).toEqual(BEFORE);
				// The text of the value is not changed by the old build.
				expect(r.body, JSON.stringify(op)).toContain('    childless: yes            # written by hand\n');
				expect(r.body, JSON.stringify(op)).toContain(`${KEY}\n`);
			}
		});

		it.skipIf(dir === null)(`${tag}: a new field on the person with the key leaves the key line alone`, async () => {
			const applyOld = await oldApplyOp(dir!);
			const r = applyOld(NOTE, { kind: 'set-person-fields', id: 'hale', fields: { sex: 'm' } });
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			const lines = r.body.split('\n');
			const at = lines.indexOf(KEY);
			expect(at).toBeGreaterThan(0);
			expect(lines.filter((l) => l === KEY)).toHaveLength(1);
			expect(lines).toContain('    sex: m');
		});
	}

	it('the current build keeps the key lines of the base text in 4 different edits', () => {
		const apply = (op: Record<string, unknown>) => {
			const r = edit.applyOp(NOTE, op as unknown as Op);
			if (!r.ok) throw new Error(`refused ${r.code}`);
			return r.body;
		};
		for (const op of [
			{ kind: 'set-person-fields', id: 'hale', fields: { name: 'Hale the Last' } },
			{ kind: 'set-person-fields', id: 'gwen', fields: { notes: 'A note.' } },
			{ kind: 'set-person-fields', id: 'eli', fields: { sex: 'f' } },
			{ kind: 'set-option', key: 'start', value: 'wulf' },
		]) {
			expect(holders(apply(op)), JSON.stringify(op)).toEqual(BEFORE);
		}
	});
});
