// Spec §14 rule 13 (WP-6 step 1): the name lists in the `kin-calendar` block: reading, bad shapes, and the edits of the window with
// comments, unknown keys, quoting and styles kept.
import { describe, expect, it } from 'vitest';
import { CALENDAR_ORDER, editCalendarBlock, LIST_ORDER, parseCalendarBlock, type CalendarOp } from '../src/core/calendar-block';
import { compileCalendars, type NameList } from '../src/core/dates';
import { issueText } from '../src/core/messages';
import { commentsOf } from '../src/core/yaml-patch';
import { list } from './dates-support/names';

const read = (body: string) => parseCalendarBlock(body, 'Calendars.md', 0);
const apply = (body: string, op: CalendarOp): string => {
	const r = editCalendarBlock(body, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	// The new body reads without an issue, and every comment survives. A format that keeps a marker place that no list has now is the one issue the edit may leave.
	expect(read(r.body).issues.filter((i) => (i.params as { why?: string }).why !== 'marker')).toEqual([]);
	return r.body;
};
const refused = (body: string, op: CalendarOp) => {
	const r = editCalendarBlock(body, op);
	expect(r.ok, JSON.stringify(op)).toBe(false);
	return r.ok ? '' : (r.detail ?? '');
};
const plain = (over: Partial<NameList> = {}) => list({ marker: undefined, ...over });

/** The block of spec §14 rule 13. */
const BLOCK = `calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1
    formats: ["{cycle}.{year} {planet}", "{year} Year of the {cycle} Cycle"]
    lists:
      - name: Planets
        marker: planet
        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
        known: {year: 1273, index: 0}
        show: short
plain:
  lists:
    - name: Planets
      names:
        - {name: Saturn, short: Sa}
      known: {year: 1273, index: 0}
      show: short
`;

/** A block with a comment on every kind of place, unknown keys and the three styles. */
const RICH = `# Calendars of the Far Land
version: 3 # not read by the plugin
calendars:
  # the old count of the south
  - name: The Long Count # the first calendar
    kind: cycles
    length: 60
    start: 1
    notes: "kept by the monks"
    formats: ["{cycle}.{year} {planet}"]
    lists:
      # planets
      - name: Planets # seven of them
        marker: planet
        source: the annals
        names:
          - {name: Saturn, short: Sa} # first
          - {name: Jupiter, short: Ju}
        known: {year: 1273, index: 0}
        show: short
  - {name: Short, kind: cycles, length: 12, start: -3, formats: ["Cycle {cycle} year {year}"]}
plain: # the plain years
  tag: old
  lists:
    - name: Planets
      names: [{name: Saturn, short: Sa}]
      known: {year: 1273, index: 0}
      show: full
`;

describe('§14 rule 13: reading the lists', () => {
	it('reads the lists of a calendar and of the plain years', () => {
		const r = read(BLOCK);
		expect(r.issues).toEqual([]);
		expect(r.calendars).toHaveLength(1);
		expect(r.calendars[0].lists).toEqual([
			{ name: 'Planets', marker: 'planet', names: [{ name: 'Saturn', short: 'Sa' }, { name: 'Jupiter', short: 'Ju' }], known: { year: 1273, index: 0 }, show: 'short' },
		]);
		expect(r.plain).toEqual([{ name: 'Planets', names: [{ name: 'Saturn', short: 'Sa' }], known: { year: 1273, index: 0 }, show: 'short' }]);
	});

	it('a calendar without lists keeps the shape of 0.3.2, and the block without plain has no plain', () => {
		const r = read('calendars:\n  - {name: A, kind: cycles, length: 5, start: 1, formats: ["{cycle}.{year}"]}\n');
		expect(r.calendars[0]).not.toHaveProperty('lists');
		expect(r).not.toHaveProperty('plain');
		expect(read('calendars:\n  - {name: A, kind: cycles, length: 5, start: 1, formats: ["{cycle}.{year}"], lists: []}\n').calendars[0]).not.toHaveProperty('lists');
	});

	it('a block with only plain is valid and a calendar block', () => {
		const r = read('plain:\n  lists:\n    - {name: P, names: [A, B], known: {year: 5, index: 1}}\n');
		expect(r.issues).toEqual([]);
		expect(r.calendars).toEqual([]);
		expect(r.plain).toEqual([{ name: 'P', names: [{ name: 'A' }, { name: 'B' }], known: { year: 5, index: 1 }, show: 'short' }]);
		expect(read('plain:\n').plain).toEqual([]);
		expect(read('plain: {}\n').plain).toEqual([]);
		expect(read('calendars: []\nplain:\n  lists: []\n').plain).toEqual([]);
	});

	it('a block with neither calendars nor plain is still invalid; a plain that is not a map gives an issue', () => {
		expect(read('other: 1\n').issues.map((i) => i.code)).toEqual(['calendar-block-invalid']);
		const bad = read('plain: nonsense\n');
		expect(bad.calendars).toEqual([]);
		expect(bad.plain).toEqual([]);
		expect(bad.issues.map((i) => i.code)).toEqual(['calendar-list-invalid']);
		expect(read('calendars: 5\nplain:\n  lists: []\n').issues.map((i) => i.code)).toEqual(['calendar-block-invalid']);
	});

	it('show is short when it is missing or wrong', () => {
		const shows = (show: string) => read(`plain:\n  lists:\n    - {name: P, names: [A], known: {year: 1, index: 0}${show}}\n`).plain![0].show;
		expect(shows('')).toBe('short');
		expect(shows(', show: loud')).toBe('short');
		expect(shows(', show: Full')).toBe('full');
		expect(shows(', show: none')).toBe('none');
	});

	it('a list with a bad shape keeps its place with no usable names, and gives an issue; the others are read', () => {
		const body = `calendars:
  - name: C
    kind: cycles
    length: 60
    formats: ["{cycle}.{year} {planet}"]
    lists:
      - {name: NoNames, marker: planet, names: [], known: {year: 1, index: 0}}
      - {name: Good, marker: animal, names: [A], known: {year: 1, index: 0}}
      - {name: OutOfRange, marker: m3, names: [A, B], known: {year: 1, index: 2}}
      - {name: NotWhole, marker: m4, names: [A], known: {year: 1.5, index: 0}}
      - 7
      - {name: NoKnown, marker: m6, names: [A]}
      - {name: NoName, marker: m7, names: [{short: x}], known: {year: 1, index: 0}}
`;
		const r = read(body);
		const lists = r.calendars[0].lists!;
		expect(lists).toHaveLength(7);
		expect(lists.map((l) => l.name)).toEqual(['NoNames', 'Good', 'OutOfRange', 'NotWhole', '', 'NoKnown', 'NoName']);
		expect(lists[1].names).toEqual([{ name: 'A' }]);
		expect(lists[0].names).toEqual([]);
		expect(lists[2].known).toEqual({ year: 1, index: 2 });
		expect(Number.isNaN(lists[3].known.year)).toBe(true);
		expect(r.issues.map((i) => i.code)).toEqual(Array(6).fill('calendar-list-invalid'));
		expect(r.issues.map((i) => (i.params as { index: number }).index)).toEqual([1, 3, 4, 5, 6, 7]);
		// Only the usable list reads; the marker of a list that is skipped keeps its place, so the base form still reads the date.
		const reader = compileCalendars(r.calendars, true);
		expect(reader.hasLists).toBe(true);
		expect(reader.read('2.1')?.year).toBe(61);
		expect(reader.read('2.1')?.names?.map((n) => n.list)).toEqual(['Good']);
	});

	it('lists that are not a list, and a calendar that is skipped adds no list issue', () => {
		const r = read('calendars:\n  - {name: C, kind: cycles, length: 60, formats: ["{cycle}.{year}"], lists: nonsense}\n  - {name: Z, kind: weeks, lists: nonsense}\n');
		expect(r.calendars[0]).not.toHaveProperty('lists');
		expect(r.issues.map((i) => [i.code, (i.params as { why: string }).why])).toEqual([['calendar-list-invalid', 'lists'], ['calendar-entry-invalid', 'kind']]);
	});

	it('the issue texts name the list, the calendar and the note', () => {
		const text = (params: Record<string, string | number>) => issueText({ code: 'calendar-list-invalid', level: 'warning', params });
		expect(text({ note: 'Calendars.md', calendar: 'The Long Count', index: 2, why: 'names' })).toBe('Name list 2 of the calendar “The Long Count” in the note “Calendars.md” cannot be used. The reason is that it has no names, or a name is not text. The plugin ignores it. Edit the text of the block in the note.');
		expect(text({ note: 'Calendars.md', index: 1, why: 'known' })).toContain('of the plain years');
		expect(text({ note: 'Calendars.md', index: 0, why: 'lists' })).toBe('The name lists of the plain years in the note “Calendars.md” cannot be used. The reason is that they are not a list. A list has one item on each text line, after a “-”. The plugin ignores them. Edit the text of the block in the note.');
		expect(text({})).not.toMatch(/undefined|NaN|null/);
	});

	it('never throws for strange input', () => {
		for (const body of ['', 'calendars:\n  - {name: A, kind: cycles, length: 1, lists: [[[]]]}\n', 'plain:\n  lists: [null, [], {names: {a: 1}}]\n', 'plain: [1, 2]\n', '{{{', 'calendars:\n  - name: A\n    kind: eras\n    lists:\n      - names: 5\n']) {
			expect(() => read(body)).not.toThrow();
		}
		expect(() => parseCalendarBlock(undefined as never, 'x', 0)).not.toThrow();
	});

	it('the write order of a calendar and of a list', () => {
		// `docs/format.md` lists the keys of CALENDAR_ORDER, `lists` last (spec §14 rule 13).
		expect(CALENDAR_ORDER).toEqual(['name', 'kind', 'length', 'start', 'formats', 'eras', 'lists']);
		expect(LIST_ORDER).toEqual(['name', 'marker', 'names', 'known', 'show']);
	});
});

describe('§14 rule 13: writing the lists', () => {
	it('adds a list to a calendar that has lists, in the style of the existing ones', () => {
		const out = apply(BLOCK, { kind: 'add-list', calendar: 0, list: list({ name: 'Animals', marker: 'animal', names: [{ name: 'Rat' }, { name: 'Ox', short: 'Ox' }], known: { year: 1273, index: 1 }, show: 'full' }) });
		expect(out).toContain(`        known: {year: 1273, index: 0}
        show: short
      - name: Animals
        marker: animal
        names:
          - {name: Rat}
          - {name: Ox, short: Ox}
        known: {year: 1273, index: 1}
        show: full
plain:`);
		expect(read(out).calendars[0].lists!.map((l) => l.name)).toEqual(['Planets', 'Animals']);
		expect(out.replace(/      - name: Animals[\s\S]*?show: full\n/, '')).toBe(BLOCK);
	});

	it('adds the first list to a calendar after its eras, in a block map and in a flow map', () => {
		const eraBlock = 'calendars:\n  - name: R\n    kind: eras\n    formats: ["{era} {year}"]\n    eras:\n      - {name: Qing, start: 130}\n  - {name: S, kind: cycles, length: 12, start: 1, formats: ["{cycle}.{year}"]}\n';
		const one = apply(eraBlock, { kind: 'add-list', calendar: 0, list: list() });
		expect(one).toContain('      - {name: Qing, start: 130}\n    lists:\n      - name: Planets\n        marker: planet\n        names:\n          - {name: Saturn, short: Sa}');
		const flow = apply(eraBlock, { kind: 'add-list', calendar: 1, list: list() });
		expect(flow).toContain('formats: ["{cycle}.{year}"], lists: [{name: Planets, marker: planet, names: [{name: Saturn, short: Sa}');
		expect(read(flow).calendars[1].lists).toHaveLength(1);
		expect(read(one).calendars[0].lists).toEqual([list()]);
	});

	it('adds a list to the plain years: with a plain key, with a plain key without lists, and with no plain key', () => {
		const withPlain = apply(BLOCK, { kind: 'add-list', calendar: 'plain', list: plain({ name: 'Animals', names: [{ name: 'Rat' }], known: { year: 5, index: 0 } }) });
		expect(read(withPlain).plain!.map((l) => l.name)).toEqual(['Planets', 'Animals']);
		expect(withPlain).toContain('      show: short\n    - name: Animals\n      names:\n        - {name: Rat}\n      known: {year: 5, index: 0}\n      show: short\n');
		const none = apply('calendars:\n  - {name: A, kind: cycles, length: 5, start: 1, formats: ["{cycle}.{year}"]}\n', { kind: 'add-list', calendar: 'plain', list: plain() });
		expect(none).toBe('calendars:\n  - {name: A, kind: cycles, length: 5, start: 1, formats: ["{cycle}.{year}"]}\n\nplain:\n  lists:\n    - name: Planets\n      names:\n        - {name: Saturn, short: Sa}\n        - {name: Jupiter, short: Ju}\n        - {name: Mars, short: Ma}\n        - {name: Sun, short: Su}\n        - {name: Venus, short: Ve}\n        - {name: Mercury, short: Me}\n        - {name: Moon, short: Mo}\n      known: {year: 1273, index: 0}\n      show: short\n');
		const empty = apply('plain:\n', { kind: 'add-list', calendar: 'plain', list: plain({ names: [{ name: 'A' }], known: { year: 1, index: 0 } }) });
		expect(read(empty).plain).toEqual([plain({ names: [{ name: 'A' }], known: { year: 1, index: 0 } })]);
		const noLists = apply('plain:\n  note: x\n', { kind: 'add-list', calendar: 'plain', list: plain({ names: [{ name: 'A' }], known: { year: 1, index: 0 } }) });
		expect(noLists).toContain('plain:\n  note: x\n  lists:\n    - name: Planets');
		expect(read(noLists).plain).toHaveLength(1);
		// A body with no text at all: a note that is only a plain block.
		expect(read(apply('', { kind: 'add-list', calendar: 'plain', list: plain() })).plain).toHaveLength(1);
		expect(read(apply('# only a comment\n', { kind: 'add-list', calendar: 'plain', list: plain() })).plain).toHaveLength(1);
	});

	it('adds a list to a calendar that has `lists: []`', () => {
		const out = apply('calendars:\n  - name: A\n    kind: cycles\n    length: 5\n    formats: ["{cycle}.{year}"]\n    lists: []\n', { kind: 'add-list', calendar: 0, list: list() });
		expect(read(out).calendars[0].lists).toEqual([list()]);
	});

	it('edits a field of a list and writes nothing for a value that is the same', () => {
		expect(editCalendarBlock(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { name: 'Planets', marker: 'planet', show: 'short', known: { year: 1273, index: 0 }, names: [{ name: 'Saturn', short: 'Sa' }, { name: 'Jupiter', short: 'Ju' }] } })).toEqual({ ok: true, body: BLOCK, created: [] });
		// The same known year written in another order is the same.
		const swapped = BLOCK.replace('{year: 1273, index: 0}\n        show', '{index: 0, year: 1273}\n        show');
		expect(editCalendarBlock(swapped, { kind: 'edit-list', calendar: 0, list: 0, fields: { known: { year: 1273, index: 0 } } })).toEqual({ ok: true, body: swapped, created: [] });
		const show = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { show: 'none' } });
		expect(show).toBe(BLOCK.replace('        show: short\nplain:', '        show: none\nplain:'));
		const name = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { name: 'The seven', marker: '{wanderer}' } });
		expect(read(name).calendars[0].lists![0]).toMatchObject({ name: 'The seven', marker: 'wanderer' });
		// The format still names {planet}: the note reads, and says that no list has that marker.
		expect(read(name).issues.map((i) => i.params)).toMatchObject([{ why: 'marker', marker: 'planet' }]);
		const known = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { known: { year: -5, index: 1 } } });
		expect(known).toContain('known: {year: -5, index: 1}');
		expect(read(known).calendars[0].lists![0].known).toEqual({ year: -5, index: 1 });
	});

	it('edits the names of a list (block and flow style) and the plain years', () => {
		const names = [{ name: 'Moon' }, { name: 'Sun', short: 'Su' }, { name: 'Venus' }];
		const out = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { names, known: { year: 1273, index: 2 } } });
		expect(out).toContain('        names:\n          - {name: Moon}\n          - {name: Sun, short: Su}\n          - {name: Venus}\n        known: {year: 1273, index: 2}\n');
		expect(read(out).calendars[0].lists![0].names).toEqual(names);
		const flow = apply(RICH, { kind: 'edit-list', calendar: 'plain', list: 0, fields: { names: [{ name: 'Moon' }, { name: 'Sun' }], known: { year: 5, index: 1 } } });
		expect(read(flow).plain![0]).toMatchObject({ names: [{ name: 'Moon' }, { name: 'Sun' }], known: { year: 5, index: 1 }, show: 'full' });
		expect(flow).toContain('tag: old');
	});

	it('removes a marker', () => {
		const out = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { marker: null } });
		expect(out).not.toContain('marker: planet');
		expect(read(out).calendars[0].lists![0]).not.toHaveProperty('marker');
		expect(read(out).issues.map((i) => i.params)).toMatchObject([{ why: 'marker', marker: 'planet' }]);
	});

	it('removes a list; the last one leaves `lists: []`', () => {
		const two = apply(BLOCK, { kind: 'add-list', calendar: 0, list: list({ name: 'Animals', marker: 'animal' }) });
		const first = apply(two, { kind: 'remove-list', calendar: 0, list: 0 });
		expect(read(first).calendars[0].lists!.map((l) => l.name)).toEqual(['Animals']);
		const none = apply(first, { kind: 'remove-list', calendar: 0, list: 0 });
		expect(none).toContain('    lists: []\n');
		expect(read(none).calendars[0]).not.toHaveProperty('lists');
		expect(read(none).issues.map((i) => i.params)).toMatchObject([{ why: 'marker', marker: 'planet' }]);
		const noPlain = apply(BLOCK, { kind: 'remove-list', calendar: 'plain', list: 0 });
		expect(noPlain).toContain('plain:\n  lists: []\n');
		expect(read(noPlain).plain).toEqual([]);
		// The note still counts as a calendar note.
		expect(read(apply('plain:\n  lists:\n    - {name: P, names: [A], known: {year: 1, index: 0}}\n', { kind: 'remove-list', calendar: 'plain', list: 0 })).plain).toEqual([]);
	});

	it('keeps every comment, order, unknown key and style that the edit does not touch', () => {
		const before = commentsOf(RICH).map((c) => c.text);
		const steps: CalendarOp[] = [
			{ kind: 'edit-list', calendar: 0, list: 0, fields: { show: 'full' } },
			{ kind: 'edit-list', calendar: 0, list: 0, fields: { known: { year: 1273, index: 1 } } },
			{ kind: 'add-list', calendar: 0, list: list({ name: 'Animals', marker: 'animal' }) },
			{ kind: 'add-list', calendar: 1, list: list({ name: 'Animals', marker: 'animal' }) },
			{ kind: 'add-list', calendar: 'plain', list: plain({ name: 'Animals' }) },
			{ kind: 'edit-list', calendar: 'plain', list: 0, fields: { show: 'none' } },
		];
		let body = RICH;
		for (const op of steps) body = apply(body, op);
		const after = commentsOf(body).map((c) => c.text);
		expect(after).toEqual(before);
		for (const kept of ['version: 3 # not read by the plugin', 'notes: "kept by the monks"', 'source: the annals', '  tag: old', '- {name: Short, kind: cycles, length: 12, start: -3, formats: ["Cycle {cycle} year {year}"], lists: [{name: Animals']) expect(body).toContain(kept);
		const r = read(body);
		expect(r.calendars[0].lists!.map((l) => [l.name, l.show])).toEqual([['Planets', 'full'], ['Animals', 'short']]);
		expect(r.calendars[0].lists![0].known).toEqual({ year: 1273, index: 1 });
		expect(r.plain!.map((l) => [l.name, l.show])).toEqual([['Planets', 'none'], ['Animals', 'short']]);
		// Removing the lists again gives the calendars back.
		let back = body;
		for (const op of [{ kind: 'remove-list', calendar: 0, list: 1 }, { kind: 'remove-list', calendar: 1, list: 0 }, { kind: 'remove-list', calendar: 'plain', list: 1 }] as CalendarOp[]) back = apply(back, op);
		expect(read(back).calendars[1]).not.toHaveProperty('lists');
	});

	it('refuses to replace names that carry a comment, and replaces names that carry none', () => {
		const names = [{ name: 'Saturn', short: 'Sa' }, { name: 'Jupiter', short: 'Ju' }, { name: 'Mars' }];
		expect(refused(RICH, { kind: 'edit-list', calendar: 0, list: 0, fields: { names } })).toBe('The change cannot be written without a change to a comment. Edit the note text.');
		const clean = apply(RICH.replace(' # first', ''), { kind: 'edit-list', calendar: 0, list: 0, fields: { names } });
		expect(read(clean).calendars[0].lists![0].names).toEqual(names);
		expect(commentsOf(clean).map((c) => c.text)).toEqual(commentsOf(RICH).map((c) => c.text).filter((c) => c !== '# first'));
	});

	it('writes text as text: quotes a number, a yes/no word, a colon, a comma, a hash and a leading space', () => {
		// A short form has no comma (the text field could not read it back, spec §14 rule 16), so the short form of "Mary, Queen" is "Mary Queen.".
		const trickyName = (name: string, i: number) => (i % 2 ? { name, short: `${name.replace(',', '')}.` } : { name });
		const tricky = ['Yes', 'No', 'on', 'null', '7', '1st', '-3', '.5', 'a: b', 'Mary, Queen', 'a # b', '[x]', '{y}', '*star', '&anchor', "it's", 'say "hi"', 'Ünïcode 行', 'x:'];
		const out = apply(BLOCK, { kind: 'add-list', calendar: 0, list: list({ name: 'Tricky', marker: 'tricky', names: tricky.map(trickyName), known: { year: 1, index: 0 } }) });
		const lists = read(out).calendars[0].lists!;
		expect(lists[1].names).toEqual(tricky.map(trickyName));
		expect(out).toContain('{name: "Yes"}');
		expect(out).toContain('{name: "7"');
		expect(out).toContain('{name: "No", short: No.}');
		expect(out).toContain('"a: b"');
		expect(out).toContain('{name: Ünïcode 行');
		const named = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { name: 'Yes' } });
		expect(named).toContain('      - name: "Yes"\n        marker: planet');
		expect(read(named).calendars[0].lists![0].name).toBe('Yes');
	});

	it('writes a number for the known year with its sign, also for a large year', () => {
		const big = 9_000_000_000_000_000;
		const out = apply(BLOCK, { kind: 'edit-list', calendar: 0, list: 0, fields: { known: { year: -big, index: 1 } } });
		expect(read(out).calendars[0].lists![0].known).toEqual({ year: -big, index: 1 });
	});

	it('add-calendar writes the lists of a new calendar with it; the data is checked by reading it back', () => {
		const out = apply('', {
			kind: 'add-calendar',
			calendar: { name: 'Far', kind: 'cycles', formats: ['{cycle}.{year} {planet}'], length: 60, start: 1, lists: [list(), list({ name: 'Animals', marker: 'animal' })] },
		});
		expect(out).toBe(`calendars:
  - name: Far
    kind: cycles
    length: 60
    start: 1
    formats: ["{cycle}.{year} {planet}"]
    lists:
      - name: Planets
        marker: planet
        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
          - {name: Mars, short: Ma}
          - {name: Sun, short: Su}
          - {name: Venus, short: Ve}
          - {name: Mercury, short: Me}
          - {name: Moon, short: Mo}
        known: {year: 1273, index: 0}
        show: short
      - name: Animals
        marker: animal
        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
          - {name: Mars, short: Ma}
          - {name: Sun, short: Su}
          - {name: Venus, short: Ve}
          - {name: Mercury, short: Me}
          - {name: Moon, short: Mo}
        known: {year: 1273, index: 0}
        show: short`);
		expect(read(out).calendars[0].lists).toHaveLength(2);
		const eraOut = apply(BLOCK, { kind: 'add-calendar', calendar: { name: 'R', kind: 'eras', formats: ['{era} {year}'], eras: [{ name: 'Qing', start: 130 }], lists: [list({ names: [{ name: 'A' }], known: { year: 1, index: 0 } })] } });
		expect(read(eraOut).calendars[1].lists).toHaveLength(1);
		expect(eraOut).toContain('eras:\n      - {name: Qing, start: 130}\n    lists:\n');
	});

	it('refuses a list that cannot be written, an index that names nothing, and a fifth list, without a throw', () => {
		const add = (l: unknown, calendar: number | 'plain' = 0) => refused(BLOCK, { kind: 'add-list', calendar, list: l as NameList });
		expect(add({ ...list(), name: ' ' })).toBe('A name list must have a name.');
		expect(add(list({ names: [] }))).toBe('A name list has 1 to 60 names. Each name is text.');
		expect(add(list({ names: [{ name: 'x'.repeat(41) }] }))).toContain('1 to 60 names');
		expect(add(list({ names: [{ name: 5 as never }] }))).toContain('1 to 60 names');
		expect(add(list({ known: { year: 1.5, index: 0 } }))).toContain('known year');
		expect(add(list({ known: { year: 1, index: 7 } }))).toContain('known year');
		expect(add(list({ show: 'loud' as never }))).toBe('Show on cards must be short, full or none.');
		expect(add(list({ marker: 'year' }))).toContain('The marker is not valid.');
		expect(add(list({ marker: undefined }))).toContain('The marker is not valid.');
		expect(add(null)).toBe('A name list must have a name.');
		expect(add(list(), 5)).toBe('The note has no calendar at this place. Edit the note text.');
		let full = BLOCK;
		for (const n of ['B', 'C', 'D']) full = apply(full, { kind: 'add-list', calendar: 0, list: list({ name: n, marker: n.toLowerCase() }) });
		expect(refused(full, { kind: 'add-list', calendar: 0, list: list({ name: 'E', marker: 'e' }) })).toBe('A calendar and the plain years have at most 4 name lists.');
		const noList = (op: CalendarOp) => refused(BLOCK, op);
		expect(noList({ kind: 'edit-list', calendar: 0, list: 5, fields: { show: 'full' } })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(noList({ kind: 'remove-list', calendar: 0, list: 5 })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(noList({ kind: 'edit-list', calendar: 'plain', list: 3, fields: { show: 'full' } })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(refused('calendars: []\n', { kind: 'remove-list', calendar: 'plain', list: 0 })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(refused('calendars: []\n', { kind: 'edit-list', calendar: 'plain', list: 0, fields: { show: 'none' } })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(noList({ kind: 'edit-list', calendar: 0, list: 0, fields: { names: [] } })).toBe('A name list has 1 to 60 names. Each name is text.');
		const second = BLOCK.replace('known: {year: 1273, index: 0}\n        show: short\nplain', 'known: {year: 1273, index: 1}\n        show: short\nplain');
		expect(second).not.toBe(BLOCK);
		expect(refused(second, { kind: 'edit-list', calendar: 0, list: 0, fields: { names: [{ name: 'Only' }] } })).toContain('known year');
		expect(noList({ kind: 'edit-list', calendar: 0, list: 0, fields: { known: { year: 1, index: 2 } } })).toContain('known year');
		expect(noList({ kind: 'edit-list', calendar: 0, list: 0, fields: { name: '' } })).toBe('A name list must have a name.');
		expect(noList({ kind: 'edit-list', calendar: 0, list: 0, fields: { marker: '9' } })).toContain('The marker is not valid.');
		expect(noList({ kind: 'edit-list', calendar: 'plain', list: 0, fields: { marker: 'planet' } })).toContain('The marker is not valid.');
		expect(noList({ kind: 'edit-list', calendar: 0, list: 0, fields: { show: 'big' as never } })).toBe('Show on cards must be short, full or none.');
		expect(noList({ kind: 'add-list', calendar: 0 } as never)).toBe('A name list must have a name.');
		expect(() => editCalendarBlock(BLOCK, { kind: 'edit-list', calendar: 0, list: 0 } as never)).not.toThrow();
		expect(() => editCalendarBlock(BLOCK, { kind: 'add-list' } as never)).not.toThrow();
		expect(refused('plain: nonsense\n', { kind: 'add-list', calendar: 'plain', list: plain() })).toBe('The plain years of this block are not a group of keys. Edit the note text.');
		expect(refused('calendars:\n  - {name: A, kind: cycles, length: 5, formats: []}\nplain: [1]\n', { kind: 'remove-list', calendar: 'plain', list: 0 })).toContain('plain years');
		expect(refused('calendars:\n  - name: A\n    kind: cycles\n    length: 5\n    formats: []\n    lists: 5\n', { kind: 'add-list', calendar: 0, list: list() })).toBe('The calendar has no name list at this place. Edit the note text.');
		expect(refused(BLOCK, { kind: 'add-calendar', calendar: { name: 'X', kind: 'cycles', formats: [], length: 5, lists: [list({ names: [] })] } })).toContain('1 to 60 names');
		expect(refused(BLOCK, { kind: 'add-calendar', calendar: { name: 'X', kind: 'cycles', formats: [], length: 5, lists: [1, 2, 3, 4, 5].map((i) => list({ name: `L${i}`, marker: `m${i}` })) } })).toBe('A calendar and the plain years have at most 4 name lists.');
	});

	it('refuses an alias for a plain key', () => {
		expect(refused('base: &b {lists: []}\nplain: *b\n', { kind: 'add-list', calendar: 'plain', list: plain() })).toContain('YAML alias');
	});
});
