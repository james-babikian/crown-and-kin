/**
 * Turns a note's font size into the card and gap sizes a tree draws with (spec §5.8), and the line
 * lane layout of the gaps between rows. `plan.ts`, `ports.ts` and `route.ts` call these functions to size
 * and place cards; `render/dom/scene.ts` and `render/svg-string.ts` call `cardText` (with the
 * card's `PersonBox.tallName` and `tallTitle`) and `tagTop` to draw and measure the same card the
 * layout used, so every level of detail agrees on where the text sits (spec §5.4). `NORMAL_GEOMETRY` is used only by scripts and tests.
 * D78 made the arms and the portrait the same height: 1.25 line heights (1.5 em).
 * 0.2.5 (CONTRACT section B): a card has one of two forms, set by `cardForm` (`Geometry.form`). The Roundel (`form: 'roundel'`, a tree
 * from top to bottom) has a round portrait on its top edge, its text centred on an axis, and a footer plate for the relation word.
 * The text card (`form: 'text'`, a sideways tree) has its text at the left, no pictures, and the same plate. 0.2.6 (D179): the card
 * size setting and the classic card (arms and portrait at the lower right) are gone. A geometry with no form (tests, the layout) has
 * the numbers and the text places of the text card. `withRelationLine` sets every height that depends on the tree (plate, crown,
 * reach); `cardText`, `nameRoom`, `roundelPics`, `youTabRect` and `ordinalTabRect` place what the scene and the saved picture draw.
 * 0.2.7 (F.4): a card of the Show view of a line of succession can carry an ordinal tab ("2nd") on its top edge, as the marked card
 * carries its "You" tab; `LayoutSettings.ordinalCards` makes the reach for it and the route stage keeps the drop places clear of it.
 */
import type { Geometry, GeometryFor, LayoutSettings, NameLineCount, NameRoom, Orientation, Rect } from './model';

/** Obsidian's default note font size; the card geometry (180×64 cards) was tuned at this size. */
export const BASE_FONT_PX = 16;

// Sizes in em of the note font (spec §5.8: geometry follows the font).
// D117: all text is 0.85 em, so 3 lines at 1.2 line height take 3.06 em; 3.8 em keeps the padding of 0.2.3.
const CARD_W_EM = 11.25;
const CARD_H_EM = 3.8;
const COUPLE_GAP_EM = 2.25;
const NODE_GAP_EM = 1.25;
/** Line height of the card text, as a multiple of each line's font size. */
const LINE_HEIGHT = 1.2;

// The gap between rows must hold union dots, far-couple tags
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

function sanitize(fontPx: number): number {
	return Number.isFinite(fontPx) && fontPx > 0 ? Math.min(Math.max(fontPx, 8), 48) : BASE_FONT_PX;
}

/** Builds the `down` geometry for a note font size: see `GeometryFor`. */
export const geometryFor: GeometryFor = (fontPx) => {
	const f = sanitize(fontPx);
	const px = (em: number) => Math.round(em * f);
	return {
		fontPx: f,
		cardW: px(CARD_W_EM),
		cardH: px(CARD_H_EM),
		unionSize: px(UNION_EM),
		coupleGap: px(COUPLE_GAP_EM),
		nodeGap: px(NODE_GAP_EM),
		rowGap: px(ROW_GAP_EM),
		tagH: px(TAG_EM),
	};
};

/** The geometry at the default note font size, for tests and the spike. */
export const NORMAL_GEOMETRY: Geometry = geometryFor(BASE_FONT_PX);

// D24 sideways spacing, in em of the note font (owner's answers to the preview).
const SIDE_COLUMN_EM = 3.5;
const SIDE_STACK_EM = 1.5;
const SIDE_PARTNER_EM = 1.5;
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
 * The geometry a sideways layout (D24) draws with. Cards keep their size and text. The gaps take their sideways meaning:
 * `rowGap` is the smallest gap between generation columns, `nodeGap` the gap between stacked cards,
 * `coupleGap` the gap between stacked partners (0.2.1: the layout widens it, with `sidewaysPartnerGap`, for a tree
 * with a couple of two or more partnerships; `drawnGeometry` does not know the tree, so it keeps the one-partnership value).
 */
