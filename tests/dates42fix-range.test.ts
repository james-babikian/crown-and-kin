// Fix round of step 4.2, ruling 5: a range in a year-first format reads its first date (owner, 2026-10-19; spec §14 rule 5).
import { describe, expect, it } from 'vitest';
import { compileCalendars, type Calendar } from '../src/core/dates';

const REIGN: Calendar = {
	id: 'C.md#0#0',
	name: 'Reign names',
	note: 'C.md',
	formats: ['{year} Year of the {era}', '{era} {year}'],
	kind: { type: 'eras', eras: [{ name: 'Qinglong Emperor', start: 130, length: 11 }] },
};
const CYCLE: Calendar = { id: 'D.md#0#0', name: 'Cycles', note: 'D.md', formats: ['{year} Year of the {cycle} Cycle'], kind: { type: 'cycles', length: 60, start: 1 } };
const read = (cals: Calendar[], text: string) => compileCalendars(cals, true).read(text);

describe('a range in a year-first format', () => {
	it.each([
		['3rd to 5th Year of the Qinglong Emperor', 132],
		['3-5 Year of the Qinglong Emperor', 132],
		['3 – 5 Year of the Qinglong Emperor', 132],
		['between the 3rd and 5th Year of the Qinglong Emperor', 132],
		['from the third until the fifth Year of the Qinglong Emperor', 132],
		['3rd through 5th Year of the Qinglong Emperor', 132],
		['IV to VI Year of the Qinglong Emperor', 133],
	])('%s reads its first date', (text, year) => {
		expect(read([REIGN], text)).toMatchObject({ year, source: 'calendar', calendar: 'Reign names' });
	});

	it('works in a cycle format too, and keeps the cycle', () => {
		expect(read([CYCLE], '3rd to 5th Year of the Second Cycle')?.year).toBe(63);
		expect(read([CYCLE], '3-5 Year of the 2nd Cycle')?.year).toBe(63);
	});

	it('a single date and the era-first range read as before', () => {
		expect(read([REIGN], '5th Year of the Qinglong Emperor')?.year).toBe(134);
		expect(read([REIGN], 'between Qinglong Emperor 3 and 5')?.year).toBe(132);
		expect(read([REIGN], 'Qinglong Emperor 3-5')?.year).toBe(132);
	});

	it('the range keeps the warnings of the first date', () => {
		expect(read([REIGN], '0 to 5 Year of the Qinglong Emperor')).toMatchObject({ warnings: ['calendar-year-zero'] });
		expect(read([REIGN], '12 to 14 Year of the Qinglong Emperor')).toMatchObject({ year: 141, warnings: ['calendar-year-past-end'] });
	});

	it('a joiner that is not a range joiner reads the last date, as before', () => {
		expect(read([REIGN], '3rd, 5th Year of the Qinglong Emperor')?.year).toBe(134);
		expect(read([REIGN], '3 tomorrow 5 Year of the Qinglong Emperor')?.year).toBe(134);
	});
});
