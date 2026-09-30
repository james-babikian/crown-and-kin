/**
 * Turns a note's font size into the card and gap sizes a tree draws with (spec §5.8), and the line
 * lane layout of the gaps between rows. `layout.ts` and `lines.ts` call these functions to size
 * and place cards; `render/dom/scene.ts` and `render/svg-string.ts` call `cardText` (with the
 * card's `PersonBox.tallName` and `tallTitle`) and `tagTop` to draw and measure the same card the
 * layout used, so every level of detail agrees on where the text sits (spec §5.4). `NORMAL_GEOMETRY` is used only by scripts and tests.
 * M9: the places of the arms and the portrait on a card (`armsPlace`, `portraitBox`) and the width of
 * a small text line beside the portrait (`smallTextWidth`), shared by the same renderers. Owner
 * decision D78 made the arms and the portrait the same height: 1.25 name text lines (1.5 em on
 * normal cards), so both fit on a card with no relation line. The arms narrow only the name (and
 * move the D14 sign left); the portrait narrows only the small text lines beside it, which are cut
 * with "…". No picture adds a text line or changes a card's height, so pictures never move a card.
 */
import type { CardSize, Geometry, GeometryFor, LayoutSettings, NameLineCount, Rect, SidewaysCards } from './model';

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
	// 3 lines (1 em name + two 0.85 em lines) at 1.2 line height take 3.24 em; 4 em leaves ~0.38 em padding.
	normal: { cardW: 11.25, cardH: 4, coupleGap: 2.25, nodeGap: 1.25, lineHeight: 1.2 },
	// Narrower, tighter cards (spec §9 "Card size: compact"); still 3 lines at 1.1 line height.
	compact: { cardW: 9, cardH: 3.5, coupleGap: 2, nodeGap: 1, lineHeight: 1.1 },
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
// In the turned frame the tag does not sit in the gap between generations; this only keeps the
// first couple lane, and its union dot, clear of the card edge.
const TURNED_TAG_EM = 0.375;

