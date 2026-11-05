import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { parseCalendarBlock } from '../../src/core/calendar-block';
import { compileCalendars } from '../../src/core/dates';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { dateReadoutParts } from '../../src/render/date-readout';
import { attachDateLine } from '../../src/render/dom/date-line';
import { holdLayoutOnPress } from '../../src/render/dom/press-hold';
import { DATE_READOUT_UI } from '../../src/render/calendar-text';
import { FEl, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle } from '../acceptance/tree-view-fakes';
import { cycleNote } from '../support/calendar-vault';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 UX-10: the grey line under Born and Died shows while the user is still in the field (a short pause after the last key), as well as at the blur. The line
 * is the one of spec §14 rule 6, so a user who types a date in a calendar sees "Cycle 3, Year 20" without leaving the field. A date with no year says that the
 * line of succession does not use it, when the tree has a line of succession.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const cycles = compileCalendars(parseCalendarBlock(findBlocks(cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100), 'kin-calendar')[0].body, 'Note.md', 0).calendars, true);

function frame(skipped?: () => boolean) {
	const root = new FEl('div', { cls: 'dynasty-sheet' });
	const row = root.createDiv({ cls: 'dynasty-sheet-field' });
	const input = row.createEl('input');
	const button = root.createEl('button');
	const stops: (() => void)[] = [];
	holdLayoutOnPress(root as unknown as HTMLElement);
	attachDateLine(row as never, input as never, () => cycles, undefined, undefined, skipped);
	return { root, row, input, button, stops, line: row.querySelector('[data-readout]')! };
}
const typeIn = (f: ReturnType<typeof frame>, text: string) => {
	f.input.value = text;
	dispatch(f.input, 'input');
};

describe('the line while the user types', () => {
	it('shows the reading a short time after the last key, with the focus still in the field', () => {
		const f = frame();
		typeIn(f, '20 Year of the 3 Cycle');
		expect(f.line.getText()).toBe('');
		runTimers(100);
		expect(f.line.getText()).toBe('');
		runTimers(300);
		expect(f.line.getText()).toContain('Cycle 3, Year 20');
	});

	it('each key starts the pause again, so a word is read when it is finished', () => {
		const f = frame();
		typeIn(f, '20 Year');
		runTimers(250);
		typeIn(f, '20 Year of the 3 Cycle');
		runTimers(250);
		expect(f.line.getText()).toBe('');
		runTimers(100);
		expect(f.line.getText()).toContain('Cycle 3, Year 20');
	});

	it('a press on a button under way holds the change until the click, so no button moves under the pointer (D319)', () => {
		const f = frame();
		typeIn(f, '20 Year of the 3 Cycle');
		dispatch(f.button, 'pointerdown');
		runTimers(400);
		expect(f.line.getText()).toBe('');
		dispatch(f.button, 'click');
		expect(f.line.getText()).toContain('Cycle 3, Year 20');
	});

	it('a plain year and an empty field give no line, also after the pause', () => {
		const f = frame();
		typeIn(f, '1135');
		runTimers(400);
		expect(f.line.getText()).toBe('');
		typeIn(f, '');
		runTimers(400);
		expect(f.line.getText()).toBe('');
	});
});

describe('a date with no year and the line of succession', () => {
	const plain = DATE_READOUT_UI.noYear;

	it('says after "No year found" that the line of succession does not use the date, only when the caller says so', () => {
		expect(dateReadoutParts('some day', undefined, true).reading).toBe(plain);
		expect(dateReadoutParts('some day', undefined, true, { succession: false }).reading).toBe(plain);
		expect(dateReadoutParts('some day', undefined, true, { succession: true }).reading).toBe(`${plain} ${DATE_READOUT_UI.noYearSuccession}`);
		expect(DATE_READOUT_UI.noYearSuccession).toBe('The line of succession does not use this date.');
	});

	it('does not add it to a date with a year, to an empty field, or while the reader is not ready', () => {
		expect(dateReadoutParts('', undefined, true, { succession: true }).reading).toBe('');
		expect(dateReadoutParts('some day', undefined, false, { succession: true }).reading).toBe('');
	});

	it('the line of a field says it when the caller says that a line of succession exists', () => {
		const f = frame(() => true);
		typeIn(f, 'one fine day');
		runTimers(400);
		expect(f.line.getText()).toBe(`${plain} ${DATE_READOUT_UI.noYearSuccession}`);
		const g = frame(() => false);
		typeIn(g, 'one fine day');
		runTimers(400);
		expect(g.line.getText()).toBe(plain);
	});
});

describe('the person window', () => {
	const open = (body: string) => {
		const s = EditSheet.create({} as never, { handle: fakeHandle('n.md', body) as never, personId: 'a', sourcePath: 'n.md' })!;
		s.open();
		return (s as unknown as { modalEl: FEl }).modalEl;
	};
	const born = (m: FEl) => m.querySelector('[data-field="born"]')!;
	const typeBorn = (m: FEl, text: string) => {
		const input = born(m).querySelector('input') as FEl;
		input.value = text;
		dispatch(input, 'input');
	};

	it('a Born text with no year says so under the field after the pause, and names the line of succession only when a title has one', () => {
		const withLine = open(['titles:', '  - {id: crown, name: Crown, succession: primogeniture, holders: [{person: a, from: 1100}]}', 'people:', '  - {id: a, name: Aldric}', ''].join('\n'));
		typeBorn(withLine, 'one fine day');
		runTimers(400);
		expect(born(withLine).querySelector('[data-readout]')!.getText()).toBe(`${DATE_READOUT_UI.noYear} ${DATE_READOUT_UI.noYearSuccession}`);
		resetDom();
		const noLine = open(['titles:', '  - {id: crown, name: Crown, holders: [{person: a, from: 1100}]}', 'people:', '  - {id: a, name: Aldric}', ''].join('\n'));
		typeBorn(noLine, 'one fine day');
		runTimers(400);
		expect(born(noLine).querySelector('[data-readout]')!.getText()).toBe(DATE_READOUT_UI.noYear);
	});

	it('the Died field never names the line of succession (it has its own note)', () => {
		const m = open(['titles:', '  - {id: crown, name: Crown, succession: primogeniture, holders: [{person: a, from: 1100}]}', 'people:', '  - {id: a, name: Aldric}', ''].join('\n'));
		const input = m.querySelector('[data-field="died"] input') as FEl;
		input.value = 'one fine day';
		dispatch(input, 'input');
		runTimers(400);
		expect(m.querySelector('[data-field="died"] [data-readout]')!.getText()).toBe(DATE_READOUT_UI.noYear);
	});
});
