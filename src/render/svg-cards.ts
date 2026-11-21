/**
 * The cards of the headless SVG (part of `renderSvg`, see `svg-string.ts`): for each person the plate with its border and house
 * ribbon, the name, title, date and relation text lines, the arms and portrait, and the "You" or ordinal tab. The Roundel and the
 * sideways text card are drawn from the same `cardTexts`, `roundelPics` and `youTabRect` as the live scene (`dom/scene.ts`), in the
 * same element order. Each step appends to `ctx.out`; the order of the steps is the order of the elements in the file.
 */
import type { House, Person } from '../core/types';
import { isDead } from '../core/succession-keys';
import type { CardLabel } from '../core/titles';
import { ORDINAL_EM, ROUNDEL_EM, cardTexts, isRoundel, nameCountOf, nameRoom, ordinalTabRect, relationY, ribbonWidth, roundelPics, showsArms, signBelowRing, youTabRect, type CardText, type ShownLines } from '../layout/geometry';
import { armsAspectRatio, armsGap } from '../layout/arms-outline';
import { illegitimateSigns } from '../layout/illegitimate-sign';
import type { PersonBox } from '../layout/model';
import { FRAME_STROKE_PX, TAB_TEXT_BASE_EM, TAB_TEXT_EM } from './scene-model';
import type { lineLook } from './line-highlight';
import { cardNameLines, svgNameLines, titleLines, type NameMeasure, type NameRun } from './name-lines';
import { fixedColour, fontOf } from './saved-picture';
import { DEAD_STRIP_OPACITY, HEIR_LOOK, ME_LOOK, ME_RING_INNER, SAVED_CARD_RADIUS, stripColour } from './styles';
import { marksForSvg } from './date-bidi';
import { fitNamed, pickReign } from './date-fit';
import { dateLineShown, reignShown, shownReignIsolated } from './tree-info';
import { fitRelationText } from './relation-fit';
import { ribbonPath } from './view-math';
import { ME_WORD } from './view-text';
import { esc, fadeAttr, fit, isUri, textWidth, type SvgCtx } from './svg-ctx';

type Look = ReturnType<typeof lineLook>;

/** A deceased person's arms and portrait are muted like the house strip. */
const DEAD_PICTURE_OPACITY = 0.8;

/** D40: the font of the relation text, as `relationFont` in `dom/scene.ts`: italic, "You" bold italic (D117). */
const relationFontOf = (size: number, family: string, you: boolean, bold: string) => (you ? `italic ${bold} ${size}px ${family}` : `italic 400 ${size}px ${family}`);

/** What every card of one picture shares; made once. */
interface Kit {
	textOf: ReturnType<typeof cardTexts>;
	roundel: boolean;
	signed: ReadonlySet<string>;
	nameWeight: string;
	heirIds: ReadonlySet<string>;
	ordinalIds: ReadonlySet<string>;
}

/** What the steps of one card read: its person, its text sizes and the values worked out once from the options. */
interface Card {
	box: PersonBox;
	p: Person;
	house: House | undefined;
	accent: string;
	dead: boolean;
	isMe: boolean;
	/** D96: on the marked card the sign keeps clear of the mark's inner ring. */
	ring: number | undefined;
	cl: CardLabel | undefined;
	titleText: string | undefined;
	reign: string | undefined;
	dates: string | undefined;
	t: CardText;
	tx: number;
	anchor: string;
	rp: ReturnType<typeof roundelPics> | undefined;
	smallFont: string;
	cutSmall: (text: string, px: number) => string;
	smallMeasure: (s: string) => number;
	names: ReturnType<typeof cardNameLines>;
}

/** Draws every card in layout order. */
export function drawCards(ctx: SvgCtx, look: Look): void {
	const { g, layout, opts, fonts, edges } = ctx;
	const geo = layout.geometry;
	const kit: Kit = {
		textOf: cardTexts(geo),
		roundel: isRoundel(geo),
		signed: illegitimateSigns(g, edges),
		nameWeight: opts.fonts ? fonts.bold : '600',
		heirIds: new Set(opts.heirs ?? []),
		ordinalIds: new Set(layout.ordinalCards ?? []),
	};
	for (const box of layout.persons.values()) {
		const card = cardFacts(ctx, kit, box);
		ctx.out.push(`<g${ctx.di(`card:${card.p.id}`)}${fadeAttr(look.card(card.p.id))}>`);
		cardPlate(ctx, kit, card);
		cardNames(ctx, kit, card);
		cardLines(ctx, kit, card);
		cardPictures(ctx, card);
		cardTabs(ctx, kit, card);
		ctx.out.push(`</g>`);
	}
}

