/**
 * Turns a note's font size into the card and gap sizes a tree draws with (spec §5.8), and the line
 * lane layout of the gaps between rows. `layout.ts` and `lines.ts` call these functions to size
 * and place cards; `render/dom/scene.ts` and `render/svg-string.ts` call `cardText`, `isTall` and
 * `tagTop` to draw and measure the same card the layout used, so every level of detail agrees on
 * where the text sits (spec §5.4). `NORMAL_GEOMETRY` is used only by scripts and tests.
 */
import type { CardSize, Geometry, GeometryFor, LayoutSettings, SidewaysCards } from './model';

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

/** `TreeLayout.geometry` of a layout with `settings`, known before the layout runs (renderers measure names with it). */
export function drawnGeometry(geo: Geometry, settings: LayoutSettings): Geometry {
	return settings.orientation === 'sideways' ? sidewaysGeometry(geo, settings.sidewaysCards ?? 'normal', settings.narrowCardW) : geo;
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
 * D29: how much taller a card with a two-line name is: one name text line, whole px. The layout
 * gives such a card this much more height (`PersonBox.h`); `cardText(geo, true)` places its text.
 */
export const tallExtra = (geo: Geometry) => Math.round(EMS[geo.cardSize].lineHeight * geo.fontPx);

/** A card the layout made taller for a two-line name (D29): renderers read it from the box, not the settings. */
export const isTall = (geo: Geometry, box: { h: number }) => box.h > geo.cardH + 0.5;

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
	titleBaseline: number;
	datesBaseline: number;
	/**
	 * The "illegitimate" sign (spec D14) in the card's top right corner: a dashed bar from
	 * top right to bottom left, like a heraldic baton sinister, dashed like an illegitimate line.
	 * Coordinates are from the card's top left corner; `dash` is the on and off length.
	 */
	sign: { x1: number; y1: number; x2: number; y2: number; width: number; dash: [number, number] };
	/** Name width before truncation on a card with the sign, so the name stops short of it. */
	nameWithSignW: number;
}

/**
 * Text positions of a card; `tall` (D29) for a card that is `tallExtra` taller: two name text
 * lines, and the title and dates one name text line lower. The text block stays centred.
 */
export function cardText(geo: Geometry, tall = false): CardText {
	const f = geo.fontPx;
	const lh = EMS[geo.cardSize].lineHeight;
	const nameSize = f;
	const smallSize = 0.85 * f;
	const nameLine = lh * nameSize;
	const smallLine = lh * smallSize;
	const names = tall ? 2 : 1;
	const cardH = tall ? geo.cardH + tallExtra(geo) : geo.cardH;
	const top = (cardH - names * nameLine - 2 * smallLine) / 2;
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
	return {
		stripW,
		padX,
		textW,
		nameSize,
		smallSize,
		nameBaseline: baseline(top, nameLine, nameSize),
		...(tall ? { name2Baseline: baseline(top + nameLine, nameLine, nameSize) } : {}),
		titleBaseline: baseline(small, smallLine, smallSize),
		datesBaseline: baseline(small + smallLine, smallLine, smallSize),
		sign: { x1: signRight, y1: signTop, x2: signRight - signSize, y2: signTop + signSize, width: 0.15625 * f, dash: [signDash, signGap] },
		nameWithSignW: textW - signSize - 0.5 * f,
	};
}
