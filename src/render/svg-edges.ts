/**
 * The lines, the partnership and rumour signs, and the far-couple tags of the headless SVG (part of `renderSvg`, see `svg-string.ts`).
 * Each function appends to `ctx.out` in the order the picture needs: the lines under the cards, the signs on top of them, the tags last.
 */
import type { FamilyGraph } from '../core/derive';
import type { CardLabel } from '../core/titles';
import { farTagSigns } from '../layout/far-tag-sign';
import type { FarTag, Geometry } from '../layout/model';
import type { Measure, SceneFonts } from './scene-model';
import { RUMOUR_FONT_EM } from './scene-model';
import type { LineState, lineLook } from './line-highlight';
import { farTagName, farTagPair, farTagPairRuns, tagRunSvg, type TagRun } from './tree-info';
import { STROKES, ON_LINE_EXTRA, TAG_FONT_EM, TAG_MARK, UNION_MARKS, fullTagPill, tagMarkCentre, tagMarkSlot, tagNameRoom, tagPillParts, tagSignRoom, unionMark, unionShape, type Palette, type UnionShape } from './styles';
import { fontOf } from './saved-picture';
import { approxMeasure, esc, fadeAttr, fit, textWidth, type SvgCtx } from './svg-ctx';

type Look = ReturnType<typeof lineLook>;

/** The dash offset of a begetter line that lines up with its group (`EdgePath.dashOffset`); nothing for a line with none. */
const dashOffsetAttr = (offset?: number) => (offset ? ` stroke-dashoffset="${offset}"` : '');

/** Draws the lines of the tree, each with the stroke of its kind (accent and thicker on the finder's line, faded beside it). */
export function drawLines(ctx: SvgCtx, look: Look): void {
	const { c, di, out } = ctx;
	for (const p of look.paths) {
		const s = STROKES[p.kind];
		const on = p.state === 'on';
		const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : '';
		const cap = s.cap ? ` stroke-linecap="${s.cap}"` : '';
		const opacity = s.opacity && !on ? ` stroke-opacity="${s.opacity}"` : '';
		out.push(`<path d="${p.d}" fill="none" stroke="${on ? c.accent : c[s.role]}" stroke-width="${on ? s.width + ON_LINE_EXTRA : s.width}"${dash}${cap}${dashOffsetAttr(p.dashOffset)}${opacity}${fadeAttr(p.state)}${di(`line:${p.kind}`)}/>`);
	}
}

/** Draws the partnership signs on the lines and the "?" markers of rumoured links. */
export function drawMarkers(ctx: SvgCtx, look: Look): void {
	const { c, di, out, saved, ground, layout } = ctx;
	ctx.edges.markers.forEach((mk, i) => {
		const state = look.markers[i];
		if (mk.kind === 'union' || mk.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership (none for no recorded partnership); open
			// shapes are filled with the page colour. D47: a sign on the finder's line takes the accent.
			const shape = unionShape(mk.kind, mk.unionType);
			if (!shape) return;
			const spec = UNION_MARKS[shape];
			const m = unionMark(shape, mk.x, mk.y, spec.size * layout.geometry.unionSize);
			const ink = state === 'on' ? c.accent : c.line;
			const paint = spec.stroke ? `fill="${ground}" stroke="${ink}" stroke-width="${spec.stroke}" stroke-linejoin="round"` : `fill="${ink}"`;
			const at = Object.entries(m.attr).map(([k, v]) => `${k}="${v}"`).join(' ');
			out.push(`<${m.tag} ${at} ${paint}${fadeAttr(state)}${di(`union:${shape}`)}/>`);
		} else {
			if (saved) out.push(`<g${di('rumour')}>`);
			// The size of the live marker, 0.5 em and 0.7 em of the note font (`scene.ts`), not a fixed 8 px and 11 px.
			const em = layout.geometry.fontPx;
			const size = RUMOUR_FONT_EM * em;
			out.push(`<circle cx="${mk.x}" cy="${mk.y}" r="${0.5 * em}" fill="${ground}" stroke="${c.rumoured}"${fadeAttr(state)}/>`);
			out.push(`<text x="${mk.x}" y="${mk.y + 0.35 * size}" font-size="${size}" font-weight="700" text-anchor="middle" fill="${c.rumoured}"${fadeAttr(state)}>?</text>`);
			if (saved) out.push('</g>');
		}
	});
}

