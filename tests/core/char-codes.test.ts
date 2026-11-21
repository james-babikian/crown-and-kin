import { describe, expect, it } from 'vitest';
import { allUnitsAtMost, dropUnits } from '../../src/core/char-codes';
import { foldForId, foldForMatch } from '../../src/core/fold';
import { yearOf } from '../../src/core/succession-keys';
import { noteName } from '../../src/core/titles';

const ch = (c: number) => String.fromCharCode(c);

describe('allUnitsAtMost', () => {
	it('accepts an empty text and the limit itself', () => {
		expect(allUnitsAtMost('', 0x7f)).toBe(true);
		expect(allUnitsAtMost(ch(0) + ch(0x7f), 0x7f)).toBe(true);
	});
	it('rejects a unit above the limit, also a surrogate half', () => {
		expect(allUnitsAtMost(ch(0x80), 0x7f)).toBe(false);
		expect(allUnitsAtMost('a\u{1F600}', 0x7f)).toBe(false);
	});
	it('rejects an excepted unit', () => {
		expect(allUnitsAtMost('a`b', 0x7f, [0x60])).toBe(false);
		expect(allUnitsAtMost('a_b' + ch(0x61), 0x7f, [0x60])).toBe(true);
	});
});

describe('dropUnits', () => {
	it('drops by the test and keeps the rest in order', () => {
		expect(dropUnits('a1b2', (c) => c >= 0x30 && c <= 0x39)).toBe('ab');
		expect(dropUnits('', () => true)).toBe('');
	});
});

describe('fold, plain ASCII path (U+0060 is a quote look-alike)', () => {
	it('folds the grave sign to an apostrophe in an id and a search', () => {
		expect(foldForMatch("d`arc")).toBe("d'arc");
		expect(foldForMatch("D'ARC")).toBe("d'arc");
		expect(foldForId('A`B')).toBe("a'b");
	});
	it('lower-cases plain ASCII with control characters and U+007F unchanged', () => {
		expect(foldForMatch('AB' + ch(0) + ch(0x1f) + ch(0x7f))).toBe('ab' + ch(0) + ch(0x1f) + ch(0x7f));
	});
	it('folds the characters next to the grave sign as plain ASCII', () => {
		expect(foldForMatch(ch(0x5f) + ch(0x61))).toBe('_a');
	});
	it('folds non-ASCII text', () => {
		expect(foldForMatch('Éloïse')).toBe('eloise');
		expect(foldForMatch(ch(0x80) + 'A')).toBe(ch(0x80) + 'a');
	});
});

describe('yearOf, non-ASCII digits', () => {
	it('reads ASCII, Arabic-Indic and fullwidth digits as the same year', () => {
		expect(yearOf('624')).toBe(624);
		expect(yearOf('٦٢٤')).toBe(624);
		expect(yearOf('１２５０')).toBe(1250);
	});
	it('reads the highest ASCII code point as ASCII text', () => {
		expect(yearOf('624' + ch(0x7f))).toBe(yearOf('624'));
	});
});

describe('noteName, control characters', () => {
	it('removes each control character below tab, and from U+000E to U+001F', () => {
		for (const c of [0, 1, 7, 8, 0x0e, 0x10, 0x1f, 0x7f]) expect(noteName(`a${ch(c)}b`, 'x')).toBe('ab');
	});
	it('turns tab, line feed, vertical tab, form feed and carriage return into one space', () => {
		for (const c of [9, 10, 11, 12, 13]) expect(noteName(`a${ch(c)}b`, 'x')).toBe('a b');
	});
	it('keeps the characters next to the control ranges', () => {
		expect(noteName('a' + ch(0x20) + ch(0x80) + 'b', 'x')).toBe('a ' + ch(0x80) + 'b');
	});
	it('uses the fallback when only control characters remain', () => {
		expect(noteName(ch(1) + ch(0x7f), 'fallback')).toBe('fallback');
	});
});
