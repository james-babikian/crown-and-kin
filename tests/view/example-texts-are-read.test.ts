import { describe, expect, it } from 'vitest';

import { checkFormat, PLAIN_READER, parseNameLines } from '../../src/core/dates';
import { checkNewId } from '../../src/core/id-gen';
import type { CodedIssue, IssueCode, IssueParams } from '../../src/core/messages';
import { CALENDAR_REFUSAL_TEXT, codedIssue, issueText } from '../../src/core/messages';
import { REFUSAL_TEXT } from '../../src/core/refusal-text';
import { CALENDAR_UI, CALENDAR_WINDOW_UI as T } from '../../src/render/calendar-text';
import { LEGEND_DEAD_DOUBT_SAMPLE, LEGEND_DEAD_SAMPLE } from '../../src/render/legend-text';
import { parseBreakList } from '../../src/render/break-words';
import { SETTINGS_UI } from '../../src/render/settings-text';
import { NEW_SHEET, SHEET } from '../../src/render/sheet-text';
import { HOUSES, ID_UI, TITLES_UI } from '../../src/render/window-text';
import { startOf, type StartDraft } from '../../src/view/calendar-draft';
import { splitEraLine } from '../../src/view/calendar-era-lines';
import { datesApi, type CalendarDef } from '../dates-support';

/*
 * D341: the example names and years of the owner's document "Crown and Kin Example Texts" are valid for their fields. Each example is read by the real reader of its
 * field (the date reader, the name list reader, the break list, the ID check), so a text never shows an example that the plugin would refuse or read in another way.
 */

const issue = (code: IssueCode, params: IssueParams): CodedIssue => codedIssue(code, 'warning', params);
/** The example of a grey placeholder: the text after "For example: ". */
const example = (placeholder: string): string => placeholder.replace(/^For example: /, '');
/** The era of one text line of the eras box, read with the plain-year reader (D342). */
function eraOfLine(line: string): { name: string; start: number } {
	const split = splitEraLine(line, (t) => PLAIN_READER.read(t)?.year !== undefined);
	if (!split.ok) throw new Error(`no era in ${line}`);
	return { name: split.name, start: PLAIN_READER.read(split.first)!.year! };
}

const quoted = (text: string): string[] => [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]);

const OLYMPIADS: CalendarDef = {
	id: 'Calendars.md#0#0',
	name: example(T.namePlaceholderCycles),
	note: 'Calendars.md',
	formats: [example(T.formatsPlaceholderCycles)],
	kind: { type: 'cycles', length: 60, start: 1 },
};
const REIGNS: CalendarDef = {
	id: 'Calendars.md#0#1',
	name: example(T.namePlaceholderEras),
	note: 'Calendars.md',
	formats: [example(T.formatsPlaceholderEras)],
	// D342: the eras box shows the example text line "Reign of Aldric, 1100"; the purpose line of the window names "Qinglong Emperor 3".
	kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 130, length: 11 }, { ...eraOfLine(example(T.erasPlaceholder)) }] },
};
const reader = datesApi.compileCalendars([OLYMPIADS, REIGNS], true);

describe('D342: the example text line of the eras box', () => {
	it('"Reign of Aldric, 1100" is the era "Reign of Aldric" with the first year 1100 and no end', () => {
		expect(eraOfLine(example(T.erasPlaceholder))).toEqual({ name: 'Reign of Aldric', start: 1100 });
		expect(reader.read('Reign of Aldric 3')?.year).toBe(1102);
	});
});

describe('D341: the calendar examples are read by the date reader', () => {
	it('"the 3rd Year of the 92nd Olympiad" is year 3 of cycle 92 with the format "{year} Year of the {cycle} Olympiad"', () => {
		expect(OLYMPIADS.name).toBe('Greek Olympiads');
		expect(OLYMPIADS.formats).toEqual(['{year} Year of the {cycle} Olympiad']);
		const r = reader.read('the 3rd Year of the 92nd Olympiad')!;
		expect(r.calendar).toBe(OLYMPIADS.name);
		expect(r.span).toBe('Cycle 92');
		expect(r.count).toBe(3);
		// Year 3 of cycle 92 of a cycle of 60 years that starts at year 1: 1 + 91 * 60 + 2.
		expect(r.year).toBe(1 + 91 * 60 + 2);
		expect(r.warnings).toEqual([]);
	});

	it('"{era} {year}" still reads "Qinglong Emperor 3"', () => {
		expect(REIGNS.name).toBe('Reign names');
		expect(REIGNS.formats).toEqual(['{era} {year}']);
		const r = reader.read('Qinglong Emperor 3')!;
		expect(r.calendar).toBe(REIGNS.name);
		expect(r.year).toBe(132);
		expect(r.warnings).toEqual([]);
	});

	it('the purpose line of the window names these two examples, and the reader reads both', () => {
		expect(quoted(T.intro)).toEqual(['the 3rd Year of the 92nd Olympiad', 'Qinglong Emperor 3']);
		for (const text of quoted(T.intro)) expect(reader.read(text)?.source, text).toBe('calendar');
	});

	it('both formats and the refusal examples pass the format check', () => {
		expect(checkFormat('cycles', example(T.formatsPlaceholderCycles))).toBeNull();
		expect(checkFormat('eras', example(T.formatsPlaceholderEras))).toBeNull();
		for (const [key, kind] of [['calendar-format-cycle', 'cycles'], ['calendar-format-era', 'eras']] as const) {
			const text = CALENDAR_REFUSAL_TEXT[key]();
			expect(checkFormat(kind, quoted(text)[0]), text).toBeNull();
		}
	});
});

