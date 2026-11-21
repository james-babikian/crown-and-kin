/*
 * The types of the scene (see `scene.ts`): the options of `buildScene`, the `Scene` it returns and the refs of its tags and badges.
 * They are in their own file so the layer files and `scene.ts` can all read them without an import cycle; `scene.ts` exports them again.
 */

import type { CardLabel } from '../../core/titles';
import type { Person } from '../../core/types';
import type { FarTag, PlacedFoldControl, Rect } from '../../layout/model';
import type { BreakList } from '../break-words';
import type { LineMarks } from '../line-highlight';
import type { Measure, SceneFonts } from '../scene-model';
import type { FoldRef } from './folds';
import type { HeirRing } from './heir-ring';
import type { PictureSlot } from './pictures';
import type { SceneFill, SceneWords } from './scene-fill';

/** A card name's internal link, as `buildScene`'s `link` option returns it. */
export interface CardLink {
	linktext: string;
	resolved: boolean;
}

/** What `buildScene` needs beyond the layout: fonts, a measurer, link resolution and focus badges. */
export interface SceneOptions {
	fonts: SceneFonts;
	measure: Measure;
	/** The internal link on a card's name, or null when the name is plain text. */
	link: (p: Person) => CardLink | null;
	/** Focus mode (spec §5.6): people with relatives who are not shown, and how many; each card gets a `+` badge. */
	badges?: { hidden: ReadonlyMap<string, number>; label: (p: Person, hidden: number) => string };
	/** D40 (spec §13.1): the relation text of each card ("Half-sister"; "You" for the marked person), drawn on the relation line in class `dynasty-card-relation`, and named in the card's screen-reader label. The setting "Show relation names on cards" off: pass it and set class `dynasty-no-relations` on the tree (like `dynasty-no-dates`), so the text hides but the label keeps the relation. */
	relations?: SceneRelations;
	/**
	 * Spec §13.1, D352 item 1 (lazy scene only): a card whose word `relations.known` does not know at build is a late card (`scene-fill.ts`):
	 * its fill asks the word before its content is attached, and `Scene.words` gives the rest in idle time. Absent: every word is asked at build.
	 * The number is the most late cards whose words one fill near the view asks (spec §7.7, one group of the time budget); the others wait.
	 */
	lateWords?: number;
	/** D41: the marked person; the card gets class `dynasty-card-me` (one thicker border in the text colour, no accent, D153). */
	me?: string;
	/** The card corner radius (px) when the caller knows it; else the scene reads it from the card bg once it is in the document (`syncCornerRadius`). */
	cornerRadius?: number;
	/**
	 * D47 (spec §13.2): the relation finder's line. Lines, union signs and far-couple tags on it get class
	 * `dynasty-on-line` (thicker, accent colour, normal pattern); cards keep their border. With `fade`,
	 * every card, line and tag not on the line gets class `dynasty-faded` ("Show in the whole tree").
	 */
	line?: LineMarks;
	/**
	 * Spec §13.3, §13.5; D56, D58, D61–D63: the card labels of the drawn graph (`cardLabels(g)`).
	 * A card with a label shows `name` on its name text line (Full and Compact) and `title` with the
	 * reign on its title text line, on two text lines when the box has `tallTitle`; the accessible
	 * name uses them too. Absent: every card is drawn with no label.
	 */
	labels?: ReadonlyMap<string, CardLabel>;
	/**
	 * "Show dates on cards" (spec §9). `false` leaves the reign out of the title text line (spec
	 * §13.3); the dates line itself is hidden by the class `dynasty-no-dates`. Absent = true.
	 */
	showDates?: boolean;
	/**
	 * Spec §13.10: draw the fold controls of `laid.layout.folds`. Absent = none (the static phone preview, and
	 * a tree that has no folds).
	 */
	folds?: SceneFolds;
	/**
	 * Spec §13.15 rule 1: build each card, tag and badge as a shell (its attributes, classes, bg rect
	 * or hit rect) and keep the rest of its content in a detached holder until `Scene.fill` attaches it. Only the tree view sets it;
	 * the headless renderer, the tests and the saved picture stay eager and complete.
	 */
	lazyCards?: boolean;
	/** D118: the user's break places for long names (`parseBreakList`); `tallCardsFor` and the saved picture read the same list. */
	breaks?: BreakList;
	/**
	 * The heirs of the Show view of a line of succession (ids). Each such card gets the class `dynasty-heir` when it is made (cards are
	 * lazy, so a class added later would miss the cards not built yet). The look is in styles.css.
	 */
	heirs?: Iterable<string>;
	/**
	 * The ordinal text of each heir ("2nd"), by person id. A card gets the ordinal tab only if its id is also in `TreeLayout.ordinalCards`
	 * (the layout made room for it); the tab replaces the "You" tab of the same card. The texts are never part of the layout.
	 */
	ordinals?: ReadonlyMap<string, string>;
}