/** Draws the far-couple tags; they sit on top of the card's bottom edge and any line under it. */
export function drawTags(ctx: SvgCtx, look: Look): void {
	const { g, layout, edges, opts, c, di, saved, fonts, measured, out } = ctx;
	const real = opts.measure;
	const tagFont = TAG_FONT_EM * layout.geometry.fontPx;
	const tagFontStr = fontOf('400', tagFont, fonts.ui);
	const tagCtx: TagSvg = {
		g, labels: opts.labels, geo: layout.geometry, c, font: tagFont, family: saved ? ` font-family="${esc(fonts.ui)}"` : '', di,
		// D353 4 Now: the ⚭ is measured in its own font where the picture gets a real measure, so the gap after it is the fixed gap of the live tree.
		signW: savedSignWidth(real, opts.fonts, tagFont), measure: (t) => (measured ? measured(t, tagFontStr) : textWidth(t, tagFont)),
		cut: (t, px) => (measured ? ctx.cutWith(t, px, tagFontStr) : fit(t, px, tagFont)),
	};
	// A far couple with no children has no union dot, so its tag carries the partnership sign.
	const farSigns = farTagSigns(g, layout, edges);
	for (const tag of layout.farTags.values()) {
		const state = look.tag(tag);
		out.push(...tagSvg(tag, farSigns.has(tag.person) ? unionShape('union', farSigns.get(tag.person)) : null, state, saved !== undefined || state === 'faded', tagCtx));
	}
}

/** What `tagSvg` draws a far-couple tag with: the tag text size `font` (px), its measure and cut, the `font-family` attribute of a saved picture, and the parity ids. */
interface TagSvg {
	g: FamilyGraph;
	labels: ReadonlyMap<string, CardLabel> | undefined;
	geo: Geometry;
	c: Palette;
	font: number;
	family: string;
	di: (item: string) => string;
	measure: (text: string) => number;
	cut: (text: string, px: number) => string;
	/** The drawn width of the ⚭ (`SIGN_FAMILY`, `SAVED_SIGN_SIZE` tag text sizes). */
	signW: number;
}

/** The ⚭ of the saved picture is drawn apart from the name, in a symbol font, this many tag text sizes high. */
const SAVED_SIGN_SIZE = 1.25;
/** The fonts of that ⚭: few text fonts have it, and resvg would switch the whole label to the fallback font. */
const SIGN_FAMILY = 'Segoe UI Symbol, DejaVu Sans, sans-serif';
/**
 * The width of that ⚭ in tag text sizes where no real measure is given (the headless pictures): its advance in Segoe UI Symbol (0.659 em) at
 * `SAVED_SIGN_SIZE`. Before D353 4 Now the ⚭ had a room of 1.4 text sizes, a gap of about 0.58 against the 0.3 of the live tree.
 */
export const SAVED_SIGN_EM = 0.82;

/** The drawn width of the saved picture's ⚭ at tag text size `font`: measured in its own font with a real measure, else `SAVED_SIGN_EM`. */
function savedSignWidth(real: Measure | undefined, fonts: SceneFonts | undefined, font: number): number {
	return real && real !== approxMeasure && fonts ? real('⚭', fontOf('400', SAVED_SIGN_SIZE * font, SIGN_FAMILY)) : SAVED_SIGN_EM * font;
}

/**
 * One far-couple tag of the saved picture (spec §5.3, D10): the pill (D353 2 A, `fullTagPill`), the ⚭ and its room (D353 4 Now, `tagSignRoom`),
 * the partnership sign of a couple with no union dot, and the name, or the two short names of two far partners where they fit uncut (D353 3 A).
 * `grouped` wraps the parts in one group (a saved picture's parity id, or a fade).
 */
