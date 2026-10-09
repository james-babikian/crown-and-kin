import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { housePage, houseTableNote } from '../../src/core/house-page';
import { parseDynasty } from '../../src/core/parse';
import { oldestParent } from '../../src/obsidian/phone-list';

/*
 * Version 0.2.7, WP2: the other readers of the date texts that move to the new helpers (the 0.2.7 contract K.7, K.5,
 * J.7): the house page shows an empty cell for a death text that means "alive" (`isDead`), and the phone list
 * reads the birth year with `yearOf` (so "AD 45" and "200 BC" are years). Every expected value is written by hand.
 * These tests wait for WP 2 (`house-page.ts` and `phone-list.ts`).
 * Run: npx vitest run tests/acceptance/r027-readers.test.ts
 */

const graphOf = (text: string) => {
	const r = parseDynasty(text);
	if (!r.ok) throw new Error(`hard error ${r.error.code}`);
	return deriveFamilies(r.tree);
};

describe('the house page and the death texts that mean alive (K.7)', () => {
	const people = (died: string) => ['houses:', '  - {id: v, name: House V}', 'people:', `  - {id: a, name: A, house: v, born: 1100, died: ${died}}`, ''].join('\n');
	const row = (died: string) => housePage(graphOf(people(died)), 'v')!.rows[0];

	it.each(['alive', 'Alive', '" living "', 'never', 'no', 'false', '"False"'])('died: %s gives an empty cell', (died) => {
		expect(row(died).died).toBe('');
		expect(houseTableNote(housePage(graphOf(people(died)), 'v')!).split('\n')[2]).toMatch(/\| 1100 \| {2}\|$/);
	});

	it.each(['1185', '"c. 1185"', 'unknown', '"in infancy"', '"?"'])('died: %s is shown as written', (died) => {
		expect(row(died).died).toBe(died.replace(/^"|"$/g, ''));
	});

	it('no died key: an empty cell, as before', () => {
		const g = graphOf(['houses:', '  - {id: v, name: House V}', 'people:', '  - {id: a, name: A, house: v}', ''].join('\n'));
		expect(housePage(g, 'v')!.rows[0].died).toBe('');
	});
});

describe('the phone list reads the birth year with yearOf (K.5, K.7)', () => {
	const oldest = (a: string, b: string) =>
		oldestParent(graphOf(['people:', `  - {id: x, name: X, born: ${a}}`, `  - {id: y, name: Y, born: ${b}}`, '  - {id: kx, name: Kx, parents: [x]}', '  - {id: ky, name: Ky, parents: [y]}', ''].join('\n')));

	it('"AD 45" is the year 45, so it is older than 1203 (the old reader found no year in it)', () => {
		expect(oldest('"1203"', '"AD 45"')).toBe('y');
	});

	it('"20 BC" is the year -20, so it is older than the year 100 (the old reader found no year in it)', () => {
		expect(oldest('"100"', '"20 BC"')).toBe('y');
		expect(oldest('"20 BC"', '"100"')).toBe('x');
	});

	it('the text of sample trees still reads as before: "c. 1150" is older than "12 Mar 1190"', () => {
		expect(oldest('"12 Mar 1190"', '"c. 1150"')).toBe('y');
	});

	it('a text with no year comes last', () => {
		expect(oldest('"long ago"', '"1203"')).toBe('y');
	});
});
