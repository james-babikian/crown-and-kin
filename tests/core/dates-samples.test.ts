/*
 * Step 4.0 of WP-4: the regression on the sample trees (spec §14 rule 11):
 *  - every date text of every sample tree in `fixtures/` reads the same year with a full calendar set as `yearOf` reads it
 *    (no calendar captures an existing plain date), and the trees keep their warnings and their lines;
 *  - `TreeDates` of every sample tree with no calendars equals `yearOf` on every text;
 *  - `TreeDates` is lazy, and `latestYear` and `unanchored` follow their contract (rule 5, `calendar-no-anchor`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { specOf, successionLine } from '../../src/core/succession';
import { yearOf } from '../../src/core/succession-keys';
import { parseDynasty } from '../../src/core/parse';
import {
	FULL_SET,
	graphOf,
	issueCodes,
	LONG_COUNT,
	datesApi,
	names,
	REIGN_NAMES,
	type CalendarDef,
	type DateReaderT,
} from '../dates-support';

/** Every kin block of every sample note, with the file name. */
function sampleBlocks(): { file: string; source: string }[] {
	const out: { file: string; source: string }[] = [];
	for (const file of readdirSync('fixtures').filter((f) => f.endsWith('.md')).sort()) {
		const md = readFileSync(`fixtures/${file}`, 'utf8');
		for (const m of md.matchAll(/^```kin\r?\n([\s\S]*?)^```/gm)) out.push({ file, source: m[1] });
	}
	return out;
}

/** The date texts of a parsed block: born, died, holder from and to, title year. */
function textsOf(source: string): { born: string[]; died: string[]; reign: string[]; year: string[] } | null {
	const parsed = parseDynasty(source);
	if (!parsed.ok) return null;
	const t = { born: [] as string[], died: [] as string[], reign: [] as string[], year: [] as string[] };
	for (const p of parsed.tree.people) {
		if (p.born !== undefined) t.born.push(p.born);
		if (p.died !== undefined) t.died.push(p.died);
	}
	for (const title of parsed.tree.titles ?? []) {
		if (title.year !== undefined) t.year.push(title.year);
		for (const h of title.holders) for (const x of [h.from, h.to]) if (x !== undefined) t.reign.push(x);
	}
	return t;
}

const blocks = sampleBlocks();
const parsedBlocks = blocks.filter((b) => textsOf(b.source) !== null);
const allTexts = [...new Set(parsedBlocks.flatMap((b) => Object.values(textsOf(b.source)!).flat()))];

describe('the sample trees themselves (guard against an empty test)', () => {
	it('§14 r11: the samples give many blocks and many distinct date texts', () => {
		expect(blocks.length).toBeGreaterThanOrEqual(20);
		expect(parsedBlocks.length).toBeGreaterThanOrEqual(20);
		expect(allTexts.length).toBeGreaterThanOrEqual(200);
	});

	it('§14 r8: no sample has BC, a minus year, 0, BP, a dual date or non-ASCII digits (the spike hashes stay)', () => {
		// Sample trees 17 to 19 (version 0.4) hold native digits on purpose; their hashes were recorded with them.
		const old = [...new Set(parsedBlocks.filter((b) => !/^1[789]-/.test(b.file)).flatMap((b) => Object.values(textsOf(b.source)!).flat()))];
		const odd = old.filter((t) => t.trim() === '0' || /B\.?C\.?E?|BP|^\s*[-−]|\d{4}\/\d/i.test(t) || /[^\u0000-]/.test(t.replace(/[−–—   †]/g, '')) && /\p{Nd}/u.test(t.replace(/[0-9]/g, '')));
		expect(odd).toEqual([]);
	});
});

