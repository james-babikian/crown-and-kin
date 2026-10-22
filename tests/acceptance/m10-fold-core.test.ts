import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import type { FamilyGraph } from '../../src/core/derive';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { deriveFamilies } from '../../src/core/derive';
import type { FoldControl } from '../../src/core/folds';
import { fixtureSource } from './load';
import { block15, comments15, foldsModule, graphOf, sorted, treeOf } from './m10-support';

/*
 * Spec §13.10 "Rules" and "Acceptance" and the M10 core contract rules 1–12 (folds): the family and
 * its key, who is hidden, the count, the controls, the tags to hidden partners, the pruned graph,
 * the folds that hide a person, the folds to open for a person, the end of a fold and the sheet's
 * keys. The expected people, the counts N and the controls come from the comments of sample tree 15,
 * worked out by hand from the rules (never by code); the small trees here have their answers in the
 * test. These tests wait for WP 10.1.
 */

const F = comments15();
const SOURCE = block15(0);
const key = (name: string) => F.folds.get(name)!.key;
const keys = (names: readonly string[]) => new Set(names.map(key));
const labelKeys = (label: string) => keys(F.sets.get(label)!.folds);

/** A fresh graph of sample tree 15, block 1 (the fold functions keep a memo for each graph object). */
const whole = () => graphOf(SOURCE);

describe('sample tree 15: the comments are complete', () => {
	it('15 named families and 9 sets of folds', () => {
		expect([...F.folds.keys()]).toEqual(['R', 'A', 'B', 'NEST', 'TWO1', 'TWO2', 'SOLO', 'COUSIN', 'IMPL', 'H1A', 'BQ', 'GS', 'WS', 'IMPLB', 'REM']);
		expect([...F.sets.keys()]).toEqual(['none', 'A', 'B', 'A+B', 'A+NEST', 'NEST+IMPL', 'TWO2+BQ', 'COUSIN', 'R']);
		expect(F.people).toBe(96);
		expect(graphOf(SOURCE).people).toHaveLength(96);
		// The 60-person branch: fold A hides 60 blood descendants and 15 married-in partners.
		expect(F.folds.get('A')!.n).toBe(75);
		expect(F.folds.get('A')!.hides).toHaveLength(75);
	});

	it('the tree has no issue (so the fold tests read a clean tree)', () => {
		expect(graphOf(SOURCE).issues).toEqual([]);
	});
});

describe('rule 2: `foldKey`', () => {
	it('the ids sorted with the default string order, as a JSON array', async () => {
		const { foldKey } = await foldsModule();
		expect(foldKey(['b', 'a'])).toBe('["a","b"]');
		expect(foldKey(['a', 'b'])).toBe('["a","b"]');
		expect(foldKey(['a'])).toBe('["a"]');
		expect(foldKey(['osric', 'mathilde'])).toBe(key('A'));
		expect(foldKey(['Z', 'a'])).toBe('["Z","a"]');
		expect(foldKey(['e', 'é'])).toBe('["e","é"]');
	});

	it('ids that are not distinct give the distinct ones; ids with "|" or "," stay apart; it never throws', async () => {
		const { foldKey } = await foldsModule();
		expect(foldKey(['a', 'a'])).toBe('["a"]');
		expect(foldKey(['a|b', 'c,d'])).toBe(JSON.stringify(['a|b', 'c,d']));
		expect(foldKey(['a,b', 'c'])).not.toBe(foldKey(['a', 'b,c']));
		expect(() => foldKey([])).not.toThrow();
		expect(() => foldKey(['"', '\\', '\n'])).not.toThrow();
	});

	it('the key never uses the position of a union: it is the same after an edit that moves the unions', async () => {
		const { foldFamilies } = await foldsModule();
		const at = SOURCE.indexOf('\nunions:\n');
		const head = SOURCE.slice(0, at + '\nunions:\n'.length);
		const items = SOURCE.slice(head.length).split(/(?=^ {2}- partners:)/m);
		expect(items.length).toBe(22);
		const moved = head + [...items.slice(3), ...items.slice(0, 3)].join('');
		const before = foldFamilies(graphOf(SOURCE));
		const after = foldFamilies(graphOf(moved));
		expect(sorted(after.map((f) => f.key))).toEqual(sorted(before.map((f) => f.key)));
		// The control still sits on a union of the pair, whose position (u<index>) has changed.
		const union = (list: typeof before, name: string) => list.find((f) => f.key === key(name))!.union;
		expect(union(after, 'A')).not.toBe(union(before, 'A'));
	});
});

