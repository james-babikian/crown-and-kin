// Step 4.2 of WP-4 (the architecture notes §5.7, rule 11 duty "round trip of the kin-calendar block with comments and unknown keys"):
// `core/calendar-block.ts` reads the block into `Calendar` objects with issues, and edits it (add, change and remove a calendar, add, change and
// remove an era) through the yaml Document API. Untouched lines keep their comments, order, quoting and flow style; unknown keys stay.
import { describe, expect, it } from 'vitest';
import { checkCalendars, compileCalendars, type Calendar } from '../../src/core/dates';
import { calendarId, editCalendarBlock, parseCalendarBlock, type CalendarOp } from '../../src/core/calendar-block';
import { issueText } from '../../src/core/messages';
import { commentsOf } from '../../src/core/yaml-patch';
import { rng } from '../support/rng';

/** The block of the owner's doc (spec §14 rule 2). */
const DOC = `calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1
    formats: ["{year} Year of the {cycle} Cycle", "Year {year} of Cycle {cycle}"]
  - name: Reign names
    kind: eras
    formats: ["{year} Year of the {era}", "{era} {year}"]
    eras:
      - {name: Qinglong Emperor, start: 130, length: 11}
      - {name: Jianwen Emperor, start: 141}
`;

/** A block with a comment on every kind of place, unknown keys at every level, mixed styles and a quoted number. */
const RICH = `# Calendars of the Far Land
version: 3 # not read by the plugin
calendars:
  # the old count of the south
  - name: The Long Count # the first calendar
    kind: cycles
    length: 60
    start: 1
    notes: "kept by the monks"
    formats: ["{year} Year of the {cycle} Cycle", "Year {year} of Cycle {cycle}"]

  # the reign names
  - name: 'Reign names'
    kind: eras
    source: the annals
    formats:
      - "{year} Year of the {era}"
      - "{era} {year}"
    eras:
      # first emperor
      - {name: Qinglong Emperor, start: 130, length: 11} # eleven years
      - name: Jianwen Emperor
        start: 141
        source: the second annals
  - {name: Short, kind: cycles, length: 12, start: -3, formats: ["Cycle {cycle} year {year}"]}
`;

