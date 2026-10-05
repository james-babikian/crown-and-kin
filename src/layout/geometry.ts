/**
 * Turns a note's font size into the card and gap sizes a tree draws with (spec §5.8), and the line
 * lane layout of the gaps between rows. `layout.ts` and `lines.ts` call these functions to size
 * and place cards; `render/dom/scene.ts` and `render/svg-string.ts` call `cardText` (with the
 * card's `PersonBox.tallName` and `tallTitle`) and `tagTop` to draw and measure the same card the
 * layout used, so every level of detail agrees on where the text sits (spec §5.4). `NORMAL_GEOMETRY` is used only by scripts and tests.
 * M9: the places of the arms and the portrait on a card (`armsPlace`, `portraitBox`) and the room
 * that they leave a text line (`roomAt`, `nameRoom`), shared by the same renderers. Owner decision
 * D78 made the arms and the portrait the same height: 1.25 line heights (1.5 em on normal cards).
 * 0.2.4 (D117): all card text is 0.85 em; both boxes sit at the lower right, the arms left of the
 * portrait, and a text line that their height reaches is narrower. No picture changes a card's
 * height, so pictures never move a card. `namesOnlyGeometry` is the phone preview card (D119).
 */
import type { CardSize, Geometry, GeometryFor, LayoutSettings, LowerRightBox, NameLineCount, NameRoom, Rect, SidewaysCards } from './model';

/** Obsidian's default note font size; the card geometry (180×64 cards) was tuned at this size. */
export const BASE_FONT_PX = 16;

// Sizes in em of the note font (spec §5.8: geometry follows the font).
interface Ems {
	cardW: number;
	cardH: number;
	coupleGap: number;
	nodeGap: number;
	/** Line height of the card text, as a multiple of each line's font size. */
	lineHeight: number;
}

const EMS: Record<CardSize, Ems> = {
	// D117: all text is 0.85 em, so 3 lines at 1.2 line height take 3.06 em; 3.8 em keeps the padding of 0.2.3.
	normal: { cardW: 11.25, cardH: 3.8, coupleGap: 2.25, nodeGap: 1.25, lineHeight: 1.2 },
	// Narrower, tighter cards (spec §9 "Card size: compact"); still 3 lines at 1.1 line height (D126: 3.35 em).
	compact: { cardW: 9, cardH: 3.35, coupleGap: 2, nodeGap: 1, lineHeight: 1.1 },
};

// The same for both card sizes: the gap between rows must hold union dots, far-couple tags
// with the dot below them, and up to 4 sibling-bar lanes (spec §5.3), none of which shrink with
// the card. An earlier, smaller value (5.625 em, 90 px) let the lowest lane meet a far couple's dot.
const UNION_EM = 0.625;
const ROW_GAP_EM = 6.25;
const TAG_EM = 1.125;

/**
 * Top of a far-couple tag's visible pill (height `tagH`) for a tag anchored at `y`, the card's
 * bottom edge. The pill hangs below the card and overlaps it only slightly, so it does not
 * cover the date line.
 */
export const tagTop = (geo: Geometry, y: number) => y - Math.round(0.1875 * geo.fontPx);

/**
 * The tag hangs from the card's bottom edge (see `tagTop`), in the part of the edge that no other
 * line leaves from. The visible tag is never wider than that part (`FarTag.zoneW`): renderers
 * truncate the text to fit it. Its hit area is at least 44×44 px and sits mostly below the card, so it takes
 * as little of the card's own tap area as possible. Nothing about it depends on names (names are
 * not part of the layout cache key).
 */
export function tagHit(zone: { x: number; w: number }, y: number, geo: Geometry): Rect {
	const w = Math.max(MIN_HIT, zone.w);
	const top = tagTop(geo, y) - 2;
	return { x: zone.x - w / 2, y: top, w, h: Math.max(MIN_HIT, geo.tagH + 4) };
}

/** Distance between sibling-bar lanes in one gap between rows (spec §5.3: 12 px at the default font). */
export const laneStep = (geo: Geometry) => 0.75 * geo.fontPx;

/**
 * Vertical and horizontal spacing of the lines in a gap between rows. The upper part of a gap
 * holds couple lanes (couple legs and their union dots, below any tag); the lower part holds
 * sibling-bar lanes, counted up from the next row.
 */