describe('rule 1: the families (`foldFamilies`)', () => {
	it('every named family is there with its key, its children in sibling order and its parents', async () => {
		const { foldFamilies } = await foldsModule();
		const list = foldFamilies(whole());
		for (const fact of F.folds.values()) {
			const family = list.find((f) => f.key === fact.key);
			expect(family, fact.name).toBeDefined();
			expect([...family!.children], fact.name).toEqual(fact.children);
			expect(sorted(family!.parents), fact.name).toEqual(JSON.parse(fact.key));
		}
	});

	it('a pair and one of its two people alone are three different families (Godric and Wanda)', async () => {
		const { foldFamilies } = await foldsModule();
		const list = foldFamilies(whole());
		const of = (...names: string[]) => list.find((f) => f.key === JSON.stringify(names))!;
		expect(of('godric', 'wanda').children).toEqual(['berengar']);
		expect(of('godric').children).toEqual(['gerard']);
		expect(of('wanda').children).toEqual(['wolfgang']);
		expect(of('godric').union).toBeUndefined();
		expect(of('wanda').union).toBeUndefined();
	});

	it('the children of two listed unions of one pair are one family (Hugo and Thea); its control sits on the last listed union with children', async () => {
		const { foldFamilies } = await foldsModule();
		const list = foldFamilies(whole());
		const rem = list.filter((f) => f.key === key('REM'));
		expect(rem).toHaveLength(1);
		expect([...rem[0].children]).toEqual(['hugo-first', 'hugo-second']);
		expect(rem[0].union).toBe(F.folds.get('REM')!.union);
		// The union is the second of the two listed unions of the pair: its index is larger than the first's.
		const tree = treeOf(SOURCE);
		const pair = tree.unions.filter((u) => [...u.partners].sort().join() === 'hugo,thea');
		expect(pair).toHaveLength(2);
		expect(rem[0].union).toBe(`u${pair[1].index}`);
	});

	it('a family of an implicit union has the implicit union (Matthias and Rosalind)', async () => {
		const { foldFamilies } = await foldsModule();
		const impl = foldFamilies(whole()).find((f) => f.key === key('IMPL'))!;
		expect(impl.union).toBe('i:["matthias","rosalind"]');
		expect(impl.union).toBe(F.folds.get('IMPL')!.union);
	});

	it('a listed union is `u<index>` of the tree text', async () => {
		const { foldFamilies } = await foldsModule();
		const tree = treeOf(SOURCE);
		const list = foldFamilies(whole());
		for (const name of ['R', 'A', 'B', 'NEST', 'TWO1', 'TWO2', 'COUSIN', 'BQ']) {
			const family = list.find((f) => f.key === key(name))!;
			const u = tree.unions.find((x) => `u${x.index}` === family.union)!;
			expect(u, name).toBeDefined();
			expect(sorted(u.partners), name).toEqual(JSON.parse(key(name)));
			// The parents are in the partner order of that union.
			expect([...family.parents], name).toEqual([...u.partners]);
		}
	});

	it('the children of a pair include a child placed under it by any union; an adoptee is in the family of his adoptive parents only', async () => {
		const { foldFamilies } = await foldsModule();
		const list = foldFamilies(whole());
		expect([...list.find((f) => f.key === key('B'))!.children]).toContain('tomas');
		expect([...list.find((f) => f.key === key('NEST'))!.children]).not.toContain('tomas');
	});

	it('only families with a child exist: no key for a couple with none, and none for a person with no child', async () => {
		const { foldFamilies } = await foldsModule();
		const list = foldFamilies(whole());
		expect(list.every((f) => f.children.length > 0)).toBe(true);
		// Piers has no child; Sybil and Corwin's other partnership has; Isolde alone has no family.
		expect(list.find((f) => f.key === '["piers"]')).toBeUndefined();
		expect(list.find((f) => f.key === '["isolde"]')).toBeUndefined();
		expect(new Set(list.map((f) => f.key)).size).toBe(list.length);
	});

	it('the families are in the order of rule 5: the smallest Person.index of the parents, then the key', async () => {
		const { foldFamilies } = await foldsModule();
		const tree = treeOf(SOURCE);
		const index = new Map(tree.people.map((p, i) => [p.id, i]));
		const list = foldFamilies(whole());
		const order = list.map((f) => [Math.min(...f.parents.map((p) => index.get(p)!)), f.key] as const);
		const want = [...order].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
		expect(order).toEqual(want);
		// Corwin's two families: by key, Sybil before Wanda.
		const names = list.map((f) => f.key);
		expect(names.indexOf(key('TWO1'))).toBeLessThan(names.indexOf(key('TWO2')));
	});

	it('memoised for each graph object', async () => {
		const { foldFamilies } = await foldsModule();
		const g = whole();
		expect(foldFamilies(g)).toBe(foldFamilies(g));
	});

	it('the families of the graph that is asked: in the focus family only its own children count', async () => {
		const { foldFamilies } = await foldsModule();
		const tree = treeOf(SOURCE);
		const focus = deriveFamilies(focusSubgraph(tree, 'osric', 1)!.tree);
		const keysInFocus = new Set(foldFamilies(focus).map((f) => f.key));
		expect(keysInFocus.has(key('A'))).toBe(true);
		// Hadrian's children are not in the focus family of Osric.
		expect(keysInFocus.has(key('NEST'))).toBe(false);
		const a = foldFamilies(focus).find((f) => f.key === key('A'))!;
		expect([...a.children].every((id) => focus.byId.has(id))).toBe(true);
	});
});

