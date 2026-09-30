/*
 * Writes the sample pictures of sample tree 14 (`fixtures/pictures/`) and of sample tree 07b
 * (`fixtures/pictures/07b/`), spec §13.0 items 9 and 12. Every picture is fictional and made here:
 * coats of arms and painted-style busts drawn as SVG (the art of the M9 preview, branch
 * `v1.1/m9-preview`), turned into PNG with resvg or into JPEG with `picture-bytes.ts`. The large
 * pictures (a 4000 × 4000 photo, a PNG of 54 million pixels) are made byte by byte so their files
 * stay small. An internal script calls `writeFixture14Pictures` and `write07bPictures`
 * (`npm run fixtures`); the output is committed and must not be edited by hand.
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blackPng, encodeJpeg, heicFile, smallPdf, storeForOrientation6 } from './picture-bytes';

// ---------- Rendering ----------

/**
 * The RGBA pixels of an SVG drawn at `width` px wide (height from its proportions), not
 * premultiplied, as a canvas's `getImageData` gives them (resvg gives premultiplied pixels).
 */
export function rasterise(svg: string, width: number): { rgba: Uint8Array; width: number; height: number } {
	const img = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
	const rgba = new Uint8Array(img.pixels);
	for (let i = 0; i < rgba.length; i += 4) {
		const a = rgba[i + 3];
		if (a === 0 || a === 255) continue;
		for (let k = 0; k < 3; k++) rgba[i + k] = Math.min(255, Math.round((rgba[i + k] * 255) / a));
	}
	return { rgba, width: img.width, height: img.height };
}

/** A PNG of an SVG drawn at `width` px wide. */
export function svgPng(svg: string, width: number): Uint8Array {
	return new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng());
}

/** A JPEG of an SVG drawn at `width` px wide. */
function svgJpeg(svg: string, width: number, quality = 80): Uint8Array {
	const r = rasterise(svg, width);
	return encodeJpeg(r.rgba, r.width, r.height, { quality });
}

// ---------- Arms (viewBox 500 × 600, a heater shield; from the M9 preview) ----------

/** Heraldic tinctures, in the colours a painter of arms usually gives them. */
export const TINCTURE = {
	gules: '#c8102e',
	azure: '#1f4e9c',
	vert: '#1e7b3a',
	purpure: '#6b2c7a',
	sable: '#141414',
	or: '#f2c230',
	argent: '#f7f7f4',
} as const;

const SHIELD = 'M20 20H480V280C480 440 360 540 250 582C140 540 20 440 20 280Z';

/** A five-pointed star (a heraldic mullet) at `cx, cy` with outer radius `r`. */
function mullet(cx: number, cy: number, r: number): string {
	const pts: string[] = [];
	for (let i = 0; i < 10; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5;
		const rr = i % 2 ? r * 0.42 : r;
		pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
	}
	return pts.join(' ');
}

function shieldSvg(body: string, defs = '', prolog = ''): string {
	return `${prolog}<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600" viewBox="0 0 500 600">
<defs><clipPath id="shield"><path d="${SHIELD}"/></clipPath>${defs}</defs>
<g clip-path="url(#shield)">${body}</g>
<path d="${SHIELD}" fill="none" stroke="#1b1b1b" stroke-width="10" stroke-linejoin="round"/>
</svg>
`;
}

/** Valmont: Gules, a chevron Or between three mullets Or. */
export const valmontArms = () =>
	shieldSvg(`<rect width="500" height="600" fill="${TINCTURE.gules}"/>
<polygon points="0,420 250,190 500,420 500,520 250,290 0,520" fill="${TINCTURE.or}" stroke="#1b1b1b" stroke-width="4"/>
<polygon points="${mullet(130, 130, 58)}" fill="${TINCTURE.or}" stroke="#1b1b1b" stroke-width="4"/>
<polygon points="${mullet(370, 130, 58)}" fill="${TINCTURE.or}" stroke="#1b1b1b" stroke-width="4"/>
<polygon points="${mullet(250, 455, 52)}" fill="${TINCTURE.or}" stroke="#1b1b1b" stroke-width="4"/>`);