export interface LineMetrics {
	/** First couple lane, below the top of the gap: clear of a tag and of the dot's own radius. */
	coupleLane0: number;
	coupleLaneStep: number;
	/** Sibling-bar lane 0, above the bottom of the gap. */
	barDrop: number;
	barLaneStep: number;
	/** Free space between the couple lanes and the sibling-bar lanes. */
	clearance: number;
	/** Space kept between two horizontal lines that share a lane. */
	laneMargin: number;
	/** Where lines leave a card with a tag: this far in from its corners, then `exitStep` apart. */
	exitInset: number;
	exitStep: number;
	/** Where lines leave a card without a tag: `legStep` apart, beside the centre. */
	legStep: number;
	/** Space between a tag and the card edge or the nearest line that leaves the card. */
	tagInset: number;
}

/** The line-lane metrics for `geo`: see `LineMetrics`. */
export function lineMetrics(geo: Geometry): LineMetrics {
	const f = geo.fontPx;
	return {
		coupleLane0: tagTop(geo, 0) + geo.tagH + geo.unionSize / 2 + 0.125 * f,
		coupleLaneStep: geo.unionSize,
		barDrop: 0.3 * geo.rowGap,
		barLaneStep: laneStep(geo),
		clearance: 0.75 * f,
		laneMargin: 0.75 * f,
		exitInset: 0.75 * f,
		exitStep: 0.5 * f,
		legStep: 0.75 * f,
		tagInset: 0.5 * f,
	};
}

/** Height of a gap between rows that holds `couples` couple lanes and `bars` sibling-bar lanes. */
export function gapHeight(geo: Geometry, couples: number, bars: number): number {
	const m = lineMetrics(geo);
	const need = m.coupleLane0 + Math.max(0, couples - 1) * m.coupleLaneStep + geo.unionSize / 2 + m.clearance + Math.max(0, bars - 1) * m.barLaneStep + m.barDrop;
	return Math.max(geo.rowGap, need);
}

function sanitize(fontPx: number): number {
	return Number.isFinite(fontPx) && fontPx > 0 ? Math.min(Math.max(fontPx, 8), 48) : BASE_FONT_PX;
}

/** Builds the `down` geometry for a note font size and card size: see `GeometryFor`. */
export const geometryFor: GeometryFor = (fontPx, cardSize) => {
	const f = sanitize(fontPx);
	const size: CardSize = cardSize === 'compact' ? 'compact' : 'normal';
	const e = EMS[size];
	const px = (em: number) => Math.round(em * f);
	return {
		fontPx: f,
		cardSize: size,
		cardW: px(e.cardW),
		cardH: px(e.cardH),
		unionSize: px(UNION_EM),
		coupleGap: px(e.coupleGap),
		nodeGap: px(e.nodeGap),
		rowGap: px(ROW_GAP_EM),
		tagH: px(TAG_EM),
	};
};

/** The `normal`-size geometry at the default note font size, for tests and the spike. */
export const NORMAL_GEOMETRY: Geometry = geometryFor(BASE_FONT_PX, 'normal');

// D24 sideways spacing, in em of the note font (owner's answers to the preview).
const SIDE_COLUMN_EM = 3.5;
const SIDE_NARROW_COLUMN_EM = 3;
const SIDE_STACK_EM = 1.5;
const SIDE_PARTNER_EM = 1.5;
// The widest narrow card (the renderer asks for less in a smaller note box), and the narrowest.
const SIDE_NARROW_CARD_EM = 10.25;
const SIDE_NARROW_MIN_EM = 8;

/**
 * The width of a `narrow` sideways card: the renderer's `narrowCardW`, rounded to 0.5 px
 * (the cache key's precision, so one key never stands for two layouts) and clamped to
 * [8 em, 10.25 em]; 10.25 em when it is absent or not a number.
 */
export function narrowWidth(geo: Geometry, narrowCardW?: number): number {
	const max = Math.round(SIDE_NARROW_CARD_EM * geo.fontPx);
	if (typeof narrowCardW !== 'number' || !Number.isFinite(narrowCardW)) return max;
	return Math.min(max, Math.max(Math.round(SIDE_NARROW_MIN_EM * geo.fontPx), Math.round(narrowCardW * 2) / 2));
}
/** 0.2.1: the clear space, in px, a partnership sign keeps from both cards of its couple in a `sideways` layout. */
export const SIGN_CLEAR_PX = 3;

