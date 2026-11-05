import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * D330 fix round, package A, C1-05: Live Preview keeps Obsidian's own hover frame of a block (native first). The TR-11 rule changed nothing: the box of a tree in a note has no
 * side edges and no bend in every view through the rule of the tree box above it.
 */

const css = readFileSync('styles/09-read-only-resize.css', 'utf8');

describe('the tree box of a note (C1-05)', () => {
	it('has one rule for the frame, for every view of a note: no side edges, a hairline at the foot, no bend', () => {
		expect(css).toMatch(/\.dynasty-root \.dynasty-viewport\s*\{\s*border-width:\s*0 0 1px 0;\s*border-radius:\s*0;\s*\}/);
	});

	it('has no rule for Live Preview alone (TR-11 is gone), and does not touch the hover frame of Obsidian', () => {
		expect(css).not.toContain('cm-embed-block');
		expect(css).not.toContain('TR-11');
		expect(css).not.toContain('embed-block-shadow-hover');
	});
});