export function sidewaysGeometry(geo: Geometry): Geometry {
	const f = geo.fontPx;
	return {
		...geo,
		rowGap: Math.round(SIDE_COLUMN_EM * f),
		nodeGap: Math.round(SIDE_STACK_EM * f),
		coupleGap: Math.round(SIDE_PARTNER_EM * f),
	};
}

/** D40: how much taller every card is when the tree has a mark: one small (0.85 em) text line, whole px. */
export const relationExtra = (geo: Geometry) => Math.round(LINE_HEIGHT * 0.85 * geo.fontPx);

/** 0.2.5 (B.2): true for the Roundel, the top-to-bottom card with a medallion on its top edge (`cardForm`). */
export const isRoundel = (geo: Geometry): boolean => geo.form === 'roundel';

/**
 * D40, 0.2.5: `geo` with everything that depends on the tree and the settings, in ONE place: the plate or relation text line
 * (`LayoutSettings.relationLine`, one small text line taller), the Roundel's crown when the tree has a picture (`settings.arms`, `settings.personalArms` or
 * `settings.portraits` not empty; the text card has none) and `reach`, the space the first row keeps for what sticks out above
 * a card (B.3.4: the medallion's halo, or the "You" tab of `settings.youTab`, or the ordinal tab of `settings.ordinalCards`: both stand at the same height). A geometry that already has `relationLine`, `crown`
 * or `reach` is returned as it is, so a drawn geometry passed back in does not grow a second time; a value that is 0 is never stored.
 */
export function withRelationLine(geo: Geometry, settings: LayoutSettings): Geometry {
	if (geo.relationLine || geo.crown !== undefined || geo.reach !== undefined) return geo;
	const f = geo.fontPx;
	const roundel = isRoundel(geo);
	const crown = roundel && (settings.arms?.length || settings.personalArms?.length || settings.portraits?.length) ? Math.round(ROUNDEL_EM.crown * f) : 0;
	const plate = settings.relationLine === true;
	// The tab's top with its stroke must lie inside the reach, so the first row never starts above the drawing's edge.
	// The halo of a portrait ends below the crown: the text is centred under it, so a card with a portrait does not look top-heavy. Tree-wide, so the names of a row stay level.
	const textTop = crown && settings.portraits?.length ? Math.round((ROUNDEL_EM.medal + ROUNDEL_EM.ring + ROUNDEL_EM.halo - ROUNDEL_EM.above) * f) : 0;
	const reach = crown ? Math.ceil(ROUNDEL_EM.reach * f) : settings.youTab !== undefined || settings.ordinalCards?.length ? Math.ceil((roundel ? ROUNDEL_EM.tabAbove : ROUNDEL_EM.tabAboveText) * f + TAB_REACH_PAD_PX) : 0;
	if (!crown && !reach && !plate) return geo;
	return { ...geo, cardH: geo.cardH + crown + (plate ? relationExtra(geo) : 0), ...(crown ? { crown } : {}), ...(textTop > crown ? { textTop } : {}), ...(reach ? { reach } : {}), ...(plate ? { relationLine: true as const } : {}) };
}

/** `TreeLayout.geometry` of a layout with `settings`, known before the layout runs (renderers measure names with it). */
export function drawnGeometry(geo: Geometry, settings: LayoutSettings): Geometry {
	const g = withRelationLine(geo, settings);
	return settings.orientation === 'sideways' ? sidewaysGeometry(g) : g;
}

/**
 * 0.2.5 (D143, D150): the card form for an orientation. Down gives 'roundel'; sideways gives 'text' (D179: no card size is left).
 * It changes no number (no `cardH`, `crown` or `reach`) and is idempotent.
 */
export function cardForm(geo: Geometry, orientation: Orientation): Geometry {
	const form = orientation === 'sideways' ? 'text' : 'roundel';
	return geo.form === form ? geo : { ...geo, form };
}

/** px: how far the plate's right end and bottom lie inside the card edge (an unmarked card; the marked card's word is "You" and is short). */
export const PLATE_INSET_PX = 1;

/**
 * 0.2.8 (contract C, G.15): the house ribbon and the foot hairline of a card. The ribbon is `em` of the note font thick (at least `minPx`) along the
 * top edge of a top-to-bottom card and the left edge of a sideways one. The sideways hairline starts `footGapEm` after the ribbon and ends the same distance before the right edge,
 * so it never touches the ribbon; the top-to-bottom hairline runs from edge to edge, 1 px (or the border of the marked card) in.
 */
