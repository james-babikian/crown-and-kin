import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkNames, concatStyles } from '../../styles/concat.mjs';

// styles.css is generated from styles/NN-*.css (styles/README.md). If this test fails, run `npm run build` and commit styles.css.

describe('styles.css and its chunks', () => {
	it('the committed styles.css is the join of the chunks, byte for byte', () => {
		const committed = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8');
		expect(concatStyles()).toBe(committed);
	});

	it('the chunk numbers are unique and every chunk ends with a new line', () => {
		const names = chunkNames();
		expect(names.length).toBeGreaterThan(0);
		const numbers = names.map((n) => n.slice(0, 2));
		expect(new Set(numbers).size).toBe(numbers.length);
		for (const name of names) {
			expect(readFileSync(join(__dirname, '..', '..', 'styles', name), 'utf8').endsWith('\n')).toBe(true);
		}
	});

	it('the README lists every chunk', () => {
		const readme = readFileSync(join(__dirname, '..', '..', 'styles', 'README.md'), 'utf8');
		for (const name of chunkNames()) expect(readme).toContain(`\`${name}\``);
	});
});
