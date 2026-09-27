/**
 * The shapes the layout hands to renderers: card boxes, union points, far-couple tags, the line
 * kinds and the finished `TreeLayout` and `EdgeDrawing`. `layout.ts`, `edges.ts` and `geometry.ts`
 * build these shapes (`layout.ts` places cards, `edges.ts` draws lines, `geometry.ts` sizes cards
 * and gaps); `src/render` only reads them. `StrokeKind` here and `STROKES` in `render/styles.ts`
 * list the same line kinds in the same order: add a new kind to both.
 */
import type { FamilyGraph } from '../core/derive';

/** Card size a tree draws with (spec §9 "Card size"); `compact` is narrower and tighter. */
export type CardSize = 'normal' | 'compact';

/**
 * D24. `down`: generations are rows from top to bottom (every layout before D24). `sideways`:
 * generations are columns from left to right (ancestors left); siblings and children stack from
 * top to bottom in sibling order (D2); partners stack in the same column, joined by their union
 * point in the gap between the cards. The arranger works in generation / position-in-generation
 * terms; only the mapping to x/y and the gap sizes differ.
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

/** A rectangle in layout px: `x, y` is the top-left corner. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Card and gap sizes a layout draws with, in layout px, scaled from the note font (spec §5.8). */
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

/** A person's card: its box, id and generation (row in `down`, column in `sideways`). */
export interface PersonBox extends Rect {
	id: string;
	gen: number;
}

/** Where a couple's dot is drawn, and how (spec §5.3, D10). */
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
	/** Hit area, at least 44×44 px (spec §7.5). Where it meets a card, the card wins; renderers may enlarge it at settle (D31: in `down` it hangs below the card). */
	hit: Rect;
	/**
	 * The widest the visible tag may be, centred on `x`. Renderers draw the pill at
	 * `min(zoneW ?? hit.w, text width)`. Both orientations set it: the
	 * hit area can be wider than the free part of the edge, and a pill that wide would cover lines.
	 */
	zoneW?: number;
}

/** Thresholds for D11, tuned with the owner. */
export interface FarCoupleRule {
	/** Different blocks and more than this many card widths apart horizontally. Spec default 3. */
	maxCardWidths: number;
	/** Or more than this many generations apart. Spec default 1. */
	maxGenerations: number;
}

/** A finished arrangement of one tree: every card and union point placed, ready to route lines through. */
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
	/** D24: how `persons`, `unions`, `rowGaps`, tags and edges were placed. */
	orientation: Orientation;
	/** Keyed by person id. */
	farTags: Map<string, FarTag>;
	width: number;
	height: number;
	geometry: Geometry;
}

/** Every kind of line the tree draws (spec §5.3). `render/styles.ts` gives each one its `STROKES` style. */
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

/** One drawn line: its SVG path data, its kind and the people it connects. */
export interface EdgePath {
	d: string;
	kind: StrokeKind;
	/** People this line connects; lets the renderer highlight a person's lines. */
	people: string[];
}

/** A dot or "?" mark drawn on top of the lines: a union's sign, or a rumoured parent's mark. */
export interface EdgeMarker {
	x: number;
	y: number;
	kind: 'union' | 'implicit-union' | 'rumour';
	/** D26, D38: for `kind: 'union'`, the partnership type as written (a missing `type` gives `marriage`). Renderers draw the dot's shape from it: marriage dot, betrothal ring, concubinage diamond, affair open triangle; an unknown value is drawn as the marriage dot. `implicit-union` markers draw no sign. Far-couple dots use the same shapes. */
	unionType?: string;
}

/** All the lines and markers routed for one tree layout. */
export interface EdgeDrawing {
	paths: EdgePath[];
	markers: EdgeMarker[];
}

/** How a tree is arranged: sweep count, the far-couple rule, orientation and card widths. */
export interface LayoutSettings {
	/** Rounds of "centre parents over children, then children under parents". */
	sweeps: number;
	far: FarCoupleRule;
	/** D24. Absent = `down`. Part of the cache key, with `sidewaysCards`. */
	orientation?: Orientation;
	/** D24. Absent = `normal`. */
	sidewaysCards?: SidewaysCards;
	/**
	 * The card width in layout px for `narrow` cards, chosen by the renderer from the
	 * note preview's box so two whole generations fit. The layout clamps it to [8 em, 10.25 em];
	 * absent = 10.25 em. Ignored unless `orientation` is `sideways` and `sidewaysCards` is `narrow`.
	 * Part of the cache key (rounded to 0.5 px).
	 */
	narrowCardW?: number;
	/**
	 * D29, D37: people whose card is one name text line taller (the renderer found with
	 * `nameLines` that the name does not fit on one text line). In every layout: `down` (the cards of
	 * a row share their top edge; the gap below starts under the row's tallest card) and `sideways`
	 * (longer along the column), normal, narrow and compact cards. Part of the cache key (sorted).
	 * Every consumer uses `PersonBox.h`, never `geometry.cardH`, for a card's height;
	 * `cardText(geo, tall)` gives the text positions of a tall card (two name baselines; title and
	 * dates one text line lower).
	 */
	tallCards?: readonly string[];
}

/** A tree layout together with its routed lines: what `layoutTree` returns and the cache stores. */
export interface LaidOut {
	layout: TreeLayout;
	edges: EdgeDrawing;
}

/**
 * The single synchronous entry point renderers call (`src/layout/index.ts`).
 * Goes through the in-memory LRU cache (spec §5.1 step 6); `fontFamily` is part of the key (§5.8).
 */
export type LayoutTree = (g: FamilyGraph, geo: Geometry, settings: LayoutSettings, fontFamily: string) => LaidOut;