export const RIBBON = { em: 0.3, minPx: 3, footGapEm: 0.35 } as const;

/** The thickness of the house ribbon in px: 0.3 em, never under 3 px. */
export const ribbonWidth = (geo: Geometry): number => Math.max(RIBBON.minPx, Math.round(RIBBON.em * geo.fontPx));

/** The ends of the foot hairline across a card of width `w`, card-relative; `inset` is how far a top-to-bottom hairline stays inside the edge (the marked card's border). */
export function footSpan(geo: Geometry, w: number, inset = 1): { x0: number; x1: number } {
	if (isRoundel(geo)) return { x0: inset, x1: w - inset };
	const gap = Math.round(RIBBON.footGapEm * geo.fontPx);
	return { x0: ribbonWidth(geo) + gap, x1: w - gap };
}

/** em: the room that a relation word keeps from the colour bar and from the plate's right end, so a cut word never touches them. */
export const WORD_CLEAR_EM = 0.125;

/**
 * 0.2.5 (B.2): the sizes of the Roundel card, in em of the note font; the layout, the scene and the saved picture read these and no other number.
 * D219: `ring` is no longer a drawn ring: it is the width that the portrait picture takes beyond `medal`. `halo` is the width of the gap in the colour of the page
 * round the portrait and round the arms (the gap of the arms follows the outline of the picture, `arms-outline.ts`).
 */
export const ROUNDEL_EM = { crown: 0.75, reach: 1.6, medal: 1, ring: 0.15, halo: 0.2, above: 0.25, column: 10, plateMore: 0.25, armsGap: 0.55, tabW: 2.3, tabH: 1.15, tabAbove: 0.55, tabAboveText: 0.9, wordRaise: 0.15 } as const;

/**
 * 0.2.7 (F.4): the sizes of the ordinal tab, in em of the note font. Its width is fixed by the number of characters, so the live scene and the
 * saved picture agree with no measure function; it is wider than the "You" tab because its text is 0.85 em and bold. The `right...` numbers are how far
 * the tab's right edge lies left of the card axis (Roundel): 1.6 em keeps 0.25 em from the portrait's halo (1.35 em). `textCardLeft` is its left edge in a text card.
 */
export const ORDINAL_EM = { width3: 2.3, width4: 2.7, widthMore: 0.4, text: 0.8, corner: 0.2, rightPortrait: 1.9, rightArms: 1.75, rightNone: 0.4, textCardLeft: 0.875 } as const;

/** px: the margin a "You" tab adds to its height above the card top when `reach` is computed (half of its 1.5 px stroke, rounded up). */
export const TAB_REACH_PAD_PX = 1;

/** px: a Roundel name line gets the full 10 em column only if its box top is at least this far below the D14 sign bar (B.3.2). */
export const SIGN_LINE_CLEAR_PX = 5;

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
 * The frame the placement and the route stages work in for a sideways layout: a card's extent
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
export const tallExtra = relationExtra;

/** The name text size in em of the note font (D117: one size for all card text). */
const NAME_EM = 0.85;

/** Where card text goes, so every renderer lays out the Full level of detail the same way. */
export interface CardText {
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
	/** 0.2.5, Roundel and text card: the x of the text anchor from the card's left edge (the card axis for the Roundel, `padX` for the text card). */
	anchorX?: number;
	/** 0.2.5, Roundel only: the text lines are centred on `anchorX` (SVG `text-anchor: middle`). */
	middle?: true;
	/**
	 * 0.2.5, Roundel and text card: the card axis and the crown height (card-relative px), and the footer plate when the card has
	 * one (`Geometry.relationLine`): its top `y` and height `h`. The relation word sits on the plate at `relationBaseline`.
	 */
	r1?: { axis: number; crown: number; plate?: { y: number; h: number } };
	/**
	 * 0.2.5 (B7), Roundel and text card with a plate: the width the relation word may use. The Roundel centres it on the axis inside the
	 * plate; the text card starts it at `padX` and ends it at the plate's end. Wider than `textW`, which every other text line keeps.
	 */
	relationW?: number;
}

