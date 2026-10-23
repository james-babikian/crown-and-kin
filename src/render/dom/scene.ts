/*
 * Builds the tree's SVG content with Obsidian's createSvg. Colours and fonts come only from the
 * dynasty- classes in styles.css; the one value written per card is --dynasty-house-color.
 * Each card carries all three levels of detail (spec §5.4); a class on the <svg> picks one, so a
 * level change is a class change, never a rebuild. M7: the relation text, the marked card (D40, D41)
 * and the relation finder's line (D47, from `line-highlight.ts`) are classes too. M8: with card
 * labels (`SceneOptions.labels`), the name and title text lines come from them (spec §13.3, §13.5).
 * M9: a card whose box has `arms` or `portrait` gets empty picture slots (`Scene.pictures`, filled
 * by the tree view through `dom/pictures.ts`); its name makes room for the arms, and its small text
 * lines beside the portrait are narrower (spec §13.6, §13.7, D76–D78). The legend gains the houses.
 * M10: with `SceneOptions.folds`, the fold controls of the layout (`dom/folds.ts`): each in the Tab order after the
 * card of the later of its parents, its tap area in the hit layer below the cards.
 * M11 (spec §13.15 rule 1): with `SceneOptions.lazyCards` (only the tree view sets it; the headless
 * `renderSvg`, the tests, the spike and Save as a picture stay eager and complete) each card, far-couple
 * tag and focus badge is a shell plus its content:
 * - S1 Shell and content. A card shell is the `<g class="dynasty-card ...">` with `tabindex`, `role`,
 *   `aria-label`, `data-person`, every class and the `--dynasty-house-color` style, plus its
 *   `rect.dynasty-card-bg` (the size and hit area). Its content is every other child (strip,
 *   full, compact levels). 0.2.5 (WP-B8): the focus ring is not part of that content; only `fillPerson` and `fillAll`
 *   make it, because it shows only for the keyboard focus and the highlight and both fill the person first.
 *   A tag shell has its attributes and hit rect, its content the three pill groups.
 *   A badge shell has its attributes and hit rect, its content the circle and the plus path. Fold controls
 *   keep the M10 rule (`FoldRef.fill`). A shell never moves, so the Tab order, the names and the roles
 *   exist from the build on.
 * - S2 Built detached, attached later. The content is created in a detached holder, `fitted`, the
 *   `fitters`, `links` and `PictureSlot`s are registered as in an eager scene, and the holder's children
 *   move into the shell at fill. After a fill the shell has exactly the eager children in the eager
 *   order, so an eager and a filled lazy scene serialise byte for byte the same. 0.2.8 (speed repair): the text of a card and of a far-couple tag is cut
 *   to fit (the `fitters`) at fill, not at build, because nobody sees it before; a refit runs the fits that have run.
 * - S3 Near the view. `boxNearView` (`view-math.ts`) decides which items a fill attaches.
 * - S3b 0.2.1 (spec §13.15 rule 4): lines and partnership signs are delayed too. A lazy scene does not make
 *   their elements at build time; it keeps each one's box (`pathBox`) and builds the element at fill, into its
 *   layer at its place (`orderedLayer`), so the layer after `fillAll` is the eager layer byte for byte. They have
 *   no tap area, so a missing one never costs a tap. `SceneFill.pendingLines` counts them; they are not in
 *   `pending` and not in the numbers the fill calls return.
 * - S4 `Scene.fill` (`SceneFill`) is the fill API; an eager scene has one that does nothing. The
 *   tree view decides when to call it (see `obsidian/tree-view.ts`). `Scene.cards`, `tags`, `badges`,
 *   `links`, `pictures` and `folds` contain every item from the build on.
 * 0.2.5 (CONTRACT section B): a card has one of two forms (`Geometry.form`). The Roundel (a tree from top to bottom) has its text
 * centred on an axis, a round medallion and the arms on its top edge (a Full and a Compact slot for each picture), a footer plate for
 * the relation word, and a tap area over the part that sticks out above the card. The text card (sideways) has its text at the left, no
 * pictures at all (`Scene.pictures` stays empty, so nothing is fetched) and the same plate. 0.2.6 (D179): the classic card and the card size are gone. The "You" tab belongs to the card whose id
 * is `TreeLayout.youTab`, whatever the form; nothing else decides it. The scene writes no `data-relation` and draws no tooltip:
 * the tooltip belongs to the tree view.
 */

import type { FamilyGraph } from '../../core/derive';
import type { CardLabel } from '../../core/titles';
import { isDead } from '../../core/succession-keys';
import type { Person } from '../../core/types';
import { ORDINAL_EM, ROUNDEL_EM, centredWithoutWord, cardText, footSpan, isRoundel, nameCountOf, nameRoom, ordinalTabRect, relationY, ribbonWidth, roundelPics, signBelowRing, signBottomOf, tagTop, youTabRect, type CardText, type ShownLines } from '../../layout/geometry';
import { farTagSigns } from '../../layout/far-tag-sign';
import { illegitimateSigns } from '../../layout/index';
import type { FarTag, LaidOut, NameLineCount, PersonBox, PlacedFoldControl, Rect } from '../../layout/model';
import type { BreakList } from '../break-words';
import { legendRows, unionMarkClass, type LegendPart } from '../legend';
import { isColour } from '../colour-check';
import { lineLook, type LineMarks, type LineState } from '../line-highlight';
import { cardNameLines, isolateLines, titleLines, type NameMeasure, type NameRun } from '../name-lines';
import { ME_RING_INNER, TAG_MARK, UNION_MARKS, tagMarkGap, tagMarkHalfWidth, tagMarkSlot, unionMark, unionShape, type UnionShape } from '../styles';
import { fitCardText, pickReign } from '../date-fit';
import { SIGN_CARD_LABEL, cardLabel, dateLine, farTagLabel, farTagName, shownReign } from '../tree-info';
import { HIT_EM, boxNearView, pathBox, ribbonPath, truncate } from '../view-math';
import { ME_WORD } from '../view-text';
import { drawFold, type FoldRef } from './folds';

// The word moved to view-text.ts (all plugin texts live there); other modules still read it from here.
export { ME_WORD };
import type { PictureOwner, PictureSlot } from './pictures';
import { FRAME_STROKE_PX, RUMOUR_FONT_EM, TAB_TEXT_BASE_EM, type Measure, type SceneFonts } from '../scene-model';

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
	/** D40 (spec §13.1): the relation text of each card ("Half-sister"; "You" for the marked person), drawn on the relation line in class `dynasty-card-relation`, and named in the card's screen-reader label. The setting "Show relation names on cards" off: pass it and set class `dynasty-no-relations` on the tree (like `dynasty-no-dates`), so the text hides but the label keeps the relation (M7 ruling). */
	relations?: { get(id: string): { text: string; lower: string } | undefined };
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
	 * M8 (spec §13.3, §13.5; D56, D58, D61–D63): the card labels of the drawn graph (`cardLabels(g)`).
	 * A card with a label shows `name` on its name text line (Full and Compact) and `title` with the
	 * reign on its title text line, on two text lines when the box has `tallTitle`; the accessible
	 * name uses them too. Absent: every card is drawn as in M7.
	 */
	labels?: ReadonlyMap<string, CardLabel>;
	/**
	 * "Show dates on cards" (spec §9). `false` leaves the reign out of the title text line (spec
	 * §13.3); the dates line itself is hidden by the class `dynasty-no-dates`. Absent = true.
	 */
	showDates?: boolean;
	/**
	 * M10 (spec §13.10, F8, F14, F16): draw the fold controls of `laid.layout.folds`. Absent = none (the static phone preview, and
	 * every tree before M10).
	 */
	folds?: SceneFolds;
	/**
	 * M11 (spec §13.15 rule 1): build each card, tag and badge as a shell (its attributes, classes, bg rect
	 * or hit rect) and keep the rest of its content in a detached holder until `Scene.fill` attaches it. Only the tree view sets it;
	 * the headless renderer, the tests and the saved picture stay eager and complete.
	 */
	lazyCards?: boolean;
	/** D118: the user's break places for long names (`parseBreakList`); `tallCardsFor` and the saved picture read the same list. */
	breaks?: BreakList;
	/**
	 * 0.2.7 (F.2): the heirs of the Show view of a line of succession (ids). Each such card gets the class `dynasty-heir` when it is made (cards are
	 * lazy, so a class added later would miss the cards not built yet). The look is in styles.css.
	 */
	heirs?: Iterable<string>;
	/**
	 * 0.2.7 (F.4): the ordinal text of each heir ("2nd"), by person id. A card gets the ordinal tab only if its id is also in `TreeLayout.ordinalCards`
	 * (the layout made room for it); the tab replaces the "You" tab of the same card. The texts are never part of the layout.
	 */
	ordinals?: ReadonlyMap<string, string>;
}

