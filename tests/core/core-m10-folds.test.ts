import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { foldControls, foldCount, foldFamilies, foldHidden, foldKey, foldsHiding, hiddenPartners, personFolds, pruneFolds, pruneGraph, unfoldFor } from '../../src/core/folds';
import { parseDynasty } from '../../src/core/parse';

/*
 * WP 10.1 unit tests for `src/core/folds.ts` on small trees, worked out by hand: the edges that the
 * acceptance tests of sample tree 15 do not name (bad input, sole-parent families, the safety net).
 */

function graph(text: string) {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Root pair R1+R2 with children a and b; a and his wife w have child c; w has a second partner z (no children). */
const TREE = [
	'people:',
	'  - {id: r1, name: R1}',
	'  - {id: r2, name: R2}',
	'  - {id: a, name: A, parents: [r1, r2]}',
	'  - {id: b, name: B, parents: [r1, r2]}',
	'  - {id: w, name: W}',
	'  - {id: z, name: Z}',
	'  - {id: y, name: Y}',
	'  - {id: c, name: C, parents: [a, w]}',
	'  - {id: s, name: S, parents: [b]}',
	'unions:',
	'  - partners: [r1, r2]',
	'  - partners: [a, w]',
	'  - partners: [w, z]',
	'  - partners: [a, y]',
	'',
].join('\n');

describe('fold keys', () => {
	it('the key of a pair does not depend on the order; an empty or odd list does not throw', () => {
		expect(foldKey(['b', 'a'])).toBe(foldKey(['a', 'b']));
		expect(() => foldKey([] as string[])).not.toThrow();
		expect(() => foldKey(undefined as unknown as string[])).not.toThrow();
	});
});

describe('families', () => {
	it('a pair with children, a pair and a sole parent are separate families in the order of the parents', () => {
		const g = graph(TREE);
		expect(foldFamilies(g).map((f) => [f.key, [...f.children]])).toEqual([
			['["r1","r2"]', ['a', 'b']],
			['["a","w"]', ['c']],
			['["b"]', ['s']],
		]);
		expect(foldFamilies(g)[2].union).toBeUndefined();
	});

	it('the control sits on the listed union of the pair', () => {
		const g = graph(TREE);
		expect(foldFamilies(g)[0].union).toBe('u0');
	});
});

describe('hidden people', () => {
	it('a married-in person whose partners are all hidden hides with them; one with a partner outside the branch stays', () => {
		const g = graph(TREE);
		const hidden = foldHidden(g, new Set(['["r1","r2"]']));
		// W has a union with Z, who is shown, so W and Z stay; Y has only A, so Y goes.
		expect([...hidden].sort()).toEqual(['a', 'b', 'c', 's', 'y']);
	});

	it('a family whose parents are shown keeps its parents shown', () => {
		const g = graph(TREE);
		expect([...foldHidden(g, new Set(['["a","w"]']))]).toEqual(['c']);
		expect(foldCount(g, '["a","w"]')).toBe(1);
	});

	it('nothing is hidden for a made-up key or for values that are not text', () => {
		const g = graph(TREE);
		expect(foldHidden(g, new Set(['nope'])).size).toBe(0);
		expect(foldHidden(g, undefined as never).size).toBe(0);
		expect(foldCount(g, '["r1"]')).toBe(0);
	});
});

describe('controls and sheet keys', () => {
	it('a family with a hidden parent has no control; an open family shows N = 0', () => {
		const g = graph(TREE);
		const folds = new Set(['["r1","r2"]']);
		const hidden = foldHidden(g, folds);
		expect(foldControls(g, folds, hidden).map((c) => [c.key, c.folded, c.count])).toEqual([['["r1","r2"]', true, 5]]);
		const none = foldControls(g, new Set(), new Set());
		expect(none.map((c) => [c.key, c.folded, c.count])).toEqual([
			['["r1","r2"]', false, 0],
			['["a","w"]', false, 0],
			['["b"]', false, 0],
		]);
		expect('union' in none[2]).toBe(false);
	});

	it('personFolds lists the open and the folded families of a shown person', () => {
		const g = graph(TREE);
		const folds = new Set(['["a","w"]']);
		expect(personFolds(g, folds, foldHidden(g, folds), 'a')).toEqual({ open: [], folded: ['["a","w"]'] });
		expect(personFolds(g, folds, foldHidden(g, folds), 'r1')).toEqual({ open: ['["r1","r2"]'], folded: [] });
	});
});

describe('tags for hidden partners', () => {
	it('a shown person gets the hidden partners in union order', () => {
		const g = graph(TREE);
		const hidden = new Set(['z']);
		expect(hiddenPartners(g, hidden).get('w')).toEqual(['z']);
		expect(hiddenPartners(g, new Set()).size).toBe(0);
	});
});

describe('pruneGraph', () => {
	it('keeps the same object with nothing hidden and removes a union with a hidden partner', () => {
		const g = graph(TREE);
		expect(pruneGraph(g, new Set())).toBe(g);
		const p = pruneGraph(g, foldHidden(g, new Set(['["a","w"]'])));
		expect(p.unions.find((u) => u.key === 'u1')!.children).toEqual([]);
		expect(p.people.map((x) => x.id)).not.toContain('c');
		// The original union object is not changed.
		expect(g.unions.find((u) => u.key === 'u1')!.children).toEqual(['c']);
	});

	it('a union with a hidden partner goes, and so does the entry of a person who has no union left', () => {
		const g = graph(TREE);
		const p = pruneGraph(g, new Set(['z']));
		expect(p.unions.map((u) => u.key)).toEqual(['u0', 'u1', 'u3']);
		expect(p.unionsOf.get('w')).toEqual(['u1']);
		expect(p.unionsOf.has('z')).toBe(false);
	});
});

describe('folds that hide a person and folds to open', () => {
	it('foldsHiding follows the chain of a nested fold', () => {
		const g = graph(TREE);
		const folds = new Set(['["r1","r2"]', '["a","w"]']);
		expect(foldsHiding(g, folds, 'c').sort()).toEqual(['["a","w"]', '["r1","r2"]']);
		expect(foldsHiding(g, folds, 'y')).toEqual(['["r1","r2"]']);
		expect(foldsHiding(g, folds, 'w')).toEqual([]);
	});

	it('unfoldFor opens the outer and the inner fold that hide the person, and keeps a fold that hides someone else', () => {
		const g = graph(TREE);
		const folds = new Set(['["r1","r2"]', '["a","w"]', '["b"]']);
		expect([...unfoldFor(g, g, folds, ['c'])]).toEqual(['["b"]']);
		expect([...unfoldFor(g, g, folds, [])].sort()).toEqual([...folds].sort());
		expect(() => unfoldFor(g, g, folds, undefined as never)).not.toThrow();
	});

	it('pruneFolds drops a key with no family and keeps the others', () => {
		const g = graph(TREE);
		const keep = new Set(['["b"]']);
		expect(pruneFolds(g, keep)).toBe(keep);
		expect([...pruneFolds(g, new Set(['["b"]', '["b","x"]']))]).toEqual(['["b"]']);
	});
});
