// Spec §14 rule 15 (WP-6 step 2, render): `shownDate`, `dateLine`, `shownReign`, the screen-reader label, the holder rows, and the sample trees.
// The tests use a cycle calendar with a name list of seven planets (1273 = Saturn) and a plain-year list of the same planets.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { compileCalendars, PLAIN_READER, type Calendar, type DateReader, type NameList } from '../src/core/dates';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardLabels } from '../src/core/titles';
import type { Person } from '../src/core/types';
import { cardLabel, dateLine, shownDate, shownHolder, shownReign } from '../src/render/tree-info';
import { entryText } from '../src/obsidian/sheet-titles';
import { holderText } from '../src/view/titles-draft';
import { FULL_SET, type CalendarDef } from './dates-support';
import { cycles, eras, list, PLANETS } from './dates-support/names';

const FORMATS = ['{cycle}.{year} {planet}', '{cycle}.{year}'];
const planets = (over: Partial<NameList> = {}) => list(over);
const animals = (over: Partial<NameList> = {}): NameList => ({ name: 'Animals', marker: 'animal', names: [{ name: 'Rat' }, { name: 'Ox' }, { name: 'Dog', short: 'Do' }], known: { year: 1000, index: 1 }, show: 'full', ...over });
/** Cycle 22 Year 13 of a 60-year cycle starting at 1 is internal year 21 * 60 + 13 = 1273: Saturn. */
const reader = (lists: NameList[] = [planets()], plain: NameList[] = [], formats = FORMATS): DateReader => compileCalendars([cycles('C', formats, lists)], true, [], plain);
const person = (p: Partial<Person>): Person => ({ id: 'a', name: 'Aldric', index: 0, ...p }) as Person;

