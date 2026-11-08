import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// A browser closes slowly when several test files start browsers at once; the default 10 s hook limit then fails the file with no failed test.
vi.setConfig({ hookTimeout: 60_000 });

/*
 * 0.5.2: the warning triangle of the phone list in a note opens a small pop-up under the bar: one text line and one button "Show in full screen". The real `Popover` and
 * `drawProblemsPopup` (bundled with esbuild) and the real styles.css in a real Chrome at 390 x 844 with a touch screen, with DOM of the same shape as the plugin's. The
 * block sits in the box that Live Preview makes for a code block (`.cm-embed-block`, `contain: paint` as in Obsidian's own styles), which cuts everything at its edge: a pop-up in a
 * box of a 1-person tree must still show whole. The scroll of the note for a low bar is a stand-in here (the real one, `bringBarUp`, is tested with the fake DOM in
 * problem-panel-open-close.test.ts). Made-up names only.
 */

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:20px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-6:24px;--icon-m:18px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--background-primary:#fff;--modal-background:#fff;--background-modifier-border:#ccc;--background-modifier-cover:rgba(0,0,0,.3);--text-normal:#222;--text-muted:#666;--font-interface:Arial,sans-serif;--font-text:Georgia,serif;--shadow-s:0 1px 4px rgba(0,0,0,.3);--shadow-l:0 4px 16px rgba(0,0,0,.4);}
*{box-sizing:border-box} body{margin:0;font-family:Arial,sans-serif;font-size:16px}
.svg-icon{display:inline-block;width:18px;height:18px}`;

/** The Obsidian element helpers that the two bundled modules use, and the two properties `host.win` and `host.doc`. */
const SHIM = `
const toList = (c) => (c === undefined ? [] : Array.isArray(c) ? c : String(c).split(' '));
Object.defineProperty(Element.prototype, 'win', { get() { return this.ownerDocument.defaultView; } });
Object.defineProperty(Element.prototype, 'doc', { get() { return this.ownerDocument; } });
Element.prototype.createEl = function (tag, o = {}) {
	const o2 = typeof o === 'string' ? { cls: o } : o;
	const el = document.createElement(tag);
	for (const c of toList(o2.cls)) el.classList.add(c);
	if (o2.text !== undefined) el.textContent = o2.text;
	for (const [k, v] of Object.entries(o2.attr ?? {})) el.setAttribute(k, String(v));
	this.appendChild(el);
	return el;
};
Element.prototype.createDiv = function (o) { return this.createEl('div', o); };
Element.prototype.createSpan = function (o) { return this.createEl('span', o); };
Element.prototype.addClass = function (c) { this.classList.add(c); };
Element.prototype.removeClass = function (c) { this.classList.remove(c); };
Element.prototype.toggleClass = function (c, on) { this.classList.toggle(c, on); };
`;

function bundle(): string {
	const out = buildSync({
		stdin: {
			contents: `export { Popover } from './src/render/dom/widgets'; export { drawProblemsPopup } from './src/obsidian/problems-list';`,
			resolveDir: root,
			loader: 'ts',
		},
		bundle: true,
		write: false,
		format: 'iife',
		globalName: 'W',
		target: 'es2020',
		logLevel: 'silent',
	});
	return out.outputFiles[0].text;
}

/**
 * The note: a header over the scroll area, text before the list, the block of Live Preview (cut at its edge, as Obsidian's `.cm-content > [contenteditable=false]` rule does)
 * with the list (a 48 px bar and `people` rows of 60 px), and text after it.
 */
const note = (before: number, navbar: boolean, people: number, cut: boolean) => `
<div class="workspace-leaf-content">
 <div class="view-header" style="position:fixed;top:0;left:0;right:0;height:56px;background:#eee;z-index:10">header</div>
 <div id="scroller" class="markdown-source-view mod-cm6" style="position:absolute;inset:0;overflow:auto;padding:56px 24px 0">
  <p style="height:${before}px;margin:0">A test tree with made-up problems.</p>
  <div class="cm-content"><div class="cm-embed-block" id="embed" contenteditable="false" style="${cut ? 'contain:paint' : ''}">
   <div class="dynasty-root dynasty-list-root">
    <div class="dynasty-viewport dynasty-list-viewport" id="host">
     <div class="dynasty-toolbar" id="bar"><button class="clickable-icon dynasty-tool dynasty-warning-badge" id="badge" type="button">!</button></div>
     <div class="dynasty-list">${Array.from({ length: people }, () => '<div style="height:60px">a row</div>').join('')}</div>
    </div>
   </div>
  </div></div>
  <p style="height:1400px;margin:0">The rest of the note.</p>
 </div>
 ${navbar ? '<div class="mobile-navbar" style="position:fixed;left:0;right:0;bottom:0;height:64px;background:#ddd;z-index:20"></div>' : ''}
