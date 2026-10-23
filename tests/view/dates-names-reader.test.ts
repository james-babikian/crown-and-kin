// Spec §14 rules 10, 14 and 15 (WP-6 step 1): the key of the reader and "not ready", the reader of 0.3.2 on a note with name lists, and the
// warning `calendar-name-mismatch` in the tree list (and not in the line of succession).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCalendars, compileCalendars, MEMO_CAP, PLAIN_READER, type Calendar, type DateReader, type NameList } from '../../src/core/dates';
import { issueText } from '../../src/core/messages';
import { NORMAL_GEOMETRY } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, layoutKey } from '../../src/layout/index';
import { compileCapped } from '../../src/view/calendar-reader';
import { graphOf, lineOf, warningsOf } from '../dates-support';
import { cycles, list } from '../dates-support/names';

const plain = (over: Partial<NameList> = {}) => list({ marker: undefined, ...over });
const keyOf = (calendars: Calendar[], plainLists: NameList[] = [], ready = true) => compileCalendars(calendars, ready, [], plainLists).key;

describe('§14 rule 15: the key of the reader', () => {
	it('is pending while not ready, plain with nothing, and a hash otherwise', () => {
		expect(keyOf([], [], false)).toBe('pending');
		expect(keyOf([cycles('C', ['{cycle}.{year}'], [list()])], [plain()], false)).toBe('pending');
		expect(keyOf([])).toBe('plain');
		expect(keyOf([], [plain()])).toMatch(/^k/);
		expect(keyOf([cycles('C', ['{cycle}.{year}'])])).toMatch(/^k/);
		expect(PLAIN_READER.key).toBe('plain');
		// An empty list of plain lists is no list.
		expect(compileCalendars([], true, [], []).key).toBe('plain');
	});

	it('a reader with only plain-year lists is not "plain" and reads names', () => {
		const r = compileCalendars([], true, [], [plain()]);
		expect(r.key).not.toBe('plain');
		expect(r.hasLists).toBe(true);
		expect(r.read('1273')?.names).toHaveLength(1);
		expect(compileCalendars([], true).hasLists).toBe(false);
	});

	it('every field of every list changes the key, in a calendar and in the plain years', () => {
		const base = keyOf([cycles('C', ['{cycle}.{year}'], [list()])]);
		const changes: Partial<NameList>[] = [
			{ show: 'full' }, { show: 'none' }, { name: 'Other' }, { marker: 'planets' }, { known: { year: 1274, index: 0 } }, { known: { year: 1273, index: 1 } },
			{ names: [...list().names, { name: 'Pluto' }] }, { names: list().names.map((n, i) => (i === 0 ? { name: n.name, short: 'S' } : n)) }, { names: list().names.map((n, i) => (i === 0 ? { name: 'Sat' } : n)) },
		];
		const keys = new Set([base]);
		for (const c of changes) {
			const k = keyOf([cycles('C', ['{cycle}.{year}'], [list(c)])]);
			expect(keys.has(k), JSON.stringify(c)).toBe(false);
			keys.add(k);
		}
		const plainBase = keyOf([], [plain()]);
		for (const c of changes.filter((x) => !('marker' in x))) expect(keyOf([], [plain(c)]), JSON.stringify(c)).not.toBe(plainBase);
		// A list in the plain years and the same list in a calendar are two different readers.
		expect(keyOf([cycles('C', ['{cycle}.{year}'], [list()])])).not.toBe(keyOf([cycles('C', ['{cycle}.{year}'])], [plain()]));
		// The order of the lists is the written order: it counts.
		const two = [list({ name: 'A', marker: 'a' }), list({ name: 'B', marker: 'b' })];
		expect(keyOf([cycles('C', ['{cycle}.{year}'], two)])).not.toBe(keyOf([cycles('C', ['{cycle}.{year}'], [two[1], two[0]])]));
	});

	it('the same content gives the same key, whatever the order of the calendars and the ids', () => {
		const a = cycles('A', ['{cycle}.{year}'], [list()]);
		const b = cycles('B', ['{year} in {cycle}'], [list({ name: 'Other', marker: 'other' })]);
		expect(keyOf([a, b])).toBe(keyOf([b, a]));
		expect(keyOf([a])).toBe(keyOf([{ ...a, id: 'X#9#9', note: 'Elsewhere.md' }]));
	});

	it('a calendar with no list hashes as it did in 0.3.2 (the key of the sample trees does not move)', () => {
		const c = cycles('C', ['{cycle}.{year}']);
		expect(keyOf([c])).toBe(keyOf([{ ...c, lists: [] }]));
	});

	it('layoutKey does not change with the lists: the card width does not depend on the date text', () => {
		const source = 'people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Ju"}\n  - {id: b, name: Bran, sex: m, born: "1274", parents: [a]}\n';
		const keys = [
			compileCalendars([], true),
			compileCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list()])], true, [], [plain()]),
			compileCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list({ show: 'full' })])], true),
			compileCalendars([cycles('C', ['{cycle}.{year} {planet}'], [list()])], false),
		].map((r) => layoutKey(graphOf(source, r), NORMAL_GEOMETRY, DEFAULT_LAYOUT_SETTINGS, 'sans'));
		expect(new Set(keys).size).toBe(1);
	});

	it('the memo cap is 20 000 texts', () => {
		expect(MEMO_CAP).toBe(20000);
	});

	it('capReader and compileCapped forward hasLists and the plain-year lists', () => {
		const capped = compileCapped([cycles('C', ['{cycle}.{year}'], [list()])], true);
		expect(capped.hasLists).toBe(true);
		expect(capped.key).toBe(keyOf([cycles('C', ['{cycle}.{year}'], [list()])]));
		const onlyPlain = compileCapped([], true, [], [plain()]);
		expect(onlyPlain.hasLists).toBe(true);
		expect(onlyPlain.read('1273')?.names).toHaveLength(1);
		expect(compileCapped([], true).hasLists).toBe(false);
		// A text over the limit goes to the plain reader and has no name.
		expect(capped.read(`22.13 Sa ${'x'.repeat(600)}`)?.names).toBeUndefined();
	});
});