describe('rules 3 and 4: who is hidden and the count', () => {
	it('each named fold alone hides exactly the people of its comment, and N is their number', async () => {
		const { foldHidden, foldCount } = await foldsModule();
		for (const fact of F.folds.values()) {
			const g = whole();
			expect(sorted(foldHidden(g, new Set([fact.key]))), fact.name).toEqual(fact.hides);
			expect(fact.hides.length, fact.name).toBe(fact.n);
			expect(foldCount(g, fact.key), fact.name).toBe(fact.n);
		}
	});

	it('each set of folds hides exactly the people of its comment', async () => {
		const { foldHidden } = await foldsModule();
		for (const set of F.sets.values()) {
			expect(sorted(foldHidden(whole(), labelKeys(set.label))), set.label).toEqual(set.hides);
		}
	});

	it('the 60-person branch: A hides exactly 75 people, keeps the parents, the married-in partner with a union outside, and the adoptee', async () => {
		const { foldHidden } = await foldsModule();
		const hidden = foldHidden(whole(), new Set([key('A')]));
		expect(hidden.size).toBe(75);
		for (const stays of ['osric', 'mathilde', 'wanda', 'tomas', 'clarice', 'godric', 'aldric', 'isolde', 'ulric', 'agnes']) expect(hidden.has(stays), stays).toBe(false);
		// The cousin marriage child, the nested folds' people and the married-in partners of the branch.
		for (const gone of ['lucan', 'hadrian', 'corwin', 'beatrix', 'dorian', 'elinor', 'sybil', 'rosalind', 'wystan']) expect(hidden.has(gone), gone).toBe(true);
	});

	it('rule 3b: a person with any placement parent hidden is hidden (the cousin marriage across two branches)', async () => {
		const { foldHidden } = await foldsModule();
		const g = whole();
		expect(foldHidden(g, new Set([key('A')])).has('lucan')).toBe(true);
		expect(foldHidden(g, new Set([key('B')])).has('lucan')).toBe(true);
		expect(foldHidden(g, new Set([key('COUSIN')])).has('lucan')).toBe(true);
		// The parents of the cousin marriage are not hidden by their own family's fold.
		const cousin = foldHidden(g, new Set([key('COUSIN')]));
		expect([...cousin]).toEqual(['lucan']);
	});

	it('rule 3b: the one-parent children of a hidden married-in person are hidden too', async () => {
		const { foldHidden } = await foldsModule();
		const g = whole();
		// Wanda hides only when both her branches fold; then her child alone (Wolfgang) goes with her.
		expect(foldHidden(g, keys(['A', 'B'])).has('wanda')).toBe(true);
		expect(foldHidden(g, keys(['A', 'B'])).has('wolfgang')).toBe(true);
		expect(foldHidden(g, keys(['A'])).has('wolfgang')).toBe(false);
	});

	it('rule 3c: a married-in partner with a union to a shown person stays; with unions in two folded branches, hidden only when both fold', async () => {
		const { foldHidden } = await foldsModule();
		const g = whole();
		expect(foldHidden(g, keys(['A'])).has('wanda')).toBe(false);
		expect(foldHidden(g, keys(['B'])).has('wanda')).toBe(false);
		expect(foldHidden(g, keys(['A', 'B'])).has('wanda')).toBe(true);
		// Folding a family of her own children does not hide her: her partners are shown.
		expect(foldHidden(g, keys(['TWO2', 'BQ'])).has('wanda')).toBe(false);
		expect(foldHidden(g, keys(['TWO2', 'BQ'])).has('corwin')).toBe(false);
		// A partner whose only union is with a hidden person hides with that person.
		expect(foldHidden(g, keys(['A'])).has('elinor')).toBe(true);
	});

	it('an adoptive or ward child stays with his secondary line: hidden only by the fold of his adoptive parents', async () => {
		const { foldHidden } = await foldsModule();
		const g = whole();
		expect(foldHidden(g, keys(['A'])).has('tomas')).toBe(false);
		expect(foldHidden(g, keys(['NEST'])).has('tomas')).toBe(false);
		expect(foldHidden(g, keys(['B'])).has('tomas')).toBe(true);
		expect(g.secondary.some((e) => e.child === 'tomas')).toBe(true);
	});

	it('the two parents of a folded family are not hidden by that fold; nested folds hide nothing more than the outer one', async () => {
		const { foldHidden } = await foldsModule();
		const g = whole();
		const nest = foldHidden(g, keys(['NEST']));
		expect(nest.has('hadrian')).toBe(false);
		expect(nest.has('elinor')).toBe(false);
		expect(sorted(foldHidden(g, keys(['A', 'NEST'])))).toEqual(sorted(foldHidden(g, keys(['A']))));
		expect(sorted(foldHidden(g, keys(['NEST', 'IMPL'])))).toEqual(sorted(nest));
	});

	it('a key that names no family hides nothing (a person with no child, a made-up key, a pair with no child, a bad text)', async () => {
		const { foldHidden, foldCount } = await foldsModule();
		const g = whole();
		for (const bad of ['["piers"]', '["nobody"]', '["aldric","nobody"]', '["wanda","isolde"]', 'not json', '', '[]', '["osric","mathilde","x"]']) {
			expect(foldHidden(g, new Set([bad])).size, bad).toBe(0);
			expect(foldCount(g, bad), bad).toBe(0);
		}
		expect(foldHidden(g, new Set(['["piers"]', key('COUSIN')]))).toEqual(new Set(['lucan']));
		expect(foldHidden(g, new Set()).size).toBe(0);
	});

	it('the count in the graph that is asked: in a focus family only the people it draws', async () => {
		const { foldHidden, foldCount, foldFamilies } = await foldsModule();
		const tree = treeOf(SOURCE);
		const focus = deriveFamilies(focusSubgraph(tree, 'osric', 1)!.tree);
		const n = foldCount(focus, key('A'));
		expect(n).toBe(foldHidden(focus, new Set([key('A')])).size);
		expect(n).toBeGreaterThanOrEqual(4);
		expect(n).toBeLessThan(75);
		// A family that has no child in the focus family has no count.
		expect(foldFamilies(focus).some((f) => f.key === key('NEST'))).toBe(false);
		expect(foldCount(focus, key('NEST'))).toBe(0);
	});

	it('two folds can count the same person (a fold and a fold inside it; the two folds of a cousin marriage)', async () => {
		const { foldCount } = await foldsModule();
		const g = whole();
		expect(foldCount(g, key('A')) + foldCount(g, key('NEST'))).toBeGreaterThan(75);
		expect(foldCount(g, key('A')) + foldCount(g, key('B'))).toBeGreaterThan(75 + 14 - 1);
		expect(F.folds.get('A')!.hides.filter((id) => F.folds.get('B')!.hides.includes(id))).toEqual(['lucan']);
	});
});

/** A small tree for the rule 3c cases that sample tree 15 does not have. */
const TINY = [
	'people:',
	'  - {id: root, name: Root}',
	'  - {id: rootp, name: Rootp}',
	'  - {id: p, name: P, parents: [root, rootp]}',
	'  - {id: q, name: Q}', // married in; unions: p (with no children), r
	'  - {id: r, name: R, parents: [root, rootp]}',
	'  - {id: s, name: S}', // married in; only union: p, without children
	'  - {id: t, name: T, parents: [other, otherp]}',
	'  - {id: other, name: Other}',
	'  - {id: otherp, name: Otherp}',
	'  - {id: u, name: U}', // married in; unions: p (folded branch) and t (shown branch), no children
	'unions:',
	'  - partners: [root, rootp]',
	'  - partners: [p, q]',
	'  - partners: [q, r]',
	'  - partners: [p, s]',
	'  - partners: [u, p]',
	'  - partners: [u, t]',
	'  - partners: [other, otherp]',
	'',
].join('\n');

describe('rule 3c with unions that have no children (`g.unionsOf`, listed and implicit)', () => {
	it('a union with no children counts as a union partner', async () => {
		const { foldHidden } = await foldsModule();
		const g = graphOf(TINY);
		const hidden = foldHidden(g, new Set([JSON.stringify(['root', 'rootp'])]));
		expect(sorted(hidden)).toEqual(['p', 'q', 'r', 's']);
		// U has a union with T, who is shown: U stays.
		expect(hidden.has('u')).toBe(false);
	});

	it('a person with a union to a shown person stays, even when that union is the only one outside the branch; hidden when every partner is hidden', async () => {
		const { foldHidden } = await foldsModule();
		const g = graphOf(TINY);
		const root = JSON.stringify(['root', 'rootp']);
		const other = JSON.stringify(['other', 'otherp']);
		// U has unions with P (hidden by the first fold) and T (shown): U stays.
		expect(foldHidden(g, new Set([root])).has('u')).toBe(false);
		// Only the second fold: T is hidden, P is shown: U stays.
		expect(foldHidden(g, new Set([other])).has('u')).toBe(false);
		// Both folds: both partners of U are hidden, so U hides.
		const both = foldHidden(g, new Set([root, other]));
		expect(both.has('t')).toBe(true);
		expect(both.has('u')).toBe(true);
	});
});

