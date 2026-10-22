// Step 4.3 of WP-4: the draft of the Calendars window, with no DOM. The entry form "Same year as", the checks (refusals stop a save, warnings do not), the test line,
// and the operations that turn the saved calendars into the draft: applied to the note text with the edit functions of core, they must give the calendars of the draft.
import { describe, expect, it } from 'vitest';
import { editCalendarBlock, parseCalendarBlock } from '../src/core/calendar-block';
import { findBlocks } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';
import type { Calendar } from '../src/core/dates';
import { checkDraft, calendarDraftChanged, draftOf, formatsOf, newCalendar, newEra, opsOf, startReadback, testLine, wholeOf, type CalendarDraft } from '../src/view/calendar-draft';
import { cycleNote, eraNote } from './support/calendar-vault';

const NOTE = 'Calendars.md';
let n = 0;
const key = () => n++;

const readNote = (text: string): Calendar[] => {
	const calendars: Calendar[] = [];
	findBlocks(text, 'kin-calendar').forEach((b, i) => calendars.push(...parseCalendarBlock(b.body, NOTE, i).calendars));
	return calendars;
};

/** Applies the operations of the draft to a note text, as the window does with `planWrite`; the new calendars of the text. */
function apply(text: string, saved: Calendar[], drafts: CalendarDraft[], outside: Calendar[] = []): { text: string; calendars: Calendar[]; refused: string[] } {
	const checked = checkDraft(drafts, NOTE, outside);
	if (checked.refusals.length) return { text, calendars: saved, refused: checked.refusals.map((r) => r.text) };
	let out = text;
	for (const { block, ops } of opsOf(saved, drafts, checked)) {
		const body = findBlocks(out, 'kin-calendar')[block].body;
		const plan = planWrite(out, block, body, (b) => {
			let cur = b;
			for (const op of ops) {
				const r = editCalendarBlock(cur, op);
				if (!r.ok) return { ok: false, reason: `${op.kind}: ${r.detail ?? r.code}` };
				cur = r.body;
			}
			return { ok: true, body: cur };
		}, 'kin-calendar');
		if (!plan.ok) throw new Error(JSON.stringify(plan));
		out = plan.newText;
	}
	return { text: out, calendars: readNote(out), refused: [] };
}

const names = (cs: Calendar[]) => cs.map((c) => c.name);

describe('the draft of a note', () => {
	it('has no change and no operation when nothing was typed', () => {
		const text = `${cycleNote()}\n${eraNote()}`;
		const saved = readNote(text);
		const drafts = draftOf(saved, key);
		const checked = checkDraft(drafts, NOTE, []);
		expect(checked.refusals).toEqual([]);
		expect(calendarDraftChanged(saved, drafts, checked)).toBe(false);
		expect(opsOf(saved, drafts, checked)).toEqual([]);
	});

	it('changes a name, a format, a length and a start; the text of the note follows and nothing else changes', () => {
		const text = cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 1);
		const saved = readNote(text);
		const drafts = draftOf(saved, key);
		drafts[0].name = 'The Count';
		drafts[0].formats = '{year} Year of the {cycle} Cycle\nYear {year} of Cycle {cycle}';
		drafts[0].length = '70';
		const out = apply(text, saved, drafts);
		expect(out.refused).toEqual([]);
		expect(out.calendars[0]).toMatchObject({ name: 'The Count', formats: ['{year} Year of the {cycle} Cycle', 'Year {year} of Cycle {cycle}'], kind: { type: 'cycles', length: 70, start: 1 } });
		expect(out.text.startsWith('# Calendars')).toBe(true);
	});

	it('adds a cycle calendar and an era calendar, and removes a calendar', () => {
		const text = `${cycleNote()}\n${eraNote()}`;
		const saved = readNote(text);
		const drafts = draftOf(saved, key);
		const cycle = newCalendar('cycles', key);
		Object.assign(cycle, { name: 'Moon count', formats: '{year} of the {cycle} Moon', length: '12' });
		const eras = newCalendar('eras', key);
		Object.assign(eras, { name: 'Houses', formats: '{era} {year}' });
		Object.assign(eras.eras[0], { name: 'Aldric', length: '20' });
		const out = apply(text, saved, [...drafts.slice(1), cycle, eras]);
		expect(out.refused).toEqual([]);
		// The new calendars go in the first block, in front of the second block that holds the era calendar that stays.
		expect(names(out.calendars)).toEqual(['Moon count', 'Houses', 'Reign names']);
		expect(out.calendars[1].kind).toMatchObject({ type: 'eras', eras: [{ name: 'Aldric', start: 1, length: 20 }] });
	});

	it('adds, changes and removes eras by their written places', () => {
		const text = `\`\`\`kin-calendar\ncalendars:\n  - name: Reigns\n    kind: eras\n    formats: ["{era} {year}"]\n    eras:\n      - {name: Aldan, start: 100, length: 10}\n      - {name: Bram, start: 110}\n      - {name: Cora, start: 130, length: 5}\n\`\`\`\n`;
		const saved = readNote(text);
		const d = draftOf(saved, key);
		d[0].eras[0].name = 'Aldan the First';
		d[0].eras[1].length = '20';
		d[0].eras.splice(2, 1);
		d[0].eras.push(Object.assign(newEra(key), { name: 'Dagny' }));
		d[0].eras[2].length = '';
		const out = apply(text, saved, d);
		expect(out.refused).toEqual([]);
		expect(out.calendars[0].kind).toMatchObject({ type: 'eras', eras: [{ name: 'Aldan the First', start: 100, length: 10 }, { name: 'Bram', start: 110, length: 20 }, { name: 'Dagny', start: 1 }] });
	});

	it('removes the length of an era when the field is emptied', () => {
		const text = eraNote('Reigns', 'Aldan', 100);
		const saved = readNote(text);
		const d = draftOf(saved, key);
		d[0].eras[0].length = '';
		const out = apply(text, saved, d);
		expect(out.calendars[0].kind).toMatchObject({ eras: [{ name: 'Aldan', start: 100 }] });
		expect((out.calendars[0].kind as { eras: { length?: number }[] }).eras[0].length).toBeUndefined();
	});

	it('makes the first calendar in a new note: `calendars: []` and one added calendar', () => {
		const text = '```kin-calendar\ncalendars: []\n```\n';
		const d = [Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} of {cycle}', length: '60' })];
		const out = apply(text, [], d);
		expect(out.refused).toEqual([]);
		expect(out.calendars).toHaveLength(1);
		expect(out.calendars[0].kind).toEqual({ type: 'cycles', length: 60, start: 1 });
	});

	it('removes the last calendar and leaves `calendars: []`', () => {
		const text = cycleNote();
		const saved = readNote(text);
		const out = apply(text, saved, []);
		expect(out.calendars).toEqual([]);
		expect(out.text).toContain('calendars: []');
	});
});