/**
 * The text an SVG editor often writes before `<svg`: an XML declaration, a long comment and a
 * DOCTYPE. With it, "<svg" starts after the first 1 KB of the file (contract amendment A4).
 */
const LONG_PROLOG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!--
  Arms of House Orsini: Azure, on a pale Argent a crescent Gules.
  A fictional coat of arms, drawn for the Dynasty Tree sample trees (spec section 13.6).
${Array.from({ length: 16 }, (_, i) => `  Note ${String(i + 1).padStart(2, '0')}: this comment is long on purpose, so that the picture's first kilobyte holds no svg element.`).join('\n')}
-->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
`;

/** Orsini: Azure, on a pale Argent a crescent Gules; written with a long prolog (A4). */
export const orsiniArms = () =>
	shieldSvg(
		`<rect width="500" height="600" fill="${TINCTURE.azure}"/>
<rect x="170" y="0" width="160" height="600" fill="${TINCTURE.argent}" stroke="#1b1b1b" stroke-width="4"/>
<circle cx="250" cy="300" r="62" fill="${TINCTURE.gules}" mask="url(#crescent)"/>`,
		`<mask id="crescent"><rect width="500" height="600" fill="#fff"/><circle cx="250" cy="276" r="52" fill="#000"/></mask>`,
		LONG_PROLOG,
	);

/** Harrow: Sable, a saltire Or, in chief a mullet Argent. */
const harrowArms = () =>
	shieldSvg(`<rect width="500" height="600" fill="${TINCTURE.sable}"/>
<rect x="-200" y="255" width="900" height="84" fill="${TINCTURE.or}" transform="rotate(48 250 297)"/>
<rect x="-200" y="255" width="900" height="84" fill="${TINCTURE.or}" transform="rotate(-48 250 297)"/>
<polygon points="${mullet(250, 95, 42)}" fill="${TINCTURE.argent}"/>`);

/** Drakemoor: Purpure, a bend Argent. */
const drakemoorArms = () =>
	shieldSvg(`<rect width="500" height="600" fill="${TINCTURE.purpure}"/>
<rect x="-200" y="250" width="900" height="110" fill="${TINCTURE.argent}" stroke="#1b1b1b" stroke-width="4" transform="rotate(45 250 300)"/>`);

/** Veyle: Vert, a fess wavy Argent. */
const veyleArms = () =>
	shieldSvg(`<rect width="500" height="600" fill="${TINCTURE.vert}"/>
<path d="M0 250Q62 220 125 250T250 250T375 250T500 250V350Q438 380 375 350T250 350T125 350T0 350Z" fill="${TINCTURE.argent}" stroke="#1b1b1b" stroke-width="4"/>`);

/** The tower of the Castellane arms, as an outline and as a filled shape (for the hatching mask). */
const TOWER = 'M160 470V250H145V185H182V215H214V185H250V215H286V185H318V215H355V185V250H340V470Z';

/** Castellane: line art only (black lines on a transparent ground). Gules (vertical hatching), a tower Argent. */
export const castellaneArms = () => {
	const hatch: string[] = [];
	for (let x = 30; x < 480; x += 22) hatch.push(`<line x1="${x}" y1="0" x2="${x}" y2="600"/>`);
	return shieldSvg(
		`<g mask="url(#field)" stroke="#000" stroke-width="3.5">${hatch.join('')}</g>
