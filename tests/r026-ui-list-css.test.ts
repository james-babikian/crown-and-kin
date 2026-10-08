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
	it('the name button keeps a gap of 0.5 em after the pictures, before the divider of the pencil button', () => {
		expect(rule('.dynasty-list button.dynasty-list-go')).toMatch(/padding-right:\s*0\.5em/);
		// The divider is the left border of the pencil button, so the gap belongs to the name button.
		expect(rule('.dynasty-list button.dynasty-list-edit:not(.dynasty-list-whole)')).toMatch(/border-left:/);
	});

	it('the sobriquet is one inline box that is never wider than the row', () => {
		const sob = rule('.dynasty-list-sob');
		expect(sob).toMatch(/display:\s*inline-block/);
		expect(sob).toMatch(/max-width:\s*100%/);
		// No nowrap: a sobriquet wider than the row must still wrap inside its box.
		expect(sob).not.toMatch(/white-space:\s*nowrap/);
	});
});
