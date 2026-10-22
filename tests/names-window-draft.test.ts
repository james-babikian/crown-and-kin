// Spec §14 rules 13 and 16, WP-6 step 3: the draft of the Calendars window for name lists, with no DOM. The known year kept on the date that the user wrote,
// the refusals mapped to fields and sections, the operations of lists and plain years applied to the note text, and the summaries.
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { planWrite } from '../src/core/block-write';
import { editCalendarBlock, parseCalendarBlock } from '../src/core/calendar-block';
import type { Calendar, NameList } from '../src/core/dates';
import { REFUSAL_TEXT } from '../src/core/refusal-text';
import { checkDraft, calendarDraftChanged, draftOf, emptyPlain, newCalendar, newListDraft, opsOf, PLAIN_KEY, type CalendarDraft, type PlainDraft } from '../src/view/calendar-draft';
import { listDraftsOf } from '../src/view/calendar-list-draft';
import { calendarSummary, calendarTitle, listsSummary } from '../src/view/calendar-summary';

const NOTE = 'Calendars.md';
let n = 0;
const key = () => n++;

const NAMES = `        names:
          - {name: Saturn, short: Sa}
          - {name: Jupiter, short: Ju}
          - {name: Mars, short: Ma}
          - {name: Sun, short: Su}
          - {name: Venus, short: Ve}
          - {name: Mercury, short: Me}
          - {name: Moon, short: Mo}
`;

/** The Long Count: Cycle 22, Year 13 is year 1273 and it is Saturn; plain years have the same list. A comment on a key and an unknown key stay. */
const TEXT = `# Calendars

\`\`\`kin-calendar
# the calendars of the Far Land
calendars:
  - name: The Long Count
    kind: cycles
    length: 60
    start: 1 # Cycle 1, Year 1
    colour: red
    formats: ["{cycle}.{year} {planet}", "{year} Year of the {cycle} Cycle"]
    lists:
      - name: Planets
        marker: planet
${NAMES}        known: {year: 1273, index: 0}
        show: short
plain:
  lists:
    - name: Planets
      names:
        - {name: Saturn, short: Sa}
        - {name: Jupiter, short: Ju}
      known: {year: 1273, index: 0}
      show: full
\`\`\`
`;

interface Opened {
	saved: Calendar[];
	plainSaved: NameList[];
	drafts: CalendarDraft[];
	plain: PlainDraft;
	block: number;
}

function open(text: string): Opened {
	const blocks = findBlocks(text, 'kin-calendar');
	const read = blocks.map((b, i) => parseCalendarBlock(b.body, NOTE, i));
	const at = Math.max(0, read.findIndex((r) => r.plain !== undefined));
	const saved = read.flatMap((r) => r.calendars);
	const plainSaved = read[at]?.plain ?? [];
	return { saved, plainSaved, drafts: draftOf(saved, key), plain: { block: at, saved: plainSaved, lists: listDraftsOf(plainSaved, undefined, key) }, block: at };
}

/** Saves the draft the way the window does: checks it, makes the operations and applies them to the note text. */
function save(text: string, o: Opened): { text: string; refused: string[]; ops: number } {
	const checked = checkDraft(o.drafts, NOTE, [], o.plain);
	if (checked.refusals.length) return { text, refused: checked.refusals.map((r) => r.text), ops: 0 };
	const plan = opsOf(o.saved, o.drafts, checked, o.plain);
	let out = text;
	for (const { block, ops } of plan) {
		const body = findBlocks(out, 'kin-calendar')[block].body;
		const result = planWrite(out, block, body, (b) => {
			let cur = b;
			for (const op of ops) {
				const r = editCalendarBlock(cur, op);
				if (!r.ok) return { ok: false, reason: `${op.kind}: ${r.detail ?? r.code}` };
				cur = r.body;
			}
			return { ok: true, body: cur };
		}, 'kin-calendar');
		if (!result.ok) throw new Error(JSON.stringify(result));
		out = result.newText;
	}
	return { text: out, refused: [], ops: plan.reduce((a, p) => a + p.ops.length, 0) };
}

const reread = (text: string) => open(text);

