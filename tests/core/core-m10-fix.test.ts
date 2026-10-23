import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { foldFamilies, foldHidden, foldKey } from '../../src/core/folds';
import { linkedNotePath } from '../../src/core/note-make';
import { parseDynasty } from '../../src/core/parse';
import { automaticCrop, formatPortraitCrop, isAutomaticCrop } from '../../src/core/portrait-crop';
import { xorshift as rng } from '../support/rng';

/* M10 fix round, core part: fold hiding with close marriages, automatic crop, linked note path. */

function graph(text: string) {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const yaml = (rows: string[]) => ['people:', ...rows.map((r) => `  - ${r}`), ''].join('\n');

describe('folds: parents of a folded family', () => {
	it('a father whose only partner is his daughter stays shown; his family folds with no error', () => {
		const g = graph(yaml(['{id: a, name: A}', '{id: b, name: B, parents: [a]}', '{id: c, name: C, parents: [a, b]}']));
		expect(foldHidden(g, new Set([foldKey(['a'])])).has('a')).toBe(false);
	});

	it('an uncle who marries his niece stays shown when the niece house folds', () => {
		// u and s are brothers; n is the daughter of s and t. u marries n, and they have a child k.
		const g = graph(
			yaml([
				'{id: r, name: R}',
				'{id: u, name: U, parents: [r]}',
				'{id: s, name: S, parents: [r]}',
				'{id: t, name: T}',
				'{id: n, name: N, parents: [s, t]}',
				'{id: k, name: K, parents: [u, n]}',
			]),
		);
		const hidden = foldHidden(g, new Set([foldKey(['r'])]));
		// Folding the root hides its children and, by rule 3b, everything below; the guard leaves nothing hidden only if all go.
		expect(hidden.has('r')).toBe(false);
		const fold = foldHidden(g, new Set([foldKey(['n', 'u'])]));
		expect(fold.has('u')).toBe(false);
		expect(fold.has('n')).toBe(false);
		expect(fold.has('k')).toBe(true);
	});

	it('a parent hidden by a nested fold stays hidden', () => {
		const g = graph(yaml(['{id: a, name: A}', '{id: b, name: B, parents: [a]}', '{id: c, name: C, parents: [b]}', '{id: d, name: D, parents: [c]}']));
		const hidden = foldHidden(g, new Set([foldKey(['a']), foldKey(['b'])]));
		expect([...hidden].sort()).toEqual(['b', 'c', 'd']);
	});

	it('returns no hidden people when every person would be hidden', () => {
		// The parser never allows a cycle, so make one by hand: a and b are each the sole child of the other.
		const g = graph(yaml(['{id: a, name: A}', '{id: b, name: B, parents: [a]}']));
		g.soloChildren.set('b', ['a']);
		g.placementParents.set('a', ['b']);
		const folds = new Set([foldKey(['a']), foldKey(['b'])]);
		expect(foldFamilies(g).length).toBe(2);
		expect(foldHidden(g, folds).size).toBe(0);
	});
});

describe('folds: random trees', () => {
	// A small seeded generator; each tree may hold marriages between parents and children, uncles and nieces.

	function randomTree(seed: number): string {
		const rand = rng(seed);
		const n = 3 + Math.floor(rand() * 9);
		const rows: string[] = [];
		for (let i = 0; i < n; i++) {
			const earlier = Array.from({ length: i }, (_, j) => `p${j}`);
			const pick = () => earlier[Math.floor(rand() * earlier.length)];
			const kind = i === 0 ? 0 : Math.floor(rand() * 4);
			const parents = kind === 0 ? [] : kind === 1 ? [pick()] : [...new Set([pick(), pick()])];
			rows.push(`{id: p${i}, name: P${i}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`);
		}
		return yaml(rows);
	}

	it('never hides everyone and never hides a parent of a fold by marriage alone', () => {
		for (let seed = 1; seed <= 1500; seed++) {
			const g = graph(randomTree(seed));
			const families = foldFamilies(g);
			for (const f of families) {
				const hidden = foldHidden(g, new Set([f.key]));
				expect(hidden.size, `seed ${seed} ${f.key}`).toBeLessThan(g.byId.size);
				// A single fold hides a parent only when that parent lies below the family (rules 3a, 3b).
				const below = new Set<string>();
				const stack = [...f.children];
				while (stack.length) {
					const x = stack.pop()!;
					if (below.has(x)) continue;
					below.add(x);
					for (const u of g.unionsOf.get(x) ?? []) for (const c of g.unionByKey.get(u)!.children) stack.push(c);
					for (const c of g.soloChildren.get(x) ?? []) stack.push(c);
				}
				for (const p of f.parents) if (hidden.has(p)) expect(below.has(p), `seed ${seed} ${f.key} hides ${p}`).toBe(true);
			}
		}
	});
});

describe('portrait crop: automatic part', () => {
	it('counts a crop written with 4 decimals as automatic', () => {
		const written = { left: 0.0463, top: 0, side: 1 };
		expect(isAutomaticCrop(written, 4000, 3629)).toBe(true);
		expect(formatPortraitCrop(automaticCrop(4000, 3629))).toBe('0.0463 0 1');
	});

	it('does not count a different crop or an unusable one as automatic', () => {
		expect(isAutomaticCrop({ left: 0.05, top: 0, side: 1 }, 4000, 3629)).toBe(false);
		expect(isAutomaticCrop({ left: NaN, top: 0, side: 1 }, 4000, 3629)).toBe(false);
	});
});

describe('linked note path: dots in the path', () => {
	it('drops "." segments', () => {
		expect(linkedNotePath('[[./People/./Anna]]')).toEqual({ folder: 'People', name: 'Anna', path: 'People/Anna.md' });
		expect(linkedNotePath('./Anna')).toEqual({ folder: '', name: 'Anna', path: 'Anna.md' });
	});

	it('returns null for any ".." segment', () => {
		expect(linkedNotePath('[[../Anna]]')).toBeNull();
		expect(linkedNotePath('People/../Anna')).toBeNull();
		expect(linkedNotePath('People/..')).toBeNull();
		expect(linkedNotePath('..')).toBeNull();
	});

	it('returns null for a lone "."', () => {
		expect(linkedNotePath('.')).toBeNull();
	});
});