describe('D341: the example years are plain years', () => {
	const YEARS = [769, 867, 936, 1066, 1178, 1179];

	it('each new year reads as a plain year', () => {
		for (const y of YEARS) {
			const r = PLAIN_READER.read(String(y))!;
			expect(r.year, String(y)).toBe(y);
			expect(r.source, String(y)).toBe('plain');
		}
	});

	it('each text shows its year from the document', () => {
		expect(LEGEND_DEAD_SAMPLE).toBe('b. 769 †');
		expect(LEGEND_DEAD_DOUBT_SAMPLE).toBe('b. 769 †?');
		expect(T.sameAsHint).toContain('for example 867.');
		expect(CALENDAR_UI.noCalendarDetail).toContain('for example 936.');
		expect(T.plainHint).toContain('for example 1178.');
		expect(T.knownHint).toContain('if year 1178 is Saturn, year 1179 is');
		expect(T.knownDateBadPlain).toContain('for example 1178.');
		expect(issueText(issue('year-unreadable', { title: 'Crown', value: 'x' }))).toContain('“year: 1066”');
	});
});

describe('D341: the example IDs pass the ID check', () => {
	it('"robert", "gwendoline", "juliana", "plantagenet" and "duchy-of-normandy" are valid new IDs', () => {
		for (const id of ['robert', 'gwendoline', 'juliana', 'plantagenet', 'duchy-of-normandy']) expect(checkNewId(id, new Set()), id).toBeNull();
	});

	it('the warnings show those IDs and no other example ID', () => {
		const text = (code: IssueCode, params: IssueParams) => issueText(issue(code, params));
		expect(text('missing-id', { section: 'houses', index: 1 })).toContain('“id: plantagenet”');
		expect(text('missing-id', { section: 'titles', index: 1 })).toContain('“id: duchy-of-normandy”');
		expect(text('entry-not-map', { section: 'parents', index: 1, person: 'X' })).toContain('“{id: robert, type: adoptive}”');
		expect(text('entry-not-map', { section: 'holders', index: 1, title: 'T' })).toContain('“- {person: robert}”');
		expect(text('section-wrong-shape', { section: 'options' })).toContain('“start: robert”');
		expect(text('union-partner-count', { union: '#1', partners: ['A', 'B', 'C'], count: 3 })).toContain('“- partners: [robert, gwendoline]”');
		expect(text('through-spouse-no-claim', { person: 'H', count: 2, partners: ['A', 'B'], title: 'T' })).toContain('through-spouse: juliana');
		for (const id of ['robert', 'gwendoline', 'juliana']) expect(checkNewId(id, new Set()), id).toBeNull();
	});

	it('the ID rule says "small letters", and the plugin refuses a capital letter', () => {
		expect(ID_UI.characters).toBe('Use only small letters, digits and hyphens (-).');
		expect(REFUSAL_TEXT.idCharacters).toBe('An ID has only small letters, digits and hyphens.');
		expect(checkNewId('Robert', new Set())).toBe('characters');
	});
});

describe('D341: the example names', () => {
	it('"Es-clar-monde" gives the break places that the setting promises', () => {
		expect(quoted(SETTINGS_UI.breakWordsDesc)).toEqual(['Es-clar-monde']);
		const entry = parseBreakList('Es-clar-monde').get('esclarmonde')!;
		expect([...entry.places]).toEqual([2, 6]);
		expect(entry.length).toBe(11);
	});

	it('the last comma of the example "Mary, Queen of Scots," makes one name with no short form', () => {
		expect(quoted(T.namesHint)).toEqual(['Saturn, Sa', 'Mary, Queen of Scots,']);
		expect(parseNameLines('Mary, Queen of Scots,')).toEqual({ names: [{ name: 'Mary, Queen of Scots' }] });
		expect(parseNameLines('Saturn, Sa')).toEqual({ names: [{ name: 'Saturn', short: 'Sa' }] });
	});

	it('the person, house, holder and title examples are the names of the document', () => {
		expect(NEW_SHEET.namePlaceholder).toBe('For example: Rosamund de Clifford');
		expect(HOUSES.namePlaceholder).toBe('For example: House Plantagenet');
		expect(TITLES_UI.holderNamePlaceholder).toBe('For example: Rosamund de Clifford');
		expect(TITLES_UI.namePlaceholder).toBe('For example: Duchy of Normandy');
		expect(TITLES_UI.malePlaceholder).toBe('For example: Duke of Normandy');
		expect(TITLES_UI.femalePlaceholder).toBe('For example: Duchess of Normandy');
		expect(SHEET.titleHint).toContain('“Keeper of the Swans”');
		expect(SHEET.sobriquetHint).toContain('“the Conqueror”');
		expect(TITLES_UI.rulerHint).toContain('“Sir”');
	});
});

describe('D341: an empty Cycle means 1, like the grey 1 that it shows', () => {
	const start = (cycle: string): StartDraft => ({ saved: null, same: '1000', cycle, year: '' });
	const read = (s: StartDraft) => startOf(s, () => PLAIN_READER, true, 60);

	it('an empty Cycle gives the same start as "1"', () => {
		expect(T.cyclePlaceholder).toBe('1');
		expect(T.cyclePlaceholder).toBe(T.yearPlaceholder);
		const empty = read(start(''));
		expect(empty.ok).toBe(true);
		expect(empty).toEqual(read(start('1')));
		// Cycle 2 is another start: the empty field is not just "any value".
		expect(read(start('2'))).not.toEqual(empty);
	});
});