describe('Same year as', () => {
	const outside = readNote(eraNote('Reign names', 'Qinglong Emperor', 130));

	it('works the start of a cycle calendar out of a plain year', () => {
		const d = Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
		d.start.same = '1203';
		d.start.cycle = '3';
		d.start.year = '21';
		const checked = checkDraft([d], NOTE, []);
		expect(checked.refusals).toEqual([]);
		// year Y of cycle C is S + (C - 1) x L + (Y - 1): S = 1203 - 120 - 20.
		expect(checked.calendars[0].kind).toMatchObject({ start: 1063 });
		expect(checked.reader.read('21 Year of the 3 Cycle')?.year).toBe(1203);
		expect(startReadback(checked.starts.get(`c${d.key}`), checked.calendars[0], null)).toBe('Start: year 1063. This is the plain year of Year 1 of this calendar. Example: 21 Year of the 3 Cycle = year 1203');
	});

	it('reads a date in another calendar, and treats an empty example as year 1 of cycle 1', () => {
		const d = Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
		d.start.same = 'Qinglong Emperor 3';
		const checked = checkDraft([d], NOTE, outside);
		expect(checked.calendars[0].kind).toMatchObject({ start: 132 });
	});

	it('works the start of an era out of a date', () => {
		const d = newCalendar('eras', key);
		Object.assign(d, { name: 'Houses', formats: '{era} {year}' });
		Object.assign(d.eras[0], { name: 'Aldric' });
		d.eras[0].start.same = '1500';
		d.eras[0].start.year = '4';
		const checked = checkDraft([d], NOTE, []);
		expect(checked.calendars[0].kind).toMatchObject({ eras: [{ name: 'Aldric', start: 1497 }] });
		expect(startReadback(checked.starts.get(`e${d.eras[0].key}`), checked.calendars[0], null)).toContain('Aldric 4 = year 1500');
	});

	it('refuses a date with no year, and whole numbers that are not', () => {
		const d = Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} of {cycle}', length: '60' });
		d.start.same = 'long ago';
		expect(checkDraft([d], NOTE, []).refusals.map((r) => r.text)).toContain('The plugin cannot read a year in this date. Write a plain year, or a date that fits another calendar.');
		d.start.same = '1500';
		d.start.year = 'x';
		expect(checkDraft([d], NOTE, []).refusals.map((r) => r.text)).toContain('Write whole numbers in Cycle and Year.');
	});

	it('keeps the saved start when the entry form is empty, and says so', () => {
		const text = cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 130);
		const saved = readNote(text);
		const d = draftOf(saved, key);
		const checked = checkDraft(d, NOTE, []);
		expect(startReadback(checked.starts.get(`c${d[0].key}`), checked.calendars[0], 130)).toBe('The calendar starts at year 130. To change this, write a date in “Same year as”. Example: 1 Year of the 1 Cycle = year 130');
		expect(startReadback(checked.starts.get(`c${d[0].key}`), checked.calendars[0], null)).toBe('No “Same year as” date. The calendar starts at year 1. If you use other calendars or plain years, write a date in “Same year as”.');
	});
});

