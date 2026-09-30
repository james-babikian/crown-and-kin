/**
 * Draws a finished tree layout to a standalone SVG string, for the spike (`npm run spike`), test
 * snapshots and (M9, spec §13.8) the saved picture. This is the only place plugin code may bake
 * colours into SVG attributes: it takes a fixed `Palette` (`styles.ts`) instead of the CSS variables
 * the DOM renderer uses, since a headless SVG and a saved file have no page theme to read from.
 * M9: `pictures` embeds arms and portraits as data URIs (the spike, B9); `saved` adds the white
 * ground, the heading, the legend and the parity ids of a saved picture (P3, P4), placed by
 * `savedFrame` in `saved-picture.ts`; `measure` and `fonts` break and cut the text with the font a
 * canvas really draws (P2). With none of them, the output is exactly the M8 drawing.
 * In a saved picture every drawn element has a `data-item` (`card:`, `line:`, `union:`, `rumour`,
 * `sign:`, `tag:`, `relation:`, `arms:`, `portrait:`, `frame:`, `heading`, `legend-line:`,
 * `legend-sign`, `legend-house:`, `legend-arms:`); the tests compare this list with the one they
 * derive from the DOM scene, so the file and the screen draw the same things.
 */
import type { FamilyGraph } from '../core/derive';
import type { CardLabel } from '../core/titles';
import { armsPlace, cardText, nameCountOf, nameTextWidth, portraitBox, relationY, smallTextWidth, tagTop, type CardText } from '../layout/geometry';
import { illegitimateSigns } from '../layout/illegitimate-sign';
import { FOLD_EM } from '../layout/fold-spots';
import type { EdgeDrawing, NameLineCount, StrokeKind, TreeLayout } from '../layout/model';
import { signText } from './dom/folds';
import type { Measure, SceneFonts } from './dom/scene';
import { legendRows, type LegendHouse, type LegendPart } from './legend';
import { lineLook, type LineMarks, type LineState } from './line-highlight';
import { nameLines, titleLines } from './name-lines';
import { fixedColour, fontOf, savedFrame, xmlText, type PictureMap, type SavedFrame, type SavedParts } from './saved-picture';
import { DEAD_STRIP_OPACITY, DEFAULT_DARK, DEFAULT_LIGHT, FADED_OPACITY, ME_LOOK, ON_LINE_EXTRA, STROKES, UNION_MARKS, stripColour, unionMark, unionShape, type Palette, type UnionShape } from './styles';
import { LEGEND_LABELS, SIGN_LEGEND_LABEL, dateLine, farTagName } from './tree-info';
import { truncate } from './view-math';

/** The fade of a part beside the finder's line, as an SVG attribute (D47). */
const fadeAttr = (s: LineState) => (s === 'faded' ? ` opacity="${FADED_OPACITY}"` : '');

const esc = (s: string) => xmlText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
	for (const ch of xmlText(text)) em += charEm(ch);
	return em * fontSize * (bold ? 1.06 : 1);
}

/** `textWidth` as a `Measure` of a CSS font string (`${weight} ${size}px ${family}`): the fallback when a saved picture gets no real measure. */
export const approxMeasure: Measure = (text, font) => {
	const size = /(\d+(?:\.\d+)?)px/.exec(font);
	const weight = /^(?:italic\s+)?(\d{3})\s/.exec(font);
	return textWidth(text, size ? Number(size[1]) : 16, !!weight && Number(weight[1]) >= 600);
};

function fit(text: string, px: number, fontSize: number, bold = false): string {
	if (textWidth(text, fontSize, bold) <= px) return text;
	const chars = [...text];
	while (chars.length > 1 && textWidth(chars.join('') + '…', fontSize, bold) > px) chars.pop();
	return chars.join('') + '…';
}

/** G4: a deceased person's arms and portrait are muted like the house strip. */
export const DEAD_PICTURE_OPACITY = 0.8;

/** M10 (F14): how the headless picture draws the fold controls of `layout.folds`. */
export interface SvgFolds {
	/** Draw the open "−" buttons too; false draws the "+ N" signs only. A saved picture never draws buttons (D71). */
	buttons: boolean;
}

