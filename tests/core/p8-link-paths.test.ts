/*
 * P8-19: the shared folder helper of `core/link-text.ts`, used by the picture picker, the saved picture
 * and the link rename (they had three copies of it).
 */
import { describe, expect, it } from 'vitest';
import { folderOf } from '../../src/core/link-text';

describe('folderOf', () => {
	it('gives the folder of a vault path, or nothing at the top of the vault', () => {
		expect(folderOf('Trees/Pictures/arms.png')).toBe('Trees/Pictures');
		expect(folderOf('Family.md')).toBe('');
	});
});