describe('refusals and warnings', () => {
	const cycle = (name: string, format: string) => Object.assign(newCalendar('cycles', key), { name, formats: format, length: '60' });

	it('refuses a calendar with no name, a bad format, a length below 1 and a format that two calendars share', () => {
		const text = (checked: ReturnType<typeof checkDraft>) => checked.refusals.map((r) => r.text);
		expect(text(checkDraft([cycle('', '{year} of {cycle}')], NOTE, [])).join('|')).toContain('A calendar must have a name.');
		expect(text(checkDraft([cycle('A', '{year} only')], NOTE, [])).join('|')).toContain('A cycle format needs {year} and {cycle}');
		expect(text(checkDraft([Object.assign(cycle('A', '{year} of {cycle}'), { length: '0' })], NOTE, [])).join('|')).toContain('The length of a cycle or an era');
		const two = text(checkDraft([cycle('A', '{year} of {cycle}'), cycle('B', '{Year} OF {cycle}')], NOTE, []));
		expect(two.join('|')).toContain('have the same format');
		expect(two.join('|')).toContain('“A”');
	});

	it('refuses the same era name twice and an era calendar with no era', () => {
		const eras = Object.assign(newCalendar('eras', key), { name: 'Houses', formats: '{era} {year}' });
		eras.eras = [Object.assign(newEra(key), { name: 'Aldric' }), Object.assign(newEra(key), { name: 'ALDRIC' })];
		expect(checkDraft([eras], NOTE, []).refusals.map((r) => r.text).join('|')).toContain('same era name');
		eras.eras = [];
		expect(checkDraft([eras], NOTE, []).refusals.map((r) => r.text)).toContain('This calendar has no era. Add an era.');
	});

	it('warns, and does not refuse, for a format that another calendar note has too', () => {
		const other = readNote(cycleNote('Copy', '{year} of {cycle}'));
		const mine = cycle('Mine', '{year} of {cycle}');
		const checked = checkDraft([mine], NOTE, other.map((c) => ({ ...c, note: 'Copy.md' })));
		expect(checked.refusals).toEqual([]);
		expect(checked.warnings.map((w) => w.text).join('|')).toContain('both have the calendar');
	});

	it('warns that a calendar with no example is read from year 1, beside another calendar', () => {
		const other = readNote(eraNote('Reign names', 'Qinglong Emperor', 130));
		const checked = checkDraft([cycle('Count', '{year} of {cycle}')], NOTE, other);
		// The window shows a short warning at Start (D278); the long sentence stays in the problem list of the tree, not in the warnings of the window.
		expect(checked.noAnchor.size).toBe(1);
		expect(checked.warnings).toEqual([]);
		const alone = checkDraft([cycle('Count', '{year} of {cycle}')], NOTE, []);
		expect(alone.warnings).toEqual([]);
		expect(alone.noAnchor.size).toBe(0);
	});

	it('warns for a calendar with no format', () => {
		const checked = checkDraft([Object.assign(cycle('Count', ''), { formats: '' })], NOTE, []);
		expect(checked.warnings.map((w) => w.text)).toContain('This calendar has no format. The plugin cannot read a date with it. Add a format.');
	});
});

describe('the test line', () => {
	const d = Object.assign(newCalendar('cycles', key), { name: 'The Long Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
	d.start.same = '1000';
	const reader = checkDraft([d], NOTE, []).reader;

	it('reads a calendar date and shows the cycle, the year and the internal year', () => {
		expect(testLine(reader, '10 Year of the 3 Cycle')).toBe('The Long Count: Cycle 3, Year 10 = year 1129');
	});

	it('shows nothing for an empty field and for a plain year, and "No year found" for other text', () => {
		expect(testLine(reader, '')).toBe('');
		expect(testLine(reader, '  ')).toBe('');
		expect(testLine(reader, '1203')).toBe('');
		expect(testLine(reader, 'long ago')).toBe('No year found. Write a year, or add a format for this date in a calendar.');
	});

	it('adds the warning of a year 0 and of a year past the end', () => {
		expect(testLine(reader, '0 Year of the 3 Cycle')).toContain('Year 0 counts as the year before Year 1. Check that you mean this.');
		expect(testLine(reader, '61 Year of the 3 Cycle')).toContain('This year is after the end of its cycle or era. The plugin counts on from the last year.');
	});
});

describe('typed numbers and formats', () => {
	it('reads whole numbers only', () => {
		expect(wholeOf('12')).toBe(12);
		expect(wholeOf(' -3 ')).toBe(-3);
		expect(wholeOf('')).toBeUndefined();
		expect(wholeOf('1.5')).toBeNull();
		expect(wholeOf('9'.repeat(30))).toBeNull();
	});

	it('takes one format from each text line', () => {
		expect(formatsOf('a\n\n  b  \r\nc')).toEqual(['a', 'b', 'c']);
	});
});
