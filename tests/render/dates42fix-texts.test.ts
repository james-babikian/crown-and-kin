// Fix round of step 4.2, ruling 7: the final texts of the clarity editor, word for word, and the rule that no known refusal key reaches the fallback.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALENDAR_REFUSAL_TEXT, calendarRefusalText, codedIssue, issueText, type IssueCode, type IssueParams } from '../../src/core/messages';
import { REFUSAL_TEXT } from '../../src/core/refusal-text';
import { SUCCESSION_UI } from '../../src/render/succession-text';

const text = (code: IssueCode, params: IssueParams) => issueText(codedIssue(code, 'warning', params));
const PERSON = { where: 'born', value: '0', person: 'Hugo' };
const TITLE = { where: 'year', value: '0', title: 'Crown' };

describe('the date warnings', () => {
	it('year-zero', () => {
		expect(text('year-zero', TITLE)).toBe('The title Crown has “year: 0”. There is no year 0. The plugin reads 0 as 1 BC. If you mean AD 1, write “1”. For a year before that, write a number with a minus sign, such as “-5”, for 5 BC.');
		expect(text('year-zero', PERSON)).toBe('Hugo has “born: 0”. There is no year 0. The plugin reads 0 as 1 BC. If you mean AD 1, write “1”. For a year before that, write a number with a minus sign, such as “-5”, for 5 BC.');
	});

	it('calendar-year-zero', () => {
		expect(text('calendar-year-zero', PERSON)).toBe('Hugo has “born: 0”. A cycle or an era has no Year 0. The plugin counts this date as the year before Year 1. If you mean Year 1, correct the date.');
	});

	it('calendar-year-past-end', () => {
		expect(text('calendar-year-past-end', PERSON)).toBe(
			'Hugo has “born: 0”. The year in this date is after the last year of its cycle or era. The plugin continues the count past the end. If this is a mistake, correct the date. If the cycle or era is longer, change its length in the Calendars window.',
		);
	});

	it('fits-two-calendars', () => {
		expect(text('fits-two-calendars', { ...PERSON, calendars: ['A', 'B'] })).toBe(
			'Hugo has “born: 0”. The date fits the calendars “A” and “B” and gives a different year in each. As a result, the plugin uses no year for this date. Change the date, or change a calendar so that only one calendar fits it.',
		);
	});

	it('calendar-no-anchor', () => {
		expect(text('calendar-no-anchor', { calendar: 'The Long Count' })).toBe(
			'The calendar “The Long Count” has no “Same year as” date that links it to plain years. So the plugin counts its Year 1 as plain year 1. The tree also has plain years or dates of another calendar. As a result, the order of dates and the ages can be wrong. In the Calendars window, add a “Same year as” date to the calendar.',
		);
	});

	it('calendar-note-missing', () => {
		expect(text('calendar-note-missing', { note: '[[Far]]' })).toBe(
			'The tree uses the calendar note “[[Far]]”, but this note does not exist or has no calendar. As a result, the plugin reads no dates in your own calendars. Correct the link in the text of the tree. Or select “Calendar note” in the More list, and choose another note or “No calendar”.',
		);
	});

	it('calendar-block-invalid', () => {
		expect(text('calendar-block-invalid', { note: 'A.md' })).toBe(
			'The calendar block in the note “A.md” has an error, so the plugin ignores it. The tree uses no calendar from this block. Edit the text of the block in the note. The block must have a list under “calendars:”.',
		);
	});

	it('calendar-entry-invalid, with the four reasons', () => {
		const why = { 'no-name': 'it has no name', 'not-map': 'it is not a group of keys, such as “name:”', kind: 'its “kind:” is not “cycles” or “eras”', era: 'one of its eras has no name' };
		for (const [key, reason] of Object.entries(why)) {
			expect(text('calendar-entry-invalid', { note: 'A.md', index: 2, why: key })).toBe(`Calendar 2 in the block of the note “A.md” cannot be used, because ${reason}. The plugin ignores it. Edit the text of the block in the note.`);
		}
	});
});

describe('the Calendars window refusals', () => {
	const refuse = (key: string, other?: string) => calendarRefusalText({ calendar: 'Reign names', key, ...(other ? { other } : {}) });

	it('the format refusals', () => {
		expect(refuse('calendar-format-cycle')).toBe('A cycle format needs {year} and {cycle}, one time each. It cannot have any other word in curly brackets. An example is “{year} Year of the {cycle} Cycle”.');
		expect(refuse('calendar-format-era')).toBe('An era format needs {year} and {era}, one time each. It cannot have any other word in curly brackets. An example is “{era} {year}”.');
		expect(refuse('calendar-format-touching')).toBe('In this format, {cycle} and {year} are next to each other, so the plugin cannot tell where one ends. Put a word or a space between them.');
	});

	it('the duplicates name both calendars, and keep the variant for one calendar', () => {
		expect(refuse('calendar-format-duplicate', 'Dynasties')).toBe('The calendar “Reign names” and the calendar “Dynasties” have the same format. A date in this format would fit both. Change one format.');
		expect(refuse('calendar-era-duplicate', 'Dynasties')).toBe('The calendar “Reign names” and the calendar “Dynasties” have the same era name. A date with this name would fit both. Change one era name.');
		expect(refuse('calendar-format-duplicate')).toBe('The calendar “Reign names” has the same format two times. Change one format.');
		expect(refuse('calendar-era-duplicate')).toBe('The calendar “Reign names” has the same era name two times. Change one era name.');
	});

	it('the number refusals, here and in the refused edits', () => {
		expect(refuse('calendar-length')).toBe('The length of a cycle or an era is a number of years. Write a whole number, 1 or more.');
		expect(refuse('calendar-number')).toBe('The start and the length of a calendar or an era must be whole numbers.');
		expect(REFUSAL_TEXT.calendarLength).toBe(refuse('calendar-length'));
		expect(REFUSAL_TEXT.calendarNumber).toBe(refuse('calendar-number'));
	});

	it('the fallback is reachable by no key that the code gives', () => {
		// The keys are written in the files of the date reader (the formats moved out of dates.ts in 0.3.3).
		const source = ['dates', 'date-formats', 'name-lists'].map((f) => readFileSync(`src/core/${f}.ts`, 'utf8')).join('\n');
		const keys = new Set([...source.matchAll(/'(calendar-(?:format|era|length|number)[a-z-]*)'/g)].map((m) => m[1]));
		expect(keys.size).toBeGreaterThanOrEqual(7);
		for (const key of keys) {
			expect(Object.keys(CALENDAR_REFUSAL_TEXT), key).toContain(key);
			expect(refuse(key), key).not.toBe('The calendar has an error. Correct the calendar.');
		}
	});
});

describe('the line note', () => {
	it('diedNoYear says the year of the line as written, then how to change it', () => {
		expect(SUCCESSION_UI.diedNoYear('Cora', 'Aldric 10')).toBe('The plugin cannot read a year in the death date of Cora. So in this line, it counts Cora as dead in Aldric 10. To change this, write a year in the death date.');
	});
});
