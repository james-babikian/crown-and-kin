/*
 * Step 4.0 of WP-4: dates in the line of succession, the tree warning list and the cards (spec §14 rules 4, 5, 7, 11 and
 * the family-history case table of the decision notes "Dates spec, genealogy check": M1 death date with no year, M2 no year 0,
 * S1 two equal calendars, S2 a range, S3 Year 0, S5 first match, S6 YEAR as written, S7 calendar-no-anchor, S8 Roman
 * numerals, plus Shōwa 64 and Heisei 1 and I19).
 */

import { describe, expect, it } from 'vitest';
import {
	ALDRIC,
	cardLabelWith,
	copyOf,
	dateLineWith,
	graphOf,
	issueCodes,
	JAPAN,
	LONG_COUNT,
	lineOf,
	lineWithDates,
	datesApi,
	notesOf,
	person,
	REIGN_NAMES,
	warningsOf,
	type CalendarDef,
	type DatesApi,
} from './dates-support';

/** A title tree: Rolf rules, Cade is his child. `extra` adds people and `title` the keys of the title. */
function tree(opts: { people?: string; title?: string; holder?: string } = {}): string {
	return `people:
  - {id: r, name: Rolf, sex: m}
${opts.people ?? '  - {id: c, name: Cade, sex: m, born: 1020, parents: [r]}\n'}
titles:
  - id: crown
    name: Crown
    succession: eldest-child
${opts.title ?? '    year: "1109"\n'}    holders:
      - ${opts.holder ?? '{person: r}'}
`;
}

describe('§14 r5, r7: the year Y of the line and its text (family history S6)', () => {
	const A = datesApi;
	const aldric = () => A.compileCalendars([ALDRIC], true);

	it('§14 r7: a title year in a calendar gives Y, and YEAR is the text as written', () => {
		const res = lineOf(tree({ title: '    year: "Aldric 10"\n' }), aldric());
		expect(res.year).toBe(1109);
		expect(res.yearFrom).toBe('field');
		expect(res.yearText).toBe('Aldric 10');
	});

	it('§14 r7: the last holder "to" in a calendar gives Y, and YEAR is that text', () => {
		const res = lineOf(tree({ title: '', holder: '{person: r, from: "Aldric 1", to: "Aldric 20"}' }), aldric());
		expect(res.year).toBe(1119);
		expect(res.yearFrom).toBe('reign-end');
		expect(res.yearText).toBe('Aldric 20');
	});

	it('§14 r7: "now" has no YEAR text', () => {
		const res = lineOf(tree({ title: '' }), aldric());
		expect(res.year).toBeNull();
		expect(res.yearText).toBeNull();
	});

	it('§14 r7: a plain year keeps its text, and a BC text is shown as written, not as an internal number', () => {
		expect(lineOf(tree({ title: '    year: "1210"\n' })).yearText).toBe('1210');
		expect(lineOf(tree({ title: '    year: "c. 1210"\n' })).yearText).toBe('c. 1210');
		expect(lineOf(tree({ title: '    year: "200 BC"\n', holder: '{person: r, from: "300 BC"}' })).yearText).toBe('200 BC');
	});

	it('§14 r7: the Titles window gives a draft year; successionLine reads it through the dates view it gets', () => {
		const g = graphOf(tree({ title: '    year: "1109"\n' }));
		const res = lineWithDates(g, { year: 'Aldric 10' }, A.buildTreeDates(aldric(), g.people, g.titles));
		expect(res.year).toBe(1109);
		expect(res.yearText).toBe('Aldric 10');
	});
});

