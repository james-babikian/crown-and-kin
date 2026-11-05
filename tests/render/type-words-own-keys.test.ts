/*
 * Type words from a note are looked up only among a table's own keys: a word such as "constructor" reads as an unknown type, never as an object built-in.
 */
import { describe, expect, it } from 'vitest';
import { addedAsChild, addedAsParent, CHANGE_UI } from '../../src/render/change-text';
import { parentTypeText, unionTypeText } from '../../src/render/sheet-text';

describe('type words use only the own keys of their table', () => {
	it('an object built-in name is an unknown type', () => {
		expect(unionTypeText('constructor')).toBe('Other (constructor)');
		expect(unionTypeText('__proto__')).toBe('Other (__proto__)');
		expect(parentTypeText('toString')).toBe('Other (toString)');
		expect(addedAsParent('constructor')).toBe('a parent');
		expect(addedAsChild('hasOwnProperty')).toBe('a child');
		expect(CHANGE_UI.addedParent('Rina Vane', 'Oswin Valmont', 'constructor')).toBe('The plugin added Rina Vane as a parent of Oswin Valmont.');
	});

	it('the known words are unchanged', () => {
		expect(unionTypeText('marriage')).toBe('Marriage');
		expect(addedAsParent('ward')).toBe('a guardian');
		expect(addedAsChild('rumoured')).toBe('a rumoured child');
	});
});
