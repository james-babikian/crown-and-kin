// G2 review of WP-4 step 4.3: the draft of the Calendars window. Failing proofs; each test says what it expects.
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { parseCalendarBlock } from '../src/core/calendar-block';
import type { Calendar } from '../src/core/dates';
import { checkDraft, calendarDraftChanged, draftOf, opsOf } from '../src/view/calendar-draft';
import { writeCalendars } from '../src/view/calendar-write';

const NOTE = 'Calendars.md';
let n = 0;
const key = () => n++;

const readNote = (text: string): Calendar[] => {
	const out: Calendar[] = [];
	findBlocks(text, 'kin-calendar').forEach((b, i) => out.push(...parseCalendarBlock(b.body, NOTE, i).calendars));
	return out;
};
const bodies = (text: string) => findBlocks(text, 'kin-calendar').map((b) => b.body);

const ERA_NO_START = ['```kin-calendar', 'calendars:', '  - name: Reigns', '    kind: eras', '    formats: ["{era} {year}"]', '    eras:', '      - {name: Qinglong, start: soon, length: 11}', '  - name: Other', '    kind: eras', '    formats: ["{era} {year}"]', '    eras:', '      - {name: Jianwen, start: 141}', '```', ''].join('\n');

describe('an era or cycle start that the note holds but the window cannot read', () => {
	it('does not make the window dirty when it opens, and Cancel would ask to discard nothing', () => {
		const saved = readNote(ERA_NO_START);
		const drafts = draftOf(saved, key);
		const checked = checkDraft(drafts, NOTE, []);
		expect(calendarDraftChanged(saved, drafts, checked)).toBe(false);
	});

	it('does not rewrite the start of an era that the user did not touch, when another calendar is renamed', () => {
		const saved = readNote(ERA_NO_START);
		const drafts = draftOf(saved, key);
		drafts[1].name = 'Other renamed';
		const checked = checkDraft(drafts, NOTE, []);
		const plan = opsOf(saved, drafts, checked);
		const out = writeCalendars(ERA_NO_START, bodies(ERA_NO_START), plan);
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.text).toContain('start: soon');
	});

	it('does not rewrite a cycle start the note holds as text', () => {
		const text = ['```kin-calendar', 'calendars:', '  - name: Count', '    kind: cycles', '    length: 60', '    start: "12b"', '    formats: ["{year} of {cycle}"]', '  - name: Two', '    kind: cycles', '    length: 10', '    start: 5', '    formats: ["{year} in {cycle}"]', '```', ''].join('\n');
		const saved = readNote(text);
		const drafts = draftOf(saved, key);
		drafts[1].name = 'Two renamed';
		const out = writeCalendars(text, bodies(text), opsOf(saved, drafts, checkDraft(drafts, NOTE, [])));
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.text).toContain('12b');
	});
});

describe('text that the window normalises but the reader keeps', () => {
	const SPACED = ['```kin-calendar', 'calendars:', '  - name: Count', '    kind: cycles', '    length: 60', '    start: 1', '    formats: ["{year} of the {cycle} ", "Year {year} of {cycle}"]', '  - name: Two', '    kind: cycles', '    length: 10', '    start: 5', '    formats: ["{year} in {cycle}"]', '```', ''].join('\n');

	it('a format written with a trailing space does not make the window dirty when it opens', () => {
		const saved = readNote(SPACED);
		const drafts = draftOf(saved, key);
		expect(calendarDraftChanged(saved, drafts, checkDraft(drafts, NOTE, []))).toBe(false);
	});

	it('a format written with a trailing space is not rewritten when another calendar is renamed', () => {
		const saved = readNote(SPACED);
		const drafts = draftOf(saved, key);
		drafts[1].name = 'Two renamed';
		const out = writeCalendars(SPACED, bodies(SPACED), opsOf(saved, drafts, checkDraft(drafts, NOTE, [])));
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.text).toBe(SPACED.replace('name: Two', 'name: Two renamed'));
	});
});

import { editCalendarBlock } from '../src/core/calendar-block';
import { compileCalendars } from '../src/core/dates';
import { newCalendar } from '../src/view/calendar-draft';
import { NEW_NOTE_TEXT } from '../src/view/calendar-write';

describe('"Same year as" that names a calendar of the same session', () => {
	it('anchors the second new calendar to the first as the first will be saved', () => {
		const a = newCalendar('cycles', key);
		Object.assign(a, { name: 'Long Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
		Object.assign(a.start, { same: '1500', cycle: '1', year: '1' }); // Year 1 of Cycle 1 is the plain year 1500
		const b = newCalendar('eras', key);
		Object.assign(b, { name: 'Reigns', formats: '{era} {year}' });
		Object.assign(b.eras[0], { name: 'Aldric' });
		// Year 1 of Aldric is the same year as Year 1 of Cycle 1 of the Long Count.
		Object.assign(b.eras[0].start, { same: '1 Year of the 1 Cycle', year: '1' });
		const drafts = [a, b];
		const checked = checkDraft(drafts, NOTE, []);
		expect(checked.refusals).toEqual([]);
		const out = writeCalendars(NEW_NOTE_TEXT, bodies(NEW_NOTE_TEXT), opsOf([], drafts, checked));
		expect(out.ok).toBe(true);
		if (!out.ok) return;
		const reader = compileCalendars(readNote(out.text), true);
		expect(reader.read('1 Year of the 1 Cycle')?.year).toBe(1500);
		// The same year in the two saved calendars.
		expect(reader.read('Aldric 1')?.year).toBe(1500);
		void editCalendarBlock;
	});
});