/**
 * The geometry a sideways layout (D24) draws with. Cards keep their height and text; `narrow`
 * cards take `narrowWidth` (8 to 10.25 em, never wider than `geo`'s). The gaps take their sideways meaning:
 * `rowGap` is the smallest gap between generation columns, `nodeGap` the gap between stacked cards,
 * `coupleGap` the gap between stacked partners.
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
export const tallExtra = (geo: Geometry) => Math.round(EMS[geo.cardSize].lineHeight * geo.fontPx);

/** Where card text goes, so every renderer lays out the Full level of detail the same way. */
export interface CardText {
	/** Width of the house colour strip on the left edge (D27: 0.5 em). */
	stripW: number;
	/** Left edge of the text, from the card's left edge. */
	padX: number;
	/** Text width available before truncation. */
	textW: number;
	/** Font sizes in px: name 1 em, title and dates 0.85 em (spec §5.8). */
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
	const nameSize = f;
	const smallSize = 0.85 * f;
	const nameLine = lh * nameSize;
	const smallLine = lh * smallSize;
	const names: NameLineCount = nameCount === true ? 2 : nameCount === false ? 1 : nameCount;
	// D40: `cardH` already holds the relation text line, the third small line.
	const smalls = (geo.relationLine ? 3 : 2) + (tallTitle ? 1 : 0);
	const cardH = geo.cardH + (names - 1) * tallExtra(geo) + (tallTitle ? relationExtra(geo) : 0);
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
	const signTop = baseline(top, nameLine, nameSize) - 0.35 * f - signSize / 2;
	const signGap = 0.25 * f;
	const signDash = (Math.SQRT2 * signSize - signGap) / 2;
	const small = top + names * nameLine;
	// D61: the title's second text line pushes every small line below it down by one.
	const titles = tallTitle ? 2 : 1;
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
		...(tallTitle ? { title2Baseline: baseline(small + smallLine, smallLine, smallSize) } : {}),
		datesBaseline: baseline(small + titles * smallLine, smallLine, smallSize),
		...(geo.relationLine ? { relationBaseline: baseline(small + (titles + 1) * smallLine, smallLine, smallSize) } : {}),
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
 * `sizeLines` name text lines high; the arms box is `armsAspect` of that wide; `armsGap` (em) is
 * the gap between the name and the arms; the Compact arms box is `compactArmsW` × `compactArmsH`
 * em (C4); `portraitGap` (em) is the gap between a narrowed text line and the portrait.
 */
export const PICTURE_EM = { sizeLines: 1.25, armsAspect: 5 / 6, armsGap: 0.3, compactArmsW: 1.5, compactArmsH: 1.8, portraitGap: 0.25 } as const;

/** G3: a small text line is beside the portrait only when its line box overlaps the circle by more than this, in px. */
export const PORTRAIT_OVERLAP_PX = 0.5;

/** D78: the height of the arms box and the portrait's diameter: 1.25 name text lines (24 px on normal cards at 16 px). */
export const pictureSize = (geo: Geometry) => PICTURE_EM.sizeLines * EMS[geo.cardSize].lineHeight * geo.fontPx;

/** The arms boxes of one card and how far the names and the D14 signs move left for them (D67, D78, G2). */
export interface ArmsPlace {
	/** Full level, card-relative: right edge at the text's right edge, centred on the first name text line. */
	full: Rect;
	/** Compact level, card-relative: at the right of the card, centred on its height. */
	compact: Rect;
	/** Full: how much narrower the name is and how far the D14 sign moves left (box + 0.3 em, 1.55 em on normal cards). */
	shift: number;
	/** Compact: how far the Compact D14 sign moves left (1.8 em, B7). */
	compactShift: number;
}

/**
 * The arms places of a card with text positions `t`, height `boxH` and a sideways `+` badge cut
 * `cut` (0 without a badge; the arms, the sign and the name all move left by it). The picture keeps
 * its own proportions inside the box (D75), so only the box is fixed here.
 */
export function armsPlace(geo: Geometry, t: CardText, boxH: number, cut: number): ArmsPlace {
	const f = geo.fontPx;
	const h = pictureSize(geo);
	const w = PICTURE_EM.armsAspect * h;
	// The centre of the first name line box (its baseline sits 0.35 em below the middle).
	const nameMiddle = t.nameBaseline - 0.35 * t.nameSize;
	const cw = PICTURE_EM.compactArmsW * f;
	const ch = PICTURE_EM.compactArmsH * f;
	return {
		full: { x: t.padX + t.textW - cut - w, y: nameMiddle - h / 2, w, h },
		compact: { x: geo.cardW - 0.5 * f - cut - cw, y: boxH / 2 - ch / 2, w: cw, h: ch },
		shift: w + PICTURE_EM.armsGap * f,
		compactShift: cw + PICTURE_EM.armsGap * f,
	};
}

/** D76, D78: the portrait's square, card-relative: right edge at the text's right edge, bottom at the text block's bottom. */
export function portraitBox(geo: Geometry, t: CardText): Rect {
	const d = pictureSize(geo);
	return { x: t.padX + t.textW - d, y: t.textBottom - d, w: d, h: d };
}

/**
 * G3, D76, D77: the width of a small text line (title, second title line, dates, relation) whose
 * baseline is at `baseline`, card-relative. Beside the portrait (its line box overlaps the circle's
 * height by more than 0.5 px) the line is narrower by the portrait and a 0.25 em gap; else it keeps
 * `textW`. The name never uses this: it never narrows for a portrait.
 */
export function smallTextWidth(geo: Geometry, t: CardText, baseline: number, portrait: Rect | undefined): number {
	if (!portrait) return t.textW;
	const line = EMS[geo.cardSize].lineHeight * t.smallSize;
	const top = baseline - 0.35 * t.smallSize - line / 2;
	const overlap = Math.min(top + line, portrait.y + portrait.h) - Math.max(top, portrait.y);
	return overlap > PORTRAIT_OVERLAP_PX ? t.textW - portrait.w - PICTURE_EM.portraitGap * geo.fontPx : t.textW;
}

/**
 * L5 (D76, D77, spec §13.9): the width of name text line `line` (1 to `names`) of a card. It is the
 * text width less `shift` (the arms, the badge room). A line whose box overlaps the portrait's circle
 * by more than 0.5 px is narrower by the portrait and a 0.25 em gap; the breaks stay where they were
 * made at the wider width, so the line is only cut shorter and the card does not change height.
 */
export function nameTextWidth(geo: Geometry, t: CardText, line: NameLineCount, names: NameLineCount, portrait: Rect | undefined, shift: number): number {
	const width = t.textW - shift;
	const baseline = [t.nameBaseline, t.name2Baseline, t.name3Baseline][line - 1];
	if (!portrait || line > names || baseline === undefined) return width;
	const height = EMS[geo.cardSize].lineHeight * t.nameSize;
	const top = baseline - 0.35 * t.nameSize - height / 2;
	const overlap = Math.min(top + height, portrait.y + portrait.h) - Math.max(top, portrait.y);
	return overlap > PORTRAIT_OVERLAP_PX ? width - portrait.w - PICTURE_EM.portraitGap * geo.fontPx : width;
}

/** D29, D81: the number of name text lines a card was made for (`tallName`, `longName`). */
export const nameCountOf = (box: { tallName?: true; longName?: true }): NameLineCount => (box.longName ? 3 : box.tallName ? 2 : 1);