describe('§14 r11: sample trees with a full calendar set', () => {
	const A = datesApi;
	const readers: [string, () => DateReaderT][] = [
		['PLAIN_READER', () => A.PLAIN_READER],
		['a ready reader with no calendars', () => A.compileCalendars([], true)],
		['a reader that is not ready', () => A.compileCalendars(FULL_SET, false)],
		['a full set of calendars', () => A.compileCalendars(FULL_SET, true)],
	];

	for (const [label, make] of readers) {
		it(`§14 r11: every date text of every sample tree reads the same year as yearOf (${label})`, () => {
			const reader = make();
			const wrong: string[] = [];
			for (const text of allTexts) {
				const r = reader.read(text);
				if (r?.year !== yearOf(text) || r?.source === 'calendar' || (r?.warnings.length ?? 0) > 0) wrong.push(text);
			}
			expect(wrong).toEqual([]);
		});
	}

	it('§14 r11: the sample trees keep the same warnings with a full calendar set', () => {
		const full = A.compileCalendars(FULL_SET, true);
		for (const b of parsedBlocks) {
			expect(issueCodes(graphOf(b.source, full)), b.file).toEqual(issueCodes(graphOf(b.source)));
		}
	});

	it('§14 r11: the sample trees keep the same lines of succession with a full calendar set', () => {
		const full = A.compileCalendars(FULL_SET, true);
		let lines = 0;
		for (const b of parsedBlocks) {
			const plain = graphOf(b.source);
			const dated = graphOf(b.source, full);
			plain.titles.forEach((title, i) => {
				const strip = (res: object) => {
					const rest = { ...(res as Record<string, unknown>) };
					delete rest.yearText;
					delete rest.dateWarnings;
					return rest;
				};
				const a = successionLine(plain, title, specOf(title), 5, 110);
				const c = successionLine(dated, dated.titles[i], specOf(dated.titles[i]), 5, 110);
				expect(strip(c), `${b.file} ${title.id}`).toEqual(strip(a));
				lines++;
			});
		}
		expect(lines).toBeGreaterThanOrEqual(5);
	});
});

describe('§14 r9, r11: TreeDates of every sample tree with no calendars equals yearOf', () => {
	const A = datesApi;

	for (const [label, make] of [
		['PLAIN_READER', () => A.PLAIN_READER],
		['a ready reader with no calendars', () => A.compileCalendars([], true)],
	] as [string, () => DateReaderT][]) {
		it(`§14 r11: read() of every born, died, from, to and year text equals yearOf (${label})`, () => {
			let checked = 0;
			for (const b of parsedBlocks) {
				const g = graphOf(b.source);
				const dates = A.buildTreeDates(make(), g.people, g.titles);
				const t = textsOf(b.source)!;
				for (const text of Object.values(t).flat()) {
					expect(dates.read(text)?.year, `${b.file}: ${text}`).toBe(yearOf(text));
					checked++;
				}
				expect(dates.read(undefined)).toBeUndefined();
				expect(dates.ready).toBe(true);
			}
			expect(checked).toBeGreaterThanOrEqual(100);
		});
	}

	it('§14 r9: the graph carries a TreeDates that equals yearOf on its own people, with and without a reader', () => {
		for (const b of parsedBlocks) {
			for (const g of [graphOf(b.source), graphOf(b.source, A.compileCalendars([], true))]) {
				const dates = (g as unknown as { dates?: { read(t: string | undefined): { year?: number } | undefined } }).dates;
				expect(dates, b.file).toBeDefined();
				for (const p of g.people) {
					expect(dates!.read(p.born)?.year, `${b.file} ${p.id} born`).toBe(yearOf(p.born));
					expect(dates!.read(p.died)?.year, `${b.file} ${p.id} died`).toBe(yearOf(p.died));
				}
			}
		}
	});

	it('§14 r9: latestYear is the latest year over born, died, from and to (not the title year), for every sample tree', () => {
		let withYears = 0;
		for (const b of parsedBlocks) {
			const g = graphOf(b.source);
			const t = textsOf(b.source)!;
			const years = [...t.born, ...t.died, ...t.reign].map((x) => yearOf(x)).filter((y): y is number => y !== undefined);
			const dates = A.buildTreeDates(A.PLAIN_READER, g.people, g.titles);
			// Holders that validation dropped are not in g.titles; the written titles are in the tree. Compare on the validated set.
			const kept = [
				...g.people.flatMap((p) => [p.born, p.died]),
				...g.titles.flatMap((title) => title.holders.flatMap((h) => [h.from, h.to])),
			]
				.map((x) => yearOf(x))
				.filter((y): y is number => y !== undefined);
			expect(dates.latestYear(), b.file).toBe(kept.length ? Math.max(...kept) : undefined);
			if (years.length) withYears++;
		}
		expect(withYears).toBeGreaterThanOrEqual(10);
	});

	it('§14 r5: a sample tree has no unanchored calendar when it uses no calendar date', () => {
		const full = A.compileCalendars(FULL_SET, true);
		for (const b of parsedBlocks) {
			const g = graphOf(b.source);
			expect(A.buildTreeDates(full, g.people, g.titles).unanchored(), b.file).toEqual([]);
		}
	});
});

