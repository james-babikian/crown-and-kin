import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import { applyOp } from '../../src/core/yaml-edit';
import { hardErrorText, LIMIT_DETAIL } from '../../src/core/messages';
import { ALIAS_MARKS_CAP, ALIAS_NODES_BASE, ALIAS_NODES_CEILING, ALIAS_NODES_PER_CHAR, parseBody, parseDynasty } from '../../src/core/parse';
import { timedRatio } from '../support/speed-ref';

/*
 * WP-H2: the limits of the read (spec §8, "nothing may throw"). F1: aliases that write out far more than the text
 * could hold stop at the read. F2: a map with very many keys reads in linear time, and a repeated key is still an
 * error. F3: a nesting so deep that the parser runs out of stack space shows a plain text.
 */

const BASE = 'people:\n  - id: aldric\n    name: Aldric\n';
const rep = (n: number, s: string) => Array(n).fill(s).join(', ');
// Speed limits as a ratio to the reference work of `speed-ref.ts`, measured in the same process, so a busy machine
// does not break them. Measured on the development computer (2026-10-16), alone and under a full parallel test run:
// 40 000 keys 55 to 81 times the reference (1.1 s alone, 2.5 s under load; the old limit was 3 000 ms), 50 000 tiny
// alias uses 20 to 29 times (0.4 s alone, 0.8 s under load; the old limit was 1 000 ms). Each limit is at most 2 times
// the lowest ratio measured, so the code under test 2 times slower fails (checked: 115 to 152 and 42 to 56).
const KEYS_LIMIT = 110;
const TINY_LIMIT = 38;

describe('F1: aliases that expand far beyond the text', () => {
	// 1 000 x 200 x 200 = 4 * 10^7 nodes from a text of about 3 KB.
	const wide = `a: &a [${rep(1000, 'x')}]\nb: &b [${rep(200, '*a')}]\nx: [${rep(200, '*b')}]\n${BASE}`;

	it('a wide bomb is an error with a plain text, and no edit runs', () => {
		const r = parseDynasty(wide);
		expect(r).toEqual({ ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } });
		if (!r.ok) expect(hardErrorText(r.error)).toBe(`The tree text has an error. Correct the text to show the tree. Details: ${LIMIT_DETAIL.tooLarge}`);
		const edit = applyOp(wide, { kind: 'set-person-fields', id: 'aldric', fields: { name: 'Edited' } });
		expect(edit.ok).toBe(false);
	});

	speedTest('a wide bomb stops fast, even with a long text', () => {
		const text = `# ${'x'.repeat(170_000)}\na: &a [${rep(5000, 'x')}]\nb: &b [${rep(400, '*a')}]\nx: [${rep(400, '*b')}]\n${BASE}`;
		const t0 = performance.now();
		expect(parseBody(text).ok).toBe(false);
		expect(performance.now() - t0).toBeLessThan(1000);
	});

	it('the classic bomb is refused with the same plain text', () => {
		let text = `a: &a [${rep(9, '"lol"')}]\n`;
		for (const [i, n] of [...'bcdefghi'].entries()) text += `${n}: &${n} [${rep(9, '*' + 'abcdefgh'[i])}]\n`;
		const r = parseBody(text + BASE);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.detail).toBe(LIMIT_DETAIL.tooLarge);
	});

	it('a house used by every person is allowed (a large tree)', () => {
		const people = Array.from({ length: 2000 }, (_, i) => `  - {id: p${i}, name: P${i}, house: *h}`).join('\n');
		expect(parseBody(`houses:\n  - &h {id: h, name: H, color: "#123456", arms: "[[a.png]]"}\npeople:\n${people}\n`).ok).toBe(true);
	});

	it('a short list used many times is allowed', () => {
		expect(parseBody(`a: &a [${rep(60, 'x')}]\npeople: [${rep(2000, '*a')}]\n`).ok).toBe(true);
	});

	it('the cap is 50 nodes for each character of the text, plus 10 000', () => {
		// A list of 1 000 values used u times writes out 1 004 + 1 001 * u nodes (the map, two keys, two lists, the values).
		const make = (uses: number) => `a: &a [${rep(1000, 'x')}]\nb: [${rep(uses, '*a')}]\n`;
		const fits = (u: number) => parseBody(make(u)).ok;
		let lo = 1;
		let hi = 5000;
		while (hi - lo > 1) {
			const mid = Math.floor((lo + hi) / 2);
			if (fits(mid)) lo = mid;
			else hi = mid;
		}
		const cap = (u: number) => Math.min(ALIAS_NODES_PER_CHAR * make(u).length + ALIAS_NODES_BASE, ALIAS_NODES_CEILING);
		expect(1004 + 1001 * lo).toBeLessThanOrEqual(cap(lo));
		expect(1004 + 1001 * hi).toBeGreaterThan(cap(hi));
		expect(lo).toBeGreaterThan(10);
	});

	it('a long text does not raise the cap above the ceiling of 5 million nodes', () => {
		// 200 KB of text would allow 10 million nodes by the ratio; the ceiling is lower.
		const make = (uses: number) => `# ${'x'.repeat(200_000)}\na: &a [${rep(1000, 'x')}]\nb: [${rep(uses, '*a')}]\n`;
		expect(ALIAS_NODES_PER_CHAR * make(1).length).toBeGreaterThan(ALIAS_NODES_CEILING);
		expect(parseBody(make(4000)).ok).toBe(true);
		expect(parseBody(make(6000)).ok).toBe(false);
	});

	speedTest('1 000 people that share a map of 1 000 keys are allowed, and an edit of it stays fast', () => {
		const shared = Array.from({ length: 1000 }, (_, i) => `k${i}: v${i}`).join(', ');
		const people = Array.from({ length: 1000 }, (_, i) => `  - {id: p${i}, name: P${i}, extra: *b}`).join('\n');
		const text = `base: &b {${shared}}\npeople:\n${people}\n`;
		expect(parseBody(text).ok).toBe(true);
		const t0 = performance.now();
		expect(applyOp(text, { kind: 'set-person-fields', id: 'p1', fields: { name: 'Edited' } }).ok).toBe(true);
		expect(performance.now() - t0).toBeLessThan(3000);
	});

	it('an alias of an anchor inside itself, and of a missing anchor, do not break the count', () => {
		expect(() => parseBody('x: &x [*x]\n')).not.toThrow();
		expect(parseBody('x: *nothing\n').ok).toBe(false);
	});
});

