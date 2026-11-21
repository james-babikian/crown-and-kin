/**
 * The frame of the headless SVG (part of `renderSvg`, see `svg-string.ts`): the opening `<svg>` with the ground,
 * the heading and the bar sentence of a saved picture (or the margin and title of a plain one), the closing tags,
 * and the saved picture's legend. The places of a saved picture's parts come from `savedFrame` (`saved-picture.ts`).
 */
import type { StrokeKind } from '../layout/model';
import { legendRows, type LegendHouse, type LegendPart } from './legend';
import { LEGEND_DEAD_DOUBT_LABEL, LEGEND_DEAD_LABEL, LEGEND_LABELS, SIGN_LEGEND_LABEL } from './legend-text';
import { svgText, svgNameLines } from './name-lines';
import { fixedColour, savedFrame, type SavedFrame, type SavedParts } from './saved-picture';
import type { SceneFonts } from './scene-model';
import { STROKES, UNION_MARKS, stripColour, type Palette, type UnionShape } from './styles';
import { esc, isUri, type SvgCtx } from './svg-ctx';

/** Writes the opening `<svg>`, the ground and the heading (saved picture) or the margin and title (plain), and the `<g>` that holds the tree. Sets `ctx.frame` for a saved picture. */
export function openFrame(ctx: SvgCtx): void {
	const { layout, saved, opts, fonts, c, di, out } = ctx;
	if (saved) {
		const frame = savedFrame(layout, saved.legend, saved.heading, layout.geometry.fontPx, ctx.measured!, fonts, saved.scale, ctx.cutWith, opts.barSentence);
		ctx.frame = frame;
		const W = frame.w;
		const H = frame.h;
		const scale = saved.scale > 0 ? saved.scale : 1;
		out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W * scale)}" height="${Math.ceil(H * scale)}" viewBox="0 0 ${W} ${H}" font-family="${esc(fonts.text)}">`);
		// D73: always a white ground, also when the view is dark.
		out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
		const h = frame.heading;
		out.push(`<text x="${h.x}" y="${h.y}" font-size="${h.size}" font-weight="${esc(h.weight)}" font-family="${esc(fonts.ui)}" fill="${c.text}"${di('heading')}>${esc(h.text)}</text>`);
		const sentence = frame.sentence;
		if (sentence) out.push(`<text x="${sentence.x}" y="${sentence.y}" font-size="${sentence.size}" font-weight="${esc(sentence.weight)}" font-family="${esc(fonts.ui)}" fill="${c.text}"${di('heading-sentence')}>${esc(svgText(sentence.text))}</text>`);
		out.push(`<g transform="translate(${frame.tree.x} ${frame.tree.y})">`);
	} else {
		const m = opts.margin ?? 24;
		const titleH = opts.title ? 36 : 0;
		const W = Math.ceil(layout.width + 2 * m);
		const H = Math.ceil(layout.height + 2 * m + titleH);
		out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(ctx.family)}">`);
		out.push(`<rect width="${W}" height="${H}" fill="${c.background}"/>`);
		if (opts.title) out.push(`<text x="${m}" y="${m + 8}" font-size="16" font-weight="600" fill="${c.text}">${esc(opts.title)}</text>`);
		out.push(`<g transform="translate(${m} ${m + titleH})">`);
	}
}

/** Closes the tree group and the `<svg>`; a saved picture with a legend writes the legend between them. */
export function closeFrame(ctx: SvgCtx): void {
	const { saved, frame, out } = ctx;
	if (saved && frame?.legend) out.push('</g>', ...legendSvg(frame, saved, ctx.c, ctx.fonts, ctx.dark), '</svg>');
	else out.push('</g></svg>');
}

