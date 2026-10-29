import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Window review of the narrow-window repairs (D316): the real styles.css in a real Chrome, with hand-built DOM of the same shape as the plugin's.
// Obsidian's own styles are not here (only the variables the plugin reads), so these tests check the plugin's rules, not a theme.
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const root = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(root + 'styles.css', 'utf8');

const VARS = `:root,body{--font-ui-small:13px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:20px;--size-4-1:4px;--size-4-2:8px;--size-4-3:12px;--size-4-4:16px;--size-4-6:24px;--icon-m:18px;--input-height:30px;--radius-s:4px;--radius-m:8px;--font-semibold:600;--font-normal:400;--background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#ccc;--text-normal:#222;--text-muted:#666;--text-warning:#a60;--interactive-normal:#eee;--background-modifier-form-field:#fff;--font-interface:var(--g2-font,Arial),sans-serif;--font-text:Georgia,serif;--layer-modal:50;}
*{box-sizing:border-box} body{margin:0;font-family:var(--g2-font,Arial),sans-serif;font-size:13px}
.svg-icon{display:inline-block}`;
const ICON = '<svg class="svg-icon" viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="12" r="8"/></svg>';
const html = (stylesheet: string, body: string) => `<!doctype html><html><head><style>${VARS}</style><style>${stylesheet}</style></head><body class="theme-light is-mobile">${body}</body></html>`;

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

const calList = (phone: boolean) => `<div class="modal dynasty-sheet ${phone ? 'is-phone' : ''}" style="position:relative;width:${phone ? 390 : 700}px">
<div class="dynasty-cal-list">
 <div class="dynasty-grid ${phone ? 'is-stack' : ''}" id="top">
  <div class="dynasty-sheet-field"><label class="dynasty-sheet-label" id="l-name">Name of the list</label><input class="dynasty-sheet-input dynasty-input" id="f-name"></div>
  <div class="dynasty-sheet-field"><label class="dynasty-sheet-label" id="l-marker">Marker</label><input class="dynasty-sheet-input dynasty-input" id="f-marker"></div>
 </div>
 <div class="dynasty-sheet-field is-wide"><label class="dynasty-sheet-label">Names</label><textarea class="dynasty-sheet-input dynasty-input" id="f-names"></textarea></div>
 <div class="dynasty-grid ${phone ? 'is-stack' : ''}" id="bottom">
  <div class="dynasty-sheet-field"><label class="dynasty-sheet-label" id="l-show">Show on cards</label><div class="dynasty-select"><select class="dropdown dynasty-sheet-input dynasty-input" id="f-show"><option>Short</option></select></div></div>
 </div>
 <button class="dynasty-link dynasty-cal-remove-list" id="remove">Remove this list</button>
</div></div>`;

const listBoxes = async (phone: boolean, touch: boolean) => {
	await page.setViewport({ width: phone ? 390 : 820, height: 900, hasTouch: touch, isMobile: touch });
	await page.setContent(html(css, calList(phone)));
	return page.evaluate(() => {
		const r = (id: string) => document.getElementById(id)!.getBoundingClientRect();
		const rm = r('remove');
		const show = r('f-show');
		const names = r('f-names');
		return {
			coarse: matchMedia('(pointer: coarse)').matches,
			removeH: rm.height,
			removeLeft: rm.left,
			fieldLeft: names.left,
			belowShow: rm.top - show.bottom,
			labelName: r('l-name').height,
			labelShow: r('l-show').height,
			labelMarker: r('l-marker').height,
			overlap: Math.min(rm.bottom, show.bottom) > Math.max(rm.top, show.top),
		};
	});
};