describe('§14 rule 15: not ready', () => {
	const cal = cycles('C', ['{cycle}.{year} {planet}'], [list()]);

	it('no list is used while not ready: no name, no warning, no lists; the redraw after ready shows them', () => {
		const pending = compileCalendars([cal], false, [], [plain()]);
		expect(pending.ready).toBe(false);
		expect(pending.hasLists).toBe(false);
		expect(pending.read('22.13 Ju')).toMatchObject({ source: 'none' });
		expect(pending.read('22.13 Ju')?.names).toBeUndefined();
		expect(pending.read('1273 Sa')).toMatchObject({ year: 1273 });
		expect(pending.read('1273 Sa')?.names).toBeUndefined();
		expect(pending.read('1273')?.whole).toBeUndefined();
		const ready = compileCalendars([cal], true, [], [plain()]);
		expect(ready.hasLists).toBe(true);
		expect(ready.read('22.13 Ju')?.warnings).toEqual(['calendar-name-mismatch']);
		expect(ready.read('1273')?.names).toHaveLength(1);
		expect(pending.key).not.toBe(ready.key);
	});

	it('the tree list has no mismatch before ready and has it after', () => {
		const source = 'people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Ju"}\n';
		const codes = (r: DateReader) => graphOf(source, r).issues.map((i) => i.code);
		expect(codes(compileCalendars([cal], false))).toEqual([]);
		expect(codes(compileCalendars([cal], true))).toEqual(['calendar-name-mismatch']);
	});
});