describe('§14 r9: TreeDates is lazy and memoised', () => {
	const A = datesApi;
	const SRC = `people:
  - {id: a, name: A, born: "1100", died: "1180"}
  - {id: b, name: B, born: "c. 1150", parents: [a]}

titles:
  - id: t
    name: T
    year: "1300"
    holders:
      - {person: a, from: "1150", to: "1190"}
`;
	function counting(inner: DateReaderT) {
		const calls = { n: 0 };
		const reader: DateReaderT = {
			get ready() {
				return inner.ready;
			},
			get key() {
				return inner.key;
			},
			get problems() {
				return inner.problems;
			},
			read: (text) => {
				calls.n++;
				return inner.read(text);
			},
		};
		return { reader, calls };
	}

	it('§14 r9: building a TreeDates reads no text', () => {
		const g = graphOf(SRC);
		const { reader, calls } = counting(A.PLAIN_READER);
		const dates = A.buildTreeDates(reader, g.people, g.titles);
		expect(calls.n).toBe(0);
		expect(dates.reader).toBe(reader);
		expect(dates.ready).toBe(true);
	});

	it('§14 r9: latestYear reads once and is then memoised; it leaves out the title year', () => {
		const g = graphOf(SRC);
		const { reader, calls } = counting(A.PLAIN_READER);
		const dates = A.buildTreeDates(reader, g.people, g.titles);
		expect(dates.latestYear()).toBe(1190);
		const after = calls.n;
		expect(after).toBeGreaterThan(0);
		expect(dates.latestYear()).toBe(1190);
		expect(calls.n).toBe(after);
	});

	it('§14 r9: read() passes any text, a draft too, to the reader', () => {
		const g = graphOf(SRC);
		const dates = A.buildTreeDates(A.compileCalendars([REIGN_NAMES], true), g.people, g.titles);
		expect(dates.read('Qinglong Emperor 3')?.year).toBe(132);
		expect(dates.read('Qinglong Emperor 0')?.warnings).toEqual(['calendar-year-zero']);
		expect(dates.read('')?.year).toBeUndefined();
	});

	it('§14 r5: latestYear reads calendar dates as internal years and ignores words that mean no year', () => {
		const src = `people:
  - {id: a, name: A, born: "Aldric 10", died: "Aldric 40"}
  - {id: b, name: B, born: "long ago", died: "false"}

titles:
  - id: t
    name: T
    year: "Aldric 50"
    holders:
      - {person: a, from: "Aldric 20", to: "Aldric 30"}
`;
		const g = graphOf(src);
		const calendars: CalendarDef[] = [{ id: 'R#0#0', name: 'Aldric', note: 'R.md', formats: ['{era} {year}'], kind: { type: 'eras', eras: [{ name: 'Aldric', start: 1100, length: 50 }] } }];
		// died Aldric 40 = 1139; the title year Aldric 50 = 1149 is not counted.
		expect(A.buildTreeDates(A.compileCalendars(calendars, true), g.people, g.titles).latestYear()).toBe(1139);
		// With plain reading no text has a year.
		expect(A.buildTreeDates(A.PLAIN_READER, g.people, g.titles).latestYear()).toBeUndefined();
	});

	it('§14 r5: latestYear is undefined when no text has a year', () => {
		const g = graphOf(`people:\n  - {id: a, name: A, born: "long ago"}\n  - {id: b, name: B}\n`);
		expect(A.buildTreeDates(A.PLAIN_READER, g.people, g.titles).latestYear()).toBeUndefined();
	});
});

