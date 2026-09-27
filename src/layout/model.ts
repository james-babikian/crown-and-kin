/**
 * Milestone 1 contract (frozen by the supervisor; change only through the supervisor).
 *
 * The shapes the layout hands to renderers. WP1.3 makes `layout.ts`, `edges.ts` and
 * `geometry.ts` use these types (and removes their local duplicates); WP1.4 renders them.
 */
import type { FamilyGraph } from '../core/derive';

export type CardSize = 'normal' | 'compact';

/**
 * M5 contract (WP5.5, D24). `down`: generations are rows from top to bottom (every layout before
 * D24). `sideways`: generations are columns from left to right (ancestors left); siblings and
 * children stack from top to bottom in sibling order (D2); partners stack in the same column,
 * joined by their union point in the gap between the cards. The arranger works in generation /
 * position-in-generation terms; only the mapping to x/y and the gap sizes differ.
 */
export type Orientation = 'down' | 'sideways';

/**
 * Card width in `sideways` (D24): `normal` for the full-screen view, `narrow` for the static
 * phone note preview, so that two whole generations fit in its box. Ignored for `down`.
 */
export type SidewaysCards = 'normal' | 'narrow';

/*
 * `TreeLayout.geometry` in `sideways`: `cardW`/`cardH` are the drawn card size (renderers draw
 * cards with it); `fontPx`, `unionSize` and `tagH` are as passed in; `coupleGap` is the vertical
 * gap between stacked partners, `nodeGap` the vertical gap between unrelated neighbours in a
 * column, `rowGap` the minimum horizontal gap between columns. The gap sizes in the decision notes are
 * minimums. The D11 far distance is measured card centre to card centre along the column, against
 * 3 × the `down` card width. A far tag's 44 px hit area must not cover another card (a larger gap
 * below a tagged card, or a hit area that takes more of its own card, are both acceptable).
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Geometry {
	/** Resolved note font size in px that the geometry was built for (spec §5.8). */
	fontPx: number;
	cardSize: CardSize;
	cardW: number;
	cardH: number;
	unionSize: number;
	/** Horizontal gap between two partners joined by a marriage bar. */
	coupleGap: number;
	/** Horizontal gap between unrelated neighbours in a row. */
	nodeGap: number;
	/** Vertical gap between the bottom of one generation's cards and the top of the next. */
	rowGap: number;
	/** Height of a far-couple tag drawn at a card's bottom edge (its hit area is larger). */
	tagH: number;
}

/** `geometry.ts` exports `geometryFor: GeometryFor`. Card size scales with the font. */
export type GeometryFor = (fontPx: number, cardSize: CardSize) => Geometry;

export interface PersonBox extends Rect {
	id: string;
	gen: number;
}

export interface UnionPoint {
	key: string;
	x: number;
	y: number;
	/** Partners are side by side in the same row (`sideways`: one above the other in the same column): drawn as a bar between the cards. */
	bar: boolean;
	/** Far couple (D10): no connecting line, each partner gets a tag. */
	far: boolean;
}

/** "⚭ Name" or "⚭ N spouses" on a card's bottom edge (spec §5.3, D10). */
export interface FarTag {
	person: string;
	/** Far spouses in union order. One entry: jump directly. Several: show a list first. */
	spouses: string[];
	/**
	 * Visible tag anchor: horizontal centre and the card's bottom edge. The renderer sizes the text.
	 * In `sideways` also the bottom edge; when a partner is stacked directly below, the tag uses the
	 * left half of that edge so it does not sit on the couple's union point.
	 */
	x: number;
	y: number;
	/** Hit area, at least 44×44 px (spec §7.5). Where it meets a card, the card wins (WP4.3); renderers may enlarge it at settle (D31: in `down` it hangs below the card). */
	hit: Rect;
	/**
	 * M5 (WP5.5a): the widest the visible tag may be, centred on `x`. Renderers draw the pill at
	 * `min(zoneW ?? hit.w, text width)`. Absent = `hit.w` (every `down` layout before WP5.5a).
	 */
	zoneW?: number;
}

