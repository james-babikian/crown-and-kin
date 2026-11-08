import { describe, expect, it } from 'vitest';
import { FONT_CAP_BYTES, descriptorsOf, fontsForPng, pickSource, type FontEnv } from '../../src/obsidian/save-font';
import { withoutPageFonts } from '../../src/render/fonts';

/*
 * Spec §0 D334 (Q2 A), spec §13.8: how the font of a tree is found, read and embedded for a PNG, on a fake page (no browser). A family counts only when the
 * page loaded it from a file; a system font is not in the font set of the page and is left alone. A family whose files cannot be read, or that would bring the
 * total over 2 MB, is taken out of the font lists, so the cards are measured for the font that the canvas draws. The real engines are in
 * An internal test.
 */

interface FakeRule {
	type: number;
	cssText: string;
	parentStyleSheet?: { href: string | null };
	cssRules?: FakeRule[];
}

/** A rule as a browser writes its text: `@font-face { font-family: "X"; src: ...; }`. */
const face = (family: string, src: string, extra: Record<string, string> = {}): FakeRule => ({
	type: 5,
	cssText: `@font-face { font-family: "${family}"; src: ${src}; ${Object.entries(extra).map(([k, v]) => `${k}: ${v};`).join(' ')} }`,
	parentStyleSheet: { href: 'app://vault/snippets/a.css' },
});

interface Setup {
	loaded?: { family: string; status: string }[];
	sheets?: (FakeRule[] | 'cross-origin')[];
	files?: Record<string, number | Error>;
}

function envOf(s: Setup): { env: FontEnv; reads: string[] } {
	const reads: string[] = [];
	const sheets = (s.sheets ?? []).map((rules) => ({
		get cssRules() {
			if (rules === 'cross-origin') throw new Error('SecurityError');
			return rules;
		},
	}));
	const env: FontEnv = {
		fonts: { forEach: (cb) => (s.loaded ?? []).forEach(cb) },
		styleSheets: sheets as unknown as ArrayLike<CSSStyleSheet>,
		baseURI: 'app://vault/index.html',
		read: async (url) => {
			reads.push(url);
			const file = s.files?.[url];
			if (file === undefined || file instanceof Error) throw file ?? new Error('404');
			return new Uint8Array(file).fill(65).buffer;
		},
	};
	return { env, reads };
}

const LISTS = { text: '"Snippet Serif", -apple-system, "Segoe UI", sans-serif', ui: 'Inter, "Snippet Serif", sans-serif', bold: '600' };
const loadedSerif = [{ family: '"Snippet Serif"', status: 'loaded' }];

