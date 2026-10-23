// WP-2 of 0.3.2: the plugin tick must reset what Obsidian sets on `input[type=checkbox]:checked:after`, or only a corner of the tick shows on a phone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

describe('the tick box of the plugin windows', () => {
	const start = css.indexOf(".dynasty-sheet .dynasty-check input[type='checkbox']:checked::after {");
	const rule = css.slice(start, css.indexOf('}', start));

	it('has a tick rule', () => {
		expect(start).toBeGreaterThan(-1);
	});

	it.each([
		'position: static',
		'inset: auto',
		'background: none',
		'-webkit-mask-image: none',
		'mask-image: none',
	])('resets %s', (decl) => {
		expect(rule).toContain(decl);
	});
});
