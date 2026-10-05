// Unit tests of the sobriquet helpers (contract 1.1): the unwrap rule, the quoted form and the name join.
import { describe, expect, it } from 'vitest';
import { normaliseSobriquet, quotedSobriquet, withSobriquet } from '../src/core/sobriquet';

describe('normaliseSobriquet', () => {
	it('gives undefined for nothing, blank and non-strings', () => {
		expect(normaliseSobriquet(undefined)).toBeUndefined();
		expect(normaliseSobriquet('')).toBeUndefined();
		expect(normaliseSobriquet('   \n ')).toBeUndefined();
		expect(normaliseSobriquet(5 as unknown as string)).toBeUndefined();
	});

	it('keeps plain text and collapses white space', () => {
		expect(normaliseSobriquet('the Wise')).toBe('the Wise');
		expect(normaliseSobriquet('  the \n  Wise ')).toBe('the Wise');
	});

	it('takes one pair of double marks off the whole text', () => {
		expect(normaliseSobriquet('“the Wise”')).toBe('the Wise');
		expect(normaliseSobriquet('„the Wise“')).toBe('the Wise');
		expect(normaliseSobriquet('„the Wise”')).toBe('the Wise');
		expect(normaliseSobriquet('"the Wise"')).toBe('the Wise');
		expect(normaliseSobriquet('“ ”')).toBeUndefined();
		expect(normaliseSobriquet('""')).toBeUndefined();
	});

	it('refuses the single pair and keeps marks inside the text', () => {
		expect(normaliseSobriquet('‘Fox’')).toBe('‘Fox’');
		expect(normaliseSobriquet('“the ‘Wise’ one”')).toBe('“the ‘Wise’ one”');
		expect(normaliseSobriquet('"the "Wise" one"')).toBe('"the "Wise" one"');
		expect(normaliseSobriquet('the d’Or')).toBe('the d’Or');
	});
});

describe('quotedSobriquet and withSobriquet', () => {
	it('puts curly double marks around the text', () => {
		expect(quotedSobriquet('the Wise')).toBe('“the Wise”');
	});

	it('joins a name and a sobriquet, and leaves a name with none unchanged', () => {
		expect(withSobriquet('Aldric II', 'the Wise')).toBe('Aldric II “the Wise”');
		expect(withSobriquet('Aldric II', undefined)).toBe('Aldric II');
	});
});