/** The DOM event that makes the tree view attach all delayed content at once (for the harness and the tests). */
export const FILL_ALL_EVENT = 'dynasty-fill-all';
/** The root attribute with `SceneFill.pending` ('0' on an empty root; the harness helper counts a missing attribute as 0). */
export const CARDS_PENDING_ATTR = 'data-dynasty-cards-pending';
/** 0.2.1: the root attribute with `SceneFill.pendingLines` (lines and partnership signs that are not built yet). */
export const LINES_PENDING_ATTR = 'data-dynasty-lines-pending';

/**
 * M11 (S4): attaches the delayed content of a lazy scene. Every call is safe to repeat; each returns how many cards, tags and
 * badges it attached. 0.2.1 (S3b): the same calls build the lines and partnership signs that wait, but those are counted by
 * `pendingLines` and never in a return value.
 */
export interface SceneFill {
	/** The cards, tags and badges near `view` (`boxNearView`), and the lines and signs near it. */
	fillNear(view: Rect): number;
	/** The card of `id`, its badge and its tags, and the lines that touch the card. False if the id is unknown. */
	fillPerson(id: string): boolean;
	/** Everything that is left. */
	fillAll(): number;
	/**
	 * Up to `max` cards, the nearest to `view` first, with the tags and badges that lie before the next card. The lines and signs
	 * that wait come in the same chunks, the nearest first, so that they end with the last card.
	 */
	fillChunk(view: Rect, max: number): number;
	/** Cards, tags and badges whose content is not attached yet; 0 in an eager scene. */
	readonly pending: number;
	/** Lines and partnership signs that are not built yet; 0 in an eager scene. */
	readonly pendingLines: number;
}

