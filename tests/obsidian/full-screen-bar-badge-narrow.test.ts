import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// O-27 follow-up (G5 0.5.2, R3): the phone bar with the problem badge in a 320 px window. The real styles.css in a real Chrome, with hand-built DOM of the shape of the plugin's bar;
// Obsidian's own styles are not here (only the variables the plugin reads), so the test checks the plugin's rules, not a theme.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--icon-m:18px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--text-warning:#a60;--font-interface:Arial,sans-serif;--layer-modal:50;}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px}
.svg-icon{display:inline-block}`;
const ICON = '<svg class="svg-icon" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="8"/></svg>';
const tool = (cls: string, inner = `<span class="dynasty-tool-icon">${ICON}</span>`) => `<button type="button" class="clickable-icon dynasty-tool ${cls}">${inner}</button>`;
const bar = (badge: boolean, count = '12') =>
	`<div class="modal dynasty-fullscreen is-phone"><div class="modal-content dynasty-fullscreen-content"><div class="dynasty-full" style="position:fixed;inset:0"><div class="dynasty-toolbar">` +
	[
		tool('dynasty-add-person'),
		tool('dynasty-houses-button'),
		tool('dynasty-focus'),
		tool('dynasty-find'),
		tool('dynasty-more'),
		badge ? tool('dynasty-warning-badge', `<span class="dynasty-tool-icon">${ICON}</span><span class="dynasty-warning-count">${count}</span>`) : '',
		tool('dynasty-close'),
	].join('') +
	'</div></div></div></div>';

let browser: Browser;
let page: Page;
beforeAll(async () => {
	if (!CHROME) return;
	browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
	page = await browser.newPage();
});
afterAll(async () => {
	await browser?.close();
});

/** The boxes of all buttons, and for each button how many of its five test points (corners inset 1 px, centre) another button covers. */
const measure = async (width: number, badge: boolean, count?: string) => {
	await page.setViewport({ width, height: 700, hasTouch: true, isMobile: false });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light is-mobile">${bar(badge, count)}</body></html>`);
	return page.evaluate(() => {
		const buttons = Array.from(document.querySelectorAll<HTMLElement>('.dynasty-toolbar > .dynasty-tool'));
		return buttons.map((b) => {
			const r = b.getBoundingClientRect();
			const points = [
				[r.left + 1, r.top + 1],
				[r.right - 1, r.top + 1],
				[r.left + 1, r.bottom - 1],
				[r.right - 1, r.bottom - 1],
				[r.left + r.width / 2, r.top + r.height / 2],
			];
			const covered = points.filter(([x, y]) => {
				const hit = document.elementFromPoint(x, y);
				return !hit || !b.contains(hit);
			}).length;
			return { name: Array.from(b.classList).find((c) => c.startsWith('dynasty-') && c !== 'dynasty-tool')!, left: r.left, right: r.right, w: r.width, covered };
		});
	});
};

describe.skipIf(!CHROME)('the phone bar with and without the problem badge', () => {
	for (const width of [320, 375]) {
		for (const badge of [false, true]) {
			it(`${width} px, ${badge ? 'with' : 'without'} the badge: no button lies under another, every button is 44 px wide and inside the window`, async () => {
				const boxes = await measure(width, badge);
				const info = JSON.stringify(boxes);
				expect(boxes.length, info).toBe(badge ? 7 : 6);
				for (const b of boxes) {
					expect(b.covered, info).toBe(0);
					expect(b.w, info).toBeGreaterThanOrEqual(43.5);
					expect(b.left, info).toBeGreaterThanOrEqual(-0.01);
					expect(b.right, info).toBeLessThanOrEqual(width + 0.01);
				}
				for (let i = 1; i < boxes.length; i++) expect(boxes[i].left, info).toBeGreaterThanOrEqual(boxes[i - 1].right - 0.01);
			});
		}
	}

	it('320 px with a badge of three digits still leaves Close whole and uncovered', async () => {
		const boxes = await measure(320, true, '123');
		const close = boxes[boxes.length - 1];
		expect(close.covered, JSON.stringify(boxes)).toBe(0);
		expect(close.right).toBeLessThanOrEqual(320.01);
	});
});