describe.skipIf(!CHROME)('Calendars window: "Remove this list" at the end of the list (0.5.1)', () => {
	// A touch a few px under the top edge of Marker once removed the list. The link now stands under the last field, so no field has a link next to it.
	for (const [name, phone, touch] of [['computer, mouse', false, false], ['tablet, touch', false, true], ['phone layout', true, true]] as const) {
		it(`${name}: the link is under the last field, at the left edge of the fields, with no empty space and no raised label`, async () => {
			const f = await listBoxes(phone, touch);
			expect(f.overlap, JSON.stringify(f)).toBe(false);
			expect(f.belowShow, JSON.stringify(f)).toBeGreaterThanOrEqual(0);
			// No large empty space: the link starts within 24 px of the bottom of the last field.
			expect(f.belowShow, JSON.stringify(f)).toBeLessThanOrEqual(24);
			expect(Math.abs(f.removeLeft - f.fieldLeft), JSON.stringify(f)).toBeLessThan(1);
			// Every label is one text line high (no raised label line).
			for (const h of [f.labelName, f.labelMarker, f.labelShow]) expect(h, JSON.stringify(f)).toBeLessThan(25);
			if (touch || phone) expect(f.removeH, JSON.stringify(f)).toBeGreaterThanOrEqual(43.5);
			else expect(f.removeH, JSON.stringify(f)).toBeLessThan(40);
		});
	}
});

describe.skipIf(!CHROME)('a box with several text lines keeps a modest corner radius in a theme with round fields', () => {
	it('a textarea has at most 12 px; a single-line field keeps the radius of the theme', async () => {
		await page.setViewport({ width: 900, height: 900 });
		await page.setContent(html(`:root,body{--input-radius:40px}${css}`, calList(false)));
		const r = await page.evaluate(() => {
			const radius = (id: string) => parseFloat(getComputedStyle(document.getElementById(id)!).borderTopLeftRadius);
			return { names: radius('f-names'), name: radius('f-name') };
		});
		expect(r.names, JSON.stringify(r)).toBeLessThanOrEqual(12);
		expect(r.name, JSON.stringify(r)).toBeGreaterThan(12);
	});

	it('a theme with a small radius is not made larger', async () => {
		await page.setContent(html(`:root,body{--input-radius:4px}${css}`, calList(false)));
		const names = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('f-names')!).borderTopLeftRadius));
		expect(names).toBe(4);
	});
});

const personHead = (phone: boolean) => `<div class="modal dynasty-sheet ${phone ? 'is-phone' : ''}" style="position:relative;width:${phone ? 390 : 760}px">
<div class="dynasty-sheet-content"><div class="dynasty-sheet-body" style="padding:8px 24px">
 <div class="dynasty-head dynasty-person-head"><div class="dynasty-head-text"><div class="dynasty-head-name"><span id="name">Wren Calder</span></div><div class="dynasty-head-meta" id="meta">1120</div></div></div>
 <div class="dynasty-openall" id="row"><button class="dynasty-link dynasty-add-portrait" id="add" type="button">Add portrait or arms</button><button class="dynasty-openall-button" id="all" type="button">Open all</button></div>
 <div class="dynasty-section"><button class="dynasty-section-head" id="details" type="button">Details</button></div>
</div></div></div>`;

describe.skipIf(!CHROME)('person window: the name, "Add portrait or arms" and "Details" start at one left edge', () => {
	for (const [name, phone, touch] of [['computer', false, false], ['tablet, touch', false, true], ['phone layout', true, true]] as const) {
		it(`${name}: the text of the link starts at the left edge of the name, and "Open all" ends at the right edge of the row`, async () => {
			await page.setViewport({ width: phone ? 390 : 820, height: 900, hasTouch: touch, isMobile: touch });
			await page.setContent(html(css, personHead(phone)));
			const f = await page.evaluate(() => {
				const box = (id: string) => document.getElementById(id)!.getBoundingClientRect();
				const pad = (id: string, side: 'Left' | 'Right') => parseFloat(getComputedStyle(document.getElementById(id)!)[`padding${side}`]);
				const body = document.querySelector('.dynasty-sheet-body')!.getBoundingClientRect();
				return {
					name: box('name').left,
					meta: box('meta').left,
					linkText: box('add').left + pad('add', 'Left'),
					allTextEnd: box('all').right - pad('all', 'Right'),
					bodyRight: body.right - 24,
				};
			});
			expect(Math.abs(f.linkText - f.name), JSON.stringify(f)).toBeLessThan(0.75);
			expect(Math.abs(f.linkText - f.meta), JSON.stringify(f)).toBeLessThan(0.75);
			expect(Math.abs(f.allTextEnd - f.bodyRight), JSON.stringify(f)).toBeLessThan(0.75);
		});
	}
});

