// Spec §14 rule 13 (WP-6 step 1): the name of an internal year, with a safe modulo.
import { describe, expect, it } from 'vitest';
import { compileCalendars, isUsableList, yearName } from '../../src/core/dates';
import { cycles, list, PLANETS } from '../dates-support/names';

const nameOf = (year: number, l = list()) => yearName(l, year).entry.name;

describe('§14 rule 13: the name of an internal year', () => {
	it('the known year has the name of the known index', () => {
		expect(nameOf(1273)).toBe('Saturn');
		expect(nameOf(1273, list({ known: { year: 1273, index: 3 } }))).toBe('Sun');
	});

	it('the names run on before and after the known year', () => {
		expect(nameOf(1274)).toBe('Jupiter');
		expect(nameOf(1279)).toBe('Moon');
		expect(nameOf(1280)).toBe('Saturn');
		expect(nameOf(1272)).toBe('Moon');
		expect(nameOf(1266)).toBe('Saturn');
	});

	it('runs across Cycle 0, Year 0 and negative years', () => {
		// 1273 - 0 = 1273 = 7 * 181 + 6; so year 0 is 6 names before Saturn = Jupiter.
		expect(nameOf(0)).toBe('Jupiter');
		expect(nameOf(-1)).toBe('Saturn');
		expect(nameOf(-2)).toBe('Moon');
		expect(nameOf(-1275)).toBe('Saturn');
		expect(yearName(list(), -1275).index).toBe(0);
	});

	it('is never negative and is exact for a known year near the limit of whole numbers', () => {
		const big = 9_000_000_000_000_000;
		const k = PLANETS.length;
		const exact = (n: number, a: number, index: number) => Number((((BigInt(index) + BigInt(n) - BigInt(a)) % BigInt(k)) + BigInt(k)) % BigInt(k));
		for (const [a, n] of [[big, -big], [-big, big], [big, big - 1], [-big, -big + 3], [big, 1], [0, big], [0, -big]] as const) {
			const l = list({ known: { year: a, index: 2 } });
			const got = yearName(l, n);
			expect(got.index, `${a} ${n}`).toBe(exact(n, a, 2));
			expect(got.index).toBeGreaterThanOrEqual(0);
			expect(got.entry).toBe(PLANETS[got.index]);
		}
	});

	it('Cycle 1 Year 60 is Mercury and Cycle 2 Year 1 is Moon of a 60-year cycle with 7 names (1273 = Saturn)', () => {
		const reader = compileCalendars([cycles('Long', ['{cycle}.{year} {planet}'], [list()])], true);
		const a = reader.read('1.60 Me');
		const b = reader.read('2.1 Mo');
		expect(a).toMatchObject({ year: 60, names: [{ name: 'Mercury', written: { index: 5, form: 'short' } }] });
		expect(b).toMatchObject({ year: 61, names: [{ name: 'Moon', written: { index: 6, form: 'short' } }] });
		expect(a?.warnings).toEqual([]);
		expect(b?.warnings).toEqual([]);
		expect(nameOf(60)).toBe('Mercury');
		expect(nameOf(61)).toBe('Moon');
	});

	it('a list with a known year and index outside the names is not usable', () => {
		expect(isUsableList(list())).toBe(true);
		expect(isUsableList(list({ known: { year: 1, index: 7 } }))).toBe(false);
		expect(isUsableList(list({ known: { year: 1, index: -1 } }))).toBe(false);
		expect(isUsableList(list({ known: { year: 1.5, index: 0 } }))).toBe(false);
		expect(isUsableList(list({ known: { year: Number.NaN, index: 0 } }))).toBe(false);
		expect(isUsableList(list({ names: [] }))).toBe(false);
		expect(isUsableList(list({ names: Array.from({ length: 61 }, (_, i) => ({ name: `N${i}` })) }))).toBe(false);
		expect(isUsableList(list({ names: Array.from({ length: 60 }, (_, i) => ({ name: `N${i}` })) }))).toBe(true);
		expect(isUsableList(list(), 4)).toBe(false);
		expect(isUsableList(null)).toBe(false);
		expect(isUsableList({ name: 'x', names: [{ name: 5 }], known: { year: 1, index: 0 } })).toBe(false);
	});

	it('a name alone gives no year, and a date with no year has no name', () => {
		const reader = compileCalendars([cycles('Long', ['{cycle}.{year} {planet}'], [list()])], true);
		expect(reader.read('Saturn')?.year).toBeUndefined();
		expect(reader.read('Saturn')?.names).toBeUndefined();
		expect(reader.read('long ago')?.names).toBeUndefined();
	});
});