/**
 * 0.2.1, D24: the stack gap between the partners of a couple that has `unions` partnerships, in a `sideways`
 * layout. The signs are spread two sign sizes apart along the gap (`placeUnions`), so the gap must hold them
 * all with `SIGN_CLEAR_PX` to spare at both ends. Fewer than two partnerships keep the gap of `side` as it is.
 */
export function sidewaysPartnerGap(side: Geometry, unions: number): number {
	if (unions < 2) return side.coupleGap;
	const u = side.unionSize;
	// Half the height of the tallest sign: the ring (0.6 u plus half its 2.5 px outline) or the triangle's point (0.65 u plus half its 1.6 px outline).
	const reach = Math.max(0.6 * u + 1.25, 0.65 * u + 0.8);
	return Math.max(side.coupleGap, Math.ceil(2 * (unions - 1) * u + 2 * (reach + SIGN_CLEAR_PX)));
}

// In the turned frame the tag does not sit in the gap between generations; this only keeps the
// first couple lane, and its union dot, clear of the card edge.
const TURNED_TAG_EM = 0.375;

/**
 * The geometry a sideways layout (D24) draws with. Cards keep their height and text; `narrow`
 * cards take `narrowWidth` (8 to 10.25 em, never wider than `geo`'s). The gaps take their sideways meaning:
 * `rowGap` is the smallest gap between generation columns, `nodeGap` the gap between stacked cards,
 * `coupleGap` the gap between stacked partners (0.2.1: the layout widens it, with `sidewaysPartnerGap`, for a tree
 * with a couple of two or more partnerships; `drawnGeometry` does not know the tree, so it keeps the narrow value).
 */
export function sidewaysGeometry(geo: Geometry, cards: SidewaysCards, narrowCardW?: number): Geometry {
	const f = geo.fontPx;
	const narrow = cards === 'narrow';
	return {
		...geo,
		cardW: narrow ? Math.min(geo.cardW, narrowWidth(geo, narrowCardW)) : geo.cardW,
		rowGap: Math.round((narrow ? SIDE_NARROW_COLUMN_EM : SIDE_COLUMN_EM) * f),
		nodeGap: Math.round(SIDE_STACK_EM * f),
		coupleGap: Math.round(SIDE_PARTNER_EM * f),
	};
}

/** D40: how much taller every card is when the tree has a mark: one small (0.85 em) text line, whole px. */
export const relationExtra = (geo: Geometry) => Math.round(EMS[geo.cardSize].lineHeight * 0.85 * geo.fontPx);

/**
 * D40: `geo` with the relation text line (`LayoutSettings.relationLine`). A geometry that already
 * has it is returned as it is, so a drawn geometry passed back in does not grow a second time.
 */
export function withRelationLine(geo: Geometry, settings: LayoutSettings): Geometry {
	if (!settings.relationLine || geo.relationLine) return geo;
	return { ...geo, cardH: geo.cardH + relationExtra(geo), relationLine: true };
}

/** `TreeLayout.geometry` of a layout with `settings`, known before the layout runs (renderers measure names with it). */
export function drawnGeometry(geo: Geometry, settings: LayoutSettings): Geometry {
	const g = withRelationLine(geo, settings);
	return settings.orientation === 'sideways' ? sidewaysGeometry(g, settings.sidewaysCards ?? 'normal', settings.narrowCardW) : g;
}

/** Smallest tappable size in px (spec §7.5). */
export const MIN_HIT = 44;

/** Name size of the sideways first view (D24): layout hit areas are sized to be 44 px there. */
const SIDE_VIEW_NAME_PX = 14;

/**
 * The smallest side of a sideways far-couple tag's hit area: 44 px at the first view's 14 px
 * names, and never less than 44 layout px. The hit area hangs from the card's bottom edge into the
 * gap before the next card, so no card covers any of it (cards win over tag hit areas).
 */
