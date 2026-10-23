import { describe, expect, it } from 'vitest';
import { foldForMatch } from '../../src/core/fold';
import { slugify } from '../../src/core/id-gen';

// Search round s024, finding C1: `slugify` drops or mis-reads Latin letters that the letter map misses,
// and it is not stable the way `foldForMatch` is (it maps letters before lower-casing and before NFKD).
describe('s024 C1: slugify and the letter map', () => {
	it('keeps the eth (U+00F0, U+00D0) as a letter, as it does for the thorn', () => {
		// Fails: "gu-run" (the eth turns into a hyphen).
		expect(slugify('Guðrún')).toBe('gudrun');
		expect(slugify('House of Eðel')).toBe('house-of-edel');
	});
	it('does not lose the first letter of a name that starts with a capital eth', () => {
		// Fails: "orde" for Ðorđe (the D with stroke is mapped, the eth is dropped).
		expect(slugify('Ðorđe')).toBe('dorde');
	});
	it('maps a capital sharp s like the search does', () => {
		expect(foldForMatch('STRAẞE')).toBe('strasse');
		// Fails: "stra-e".
		expect(slugify('STRAẞE')).toBe('strasse');
	});
	it('maps a letter that NFKD splits into a mapped letter and a mark, like the search does', () => {
		expect(foldForMatch('Ǣlfred')).toBe('aelfred');
		// Fails: "lfred" (the first letter is lost).
		expect(slugify('Ǣlfred')).toBe('aelfred');
	});
	it('lets a search without the eth find a name with it (Find and the pickers use foldForMatch)', () => {
		// Fails: "guðrun" (the eth is kept, so the query "gudrun" never matches).
		expect(foldForMatch('Guðrún')).toBe('gudrun');
		expect(foldForMatch('Ðorđe')).toBe('dorde');
	});
});
