import type { FamilyGraph } from '../core/derive';
import type { Person } from '../core/types';
import { cardText, isTall, tagTop } from '../layout/geometry';
import { illegitimateSigns } from '../layout/illegitimate-sign';
import type { EdgeDrawing, FarTag, TreeLayout } from '../layout/model';
import { nameLines } from './name-lines';
import { DEAD_STRIP_OPACITY, DEFAULT_DARK, DEFAULT_LIGHT, STROKES, UNION_MARKS, stripColour, unionMark, unionShape, type Palette } from './styles';

// Headless SVG output for the layout spike and test snapshots. The plugin renders to the DOM
// with theme variables instead of a fixed palette (see styles.ts).

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Approximate advance of one character in em, for a sans-serif UI font. */
function charEm(ch: string): number {
	if ("iljt.,:;'|!()[] fr".includes(ch)) return 0.3;
	if ('mwMW'.includes(ch)) return 0.82;
	if (ch >= 'A' && ch <= 'Z') return 0.64;
	return 0.52;
}

/** Approximate text width in px; resvg cannot measure, the DOM renderer measures real text. */
export function textWidth(text: string, fontSize: number, bold = false): number {
	let em = 0;
	for (const ch of text) em += charEm(ch);
	return em * fontSize * (bold ? 1.06 : 1);
}

function fit(text: string, px: number, fontSize: number, bold = false): string {
	if (textWidth(text, fontSize, bold) <= px) return text;
	const chars = [...text];
	while (chars.length > 1 && textWidth(chars.join('') + '…', fontSize, bold) > px) chars.pop();
	return chars.join('') + '…';
}

/** "⚭ Name" for one far spouse, "⚭ N partners" for several (STE wording; the spec says spouses) (spec §5.3, D10). */
export function farTagText(g: FamilyGraph, tag: FarTag): string {
	return tag.spouses.length === 1 ? `⚭ ${g.byId.get(tag.spouses[0])?.name ?? tag.spouses[0]}` : `⚭ ${tag.spouses.length} partners`;
}

export function dateLine(p: Person): string | undefined {
	if (p.born && p.died) return `${p.born}–${p.died}`;
	if (p.born) return `b. ${p.born}`;
	if (p.died) return `d. ${p.died}`;
	return undefined;
}

export interface SvgOptions {
	margin?: number;
	title?: string;
	palette?: Palette;
	/** The palette is a dark theme's (D27 lifts house strips). Default: the palette is `DEFAULT_DARK`. */
	dark?: boolean;
	fontFamily?: string;
}

