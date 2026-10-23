import { describe, expect, it } from 'vitest';
import { matchesAll, queryWords } from '../../src/view/list-search';

/*
 * The search rule of the Titles window and the Houses window (the 0.2.5 contract D.3.3, D134): every word of the
 * query must be inside one text of the row, both sides folded with foldForMatch (D100). No fuzzy match,
 * no ranking.
 */

describe('queryWords', () => {
	it('gives no word for an empty query, for spaces and for a lone accent mark', () => {
		expect(queryWords('')).toEqual([]);
		expect(queryWords('   \t ')).toEqual([]);
		expect(queryWords('́')).toEqual([]);
	});

	it('folds case, accents and quote look-alikes, and splits at spaces', () => {
		expect(queryWords('  ESPAÑA  Duke ')).toEqual(['espana', 'duke']);
		expect(queryWords('d’España')).toEqual(["d'espana"]);
	});
});

describe('matchesAll', () => {
	it('matches everything when there is no word', () => {
		expect(matchesAll([], ['Duke of Valmont'])).toBe(true);
		expect(matchesAll([], [])).toBe(true);
	});

	it('finds "ESPANA" in "d’España" and "d\'espana" too', () => {
		expect(matchesAll(queryWords('ESPANA'), ['Count of d’España'])).toBe(true);
		expect(matchesAll(queryWords("d'espana"), ['Count of d’España'])).toBe(true);
		expect(matchesAll(queryWords('d’espana'), ["Count of d'España"])).toBe(true);
	});

	it('accepts the words in any order', () => {
		expect(matchesAll(queryWords('valmont duke'), ['Duke of Valmont'])).toBe(true);
	});

	it('lets the words match different texts of the row', () => {
		expect(matchesAll(queryWords('duke aldric'), ['Duke of Valmont', 'Aldric II'])).toBe(true);
	});

	it('needs every word', () => {
		expect(matchesAll(queryWords('duke orsini'), ['Duke of Valmont', 'Aldric II'])).toBe(false);
	});

	it('is a substring match and not a fuzzy match', () => {
		expect(matchesAll(queryWords('uke'), ['Duke of Valmont'])).toBe(true);
		expect(matchesAll(queryWords('dk'), ['Duke of Valmont'])).toBe(false);
		expect(matchesAll(queryWords('dukk'), ['Duke of Valmont'])).toBe(false);
	});

	it('does not find a word across the end of one text and the start of the next', () => {
		expect(matchesAll(queryWords('dukeof'), ['Duke', 'of Valmont'])).toBe(false);
	});

	it('finds a holder name, a sobriquet, a person name and an ID in the texts of a row', () => {
		const title = ['Duke of Valmont', 'Dukes of Valmont', 'duke-of-valmont', 'Roderick II', 'Roderick Valmont', 'the Bold'];
		expect(matchesAll(queryWords('roderick'), title)).toBe(true);
		expect(matchesAll(queryWords('bold'), title)).toBe(true);
		expect(matchesAll(queryWords('duke-of'), title)).toBe(true);
		const house = ['House Orsini', 'orsini', 'Isolde Orsini', 'Lucan Orsini'];
		expect(matchesAll(queryWords('lucan'), house)).toBe(true);
		expect(matchesAll(queryWords('lucan thorne'), house)).toBe(false);
	});

	it('compares the draft texts that the caller gives, not saved ones', () => {
		expect(matchesAll(queryWords('baron'), ['Duke of Valmont'])).toBe(false);
		expect(matchesAll(queryWords('baron'), ['Baron of Valmont'])).toBe(true);
	});

	it('does not change the order of the texts or the words (pure)', () => {
		const words = queryWords('b a');
		const texts = ['a b'];
		matchesAll(words, texts);
		expect(words).toEqual(['b', 'a']);
		expect(texts).toEqual(['a b']);
	});
});