/** The strip colour of a house: a fixed colour in a saved file (it has no page to resolve a `var()` or an unknown word), else the house's own. */
function houseAccent(ctx: SvgCtx, house: House | undefined): string {
	const { c, dark, saved } = ctx;
	const hex = house?.color && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(house.color) ? house.color : undefined;
	return hex ? stripColour(hex, c, dark) : saved ? (fixedColour(house?.color) ?? c.noHouse) : (house?.color ?? c.noHouse);
}

/** The values of one card that several steps read: the person's lines, the text sizes, the picture places and the measures. */
function cardFacts(ctx: SvgCtx, kit: Kit, box: PersonBox): Card {
	const { g, layout, opts, fonts, measured, cutWith } = ctx;
	const geo = layout.geometry;
	const p = g.byId.get(box.id)!;
	const house = p.house ? g.houses.get(p.house) : undefined;
	const count = nameCountOf(box);
	// The card's name and title text lines; without a label, the person's own.
	const cl = opts.labels?.get(p.id);
	const titleText = cl ? cl.title : p.title;
	const reign = cl && opts.showDates !== false ? marksForSvg(reignShown(cl, cl.reign, g.dates, 'none')) : undefined;
	// The scene passes the same lines, and the dates line counts even when "Show dates on cards" is off (the scene hides it by a class and keeps its room).
	const dates = marksForSvg(dateLineShown(p, g.dates, { names: 'none' }), true);
	const shown: ShownLines = { title: !!(titleText || reign), dates: !!dates };
	// D177 (10): a card with no relation word, in a tree with relation words, centres its text in the whole card.
	const t = kit.textOf(count, box.tallTitle, shown, geo.relationLine === true && !!opts.relations && !opts.relations.get(p.id)?.text);
	const isMe = opts.me !== undefined && p.id === opts.me;
	const ring = isMe ? ME_RING_INNER : undefined;
	const nameFont = fontOf(fonts.bold, t.nameSize, fonts.text);
	const sobFont = fontOf('400', t.nameSize, fonts.text);
	const smallFont = fontOf('400', t.smallSize, fonts.text);
	// D122: the sobriquet follows the name, in regular weight.
	const nameMeasure: NameMeasure = measured ? (s, sob) => measured(s, sob ? sobFont : nameFont) : (s, sob) => textWidth(s, t.nameSize, !sob);
	return {
		box, p, house, accent: houseAccent(ctx, house), dead: isDead(p), isMe, ring, cl, titleText, reign, dates, t,
		tx: box.x + (t.anchorX ?? t.padX),
		// The Roundel centres every text line on its axis.
		anchor: t.middle ? ' text-anchor="middle"' : '',
		// The Roundel's pictures stand on its top edge (`rp`); the text card has none.
		rp: kit.roundel ? roundelPics(geo, { arms: showsArms(box, p.arms, house), portrait: !!box.portrait }) : undefined,
		smallFont,
		cutSmall: (text, px) => (measured ? cutWith(text, px, smallFont) : fit(text, px, t.smallSize)),
		smallMeasure: (s) => (measured ? measured(s, smallFont) : textWidth(s, t.smallSize)),
		names: cardNameLines(cl ? cl.name : p.name, cl?.sobriquet ?? p.sobriquet, nameRoom(geo, t, kit.signed.has(p.id), ring), nameMeasure, count, opts.breaks),
	};
}

