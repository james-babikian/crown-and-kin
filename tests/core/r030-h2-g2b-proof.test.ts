import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import { LIMIT_DETAIL } from '../../src/core/messages';
import { ALIAS_MARKS_CAP, parseBody } from '../../src/core/parse';

/*
 * G2b proofs for the WP-H2 fix round; the first one failed before `NESTED_ALIAS_WORK_CAP`.
 * The cap counts alias uses plus anchors. The yaml package also walks every alias that sits inside an anchored collection
 * with an uncached `Alias.resolve(doc)` (`getAliasCount`), a visit of the whole document for each such alias. The cost is
 * (aliases inside an anchored collection) x (nodes of the document), and the cap does not see it.
 */
const mk = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

describe('G2b: alias cap', () => {
	speedTest('800 aliases inside one anchored list, used once, in a note of 4 000 people, are refused or read in under 4 s', () => {
		const text = `x: &x v\na: &a [${Array(800).fill('*x').join(', ')}]\nb: *a\npeople:\n${mk(4000, (i) => `  - {id: q${i}, name: Q${i}, notes: [a, b, c]}`)}\n`;
		const marks = 800 + 3;
		expect(marks).toBeLessThan(ALIAS_MARKS_CAP);
		const t0 = performance.now();
		const r = parseBody(text);
		const ms = performance.now() - t0;
		console.log(`read took ${Math.round(ms)} ms, ok=${r.ok}, text ${text.length} chars`);
		// Either the text is refused (tooLarge) or it reads fast. It does neither.
		expect(r.ok === false ? r.error.detail === LIMIT_DETAIL.tooLarge : ms < 4000).toBe(true);
	}, 120_000);

	it('HELD: anchors without any alias are never refused (30 000 anchors)', () => {
		expect(parseBody(`people:\n${mk(30000, (i) => `  - {id: p${i}, name: &n${i} P${i}}`)}\n`).ok).toBe(true);
	});

	it('HELD: 5 000 people sharing two anchors (10 000 uses) read; 6 100 people with two uses each are refused', () => {
		const make = (n: number) => `houses:\n  - &h {id: h, name: H}\nbase: &b "1200"\npeople:\n${mk(n, (i) => `  - {id: p${i}, name: P${i}, house: *h, born: *b}`)}\n`;
		expect(parseBody(make(5000)).ok).toBe(true);
		expect(parseBody(make(6100)).ok).toBe(false);
	});
});

describe('G2b: duplicate key text', () => {
	const detail = (text: string) => {
		const r = parseBody(text);
		return r.ok ? null : r.error.detail;
	};
	it('HELD: a quote, markup, a long key or a line break cannot reach the message', () => {
		for (const [written, key] of [['a"b', 'a"b'], ['<b>x</b>', '<b>x</b>'], ['x'.repeat(200), 'x'.repeat(200)], ['"[[link]]"', '[[link]]'], ['"`code`"', '`code`']]) {
			const d = detail(`${written}: 1\n${written}: 2\n`);
			expect(d).toBe(LIMIT_DETAIL.duplicateKey());
			expect(d).not.toContain(key);
		}
		expect(detail('people: []\npeople: []\n')).toContain('“people:”');
	});
	it('NOTE: a non-Latin key falls back to the example word "name:" (the text says "for example")', () => {
		expect(detail('名前: 1\n名前: 2\n')).toBe(LIMIT_DETAIL.duplicateKey());
	});
});

describe('the cap on aliases inside an anchored collection', () => {
	it('a shared default map with an alias inside, used by 5 000 people, still reads', () => {
		const text = `houses:\n  - &h {id: h, name: H}\nbase: &d {house: *h, born: "1200"}\npeople:\n${mk(5000, (i) => `  - {id: p${i}, name: P${i}, house: h}`)}\nother: *d\n`;
		expect(parseBody(text).ok).toBe(true);
	});

	it('the cap counts each alias once per anchored collection around it', () => {
		// 40 aliases inside two anchored collections count 80 times the nodes of the document (about 200 000 here: 16 million).
		const inner = Array(40).fill('*x').join(', ');
		const small = `x: &x v\na: &a {b: &b [${inner}]}\nc: *a\n`;
		expect(parseBody(small).ok).toBe(true);
		const big = `${small}people:\n${mk(40000, (i) => `  - {id: q${i}, name: Q${i}}`)}\n`;
		const r = parseBody(big);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.detail).toBe(LIMIT_DETAIL.tooLarge);
	});
});