</div>`;

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

interface Opened {
	cls: string[];
	hasGrip: boolean;
	hasCover: boolean;
	top: number;
	barBottom: number;
	right: number;
	hostRight: number;
	width: number;
	bottom: number;
	embedBottom: number;
	hostHeight: number;
	/** What Chrome finds at a point near the foot of the pop-up: the pop-up itself when nothing cuts it. */
	footSeen: boolean;
	line: string;
	lineWeight: string;
	lineSize: string;
	hasMark: boolean;
	button: { text: string; cls: string[]; height: number; width: number; contentWidth: number; border: string; radius: string; weight: string; size: string; shadow: string; tag: string };
	buttons: number;
	scrollTop: number;
	foot: number;
	boxAfterClose: { height: number; marked: boolean; need: string };
}

interface OpenOptions {
	navbar?: boolean;
	width?: number;
	/** False: the box of the block does not cut (Reading view). */
	cut?: boolean;
	/** False: the minimum height of the box is taken away again, to prove the cause of the cut. */
	fix?: boolean;
}

/** Opens the pop-up for `count` problems in a list of `people` rows with the note scrolled so that the bar stands `barAt` px from the top of the screen. */
async function openPopup(count: number, people: number, barAt = 290, opts: OpenOptions = {}): Promise<Opened> {
	const { navbar = false, width = 390, cut = true, fix = true } = opts;
	await page.setViewport({ width, height: 844, hasTouch: true, isMobile: true });
	await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${VARS}</style><style>${css}</style></head><body class="theme-light is-mobile is-phone">${note(barAt - 56, navbar, people, cut)}</body></html>`);
	await page.addScriptTag({ content: SHIM + script });
	return page.evaluate(
		(count, fix) => {
			const w = window as unknown as { W: { Popover: new (h: HTMLElement) => { open: (...a: unknown[]) => HTMLElement; close: (refocus?: boolean) => void }; drawProblemsPopup: (el: HTMLElement, s: unknown) => HTMLElement } };
			const host = document.getElementById('host')!;
			const bar = document.getElementById('bar')!;
			const badge = document.getElementById('badge')!;
			const scroller = document.getElementById('scroller')!;
			const pop = new w.W.Popover(host);
			const headerBottom = 56;
			const el = pop.open(
				'problems',
				(e: HTMLElement) => w.W.drawProblemsPopup(e, { count, icon: (i: HTMLElement) => i.createSpan({ cls: 'svg-icon' }), showFull: () => undefined }),
				badge,
				undefined,
				{
					panel: {
						anchor: () => bar.getBoundingClientRect(),
						bringUp: () => {
							scroller.scrollTop += bar.getBoundingClientRect().top - (headerBottom + 8);
						},
					},
				},
			);
			// The proof of the cause: without the minimum height of the box, the same pop-up is cut.
			if (!fix) {
				host.classList.remove('has-pop-panel');
				host.style.removeProperty('--dynasty-pop-need');
			}
			const r = el.getBoundingClientRect();
			const b = bar.getBoundingClientRect();
			const h = host.getBoundingClientRect();
			const line = el.querySelector('.dynasty-problems-summary') as HTMLElement;
			const btn = el.querySelector('button') as HTMLElement;
			const lineStyle = getComputedStyle(line);
			const bs = getComputedStyle(btn);
			const seen = document.elementFromPoint(r.left + r.width / 2, r.bottom - 3);
			const navbarEl = document.querySelector('.mobile-navbar');
			const out = {
				cls: Array.from(el.classList),
				hasGrip: !!el.querySelector('.dynasty-sheet-grip'),
				hasCover: !!document.querySelector('.dynasty-cover'),
				top: r.top,
				barBottom: b.bottom,
				right: r.right,
				hostRight: h.right,
				width: r.width,
				bottom: r.bottom,
				embedBottom: document.getElementById('embed')!.getBoundingClientRect().bottom,
				hostHeight: h.height,
				footSeen: !!seen?.closest('.dynasty-popover'),
				line: line.textContent ?? '',
				lineWeight: lineStyle.fontWeight,
				lineSize: lineStyle.fontSize,
				hasMark: !!line.querySelector('.dynasty-problems-mark'),
				button: {
					text: btn.textContent ?? '',
					cls: Array.from(btn.classList),
					height: btn.getBoundingClientRect().height,
					width: btn.getBoundingClientRect().width,
					contentWidth: r.width - 2 - 2 * parseFloat(getComputedStyle(el).paddingLeft),
					border: `${bs.borderTopWidth} ${bs.borderTopStyle}`,
					radius: bs.borderTopLeftRadius,
					weight: bs.fontWeight,
					size: bs.fontSize,
					shadow: bs.boxShadow,
					tag: btn.tagName,
				},
				buttons: el.querySelectorAll('button').length,
				scrollTop: scroller.scrollTop,
				foot: (navbarEl ? navbarEl.getBoundingClientRect().top : window.innerHeight) - 8,
				boxAfterClose: { height: 0, marked: false, need: '' },
			};
			// The box is as tall as the pop-up needs only while the pop-up is open.
			pop.close();
			out.boxAfterClose = { height: host.getBoundingClientRect().height, marked: host.classList.contains('has-pop-panel'), need: host.style.getPropertyValue('--dynasty-pop-need') };
			return out;
		},
		count,
		fix,
	);
}

