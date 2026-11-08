/*
 * The font of a saved PNG (spec §13.8, D313, D334). A PNG is the saved SVG drawn on a canvas, and an image on a canvas cannot use a font that only the
 * page loaded (for example a CSS snippet's `@font-face`). So `fontsForPng` reads the files of those fonts and puts them into the SVG as data-URI
 * `@font-face` rules, and the PNG draws the font of the tree. A font that cannot be read, or that would bring the total over 2 MB, is left out: then the
 * cards are measured with the list that the canvas will really draw (`withoutPageFonts`), so no text runs past a card. A saved SVG is not touched: it
 * names the family only, as before. All font reads of one save share one deadline. Nothing here throws.
 */

import { familyNames, withoutPageFonts } from '../render/fonts';
import type { SceneFonts } from '../render/scene-model';

/** The most font data, in bytes, that one saved picture takes in. */
export const FONT_CAP_BYTES = 2 * 1024 * 1024;
/** All font reads of one save may take this long together, in ms; a family still unread then is left out. */
const READ_LIMIT_MS = 10_000;
/** A style sheet that imports others, or a rule group inside a rule group, is followed this deep. */
const NEST_LIMIT = 4;
const FONT_FACE_RULE = 5;

/** What the font read needs from the page: the loaded fonts, the style sheets, and a way to read a file. The tests give a fake. */
export interface FontEnv {
	fonts?: { forEach(cb: (face: { family: string; status: string }) => void): void };
	styleSheets: ArrayLike<CSSStyleSheet>;
	baseURI: string;
	/** The bytes of the file at an absolute address. */
	read(url: string): Promise<ArrayBuffer>;
}

/** What `fontsForPng` gives: the font lists to measure and draw with, and the `@font-face` rules to put into the SVG (empty: none). */
export interface PngFonts {
	fonts: SceneFonts;
	css: string;
}

/** The font environment of a page: the document of the tree's window (a pop-out window has its own), else the main one. */
export function pageFontEnv(doc: Document = document): FontEnv {
	return {
		fonts: doc.fonts,
		styleSheets: doc.styleSheets,
		baseURI: doc.baseURI,
		read: async (url) => {
			const response = await fetch(url);
			// An error page is not a font: its bytes must not go into the picture.
			if (!response.ok) throw new Error(`the font file gave status ${response.status}`);
			return response.arrayBuffer();
		},
	};
}

/** What one embed has made so far; it is read at the deadline, so a family done before then stays. */
interface Embed {
	css: string;
	embedded: Set<string>;
	closed: boolean;
}

/**
 * The fonts for the PNG of a tree whose text is set in `fonts`. A family that only the page loaded is embedded when its files can be read, else it is
 * taken out of the lists. Without such a family the lists come back as they are and no work is done. `doc` is the document of the tree's window.
 */
export async function fontsForPng(fonts: SceneFonts, env?: FontEnv, doc?: Document): Promise<PngFonts> {
	const unchanged: PngFonts = { fonts, css: '' };
	let page: string[];
	let e: FontEnv;
	try {
		e = env ?? pageFontEnv(doc);
		page = loadedPageFamilies(e, [...new Set([...familyNames(fonts.text), ...familyNames(fonts.ui)])]);
	} catch {
		return unchanged;
	}
	if (page.length === 0) return unchanged;
	const made: Embed = { css: '', embedded: new Set(), closed: false };
	let timer: number | undefined;
	try {
		const deadline = new Promise<void>((resolve) => {
			timer = window.setTimeout(resolve, READ_LIMIT_MS);
		});
		await Promise.race([embedFamilies(e, page, made), deadline]);
	} catch (err) {
		console.error('Crown and Kin: cannot read the fonts for the picture', err);
		made.css = '';
		made.embedded.clear();
	} finally {
		// Whatever is still being read is ignored from here on.
		made.closed = true;
		if (timer !== undefined) window.clearTimeout(timer);
	}
	const { css, embedded } = made;
	const gone = new Set(page.filter((f) => !embedded.has(f)));
	if (gone.size === 0) return { fonts, css };
	return { fonts: { ...fonts, text: withoutPageFonts(fonts.text, gone), ui: withoutPageFonts(fonts.ui, gone) }, css };
}