/** The card's plate (its border, the heir's outline or the mark's thick border) and the house ribbon along its top or left edge. */
function cardPlate(ctx: SvgCtx, kit: Kit, card: Card): void {
	const { c, out, di, layout } = ctx;
	const { box, p, isMe, dead, accent } = card;
	// D212: the heir's outline is one accent border, 2 px wide; no second ring. The marked heir keeps the marked card's border
	// in the text colour (D153), and its ordinal tab shows that it is an heir.
	const heir = kit.heirIds.has(p.id);
	// D41, D153: the marked card has one thicker border in the text colour; no theme accent colour is used.
	const border = isMe ? `stroke="${c.text}" stroke-width="${ME_LOOK.border}"` : heir ? `stroke="${c.accent}" stroke-width="${HEIR_LOOK.border}"` : `stroke="${c.cardEdge}"`;
	// The heir's outline is the card's own border now, so its parity id sits on the card rect.
	out.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${SAVED_CARD_RADIUS}" fill="${c.cardFill}" ${border}${heir ? di(`heir:${p.id}`) : ''}/>`);
	const barFill = `fill="${esc(accent)}"${dead ? ` fill-opacity="${DEAD_STRIP_OPACITY}"` : ''}`;
	// The house ribbon along the top edge (the left edge of a sideways card), with the card's own corners at a fixed radius; on the marked card it lies inside the thick border.
	const rib = ribbonWidth(layout.geometry);
	const inset = isMe ? ME_RING_INNER : 0;
	out.push(`<path d="${ribbonPath(box.x + inset, box.y + inset, kit.roundel ? box.w - 2 * inset : rib, kit.roundel ? rib : box.h - 2 * inset, rib, Math.max(0, SAVED_CARD_RADIUS - inset), kit.roundel ? 'top' : 'left')}" ${barFill}/>`);
}

/** The name text lines, in a bold or regular run each, and the sign of an illegitimate child under them. */
function cardNames(ctx: SvgCtx, kit: Kit, card: Card): void {
	const { c, out, di } = ctx;
	const { box, p, t, tx, anchor, dead, ring } = card;
	svgNameLines(card.names).forEach((runs: readonly NameRun[], i) => {
		const y = box.y + [t.nameBaseline, t.name2Baseline!, t.name3Baseline!][i];
		const inner = runs.map((r) => (r.sob ? `<tspan font-weight="400">${esc(r.text)}</tspan>` : esc(r.text))).join('');
		out.push(`<text x="${tx}" y="${y}"${anchor} font-size="${t.nameSize}" font-weight="${esc(kit.nameWeight)}" fill="${dead ? c.textMuted : c.text}">${inner}</text>`);
	});
	if (kit.signed.has(p.id)) {
		const s = ring === undefined ? t.sign : signBelowRing(t.sign, ring);
		out.push(`<line x1="${box.x + s.x1}" y1="${box.y + s.y1}" x2="${box.x + s.x2}" y2="${box.y + s.y2}" stroke="${c.line}" stroke-width="${s.width}" stroke-dasharray="${s.dash.join(' ')}"${dead ? ' stroke-opacity="0.6"' : ''}${di(`sign:${p.id}`)}/>`);
	}
}

/** The title, dates and relation text lines. */
function cardLines(ctx: SvgCtx, kit: Kit, card: Card): void {
	const { c, g, out, saved, opts } = ctx;
	const { box, t, tx, anchor, cl, reign, titleText, smallMeasure, cutSmall } = card;
	const hasTitle = !!titleText || !!reign;
	let titles: string[] = [];
	if (cl && reign) {
		// D61: two text lines only on a card the layout made taller for them; else one, cut with "…".
		titles = titleLines(titleText, pickReign(titleText, marksForSvg(shownReignIsolated(cl, g.dates, 'shown')), reign, t.textW, smallMeasure, t.title2Baseline !== undefined), t.textW, smallMeasure);
		if (titles.length > 1 && t.title2Baseline === undefined) titles = [cutSmall([titleText, reign].filter(Boolean).join(' '), t.textW)];
	} else if (titleText) titles = [cutSmall(titleText, t.textW)];
	titles.forEach((line, i) => {
		out.push(`<text x="${tx}" y="${box.y + (i ? t.title2Baseline! : t.titleBaseline)}"${anchor} font-size="${t.smallSize}" fill="${c.textMuted}">${esc(line)}</text>`);
	});
	const datesY = hasTitle ? t.datesBaseline : t.titleBaseline;
	const { dates } = card;
	if (dates && !(saved && opts.showDates === false)) out.push(`<text x="${tx}" y="${box.y + datesY}"${anchor} font-size="${t.smallSize}" fill="${c.dates}">${esc(fitNamed(marksForSvg(dateLineShown(card.p, g.dates), true)!, dates, t.textW, smallMeasure, (s) => cutSmall(s, t.textW)))}</text>`);
	cardRelation(ctx, kit, card);
}

