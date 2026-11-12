// D342: the eras of an era calendar as text lines in the Calendars window. The owner's examples word for word: "Reign of Aldric, 1100", "Reign of Aldric, 1100 to 1139",
// "Reign of Aldric, the Elder, 1100", the end of an era with no last year (Aldric 1100, Bran 1140: "Reign of Aldric 50" is 1149 with a warning), and the refusal
// "Text line 1: write the name, a comma and the first year." Also the write: the note keeps `{name, start, length?}`, and an unchanged era keeps its bytes.
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { planWrite } from '../../src/core/block-write';
import { editCalendarBlock, parseCalendarBlock } from '../../src/core/calendar-block';
import type { Calendar } from '../../src/core/dates';
import { calendarDraftChanged, checkDraft, draftOf, newCalendar, opsOf, type CalendarDraft } from '../../src/view/calendar-draft';
import { eraLineText, eraLinesOf, eraReadings, erasTextOf, pairEraLines, splitEraLine } from '../../src/view/calendar-era-lines';

const NOTE = 'Calendars.md';
let n = 0;
const key = () => n++;

const readNote = (text: string): Calendar[] => findBlocks(text, 'kin-calendar').flatMap((b, i) => parseCalendarBlock(b.body, NOTE, i).calendars);

/** A new era calendar "Reigns" with the format "{era} {year}" and the text of its eras box. */
const eraCalendar = (eras: string): CalendarDraft => Object.assign(newCalendar('eras', key), { name: 'Reigns', formats: '{era} {year}', erasText: eras });

/** The eras that the draft reads, and its refusals. */
function read(eras: string) {
	const checked = checkDraft([eraCalendar(eras)], NOTE);
	const c = checked.calendars[0];
	return { eras: c.kind.type === 'eras' ? c.kind.eras : [], refusals: checked.refusals.map((r) => r.text), reader: checked.reader };
}

/** Applies the operations of the draft to the note text, as the window does. */
function apply(text: string, saved: Calendar[], drafts: CalendarDraft[]): string {
	const checked = checkDraft(drafts, NOTE);
	expect(checked.refusals).toEqual([]);
	let out = text;
	for (const { block, ops } of opsOf(saved, drafts, checked)) {
		const plan = planWrite(out, block, findBlocks(out, 'kin-calendar')[block].body, (b) => {
			let cur = b;
			for (const op of ops) {
				const r = editCalendarBlock(cur, op);
				if (!r.ok) return { ok: false, reason: r.detail ?? r.code };
				cur = r.body;
			}
			return { ok: true, body: cur };
		}, 'kin-calendar');
		if (!plan.ok) throw new Error(JSON.stringify(plan));
		out = plan.newText;
	}
	return out;
}

describe('D342: the examples of a text line on the decision page', () => {
	it('"Reign of Aldric, 1100" is the era Reign of Aldric with the first year 1100 and no length', () => {
		expect(read('Reign of Aldric, 1100')).toMatchObject({ eras: [{ name: 'Reign of Aldric', start: 1100 }], refusals: [] });
		expect(read('Reign of Aldric, 1100').eras[0].length).toBeUndefined();
	});

	it('"Reign of Aldric, 1100 to 1139" has the length 40', () => {
		expect(read('Reign of Aldric, 1100 to 1139').eras).toEqual([{ name: 'Reign of Aldric', start: 1100, length: 40 }]);
	});

	it('"Reign of Aldric, the Elder, 1100": the last comma before the year ends the name', () => {
		expect(read('Reign of Aldric, the Elder, 1100').eras).toEqual([{ name: 'Reign of Aldric, the Elder', start: 1100 }]);
	});

	it('Aldric 1100 and Bran 1140 with no last year: "Reign of Aldric 50" is the year 1149 with a warning, "Reign of Aldric 40" is 1139 with none', () => {
		const { reader } = read('Reign of Aldric, 1100\nReign of Bran, 1140');
		const fifty = reader.read('Reign of Aldric 50')!;
		expect(fifty.year).toBe(1149);
		expect(fifty.warnings).toEqual(['calendar-year-past-end']);
		const forty = reader.read('Reign of Aldric 40')!;
		expect(forty.year).toBe(1139);
		expect(forty.warnings).toEqual([]);
		// Only the last era has no end.
		expect(reader.read('Reign of Bran 500')!.warnings).toEqual([]);
	});

	it('"Reign of Aldric, the Elder" (no year) refuses with the number of its text line', () => {
		expect(read('Reign of Aldric, the Elder').refusals).toEqual(['Text line 1: write the name, a comma and the first year.']);
		expect(read('Reign of Aldric, 1100\n\nReign of Bran').refusals).toEqual(['Text line 3: write the name, a comma and the first year.']);
	});
});