/** Thresholds for D10; tuned with the owner in milestone 1. */
export interface FarCoupleRule {
	/** Different blocks and more than this many card widths apart horizontally. Spec default 3. */
	maxCardWidths: number;
	/** Or more than this many generations apart. Spec default 1. */
	maxGenerations: number;
}

export interface TreeLayout {
	persons: Map<string, PersonBox>;
	unions: Map<string, UnionPoint>;
	/** People in each generation, left to right (`sideways`: top to bottom). */
	rows: string[][];
	/**
	 * Free band between generation i and i+1: from the bottom of generation i's cards to the top of
	 * generation i+1's. In `sideways` the same numbers are x values: `top` = the right edge of
	 * column i's cards, `bottom` = the left edge of column i+1's cards.
	 */
	rowGaps: { top: number; bottom: number }[];
	/** M5 (D24): how `persons`, `unions`, `rowGaps`, tags and edges were placed. */
	orientation: Orientation;
	/** Keyed by person id. */
	farTags: Map<string, FarTag>;
	width: number;
	height: number;
	geometry: Geometry;
}

export type StrokeKind =
	| 'marriage'
	| 'betrothal'
	| 'concubinage'
	| 'affair'
	| 'implicit'
	| 'descent'
	| 'illegitimate'
	| 'birth-link'
	| 'adoptive'
	| 'ward'
	| 'rumoured';

export interface EdgePath {
	d: string;
	kind: StrokeKind;
	/** People this line connects; lets the renderer highlight a person's lines. */
	people: string[];
}

export interface EdgeMarker {
	x: number;
	y: number;
	kind: 'union' | 'implicit-union' | 'rumour';
	/** M6 (D26): for `kind: 'union'`, the partnership type as written (a missing `type` gives `marriage`). Renderers draw the dot's shape from it: marriage dot, betrothal ring, concubinage diamond, affair open diamond; an unknown value is drawn as the marriage dot. `implicit-union` markers are the small ring. Far-couple dots use the same shapes. */
	unionType?: string;
}

export interface EdgeDrawing {
	paths: EdgePath[];
	markers: EdgeMarker[];
}

export interface LayoutSettings {
	/** Rounds of "centre parents over children, then children under parents". */
	sweeps: number;
	far: FarCoupleRule;
	/** M5 (D24). Absent = `down`. Part of the cache key, with `sidewaysCards`. */
	orientation?: Orientation;
	/** M5 (D24). Absent = `normal`. */
	sidewaysCards?: SidewaysCards;
	/**
	 * M5 (WP5.5c): the card width in layout px for `narrow` cards, chosen by the renderer from the
	 * note preview's box so two whole generations fit. The layout clamps it to [8 em, 10.25 em];
	 * absent = 10.25 em. Ignored unless `orientation` is `sideways` and `sidewaysCards` is `narrow`.
	 * Part of the cache key (rounded to 0.5 px).
	 */
	narrowCardW?: number;
	/**
	 * M6 (D29, D37): people whose card is one name text line taller (the renderer found with
	 * `nameLines` that the name does not fit on one text line). In every layout: `down` (the cards of
	 * a row share their top edge; the gap below starts under the row's tallest card) and `sideways`
	 * (longer along the column), normal, narrow and compact cards. Part of the cache key (sorted).
	 * Every consumer uses `PersonBox.h`, never `geometry.cardH`, for a card's height;
	 * `cardText(geo, tall)` gives the text positions of a tall card (two name baselines; title and
	 * dates one text line lower).
	 */
	tallCards?: readonly string[];
}

export interface LaidOut {
	layout: TreeLayout;
	edges: EdgeDrawing;
}

/**
 * The single synchronous entry point renderers call (`src/layout/index.ts`, WP1.3).
 * Goes through the in-memory LRU cache (spec §5.1 step 6); `fontFamily` is part of the key (§5.8).
 */
export type LayoutTree = (g: FamilyGraph, geo: Geometry, settings: LayoutSettings, fontFamily: string) => LaidOut;