describe('§14 rule 15: shownDate', () => {
	it('appends the short name after a whole date', () => {
		expect(shownDate('22.13', reader(), 'shown')).toBe('22.13 Sa');
		expect(shownDate('22.14', reader(), 'shown')).toBe('22.14 Ju');
	});

	it('uses the full name for `full`, the list setting for `shown`, nothing for `none`', () => {
		const r = reader();
		expect(shownDate('22.13', r, 'full')).toBe('22.13 Saturn');
		expect(shownDate('22.13', r, 'none')).toBe('22.13');
		expect(shownDate('22.13', reader([planets({ show: 'full' })]), 'shown')).toBe('22.13 Saturn');
		expect(shownDate('22.13', reader([planets({ show: 'none' })]), 'shown')).toBe('22.13');
		// A list that shows nothing on a card shows nothing for the spoken label either.
		expect(shownDate('22.13', reader([planets({ show: 'none' })]), 'full')).toBe('22.13');
	});

	it('uses the full name when the entry has no short form, also with `short`', () => {
		const r = reader([planets({ names: [{ name: 'Saturn' }, ...PLANETS.slice(1)] })]);
		expect(shownDate('22.13', r, 'shown')).toBe('22.13 Saturn');
	});

	it('does not double a written name, right or wrong (D273 5)', () => {
		const r = reader();
		expect(shownDate('22.13 Sa', r, 'shown')).toBe('22.13 Sa');
		expect(shownDate('22.13 Saturn', r, 'shown')).toBe('22.13 Saturn');
		expect(shownDate('22.13 Mars', r, 'shown')).toBe('22.13 Mars');
		expect(shownDate('22.13 Mars', r, 'full')).toBe('22.13 Mars');
	});

	it('gives the names of two lists in list order, and only the list that has no written name', () => {
		const r = reader([planets(), animals()], [], ['{cycle}.{year} {planet} {animal}']);
		// 1273 - 1000 = 273 = 3 * 91, so the animal is index (1 + 273) mod 3 = 1: Ox.
		expect(shownDate('22.13', r, 'shown')).toBe('22.13 Sa Ox');
		expect(shownDate('22.13 Sa', r, 'shown')).toBe('22.13 Sa Ox');
		expect(shownDate('22.13 Ox', r, 'shown')).toBe('22.13 Ox Sa');
		expect(shownDate('22.13 Sa Ox', r, 'shown')).toBe('22.13 Sa Ox');
	});

	it('keeps an approximate prefix and gives the name after the whole text', () => {
		const r = reader();
		expect(shownDate('c. 22.13', r, 'shown')).toBe('c. 22.13 Sa');
		expect(shownDate('about 22.13', r, 'shown')).toBe('about 22.13 Sa');
	});

	it('gives no name to a date that is not whole (supervisor ruling)', () => {
		const r = reader();
		expect(shownDate('between 22.13 and 22.15', r, 'shown')).toBe('between 22.13 and 22.15');
		expect(shownDate('22.13, at dawn', r, 'shown')).toBe('22.13, at dawn');
		expect(shownDate('22.13–22.15', r, 'shown')).toBe('22.13–22.15');
		expect(shownDate('1273?', r, 'shown')).toBe('1273?');
	});

	it('gives the name of a whole plain year by the plain-year lists, and not of a text that is no year', () => {
		const plainOnly = compileCalendars([], true, [], [list({ marker: undefined })]);
		expect(shownDate('1273', plainOnly, 'shown')).toBe('1273 Sa');
		expect(shownDate('c. 1274', plainOnly, 'shown')).toBe('c. 1274 Ju');
		expect(shownDate('1273 AD', plainOnly, 'shown')).toBe('1273 AD Sa');
		expect(shownDate('1273 Sun rose', plainOnly, 'shown')).toBe('1273 Sun rose');
		expect(shownDate('12 March 1273', plainOnly, 'shown')).toBe('12 March 1273');
		expect(shownDate('1700/01', plainOnly, 'shown')).toBe('1700/01');
		expect(shownDate('yes', plainOnly, 'shown')).toBe('yes');
	});

	it('gives nothing without a list, and does not read the text when it knows that the tree has no list', () => {
		expect(shownDate('22.13', reader([]), 'shown')).toBe('22.13');
		expect(shownDate('1273', PLAIN_READER, 'shown')).toBe('1273');
		let reads = 0;
		const counting = { read: (t: string | undefined) => (reads++, PLAIN_READER.read(t)), reader: { hasLists: false } };
		expect(shownDate('1273', counting, 'shown')).toBe('1273');
		expect(reads).toBe(0);
		// A stub with no `reader` is read as it is (older tests).
		const stub = { read: (t: string | undefined) => (reads++, PLAIN_READER.read(t)) };
		expect(shownDate('1273', stub, 'shown')).toBe('1273');
		expect(reads).toBe(1);
	});

	it('gives nothing while the index is not ready', () => {
		const pending = compileCalendars([cycles('C', FORMATS, [planets()])], false, [], [list({ marker: undefined })]);
		expect(shownDate('22.13', pending, 'shown')).toBe('22.13');
		expect(shownDate('1273', pending, 'shown')).toBe('1273');
	});
});

describe('§14 rule 15: the date line of a card', () => {
	const r = reader();
	it('puts the names after both dates, and after a single date', () => {
		expect(dateLine(person({ born: '22.13', died: '22.14' }), r)).toBe('22.13 Sa\u2009–\u200922.14 Ju');
		expect(dateLine(person({ born: '22.13' }), r)).toBe('b. 22.13 Sa');
		expect(dateLine(person({ died: '22.14' }), r)).toBe('d. 22.14 Ju');
	});

	it('keeps the sign of a dead person with no death year, and a doubt', () => {
		expect(dateLine(person({ born: '22.13', died: 'yes' }), r)).toBe('b. 22.13 Sa †');
		expect(dateLine(person({ born: '22.13', died: '?' }), r)).toBe('b. 22.13 Sa †?');
		expect(dateLine(person({ died: 'yes' }), r)).toBe('†');
	});

	it('`names: none` gives the written text (the second try of the cut, §14 rule 15)', () => {
		expect(dateLine(person({ born: '22.13', died: '22.14' }), r, { names: 'none' })).toBe('22.13–22.14');
		expect(dateLine(person({ born: '22.13', died: '22.14' }), r, { names: 'full' })).toBe('22.13 Saturn\u2009–\u200922.14 Jupiter');
	});

	it('is the text as written when the tree has no list', () => {
		for (const dates of [PLAIN_READER, reader([])]) {
			expect(dateLine(person({ born: '1131', died: '1160' }), dates)).toBe('1131–1160');
			expect(dateLine(person({ born: '1131', died: 'yes' }), dates)).toBe('b. 1131 †');
		}
	});
});

