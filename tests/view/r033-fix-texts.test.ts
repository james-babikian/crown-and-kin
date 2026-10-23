// The one fix round of WP-6 steps 2 and 3: the texts of the clarity check (the clarity rewrites and rulings in an internal study), word for word, the plain-year duplicate of the index,
// and the accessor for the plain-year lists of a note.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarRefusalText, codedIssue, issueText } from '../../src/core/messages';
import { CALENDAR_BLOCK_UI, CALENDAR_UI, CALENDAR_WINDOW_UI as T, DATE_READOUT_UI } from '../../src/render/calendar-text';
import { CHANGE_UI } from '../../src/render/change-text';
import { createCalendarIndex } from '../../src/view/calendar-index';
import { fakeVault } from '../support/calendar-vault';

const refusal = (key: string, more: Record<string, unknown> = {}) => calendarRefusalText({ calendar: 'Long Count', key, listName: 'Planets', list: 0, ...more });

describe('B: the refusal texts', () => {
	it('say "marker", name the marker, and use "text line" for a line of text', () => {
		expect(refusal('calendar-marker-unknown', { detail: '{cycle}.{year} {animal}', marker: 'animal' })).toBe(
			'The format “{cycle}.{year} {animal}” has the marker “{animal}”, but no name list of the calendar “Long Count” has this marker. Add a name list with this marker, or remove the marker from the format.',
		);
		expect(refusal('calendar-marker-touching', { detail: '{cycle}{planet}' })).toBe(
			'In the format “{cycle}{planet}”, a marker stands directly next to another marker or number, so the plugin cannot tell where one ends. Put a word or a space between them.',
		);
		expect(refusal('name-twice', { detail: 'Sun' })).toBe('The name list “Planets” has the text “Sun” two times. Each name and each short form must be different, so that the plugin can find the year of a name.');
		expect(refusal('name-length')).toBe('In the name list “Planets”, a name or a short form has no text or has more than 40 characters. Write 1 to 40 characters.');
		expect(refusal('marker-invalid')).toBe('The marker of the name list “Planets” is not valid. Use 1 to 24 letters, digits or hyphens. Start with a letter. Do not use year, cycle or era.');
		expect(refusal('known-no-year')).toBe('The plugin cannot read the known year of the name list “Planets”. Write a date that the calendar can read.');
		expect(refusal('known-no-year', { plain: true })).toBe('The plugin cannot read the known year of the name list “Planets”. Write a plain year, for example 1273.');
		expect(refusal('known-no-name')).toBe('The known year of the name list “Planets” has no name, or its name is not in the list. Write a name or a short form from the list.');
		expect(refusal('list-name-length')).toBe('Name list 1 of the calendar “Long Count” has a name with more than 60 characters. Write a name with 60 characters or fewer.');
		expect(refusal('calendar-name-twice', { calendar: 'Count' })).toBe('Two calendars of this note have the name “Count”. Give each calendar its own name, so that the plugin can tell them apart.');
	});
});

describe('B: the sentences of the notes of the tree', () => {
	const text = (code: 'calendar-name-mismatch' | 'calendar-list-invalid', params: Record<string, string | number>) => issueText(codedIssue(code, 'warning', params));
	it('calendar-name-mismatch', () => {
		expect(text('calendar-name-mismatch', { where: 'born', person: 'Hugo', value: '22.13 Ju', list: 'Planets', expected: 'Saturn', written: 'Jupiter' })).toBe(
			'Hugo has “born: 22.13 Ju”. In the list “Planets”, this year is Saturn. The date says Jupiter. The plugin keeps the year of the date. Correct the name in the date, or remove the name.',
		);
	});
	it('calendar-list-invalid', () => {
		const base = { note: 'C.md', calendar: 'Count', index: 2 };
		expect(text('calendar-list-invalid', { ...base, why: 'size' })).toContain('it has more than 60 names, or it is the fifth list or later (a calendar has at most 4 name lists)');
		expect(text('calendar-list-invalid', { ...base, why: 'known' })).toContain('its known year in the note is not a whole number');
		expect(text('calendar-list-invalid', { note: 'C.md', index: 0, why: 'lists' })).toContain('they are not a list. A list has one item on each text line, after a “-”');
		expect(text('calendar-list-invalid', { ...base, why: 'marker', marker: 'star' })).toBe(
			'A format of the calendar “Count” in the note “C.md” has the marker “{star}”, but no name list of the calendar has this marker. The plugin reads such dates without the name, and it does not check a name. Add a name list with this marker, or remove the marker from the format.',
		);
	});
});

