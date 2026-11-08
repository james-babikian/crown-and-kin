import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SUCCESSION_UI } from '../../src/render/succession-text';

// B-0036: on a phone the sentence of the Show bar wraps to at most two text lines, and the rule and "No heir in the tree." stay in sight. The real styles.css in a real Chrome, with hand-built
// DOM of the shape that the plugin makes; Obsidian's own styles are not here, so the test checks the plugin's rules, not a theme.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--icon-m:18px;--radius-s:4px;--font-normal:400;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--font-interface:Arial,sans-serif;--font-text:Georgia,serif;}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px}`;

const T = SUCCESSION_UI;
const SENTENCES = [
	T.bar('Duke of Carrowmere', null, 'eldest-child'),
	T.barNoHeir('Duke of Carrowmere', null, 'eldest-child'),
	T.barNoHeir('Duke of Carrowmere', 1150, 'siblings-first'),
];

/** The two bars of a phone: the bar over the tree (`dynasty-result`, a row with the X) and the bar at the top of the list. */
const bars = (sentence: string) => {
	const at = sentence.lastIndexOf(' · ');
	const text = `${sentence.slice(0, at)}<span class="dynasty-sr-only">, </span><span aria-hidden="true"> · </span><span>${sentence.slice(at + 3)}</span>`;
	return `<div class="dynasty-result dynasty-succession-bar dynasty-result-phone" id="tree-bar" style="position:relative;top:0"><div class="dynasty-result-text dynasty-succession-text" role="status">${text}</div><div class="dynasty-result-buttons"><button class="dynasty-result-button clickable-icon dynasty-bar-x">x</button></div></div>
<div class="dynasty-list-succession" id="list-bar"><div class="dynasty-succession-text">${text}</div><button class="dynasty-succession-close">x</button></div>`;
};

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

/** The lines of the sentence that the sentence needs, the lines it shows, and whether the whole text fits in what it shows. */
const measure = async (width: number, sentence: string, id: string) => {
	await page.setViewport({ width, height: 800, hasTouch: true });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light is-mobile">${bars(sentence)}</body></html>`);
	return page.evaluate((barId) => {
		const el = document.querySelector(`#${barId} .dynasty-succession-text`) as HTMLElement;
		const s = getComputedStyle(el);
		const line = parseFloat(s.lineHeight);
		const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
		return { shown: Math.round((el.clientHeight - pad) / line), needed: Math.round((el.scrollHeight - pad) / line), bar: (document.getElementById(barId) as HTMLElement).offsetHeight };
	}, id);
};

describe.skipIf(!CHROME)('the Show bar on a phone (B-0036)', () => {
	for (const width of [320, 375, 390]) {
		for (const id of ['tree-bar', 'list-bar']) {
			it(`${id} at ${width} px: the sentence wraps, none of it is cut, and it needs three text lines at most`, async () => {
				for (const sentence of SENTENCES) {
					const m = await measure(width, sentence, id);
					expect(m.shown, sentence).toBe(m.needed);
					expect(m.needed, sentence).toBeLessThanOrEqual(3);
					// Two text lines hold the sentence of a phone of 390 px; the narrower phones need a third line for the longest sentences only.
					if (width === 390 && !sentence.includes('lateral')) expect(m.needed, sentence).toBeLessThanOrEqual(2);
				}
			});
		}
	}

	it('the computer bar keeps its one row: no clamp on the finder text', async () => {
		await page.setViewport({ width: 1000, height: 800 });
		await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body>${bars(SENTENCES[1]).replace(' dynasty-result-phone', '')}</body></html>`);
		const lines = await page.evaluate(() => {
			const el = document.querySelector('#tree-bar .dynasty-succession-text') as HTMLElement;
			return { display: getComputedStyle(el).display, clamp: getComputedStyle(el).webkitLineClamp };
		});
		expect(lines.clamp).toBe('none');
	});
});