const ok = (body: string, op: CalendarOp): string => {
	const r = editCalendarBlock(body, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}\n${body}`);
	return r.body;
};
const calendars = (body: string) => parseCalendarBlock(body, 'Calendars.md', 0).calendars;
const comments = (body: string) => commentsOf(body).map((c) => c.text);
const lines = (body: string) => body.split('\n');

describe('parseCalendarBlock', () => {
	it('reads the block of the owner\'s doc', () => {
		const { calendars: cals, issues } = parseCalendarBlock(DOC, 'Calendars.md', 0);
		expect(issues).toEqual([]);
		expect(cals).toEqual([
			{ id: 'Calendars.md#0#0', name: 'The Long Count', note: 'Calendars.md', formats: ['{year} Year of the {cycle} Cycle', 'Year {year} of Cycle {cycle}'], kind: { type: 'cycles', length: 60, start: 1 } },
			{
				id: 'Calendars.md#0#1',
				name: 'Reign names',
				note: 'Calendars.md',
				formats: ['{year} Year of the {era}', '{era} {year}'],
				kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 130, length: 11 }, { name: 'Jianwen Emperor', start: 141 }] },
			},
		]);
	});

	it('the id has the note, the number of the block among the kin-calendar blocks and the place in the list', () => {
		expect(parseCalendarBlock(DOC, 'Far Land/Eras.md', 2).calendars.map((c) => c.id)).toEqual(['Far Land/Eras.md#2#0', 'Far Land/Eras.md#2#1']);
		expect(calendarId('A.md', 1, 4)).toBe('A.md#1#4');
	});

	it('reads a block with comments, unknown keys, quoted names, a block list of formats and a flow item', () => {
		const { calendars: cals, issues } = parseCalendarBlock(RICH, 'Calendars.md', 0);
		expect(issues).toEqual([]);
		expect(cals.map((c) => c.name)).toEqual(['The Long Count', 'Reign names', 'Short']);
		expect(cals[1].formats).toEqual(['{year} Year of the {era}', '{era} {year}']);
		expect(cals[2].kind).toEqual({ type: 'cycles', length: 12, start: -3 });
	});

	it('what it reads is what the date reader needs: the calendars compile and read a date', () => {
		const reader = compileCalendars(calendars(DOC), true);
		expect(reader.read('Qinglong Emperor 3')?.year).toBe(132);
		expect(reader.read('Year 5 of Cycle 3')?.year).toBe(125);
	});

	it('an empty block, `calendars:` with nothing and `calendars: []` are valid and hold no calendar', () => {
		for (const body of ['', '\n', '# only a comment\n', 'calendars:\n', 'calendars: []\n', '{}']) {
			expect(parseCalendarBlock(body, 'C.md', 0)).toEqual({ calendars: [], issues: [] });
		}
	});

	it('a block that is not YAML, has no list of calendars or holds another shape gives one issue', () => {
		for (const body of ['calendars: [\n', 'just text', '- a\n- b\n', 'other: 1\n', 'calendars: Long Count\n', 'calendars:\n  name: X\n']) {
			const r = parseCalendarBlock(body, 'C.md', 0);
			expect(r.calendars, body).toEqual([]);
			expect(r.issues.map((i) => i.code), body).toEqual(['calendar-block-invalid']);
			expect(issueText(r.issues[0])).toContain('“C.md”');
		}
	});

	it('leaves out a calendar that cannot be used, with an issue for it, and keeps its place number for the others', () => {
		const body = `calendars:
  - just a text
  - {kind: cycles, length: 5}
  - {name: Odd, kind: stars}
  - {name: Fine, kind: eras, eras: [{name: A, start: 1}, {start: 5}, 7]}
  - {name: Last, kind: Cycles, length: 5}
`;
		const r = parseCalendarBlock(body, 'C.md', 0);
		expect(r.issues.map((i) => [i.params.index, i.params.why])).toEqual([[1, 'not-map'], [2, 'no-name'], [3, 'kind'], [4, 'era']]);
		expect(r.calendars.map((c) => [c.id, c.name])).toEqual([['C.md#0#3', 'Fine'], ['C.md#0#4', 'Last']]);
		expect(r.calendars[0].kind).toEqual({ type: 'eras', eras: [{ name: 'A', start: 1 }] });
		for (const i of r.issues) expect(issueText(i)).toMatch(/^Calendar \d in the block of the note “C.md” cannot be used, because /);
	});

	it('a number that is not a whole number becomes NaN, so the window refuses it and the date reader ignores the calendar; a missing start is 1', () => {
		const r = parseCalendarBlock('calendars:\n  - {name: A, kind: cycles, length: x, start: 1.5, formats: []}\n  - {name: B, kind: cycles, length: 5, formats: []}\n', 'C.md', 0);
		expect(r.issues).toEqual([]);
		const [a, b] = r.calendars;
		expect(a.kind).toMatchObject({ type: 'cycles', length: NaN, start: NaN });
		expect(b.kind).toEqual({ type: 'cycles', length: 5, start: 1 });
		expect(checkCalendars([a]).map((x) => x.key)).toEqual(['calendar-length', 'calendar-number']);
		expect(compileCalendars([a], true).read('Year 1 of Cycle 1')?.source).not.toBe('calendar');
	});

	it('never throws for any input', () => {
		for (const bad of [null, undefined, 42, {}, [], 'a: &x [*x]\n', '\u0000\u0001', 'calendars:\n' + '  - {name: A, kind: eras, eras: [' + '{name: B, start: 1},'.repeat(3000) + ']}\n']) {
			expect(() => parseCalendarBlock(bad as unknown as string, 'C.md', 0)).not.toThrow();
		}
		expect(parseCalendarBlock(42 as unknown as string, 'C.md', 0)).toEqual({ calendars: [], issues: [] });
	});
});

describe('editCalendarBlock: add', () => {
	it('adds a cycle calendar to the end of the list, in the style of the list', () => {
		const body = ok(DOC, { kind: 'add-calendar', calendar: { name: 'Age of Stars', kind: 'cycles', length: 1000, start: 1, formats: ['{year} AS of the {cycle} Age'] } });
		expect(body).toBe(`${DOC}  - name: Age of Stars
    kind: cycles
    length: 1000
    start: 1
    formats: ["{year} AS of the {cycle} Age"]
`);
		expect(calendars(body).map((c) => c.name)).toEqual(['The Long Count', 'Reign names', 'Age of Stars']);
	});

	it('adds an era calendar with its eras, and one with none', () => {
		const body = ok(DOC, { kind: 'add-calendar', calendar: { name: 'Dynasties', kind: 'eras', formats: ['{era} dynasty, year {year}'], eras: [{ name: 'Tang', start: 618, length: 289 }, { name: 'Song', start: 960 }] } });
		expect(body.endsWith(`  - name: Dynasties
    kind: eras
    formats: ["{era} dynasty, year {year}"]
    eras:
      - {name: Tang, start: 618, length: 289}
      - {name: Song, start: 960}
`)).toBe(true);
		const empty = ok(DOC, { kind: 'add-calendar', calendar: { name: 'None yet', kind: 'eras', formats: ['{era} {year}'] } });
		expect(calendars(empty)[2].kind).toEqual({ type: 'eras', eras: [] });
		expect(empty).toContain('eras: []');
	});

	it('makes the block when there is none: an empty body, a body of comments and a `calendars:` with nothing', () => {
		const c = { name: 'A', kind: 'cycles' as const, length: 10, start: 1, formats: ['{cycle}.{year}'] };
		expect(ok('', { kind: 'add-calendar', calendar: c })).toBe('calendars:\n  - name: A\n    kind: cycles\n    length: 10\n    start: 1\n    formats: ["{cycle}.{year}"]');
		const withComment = ok('# my calendars\n', { kind: 'add-calendar', calendar: c });
		expect(withComment.startsWith('# my calendars\ncalendars:\n  - name: A')).toBe(true);
		for (const start of ['calendars:\n', 'calendars: []\n', 'calendars:\n# nothing yet\n']) {
			const body = ok(start, { kind: 'add-calendar', calendar: c });
			expect(calendars(body).map((x) => x.name), start).toEqual(['A']);
			expect(comments(body), start).toEqual(comments(start));
		}
	});

	it('a name that needs quotes is quoted, and a number as a name stays text', () => {
		const body = ok(DOC, { kind: 'add-calendar', calendar: { name: 'Reigns: the old: ones', kind: 'cycles', length: 5, start: 1, formats: ['{cycle}/{year}'] } });
		expect(calendars(body)[2].name).toBe('Reigns: the old: ones');
		expect(calendars(ok(DOC, { kind: 'add-calendar', calendar: { name: '1066', kind: 'cycles', length: 5, formats: ['{cycle}/{year}'] } }))[2].name).toBe('1066');
	});

	it('adds to a list written in flow style, and keeps the comment on the last item', () => {
		const flow = 'calendars: [{name: A, kind: cycles, length: 5, start: 1, formats: ["{cycle} {year}"]}] # one\n';
		const body = ok(flow, { kind: 'add-calendar', calendar: { name: 'B', kind: 'cycles', length: 6, start: 2, formats: ['{year}/{cycle}'] } });
		expect(calendars(body).map((c) => c.name)).toEqual(['A', 'B']);
		expect(comments(body)).toEqual(['# one']);
	});

	it('keeps every comment and unknown key of a rich block', () => {
		const body = ok(RICH, { kind: 'add-calendar', calendar: { name: 'New', kind: 'cycles', length: 7, start: 1, formats: ['{cycle} {year}'] } });
		expect(comments(body)).toEqual(comments(RICH));
		expect(body.startsWith(RICH.trimEnd())).toBe(true);
		expect(calendars(body).map((c) => c.name)).toEqual(['The Long Count', 'Reign names', 'Short', 'New']);
	});
});

describe('editCalendarBlock: change a calendar', () => {
	it('changes the name on its line and nothing else', () => {
		const body = ok(RICH, { kind: 'edit-calendar', index: 0, fields: { name: 'The Old Count' } });
		const a = lines(RICH);
		const b = lines(body);
		expect(b).toHaveLength(a.length);
		expect(b.filter((l, i) => l !== a[i])).toEqual(['  - name: The Old Count # the first calendar']);
		expect(comments(body)).toEqual(comments(RICH));
	});

	it('changes a length and a start in place, and adds a missing start in the key order', () => {
		const body = ok(RICH, { kind: 'edit-calendar', index: 0, fields: { length: 30, start: 5 } });
		expect(calendars(body)[0].kind).toEqual({ type: 'cycles', length: 30, start: 5 });
		expect(lines(body).filter((l, i) => l !== lines(RICH)[i])).toEqual(['    length: 30', '    start: 5']);
		const noStart = ok('calendars:\n  - {name: A, kind: cycles, length: 5, formats: ["{cycle}.{year}"]}\n', { kind: 'edit-calendar', index: 0, fields: { start: 7 } });
		expect(calendars(noStart)[0].kind).toEqual({ type: 'cycles', length: 5, start: 7 });
	});

	it('changes the formats (a flow list), and keeps the unknown keys and the comments around', () => {
		const body = ok(RICH, { kind: 'edit-calendar', index: 0, fields: { formats: ['Cycle {cycle}, year {year}'] } });
		expect(calendars(body)[0].formats).toEqual(['Cycle {cycle}, year {year}']);
		expect(body).toContain('notes: "kept by the monks"');
		expect(comments(body)).toEqual(comments(RICH));
	});

	it('refuses to change the formats of a block list that has comments inside, instead of losing a comment', () => {
		const text = 'calendars:\n  - name: A\n    kind: eras\n    formats:\n      # the main one\n      - "{era} {year}"\n';
		const r = editCalendarBlock(text, { kind: 'edit-calendar', index: 0, fields: { formats: ['{year} {era}'] } });
		expect(r.ok).toBe(false);
	});

	it('writes nothing when the value is the one written', () => {
		expect(ok(RICH, { kind: 'edit-calendar', index: 0, fields: { name: 'The Long Count', length: 60, start: 1, formats: ['{year} Year of the {cycle} Cycle', 'Year {year} of Cycle {cycle}'] } })).toBe(RICH);
	});

	it('a calendar of a flow item changes in the flow item', () => {
		const body = ok(RICH, { kind: 'edit-calendar', index: 2, fields: { name: 'Shorter', length: 10 } });
		expect(lines(body).find((l) => l.includes('Shorter'))).toBe('  - {name: Shorter, kind: cycles, length: 10, start: -3, formats: ["Cycle {cycle} year {year}"]}');
	});

	it('refuses a length or a start for an era calendar, a bad value and an index that names nothing', () => {
		const refuses = (op: CalendarOp) => expect(editCalendarBlock(DOC, op).ok, JSON.stringify(op)).toBe(false);
		refuses({ kind: 'edit-calendar', index: 1, fields: { length: 5 } });
		refuses({ kind: 'edit-calendar', index: 1, fields: { start: 5 } });
		refuses({ kind: 'edit-calendar', index: 0, fields: { length: 0 } });
		refuses({ kind: 'edit-calendar', index: 0, fields: { length: 1.5 } });
		refuses({ kind: 'edit-calendar', index: 0, fields: { start: NaN } });
		refuses({ kind: 'edit-calendar', index: 0, fields: { name: '  ' } });
		refuses({ kind: 'edit-calendar', index: 0, fields: { formats: [3 as unknown as string] } });
		refuses({ kind: 'edit-calendar', index: 9, fields: { name: 'X' } });
		refuses({ kind: 'edit-calendar', index: -1, fields: { name: 'X' } });
	});
});

describe('editCalendarBlock: remove a calendar', () => {
	it('removes the calendar with its lines and the comments above it, and keeps the rest', () => {
		const body = ok(RICH, { kind: 'remove-calendar', index: 1 });
		expect(calendars(body).map((c) => c.name)).toEqual(['The Long Count', 'Short']);
		expect(comments(body)).toEqual(['# Calendars of the Far Land', '# not read by the plugin', '# the old count of the south', '# the first calendar']);
		expect(body).toContain('version: 3');
		expect(body).not.toContain('annals');
	});

	it('removes the last calendar and leaves `calendars: []` and the other keys', () => {
		const one = 'version: 1 # keep\ncalendars:\n  - {name: A, kind: cycles, length: 5, start: 1, formats: []}\n';
		const body = ok(one, { kind: 'remove-calendar', index: 0 });
		expect(body).toBe('version: 1 # keep\ncalendars: []\n');
		expect(parseCalendarBlock(body, 'C.md', 0)).toEqual({ calendars: [], issues: [] });
		const block = ok(DOC, { kind: 'remove-calendar', index: 0 });
		expect(calendars(ok(block, { kind: 'remove-calendar', index: 0 }))).toEqual([]);
	});

	it('refuses an index that names nothing', () => {
		expect(editCalendarBlock(DOC, { kind: 'remove-calendar', index: 2 }).ok).toBe(false);
		expect(editCalendarBlock('', { kind: 'remove-calendar', index: 0 }).ok).toBe(false);
	});
});

describe('editCalendarBlock: eras', () => {
	it('adds an era to the end of a block list of one-line eras, in the same style', () => {
		const body = ok(DOC, { kind: 'add-era', calendar: 1, era: { name: 'Kaiyuan', start: 200, length: 30 } });
		expect(body).toBe(DOC + '      - {name: Kaiyuan, start: 200, length: 30}\n');
		expect(calendars(body)[1].kind).toEqual({ type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 130, length: 11 }, { name: 'Jianwen Emperor', start: 141 }, { name: 'Kaiyuan', start: 200, length: 30 }] });
	});

	it('adds an era after a block-map era, keeping the comments that follow the list', () => {
		const body = ok(RICH, { kind: 'add-era', calendar: 1, era: { name: 'Third', start: 150 } });
		expect(calendars(body)[1].kind).toMatchObject({ type: 'eras', eras: [{ name: 'Qinglong Emperor' }, { name: 'Jianwen Emperor' }, { name: 'Third', start: 150 }] });
		expect(comments(body)).toEqual(comments(RICH));
		expect(body).toContain('  - {name: Short');
	});

	it('adds the first era to an empty list, to a missing `eras` key and to a flow list', () => {
		const one = (eras: string) => `calendars:\n  - name: E\n    kind: eras\n    formats: ["{era} {year}"]${eras}\n`;
		for (const eras of ['', '\n    eras:', '\n    eras: []']) {
			const body = ok(one(eras), { kind: 'add-era', calendar: 0, era: { name: 'First', start: 1 } });
			expect(calendars(body)[0].kind, eras).toEqual({ type: 'eras', eras: [{ name: 'First', start: 1 }] });
		}
		const flow = ok('calendars:\n  - {name: E, kind: eras, formats: ["{era} {year}"], eras: [{name: A, start: 1}]}\n', { kind: 'add-era', calendar: 0, era: { name: 'B', start: 5 } });
		expect(calendars(flow)[0].kind).toEqual({ type: 'eras', eras: [{ name: 'A', start: 1 }, { name: 'B', start: 5 }] });
	});

	it('changes the name, the start and the length of an era, and removes a length with null', () => {
		const body = ok(RICH, { kind: 'edit-era', calendar: 1, era: 0, fields: { name: 'Qinglong', start: 131, length: 12 } });
		expect(body).toContain('- {name: Qinglong, start: 131, length: 12} # eleven years');
		const noLength = ok(RICH, { kind: 'edit-era', calendar: 1, era: 0, fields: { length: null } });
		expect(noLength).toContain('- {name: Qinglong Emperor, start: 130} # eleven years');
		const second = ok(RICH, { kind: 'edit-era', calendar: 1, era: 1, fields: { length: 9, start: 142 } });
		expect(calendars(second)[1].kind).toMatchObject({ eras: [{ start: 130 }, { name: 'Jianwen Emperor', start: 142, length: 9 }] });
		expect(second).toContain('source: the second annals');
		expect(comments(second)).toEqual(comments(RICH));
	});

	it('removes an era with its lines, and the last era leaves `eras: []`', () => {
		const body = ok(RICH, { kind: 'remove-era', calendar: 1, era: 1 });
		expect(calendars(body)[1].kind).toMatchObject({ eras: [{ name: 'Qinglong Emperor' }] });
		expect(body).not.toContain('second annals');
		const none = ok(body, { kind: 'remove-era', calendar: 1, era: 0 });
		expect(none).toContain('eras: []');
		expect(calendars(none)[1].kind).toEqual({ type: 'eras', eras: [] });
		expect(calendars(none).map((c) => c.name)).toEqual(['The Long Count', 'Reign names', 'Short']);
	});

	it('refuses eras of a cycle calendar, a bad era and a place that names nothing', () => {
		const refuses = (op: CalendarOp) => expect(editCalendarBlock(DOC, op).ok, JSON.stringify(op)).toBe(false);
		refuses({ kind: 'add-era', calendar: 0, era: { name: 'X', start: 1 } });
		refuses({ kind: 'add-era', calendar: 1, era: { name: '', start: 1 } });
		refuses({ kind: 'add-era', calendar: 1, era: { name: 'X', start: 1.5 } });
		refuses({ kind: 'add-era', calendar: 1, era: { name: 'X', start: 1, length: 0 } });
		refuses({ kind: 'add-era', calendar: 5, era: { name: 'X', start: 1 } });
		refuses({ kind: 'edit-era', calendar: 1, era: 5, fields: { name: 'X' } });
		refuses({ kind: 'edit-era', calendar: 1, era: 0, fields: { name: '' } });
		refuses({ kind: 'edit-era', calendar: 1, era: 0, fields: { length: 0 } });
		refuses({ kind: 'remove-era', calendar: 1, era: 5 });
		refuses({ kind: 'remove-era', calendar: 0, era: 0 });
	});
});

describe('editCalendarBlock: the data check and the refusals', () => {
	it('refuses a block that is not YAML or whose `calendars` is not a list, and never throws', () => {
		const c = { name: 'A', kind: 'cycles' as const, length: 5, formats: [] };
		expect(editCalendarBlock('calendars: [\n', { kind: 'add-calendar', calendar: c }).ok).toBe(false);
		expect(editCalendarBlock('calendars: text\n', { kind: 'add-calendar', calendar: c }).ok).toBe(false);
		expect(editCalendarBlock('calendars:\n  name: X\n', { kind: 'add-calendar', calendar: c }).ok).toBe(false);
		for (const bad of [null, undefined, {}, { kind: 'nothing' }, { kind: 'add-calendar' }, { kind: 'add-calendar', calendar: null }, { kind: 'edit-era' }]) {
			expect(() => editCalendarBlock(DOC, bad as unknown as CalendarOp)).not.toThrow();
			expect(editCalendarBlock(DOC, bad as unknown as CalendarOp).ok).toBe(false);
		}
		expect(() => editCalendarBlock(null as unknown as string, { kind: 'remove-calendar', index: 0 })).not.toThrow();
	});

	it('refuses a new calendar with no name, a wrong kind, formats that are not text or a length below 1', () => {
		const base = { name: 'A', kind: 'cycles' as const, length: 5, formats: ['{cycle} {year}'] };
		const refuses = (c: object) => expect(editCalendarBlock(DOC, { kind: 'add-calendar', calendar: { ...base, ...c } as never }).ok, JSON.stringify(c)).toBe(false);
		refuses({ name: '' });
		refuses({ kind: 'stars' });
		refuses({ formats: 'x' });
		refuses({ formats: [1] });
		refuses({ length: 0 });
		refuses({ length: undefined });
		refuses({ start: 1.5 });
		refuses({ kind: 'eras', eras: [{ name: '', start: 1 }] });
	});

	it('an alias for a calendar item is refused with a plain sentence (edit the note text)', () => {
		const r = editCalendarBlock('calendars:\n  - &a {name: A, kind: cycles, length: 5, formats: []}\n  - *a\n', { kind: 'edit-calendar', index: 1, fields: { name: 'B' } });
		expect(r.ok).toBe(false);
	});

	it('a CRLF block keeps its line ending', () => {
		const crlf = DOC.replace(/\n/g, '\r\n');
		const body = ok(crlf, { kind: 'edit-calendar', index: 0, fields: { name: 'The Old Count' } });
		expect(body.replace(/\r\n/g, '').includes('\n')).toBe(false);
		expect(calendars(body)[0].name).toBe('The Old Count');
	});
});

describe('round trip: any chain of edits reads back as the expected calendars and keeps every comment and unknown key', () => {
	/** The expected state of the chain, kept as plain data and compared with what the block reads back. */
	interface Model {
		name: string;
		kind: 'cycles' | 'eras';
		length: number;
		start: number;
		formats: string[];
		eras: { name: string; start: number; length?: number }[];
	}
	const asCalendar = (m: Model, i: number): Calendar => ({
		id: `Calendars.md#0#${i}`,
		name: m.name,
		note: 'Calendars.md',
		formats: m.formats,
		kind: m.kind === 'cycles' ? { type: 'cycles', length: m.length, start: m.start } : { type: 'eras', eras: m.eras },
	});

	it('60 random chains of 12 edits on the rich block: the calendars read back as expected, and no comment or unknown key is lost', () => {
		let applied = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const next = rng(seed);
			const pick = (n: number) => Math.floor(next() * n);
			// `added` marks what the chain made itself: only that is removed, so the comments and keys of the rich block must all stay.
			const model: (Model & { added: boolean; addedEras: boolean[] })[] = calendars(RICH).map((c) => ({
				name: c.name,
				kind: c.kind.type,
				length: c.kind.type === 'cycles' ? c.kind.length : 0,
				start: c.kind.type === 'cycles' ? c.kind.start : 0,
				formats: c.formats,
				eras: c.kind.type === 'eras' ? c.kind.eras.map((e) => ({ ...e })) : [],
				added: false,
				addedEras: c.kind.type === 'eras' ? c.kind.eras.map(() => false) : [],
			}));
			let body = RICH;
			for (let step = 0; step < 12; step++) {
				const i = pick(model.length + 1);
				const m = model[i];
				const label = `seed ${seed} step ${step}`;
				let op: CalendarOp;
				const choice = pick(7);
				if (choice === 0 || !m) {
					const kind: 'cycles' | 'eras' = next() < 0.5 ? 'cycles' : 'eras';
					const eras = kind === 'eras' ? [{ name: `Era ${step}`, start: pick(900) }] : [];
					const fresh = { name: `Cal ${seed}-${step}`, kind, length: 5 + pick(50), start: pick(300) - 100, formats: [kind === 'cycles' ? `{cycle}-${step} {year}` : `{era} ${step} {year}`], eras, added: true, addedEras: eras.map(() => true) };
					op = { kind: 'add-calendar', calendar: { name: fresh.name, kind, formats: fresh.formats, ...(kind === 'cycles' ? { length: fresh.length, start: fresh.start } : { eras }) } };
					model.push(fresh);
				} else if (choice === 1 && m.added) {
					op = { kind: 'remove-calendar', index: i };
					model.splice(i, 1);
				} else if (choice === 2) {
					m.name = `${m.name.split(' #')[0]} #${step}`;
					op = { kind: 'edit-calendar', index: i, fields: { name: m.name } };
				} else if (choice === 3 && m.kind === 'cycles') {
					m.length = 2 + pick(80);
					m.start = pick(400) - 200;
					op = { kind: 'edit-calendar', index: i, fields: { length: m.length, start: m.start } };
				} else if (choice === 4 && m.kind === 'eras') {
					const era = { name: `Added ${step}`, start: pick(2000) - 500, ...(next() < 0.5 ? { length: 1 + pick(40) } : {}) };
					m.eras.push(era);
					m.addedEras.push(true);
					op = { kind: 'add-era', calendar: i, era };
				} else if (choice === 5 && m.kind === 'eras' && m.eras.length) {
					const e = pick(m.eras.length);
					const length = next() < 0.4 ? null : 1 + pick(30);
					m.eras[e] = { name: `${m.eras[e].name.split(' (')[0]} (${step})`, start: pick(2000), ...(length === null ? {} : { length }) };
					op = { kind: 'edit-era', calendar: i, era: e, fields: { name: m.eras[e].name, start: m.eras[e].start, length } };
				} else if (choice === 6 && m.kind === 'eras' && m.addedEras.some(Boolean)) {
					const e = m.addedEras.lastIndexOf(true);
					m.eras.splice(e, 1);
					m.addedEras.splice(e, 1);
					op = { kind: 'remove-era', calendar: i, era: e };
				} else continue;
				const r = editCalendarBlock(body, op);
				if (!r.ok) throw new Error(`${label}: ${r.code} ${r.detail}\n${JSON.stringify(op)}\n${body}`);
				body = r.body;
				applied++;
				expect(calendars(body), label).toEqual(model.map(asCalendar));
			}
			expect(comments(body), `seed ${seed}`).toEqual(comments(RICH));
			for (const kept of ['version: 3', 'notes: "kept by the monks"', 'source: the annals', 'source: the second annals']) expect(body, `seed ${seed}`).toContain(kept);
			expect(parseCalendarBlock(body, 'Calendars.md', 0).issues, `seed ${seed}`).toEqual([]);
		}
		// Most of the 720 steps chose an edit that fits the state.
		expect(applied).toBeGreaterThan(350);
	}, 30000);
});