/** The families of `names` that the page loaded from a file (`@font-face`) and so are in use: a system font is not in the font set of the page. */
function loadedPageFamilies(env: FontEnv, names: string[]): string[] {
	const found = new Set<string>();
	env.fonts?.forEach((face) => {
		const key = familyNames(face.family)[0];
		if (key !== undefined && names.includes(key) && (face.status === 'loaded' || face.status === 'loading')) found.add(key);
	});
	return names.filter((n) => found.has(n));
}

interface FaceRule {
	family: string;
	/** The descriptors of the rule (`src`, `font-weight` ...), by lower-case name. */
	d: Map<string, string>;
	sheetHref: string | null;
}

/** Every `@font-face` rule that the page can read, with the lower-case name of its family. A sheet from another origin cannot be read and is skipped. */
function faceRules(env: FontEnv): FaceRule[] {
	const out: FaceRule[] = [];
	const seen = new Set<string>();
	const walk = (rules: ArrayLike<CSSRule>, depth: number) => {
		for (let i = 0; i < rules.length; i++) {
			// One rule at a time: an @import from another origin cannot be read, and the rules after it still can.
			try {
				const r = rules[i] as CSSRule & { cssRules?: ArrayLike<CSSRule>; styleSheet?: CSSStyleSheet | null };
				if (r.type === FONT_FACE_RULE) {
					// The text of the rule is read, not its `style` object: the lint rule of spec §5.8 closes `.style` to everything but custom properties.
					const d = descriptorsOf(r.cssText);
					const family = familyNames(d.get('font-family') ?? '')[0];
					if (family === undefined) continue;
					const rule = { family, d, sheetHref: r.parentStyleSheet?.href ?? null };
					// The same face reached twice (a sheet that is also imported) is one face.
					const key = faceKey(env, rule);
					if (seen.has(key)) continue;
					seen.add(key);
					out.push(rule);
				} else if (depth < NEST_LIMIT) {
					// An @media or @supports group, or an @import: the font may be inside.
					const inner = r.cssRules ?? r.styleSheet?.cssRules;
					if (inner) walk(inner, depth + 1);
				}
			} catch {
				// Not readable (another origin): this rule is skipped.
			}
		}
	};
	for (let i = 0; i < env.styleSheets.length; i++) {
		try {
			walk(env.styleSheets[i].cssRules, 0);
		} catch {
			// Another origin: the rules are not readable, so the font cannot be embedded.
		}
	}
	return out;
}

/** What names a face: family, descriptors and the address of its file, so one face counts once. */
function faceKey(env: FontEnv, rule: FaceRule): string {
	const pick = pickSource(rule.d.get('src') ?? '');
	let source = rule.d.get('src') ?? '';
	if (pick) {
		try {
			source = /^data:/i.test(pick.url) ? pick.url : new URL(pick.url, rule.sheetHref ?? env.baseURI).href;
		} catch {
			source = pick.url;
		}
	}
	const parts = ['font-weight', 'font-style', 'font-stretch', 'unicode-range'].map((p) => rule.d.get(p) ?? '');
	return JSON.stringify([rule.family, ...parts, source]);
}

/** Reads the files of `families` and builds their rules into `made`; a family that is read whole and fits under the cap goes into `made.embedded`. */
async function embedFamilies(env: FontEnv, families: string[], made: Embed): Promise<void> {
	const all = faceRules(env);
	let total = 0;
	for (const family of families) {
		let familyCss = '';
		let bytes = 0;
		let whole = false;
		for (const rule of all) {
			if (rule.family !== family) continue;
			whole = true;
			const one = await readFace(env, rule, FONT_CAP_BYTES - total - bytes);
			if (made.closed) return;
			if (!one) {
				whole = false;
				break;
			}
			familyCss += one.css;
			bytes += one.bytes;
		}
		if (!whole) continue;
		made.css += familyCss;
		total += bytes;
		made.embedded.add(family);
	}
}

