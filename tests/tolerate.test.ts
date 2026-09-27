import { describe, expect, it } from 'vitest';
import { bool, int, isEmpty, isMap, linkValue, list, str } from '../src/core/tolerate';

describe('tolerate', () => {
	it('str: trims, turns other scalars into text, and rejects collections', () => {
		expect(str('  aldric ')).toBe('aldric');
		expect(str('')).toBeUndefined();
		expect(str('   ')).toBeUndefined();
		expect(str(42)).toBe('42');
		expect(str(true)).toBe('true');
		expect(str(new Date('2001-12-14T00:00:00Z'))).toBe('2001-12-14');
		expect(str(new Date('nonsense'))).toBeUndefined();
		expect(str(null)).toBeUndefined();
		expect(str(['a'])).toBeUndefined();
		expect(str({ id: 'a' })).toBeUndefined();
	});

	it('list: a single value where a list was expected is a one-item list', () => {
		expect(list(['a', 'b'])).toEqual(['a', 'b']);
		expect(list('a')).toEqual(['a']);
		expect(list({ id: 'a' })).toEqual([{ id: 'a' }]);
		expect(list(undefined)).toEqual([]);
		expect(list(null)).toEqual([]);
		expect(list('')).toEqual([]);
	});

	it('linkValue: flattens an unquoted [[link]] and keeps a quoted one', () => {
		expect(linkValue([['Wren of the Marches']])).toBe('[[Wren of the Marches]]');
		expect(linkValue('[[Wren]]')).toBe('[[Wren]]');
		expect(linkValue([[[]]])).toBeUndefined();
	});

	it('linkValue: a comma in an unquoted [[link]] keeps the text as written', () => {
		expect(linkValue([['Smith', 'John']], () => '[[Smith,  John]]')).toBe('[[Smith,  John]]');
		// No usable source text (none, or on two text lines): the items are joined.
		expect(linkValue([['Smith', 'John']])).toBe('[[Smith, John]]');
		expect(linkValue([['Smith', 'John']], () => '[[Smith,\n  John]]')).toBe('[[Smith, John]]');
		expect(linkValue([['a', []]])).toBeUndefined();
	});

	it('bool and int read the failsafe strings', () => {
		expect(bool('true')).toBe(true);
		expect(bool('Yes')).toBe(true);
		expect(bool('no')).toBe(false);
		expect(bool(true)).toBe(true);
		expect(bool(undefined)).toBe(false);
		expect(int('500')).toBe(500);
		expect(int('-3')).toBe(-3);
		expect(int('3.5')).toBeUndefined();
		expect(int('9'.repeat(40))).toBeUndefined();
	});

	it('isMap and isEmpty', () => {
		expect(isMap({})).toBe(true);
		expect(isMap([])).toBe(false);
		expect(isMap(null)).toBe(false);
		expect(isMap(new Date())).toBe(false);
		expect(isEmpty(' ')).toBe(true);
		expect(isEmpty(0)).toBe(false);
	});
});
