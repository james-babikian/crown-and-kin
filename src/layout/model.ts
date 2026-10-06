/**
 * The shapes the layout hands to renderers: card boxes, union points, far-couple tags, the line
 * kinds and the finished `TreeLayout` and `EdgeDrawing`. `layout.ts`, `edges.ts` and `geometry.ts`
 * build these shapes (`layout.ts` places cards, `edges.ts` draws lines, `geometry.ts` sizes cards
 * and gaps); `src/render` only reads them. `StrokeKind` here and `STROKES` in `render/styles.ts`
 * list the same line kinds in the same order: add a new kind to both.
 */
import type { FamilyGraph } from '../core/derive';
import type { FoldControl, FoldKey } from '../core/folds';

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
	/**
	 * D40 (M7): set by the layout from `LayoutSettings.relationLine`, in every layout and card size;
	 * `cardH` then already includes one small text line (`relationExtra(geo)` = round(line height ×
	 * 0.85 × fontPx)), so `cardText`, `tagTop` and the lines need no other change. `drawnGeometry` and
	 * `layoutFamilies` apply it before anything else. `cardText` then centres three small lines.
	 */
	relationLine?: boolean;
	/** 0.2.5 (D143, D150): the card form. 'roundel' = the top-to-bottom card with a medallion; 'text' = the sideways text card. Absent = the classic card. Set by `cardForm` only, never by `withRelationLine`. */
	form?: 'roundel' | 'text';
	/** 0.2.5: the empty space above every card of a Roundel tree that has a picture, in px. Set only when more than 0, so old keys stay. */
	crown?: number;
	/** 0.2.5: the px at the start of the first row (down) or the first stack position (sideways) for what sticks out above a card (medallion, "You" tab). Set only when more than 0. */
	reach?: number;
}

/** `geometry.ts` exports `geometryFor: GeometryFor`. Card size scales with the font. */
export type GeometryFor = (fontPx: number, cardSize: CardSize) => Geometry;

/** How many text lines a name takes on a card (D29, D81). */
export type NameLineCount = 1 | 2 | 3;

/** A lower-right box of a card (the arms box or the portrait) and its gap to the text (D117, contract 4.2). */
export interface LowerRightBox {
	r: Rect;
	gap: number;
}

/** Room for the text lines of a name (px, from the text's left edge). `full`: any line before the last. `last`: the final line of a name of 2 or 3 lines. `only`: the line of a name that stays on ONE line. */
export interface NameRoom {
	full: number;
	last: number;
	only: number;
}

/** A person's card: its box, id and generation (row in `down`, column in `sideways`). */
export interface PersonBox extends Rect {
	id: string;
	gen: number;
	/** D29, D37: the name takes two text lines (`LayoutSettings.tallCards`); set only when true. */
	tallName?: true;
	/** D81: the name takes three text lines (`LayoutSettings.longNames`); set only when true, together with `tallName`. */
	longName?: true;
	/** D61: the title text line takes two text lines (`LayoutSettings.tallTitles`); set only when true. */
	tallTitle?: true;
	/** D67, D78: the card shows its house's arms (`armsCards`); set only when true. The box keeps its size. */
	arms?: true;
	/** D76, D78: the card shows a portrait (`LayoutSettings.portraits`); set only when true. The box keeps its size. */
	portrait?: true;
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

/** M10 (F5): a point in layout px; the centre of a fold control. */
export interface FoldSpot {
	x: number;
	y: number;
}

/** M10 (F5): a fold control of the core with its place in the layout. */
export type PlacedFoldControl = FoldControl & { spot: FoldSpot };

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
	/**
	 * M10 (spec §13.10, F5): the fold controls with the centre of each, set only when
	 * `LayoutSettings.foldControls` is true (absent, not empty, otherwise). `width` and `height` include
	 * every control's largest mark and its 44 px hit area (F5b).
	 */
	folds?: PlacedFoldControl[];
	/** 0.2.5 (D148): a copy of `LayoutSettings.youTab`, set by `layoutTree` only when that id is a person of the drawn graph. The scene and the saved picture read the tab from here. */
	youTab?: string;
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
	/** M7: the union of a bar (a shared bar: the pair's last-listed union), a leg, a trunk or a drop. */
	union?: string;
	/** M7: a trunk and its drops: the family's parents; a side link: the link's parents. */
	parents?: string[];
	/** M7: a drop or a side link: the child. */
	child?: string;
}