/** Options for `renderSvg`; all optional. */
export interface SvgOptions {
	margin?: number;
	title?: string;
	palette?: Palette;
	/** The palette is a dark theme's (D27 lifts house strips). Default: the palette is `DEFAULT_DARK`. */
	dark?: boolean;
	fontFamily?: string;
	/** D40: the relation text of each card, as `SceneOptions.relations`. */
	relations?: ReadonlyMap<string, { text: string; lower: string }>;
	/** D41: the marked person, as `SceneOptions.me`. */
	me?: string;
	/** D47: the relation finder's line, as `SceneOptions.line`. */
	line?: LineMarks;
	/** M8: the card labels of the drawn graph, as `SceneOptions.labels`; absent = the M7 drawing. */
	labels?: ReadonlyMap<string, CardLabel>;
	/**
	 * "Show dates on cards", as `SceneOptions.showDates`: `false` leaves the reign out of the title
	 * text line; with `saved` it also leaves the dates line out, as the class hides it on screen. Absent = true.
	 */
	showDates?: boolean;
	/** P2: measures text in a CSS font string; with `fonts`, all text is broken and cut with it. */
	measure?: Measure;
	/** P2: the font families and bold weight the text is measured and written in. */
	fonts?: SceneFonts;
	/** B9: arms and portraits to embed (data URIs), without the saved picture's heading and legend (the spike). */
	pictures?: PictureMap;
	/** P3: draw a saved picture: white ground, heading, tree and legend, colours from `palette`, and parity ids. */
	saved?: SavedParts;
	/** M10: draw the fold controls of the layout (the spike). A saved picture draws its signs from `saved.folds` and no buttons. Absent = none. */
	folds?: SvgFolds;
}

/** D40: the font of the relation text, as `relationFont` in `dom/scene.ts`: italic, "You" semibold upright. */
const relationFontOf = (size: number, family: string, you: boolean) => (you ? `600 ${size}px ${family}` : `italic 400 ${size}px ${family}`);

const isUri = (v: string | null | undefined): v is string => typeof v === 'string' && v.startsWith('data:');

