/*
 * P8-19: the shared folder and free-path helpers of `core/link-text.ts`, used by the picture picker, the saved picture
 * and the link rename (they had three copies of `folderOf` and two of the numbered free-path loop).
 */
import { describe, expect, it } from 'vitest';
import { folderOf, numberedFreePath } from '../src/core/link-text';

describe('folderOf', () => {
	it('gives the folder of a vault path, or nothing at the top of the vault', () => {
		expect(folderOf('Trees/Pictures/arms.png')).toBe('Trees/Pictures');
		expect(folderOf('Family.md')).toBe('');
	});
});

describe('numberedFreePath', () => {
	it('keeps the name when it is free', () => {
		expect(numberedFreePath('Trees', 'tree.svg', () => false)).toBe('Trees/tree.svg');
		expect(numberedFreePath('', 'tree.svg', () => false)).toBe('tree.svg');
	});

	it('adds " 1", " 2", … before the extension while the name is taken', () => {
		const taken = new Set(['Trees/tree.svg', 'Trees/tree 1.svg']);
		expect(numberedFreePath('Trees', 'tree.svg', (p) => taken.has(p))).toBe('Trees/tree 2.svg');
	});

	it('numbers a name with no extension, and a name that starts with a dot keeps it whole', () => {
		expect(numberedFreePath('', 'README', (p) => p === 'README')).toBe('README 1');
		expect(numberedFreePath('', '.hidden', (p) => p === '.hidden')).toBe('.hidden 1');
	});
});