describe('A: the texts of the Calendars window', () => {
	it('say what the clarity check asked for', () => {
		expect(DATE_READOUT_UI.nameMismatch('Planets', 'Saturn', 'Jupiter')).toBe('In the list Planets, this year is Saturn. The date says Jupiter. The plugin uses the year of the date.');
		expect(T.removeCalendar('')).toBe('Remove the calendar without a name');
		expect(T.summaryYears(1)).toBe('1 year in a cycle');
		expect(T.summaryYears(60)).toBe('60 years in a cycle');
		expect(T.summaryLists(['Planets'])).toBe('Name list: Planets');
		expect(T.summaryLists(['Planets', 'Moons'])).toBe('Name lists: Planets, Moons');
		expect(T.knownBackPlain(1273, 'Saturn', 7)).toBe('The name of year 1273 is Saturn. The names repeat every 7 years.');
		expect(T.knownDateBadPlain).toBe('The plugin cannot read a year in this date. Write a plain year, for example 1273.');
		expect(T.showLabel).toBe('Name of the year on cards');
		expect(T.showHint).toBe('The plugin adds the name after a date on cards and in lists. A date that already has the name shows as you wrote it.');
		expect(T.showShort).toBe('Short form');
		expect(T.testLabel).toBe('Test a date');
		expect(T.testHint).toBe('The plugin shows the date as a plain year, for example “year 1273”.');
		expect(T.refusalHead(1)).toBe('Correct this error:');
		expect(T.refusalHead(2)).toBe('Correct these errors:');
		expect(T.markerPlaceholder).toBe('For example: {planet}');
		expect(T.namesPlaceholder).toBe('For example: Saturn, Sa');
		expect(CALENDAR_BLOCK_UI.listMarker('Planets', 'planet')).toBe('Planets, marker {planet}');
		expect(T.cannotSaveBecause('X.')).toBe('The plugin cannot save the calendars. X. Your changes stay in this window.');
		expect(CALENDAR_UI.more).toBe('Calendars');
	});
	it('have no sentence of more than 25 words', () => {
		const hints = [T.noLists, T.plainHint, T.markerHint, T.namesHint, T.knownHint, T.showHint, T.testHint, T.startNoAnchor, T.knownDateBadPlain];
		for (const hint of hints) for (const s of hint.split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25);
	});
});

describe('C: the texts of the change line', () => {
	it('say what the plugin did, in short sentences', () => {
		expect(CHANGE_UI.addedParentAndMarriage('Cora', 'Bran', 'birth', 'Aldric')).toBe('The plugin added Cora as a parent of Bran. It also added a marriage of Cora and Aldric.');
		expect(CHANGE_UI.undone).toBe('The plugin undid the last change to the tree.');
		expect(CHANGE_UI.markedMe('Aldric')).toBe('The plugin marked Aldric with “This is me”.');
	});
});

describe('item 9: the index', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());
	const plain = (name: string) => `\`\`\`kin-calendar\nplain:\n  lists:\n    - {name: ${name}, names: [Rat, Ox], known: {year: 1273, index: 1}, show: short}\n\`\`\`\n`;
	// D289: a tree uses one calendar note, so two notes with a list of one name are no problem: the tree uses the lists of the note it names.
	it('gives the plain-year lists of the note that a tree names, and no problem when another note has a list of the same name', async () => {
		const vault = fakeVault({ 'a.md': plain('Animals'), 'b.md': plain('animals'), 'c.md': '# no calendar\n' }, true);
		vault.links.set('[[A]]', 'a.md');
		const index = createCalendarIndex(vault);
		await index.start();
		index.readerFor('t.md', '[[A]]');
		await vi.advanceTimersByTimeAsync(1000);
		expect(index.plainListsOf('a.md').map((l) => l.name)).toEqual(['Animals']);
		expect(index.plainListsOf('b.md')).toEqual([]);
		expect(index.readerFor('t.md', '[[A]]').problems).toEqual([]);
	});
});