export function sideTagDepth(geo: Geometry): number {
	return Math.max(MIN_HIT, Math.ceil((MIN_HIT * geo.fontPx) / SIDE_VIEW_NAME_PX));
}

/** Sideways: the space a far tag keeps from the bar of a partner stacked below (the tag's edge inset, or the dot's radius and 2 px). */
export const barClear = (geo: Geometry) => Math.max(lineMetrics(geo).tagInset, geo.unionSize / 2 + 2);

/**
 * The frame the arranger and the line planner work in for a sideways layout: a card's extent
 * along its generation is its real height, and "below" is "to the right". Built from the sideways
 * geometry alone, so routing can rebuild it from a finished layout.
 */
export function turnedGeometry(side: Geometry): Geometry {
	return { ...side, cardW: side.cardH, cardH: side.cardW, tagH: Math.round(TURNED_TAG_EM * side.fontPx) };
}

/**
 * D29, D81: how much taller a card is for each name text line after the first: one name text line,
 * whole px. The layout gives a card with a two-line name this much more height, a card with a
 * three-line name twice this (`PersonBox.h`, `PersonBox.tallName`, `PersonBox.longName`);
 * `cardText(geo, 2)` and `cardText(geo, 3)` place its text. A card with a two-line title text line (D61) is `relationExtra` taller.
 */
export const tallExtra = (geo: Geometry) => Math.round(EMS[geo.cardSize].lineHeight * 0.85 * geo.fontPx);

/** The name text size in em of the note font (D117: one size for all card text). */
const NAME_EM = 0.85;

/** D119: the name size of the phone preview's first view, in px; equal to `READABLE_NAME_PX` in `render/view-math.ts` (a test pins that). */
export const NAMES_ONLY_NAME_PX = 14;

/**
 * D119: the card height of the names-only card: a finger (44 px) at the 14 px first view, whole px.
 * 51 px at 16 px, 38 px at 12 px.
 */
export const namesOnlyCardH = (fontPx: number): number => Math.ceil((MIN_HIT * fontPx) / NAMES_ONLY_NAME_PX);

/** D119: `geo` for the names-only card. `relationLine` stays false: the card has no relation text line. */
export const namesOnlyGeometry = (geo: Geometry): Geometry => ({ ...geo, cardH: namesOnlyCardH(geo.fontPx), namesOnly: true });

/**
 * D126 (3), D129: the name slots of a card. A names-only card that has the D14 sign and a one-line name has two slots (the
 * second is empty), so the arms box and the portrait stay clear of the sign. The marked person's Compact card that has the sign
 * gets the same one text line more (`marked`): its pushed-down sign, the ring and the boxes then stay clear at every note font.
 */
export const nameSlots = (geo: Geometry, lines: NameLineCount, signed: boolean, marked = false): NameLineCount =>
	signed && lines === 1 && (geo.namesOnly || (marked && geo.cardSize === 'compact')) ? 2 : lines;

/** Where card text goes, so every renderer lays out the Full level of detail the same way. */
export interface CardText {
	/** Width of the house colour strip on the left edge (D27: 0.5 em). */
	stripW: number;
	/** Left edge of the text, from the card's left edge. */
	padX: number;
	/** Text width available before truncation. */
	textW: number;
	/** Font sizes in px: name, title and dates are all 0.85 em of the note font (D117, spec §5.8). */
	nameSize: number;
	smallSize: number;
	/** Baselines from the card's top edge. With no title, the dates take the title's line. */
	nameBaseline: number;
	/** D29, a tall card only: the baseline of the name's second text line. */
	name2Baseline?: number;
	/** D81, a card with a three-line name only: the baseline of the name's third text line. */
	name3Baseline?: number;
	titleBaseline: number;
	/** D61, a card with a two-line title text line only: the baseline of the title's second text line. */
	title2Baseline?: number;
	datesBaseline: number;
	/**
	 * D40, only when `Geometry.relationLine`: the baseline of the relation text line, the third small
	 * text line. The renderer moves it up one small line for each of the title and dates lines that the
	 * card does not show, as the dates move up today.
	 */
	relationBaseline?: number;
	/**
	 * The "illegitimate" sign (spec D14) in the card's top right corner: a dashed bar from
	 * top right to bottom left, like a heraldic baton sinister, dashed like an illegitimate line.
	 * Coordinates are from the card's top left corner; `dash` is the on and off length.
	 */
	sign: { x1: number; y1: number; x2: number; y2: number; width: number; dash: [number, number] };
	/** Name width before truncation on a card with the sign, so the name stops short of it. */
	nameWithSignW: number;
	/**
	 * M9 (D76, D78): the bottom of the text block (the name lines and every small text line place,
	 * the relation line included when the cards have one), from the card's top edge. The portrait's
	 * bottom sits here.
	 */
	textBottom: number;
}