describe('§14 r4, r5: the line reads born, died and the reigns through the calendar', () => {
	const A = datesApi;
	const SIBLINGS = tree({
		people: '  - {id: c1, name: Cora, sex: f, born: "Aldric 30", parents: [r]}\n  - {id: c2, name: Cade, sex: m, born: "Aldric 10", parents: [r]}\n',
		title: '',
	});

	it('§14 r4: brothers and sisters are put in the order of their calendar birth years', () => {
		expect(lineOf(SIBLINGS, A.compileCalendars([ALDRIC], true)).heirs).toEqual(['c2', 'c1']);
	});

	it('§14 r7: before ready the same dates read as plain: no years, so the order of the note, and no date note', () => {
		const res = lineOf(SIBLINGS, A.compileCalendars([ALDRIC], false));
		expect(res.heirs).toEqual(['c1', 'c2']);
		expect(res.noYear).toEqual([]);
		expect(warningsOf(res)).toEqual([]);
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r7: with no calendars the same dates read as plain, as in 0.3.1', () => {
		expect(lineOf(SIBLINGS).heirs).toEqual(['c1', 'c2']);
		expect(lineOf(SIBLINGS, A.PLAIN_READER).heirs).toEqual(['c1', 'c2']);
	});

	const HEIRS = (year: string) =>
		tree({
			people: `  - {id: a, name: Alva, sex: f, born: "Aldric 1", died: "Aldric 5"}\n  - {id: b, name: Bram, sex: m, born: "Aldric 1", died: "Aldric 20"}\n`,
			title: `    year: "${year}"\n    heir: [a, b]\n`,
		});

	it('§14 r5: a named heir who died in a calendar year before Y is not alive; one who died after Y is the first heir', () => {
		const res = lineOf(HEIRS('Aldric 10'), A.compileCalendars([ALDRIC], true));
		expect(res.namedHeirs).toEqual([
			{ id: 'a', state: 'not-alive' },
			{ id: 'b', state: 'first' },
		]);
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r7: before ready no date is read through the calendar: no note and no warning about the death dates', () => {
		const res = lineOf(HEIRS('Aldric 10'), A.compileCalendars([ALDRIC], false));
		expect(notesOf(res, 'died-no-year')).toEqual([]);
		expect(warningsOf(res)).toEqual([]);
		expect(res.noYear).toEqual([]);
	});

	it('§14 r5: a holder entry in a calendar starts the reign at its year (Y is the year of the title)', () => {
		const src = tree({ people: '', title: '    year: "Aldric 30"\n', holder: '{person: r, from: "Aldric 20"}' });
		expect(lineOf(src, A.compileCalendars([ALDRIC], true)).kind).toBe('line');
		// A reign that starts after Y has not started.
		const later = tree({ people: '', title: '    year: "Aldric 10"\n', holder: '{person: r, from: "Aldric 20"}' });
		expect(lineOf(later, A.compileCalendars([ALDRIC], true)).kind).toBe('no-ruler');
	});
});

describe('§14 r1, r4: Shōwa 64 and Heisei 1 are one year (family history)', () => {
	const A = datesApi;
	const src = (year: string) =>
		tree({
			people: `  - {id: x, name: Xan, sex: m, born: "Heisei 1"}
  - {id: y, name: Yul, sex: m, born: "Heisei 2"}
  - {id: z, name: Zed, sex: m, born: "Shōwa 1", died: "Shōwa 64"}
`,
			title: `    year: "${year}"\n    heir: [x, y, z]\n`,
		});
	const states = [
		{ id: 'x', state: 'first' },
		{ id: 'y', state: 'not-born' },
		{ id: 'z', state: 'not-alive' },
	];

	it('§14 r4: a person born in Heisei 1 is born in Shōwa 64 (born in Y counts); one born in Heisei 2 is not; one who died in Shōwa 64 is dead', () => {
		expect(lineOf(src('Shōwa 64'), A.compileCalendars([JAPAN], true)).namedHeirs).toEqual(states);
	});

	it('§14 r4: the same line when the year of the title is written as Heisei 1', () => {
		const res = lineOf(src('Heisei 1'), A.compileCalendars([JAPAN], true));
		expect(res.namedHeirs).toEqual(states);
		expect(res.year).toBe(1989);
		expect(res.yearText).toBe('Heisei 1');
	});
});