describe('D342: the other refusals of a text line, each with its number', () => {
	it('a last year before the first year, a last year that cannot be read, "to" with nothing after it, a name twice', () => {
		expect(read('Aldric, 1100 to 1090').refusals).toEqual(['Text line 1: the last year is before the first year. Write a last year that is not before the first year.']);
		expect(read('Aldric, 1100\nBran, 1140 to soon').refusals).toEqual(['Text line 2: the plugin cannot read the year after “to”. Write a plain year, or a date in another calendar.']);
		expect(read('Aldric, 1100 to').refusals).toEqual(['Text line 1: the plugin cannot read the year after “to”. Write a plain year, or a date in another calendar.']);
		expect(read('Aldric, 1100\nBran, 1140\naldric, 1180').refusals).toEqual(['Text line 3: text line 1 has the same era name. Give each era its own name.']);
	});

	it('no comma, an empty name, and an empty box', () => {
		expect(read('Aldric 1100').refusals).toEqual(['Text line 1: write the name, a comma and the first year.']);
		expect(read(', 1100').refusals).toEqual(['Text line 1: write the name, a comma and the first year.']);
		expect(read('').refusals).toEqual(['This calendar has no era. Write one era on each text line, for example “Reign of Aldric, 1100”.']);
	});

	it('an era name that another era calendar of the note has stands under the eras box', () => {
		const a = eraCalendar('Aldric, 1100');
		const b = Object.assign(eraCalendar('Bran, 1200\nAldric, 1300'), { name: 'Others' });
		const checked = checkDraft([a, b], NOTE);
		expect(checked.refusals.map((r) => [r.key, r.field])).toEqual([[b.key, 'eras']]);
	});
});

describe('D342: the forms of a text line', () => {
	const plain = (t: string) => /^-?\d+( BC)?$/.test(t.trim());

	it('"to" in any case, white space around the comma, BC years, empty text lines ignored', () => {
		expect(read('  Aldric ,1100 TO 1139  ').eras).toEqual([{ name: 'Aldric', start: 1100, length: 40 }]);
		expect(read('Old Kings, 200 BC to 1 BC').eras).toEqual([{ name: 'Old Kings', start: -199, length: 200 }]);
		expect(eraLinesOf('\n A, 1 \n\n B, 2\n')).toEqual([{ line: 2, text: 'A, 1' }, { line: 4, text: 'B, 2' }]);
	});

	it('the first year can be a date in another calendar of the note, as "Same year as" reads it', () => {
		const count = Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
		Object.assign(count.start, { same: '1000' });
		const eras = eraCalendar('Aldric, 3 Year of the 2 Cycle to 10 Year of the 2 Cycle');
		const checked = checkDraft([count, eras], NOTE);
		expect(checked.refusals).toEqual([]);
		expect(checked.calendars[1].kind).toEqual({ type: 'eras', eras: [{ name: 'Aldric', start: 1062, length: 8 }] });
	});

	it('a saved era shows as "name, start" or "name, start to last", in plain years that read back the same', () => {
		expect(eraLineText({ name: 'Reign of Aldric', start: 1100 })).toBe('Reign of Aldric, 1100');
		expect(eraLineText({ name: 'Reign of Aldric', start: 1100, length: 40 })).toBe('Reign of Aldric, 1100 to 1139');
		expect(eraLineText({ name: 'Reign of Aldric, the Elder', start: 1100 })).toBe('Reign of Aldric, the Elder, 1100');
		expect(eraLineText({ name: 'Old Kings', start: -199, length: 200 })).toBe('Old Kings, 200 BC to 1 BC');
		expect(eraLineText({ name: 'Year zero', start: 0 })).toBe('Year zero, 1 BC');
		for (const e of [{ name: 'Reign of Aldric, the Elder', start: 1100, length: 40 }, { name: 'Old Kings', start: -199, length: 200 }, { name: 'A, B, C', start: 5 }]) {
			const split = splitEraLine(eraLineText(e), plain);
			expect(split).toMatchObject({ ok: true, name: e.name });
		}
		expect(erasTextOf([{ name: 'A', start: 1 }, { name: 'B', start: 2, length: 3 }])).toBe('A, 1\nB, 2 to 4');
	});
});