/**
 * Text positions of a card, from its `PersonBox`. `names` is the number of name text lines (D29, D81):
 * 1, 2 or 3; a card with more has `tallExtra` more height for each, and the title and dates sit one
 * name text line lower for each. A boolean is still accepted (true is 2, false is 1). `tallTitle` (D61)
 * for a card that is `relationExtra` taller: two title text lines, and the dates and relation text
 * one small text line lower. The text block stays centred.
 */
export function cardText(geo: Geometry, nameCount: boolean | NameLineCount = 1, tallTitle = false): CardText {
	const f = geo.fontPx;
	const lh = EMS[geo.cardSize].lineHeight;
	const nameSize = NAME_EM * f;
	const smallSize = 0.85 * f;
	const nameLine = lh * nameSize;
	const smallLine = lh * smallSize;
	const names: NameLineCount = nameCount === true ? 2 : nameCount === false ? 1 : nameCount;
	// D119: the names-only card has the years line only: no title, no second title text line, no relation text line.
	const only = geo.namesOnly === true;
	const tall = tallTitle && !only;
	const relation = geo.relationLine === true && !only;
	// D40: `cardH` already holds the relation text line, the third small line.
	const smalls = only ? 1 : (relation ? 3 : 2) + (tall ? 1 : 0);
	const cardH = geo.cardH + (names - 1) * tallExtra(geo) + (tall ? relationExtra(geo) : 0);
	const top = (cardH - names * nameLine - smalls * smallLine) / 2;
	// Baseline of a line box: its middle plus about a third of the font size (Latin cap height ≈ 0.7 em).
	const baseline = (lineTop: number, line: number, size: number) => lineTop + line / 2 + 0.35 * size;
	const stripW = 0.5 * f;
	const padX = 0.875 * f;
	const textW = geo.cardW - padX - 0.5 * f;
	// Centred on the name's capitals and level with the text's right edge. Big and thick enough to
	// read as a bar at true size: two long dashes with one gap, not a row of dots (visual QA 3.4).
	const signSize = 1.125 * f;
	const signRight = geo.cardW - 0.5 * f;
	// Level with the middle of the first name text line, as in 0.2.3 (the name is 0.85 em now, so the sign sits 1.6 px higher at 16 px).
	const signTop = baseline(top, nameLine, nameSize) - 0.35 * nameSize - signSize / 2;
	const signGap = 0.25 * f;
	const signDash = (Math.SQRT2 * signSize - signGap) / 2;
	const small = top + names * nameLine;
	// D61: the title's second text line pushes every small line below it down by one.
	const titles = tall ? 2 : 1;
	return {
		stripW,
		padX,
		textW,
		nameSize,
		smallSize,
		nameBaseline: baseline(top, nameLine, nameSize),
		...(names > 1 ? { name2Baseline: baseline(top + nameLine, nameLine, nameSize) } : {}),
		...(names > 2 ? { name3Baseline: baseline(top + 2 * nameLine, nameLine, nameSize) } : {}),
		titleBaseline: baseline(small, smallLine, smallSize),
		...(tall ? { title2Baseline: baseline(small + smallLine, smallLine, smallSize) } : {}),
		datesBaseline: baseline(small + (only ? 0 : titles) * smallLine, smallLine, smallSize),
		...(relation ? { relationBaseline: baseline(small + (titles + 1) * smallLine, smallLine, smallSize) } : {}),
		sign: { x1: signRight, y1: signTop, x2: signRight - signSize, y2: signTop + signSize, width: 0.15625 * f, dash: [signDash, signGap] },
		nameWithSignW: textW - signSize - 0.5 * f,
		textBottom: small + smalls * smallLine,
	};
}