/** A dot or "?" mark drawn on top of the lines: a union's sign, or a rumoured parent's mark. */
export interface EdgeMarker {
	x: number;
	y: number;
	kind: 'union' | 'implicit-union' | 'rumour';
	/** D26, D38: for `kind: 'union'`, the partnership type as written (a missing `type` gives `marriage`). Renderers draw the dot's shape from it: marriage dot, betrothal ring, concubinage diamond, affair open triangle; an unknown value is drawn as the marriage dot. `implicit-union` markers draw no sign. Far-couple dots use the same shapes. */
	unionType?: string;
	/** M7: `union` and `implicit-union` markers: the union key. */
	union?: string;
}

/** All the lines and markers routed for one tree layout. */
export interface EdgeDrawing {
	paths: EdgePath[];
	markers: EdgeMarker[];
}

/** How a tree is arranged: sweep count, the far-couple rule and orientation. */
export interface LayoutSettings {
	/** Rounds of "centre parents over children, then children under parents". */
	sweeps: number;
	far: FarCoupleRule;
	/** D24. Absent = `down`. Part of the cache key. */
	orientation?: Orientation;
	/**
	 * D29, D37: people whose card is one name text line taller (the renderer found with
	 * `nameLines` that the name does not fit on one text line). In every layout: `down` (the cards of
	 * a row share their top edge; the gap below starts under the row's tallest card) and `sideways`
	 * (longer along the column), normal and compact cards. Part of the cache key (sorted).
	 * Every consumer uses `PersonBox.h`, never `geometry.cardH`, for a card's height;
	 * `cardText(geo, box.tallName, box.tallTitle)` gives the text positions of a tall card (two name
	 * baselines; title and dates one text line lower).
	 */
	tallCards?: readonly string[];
	/**
	 * D81: people whose name needs exactly three text lines (a subset of `tallCards`, from `tallCardsFor`).
	 * Such a card is two `tallExtra` taller than a card with a one-line name. The box gets `longName`.
	 * Part of the cache key (sorted); none leaves the key as it was.
	 */
	longNames?: readonly string[];
	/**
	 * D61 (spec §13.3): people whose title text line takes two text lines (`tallTitlesFor`). Such a
	 * card is `relationExtra` (one small text line) taller; a card also in `tallCards` is taller by
	 * the sum. `down`: a row's gap starts under its tallest card; `sideways`: each card keeps its own
	 * height (the D37 rule). The box gets `tallTitle`. Part of the cache key (sorted).
	 */
	tallTitles?: readonly string[];
	/**
	 * D40 (spec §13.1): the tree has a mark and relation names show on cards, so every card is one
	 * small text line (0.85 em × line height) taller, in every layout and card size; the relation text
	 * sits on that line after the card's other text lines (`CardText.relationBaseline`). The setting
	 * "Show relation names on cards" off keeps the height (like "Show dates on cards"), so this is
	 * true whenever the tree has a valid mark. Part of the cache key. The layout applies it to
	 * `Geometry` (`Geometry.relationLine`, `cardH` += `relationExtra`). The line-only small tree of
	 * the relation finder is laid out without it. `NEVER_FAR_RULE` (`layout.ts`, M7) =
	 * `{ maxCardWidths: Infinity, maxGenerations: Infinity }` never splits a couple.
	 */
	relationLine?: boolean;
	/**
	 * Spec §13.6 (D67, D78): ids of the houses whose `arms` is written in the tree text, sorted
	 * (`pictureSets`). A written value counts even when the file is missing or cannot show, so a
	 * picture that loads late never changes a layout. Cards of these houses get `PersonBox.arms`;
	 * no box changes size or place. Part of the cache key when not empty.
	 */
	arms?: readonly string[];
	/**
	 * Spec §13.7 (D76, D78): ids of the people whose `portrait` is written, sorted; empty or absent
	 * when "Show portraits on cards" is off (`pictureSets`). These cards get `PersonBox.portrait`; no
	 * box changes size or place. Part of the cache key when not empty.
	 */
	portraits?: readonly string[];
	/**
	 * Spec §13.10 (F1, F2): the people that the folds hide, sorted. The layout takes the generations
	 * from the whole graph and arranges the graph without these people. Part of the cache key when not empty.
	 */
	foldHidden?: readonly string[];
	/** Spec §13.10 (F4): the effective fold keys, sorted. The layout keeps a folded family's dot, stem lane and room for its "+ N" sign. Part of the cache key when not empty. */
	foldedFamilies?: readonly FoldKey[];
	/** Spec §13.10 (F5): the view can fold, so the layout computes `TreeLayout.folds`. Absent in a static preview. Part of the cache key when true. */
	foldControls?: true;
	/** 0.2.5 (D148): the id of the person who gets the "You" tab. Set whenever the tree has a mark and `relationLine` is false (also in the small tree of the relation finder). Part of the cache key. */
	youTab?: string;
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
