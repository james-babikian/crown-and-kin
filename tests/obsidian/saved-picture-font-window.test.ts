import { afterEach, describe, expect, it, vi } from 'vitest';
import { fontsForPng, pageFontEnv } from '../../src/obsidian/save-font';

// The fonts are read from the document of the tree's window, not from the main window (a pop-out window has its own document).

afterEach(() => vi.unstubAllGlobals());

describe('the fonts of the window of the tree', () => {
	it('pageFontEnv reads the document that it is given, not the global one', () => {
		vi.stubGlobal('document', { fonts: undefined, styleSheets: [], baseURI: 'app://main/' });
		const pop = { fonts: undefined, styleSheets: [], baseURI: 'app://pop-out/' } as unknown as Document;
		expect(pageFontEnv(pop).baseURI).toBe('app://pop-out/');
		expect(pageFontEnv().baseURI).toBe('app://main/');
	});

	it('fontsForPng finds the font loaded in the given document', async () => {
		vi.stubGlobal('document', { fonts: { forEach: () => undefined }, styleSheets: [], baseURI: 'app://main/' });
		const face = {
			type: 5,
			cssText: '@font-face { font-family: "Pop Serif"; src: url("data:font/ttf;base64,AAAA"); }',
			parentStyleSheet: { href: null },
		};
		const pop = {
			fonts: { forEach: (cb: (f: { family: string; status: string }) => void) => cb({ family: '"Pop Serif"', status: 'loaded' }) },
			styleSheets: [{ cssRules: [face] }],
			baseURI: 'app://pop-out/',
		} as unknown as Document;
		const r = await fontsForPng({ text: '"Pop Serif", sans-serif', ui: 'sans-serif', bold: '600' }, undefined, pop);
		expect(r.css).toContain('base64,AAAA');
	});
});