describe('rule 5: the controls (`foldControls`)', () => {
	const controlsOf = async (label: string) => {
		const { foldHidden, foldControls } = await foldsModule();
		const g = whole();
		const folds = labelKeys(label);
		return foldControls(g, folds, foldHidden(g, folds));
	};

	it('each set of folds: the named families with a control are the ones in the comments; a folded family has "+ N", an open one N = 0', async () => {
		for (const set of F.sets.values()) {
			const controls = await controlsOf(set.label);
			const byKey = new Map(controls.map((c) => [c.key, c]));
			const named = new Set([...F.folds.values()].map((f) => f.key));
			const shownNamed = controls.filter((c) => named.has(c.key));
			const namesOf = (c: FoldControl) => [...F.folds.values()].find((f) => f.key === c.key)!.name;
			expect(sorted(shownNamed.filter((c) => !c.folded).map(namesOf)), `${set.label} open`).toEqual(sorted(set.open));
			expect(sorted(shownNamed.filter((c) => c.folded).map((c) => `${namesOf(c)}:${c.count}`)), `${set.label} folded`).toEqual(sorted([...set.folded].map(([n, count]) => `${n}:${count}`)));
			for (const c of controls.filter((x) => !x.folded)) expect(c.count, `${set.label} ${c.key}`).toBe(0);
			expect(byKey.size, `${set.label} one control for each key`).toBe(controls.length);
		}
	});

	it('the "+ N" sign keeps its N when another fold hides a child too (A and B both hide Lucan)', async () => {
		const controls = await controlsOf('A+B');
		expect(controls.find((c) => c.key === key('A'))).toMatchObject({ folded: true, count: 75 });
		expect(controls.find((c) => c.key === key('B'))).toMatchObject({ folded: true, count: 14 });
	});

	it('a family with a hidden parent has no control: the cousin marriage when either branch folds', async () => {
		for (const label of ['A', 'B', 'A+B']) {
			const controls = await controlsOf(label);
			expect(controls.some((c) => c.key === key('COUSIN')), label).toBe(false);
		}
		expect((await controlsOf('none')).some((c) => c.key === key('COUSIN'))).toBe(true);
	});

	it('a person with two families has two controls; children of one parent have one; a pair and each of its people alone have their own', async () => {
		const controls = await controlsOf('none');
		const keysOf = new Set(controls.map((c) => c.key));
		expect(keysOf.has(key('TWO1')) && keysOf.has(key('TWO2'))).toBe(true);
		expect(keysOf.has(key('SOLO'))).toBe(true);
		expect(keysOf.has(key('BQ')) && keysOf.has(key('GS')) && keysOf.has(key('WS'))).toBe(true);
	});

	it('one control for two listed unions of a pair, on `family.union`; the parents and the union are those of the family', async () => {
		const { foldFamilies } = await foldsModule();
		const controls = await controlsOf('none');
		const rem = controls.filter((c) => c.key === key('REM'));
		expect(rem).toHaveLength(1);
		expect(rem[0].union).toBe(F.folds.get('REM')!.union);
		const families = foldFamilies(whole());
		for (const c of controls) {
			const family = families.find((f) => f.key === c.key)!;
			expect([...c.parents], c.key).toEqual([...family.parents]);
			expect(c.union, c.key).toBe(family.union);
		}
	});

	it('the controls are in the order of the smallest Person.index of the parents, then by key', async () => {
		const tree = treeOf(SOURCE);
		const index = new Map(tree.people.map((p, i) => [p.id, i]));
		const controls = await controlsOf('none');
		const order = controls.map((c) => [Math.min(...c.parents.map((p) => index.get(p)!)), c.key] as const);
		const want = [...order].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
		expect(order).toEqual(want);
	});

	it('the families of a folded fold keep their sign, and the folded key stays even if the family has a hidden child of another fold', async () => {
		const controls = await controlsOf('TWO2+BQ');
		expect(controls.find((c) => c.key === key('TWO2'))).toMatchObject({ folded: true, count: 5 });
		expect(controls.find((c) => c.key === key('BQ'))).toMatchObject({ folded: true, count: 1 });
	});
});

describe('rule 6: the tags to hidden partners (`hiddenPartners`)', () => {
	it('each set of folds: the shown people with a hidden union partner, as in the comments (the tag case: Clarice and Dorian)', async () => {
		const { foldHidden, hiddenPartners } = await foldsModule();
		for (const set of F.sets.values()) {
			const g = whole();
			const hidden = foldHidden(g, labelKeys(set.label));
			const got = hiddenPartners(g, hidden);
			expect(sorted(got.keys()), set.label).toEqual(sorted(set.tags.keys()));
			for (const [person, partners] of set.tags) expect(got.get(person), `${set.label} ${person}`).toEqual(partners);
		}
	});

	it('the hidden partners are in the order of the unions of the person', async () => {
		const { foldHidden, hiddenPartners } = await foldsModule();
		const text = [
			'people:',
			'  - {id: x, name: X}',
			'  - {id: y, name: Y}',
			'  - {id: q, name: Q, parents: [x, y]}',
			'  - {id: r, name: R, parents: [x, y]}',
			'  - {id: px, name: Px}',
			'  - {id: py, name: Py}',
			'  - {id: p, name: P, parents: [px, py]}',
			'unions:',
			'  - partners: [x, y]',
			'  - partners: [px, py]',
			'  - partners: [p, r]',
			'  - partners: [p, q]',
			'',
		].join('\n');
		const g = graphOf(text);
		const hidden = foldHidden(g, new Set([JSON.stringify(['x', 'y'])]));
		expect(sorted(hidden)).toEqual(['q', 'r']);
		expect(hiddenPartners(g, hidden).get('p')).toEqual(['r', 'q']);
		// The other order of the unions gives the other order of the tag list.
		const swapped = graphOf(text.replace('  - partners: [p, r]\n  - partners: [p, q]\n', '  - partners: [p, q]\n  - partners: [p, r]\n'));
		expect(hiddenPartners(swapped, foldHidden(swapped, new Set([JSON.stringify(['x', 'y'])]))).get('p')).toEqual(['q', 'r']);
	});

	it('nothing hidden: no tags', async () => {
		const { hiddenPartners } = await foldsModule();
		expect(hiddenPartners(whole(), new Set()).size).toBe(0);
	});
});

