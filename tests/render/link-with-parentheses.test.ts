import { describe, expect, it } from 'vitest';
import { parseLink } from '../../src/core/picture-link';
import { linkedNotePath } from '../../src/core/note-make';
import { linkTarget } from '../../src/render/tree-info';

// Proof of review s113-a: a Markdown link whose destination holds parentheses is read correctly by
// `parseLink` (link rewrite, balanced parentheses, contract A2) but not by `linkedNotePath`
// (note-make.ts) and `linkTarget` (src/render/tree-info.ts), which stop at the first ")".
// Obsidian itself writes `[Note (2)](Note%20(2).md)` for a note called "Note (2)".

describe('Markdown link with parentheses in the note name', () => {
	const forms = ['[Note (2)](Note%20(2).md)', '[Note (2)](<Note (2).md>)'];
	for (const form of forms) {
		it(`parseLink reads ${form}`, () => {
			expect(parseLink(form)?.target).toBe('Note (2).md');
		});
		it(`linkedNotePath names the note for ${form}`, () => {
			expect(linkedNotePath(form)).toEqual({ folder: '', name: 'Note (2)', path: 'Note (2).md' });
		});
		it(`linkTarget (render) gives the link text for ${form}`, () => {
			expect(linkTarget(form)).toBe('Note (2).md');
		});
	}
});