/** Draws `layout` and `edges` to a complete `<svg>...</svg>` string, with cards, lines, signs and far-couple tags. */
export function renderSvg(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing, opts: SvgOptions = {}): string {
	const c = opts.palette ?? DEFAULT_LIGHT;
	const dark = opts.dark ?? c === DEFAULT_DARK;
	const saved = opts.saved;
	const pics = saved?.pictures ?? opts.pictures;
	const family = opts.fontFamily ?? 'Segoe UI, Helvetica, Arial, sans-serif';
	// P2: with a real measure every text is broken and cut with it; a saved picture without one uses the approximation.
	const real = opts.measure;
	const measured: Measure | undefined = real && opts.fonts ? (s, font) => real(xmlText(s), font) : saved ? approxMeasure : undefined;
	const fonts: SceneFonts = opts.fonts ?? { text: family, ui: family, bold: '600' };
	const cutWith = (text: string, px: number, font: string) => truncate(text, px, (s) => measured!(s, font));
	/** P4: the parity id of an element of a saved picture; nothing otherwise. */
	const di = (item: string) => (saved ? ` data-item="${esc(item)}"` : '');
	const out: string[] = [];
	let frame: SavedFrame | undefined;
	if (saved) {
		frame = savedFrame(layout, saved.legend, saved.heading, layout.geometry.fontPx, measured!, fonts, saved.scale, cutWith);
		const W = frame.w;
		const H = frame.h;
		const scale = saved.scale > 0 ? saved.scale : 1;
		out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W * scale)}" height="${Math.ceil(H * scale)}" viewBox="0 0 ${W} ${H}" font-family="${esc(fonts.text)}">`);
		// D73: always a white ground, also when the view is dark.
		out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
		const h = frame.heading;
		out.push(`<text x="${h.x}" y="${h.y}" font-size="${h.size}" font-weight="${esc(h.weight)}" font-family="${esc(fonts.ui)}" fill="${c.text}"${di('heading')}>${esc(h.text)}</text>`);
		out.push(`<g transform="translate(${frame.tree.x} ${frame.tree.y})">`);
	} else {
		const m = opts.margin ?? 24;
		const titleH = opts.title ? 36 : 0;
		const W = Math.ceil(layout.width + 2 * m);
		const H = Math.ceil(layout.height + 2 * m + titleH);
		out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(family)}">`);
		out.push(`<rect width="${W}" height="${H}" fill="${c.background}"/>`);
		if (opts.title) out.push(`<text x="${m}" y="${m + 8}" font-size="16" font-weight="600" fill="${c.text}">${esc(opts.title)}</text>`);
		out.push(`<g transform="translate(${m} ${m + titleH})">`);
	}
	const ground = saved ? '#ffffff' : c.background;

	const look = lineLook(g, layout, edges, opts.line);
	for (const p of look.paths) {
		const s = STROKES[p.kind];
		const on = p.state === 'on';
		const dash = s.dash ? ` stroke-dasharray="${s.dash}"` : '';
		const cap = s.cap ? ` stroke-linecap="${s.cap}"` : '';
		const opacity = s.opacity && !on ? ` stroke-opacity="${s.opacity}"` : '';
		out.push(`<path d="${p.d}" fill="none" stroke="${on ? c.accent : c[s.role]}" stroke-width="${on ? s.width + ON_LINE_EXTRA : s.width}"${dash}${cap}${opacity}${fadeAttr(p.state)}${di(`line:${p.kind}`)}/>`);
	}

	const geo = layout.geometry;
	const base = cardText(geo);
	// D29, D61: text positions of the tall cards, one per kind of tall card.
	const tallTexts = new Map<string, CardText>();
	const textOf = (count: NameLineCount, tallTitle?: true): CardText => {
		if (count === 1 && !tallTitle) return base;
		const key = `${count}${tallTitle ? 1 : 0}`;
		let t = tallTexts.get(key);
		if (!t) tallTexts.set(key, (t = cardText(geo, count, tallTitle)));
		return t;
	};
	const signed = illegitimateSigns(g, edges);
	const nameWeight = opts.fonts ? fonts.bold : '600';
	let clips = 0;
	for (const box of layout.persons.values()) {
		const p = g.byId.get(box.id)!;
		const house = p.house ? g.houses.get(p.house) : undefined;
		const hex = house?.color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(house.color) ? house.color : undefined;
		// R2: a saved file has no page to resolve a `var()` or an unknown word, so it draws only fixed colours.
		const accent = hex ? stripColour(hex, c, dark) : saved ? (fixedColour(house?.color) ?? c.noHouse) : (house?.color ?? c.noHouse);
		const dead = p.died !== undefined;
		const count = nameCountOf(box);
		const t = textOf(count, box.tallTitle);
		const tx = box.x + t.padX;
		// D67, D78: the arms at the top right; the name ends before them and the D14 sign moves left of them.
		const place = box.arms && house ? armsPlace(geo, t, box.h, 0) : undefined;
		const nameW = place ? (signed.has(p.id) ? t.nameWithSignW : t.textW) - place.shift : signed.has(p.id) ? t.nameWithSignW : t.textW;
		// D76, D77: the small text lines beside the portrait are narrower; the name never is.
		const portrait = box.portrait ? portraitBox(geo, t) : undefined;
		const widthAt = (baseline: number) => (portrait ? smallTextWidth(geo, t, baseline, portrait) : t.textW);
		const nameFont = fontOf(fonts.bold, t.nameSize, fonts.text);
		const smallFont = fontOf('400', t.smallSize, fonts.text);
		const cutSmall = (text: string, px: number) => (measured ? cutWith(text, px, smallFont) : fit(text, px, t.smallSize));
		// M8: the card's name and title text lines; without a label, the person's own (M7).
		const cl = opts.labels?.get(p.id);
		const shownName = cl ? cl.name : p.name;
		const maxLines = count === 3 ? 3 : 2;
		const rawNames = measured
			? count > 1
				? nameLines(shownName, nameW, (s) => measured(s, nameFont), maxLines)
				: [cutWith(shownName, nameW, nameFont)]
			: count > 1
				? nameLines(shownName, nameW, (s) => textWidth(s, t.nameSize, true), maxLines)
				: [fit(shownName, nameW, t.nameSize, true)];
		// D76, D77: a name text line beside the portrait is cut shorter; the breaks stay.
		const names = rawNames.map((line, i) => {
			const w = nameTextWidth(geo, t, (i + 1) as NameLineCount, count, portrait, t.textW - nameW);
			return w < nameW ? (measured ? cutWith(line, w, nameFont) : fit(line, w, t.nameSize, true)) : line;
		});
		const isMe = opts.me !== undefined && p.id === opts.me;
		out.push(`<g${di(`card:${p.id}`)}${fadeAttr(look.card(p.id))}>`);
		// D41: the marked card has a thicker accent border, with a thin text-colour ring inside it.
		const border = isMe ? `stroke="${c.accent}" stroke-width="${ME_LOOK.border}"` : `stroke="${c.cardBorder}"`;
		out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="6" fill="${c.cardFill}" ${border}/>`);
		out.push(`<rect x="${box.x}" y="${box.y}" width="${t.stripW}" height="${box.h}" rx="3" fill="${esc(accent)}"${dead ? ` fill-opacity="${DEAD_STRIP_OPACITY}"` : ''}/>`);
		if (isMe) {
			const i = ME_LOOK.border / 2 + ME_LOOK.ring / 2;
			out.push(`<rect x="${box.x + i}" y="${box.y + i}" width="${box.w - 2 * i}" height="${box.h - 2 * i}" rx="${6 - i}" fill="none" stroke="${c.text}" stroke-width="${ME_LOOK.ring}"/>`);
		}
		names.forEach((line, i) => {
			const y = box.y + [t.nameBaseline, t.name2Baseline!, t.name3Baseline!][i];
			out.push(`<text x="${tx}" y="${y}" font-size="${t.nameSize}" font-weight="${esc(nameWeight)}" fill="${dead ? c.textMuted : c.text}">${esc(line)}</text>`);
		});
		if (signed.has(p.id)) {
			const s = place ? { ...t.sign, x1: t.sign.x1 - place.shift, x2: t.sign.x2 - place.shift } : t.sign;
			out.push(`<line x1="${box.x + s.x1}" y1="${box.y + s.y1}" x2="${box.x + s.x2}" y2="${box.y + s.y2}" stroke="${c.line}" stroke-width="${s.width}" stroke-dasharray="${s.dash.join(' ')}"${dead ? ' stroke-opacity="0.6"' : ''}${di(`sign:${p.id}`)}/>`);
		}
		const titleText = cl ? cl.title : p.title;
		const reign = cl && opts.showDates !== false ? cl.reign : undefined;
		const hasTitle = !!titleText || !!reign;
		let titles: string[] = [];
		const smallMeasure = (s: string) => (measured ? measured(s, smallFont) : textWidth(s, t.smallSize));
		if (cl && reign) {
			// D61: two text lines only on a card the layout made taller for them; else one, cut with "…".
			titles = titleLines(titleText, reign, t.textW, smallMeasure);
			if (titles.length > 1 && t.title2Baseline === undefined) titles = [cutSmall([titleText, reign].filter(Boolean).join(' '), widthAt(t.titleBaseline))];
		} else if (titleText) titles = [cutSmall(titleText, widthAt(t.titleBaseline))];
		if (portrait) {
			// G3: the break is made at the normal width; a text line beside the portrait is then cut shorter.
			titles = titles.map((line, i) => {
				const w = widthAt(i ? t.title2Baseline! : t.titleBaseline);
				return w < t.textW ? cutSmall(line, w) : line;
			});
		}
		titles.forEach((line, i) => {
			out.push(`<text x="${tx}" y="${box.y + (i ? t.title2Baseline! : t.titleBaseline)}" font-size="${t.smallSize}" fill="${c.textMuted}">${esc(line)}</text>`);
		});
		const dates = dateLine(p);
		const datesY = hasTitle ? t.datesBaseline : t.titleBaseline;
		if (dates && !(saved && opts.showDates === false)) out.push(`<text x="${tx}" y="${box.y + datesY}" font-size="${t.smallSize}" fill="${c.dates}">${esc(cutSmall(dates, widthAt(datesY)))}</text>`);
		const relation = opts.relations?.get(p.id)?.text;
		const relY = relationY(t, hasTitle, !!dates);
		if (relation && relY !== undefined) {
			const style = isMe ? 'font-weight="600"' : 'font-style="italic"';
			const relText = measured ? cutWith(relation, widthAt(relY), relationFontOf(t.smallSize, fonts.text, isMe)) : fit(relation, widthAt(relY), t.smallSize, isMe);
			out.push(`<text x="${tx}" y="${box.y + relY}" font-size="${t.smallSize}" ${style} fill="${c.text}"${di(`relation:${p.id}`)}>${esc(relText)}</text>`);
		}
		// M9: the pictures. Arms with a problem show nothing; a portrait always has its frame (B1, B9).
		const muted = dead ? ` opacity="${DEAD_PICTURE_OPACITY}"` : '';
		if (place) {
			const uri = pics?.get(`arms:${house!.id}`);
			const r = place.full;
			if (isUri(uri)) out.push(`<image href="${esc(uri)}" x="${box.x + r.x}" y="${box.y + r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMid meet"${muted}${di(`arms:${p.id}`)}/>`);
		}
		if (portrait) {
			const uri = pics?.get(`portrait:${p.id}`);
			const rad = portrait.w / 2;
			const cx = box.x + portrait.x + rad;
			const cy = box.y + portrait.y + rad;
			if (isUri(uri)) {
				// The upper-centre square of the picture (§13.7), cut round; a saved picture's copy already is.
				const id = `dynasty-portrait-clip-${clips++}`;
				out.push(`<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${rad}"/></clipPath>`);
				out.push(`<image href="${esc(uri)}" x="${box.x + portrait.x}" y="${box.y + portrait.y}" width="${portrait.w}" height="${portrait.h}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"${muted}${di(`portrait:${p.id}`)}/>`);
			}
			// B1: dashed with a grey fill only for a missing file; else the solid empty frame (or the ring round the picture).
			const missing = uri === 'missing';
			const paint = missing ? `fill="${c.cardBorder}" stroke="${c.textFaint}" stroke-dasharray="3 2"` : `fill="none" stroke="${isUri(uri) ? c.cardBorder : c.textFaint}"`;
			out.push(`<circle cx="${cx}" cy="${cy}" r="${rad - 0.5}" ${paint} stroke-width="1"${di(`frame:${p.id}`)}/>`);
		}
		out.push(`</g>`);
	}

	edges.markers.forEach((mk, i) => {
		const state = look.markers[i];
		if (mk.kind === 'union' || mk.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership (none for no recorded partnership); open
			// shapes are filled with the page colour. D47: a sign on the finder's line takes the accent.
			const shape = unionShape(mk.kind, mk.unionType);
			if (!shape) return;
			const spec = UNION_MARKS[shape];
			const m = unionMark(shape, mk.x, mk.y, spec.size * geo.unionSize);
			const ink = state === 'on' ? c.accent : c.line;
			const paint = spec.stroke ? `fill="${ground}" stroke="${ink}" stroke-width="${spec.stroke}" stroke-linejoin="round"` : `fill="${ink}"`;
			const at = Object.entries(m.attr).map(([k, v]) => `${k}="${v}"`).join(' ');
			out.push(`<${m.tag} ${at} ${paint}${fadeAttr(state)}${di(`union:${shape}`)}/>`);
		} else {
			if (saved) out.push(`<g${di('rumour')}>`);
			out.push(`<circle cx="${mk.x}" cy="${mk.y}" r="8" fill="${ground}" stroke="${c.rumoured}"${fadeAttr(state)}/>`);
			out.push(`<text x="${mk.x}" y="${mk.y + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="${c.rumoured}"${fadeAttr(state)}>?</text>`);
			if (saved) out.push('</g>');
		}
	});

	// M10 (F14): the "+ N" signs of the folded families, and (not in a saved picture) the buttons of the open ones.
	const foldMode: SvgFolds | undefined = saved ? (saved.folds ? { buttons: false } : undefined) : opts.folds;
	if (foldMode) {
		const em = geo.fontPx;
		const sized = FOLD_EM.signText * em;
		const signFont = fontOf('600', sized, fonts.ui);
		for (const control of layout.folds ?? []) {
			const { spot } = control;
			if (!control.folded) {
				if (!foldMode.buttons) continue;
				const r = (FOLD_EM.button / 2) * em;
				const arm = FOLD_EM.minusHalf * r;
				out.push(`<circle cx="${spot.x}" cy="${spot.y}" r="${r}" fill="${c.cardFill}" stroke="${c.line}" stroke-width="1"/>`);
				out.push(`<path d="M${spot.x - arm} ${spot.y}H${spot.x + arm}" fill="none" stroke="${c.text}" stroke-width="${FOLD_EM.minusStroke * r}"/>`);
				continue;
			}
			const text = signText(control.count);
			const textW = measured ? measured(text, signFont) : textWidth(text, sized, true);
			const h = FOLD_EM.signHeight * em;
			const left = spot.x - h / 2;
			const group = saved ? `<g${di(`fold:${control.key}`)}>` : '';
			if (group) out.push(group);
			out.push(`<rect x="${left}" y="${spot.y - h / 2}" width="${textW + FOLD_EM.signPad * em}" height="${h}" rx="${h / 2}" fill="${c.cardFill}" stroke="${c.line}" stroke-width="1"/>`);
			out.push(`<text x="${left + 0.45 * em}" y="${spot.y + 0.35 * sized}" font-size="${sized}" font-weight="600"${saved ? ` font-family="${esc(fonts.ui)}"` : ''} fill="${c.text}">${esc(text)}</text>`);
			if (group) out.push('</g>');
		}
	}

	// Far-couple tags sit on top of the card's bottom edge and any line under it.
	const tagH = geo.tagH;
	const tagFont = 0.75 * geo.fontPx;
	const tagFontStr = fontOf('400', tagFont, fonts.ui);
	const tagFamily = saved ? ` font-family="${esc(fonts.ui)}"` : '';
	for (const tag of layout.farTags.values()) {
		const pad = tagH / 2;
		// The marriage sign is drawn apart: few text fonts have it, and resvg would switch the whole label to the fallback font.
		const sign = tagFont * 1.4;
		// The widest the tag may be; a sideways hit area can be wider than the part of the edge the tag may use.
		const room = tag.zoneW ?? tag.hit.w;
		const label = measured ? cutWith(farTagName(g, tag.spouses), room - 2 * pad - sign, tagFontStr) : fit(farTagName(g, tag.spouses), room - 2 * pad - sign, tagFont);
		const w = Math.min(room, (measured ? measured(label, tagFontStr) : textWidth(label, tagFont)) + sign + 2 * pad);
		const left = tag.x - w / 2;
		const top = tagTop(geo, tag.y);
		const base = top + tagH / 2 + 0.35 * tagFont;
		// D47: a tag of a marriage on the finder's line gets an accent edge; a tag beside it fades.
		const state = look.tag(tag);
		const group = saved || state === 'faded';
		if (group) out.push(`<g${di(`tag:${tag.person}`)}${fadeAttr(state)}>`);
		const edge = state === 'on' ? `stroke="${c.accent}" stroke-width="2"` : `stroke="${c.line}" stroke-width="1"`;
		out.push(`<rect x="${left}" y="${top}" width="${w}" height="${tagH}" rx="${tagH / 2}" fill="${c.cardFill}" ${edge}/>`);
		out.push(`<text x="${left + pad}" y="${base}" font-size="${1.25 * tagFont}" font-family="Segoe UI Symbol, DejaVu Sans, sans-serif" fill="${c.textMuted}">⚭</text>`);
		out.push(`<text x="${left + pad + sign}" y="${base}" font-size="${tagFont}"${tagFamily} fill="${c.textMuted}">${esc(label)}</text>`);
		if (group) out.push('</g>');
	}

	if (saved && frame?.legend) out.push('</g>', ...legendSvg(frame, saved, c, fonts, dark), '</svg>');
	else out.push('</g></svg>');
	return out.join('\n');
}

