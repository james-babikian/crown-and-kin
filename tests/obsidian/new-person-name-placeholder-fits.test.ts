import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NEW_SHEET } from '../../src/render/sheet-text';

// B-0064: the placeholder of the Name field of a new person must show whole on every phone width. The real styles.css in a real Chrome, with hand-built DOM of the shape that
// the plugin makes (a `dynasty-grid` with `is-wide` fields); Obsidian's own styles are not here, so the test checks the plugin's rules, not a theme.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:20px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-6:24px;--icon-m:18px;--input-height:30px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--text-faint:#999;--text-warning:#a60;--interactive-normal:#eee;--background-modifier-form-field:#fff;--font-interface:Arial,sans-serif;--font-text:Georgia,serif;--layer-modal:50;}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px}`;

const form = (wide: boolean) => `<div class="modal dynasty-sheet is-phone" style="position:relative;width:100%">
<div class="dynasty-sheet-body"><div class="dynasty-grid">
 <div class="dynasty-sheet-field ${wide ? 'is-wide' : ''}"><label class="dynasty-sheet-label" for="f-name">Name</label><input class="dynasty-sheet-input dynasty-input" id="f-name" placeholder="${NEW_SHEET.namePlaceholder}"></div>
 <div class="dynasty-sheet-field ${wide ? 'is-wide' : ''}"><label class="dynasty-sheet-label" for="f-sob">Sobriquet</label><input class="dynasty-sheet-input dynasty-input" id="f-sob"></div>
</div></div></div>`;

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

/** The free width of the text area of the field minus the width of the placeholder: negative when the placeholder is cut. */
const spare = async (width: number, wide: boolean) => {
	await page.setViewport({ width, height: 800, hasTouch: true });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light is-mobile">${form(wide)}</body></html>`);
	return page.evaluate(() => {
		const input = document.getElementById('f-name') as HTMLInputElement;
		const s = getComputedStyle(input);
		const ctx = document.createElement('canvas').getContext('2d')!;
		ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
		const room = input.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
		return { room, need: ctx.measureText(input.placeholder).width };
	});
};

describe.skipIf(!CHROME)('the Name placeholder of a new person (B-0064)', () => {
	it('is cut in half a row, which is why Name has a row of its own (the measure sees the fault)', async () => {
		const m = await spare(390, false);
		expect(m.need, JSON.stringify(m)).toBeGreaterThan(m.room);
	});

	for (const width of [320, 375, 390]) {
		it(`shows whole at ${width} px when Name has a row of its own`, async () => {
			const m = await spare(width, true);
			expect(m.need, JSON.stringify(m)).toBeLessThanOrEqual(m.room);
		});
	}
});