/** 0.2.5: which small text lines a Roundel or text card has, so the lines that exist are centred in the body. */
export interface ShownLines {
	title: boolean;
	dates: boolean;
}

/**
 * Text positions of a card, from its `PersonBox`. `names` is the number of name text lines (D29, D81):
 * 1, 2 or 3; a card with more has `tallExtra` more height for each, and the title and dates sit one
 * name text line lower for each. A boolean is still accepted (true is 2, false is 1). `tallTitle` (D61)
 * for a card that is `relationExtra` taller: two title text lines, and the dates and relation text
 * one small text line lower. The text block stays centred. 0.2.5: the Roundel and the text card (`Geometry.form`) centre the lines
 * that exist (`shown`; absent means a title and a dates line) in the body between the crown and the plate.
 */
export function cardText(geo: Geometry, nameCount: boolean | NameLineCount = 1, tallTitle = false, shown?: ShownLines): CardText {
	return formText(geo, nameCount === true ? 2 : nameCount === false ? 1 : nameCount, tallTitle, shown);
}

/**
 * 0.2.6 (D177 item 10, B7): the text of a card that has no relation word, in a tree whose cards have a relation line. The card keeps its
 * height; the text block moves down by half of the empty strip (the plate), so it is centred in the whole card. A Roundel with a crown keeps its sign at the top edge. The text card: the sign moves with the name.
 */
export function centredWithoutWord(geo: Geometry, t: CardText): CardText {
	if (geo.relationLine !== true) return t;
	const dy = (t.r1?.plate?.h ?? 0) / 2;
	if (dy === 0) return t;
	const signDy = isRoundel(geo) && t.r1 && t.r1.crown > 0 ? 0 : dy;
	return {
		...t,
		nameBaseline: t.nameBaseline + dy,
		...(t.name2Baseline !== undefined ? { name2Baseline: t.name2Baseline + dy } : {}),
		...(t.name3Baseline !== undefined ? { name3Baseline: t.name3Baseline + dy } : {}),
		titleBaseline: t.titleBaseline + dy,
		...(t.title2Baseline !== undefined ? { title2Baseline: t.title2Baseline + dy } : {}),
		datesBaseline: t.datesBaseline + dy,
		textBottom: t.textBottom + dy,
		sign: { ...t.sign, y1: t.sign.y1 + signDy, y2: t.sign.y2 + signDy },
	};
}

/**
 * D40: the baseline of a card's relation text, from its top edge: the word sits on the plate whatever other lines the card has.
 * Undefined when the cards have no relation line (`Geometry.relationLine`).
 */
export const relationY = (t: CardText): number | undefined => t.relationBaseline;

/**
 * M9 picture sizes (D78): arms and portrait are both `sizeLines` line heights high; the arms box is `armsAspect` of that wide.
 */
export const PICTURE_EM = { sizeLines: 1.25, armsAspect: 5 / 6 } as const;

/** D78: the height of the arms box and the portrait's diameter: 1.25 line heights (24 px at 16 px). */
export const pictureSize = (geo: Geometry) => PICTURE_EM.sizeLines * LINE_HEIGHT * geo.fontPx;

