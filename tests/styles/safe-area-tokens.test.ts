import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * D335 (B-0065): the plugin reads the system bars only through the four tokens `--dynasty-safe-*` of styles/00-tokens.css, which take Obsidian's
 * own `--safe-area-inset-*` first and `env()` second. A rule that reads `env(safe-area-inset-*)` itself gives 0 on Android.
 */

const chunks = readdirSync('styles').filter((f) => f.endsWith('.css'));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const SIDES = ['top', 'bottom', 'left', 'right'];

describe('safe-area tokens (D335)', () => {
	it('no chunk reads env(safe-area-inset-*) or --safe-area-inset-* except the token file', () => {
		for (const f of chunks) {
			if (f === '00-tokens.css') continue;
			const css = strip(readFileSync(`styles/${f}`, 'utf8'));
			expect(css, f).not.toMatch(/env\(\s*safe-area-inset/);
			expect(css, f).not.toMatch(/--safe-area-inset/);
		}
	});

	it('the token file defines each side once, from the Obsidian variable with env() as the fallback', () => {
		const css = strip(readFileSync('styles/00-tokens.css', 'utf8'));
		for (const s of SIDES) {
			const line = `\n\t--dynasty-safe-${s}: var(--safe-area-inset-${s}, env(safe-area-inset-${s}, 0px));`;
			expect(css, s).toContain(line);
			expect(css.split(`--dynasty-safe-${s}: var(`)).toHaveLength(2);
		}
	});

	it('each token is registered as a length, so a bare 0 from a pop-out window stays valid in max() and calc()', () => {
		const css = strip(readFileSync('styles/00-tokens.css', 'utf8'));
		for (const s of SIDES) {
			const rule = `@property --dynasty-safe-${s} {\n\tsyntax: '<length>';\n\tinherits: true;\n\tinitial-value: 0px;\n}`;
			expect(css, s).toContain(rule);
		}
	});

	it('the safe-area probe pads itself with the tokens', () => {
		const css = strip(readFileSync('styles/16-full-screen.css', 'utf8'));
		const body = /\.dynasty-safe-probe \{([^}]*)\}/.exec(css)![1];
		expect(body).toContain('padding-top: var(--dynasty-safe-top);');
		expect(body).toContain('padding-left: var(--dynasty-safe-left);');
		expect(body).toContain('padding-right: var(--dynasty-safe-right);');
	});
});