/**
 * D40: the baseline of a card's relation text, from its top edge. Like the dates, it moves up one
 * small text line for each of the title and dates lines that the card does not show; on a card with
 * a two-line title text line (`title2Baseline`, D61) the title counts as two. Undefined when the
 * cards have no relation line (`Geometry.relationLine`).
 */
export function relationY(t: CardText, hasTitle: boolean, hasDates: boolean): number | undefined {
	if (t.relationBaseline === undefined) return undefined;
	const two = t.title2Baseline !== undefined;
	const lines = two ? [t.titleBaseline, t.title2Baseline!, t.datesBaseline, t.relationBaseline] : [t.titleBaseline, t.datesBaseline, t.relationBaseline];
	return lines[(hasTitle ? (two ? 2 : 1) : 0) + (hasDates ? 1 : 0)];
}


/**
 * M9 picture sizes (D78, which replaced the first contract values): arms and portrait are both
 * `sizeLines` line heights high; the arms box is `armsAspect` of that wide; `armsGap` (em) is
 * the gap between the arms box and the portrait (D117: they sit side by side at the lower right); the Compact arms box is
 * `compactArmsW` × `compactArmsH` em (C4); `portraitGap` (em) is the gap between a narrowed text line and the portrait.
 */
export const PICTURE_EM = { sizeLines: 1.25, armsAspect: 5 / 6, armsGap: 0.3, compactArmsW: 1.5, compactArmsH: 1.8, portraitGap: 0.25 } as const;

/** G3: a text line is beside a box only when its line box overlaps the box's height by more than this, in px. */
export const PORTRAIT_OVERLAP_PX = 0.5;

/** D78: the height of the arms box and the portrait's diameter: 1.25 line heights (24 px on normal cards at 16 px). */
export const pictureSize = (geo: Geometry) => PICTURE_EM.sizeLines * EMS[geo.cardSize].lineHeight * geo.fontPx;

/** The arms boxes of one card (D67, D78, G2, D117). */
export interface ArmsPlace {
	/** Full level, card-relative: at the lower right, left of the portrait when the card has one; the box's bottom is the portrait's bottom. */
	full: Rect;
	/** Compact level, card-relative: at the right of the card, centred on its height. */
	compact: Rect;
	/** Compact: how far the Compact D14 sign moves left (1.8 em, B7). */
	compactShift: number;
}

/** D96: the clear space, in px, between the marked card's inner ring and the arms box, the portrait or the D14 sign. */
export const MARK_CLEAR_PX = 1.5;

/**
 * E4 (contract 4.2): the note font size from which a marked Normal card that has a D14 sign shows the arms and the portrait. The sign
 * is pushed down below the ring (`signBelowRing`) while the boxes stay at the bottom; below this size the two would come
 * within `MARK_CLEAR_PX` of each other, so such a card shows neither. The Compact card has no limit (D129): it is one text line higher.
 */
export const MARKED_SIGNED_BOX_MIN_FONT = 11;

/** False for a marked Normal card with the D14 sign at a note font below the limit (E4): it shows no arms box and no portrait. */
export const boxesShown = (geo: Geometry, marked: boolean, signed: boolean): boolean => !(marked && signed && geo.cardSize === 'normal' && geo.fontPx < MARKED_SIGNED_BOX_MIN_FONT);

/**
 * The bottom of the text block, from the card's top edge, less `lift`: where the portrait and the arms box end.
 * D96: on the marked card (`ring`, the ring's inner edge from the card's edge) it stays `MARK_CLEAR_PX` above the ring.
 */
const boxBottom = (t: CardText, boxH: number, ring: number | undefined, lift: number) => (ring === undefined ? t.textBottom : Math.min(t.textBottom, boxH - ring - MARK_CLEAR_PX)) - lift;

/**
 * The arms places of a card with text positions `t` and height `boxH` (D117). The Full box has the width 5/6 of
 * `pictureSize`, ends at the bottom of the portrait (`portrait`, from `portraitBox`) or, with none, at the bottom
 * of the text block, and its right edge is the portrait's left edge less `armsGap`, or the text's right edge. D96: for
 * the "This is me" card, `ring` is how far the inner edge of the ring lies inside the card's edge. `lift` (px, rule B) raises
 * the box. The arms no longer narrow the name or move the D14 sign.
 */
