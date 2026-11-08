// The browser half of the saved-picture font tests (D334). A test bundles this file with esbuild (`bundlePictureFontPage` in picture-font-bundle.ts) and
// runs it in a real Chromium. It calls the real `makePicture` of the plugin (layout, text measure on a canvas, the font read, the SVG, the PNG on a canvas).
// A snippet font is installed as a CSS snippet would: an @font-face rule in a style element, with the file as a data URI or as a blob URL.
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { fontsForPng, pageFontEnv } from '../../src/obsidian/save-font';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { withoutPageFonts } from '../../src/render/fonts';

// The plugin's `measureText` and `pngOf` call Obsidian's global `createEl`.
(globalThis as unknown as { createEl: (tag: string) => HTMLElement }).createEl = (tag) => document.createElement(tag);

/** The SVG text that the plugin drew on the canvas (with the embedded font rules), caught when it made its blob. */
let lastSvg = '';
const realCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob | MediaSource): string => {
	if (blob instanceof Blob && blob.type === 'image/svg+xml') void blob.text().then((t) => (lastSvg = t));
	return realCreate(blob);
};

const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

interface Installed {
	style: HTMLStyleElement;
	url?: string;
}
const installed = new Map<string, Installed>();

/** Installs a font like a snippet: `via` 'data' puts the file in the rule, 'blob' makes a blob URL. Waits until the page has loaded it. */
async function installFont(family: string, b64: string, via: 'data' | 'blob'): Promise<void> {
	let url: string | undefined;
	let source: string;
	if (via === 'blob') {
		url = URL.createObjectURL(new Blob([b64ToBytes(b64) as BlobPart], { type: 'font/ttf' }));
		source = `url(${url}) format("truetype")`;
	} else {
		source = `url(data:font/ttf;base64,${b64}) format("truetype")`;
	}
	const style = document.createElement('style');
	style.textContent = `@font-face { font-family: "${family}"; src: ${source}; font-weight: 100 900; font-style: normal; }`;
	document.head.append(style);
	installed.set(family, { style, ...(url ? { url } : {}) });
	await document.fonts.load(`16px "${family}"`);
	await document.fonts.load(`600 16px "${family}"`);
}

/** Takes the font away from the file side only: the page keeps the loaded face, but its file can no longer be read. */
function breakFile(family: string): void {
	const i = installed.get(family);
	if (i?.url) URL.revokeObjectURL(i.url);
}

function sourceOf(text: string, note: string, list: string): SaveSource {
	const parsed = parseDynasty(text);
	if (!parsed.ok) throw new Error('the sample does not parse');
	return {
		g: deriveFamilies(parsed.tree),
		orientation: 'down',
		geo: cardForm(geometryFor(16), 'down'),
		relationLine: false,
		fonts: { text: list, ui: list, bold: '600' },
		showDates: true,
		showPortraits: false,
		sourcePath: 'Preview.md',
		note,
	};
}

export interface Probe {
	pngB64: string;
	pngBytes: number;
	svgBytes: number;
	/** The SVG that the canvas drew holds an @font-face rule. */
	embedded: boolean;
	/** The families the SVG names on its first text. */
	family: string;
	cardTexts: number;
	/** Card texts that run past their card when set in the font list that the SVG names (the font the canvas draws). */
	over: number;
	worst: string;
	/** Which font the PNG shows for the heading: 'page', 'standard' or 'unknown'. */
	drew: string;
	ms: number;
}