describe('§14 r5: a death date with no year (family history M1)', () => {
	const A = datesApi;
	const PEOPLE = `  - {id: c1, name: Cora, sex: f, born: 1060, died: "fell in the war", parents: [r]}
  - {id: c2, name: Cade, sex: m, born: 1070, parents: [r]}
`;
	const base = (extraTitle = '', year = '    year: "1109"\n') => tree({ people: PEOPLE, title: `${year}${extraTitle}` });
	const note = (res: ReturnType<typeof lineOf>, id: string) => notesOf(res, 'died-no-year').filter((n) => n.params.person === id);

	it('§14 r5: a person the walk reaches who is out of the line only for this reason gets the note, with YEAR', () => {
		const res = lineOf(base());
		expect(res.heirs).toEqual(['c2']);
		const n = note(res, 'c1');
		expect(n.length).toBeGreaterThanOrEqual(1);
		expect(n[0].params.year).toBe('1109');
	});

	it('§14 r5: YEAR in the note is the text that gives Y, as written', () => {
		expect(note(lineOf(base('', '    year: "c. 1109"\n')), 'c1')[0].params.year).toBe('c. 1109');
		const fromReign = tree({ people: PEOPLE, title: '', holder: '{person: r, from: 1050, to: "1109"}' });
		expect(note(lineOf(fromReign), 'c1')[0].params.year).toBe('1109');
	});

	it('§14 r5: the note shows with a ready reader that has no calendars, and with a full calendar set', () => {
		expect(note(lineOf(base(), A.PLAIN_READER), 'c1').length).toBeGreaterThanOrEqual(1);
		expect(note(lineOf(base(), A.compileCalendars([LONG_COUNT, REIGN_NAMES, JAPAN, ALDRIC], true)), 'c1').length).toBeGreaterThanOrEqual(1);
	});

	it('§14 r7: before ready there is no note (the line reads plain years and says nothing about dates)', () => {
		const res = lineOf(base(), A.compileCalendars([ALDRIC], false));
		expect(res.heirs).toEqual(['c2']);
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r5: a death date that fits a calendar has a year, so there is no note', () => {
		const src = tree({ people: PEOPLE.replace('fell in the war', 'Aldric 5'), title: '    year: "Aldric 10"\n' });
		const res = lineOf(src, A.compileCalendars([ALDRIC], true));
		expect(res.heirs).toEqual(['c2']);
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r5: no note for a death date with a year, an alive word, or a person who is not born yet', () => {
		expect(notesOf(lineOf(tree({ people: PEOPLE.replace('fell in the war', '1100'), title: '    year: "1109"\n' })), 'died-no-year')).toEqual([]);
		const alive = lineOf(tree({ people: PEOPLE.replace('fell in the war', 'alive'), title: '    year: "1109"\n' }));
		expect(alive.heirs).toEqual(['c1', 'c2']);
		expect(notesOf(alive, 'died-no-year')).toEqual([]);
		const unborn = lineOf(tree({ people: PEOPLE.replace('born: 1060', 'born: 1200'), title: '    year: "1109"\n' }));
		expect(unborn.heirs).toEqual(['c2']);
		expect(notesOf(unborn, 'died-no-year')).toEqual([]);
	});

	it('§14 r5: with "now" (Y is not a number) there is no note', () => {
		const res = lineOf(base('', ''));
		expect(res.yearText).toBeNull();
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r5: a person who is out for another reason (a daughter under men-only) gets no note', () => {
		const res = lineOf(base('    inherit: men-only\n'));
		expect(res.heirs).toEqual(['c2']);
		expect(notesOf(res, 'died-no-year')).toEqual([]);
	});

	it('§14 r5: an open-branch row that this death date causes gets the note', () => {
		// With men-only the daughter is not an heir, but with inherit-through anyone she passes the claim on and has no
		// children: her row is caused by the death date.
		const res = lineOf(base('    inherit: men-only\n    inherit-through: anyone\n'));
		expect(res.openBranches.map((b) => b.id)).toContain('c1');
		expect(note(res, 'c1').length).toBeGreaterThanOrEqual(1);
	});

	it('§14 r5: a named heir who is not alive only for this reason gets the note; one with a dated death does not', () => {
		const named = (died: string) =>
			tree({
				people: `  - {id: n, name: Nora, sex: f, born: 1060, died: "${died}"}\n`,
				title: '    year: "1109"\n    heir: [n]\n',
			}).replace('    succession: eldest-child\n', '');
		const undated = lineOf(named('killed in the war'));
		expect(undated.namedHeirs).toEqual([{ id: 'n', state: 'not-alive' }]);
		expect(note(undated, 'n').length).toBeGreaterThanOrEqual(1);
		const dated = lineOf(named('1100'));
		expect(dated.namedHeirs).toEqual([{ id: 'n', state: 'not-alive' }]);
		expect(note(dated, 'n')).toEqual([]);
		expect(note(lineOf(named('killed in the war'), A.compileCalendars([ALDRIC], false)), 'n')).toEqual([]);
	});
});