/** D96: the clear space, in px, between the marked card's inner ring and the D14 sign. */
export const MARK_CLEAR_PX = 1.5;

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
 * D125 a: the room of the name text lines of a card (see `NameRoom`). `full` is the text width, less the D14 sign's room when
 * the card `signed`. `last` is the room of the card's final name slot. `only` (a name that stays on one line) equals `last`. `t` is
 * the card's own text; `ring` is the marked card's ring edge (the Roundel's room depends on it). No picture narrows a line (D179).
 */
export function nameRoom(geo: Geometry, t: CardText, signed: boolean, ring?: number): NameRoom {
	if (!isRoundel(geo)) return signed ? { full: t.nameWithSignW, last: t.nameWithSignW, only: t.nameWithSignW } : { full: t.textW, last: t.textW, only: t.textW };
	if (!signed) return { full: t.textW, last: t.textW, only: t.textW };
	const last = lastLineClearsSign(geo, ring) ? t.textW : t.nameWithSignW;
	return { full: t.nameWithSignW, last, only: t.nameWithSignW };
}

/** The lowest point of the stroked D14 sign: its lower end, plus the corner of the flat end of the bar. */
export const signBottomOf = (s: CardText['sign']): number => Math.max(s.y1, s.y2) + s.width / (2 * Math.SQRT2);

/** The answers of `lastLineClearsSign`, per geometry object and per ring (-1 = no ring): one `cardText(geo, 2)` for every card of a tree, not one per card. */
const clearAnswers = new WeakMap<Geometry, Map<number, boolean>>();

/**
 * B.3.2: true when line 2 of a two-line name (the card's last line) has its box top at least `SIGN_LINE_CLEAR_PX` below the D14 sign,
 * so it may take the whole text column. It is decided once per geometry and ring from the default two-slot text (a two-line title or a
 * missing small line moves line 2 by less than 0.6 px); a three-line name's line 3 is lower still. `ring` is the marked card's
 * inner ring edge: its sign moves below the ring (`signBelowRing`).
 */
function lastLineClearsSign(geo: Geometry, ring?: number): boolean {
	let byRing = clearAnswers.get(geo);
	if (!byRing) clearAnswers.set(geo, (byRing = new Map<number, boolean>()));
	const key = ring ?? -1;
	let answer = byRing.get(key);
	if (answer === undefined) {
		const two = cardText(geo, 2);
		const sign = ring === undefined ? two.sign : signBelowRing(two.sign, ring);
		const line2Top = two.name2Baseline! - 0.35 * two.nameSize - (LINE_HEIGHT * two.nameSize) / 2;
		answer = line2Top - signBottomOf(sign) >= SIGN_LINE_CLEAR_PX;
		byRing.set(key, answer);
	}
	return answer;
}

/** D29, D81: the number of name text lines a card was made for (`tallName`, `longName`). */
export const nameCountOf = (box: { tallName?: true; longName?: true }): NameLineCount => (box.longName ? 3 : box.tallName ? 2 : 1);

// ---------- 0.2.5: the Roundel (top-to-bottom) and the text card (sideways), the 0.2.5 contract section B ----------

/**
 * The card axis of the Roundel, card-relative: the middle of the card. Until 0.2.7 it was 0.25 em right of the middle, to centre the content
 * in the area right of the house strip. 0.2.8 (D197) replaced the strip by the top ribbon, so the content is centred on the whole card.
 */
export const roundelAxis = (geo: Geometry): number => geo.cardW / 2;

/**
 * The old axis offset, 0.25 em. Only the widths that depend on the axis keep it (`formText`), so that no name or relation word fits
 * differently than before the axis moved to the middle.
 */
const OLD_AXIS_SHIFT_EM = 0.25;

/**
 * Text positions of a Roundel or a text card (B.3.2, B.3.10). The lines that exist are centred between the crown and the plate;
 * the Roundel centres them on its axis in a 10 em column, the text card keeps them at `padX`. `nameCount`, `tall` and `shown` are as for `cardText`.
 */
function formText(geo: Geometry, names: NameLineCount, tall: boolean, shown?: ShownLines): CardText {
	const f = geo.fontPx;
	const roundel = isRoundel(geo);
	const lh = LINE_HEIGHT;
	const nameSize = NAME_EM * f;
	const smallSize = 0.85 * f;
	const nameLine = lh * nameSize;
	const smallLine = lh * smallSize;
	const crown = geo.crown ?? 0;
	// 0.2.8 (D212): the room for the text starts under the ribbon, or under the portrait's halo, not at the card's edge: the text block is centred in what is left.
	const lead = roundel ? Math.max(ribbonWidth(geo), geo.textTop ?? crown) : crown;
	const cardH = geo.cardH + (names - 1) * tallExtra(geo) + (tall ? relationExtra(geo) : 0);
	const plateH = geo.relationLine === true ? relationExtra(geo) + ROUNDEL_EM.plateMore * f : 0;
	const titles = shown ? (shown.title ? (tall ? 2 : 1) : 0) : tall ? 2 : 1;
	const smalls = titles + (shown ? (shown.dates ? 1 : 0) : 1);
	const top = lead + (cardH - plateH - lead - names * nameLine - smalls * smallLine) / 2;
	// Baseline of a line box: its middle plus about a third of the font size (Latin cap height is about 0.7 em).
	const baseline = (lineTop: number, line: number, size: number) => lineTop + line / 2 + 0.35 * size;
	const axis = roundelAxis(geo);
	const padX = roundel ? axis - (ROUNDEL_EM.column * f) / 2 : 0.875 * f;
	const textW = roundel ? ROUNDEL_EM.column * f : geo.cardW - padX - 0.5 * f;
	const signSize = 1.125 * f;
	const signRight = geo.cardW - 0.5 * f;
	// With a crown the sign sits near the top edge. Without one the text block starts at about 3 px, and a sign there would touch the
	// second name line: it keeps its 0.2.4 place, level with the middle of name line 1.
	const nameBase = baseline(top, nameLine, nameSize);
	const signTop = roundel && crown > 0 ? f / 3 : nameBase - 0.35 * nameSize - signSize / 2;
	const signGap = 0.25 * f;
	const signDash = (Math.SQRT2 * signSize - signGap) / 2;
	const small = top + names * nameLine;
	// The word may use the plate: the Roundel centres it on the axis, so the nearer plate end (the right one) sets the width on both sides.
	const wordClear = WORD_CLEAR_EM * f;
	const relationW = roundel ? 2 * (geo.cardW - PLATE_INSET_PX - axis - wordClear) - 2 * OLD_AXIS_SHIFT_EM * f : geo.cardW - PLATE_INSET_PX - wordClear - padX;
	return {
		padX,
		textW,
		nameSize,
		smallSize,
		nameBaseline: nameBase,
		...(names > 1 ? { name2Baseline: baseline(top + nameLine, nameLine, nameSize) } : {}),
		...(names > 2 ? { name3Baseline: baseline(top + 2 * nameLine, nameLine, nameSize) } : {}),
		titleBaseline: baseline(small, smallLine, smallSize),
		...(tall && titles === 2 ? { title2Baseline: baseline(small + smallLine, smallLine, smallSize) } : {}),
		datesBaseline: baseline(small + titles * smallLine, smallLine, smallSize),
		// Raised, so a descender of the word stays above the pill of a far-couple tag that hangs into the plate (B.3.2).
		...(plateH > 0 ? { relationBaseline: cardH - plateH / 2 + 0.35 * smallSize + 0.5 - ROUNDEL_EM.wordRaise * f, relationW } : {}),
		sign: { x1: signRight, y1: signTop, x2: signRight - signSize, y2: signTop + signSize, width: 0.15625 * f, dash: [signDash, signGap] },
		nameWithSignW: roundel ? 2 * (signRight - signSize - 0.25 * f - axis) - 2 * OLD_AXIS_SHIFT_EM * f : textW - signSize - 0.5 * f,
		textBottom: small + smalls * smallLine,
		anchorX: roundel ? axis : padX,
		...(roundel ? { middle: true as const } : {}),
		r1: { axis, crown, ...(plateH > 0 ? { plate: { y: cardH - plateH, h: plateH } } : {}) },
	};
}

/** Where the medallion and the arms of a Roundel card go, card-relative layout px. */
export interface RoundelPics {
	/** The portrait's picture square: 2 em plus the ring's width on each side (D219: the picture takes the space that the house ring had). */
	portrait?: Rect;
	/** The arms box: 1.25 x 1.5 em beside the medallion, or 1.67 x 2 em in the medallion's place. */
	arms?: Rect;
	/** The portrait's outer radius (the edge of the picture; the name dates from the house ring), the halo's radius and the medallion's centre. */
	ringR: number;
	haloR: number;
	cx: number;
	cy: number;
}

/** 0.2.5 (B.3.3): the places of the medallion and the arms of a Roundel card: on the top edge, centred on the axis. */
export function roundelPics(geo: Geometry, o: { arms: boolean; portrait: boolean }): RoundelPics {
	const f = geo.fontPx;
	const E = ROUNDEL_EM;
	const cx = roundelAxis(geo);
	const cy = -E.above * f;
	const r = E.medal * f;
	const ringR = r + E.ring * f;
	const haloR = ringR + E.halo * f;
	// D219: no house ring any more. The picture fills the ring's space, so the outer diameter, the halo and the layout stay where they were.
	const portrait = o.portrait ? { x: cx - ringR, y: cy - ringR, w: 2 * ringR, h: 2 * ringR } : undefined;
	let arms: Rect | undefined;
	if (o.arms) {
		if (o.portrait) {
			const h = pictureSize(geo);
			const w = PICTURE_EM.armsAspect * h;
			arms = { x: cx + ringR + E.armsGap * f, y: cy - h / 2, w, h };
		} else {
			const h = 2 * r;
			const w = PICTURE_EM.armsAspect * h;
			arms = { x: cx - w / 2, y: cy - h / 2, w, h };
		}
	}
	return { ...(portrait ? { portrait } : {}), ...(arms ? { arms } : {}), ringR, haloR, cx, cy };
}

/** 0.2.5 (B.3.5): how far above the card top a line from the parents stops: at the ring of a portrait, at the top of arms alone, or 0 with no picture. */
export function roundelLineEnd(geo: Geometry, o: { arms?: boolean; portrait?: boolean }): number {
	const f = geo.fontPx;
	const E = ROUNDEL_EM;
	if (o.portrait) return (E.above + E.medal + E.ring) * f;
	if (o.arms) return (E.above + E.medal) * f;
	return 0;
}

/**
 * 0.2.5 (B.3.4): the small "You" tab of the marked person, card-relative. The Roundel puts it on the top edge left of the medallion
 * or of the arms or of the axis; the text card puts it above the text's left edge. 0.2.8 (D213): it keeps the ordinal tab's distance from the
 * picture (`ORDINAL_EM.right...`), so "You" and "1st" stand alike; its width (2.3 em) is the ordinal's for 3 characters, so the two tabs are the same shape.
 */
export function youTabRect(geo: Geometry, hasPortrait: boolean, hasArms = false): Rect {
	const f = geo.fontPx;
	const w = ROUNDEL_EM.tabW * f;
	const h = ROUNDEL_EM.tabH * f;
	if (isRoundel(geo)) {
		const E = ORDINAL_EM;
		return { x: roundelAxis(geo) - (hasPortrait ? E.rightPortrait : hasArms ? E.rightArms : E.rightNone) * f - w, y: -ROUNDEL_EM.tabAbove * f, w, h };
	}
	return { x: 0.875 * f, y: -ROUNDEL_EM.tabAboveText * f, w, h };
}

/**
 * 0.2.7 (F.4): the ordinal tab ("2nd") of a card in the Show view, card-relative, on the top edge at the height of the "You" tab. The width follows
 * `chars`, the length of the text (2.3 em for 3 characters, 2.7 em for 4, 0.4 em more for each further character, at most 6 are counted). The Roundel
 * puts the right edge 1.6 em left of the axis when the card has a portrait (halo 1.35 em + 0.25 em), 1.45 em with arms alone, 0.4 em with no picture;
 * the text card starts it at 0.875 em. The "You" tab uses the same right edges (`youTabRect`).
 */
export function ordinalTabRect(geo: Geometry, hasPortrait: boolean, hasArms: boolean, chars: number): Rect {
	const f = geo.fontPx;
	const E = ORDINAL_EM;
	const n = Math.min(6, Math.max(3, Math.round(chars) || 3));
	const w = (n === 3 ? E.width3 : E.width4 + (n - 4) * E.widthMore) * f;
	const h = ROUNDEL_EM.tabH * f;
	if (isRoundel(geo)) {
		const right = roundelAxis(geo) - (hasPortrait ? E.rightPortrait : hasArms ? E.rightArms : E.rightNone) * f;
		return { x: right - w, y: -ROUNDEL_EM.tabAbove * f, w, h };
	}
	return { x: E.textCardLeft * f, y: -ROUNDEL_EM.tabAboveText * f, w, h };
}

/**
 * The one tolerance for comparing two computed positions (px), used by the card-and-line stages (the architecture notes §4.2.4). Plans made
 * again on cards that moved by one amount differ in their last digits; a tie must go the same way in both (to the right, to the first
 * candidate). It is a tolerance, not a size: sizes such as `SNAP` or `LEG_MIN` say how close, and never decide that two positions are equal.
 */
export const TIE = 1e-6;

/** 0.2.7 (F.4): the cards that have a tab on the top edge: the "You" card and the ordinal cards of a layout. */
export function tabbedCards(youTab: string | undefined, ordinalCards: readonly string[] | undefined): ReadonlySet<string> {
	return new Set([...(ordinalCards ?? []), ...(youTab !== undefined ? [youTab] : [])]);
}
