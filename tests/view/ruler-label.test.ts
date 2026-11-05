import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { rulerLabelOf } from '../../src/view/succession-notes';
import type { HolderRow, HolderValues } from '../../src/view/titles-draft';

/*
 * D319 item 2a: the heading of the line of succession names the ruler as the holder list does (spec §13.21 rule 30). The person is named "Konrad VI", so the list shows
 * "Konrad VI" for an entry with no number and no written ruler name; the heading showed the first word, "Konrad".
 */

const graph = (() => {
	const r = parseDynasty('people:\n  - {id: k, name: Konrad VI, sex: m, born: 1409}\n  - {id: a, name: Aldric Valmont, sex: m, born: 1380}\n');
	if (!r.ok) throw new Error('does not parse');
	return deriveFamilies(r.tree);
})();

const row = (values: HolderValues): HolderRow => ({ key: 'h', ref: null, base: null, values });

describe('rulerLabelOf', () => {
	it('an entry with no number and no written name: the full name, as the holder list shows it', () => {
		expect(rulerLabelOf(graph, [row({ person: 'k', from: '1429' })], 'k', 1464, 'Konrad VI')).toBe('Konrad VI');
	});

	it('an entry with a number keeps the ruler text (first word and number); an entry with a written name keeps that name', () => {
		expect(rulerLabelOf(graph, [row({ person: 'a', number: 'II', from: '1429' })], 'a', 1464, 'Aldric Valmont')).toBe('Aldric II');
		expect(rulerLabelOf(graph, [row({ person: 'a', as: 'Alric', from: '1429' })], 'a', 1464, 'Aldric Valmont')).toBe('Alric');
	});

	it('the entry that the year reaches wins; a person with no entry gets the given name', () => {
		const holders = [row({ person: 'a', number: 'I', from: '1400' }), row({ person: 'a', number: 'II', from: '1450' })];
		expect(rulerLabelOf(graph, holders, 'a', 1420, 'Aldric Valmont')).toBe('Aldric I');
		expect(rulerLabelOf(graph, holders, 'k', 1420, 'Konrad VI')).toBe('Konrad VI');
	});
});
