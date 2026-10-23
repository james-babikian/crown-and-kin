import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { compileCalendars, type NameList } from '../../src/core/dates';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { DATE_READOUT_UI as T } from '../../src/render/calendar-text';
import { dateReadout } from '../../src/render/date-readout';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { PLANETS, cycles, list } from '../dates-support/names';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Spec §14 rule 15 (WP-6 step 3): the grey text line under Born and Died and the test line. After the year there is one sentence for each name list, "Planets: Saturn.", with
 * the full name; a whole plain year with a plain-year list has this line too; a wrong written name adds the sentence of the mismatch. The real person window shows it.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const animals = list({ name: 'Animals', marker: 'animal', names: [{ name: 'Rat' }, { name: 'Ox' }, { name: 'Tiger' }], known: { year: 1273, index: 1 } });
const plainPlanets: NameList = list({ marker: undefined });
const plainAnimals: NameList = { ...animals, marker: undefined };
const COUNT = cycles('The Long Count', ['{cycle}.{year} {planet}', '{year} Year of the {cycle} Cycle'], [list()]);
const reader = (cals = [COUNT], plain: NameList[] = []) => compileCalendars(cals, true, [], plain);
const line = (r: ReturnType<typeof reader>, text: string, ready = true) => dateReadout(text, r.read(text), ready);

describe('the grey line with name lists', () => {
	it('names the year after a calendar date, with the full name, also when no name is written', () => {
		const r = reader();
		expect(line(r, '22.13')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
		expect(line(r, '22.13 Sa')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
		expect(line(r, '22.14')).toBe('The Long Count: Cycle 22, Year 14 = year 1274. Planets: Jupiter.');
	});

	it('names the year for a date that is not whole, and in every format of the calendar', () => {
		const r = reader();
		expect(line(r, 'between 22.13 and 22.15')).toContain('Planets: Saturn.');
		expect(line(r, '13 Year of the 22 Cycle')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
	});

	it('gives one sentence for each list, in list order', () => {
		const r = reader([cycles('The Long Count', ['{cycle}.{year} {planet} {animal}'], [list(), animals])]);
		expect(line(r, '22.13')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn. Animals: Ox.');
	});

	it('shows the full name also when the list shows nothing on cards', () => {
		const r = reader([cycles('The Long Count', ['{cycle}.{year} {planet}'], [list({ show: 'none' })])]);
		expect(line(r, '22.13')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
	});

	it('adds the sentence of the mismatch after the names, and keeps the year', () => {
		const r = reader();
		expect(line(r, '22.13 Ju')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. In the list Planets, this year is Saturn. The date says Jupiter. The plugin uses the year of the date.');
		expect(line(r, '22.13 Jupiter')).toContain('this year is Saturn. The date says Jupiter.');
		expect(T.nameMismatch('Planets', 'Saturn', 'Jupiter')).toBe('In the list Planets, this year is Saturn. The date says Jupiter. The plugin uses the year of the date.');
	});

	it('puts the sentences after "also fits" and before the warnings of the year', () => {
		const other = cycles('Copy', ['{cycle}.{year}'], undefined, 60, 1, 'D.md');
		const r = reader([COUNT, other]);
		expect(line(r, '22.13')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn. It also fits Copy, with the same year.');
		expect(line(reader(), '22.61')).toBe(`The Long Count: Cycle 22, Year 61 = year 1321. Planets: Moon. ${T.pastEnd}`);
	});

	it('gives a whole plain year the line of the plain-year list, and any other plain text none', () => {
		const r = reader([], [plainPlanets]);
		expect(line(r, '1273')).toBe('Planets: Saturn.');
		expect(line(r, 'c. 1274')).toBe('Planets: Jupiter.');
		expect(line(r, '1273 Sa')).toBe('Planets: Saturn.');
		expect(line(r, '1273 Ju')).toBe('In the list Planets, this year is Saturn. The date says Jupiter. The plugin uses the year of the date.');
		for (const text of ['1273?', '1700/01', '12 March 1273', '1273 Sun rose', '1273-05-12', '']) expect(line(r, text), text).toBe(text === '1700/01' ? 'The plugin reads this as year 1701.' : '');
		expect(line(reader([], [plainPlanets, plainAnimals]), '1273')).toBe('Planets: Saturn. Animals: Ox.');
	});

	it('is empty while the reader is not ready, and for a plain year when no list exists', () => {
		const pending = compileCalendars([COUNT], false, [], [plainPlanets]);
		expect(dateReadout('1273', pending.read('1273'), false)).toBe('');
		expect(line(reader(), '1273')).toBe('');
		expect(PLANETS).toHaveLength(7);
	});
});

const BODY = `people:
  - id: aldric
    name: Aldric Valmont
    born: 22.13
    died: 22.14 Sa
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

describe('the grey line in the person window', () => {
	it('shows the name of the year under Born and Died, the mismatch under Died, and the field keeps the text as written', () => {
		const r = reader();
		const handle = writingHandle(BODY);
		const sheet = EditSheet.create({} as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Tree.md', dates: () => r })!;
		sheet.open();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		const readout = (key: string) => content.querySelector(`[data-field="${key}"] [data-readout]`)?.getText();
		expect(readout('born')).toBe('The Long Count: Cycle 22, Year 13 = year 1273. Planets: Saturn.');
		// The wrong written name is a part of its own: the reading stays grey and the warning has its own text line (D278).
		const part = (key: string, sel: string) => content.querySelector(`[data-field="${key}"] [data-readout] ${sel}`)?.getText();
		expect(part('died', '.dynasty-date-reading')).toBe('The Long Count: Cycle 22, Year 14 = year 1274.');
		expect(part('died', '[data-warning]')).toBe('In the list Planets, this year is Jupiter. The date says Saturn. The plugin uses the year of the date.');
		expect(part('born', '[data-warning]')).toBeUndefined();
		expect(content.querySelector('[data-field="died"] [data-warning] svg.dynasty-mark.is-warning')).not.toBeNull();
		expect(content.querySelector('[data-field="died"] [data-warning] svg')!.getAttribute('aria-hidden')).toBe('true');
		expect(content.querySelector('[data-field="born"] input')!.value).toBe('22.13');
		expect(content.querySelector('[data-field="died"] input')!.value).toBe('22.14 Sa');
		// A change of the text shows when the field loses the focus.
		const input = content.querySelector('[data-field="born"] input')!;
		input.value = '22.15 Ma';
		dispatch(input, 'blur');
		expect(readout('born')).toBe('The Long Count: Cycle 22, Year 15 = year 1275. Planets: Mars.');
		expect(handle.ops).toEqual([]);
	});
});