describe('rule 7: the pruned graph (`pruneGraph`)', () => {
	const SETS = ['A', 'B', 'A+B', 'NEST+IMPL', 'TWO2+BQ', 'COUSIN', 'R'];

	/** Every id and key that names something must name something in the graph (rule 7). */
	function danglingIn(p: FamilyGraph): string[] {
		const bad: string[] = [];
		const has = (id: string) => p.byId.has(id);
		for (const person of p.people) if (!p.byId.has(person.id)) bad.push(`people/byId ${person.id}`);
		for (const id of p.byId.keys()) if (!p.people.some((x) => x.id === id)) bad.push(`byId key ${id}`);
		for (const [id, list] of p.placementParents) {
			if (!has(id)) bad.push(`placementParents key ${id}`);
			for (const x of list) if (!has(x)) bad.push(`placementParents ${id} -> ${x}`);
		}
		for (const id of p.placementType.keys()) if (!has(id)) bad.push(`placementType key ${id}`);
		for (const [id, k] of p.primaryUnion) {
			if (!has(id)) bad.push(`primaryUnion key ${id}`);
			if (!p.unionByKey.has(k)) bad.push(`primaryUnion ${id} -> ${k}`);
		}
		for (const u of p.unions) {
			if (p.unionByKey.get(u.key) !== u) bad.push(`unionByKey ${u.key}`);
			for (const x of u.partners) if (!has(x)) bad.push(`union ${u.key} partner ${x}`);
			for (const c of u.children) if (!has(c)) bad.push(`union ${u.key} child ${c}`);
		}
		for (const k of p.unionByKey.keys()) if (!p.unions.some((u) => u.key === k)) bad.push(`unionByKey key ${k}`);
		for (const [id, list] of p.unionsOf) {
			if (!has(id)) bad.push(`unionsOf key ${id}`);
			for (const k of list) if (!p.unionByKey.has(k)) bad.push(`unionsOf ${id} -> ${k}`);
		}
		for (const [id, list] of p.soloChildren) {
			if (!has(id)) bad.push(`soloChildren key ${id}`);
			if (list.length === 0) bad.push(`soloChildren ${id} empty`);
			for (const c of list) if (!has(c)) bad.push(`soloChildren ${id} -> ${c}`);
		}
		for (const e of p.secondary) {
			if (!has(e.child)) bad.push(`secondary child ${e.child}`);
			for (const x of e.parents) if (!has(x)) bad.push(`secondary parent ${x}`);
			if (e.unionKey !== undefined && !p.unionByKey.has(e.unionKey)) bad.push(`secondary unionKey ${e.unionKey}`);
		}
		return bad;
	}

	it('with an empty set it returns the same graph object', async () => {
		const { pruneGraph } = await foldsModule();
		const g = whole();
		expect(pruneGraph(g, new Set())).toBe(g);
	});

	it('no key or id names something that is not in the result (each set of folds)', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		for (const label of SETS) {
			const g = whole();
			const hidden = foldHidden(g, labelKeys(label));
			expect(danglingIn(pruneGraph(g, hidden)), label).toEqual([]);
		}
	});

	it('invariant a: no hidden person is a key or in a list of people, byId, placementParents, placementType and primaryUnion', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		for (const label of SETS) {
			const g = whole();
			const hidden = foldHidden(g, labelKeys(label));
			const p = pruneGraph(g, hidden);
			expect(p.people.map((x) => x.id), label).toEqual(g.people.filter((x) => !hidden.has(x.id)).map((x) => x.id));
			expect(sorted(p.byId.keys()), label).toEqual(sorted(p.people.map((x) => x.id)));
			for (const [id, list] of p.placementParents) {
				expect(hidden.has(id), `${label} ${id}`).toBe(false);
				expect(list.some((x) => hidden.has(x)), `${label} ${id}`).toBe(false);
			}
			for (const id of [...p.placementType.keys(), ...p.primaryUnion.keys()]) expect(hidden.has(id), `${label} ${id}`).toBe(false);
		}
	});

	it('invariant b: a union stays when all its partners are shown, and loses its hidden children (it may end with none)', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		for (const label of SETS) {
			const g = whole();
			const hidden = foldHidden(g, labelKeys(label));
			const p = pruneGraph(g, hidden);
			const want = g.unions.filter((u) => u.partners.every((x) => !hidden.has(x)));
			expect(p.unions.map((u) => u.key), label).toEqual(want.map((u) => u.key));
			expect(sorted(p.unionByKey.keys()), label).toEqual(sorted(want.map((u) => u.key)));
			for (const u of want) expect(p.unionByKey.get(u.key)!.children, `${label} ${u.key}`).toEqual(u.children.filter((c) => !hidden.has(c)));
		}
		// Fold A: the union of A itself has no child any more but stays.
		const g = whole();
		const p = pruneGraph(g, new Set(F.folds.get('A')!.hides));
		const a = p.unions.find((u) => u.partners.includes('osric') && u.partners.includes('mathilde'))!;
		expect(a.children).toEqual([]);
	});

	it('invariant c: the values of unionsOf and primaryUnion name unions that stay; a secondary edge stays only when its child, its parents and its union are shown', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		const g = whole();
		const hidden = foldHidden(g, keys(['A']));
		const p = pruneGraph(g, hidden);
		// Tomas is shown under B; his secondary line to Hadrian and Elinor is not drawn.
		expect(g.secondary.some((e) => e.child === 'tomas')).toBe(true);
		expect(p.secondary.some((e) => e.child === 'tomas')).toBe(false);
		expect(p.byId.has('tomas')).toBe(true);
		// Wanda stays; her union with Corwin does not, her union with Godric does.
		expect(p.unionsOf.get('wanda')!.length).toBe(1);
		expect(p.unionsOf.get('wanda')!.every((k) => p.unionByKey.has(k))).toBe(true);
		for (const e of p.secondary) {
			expect(hidden.has(e.child)).toBe(false);
			expect(e.parents.some((x) => hidden.has(x))).toBe(false);
		}
		// Every secondary edge whose child and parents are shown is kept.
		const want = g.secondary.filter((e) => !hidden.has(e.child) && !e.parents.some((x) => hidden.has(x)) && (e.unionKey === undefined || p.unionByKey.has(e.unionKey)));
		expect(p.secondary.map((e) => `${e.child}/${e.parents.join()}`)).toEqual(want.map((e) => `${e.child}/${e.parents.join()}`));
	});

	it('invariant d: soloChildren entries lose hidden children; an entry with no shown child is removed', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		const g = whole();
		// Beatrix hides with A: her entry goes. Godric's solo child goes with B.
		const a = pruneGraph(g, foldHidden(g, keys(['A'])));
		expect(a.soloChildren.has('beatrix')).toBe(false);
		expect(a.soloChildren.get('godric')).toEqual(['gerard']);
		const b = pruneGraph(g, foldHidden(g, keys(['B'])));
		expect(b.soloChildren.has('godric')).toBe(false);
		expect(b.soloChildren.get('beatrix')!.length).toBe(4);
		// Fold of the family of a solo parent: the parent stays, the children go, the entry goes.
		const solo = pruneGraph(g, foldHidden(g, keys(['SOLO'])));
		expect(solo.soloChildren.has('beatrix')).toBe(false);
		expect(solo.byId.has('beatrix')).toBe(true);
	});

	it('invariant e: writtenUnions, titles, writtenTitles, issues and houses do not change; Person.index does not change', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		for (const label of SETS) {
			const g = whole();
			const p = pruneGraph(g, foldHidden(g, labelKeys(label)));
			expect(p.writtenUnions, label).toEqual(g.writtenUnions);
			expect(p.titles, label).toEqual(g.titles);
			expect(p.writtenTitles, label).toEqual(g.writtenTitles);
			expect(p.issues, label).toEqual(g.issues);
			expect([...p.houses.keys()], label).toEqual([...g.houses.keys()]);
			for (const person of p.people) expect(person.index, `${label} ${person.id}`).toBe(g.byId.get(person.id)!.index);
		}
	});

	it('the input graph is not changed, and the sibling order (D2) of the shown people is kept', async () => {
		const { foldHidden, pruneGraph } = await foldsModule();
		const g = whole();
		const snapshot = JSON.stringify([g.people.map((x) => x.id), g.unions.map((u) => [u.key, u.children]), [...g.soloChildren], [...g.unionsOf], g.secondary]);
		const p = pruneGraph(g, foldHidden(g, keys(['A', 'B'])));
		expect(JSON.stringify([g.people.map((x) => x.id), g.unions.map((u) => [u.key, u.children]), [...g.soloChildren], [...g.unionsOf], g.secondary])).toBe(snapshot);
		const order = p.people.map((x) => x.index);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('random sets of folds: no dangling key or id, ever', async () => {
		const { foldHidden, foldFamilies, pruneGraph } = await foldsModule();
		const g = whole();
		const all = foldFamilies(g).map((f) => f.key);
		let seed = 7;
		const next = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let i = 0; i < 60; i++) {
			const folds = new Set(all.filter(() => next() < 0.08));
			const hidden = foldHidden(g, folds);
			expect(danglingIn(pruneGraph(g, hidden)), [...folds].join(' ')).toEqual([]);
		}
	});
});