export function renderSvg(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing, opts: SvgOptions = {}): string {
	const c = opts.palette ?? DEFAULT_LIGHT;
	const dark = opts.dark ?? c === DEFAULT_DARK;
	const m = opts.margin ?? 24;
	const titleH = opts.title ? 36 : 0;
	const W = Math.ceil(layout.width + 2 * m);
	const H = Math.ceil(layout.height + 2 * m + titleH);
	const out: string[] = [];
	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(opts.fontFamily ?? 'Segoe UI, Helvetica, Arial, sans-serif')}">`);
	out.push(`<rect width="${W}" height="${H}" fill="${c.background}"/>`);
	if (opts.title) out.push(`<text x="${m}" y="${m + 8}" font-size="16" font-weight="600" fill="${c.text}">${esc(opts.title)}</text>`);
	out.push(`<g transform="translate(${m} ${m + titleH})">`);

	for (const p of edges.paths) {
		const s = STROKES[p.kind];
		const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : '';
		const cap = s.cap ? ` stroke-linecap="${s.cap}"` : '';
		const opacity = s.opacity ? ` stroke-opacity="${s.opacity}"` : '';
		out.push(`<path d="${p.d}" fill="none" stroke="${c[s.role]}" stroke-width="${s.width}"${dash}${cap}${opacity}/>`);
	}

	const base = cardText(layout.geometry);
	const tallText = cardText(layout.geometry, true);
	const signed = illegitimateSigns(g, edges);
	for (const box of layout.persons.values()) {
		const p = g.byId.get(box.id)!;
		const house = p.house ? g.houses.get(p.house) : undefined;
		const hex = house?.color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(house.color) ? house.color : undefined;
		const accent = hex ? stripColour(hex, c, dark) : (house?.color ?? c.noHouse);
		const dead = p.died !== undefined;
		const tall = isTall(layout.geometry, box);
		const t = tall ? tallText : base;
		const tx = box.x + t.padX;
		const nameW = signed.has(p.id) ? t.nameWithSignW : t.textW;
		const names = tall ? nameLines(p.name, nameW, (s) => textWidth(s, t.nameSize, true)) : [fit(p.name, nameW, t.nameSize, true)];
		out.push(`<g>`);
		out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" fill="${c.cardFill}" stroke="${c.cardBorder}"/>`);
		out.push(`<rect x="${box.x}" y="${box.y}" width="${t.stripW}" height="${box.h}" rx="3" fill="${accent}"${dead ? ` fill-opacity="${DEAD_STRIP_OPACITY}"` : ''}/>`);
		names.forEach((line, i) => {
			const y = box.y + (i ? t.name2Baseline! : t.nameBaseline);
			out.push(`<text x="${tx}" y="${y}" font-size="${t.nameSize}" font-weight="600" fill="${dead ? c.textMuted : c.text}">${esc(line)}</text>`);
		});
		if (signed.has(p.id)) {
			const s = t.sign;
			out.push(`<line x1="${box.x + s.x1}" y1="${box.y + s.y1}" x2="${box.x + s.x2}" y2="${box.y + s.y2}" stroke="${c.line}" stroke-width="${s.width}" stroke-dasharray="${s.dash.join(' ')}"${dead ? ' stroke-opacity="0.6"' : ''}/>`);
		}
		if (p.title) out.push(`<text x="${tx}" y="${box.y + t.titleBaseline}" font-size="${t.smallSize}" fill="${c.textMuted}">${esc(fit(p.title, t.textW, t.smallSize))}</text>`);
		const dates = dateLine(p);
		if (dates) out.push(`<text x="${tx}" y="${box.y + (p.title ? t.datesBaseline : t.titleBaseline)}" font-size="${t.smallSize}" fill="${c.dates}">${esc(fit(dates, t.textW, t.smallSize))}</text>`);
		out.push(`</g>`);
	}

	for (const mk of edges.markers) {
		if (mk.kind === 'union' || mk.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership (none for no recorded partnership); open
			// shapes are filled with the page colour.
			const shape = unionShape(mk.kind, mk.unionType);
			if (!shape) continue;
			const spec = UNION_MARKS[shape];
			const m = unionMark(shape, mk.x, mk.y, spec.size * layout.geometry.unionSize);
			const paint = spec.stroke ? `fill="${c.background}" stroke="${c.line}" stroke-width="${spec.stroke}" stroke-linejoin="round"` : `fill="${c.line}"`;
			const at = Object.entries(m.attr).map(([k, v]) => `${k}="${v}"`).join(' ');
			out.push(`<${m.tag} ${at} ${paint}/>`);
		} else {
			out.push(`<circle cx="${mk.x}" cy="${mk.y}" r="8" fill="${c.background}" stroke="${c.rumoured}"/>`);
			out.push(`<text x="${mk.x}" y="${mk.y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="${c.rumoured}">?</text>`);
		}
	}

	// Far-couple tags sit on top of the card's bottom edge and any line under it.
	const tagH = layout.geometry.tagH;
	const tagFont = 0.75 * layout.geometry.fontPx;
	for (const tag of layout.farTags.values()) {
		const pad = tagH / 2;
		// The marriage sign is drawn apart: few text fonts have it, and resvg would switch the whole label to the fallback font.
		const sign = tagFont * 1.4;
		// The widest the tag may be; a sideways hit area can be wider than the part of the edge the tag may use.
		const room = tag.zoneW ?? tag.hit.w;
		const label = fit(farTagText(g, tag).slice(2), room - 2 * pad - sign, tagFont);
		const w = Math.min(room, textWidth(label, tagFont) + sign + 2 * pad);
		const left = tag.x - w / 2;
		const top = tagTop(layout.geometry, tag.y);
		const base = top + tagH / 2 + 0.35 * tagFont;
		out.push(`<rect x="${left}" y="${top}" width="${w}" height="${tagH}" rx="${tagH / 2}" fill="${c.cardFill}" stroke="${c.line}" stroke-width="1"/>`);
		out.push(`<text x="${left + pad}" y="${base}" font-size="${1.25 * tagFont}" font-family="Segoe UI Symbol, DejaVu Sans, sans-serif" fill="${c.textMuted}">⚭</text>`);
		out.push(`<text x="${left + pad + sign}" y="${base}" font-size="${tagFont}" fill="${c.textMuted}">${esc(label)}</text>`);
	}

	out.push('</g></svg>');
	return out.join('\n');
}
