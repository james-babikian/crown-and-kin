/*
 * WP-J second review, finding 1: one very long line of "- > " pairs made the scan of a list marker line recurse once
 * per pair and overflow the call stack (spec §8: nothing may throw). The scan now stops at 64 nested quote markers.
 */
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';

describe('a hostile line of nested list and quote markers', () => {
	const line = '- > '.repeat(5000) + 'x';

	it('findBlocks reads a line with 5 000 "- > " pairs without an error', () => {
		expect(() => findBlocks(`${line}\n`)).not.toThrow();
	});

	it('and still finds the tree below it', () => {
		const blocks = findBlocks(`${line}\n\n\`\`\`kin\npeople: []\n\`\`\`\n`);
		expect(blocks.map((b) => b.body)).toEqual(['people: []']);
	});

	it('a few nested quotes on one marker line are still read without an error', () => {
		const shallow = '- > '.repeat(3) + 'x';
		expect(() => findBlocks(`${shallow}\n`)).not.toThrow();
	});
});
