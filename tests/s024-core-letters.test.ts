import { describe, expect, it } from 'vitest';
import { foldForMatch, foldLetters } from '../src/core/fold';
import { slugify, uniqueId } from '../src/core/id-gen';

// 0.2.4 C1/C1b: ids and search agree on the letters that have no accent form.
describe('s024 letters (C1, C1b)', () => {
	it('foldLetters maps eth and capital sharp s', () => {
		expect(foldLetters('Ðð')).toBe('dd');
		expect(foldLetters('ẞ')).toBe('ss');
	});
	it('slugify and foldForMatch agree on a mixed name', () => {
		for (const n of ['Þórr Ðorđe', 'Ǣlfred of Eðel', 'STRAẞE', 'Łukasz Øre']) {
			expect(slugify(n)).toBe(foldForMatch(n).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
		}
	});
	it('slugify of old inputs is unchanged', () => {
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('Þórr')).toBe('thorr');
		expect(slugify('1103')).toBe('p-1103');
		expect(slugify('')).toBe('person');
		expect(uniqueId('Guðrún', new Set(['gudrun']))).toBe('gudrun-2');
	});
});