/** The saved picture's legend (D74): "Line styles" with the samples of the kinds drawn, then "Houses". */
function legendSvg(frame: SavedFrame, saved: SavedParts, c: Palette, fonts: SceneFonts, dark: boolean): string[] {
	const L = frame.legend!;
	const out: string[] = [`<g transform="translate(${L.x} ${L.y})">`];
	const title = (t: { text: string; x: number; y: number; size: number; weight: string }) =>
		out.push(`<text x="${t.x}" y="${t.y}" font-size="${t.size}" font-weight="${esc(t.weight)}" font-family="${esc(fonts.ui)}" fill="${c.text}">${esc(t.text)}</text>`);
	const label = (x: number, text: string) =>
		`<text x="${x}" y="${L.rowH / 2 + 0.35 * L.labelSize}" font-size="${L.labelSize}" font-family="${esc(fonts.ui)}" fill="${c.text}">${esc(text)}</text>`;
	if (L.lines) {
		title(L.lines.title);
		const rows = new Map(legendRows().map((r) => [r.kind, r]));
		for (const cell of L.lines.rows) {
			const row = rows.get(cell.item);
			if (!row) continue;
			const item = cell.item === 'sign' ? 'legend-sign' : cell.item === 'dead' || cell.item === 'dead-doubt' ? `legend-${cell.item}` : `legend-line:${cell.item}`;
			out.push(`<g transform="translate(${cell.x} ${cell.y})" data-item="${item}">`);
			out.push(`<g transform="translate(0 ${(L.rowH - L.sample.h) / 2}) scale(${L.sample.scale})">${row.parts.map((part) => partSvg(part, c, '#ffffff')).join('')}</g>`);
			out.push(label(L.labelX, cell.item === 'sign' ? SIGN_LEGEND_LABEL : cell.item === 'dead' ? LEGEND_DEAD_LABEL : cell.item === 'dead-doubt' ? LEGEND_DEAD_DOUBT_LABEL : LEGEND_LABELS[cell.item]));
			out.push('</g>');
		}
	}
	if (L.houses) {
		title(L.houses.title);
		for (const cell of L.houses.rows) {
			const h: LegendHouse = cell.item;
			out.push(`<g transform="translate(${cell.x} ${cell.y})" data-item="legend-house:${esc(h.id)}">`);
			const hex = h.color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(h.color) ? h.color : undefined;
			const fill = hex ? stripColour(hex, c, dark) : (fixedColour(h.color) ?? c.noHouse);
			out.push(`<rect x="${L.strip.x}" y="${(L.rowH - L.strip.h) / 2}" width="${L.strip.w}" height="${L.strip.h}" rx="${L.strip.w / 2}" fill="${esc(fill)}"/>`);
			const uri = h.arms ? saved.pictures.get(`arms:${h.id}`) : undefined;
			if (isUri(uri)) out.push(`<image href="${esc(uri)}" x="${L.arms.x}" y="${(L.rowH - L.arms.h) / 2}" width="${L.arms.w}" height="${L.arms.h}" preserveAspectRatio="xMidYMid meet" data-item="legend-arms:${esc(h.id)}"/>`);
			// D346 item 3: the house name gets the embedding of a card name, so a mixed name reads in the order of the cards (WebKit ignores an isolate here).
			out.push(label(L.houseLabelX, svgNameLines([[{ text: h.name, sob: false }]])[0].map((r) => r.text).join('')));
			out.push('</g>');
		}
	}
	out.push('</g>');
	return out;
}

/** One legend sample part (`legend.ts`, drawn with classes on screen) with the palette's colours. */
function partSvg(part: LegendPart, c: Palette, ground: string, inRumour = false): string {
	const cls = part.cls;
	const attrs = Object.entries(part.attr).map(([k, v]) => `${k}="${esc(String(v))}"`);
	const kind = cls.find((x) => x.startsWith('dynasty-line-'))?.slice('dynasty-line-'.length) as StrokeKind | undefined;
	if (kind && STROKES[kind]) {
		const s = STROKES[kind];
		attrs.push(`fill="none" stroke="${c[s.role]}" stroke-width="${s.width}"`);
		if (s.dash) attrs.push(`stroke-dasharray="${s.dash}"`);
		if (s.cap) attrs.push(`stroke-linecap="${s.cap}"`);
		if (s.opacity) attrs.push(`stroke-opacity="${s.opacity}"`);
	} else if (cls.includes('dynasty-union-dot')) {
		const shape = (cls.find((x) => x.startsWith('dynasty-union-') && x !== 'dynasty-union-dot')?.slice('dynasty-union-'.length) ?? 'dot') as UnionShape;
		const spec = UNION_MARKS[shape] ?? UNION_MARKS.dot;
		attrs.push(spec.stroke ? `fill="${ground}" stroke="${c.line}" stroke-width="${spec.stroke}" stroke-linejoin="round"` : `fill="${c.line}"`);
	} else if (cls.includes('dynasty-legend-dagger')) attrs.push(`font-size="12" fill="${c.textMuted}"`);
	else if (cls.includes('dynasty-legend-card')) attrs.push(`fill="${c.cardFill}" stroke="${c.cardBorder}"`);
	else if (cls.includes('dynasty-sign')) attrs.push(`stroke="${c.line}"`);
	else if (inRumour && part.tag === 'circle') attrs.push(`fill="${ground}" stroke="${c.rumoured}"`);
	else if (inRumour && part.tag === 'text') attrs.push(`font-size="9" font-weight="700" fill="${c.rumoured}"`);
	const rumour = cls.includes('dynasty-rumour-marker');
	const inner = (part.children ?? []).map((ch) => partSvg(ch, c, ground, inRumour || rumour)).join('') + (part.text !== undefined ? esc(part.text) : '');
	return inner ? `<${part.tag} ${attrs.join(' ')}>${inner}</${part.tag}>` : `<${part.tag} ${attrs.join(' ')}/>`;
}
