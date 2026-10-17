import { describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { planInsert } from '../src/obsidian/insert-tree';
import { INSERT_UI } from '../src/render/ui-text';

// Adopted from scratch/r111-review-a 153116b (N1 and F4b). Rulings A3 and A4 of the 0.2.1 review wave.
describe('review A: text that the plugin writes into a note', () => {
	it('N1: the block that "Insert family tree" writes is plain ASCII (the note gets no curly marks)', () => {
		const plan = planInsert('', '');
		expect(plan.text).toMatch(/^[\x00-\x7f]*$/);
		expect(plan.text).toContain(INSERT_UI.noteHint);
	});

	it('N1b: also after a text line, inside a list item and inside a quote', () => {
		for (const head of ['text', '- item', '> quote', '- ']) {
			expect(planInsert(head, '').text, head).toMatch(/^[\x00-\x7f]*$/);
		}
	});

	it('the note hint has straight marks', () => {
		expect(INSERT_UI.noteHint).toContain('"Add first person"');
	});
});