describe('§14 r5, r8: warnings of one date in the line (scope of §13.21 rule 9)', () => {
	const A = datesApi;
	const reign = () => A.compileCalendars([REIGN_NAMES], true);
	const find = (res: Record<string, unknown>, warning: string, what: string) => warningsOf(res).filter((w) => w.warning === warning && w.what === what);

	it('§14 r5: Year 0 of an era in the title year gives calendar-year-zero, with the text as written', () => {
		const res = lineOf(tree({ people: '', title: '    year: "Qinglong Emperor 0"\n' }), reign());
		expect(res.year).toBe(129);
		expect(find(res, 'calendar-year-zero', 'year')).toMatchObject([{ text: 'Qinglong Emperor 0' }]);
	});

	it('§14 r5: a year above the length of the era in the title year gives calendar-year-past-end', () => {
		const res = lineOf(tree({ people: '', title: '    year: "Qinglong Emperor 12"\n' }), reign());
		expect(res.year).toBe(141);
		expect(find(res, 'calendar-year-past-end', 'year')).toHaveLength(1);
	});

	it('§14 r5: a holder entry that the line reads gives the warning with its entry index', () => {
		const res = lineOf(tree({ people: '', title: '    year: "Jianwen Emperor 5"\n', holder: '{person: r, from: "Qinglong Emperor 12"}' }), reign());
		expect(res.kind).toBe('line');
		expect(find(res, 'calendar-year-past-end', 'reign')).toMatchObject([{ entry: 0, text: 'Qinglong Emperor 12' }]);
	});

	it('§14 r5: the birth date of a person in the line gives the warning with the id', () => {
		const src = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 12", parents: [r]}\n', title: '    year: "Jianwen Emperor 5"\n' });
		const res = lineOf(src, reign());
		expect(res.heirs).toEqual(['c']);
		expect(find(res, 'calendar-year-past-end', 'born')).toMatchObject([{ id: 'c', text: 'Qinglong Emperor 12' }]);
	});

	it('§14 r5: a person the line does not need gets no warning (the scope is where rule 9 shows a note)', () => {
		const src = tree({
			people: '  - {id: c, name: Cade, sex: m, born: "Jianwen Emperor 1", parents: [r]}\n  - {id: u, name: Una, sex: f, born: "Qinglong Emperor 12"}\n',
			title: '    year: "Jianwen Emperor 5"\n',
		});
		const res = lineOf(src, reign());
		expect(warningsOf(res).filter((w) => w.id === 'u')).toEqual([]);
	});

	it('§14 r4: a date that fits two calendars with different years has no year and gives fits-two-calendars', () => {
		const moved = copyOf(REIGN_NAMES, 'Other.md', {
			kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 500, length: 11 }, { name: 'Jianwen Emperor', start: 141 }] },
		});
		const src = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 3", parents: [r]}\n', title: '    year: "Jianwen Emperor 5"\n' });
		const res = lineOf(src, A.compileCalendars([REIGN_NAMES, moved], true));
		expect(find(res, 'fits-two-calendars', 'born')).toMatchObject([{ id: 'c' }]);
		// ruling 4.2 fix: the warning says it; the line adds no second note about the missing year.
		expect(res.noYear).not.toContainEqual({ id: 'c', what: 'born' });
	});

	it('§14 r4: two calendars that give the same year (a sync copy) keep the year and give no warning (family history S1)', () => {
		const src = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 3", parents: [r]}\n', title: '    year: "Jianwen Emperor 5"\n' });
		const res = lineOf(src, A.compileCalendars([REIGN_NAMES, copyOf(REIGN_NAMES, 'Other.md')], true));
		expect(res.noYear).toEqual([]);
		expect(warningsOf(res)).toEqual([]);
		expect(res.heirs).toEqual(['c']);
	});

	it('§14 r7: before ready the same texts give no warning and no noYear', () => {
		const src = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 12", parents: [r]}\n', title: '    year: "Qinglong Emperor 0"\n' });
		const res = lineOf(src, A.compileCalendars([REIGN_NAMES], false));
		expect(warningsOf(res)).toEqual([]);
		expect(res.noYear).toEqual([]);
	});

	it('§14 r8: with only plain, well-formed years there is no date warning', () => {
		expect(warningsOf(lineOf(tree(), reign()))).toEqual([]);
		expect(warningsOf(lineOf(tree(), A.PLAIN_READER))).toEqual([]);
	});

	// Needs step 4.1b as well: a plain 0 is read as 1 BC with the warning year-zero.
	it('§14 r8: a plain 0 as the title year gives year-zero (needs 4.1b)', () => {
		const res = lineOf(tree({ people: '', title: '    year: "0"\n' }), A.PLAIN_READER);
		expect(find(res, 'year-zero', 'year')).toMatchObject([{ text: '0' }]);
	});
});

