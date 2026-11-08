import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// D336 F1: a long house name in the head of the person window wraps to a second text line, the title and the years move down, and nothing overlaps. The real styles.css in a
// real Chrome, with hand-built DOM of the shape that `HeaderMeta` makes; Obsidian's own styles are not here, so the test checks the plugin's rules, not a theme.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:20px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-6:24px;--icon-m:18px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--text-faint:#999;--font-interface:Arial,sans-serif;--font-text:Georgia,serif;--layer-modal:50;}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px}`;

const head = (house: string, mark: 'dot' | 'arms') => `<div class="modal dynasty-sheet is-phone" style="position:relative;width:100%">
<div class="dynasty-sheet-body"><div class="dynasty-head dynasty-person-head"><div class="dynasty-head-text">
<div class="dynasty-head-name"><span>Aldric Valmont</span></div>
<div class="dynasty-joined dynasty-head-meta">
 <span class="dynasty-jitem"><span class="dynasty-house" id="house">${mark === 'dot' ? '<span class="dynasty-house-dot" id="mark"></span>' : '<span class="dynasty-house-armsmark" id="mark"><img id="img" width="15" height="15" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></span>'}<span class="dynasty-house-name" id="name">${house}</span></span></span>
 <span class="dynasty-jitem" id="title"><span class="dynasty-jmark">·</span> Duke of Valmont</span>
 <span class="dynasty-jitem" id="years"><span class="dynasty-jmark">·</span> 1102-1160</span>
</div></div></div></div></div>`;

let browser: Browser;
let page: Page;
beforeAll(async () => {
	if (!CHROME) return;
	browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
	page = await browser.newPage();
}, 60_000);
afterAll(async () => {
	await browser?.close();
}, 60_000);

interface Boxes {
	line: number;
	house: DOMRect;
	name: DOMRect;
	mark: DOMRect;
	title: DOMRect;
	years: DOMRect;
}

const measure = async (width: number, house: string, mark: 'dot' | 'arms'): Promise<Boxes> => {
	await page.setViewport({ width, height: 800, hasTouch: true });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light is-mobile">${head(house, mark)}</body></html>`);
	return page.evaluate(() => {
		const r = (id: string) => document.getElementById(id)!.getBoundingClientRect().toJSON();
		const meta = getComputedStyle(document.querySelector('.dynasty-head-meta')!);
		return { line: parseFloat(meta.fontSize) * 1.45, house: r('house'), name: r('name'), mark: r('mark'), title: r('title'), years: r('years') };
	}) as Promise<Boxes>;
};

const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

describe.skipIf(!CHROME)('the house in the head of the person window (D336 F1)', () => {
	const LONG = 'House Valmont of the Northern Marches';

	for (const mark of ['dot', 'arms'] as const) {
		it(`a long name (${mark} mark) takes two text lines, the house box holds both, and the title and years do not overlap it`, async () => {
			const m = await measure(320, LONG, mark);
			expect(m.name.height, 'the name wraps').toBeGreaterThan(m.line * 1.5);
			expect(m.house.bottom, 'the house box reaches the end of its name').toBeGreaterThanOrEqual(m.name.bottom - 0.5);
			expect(overlap(m.house, m.title), 'title').toBe(false);
			expect(overlap(m.house, m.years), 'years').toBe(false);
			expect(overlap(m.name, m.title), 'title and name').toBe(false);
			expect(overlap(m.name, m.years), 'years and name').toBe(false);
		});

		it(`the ${mark} mark stays level with the first text line of a long name`, async () => {
			const m = await measure(320, LONG, mark);
			const centre = (m.mark.top + m.mark.bottom) / 2;
			expect(Math.abs(centre - (m.name.top + m.line / 2)), JSON.stringify({ centre, top: m.name.top, line: m.line })).toBeLessThanOrEqual(1);
		});

		it(`a short name (${mark} mark) keeps one text line and the mark level with it`, async () => {
			const m = await measure(390, 'House Vane', mark);
			expect(m.house.height).toBeCloseTo(m.line, 0);
			expect(Math.abs((m.mark.top + m.mark.bottom) / 2 - (m.house.top + m.house.bottom) / 2)).toBeLessThanOrEqual(1);
		});
	}
});