/** The relation text of the card ("Aunt", "You"), when the tree shows relation words. */
function cardRelation(ctx: SvgCtx, kit: Kit, card: Card): void {
	const { c, out, di, fonts, measured, opts } = ctx;
	const { box, p, t, tx, anchor, isMe } = card;
	const relation = opts.relations?.get(p.id)?.text;
	const relY = relationY(t);
	if (!relation || relY === undefined) return;
	const style = isMe ? `font-style="italic" font-weight="${esc(kit.nameWeight)}"` : 'font-style="italic"';
	// The word may use the width that the card gives it; every other line keeps its column. The word is muted; "You" is in the text colour.
	const relW = t.relationW ?? t.textW;
	const relFont = relationFontOf(t.smallSize, fonts.text, isMe, fonts.bold);
	// D268: the short forms of the relation text before a cut, by the measure of this picture; the saved picture has its own, the live view has its own.
	const relText = fitRelationText(relation, relW, (s) => (measured ? measured(s, relFont) : textWidth(s, t.smallSize, isMe)));
	out.push(`<text x="${tx}" y="${box.y + relY}"${anchor} font-size="${t.smallSize}" ${style} fill="${isMe ? c.text : c.textMuted}"${di(`relation:${p.id}`)}>${esc(relText)}</text>`);
}

/** The arms and the portrait medallion on the top edge of a Roundel, in the scene's order. Arms with a problem show nothing; a portrait always has its frame. */
function cardPictures(ctx: SvgCtx, card: Card): void {
	const { rp } = card;
	if (!rp) return;
	// The saved picture draws the Full level only, so each picture is made once.
	if (rp.arms) cardArms(ctx, card, rp.arms, rp);
	if (rp.portrait) cardPortrait(ctx, card, rp.portrait, rp);
}

const mutedOf = (card: Card) => (card.dead ? ` opacity="${DEAD_PICTURE_OPACITY}"` : '');

type RoundelPics = NonNullable<Card['rp']>;

/** The arms picture of a card: the personal arms of the person, else the arms of the house, with the gap round its outline. */
function cardArms(ctx: SvgCtx, card: Card, r: NonNullable<RoundelPics['arms']>, rp: RoundelPics): void {
	const { out, di, pics, ground, layout, opts } = ctx;
	const { box, p, house } = card;
	// The personal arms of the person, else the arms of the house. The caller (`save-picture.ts`) names the personal ones `person-arms:<id>`.
	const uri = p.arms ? pics?.get(`person-arms:${p.id}`) : pics?.get(`arms:${house!.id}`);
	// D219: the gap in the colour of the page follows the outline of the picture; the picture comes over it. Without an outline there is no gap.
	// No `opacity` on the gap (a dead person's arms are faded, the gap behind them is not): resvg 2.6 panics on a layer outside a cropped view, as it does on an image.
	const outline = isUri(uri) ? opts.outlines?.get(p.arms ? `person-arms:${p.id}` : `arms:${house!.id}`) : undefined;
	if (outline) {
		const gap = armsGap(outline, { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h }, ROUNDEL_EM.halo * layout.geometry.fontPx, rp.armsAlign);
		out.push(`<path d="${gap.d}" fill="${ground}" stroke="${ground}" stroke-width="${gap.strokeWidth}" stroke-linejoin="round" fill-rule="evenodd"/>`);
	}
	if (isUri(uri)) out.push(`<image href="${esc(uri)}" x="${box.x + r.x}" y="${box.y + r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="${armsAspectRatio(rp.armsAlign)}"${mutedOf(card)}${di(`arms:${p.id}`)}/>`);
}

