// Guards two faults the C6 harness found in the phone list: a long name must wrap (Obsidian sets nowrap on a button),
// and the saved-row flash must live in the block state so a second build keeps it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('styles.css', 'utf8');
const view = readFileSync('src/obsidian/tree-view-list.ts', 'utf8');

describe('phone list faults of WP-C6', () => {
	it('the name button and the pencil button of a row reset white-space to normal', () => {
		const start = css.indexOf('.dynasty-list button.dynasty-list-go,\n.dynasty-list button.dynasty-list-edit {');
		expect(start).toBeGreaterThan(-1);
		const block = css.slice(start, css.indexOf('}', start));
		expect(block).toContain('white-space: normal;');
	});

	it('the saved-row flash is kept per block, and a later build flashes for the time that is left', () => {
		expect(view).toContain('const savedFlashes = new WeakMap<BlockState');
		expect(view).toContain('this.flashRow(row, left)');
	});

	it('the list bar has its own layer above the invisible edit-block button of Obsidian', () => {
		const start = css.indexOf('.dynasty-list-viewport > .dynasty-toolbar {');
		expect(start).toBeGreaterThan(-1);
		const block = css.slice(start, css.indexOf('}', start));
		expect(block).toContain('position: relative;');
		expect(block).toContain('z-index: 1;');
		expect(block).not.toContain('position: static');
	});
});