// The phone list: the large row and the marked row reach the edge of the block (margin -8px), and the block clips what lies outside it.
const flashList = (cls: string) => `<div id="block" style="width:390px;overflow:hidden;padding:0">
<div class="dynasty-viewport dynasty-list-viewport"><div class="dynasty-list-section" data-section="person" style="padding-left:8px;padding-right:8px">
 <div class="dynasty-list-row ${cls} dynasty-list-flash" id="row" data-person="a"><span>Roderick Valmont</span></div>
</div></div></div>`;

describe.skipIf(!CHROME)('phone list: the outline of a saved row lies inside the visible box of the block, on all four sides', () => {
	for (const [name, cls] of [['the large row', 'dynasty-list-hero'], ['the marked row', 'dynasty-list-me'], ['a plain row', '']] as const) {
		for (const theme of ['light', 'dark']) {
			it(`${name}, ${theme} theme`, async () => {
				await page.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true });
				const stylesheet = `:root,body{--interactive-accent:#a22}${css}`;
				await page.setContent(html(stylesheet, flashList(cls)).replace('theme-light', `theme-${theme}`));
				const f = await page.evaluate(() => {
					const row = document.getElementById('row')!;
					const cs = getComputedStyle(row);
					const w = parseFloat(cs.outlineWidth);
					const o = parseFloat(cs.outlineOffset);
					const b = row.getBoundingClientRect();
					const block = document.getElementById('block')!.getBoundingClientRect();
					const grow = w + o;
					return { style: cs.outlineStyle, left: b.left - grow - block.left, right: block.right - (b.right + grow), top: b.top - grow - block.top, w, o };
				});
				expect(f.style, JSON.stringify(f)).toBe('solid');
				expect(f.w, JSON.stringify(f)).toBeGreaterThan(0);
				for (const side of ['left', 'right', 'top'] as const) expect(f[side], `${side} ${JSON.stringify(f)}`).toBeGreaterThanOrEqual(-0.01);
			});
		}
	}
});

// ---------- the wrapped bar ----------
const btn = (cls: string, inner = ICON) => `<button class="clickable-icon dynasty-tool ${cls}" type="button" aria-label="${cls}"><span class="dynasty-tool-icon">${inner}</span></button>`;
const word = (cls: string, w: string) => `<button class="clickable-icon dynasty-tool ${cls}" type="button"><span class="dynasty-tool-icon">${ICON}</span><span class="dynasty-tool-text">${w}</span></button>`;
const sep = '<span class="dynasty-sep" aria-hidden="true"></span>';
const grow = '<span class="dynasty-grow" aria-hidden="true"></span>';
const badge = `<button class="clickable-icon dynasty-tool dynasty-warning-badge" type="button"><span class="dynasty-tool-icon">${ICON}</span><span class="dynasty-warning-count">3</span></button>`;
const VARIANTS: Record<string, string> = {
	editable: [word('dynasty-add-person dynasty-tool-main', 'Add person'), btn('dynasty-find'), btn('dynasty-focus'), btn('dynasty-fit'), sep, btn('dynasty-houses-button'), btn('dynasty-titles-button'), sep, btn('dynasty-more'), grow, badge, btn('dynasty-close')].join(''),
	'read-only': ['<span class="dynasty-read-only-label">Read only</span>', word('dynasty-open-source', 'Open source'), btn('dynasty-find'), btn('dynasty-focus'), btn('dynasty-fit'), sep, btn('dynasty-more'), grow, badge, btn('dynasty-close')].join(''),
};
const barPage = (inner: string) =>
	`<div class="modal-container dynasty-fullscreen-container"><div class="modal dynasty-fullscreen is-phone"><div class="modal-content dynasty-fullscreen-content"><div class="dynasty-fullscreen-tree"><div class="dynasty-root dynasty-full"><div class="dynasty-viewport"><div class="dynasty-toolbar has-wide-set" id="bar">${inner}</div></div></div></div></div></div></div>`;

