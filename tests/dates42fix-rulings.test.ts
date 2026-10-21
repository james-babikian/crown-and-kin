// Fix round of step 4.2 (the decision notes "WP-4.2 built", rulings 1, 2, 3 and 6): the scope and the single copy of the tree date warnings,
// a date that fits two calendars, the notes while the calendars are not ready, and `calendar-no-anchor` in the line.
import { describe, expect, it } from 'vitest';
import { compileCalendars } from '../src/core/dates';
import { issueText } from '../src/core/messages';
import { specOf, successionLine } from '../src/core/succession';
import { ALDRIC, LONG_COUNT, copyOf, graphOf, lineOf, notesOf, warningsOf } from './dates-support';

const READY = () => compileCalendars([ALDRIC], true);
const NOT_READY = () => compileCalendars([ALDRIC], false);
const zeros = (src: string, reader = READY()) => graphOf(src, reader).issues.filter((i) => i.code === 'year-zero').map((i) => i.ids?.[0] ?? String(i.params.title));

/** Gran has two sons: Dad (father of the holder Rolf) and Uncle (father of Cousin). Zed is kin of no one. Ward is a ward of Rolf. */
const KIN = (rule: string, extra = '') => `people:
  - {id: gran, name: Gran, sex: m, born: "0"}
  - {id: dad, name: Dad, sex: m, born: 960, parents: [gran]}
  - {id: uncle, name: Uncle, sex: m, born: 962, parents: [gran]}
  - {id: rolf, name: Rolf, sex: m, born: 1000, parents: [dad]}
  - {id: cousin, name: Cousin, sex: m, born: "0", parents: [uncle]}
  - {id: zed, name: Zed, sex: m, born: "0"}
  - {id: ward, name: Ward, sex: m, born: "0", parents: [{id: rolf, type: ward}]}
titles:
  - id: crown
    name: Crown
${rule}    year: "1100"
    holders:
      - {person: rolf}
${extra}`;

describe('ruling 1: the scope of the tree date warnings', () => {
	it('takes the holders, their ancestors and every descendant of those ancestors, and no one else', () => {
		const ids = zeros(KIN('    succession: eldest-child\n'));
		// Gran (an ancestor) and Cousin (a descendant of an ancestor) are in the scope; Zed is kin of no one; a ward is no descent.
		expect(ids.sort()).toEqual(['cousin', 'gran']);
	});

	it('a named heir counts like a holder, and a title with no rule and no heir adds nothing', () => {
		const heirOnly = `people:
  - {id: a, name: A, sex: m, born: 900}
  - {id: b, name: B, sex: m, born: "0", parents: [a]}
  - {id: c, name: C, sex: m, born: 1000, parents: [a]}
  - {id: z, name: Z, sex: m, born: "0"}
titles:
  - id: t
    name: T
    heir: [c]
    year: "1100"
    holders:
      - {person: z}
`;
		// B is a brother of the named heir C: the line can read it. Z holds the title: its own date shows once.
		expect(zeros(heirOnly).sort()).toEqual(['b', 'z']);
		expect(zeros(KIN(''))).toEqual([]);
	});

	it('one date gives one warning, however many titles reach the person', () => {
		const extra = `  - id: duchy
    name: Duchy
    succession: eldest-child
    year: "1100"
    holders:
      - {person: rolf}
  - id: march
    name: March
    heir: [dad]
    year: "1100"
    holders:
      - {person: uncle}
`;
		expect(zeros(KIN('    succession: eldest-child\n', extra)).sort()).toEqual(['cousin', 'gran']);
	});

	it('the title year still gives one warning for each title', () => {
		const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
titles:
  - {id: a, name: Alpha, succession: eldest-child, year: "0", holders: [{person: r}]}
  - {id: b, name: Beta, succession: eldest-child, year: "0", holders: [{person: r}]}
`;
		expect(zeros(src)).toEqual(['Alpha', 'Beta']);
	});

	it('covers every person that the line shows with a warning', () => {
		const g = graphOf(KIN('    succession: siblings-first\n'), READY());
		const line = successionLine(g, g.titles[0], specOf(g.titles[0]), 9, 110);
		const inList = new Set(g.issues.filter((i) => i.code === 'year-zero').flatMap((i) => i.ids ?? []));
		for (const w of warningsOf(line as never).filter((x) => x.warning === 'year-zero')) expect(inList.has(w.id!)).toBe(true);
	});
});

describe('ruling 2: a date that fits two calendars gives only fits-two-calendars', () => {
	const TWO = () => compileCalendars([ALDRIC, copyOf(ALDRIC, 'Other.md', { kind: { type: 'eras', eras: [{ name: 'Aldric', start: 1200 }] } })], true);
	const codes = (src: string) => graphOf(src, TWO()).issues.map((i) => String(i.code));

	it('a title year gives one warning, in words that name both calendars', () => {
		const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
titles:
  - {id: t, name: T, succession: eldest-child, year: "Aldric 10", holders: [{person: r}]}
`;
		expect(codes(src)).toContain('fits-two-calendars');
		expect(codes(src)).not.toContain('year-unreadable');
		const g = graphOf(src, TWO());
		expect(issueText(g.issues.find((i) => i.code === 'fits-two-calendars')!)).toContain('“Aldric (copy)”');
	});

	it('a text that fits no calendar and no plain year still gives year-unreadable', () => {
		const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
titles:
  - {id: t, name: T, succession: eldest-child, year: "late in the age", holders: [{person: r}]}
`;
		expect(codes(src)).toContain('year-unreadable');
	});

	it('the line gives no note for a reign text or a birth text that fits two calendars, and a note for one that has no year', () => {
		const src = (from: string, born: string) => `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: c, name: C, sex: m, born: "${born}", parents: [r]}
titles:
  - {id: t, name: T, succession: eldest-child, year: "1300", holders: [{person: r, from: "${from}"}]}
`;
		const two = lineOf(src('Aldric 3', 'Aldric 4'), TWO());
		expect(two.noYear).toEqual([]);
		expect(warningsOf(two).map((w) => w.warning)).toEqual(['fits-two-calendars', 'fits-two-calendars']);
		const lost = lineOf(src('long ago', 'a cold winter'), TWO());
		expect(lost.noYear).toEqual([{ id: 'r', what: 'reign', entry: 0 }, { id: 'c', what: 'born' }]);
	});
});

describe('ruling 3: while the calendars are not ready, no note about a missing year shows', () => {
	const SIBLINGS = (born: string[]) => `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: w1, name: W1, sex: f}
  - {id: w2, name: W2, sex: f}
  - {id: a, name: A, sex: m, born: "${born[0]}", parents: [r, w1]}
  - {id: c, name: C, sex: m, born: "${born[1]}", parents: [r, w2]}
titles:
  - {id: t, name: T, succession: eldest-child, year: "Aldric 40", holders: [{person: r, from: "Aldric 1"}]}
`;

	it('the order of the note shows only for a tie of two readable years, or a year that is really missing', () => {
		const pair = (born: string[], reader: ReturnType<typeof READY>) => notesOf(lineOf(SIBLINGS(born), reader), 'order-from-note').map((n) => n.params);
		expect(pair(['Aldric 3', 'Aldric 5'], READY())).toEqual([]);
		// Not ready: both years are unread, and the note would blame the user for it.
		expect(pair(['Aldric 3', 'Aldric 5'], NOT_READY())).toEqual([]);
		// A tie of two plain years is a fact in both states.
		expect(pair(['1020', '1020'], NOT_READY())).toEqual([{ a: 'a', b: 'c', reason: 'same-year' }]);
		expect(pair(['1020', '1020'], READY())).toEqual([{ a: 'a', b: 'c', reason: 'same-year' }]);
		// Ready, a year that is really missing still gets its note.
		expect(pair(['Aldric 3', 'some day'], READY())).toEqual([{ a: 'a', b: 'c' }]);
	});

	it('the other notes of a missing year stay hidden: noYear, died-no-year, the date warnings and the break of the order', () => {
		const src = `people:
  - {id: r, name: R, sex: m, born: 1000, died: 1100}
  - {id: a, name: A, sex: m, born: "Aldric 3", died: "Aldric 20", parents: [r]}
  - {id: b, name: B, sex: m, born: "0", died: "gone", parents: [r]}
titles:
  - {id: t, name: T, succession: eldest-child, year: "Aldric 30", holders: [{person: r, from: "Aldric 1"}]}
`;
		const res = lineOf(src, NOT_READY());
		expect(res.noYear).toEqual([]);
		expect(res.noBirthYear).toBe(0);
		expect(res.dateWarnings).toEqual([]);
		expect(res.notes.map((n) => n.kind)).toEqual([]);
	});

	it('the same kind of tree, once ready, shows the notes that are true', () => {
		const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: b, name: B, sex: m, born: "some day", parents: [r]}
titles:
  - {id: t, name: T, succession: born-in-reign, year: "Aldric 30", holders: [{person: r}]}
`;
		const res = lineOf(src, READY());
		expect(res.noYear).toContainEqual({ id: 'b', what: 'born' });
		expect(res.noBirthYear).toBe(1);
	});
});

