/*
 * Proof for tests/support/common-mocks.ts (0.4, slim assessment T2): a test file that declares no mock of its
 * own gets the common mocks from the setup file.
 */
import { syntaxTree } from '@codemirror/language';
import { ViewPlugin } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import * as obsidian from 'obsidian';
import * as fake from '../acceptance/fake-obsidian';

describe('the setup file mocks obsidian and the two CodeMirror packages for a file without mocks', () => {
	it('obsidian is the fake of tests/acceptance/fake-obsidian.ts', () => {
		expect(obsidian.Notice).toBe(fake.Notice);
		expect(obsidian.Modal).toBe(fake.Modal);
	});

	it('@codemirror/view and @codemirror/language are the stubs', () => {
		expect(ViewPlugin.fromClass(class {})).toEqual({});
		expect(syntaxTree({} as never)).toEqual({ length: 0 });
	});
});