/** The portrait of a card in its round clip, or the thin (dashed when the file is missing) frame where there is no picture to show. */
function cardPortrait(ctx: SvgCtx, card: Card, r: NonNullable<RoundelPics['portrait']>, rp: RoundelPics): void {
	const { out, di, pics, ground, c } = ctx;
	const { box, p } = card;
	const uri = pics?.get(`portrait:${p.id}`);
	const cx = box.x + rp.cx;
	const cy = box.y + rp.cy;
	// A gap in the page colour round the picture keeps the line and the card edge off it.
	out.push(`<circle cx="${cx}" cy="${cy}" r="${rp.haloR}" fill="${ground}"/>`);
	const absent = uri === 'missing';
	if (isUri(uri)) {
		const id = `dynasty-portrait-clip-${ctx.clips++}`;
		out.push(`<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r.w / 2}"/></clipPath>`);
		out.push(`<image href="${esc(uri)}" x="${box.x + r.x}" y="${box.y + r.y}" width="${r.w}" height="${r.h}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"${mutedOf(card)}${di(`portrait:${p.id}`)}/>`);
	} else {
		// D219: no ring round a picture that shows. A portrait that is missing or cannot be read keeps a thin frame on the picture's edge; a file that is not
		// in the vault gives the dashed frame with a grey inside, as on screen.
		const paint = absent ? `fill="${c.cardBorder}" stroke="${c.textMuted}" stroke-dasharray="3 2"` : `fill="none" stroke="${c.textMuted}"`;
		out.push(`<circle cx="${cx}" cy="${cy}" r="${rp.ringR - FRAME_STROKE_PX / 2}" ${paint} stroke-width="${FRAME_STROKE_PX}"${di(`frame:${p.id}`)}/>`);
	}
}

/** The small "You" tab, or the ordinal tab of an heir, on the top edge of the card. */
function cardTabs(ctx: SvgCtx, kit: Kit, card: Card): void {
	const { c, out, di, layout, opts } = ctx;
	const { box, p, rp } = card;
	const geo = layout.geometry;
	const nameWeight = kit.nameWeight;
	// The ordinal tab replaces the "You" tab of the same card.
	const ordinal = kit.ordinalIds.has(p.id) ? opts.ordinals?.get(p.id) : undefined;
	const tab = layout.youTab === p.id && !ordinal ? youTabRect(geo, !!rp?.portrait, !!rp?.arms) : undefined;
	const ordTab = ordinal ? ordinalTabRect(geo, !!rp?.portrait, !!rp?.arms, [...ordinal].length) : undefined;
	if (tab) {
		// D148: the small "You" tab on the top edge of the person that `TreeLayout.youTab` names; the Full level only, so no other level hides it.
		// One look for both tabs: the card colour inside a 1 px border in the text colour, on a card-colour base with a wide edge, so the border
		// and the line above the card do not show through.
		const spot = `x="${box.x + tab.x}" y="${box.y + tab.y}" width="${tab.w}" height="${tab.h}" rx="${tab.h / 2}"`;
		out.push(`<rect ${spot} fill="${c.cardFill}" stroke="${c.cardFill}" stroke-width="${HEIR_LOOK.tabBase}"/>`);
		out.push(`<rect ${spot} fill="${c.cardFill}" stroke="${c.text}" stroke-width="${HEIR_LOOK.tabBorder}"${di(`tab:${p.id}`)}/>`);
		out.push(`<text x="${box.x + tab.x + tab.w / 2}" y="${box.y + tab.y + tab.h / 2 + TAB_TEXT_BASE_EM * geo.fontPx}" font-size="${TAB_TEXT_EM * geo.fontPx}" font-weight="${esc(nameWeight)}" text-anchor="middle" fill="${c.text}">${ME_WORD}</text>`);
	}
	if (ordTab) {
		// The ordinal tab, in the fixed colours and with the same look as the "You" tab; the text is bold, not italic.
		const spot = `x="${box.x + ordTab.x}" y="${box.y + ordTab.y}" width="${ordTab.w}" height="${ordTab.h}" rx="${ORDINAL_EM.corner * geo.fontPx}"`;
		out.push(`<rect ${spot} fill="${c.cardFill}" stroke="${c.cardFill}" stroke-width="${HEIR_LOOK.tabBase}"/>`);
		out.push(`<rect ${spot} fill="${c.cardFill}" stroke="${c.text}" stroke-width="${HEIR_LOOK.tabBorder}"${di(`ordinal:${p.id}`)}/>`);
		out.push(`<text x="${box.x + ordTab.x + ordTab.w / 2}" y="${box.y + ordTab.y + ordTab.h / 2 + TAB_TEXT_BASE_EM * geo.fontPx}" font-size="${ORDINAL_EM.text * geo.fontPx}" font-weight="${esc(nameWeight)}" text-anchor="middle" fill="${c.text}">${esc(ordinal!)}</text>`);
	}
}