describe('the lists in the draft (§14 rule 16)', () => {
	it('shows the lists as text fields, and the known year as the date of the first format with no marker', () => {
		const o = open(TEXT);
		const l = o.drafts[0].lists[0];
		expect(l.name).toBe('Planets');
		expect(l.marker).toBe('{planet}');
		expect(l.names.split('\n')).toEqual(['Saturn, Sa', 'Jupiter, Ju', 'Mars, Ma', 'Sun, Su', 'Venus, Ve', 'Mercury, Me', 'Moon, Mo']);
		expect(l.knownDate).toBe('22.13');
		expect(l.knownName).toBe('Saturn');
		expect(l.show).toBe('short');
		// The plain years show the number.
		expect(o.plain.lists[0].knownDate).toBe('1273');
		expect(o.plain.lists[0].marker).toBe('');
	});

	it('shows the plain year "N BC" when no format of the calendar gives the year (it reads back to the same year)', () => {
		const text = TEXT.replace('known: {year: 1273, index: 0}\n        show: short', 'known: {year: -130, index: 2}\n        show: short');
		expect(open(text).drafts[0].lists[0].knownDate).toBe('131 BC');
	});

	it('an untouched window has no change, no refusal and no operation', () => {
		const o = open(TEXT);
		const checked = checkDraft(o.drafts, NOTE, [], o.plain);
		expect(checked.refusals).toEqual([]);
		expect(calendarDraftChanged(o.saved, o.drafts, checked, o.plain)).toBe(false);
		expect(opsOf(o.saved, o.drafts, checked, o.plain)).toEqual([]);
		expect(checked.knowns.get(o.drafts[0].lists[0].key)).toMatchObject({ year: 1273, index: 0, name: 'Saturn', count: 7 });
	});

	it('keeps the name on the date that the user wrote after a change of Start', () => {
		const o = open(TEXT);
		// Cycle 1, Year 1 is now year 1000: so 22.13 is year 2272, and Saturn moves with the date.
		o.drafts[0].start.same = '1000';
		o.drafts[0].start.cycle = '1';
		o.drafts[0].start.year = '1';
		const checked = checkDraft(o.drafts, NOTE, [], o.plain);
		expect(checked.refusals).toEqual([]);
		expect(checked.knowns.get(o.drafts[0].lists[0].key)?.year).toBe(1000 + 21 * 60 + 12);
		const out = save(TEXT, o);
		expect(out.refused).toEqual([]);
		const again = reread(out.text).saved[0];
		expect(again.kind).toMatchObject({ type: 'cycles', start: 1000 });
		expect(again.lists?.[0].known).toEqual({ year: 1000 + 21 * 60 + 12, index: 0 });
		// The comments and the unknown key of the calendar stay.
		expect(out.text).toContain('# Cycle 1, Year 1');
		expect(out.text).toContain('colour: red');
	});
});

