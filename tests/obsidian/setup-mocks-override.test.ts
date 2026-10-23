/*
 * Proof for tests/support/common-mocks.ts (0.4, slim assessment T2): a mock that a test file declares itself replaces the
 * mock of the setup file, and vi.unmock gives a test the real package. 'obsidian' and '@codemirror/language' are
 * replaced in this file; '@codemirror/view' is unmocked, so the real package loads.
 */
import { syntaxTree } from '@codemirror/language';
import { Decoration } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import * as obsidian from 'obsidian';

vi.mock('obsidian', () => ({ marker: 'own mock of this file' }));
vi.mock('@codemirror/language', () => ({ syntaxTree: () => 'own tree' }));
vi.unmock('@codemirror/view');

describe('a file-level mock replaces the mock of the setup file', () => {
	it('obsidian is the mock of this file, not the fake', () => {
		expect((obsidian as unknown as { marker: string }).marker).toBe('own mock of this file');
		expect(Object.keys(obsidian)).toEqual(['marker']);
	});

	it('@codemirror/language is the mock of this file', () => {
		expect(syntaxTree({} as never)).toBe('own tree');
	});

	it('vi.unmock brings back the real @codemirror/view', () => {
		expect(typeof Decoration.mark).toBe('function');
	});
});
