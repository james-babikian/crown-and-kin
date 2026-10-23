import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 0.2.6, WP3 (D173): the phone list rows. The gap between the last picture and the divider, and the sobriquet that
 * moves whole. These are rule checks; the pictures are the harness' job.
 */

const css = readFileSync('styles.css', 'utf8');
const rule = (selector: string): string => {
	const found = [...css.matchAll(/(^|\n)([^{}\n]+)\{([^}]*)\}/g)].filter((m) => m[2].split(',').map((x) => x.trim()).includes(selector));
	return found.map((m) => m[3]).join('\n');
};

describe('phone list rows (D173)', () => {
	it('0.2.8 (C03): no divider before the pencil; the pencil is a 44 px square at the right edge', () => {
		const pencil = rule('.dynasty-list button.dynasty-list-edit:not(.dynasty-list-whole)');
		expect(pencil).not.toMatch(/border-left:/);
		expect(pencil).toMatch(/width:\s*44px/);
		expect(pencil).toMatch(/height:\s*44px/);
	});

	it('the sobriquet is one inline box that is never wider than the row', () => {
		const sob = rule('.dynasty-list-sob');
		expect(sob).toMatch(/display:\s*inline-block/);
		expect(sob).toMatch(/max-width:\s*100%/);
		// No nowrap: a sobriquet wider than the row must still wrap inside its box.
		expect(sob).not.toMatch(/white-space:\s*nowrap/);
	});
});
