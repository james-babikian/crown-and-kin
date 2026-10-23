import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { parseCalendarBlock } from '../../src/core/calendar-block';
import { compileCalendars, PLAIN_READER, type ReadDate } from '../../src/core/dates';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { dateReadout } from '../../src/render/date-readout';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { cycleNote, eraNote } from '../support/calendar-vault';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Step 4.3 of WP-4 (spec §14 rule 6, the architecture notes §5.7): the grey line under Born and Died. The text of the line for every case of rule 6, and the line in the real person window:
 * it reads the text in the field (a draft), changes when the field loses the focus, and is empty for an empty field and for a plain year.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const read = (...notes: string[]) => compileCalendars(notes.flatMap((n, i) => parseCalendarBlock(findBlocks(n, 'kin-calendar')[0].body, `Note ${i}.md`, 0).calendars), true);
const cycles = read(cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100));
const eras = read(eraNote('Reign names', 'Qinglong Emperor', 130));
const line = (r: ReturnType<typeof read>, text: string) => dateReadout(text, r.read(text));

describe('the text of the grey line', () => {
	it('is empty for an empty field and for a plain year, also a BC year and a plain 0', () => {
		for (const text of ['', '   ', '1203', 'c. 1203', '5 BC', '-5', '0']) expect(line(cycles, text), text).toBe('');
		expect(dateReadout('', undefined)).toBe('');
	});

	it('shows the cycle, the year in it and the internal year for a cycle date', () => {
		expect(line(cycles, '10 Year of the 3 Cycle')).toBe('The Long Count: Cycle 3, Year 10 = year 229');
		expect(line(cycles, 'tenth year of the third cycle')).toBe('The Long Count: Cycle 3, Year 10 = year 229');
	});

	it('shows the era, the year in it and the internal year for an era date', () => {
		expect(line(eras, 'Qinglong Emperor 3')).toBe('Reign names: Qinglong Emperor, Year 3 = year 132');
	});

	it('writes a year before year 1 with a minus sign', () => {
		const r = read(eraNote('Reign names', 'Early', -4));
		expect(line(r, 'Early 3')).toBe('Reign names: Early, Year 3 = year −2');
	});

	it('adds the warning text after a calendar match', () => {
		expect(line(cycles, '0 Year of the 3 Cycle')).toBe('The Long Count: Cycle 3, Year 0 = year 219. Year 0 counts as the year before Year 1. Check that you mean this.');
		expect(line(cycles, '61 Year of the 3 Cycle')).toBe('The Long Count: Cycle 3, Year 61 = year 280. This year is after the end of its cycle or era. The plugin counts on from the last year.');
	});

	it('names both calendars when two calendars give the same year, and says that no year is found when they differ', () => {
		const same = read(eraNote('One', 'Qinglong Emperor', 130), eraNote('Two', 'Qinglong Emperor', 130));
		expect(line(same, 'Qinglong Emperor 3')).toBe('One: Qinglong Emperor, Year 3 = year 132. It also fits Two, with the same year.');
		const other = read(eraNote('One', 'Qinglong Emperor', 130), eraNote('Two', 'Qinglong Emperor', 500));
		expect(line(other, 'Qinglong Emperor 3')).toBe('This date fits One and Two, with different years. No year found. Change a format.');
	});

	it('says "No year found." for a text that fits no calendar and is no plain year, and for an era name with no number', () => {
		expect(line(eras, 'long ago')).toBe('No year found. Write a year, or add a format for this date in a calendar.');
		expect(line(eras, 'late in the Qinglong Emperor era')).toBe('No year found. Write a year, or add a format for this date in a calendar.');
	});

	it('shows the year that the plugin reads for an old double date', () => {
		expect(dateReadout('1700/01', PLAIN_READER.read('1700/01'))).toBe('The plugin reads this as year 1701.');
		expect(dateReadout('1905/06', PLAIN_READER.read('1905/06'))).toBe('');
	});

	it('says so for two dates at the same place', () => {
		const r: ReadDate = { text: 'x', source: 'calendar', samePlace: true, warnings: [] };
		expect(dateReadout('x', r)).toBe('Two formats read the same words and give different years. No year found. Change a format.');
	});

	it('falls back to "No year found." when there is no read', () => {
		expect(dateReadout('x', undefined)).toBe('No year found. Write a year, or add a format for this date in a calendar.');
	});
});

const BODY = `people:
  - id: aldric
    name: Aldric Valmont
    born: Qinglong Emperor 3
    died: Qinglong Emperor 9
`;

function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Tree.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	return h;
}

function openSheet(dates?: (link: string | undefined) => ReturnType<typeof read>) {
	const handle = writingHandle(BODY);
	const sheet = EditSheet.create({} as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md', ...(dates ? { dates } : {}) })!;
	sheet.open();
	return (sheet as unknown as { contentEl: FEl }).contentEl;
}

const readout = (content: FEl, key: 'born' | 'died') => content.querySelector(`[data-field="${key}"] [data-readout]`)?.getText();

describe('the grey line in the person window', () => {
	it('shows how the plugin reads Born and Died, one line under each field', () => {
		const content = openSheet(() => eras);
		expect(readout(content, 'born')).toBe('Reign names: Qinglong Emperor, Year 3 = year 132');
		expect(readout(content, 'died')).toBe('Reign names: Qinglong Emperor, Year 9 = year 138');
		const field = content.querySelector('[data-field="born"]')!;
		expect(field.querySelector('.dynasty-sheet-hint')).not.toBeNull();
		expect(field.querySelector('input')!.getAttribute('aria-describedby')).toContain('readout');
	});

	it('is empty for a plain year, and the window with no calendars gives no line for the saved plain texts', () => {
		const content = openSheet();
		// The texts are calendar dates, but no reader knows the calendar: the plugin finds no year.
		expect(readout(content, 'born')).toBe('No year found. Write a year, or add a format for this date in a calendar.');
	});

	it('reads the unsaved text and changes when the field loses the focus, not at each key press', () => {
		const content = openSheet(() => eras);
		const input = content.querySelector('[data-field="born"] input')!;
		input.value = 'Qinglong Emperor 7';
		dispatch(input, 'input');
		expect(readout(content, 'born')).toBe('Reign names: Qinglong Emperor, Year 3 = year 132');
		dispatch(input, 'blur');
		expect(readout(content, 'born')).toBe('Reign names: Qinglong Emperor, Year 7 = year 136');
		input.value = '1203';
		dispatch(input, 'blur');
		expect(readout(content, 'born')).toBe('');
	});

	it('the other fields have no grey line', () => {
		const content = openSheet(() => eras);
		expect(content.querySelector('[data-field="name"] [data-readout]')).toBeNull();
		expect(content.querySelectorAll('[data-readout]')).toHaveLength(2);
	});
});
