// D342 (Q2 A): an era with no last year ends where the next era starts; only the last era has no end. The date keeps its year and gets the warning
// `calendar-year-past-end`; the text that names the era of a year (`exampleText`, the grey line under each era) names the era that holds the year.
import { describe, expect, it } from 'vitest';
import { compileCalendars, eraEnds, exampleText, type Calendar } from '../../src/core/dates';

const reigns = (eras: { name: string; start: number; length?: number }[]): Calendar => ({ id: 'n.md#0#0', name: 'Reigns', note: 'n.md', formats: ['{era} {year}'], kind: { type: 'eras', eras } });

describe('D342: the end of an era with no length', () => {
	it('is the year before the next era by start, not by place in the list; the last era has none; a written length wins', () => {
		expect(eraEnds([{ start: 1180 }, { start: 1100 }, { start: 1140, length: 5 }, { start: 1160 }])).toEqual([undefined, 1139, 1144, 1179]);
		// Two eras with one start: neither is the next of the other.
		expect(eraEnds([{ start: 1100 }, { start: 1100 }, { start: 1200 }])).toEqual([1199, 1199, undefined]);
		expect(eraEnds([{ start: Number.NaN }, { start: 5 }])).toEqual([undefined, undefined]);
	});

	it('gives the warning past its end, and keeps every year', () => {
		const reader = compileCalendars([reigns([{ name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Bran', start: 1140 }])], true);
		expect(reader.read('Reign of Aldric 50')).toMatchObject({ year: 1149, warnings: ['calendar-year-past-end'] });
		expect(reader.read('Reign of Aldric 40')).toMatchObject({ year: 1139, warnings: [] });
		expect(reader.read('Reign of Bran 90')).toMatchObject({ year: 1229, warnings: [] });
	});

	it('the example of a year names the era that holds it (the grey text names that era)', () => {
		const cal = reigns([{ name: 'Reign of Aldric', start: 1100 }, { name: 'Reign of Bran', start: 1140 }]);
		expect(exampleText(cal, 1149)).toBe('Reign of Bran 10');
		expect(exampleText(cal, 1139)).toBe('Reign of Aldric 40');
		expect(exampleText(cal, 1140)).toBe('Reign of Bran 1');
		// A year in a gap between an era with a length and the next era is in no era.
		expect(exampleText(reigns([{ name: 'A', start: 1, length: 5 }, { name: 'B', start: 10 }]), 7)).toBeNull();
	});

	it('two eras that share a year (Shōwa 64 and Heisei 1): a written length keeps the old reading with no warning', () => {
		const reader = compileCalendars([reigns([{ name: 'Shōwa', start: 1926, length: 64 }, { name: 'Heisei', start: 1989 }])], true);
		expect(reader.read('Shōwa 64')).toMatchObject({ year: 1989, warnings: [] });
		expect(reader.read('Heisei 1')).toMatchObject({ year: 1989, warnings: [] });
		// With no length, Shōwa ends where Heisei starts: Shōwa 64 keeps its year and warns.
		const open = compileCalendars([reigns([{ name: 'Shōwa', start: 1926 }, { name: 'Heisei', start: 1989 }])], true);
		expect(open.read('Shōwa 64')).toMatchObject({ year: 1989, warnings: ['calendar-year-past-end'] });
	});
});
