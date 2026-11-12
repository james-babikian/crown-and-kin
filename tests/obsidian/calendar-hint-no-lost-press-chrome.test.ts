import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { concatStyles } from '../../styles/concat.mjs';

// A browser closes slowly when several test files start browsers at once; the default 10 s hook limit then fails the file with no failed test.
vi.setConfig({ hookTimeout: 60_000 });

/*
 * D342 repair, "no lost press": the user walk found that the first press on "Add era" did nothing after the user typed in "Same year as". The help of the field hid when
 * the field lost the focus at the press, the link under it moved up, and the release ended on another place, so the browser sent no click. Here the real `field` of the
 * Calendars window (`src/obsidian/calendar-parts.ts`) and the real press hold (`render/dom/press-hold.ts`) are bundled with esbuild into a page with the real style sheet,
 * in a real Chrome, with a real mouse press and a real touch tap: a help line under a row of fields (the start of a cycle calendar), and a help line that shows while its
 * field has the focus (Formats). The link right below must get the click. The same page with no press hold is the control: it loses the press, so the test can fail.
 */

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = concatStyles();

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--input-height:30px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--background-primary:#fff;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--interactive-accent:#7a3cff;--font-interface:Arial,sans-serif;}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:13px}`;

/** The element helpers of Obsidian that the bundled files use. */
const SHIM = `
const toList = (c) => (c === undefined ? [] : Array.isArray(c) ? c : String(c).split(' '));
Object.defineProperty(Node.prototype, 'win', { get() { return this.ownerDocument.defaultView; } });
Object.defineProperty(Node.prototype, 'doc', { get() { return this.ownerDocument; } });
Element.prototype.createEl = function (tag, o = {}) {
	const o2 = typeof o === 'string' ? { cls: o } : o;
	const el = document.createElement(tag);
	for (const c of toList(o2.cls)) if (c) el.classList.add(c);
	if (o2.text !== undefined) el.textContent = o2.text;
	for (const [k, v] of Object.entries(o2.attr ?? {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
	this.appendChild(el);
	return el;
};
Element.prototype.createDiv = function (o) { return this.createEl('div', o); };
Element.prototype.createSpan = function (o) { return this.createEl('span', o); };
Element.prototype.addClass = function (...c) { this.classList.add(...c); };
Element.prototype.removeClass = function (...c) { this.classList.remove(...c); };
Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
Element.prototype.hasClass = function (c) { return this.classList.contains(c); };
Element.prototype.empty = function () { this.textContent = ''; };
Element.prototype.setText = function (t) { this.textContent = t; };
Element.prototype.getText = function () { return this.textContent ?? ''; };
Element.prototype.appendText = function (t) { this.appendChild(document.createTextNode(t)); };
Element.prototype.toggle = function (show) { this.style.display = show ? '' : 'none'; };
`;

function bundle(): string {
	const out = buildSync({
		stdin: {
			contents: `export { field } from './src/obsidian/calendar-parts'; export { holdLayoutOnPress } from './src/render/dom/press-hold';`,
			resolveDir: root,
			loader: 'ts',
		},
		alias: { obsidian: './tests/support/obsidian-browser-stub.ts' },
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'P',
		target: 'es2020',
		logLevel: 'silent',
	});
	return out.outputFiles[0].text;
}

let browser: Browser;
let page: Page;
let script = '';
beforeAll(async () => {
	if (!CHROME) return;
	script = bundle();
	browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
	page = await browser.newPage();
});
afterAll(async () => {
	await browser?.close();
});

type Kind = 'row' | 'focus';

/**
 * Builds the window part: `row` is the start of a cycle calendar (Cycle, Year and "Same year as" in one row, each help in the box under the row), `focus` is a field whose
 * help shows while it has the focus (Formats). Under it stands the link. `hold` starts the press hold of the window, as every plugin window does.
 */