describe('rule 8: the folds that hide a person (`foldsHiding`)', () => {
	it('empty when the person is shown', async () => {
		const { foldsHiding } = await foldsModule();
		const g = whole();
		expect(foldsHiding(g, keys(['A']), 'clarice')).toEqual([]);
		expect(foldsHiding(g, keys(['A']), 'wanda')).toEqual([]);
		expect(foldsHiding(g, keys(['A']), 'osric')).toEqual([]);
		expect(foldsHiding(g, new Set(), 'lucan')).toEqual([]);
		expect(foldsHiding(g, keys(['A']), 'nobody')).toEqual([]);
	});

	it('nested folds: the outer fold and each fold inside it that leads to the person', async () => {
		const { foldsHiding } = await foldsModule();
		const g = whole();
		const all = new Set([...keys(['A', 'NEST', 'IMPL', 'B', 'TWO1'])]);
		// h2a is a child of Matthias and Rosalind (IMPL), Matthias is a child of Hadrian and Elinor (NEST), Hadrian is a child of Osric and Mathilde (A).
		const h2a = F.folds.get('IMPL')!.children[0];
		expect(sorted(foldsHiding(g, all, h2a))).toEqual(sorted(keys(['A', 'NEST', 'IMPL'])));
		// With IMPL open the reasons are the two folds above it.
		expect(sorted(foldsHiding(g, keys(['A', 'NEST']), h2a))).toEqual(sorted(keys(['A', 'NEST'])));
		expect(sorted(foldsHiding(g, keys(['IMPL']), h2a))).toEqual(sorted(keys(['IMPL'])));
		// A person of the branch that has no fold of his own: the outer fold only.
		expect(sorted(foldsHiding(g, all, 'corwin'))).toEqual(sorted(keys(['A'])));
	});

	it('a cousin marriage: the child is hidden by the folds of both branches', async () => {
		const { foldsHiding } = await foldsModule();
		const g = whole();
		expect(sorted(foldsHiding(g, keys(['A', 'B']), 'lucan'))).toEqual(sorted(keys(['A', 'B'])));
		expect(sorted(foldsHiding(g, keys(['A', 'B', 'COUSIN']), 'lucan'))).toEqual(sorted(keys(['A', 'B', 'COUSIN'])));
		expect(sorted(foldsHiding(g, keys(['B']), 'lucan'))).toEqual(sorted(keys(['B'])));
		expect(sorted(foldsHiding(g, keys(['COUSIN']), 'lucan'))).toEqual(sorted(keys(['COUSIN'])));
	});

	it('a married-in partner with unions in two branches: the folds of both', async () => {
		const { foldsHiding } = await foldsModule();
		const g = whole();
		expect(sorted(foldsHiding(g, keys(['A', 'B', 'TWO1']), 'wanda'))).toEqual(sorted(keys(['A', 'B'])));
		expect(foldsHiding(g, keys(['A', 'TWO1']), 'wanda')).toEqual([]);
		// Sybil has one union, with Corwin: the fold that hides Corwin.
		expect(foldsHiding(g, keys(['A', 'B']), 'sybil')).toEqual([key('A')]);
	});

	it('a person hidden through a hidden parent that is hidden by another fold: the chain is followed (R above A)', async () => {
		const { foldsHiding } = await foldsModule();
		const g = whole();
		expect(sorted(foldsHiding(g, keys(['R', 'A']), 'corwin'))).toEqual(sorted(keys(['R', 'A'])));
		expect(foldsHiding(g, keys(['R']), 'wolfgang')).toEqual([key('R')]);
	});
});