describe('§14 r1, r5: calendar-no-anchor from the tree-level facts', () => {
	const A = datesApi;
	const ERA_ONE: CalendarDef = { id: 'E#0#0', name: 'Dawn', note: 'E.md', formats: ['{era} {year}'], kind: { type: 'eras', eras: [{ name: 'Dawn', start: 1 }] } };
	const dated = (people: string, cals: CalendarDef[], ready = true) => {
		const g = graphOf(`people:\n${people}`);
		return A.buildTreeDates(A.compileCalendars(cals, ready), g.people, g.titles).unanchored();
	};
	const who = (list: string[], c: CalendarDef) => list.some((x) => names(x, c));

	it('§14 r1: case 1: a calendar with S = 1 beside a plain year gives calendar-no-anchor', () => {
		const list = dated(`  - {id: a, name: A, born: "Year 5 of Cycle 3"}\n  - {id: b, name: B, born: "1203"}\n`, [LONG_COUNT]);
		expect(list).toHaveLength(1);
		expect(who(list, LONG_COUNT)).toBe(true);
	});

	it('§14 r1: case 2: a calendar with S = 1 that stands alone in its tree gives no calendar-no-anchor', () => {
		expect(dated(`  - {id: a, name: A, born: "Year 5 of Cycle 3"}\n  - {id: b, name: B, died: "Year 9 of Cycle 3"}\n`, [LONG_COUNT])).toEqual([]);
	});

	it('§14 r1: a calendar with a real start (130) beside a plain year gives no calendar-no-anchor', () => {
		expect(dated(`  - {id: a, name: A, born: "Qinglong Emperor 3"}\n  - {id: b, name: B, born: "1203"}\n`, [REIGN_NAMES])).toEqual([]);
	});

	it('§14 r1: a calendar with S = 1 beside a date of another calendar gives calendar-no-anchor for it, not for the other', () => {
		const list = dated(`  - {id: a, name: A, born: "Year 5 of Cycle 3"}\n  - {id: b, name: B, born: "Qinglong Emperor 3"}\n`, [LONG_COUNT, REIGN_NAMES]);
		expect(who(list, LONG_COUNT)).toBe(true);
		expect(who(list, REIGN_NAMES)).toBe(false);
	});

	it('§14 r1: an era calendar whose first era starts at 1 is the same case', () => {
		const list = dated(`  - {id: a, name: A, born: "Dawn 4"}\n  - {id: b, name: B, born: "1203"}\n`, [ERA_ONE]);
		expect(who(list, ERA_ONE)).toBe(true);
	});

	it('§14 r1: a calendar that no date of the tree uses is not reported', () => {
		expect(dated(`  - {id: a, name: A, born: "1203"}\n  - {id: b, name: B, born: "1250"}\n`, [LONG_COUNT])).toEqual([]);
	});

	it('§14 r1: a text with no year does not count as a plain year', () => {
		expect(dated(`  - {id: a, name: A, born: "Year 5 of Cycle 3"}\n  - {id: b, name: B, born: "long ago"}\n`, [LONG_COUNT])).toEqual([]);
	});

	it('§14 r7: while the reader is not ready nothing is reported', () => {
		expect(dated(`  - {id: a, name: A, born: "Year 5 of Cycle 3"}\n  - {id: b, name: B, born: "1203"}\n`, [LONG_COUNT], false)).toEqual([]);
	});
});