describe('F2: a map with very many keys', () => {
	speedTest(`40 000 keys read and edit in about a second (at most ${KEYS_LIMIT} times the reference work)`, () => {
		const keys = Array.from({ length: 40_000 }, (_, i) => `    k${i}: v${i}`).join('\n');
		const text = `people:\n  - id: aldric\n    name: Aldric\n${keys}\n`;
		const t = timedRatio(() => [parseDynasty(text), applyOp(text, { kind: 'set-person-fields', id: 'aldric', fields: { name: 'Edited' } })] as const, 3);
		console.log(`40 000 keys: ${t.ms.toFixed(0)} ms, reference ${t.refMs.toFixed(1)} ms, ratio ${t.ratio.toFixed(1)}`);
		expect(t.out[0].ok).toBe(true);
		expect(t.out[1].ok).toBe(true);
		expect(t.ratio).toBeLessThan(KEYS_LIMIT);
	}, 120_000);

	it('a repeated key of a block map is an error on the line of the second key', () => {
		expect(parseBody('people: []\nhouses: []\npeople: []\n')).toEqual({ ok: false, error: { code: 'yaml-invalid', line: 3, detail: LIMIT_DETAIL.duplicateKey('people') } });
	});

	it('a repeated key deep in a person, and in a flow map, is an error', () => {
		expect(parseBody('people:\n  - id: a\n    name: A\n    name: B\n')).toMatchObject({ ok: false, error: { line: 4, detail: LIMIT_DETAIL.duplicateKey('name') } });
		expect(parseBody('people:\n  - {id: a, name: A, id: b}\n')).toMatchObject({ ok: false, error: { line: 2, detail: LIMIT_DETAIL.duplicateKey('id') } });
	});

	it('reports the same line as the package did, also for a nested map and for a quoted key', () => {
		expect(parseBody('a:\n  x: 1\n  y: 2\n  x: 3\nb: 1\nb: 2\n')).toMatchObject({ ok: false, error: { line: 4 } });
		expect(parseBody('"a": 1\na: 2\n')).toMatchObject({ ok: false, error: { line: 2, detail: LIMIT_DETAIL.duplicateKey('a') } });
	});

	it('the same key in two different maps is fine', () => {
		expect(parseBody('people:\n  - id: a\n    name: A\n  - id: b\n    name: B\n').ok).toBe(true);
	});

	it('the first problem in the text is the one reported', () => {
		// The repeated key comes before the bad indentation.
		expect(parseBody('a: 1\na: 2\nb: [\n')).toMatchObject({ ok: false, error: { line: 2, detail: LIMIT_DETAIL.duplicateKey('a') } });
		// The bad flow list comes first.
		const r = parseBody('b: [\na: 1\na: 2\n');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.detail).not.toBe(LIMIT_DETAIL.duplicateKey('a'));
	});

	speedTest('10 000 repeated keys are still one error', () => {
		const t0 = performance.now();
		expect(parseBody(Array(10_000).fill('people: []').join('\n') + '\n')).toMatchObject({ ok: false, error: { line: 2 } });
		expect(performance.now() - t0).toBeLessThan(2000);
	});
});