describe('§14 rule 15: the screen-reader label', () => {
	it('says the full names, whatever the list shows on the card, and does not cut them', () => {
		const p = person({ born: '22.13', died: '22.14' });
		for (const show of ['short', 'full'] as const) expect(cardLabel(p, undefined, undefined, undefined, reader([planets({ show })]))).toBe('Aldric, 22.13 Saturn\u2009–\u200922.14 Jupiter');
		// A list set to `none` is not shown on the card, and so it is not said.
		expect(cardLabel(p, undefined, undefined, undefined, reader([planets({ show: 'none' })]))).toBe('Aldric, 22.13–22.14');
		expect(cardLabel(p, 'brother', undefined, undefined, reader())).toBe('Aldric, 22.13 Saturn\u2009–\u200922.14 Jupiter, brother');
		expect(cardLabel(person({ born: '1131', died: '1160' }))).toBe('Aldric, 1131–1160');
	});

	it('says the full names of the years of the reign', () => {
		const g = deriveFamilies(
			(parseDynasty(['titles:', '  - id: crown', '    name: Crown', '    holders:', '      - {person: a, from: "22.13", to: "22.14"}', 'people:', '  - {id: a, name: Aldric, born: "22.10"}', ''].join('\n')) as { ok: true; tree: never }).tree,
			{ dates: reader() },
		);
		const label = cardLabels(g).get('a')!;
		expect(label.reign).toBe('(r. 22.13–22.14)');
		expect(cardLabel(g.byId.get('a')!, undefined, label, undefined, g.dates)).toBe('Aldric, Crown (r. 22.13 Saturn\u2009–\u200922.14 Jupiter), b. 22.10 Venus');
	});
});

describe('§14 rule 15: the reign of a card', () => {
	const entries = (...e: { from?: string; to?: string }[]) => e.map((x, index) => ({ ...x, index }));
	const label = (...e: { from?: string; to?: string }[]) => ({ reign: '(r. x)', shown: { title: {} as never, entries: entries(...e) } });

	it('puts the name after each date of the reign', () => {
		expect(shownReign(label({ from: '22.13', to: '22.14' }), reader(), 'shown')).toBe('(r. 22.13 Sa\u2009–\u200922.14 Ju)');
		expect(shownReign(label({ from: '22.13' }), reader(), 'shown')).toBe('(r. from 22.13 Sa)');
		expect(shownReign(label({ to: '22.14' }), reader(), 'shown')).toBe('(r. until 22.14 Ju)');
		expect(shownReign(label({ from: '22.13', to: '22.14' }, { from: '22.20' }), reader(), 'shown')).toBe('(r. 22.13 Sa\u2009–\u200922.14 Ju, from 22.20 Sa)');
	});

	it('is the label text without a list, with `none`, or without a reign', () => {
		const none = { read: reader().read, reader: { hasLists: false } };
		expect(shownReign(label({ from: '22.13' }), none, 'shown')).toBe('(r. x)');
		// The plain reader has no `reader` of its own: the text is built again and is the text of the label.
		expect(shownReign(label({ from: '22.13' }), PLAIN_READER, 'shown')).toBe('(r. from 22.13)');
		expect(shownReign(label({ from: '22.13' }), reader(), 'none')).toBe('(r. x)');
		expect(shownReign({ shown: undefined }, reader(), 'shown')).toBeUndefined();
		expect(shownReign(undefined, reader(), 'shown')).toBeUndefined();
	});

	it('`shownHolder` changes only `from` and `to`', () => {
		expect(shownHolder({ person: 'a', number: 'II', from: '22.13' }, reader(), 'shown')).toEqual({ person: 'a', number: 'II', from: '22.13 Sa' });
		const bare: { person: string; from?: string } = { person: 'a' };
		expect(shownHolder(bare, reader(), 'shown')).toEqual({ person: 'a' });
	});
});

