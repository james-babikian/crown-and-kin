// Review D probe: renders the dumped DOM with Obsidian's app.css (APP_CSS) and styles.css (CSS, default ./styles.css)
// in Chrome at several window widths and prints where the controls of each row are.
// Run (from the repo root): R112D_DUMP=1 npx vitest run tests/r112-review-d-dump.test.ts
//   then: APP_CSS=<path to Obsidian app.css> node tests/r112-review-d-layout-probe.mjs houses-plain houses-pending titles-pending
// For the 1.1.1 look: CSS=<styles.css of c434e02> STRIP=1 (STRIP removes the "Change id" buttons).
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';
const D = process.env.R112D_OUT ?? 'out-review-d';
const APPCSS = readFileSync(process.env.APP_CSS, 'utf8');
const PLUGIN = readFileSync(process.env.CSS || 'styles.css', 'utf8');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const out = [];
const names = process.argv.slice(2);
for (const name of names) {
	let { html } = JSON.parse(readFileSync(`${D}/${name}.json`, 'utf8'));
	if (process.env.STRIP) html = html.replace(/<button class="dynasty-sheet-action dynasty-id-open"[^>]*>Change id<\/button>/g, '');
	for (const w of [320, 360, 375, 390, 600, 640, 700, 760, 900]) {
		const phone = w < 600;
		const page = await browser.newPage();
		await page.setViewport({ width: w, height: 760 });
		const page_html = `<!doctype html><html><head><meta charset="utf-8"><style>${APPCSS}</style><style>${PLUGIN}</style></head><body class="theme-light ${phone ? 'is-mobile is-phone' : ''}">${html}</body></html>`;
		await page.setContent(page_html);
		const res = await page.evaluate((phone, w) => {
			const modal = document.querySelector('.modal.dynasty-sheet');
			if (phone) { modal.classList.add('is-phone'); modal.style.setProperty('--dynasty-sheet-height', '760px'); } else modal.classList.remove('is-phone');
			const body = document.querySelector('.dynasty-sheet-body');
			const mr = modal.getBoundingClientRect();
			const rows = [...document.querySelectorAll('.dynasty-house-row, .dynasty-title-row')].map((row) => {
				const r = row.getBoundingClientRect();
				const kids = [...row.children].map((c) => { const b = c.getBoundingClientRect(); return { cls: (c.className || c.tagName).toString().split(' ').slice(0, 2).join('.'), x: Math.round(b.left), r: Math.round(b.right), y: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) }; });
				return { row: (row.getAttribute('data-house') || row.parentElement.getAttribute('data-title')), rowR: Math.round(r.right), rowL: Math.round(r.left), rowH: Math.round(r.height), kids };
			});
			return { winW: w, modalL: Math.round(mr.left), modalR: Math.round(mr.right), modalW: Math.round(mr.width), bodyClient: body?.clientWidth, bodyScroll: body?.scrollWidth, rows };
		}, phone, w);
		out.push({ name, ...res });
		await page.close();
	}
}
await browser.close();
writeFileSync(`${D}/measure-out.json`, JSON.stringify(out));
for (const o of out) {
	const bad = [];
	for (const r of o.rows) for (const k of r.kids) if (k.r > o.modalR + 1 || k.x < o.modalL - 1) bad.push(`${r.row}:${k.cls} ${k.x}-${k.r}`);
	console.log(o.name, 'win', o.winW, 'modalW', o.modalW, 'body client/scroll', o.bodyClient, o.bodyScroll, bad.length ? 'OUT: ' + bad.join(' | ') : '');
}