describe('the font of a PNG', () => {
	it('leaves the lists alone and reads nothing when the page loaded no font file', async () => {
		const { env, reads } = envOf({ loaded: [], sheets: [[face('Snippet Serif', 'url(a.woff2)')]], files: { 'app://vault/snippets/a.woff2': 100 } });
		const r = await fontsForPng(LISTS, env);
		expect(r.fonts).toBe(LISTS);
		expect(r.css).toBe('');
		expect(reads).toEqual([]);
	});

	it('does not count a face that did not load or failed', async () => {
		for (const status of ['unloaded', 'error']) {
			const { env } = envOf({ loaded: [{ family: 'Snippet Serif', status }], sheets: [[face('Snippet Serif', 'url(a.woff2)')]] });
			expect((await fontsForPng(LISTS, env)).fonts).toBe(LISTS);
		}
	});

	it('embeds a font whose file is a data address, as it is', async () => {
		const uri = 'data:font/ttf;base64,AAAA';
		const { env, reads } = envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', `url("${uri}") format("truetype")`, { 'font-weight': '100 900', 'font-style': 'normal' })]] });
		const r = await fontsForPng(LISTS, env);
		expect(r.fonts).toBe(LISTS);
		expect(r.css).toBe(`@font-face{font-family:"Snippet Serif";src:url("${uri}");font-weight:100 900;font-style:normal}`);
		expect(reads).toEqual([]);
	});

	it('reads a file by its address from the sheet, and writes it as a data address with its type', async () => {
		const { env, reads } = envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', 'url(fonts/s.woff2) format("woff2")')]], files: { 'app://vault/snippets/fonts/s.woff2': 3 } });
		const r = await fontsForPng(LISTS, env);
		expect(reads).toEqual(['app://vault/snippets/fonts/s.woff2']);
		expect(r.css).toBe('@font-face{font-family:"Snippet Serif";src:url("data:font/woff2;base64,QUFB");}');
		expect(r.fonts).toBe(LISTS);
	});

	it('finds the rule inside an @media group and inside an imported sheet', async () => {
		const media: FakeRule = { type: 4, cssText: '', cssRules: [face('Snippet Serif', 'url("data:font/ttf;base64,AAAA")')] };
		const imported: FakeRule = { type: 3, cssText: '', styleSheet: { cssRules: [face('Snippet Serif', 'url("data:font/ttf;base64,BBBB")')] } } as FakeRule;
		const r = await fontsForPng(LISTS, envOf({ loaded: loadedSerif, sheets: [[media, imported]] }).env);
		expect(r.css).toContain('base64,AAAA');
		expect(r.css).toContain('base64,BBBB');
	});

	it('takes the family out of both lists when the sheet is from another origin', async () => {
		const r = await fontsForPng(LISTS, envOf({ loaded: loadedSerif, sheets: ['cross-origin'] }).env);
		expect(r.css).toBe('');
		expect(r.fonts).toEqual({ text: '-apple-system, "Segoe UI", sans-serif', ui: 'Inter, sans-serif', bold: '600' });
	});

	it('takes the family out when the page loaded it but no rule names it (a font added by a script)', async () => {
		const r = await fontsForPng(LISTS, envOf({ loaded: loadedSerif, sheets: [[face('Other', 'url(x.ttf)')]] }).env);
		expect(r.fonts.text).toBe('-apple-system, "Segoe UI", sans-serif');
	});

	it('takes the family out when its file cannot be read or has no usable address', async () => {
		const gone = await fontsForPng(LISTS, envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', 'url(a.woff2)')]], files: {} }).env);
		expect(gone.css).toBe('');
		expect(gone.fonts.text).not.toContain('Snippet Serif');
		const none = await fontsForPng(LISTS, envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', 'local("Foo")')]] }).env);
		expect(none.fonts.ui).toBe('Inter, sans-serif');
	});

	it('uses sans-serif when the page font was the only family', async () => {
		const only = { text: '"Snippet Serif"', ui: '"Snippet Serif"', bold: '600' };
		const r = await fontsForPng(only, envOf({ loaded: loadedSerif, sheets: ['cross-origin'] }).env);
		expect(r.fonts).toEqual({ text: 'sans-serif', ui: 'sans-serif', bold: '600' });
	});

	it('takes the family out when one file is over the 2 MB cap', async () => {
		const { env } = envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', 'url(big.ttf)')]], files: { 'app://vault/snippets/big.ttf': FONT_CAP_BYTES + 1 } });
		const r = await fontsForPng(LISTS, env);
		expect(r.css).toBe('');
		expect(r.fonts.text).not.toContain('Snippet Serif');
	});

	it('embeds a file of exactly the cap', async () => {
		const { env } = envOf({ loaded: loadedSerif, sheets: [[face('Snippet Serif', 'url(big.ttf)')]], files: { 'app://vault/snippets/big.ttf': FONT_CAP_BYTES } });
		expect((await fontsForPng(LISTS, env)).css).toContain('@font-face');
	});

	it('takes the family out when its files together are over the cap, and keeps a family that fits', async () => {
		const lists = { text: '"Snippet Serif", "Small Sans", sans-serif', ui: 'sans-serif', bold: '600' };
		const { env } = envOf({
			loaded: [...loadedSerif, { family: 'Small Sans', status: 'loaded' }],
			sheets: [[face('Small Sans', 'url(s.ttf)'), face('Snippet Serif', 'url(r.ttf)'), face('Snippet Serif', 'url(b.ttf)')]],
			files: { 'app://vault/snippets/s.ttf': 1000, 'app://vault/snippets/r.ttf': FONT_CAP_BYTES - 2000, 'app://vault/snippets/b.ttf': FONT_CAP_BYTES - 2000 },
		});
		const r = await fontsForPng(lists, env);
		expect(r.css).toContain('"Small Sans"');
		expect(r.css).not.toContain('Snippet Serif');
		expect(r.fonts.text).toBe('"Small Sans", sans-serif');
	});

	it('does not throw on a page with no font set or with a broken style sheet list', async () => {
		const { env } = envOf({});
		expect((await fontsForPng(LISTS, { ...env, fonts: undefined })).fonts).toBe(LISTS);
		const broken = { ...env, fonts: { forEach: () => { throw new Error('no'); } } } as FontEnv;
		expect((await fontsForPng(LISTS, broken)).fonts).toBe(LISTS);
	});
});

describe('the text of a font rule', () => {
	it('splits the declarations and keeps a ; inside a data address or a quote', () => {
		const d = descriptorsOf('@font-face { font-family: "A;B"; src: url("data:font/ttf;base64,AA==") format("truetype"), url(x;y.woff); FONT-WEIGHT: 100 900 }');
		expect([...d.keys()]).toEqual(['font-family', 'src', 'font-weight']);
		expect(d.get('font-family')).toBe('"A;B"');
		expect(d.get('src')).toBe('url("data:font/ttf;base64,AA==") format("truetype"), url(x;y.woff)');
		expect(d.get('font-weight')).toBe('100 900');
	});

	it('reads a rule with an unquoted data address of 2 MB at once', () => {
		const d = descriptorsOf(`@font-face { src: url(data:font/ttf;base64,${'A'.repeat(FONT_CAP_BYTES)}); font-style: italic; }`);
		expect(d.get('font-style')).toBe('italic');
		expect(d.get('src')?.length).toBeGreaterThan(FONT_CAP_BYTES);
	});

	it('gives nothing for text with no braces', () => {
		expect(descriptorsOf('nothing').size).toBe(0);
	});
});

describe('the sources of a font rule', () => {
	it('takes the first address with a format that a browser reads', () => {
		expect(pickSource('url(a.eot) format("embedded-opentype"), url(b.woff2) format("woff2"), url(c.ttf)')).toEqual({ url: 'b.woff2', format: 'woff2' });
		expect(pickSource("local('X'), url('c.ttf')")).toEqual({ url: 'c.ttf', format: '' });
		expect(pickSource('local(X)')).toBeNull();
		expect(pickSource('url(a.svg#f) format("svg")')).toBeNull();
	});
});

describe('the font lists without the fonts of the page', () => {
	it('drops the named families, keeps the order, and falls back to sans-serif', () => {
		expect(withoutPageFonts('"Snippet Serif", Inter, sans-serif', new Set(['snippet serif']))).toBe('Inter, sans-serif');
		expect(withoutPageFonts('Inter, sans-serif', new Set(['snippet serif']))).toBe('Inter, sans-serif');
		expect(withoutPageFonts("'A', B", new Set(['a', 'b']))).toBe('sans-serif');
		expect(withoutPageFonts('A, B', new Set())).toBe('A, B');
	});
});
