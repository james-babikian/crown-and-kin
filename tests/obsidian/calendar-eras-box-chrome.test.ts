import { existsSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { concatStyles } from '../../styles/concat.mjs';
import { device, resetDom, type FEl } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { openWindow } from '../support/calendar-window-app';
import { toHtml } from '../support/fake-dom-html';
import { useFakeDom } from '../support/fake-dom-setup';

// A browser closes slowly when several test files start browsers at once; the default 10 s hook limit then fails the file with no failed test.
vi.setConfig({ hookTimeout: 60_000 });

/*
 * D342: the eras box of the Calendars window in a real Chrome, at 320 and 390 px with a touch screen (the phone window) and at a computer width, in the light and the
 * dark theme. The window is the real plugin code on the fake DOM, written as HTML, with the real style sheet (the joined chunks of styles/). Obsidian's own styles are not
 * here (only the variables that the plugin reads), so these tests check the plugin's rules, not a theme. Made-up names only.
 */
useFakeDom({ window: true });

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const css = concatStyles();

const LIGHT = '--background-primary:#ffffff;--background-secondary:#f5f5f5;--background-modifier-border:#cccccc;--background-modifier-form-field:#ffffff;--text-normal:#222222;--text-muted:#666666;--text-faint:#999999;--text-error:#d00000;--interactive-accent:#7a3cff;--text-accent:#5a2ad0;';
const DARK = '--background-primary:#1e1e1e;--background-secondary:#262626;--background-modifier-border:#3a3a3a;--background-modifier-form-field:#262626;--text-normal:#dadada;--text-muted:#a3a3a3;--text-faint:#6f6f6f;--text-error:#ff6b6b;--interactive-accent:#8a5cff;--text-accent:#a88bff;';
const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:20px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-6:24px;--icon-m:18px;--icon-s:16px;--icon-l:20px;--input-height:30px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--font-interface:Arial,sans-serif;--font-text:Georgia,serif;--layer-modal:50;}
body.theme-light{${LIGHT}} body.theme-dark{${DARK}}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px;background:var(--background-primary);color:var(--text-normal)}
.svg-icon{display:inline-block}`;

const NOTE = [
	'```kin-calendar',
	'calendars:',
	'  - name: Reigns',
	'    kind: eras',
	'    formats: ["{era} {year}"]',
	'    eras:',
	'      - {name: Reign of Aldric, start: 1100}',
	'      - {name: Reign of Bran, start: 1140}',
	'      - {name: "Reign of Dina the Wise, Lady of the Northern Marches and of the Isles", start: 1160}',
	'      - {name: Reign of Cara, start: 1180}',
	'```',
	'',
].join('\n');

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
beforeEach(() => {
	resetDom();
	resetObsidian();
});

/** The HTML of the real window, as a phone (coarse pointer, `width`) or a computer draws it. */
async function windowHtml(phone: boolean, width: number): Promise<string> {
	device.coarse = phone;
	device.width = phone ? width : 1280;
	try {
		const o = await openWindow({ 'Calendars.md': NOTE });
		return toHtml(o.win.modalEl as FEl);
	} finally {
		device.coarse = false;
		device.width = 1280;
	}
}

interface Facts {
	modal: string;
	overflow: boolean;
	boxRight: number;
	bodyRight: number;
	areaWidth: number;
	rowWidth: number;
	areaFont: number;
	help: { shown: boolean; colour: string };
	list: { colour: string; background: string };
	rows: { endRight: number; listRight: number; overlap: boolean; endLines: number; text: string; end: string }[];
}

async function facts(phone: boolean, width: number, theme: 'light' | 'dark'): Promise<Facts> {
	const html = await windowHtml(phone, width);
	await page.setViewport({ width, height: 900, hasTouch: phone, isMobile: phone });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-${theme}${phone ? ' is-mobile' : ''}"><div class="modal-container">${html}</div></body></html>`);
	await page.evaluate((w: number, p: boolean) => {
		const m = document.querySelector<HTMLElement>('.modal')!;
		m.style.width = `${p ? w : Math.min(700, w)}px`;
		m.style.position = 'relative';
	}, width, phone);
	return page.evaluate(() => {
		const m = document.querySelector<HTMLElement>('.modal')!;
		const box = document.querySelector<HTMLElement>('.dynasty-cal-eras-box')!;
		const body = document.querySelector<HTMLElement>('.dynasty-sheet-body') ?? m;
		const area = box.querySelector<HTMLTextAreaElement>('textarea')!;
		const help = box.children[2] as HTMLElement;
		const list = box.querySelector<HTMLElement>('.dynasty-cal-era-list')!;
		const lr = list.getBoundingClientRect();
		const rows = Array.from(list.querySelectorAll<HTMLElement>('.dynasty-cal-era-read')).map((row) => {
			const a = row.querySelector<HTMLElement>('.dynasty-cal-era-first')!.getBoundingClientRect();
			const e = row.querySelector<HTMLElement>('.dynasty-cal-era-end')!;
			const b = e.getBoundingClientRect();
			const lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.4;
			return {
				endRight: b.right,
				listRight: lr.right,
				overlap: Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top),
				endLines: Math.round(b.height / lh),
				text: row.textContent ?? '',
				end: e.textContent ?? '',
			};
		});
		return {
			modal: m.className,
			overflow: body.scrollWidth > body.clientWidth + 1,
			boxRight: box.getBoundingClientRect().right,
			bodyRight: body.getBoundingClientRect().right,
			areaWidth: area.getBoundingClientRect().width,
			rowWidth: area.parentElement!.getBoundingClientRect().width,
			areaFont: parseFloat(getComputedStyle(area).fontSize),
			help: { shown: getComputedStyle(help).display !== 'none' && help.getBoundingClientRect().height > 0, colour: getComputedStyle(help).color },
			list: { colour: getComputedStyle(list).color, background: getComputedStyle(document.body).backgroundColor },
			rows,
		};
	});
}

describe.skipIf(!CHROME)('D342: the eras box in a real Chrome', () => {
	for (const [name, phone, width] of [['phone 320 px', true, 320], ['phone 390 px', true, 390], ['computer', false, 1100]] as const) {
		for (const theme of ['light', 'dark'] as const) {
			it(`${name}, ${theme}: the field takes the whole row, the help shows, and each era line has its end at the right on one text line, with no overlap and no sideways scroll`, async () => {
				const f = await facts(phone, width, theme);
				const all = JSON.stringify(f);
				expect(f.modal.includes('is-phone'), all).toBe(phone);
				expect(f.overflow, all).toBe(false);
				expect(f.boxRight, all).toBeLessThanOrEqual(f.bodyRight + 0.5);
				expect(Math.abs(f.areaWidth - f.rowWidth), all).toBeLessThan(1);
				// A touched field needs 16 px or more, or iOS zooms the page (rule book "iOS inputs").
				if (phone) expect(f.areaFont, all).toBeGreaterThanOrEqual(16);
				expect(f.help.shown, all).toBe(true);
				// The list has the quiet colour of the help (one token), and it is not the colour of the window.
				expect(f.list.colour, all).toBe(f.help.colour);
				expect(f.list.colour, all).not.toBe(f.list.background);
				expect(f.rows.map((r) => r.end), all).toEqual(['to 1139', 'to 1159', 'to 1179', 'no end']);
				for (const r of f.rows) {
					expect(r.overlap, all).toBe(false);
					expect(r.endLines, all).toBe(1);
					expect(Math.abs(r.endRight - r.listRight), all).toBeLessThan(1);
				}
			});
		}
	}
});