describe('D342: the reading list', () => {
	it('names each era with its first year, and ends an era with no last year at the start of the next era by year, not by text line', () => {
		expect(eraReadings([{ name: 'Cara', start: 1180 }, { name: 'Aldric', start: 1100 }, { name: 'Dina', start: 1160 }, { name: 'Bran', start: 1140, length: 5 }])).toEqual([
			{ name: 'Cara', start: 1180 },
			{ name: 'Aldric', start: 1100, end: 1139 },
			{ name: 'Dina', start: 1160, end: 1179 },
			{ name: 'Bran', start: 1140, end: 1144 },
		]);
	});
});

describe('D342: the note keeps its form, and an unchanged era keeps its bytes', () => {
	const TEXT = ['# Calendars', '', '```kin-calendar', 'calendars:', '  - name: Reigns', '    kind: eras', '    formats: ["{era} {year}"]', '    eras:', '      - {name: "Reign of Aldric", start: 1100}  # the first king', '      - {name: Reign of Bran, start: 1140, length: 20}', '```', ''].join('\n');

	it('opens with the text lines of the note, no change and no operation', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		expect(d[0].erasText).toBe('Reign of Aldric, 1100\nReign of Bran, 1140 to 1159');
		const checked = checkDraft(d, NOTE);
		expect(checked.refusals).toEqual([]);
		expect(calendarDraftChanged(saved, d, checked)).toBe(false);
		expect(opsOf(saved, d, checked)).toEqual([]);
	});

	it('a text line added at the end adds one era and leaves the other text lines of the note as written', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText += '\nReign of Cara, 1160';
		const out = apply(TEXT, saved, d);
		expect(out.split('\n').slice(0, 10)).toEqual(TEXT.split('\n').slice(0, 10));
		expect(readNote(out)[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Bran', start: 1140, length: 20 }, { name: 'Reign of Cara', start: 1160 }] });
	});

	it('a text line typed in the middle puts the era there, and a deleted text line removes its era', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Aldric, 1100\nReign of Dina, 1120\nReign of Bran, 1140 to 1159';
		const out = apply(TEXT, saved, d);
		expect(out).toContain('# the first king');
		expect(readNote(out)[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Dina', start: 1120 }, { name: 'Reign of Bran', start: 1140, length: 20 }] });
		const d2 = draftOf(readNote(out), key);
		d2[0].erasText = 'Reign of Aldric, 1100\nReign of Bran, 1140 to 1159';
		expect(readNote(apply(out, readNote(out), d2))[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Bran', start: 1140, length: 20 }] });
	});

	it('a comma in an era name is written as the note needs it, and reads back', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Aldric, the Elder, 1100\nReign of Bran, 1140 to 1159';
		const out = apply(TEXT, saved, d);
		const again = draftOf(readNote(out), key);
		expect(again[0].erasText).toBe('Reign of Aldric, the Elder, 1100\nReign of Bran, 1140 to 1159');
	});
});

describe('D342: deleting or typing a text line leaves every other era of the note as written', () => {
	const TEXT = ['# Calendars', '', '```kin-calendar', 'calendars:', '  - name: Reigns', '    kind: eras', '    formats: ["{era} {year}"]', '    eras:',
		'      - {name: "Reign of Aldric", start: 1100}  # the first king', '      - {name: Reign of Bran, start: 1140, length: 20}  # second', '      - {name: Cara, start: 1170}', '```', ''].join('\n');
	const ALDRIC = '      - {name: "Reign of Aldric", start: 1100}  # the first king';
	const BRAN = '      - {name: Reign of Bran, start: 1140, length: 20}  # second';
	const CARA = '      - {name: Cara, start: 1170}';

	it('deleting the first text line leaves the bytes and the comments of the other eras as they were', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Bran, 1140 to 1159\nCara, 1170';
		expect(apply(TEXT, saved, d)).toBe(TEXT.replace(`${ALDRIC}\n`, ''));
	});

	it('typing a new text line in the middle leaves the bytes and the comments of the other eras as they were', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Aldric, 1100\nDina, 1120\nReign of Bran, 1140 to 1159\nCara, 1170';
		expect(apply(TEXT, saved, d)).toBe(TEXT.replace(BRAN, `      - {name: Dina, start: 1120}\n${BRAN}`));
	});

	it('typing a new first text line and deleting the last one in one Save', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Old Kings, 1000\nReign of Aldric, 1100\nReign of Bran, 1140 to 1159';
		expect(apply(TEXT, saved, d)).toBe(TEXT.replace(ALDRIC, `      - {name: Old Kings, start: 1000}\n${ALDRIC}`).replace(`${CARA}\n`, ''));
	});

	it('a changed text line changes only its own era, and keeps its comment', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Aldric, 1100\nReign of Bran, 1141 to 1159\nCara, 1170';
		expect(apply(TEXT, saved, d)).toBe(TEXT.replace(BRAN, '      - {name: Reign of Bran, start: 1141, length: 19}  # second'));
	});

	it('a deleted text line next to a changed one: the changed text line keeps the era of its own name', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Reign of Bran, 1141 to 1159\nCara, 1170';
		expect(apply(TEXT, saved, d)).toBe(TEXT.replace(`${ALDRIC}\n`, '').replace(BRAN, '      - {name: Reign of Bran, start: 1141, length: 19}  # second'));
	});

	it('the text lines in a new order give the new order, and the note reads back with the same eras', () => {
		const saved = readNote(TEXT);
		const d = draftOf(saved, key);
		d[0].erasText = 'Cara, 1170\nReign of Aldric, 1100\nReign of Bran, 1140 to 1159';
		const out = apply(TEXT, saved, d);
		expect(readNote(out)[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Cara', start: 1170 }, { name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Bran', start: 1140, length: 20 }] });
		expect(out).toContain(BRAN);
		expect(out).toContain('# the first king');
	});
});

