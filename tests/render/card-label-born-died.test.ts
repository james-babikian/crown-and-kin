/*
 * D334 Q9: the spoken label of a card says "born 1131" and "died 1161", not "b. 1131" and "d. 1161". The visible dates line keeps the short leads, and
 * the child row of the person window (whose spoken name must contain its visible text in order) keeps "b.".
 */
import { describe, expect, it } from 'vitest';
import { CARD_SPOKEN_LEAD, cardLabel, dateLine, dateLineParts } from '../../src/render/tree-info';
import { WINDOW_UI } from '../../src/render/window-text';
import { LONG_COUNT, cardLabelWith, datesApi, person } from '../dates-support';
import { build } from '../support/helpers';

const SRC = [
	'people:',
	'  - {id: a, name: Aldric, born: 1131}',
	'  - {id: b, name: Bert, died: 1161}',
	'  - {id: c, name: Cora, born: 1100, died: 1160}',
	'  - {id: d, name: Dina, born: 1131, died: yes}',
	'  - {id: e, name: Edda}',
	'',
].join('\n');
const g = build(SRC).g;
const label = (id: string) => cardLabel(g.byId.get(id)!, undefined, undefined, undefined, g.dates);
const line = (id: string) => dateLine(g.byId.get(id)!, g.dates);

describe('the spoken card label', () => {
	it('says "born" and "died" for a person with one date', () => {
		expect(CARD_SPOKEN_LEAD).toEqual({ born: 'born ', died: 'died ' });
		expect(label('a')).toBe('Aldric, born 1131');
		expect(label('b')).toBe('Bert, died 1161');
	});

	it('says a full range as "born X, died Y", and has the words for a death with no year', () => {
		expect(label('c')).toBe('Cora, born 1100, died 1160');
		expect(label('d')).toBe('Dina, born 1131, dead');
		expect(label('e')).toBe('Edda');
	});

	it('has no short lead and no dash between years in any label', () => {
		for (const id of ['a', 'b', 'c', 'd', 'e']) {
			expect(label(id), id).not.toMatch(/\b[bd]\. /);
			expect(label(id), id).not.toMatch(/\d[–-]\d/);
		}
	});

	it('puts the name, the title and the relation round the spoken range', () => {
		expect(cardLabel(g.byId.get('c')!, 'half-sister', undefined, '2nd in line', g.dates)).toBe('Cora, born 1100, died 1160, half-sister, 2nd in line');
	});
});

describe('the spoken range with calendar dates, and a death with no year', () => {
	const view = datesApi.buildTreeDates(datesApi.compileCalendars([LONG_COUNT], true), [], []);
	const say = (p: Parameters<typeof person>[0]) => cardLabelWith(person(p), view);

	it('says each date as written after its word', () => {
		expect(say({ id: 'a', name: 'Ada', born: '1100', died: 'Year 5 of Cycle 3' })).toBe('Ada, born 1100, died Year 5 of Cycle 3');
		expect(say({ id: 'a', name: 'Ada', born: 'Year 1 of Cycle 3', died: 'Year 5 of Cycle 3' })).toBe('Ada, born Year 1 of Cycle 3, died Year 5 of Cycle 3');
		expect(say({ id: 'a', name: 'Ada', born: 'Year 1 of Cycle 3' })).toBe('Ada, born Year 1 of Cycle 3');
		expect(say({ id: 'a', name: 'Ada', died: 'Year 5 of Cycle 3' })).toBe('Ada, died Year 5 of Cycle 3');
	});

	it('says an "about" date after its word, as written', () => {
		expect(say({ id: 'a', name: 'Ada', born: 'c. 1100', died: '1160' })).toBe('Ada, born c. 1100, died 1160');
	});

	it('says "dead" for a death with no year, with or without a birth year', () => {
		expect(say({ id: 'a', name: 'Ada', born: '1100', died: 'fell in the war' })).toBe('Ada, born 1100, dead');
		expect(say({ id: 'a', name: 'Ada', died: 'yes' })).toBe('Ada, dead');
		expect(say({ id: 'a', name: 'Ada', died: '?' })).toBe('Ada, dead, but the death text is not clear');
	});

	it('says no death for an alive word', () => {
		expect(say({ id: 'a', name: 'Ada', born: '1100', died: 'no' })).toBe('Ada, born 1100');
	});

	it('keeps an Arabic or Hebrew date in the order written, with no isolate control', () => {
		const arabic = say({ id: 'a', name: 'Ann', born: 'حوالي 1108', died: '1170' });
		expect(arabic).toBe('Ann, born حوالي 1108, died 1170');
		expect(arabic).not.toMatch(/[⁦-⁩‎‏]/);
		expect(say({ id: 'a', name: 'Ann', born: '1108', died: 'בערך 1170' })).toBe('Ann, born 1108, died בערך 1170');
	});
});

describe('the visible text', () => {
	it('keeps "b." and "d." on the card line and in the parts of the list', () => {
		expect(line('a')).toBe('b. 1131');
		expect(line('b')).toBe('d. 1161');
		expect(line('c')).toBe('1100–1160');
		expect(dateLineParts(g.byId.get('a')!, g.dates)?.[0]).toEqual({ text: 'b. ' });
	});

	it('the child row of the person window keeps "b." in its spoken name', () => {
		expect(WINDOW_UI.openPersonLabel('Gwen', 'Daughter', 'b. 1131')).toBe('Gwen, Daughter, b. 1131. Open this person.');
	});
});
