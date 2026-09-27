import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import type { ApplyOp, EditRefusal, EditResult, Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import * as edit from '../../src/core/yaml-edit';
import { golden, replaceOnce } from './golden';
import { fixtureNote, fixtureSource, topLevelBlocks } from './load';

// Cases added after the spec review of WP3.1 (the decision notes "Relationship-op details", spec D15):
// a parent of two types, keys left stale by an op (§4.3 placement and union), write paths the
// first round missed (a single-string `parents`, a flow-map person, an implicit partnership, flow
// `unions` and block `partners`), and when an automatic marriage is not added (§6.4, D15).
// The item-ownership rule and the other formatting decisions are in relationship-ops.test.ts.

const applyOp: ApplyOp = edit.applyOp;

const MAIN = topLevelBlocks(fixtureNote('09'))[0].replace(/\n$/, '');
const F1 = fixtureSource('01').replace(/\n$/, '');
const F8 = fixtureSource('08').replace(/\n$/, '');
/** Fixture 1 after a second union for Roderick and Mathilde: Edric and Alys have `union: roderick-mathilde`. */
const F1_TWO = golden('01-add-union-second.yaml').replace(/\n$/, '');

type Ok = Extract<EditResult, { ok: true }>;

function ok(r: EditResult): Ok {
	if (!r.ok) throw new Error(`edit refused: ${r.code} ${r.detail ?? ''}`);
	return r;
}

function expectGolden(r: EditResult, file: string): Ok {
	const o = ok(r);
	expect(o.body + '\n').toBe(golden(file));
	return o;
}

function expectRefused(r: EditResult, code: EditRefusal): void {
	expect(r.ok, `expected refusal ${code}`).toBe(false);
	expect(r).toMatchObject({ ok: false, code });
}

function expectClean(body: string): void {
	const r = parseDynasty(body);
	expect(r.ok).toBe(true);
	if (r.ok) expect(deriveFamilies(r.tree).issues.map((i) => i.code)).toEqual([]);
}

function chain(body: string, ...ops: Op[]): string {
	return ops.reduce((b, op) => ok(applyOp(b, op)).body, body);
}

const effects = (r: EditResult) => ok(r).effects ?? [];

describe('a parent of two types (the decision notes: allowed; §6.6 excludes only the chosen type)', () => {
	const RUMOURED = '[gareth, odette, {id: marek, type: rumoured}]';
	const withBoth = replaceOnce(F8, RUMOURED, '[gareth, odette, {id: marek, type: rumoured}, {id: marek, type: adoptive}]');

	it('Marek, rumoured father of Roderick, is added as his adoptive father too', () => {
		const r = applyOp(F8, { kind: 'add-parent', child: 'roderick', parent: 'marek', type: 'adoptive' });
		expect(ok(r).body).toBe(withBoth);
		expect(effects(r)).toEqual([]);
		expectClean(ok(r).body);
	});

	it('remove-parent removes only the entry of the given type', () => {
		expect(ok(applyOp(withBoth, { kind: 'remove-parent', child: 'roderick', parent: 'marek', type: 'rumoured' })).body).toBe(
			replaceOnce(F8, RUMOURED, '[gareth, odette, {id: marek, type: adoptive}]'),
		);
		expect(ok(applyOp(withBoth, { kind: 'remove-parent', child: 'roderick', parent: 'marek', type: 'adoptive' })).body).toBe(F8);
	});

	it('delete-person removes every entry for that person', () => {
		const marek = '  - id: marek\n    name: Marek Drakemoor\n    title: Margrave of Drakemoor\n    house: drakemoor\n    sex: m\n    born: 1100\n';
		let want = replaceOnce(F8, marek, '');
		want = replaceOnce(want, '    parents: [marek, anna]\n', '    parents: [anna]\n');
		want = replaceOnce(want, '[marek, anna, {id: aldric', '[anna, {id: aldric');
		want = replaceOnce(want, RUMOURED, '[gareth, odette]');
		want = replaceOnce(want, '  - partners: [marek, anna]\n', '');
		expect(ok(applyOp(withBoth, { kind: 'delete-person', id: 'marek' })).body).toBe(want);
	});

	it('the same type again is still refused', () => {
		expectRefused(applyOp(withBoth, { kind: 'add-parent', child: 'roderick', parent: 'marek', type: 'adoptive' }), 'bad-value');
	});
});

describe('keys left stale by an op go in the same write (the decision notes "Relationship-op details")', () => {
	const TOMAS = '[marek, anna, {id: aldric, type: adoptive}, {id: isolde, type: adoptive}]';

	it('remove-parent: placement: adoptive stays while one adoptive parent is left, and goes with the last', () => {
		const one = ok(applyOp(F8, { kind: 'remove-parent', child: 'tomas', parent: 'aldric', type: 'adoptive' })).body;
		expect(one).toBe(replaceOnce(F8, TOMAS, '[marek, anna, {id: isolde, type: adoptive}]'));
		const r = applyOp(one, { kind: 'remove-parent', child: 'tomas', parent: 'isolde', type: 'adoptive' });
		expectGolden(r, '08-remove-adoptive-parents.yaml');
		expectClean(ok(r).body);
	});

	it('set-parent-type: placement: adoptive goes when no adoptive parent is left', () => {
		const body = chain(
			F8,
			{ kind: 'set-parent-type', child: 'tomas', parent: 'aldric', from: 'adoptive', to: 'ward' },
			{ kind: 'set-parent-type', child: 'tomas', parent: 'isolde', from: 'adoptive', to: 'ward' },
		);
		expect(body).toBe(
			replaceOnce(
				F8,
				`    parents: ${TOMAS}\n    placement: adoptive\n`,
				'    parents: [marek, anna, {id: aldric, type: ward}, {id: isolde, type: ward}]\n',
			),
		);
		expectClean(body);
	});

	it('delete-person: placement: adoptive goes when the last adoptive parent is deleted', () => {
		const aldric = '  - id: aldric\n    name: Aldric Valmont\n    title: Duke of Valmont\n    house: valmont\n    sex: m\n    born: 1102\n    died: 1161\n';
		const isolde = '  - id: isolde\n    name: Isolde Orsini\n    house: orsini\n    sex: f\n    born: 1110\n';
		const one = ok(applyOp(F8, { kind: 'delete-person', id: 'aldric' })).body;
		// Isolde is still an adoptive parent, so placement stays.
		expect(one).toContain('    parents: [marek, anna, {id: isolde, type: adoptive}]\n    placement: adoptive\n');
		let want = replaceOnce(F8, aldric + isolde, '');
		want = replaceOnce(want, `    parents: ${TOMAS}\n    placement: adoptive\n`, '    parents: [marek, anna]\n');
		want = replaceOnce(want, '[gareth, odette, {id: aldric, type: ward}]', '[gareth, odette]');
		want = replaceOnce(want, '  - partners: [aldric, isolde]\n    start: 1129\n', '');
		const two = ok(applyOp(one, { kind: 'delete-person', id: 'isolde' })).body;
		expect(two).toBe(want);
		expectClean(two);
	});

	it('remove-parent: union: goes when it no longer names a union of the placement parents', () => {
		const r = applyOp(F1_TWO, { kind: 'remove-parent', child: 'edric', parent: 'mathilde', type: 'birth' });
		expectGolden(r, '01-remove-parent-stale-union.yaml');
		expectClean(ok(r).body);
	});

	it('set-parent-type: union: goes when the pair is no longer the placement parents', () => {
		const r = ok(applyOp(F1_TWO, { kind: 'set-parent-type', child: 'edric', parent: 'mathilde', from: 'birth', to: 'adoptive' }));
		expect(r.body).toBe(
			replaceOnce(
				F1_TWO,
				'    born: 1158\n    parents: [roderick, mathilde]\n    union: roderick-mathilde\n',
				'    born: 1158\n    parents: [roderick, {id: mathilde, type: adoptive}]\n',
			),
		);
		expectClean(r.body);
	});

	it('a union: that still fits stays', () => {
		// Alys keeps her union when Edric loses his.
		const r = ok(applyOp(F1_TWO, { kind: 'remove-parent', child: 'edric', parent: 'mathilde', type: 'birth' }));
		expect(r.body).toContain('    born: 1161\n    parents: [roderick, mathilde]\n    union: roderick-mathilde\n');
	});
});

describe('parents written as a single string (§8 "a single string where a list was expected")', () => {
	const SINGLE = replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: aldous\n  # Wards');

	it('add-parent: the value becomes a flow sequence', () => {
		// Decision: once a second entry is needed, the value is rewritten in the §4.2 form, a flow
		// sequence, in place of the single string.
		expect(ok(applyOp(SINGLE, { kind: 'add-parent', child: 'piers', parent: 'joan', type: 'birth', autoUnion: false })).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: [aldous, joan]\n  # Wards'),
		);
		expect(ok(applyOp(SINGLE, { kind: 'add-parent', child: 'piers', parent: 'tamsin', type: 'adoptive' })).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: [aldous, {id: tamsin, type: adoptive}]\n  # Wards'),
		);
	});

	it('set-parent-type: a flow sequence holding one flow map', () => {
		expect(ok(applyOp(SINGLE, { kind: 'set-parent-type', child: 'piers', parent: 'aldous', from: 'birth', to: 'ward' })).body).toBe(
			replaceOnce(MAIN, '    parents: [aldous]\n  # Wards', '    parents: [{id: aldous, type: ward}]\n  # Wards'),
		);
	});

	it('remove-parent: the only entry goes, and the key with it', () => {
		expect(ok(applyOp(SINGLE, { kind: 'remove-parent', child: 'piers', parent: 'aldous', type: 'birth' })).body).toBe(
			replaceOnce(MAIN, '    born: 1136\n    parents: [aldous]\n', '    born: 1136\n'),
		);
	});

	it('delete-person of that parent: the same result as with a list', () => {
		expectGolden(applyOp(SINGLE, { kind: 'delete-person', id: 'aldous' }), '09-delete-aldous.yaml');
	});
});

describe('the flow-map person (fixture 9 Joan)', () => {
	const JOAN = '  - {id: joan, name: Joan Marsh, sex: f, born: 1135}   # a flow-map person\n';
	/** Joan made Aldous's daughter, so she is the third of his single-parent group. */
	const WITH_PARENT = replaceOnce(MAIN, JOAN, '  - {id: joan, name: Joan Marsh, sex: f, born: 1135, parents: [aldous]}   # a flow-map person\n');

	it('move-sibling: the one-line item moves with its end-of-line comment', () => {
		const tamsin =
			'  # Wards and married-in\n  - id: tamsin\n    name: Tamsin\n    title: Keeper of the Rolls\n    sex: f\n    parents:\n      - id: aldous\n        type: ward\n        since: 1140           # unknown key in a parent entry\n';
		const joan = '  - {id: joan, name: Joan Marsh, sex: f, born: 1135, parents: [aldous]}   # a flow-map person\n';
		const want = replaceOnce(WITH_PARENT, tamsin + joan, joan + tamsin);
		expect(ok(applyOp(WITH_PARENT, { kind: 'move-sibling', id: 'joan', direction: 'earlier' })).body).toBe(want);
		expect(ok(applyOp(WITH_PARENT, { kind: 'move-sibling', id: 'tamsin', direction: 'later' })).body).toBe(want);
		expectRefused(applyOp(WITH_PARENT, { kind: 'move-sibling', id: 'joan', direction: 'later' }), 'no-sibling');
	});

	it('delete-person: her line and its end-of-line comment go, and her union; the comment above the union stays', () => {
		const r = ok(applyOp(MAIN, { kind: 'delete-person', id: 'joan' }));
		expect(r.body).toBe(replaceOnce(replaceOnce(MAIN, JOAN, ''), '  - partners: [edric, joan]\n    type: betrothal\n', ''));
		expectClean(r.body);
	});
});

describe('delete-person whose only partnership is implicit', () => {
	it('no union item is removed; the child keeps the other parent', () => {
		const body = [
			'people:',
			'  - id: a',
			'    name: A',
			'  - id: b',
			'    name: B',
			'  - id: d',
			'    name: D',
			'  - id: c',
			'    name: C',
			'    parents: [a, b]',
			'',
			'unions:',
			'  - partners: [a, d]',
		].join('\n');
		expect(ok(applyOp(body, { kind: 'delete-person', id: 'b' })).body).toBe(
			['people:', '  - id: a', '    name: A', '  - id: d', '    name: D', '  - id: c', '    name: C', '    parents: [a]', '', 'unions:', '  - partners: [a, d]'].join('\n'),
		);
	});
});

describe('unions written in other styles (§6.2: untouched nodes keep their style)', () => {
	const PEOPLE = 'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n  - id: c\n    name: C\n    parents: [a, b]\n';

	it('a flow list of unions: the new union is a flow map at the end; the id goes first inside the braces', () => {
		// Decision: inside a flow list, a new union is a flow map joined with ", ", like the rest of
		// the list; `union:` on the child is a new block key as usual.
		const body = PEOPLE + 'unions: [{partners: [a, b], type: marriage}]';
		expect(ok(applyOp(body, { kind: 'add-union', partners: ['a', 'b'], type: 'betrothal' })).body).toBe(
			'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n  - id: c\n    name: C\n    parents: [a, b]\n    union: a-b\n' +
				'unions: [{id: a-b, partners: [a, b], type: marriage}, {partners: [a, b], type: betrothal}]',
		);
	});

	it('a flow list of unions: a new pair', () => {
		const body = PEOPLE + 'unions: [{partners: [a, b]}]';
		expect(ok(applyOp(body, { kind: 'add-union', partners: ['b', 'c'] })).body).toBe(PEOPLE + 'unions: [{partners: [a, b]}, {partners: [b, c]}]');
	});

	it('partners as a block list: the existing union gains an id on its "- " line; the new union uses the usual form', () => {
		const body = PEOPLE + 'unions:\n  - partners:\n      - a\n      - b\n    start: 1100';
		expect(ok(applyOp(body, { kind: 'add-union', partners: ['b', 'a'] })).body).toBe(
			'people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n  - id: c\n    name: C\n    parents: [a, b]\n    union: a-b\n' +
				'unions:\n  - id: a-b\n    partners:\n      - a\n      - b\n    start: 1100\n  - partners: [b, a]',
		);
	});
});

describe('when no automatic marriage is added (§6.4, D15, the decision notes)', () => {
	it('add-parent with autoUnion: false adds none, even for a second birth parent', () => {
		// Add child with an existing child and an implicit co-parent passes autoUnion: false.
		const one = chain(F8, { kind: 'add-parent', child: 'sabine', parent: 'marek', type: 'birth' });
		const r = applyOp(one, { kind: 'add-parent', child: 'sabine', parent: 'gareth', type: 'birth', autoUnion: false });
		expect(ok(r).body).toBe(replaceOnce(F8, '    born: 1135\n', '    born: 1135\n    parents: [marek, gareth]\n'));
		expect(effects(r)).toEqual([]);
	});

	it('add-person with two birth parents who have no union adds none', () => {
		const r = applyOp(MAIN, { kind: 'add-person', id: 'kit', fields: { name: 'Kit' }, parents: [{ id: 'piers', type: 'birth' }, { id: 'joan', type: 'birth' }] });
		expect(ok(r).body).toBe(replaceOnce(MAIN, '   # a flow-map person\n', '   # a flow-map person\n  - id: kit\n    name: Kit\n    parents: [piers, joan]\n'));
		expect(effects(r)).toEqual([]);
	});

	it('add-person with two adoptive parents who have no union adds none', () => {
		const r = applyOp(F1, {
			kind: 'add-person',
			id: 'kit',
			fields: { name: 'Kit' },
			parents: [
				{ id: 'isolde', type: 'adoptive' },
				{ id: 'mathilde', type: 'adoptive' },
			],
		});
		expect(ok(r).body).toBe(replaceOnce(F1, '    parents: [roderick, mathilde]\n\nunions:', '    parents: [roderick, mathilde]\n  - id: kit\n    name: Kit\n    parents: [{id: isolde, type: adoptive}, {id: mathilde, type: adoptive}]\n\nunions:'));
		expect(effects(r)).toEqual([]);
	});
});