describe.skipIf(!CHROME)('0.5.2: the small problem pop-up of the phone list in a note (Chrome, real styles.css, touch, 390 x 844)', () => {
	for (const count of [1, 3, 16]) {
		it(`${count} problem(s): 4 px under the bar, on the right edge of the list, 280 px wide, no sheet, no grip, no cover, no long list`, async () => {
			const f = await openPopup(count, 3);
			const info = JSON.stringify(f);
			expect(f.cls, info).toContain('is-panel');
			expect(f.cls, info).not.toContain('is-sheet');
			expect(f.hasGrip, info).toBe(false);
			expect(f.hasCover, info).toBe(false);
			expect(f.top - f.barBottom, info).toBeCloseTo(4, 0);
			expect(f.right, info).toBeCloseTo(f.hostRight, 0);
			expect(f.width, info).toBeLessThanOrEqual(280);
			expect(f.width, info).toBeCloseTo(280, 0);
			expect(f.buttons, info).toBe(1);
			expect(f.line, info).toBe(count === 1 ? 'This tree has 1 problem.' : `This tree has ${count} problems.`);
			expect(f.hasMark, info).toBe(true);
			// One size for every count: the pop-up never grows with the number of problems.
			expect(f.bottom - f.top, info).toBeLessThan(140);
		});
	}

	it('the text line is semibold and as large as a control; the button is a plain button of 44 px or more with the edge of every button and the pill of a phone', async () => {
		const f = await openPopup(3, 3);
		const info = JSON.stringify(f);
		expect(f.lineWeight, info).toBe('600');
		expect(f.lineSize, info).toBe('16px');
		expect(f.button.tag, info).toBe('BUTTON');
		expect(f.button.text, info).toBe('Show in full screen');
		expect(f.button.cls, info).toContain('dynasty-btn');
		expect(f.button.cls, info).not.toContain('mod-cta');
		expect(f.button.height, info).toBeGreaterThanOrEqual(44);
		expect(f.button.border, info).toBe('1px solid');
		expect(Number.parseFloat(f.button.radius), info).toBeGreaterThan(20);
		expect(f.button.weight, info).toBe('400');
		expect(f.button.size, info).toBe('16px');
		expect(f.button.shadow, info).toBe('none');
		expect(f.button.width, info).toBeCloseTo(f.button.contentWidth, 0);
	});

	it('its width is the width of the list when the list is narrower than 280 px, and 280 px when it is wider', async () => {
		// 280 px of screen less 2 x 24 px of the note: a list of 232 px.
		const narrow = await openPopup(1, 3, 290, { width: 280 });
		expect(narrow.width, JSON.stringify(narrow)).toBeCloseTo(232, 0);
		const wide = await openPopup(1, 3, 290, { width: 700 });
		expect(wide.width, JSON.stringify(wide)).toBeCloseTo(280, 0);
		expect(wide.right, JSON.stringify(wide)).toBeCloseTo(wide.hostRight, 0);
	});

	it('the cause of the cut: the box of a 1-person tree in Live Preview cuts the pop-up at its edge unless the box has a minimum height', async () => {
		const f = await openPopup(1, 1, 290, { fix: false });
		const info = JSON.stringify(f);
		expect(f.bottom, info).toBeGreaterThan(f.embedBottom);
		expect(f.footSeen, info).toBe(false);
	});

	for (const people of [1, 3]) {
		it(`a box of a tree of ${people} person(s): the pop-up shows whole, its foot inside the box that Live Preview cuts at, with 8 px to spare`, async () => {
			const f = await openPopup(1, people);
			const info = JSON.stringify(f);
			expect(f.bottom, info).toBeLessThanOrEqual(f.embedBottom - 8 + 1);
			expect(f.footSeen, info).toBe(true);
			// A box that is already tall enough is not made taller.
			if (people === 3) expect(f.hostHeight, info).toBeCloseTo(48 + 3 * 60, 0);
		});
	}

	it('the box grows only while the pop-up is open: it goes back to its own height when the pop-up closes', async () => {
		const f = await openPopup(1, 1);
		const info = JSON.stringify(f);
		expect(f.hostHeight, info).toBeGreaterThan(48 + 60);
		expect(f.boxAfterClose.height, info).toBeCloseTo(48 + 60, 0);
		expect(f.boxAfterClose.marked, info).toBe(false);
		expect(f.boxAfterClose.need, info).toBe('');
	});

	it('Reading view (no cut): the pop-up is whole too', async () => {
		const f = await openPopup(1, 1, 290, { cut: false });
		expect(f.footSeen, JSON.stringify(f)).toBe(true);
	});

	it('the floating bar of a theme (.mobile-navbar) lowers the foot of the screen; a bar that has room does not scroll the note', async () => {
		const f = await openPopup(1, 3, 290, { navbar: true });
		expect(f.scrollTop, JSON.stringify(f)).toBe(0);
		expect(f.bottom, JSON.stringify(f)).toBeLessThanOrEqual(f.foot);
	});

	it('a low bar: the note scrolls first so that the bar stands under the header, and the pop-up opens under the bar, never above it', async () => {
		const f = await openPopup(1, 3, 780);
		const info = JSON.stringify(f);
		expect(f.scrollTop, info).toBeGreaterThan(0);
		expect(f.top - f.barBottom, info).toBeCloseTo(4, 0);
		expect(f.footSeen, info).toBe(true);
	});

	it('a bar with room: the pop-up fits where it is, so the note does not scroll', async () => {
		const f = await openPopup(1, 3, 560);
		expect(f.scrollTop, JSON.stringify(f)).toBe(0);
	});

	it('the colours come from theme variables: the rules of the pop-up write no colour value', () => {
		const rule = css.match(/\.dynasty-popover\.is-panel \{[^}]*\}/)![0];
		expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
		const button = css.match(/\.dynasty-popover \.dynasty-btn\.dynasty-problems-full \{[^}]*\}/)![0];
		expect(button).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
	});
});