<path d="${TOWER}" fill="none" stroke="#000" stroke-width="7" stroke-linejoin="round"/>
<path d="M225 470V420A25 25 0 0 1 275 420V470" fill="none" stroke="#000" stroke-width="6"/>
<rect x="188" y="290" width="22" height="42" rx="11" fill="none" stroke="#000" stroke-width="5"/>
<rect x="290" y="290" width="22" height="42" rx="11" fill="none" stroke="#000" stroke-width="5"/>
<line x1="160" y1="360" x2="340" y2="360" stroke="#000" stroke-width="3"/>
<line x1="160" y1="400" x2="225" y2="400" stroke="#000" stroke-width="3"/>
<line x1="275" y1="400" x2="340" y2="400" stroke="#000" stroke-width="3"/>`,
		`<mask id="field"><rect width="500" height="600" fill="#fff"/><path d="${TOWER}" fill="#000" stroke="#000" stroke-width="14"/></mask>`,
	).replace(/<path d="M20 20H480[^"]*" fill="none" stroke="#1b1b1b"/, `<path d="${SHIELD}" fill="none" stroke="#000"`);
};

// ---------- Portraits (600 px wide; the head in the upper part; from the M9 preview) ----------

type Hair = 'short' | 'receding' | 'long' | 'bun' | 'braid' | 'curly';
type Headwear = 'none' | 'circlet' | 'coronet' | 'veil' | 'pearls';
type Beard = 'none' | 'short' | 'full' | 'moustache';

/** The look of one painted bust. */
interface Look {
	h: number;
	bg: [string, string];
	skin: [string, string, string];
	hair: string;
	hairStyle: Hair;
	beard: Beard;
	beardColour?: string;
	eyes: string;
	cloth: [string, string];
	trim: string;
	headwear: Headwear;
	ermine?: boolean;
	chain?: boolean;
	lips: string;
	old?: boolean;
	seed: number;
	/** Leave out the painted-texture filter: flat colours, for a small PNG. */
	flat?: boolean;
}

function bust(k: Look): string {
	const H = k.h;
	const cx = 300;
	const cy = 255;
	const out: string[] = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${H}" viewBox="0 0 600 ${H}">`);
	out.push(`<defs>
<radialGradient id="bg" cx="0.42" cy="0.3" r="0.85"><stop offset="0" stop-color="${k.bg[0]}"/><stop offset="1" stop-color="${k.bg[1]}"/></radialGradient>
<radialGradient id="skin" cx="0.4" cy="0.36" r="0.72"><stop offset="0" stop-color="${k.skin[0]}"/><stop offset="0.6" stop-color="${k.skin[1]}"/><stop offset="1" stop-color="${k.skin[2]}"/></radialGradient>
<linearGradient id="cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${k.cloth[0]}"/><stop offset="1" stop-color="${k.cloth[1]}"/></linearGradient>
<radialGradient id="hair" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="${k.hair}" stop-opacity="1"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient>
<filter id="paint" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="${k.seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="soft"><feGaussianBlur stdDeviation="6"/></filter>
</defs>`);
	out.push(k.flat ? `<rect width="600" height="${H}" fill="${k.bg[1]}"/>` : `<rect width="600" height="${H}" fill="url(#bg)"/>`);
	out.push(k.flat ? '<g>' : '<g filter="url(#paint)">');
	if (k.hairStyle === 'long' || k.hairStyle === 'braid') out.push(`<path d="M190 210C170 330 175 450 150 540L450 540C425 450 430 330 410 210Z" fill="url(#hair)"/>`);
	if (k.hairStyle === 'bun') out.push(`<circle cx="${cx}" cy="118" r="52" fill="url(#hair)"/>`);
	if (k.headwear === 'veil') out.push(`<path d="M170 200C160 320 150 470 110 ${Math.min(H, 640)}L490 ${Math.min(H, 640)}C450 470 440 320 430 200C420 110 360 90 300 90C240 90 180 110 170 200Z" fill="#ecebe4"/><path d="M190 230C185 330 190 440 170 ${Math.min(H, 640)}" stroke="#cfcdc2" stroke-width="6" fill="none"/><path d="M410 230C415 330 410 440 430 ${Math.min(H, 640)}" stroke="#cfcdc2" stroke-width="6" fill="none"/>`);
	out.push(`<path d="M40 ${H}C45 560 120 462 225 432L375 432C480 462 555 560 560 ${H}Z" fill="url(#cloth)"/>`);
	if (H > 700) out.push(`<path d="M300 450V${H}" stroke="${k.trim}" stroke-width="10"/><path d="M170 760C230 780 370 780 430 760" stroke="${k.trim}" stroke-width="14" fill="none"/>`);
	if (k.ermine) {
		out.push(`<path d="M150 485C200 450 250 450 300 480C350 450 400 450 450 485L470 540C400 510 350 520 300 550C250 520 200 510 130 540Z" fill="#f4f2ea"/>`);
		for (const [x, y] of [[180, 500], [230, 485], [265, 510], [335, 510], [370, 485], [420, 500]]) out.push(`<path d="M${x} ${y}l-5 12h10z" fill="#1a1a1a"/>`);
	} else out.push(`<path d="M222 432C250 482 350 482 378 432L396 452C360 514 240 514 204 452Z" fill="${k.trim}"/>`);
	if (k.chain) out.push(`<path d="M205 460C230 580 370 580 395 460" stroke="#d9b24a" stroke-width="9" stroke-dasharray="14 5" fill="none"/><circle cx="300" cy="570" r="17" fill="#d9b24a" stroke="#8a6a1e" stroke-width="4"/>`);
	out.push(`<path d="M256 350L256 444C280 460 320 460 344 444L344 350Z" fill="${k.skin[1]}"/><ellipse cx="300" cy="392" rx="46" ry="16" fill="${k.skin[2]}" opacity="0.6" filter="url(#soft)"/>`);
	out.push(`<ellipse cx="197" cy="262" rx="16" ry="28" fill="${k.skin[1]}"/><ellipse cx="403" cy="262" rx="16" ry="28" fill="${k.skin[1]}"/>`);
	out.push(`<ellipse cx="${cx}" cy="${cy}" rx="104" ry="132" fill="${k.flat ? k.skin[1] : 'url(#skin)'}"/>`);
	const cap: Record<Hair, string> = {
		short: 'M194 262C186 160 236 112 300 112C364 112 414 160 406 262C398 206 372 178 300 172C228 178 202 206 194 262Z',
		receding: 'M196 268C190 200 214 170 238 160C222 190 216 220 214 250ZM404 268C410 200 386 170 362 160C378 190 384 220 386 250Z',
		long: 'M192 290C176 160 232 106 300 106C368 106 424 160 408 290C400 220 380 176 318 160C300 178 250 190 208 210C200 230 196 260 192 290Z',
		bun: 'M194 262C188 162 238 118 300 118C362 118 412 162 406 262C398 205 370 172 300 166C230 172 202 205 194 262Z',
		braid: 'M192 285C178 160 232 108 300 108C368 108 422 160 408 285C398 210 372 172 300 166C228 172 202 210 192 285Z',
		curly: 'M190 270C170 150 240 100 300 104C370 100 432 150 410 270C404 210 380 186 360 180C340 170 320 176 300 170C280 176 260 170 240 180C220 186 196 210 190 270Z',
	};
	out.push(`<path d="${cap[k.hairStyle]}" fill="${k.flat ? k.hair : 'url(#hair)'}"/>`);
	if (k.hairStyle === 'curly') for (let i = 0; i < 9; i++) out.push(`<circle cx="${200 + i * 25}" cy="${150 - Math.sin((i / 8) * Math.PI) * 40}" r="24" fill="${k.hair}"/>`);
	if (k.hairStyle === 'braid') out.push(`<path d="M405 280C430 360 420 430 440 520" stroke="${k.hair}" stroke-width="30" stroke-dasharray="26 6" fill="none"/>`);
	const brow = k.beardColour ?? k.hair;
	out.push(`<path d="M232 222C248 210 270 210 284 218" stroke="${brow}" stroke-width="7" stroke-linecap="round" fill="none"/><path d="M316 218C330 210 352 210 368 222" stroke="${brow}" stroke-width="7" stroke-linecap="round" fill="none"/>`);
	for (const ex of [258, 342]) {
		out.push(`<path d="M${ex - 20} 252C${ex - 10} 240 ${ex + 10} 240 ${ex + 20} 252C${ex + 10} 262 ${ex - 10} 262 ${ex - 20} 252Z" fill="#f4efe6"/>`);
		out.push(`<circle cx="${ex}" cy="252" r="8.5" fill="${k.eyes}"/><circle cx="${ex}" cy="252" r="4" fill="#111"/><circle cx="${ex - 3}" cy="249" r="2" fill="#fff"/>`);
		out.push(`<path d="M${ex - 21} 251C${ex - 10} 238 ${ex + 10} 238 ${ex + 21} 251" stroke="#3a2a22" stroke-width="3" fill="none"/>`);
	}
	out.push(`<path d="M298 262C294 285 286 300 290 306C296 311 306 311 312 306" stroke="${k.skin[2]}" stroke-width="5" stroke-linecap="round" fill="none"/>`);
	if (!k.flat) out.push(`<ellipse cx="248" cy="300" rx="24" ry="14" fill="#e08a7a" opacity="0.25" filter="url(#soft)"/><ellipse cx="352" cy="300" rx="24" ry="14" fill="#e08a7a" opacity="0.25" filter="url(#soft)"/>`);
	out.push(`<path d="M274 336C288 330 312 330 326 336C314 350 286 350 274 336Z" fill="${k.lips}"/><path d="M274 336C290 340 310 340 326 336" stroke="#6a3a34" stroke-width="2.5" fill="none"/>`);
	if (k.old) out.push(`<path d="M236 272C244 278 254 280 262 278M338 278C346 280 356 278 364 272M262 316C258 330 262 342 268 348M338 316C342 330 338 342 332 348M250 180C280 172 320 172 350 180" stroke="${k.skin[2]}" stroke-width="2.5" fill="none" opacity="0.8"/>`);
	const bc = k.beardColour ?? k.hair;
	if (k.beard === 'full') out.push(`<path d="M198 270C200 350 240 400 300 404C360 400 400 350 402 270C392 320 370 352 340 358C330 346 312 340 300 342C288 340 270 346 260 358C230 352 208 320 198 270Z" fill="${bc}"/><path d="M262 330C280 318 320 318 338 330C320 326 280 326 262 330Z" fill="${bc}"/>`);
	if (k.beard === 'short') out.push(`<path d="M214 300C226 360 260 390 300 392C340 390 374 360 386 300C376 340 350 360 330 362C320 352 310 350 300 352C290 350 280 352 270 362C250 360 224 340 214 300Z" fill="${bc}" opacity="0.92"/><path d="M266 329C282 320 318 320 334 329C318 327 282 327 266 329Z" fill="${bc}"/>`);
	if (k.beard === 'moustache') out.push(`<path d="M262 330C278 316 296 320 300 326C304 320 322 316 338 330C322 328 310 332 300 332C290 332 278 328 262 330Z" fill="${bc}"/>`);
	if (k.headwear === 'veil') out.push(`<path d="M196 250C196 150 240 120 300 120C360 120 404 150 404 250C400 190 370 158 300 152C230 158 200 190 196 250Z" fill="#f4f3ee"/><path d="M204 330C220 400 260 420 300 420C340 420 380 400 396 330C390 380 350 404 300 406C250 404 210 380 204 330Z" fill="#f4f3ee"/>`);
	if (k.headwear === 'circlet') out.push(`<path d="M200 180C240 162 360 162 400 180" stroke="#d9b24a" stroke-width="9" fill="none"/><circle cx="300" cy="168" r="10" fill="#2f7fbf" stroke="#d9b24a" stroke-width="4"/>`);
	if (k.headwear === 'pearls') for (let i = 0; i < 13; i++) out.push(`<circle cx="${204 + i * 16}" cy="${178 - Math.sin((i / 12) * Math.PI) * 14}" r="6" fill="#f6f1e4" stroke="#b8ae98" stroke-width="1.5"/>`);
	if (k.headwear === 'coronet') {
		out.push(`<path d="M196 150L200 108L232 132L252 96L276 128L300 88L324 128L348 96L368 132L400 108L404 150C360 138 240 138 196 150Z" fill="#e0b94c" stroke="#8a6a1e" stroke-width="4"/>`);
		out.push(`<path d="M196 150C240 138 360 138 404 150L404 170C360 158 240 158 196 170Z" fill="#c9a03a" stroke="#8a6a1e" stroke-width="4"/>`);
		for (const x of [236, 300, 364]) out.push(`<circle cx="${x}" cy="158" r="7" fill="#b3202c"/>`);
	}
	out.push('</g>');
	out.push('</svg>');
	return out.join('\n') + '\n';
}