describe('rule 9: the folds to open for a person (`unfoldFor`)', () => {
	it('Find of a person inside two nested folds opens both, and no other fold', async () => {
		const { unfoldFor } = await foldsModule();
		const g = whole();
		const h2a = F.folds.get('IMPL')!.children[0];
		const folds = keys(['A', 'NEST', 'IMPL', 'B', 'TWO1']);
		const open = unfoldFor(g, g, folds, [h2a]);
		expect(sorted(open)).toEqual(sorted(keys(['B', 'TWO1'])));
	});

	it('a person hidden by one branch: only that branch opens; a cousin marriage child by either', async () => {
		const { unfoldFor } = await foldsModule();
		const g = whole();
		expect(sorted(unfoldFor(g, g, keys(['A', 'B']), ['clarice']))).toEqual(sorted(keys(['A'])));
		expect(sorted(unfoldFor(g, g, keys(['A', 'B']), ['dorian']))).toEqual(sorted(keys(['B'])));
		// Lucan is hidden by both.
		expect(sorted(unfoldFor(g, g, keys(['A', 'B']), ['lucan']))).toEqual([]);
	});

	it('a married-in partner between two folds needs both open; one fold that hides only her partner opens alone when she is shown', async () => {
		const { unfoldFor } = await foldsModule();
		const g = whole();
		expect(unfoldFor(g, g, keys(['A', 'B']), ['wanda']).size).toBe(0);
		// Shown people change nothing.
		expect(sorted(unfoldFor(g, g, keys(['A']), ['wanda']))).toEqual(sorted(keys(['A'])));
	});

	it('several ids: the union of the folds that hide any of them', async () => {
		const { unfoldFor } = await foldsModule();
		const g = whole();
		expect(sorted(unfoldFor(g, g, keys(['A', 'B', 'TWO1']), ['dorian', 'godric']))).toEqual(sorted(keys(['TWO1'])));
		expect(unfoldFor(g, g, keys(['A', 'B']), []).size).toBe(2);
	});

	it('it never adds a fold, and it changes nothing for a person who is shown or unknown', async () => {
		const { unfoldFor } = await foldsModule();
		const g = whole();
		const folds = keys(['A', 'B', 'TWO1']);
		expect(sorted(unfoldFor(g, g, folds, ['osric']))).toEqual(sorted(folds));
		expect(sorted(unfoldFor(g, g, folds, ['nobody']))).toEqual(sorted(folds));
		// The input set is not changed.
		expect(sorted(folds)).toEqual(sorted(keys(['A', 'B', 'TWO1'])));
	});

	it('a focus graph: the folds are those that hide the person in the graph that is drawn after the action', async () => {
		const { unfoldFor, foldHidden } = await foldsModule();
		const tree = treeOf(SOURCE);
		const wholeG = whole();
		const drawn = deriveFamilies(focusSubgraph(tree, 'godric', 1)!.tree);
		// Preconditions: Wanda is in the focus family of Godric, her other partner Corwin is not.
		expect(drawn.byId.has('wanda')).toBe(true);
		expect(drawn.byId.has('godric')).toBe(true);
		expect(drawn.byId.has('corwin')).toBe(false);
		const folds = keys(['B']);
		// In the whole tree Wanda is shown (Corwin is shown); in the focus family her only partner Godric is hidden by B.
		expect(foldHidden(wholeG, folds).has('wanda')).toBe(false);
		expect(foldHidden(drawn, folds).has('wanda')).toBe(true);
		const open = unfoldFor(drawn, wholeG, folds, ['wanda']);
		expect(foldHidden(drawn, open).has('wanda')).toBe(false);
		expect(open.size).toBe(0);
	});

	it('no target stays hidden in the graph that is drawn, for any set of folds and any person (random)', async () => {
		const { unfoldFor, foldHidden, foldFamilies, foldsHiding } = await foldsModule();
		const tree = treeOf(SOURCE);
		const wholeG = whole();
		const graphs: FamilyGraph[] = [wholeG, ...['godric', 'clarice', 'wanda', 'osric', 'hadrian', 'tomas'].map((id) => deriveFamilies(focusSubgraph(tree, id, 1)!.tree))];
		const all = foldFamilies(wholeG).map((f) => f.key);
		let seed = 15;
		const next = () => {
			seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let i = 0; i < 300; i++) {
			const drawn = graphs[Math.floor(next() * graphs.length)];
			const folds = new Set(all.filter(() => next() < 0.15));
			const ids = tree.people.filter(() => next() < 0.04).map((p) => p.id).filter((id) => drawn.byId.has(id));
			const open = unfoldFor(drawn, wholeG, folds, ids);
			const label = `${[...folds].length} folds, ${ids.join()}`;
			// It never adds a fold.
			for (const k of open) expect(folds.has(k), label).toBe(true);
			// No target stays hidden in the drawn graph.
			const still = foldHidden(drawn, open);
			for (const id of ids) expect(still.has(id), `${label}: ${id}`).toBe(false);
			// Only folds that hide a target (in the drawn or in the whole graph) are opened.
			const allowed = new Set([...ids.flatMap((id) => [...foldsHiding(drawn, folds, id), ...foldsHiding(wholeG, folds, id)])]);
			for (const k of folds) if (!open.has(k)) expect(allowed.has(k), `${label}: ${k}`).toBe(true);
		}
	});
});

