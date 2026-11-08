import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// D334 Q17: the Begetter sample of the legend is the orange of the line in the tree, with the same dash. The real styles.css in a real Chrome, with hand-built SVG of the shape that the plugin makes.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--color-orange:#ec7500;--color-red:#e93147;--color-blue:#086ddd;--text-normal:#222222;--text-muted:#5c5c5c;--text-faint:#999;--background-primary:#fff;--modal-background:#fff;}`;
const body = `<svg id="tree"><path class="dynasty-line dynasty-line-begetter" d="M0 0 C 10 0 20 10 30 10"/></svg>
<div class="dynasty-legend"><svg class="dynasty-legend-sample"><path id="sample" class="dynasty-line dynasty-line-begetter" d="M0 0 C 10 0 20 10 30 10"/></svg></div>`;

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

describe.skipIf(!CHROME)('the Begetter sample of the legend', () => {
	it('has the stroke colour, width, dash and caps of the drawn line, and that colour is orange, not grey-brown', async () => {
		await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light">${body}</body></html>`);
		const read = await page.evaluate(() => {
			const get = (el: Element) => {
				const s = getComputedStyle(el);
				return { stroke: s.stroke, width: s.strokeWidth, dash: s.strokeDasharray, cap: s.strokeLinecap };
			};
			return { tree: get(document.querySelector('#tree path')!), sample: get(document.getElementById('sample')!) };
		});
		expect(read.sample).toEqual(read.tree);
		// Chrome writes a mixed colour as `color(srgb 0.69 0.36 0.04)`.
		const [r, g, b] = (read.sample.stroke.match(/[\d.]+/g) ?? []).map((v) => Math.round(Number(v) * 255));
		// The drawn orange moved 30 % towards the text colour: red well above blue, as in the tree (rgb 175, 92, 10 here).
		expect(r - b, read.sample.stroke).toBeGreaterThan(100);
		expect(r).toBeGreaterThan(g);
	});
});