/** The declarations inside the braces of an `@font-face` rule's text, as name (lower case) to value. Quotes and brackets are skipped, so a `;` inside a data address does not split. */
export function descriptorsOf(cssText: string): Map<string, string> {
	const open = cssText.indexOf('{');
	const close = cssText.lastIndexOf('}');
	const body = open < 0 ? '' : cssText.slice(open + 1, close > open ? close : undefined);
	const out = new Map<string, string>();
	const special = /[;"'()]/g;
	let at = 0;
	while (at < body.length) {
		const colon = body.indexOf(':', at);
		if (colon < 0) break;
		let i = colon + 1;
		let depth = 0;
		while (i < body.length) {
			special.lastIndex = i;
			const m = special.exec(body);
			if (!m) {
				i = body.length;
				break;
			}
			const ch = m[0];
			if (ch === ';' && depth === 0) {
				i = m.index;
				break;
			}
			i = m.index + 1;
			if (ch === '"' || ch === "'") {
				// Jump to the closing quote; a quote with a backslash before it does not close.
				let q = body.indexOf(ch, i);
				while (q > 0 && body[q - 1] === '\\') q = body.indexOf(ch, q + 1);
				i = q < 0 ? body.length : q + 1;
			} else if (ch === '(') depth++;
			else if (ch === ')') depth = Math.max(0, depth - 1);
		}
		out.set(body.slice(at, colon).trim().toLowerCase(), body.slice(colon + 1, i).trim());
		at = i + 1;
	}
	return out;
}

/** A font source of a `src` descriptor: the first `url()` whose format a browser reads. */
export function pickSource(src: string): { url: string; format: string } | null {
	const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)(?:\s*format\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\))?/g;
	for (let m = re.exec(src); m; m = re.exec(src)) {
		const url = m[1] ?? m[2] ?? m[3] ?? '';
		const format = (m[4] ?? m[5] ?? m[6] ?? '').toLowerCase();
		if (url !== '' && format !== 'embedded-opentype' && format !== 'svg') return { url, format };
	}
	return null;
}

const MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', opentype: 'font/otf', truetype: 'font/ttf' };

function mimeOf(url: string, format: string): string {
	const known = MIME[format.replace(/-variations$/, '')];
	if (known) return known;
	const ext = /\.(woff2|woff|otf|ttf)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
	return ext === 'otf' ? 'font/otf' : ext === 'ttf' ? 'font/ttf' : `font/${ext ?? 'ttf'}`;
}

/** The size in bytes of the data in a base64 data URI. */
function dataUriBytes(uri: string): number {
	return Math.floor(((uri.length - uri.indexOf(',') - 1) * 3) / 4);
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** Text safe inside an XML style element and a CSS string. */
const safe = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** One `@font-face` rule with its file as a data URI, or null (nothing readable, or more than `room` bytes). */
async function readFace(env: FontEnv, rule: FaceRule, room: number): Promise<{ css: string; bytes: number } | null> {
	const pick = pickSource(rule.d.get('src') ?? '');
	if (!pick) return null;
	let uri = pick.url;
	let bytes: number;
	if (/^data:/i.test(uri)) {
		bytes = dataUriBytes(uri);
	} else {
		let buf: ArrayBuffer;
		try {
			const abs = new URL(pick.url, rule.sheetHref ?? env.baseURI).href;
			buf = await env.read(abs);
		} catch {
			return null;
		}
		bytes = buf.byteLength;
		if (bytes > room) return null;
		uri = `data:${mimeOf(pick.url, pick.format)};base64,${toBase64(new Uint8Array(buf))}`;
	}
	uri = uri.replace(/[\r\n\t]/g, '');
	if (bytes > room || /["\\<&]/.test(uri)) return null;
	const family = (rule.d.get('font-family') ?? '').replace(/^["']|["']$/g, '');
	const extra = ['font-weight', 'font-style', 'font-stretch', 'unicode-range']
		.map((p) => [p, rule.d.get(p) ?? ''] as const)
		.filter(([, v]) => v !== '')
		.map(([p, v]) => `${p}:${safe(v)}`);
	return { css: `@font-face{font-family:"${safe(family)}";src:url("${uri}");${extra.join(';')}}`, bytes };
}