describe('§14 r1, r5: calendar-no-anchor in the line (family history S7)', () => {
	const A = datesApi;
	const anchorWarnings = (res: Record<string, unknown>) => warningsOf(res).filter((w) => w.warning === 'calendar-no-anchor');
	const cals = (cs: CalendarDef[], ready = true) => A.compileCalendars(cs, ready);
	const withKid = (born: string, year: string) => tree({ people: `  - {id: c, name: Cade, sex: m, born: "${born}", parents: [r]}\n`, title: `    year: "${year}"\n` });

	it('§14 r5: case 1: a calendar with S = 1 beside plain years gives calendar-no-anchor, and the line still compares', () => {
		const res = lineOf(withKid('100', 'Year 5 of Cycle 3'), cals([LONG_COUNT]));
		expect(anchorWarnings(res)).toHaveLength(1);
		expect(res.kind).toBe('line');
		expect(res.year).toBe(125);
		expect(res.heirs).toEqual(['c']);
	});

	it('§14 r5: case 2: a calendar with S = 1 beside nothing else gives no calendar-no-anchor', () => {
		const res = lineOf(withKid('Year 1 of Cycle 1', 'Year 5 of Cycle 3'), cals([LONG_COUNT]));
		expect(anchorWarnings(res)).toEqual([]);
		expect(res.heirs).toEqual(['c']);
	});

	it('§14 r5: a calendar with a real start beside plain years gives none', () => {
		expect(anchorWarnings(lineOf(withKid('100', 'Qinglong Emperor 5'), cals([REIGN_NAMES])))).toEqual([]);
	});

	it('§14 r7: before ready it gives none', () => {
		expect(anchorWarnings(lineOf(withKid('100', 'Year 5 of Cycle 3'), cals([LONG_COUNT], false)))).toEqual([]);
	});
});

