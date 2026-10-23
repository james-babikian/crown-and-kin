import { beforeEach, describe, expect, it } from 'vitest';

import { findBlocks } from '../../src/core/block-locate';
import { nameForms } from '../../src/obsidian/rename-links';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { setup, tree } from '../support/rename-setup';

/*
 * Search round 0.2.3, area D: the link update after a rename (spec §6.9) on names with accents and
 * punctuation. The vault fake is in support/rename-setup.ts.
 */

beforeEach(() => resetObsidian());

describe('D4 (review C): a link written in another case than the note name is still found', () => {
	// Obsidian finds a note by a name in any case, and the link scan compares lower-case names (spec É6.9).
	// A percent-encoded accent written in lower case ("%C3%A9" for the É of "Émile") is such a link.
	it('"[her](%C3%A9mile.md)" is updated when "Émile.md" is renamed (0.2.2 found it)', async () => {
		const s = setup({ 'Trees.md': tree('"[her](%C3%A9mile.md)"'), 'Émile.md': '' });
		await s.rename('Émile.md', 'Emile Zola.md');
		expect(findBlocks(s.texts.get('Trees.md')!)[0].body).toContain('Emile%20Zola.md');
	});

	it('the filter has the forms of the name in both cases', () => {
		const forms = nameForms('Émile');
		expect(forms).toContain('%c3%a9mile');
		expect(forms).toContain('%c3%89mile');
	});
});
