import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * G2 review of the 0.2.8 look round (D212 sheet-opaque): a declaration that holds var() is "valid" for the parser whatever else it holds. The browser
 * decides at computed-value time. An engine that does not know relative colours (`rgb(from … r g b)`: Chromium before 119, Safari before 16.4) then makes the
 * property "invalid at computed-value time" and uses its initial value (transparent). It does NOT fall back to the declaration before it. So a "first line
 * stays for engines without relative colours" is false; the second line must sit in an @supports block (as 01-base.css does for color-mix).
 */

/** The text before `at` that opens each block that still encloses `at`. */
function enclosing(css: string, at: number): string[] {
	const stack: string[] = [];
	let start = 0;
	let i = 0;
	while (i < at) {
		if (css.startsWith('/*', i)) {
			i = css.indexOf('*/', i + 2) + 2;
			start = i;
			continue;
		}
		const ch = css[i];
		if (ch === '{') {
			stack.push(css.slice(start, i).trim());
			start = i + 1;
		} else if (ch === '}') {
			stack.pop();
			start = i + 1;
		} else if (ch === ';') start = i + 1;
		i++;
	}
	return stack;
}

describe('relative colours', () => {
	const dir = 'styles';
	const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

	it('every `rgb(from …)` sits in an @supports block, because var() hides it from the parser', () => {
		const bad: string[] = [];
		for (const f of files) {
			const css = readFileSync(`${dir}/${f}`, 'utf8');
			for (const m of css.matchAll(/rgb\(from /g)) {
				const open = enclosing(css, m.index!);
				if (!open.some((p) => p.startsWith('@supports'))) bad.push(`${f}: ${open[open.length - 1]}`);
			}
		}
		expect(bad).toEqual([]);
	});
});
