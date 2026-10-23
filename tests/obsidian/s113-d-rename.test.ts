import { beforeEach, describe, expect, it } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { nameForms } from '../../src/obsidian/rename-links';
import { notices, resetObsidian } from '../acceptance/fake-obsidian';
import { setup, tree } from '../support/rename-setup';

/*
 * Search round 0.2.3, area D: the link update after a rename (spec §6.9) on names with accents and
 * punctuation. The vault fake is in support/rename-setup.ts.
 */

beforeEach(() => resetObsidian());

describe('D4: the scan only reads a note whose text holds a form of the old name', () => {
	// Obsidian writes a Markdown link with encodeURI: the accent is encoded, the comma is not (`Caf%C3%A9,%20Bar.md`).
	it('a Markdown link written with encodeURI to a note with an accent and a comma is updated', async () => {
		const old = 'Élisabeth, Queen';
		const link = `"[her](${encodeURI(`${old}.md`)})"`;
		expect(link).toContain('%C3%89lisabeth,%20Queen.md');
		const s = setup({ 'Trees.md': tree(link), [`${old}.md`]: '' });
		await s.rename(`${old}.md`, 'Queen Elisabeth.md');
		const body = findBlocks(s.texts.get('Trees.md')!)[0].body;
		expect(body).toContain('Queen%20Elisabeth.md');
		expect(notices).toHaveLength(1);
	});

	it('a capital with an accent is encoded before the case is lowered ("%C3%89" is not "%C3%A9")', async () => {
		const link = `"[her](${encodeURI('Élisabeth Queen.md')})"`;
		const s = setup({ 'Trees.md': tree(link), 'Élisabeth Queen.md': '' });
		await s.rename('Élisabeth Queen.md', 'Queen Elisabeth.md');
		expect(findBlocks(s.texts.get('Trees.md')!)[0].body).toContain('Queen%20Elisabeth.md');
	});

	it('the forms of a name include what encodeURI makes of it', () => {
		const name = 'élisabeth, queen';
		expect(nameForms(name).map((f) => f.toLowerCase())).toContain(encodeURI(name).toLowerCase());
	});
});