export function armsPlace(geo: Geometry, t: CardText, boxH: number, ring?: number, portrait?: Rect, lift = 0): ArmsPlace {
	const f = geo.fontPx;
	const h = pictureSize(geo);
	const w = PICTURE_EM.armsAspect * h;
	const cw = PICTURE_EM.compactArmsW * f;
	const ch = PICTURE_EM.compactArmsH * f;
	const floor = ring === undefined ? -Infinity : ring + MARK_CLEAR_PX;
	const right = portrait ? portrait.x - PICTURE_EM.armsGap * f : t.padX + t.textW;
	const bottom = portrait ? portrait.y + portrait.h : boxBottom(t, boxH, ring, lift);
	return {
		full: { x: right - w, y: bottom - h, w, h },
		compact: { x: geo.cardW - 0.5 * f - cw, y: Math.max(boxH / 2 - ch / 2, floor), w: cw, h: ch },
		compactShift: cw + PICTURE_EM.armsGap * f,
	};
}

/**
 * D76, D78: the portrait's square, card-relative: right edge at the text's right edge, bottom at the text block's bottom,
 * less `lift` (px, rule B). D96: for the "This is me" card, `mark` gives the card's height and the ring's inner edge; the
 * bottom then stays `MARK_CLEAR_PX` above the ring.
 */
export function portraitBox(geo: Geometry, t: CardText, mark?: { boxH: number; ring: number }, lift = 0): Rect {
	const d = pictureSize(geo);
	return { x: t.padX + t.textW - d, y: boxBottom(t, mark ? mark.boxH : 0, mark?.ring, lift) - d, w: d, h: d };
}

/**
 * D96: the D14 sign of the "This is me" card, moved down if its top edge would come closer than `MARK_CLEAR_PX`
 * to the ring's inner edge (`ring`, from the card's edge). A sign that is clear already is returned as it is.
 */
export function signBelowRing(sign: CardText['sign'], ring: number): CardText['sign'] {
	// The dashed bar has flat ends, so its top corner lies half a stroke width above the end point, at 45 degrees.
	const top = Math.min(sign.y1, sign.y2) - sign.width / (2 * Math.SQRT2);
	const dy = ring + MARK_CLEAR_PX - top;
	return dy > 0 ? { ...sign, y1: sign.y1 + dy, y2: sign.y2 + dy } : sign;
}

/**
 * D117, D125: the width of a text line (name or small) with its baseline at `baseline` and font size `size`, card-relative from
 * `padX`. It is the text width, less what the lower-right boxes take from a line that their height reaches: a box narrows the
 * line when their heights overlap by more than `PORTRAIT_OVERLAP_PX`; the line then ends a gap before the box.
 */
export function roomAt(geo: Geometry, t: CardText, baseline: number, size: number, boxes: readonly LowerRightBox[]): number {
	const line = EMS[geo.cardSize].lineHeight * size;
	const top = baseline - 0.35 * size - line / 2;
	let right = t.padX + t.textW;
	for (const b of boxes) if (Math.min(top + line, b.r.y + b.r.h) - Math.max(top, b.r.y) > PORTRAIT_OVERLAP_PX) right = Math.min(right, b.r.x - b.gap);
	return right - t.padX;
}

/**
 * D125 a: the room of the name text lines of a card (see `NameRoom`). `full` is the text width, less the D14 sign's room when
 * the card `signed`. `last` is the room of the card's final name slot. The text block is centred, so the final line has the same
 * place whatever the number of lines, and `last` is the same for a card of one, two or three slots. `only` (a name that stays on one
 * line) equals `last`, except on a names-only card that has the sign: it has two slots (D126 3), its one line sits in slot 1 above the
 * boxes, so `only` is `full`. `t` is the card's own text; a one-slot `t` of such a card is moved to the two-slot card here (the
 * boxes shift with the bottom of the text block).
 */