/** The saved picture's legend (P3, D74): "Line styles" with the samples of the kinds drawn, then "Houses". */
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
			const item = cell.item === 'sign' ? 'legend-sign' : `legend-line:${cell.item}`;
			out.push(`<g transform="translate(${cell.x} ${cell.y})" data-item="${item}">`);
			out.push(`<g transform="translate(0 ${(L.rowH - L.sample.h) / 2}) scale(${L.sample.scale})">${row.parts.map((part) => partSvg(part, c, '#ffffff')).join('')}</g>`);
			out.push(label(L.labelX, cell.item === 'sign' ? SIGN_LEGEND_LABEL : LEGEND_LABELS[cell.item as StrokeKind]));
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
			out.push(label(L.houseLabelX, h.name));
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
	} else if (cls.includes('dynasty-legend-card')) attrs.push(`fill="${c.cardFill}" stroke="${c.cardBorder}"`);
	else if (cls.includes('dynasty-sign')) attrs.push(`stroke="${c.line}"`);
	else if (inRumour && part.tag === 'circle') attrs.push(`fill="${ground}" stroke="${c.rumoured}"`);
	else if (inRumour && part.tag === 'text') attrs.push(`font-size="9" font-weight="700" fill="${c.rumoured}"`);
	const rumour = cls.includes('dynasty-rumour-marker');
	const inner = (part.children ?? []).map((ch) => partSvg(ch, c, ground, inRumour || rumour)).join('') + (part.text !== undefined ? esc(part.text) : '');
	return inner ? `<${part.tag} ${attrs.join(' ')}>${inner}</${part.tag}>` : `<${part.tag} ${attrs.join(' ')}/>`;
}