const SKIN_FAIR: [string, string, string] = ['#f6d8c4', '#e8b99c', '#c98e72'];
const SKIN_WARM: [string, string, string] = ['#efc7a4', '#d9a37d', '#b27853'];
const SKIN_OLIVE: [string, string, string] = ['#e2b88f', '#c79468', '#9c6c46'];
const SKIN_DEEP: [string, string, string] = ['#b98563', '#96603f', '#6e4028'];

/** The eight looks of the preview, by the name the preview gave them. */
const LOOKS: Record<string, Omit<Look, 'h'>> = {
	percival: { bg: ['#9a5b3c', '#3b1f16'], skin: SKIN_WARM, hair: '#4a2e1c', hairStyle: 'short', beard: 'short', eyes: '#5a3a1e', cloth: ['#2a4e8f', '#10254f'], trim: '#d9b24a', headwear: 'none', chain: true, lips: '#b86a5c', seed: 3 },
	adela: { bg: ['#9fb3c2', '#3e5566'], skin: SKIN_FAIR, hair: '#8a3b1c', hairStyle: 'long', beard: 'none', eyes: '#3f6b3a', cloth: ['#2f7d4a', '#123d22'], trim: '#e0c46a', headwear: 'circlet', lips: '#c46a6a', seed: 11 },
	hugo: { bg: ['#48624a', '#16241a'], skin: SKIN_FAIR, hair: '#b9b4ab', hairStyle: 'receding', beard: 'full', beardColour: '#cfcac0', eyes: '#4d6a8a', cloth: ['#a4192c', '#4f0a14'], trim: '#e0c46a', headwear: 'coronet', ermine: true, lips: '#b06a60', old: true, seed: 5 },
	felicia: { bg: ['#d0a24a', '#6b4a18'], skin: SKIN_FAIR, hair: '#6b5a4a', hairStyle: 'short', beard: 'none', eyes: '#5a4a3a', cloth: ['#6b2c7a', '#2e0f38'], trim: '#c9b27a', headwear: 'veil', lips: '#b87070', old: true, seed: 17 },
	odette: { bg: ['#9aa35a', '#3f4520'], skin: SKIN_FAIR, hair: '#d9b566', hairStyle: 'braid', beard: 'none', eyes: '#3d6fa0', cloth: ['#4f86c6', '#1d3f73'], trim: '#f1ead2', headwear: 'none', lips: '#d27a7a', seed: 23 },
	darian: { bg: ['#3f8f8a', '#123a38'], skin: SKIN_OLIVE, hair: '#1a1410', hairStyle: 'curly', beard: 'moustache', eyes: '#3a2a1a', cloth: ['#2a2a2a', '#050505'], trim: '#d9b24a', headwear: 'none', lips: '#a9645a', seed: 29 },
	roderick: { bg: ['#b08a5a', '#4a3218'], skin: SKIN_FAIR, hair: '#b5501f', hairStyle: 'short', beard: 'none', eyes: '#4a7a4a', cloth: ['#5f8f3a', '#23401a'], trim: '#8a5a2a', headwear: 'none', lips: '#cf7c70', seed: 31 },
	giselle: { bg: ['#6f7f99', '#252c3a'], skin: SKIN_DEEP, hair: '#1f1612', hairStyle: 'bun', beard: 'none', eyes: '#2a1a10', cloth: ['#8c2041', '#3a0a1a'], trim: '#e6dcc6', headwear: 'pearls', lips: '#8a4a44', seed: 37 },
};