export function nameRoom(geo: Geometry, t: CardText, signed: boolean, boxes: readonly LowerRightBox[]): NameRoom {
	const full = signed ? t.nameWithSignW : t.textW;
	let text = t;
	let at = boxes;
	const twoSlot = geo.namesOnly === true && signed;
	if (twoSlot && t.name2Baseline === undefined) {
		text = cardText(geo, 2);
		const dy = text.textBottom - t.textBottom;
		at = boxes.map((b) => ({ gap: b.gap, r: { ...b.r, y: b.r.y + dy } }));
	}
	const finalBaseline = text.name3Baseline ?? text.name2Baseline ?? text.nameBaseline;
	const last = Math.min(full, roomAt(geo, text, finalBaseline, text.nameSize, at));
	return { full, last, only: twoSlot ? full : last };
}

/** The height of one small (0.85 em) text line in px, not rounded: the lift of rule B (D126 4). */
export const smallLineOf = (geo: Geometry) => EMS[geo.cardSize].lineHeight * 0.85 * geo.fontPx;

/** The lower-right boxes of one card, with the gaps that `roomAt` needs (the arms box 0.3 em from the portrait, the portrait 0.25 em from the text). */
export interface CardBoxes {
	arms?: ArmsPlace;
	portrait?: Rect;
	boxes: LowerRightBox[];
}

/**
 * The portrait and the arms box of a Full card in one call, so the layout, the scene and the saved picture place them alike. `boxH` is the
 * card's height, `ring` the "This is me" ring's inner edge (D96), `lift` the rule B lift in px. A box that is not wanted is left out.
 */
export function cardBoxes(geo: Geometry, t: CardText, boxH: number, o: { arms: boolean; portrait: boolean; ring?: number; lift?: number }): CardBoxes {
	const f = geo.fontPx;
	const lift = o.lift ?? 0;
	const portrait = o.portrait ? portraitBox(geo, t, o.ring === undefined ? undefined : { boxH, ring: o.ring }, lift) : undefined;
	const arms = o.arms ? armsPlace(geo, t, boxH, o.ring, portrait, lift) : undefined;
	return {
		...(arms ? { arms } : {}),
		...(portrait ? { portrait } : {}),
		boxes: [...(arms ? [{ r: arms.full, gap: PICTURE_EM.armsGap * f }] : []), ...(portrait ? [{ r: portrait, gap: PICTURE_EM.portraitGap * f }] : [])],
	};
}

/** Radius of the focus-mode "+" badge in em; the same number as `BADGE_RADIUS_EM` in `render/dom/scene.ts` (a test pins it). */
const BADGE_EM = 0.6;

/** The distance from the stroked D14 sign (its bar, less half its width) to a rectangle, sampled along the bar. */
function signGap(s: CardText['sign'], r: Rect): number {
	const n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 0.1));
	let best = Infinity;
	for (let i = 0; i <= n; i++) {
		const x = s.x1 + ((s.x2 - s.x1) * i) / n;
		const y = s.y1 + ((s.y2 - s.y1) * i) / n;
		best = Math.min(best, Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h))));
	}
	return best - s.width / 2;
}

/**
 * E4 (contract 4.2): true when the boxes keep `MARK_CLEAR_PX` from the D14 sign (when the card is `signed`; on the marked card the sign is
 * the one below the ring), from the disc of the "+" badge at the card's top right corner, and (marked card) from the ring's inner edge.
 * `tallCardsFor` asks it before it lifts the boxes (rule B): a lift that would fail it is not made.
 */
export function boxesClear(geo: Geometry, t: CardText, boxes: readonly Rect[], o: { signed: boolean; ring?: number }): boolean {
	const sign = o.ring === undefined ? t.sign : signBelowRing(t.sign, o.ring);
	const r = BADGE_EM * geo.fontPx;
	for (const b of boxes) {
		if (o.signed && signGap(sign, b) < MARK_CLEAR_PX) return false;
		const dx = Math.max(b.x - geo.cardW, 0, geo.cardW - (b.x + b.w));
		const dy = Math.max(b.y, 0, -(b.y + b.h));
		if (Math.hypot(dx, dy) - r < MARK_CLEAR_PX) return false;
		if (o.ring !== undefined && b.y - o.ring < MARK_CLEAR_PX) return false;
	}
	return true;
}

/** D29, D81: the number of name text lines a card was made for (`tallName`, `longName`). */
export const nameCountOf = (box: { tallName?: true; longName?: true }): NameLineCount => (box.longName ? 3 : box.tallName ? 2 : 1);
