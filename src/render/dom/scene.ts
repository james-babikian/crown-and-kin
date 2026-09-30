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
 *   `rect.dynasty-card-bg` (the size and hit area). Its content is every other child (ring, strip, me-ring,
 *   full, compact levels). A tag shell has its attributes and hit rect, its content the three pill groups.
 *   A badge shell has its attributes and hit rect, its content the circle and the plus path. Fold controls
 *   keep the M10 rule (`FoldRef.fill`); lines, markers and union signs are not delayed. A shell never
 *   moves, so the Tab order, the names and the roles exist from the build on.
 * - S2 Built detached, attached later. The content is created in a detached holder, `fitted`, the
 *   `fitters`, `links` and `PictureSlot`s are registered as in an eager scene, and the holder's children
 *   move into the shell at fill. After a fill the shell has exactly the eager children in the eager
 *   order, so an eager and a filled lazy scene serialise byte for byte the same.
 * - S3 Near the view. `boxNearView` (`view-math.ts`) decides which items a fill attaches.
 * - S4 `Scene.fill` (`SceneFill`) is the fill API; an eager scene has one that does nothing. The
 *   tree view decides when to call it (see `obsidian/tree-view.ts`). `Scene.cards`, `tags`, `badges`,
 *   `links`, `pictures` and `folds` contain every item from the build on.
 */

import type { FamilyGraph } from '../../core/derive';
import type { CardLabel } from '../../core/titles';
import type { Person } from '../../core/types';
import { armsPlace, cardText, nameCountOf, nameTextWidth, portraitBox, relationY, smallTextWidth, tagTop, type CardText } from '../../layout/geometry';
import { illegitimateSigns } from '../../layout/index';
import type { FarTag, LaidOut, NameLineCount, PersonBox, PlacedFoldControl, Rect } from '../../layout/model';
import { legendRows, unionMarkClass, type LegendHouse, type LegendPart } from '../legend';
import { lineLook, type LineMarks, type LineState } from '../line-highlight';
import { nameLines, titleLines } from '../name-lines';
import { ME_LOOK, UNION_MARKS, unionMark, unionShape } from '../styles';
import { LEGEND_HOUSES_LABEL, SIGN_CARD_LABEL, cardLabel, dateLine, farTagLabel, farTagName } from '../tree-info';
import { HOUSE_PAGE_UI } from '../ui-text';
import { boxNearView, truncate } from '../view-math';
import { drawFold, type FoldRef } from './folds';
import type { PictureSlot } from './pictures';

/** Text width in px for a CSS font shorthand. */
export type Measure = (text: string, font: string) => number;

/** The resolved font families and weight the scene measures and draws text with. */
export interface SceneFonts {
	/** Resolved `font-family` of the note text (card text). */
	text: string;
	/** Resolved `font-family` of the interface (tags). */
	ui: string;
	/** Resolved bold weight, for measuring names. */
	bold: string;
}

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
	relations?: ReadonlyMap<string, { text: string; lower: string }>;
	/** D41: the marked person; the card gets class `dynasty-card-me` (a thicker accent border with a thin text-colour ring inside it). */
	me?: string;
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
}

/** The DOM event that makes the tree view attach all delayed content at once (for the harness and the tests). */
export const FILL_ALL_EVENT = 'dynasty-fill-all';
/** The root attribute with `SceneFill.pending` ('0' on an empty root; the harness helper counts a missing attribute as 0). */
export const CARDS_PENDING_ATTR = 'data-dynasty-cards-pending';

/** M11 (S4): attaches the delayed content of a lazy scene. Every call is safe to repeat; each returns how many items it attached. */
export interface SceneFill {
	/** The cards, tags and badges near `view` (`boxNearView`). */
	fillNear(view: Rect): number;
	/** The card of `id`, its badge and its tags. False if the id is unknown. */
	fillPerson(id: string): boolean;
	/** Everything that is left. */
	fillAll(): number;
	/** Up to `max` cards, the nearest to `view` first, with the tags and badges that lie before the next card. */
	fillChunk(view: Rect, max: number): number;
	/** Items whose content is not attached yet; 0 in an eager scene. */
	readonly pending: number;
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
}