describe('D342: the pairing of the typed text lines with the saved eras', () => {
	const saved = (...names: string[]) => names.map((n) => ({ text: `${n}, 1`, name: n }));
	const typed = (...lines: string[]) => lines.map((t) => ({ text: t, name: t.split(',')[0] }));

	it('pairs the unchanged text lines by content, a changed text line with its own name, and the rest by place', () => {
		expect(pairEraLines(saved('A', 'B', 'C'), typed('B, 1', 'C, 1'))).toEqual([{ saved: 1, same: true }, { saved: 2, same: true }]);
		expect(pairEraLines(saved('A', 'B', 'C'), typed('A, 1', 'D, 1', 'B, 1', 'C, 1'))).toEqual([{ saved: 0, same: true }, { saved: null, same: false }, { saved: 1, same: true }, { saved: 2, same: true }]);
		expect(pairEraLines(saved('A', 'B', 'C'), typed('B, 2', 'C, 1'))).toEqual([{ saved: 1, same: false }, { saved: 2, same: true }]);
		expect(pairEraLines(saved('A', 'B'), typed('X, 1', 'Y, 1', 'Z, 1'))).toEqual([{ saved: 0, same: false }, { saved: 1, same: false }, { saved: null, same: false }]);
		expect(pairEraLines([], typed('A, 1'))).toEqual([{ saved: null, same: false }]);
	});

	it('keeps the order of both lists, so the kept eras stay in the order of the text lines', () => {
		const pairs = pairEraLines(saved('A', 'B', 'C', 'D'), typed('D, 1', 'B, 1', 'A, 1', 'C, 1'));
		const kept = pairs.map((p) => p.saved).filter((s): s is number => s !== null);
		expect(kept).toEqual([...kept].sort((a, b) => a - b));
	});
});