/** The words of the cards (`SceneOptions.relations`): `get` works a word out when needed; `known` and `getMany` serve the late words. */
export interface SceneRelations {
	get(id: string): { text: string; lower: string } | undefined;
	/** True when the word of `id` is worked out already. */
	known?(id: string): boolean;
	/** Works out the words of `ids` in one request. */
	getMany?(ids: Iterable<string>): unknown;
}


/** How the scene draws the fold controls. */
export interface SceneFolds {
	/** Draw the open buttons too; false draws the "+ N" signs only (a saved picture, D71). */
	buttons: boolean;
	/** The accessible name and the tooltip of a control, from `ui-text.ts`; `names` are the parents' `Person.name`, in order. */
	label: (c: PlacedFoldControl, names: readonly string[]) => string;
	/** True: open buttons are made as empty shells (see `FoldDrawing.lazy`). Only the tree view sets it; the headless scene and the saved picture stay eager. */
	lazy?: boolean;
	/** Called once for each control when it gets its tap area. */
	wire?: (ref: FoldRef) => void;
}

/** A drawn far-couple tag, with its element and enlarged tap area. */
export interface TagRef {
	tag: FarTag;
	el: SVGGElement;
	/** The invisible tap area. It lies below the cards (see buildScene), so it is not inside `el`. */
	hit: SVGRectElement;
	/**
	 * The invisible strip of the tap area that lies over the bottom of the tag's own card, inside `el` and so above the cards:
	 * the tag wins a press there. Empty (no size) until the tree view places it at a settled zoom (`tagHitSide`).
	 */
	over: SVGRectElement;
}

/** The `+` badge of a card in focus mode (spec §5.6). */
export interface BadgeRef {
	person: string;
	el: SVGGElement;
	/**
	 * The invisible tap square. It lies below the cards (in its own layer, under the tag and fold tap areas), so a card, a tag and a
	 * fold control win over it; the tree view sizes it from `mark` at each settled zoom (`badgeHit`).
	 */
	hit: SVGRectElement;
	/** The invisible disc inside the badge's group, above the cards: the badge wins a tap here, also over its own card (`badgeTap`). */
	disc: SVGPathElement;
	/** The badge's visible circle. */
	mark: Rect;
}


/** The SVG content `buildScene` built: the drawn elements, and a way to re-fit their text. */
export interface Scene {
	cards: Map<string, SVGGElement>;
	tags: TagRef[];
	badges: BadgeRef[];
	/** Name elements that are links, with their link text. */
	links: Map<SVGTextElement, string>;
	/**
	 * The empty picture slots, in card order and, within a card, Full arms, portrait, then
	 * Compact arms. `buildScene` makes no `<image>`; `setPicture` fills a slot.
	 */
	pictures: PictureSlot[];
	/** The fold controls, in drawing order; empty without `SceneOptions.folds`. */
	folds: FoldRef[];
	/** The numbered rings of the heirs (Compact, and Overview on a computer); empty without a line of succession. The tree view places them with the zoom (`placeRings`). */
	rings: HeirRing[];
	/**
	 * Truncates every text again with the current measurements, in place: for a web font that
	 * finished loading after the first measurement. No element is replaced, so focus, a highlight
	 * and a running pan or zoom are not disturbed.
	 */
	refit: () => void;
	/** The card corner radius (px) is known from the caller: the ribbons and badges are drawn again with it. */
	setCornerRadius: (r: number) => void;
	/**
	 * Reads the card's real corner radius (the computed `rx` of the first card bg that is in the document) and draws the ribbons and badges again if it differs from
	 * what they use. Without `force` it does nothing once the radius is known, so a fill can call it every time; a theme change passes `force`. One read, never one per card.
	 */
	syncCornerRadius: (force?: boolean) => void;
	/**
	 * R026 fit: false takes the detail group of every card out of the document, true puts it back. The Overview level draws no detail, and leaving the
	 * groups out is far cheaper than hiding them with a class (about 1.6 ms against 11 ms on sample tree 07b). A lazy scene puts the groups back as
	 * it fills a card (`fill`: near the view at once, the rest in idle chunks), because putting all of them back in one frame costs more than the
	 * class did. The `dynasty-lod-overview` rule still hides a group that is in the document.
	 */
	setDetail: (on: boolean) => void;
	/** D377 step 8: makes the text of the tag pills that `level` shows ('compact' or 'overview'), once. The view calls it before the level class changes, so no frame shows an empty pill. */
	showLevel: (level: string) => void;
	/** The fill API; an eager scene has one that does nothing. */
	fill: SceneFill;
	/** The late relation words (`SceneOptions.lateWords`); an eager scene has none. */
	words: SceneWords;
}