/** The `+` badge of a card in focus mode (spec §5.6). */
export interface BadgeRef {
	person: string;
	el: SVGGElement;
	/** The invisible tap area inside the badge; the tree view sizes it from `mark` at each settled zoom (`badgeHit`). */
	hit: SVGRectElement;
	/** The badge's visible circle. */
	mark: Rect;
	/**
	 * `sideways` (D24): the badge sits inside this card's top right corner, and its tap area stays on
	 * the card (`badgeHitInCard`). Absent in `down`, where the badge sits over the card's corner.
	 */
	card?: Rect;
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
	/** M11 (S4): the fill API; an eager scene has one that does nothing. */
	fill: SceneFill;
}

/** Compact names are this much larger than Full names (spec §5.4: a larger font that fills the card). */
export const COMPACT_NAME_EM = 1.5;
/** Tag text size in em of the note font (matches the headless renderer). */
export const TAG_FONT_EM = 0.75;
/** Tag text at the Compact level is as large as the Compact name, so it is as readable. */
export const TAG_COMPACT_FONT_EM = COMPACT_NAME_EM;
/** Height of the Compact and Overview tag pill, in em. It grows up into the card, below the Compact name. */
export const TAG_COMPACT_PILL_EM = 2;
/** Radius of the focus-mode `+` badge, in em. It sits outside the card's top right corner, in the gap to the next card (1.25 em). */
export const BADGE_RADIUS_EM = 0.6;
/**
 * `sideways` (D24): the badge sits inside the card's top right corner, this far from both edges, in
 * em. In the column gaps it would sit on the lines.
 */
export const BADGE_INSET_EM = 0.25;
/** How much further left the name and the D14 sign end on a sideways card with a badge, in em. */
export const BADGE_TEXT_CUT_EM = BADGE_INSET_EM + 2 * BADGE_RADIUS_EM + 0.25 - 0.5;
/** D41: the text-colour ring of the marked card sits this far inside the card's edge, in px: inside the accent border, touching it (styles.css sizes its stroke). */
export const ME_RING_INSET = ME_LOOK.border / 2 + ME_LOOK.ring / 2;
/** "?" of the rumoured-parent marker, in em. */
export const RUMOUR_FONT_EM = 0.7;
// All font sizes are set in styles.css from --dynasty-font-size (spec §5.8: nothing that styles
// text is written into SVG attributes); these constants are what the measurement assumes.

/** The class name on the `<svg>` that picks one level of detail (spec §5.4). */
export const lodClass = (lod: string) => `dynasty-lod-${lod}`;

/**
 * The "illegitimate" sign (spec D14) for a name `scale` times the Full name size: the Full sign
 * from `cardText`, scaled about its top right end, then moved so it is centred on the capitals of
 * a name whose baseline is at `baseline`. Coordinates are from the card's top left corner.
 */
export function signAt(t: CardText, scale: number, baseline: number, rightX: number): CardText['sign'] {
	const s = t.sign;
	const size = (s.x1 - s.x2) * scale;
	const top = baseline - 0.35 * t.nameSize * scale - size / 2;
	return { x1: rightX, y1: top, x2: rightX - size, y2: top + size, width: s.width * scale, dash: [s.dash[0] * scale, s.dash[1] * scale] };
}

/** The class of a part on the relation finder's line, or of a part faded beside it (D47). */
const stateCls = (s: LineState): string[] => (s === 'on' ? ['dynasty-on-line'] : s === 'faded' ? ['dynasty-faded'] : []);

/** The font the relation text is measured with: 0.85 em italic, "You" semibold upright (styles.css). */
export const relationFont = (size: number, family: string, you: boolean) => (you ? `600 ${size}px ${family}` : `italic 400 ${size}px ${family}`);

function isColour(value: string | undefined): value is string {
	if (!value) return false;
	try {
		return CSS.supports('color', value);
	} catch {
		return false;
	}
}