describe('§14 rule 14: calendar-name-mismatch in the list of problems of the tree', () => {
	const cal = cycles('C', ['{cycle}.{year} {planet}'], [list()]);
	const reader = compileCalendars([cal], true, [], [plain()]);
	const issues = (source: string, r: DateReader = reader) => graphOf(source, r).issues.filter((i) => i.code === 'calendar-name-mismatch');

	it('shows for a born and a died date of every person, with the params and the ids', () => {
		const got = issues('people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Ju", died: "22.14 Ju"}\n  - {id: b, name: Bran, sex: m, born: "22.13 Sa"}\n');
		expect(got).toHaveLength(1);
		expect(got[0].params).toEqual({ where: 'born', value: '22.13 Ju', person: 'Aldric', list: 'Planets', expected: 'Saturn', written: 'Jupiter' });
		expect(got[0].ids).toEqual(['a']);
		expect(got[0].level).toBe('warning');
		expect(issueText(got[0])).toBe('Aldric has “born: 22.13 Ju”. In the list “Planets”, this year is Saturn. The date says Jupiter. The plugin keeps the year of the date. Correct the name in the date, or remove the name.');
		const died = issues('people:\n  - {id: a, name: Aldric, sex: m, died: "22.14 Sa"}\n');
		expect(died[0].params).toMatchObject({ where: 'died', expected: 'Jupiter', written: 'Saturn' });
	});

	it('shows for a plain year with a wrong name', () => {
		const got = issues('people:\n  - {id: a, name: Aldric, sex: m, born: "1274 Sa"}\n');
		expect(got).toHaveLength(1);
		expect(got[0].params).toMatchObject({ where: 'born', value: '1274 Sa', list: 'Planets', expected: 'Jupiter', written: 'Saturn' });
	});

	it('shows for a title year and a holder from and to, always: also for a title with no rule of succession', () => {
		const source = `people:
  - {id: r, name: Rolf, sex: m}
titles:
  - id: crown
    name: Crown
    year: "22.13 Ju"
    holders:
      - {person: r, from: "22.14 Sa", to: "22.15 Sa"}
`;
		const got = issues(source);
		expect(got.map((i) => [i.params.where, i.params.value, i.params.title])).toEqual([['year', '22.13 Ju', 'Crown'], ['reign', '22.14 Sa', 'Crown'], ['reign', '22.15 Sa', 'Crown']]);
		expect(issueText(got[1])).toBe('The title Crown has the reign date “22.14 Sa”. In the list “Planets”, this year is Jupiter. The date says Saturn. The plugin keeps the year of the date. Correct the name in the date, or remove the name.');
		// With a rule, the other date warnings join, but the mismatch shows once for each date.
		const withRule = source.replace('    year:', '    succession: eldest-child\n    year:');
		expect(issues(withRule)).toHaveLength(3);
	});

	it('shows once for each list that has a wrong name', () => {
		const animals: NameList = { name: 'Animals', marker: 'animal', names: [{ name: 'Rat' }, { name: 'Ox' }], known: { year: 1273, index: 0 }, show: 'short' };
		const two = compileCalendars([cycles('C', ['{cycle}.{year} {planet} {animal}'], [list(), animals])], true);
		const got = issues('people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Ju Ox"}\n', two);
		expect(got.map((i) => i.params.list)).toEqual(['Planets', 'Animals']);
	});

	it('is not a row of the line of succession and changes nothing in it', () => {
		const source = `people:
  - {id: r, name: Rolf, sex: m, born: "22.10 Sa"}
  - {id: c, name: Cade, sex: m, born: "22.13 Ju", parents: [r]}
titles:
  - id: crown
    name: Crown
    succession: eldest-child
    year: "22.20"
    holders:
      - {person: r}
`;
		const withNames = lineOf(source, reader);
		const without = lineOf(source, compileCalendars([cycles('C', ['{cycle}.{year} {planet}'])], true));
		expect(warningsOf(withNames).map((w) => w.warning)).toEqual(warningsOf(without).map((w) => w.warning));
		expect(warningsOf(withNames).some((w) => w.warning === 'calendar-name-mismatch')).toBe(false);
		expect(withNames.heirs).toEqual(without.heirs);
		expect(withNames.heirs).toEqual(['c']);
		// ... while the tree list has it.
		expect(issues(source)).toHaveLength(2);
	});

	it('reads the born and died dates only when the reader has lists', () => {
		const source = 'people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Ju", died: "22.20"}\n  - {id: b, name: Bran, sex: m, born: "1200"}\n';
		const spy = (inner: DateReader) => {
			const seen: string[] = [];
			const wrapped: DateReader = { ready: inner.ready, key: inner.key, problems: inner.problems, hasLists: inner.hasLists, read: (t) => (seen.push(String(t)), inner.read(t)) };
			return { wrapped, seen };
		};
		const without = spy(compileCalendars([cycles('C', ['{cycle}.{year} {planet}'])], true));
		graphOf(source, without.wrapped);
		expect(without.seen).toEqual([]);
		const withLists = spy(reader);
		graphOf(source, withLists.wrapped);
		expect(withLists.seen).toEqual(expect.arrayContaining(['22.13 Ju', '22.20', '1200']));
		// The plain reader of a tree with no calendar reads nothing either.
		expect(graphOf(source).issues.filter((i) => i.code === 'calendar-name-mismatch')).toEqual([]);
	});

	it('a date with no wrong name has no warning, also with names shown', () => {
		expect(issues('people:\n  - {id: a, name: Aldric, sex: m, born: "22.13 Sa", died: "22.14"}\n')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------
// Spec §14 rule 10: the reader of 0.3.2 (tag v0.3.2)
// Note 8 (supervisor, fix round): with no lists at all, two behaviours still differ from 0.3.2 and stay so: an identical format twice in one
// calendar is refused, and a word that is no place gives the marker sentence in the window instead of the format sentence.

type OldDates = {
	compileCalendars(calendars: unknown[], ready: boolean): { read(text: string): { year?: number; source: string; warnings: string[]; names?: unknown } | undefined; key: string };
	checkFormat(kind: string, format: string): string | null;
	checkCalendars(calendars: unknown[]): { key: string }[];
};

/** The sources of `src/core/dates.ts` and the two files it needs, as they are in the tag; null when the tag is not in this clone. */
function oldSources(): Record<string, string> | null {
	try {
		const out: Record<string, string> = {};
		for (const file of ['dates', 'hash', 'succession-keys']) out[file] = execFileSync('git', ['show', `v0.3.2:src/core/${file}.ts`], { encoding: 'utf8', maxBuffer: 20_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
		return out;
	} catch {
		return null;
	}
}

const sources = oldSources();

describe.skipIf(sources === null)('N19: the reader of 0.3.2 on a note with name lists (tag v0.3.2)', () => {
	let old: OldDates;
	const load = async () => {
		const dir = mkdtempSync(join(tmpdir(), 'kin-v032-'));
		mkdirSync(dir, { recursive: true });
		for (const [file, text] of Object.entries(sources!)) writeFileSync(join(dir, `${file}.ts`), text);
		old = (await import(/* @vite-ignore */ pathToFileURL(join(dir, 'dates.ts')).href)) as OldDates;
	};
	const calendar = (formats: string[], extra: object = {}) => ({ id: 'C.md#0#0', name: 'C', note: 'C.md', formats, kind: { type: 'cycles', length: 60, start: 1 }, ...extra });

	it('skips a format with a marker place and still reads the other formats; the new reader reads both', async () => {
		await load();
		const formats = ['{cycle}.{year} {planet}', '{year} Year of the {cycle} Cycle'];
		const lists = [list()];
		const before = old.compileCalendars([calendar(formats, { lists })], true);
		const after = compileCalendars([calendar(formats, { lists }) as unknown as Calendar], true);
		// The other format reads the same year in both versions, and nothing is written about a marker.
		expect(before.read('13 Year of the 22 Cycle')).toMatchObject({ year: 1273, source: 'calendar', warnings: [] });
		expect(after.read('13 Year of the 22 Cycle')).toMatchObject({ year: 1273, source: 'calendar', warnings: [] });
		// The marker format reads nothing in 0.3.2 (the plain reader finds no run of three digits in "22.13 Sa").
		expect(before.read('22.13 Sa')?.year).toBeUndefined();
		expect(before.read('22.13 Sa')?.source).toBe('none');
		expect(after.read('22.13 Sa')).toMatchObject({ year: 1273, source: 'calendar' });
	});

	it('a calendar whose only format has a marker reads nothing in 0.3.2', async () => {
		await load();
		const only = [calendar(['{cycle}.{year} {planet}'], { lists: [list()] })];
		expect(old.compileCalendars(only, true).read('22.13 Sa')?.source).toBe('none');
		expect(compileCalendars(only as unknown as Calendar[], true).read('22.13 Sa')?.year).toBe(1273);
	});

	it('refuses to save the note until the marker format is removed, and the key of a calendar with no list is the same in both versions', async () => {
		await load();
		expect(old.checkFormat('cycles', '{cycle}.{year} {planet}')).toBe('calendar-format-cycle');
		expect(old.checkCalendars([calendar(['{cycle}.{year} {planet}'])]).map((r) => r.key)).toEqual(['calendar-format-cycle']);
		const plainCal = calendar(['{year} Year of the {cycle} Cycle']);
		expect(compileCalendars([plainCal as unknown as Calendar], true).key).toBe(old.compileCalendars([plainCal], true).key);
		// With the marker format removed the 0.3.2 window accepts the calendar, and the lists in the note do not matter to it.
		expect(old.checkCalendars([calendar(['{year} Year of the {cycle} Cycle'], { lists: [list()] })])).toEqual([]);
	});

	it('a user who keeps one format without a marker: the names show in 0.3.3 and a written name is not checked then', async () => {
		await load();
		const keep = [cycles('C', ['{cycle}.{year}'], [list()])];
		const r = compileCalendars(keep, true).read('22.13 Ju')!;
		expect(r.year).toBe(1273);
		expect(r.names?.[0]).toMatchObject({ name: 'Saturn' });
		expect(r.names?.[0].written).toBeUndefined();
		expect(r.warnings).toEqual([]);
		expect(r.whole).toBeUndefined();
		expect(checkCalendars(keep)).toEqual([]);
	});
});