describe('D342: a chain of three era calendars, each starting from an era of the one before', () => {
	const era = (name: string, text: string): CalendarDraft => Object.assign(newCalendar('eras', key), { name, formats: '{era} {year}', erasText: text });

	it('Gamma "Cone, Bone 3" reads when Bone starts from Aone (the window of 0.5.3 reads this chain): Cone = 1006', () => {
		const c = checkDraft([era('Alpha', 'Aone, 1000'), era('Beta', 'Bone, Aone 5'), era('Gamma', 'Cone, Bone 3')], NOTE);
		expect(c.refusals.map((r) => r.text)).toEqual([]);
		expect(c.calendars[2].kind).toEqual({ type: 'eras', eras: [{ name: 'Cone', start: 1006 }] });
	});

	it('reads the chain in any order of the calendars', () => {
		const c = checkDraft([era('Gamma', 'Cone, Bone 3'), era('Beta', 'Bone, Aone 5'), era('Alpha', 'Aone, 1000')], NOTE);
		expect(c.refusals.map((r) => r.text)).toEqual([]);
		expect(c.calendars[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Cone', start: 1006 }] });
	});

	it('two era calendars that start from each other are refused as a cycle, with the number of each text line', () => {
		const c = checkDraft([era('Alpha', 'Aone, 1000\nAtwo, Bone 1'), era('Beta', 'Bone, Atwo 1')], NOTE);
		expect(c.refusals.map((r) => r.text)).toEqual([
			'Text line 2: the first year is a date that needs this calendar to be read. Write a plain year.',
			'Text line 1: the first year is a date that needs this calendar to be read. Write a plain year.',
		]);
	});

	it('an era calendar and a cycle calendar that start from each other are refused as a cycle', () => {
		const count = Object.assign(newCalendar('cycles', key), { name: 'Count', formats: '{year} Year of the {cycle} Cycle', length: '60' });
		Object.assign(count.start, { same: 'Aldric 5', cycle: '1', year: '1' });
		const c = checkDraft([count, era('Reigns', 'Aldric, 3 Year of the 2 Cycle')], NOTE);
		expect(c.refusals.map((r) => r.text)).toContain('Text line 1: the first year is a date that needs this calendar to be read. Write a plain year.');
	});
});

describe('D342 ruling: the Arabic comma and the full-width comma count as the comma of a text line', () => {
	it('an Arabic comma (U+060C) and a full-width comma (U+FF0C) split the name from the year', () => {
		expect(read('ملك عظيم، 1100\n秦始皇，221')).toEqual(expect.objectContaining({ eras: [{ name: 'ملك عظيم', start: 1100 }, { name: '秦始皇', start: 221 }], refusals: [] }));
		expect(read('Aldric، 1100 to 1139').eras).toEqual([{ name: 'Aldric', start: 1100, length: 40 }]);
		expect(read('Aldric， the Elder， 1100').eras).toEqual([{ name: 'Aldric， the Elder', start: 1100 }]);
	});
});

describe('the year part of a text line is a date text of at most 500 characters', () => {
	it('a comma more than 500 characters before the end of the text line is not tried, as a date text of that length is not read (spec §14 rule 9)', () => {
		const plainReads = (t: string) => /\d{3,4}/.test(t);
		expect(splitEraLine(`Aldric, ${'x'.repeat(494)} 1100`, plainReads)).toMatchObject({ ok: true, name: 'Aldric' });
		expect(splitEraLine(`Aldric, ${'x'.repeat(495)} 1100`, plainReads)).toEqual({ ok: false, why: 'no-year' });
		expect(splitEraLine(`${'a'.repeat(20_000)}, 1100`, plainReads)).toMatchObject({ ok: true, first: '1100' });
	});
});