describe('F3: a nesting that overflows the stack', () => {
	for (const depth of [10_000, 100_000]) {
		it(`${depth} flow lists deep show a plain text`, () => {
			const text = `people:\n  - id: aldric\n    name: Aldric\n    notes: ${'['.repeat(depth)}x${']'.repeat(depth)}\n`;
			const r = parseBody(text);
			expect(() => parseDynasty(text)).not.toThrow();
			// A depth that the package reads is allowed; one that it cannot read must give the plain text.
			if (!r.ok) {
				expect(r.error.detail).toBe(LIMIT_DETAIL.tooDeep);
				expect(hardErrorText(r.error)).not.toMatch(/call stack|Maximum/i);
			}
		});
	}

	it('the overflow of the stack always becomes the plain text', () => {
		// 100 000 levels cannot be read by any engine stack, so this case must be an error.
		const r = parseBody(`x: ${'{a: '.repeat(100_000)}x${'}'.repeat(100_000)}\n`);
		expect(r).toMatchObject({ ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooDeep } });
	});
});

describe('the cap of alias uses (the package resolves aliases in quadratic time)', () => {
	const tiny = (uses: number) => `a: &a x\nb: [${rep(uses, '*a')}]\n${BASE}`;

	it('the cap is 12 000 alias uses and anchors together', () => {
		expect(ALIAS_MARKS_CAP).toBe(12_000);
		// One anchor and the uses: 11 999 + 1 fits, one more does not.
		expect(parseBody(tiny(ALIAS_MARKS_CAP - 1)).ok).toBe(true);
		expect(parseBody(tiny(ALIAS_MARKS_CAP))).toEqual({ ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } });
	}, 30_000);

	speedTest(`50 000 uses of a tiny anchor are refused at once (at most ${TINY_LIMIT} times the reference work), with the plain text, and no edit runs`, () => {
		const text = tiny(50_000);
		const t = timedRatio(() => [parseDynasty(text), applyOp(text, { kind: 'set-person-fields', id: 'aldric', fields: { name: 'Edited' } })] as const, 3);
		console.log(`50 000 tiny anchor uses: ${t.ms.toFixed(0)} ms, reference ${t.refMs.toFixed(1)} ms, ratio ${t.ratio.toFixed(1)}`);
		const [r, edit] = t.out;
		expect(t.ratio).toBeLessThan(TINY_LIMIT);
		expect(r).toEqual({ ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooLarge } });
		expect(edit.ok).toBe(false);
	});

	it('anchors count too, so many anchors do not make the search slow', () => {
		const anchors = Array.from({ length: 13_000 }, (_, i) => `&k${i} x`).join(', ');
		expect(parseBody(`a: [${anchors}]\nb: [*k1]\n${BASE}`)).toMatchObject({ ok: false, error: { detail: LIMIT_DETAIL.tooLarge } });
	});

	it('many anchors without any alias are fine', () => {
		const anchors = Array.from({ length: 13_000 }, (_, i) => `&k${i} x`).join(', ');
		expect(parseBody(`a: [${anchors}]\n${BASE}`).ok).toBe(true);
	});

	speedTest('a text just under the cap reads and edits in a few seconds', () => {
		const people = Array.from({ length: 11_900 }, (_, i) => `  - {id: p${i}, name: P${i}, house: *h}`).join('\n');
		const text = `houses:\n  - &h {id: h, name: H}\npeople:\n${people}\n`;
		const t0 = performance.now();
		expect(parseDynasty(text).ok).toBe(true);
		const t1 = performance.now();
		expect(applyOp(text, { kind: 'set-person-fields', id: 'p5', fields: { name: 'Edited' } }).ok).toBe(true);
		const t2 = performance.now();
		// About 1.5 s and 3.2 s on the development computer; the bound leaves room for a loaded computer.
		expect(t1 - t0).toBeLessThan(8000);
		expect(t2 - t1).toBeLessThan(12_000);
	}, 40_000);

	it('7 000 people that share one house read and edit', () => {
		const people = Array.from({ length: 7000 }, (_, i) => `  - {id: p${i}, name: P${i}, house: *h}`).join('\n');
		const text = `houses:\n  - &h {id: h, name: H}\npeople:\n${people}\n`;
		expect(parseDynasty(text).ok).toBe(true);
		expect(applyOp(text, { kind: 'set-person-fields', id: 'p5', fields: { name: 'Edited' } }).ok).toBe(true);
	}, 30_000);
});