describe('ruling 6: calendar-no-anchor in the line uses every date text the line read', () => {
	// The plain birth year is on a person who is not shown (limit 1); the calendar date is on the shown heir.
	const src = `people:
  - {id: r, name: R, sex: m, born: 1000}
  - {id: a, name: A, sex: m, born: "Year 5 of Cycle 1", parents: [r]}
  - {id: b, name: B, sex: m, born: "1040", parents: [r]}
titles:
  - {id: t, name: T, succession: eldest-child, year: "Year 9 of Cycle 1", holders: [{person: r}]}
`;
	const anchors = (limit: number) => {
		const g = graphOf(src, compileCalendars([LONG_COUNT], true));
		return warningsOf(successionLine(g, g.titles[0], specOf(g.titles[0]), limit, 110) as never).filter((w) => w.warning === 'calendar-no-anchor');
	};

	it('a plain year read for someone who is not shown still makes the warning', () => {
		expect(anchors(1)).toEqual([{ warning: 'calendar-no-anchor', what: 'year', text: 'The Long Count' }]);
		expect(anchors(5)).toHaveLength(1);
	});

	it('shows no other warning for the dates of people who are not shown', () => {
		// Zed (Year 0 of Cycle 2 is year 60, alive in year 69) stands after A in the line, so the line reads her, but limit 1 does not show her.
		const more = src.replace('Year 9 of Cycle 1', 'Year 9 of Cycle 2').replace('  - {id: b,', '  - {id: z, name: Z, sex: m, born: "Year 0 of Cycle 2", parents: [r]}\n  - {id: b,');
		const g = graphOf(more, compileCalendars([LONG_COUNT], true));
		const res = successionLine(g, g.titles[0], specOf(g.titles[0]), 1, 110);
		expect(res.heirs).toEqual(['a']);
		expect(warningsOf(res as never).filter((w) => w.warning === 'calendar-year-zero')).toEqual([]);
		const wide = successionLine(g, g.titles[0], specOf(g.titles[0]), 5, 110);
		expect(warningsOf(wide as never).filter((w) => w.warning === 'calendar-year-zero')).toHaveLength(1);
	});
});