function tagSvg(tag: FarTag, farShape: UnionShape | null, state: LineState, grouped: boolean, t: TagSvg): string[] {
	const { c, font } = t;
	const out: string[] = [];
	const { top, h } = fullTagPill(t.geo, tag.y);
	const pad = h / 2;
	// D354 2 C: a tag for several partners has no sign and takes no room for one; the two names get that room.
	const bare = tag.spouses.length !== 1;
	const spaceW = farShape ? t.measure(' ') : 0;
	const drawn = bare ? 0 : tagSignRoom(t.signW, spaceW, font, farShape);
	// The partnership sign takes its own room between the marriage sign and the name; the room depends on the shape, so the gap before the name is the same (D108).
	const slot = farShape ? tagMarkSlot(farShape, font) : 0;
	// The widest the tag may be; a sideways hit area can be wider than the part of the edge the tag may use.
	const room = tag.zoneW ?? tag.hit.w;
	const pair = farTagPair(t.g, tag.spouses, t.labels);
	// D353 3 A: the two names are chosen with the room of the live tag (its ⚭ in the tag font), so a tag never reads "Katrin · Ermengarde" on
	// the screen and "2 partners" in the saved picture. The larger ⚭ of the picture then takes its room from the room the names leave.
	const liveW = t.measure('⚭');
	const live = bare ? 0 : tagSignRoom(liveW, farShape ? t.measure('⚭ ') - liveW : 0, font, farShape);
	const liveRoom = tagNameRoom(room, pad, live, slot);
	const two = pair ? farTagPairRuns(pair, liveRoom, t.measure) : undefined;
	const sign = two ? Math.min(drawn, live + liveRoom - two.w) : drawn;
	const label = two ? '' : t.cut(farTagName(t.g, tag.spouses, t.labels), tagNameRoom(room, pad, sign, slot));
	const { left, w, signX, markX, nameX } = tagPillParts(tag.x, room, pad, sign, slot, two ? two.w : t.measure(label), farShape ? tagMarkCentre(farShape, font) : 0);
	const base = top + h / 2 + 0.35 * font;
	// D47: a tag of a marriage on the finder's line gets an accent edge; a tag beside it fades.
	if (grouped) out.push(`<g${t.di(`tag:${tag.person}`)}${fadeAttr(state)}>`);
	// D212: the pill is a chip with the line colour as its edge, so it still reads as a tag without colour (3:1 on the page).
	const edge = state === 'on' ? `stroke="${c.accent}" stroke-width="2"` : `stroke="${c.line}" stroke-width="1"`;
	out.push(`<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="${h / 2}" fill="${c.cardFill}" ${edge}/>`);
	if (!bare) out.push(`<text x="${signX}" y="${base}" font-size="${SAVED_SIGN_SIZE * font}" font-family="${SIGN_FAMILY}" fill="${c.textMuted}">⚭</text>`);
	if (farShape) {
		const spec = UNION_MARKS[farShape];
		const m = unionMark(farShape, markX, top + h / 2, spec.size * TAG_MARK.unit * font);
		const at = Object.entries(m.attr).map(([k, v]) => `${k}="${v}"`).join(' ');
		const paint = spec.stroke ? `fill="${c.cardFill}" stroke="${c.textMuted}" stroke-width="${spec.stroke}" stroke-linejoin="round"` : `fill="${c.textMuted}"`;
		// The sign is listed like any union sign, as the live tree's sign has the class of one.
		out.push(`<${m.tag} ${at} ${paint}${t.di(`union:${farShape}`)}/>`);
	}
	const runs = two ? two.runs : [{ text: label, dx: 0, name: true }];
	const runText = (r: TagRun) => esc(tagRunSvg(r));
	// Three runs (a name with a right-to-left letter) are tspans at exact x, each its own text chunk, as on screen (`putName`, dom/tag-pill.ts).
	const body = runs.length === 1 ? runText(runs[0]) : runs.map((r) => `<tspan x="${nameX + r.dx}">${runText(r)}</tspan>`).join('');
	out.push(`<text x="${nameX}" y="${base}" font-size="${font}"${t.family} fill="${c.textMuted}">${body}</text>`);
	if (grouped) out.push('</g>');
	return out;
}
