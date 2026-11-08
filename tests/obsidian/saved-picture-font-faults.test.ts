import { afterEach, describe, expect, it, vi } from 'vitest';
import { FONT_CAP_BYTES, fontsForPng, pageFontEnv, type FontEnv } from '../../src/obsidian/save-font';

// Faults of the page-font embed of a saved PNG (D334 Q2 A), shown on a fake page.

interface R {
	type: number;
	cssText: string;
	parentStyleSheet?: { href: string | null };
	cssRules?: R[];
	styleSheet?: { readonly cssRules: R[] };
}
const face = (family: string, src: string): R => ({
	type: 5,
	cssText: `@font-face { font-family: "${family}"; src: ${src}; }`,
	parentStyleSheet: { href: 'app://vault/snippets/a.css' },
});
const LISTS = { text: '"Snippet Serif", sans-serif', ui: 'sans-serif', bold: '600' };
const loaded = [{ family: '"Snippet Serif"', status: 'loaded' }];
const envOf = (sheets: R[][], read: FontEnv['read']): FontEnv => ({
	fonts: { forEach: (cb) => loaded.forEach(cb) },
	styleSheets: sheets.map((rules) => ({ cssRules: rules })) as unknown as ArrayLike<CSSStyleSheet>,
	baseURI: 'app://vault/index.html',
	read,
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('the page fonts of a saved PNG', () => {
	it('a cross-origin @import does not hide the @font-face rules after it in the same sheet', async () => {
		const crossImport: R = {
			type: 3,
			cssText: '@import url(https://fonts.example/x.css);',
			get styleSheet(): { readonly cssRules: R[] } {
				return {
					get cssRules(): R[] {
						throw new Error('SecurityError');
					},
				};
			},
		};
		const env = envOf([[crossImport, face('Snippet Serif', 'url("data:font/ttf;base64,AAAA")')]], async () => new ArrayBuffer(1));
		const r = await fontsForPng(LISTS, env);
		expect(r.css).toContain('base64,AAAA');
	});

	it('a failed download (404 page) is not embedded as a font', async () => {
		vi.stubGlobal('document', { fonts: undefined, styleSheets: [], baseURI: 'app://vault/' });
		vi.stubGlobal('fetch', async () => new Response('<html>Not found</html>', { status: 404 }));
		await expect(pageFontEnv().read('app://vault/snippets/a.woff2')).rejects.toBeTruthy();
	});

	it('the same sheet reached twice does not count its font twice against the 2 MB cap', async () => {
		const rule = face('Snippet Serif', 'url(big.ttf)');
		const imported: R = { type: 3, cssText: '', styleSheet: { cssRules: [rule] } };
		const half = Math.floor(FONT_CAP_BYTES * 0.6);
		const env = envOf([[rule], [imported]], async () => new Uint8Array(half).buffer);
		const r = await fontsForPng(LISTS, env);
		expect(r.css).toContain('@font-face');
		expect((r.css.match(/@font-face/g) ?? []).length).toBe(1);
	});

	it('a hung font file does not keep the save waiting longer than one limit in total', async () => {
		vi.useFakeTimers();
		const lists = { text: '"A", "B", "C", "D", sans-serif', ui: 'sans-serif', bold: '600' };
		const names = ['A', 'B', 'C', 'D'];
		const env: FontEnv = {
			fonts: { forEach: (cb) => names.forEach((family) => cb({ family, status: 'loaded' })) },
			styleSheets: [{ cssRules: names.map((n) => face(n, `url(${n}.woff2)`)) }] as unknown as ArrayLike<CSSStyleSheet>,
			baseURI: 'app://vault/index.html',
			read: () => new Promise<ArrayBuffer>(() => undefined),
		};
		let done = false;
		void fontsForPng(lists, env).then(() => (done = true));
		await vi.advanceTimersByTimeAsync(10_500);
		expect(done).toBe(true);
	});
});