/** M10: how the scene draws the fold controls. */
export interface SceneFolds {
	/** Draw the open buttons too; false draws the "+ N" signs only (a saved picture, D71). */
	buttons: boolean;
	/** The accessible name and the tooltip of a control (F16), from `ui-text.ts`; `names` are the parents' `Person.name`, in order. */
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
	 * 0.3.1 fix3: the invisible strip of the tap area that lies over the bottom of the tag's own card, inside `el` and so above the cards:
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

/**
 * The path of the badge's tap disc: the circle of radius `r` around (`cx`, `cy`), with nothing above the line `top` (the
 * strip that a tag tap area covers). The tree view sets it again at each settled zoom (`badgeTap`).
 */
export function discPath(cx: number, cy: number, r: number, top: number): string {
	const n = (v: number) => String(Math.round(v * 100) / 100);
	const cut = cy - top;
	if (!(r > 0)) return '';
	if (cut >= r) return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}Z`;
	// A chord at `top`: the big arc runs round the bottom.
	const dx = Math.sqrt(Math.max(0, r * r - cut * cut));
	return `M${n(cx - dx)} ${n(top)}A${n(r)} ${n(r)} 0 ${cut > 0 ? 1 : 0} 0 ${n(cx + dx)} ${n(top)}Z`;
}

/** The SVG content `buildScene` built: the drawn elements, and a way to re-fit their text. */
export interface Scene {
	cards: Map<string, SVGGElement>;
	tags: TagRef[];
	badges: BadgeRef[];
	/** Name elements that are links, with their link text. */
	links: Map<SVGTextElement, string>;
	/**
	 * M9 (S1): the empty picture slots, in card order and, within a card, Full arms, portrait, then
	 * Compact arms. `buildScene` makes no `<image>`; `setPicture` fills a slot.
	 */
	pictures: PictureSlot[];
	/** M10: the fold controls, in drawing order; empty without `SceneOptions.folds`. */
	folds: FoldRef[];
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
	/** M11 (S4): the fill API; an eager scene has one that does nothing. */
	fill: SceneFill;
}

/** Compact names are this much larger than Full names (spec §5.4: a larger font that fills the card). */
export const COMPACT_NAME_EM = 1.5;
/** D203: at the Compact level a long name shrinks down to this size, in em, before it is cut. */
export const COMPACT_NAME_MIN_EM = 1.05;
/** The sizes a Compact name can have, in em, largest first. The steps are made by repeated subtraction, so the font strings (and the measure cache keys) stay as they were. */
export const COMPACT_STEPS: readonly number[] = (() => {
	const steps = [COMPACT_NAME_EM];
	for (let em = COMPACT_NAME_EM; em > COMPACT_NAME_MIN_EM + 1e-9; ) steps.push((em = Math.max(COMPACT_NAME_MIN_EM, em - 0.05)));
	return steps;
})();

/**
 * The index in `COMPACT_STEPS` of the size of a Compact name: the first size whose width `widthAt(k)` fits in `maxW`, else the smallest. This is the result of a walk down from
 * the top size, but a canvas measure is the cost, and the width follows the size almost linearly, so the room gives a first guess that one or two measures confirm.
 */
export function compactNameStep(widthAt: (k: number) => number, maxW: number): number {
	const w0 = widthAt(0);
	if (!(w0 > maxW)) return 0;
	const last = COMPACT_STEPS.length - 1;
	const want = (COMPACT_NAME_EM * maxW) / w0;
	let k = 1;
	while (k < last && COMPACT_STEPS[k] > want + 1e-9) k++;
	// `misfit` is the largest step that is known not to fit.
	let misfit = 0;
	while (k < last && widthAt(k) > maxW) misfit = k++;
	while (k - 1 > misfit && widthAt(k - 1) <= maxW) k--;
	return k;
}

/** Tag text size in em of the note font (matches the headless renderer). */
export const TAG_FONT_EM = 0.75;
/** Tag text at the Compact level is as large as the Compact name, so it is as readable. */
export const TAG_COMPACT_FONT_EM = COMPACT_NAME_EM;
/** Height of the Compact and Overview tag pill, in em. It grows up into the card, below the Compact name. */
export const TAG_COMPACT_PILL_EM = 2;
/** Radius of the focus-mode `+` badge, in em. 0.2.8 (I01): its centre lies on the arc of the card's rounded top right corner, the middle of that arc. */
export const BADGE_RADIUS_EM = 0.55;
// All font sizes are set in styles.css from --dynasty-font-size (spec §5.8: nothing that styles
// text is written into SVG attributes); these constants are what the measurement assumes.

/** The class name on the `<svg>` that picks one level of detail (spec §5.4). */
export const lodClass = (lod: string) => `dynasty-lod-${lod}`;

/**
 * The "illegitimate" sign (spec D14) for the Compact name, `scale` times the note font: the Full sign
 * from `cardText`, scaled about its top right end, then moved so it is centred on the capitals of
 * a name whose baseline is at `baseline`. Coordinates are from the card's top left corner.
 */
export function signAt(t: CardText, scale: number, baseline: number, rightX: number): CardText['sign'] {
	const s = t.sign;
	const size = (s.x1 - s.x2) * scale;
	// The sign is 1.125 em of the note font; the Compact name is `scale` times the note font (not the Full name size, 0.85 em), so the sign sits as in 0.2.3.
	const top = baseline - 0.35 * ((s.x1 - s.x2) / 1.125) * scale - size / 2;
	return { x1: rightX, y1: top, x2: rightX - size, y2: top + size, width: s.width * scale, dash: [s.dash[0] * scale, s.dash[1] * scale] };
}

/** The class of a part on the relation finder's line, or of a part faded beside it (D47). */
const stateCls = (s: LineState): string[] => (s === 'on' ? ['dynasty-on-line'] : s === 'faded' ? ['dynasty-faded'] : []);

/** The font the relation text is measured with: 0.85 em italic, "You" bold italic (styles.css, D117); `bold` is the bold weight of the page. */
export const relationFont = (size: number, family: string, you: boolean, bold = '700') => (you ? `italic ${bold} ${size}px ${family}` : `italic 400 ${size}px ${family}`);

/** D122: sets the pieces of a name text line: the name as text, the sobriquet in a regular `tspan`. */
function setRuns(el: SVGTextElement, runs: readonly NameRun[]): void {
	el.empty();
	for (const r of runs) {
		if (r.sob) el.createSvg('tspan', { cls: 'dynasty-card-sob' }).setText(r.text);
		else el.appendText(r.text);
	}
}

/** The box of a line or sign that has none we can read: near every view. */
const EVERYWHERE: Rect = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
/** Room added around a late line's box for its stroke and for the highlight's wider stroke, in px. */
const LATE_PAD = 4;
/** When no card waits, a chunk builds this many late lines for each card of its size. */
const LATE_LINES_PER_CARD_SLOT = 4;

/** Makes one element of a marker, in the layer or (lazy) as a free element that the layer then takes. */
type Maker = <K extends 'circle' | 'path' | 'g'>(tag: K, info: { cls: string[]; attr?: Record<string, string | number | boolean | null> }) => SVGElementTagNameMap[K];

/**
 * A layer whose members are made one by one in any order and still stand in their build order, so a layer that is
 * filled late serialises like one that was built at once. `reserve` takes the next place; `put` puts an element there.
 */
function orderedLayer(parent: SVGElement): { reserve: () => number; put: (slot: number, el: SVGElement) => SVGElement } {
	const els: (SVGElement | undefined)[] = [];
	// The slots that have an element, in order: the first one after a new slot is the element to insert before.
	const done: number[] = [];
	return {
		reserve: () => els.push(undefined) - 1,
		put(slot, el) {
			let lo = 0;
			let hi = done.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (done[mid] < slot) lo = mid + 1;
				else hi = mid;
			}
			parent.insertBefore(el, lo < done.length ? els[done[lo]]! : null);
			done.splice(lo, 0, slot);
			els[slot] = el;
			return el;
		},
	};
}

/** The corner radius (px) that ribbons use until the real one is read; it is the `rx` of the narrowest theme look (Cupertino). */
const CORNER_FALLBACK = 4;

/** The card corner radius that the last scene learned, so the next scene starts with it and has nothing to draw again (a speed gain; it is checked on the first sync). */
let learnedRadius: number | undefined;

/** Forgets the learned card corner radius (tests; the next scene starts with the fallback). */
export function resetLearnedCornerRadius(): void {
	learnedRadius = undefined;
}

/** Reads the computed corner radius (px) of an SVG rect; `fallback` when the element is detached or the value is unknown. */
export function readCornerRadius(el: Element, fallback: number): number {
	try {
		if (typeof getComputedStyle !== 'function' || el.isConnected === false) return fallback;
		const cs = getComputedStyle(el) as CSSStyleDeclaration & { rx?: string };
		const v = parseFloat(cs.rx ?? '');
		return Number.isFinite(v) && v >= 0 ? v : fallback;
	} catch {
		return fallback;
	}
}

/** Draws the whole tree's SVG content (lines, markers, cards, badges, tags) into `parent`. */
export function buildScene(parent: SVGGElement, g: FamilyGraph, laid: LaidOut, opts: SceneOptions): Scene {
	const { layout, edges } = laid;
	const geo = layout.geometry;
	const t = cardText(geo);
	const f = geo.fontPx;
	const roundel = isRoundel(geo);
	const textFont = (size: number, weight = '400') => `${weight} ${size}px ${opts.fonts.text}`;
	const fit = (text: string, maxW: number, font: string) => truncate(text, maxW, (s) => opts.measure(s, font));
	const fitters: (() => void)[] = [];
	const lazy = opts.lazyCards === true;
	/** A lazy item that has not got its content yet: where it lies, its person, and the step that attaches it. */
	interface Delayed {
		box: Rect;
		person: string;
		card: boolean;
		attach: () => void;
	}
	const delayed = new Set<Delayed>();
	/** B8 3: the step that makes the focus ring of a lazy card, by person. */
	const rings = new Map<string, () => void>();
	const byPerson = new Map<string, Delayed[]>();
	/** Where the content of a shell is built: the shell itself when eager, else a holder that is not in the document. */
	const holderFor = (shell: SVGGElement): SVGGElement => (lazy ? createSvg('g') : shell);
	/** R026 fit: the detail group of a card, and whether the card has made it (a lazy card makes it when it is filled). */
	interface BodyRef {
		person: string;
		card: SVGGElement;
		body: SVGGElement;
		made: boolean;
		/** True while the group is a child of its card. */
		in: boolean;
		/** True while a delayed item waits to put the group back. */
		waiting: boolean;
	}
	const bodies: BodyRef[] = [];
	// The card corner is the `rx` that the style sheet gives the card bg (from --radius-m, capped by the font size); the ribbon and badge paths need the number.
	// The scene is built before it is in the document. A new scene starts with the radius the last scene learned (the theme rarely changes), or with a fallback
	// for the very first one; `syncCornerRadius` then reads the first card bg that is in the document, once, and draws again only if the paths differ from it.
	// Never read per card, and never read a theme variable: the computed `rx` is the one value that is the card's own.
	let cornerR: number | undefined = opts.cornerRadius ?? learnedRadius;
	/** True when the radius is known for certain (the caller's, or read from a card bg), not guessed from the last scene. */
	let verified = opts.cornerRadius !== undefined;
	let firstBg: Element | undefined;
	/** The radius of the first path drawn, and whether a later path used another one. */
	let drawn: number | undefined;
	let mixed = false;
	const bars: ((r: number) => void)[] = [];
	const barRadius = (bg: Element): number => {
		firstBg ??= bg;
		if (cornerR === undefined) {
			const r = readCornerRadius(bg, -1);
			if (r >= 0) {
				cornerR = r;
				verified = true;
				learnedRadius = r;
			}
		}
		const use = cornerR ?? CORNER_FALLBACK;
		if (drawn === undefined) drawn = use;
		else if (use !== drawn) mixed = true;
		return use;
	};
	const syncCornerRadius = (force = false): void => {
		if (!firstBg || (verified && !force)) return;
		const r = readCornerRadius(firstBg, -1);
		if (r < 0) return;
		verified = true;
		learnedRadius = r;
		cornerR = r;
		if (mixed || r !== drawn) {
			bars.forEach((draw) => draw(r));
			drawn = r;
			mixed = false;
		}
	};
	let detail = true;
	const delay = (person: string, box: Rect, card: boolean, attach: () => void) => {
		const d: Delayed = { box, person, card, attach };
		delayed.add(d);
		if (card) cardsLeft++;
		const list = byPerson.get(person);
		if (list) list.push(d);
		else byPerson.set(person, [d]);
	};
	let cardsLeft = 0;
	/** 0.2.1 (S3b): a line or sign that is not built yet: where it lies and the step that builds it into its layer. */
	interface LateLine {
		box: Rect;
		put: () => void;
	}
	const lateLines = new Set<LateLine>();
	const lateLine = (box: Rect | null, put: () => void) => lateLines.add({ box: box ?? EVERYWHERE, put });
	const putLine = (l: LateLine): number => {
		if (!lateLines.delete(l)) return 0;
		l.put();
		return 1;
	};
	const attachChildren = (holder: SVGElement, shell: SVGElement) => {
		for (const c of Array.from(holder.children)) shell.appendChild(c);
	};
	const attachItem = (d: Delayed): number => {
		if (!delayed.delete(d)) return 0;
		if (d.card) cardsLeft--;
		d.attach();
		return 1;
	};
	/**
	 * The text fits of the card (or far-couple tag) that is being built in a lazy scene. They run when its content is attached (`fitsOnAttach`): nobody can see the
	 * text before, and the first view attaches about thirty of 400 cards. An eager scene has no such list and fits at once.
	 */
	let pendingFits: (() => void)[] | null = null;
	const addFit = (run: () => void) => {
		if (pendingFits) {
			pendingFits.push(run);
			return;
		}
		run();
		fitters.push(run);
	};
	/** Takes the fits collected since `pendingFits` was set; the returned step runs them once, and from then on a refit runs them too. */
	const fitsOnAttach = (): (() => void) => {
		const runs = pendingFits ?? [];
		pendingFits = null;
		let done = false;
		return () => {
			if (done) return;
			done = true;
			for (const run of runs) {
				run();
				fitters.push(run);
			}
		};
	};
	/** Sets `el` to `text` truncated to `maxW`, now and on every refit. A relation text (B6, D268) tries the short forms first, by this renderer's own measure. */
	const fitted = (el: SVGTextElement, text: string, maxW: number, font: string, relation = false, plain?: string) => {
		const run = () => el.setText(fitCardText(text, plain, maxW, (s) => opts.measure(s, font), relation));
		addFit(run);
	};

	/**
	 * D203: the Compact name is as large as the room allows, from 1.5 em down to 1.05 em in steps of 0.05 em, and is cut with "…" only when even the smallest size does
	 * not fit. The size goes to the text as the custom property `--dynasty-compact-em` (the style turns it into the font size). Runs again on every refit.
	 */
	const fittedShrinking = (el: SVGTextElement, text: string, maxW: number) => {
		/** True while the text carries a size of its own, so a name that fits again clears it and a name that always fits never touches the style. */
		let sized = false;
		const run = () => {
			const k = compactNameStep((i) => opts.measure(text, textFont(COMPACT_STEPS[i] * f, opts.fonts.bold)), maxW);
			const em = COMPACT_STEPS[k];
			// A name that fits at the top size is not cut, so there is nothing to measure again.
			el.setText(k === 0 ? text : truncate(text, maxW, (s) => opts.measure(s, textFont(em * f, opts.fonts.bold))));
			if (k === 0) {
				if (sized) el.style.removeProperty('--dynasty-compact-em');
				sized = false;
			} else {
				el.style.setProperty('--dynasty-compact-em', String(Math.round(em * 100) / 100));
				sized = true;
			}
		};
		addFit(run);
	};

	// D47: the relation finder's line; without one every part is drawn as usual.
	const look = lineLook(g, layout, edges, opts.line);
	const linesEl = parent.createSvg('g', { cls: 'dynasty-lines' });
	const linesLayer = lazy ? orderedLayer(linesEl) : null;
	for (const p of look.paths) {
		const info = { cls: ['dynasty-line', `dynasty-line-${p.kind}`, ...stateCls(p.state)], attr: { d: p.d } };
		if (!linesLayer) {
			linesEl.createSvg('path', info);
			continue;
		}
		const slot = linesLayer.reserve();
		lateLine(pathBox(p.d, LATE_PAD), () => linesLayer.put(slot, createSvg('path', info)));
	}

	const markersEl = parent.createSvg('g', { cls: 'dynasty-markers' });
	const markersLayer = lazy ? orderedLayer(markersEl) : null;
	/** Builds one marker: into the layer at once, or (lazy) when its box comes near the view. */
	const markerAt = (box: Rect, draw: (make: Maker) => void) => {
		if (!markersLayer) {
			draw((tag, info) => markersEl.createSvg(tag, info));
			return;
		}
		const slot = markersLayer.reserve();
		lateLine(box, () =>
			draw((tag, info) => {
				const el = createSvg(tag, info);
				markersLayer.put(slot, el);
				return el;
			}),
		);
	};
	edges.markers.forEach((m, i) => {
		const state = stateCls(look.markers[i]);
		if (m.kind === 'union' || m.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership; no recorded partnership has none.
			const shape = unionShape(m.kind, m.unionType);
			if (!shape) return;
			const size = UNION_MARKS[shape].size * geo.unionSize;
			const half = size + LATE_PAD;
			markerAt({ x: m.x - half, y: m.y - half, w: 2 * half, h: 2 * half }, (make) => {
				const mark = unionMark(shape, m.x, m.y, size);
				make(mark.tag, { cls: [...unionMarkClass(shape), ...state], attr: mark.attr });
			});
		} else {
			const r = 0.5 * f;
			const half = f + LATE_PAD;
			markerAt({ x: m.x - half, y: m.y - half, w: 2 * half, h: 2 * half }, (make) => {
				const q = make('g', { cls: ['dynasty-rumour-marker', ...state] });
				q.createSvg('circle', { attr: { cx: m.x, cy: m.y, r } });
				const size = RUMOUR_FONT_EM * f;
				q.createSvg('text', { attr: { x: m.x, y: m.y + 0.35 * size, 'text-anchor': 'middle' } }).setText('?');
			});
		}
	});

	// The tags' enlarged tap areas lie below the cards: at a low zoom a 44 px area can cover a whole
	// small card, and a press on a card must open its sheet (spec §7.2). The visible pills stay on top.
	// 0.2.4: the badge squares lie under all of these, so a tag or a fold control wins where it meets one (contract 4.2 E1).
	const badgeHitsEl = parent.createSvg('g', { cls: 'dynasty-badge-hits' });
	const hitsEl = parent.createSvg('g', { cls: 'dynasty-tag-hits' });
	// The tap areas of the open fold buttons share one group, so the Overview level hides them with one rule. It moves to the end of the layer after the tags are made (below).
	const openFoldHitsEl = hitsEl.createSvg('g', { cls: 'dynasty-fold-hits-open' });

	const cardsEl = parent.createSvg('g', { cls: 'dynasty-cards' });
	const cards = new Map<string, SVGGElement>();
	const badges: BadgeRef[] = [];
	// M10: a control is drawn right after the card (and badge) of the later of its parents, so the Tab key reaches it next.
	const folds: FoldRef[] = [];
	const foldsAfter = new Map<string, PlacedFoldControl[]>();
	if (opts.folds) {
		const at = new Map([...layout.persons.keys()].map((id, i) => [id, i]));
		for (const c of layout.folds ?? []) {
			if (!opts.folds.buttons && !c.folded) continue;
			const known = c.parents.filter((id) => at.has(id));
			if (!known.length) continue;
			const last = known.reduce((a, b) => (at.get(b)! > at.get(a)! ? b : a));
			const list = foldsAfter.get(last);
			if (list) list.push(c);
			else foldsAfter.set(last, [c]);
		}
	}
	const drawFolds = (list: readonly PlacedFoldControl[] | undefined) => {
		for (const c of list ?? []) {
			const label = opts.folds!.label(
				c,
				c.parents.map((id) => g.byId.get(id)?.name ?? id),
			);
			folds.push(drawFold({ controls: cardsEl, hits: hitsEl, openHits: openFoldHitsEl, fonts: opts.fonts, measure: opts.measure, em: f, label, fitters, ...(layout.orientation === 'sideways' ? { anchored: true } : {}), ...(opts.folds!.wire ? { wire: opts.folds!.wire } : {}), ...(opts.folds!.lazy ? { lazy: true } : {}) }, c));
		}
	};
	const links = new Map<SVGTextElement, string>();
	const nameFont = textFont(t.nameSize, opts.fonts.bold);
	const smallFont = textFont(t.smallSize);
	// The Compact name is 1.5 em of the note font, not of the Full name size (0.85 em): Compact looks as in 0.2.3.
	const compactSize = COMPACT_NAME_EM * f;
	// 0.2.8: the sideways card's Compact name starts 0.6 em after the ribbon and ends 0.6 em before the edge.
	const compactW = geo.cardW - ribbonWidth(geo) - 1.2 * f;
	const signed = illegitimateSigns(g, edges);
	// D29, D61: a tall card has two Full name or title text lines; its Compact name stays one line, centred.
	const tallTexts = new Map<string, CardText>();
	const textOf = (box: PersonBox, shown?: ShownLines, wordless = false): CardText => {
		const count = nameCountOf(box);
		if (count === 1 && !box.tallTitle && !shown && !wordless) return t;
		const key = `${count}${box.tallTitle ? 1 : 0}${shown ? `${shown.title ? 1 : 0}${shown.dates ? 1 : 0}` : ''}${wordless ? 'w' : ''}`;
		let ct = tallTexts.get(key);
		if (!ct) {
			ct = cardText(geo, count, box.tallTitle, shown);
			if (wordless) ct = centredWithoutWord(geo, ct);
			tallTexts.set(key, ct);
		}
		return ct;
	};
	const measureSmall = (s: string) => opts.measure(s, smallFont);
	// The Roundel's Compact name is centred in the body below the crown (B.3.7); every other card has no crown.
	const compactBaseline = (h: number, crown = 0) => crown + (h - crown) / 2 + 0.35 * compactSize;
	const compactSign = (h: number) => signAt(t, COMPACT_NAME_EM, compactBaseline(h), t.sign.x1);
	const baseCompactSign = compactSign(geo.cardH);
	// The Compact name stops short of the sign by the same clear gap as the Full name.
	const compactWithSignW = compactW - (baseCompactSign.x1 - baseCompactSign.x2) - 0.5 * f;
	const regularFont = textFont(t.nameSize);
	const nameMeasure: NameMeasure = (s, sob) => opts.measure(s, sob ? regularFont : nameFont);
	const pictures: PictureSlot[] = [];
	const drawSign = (parentEl: SVGGElement, x: number, y: number, s: CardText['sign']) =>
		parentEl.createSvg('line', {
			cls: 'dynasty-sign',
			attr: { x1: x + s.x1, y1: y + s.y1, x2: x + s.x2, y2: y + s.y2, 'stroke-width': s.width, 'stroke-dasharray': s.dash.join(' ') },
		});
	/**
	 * D61: the title text line from a card label, on the box's one or two text lines. A box the layout
	 * did not make taller shows one text line, cut with "…", until the tree view lays it out again.
	 */
	const drawTitle = (fullEl: SVGGElement, box: PersonBox, ct: CardText, title: string | undefined, plainReign: string | undefined, namedReign: string | undefined) => {
		const x = box.x + (ct.anchorX ?? t.padX);
		const first = fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.titleBaseline } });
		const second = box.tallTitle && ct.title2Baseline !== undefined ? fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.title2Baseline } }) : undefined;
		const run = () => {
			// Spec §14 rule 15: a one-line room that cannot hold the names takes the plain reign, so a text that needs a cut is always the plain one.
			const lines = titleLines(title, pickReign(title, namedReign, plainReign, t.textW, measureSmall, !!second), t.textW, measureSmall);
			if (second) {
				first.setText(lines[0] ?? '');
				second.setText(lines[1] ?? '');
			} else first.setText(lines.length > 1 ? fit([title, plainReign].filter(Boolean).join(' '), t.textW, smallFont) : (lines[0] ?? ''));
		};
		addFit(run);
	};

	const heirIds = new Set(opts.heirs ?? []);
	const ordinalIds = new Set(layout.ordinalCards ?? []);
	for (const box of layout.persons.values()) {
		const p = g.byId.get(box.id);
		if (!p) continue;
		const house = p.house ? g.houses.get(p.house) : undefined;
		const isMe = opts.me !== undefined && p.id === opts.me;
		const relation = opts.relations?.get(p.id);
		// M8: the card's name and title text lines; without a label, the person's own (M7).
		const cl = opts.labels?.get(p.id);
		const shownName = cl ? cl.name : p.name;
		// §13.1: the label names the relation, also when a class hides the text on the card.
		const label = cardLabel(p, isMe ? 'you' : relation?.lower, cl, undefined, g.dates);
		const cls = ['dynasty-card', ...(roundel ? ['dynasty-card-r1'] : ['dynasty-card-tc']), ...(isDead(p) ? ['dynasty-deceased'] : []), ...(heirIds.has(p.id) ? ['dynasty-heir'] : []), ...(isMe ? ['dynasty-card-me'] : []), ...stateCls(look.card(p.id))];
		const card = cardsEl.createSvg('g', {
			cls: cls.length === 1 ? 'dynasty-card' : cls,
			attr: { tabindex: 0, role: 'group', 'aria-label': label, 'data-person': p.id },
		});
		const colour = house?.color;
		if (isColour(colour)) {
			card.style.setProperty('--dynasty-house-color', colour);
			// D27: only a house colour is lifted in the dark theme, not the no-house grey.
			card.addClass('dynasty-has-house');
		}
		cards.set(p.id, card);
		pendingFits = lazy ? [] : null;

		// The second focus and highlight ring, under the card: the accent alone can be too weak in a theme.
		// A lazy card keeps only its bg rect (its size and hit area). Its ring is made by `fillPerson` and `fillAll` only (B8 3): the ring shows only
		// for the keyboard focus and the highlight, and both ask for the person first.
		const ringInfo = { cls: 'dynasty-card-ring', attr: { x: box.x, y: box.y, width: box.w, height: box.h } };
		const ringNow = !lazy;
		if (ringNow) card.createSvg('rect', ringInfo);
		const bg = card.createSvg('rect', { cls: 'dynasty-card-bg', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
		// B.3.3: the Roundel's medallion and arms stand on the top edge; the text card has none (it never reads the picture flags).
		// 0.2.8 (I05, D204): a card shows the arms of its person (A.1) or else of its house.
		const hasArms = !!(box.arms && (p.arms || house));
		const rp = roundel ? roundelPics(geo, { arms: hasArms, portrait: !!box.portrait }) : undefined;
		// F.4: the ordinal tab replaces the "You" tab of the same card.
		const ordinal = ordinalIds.has(p.id) ? opts.ordinals?.get(p.id) : undefined;
		const hasTab = layout.youTab === p.id && !ordinal;
		// B.3.6: a press on the part that sticks out above the card (the halo, the arms, the tab) opens the sheet and never pans; it is in the shell, so a card that is not filled yet has it.
		const above: number[] = [];
		if (rp?.portrait) above.push(rp.cx - rp.haloR, rp.cx + rp.haloR);
		if (rp?.arms) above.push(rp.arms.x, rp.arms.x + rp.arms.w);
		const tab = hasTab ? youTabRect(geo, !!rp?.portrait, !!rp?.arms) : undefined;
		if (tab) above.push(tab.x, tab.x + tab.w);
		const ordTab = ordinal ? ordinalTabRect(geo, !!rp?.portrait, !!rp?.arms, [...ordinal].length) : undefined;
		// F.4: the ordinal tab has no tap target of its own; a press on it is a press on the card, through the same crown area as the "You" tab.
		if (ordTab) above.push(ordTab.x, ordTab.x + ordTab.w);
		if (above.length && geo.reach) {
			const x0 = Math.min(...above);
			card.createSvg('rect', { cls: 'dynasty-card-crown-hit', attr: { x: box.x + x0, y: box.y - geo.reach, width: Math.max(...above) - x0, height: geo.reach } });
		}
		// R026 fit: the level-specific parts of a card (bar, Full group, Compact text, sign, arms) are in one group. The Overview level hides that one group, so the browser
		// restyles one element for each card, not every part (a class swap on the root restyled 3 000 elements, 108 ms at 4x CPU). A lazy card makes the group apart and attaches it whole.
		const body = lazy ? createSvg('g', { cls: 'dynasty-card-body' }) : card.createSvg('g', { cls: 'dynasty-card-body' });
		const bodyRef: BodyRef = { person: p.id, card, body, made: !lazy, in: !lazy, waiting: false };
		bodies.push(bodyRef);
		// 0.2.8 (contract C, G.15): the house ribbon is a path with the card's own rounded corners; on the marked card it lies inside the thick border. The radius comes
		// from the theme at run time (`readCornerRadius`), so the path is made again when it becomes known (`setCornerRadius`).
		const rib = ribbonWidth(geo);
		const inset = isMe ? ME_RING_INNER : 0;
		const ribbonD = (r: number) => ribbonPath(box.x + inset, box.y + inset, roundel ? box.w - 2 * inset : rib, roundel ? rib : box.h - 2 * inset, rib, Math.max(0, r - inset), roundel ? 'top' : 'left');
		const ribbon = body.createSvg('path', { cls: 'dynasty-card-ribbon', attr: { d: ribbonD(barRadius(bg)) } });
		bars.push((r) => ribbon.setAttribute('d', ribbonD(r)));

		const tall = !!(box.tallName || box.tallTitle);
		// B.3.2: the lines that exist are centred in the body, so the text block needs to know which small lines the person has. The dates line counts even when "Show dates on cards" is off (the class hides it), as the saved picture centres it.
		const titleText = cl ? cl.title : p.title;
		const reign = cl && opts.showDates !== false ? cl.reign : undefined;
		const shown: ShownLines = { title: !!(titleText || reign), dates: !!dateLine(p, g.dates, { names: 'none' }) };
		// D177 (10): a card with no relation word, in a tree with relation words, centres its text in the whole card.
		const ct = textOf(box, shown, geo.relationLine === true && !!opts.relations && !relation?.text);
		const tx = box.x + (ct.anchorX ?? t.padX);
		const n = opts.badges?.hidden.get(p.id);
		// D122: the sobriquet follows the name at the Full level (Compact and Overview show the name only).
		const sob = cl?.sobriquet ?? p.sobriquet;
		const full = body.createSvg('g', { cls: 'dynasty-card-full' });
		if (ct.r1?.plate && relation?.text) {
			// 0.2.8: the foot is a hairline over the relation word (there is no footer plate). A person with no relation word has no hairline
			// (the card keeps its height, so a row keeps one height).
			const span = footSpan(geo, box.w, isMe ? ME_RING_INNER : 1);
			const y0 = box.y + ct.r1.plate.y + 0.5;
			full.createSvg('line', { cls: 'dynasty-card-foot-line', attr: { x1: box.x + span.x0, y1: y0, x2: box.x + span.x1, y2: y0 } });
		}
		const link = opts.link(p);
		const nameEl = (baseline: number) =>
			full.createSvg('text', {
				cls: link ? ['dynasty-card-name', 'dynasty-name-link', ...(link.resolved ? [] : ['is-unresolved'])] : 'dynasty-card-name',
				attr: { x: tx, y: box.y + baseline },
			});
		const name = nameEl(ct.nameBaseline);
		const sign = signed.has(p.id);
		if (sign) {
			card.addClass('dynasty-signed');
			card.setAttribute('aria-label', `${label}, ${SIGN_CARD_LABEL}`);
		}
		// D96: on the marked card the sign keeps clear of the mark's inner ring.
		const markRing = isMe ? ME_RING_INNER : undefined;
		const count = nameCountOf(box);
		// The Roundel's room depends on the marked ring (B.3.2).
		const room = nameRoom(geo, ct, sign, markRing);
		const names = [name];
		if (count > 1 && ct.name2Baseline !== undefined) {
			names.push(nameEl(ct.name2Baseline));
			if (count > 2 && ct.name3Baseline !== undefined) names.push(nameEl(ct.name3Baseline));
		}
		const runNames = () => {
			// A box the layout made taller for fewer text lines than the name needs shows at most that many until the tree view lays it out again.
			const lines = isolateLines(cardNameLines(shownName, sob, room, nameMeasure, names.length as NameLineCount, opts.breaks));
			names.forEach((el, i) => setRuns(el, lines[i] ?? []));
		};
		addFit(runNames);
		if (sign) drawSign(full, box.x, box.y, markRing === undefined ? ct.sign : signBelowRing(ct.sign, markRing));
		if (link) {
			for (const el of names) {
				el.setAttribute('data-href', link.linktext);
				links.set(el, link.linktext);
			}
		}
		// D61: with a label, the title text line carries the reign, unless dates are off.
		const hasTitle = !!titleText || !!reign;
		if (cl) {
			if (hasTitle) drawTitle(full, box, ct, titleText, reign, shownReign(cl, g.dates, 'shown'));
		} else if (p.title) {
			fitted(full.createSvg('text', { cls: 'dynasty-card-title', attr: { x: tx, y: box.y + ct.titleBaseline } }), p.title, ct.textW, smallFont);
		}
		const dates = dateLine(p, g.dates);
		const datesBaseline = hasTitle ? ct.datesBaseline : ct.titleBaseline;
		if (dates) {
			fitted(full.createSvg('text', { cls: 'dynasty-card-dates', attr: { x: tx, y: box.y + datesBaseline } }), dates, ct.textW, smallFont, false, dateLine(p, g.dates, { names: 'none' }));
		}
		const relY = relationY(ct);
		if (relation?.text && relY !== undefined) {
			// D40: a name too long for the card ends with "…"; the sheet shows it in full.
			// D176 (5): a text with a maybe keeps " ?" when it is cut, so the word and the suffix are cut apart.
			// D268: before it is cut, the text tries the short forms; only the drawn card does (the sheet, the label and the list keep the whole text).
			fitted(full.createSvg('text', { cls: 'dynasty-card-relation', attr: { x: tx, y: box.y + relY } }), relation.text, ct.relationW ?? ct.textW, relationFont(t.smallSize, opts.fonts.text, isMe, opts.fonts.bold), true);
		}
		if (rp) {
			// B.3.3, WP-B8: one set of elements for both levels. The Compact level shows the Full group with its text hidden (styles.css), so the medallion and
			// the arms are the same elements at both levels, at the same places; the live pictures choose slots by level, so each picture has a Compact slot
			// that shares the element and the frame with its Full slot. The arms go first.
			const full2: PictureSlot[] = [];
			if (rp.arms) {
				const r = rp.arms;
				const el = full.createSvg('g', { cls: 'dynasty-arms' });
				const rect = { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h };
				// D219: the gap round the arms follows the outline of the picture. It is drawn when the picture and its outline are in the slot (`setArmsGap`), never before.
				// The slot's owner: the person (personal arms) or the house.
				const owner: PictureOwner = p.arms ? { person: p.id } : { house: p.house! };
				full2.push({ kind: 'arms', lod: 'full', person: p.id, owner, rect, el, gap: ROUNDEL_EM.halo * f });
			}
			if (rp.portrait) {
				const r = rp.portrait;
				const rect = { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h };
				const el = full.createSvg('g', { cls: 'dynasty-portrait' });
				// D219: a gap in the colour of the page round the picture keeps the line and the card edge off it. The frame is a thin outline on the picture's edge
				// that shows only while the picture is missing or has not come (the style).
				el.createSvg('circle', { cls: 'dynasty-r1-halo', attr: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r: rp.haloR } });
				const frame = el.createSvg('circle', { cls: 'dynasty-portrait-frame', attr: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r: rp.ringR - FRAME_STROKE_PX / 2 } });
				full2.push({ kind: 'portrait', lod: 'full', person: p.id, rect, el, frame });
			}
			pictures.push(...full2, ...full2.map((slot): PictureSlot => ({ ...slot, lod: 'compact' })));
		}
		if (tab) {
			// D148: the small "You" tab on the top edge. It stands in the Full group, so the Compact and Overview levels hide it; the border still marks the person.
			const tabEl = full.createSvg('g', { cls: 'dynasty-r1-tab-group' });
			// D153: the base is a card-colour pill with a wide edge, so the border and the line above the card do not show through it.
			tabEl.createSvg('rect', { cls: 'dynasty-r1-tab-base', attr: { x: box.x + tab.x, y: box.y + tab.y, width: tab.w, height: tab.h, rx: tab.h / 2 } });
			tabEl.createSvg('rect', { cls: 'dynasty-r1-tab', attr: { x: box.x + tab.x, y: box.y + tab.y, width: tab.w, height: tab.h, rx: tab.h / 2 } });
			tabEl.createSvg('text', { cls: 'dynasty-r1-tab-text', attr: { x: box.x + tab.x + tab.w / 2, y: box.y + tab.y + tab.h / 2 + TAB_TEXT_BASE_EM * f } }).setText(ME_WORD);
		}
		if (ordTab) {
			// F.4: the ordinal tab, at the Full level only like the "You" tab. A card-colour base keeps the border and the line above the card from showing through.
			const tabEl = full.createSvg('g', { cls: 'dynasty-ordinal-tab-group', attr: { 'aria-hidden': 'true' } });
			const rect = { x: box.x + ordTab.x, y: box.y + ordTab.y, width: ordTab.w, height: ordTab.h, rx: ORDINAL_EM.corner * f };
			tabEl.createSvg('rect', { cls: 'dynasty-ordinal-tab-base', attr: rect });
			tabEl.createSvg('rect', { cls: 'dynasty-ordinal-tab', attr: rect });
			tabEl.createSvg('text', { cls: 'dynasty-ordinal-tab-text', attr: { x: box.x + ordTab.x + ordTab.w / 2, y: box.y + ordTab.y + ordTab.h / 2 + TAB_TEXT_BASE_EM * f } }).setText(ordinal!);
		}

		const compact = body.createSvg('text', {
			cls: 'dynasty-card-compact',
			attr: roundel ? { x: box.x + (ct.anchorX ?? t.padX), y: box.y + compactBaseline(box.h, ct.r1?.crown ?? 0) } : { x: box.x + rib + 0.6 * f, y: box.y + compactBaseline(box.h) },
		});
		// B.3.7: the Roundel's Compact sign is the Full one; its text is centred, so the name stops short of the sign only where the two can meet.
		const cs = sign ? (roundel ? ct.sign : tall ? compactSign(box.h) : baseCompactSign) : undefined;
		const shownCs = cs && markRing !== undefined ? signBelowRing(cs, markRing) : cs;
		// The Compact name's capitals are 0.7 em of its size above its baseline; a name under the sign (no crown, the sign level with line 1) takes the narrow room.
		const roundelCompactW = shownCs && compactBaseline(box.h, ct.r1?.crown ?? 0) - 0.7 * compactSize < signBottomOf(shownCs) ? ct.nameWithSignW : ct.textW;
		// Unsigned, the Compact name ends 0.25 em from the card's edge, not 0.5 em like the Full name.
		// With the sign it ends 0.5 em before the sign.
		const compactNameW = roundel ? roundelCompactW : sign ? compactWithSignW : compactW;
		fittedShrinking(compact, shownName, compactNameW);
		if (shownCs) drawSign(body.createSvg('g', { cls: 'dynasty-card-compact-sign' }), box.x, box.y, shownCs);
		const cardFits = fitsOnAttach();
		if (lazy) {
			let ringMade = ringNow;
			rings.set(p.id, () => {
				if (ringMade) return;
				ringMade = true;
				card.insertBefore(createSvg('rect', ringInfo), bg);
			});
			delay(p.id, box, true, () => {
				cardFits();
				bodyRef.made = true;
				if (detail) {
					card.appendChild(body);
					bodyRef.in = true;
				}
			});
		}

		// The `+` badge goes right after its card: the Tab key reaches a card, then its own badge. It
		// shows over its own card's corner; a card drawn later still wins where the two meet.
		if (n && opts.badges) {
			const r = BADGE_RADIUS_EM * f;
			const arm = 0.5 * r;
			// 0.2.8 (I01): an outline disc whose centre lies on the middle of the arc of the card's rounded top right corner, so the disc sits in the corner
			// and does not stick out of it. The corner radius comes from the theme at run time, so the places are set again when it becomes known (`setCornerRadius`).
			const mark = { x: 0, y: 0, w: 2 * r, h: 2 * r };
			const el = cardsEl.createSvg('g', {
				cls: 'dynasty-focus-badge',
				attr: { tabindex: 0, role: 'button', 'aria-label': opts.badges.label(p, n), 'data-person': p.id, 'data-hidden': n },
			});
			// The square is below the cards, so the own card wins over it; the disc is the one part of the badge that wins over its card. Its first size is 3 em (G.13); the tree view sizes it again at each settled zoom.
			const hitSide = HIT_EM * f;
			const hit = badgeHitsEl.createSvg('rect', { cls: 'dynasty-focus-badge-hit', attr: { x: 0, y: 0, width: hitSide, height: hitSide, 'data-badge': p.id } });
			const disc = el.createSvg('path', { cls: 'dynasty-focus-badge-disc' });
			const bb = holderFor(el);
			const circle = bb.createSvg('circle', { cls: 'dynasty-focus-badge-mark', attr: { r } });
			const plus = bb.createSvg('path', { cls: 'dynasty-focus-badge-plus', attr: { 'stroke-width': 0.11 * f } });
			const place = (cr: number) => {
				const c = cr > 4 ? cr - cr / Math.SQRT2 : 0;
				const cx = box.x + box.w - c;
				const cy = box.y + c;
				mark.x = cx - r;
				mark.y = cy - r;
				hit.setAttribute('x', String(cx + r - hitSide));
				hit.setAttribute('y', String(cy - hitSide / 2));
				disc.setAttribute('d', discPath(cx, cy, r, cy));
				circle.setAttribute('cx', String(cx));
				circle.setAttribute('cy', String(cy));
				plus.setAttribute('d', `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}`);
			};
			place(barRadius(bg));
			bars.push(place);
			if (lazy) delay(p.id, mark, false, () => attachChildren(bb, el));
			badges.push({ person: p.id, el, hit, disc, mark });
		}
		drawFolds(foldsAfter.get(p.id));
		foldsAfter.delete(p.id);
	}
	// A control whose parent has no person in the graph is still drawn.
	for (const list of foldsAfter.values()) drawFolds(list);

	// Tags go last: their pills sit on the card's bottom edge and show over it (D10).
	const tagsEl = parent.createSvg('g', { cls: 'dynasty-tags' });
	const tags: TagRef[] = [];
	const tagFont = (em: number) => `400 ${em * f}px ${opts.fonts.ui}`;
	const small = tagFont(TAG_FONT_EM);
	const large = tagFont(TAG_COMPACT_FONT_EM);
	const bigH = TAG_COMPACT_PILL_EM * f;
	// 0.2.1: a far couple with no children has no union dot, so its tag carries the partnership sign.
	const farSigns = farTagSigns(g, layout, edges);
	for (const tag of layout.farTags.values()) {
		const prefix = '⚭ ';
		const rest = farTagName(g, tag.spouses);
		const top = tagTop(geo, tag.y);
		const bottom = top + geo.tagH;
		const tagState = stateCls(look.tag(tag));
		const el = tagsEl.createSvg('g', {
			cls: tagState.length ? ['dynasty-tag', ...tagState] : 'dynasty-tag',
			attr: { tabindex: 0, role: 'button', 'aria-label': farTagLabel(g, tag.spouses), 'data-person': tag.person },
		});
		const over = el.createSvg('rect', { cls: 'dynasty-tag-over', attr: { x: tag.hit.x, y: tag.hit.y, width: 0, height: 0 } });
		const pills = holderFor(el);
		const hit = hitsEl.createSvg('rect', { cls: 'dynasty-tag-hit', attr: { x: tag.hit.x, y: tag.hit.y, width: tag.hit.w, height: tag.hit.h, 'data-person': tag.person } });
		// The pill never grows past its zone (FarTag.zoneW): in `sideways` the tap area can be wider than the card's edge.
		const zone = tag.zoneW ?? tag.hit.w;
		// One rendering per level of detail, like the cards; a class on the <svg> shows one.
		const pill = (cls: string, font: string, fontEm: number, h: number, text: string, fitText: boolean, shape?: UnionShape) => {
			const pad = h / 2;
			const part = pills.createSvg('g', { cls });
			const ring = part.createSvg('rect', { cls: 'dynasty-tag-ring', attr: { y: bottom - h, height: h, rx: h / 2 } });
			const rect = part.createSvg('rect', { cls: 'dynasty-tag-pill', attr: { y: bottom - h, height: h, rx: h / 2 } });
			const textEl = part.createSvg('text', { cls: 'dynasty-tag-text', attr: { x: tag.x, y: bottom - h / 2 + 0.35 * fontEm * f, 'text-anchor': 'middle' } });
			// 0.2.1: the partnership sign sits between the ⚭ and the name. The text stays one text element; en spaces leave
			// the room, and the sign is drawn on that room, found with the same measure as the text.
			const markPx = fontEm * f;
			const markAt = (cx: number) => unionMark(shape!, cx, bottom - h / 2, UNION_MARKS[shape!].size * TAG_MARK.unit * markPx);
			const markEl = shape ? part.createSvg(markAt(0).tag, { cls: ['dynasty-tag-mark', ...unionMarkClass(shape)], attr: markAt(0).attr }) : undefined;
			const run = () => {
				let lead = prefix;
				if (shape) {
					const en = opts.measure(' ', font);
					// Rounded up: the room is never smaller than the shape needs (D108); a little more only moves the name right.
					lead = prefix + ' '.repeat(en > 0 ? Math.max(1, Math.ceil(tagMarkSlot(shape, markPx) / en - 1e-9)) : 2);
				}
				const label = fitText ? lead + fit(rest, Math.max(0, zone - 2 * pad - opts.measure(lead, font)), font) : text;
				const w = Math.min(zone, opts.measure(label, font) + 2 * pad);
				for (const r of [ring, rect]) {
					r.setAttribute('x', String(tag.x - w / 2));
					r.setAttribute('width', String(w));
				}
				textEl.setText(label);
				if (markEl) {
					// D108: the sign is placed from the start of the name, so the gap before the name is the same for every
					// shape whatever the width of a space; the spaces above leave at least a gap G on the left of the shape.
					const nameStart = tag.x - opts.measure(label, font) / 2 + opts.measure(lead, font);
					const cx = nameStart - tagMarkGap(markPx) - tagMarkHalfWidth(shape!, markPx);
					const at = markAt(cx).attr;
					if ('d' in at) markEl.setAttribute('d', at.d);
					else {
						markEl.setAttribute('cx', String(at.cx));
						markEl.setAttribute('cy', String(at.cy));
						markEl.setAttribute('r', String(at.r));
					}
				}
			};
			addFit(run);
		};
		const farShape = farSigns.has(tag.person) ? unionShape('union', farSigns.get(tag.person)) : null;
		pendingFits = lazy ? [] : null;
		pill('dynasty-tag-full', small, TAG_FONT_EM, geo.tagH, '', true, farShape ?? undefined);
		pill('dynasty-tag-compact', large, TAG_COMPACT_FONT_EM, bigH, '', true, farShape ?? undefined);
		pill('dynasty-tag-sign', large, TAG_COMPACT_FONT_EM, bigH, '⚭', false);
		const tagFits = fitsOnAttach();
		if (lazy)
			delay(tag.person, tag.hit, false, () => {
				tagFits();
				attachChildren(pills, el);
			});
		tags.push({ tag, el, hit, over });
	}

	// A tap area made later (a lazy button) lies after the tag areas; the group takes that place for every button, as before.
	hitsEl.appendChild(openFoldHitsEl);

	let chain: { cx: number; cy: number; items: Delayed[]; at: number } | null = null;
	let lineChain: { cx: number; cy: number; items: LateLine[]; at: number } | null = null;
	/** Builds up to `count` late lines, the nearest to the point first. The order is sorted once for each point, like `chain`. */
	const fillLines = (cx: number, cy: number, count: number) => {
		if (count <= 0 || !lateLines.size) return;
		if (!lineChain || lineChain.cx !== cx || lineChain.cy !== cy) {
			const order = [...lateLines].map((l) => ({ l, k: (l.box.x + l.box.w / 2 - cx) ** 2 + (l.box.y + l.box.h / 2 - cy) ** 2 }));
			order.sort((a, b) => a.k - b.k);
			lineChain = { cx, cy, items: order.map((o) => o.l), at: 0 };
		}
		let left = count;
		while (left > 0 && lineChain.at < lineChain.items.length) left -= putLine(lineChain.items[lineChain.at++]);
	};
	const fill: SceneFill = lazy
		? {
				fillNear(view) {
					let n = 0;
					for (const d of [...delayed]) if (boxNearView(d.box, view)) n += attachItem(d);
					if (lateLines.size) for (const l of [...lateLines]) if (boxNearView(l.box, view)) putLine(l);
					return n;
				},
				fillPerson(id) {
					const box = layout.persons.get(id);
					if (!cards.has(id) || !box) return cards.has(id);
					for (const d of byPerson.get(id) ?? []) attachItem(d);
					rings.get(id)?.();
					// The lines that touch the card come with it; their boxes include the stroke room.
					if (lateLines.size) {
						for (const l of [...lateLines]) {
							const b = l.box;
							if (b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) putLine(l);
						}
					}
					return true;
				},
				fillAll() {
					let n = 0;
					for (const d of [...delayed]) n += attachItem(d);
					for (const make of rings.values()) make();
					for (const l of [...lateLines]) putLine(l);
					return n;
				},
				fillChunk(view, max) {
					if (max <= 0) return 0;
					const cx = view.x + view.w / 2;
					const cy = view.y + view.h / 2;
					// The lines are spread over the chunks that the cards still need, so both end together; with no card left they come in chunks of their own.
					if (lateLines.size) fillLines(cx, cy, cardsLeft > 0 ? Math.ceil(lateLines.size / Math.ceil(cardsLeft / max)) : LATE_LINES_PER_CARD_SLOT * max);
					if (!delayed.size) return 0;
					// The order is sorted once per chain: the same view centre keeps the list and a cursor. Items that other fills attached meanwhile are skipped.
					if (!chain || chain.cx !== cx || chain.cy !== cy) {
						// Squared distance from the view's centre to the item's centre: nearest first, so the cards the person looks at come first.
						const order = [...delayed].map((d) => ({ d, k: (d.box.x + d.box.w / 2 - cx) ** 2 + (d.box.y + d.box.h / 2 - cy) ** 2 }));
						order.sort((a, b) => a.k - b.k);
						chain = { cx, cy, items: order.map((o) => o.d), at: 0 };
					}
					let n = 0;
					let cardsDone = 0;
					while (chain.at < chain.items.length) {
						const d = chain.items[chain.at];
						if (!delayed.has(d)) {
							chain.at++;
							continue;
						}
						if (d.card && cardsDone >= max) break;
						if (d.card) cardsDone++;
						chain.at++;
						n += attachItem(d);
					}
					return n;
				},
				get pending() {
					return delayed.size;
				},
				get pendingLines() {
					return lateLines.size;
				},
			}
		: { fillNear: () => 0, fillPerson: (id) => cards.has(id), fillAll: () => 0, fillChunk: () => 0, pending: 0, pendingLines: 0 };

	const setDetail = (on: boolean) => {
		if (on === detail) return;
		detail = on;
		// The groups that come back are new work: a finished chain at the same view centre must not skip them.
		chain = null;
		for (const b of bodies) {
			if (!b.made) continue;
			if (!on) {
				if (b.in) b.body.remove();
				b.in = false;
			} else if (!b.in && !b.waiting) {
				const box = layout.persons.get(b.person);
				if (lazy && box) {
					// The fill puts it back: the cards near the view now, the rest in idle chunks.
					b.waiting = true;
					delay(b.person, box, true, () => {
						b.waiting = false;
						if (detail && !b.in) {
							b.card.appendChild(b.body);
							b.in = true;
						}
					});
				} else {
					b.card.appendChild(b.body);
					b.in = true;
				}
			}
		}
	};

	return { cards, tags, badges, links, pictures, folds, refit: () => fitters.forEach((run) => run()),
		setCornerRadius: (r) => {
			cornerR = r;
			verified = true;
			learnedRadius = r;
			drawn = r;
			mixed = false;
			bars.forEach((redraw) => redraw(r));
		},
		syncCornerRadius,
		setDetail,
		fill,
	};
}

function addPart(parent: SVGElement, part: LegendPart): void {
	const el = parent.createSvg(part.tag, { cls: part.cls, attr: part.attr });
	if (part.text !== undefined) el.setText(part.text);
	for (const c of part.children ?? []) addPart(el, c);
}

/**
 * Fills the legend popover (D25): one row per line kind, the D14 sign and the two dead signs, each sample drawn like the tree. 0.2.8 (D196 item 3, contract A.1): the
 * live legend shows the line styles only; the houses are in the Houses window, and the saved picture keeps its own house legend (`svg-string.ts`).
 */
export function buildLegend(list: HTMLElement): void {
	for (const r of legendRows()) {
		const row = list.createDiv({ cls: r.kind === 'sign' ? 'dynasty-legend-row dynasty-legend-sign' : 'dynasty-legend-row' });
		const sample = row.createSvg('svg', { cls: 'dynasty-legend-sample', attr: { width: r.w, height: r.h, viewBox: `0 0 ${r.w} ${r.h}` } });
		for (const part of r.parts) addPart(sample, part);
		row.createSpan({ cls: 'dynasty-legend-label', text: r.label });
	}
}
