// P8-17, P8-20 and P8-22: the shared ordinal word, list comparison and deep freeze.
import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/core/deep-freeze';
import { sameList } from '../src/core/same-list';
import { ordinal } from '../src/core/succession-keys';
import { createParseCache } from '../src/core/parse-cache';

/** The private copy that `relations.ts` had before P8-17. */
function oldRelationsOrdinal(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

describe('P8-17: one ordinal word', () => {
	it('gives the same word as the old relations copy for 0 to 5000', () => {
		for (let n = 0; n <= 5000; n++) expect(ordinal(n)).toBe(oldRelationsOrdinal(n));
	});

	it('spells the known words', () => {
		const words = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 113].map(ordinal);
		expect(words).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th', '113th']);
	});
});

describe('P8-20: one sameList', () => {
	it('compares length, order and items', () => {
		expect(sameList([], [])).toBe(true);
		expect(sameList([1, 2, 3], [1, 2, 3])).toBe(true);
		expect(sameList([1, 2, 3], [1, 2])).toBe(false);
		expect(sameList([1, 2, 3], [1, 3, 2])).toBe(false);
		expect(sameList(['a'], ['b'])).toBe(false);
	});

	it('takes the same list as equal and accepts read-only lists', () => {
		const list: readonly string[] = ['x', 'y'];
		expect(sameList(list, list)).toBe(true);
		expect(sameList(list, ['x', 'y'])).toBe(true);
	});

	it('compares objects by identity', () => {
		const a = {};
		expect(sameList([a], [a])).toBe(true);
		expect(sameList([a], [{}])).toBe(false);
	});
});

describe('P8-22: one deepFreeze', () => {
	it('freezes plain data at every depth and returns the value', () => {
		const v = { a: [{ b: 1 }, { c: { d: [2] } }] as [{ b: number }, { c: { d: number[] } }], e: 'x' };
		expect(deepFreeze(v)).toBe(v);
		expect(Object.isFrozen(v)).toBe(true);
		expect(Object.isFrozen(v.a)).toBe(true);
		expect(Object.isFrozen(v.a[0])).toBe(true);
		expect(Object.isFrozen(v.a[1].c.d)).toBe(true);
	});

	it('returns a primitive and null as they are', () => {
		expect(deepFreeze(5)).toBe(5);
		expect(deepFreeze(null)).toBe(null);
		expect(deepFreeze('s')).toBe('s');
	});

	it('freezes a Map with its values and blocks set, delete and clear', () => {
		const inner = { n: 1 };
		const m = new Map<string, { n: number }>([['k', inner]]);
		deepFreeze(m);
		expect(Object.isFrozen(inner)).toBe(true);
		expect(() => m.set('z', inner)).toThrow(TypeError);
		expect(() => m.delete('k')).toThrow(TypeError);
		expect(() => m.clear()).toThrow(TypeError);
		expect(m.get('k')).toBe(inner);
	});

	it('freezes the values inside a Map inside a plain object', () => {
		const inner = [1];
		const v = { m: new Map([[1, inner]]) };
		deepFreeze(v);
		expect(Object.isFrozen(inner)).toBe(true);
	});

	it('survives a cycle', () => {
		const a: { self?: unknown; list: unknown[] } = { list: [] };
		a.self = a;
		a.list.push(a);
		expect(() => deepFreeze(a)).not.toThrow();
		expect(Object.isFrozen(a)).toBe(true);
		expect(Object.isFrozen(a.list)).toBe(true);
	});

	it('visits a shared object once', () => {
		const shared = { x: 1 };
		const v = { p: shared, q: shared };
		deepFreeze(v);
		expect(Object.isFrozen(shared)).toBe(true);
	});

	it('is the freeze of the parse cache only when the cache asks for it', () => {
		const text = 'people:\n  - id: a\n    name: A\n';
		const frozen = createParseCache({ freeze: true }).get('p.md', text);
		const open = createParseCache().get('p.md', text);
		expect(frozen.ok && Object.isFrozen(frozen.tree) && Object.isFrozen(frozen.tree.people?.[0])).toBe(true);
		expect(open.ok && Object.isFrozen(open.tree)).toBe(false);
	});
});