describe('rule 10: folds that end (`pruneFolds`)', () => {
	it('a fold whose family exists stays; the same set object comes back when nothing ends', async () => {
		const { pruneFolds } = await foldsModule();
		const g = whole();
		const folds = keys(['A', 'NEST', 'REM']);
		expect(pruneFolds(g, folds)).toBe(folds);
		const empty = new Set<string>();
		expect(pruneFolds(g, empty)).toBe(empty);
	});

	it('a key with no family ends: no child, or a parent that does not exist', async () => {
		const { pruneFolds } = await foldsModule();
		const g = whole();
		const kept = pruneFolds(g, new Set([key('A'), '["piers"]', '["nobody"]', '["aldric","nobody"]', 'garbage']));
		expect([...kept]).toEqual([key('A')]);
	});

	it('the family has no child any more (the last child deleted): the fold ends; the others stay', async () => {
		const { pruneFolds } = await foldsModule();
		// Remove the person item of Lucan, the only child of Dorian and Clarice.
		const start = SOURCE.indexOf('  - id: lucan\n');
		const next = SOURCE.indexOf('\n  - id:', start + 1) + 1;
		const edited = SOURCE.slice(0, start) + SOURCE.slice(next);
		const g = graphOf(edited);
		expect(g.byId.has('lucan')).toBe(false);
		const folds = keys(['COUSIN', 'A', 'B']);
		expect(sorted(pruneFolds(g, folds))).toEqual(sorted(keys(['A', 'B'])));
	});

	it('a parent id that changed: the fold ends (the key names the parents)', async () => {
		const { pruneFolds, foldFamilies } = await foldsModule();
		const edited = SOURCE.split('parents: [corwin, sybil]').join('parents: [corwin, wilma]').replace('  - id: sybil\n', '  - id: wilma\n').replace('partners: [corwin, sybil]', 'partners: [corwin, wilma]');
		const g = graphOf(edited);
		expect(foldFamilies(g).some((f) => f.key === key('TWO1'))).toBe(false);
		expect([...pruneFolds(g, keys(['TWO1', 'A']))]).toEqual([key('A')]);
	});

	it('the fold stays after an edit that moves the unions', async () => {
		const { pruneFolds } = await foldsModule();
		const at = SOURCE.indexOf('\nunions:\n');
		const head = SOURCE.slice(0, at + '\nunions:\n'.length);
		const items = SOURCE.slice(head.length).split(/(?=^ {2}- partners:)/m);
		const moved = head + [...items.slice(5), ...items.slice(0, 5)].join('');
		const folds = keys(['A', 'REM', 'BQ']);
		expect(pruneFolds(graphOf(moved), folds)).toBe(folds);
	});

	it('a fold whose family exists in the whole tree is kept, although the drawn graph (a focus family) lacks it', async () => {
		const { pruneFolds, foldFamilies } = await foldsModule();
		const tree = treeOf(SOURCE);
		const focus = deriveFamilies(focusSubgraph(tree, 'osric', 1)!.tree);
		expect(foldFamilies(focus).some((f) => f.key === key('NEST'))).toBe(false);
		const folds = keys(['NEST']);
		// `pruneFolds` is given the whole tree's graph.
		expect(pruneFolds(whole(), folds)).toBe(folds);
	});
});

describe('rule 11: the keys for the sheet (`personFolds`)', () => {
	const at = async (names: readonly string[], id: string) => {
		const { foldHidden, personFolds } = await foldsModule();
		const g = whole();
		const folds = keys(names);
		return personFolds(g, folds, foldHidden(g, folds), id);
	};

	it('a person with two families that have children: both are open (Corwin)', async () => {
		const r = await at([], 'corwin');
		expect(sorted(r.open)).toEqual(sorted(keys(['TWO1', 'TWO2'])));
		expect(r.folded).toEqual([]);
	});

	it('one folded and one open: "Hide descendants" folds exactly the open one, "Show descendants" opens exactly the folded one', async () => {
		const r = await at(['TWO1'], 'corwin');
		expect(r.open).toEqual([key('TWO2')]);
		expect(r.folded).toEqual([key('TWO1')]);
	});

	it('a pair, and each of the two alone: Wanda has three families (Corwin, Godric, alone)', async () => {
		const r = await at([], 'wanda');
		expect(sorted(r.open)).toEqual(sorted(keys(['TWO2', 'BQ', 'WS'])));
	});

	it('a person with no child has nothing', async () => {
		const r = await at([], 'piers');
		expect(r).toEqual({ open: [], folded: [] });
		expect(await at([], 'nobody')).toEqual({ open: [], folded: [] });
	});

	it('a hidden person, or a person whose family has a hidden parent, has no control to offer', async () => {
		expect(await at(['A'], 'corwin')).toEqual({ open: [], folded: [] });
		expect(await at(['A'], 'dorian')).toEqual({ open: [], folded: [] });
		// Clarice is shown, but the family with Dorian has a hidden parent.
		expect(await at(['A'], 'clarice')).toEqual({ open: [], folded: [] });
		// Wanda under A: only the families with shown parents.
		expect(sorted((await at(['A'], 'wanda')).open)).toEqual(sorted(keys(['BQ', 'WS'])));
	});

	it('a folded family of the person is in `folded`; folds inside the branch keep their own state', async () => {
		const r = await at(['A', 'NEST'], 'osric');
		expect(r.open).toEqual([]);
		expect(r.folded).toEqual([key('A')]);
		const inner = await at(['NEST'], 'hadrian');
		expect(inner.folded).toEqual([key('NEST')]);
	});
});

describe('performance (spec §13.10 acceptance; contract F17): sample tree 7', () => {
	speedTest('the count of every family, and the hidden set of every family, take well under a second', async () => {
		const { foldFamilies, foldCount, foldHidden, foldControls } = await foldsModule();
		const g = graphOf(fixtureSource('07'));
		const families = foldFamilies(g);
		expect(families.length).toBeGreaterThan(100);
		const start = performance.now();
		let total = 0;
		for (const f of families) total += foldCount(g, f.key);
		const counted = performance.now() - start;
		expect(total).toBeGreaterThan(families.length);
		const all = new Set(families.map((f) => f.key));
		const start2 = performance.now();
		const hidden = foldHidden(g, all);
		foldControls(g, all, hidden);
		const together = performance.now() - start2;
		expect(hidden.size).toBeGreaterThan(300);
		// The target for a whole fold or open is 100 ms on the computer, layout included; the core part must be a small part of it.
		expect(counted).toBeLessThan(500);
		expect(together).toBeLessThan(100);
	});
});