describe('§14 rule 15: the holder rows', () => {
	const body = ['titles:', '  - id: crown', '    name: Crown', '    holders:', '      - {person: a, number: II, from: "22.13", to: "22.14"}', '      - {person: a, from: "22.15 Mars"}', 'people:', '  - {id: a, name: Aldric}', ''].join('\n');
	const g = deriveFamilies((parseDynasty(body) as { ok: true; tree: never }).tree, { dates: reader() });
	const plain = deriveFamilies((parseDynasty(body) as { ok: true; tree: never }).tree);

	it('the Titles window row shows the reign with names, and the written name once', () => {
		expect(holderText(g, { person: 'a', number: 'II', from: '22.13', to: '22.14' }).reign).toBe('22.13 Sa\u2009–\u200922.14 Ju');
		expect(holderText(g, { person: 'a', from: '22.15 Mars' }).reign).toBe('from 22.15 Mars');
		expect(holderText(g, { person: 'a', to: '22.14' }).reign).toBe('until 22.14 Ju');
		expect(holderText(plain, { person: 'a', from: '22.13' }).reign).toBe('from 22.13');
		expect(holderText(null, { name: 'Orso', from: '22.13' }).reign).toBe('from 22.13');
	});

	it('the entry in the person window shows the same, and is as written without the dates view', () => {
		const e = { person: 'a', number: 'II', from: '22.13', to: '22.14', index: 0 };
		expect(entryText(e, 'Aldric', undefined, g.dates)).toBe('Aldric II, 22.13 Sa\u2009–\u200922.14 Ju');
		expect(entryText(e, 'Aldric')).toBe('Aldric II, 22.13–22.14');
	});
});

describe('the sample trees with no list', () => {
	const trees: { file: string; people: Person[] }[] = [];
	for (const file of readdirSync('fixtures').filter((f) => f.endsWith('.md'))) {
		for (const m of readFileSync(`fixtures/${file}`, 'utf8').matchAll(/^```kin\r?\n([\s\S]*?)^```/gm)) {
			const parsed = parseDynasty(m[1]);
			if (parsed.ok) trees.push({ file, people: deriveFamilies(parsed.tree).people as Person[] });
		}
	}
	const withLists = (FULL_SET as CalendarDef[]).map((c) => ({ ...c, formats: c.formats.map((f) => `${f} {planet}`), lists: [planets({ show: 'none' })] }) as Calendar);
	const alone = compileCalendars(FULL_SET as Calendar[], true);
	const listed = compileCalendars(withLists, true, [], [list({ marker: undefined, show: 'none' })]);

	it('there are many people', () => {
		expect(trees.flatMap((t) => t.people).length).toBeGreaterThan(300);
	});

	it('the date line is the written text with no list, with the default option or `none`', () => {
		for (const { file, people } of trees) {
			for (const p of people) {
				const base = dateLine(p, PLAIN_READER, { names: 'none' });
				expect(dateLine(p, PLAIN_READER), `${file} ${p.id}`).toBe(base);
				expect(dateLine(p, reader([]), { names: 'shown' }), `${file} ${p.id}`).toBe(base);
				expect(cardLabel(p, undefined, undefined, undefined, PLAIN_READER)).toBe(cardLabel(p));
			}
		}
	});

	it('the date line with a full set of calendars and lists that show nothing is the line of the calendars alone', () => {
		for (const { file, people } of trees) {
			for (const p of people) {
				expect(dateLine(p, listed), `${file} ${p.id}`).toBe(dateLine(p, alone));
				expect(cardLabel(p, undefined, undefined, undefined, listed), `${file} ${p.id}`).toBe(cardLabel(p, undefined, undefined, undefined, alone));
			}
		}
	});

	it('eras of the contract example give a name only to a whole date', () => {
		const e = compileCalendars([eras('Kings', [{ name: 'Qinglong Emperor', start: 100, length: 20 }], ['{era} {year} {planet}'], [planets({ known: { year: 100, index: 2 } })])], true);
		expect(shownDate('Qinglong Emperor 1', e, 'shown')).toBe('Qinglong Emperor 1 Ma');
		expect(shownDate('Qinglong Emperor 1 Sun', e, 'shown')).toBe('Qinglong Emperor 1 Sun');
	});
});