/** The ink width of the heading in the PNG, in layout px, by the dark pixels right of the heading's start. */
async function headingInk(svg: Document, pngB64: string): Promise<number> {
	const h = svg.querySelector('text[data-item="heading"]');
	if (!h) return 0;
	const vb = (svg.documentElement.getAttribute('viewBox') ?? '0 0 1 1').split(/\s+/).map(Number);
	const size = Number(h.getAttribute('font-size'));
	const hx = Number(h.getAttribute('x'));
	const hy = Number(h.getAttribute('y'));
	const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${pngB64}`)).blob());
	const k = bmp.width / vb[2];
	const c = document.createElement('canvas');
	c.width = bmp.width;
	c.height = bmp.height;
	const cx = c.getContext('2d', { willReadFrequently: true })!;
	cx.drawImage(bmp, 0, 0);
	const y0 = Math.max(0, Math.floor((hy - size * 0.9) * k));
	const y1 = Math.min(c.height, Math.ceil((hy + size * 0.3) * k));
	const x0 = Math.max(0, Math.floor((hx - 4) * k));
	const px = cx.getImageData(0, y0, c.width, Math.max(1, y1 - y0));
	let right = x0;
	for (let y = 0; y < px.height; y++) {
		for (let x = x0; x < px.width; x++) {
			const i = (y * px.width + x) * 4;
			if (px.data[i] + px.data[i + 1] + px.data[i + 2] < 3 * 128 && x > right) right = x;
		}
	}
	return (right - hx * k) / k;
}

/** Reads the drawn SVG: texts past their card, and which font the PNG shows. `snippet` is the family name that only the page loaded. */
async function facts(svgText: string, pngB64: string, snippet: string, std: string, measureAs: string): Promise<Pick<Probe, 'cardTexts' | 'over' | 'worst' | 'drew'>> {
	const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
	const ctx = document.createElement('canvas').getContext('2d')!;
	const familyOf = (el: Element): string => {
		for (let e: Element | null = el; e; e = e.parentElement) {
			const f = e.getAttribute('font-family');
			if (f) return f;
		}
		return '';
	};
	const width = (t: Element, list: string) => {
		ctx.font = `${t.getAttribute('font-style') === 'italic' ? 'italic ' : ''}${t.getAttribute('font-weight') ?? '400'} ${t.getAttribute('font-size')}px ${list}`;
		return ctx.measureText(t.textContent ?? '').width;
	};
	let cardTexts = 0;
	let over = 0;
	let worstPx = 0;
	let worst = '';
	for (const g of Array.from(doc.querySelectorAll('g[data-item^="card:"]'))) {
		const rect = g.querySelector('rect');
		if (!rect) continue;
		const rx = Number(rect.getAttribute('x'));
		const rw = Number(rect.getAttribute('width'));
		for (const t of Array.from(g.querySelectorAll('text'))) {
			if (!t.textContent || !t.getAttribute('font-size')) continue;
			const w = width(t, measureAs || familyOf(t));
			const x = Number(t.getAttribute('x'));
			const anchor = t.getAttribute('text-anchor') ?? 'start';
			const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
			const out = Math.max(0, rx - left, left + w - (rx + rw));
			cardTexts++;
			if (out > 0.5) {
				over++;
				if (out > worstPx) {
					worstPx = out;
					worst = `"${t.textContent}" is ${Math.round(w)} px wide in a card ${Math.round(rw)} px wide`;
				}
			}
		}
	}
	let drew = 'unknown';
	const h = doc.querySelector('text[data-item="heading"]');
	if (h && snippet && pngB64) {
		// The heading is set in the interface list of the page, as the page shows it, and in that list without the page font.
		const wPage = width(h, `"${snippet}", ${std}`);
		const wStd = width(h, std);
		const ink = await headingInk(doc, pngB64);
		const dP = Math.abs(ink - wPage);
		const dS = Math.abs(ink - wStd);
		drew = Math.abs(dP - dS) < 1 ? 'unknown' : dP < dS ? 'page' : 'standard';
	}
	return { cardTexts, over, worst, drew };
}

const toB64 = (buf: ArrayBuffer): string => {
	const bytes = new Uint8Array(buf);
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
};

/** One save of `text` as `kind` with the text and interface fonts set to `"family", std`. `measureAs` sets every card text in that list to count the texts past their card. */
async function save(text: string, note: string, family: string, std: string, kind: 'png' | 'svg', cold: boolean, measureAs = ''): Promise<Probe> {
	if (cold) clearMeasureCache();
	lastSvg = '';
	const t0 = performance.now();
	const made = await makePicture(undefined, sourceOf(text, note, family ? `"${family}", ${std}` : std), kind);
	const ms = performance.now() - t0;
	const svg = kind === 'svg' ? new TextDecoder().decode(made.bytes) : await settledSvg();
	const pngB64 = kind === 'png' ? toB64(made.bytes) : '';
	const f = kind === 'png' ? await facts(svg, pngB64, family, std, measureAs) : await facts(svg, '', family, std, measureAs);
	const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
	return { pngB64, pngBytes: kind === 'png' ? made.bytes.byteLength : 0, svgBytes: svg.length, embedded: /@font-face/.test(svg), family: root.getAttribute('font-family') ?? '', ms, ...f };
}

async function settledSvg(): Promise<string> {
	// `blob.text()` finishes a moment after the PNG is made.
	for (let i = 0; i < 50 && lastSvg === ''; i++) await new Promise((r) => setTimeout(r, 10));
	return lastSvg;
}

/** The time of the font read alone, as the median of `reps` runs. */
async function fontReadMs(family: string, std: string, reps: number): Promise<{ ms: number; css: number }> {
	const times: number[] = [];
	let css = 0;
	for (let i = 0; i < reps; i++) {
		const t0 = performance.now();
		const r = await fontsForPng({ text: `"${family}", ${std}`, ui: `"${family}", ${std}`, bold: '600' }, pageFontEnv());
		times.push(performance.now() - t0);
		css = r.css.length;
	}
	return { ms: [...times].sort((a, b) => a - b)[Math.floor(reps / 2)]!, css };
}

const api = { installFont, breakFile, save, fontReadMs, withoutPageFonts: (list: string, gone: string[]) => withoutPageFonts(list, new Set(gone)) };
(globalThis as unknown as { pf: typeof api }).pf = api;