describe('§14 r5, r7: the tree warning list (where §13.21 rule 9 shows a note)', () => {
	const A = datesApi;
	const codes = (src: string, reader: ReturnType<DatesApi['compileCalendars']>) => issueCodes(graphOf(src, reader));
	const reign = (ready = true) => A.compileCalendars([REIGN_NAMES], ready);
	const zero = tree({ people: '', title: '    year: "Qinglong Emperor 0"\n' });

	it('§14 r5: a title with a rule and a year at Year 0 of an era has calendar-year-zero in the list', () => {
		expect(codes(zero, reign())).toContain('calendar-year-zero');
	});

	it('§14 r5: calendar-year-past-end, fits-two-calendars and calendar-no-anchor are in the list for such a title', () => {
		expect(codes(tree({ people: '', title: '    year: "Qinglong Emperor 12"\n' }), reign())).toContain('calendar-year-past-end');
		const moved = copyOf(REIGN_NAMES, 'Other.md', { kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 500, length: 11 }, { name: 'Jianwen Emperor', start: 141 }] } });
		const two = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 3", parents: [r]}\n', title: '    year: "Jianwen Emperor 5"\n' });
		expect(codes(two, A.compileCalendars([REIGN_NAMES, moved], true))).toContain('fits-two-calendars');
		const noAnchor = tree({ people: '  - {id: c, name: Cade, sex: m, born: "100", parents: [r]}\n', title: '    year: "Year 5 of Cycle 3"\n' });
		expect(codes(noAnchor, A.compileCalendars([LONG_COUNT], true))).toContain('calendar-no-anchor');
	});

	it('§14 r5: a person whom the line needs, with a date past the end of the era, is in the list', () => {
		const src = tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 12", parents: [r]}\n', title: '    year: "Jianwen Emperor 5"\n' });
		expect(codes(src, reign())).toContain('calendar-year-past-end');
	});

	it('§14 r5: a title with no rule and no named heir does not need the year, so the list has no warning of it', () => {
		const src = zero.replace('    succession: eldest-child\n', '');
		const found = codes(src, reign()).filter((c) => c.startsWith('calendar-') || c === 'year-unreadable');
		expect(found).toEqual([]);
	});

	it('§14 r7: before ready the list has no calendar warning and no year-unreadable', () => {
		const text = tree({ people: '', title: '    year: "Year 5 of Cycle 3"\n' });
		for (const src of [zero, text]) {
			const found = codes(src, A.compileCalendars([REIGN_NAMES, LONG_COUNT], false)).filter((c) => c.startsWith('calendar-') || c === 'year-unreadable' || c === 'fits-two-calendars' || c === 'year-zero');
			expect(found).toEqual([]);
		}
	});

	it('§14 r7: a ready reader with no calendar reads the year of "Year 5 of Cycle 3" as no year: year-unreadable, as in 0.3.1', () => {
		const text = tree({ people: '', title: '    year: "Year 5 of Cycle 3"\n' });
		expect(codes(text, A.PLAIN_READER)).toContain('year-unreadable');
		expect(codes(text, A.compileCalendars([REIGN_NAMES], true))).toContain('year-unreadable');
	});

	it('§14 r7: once the calendar is loaded and ready, the same year is readable: no year-unreadable', () => {
		const text = tree({ people: '', title: '    year: "Year 5 of Cycle 3"\n' });
		expect(codes(text, A.compileCalendars([LONG_COUNT], true))).not.toContain('year-unreadable');
	});

	it('§14 r3, r7: a problem of the calendar set (note missing, duplicate) is a tree warning once ready, and not before', () => {
		const src = tree();
		for (const key of ['calendar-note-missing', 'calendar-duplicate'] as const) {
			const problem = { key, note: 'Calendars of the Far Land' };
			expect(codes(src, A.compileCalendars([], true, [problem]))).toContain(key);
			expect(codes(src, A.compileCalendars([], false, [problem]))).not.toContain(key);
		}
	});

	// Needs step 4.1b as well.
	it('§14 r8: a title with a rule and the year "0" has year-zero in the list; without a rule it does not (needs 4.1b)', () => {
		const withRule = tree({ people: '', title: '    year: "0"\n' });
		expect(codes(withRule, A.PLAIN_READER)).toContain('year-zero');
		expect(codes(withRule.replace('    succession: eldest-child\n', ''), A.PLAIN_READER)).not.toContain('year-zero');
	});
});

