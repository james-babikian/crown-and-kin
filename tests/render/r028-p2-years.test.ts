/*
 * 0.2.8 work package P2: the year reader (S1, F-KIN-01), the year formatter (F-KIN-06) and the succession texts that
 * show a year.
 */

import { describe, expect, it } from 'vitest';
import { formatYear, yearOf } from '../../src/core/succession-keys';
import { SUCCESSION_UI } from '../../src/render/succession-text';

describe('yearOf: a text that is wholly a grouped number is one number (S1, gate vet row S1)', () => {
	// §14 rule 8 (0.3.2): n BC is internal 1 - n, so every BC row below is one year higher than before.
	const cases: [string, number | undefined][] = [
		['1,250', 1250],
		['12 000 BC', -11999],
		['12,000', 12000],
		['BC 300', -299],
		['AD 1,250', 1250],
		['c. 12,000', 12000],
		// The rest of the family of forms.
		['1,250 AD', 1250],
		['12,000 BC', -11999],
		['1,250,000', 1250000],
		['ca. 1,250', 1250],
		['about 12 000', 12000],
		['circa 1,250 CE', 1250],
		['~1,250', 1250],
		['12 000', 12000],
		['12 000 BC', -11999],
		['12 000', 12000],
		['BC 1,250', -1249],
		['B.C. 300', -299],
		['BCE 300', -299],
		['300 BC', -299],
		['c. BC 300', -299],
	];
	for (const [text, want] of cases) {
		it(`${JSON.stringify(text)} reads ${want}`, () => {
			expect(yearOf(text)).toBe(want);
		});
	}

	it('a fragment of a grouped number is never a year', () => {
		for (const text of ['1,25', 'about 1,250 men', 'AD 1,250 and later', '10 000 BC to 5 000 BC', 'x 12,000 y']) {
			expect(yearOf(text), text).toBeUndefined();
		}
	});

	it('the old readings stay', () => {
		// §14 rule 8 (0.3.2): -200 and 200 BC are internal -199.
		const same: [string, number | undefined][] = [
			['12', 12],
			['-200', -199],
			['−200', -199],
			['c. 200 BC', -199],
			['AD 45', 45],
			['45 AD', 45],
			['c. 1203', 1203],
			['12 May 1203', 1203],
			['1203-05-12', 1203],
			['spring 870', 870],
			['1st century', undefined],
			['year 12', undefined],
			['c. 12000', undefined],
			['long ago', undefined],
			['12 May 1203, 150 men', 1203],
			['1203, 150', 1203],
			['5 1203', 1203],
		];
		for (const [text, want] of same) expect(yearOf(text), text).toBe(want);
	});

	it('a number of more than 15 digits gives no year', () => {
		expect(yearOf('1,234,567,890,123,456')).toBeUndefined();
		expect(yearOf('BC 1234567890123456')).toBeUndefined();
	});

	it('uses no lookbehind (older iPhones cannot parse one)', () => {
		// The module is plain source text here: a "(?<=" or "(?<!" in a regular expression would be a lookbehind.
		const src = String(yearOf) + String(formatYear);
		expect(src).not.toMatch(/\(\?<[=!]/);
	});
});

describe('formatYear: an internal year of 0 or less shows as "N BC" (F-KIN-06)', () => {
	it('shows BC years and plain years', () => {
		// §14 rule 8 (0.3.2): the internal year y shows as (1 - y) BC, so 0 is 1 BC and -224 is 225 BC.
		expect(formatYear(-224)).toBe('225 BC');
		expect(formatYear(0)).toBe('1 BC');
		expect(formatYear(-1)).toBe('2 BC');
		expect(formatYear(1210)).toBe('1210');
	});
});

// §14 rule 8 (0.3.2): the years given to the texts are internal; -224 is 225 BC, -299 is 300 BC, -199 is 200 BC.
describe('every succession text that shows a year uses formatYear', () => {
	const U = SUCCESSION_UI;
	it('the heading, the bar, the texts of the named heirs, the no-holder texts and the age note', () => {
		expect(U.lineAfter('Antiochus', -224)).toBe('After Antiochus in 225 BC');
		expect(U.lineAfter('Antiochus', 1210)).toBe('After Antiochus in 1210');
		expect(U.lineAfter('Antiochus', null)).toBe('After Antiochus now');
		expect(U.bar('Seleucid throne', -224)).toBe('Line of succession: Seleucid throne, 225 BC');
		expect(U.barNoHeir('Seleucid throne', -224)).toBe('Line of succession: Seleucid throne, 225 BC. No heir in the tree.');
		expect(U.heirNotAlive('Hero', -224)).toContain('is not alive in 225 BC');
		expect(U.heirNotBorn('Hero', -224)).toContain('is not born yet in 225 BC');
		expect(U.noRuler(-299)).toBe('The title has no holder in 300 BC, so there is no line of succession.');
		expect(U.rulerNotInTree(-299)).toBe('The holder of the title in 300 BC is not in the tree. The plugin cannot show the line of succession.');
		expect(U.old('Hero', 111, -199)).toBe('Hero is older than 111 years in 200 BC. If Hero is dead, add a death date.');
		expect(U.coRulers(2, 'Hero', -199)).toBe('2 holders rule in 200 BC. The line is after Hero.');
		expect(U.coRulers(2, 'Hero', null)).toBe('2 holders rule now. The line is after Hero.');
	});

	it('a year after the era stays a plain number', () => {
		expect(U.bar('Throne', 1210)).toBe('Line of succession: Throne, 1210');
		expect(U.old('Hero', 111, 1210)).toBe('Hero is older than 111 years in 1210. If Hero is dead, add a death date.');
	});
});

describe('the new texts of the line of succession (an internal note section 2)', () => {
	const U = SUCCESSION_UI;
	it('the notes', () => {
		expect(U.orderFromNote('Anna', 'Berta')).toBe('The order of Anna and Berta comes from the order in the note. Add a birth year to change it.');
		expect(U.orderContradiction('Anna, Berta and Cora')).toBe('The birth years and the order in the note do not agree for Anna, Berta and Cora. The plugin puts the people who have a birth year in the order of the birth years.');
		expect(U.orderContradiction(['Anna', 'Berta', 'Cora'])).toBe(U.orderContradiction('Anna, Berta and Cora'));
		expect(U.coRulersNotInLine).toBe('The other holders are not in the line of succession, unless they are named heirs.');
		expect(U.bornInReignNoFrom('Anna')).toBe(
			'Anna has no start year as a holder of this title. So the rule “Born during the reign first” puts the children of Anna in the order of “Eldest child first”. Add a start year in the field “From”.',
		);
		expect(U.throughSpouseNote('Hugo', 'Anna')).toBe('Hugo holds the title through the spouse, Anna. The line of succession is for Anna.');
	});

	it('the heirs-of-body hint when the first entry has a name only (F-KIN-07)', () => {
		expect(U.bodyHintSkipped('Xavier', 'Old Duke')).toBe(
			'The first holder in the tree is Xavier, so only the descendants of Xavier are in the line of succession. The first entry, Old Duke, is not a person in the tree. To use Old Duke, select a person in the tree as that holder. If the title goes to a new house, make a new title.',
		);
		// The old hint stays for the other case.
		expect(U.bodyHint('Xavier')).toBe('The first holder is Xavier. Only the descendants of Xavier are in the line. If the title goes to a new house, make a new title.');
	});

	it('the hints of the switch while it is off (D291)', () => {
		expect(U.bodyHintOff('Xavier')).toBe('The first holder is Xavier. If you turn on this switch, only the descendants of Xavier are in the line.');
		expect(U.bodyHintSkippedOff('Xavier', 'Old Duke')).toBe(
			'The first entry, Old Duke, is not a person in the tree, so the first holder in the tree is Xavier. If you turn on this switch, only the descendants of Xavier are in the line. To use Old Duke, select a person in the tree as that holder.',
		);
		expect(U.cadetHint('William', 'Robert')).toBe(
			'William is in the line of succession, but William is not a descendant of Robert. If only the descendants of Robert can inherit this title, turn on this switch. Then William leaves the line.',
		);
	});

	it('the names of the rules and the hint of the oldest generation (D292)', () => {
		expect(U.rules['siblings-first']).toBe('Oldest generation first (lateral succession)');
		expect(U.inherits['men-first-in-house']).toBe('Men first in the whole dynasty (semi-Salic)');
		expect(U.inherits['women-first-in-house']).toBe('Women first in the whole dynasty (reverse semi-Salic)');
		expect(U.siblingsHint).toBe(
			'The oldest generation comes first: great-uncles and great-aunts, then aunts and uncles, then brothers, sisters and cousins, then children, nephews and nieces. Age does not decide between generations. For example, an uncle of the ruler comes before a brother of the ruler, even if the uncle is younger.',
		);
		expect(U.illHint).toBe('Here a claim passes only through women, so only the mother’s side counts. If the box “Illegitimate” does not matter, choose “They have the same right to inherit as the other children”.');
		expect(U.illHintFirstGroup).toBe('The first group, the women of the female line, has a claim only through the mother’s side. For everyone else the father’s side also counts, so the box “Illegitimate” matters there.');
		// The hints name the options with the labels of the lists.
		expect(U.illHint).toContain(`“${U.ills.equal}”`);
		expect(U.matrilinealHint).toContain(`“${U.throughs.women}”`);
		expect(U.matrilinealHint).toContain(`“${U.rules['eldest-child']}”`);
		expect(U.matrilinealHint).toContain(`“${U.rules['siblings-first']}” or “${U.rules['nearest-relative']}”`);
		expect(U.houseMen).toContain(`“${U.throughLabel}” is “Anyone”`);
		// No text names the old rule names.
		expect(JSON.stringify(U)).not.toMatch(/Siblings before children|whole house|seniority/);
	});

	it('the hints of the one-sex house forms (F-DOCS-02)', () => {
		expect(U.houseMen).toBe(
			'The dynasty is all the descendants of the founders. Every man of the male line of the dynasty comes before every woman. This is true even if a woman is of an older generation or is nearer to the ruler. A man whose claim comes through a woman is in this group only if “The right to inherit comes from” is “Anyone”.',
		);
		expect(U.houseWomen).toBe(
			'The dynasty is all the descendants of the founders. Every woman of the female line of the dynasty comes before every man. This is true even if a man is of an older generation or is nearer to the ruler. A woman whose claim comes through a man is in this group only if “The right to inherit comes from” is “Anyone”.',
		);
	});

	it('the new texts follow the word list: no forbidden word', () => {
		const all = [
			U.orderFromNote('A', 'B'),
			U.orderContradiction('A, B and C'),
			U.coRulersNotInLine,
			U.bornInReignNoFrom('A'),
			U.throughSpouseNote('A', 'B'),
			U.bodyHintSkipped('A', 'B'),
			U.bodyHintOff('A'),
			U.bodyHintSkippedOff('A', 'B'),
			U.cadetHint('A', 'B'),
			U.siblingsHint,
			U.houseMen,
			U.houseWomen,
			U.matrilinealHint,
			U.illHint,
			U.illHintFirstGroup,
		];
		for (const text of all) {
			expect(text).not.toMatch(/\b(graph|diagram|chart|node|edge|layer|rank|fixture|file|document|union)\b/i);
			// A quoted label of a list counts as one word.
			for (const sentence of text.replace(/“[^”]*”/g, 'LABEL').split(/(?<=[.!?])\s+(?=[A-Z])/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(25);
		}
	});
});
