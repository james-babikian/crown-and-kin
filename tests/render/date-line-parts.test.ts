import { describe, expect, it } from 'vitest';
import { dateLine, dateLineParts } from '../../src/render/tree-info';
import { build } from '../support/helpers';

/*
 * 0.5 step 1b (D302 repair, right-to-left dates): `dateLineParts` is `dateLine` in parts. The parts joined are exactly the text of `dateLine`, with no control
 * character, in every form a date line has; only the born and the died date are marked as dates, so the list can isolate them. All people are made up.
 */

const PEOPLE: Array<[string, string]> = [
	['born and died', '{id: p, name: P, born: 1108, died: 1170}'],
	['a range with an approximate word (thin dash)', '{id: p, name: P, born: "c. 1108", died: 1170}'],
	['an Arabic word before the year', '{id: p, name: P, born: "حوالي 1108", died: 1170}'],
	['born only', '{id: p, name: P, born: 1108}'],
	['died only', '{id: p, name: P, died: 1170}'],
	['born and a dead sign', '{id: p, name: P, born: 1108, died: yes}'],
	['a doubtful death sign', '{id: p, name: P, died: "?"}'],
	['no dates', '{id: p, name: P}'],
	['alive', '{id: p, name: P, born: 1108, died: "no"}'],
];

describe('dateLineParts', () => {
	for (const [name, yaml] of PEOPLE) {
		it(`${name}: the parts joined are the text of dateLine, with no control character`, () => {
			const { g } = build(`people:\n  - ${yaml}\n`);
			const p = g.byId.get('p')!;
			const parts = dateLineParts(p, g.dates);
			expect(parts?.map((s) => s.text).join('')).toBe(dateLine(p, g.dates));
			expect(parts?.some((s) => /[⁦-⁩‎‏؜]/.test(s.text))).not.toBe(true);
		});
	}

	it('marks the born and the died date as dates and leaves the lead, the dash and the sign plain', () => {
		const { g } = build('people:\n  - {id: a, name: A, born: "c. 1108", died: 1170}\n  - {id: b, name: B, born: 1108}\n  - {id: c, name: C, born: 1108, died: yes}\n');
		const parts = (id: string) => dateLineParts(g.byId.get(id)!, g.dates)!.map((s) => [s.date ?? '', s.text]);
		expect(parts('a')).toEqual([['born', 'c. 1108'], ['', ' – '], ['died', '1170']]);
		expect(parts('b')).toEqual([['', 'b. '], ['born', '1108']]);
		expect(parts('c')).toEqual([['', 'b. '], ['born', '1108'], ['', ' †']]);
	});
});