describe('§14 r7, I19: a calendar death date with no birth date shows as written on the card', () => {
	const A = datesApi;
	const view = (cals: CalendarDef[], ready = true) => A.buildTreeDates(A.compileCalendars(cals, ready), [], []);
	const plain = () => A.buildTreeDates(A.PLAIN_READER, [], []);
	const p = (extra: { born?: string; died?: string }) => person({ id: 'a', name: 'Ada', ...extra });

	it('§14 r7: a death text that fits a calendar shows as written, not as †', () => {
		expect(dateLineWith(p({ died: 'Year 5 of Cycle 3' }), view([LONG_COUNT]))).toBe('d. Year 5 of Cycle 3');
	});

	it('§14 r7: the same text with no calendar still gives † (as in 0.3.1)', () => {
		expect(dateLineWith(p({ died: 'Year 5 of Cycle 3' }), plain())).toBe('†');
	});

	it('§14 r7: before ready the card shows † (the scan has not ended)', () => {
		expect(dateLineWith(p({ died: 'Year 5 of Cycle 3' }), view([LONG_COUNT], false))).toBe('†');
	});

	it('§14 r7: born and died in calendars show "born–died" as written', () => {
		expect(dateLineWith(p({ born: 'Year 1 of Cycle 3', died: 'Year 5 of Cycle 3' }), view([LONG_COUNT]))).toBe('Year 1 of Cycle 3–Year 5 of Cycle 3');
		expect(dateLineWith(p({ born: '1100', died: 'Qinglong Emperor 3' }), view([REIGN_NAMES]))).toBe('1100–Qinglong Emperor 3');
	});

	it('§14 r7: a death text with no year in any calendar keeps its sign; an alive word shows no death', () => {
		expect(dateLineWith(p({ died: 'yes' }), view([LONG_COUNT, REIGN_NAMES]))).toBe('†');
		expect(dateLineWith(p({ died: '?' }), view([LONG_COUNT]))).toBe('†?');
		expect(dateLineWith(p({ born: 'Qinglong Emperor 3', died: 'fell in the war' }), view([REIGN_NAMES]))).toBe('b. Qinglong Emperor 3 †');
		expect(dateLineWith(p({ died: 'false' }), view([LONG_COUNT]))).toBeUndefined();
	});

	it('§14 r7: plain years are unchanged: "1131–1180", "b. 1131", "d. 1180"', () => {
		const v = view([LONG_COUNT, REIGN_NAMES]);
		expect(dateLineWith(p({ born: '1131', died: '1180' }), v)).toBe('1131–1180');
		expect(dateLineWith(p({ born: '1131' }), v)).toBe('b. 1131');
		expect(dateLineWith(p({ died: '1180' }), v)).toBe('d. 1180');
		expect(dateLineWith(p({}), v)).toBeUndefined();
	});
});

describe('§14 r7, I19: the screen-reader label of the card says the same', () => {
	const A = datesApi;
	const dead = person({ id: 'a', name: 'Ada', died: 'Year 5 of Cycle 3' });

	it('§14 r7: a calendar death date is read as written; with no calendar the label says "dead"', () => {
		expect(cardLabelWith(dead, A.buildTreeDates(A.compileCalendars([LONG_COUNT], true), [], []))).toBe('Ada, d. Year 5 of Cycle 3');
		expect(cardLabelWith(dead, A.buildTreeDates(A.PLAIN_READER, [], []))).toBe('Ada, dead');
	});
});
