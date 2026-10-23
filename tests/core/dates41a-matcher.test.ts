// Step 4.1a of WP-4: unit tests of `src/core/dates.ts` and `readPlain` (my own cases; the acceptance table of step 4.0 is in
// `tests/dates-*.test.ts`). Spec §14 rules 3 to 5 and 8 to 9, the architecture notes §5.7.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildTreeDates,
	checkCalendars,
	checkFormat,
	compileCalendars,
	exampleText,
	formatInternalYear,
	MEMO_CAP,
	PLAIN_READER,
	startFromSameYear,
	type Calendar,
} from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { lineSubgraph } from '../../src/core/relations';
import { readPlain, yearOf } from '../../src/core/succession-keys';
import type { Person } from '../../src/core/types';

const cycles = (name: string, formats: string[], length = 60, start = 1, note = 'C.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'cycles', length, start } });
const eras = (name: string, list: { name: string; start: number; length?: number }[], formats = ['{era} {year}'], note = 'C.md'): Calendar => ({ id: `${note}#0#0`, name, note, formats, kind: { type: 'eras', eras: list } });
const year = (cals: Calendar[], text: string) => compileCalendars(cals, true).read(text)?.year;

describe('number places (§14 rule 4)', () => {
	const C = cycles('C', ['y{year} c{cycle}']);
	const rows: [string, number | undefined][] = [
		// Digits, ordinals with any of st/nd/rd/th, words 1 to 99 with a hyphen or a space, Roman numerals in either case.
		['y1 c1', 1],
		['y2 c1', 2],
		['y1st c2nd', 61],
		['y3rd c4th', 3 + 180],
		['yone cone', 1],
		['ythirty-three cone', 33],
		['ythirty three cone', 33],
		['ytwenty-first cone', 21],
		['ytwenty first cone', 21],
		['yninety-ninth cone', 99],
		['yeleventh ctwelfth', 11 + 11 * 60],
		['yXIV cMMXXIV', 14 + 2023 * 60],
		['yxiv cmmxxiv', 14 + 2023 * 60],
		// Not values: zero and one hundred as words, a Roman numeral that is not in the form, a Roman numeral above 3999.
		['yzero c1', undefined],
		['yone hundred c1', undefined],
		['yiiii c1', undefined],
		['yiix c1', undefined],
		['y1 cMMMM', undefined],
		// A digit run of 16 digits is no value.
		['y1 c1234567890123456', undefined],
	];
	for (const [text, want] of rows) {
		it(`${JSON.stringify(text)} is ${want ?? 'no year'}`, () => {
			expect(year([C], text)).toBe(want);
		});
	}

	it('MMMCMXCIX is 3999 and the cycle formula holds for it', () => {
		expect(year([C], 'y1 cMMMCMXCIX')).toBe(1 + 3998 * 60);
	});

	it('backtracks over the number forms: "twenty one" is one value or two', () => {
		const two = cycles('Two', ['{year} {cycle}']);
		expect(year([two], 'twenty one')).toBe(1 + 0 * 60 + 19);
		// The longest reading first: year twenty-one, cycle two (1 + 60 + 20).
		expect(year([two], 'twenty one two')).toBe(81);
	});
});

describe('where a match may stand (§14 rule 4)', () => {
	const C = cycles('C', ['year {year} of cycle {cycle}']);
	it('folds case and white space in the text and in the format', () => {
		const f = cycles('F', ['  YEAR   {Year}\tOF cycle {CYCLE} ']);
		expect(year([f], 'Year 5\n of  CYCLE 3')).toBe(125);
	});
	it('a letter, a digit or a mark may not touch either end', () => {
		for (const text of ['xyear 5 of cycle 3', 'year 5 of cycle 3x', '1year 5 of cycle 3', 'year 5 of cycle 33a', 'year 5 of cycle 3́']) expect(year([C], text), text).toBeUndefined();
		for (const text of ['(year 5 of cycle 3)', 'year 5 of cycle 3.', 'died year 5 of cycle 3, buried', 'x - year 5 of cycle 3']) expect(year([C], text), text).toBe(125);
	});
	it('a match beside an astral letter is refused too', () => {
		expect(year([C], '\u{1d4d0}year 5 of cycle 3')).toBeUndefined();
	});
	it('the first match in text order wins, not the smaller year', () => {
		expect(year([C], 'year 9 of cycle 3 or year 1 of cycle 1')).toBe(129);
	});
	it('an ordinal suffix after digits is part of the value', () => {
		const f = cycles('F', ['{year} yr {cycle} cyc']);
		expect(year([f], '21st yr 3rd cyc')).toBe(141);
		expect(year([f], '21 yr 3 cyc')).toBe(141);
	});
	it('the era place has no word-boundary of its own inside a format (CJK style)', () => {
		const j = eras('J', [{ name: '昭和', start: 1926 }], ['{era}{year}年']);
		expect(year([j], '昭和64年')).toBe(1989);
	});
});

describe('prefixes that make a match approximate (§14 rule 4)', () => {
	const C = cycles('C', ['year {year} of cycle {cycle}']);
	const approx = (text: string) => compileCalendars([C], true).read(text)?.approx;
	it('c., ca., about, circa and ~ set approx, whatever the case', () => {
		// ruling WP-4.1a G2: 'c.' and 'ca.' count only when a space or a digit follows, so 'c.' and 'ca.' with a letter next are no longer in this list.
		for (const p of ['c. ', 'C. ', 'ca. ', 'Ca. ', 'about ', 'ABOUT ', 'circa ', '~', '~ ', 'born c. ', 'born, about ']) expect(approx(`${p}year 5 of cycle 3`), p).toBe(true);
	});
	it('a prefix inside a longer word does not count', () => {
		for (const p of ['abc. ', 'xabout ', 'forcirca ', '']) expect(approx(`${p}year 5 of cycle 3`), p).toBeUndefined();
	});
});

describe('two calendars, two matches (§14 rule 4)', () => {
	const A = cycles('A', ['year {year} of cycle {cycle}'], 60, 1, 'A.md');
	const B = cycles('B', ['year {year} of cycle {cycle}'], 60, 1, 'B.md');
	const B2 = cycles('B2', ['year {year} of cycle {cycle}'], 60, 2, 'B.md');
	const D = cycles('D', ['year {year} of cycle {cycle}'], 60, 3, 'D.md');
	it('same year: the first calendar is named and the others are in also', () => {
		const r = compileCalendars([A, B], true).read('year 5 of cycle 3')!;
		expect(r).toMatchObject({ year: 125, source: 'calendar', calendar: 'A', also: ['B'], span: 'Cycle 3', count: 5, warnings: [] });
	});
	it('different years: no year, fits-two-calendars, source stays calendar (the architecture notes §5.7 ruling 1)', () => {
		const r = compileCalendars([A, B2, D], true).read('year 5 of cycle 3')!;
		expect(r.year).toBeUndefined();
		expect(r).toMatchObject({ source: 'calendar', calendar: 'A', also: ['B2', 'D'], warnings: ['fits-two-calendars'] });
		expect(r.samePlace).toBeUndefined();
	});
	it('the order of the calendars decides which is named first, not the year', () => {
		expect(compileCalendars([B, A], true).read('year 5 of cycle 3')!.calendar).toBe('B');
	});
	it('two calendars that match at different places: the first place wins and no warning is made', () => {
		const E = eras('E', [{ name: 'Dawn', start: 500 }]);
		const r = compileCalendars([A, E], true).read('Dawn 2, year 5 of cycle 3')!;
		expect(r).toMatchObject({ year: 501, calendar: 'E', warnings: [] });
		expect(r.also).toBeUndefined();
	});
	it('two matches that start at the same character with different years: samePlace, no year, no warning', () => {
		const S = cycles('S', ['{year} {cycle}', '{cycle} {year}']);
		const r = compileCalendars([S], true).read('1 2')!;
		expect(r).toMatchObject({ source: 'calendar', samePlace: true, warnings: [] });
		expect(r.year).toBeUndefined();
	});
	it('matches that start at different characters are not the same place', () => {
		const S = cycles('S', ['{year} {cycle}', 'z {year} {cycle}']);
		expect(compileCalendars([S], true).read('1 2')?.year).toBe(61);
		expect(compileCalendars([S], true).read('z 1 2')?.year).toBe(61);
		// "x" is the Roman numeral 10, so here both formats start at the same character.
		const T = cycles('T', ['{year} {cycle}', 'x {year} {cycle}']);
		expect(compileCalendars([T], true).read('x 1 2')?.samePlace).toBe(true);
	});
});

describe('the year and its warnings (§14 rule 5)', () => {
	it('an era with a length warns past its end and an era with none does not', () => {
		const E = eras('E', [{ name: 'Short', start: 100, length: 3 }, { name: 'Open', start: 200 }]);
		const read = (t: string) => compileCalendars([E], true).read(t)!;
		expect(read('Short 3').warnings).toEqual([]);
		expect(read('Short 4')).toMatchObject({ year: 103, warnings: ['calendar-year-past-end'] });
		expect(read('Open 400')).toMatchObject({ year: 599, warnings: [] });
		expect(read('Short 0')).toMatchObject({ year: 99, warnings: ['calendar-year-zero'], span: 'Short', count: 0 });
	});
	it('a cycle calendar counts on past its end', () => {
		expect(compileCalendars([cycles('C', ['{year}/{cycle}'], 12)], true).read('13/1')).toMatchObject({ year: 13, warnings: ['calendar-year-past-end'] });
	});
	it('a result that is not a safe whole number is no match', () => {
		const E = eras('E', [{ name: 'Far', start: Number.MAX_SAFE_INTEGER }]);
		expect(year([E], 'Far 5')).toBeUndefined();
	});
	it('an era name alone and a range give what the rules say', () => {
		const E = eras('E', [{ name: 'Q', start: 130 }]);
		expect(year([E], 'late in the Q era')).toBeUndefined();
		expect(year([E], 'between Q 3 and 5')).toBe(132);
	});
	it('a text that fits no format reads as the plain reader does, source plain or none', () => {
		const r = compileCalendars([cycles('C', ['year {year} of cycle {cycle}'])], true);
		expect(r.read('c. 1203')).toMatchObject({ year: 1203, source: 'plain', approx: true });
		expect(r.read('long ago')).toMatchObject({ source: 'none', warnings: [] });
		expect(r.read('')).toMatchObject({ source: 'none' });
		expect(r.read(undefined)).toBeUndefined();
	});
});

describe('bad input never throws', () => {
	it('a calendar that cannot read is left out; the others still read', () => {
		const bad = [
			cycles('Zero', ['y{year} c{cycle}'], 0),
			cycles('Frac', ['y{year} c{cycle}'], 1.5),
			cycles('NaN', ['y{year} c{cycle}'], 60, Number.NaN),
			{ id: 'x', name: 'Odd', note: 'n', formats: ['{era} {year}'], kind: { type: 'weeks' } } as unknown as Calendar,
			cycles('NoFormat', ['no places', '{year}', '{year} {year} {cycle}', '{year} {cycle} {era}']),
			eras('BadEras', [{ name: '', start: 5 }, { name: 'Nope', start: 1.5 }, { name: 'Len', start: 5, length: 0 }]),
		];
		const good = eras('Good', [{ name: 'Dawn', start: 10 }]);
		const reader = compileCalendars([...bad, good], true);
		expect(reader.read('y1 c1')).toMatchObject({ source: 'none' });
		expect(reader.read('Dawn 2')?.year).toBe(11);
		expect(reader.read('Nope 1')?.year).toBeUndefined();
	});
	it('the helpers take odd text', () => {
		expect(checkFormat('cycles', undefined as unknown as string)).not.toBeNull();
		expect(exampleText(cycles('C', []), 5)).toBeNull();
		expect(exampleText(eras('E', [{ name: 'X', start: 1 }], ['no places']), 5)).toBeNull();
	});
});

describe('the memo and the key (§14 rule 9)', () => {
	const C = cycles('C', ['year {year} of cycle {cycle}']);
	it('the same text gives the same object until the memo holds 20 000 texts, then it is cleared', () => {
		// Spec §14 rule 15: the cap went from 5 000 to 20 000 texts.
		expect(MEMO_CAP).toBe(20000);
		const reader = compileCalendars([C], true);
		const first = reader.read('year 1 of cycle 1')!;
		expect(reader.read('year 1 of cycle 1')).toBe(first);
		for (let n = 2; n <= MEMO_CAP; n++) reader.read(`year ${n} of cycle 1`);
		// 19 999 other texts: the first is still there.
		expect(reader.read('year 1 of cycle 1')).toBe(first);
		reader.read(`year ${MEMO_CAP + 1} of cycle 1`);
		expect(reader.read('year 1 of cycle 1')).not.toBe(first);
		expect(reader.read('year 1 of cycle 1')).toEqual(first);
	});
	it('PLAIN_READER keeps no memo and is the key "plain"', () => {
		expect(PLAIN_READER.read('1203')).not.toBe(PLAIN_READER.read('1203'));
		expect(PLAIN_READER).toMatchObject({ ready: true, key: 'plain', problems: [] });
	});
	it('pending, plain, and a hash that follows the content and the problems and not the order, the id or the note', () => {
		expect(compileCalendars([C], false).key).toBe('pending');
		expect(compileCalendars([C], false, [{ key: 'calendar-note-missing' }]).key).toBe('pending');
		expect(compileCalendars([], true).key).toBe('plain');
		const E = eras('E', [{ name: 'Dawn', start: 10 }]);
		const key = compileCalendars([C, E], true).key;
		expect(key).not.toMatch(/^(plain|pending)$/);
		expect(compileCalendars([E, C], true).key).toBe(key);
		expect(compileCalendars([{ ...C, id: 'other#9#9', note: 'Moved.md' }, E], true).key).toBe(key);
		expect(compileCalendars([{ ...C, name: 'Renamed' }, E], true).key).not.toBe(key);
		expect(compileCalendars([C, eras('E', [{ name: 'Dawn', start: 11 }])], true).key).not.toBe(key);
		expect(compileCalendars([C, E], true, [{ key: 'calendar-note-missing', note: 'a' }]).key).not.toBe(key);
		const missing = compileCalendars([], true, [{ key: 'calendar-note-missing', note: 'Gone' }]);
		expect(missing.key).not.toMatch(/^(plain|pending)$/);
		expect(missing.problems).toEqual([{ key: 'calendar-note-missing', note: 'Gone' }]);
	});
	it('a not-ready reader reads plain years only', () => {
		const r = compileCalendars([C], false);
		expect(r.ready).toBe(false);
		expect(r.read('year 5 of cycle 3')).toMatchObject({ source: 'none', warnings: [] });
		expect(r.read('1203')?.year).toBe(1203);
	});
});

describe('readPlain (the architecture notes §5.7; years as yearOf reads them today)', () => {
	it('gives the year of yearOf for any text', () => {
		for (const t of ['1203', '12 May 1203', '200 BC', '-200', '0', '1,250', '1.250', 'c. 1203', '1700/01', '1203/05/12', 'long ago', '', undefined]) expect(readPlain(t).year, String(t)).toBe(yearOf(t));
		expect(readPlain(undefined)).toEqual({});
	});
	it('approx: c., ca., ~, about, circa at the start', () => {
		for (const t of ['c. 1203', 'ca. 1203', 'CA.1203', '~1203', 'about 1203', 'Circa 1203', '  c. 1203']) expect(readPlain(t).approx, t).toBe(true);
		for (const t of ['1203', 'abc. 1203', 'aboutish 1203', 'born 1203']) expect(readPlain(t).approx, t).toBeUndefined();
		expect(readPlain('c. long ago')).toEqual({});
	});
	it('dual: the part after the slash is the last one or two digits of the next year', () => {
		for (const t of ['1700/01', '1700/1', '1799/00', '1709/10', 'March 1700/01', 'c. 1700/01']) expect(readPlain(t).dual, t).toBe(true);
		for (const t of ['1700/05', '1700/02', '1203/05/12', '1203/04/12', '12/05/1203', '1700/001', '1650 or 1700/01']) expect(readPlain(t).dual, t).toBeUndefined();
		// §14 rule 8 (0.3.2): a dual date reads the later year (a flag only at step 4.1a, when the year stayed the first one).
		expect(readPlain('1700/01').year).toBe(1701);
	});
});

describe('the rules of the Calendars window (§14 rules 1, 3, 6)', () => {
	it('checkFormat keys: one for each kind', () => {
		expect(checkFormat('cycles', '{year} {era}')).toBe('calendar-format-cycle');
		expect(checkFormat('eras', '{year} {cycle}')).toBe('calendar-format-era');
		expect(checkFormat('eras', '{YEAR} of {Era}')).toBeNull();
		expect(checkFormat('eras', '{year} {era} {')).not.toBeNull();
		expect(checkFormat('eras', '{year} {era} }')).not.toBeNull();
	});
	it('checkCalendars: the keys and the other calendar', () => {
		const a = cycles('A', ['Year {year} of Cycle {cycle}']);
		const b = cycles('B', ['year {year}  of cycle {cycle}']);
		expect(checkCalendars([a, b])).toEqual([{ calendar: 'B', key: 'calendar-format-duplicate', other: 'A' }]);
		expect(checkCalendars([a, eras('E', [{ name: 'X', start: 1 }, { name: 'x', start: 5 }])])).toEqual([{ calendar: 'E', key: 'calendar-era-duplicate' }]);
		expect(checkCalendars([eras('E1', [{ name: 'X', start: 1 }]), eras('E2', [{ name: 'x ', start: 5 }])])).toEqual([{ calendar: 'E2', key: 'calendar-era-duplicate', other: 'E1' }]);
		expect(checkCalendars([cycles('Z', ['{year}'], 0)]).map((r) => r.key).sort()).toEqual(['calendar-format-cycle', 'calendar-length']);
		expect(checkCalendars([cycles('Half', ['{year} {cycle}'], 2.5)])).toEqual([{ calendar: 'Half', key: 'calendar-length' }]);
		// A cycle format and an era name never clash, and two era calendars may share a format.
		expect(checkCalendars([a, eras('Year', [{ name: 'Year {year} of Cycle {cycle}', start: 1 }])])).toEqual([]);
	});
	it('startFromSameYear and exampleText read back each other', () => {
		const L = 12;
		for (const [cycle, y, other] of [[1, 1, 1], [3, 5, -40], [0, 12, 100], [7, 1, 1000]] as const) {
			const s = startFromSameYear({ cycle, year: y }, other, L);
			const cal = cycles('C', ['y{year}c{cycle}'], L, s);
			expect(exampleText(cal, other)).toBe(`y${y}c${cycle}`);
			expect(year([cal], `y${y}c${cycle}`)).toBe(other);
		}
	});
	it('exampleText: null before cycle 0, before the first era and in a gap; the first era that holds the year; the first format as written', () => {
		const C = cycles('C', ['{Year} / {Cycle}'], 10, 1);
		expect(exampleText(C, -9)).toBe('1 / 0');
		expect(exampleText(C, -10)).toBeNull();
		const J = eras('J', [{ name: 'Shōwa', start: 1926, length: 64 }, { name: 'Heisei', start: 1989 }], ['{era}-{year}']);
		expect(exampleText(J, 1989)).toBe('Shōwa-64');
		expect(exampleText(J, 1990)).toBe('Heisei-2');
		expect(exampleText(J, 1925)).toBeNull();
		expect(exampleText(eras('E', [{ name: '$&', start: 1 }], ['{era} {year}']), 1)).toBe('$& 1');
	});
	it('formatInternalYear uses U+2212', () => {
		expect(formatInternalYear(-12)).toBe('year −12');
		expect(formatInternalYear(0)).toBe('year 0');
	});
});

describe('TreeDates (§14 rule 9)', () => {
	const person = (p: Partial<Person> & { id: string }): Person => ({ name: p.id, parents: [], illegitimate: false, index: 0, ...p });
	it('latestYear is lazy, memoised, over born, died and holder dates and not the title year', () => {
		let reads = 0;
		const reader = { ...PLAIN_READER, read: (t: string | undefined) => (reads++, PLAIN_READER.read(t)) };
		const titles = [{ id: 't', name: 'T', plural: 'T', index: 0, items: 1, year: '1500', holders: [{ index: 0, from: '1250', to: '1290' }] }];
		const dates = buildTreeDates(reader, [person({ id: 'a', born: '1200', died: '1260' })], titles);
		expect(reads).toBe(0);
		expect(dates.latestYear()).toBe(1290);
		const n = reads;
		expect(dates.latestYear()).toBe(1290);
		expect(reads).toBe(n);
	});
	it('unanchored: S = 1 beside a plain year, beside another calendar, or alone; the title year counts as a date', () => {
		const C = cycles('Cyc', ['year {year} of cycle {cycle}']);
		const E = eras('Dawn era', [{ name: 'Dawn', start: 1 }, { name: 'Dusk', start: 50 }]);
		const R = eras('Real', [{ name: 'Real', start: 300 }]);
		const names = (cals: Calendar[], people: Partial<Person>[], year?: string) =>
			buildTreeDates(compileCalendars(cals, true), people.map((p, i) => person({ id: `p${i}`, index: i, ...p })), year ? [{ id: 't', name: 'T', plural: 'T', index: 0, items: 0, year, holders: [] }] : []).unanchored();
		expect(names([C], [{ born: 'year 5 of cycle 3' }, { born: '1203' }])).toEqual(['Cyc']);
		expect(names([C], [{ born: 'year 5 of cycle 3' }, { died: 'year 9 of cycle 3' }])).toEqual([]);
		expect(names([C, R], [{ born: 'year 5 of cycle 3' }, { born: 'Real 3' }])).toEqual(['Cyc']);
		expect(names([C, E], [{ born: 'year 5 of cycle 3' }, { born: 'Dawn 3' }])).toEqual(['Cyc', 'Dawn era']);
		// The flag belongs to the calendar (its first era starts at 1), not to the era that the date names.
		expect(names([E], [{ born: 'Dusk 3' }, { born: '1203' }])).toEqual(['Dawn era']);
		expect(names([C], [{ born: 'year 5 of cycle 3' }], '1300')).toEqual(['Cyc']);
		expect(names([C], [{ born: 'year 5 of cycle 3' }, { born: 'long ago' }])).toEqual([]);
	});
	it('a reader that wraps another one still finds the unanchored calendars', () => {
		const inner = compileCalendars([cycles('Cyc', ['year {year} of cycle {cycle}'])], true);
		const wrapper = { ready: true, key: inner.key, problems: [], hasLists: inner.hasLists, read: (t: string | undefined) => inner.read(t) };
		const dates = buildTreeDates(wrapper, [person({ id: 'a', born: 'year 5 of cycle 3' }), person({ id: 'b', born: '1203' })], []);
		expect(dates.unanchored()).toEqual(['Cyc']);
	});
});

describe('the sample trees (§14 rules 9 and 11)', () => {
	const trees = readdirSync('fixtures')
		.filter((f) => f.endsWith('.md'))
		.flatMap((file) => [...readFileSync(`fixtures/${file}`, 'utf8').matchAll(/^```kin\r?\n([\s\S]*?)^```/gm)].map((m) => ({ file, source: m[1] })))
		.flatMap((b) => {
			const parsed = parseDynasty(b.source);
			return parsed.ok ? [{ file: b.file, tree: parsed.tree }] : [];
		});

	// The latest year as succession.ts computes it before this step.
	const latestToday = (g: ReturnType<typeof deriveFamilies>) => {
		let latest: number | undefined;
		const see = (text: string | undefined) => {
			const y = yearOf(text);
			if (y !== undefined && (latest === undefined || y > latest)) latest = y;
		};
		for (const p of g.people) {
			see(p.born);
			see(p.died);
		}
		for (const t of g.titles) {
			for (const h of t.holders) {
				see(h.from);
				see(h.to);
			}
		}
		return latest;
	};

	it('there are many trees', () => {
		expect(trees.length).toBeGreaterThanOrEqual(20);
	});

	it('g.dates reads every date text as yearOf does, and latestYear is the number of today', () => {
		let texts = 0;
		let withLatest = 0;
		for (const { file, tree } of trees) {
			const g = deriveFamilies(tree);
			expect(g.dates.reader, file).toBe(PLAIN_READER);
			const all = [...tree.people.flatMap((p) => [p.born, p.died]), ...(tree.titles ?? []).flatMap((title) => [title.year, ...title.holders.flatMap((h) => [h.from, h.to])])];
			for (const t of all) {
				if (t === undefined) continue;
				expect(g.dates.read(t)?.year, `${file} ${t}`).toBe(yearOf(t));
				texts++;
			}
			expect(g.dates.latestYear(), file).toBe(latestToday(g));
			if (latestToday(g) !== undefined) withLatest++;
			expect(g.dates.unanchored(), file).toEqual([]);
		}
		expect(texts).toBeGreaterThan(300);
		expect(withLatest).toBeGreaterThan(5);
	});

	it('a ready reader with no calendars changes nothing', () => {
		const reader = compileCalendars([], true);
		for (const { file, tree } of trees) {
			const g = deriveFamilies(tree, { dates: reader });
			expect(g.dates.reader, file).toBe(reader);
			expect(g.dates.latestYear(), file).toBe(latestToday(g));
		}
	});

	it('lineSubgraph gives the small tree the dates of the whole tree', () => {
		const parsed = parseDynasty('people:\n  - {id: a, name: A, born: "1200"}\n  - {id: b, name: B, born: "1230", parents: [a]}\n');
		if (!parsed.ok) throw new Error('parse');
		const reader = compileCalendars([cycles('C', ['year {year} of cycle {cycle}'])], true);
		const g = deriveFamilies(parsed.tree, { dates: reader });
		const sub = lineSubgraph(g, { people: ['a', 'b'], links: [{ parent: 'a', child: 'b', type: 'birth' }], unions: [] } as never);
		expect(sub.dates).toBe(g.dates);
	});
});