/** Draws the whole tree's SVG content (lines, markers, cards, badges, tags) into `parent`. */
export function buildScene(parent: SVGGElement, g: FamilyGraph, laid: LaidOut, opts: SceneOptions): Scene {
	const { layout, edges } = laid;
	const geo = layout.geometry;
	const t = cardText(geo);
	const f = geo.fontPx;
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
	const byPerson = new Map<string, Delayed[]>();
	/** Where the content of a shell is built: the shell itself when eager, else a holder that is not in the document. */
	const holderFor = (shell: SVGGElement): SVGGElement => (lazy ? createSvg('g') : shell);
	const delay = (person: string, box: Rect, card: boolean, attach: () => void) => {
		const d: Delayed = { box, person, card, attach };
		delayed.add(d);
		const list = byPerson.get(person);
		if (list) list.push(d);
		else byPerson.set(person, [d]);
	};
	const attachChildren = (holder: SVGElement, shell: SVGElement) => {
		for (const c of Array.from(holder.children)) shell.appendChild(c);
	};
	const attachItem = (d: Delayed): number => {
		if (!delayed.delete(d)) return 0;
		d.attach();
		return 1;
	};
	/** Sets `el` to `text` truncated to `maxW`, now and on every refit. */
	const fitted = (el: SVGTextElement, text: string, maxW: number, font: string) => {
		const run = () => el.setText(fit(text, maxW, font));
		run();
		fitters.push(run);
	};

	// D47: the relation finder's line; without one every part is drawn as usual.
	const look = lineLook(g, layout, edges, opts.line);
	const linesEl = parent.createSvg('g', { cls: 'dynasty-lines' });
	for (const p of look.paths) {
		linesEl.createSvg('path', { cls: ['dynasty-line', `dynasty-line-${p.kind}`, ...stateCls(p.state)], attr: { d: p.d } });
	}

	const markersEl = parent.createSvg('g', { cls: 'dynasty-markers' });
	edges.markers.forEach((m, i) => {
		const state = stateCls(look.markers[i]);
		if (m.kind === 'union' || m.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership; no recorded partnership has none.
			const shape = unionShape(m.kind, m.unionType);
			if (!shape) return;
			const mark = unionMark(shape, m.x, m.y, UNION_MARKS[shape].size * geo.unionSize);
			markersEl.createSvg(mark.tag, { cls: [...unionMarkClass(shape), ...state], attr: mark.attr });
		} else {
			const r = 0.5 * f;
			const q = markersEl.createSvg('g', { cls: ['dynasty-rumour-marker', ...state] });
			q.createSvg('circle', { attr: { cx: m.x, cy: m.y, r } });
			const size = RUMOUR_FONT_EM * f;
			q.createSvg('text', { attr: { x: m.x, y: m.y + 0.35 * size, 'text-anchor': 'middle' } }).setText('?');
		}
	});

	// The tags' enlarged tap areas lie below the cards: at a low zoom a 44 px area can cover a whole
	// small card, and a press on a card must open its sheet (spec §7.2). The visible pills stay on top.
	const hitsEl = parent.createSvg('g', { cls: 'dynasty-tag-hits' });

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
			folds.push(drawFold({ controls: cardsEl, hits: hitsEl, fonts: opts.fonts, measure: opts.measure, em: f, label, fitters, ...(opts.folds!.wire ? { wire: opts.folds!.wire } : {}), ...(opts.folds!.lazy ? { lazy: true } : {}) }, c));
		}
	};
	const links = new Map<SVGTextElement, string>();
	const nameFont = textFont(t.nameSize, opts.fonts.bold);
	const smallFont = textFont(t.smallSize);
	const compactSize = COMPACT_NAME_EM * t.nameSize;
	const compactFont = textFont(compactSize, opts.fonts.bold);
	const compactW = geo.cardW - t.stripW - 0.75 * f;
	const signed = illegitimateSigns(g, edges);
	// D29, D61: a tall card has two Full name or title text lines; its Compact name stays one line, centred.
	const tallTexts = new Map<string, CardText>();
	const textOf = (box: PersonBox): CardText => {
		const count = nameCountOf(box);
		if (count === 1 && !box.tallTitle) return t;
		const key = `${count}${box.tallTitle ? 1 : 0}`;
		let ct = tallTexts.get(key);
		if (!ct) tallTexts.set(key, (ct = cardText(geo, count, box.tallTitle)));
		return ct;
	};
	const measureSmall = (s: string) => opts.measure(s, smallFont);
	const compactBaseline = (h: number) => h / 2 + 0.35 * compactSize;
	const compactSign = (h: number) => signAt(t, COMPACT_NAME_EM, compactBaseline(h), t.sign.x1);
	const baseCompactSign = compactSign(geo.cardH);
	// The Compact name stops short of the sign by the same clear gap as the Full name.
	const compactWithSignW = compactW - (baseCompactSign.x1 - baseCompactSign.x2) - 0.5 * f;
	const sideways = layout.orientation === 'sideways';
	const cut = BADGE_TEXT_CUT_EM * f;
	const moved = (s: CardText['sign'], dx = cut): CardText['sign'] => ({ ...s, x1: s.x1 - dx, x2: s.x2 - dx });
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
	const drawTitle = (fullEl: SVGGElement, box: PersonBox, ct: CardText, title: string | undefined, reign: string | undefined, widthAt: (baseline: number) => number) => {
		const x = box.x + t.padX;
		const first = fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.titleBaseline } });
		const second = box.tallTitle && ct.title2Baseline !== undefined ? fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.title2Baseline } }) : undefined;
		// G3: the lines break at the normal width; a line beside the portrait is then only cut shorter.
		const w1 = widthAt(ct.titleBaseline);
		const w2 = second ? widthAt(ct.title2Baseline!) : t.textW;
		const cutTo = (line: string | undefined, w: number) => (line === undefined ? '' : w < t.textW ? fit(line, w, smallFont) : line);
		const run = () => {
			const lines = titleLines(title, reign, t.textW, measureSmall);
			if (second) {
				first.setText(cutTo(lines[0], w1));
				second.setText(cutTo(lines[1], w2));
			} else first.setText(lines.length > 1 ? fit([title, reign].filter(Boolean).join(' '), w1, smallFont) : cutTo(lines[0], w1));
		};
		run();
		fitters.push(run);
	};

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
		const label = cardLabel(p, isMe ? 'you' : relation?.lower, cl);
		const cls = ['dynasty-card', ...(p.died !== undefined ? ['dynasty-deceased'] : []), ...(isMe ? ['dynasty-card-me'] : []), ...stateCls(look.card(p.id))];
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

		// The second focus and highlight ring, under the card: the accent alone can be too weak in a theme.
		// A lazy card keeps only its bg rect (its size and hit area); the ring goes back before it at the fill.
		const body = holderFor(card);
		const ring = body.createSvg('rect', { cls: 'dynasty-card-ring', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
		const bg = card.createSvg('rect', { cls: 'dynasty-card-bg', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
		body.createSvg('rect', { cls: 'dynasty-card-strip', attr: { x: box.x, y: box.y, width: t.stripW, height: box.h } });
		if (isMe) {
			// D41: a thin ring in the text colour inside the accent border, so the mark shows also without colour.
			const i = ME_RING_INSET;
			body.createSvg('rect', { cls: 'dynasty-card-me-ring', attr: { x: box.x + i, y: box.y + i, width: box.w - 2 * i, height: box.h - 2 * i } });
		}

		const tx = box.x + t.padX;
		const tall = !!(box.tallName || box.tallTitle);
		const ct = textOf(box);
		const n = opts.badges?.hidden.get(p.id);
		// A sideways badge sits inside the card's top right corner: the name and the sign end left of it.
		const inCard = sideways && !!n;
		const nameCut = inCard ? cut : 0;
		const full = body.createSvg('g', { cls: 'dynasty-card-full' });
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
		// D67, D78: arms at the top right; the name ends before them and the D14 sign moves left of them.
		const place = box.arms && house ? armsPlace(geo, ct, box.h, nameCut) : undefined;
		const armsShift = place ? place.shift : 0;
		const nameW = (sign ? t.nameWithSignW : t.textW) - nameCut - armsShift;
		// D76, D77: the portrait sits in the lower right corner; a name text line beside it is cut shorter.
		const portrait = box.portrait ? portraitBox(geo, ct) : undefined;
		const count = nameCountOf(box);
		const lineW = (line: NameLineCount) => nameTextWidth(geo, ct, line, count, portrait, t.textW - nameW);
		const names = [name];
		if (count > 1 && ct.name2Baseline !== undefined) {
			names.push(nameEl(ct.name2Baseline));
			if (count > 2 && ct.name3Baseline !== undefined) names.push(nameEl(ct.name3Baseline));
			const run = () => {
				// The breaks are made at the normal width, so a portrait never adds a text line; a box the layout made
				// taller for two text lines shows at most two until the tree view lays it out again.
				const lines = nameLines(shownName, nameW, (s) => opts.measure(s, nameFont), names.length > 2 ? 3 : 2);
				names.forEach((el, i) => {
					const w = lineW((i + 1) as NameLineCount);
					el.setText(lines[i] === undefined ? '' : w < nameW ? fit(lines[i], w, nameFont) : lines[i]);
				});
			};
			run();
			fitters.push(run);
		} else fitted(name, shownName, lineW(1), nameFont);
		const fullSign = ct.sign;
		if (sign) drawSign(full, box.x, box.y, inCard || place ? moved(fullSign, nameCut + armsShift) : fullSign);
		if (link) {
			for (const el of names) {
				el.setAttribute('data-href', link.linktext);
				links.set(el, link.linktext);
			}
		}
		// D76, D77: the portrait sits in the lower right corner; the small text lines beside it are narrower.
		const widthAt = (baseline: number) => smallTextWidth(geo, ct, baseline, portrait);
		// D61: with a label, the title text line carries the reign, unless dates are off.
		const titleText = cl ? cl.title : p.title;
		const reign = cl && opts.showDates !== false ? cl.reign : undefined;
		const hasTitle = !!titleText || !!reign;
		if (cl) {
			if (hasTitle) drawTitle(full, box, ct, titleText, reign, widthAt);
		} else if (p.title) {
			fitted(full.createSvg('text', { cls: 'dynasty-card-title', attr: { x: tx, y: box.y + ct.titleBaseline } }), p.title, widthAt(ct.titleBaseline), smallFont);
		}
		const dates = dateLine(p);
		if (dates) {
			const baseline = hasTitle ? ct.datesBaseline : ct.titleBaseline;
			fitted(full.createSvg('text', { cls: 'dynasty-card-dates', attr: { x: tx, y: box.y + baseline } }), dates, widthAt(baseline), smallFont);
		}
		const relY = relationY(ct, hasTitle, !!dates);
		if (relation?.text && relY !== undefined) {
			// D40: a name too long for the card ends with "…"; the sheet shows it in full.
			fitted(full.createSvg('text', { cls: 'dynasty-card-relation', attr: { x: tx, y: box.y + relY } }), relation.text, widthAt(relY), relationFont(t.smallSize, opts.fonts.text, isMe));
		}
		// S1: the empty picture slots of the Full level; the tree view fills them.
		if (place) {
			const r = place.full;
			const el = full.createSvg('g', { cls: 'dynasty-arms' });
			pictures.push({ kind: 'arms', lod: 'full', person: p.id, house: p.house, rect: { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h }, el });
		}
		if (portrait) {
			const rect = { x: box.x + portrait.x, y: box.y + portrait.y, w: portrait.w, h: portrait.h };
			const el = full.createSvg('g', { cls: 'dynasty-portrait' });
			const frame = el.createSvg('circle', { cls: 'dynasty-portrait-frame', attr: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r: rect.w / 2 } });
			pictures.push({ kind: 'portrait', lod: 'full', person: p.id, rect, el, frame });
		}

		const compact = body.createSvg('text', {
			cls: 'dynasty-card-compact',
			attr: { x: box.x + t.stripW + 0.5 * f, y: box.y + compactBaseline(box.h) },
		});
		const cs = sign ? (tall ? compactSign(box.h) : baseCompactSign) : undefined;
		// G2, B7: Compact arms at the card's right; the sign's right end 0.3 em left of them.
		const shownCs = cs && (inCard || place) ? moved(cs, nameCut + (place ? place.compactShift : 0)) : cs;
		const compactLeft = t.stripW + 0.5 * f;
		// Unsigned, the Compact name ends 0.25 em from the card's edge, not 0.5 em like the Full name.
		// Beside arms it ends 0.3 em before them, or 0.5 em before the sign.
		const compactNameW = place
			? (shownCs ? shownCs.x2 - 0.5 * f : place.compact.x - 0.3 * f) - compactLeft
			: (sign ? compactWithSignW : compactW) - (inCard ? cut + (sign ? 0 : 0.25 * f) : 0);
		fitted(compact, shownName, compactNameW, compactFont);
		if (shownCs) drawSign(body.createSvg('g', { cls: 'dynasty-card-compact-sign' }), box.x, box.y, shownCs);
		if (place) {
			const r = place.compact;
			const el = body.createSvg('g', { cls: 'dynasty-card-compact-arms' }).createSvg('g', { cls: 'dynasty-arms' });
			pictures.push({ kind: 'arms', lod: 'compact', person: p.id, house: p.house, rect: { x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h }, el });
		}
		if (lazy) {
			delay(p.id, box, true, () => {
				card.insertBefore(ring, bg);
				for (const c of Array.from(body.children)) if (c !== ring) card.appendChild(c);
			});
		}

		// The `+` badge goes right after its card: the Tab key reaches a card, then its own badge. It
		// shows over its own card's corner; a card drawn later still wins where the two meet.
		if (n && opts.badges) {
			const r = BADGE_RADIUS_EM * f;
			const arm = 0.45 * r;
			const inset = BADGE_INSET_EM * f;
			const cx = inCard ? box.x + box.w - inset - r : box.x + box.w + r / 2;
			const cy = inCard ? box.y + inset + r : box.y - r / 2;
			const mark = { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
			const el = cardsEl.createSvg('g', {
				cls: 'dynasty-focus-badge',
				attr: { tabindex: 0, role: 'button', 'aria-label': opts.badges.label(p, n), 'data-person': p.id, 'data-hidden': n },
			});
			const hit = el.createSvg('rect', { cls: 'dynasty-focus-badge-hit', attr: { x: mark.x, y: mark.y, width: mark.w, height: mark.h } });
			const bb = holderFor(el);
			bb.createSvg('circle', { cls: 'dynasty-focus-badge-mark', attr: { cx, cy, r } });
			bb.createSvg('path', { cls: 'dynasty-focus-badge-plus', attr: { d: `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}`, 'stroke-width': 0.25 * r } });
			if (lazy) delay(p.id, mark, false, () => attachChildren(bb, el));
			badges.push({ person: p.id, el, hit, mark, ...(inCard ? { card: { x: box.x, y: box.y, w: box.w, h: box.h } } : {}) });
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
		const pills = holderFor(el);
		const hit = hitsEl.createSvg('rect', { cls: 'dynasty-tag-hit', attr: { x: tag.hit.x, y: tag.hit.y, width: tag.hit.w, height: tag.hit.h, 'data-person': tag.person } });
		// The pill never grows past its zone (FarTag.zoneW): in `sideways` the tap area can be wider than the card's edge.
		const zone = tag.zoneW ?? tag.hit.w;
		// One rendering per level of detail, like the cards; a class on the <svg> shows one.
		const pill = (cls: string, font: string, fontEm: number, h: number, text: string, fitText: boolean) => {
			const pad = h / 2;
			const part = pills.createSvg('g', { cls });
			const ring = part.createSvg('rect', { cls: 'dynasty-tag-ring', attr: { y: bottom - h, height: h, rx: h / 2 } });
			const rect = part.createSvg('rect', { cls: 'dynasty-tag-pill', attr: { y: bottom - h, height: h, rx: h / 2 } });
			const textEl = part.createSvg('text', { cls: 'dynasty-tag-text', attr: { x: tag.x, y: bottom - h / 2 + 0.35 * fontEm * f, 'text-anchor': 'middle' } });
			const run = () => {
				const label = fitText ? prefix + fit(rest, Math.max(0, zone - 2 * pad - opts.measure(prefix, font)), font) : text;
				const w = Math.min(zone, opts.measure(label, font) + 2 * pad);
				for (const r of [ring, rect]) {
					r.setAttribute('x', String(tag.x - w / 2));
					r.setAttribute('width', String(w));
				}
				textEl.setText(label);
			};
			run();
			fitters.push(run);
		};
		pill('dynasty-tag-full', small, TAG_FONT_EM, geo.tagH, '', true);
		pill('dynasty-tag-compact', large, TAG_COMPACT_FONT_EM, bigH, '', true);
		pill('dynasty-tag-sign', large, TAG_COMPACT_FONT_EM, bigH, '⚭', false);
		if (lazy) delay(tag.person, tag.hit, false, () => attachChildren(pills, el));
		tags.push({ tag, el, hit });
	}

	let chain: { cx: number; cy: number; items: Delayed[]; at: number } | null = null;
	const fill: SceneFill = lazy
		? {
				fillNear(view) {
					let n = 0;
					for (const d of [...delayed]) if (boxNearView(d.box, view)) n += attachItem(d);
					return n;
				},
				fillPerson(id) {
					if (!cards.has(id)) return false;
					for (const d of byPerson.get(id) ?? []) attachItem(d);
					return true;
				},
				fillAll() {
					let n = 0;
					for (const d of [...delayed]) n += attachItem(d);
					return n;
				},
				fillChunk(view, max) {
					if (max <= 0 || !delayed.size) return 0;
					const cx = view.x + view.w / 2;
					const cy = view.y + view.h / 2;
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
						const d = chain.items[chain.at]!;
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
			}
		: { fillNear: () => 0, fillPerson: (id) => cards.has(id), fillAll: () => 0, fillChunk: () => 0, pending: 0 };

	return { cards, tags, badges, links, pictures, folds, refit: () => fitters.forEach((run) => run()), fill };
}

function addPart(parent: SVGElement, part: LegendPart): void {
	const el = parent.createSvg(part.tag, { cls: part.cls, attr: part.attr });
	if (part.text !== undefined) el.setText(part.text);
	for (const c of part.children ?? []) addPart(el, c);
}

/**
 * Fills the legend popover (D25): one row per line kind and the D14 sign, each sample drawn like the
 * tree. M9 (S4, spec §13.6 "Legend"): then, when `houses` is not empty, the title "Houses" and one row
 * per house in the given order (colour strip, arms slot, name). The rows are not buttons in M9.
 * Returns the arms slots by house id, for `setLegendArms`.
 */
export function buildLegend(list: HTMLElement, houses?: readonly LegendHouse[], onHouse?: (houseId: string) => void): { arms: Map<string, HTMLElement> } {
	for (const r of legendRows()) {
		const row = list.createDiv({ cls: r.kind === 'sign' ? 'dynasty-legend-row dynasty-legend-sign' : 'dynasty-legend-row' });
		const sample = row.createSvg('svg', { cls: 'dynasty-legend-sample', attr: { width: r.w, height: r.h, viewBox: `0 0 ${r.w} ${r.h}` } });
		for (const part of r.parts) addPart(sample, part);
		row.createSpan({ cls: 'dynasty-legend-label', text: r.label });
	}
	const arms = new Map<string, HTMLElement>();
	if (!houses?.length) return { arms };
	const part = list.createDiv({ cls: 'dynasty-legend-houses' });
	part.createDiv({ cls: 'dynasty-legend-title', text: LEGEND_HOUSES_LABEL });
	for (const h of houses) {
		// M10 (H1): with a callback the row is a button (44 px, see styles.css) that opens the house page; its tooltip is its label.
		const row = onHouse
			? part.createEl('button', { cls: ['dynasty-legend-house', 'is-button'], attr: { type: 'button', 'aria-label': HOUSE_PAGE_UI.peopleLabel(h.name), 'data-house': h.id } })
			: part.createDiv({ cls: 'dynasty-legend-house' });
		if (onHouse) row.addEventListener('click', () => onHouse(h.id));
		const strip = row.createSpan({ cls: 'dynasty-legend-strip' });
		if (isColour(h.color)) {
			strip.style.setProperty('--dynasty-house-color', h.color);
			// D27: as on the cards, only a house colour is lifted in the dark theme.
			strip.addClass('dynasty-has-house');
		}
		// Every row keeps the arms place, so the names line up; only houses with arms get a slot to fill.
		const slot = row.createSpan({ cls: h.arms ? 'dynasty-legend-arms' : ['dynasty-legend-arms', 'is-empty'] });
		if (h.arms) arms.set(h.id, slot);
		row.createSpan({ cls: 'dynasty-legend-label', text: h.name });
	}
	return { arms };
}
