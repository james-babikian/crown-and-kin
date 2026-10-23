import { describe, expect, it } from 'vitest';

/*
 * 0.4 WP-1b: text that a user typed becomes a vault path through Obsidian's `normalizePath` (the official lint tool asks for it).
 * The vault root is '' in the plugin; `normalizePath` writes it as '/'.
 */

import { vaultPath } from '../../src/obsidian/vault-path';

describe('vaultPath', () => {
	it('keeps a clean path as it is', () => {
		expect(vaultPath('People/Kings/Aldric.md')).toBe('People/Kings/Aldric.md');
		expect(vaultPath('Aldric.md')).toBe('Aldric.md');
	});

	it('cleans the slips of hand-typing: backslashes, doubled slashes, slashes at the ends', () => {
		expect(vaultPath('People\\Kings')).toBe('People/Kings');
		expect(vaultPath('People//Kings///Aldric.md')).toBe('People/Kings/Aldric.md');
		expect(vaultPath('/People/Kings/')).toBe('People/Kings');
	});

	it('gives the vault root, "", for nothing, a slash or a dot', () => {
		for (const text of ['', '/', '//', '\\', '.']) expect(vaultPath(text), JSON.stringify(text)).toBe('');
	});

	it('writes a no-break space as a space and a letter with a mark in one form (Unicode NFC)', () => {
		expect(vaultPath('People/Aldric Valmont.md')).toBe('People/Aldric Valmont.md');
		expect(vaultPath('Café/Note.md')).toBe('Café/Note.md');
	});
});