const popover = '<div class="dynasty-popover" id="pop">Problems</div>';
const barAndList = (inner: string) => barPage(inner).replace('</div></div></div></div></div></div>', `${popover}</div></div></div></div></div></div>`);

describe.skipIf(!CHROME)('the problem list keeps clear of the bar, one row or two, in any interface font', () => {
	// The reserve is the real height of the bar (`--dynasty-bar-h`, set by `watchBar` where the bar changes size), not a width limit that fits one font.
	for (const font of ['Arial', 'Verdana']) {
		for (const w of [320, 420, 470, 490, 496, 520, 600]) {
			it(`${font} at ${w} px`, async () => {
				for (const inner of Object.values(VARIANTS)) {
					await page.setViewport({ width: w, height: 800 });
					await page.setContent(html(css, barAndList(inner)).replace('<body ', `<body style="--g2-font:${font}" `));
					const f = await page.evaluate(() => {
						const bar = document.getElementById('bar')!;
						document.querySelector<HTMLElement>('.dynasty-viewport')!.style.setProperty('--dynasty-bar-h', `${bar.offsetHeight}px`);
						return { barTop: bar.getBoundingClientRect().top, popBottom: document.getElementById('pop')!.getBoundingClientRect().bottom, rows: Math.round(bar.offsetHeight / 44) };
					});
					expect(f.popBottom, JSON.stringify(f)).toBeLessThanOrEqual(f.barTop);
					// And not far above it: the gap is the 8 px margin, so a one-row bar does not waste a row.
					expect(f.barTop - f.popBottom, JSON.stringify(f)).toBeLessThanOrEqual(12);
				}
			});
		}
	}
});

describe.skipIf(!CHROME)('rows and Close of the wrapped bar', () => {
	for (const w of [280, 320, 375, 414, 440, 470]) {
		for (const [name, inner] of Object.entries(VARIANTS)) {
			it(`${name} at ${w} px: two rows at most, Close at the right end of the last row, nothing lies over another button`, async () => {
				await page.setViewport({ width: w, height: 800 });
				await page.setContent(html(css, barPage(inner)));
				const f = await page.evaluate(() => {
					const bar = document.getElementById('bar')!;
					const b = bar.getBoundingClientRect();
					const kids = Array.from(bar.children).filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0) as HTMLElement[];
					const r = kids.map((e) => ({ c: e.className.replace('clickable-icon dynasty-tool ', ''), ...e.getBoundingClientRect().toJSON() }));
					const close = r.find((x) => x.c.includes('dynasty-close'))!;
					const overlaps: string[] = [];
					for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
						const a = r[i], c = r[j];
						if (a.c.includes('grow') || c.c.includes('grow')) continue;
						const ox = Math.min(a.right, c.right) - Math.max(a.left, c.left);
						const oy = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
						if (ox > 1 && oy > 1) overlaps.push(a.c + '/' + c.c);
					}
					return { rows: Math.round(b.height / 44), barH: b.height, closeRight: Math.round(b.right - close.right), closeBottom: Math.round(b.bottom - close.bottom), winBottom: Math.round(innerHeight - b.bottom), overlaps, scrollW: bar.scrollWidth, clientW: bar.clientWidth };
				});
				expect(f.overlaps, JSON.stringify(f)).toEqual([]);
				expect(f.rows, JSON.stringify(f)).toBeLessThanOrEqual(2);
				expect(f.closeRight, JSON.stringify(f)).toBeLessThanOrEqual(10);
				expect(f.scrollW, JSON.stringify(f)).toBeLessThanOrEqual(f.clientW);
			});
		}
	}
});
