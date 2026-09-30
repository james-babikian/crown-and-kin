import { describe, expect, it } from 'vitest';
import type { NameLines } from '../../src/render/name-lines';
import * as impl from '../../src/render/name-lines';

// D29 (spec §0, §5.2): in the note preview on an upright phone, a name that does not fit on one
// text line uses two. Contract `NameLines` (src/render/name-lines.ts): one text line if
// `measure(name) <= width`; otherwise two, broken at the last space that lets line 1 fit; line 2
// ends with "…" if it is still too wide; a name with no usable space: line 1 is the widest prefix
// that fits, line 2 the rest (with "…" if needed). Pure. Since M10 (D81) the default is three text lines; these tests pass 2, the D37 result.
//
// How much of line 2 stays before "…" is not fixed beyond "it fits"; these tests accept a line 2
// that fits and could not hold two more characters of the rest (one trailing space may be trimmed).

const nameLines: NameLines = impl.nameLines;
const ELLIPSIS = '…';

/** Every character 10 px wide, the ellipsis too. */
const mono = (text: string) => [...text].length * 10;

/** Narrow and wide letters, as in a proportional font. */
const WIDTHS: Record<string, number> = { i: 4, l: 4, j: 4, ' ': 5, W: 14, M: 14, m: 13, w: 13, [ELLIPSIS]: 12 };
const prop = (text: string) => [...text].reduce((s, c) => s + (WIDTHS[c] ?? 9), 0);

/** Line 2 cut with "…": it fits, it is the start of the rest, and it keeps nearly all that fits. */
function ellipsisProblems(line2: string, rest: string, width: number, measure: (t: string) => number): string[] {
	const bad: string[] = [];
	if (!line2.endsWith(ELLIPSIS)) return [`line 2 "${line2}" does not end with "…"`];
	if (measure(line2) > width) bad.push(`line 2 "${line2}" is ${measure(line2)} wide, more than ${width}`);
	const kept = line2.slice(0, -ELLIPSIS.length);
	if (!rest.startsWith(kept)) bad.push(`line 2 "${line2}" is not the start of the rest "${rest}"`);
	else if (kept.length + 2 <= rest.length && measure(rest.slice(0, kept.length + 2) + ELLIPSIS) <= width) bad.push(`line 2 "${line2}" could keep more of "${rest}"`);
	return bad;
}

describe('one text line when the name fits (D29)', () => {
	it('shorter than the width, and exactly the width', () => {
		expect(nameLines('Aldric Valmont', 200, mono, 2)).toEqual(['Aldric Valmont']);
		expect(nameLines('Aldric Valmont', 140, mono, 2)).toEqual(['Aldric Valmont']);
		expect(nameLines('Wren', 40, mono, 2)).toEqual(['Wren']);
	});
});

describe('two text lines, broken at the last space that lets line 1 fit', () => {
	it('the space goes; both lines fit', () => {
		expect(nameLines('Ser Gareth Orsini the Younger', 170, mono, 2)).toEqual(['Ser Gareth Orsini', 'the Younger']);
		expect(nameLines('Anne Marie de la Tour', 120, mono, 2)).toEqual(['Anne Marie', 'de la Tour']);
		expect(nameLines('Aldric Valmont', 139, mono, 2)).toEqual(['Aldric', 'Valmont']);
	});

	it('the last space that fits, not the first', () => {
		expect(nameLines('Isolde of the Orsini', 130, mono, 2)).toEqual(['Isolde of the', 'Orsini']);
	});

	it('line 2 still too wide: it ends with "…"', () => {
		const [line1, line2, ...more] = nameLines('Ser Gareth Orsini the Younger', 160, mono, 2);
		expect(more).toEqual([]);
		expect(line1).toBe('Ser Gareth');
		expect(ellipsisProblems(line2 ?? '', 'Orsini the Younger', 160, mono)).toEqual([]);
	});
});

describe('no usable space: line 1 is the widest prefix that fits, line 2 the rest', () => {
	it('a name with no space', () => {
		expect(nameLines('Wenceslausberg', 100, mono, 2)).toEqual(['Wenceslaus', 'berg']);
	});

	it('a name whose first word is already too wide', () => {
		const [line1, line2] = nameLines('Maximiliana Valmont', 80, mono, 2);
		expect(line1).toBe('Maximili');
		expect(ellipsisProblems(line2 ?? '', 'ana Valmont', 80, mono)).toEqual([]);
	});

	it('a very long name with no space: "…" on line 2', () => {
		const name = 'Aurelianusmaximilianus';
		const [line1, line2] = nameLines(name, 100, mono, 2);
		expect(line1).toBe('Aurelianus');
		expect(ellipsisProblems(line2 ?? '', 'maximilianus', 100, mono)).toEqual([]);
	});
});

describe('with a proportional measure', () => {
	it('"iiii" is narrow, "WWWW" is wide', () => {
		expect(nameLines('iiii llll', 45, prop, 2)).toEqual(['iiii llll']);
		expect(nameLines('WWWW MMMM', 70, prop, 2)).toEqual(['WWWW', 'MMMM']);
	});

	// The contract, checked on generated names (single spaces between words, widths at least one wide letter).
	it('generated names and widths', () => {
		let seed = 0x9a3e11;
		const rand = (n: number) => {
			seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
			return (seed >>> 8) % n;
		};
		const LETTERS = 'aeiloustnrWMmwjAEIOU';
		for (let k = 0; k < 3000; k++) {
			const words = Array.from({ length: 1 + rand(5) }, () => Array.from({ length: 1 + rand(12) }, () => LETTERS[rand(LETTERS.length)]).join(''));
			const name = words.join(' ');
			const width = 14 + rand(200);
			const at = `${JSON.stringify(name)} in ${width}`;
			const lines = nameLines(name, width, prop, 2);
			if (prop(name) <= width) {
				expect(lines, at).toEqual([name]);
				continue;
			}
			expect(lines.length, at).toBe(2);
			const [line1, line2] = lines as [string, string];
			expect(prop(line1) <= width, `${at}: line 1 "${line1}" is too wide`).toBe(true);
			expect(name.startsWith(line1), `${at}: line 1 "${line1}" is not the start of the name`).toBe(true);
			const spaces = [...name].flatMap((c, i) => (c === ' ' ? [i] : []));
			const fitting = spaces.filter((i) => prop(name.slice(0, i)) <= width);
			let rest: string;
			if (fitting.length) {
				// A space break at the last space that lets line 1 fit.
				expect(line1.length, `${at}: line 1 "${line1}"`).toBe(fitting[fitting.length - 1]);
				rest = name.slice(line1.length + 1);
			} else {
				// No usable space: the widest prefix that fits.
				expect(prop(name.slice(0, line1.length + 1)) > width, `${at}: line 1 "${line1}" is not the widest prefix`).toBe(true);
				rest = name.slice(line1.length);
			}
			if (prop(rest) <= width) expect(line2, at).toBe(rest);
			else expect(ellipsisProblems(line2, rest, width, prop), at).toEqual([]);
		}
	});
});