const look = (name: keyof typeof LOOKS, h: number, extra: Partial<Look> = {}): Look => ({ ...LOOKS[name], h, ...extra });

// ---------- A large photo that stays a small file ----------

/**
 * A 4000 × 4000 px landscape "photo" (spec §13.0 item 12): flat shapes, so a JPEG of 16 million
 * pixels stays under about 100 KB. Big enough to need a small copy, small enough to be decoded.
 */
function landscapeSvg(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<rect width="400" height="240" fill="#9cc0dc"/>
<circle cx="300" cy="80" r="34" fill="#f5d77a"/>
<path d="M0 230L70 170L130 215L210 150L290 210L350 175L400 205V400H0Z" fill="#6f8f5a"/>
<path d="M0 290C90 270 160 300 250 285C320 275 360 290 400 285V400H0Z" fill="#4f6f3f"/>
<path d="M150 285V205H160V190H172V205H184V190H196V205H208V190H220V205H230V285Z" fill="#7b7066"/>
<path d="M183 285V255A7 7 0 0 1 197 255V285Z" fill="#3a332c"/>
<path d="M0 330C120 320 280 340 400 325V400H0Z" fill="#5a86a8"/>
</svg>
`;
}

// ---------- Sample tree 14 ----------

/** One picture file of sample tree 14: its name in `fixtures/pictures/` and its bytes. */
export interface PictureFile {
	file: string;
	bytes: () => Uint8Array;
	/** What the file is for, for the notes of sample tree 14. */
	about: string;
}

/** The picture files of sample tree 14 (spec §13.0 item 12). Missing files and web addresses are only in the tree text. */
export const FIXTURE_14_PICTURES: PictureFile[] = [
	{ file: 'valmont-arms.png', about: 'arms as a PNG: a filled shield on a transparent ground', bytes: () => svgPng(valmontArms(), 250) },
	{ file: 'orsini-arms.svg', about: 'arms as an SVG, with a long prolog before <svg', bytes: () => new TextEncoder().encode(orsiniArms()) },
	{ file: 'castellane-arms-lineart.png', about: 'arms as a transparent PNG with black lines only', bytes: () => svgPng(castellaneArms(), 250) },
	{ file: 'veyle-arms.heic', about: 'a HEIC photo (4032 × 3024)', bytes: () => heicFile([[4032, 3024]]) },
	{ file: 'ashby-charter.pdf', about: 'a file that is not a picture', bytes: smallPdf },
	{ file: 'huge-banner.png', about: 'a valid PNG of 9000 × 6000 px (54 million pixels)', bytes: () => blackPng(9000, 6000) },
	{ file: 'aldric.jpg', about: 'a square JPEG portrait', bytes: () => svgJpeg(bust(look('hugo', 600)), 300) },
	{ file: 'isolde.png', about: 'a square PNG portrait (flat colours)', bytes: () => svgPng(bust(look('adela', 600, { flat: true })), 240) },
	{ file: 'roderick-tall.jpg', about: 'the tall portrait photo for the crop (400 × 600)', bytes: () => svgJpeg(bust(look('percival', 900)), 400) },
	{
		file: 'edmund-rotated.jpg',
		about: 'a tall portrait stored on its side (450 × 300) with EXIF orientation 6, as an iPhone photo',
		bytes: () => {
			const r = rasterise(bust(look('roderick', 900, { seed: 41 })), 300);
			const s = storeForOrientation6(r.rgba, r.width, r.height);
			return encodeJpeg(s.rgba, s.width, s.height, { quality: 80, orientation: 6 });
		},
	},
	{ file: 'matteo.png', about: 'a PNG portrait, linked by an unquoted [[…]]', bytes: () => svgPng(bust(look('darian', 600, { flat: true })), 240) },
	{ file: 'beatrice.jpg', about: 'a square JPEG portrait', bytes: () => svgJpeg(bust(look('odette', 600)), 300) },
	{ file: 'giselle.png', about: 'a PNG portrait, linked by a Markdown link', bytes: () => svgPng(bust(look('giselle', 600, { flat: true })), 240) },
	{ file: 'tomas.svg', about: 'an SVG portrait', bytes: () => new TextEncoder().encode(bust(look('roderick', 600, { flat: true, hair: '#2a1a10', seed: 43 }))) },
	{ file: 'piers.png', about: 'a PNG portrait, linked with an alias', bytes: () => svgPng(bust(look('percival', 600, { flat: true, beard: 'none', hair: '#6a4a2a' })), 240) },
	{ file: 'felicia.heic', about: 'a HEIC photo stored as tiles (512 × 512 tiles, 3024 × 4032 in all)', bytes: () => heicFile([[512, 512], [3024, 4032]]) },
	{ file: 'wren-photo.jpg', about: 'a HEIC photo with the name of a JPEG (the bytes decide)', bytes: () => heicFile([[4032, 3024]]) },
	{ file: 'lisette.png', about: 'a JPEG photo with the name of a PNG (the bytes decide; it shows)', bytes: () => svgJpeg(bust(look('giselle', 600, { skin: SKIN_FAIR, hair: '#7a4a2a', seed: 47 })), 240) },
	{
		file: 'photo-4000.jpg',
		about: 'a 4000 × 4000 px photo (16 million pixels)',
		bytes: () => {
			const r = rasterise(landscapeSvg(), 4000);
			return encodeJpeg(r.rgba, r.width, r.height, { quality: 75 });
		},
	},
];

/** Writes the picture files of sample tree 14 into `dir`. */
export function writeFixture14Pictures(dir: string): void {
	mkdirSync(dir, { recursive: true });
	for (const p of FIXTURE_14_PICTURES) writeFileSync(join(dir, p.file), p.bytes());
	console.log(`${dir}: ${FIXTURE_14_PICTURES.length} pictures for sample tree 14`);
}

// ---------- Sample tree 07b ----------

/** The arms of the six houses of sample trees 7 and 07b. */
const HOUSE_ARMS: Record<string, () => string> = {
	valmont: valmontArms,
	orsini: () => orsiniArms().replace(LONG_PROLOG, ''),
	harrow: harrowArms,
	castellane: castellaneArms,
	drakemoor: drakemoorArms,
	veyle: veyleArms,
};

/** The file name of a house's arms in sample tree 07b (unique in `fixtures/pictures/`). */
export const armsFile07b = (house: string) => `07b-${house}-arms.png`;

/** The file name of a person's portrait in sample tree 07b: mostly JPEG photos, some PNG and SVG. */
export function portraitFile07b(id: string, k: number): string {
	return `07b-${id}.${k % 10 === 5 ? 'svg' : k % 10 === 0 ? 'png' : 'jpg'}`;
}

const LOOK_NAMES = Object.keys(LOOKS) as (keyof typeof LOOKS)[];
const MALE_LOOKS: (keyof typeof LOOKS)[] = ['percival', 'hugo', 'darian', 'roderick'];
const FEMALE_LOOKS: (keyof typeof LOOKS)[] = ['adela', 'felicia', 'odette', 'giselle'];

/** A bust for the k-th portrait of sample tree 07b: the look follows the person's sex; the colours vary. */
function bust07b(k: number, sex: string, old: boolean): string {
	const pool = sex === 'm' ? MALE_LOOKS : sex === 'f' ? FEMALE_LOOKS : LOOK_NAMES;
	const base = pool[k % pool.length];
	const other = LOOKS[LOOK_NAMES[(k * 3 + 1) % LOOK_NAMES.length]];
	const tall = k % 7 === 3;
	return bust(look(base, tall ? 900 : 600, { bg: other.bg, cloth: other.cloth, seed: 100 + k, old: old || LOOKS[base].old, flat: k % 10 === 0 || k % 10 === 5 }));
}

/** Writes the arms of `houses` and the portraits of `people` for sample tree 07b into `dir`. */
export function write07bPictures(dir: string, houses: readonly string[], people: readonly { id: string; sex: string; old: boolean }[]): void {
	mkdirSync(dir, { recursive: true });
	for (const h of houses) writeFileSync(join(dir, armsFile07b(h)), svgPng(HOUSE_ARMS[h](), 120));
	people.forEach((p, k) => {
		const file = portraitFile07b(p.id, k);
		const svg = bust07b(k, p.sex, p.old);
		const bytes = file.endsWith('.svg') ? new TextEncoder().encode(svg) : file.endsWith('.png') ? svgPng(svg, 128) : svgJpeg(svg, 128, 75);
		writeFileSync(join(dir, file), bytes);
	});
	console.log(`${dir}: ${houses.length} arms and ${people.length} portraits for sample tree 07b`);
}
