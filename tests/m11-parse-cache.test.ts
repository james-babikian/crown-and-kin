import { describe, expect, it, vi } from 'vitest';
import { PARSE_CACHE_SIZE } from '../src/core/parse-cache';
import { parseDynasty } from '../src/core/parse';
import type { ParseResult } from '../src/core/types';
import { parseCacheModule } from './acceptance/m11-support';

/*
 * WP 11.0 (spec §13.15 rule 3; `src/core/parse-cache.ts` header): the parse cache. The module
 * `src/core/parse-cache.ts` is added by WP 11.1; until then every test here fails with a message that names it.
 * Run: npx vitest run tests/m11-parse-cache.test.ts
 */

const BODY = `houses:
  - {id: h, name: House H}
people:
  - {id: a, name: Aldric, house: h}
  - {id: b, name: Bran, parents: [a]}
`;

/** A parse double: one new object per call, so a test tells a hit from a new parse. */
function spy() {
	const parse = vi.fn((text: string): ParseResult => ({ ok: true, tree: { text } as never }));
	return parse;
}

describe('S8: the parse cache', () => {
	it('the size is 4', () => {
		expect(PARSE_CACHE_SIZE).toBe(4);
	});

	it('the same path and text give the same result and one parse', async () => {
		const { createParseCache } = await parseCacheModule();
		const parse = spy();
		const cache = createParseCache({ parse });
		const a = cache.get('A.md', 'text');
		const b = cache.get('A.md', 'text');
		expect(b).toBe(a);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(parse).toHaveBeenCalledWith('text');
		expect(cache.size).toBe(1);
	});

	it('the key has the path and the exact text: another path or another text is another entry', async () => {
		const { createParseCache } = await parseCacheModule();
		const parse = spy();
		const cache = createParseCache({ parse });
		const a = cache.get('A.md', 'text');
		expect(cache.get('B.md', 'text')).not.toBe(a);
		expect(cache.get('A.md', 'text ')).not.toBe(a);
		expect(cache.get('A.md', 'Text')).not.toBe(a);
		expect(parse).toHaveBeenCalledTimes(4);
		expect(cache.size).toBe(4);
	});

	it('the least recently used entry goes when a 5th one comes; a hit makes an entry the most recent', async () => {
		const { createParseCache } = await parseCacheModule();
		const parse = spy();
		const cache = createParseCache({ parse });
		for (const t of ['t1', 't2', 't3', 't4']) cache.get('N.md', t);
		expect(parse).toHaveBeenCalledTimes(4);
		cache.get('N.md', 't1'); // a hit: t1 is now the newest, t2 the oldest
		expect(parse).toHaveBeenCalledTimes(4);
		cache.get('N.md', 't5'); // evicts t2 (first-in-first-out would evict t1)
		expect(cache.size).toBe(4);
		expect(parse).toHaveBeenCalledTimes(5);
		cache.get('N.md', 't1');
		cache.get('N.md', 't3');
		cache.get('N.md', 't4');
		cache.get('N.md', 't5');
		expect(parse).toHaveBeenCalledTimes(5);
		cache.get('N.md', 't2');
		expect(parse).toHaveBeenCalledTimes(6);
	});

	it('the size never goes over the limit', async () => {
		const { createParseCache } = await parseCacheModule();
		const cache = createParseCache({ parse: spy() });
		for (let i = 0; i < 50; i++) cache.get('N.md', `t${i}`);
		expect(cache.size).toBe(PARSE_CACHE_SIZE);
	});

	it('the option `limit` sets the size', async () => {
		const { createParseCache } = await parseCacheModule();
		const parse = spy();
		const cache = createParseCache({ parse, limit: 2 });
		cache.get('N.md', 'a');
		cache.get('N.md', 'b');
		cache.get('N.md', 'c');
		expect(cache.size).toBe(2);
		cache.get('N.md', 'b');
		cache.get('N.md', 'c');
		expect(parse).toHaveBeenCalledTimes(3);
		cache.get('N.md', 'a');
		expect(parse).toHaveBeenCalledTimes(4);
	});

	it('an error is kept too: the same text gives the same error result and no new parse', async () => {
		const { createParseCache } = await parseCacheModule();
		const failed: ParseResult = { ok: false, error: { code: 'yaml-syntax', detail: 'x' } as never };
		const parse = vi.fn((): ParseResult => failed);
		const cache = createParseCache({ parse });
		expect(cache.get('E.md', 'bad')).toBe(failed);
		expect(cache.get('E.md', 'bad')).toBe(failed);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(cache.size).toBe(1);
	});

	it('clear empties the cache; the next get parses again', async () => {
		const { createParseCache } = await parseCacheModule();
		const parse = spy();
		const cache = createParseCache({ parse });
		cache.get('A.md', 'x');
		cache.clear();
		expect(cache.size).toBe(0);
		cache.get('A.md', 'x');
		expect(parse).toHaveBeenCalledTimes(2);
	});

	it('without a `parse` option it uses parseDynasty, and its result is the same as a direct parse', async () => {
		const { createParseCache } = await parseCacheModule();
		const cache = createParseCache();
		const got = cache.get('T.md', BODY);
		const direct = parseDynasty(BODY);
		expect(got.ok).toBe(true);
		if (!got.ok || !direct.ok) throw new Error('parse');
		expect(got.tree.people.map((p) => p.id)).toEqual(direct.tree.people.map((p) => p.id));
		expect(cache.get('T.md', BODY)).toBe(got);
		const bad = cache.get('T.md', 'people: [unclosed');
		expect(bad.ok).toBe(false);
	});

	it('a different note with the same block text is parsed again (the path is part of the key)', async () => {
		const { createParseCache } = await parseCacheModule();
		const cache = createParseCache();
		expect(cache.get('A.md', BODY)).not.toBe(cache.get('B.md', BODY));
	});

	it('freeze: the returned Tree cannot be changed at any depth, and a write throws', async () => {
		const { createParseCache } = await parseCacheModule();
		const cache = createParseCache({ freeze: true });
		const got = cache.get('T.md', BODY);
		if (!got.ok) throw new Error('parse');
		const tree = got.tree;
		expect(Object.isFrozen(tree)).toBe(true);
		expect(() => {
			(tree.people as unknown[]).push({});
		}).toThrow();
		expect(() => {
			(tree.people[0] as { name: string }).name = 'X';
		}).toThrow();
		expect(() => {
			(tree.houses[0] as { name: string }).name = 'X';
		}).toThrow();
		expect(() => {
			(tree as { people: unknown }).people = [];
		}).toThrow();
		// A second get gives the same, still frozen.
		expect(cache.get('T.md', BODY)).toBe(got);
		expect(tree.people[0].name).toBe('Aldric');
	});

	it('without freeze nothing is frozen', async () => {
		const { createParseCache } = await parseCacheModule();
		const plain = createParseCache().get('T.md', BODY);
		if (!plain.ok) throw new Error('parse');
		expect(Object.isFrozen(plain.tree)).toBe(false);
	});

	it('freeze is off by default, so a plain cache adds no cost of its own to a result', async () => {
		const { createParseCache } = await parseCacheModule();
		const result: ParseResult = { ok: true, tree: { people: [], houses: [] } as never };
		const got = createParseCache({ parse: () => result }).get('A.md', 'x');
		expect(got).toBe(result);
		expect(Object.isFrozen(result.ok && result.tree)).toBe(false);
	});
});