async function build(kind: Kind, hold: boolean, touch: boolean): Promise<void> {
	await page.setViewport({ width: 390, height: 800, hasTouch: touch, isMobile: touch });
	await page.setContent(`<!doctype html><html><head><style>${VARS}</style><style>${css}</style></head><body class="theme-light"><div class="modal dynasty-sheet dynasty-calendars" id="modal" style="position:relative;width:390px;padding:16px"><div id="mount"></div></div><script>${SHIM}${script}</script></body></html>`);
	await page.evaluate(
		(kind: Kind, hold: boolean) => {
			const P = (window as unknown as { P: { field: (...a: unknown[]) => HTMLElement; holdLayoutOnPress: (el: HTMLElement) => void } }).P;
			const modal = document.getElementById('modal')!;
			const mount = document.getElementById('mount')!;
			const host = { checked: () => ({ refusals: [] }), changed: () => undefined, register: () => undefined, reader: () => null, attempted: () => false, removeCalendar: () => undefined, addList: () => undefined, removeList: () => undefined };
			const help = 'Write the same year in another calendar, or as a plain year, for example 867. This help has two text lines in a narrow window.';
			if (kind === 'row') {
				const box = mount.createDiv({ cls: 'dynasty-cal-start' });
				const row = box.createDiv({ cls: ['dynasty-cal-start-row', 'has-cycle'] });
				const under = box.createDiv({ cls: 'dynasty-cal-under' });
				P.field(row, host, 'x-same', 'Same year as', '', () => undefined, { wide: true, hint: help, errorIn: under, hintIn: under });
			} else {
				P.field(mount, host, 'x-formats', 'Formats', '', () => undefined, { area: true, wide: true, hint: help });
			}
			const link = mount.createEl('button', { cls: ['dynasty-link', 'dynasty-cal-add-link'], text: 'Add name list', attr: { id: 'link', type: 'button' } });
			(window as unknown as { clicks: number }).clicks = 0;
			link.addEventListener('click', () => ((window as unknown as { clicks: number }).clicks += 1));
			if (hold) P.holdLayoutOnPress(modal);
		},
		kind,
		hold,
	);
}

/** Focuses the field and types in it, then presses the link with a real mouse or a real touch at the place where the user sees it. The clicks the link got, and how far it moved. */
async function pressLink(touch: boolean): Promise<{ clicks: number; moved: number }> {
	const input = await page.$('input, textarea');
	await input!.click();
	await page.keyboard.type('1203');
	const before = await page.evaluate(() => document.getElementById('link')!.getBoundingClientRect().top);
	const box = (await (await page.$('#link'))!.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	if (touch) await page.touchscreen.tap(x, y);
	else await page.mouse.click(x, y, { delay: 80 });
	await new Promise((r) => setTimeout(r, 700));
	return page.evaluate((top: number) => ({ clicks: (window as unknown as { clicks: number }).clicks, moved: Math.abs(document.getElementById('link')!.getBoundingClientRect().top - top) }), before);
}

describe.skipIf(!CHROME)('D342: a press on a link right below a field with a help line is never lost', () => {
	for (const kind of ['row', 'focus'] as const) {
		for (const touch of [false, true]) {
			const what = `${kind === 'row' ? 'the help under a row of fields (Same year as)' : 'the help that shows while its field has the focus (Formats)'}, ${touch ? 'touch' : 'mouse'}`;
			it(`${what}: the link gets the click, and the help hides after the press`, async () => {
				await build(kind, true, touch);
				const r = await pressLink(touch);
				expect(r.clicks, JSON.stringify(r)).toBe(1);
				// The help hid after the press, so the link moved up only then.
				expect(r.moved, JSON.stringify(r)).toBeGreaterThan(10);
			});
		}
		it(`control, ${kind === 'row' ? 'help under a row' : 'help on focus'}: with no press hold the same press is lost (the fault of the walk)`, async () => {
			await build(kind, false, false);
			const r = await pressLink(false);
			expect(r.clicks, JSON.stringify(r)).toBe(0);
		});
	}
});