describe('the operations of lists', () => {
	it('adds a list to a calendar, and the plain years get a list when the note has none', () => {
		const o = open(TEXT);
		const l = newListDraft(key);
		Object.assign(l, { name: 'Animals', marker: 'animal', names: 'Rat\nOx, Ox\nTiger', knownDate: '1273', knownName: 'ox', show: 'full' });
		o.drafts[0].lists.push(l);
		o.drafts[0].formats += '\n{year}/{cycle} {animal}';
		const out = save(TEXT, o);
		expect(out.refused).toEqual([]);
		const again = reread(out.text).saved[0];
		expect(again.lists?.map((x) => x.name)).toEqual(['Planets', 'Animals']);
		expect(again.lists?.[1]).toMatchObject({ marker: 'animal', known: { year: 1273, index: 1 }, show: 'full', names: [{ name: 'Rat' }, { name: 'Ox', short: 'Ox' }, { name: 'Tiger' }] });
		expect(again.formats).toContain('{year}/{cycle} {animal}');
	});

	it('adds the key plain to a note that has none, in the first block', () => {
		const text = TEXT.slice(0, TEXT.indexOf('plain:')) + '```\n';
		const o = open(text);
		expect(o.plain.lists).toEqual([]);
		const l = newListDraft(key);
		Object.assign(l, { name: 'Animals', names: 'Rat\nOx', knownDate: '1273', knownName: 'Rat' });
		o.plain.lists.push(l);
		const out = save(text, o);
		expect(out.refused).toEqual([]);
		expect(reread(out.text).plainSaved[0]).toMatchObject({ name: 'Animals', known: { year: 1273, index: 0 }, show: 'short' });
	});

	it('changes the names and the known year of a plain list, and removes a list; a list that stays is not rewritten', () => {
		const o = open(TEXT);
		const p = o.plain.lists[0];
		p.names = 'Saturn, Sa\nJupiter, Ju\nMars, Ma';
		p.knownDate = '1275';
		p.knownName = 'mars';
		const out = save(TEXT, o);
		expect(out.refused).toEqual([]);
		const again = reread(out.text);
		expect(again.plainSaved[0].names).toHaveLength(3);
		expect(again.plainSaved[0].known).toEqual({ year: 1275, index: 2 });
		expect(again.drafts[0].lists[0].names).toContain('Saturn, Sa');
		// Remove the calendar list: the other keys of the calendar stay.
		const o2 = open(TEXT);
		o2.drafts[0].lists.splice(0, 1);
		o2.drafts[0].formats = '{year} Year of the {cycle} Cycle';
		const out2 = save(TEXT, o2);
		expect(out2.refused).toEqual([]);
		expect(reread(out2.text).saved[0].lists ?? []).toEqual([]);
		expect(out2.text).toContain('colour: red');
	});

	it('removes the last plain list: the key plain stays with an empty list', () => {
		const o = open(TEXT);
		o.plain.lists.splice(0, 1);
		const checked = checkDraft(o.drafts, NOTE, [], o.plain);
		expect(calendarDraftChanged(o.saved, o.drafts, checked, o.plain)).toBe(true);
		const out = save(TEXT, o);
		expect(out.refused).toEqual([]);
		expect(reread(out.text).plainSaved).toEqual([]);
		expect(out.text).toContain('plain:');
		expect(out.text).toContain('# Cycle 1, Year 1');
	});

	it('swaps one list of four for another in one save', () => {
		const lists = [1, 2, 3, 4].map((i) => `      - name: L${i}\n        marker: m${i}\n        names: [A${i}, B${i}]\n        known: {year: 10, index: 0}\n        show: short\n`).join('');
		const text = `\`\`\`kin-calendar\ncalendars:\n  - name: C\n    kind: cycles\n    length: 10\n    start: 1\n    formats: ["{cycle}.{year}"]\n    lists:\n${lists}\`\`\`\n`;
		const o = open(text);
		expect(o.drafts[0].lists).toHaveLength(4);
		o.drafts[0].lists.splice(1, 1);
		const l = newListDraft(key);
		Object.assign(l, { name: 'New', marker: 'new', names: 'X\nY', knownDate: '10', knownName: 'X' });
		o.drafts[0].lists.push(l);
		const out = save(text, o);
		expect(out.refused).toEqual([]);
		expect(reread(out.text).saved[0].lists?.map((x) => x.name)).toEqual(['L1', 'L3', 'L4', 'New']);
	});

	it('a new calendar carries its lists', () => {
		const o = open('```kin-calendar\ncalendars: []\n```\n');
		const d = newCalendar('cycles', key);
		d.name = 'Count';
		d.formats = '{cycle}.{year} {planet}';
		d.length = '12';
		const l = newListDraft(key);
		Object.assign(l, { name: 'Planets', marker: '{planet}', names: 'Saturn, Sa\nJupiter, Ju', knownDate: '2.5', knownName: 'Ju', show: 'none' });
		d.lists.push(l);
		o.drafts.push(d);
		const out = save('```kin-calendar\ncalendars: []\n```\n', o);
		expect(out.refused).toEqual([]);
		const made = reread(out.text).saved[0];
		expect(made.lists?.[0]).toMatchObject({ name: 'Planets', marker: 'planet', known: { year: 17, index: 1 }, show: 'none' });
	});
});

describe('the refusals of lists (§14 rule 16)', () => {
	const refusals = (o: Opened) => checkDraft(o.drafts, NOTE, [], o.plain).refusals;

	it('maps a refusal to the calendar, the list and the field', () => {
		const o = open(TEXT);
		const l = o.drafts[0].lists[0];
		l.names = 'Saturn\nsaturn';
		const r = refusals(o).filter((x) => x.field?.startsWith(`list:${l.key}`));
		expect(r.map((x) => x.field)).toContain(`list:${l.key}:names`);
		expect(r.every((x) => x.key === o.drafts[0].key)).toBe(true);
	});

	it('refuses a marker that breaks the rule, a marker twice, and a format with a marker that has no list', () => {
		const o = open(TEXT);
		const l = o.drafts[0].lists[0];
		l.marker = '{year}';
		expect(refusals(o).some((r) => r.field === `list:${l.key}:marker`)).toBe(true);
		l.marker = '{planet}';
		o.drafts[0].formats += '\n{cycle}.{year} {star}';
		const r = refusals(o).find((x) => x.field === 'formats');
		expect(r?.text).toContain('{cycle}.{year} {star}');
	});

	it('refuses a known date with no year and a known name that is not in the list', () => {
		const o = open(TEXT);
		const l = o.drafts[0].lists[0];
		l.knownDate = 'at dawn';
		l.knownName = 'Pluto';
		const fields = refusals(o).map((r) => r.field);
		expect(fields).toContain(`list:${l.key}:known`);
		expect(checkDraft(o.drafts, NOTE, [], o.plain).knowns.get(l.key)).toMatchObject({ index: -1 });
	});

	it('refuses the lines that the text field cannot read: a short form with no name, 61 lines', () => {
		const o = open(TEXT);
		const l = o.drafts[0].lists[0];
		l.names = 'Saturn, Sa\n, Ju';
		expect(refusals(o).map((r) => r.text)).toContain(REFUSAL_TEXT.nameLineEmpty);
		l.names = Array.from({ length: 61 }, (_, i) => `N${i}`).join('\n');
		expect(refusals(o).map((r) => r.text)).toContain(REFUSAL_TEXT.nameLinesTooMany);
	});

	it('refuses a plain-year list under the key of the plain years, and five lists in a calendar', () => {
		const o = open(TEXT);
		const p = o.plain.lists[0];
		p.name = '';
		const r = refusals(o).find((x) => x.key === PLAIN_KEY);
		expect(r?.field).toBe(`list:${p.key}:name`);
		const o2 = open(TEXT);
		for (let i = 0; i < 4; i++) {
			const l = newListDraft(key);
			Object.assign(l, { name: `L${i}`, marker: `m${i}`, names: 'A', knownDate: '1273', knownName: 'A' });
			o2.drafts[0].lists.push(l);
		}
		expect(refusals(o2).some((x) => x.field === 'lists')).toBe(true);
	});

	it('refuses a duplicate across two calendars at the later one', () => {
		const o = open(TEXT);
		const d = newCalendar('cycles', key);
		d.name = 'Copy';
		d.formats = '{cycle}.{year}';
		d.length = '60';
		o.drafts.push(d);
		const r = refusals(o).find((x) => x.field === 'formats');
		expect(r?.key).toBe(d.key);
	});

	it('does not refuse a list that cannot be used and was not changed', () => {
		const text = TEXT.replace('known: {year: 1273, index: 0}\n        show: short', 'known: {year: 1273, index: 9}\n        show: short');
		const o = open(text);
		const checked = checkDraft(o.drafts, NOTE, [], o.plain);
		expect(checked.refusals).toEqual([]);
		expect(calendarDraftChanged(o.saved, o.drafts, checked, o.plain)).toBe(false);
		// As soon as the user changes the list, the refusal shows.
		o.drafts[0].lists[0].show = 'full';
		expect(refusals(o).length).toBeGreaterThan(0);
	});
});

describe('the title and the summary of a section (§14 rule 16)', () => {
	it('names a calendar and shows its kind, length, formats and lists', () => {
		const o = open(TEXT);
		expect(calendarTitle(o.drafts[0])).toBe('The Long Count');
		expect(calendarSummary(o.drafts[0])).toBe('Cycle calendar · 60 years in a cycle · 2 formats · Name list: Planets');
		expect(listsSummary(o.plain.lists)).toBe('Name list: Planets');
		expect(listsSummary([])).toBe('No name list');
	});

	it('uses the correct plurals and the kind for a calendar with no name', () => {
		const d = newCalendar('cycles', key);
		expect(calendarTitle(d)).toBe('Cycle calendar');
		d.length = '1';
		d.formats = '{cycle}.{year}';
		expect(calendarSummary(d)).toBe('Cycle calendar · 1 year in a cycle · 1 format · No name list');
		d.formats = '';
		expect(calendarSummary(d)).toContain('No format');
	});

	it('lists the first two eras and "and N more"', () => {
		const e = newCalendar('eras', key);
		const era = (name: string) => ({ ...e.eras[0], key: key(), name });
		e.eras = ['Qinglong Emperor', 'Jianwen Emperor', 'Xuande Emperor', 'Zhengtong Emperor', 'Jingtai Emperor'].map(era);
		expect(calendarSummary(e)).toBe('Era calendar · Qinglong Emperor, Jianwen Emperor and 3 more · No name list');
		e.eras = e.eras.slice(0, 2);
		expect(calendarSummary(e)).toBe('Era calendar · Qinglong Emperor, Jianwen Emperor · No name list');
		e.eras = [];
		expect(calendarSummary(e)).toBe('Era calendar · No era · No name list');
	});
});

describe('the plain years and the reader of the test field', () => {
	it('reads a plain year with a plain-year list in the test field, with the name', () => {
		const o = open(TEXT);
		const checked = checkDraft(o.drafts, NOTE, [], o.plain);
		expect(checked.reader.read('1275')?.names?.[0]?.name).toBe('Saturn');
		expect(emptyPlain().lists).toEqual([]);
	});
});
