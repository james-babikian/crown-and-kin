/*
 * Builds the tree's SVG content with Obsidian's createSvg. Colours and fonts come only from the
 * dynasty- classes in styles.css; the one value written per card is --dynasty-house-color.
 * Each card carries all three levels of detail (spec §5.4); a class on the <svg> picks one, so a
 * level change is a class change, never a rebuild.
 */

import type { FamilyGraph } from '../../core/derive';
import type { Person } from '../../core/types';
import { cardText, isTall, tagTop, type CardText } from '../../layout/geometry';
import { illegitimateSigns } from '../../layout/index';
import type { FarTag, LaidOut, Rect } from '../../layout/model';
import { legendRows, unionMarkClass, type LegendPart } from '../legend';
import { nameLines } from '../name-lines';
import { UNION_MARKS, unionMark, unionShape } from '../styles';
import { SIGN_CARD_LABEL, cardLabel, dateLine, farTagLabel, farTagName } from '../tree-info';
import { truncate } from '../view-math';

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
	 * Truncates every text again with the current measurements, in place: for a web font that
	 * finished loading after the first measurement. No element is replaced, so focus, a highlight
	 * and a running pan or zoom are not disturbed.
	 */
	refit: () => void;
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
	/** Sets `el` to `text` truncated to `maxW`, now and on every refit. */
	const fitted = (el: SVGTextElement, text: string, maxW: number, font: string) => {
		const run = () => el.setText(fit(text, maxW, font));
		run();
		fitters.push(run);
	};

	const linesEl = parent.createSvg('g', { cls: 'dynasty-lines' });
	for (const p of edges.paths) {
		linesEl.createSvg('path', { cls: ['dynasty-line', `dynasty-line-${p.kind}`], attr: { d: p.d } });
	}

	const markersEl = parent.createSvg('g', { cls: 'dynasty-markers' });
	for (const m of edges.markers) {
		if (m.kind === 'union' || m.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership; no recorded partnership has none.
			const shape = unionShape(m.kind, m.unionType);
			if (!shape) continue;
			const mark = unionMark(shape, m.x, m.y, UNION_MARKS[shape].size * geo.unionSize);
			markersEl.createSvg(mark.tag, { cls: unionMarkClass(shape), attr: mark.attr });
		} else {
			const r = 0.5 * f;
			const q = markersEl.createSvg('g', { cls: 'dynasty-rumour-marker' });
			q.createSvg('circle', { attr: { cx: m.x, cy: m.y, r } });
			const size = RUMOUR_FONT_EM * f;
			q.createSvg('text', { attr: { x: m.x, y: m.y + 0.35 * size, 'text-anchor': 'middle' } }).setText('?');
		}
	}

	// The tags' enlarged tap areas lie below the cards: at a low zoom a 44 px area can cover a whole
	// small card, and a press on a card must open its sheet (spec §7.2). The visible pills stay on top.
	const hitsEl = parent.createSvg('g', { cls: 'dynasty-tag-hits' });

	const cardsEl = parent.createSvg('g', { cls: 'dynasty-cards' });
	const cards = new Map<string, SVGGElement>();
	const badges: BadgeRef[] = [];
	const links = new Map<SVGTextElement, string>();
	const nameFont = textFont(t.nameSize, opts.fonts.bold);
	const smallFont = textFont(t.smallSize);
	const compactSize = COMPACT_NAME_EM * t.nameSize;
	const compactFont = textFont(compactSize, opts.fonts.bold);
	const compactW = geo.cardW - t.stripW - 0.75 * f;
	const signed = illegitimateSigns(g, edges);
	// D29: a tall card has two Full name text lines; its Compact name stays one line, centred.
	const tallText = cardText(geo, true);
	const compactBaseline = (h: number) => h / 2 + 0.35 * compactSize;
	const compactSign = (h: number) => signAt(t, COMPACT_NAME_EM, compactBaseline(h), t.sign.x1);
	const baseCompactSign = compactSign(geo.cardH);
	// The Compact name stops short of the sign by the same clear gap as the Full name.
	const compactWithSignW = compactW - (baseCompactSign.x1 - baseCompactSign.x2) - 0.5 * f;
	const sideways = layout.orientation === 'sideways';
	const cut = BADGE_TEXT_CUT_EM * f;
	const moved = (s: CardText['sign']): CardText['sign'] => ({ ...s, x1: s.x1 - cut, x2: s.x2 - cut });
	const drawSign = (parentEl: SVGGElement, x: number, y: number, s: CardText['sign']) =>
		parentEl.createSvg('line', {
			cls: 'dynasty-sign',
			attr: { x1: x + s.x1, y1: y + s.y1, x2: x + s.x2, y2: y + s.y2, 'stroke-width': s.width, 'stroke-dasharray': s.dash.join(' ') },
		});

	for (const box of layout.persons.values()) {
		const p = g.byId.get(box.id);
		if (!p) continue;
		const house = p.house ? g.houses.get(p.house) : undefined;
		const card = cardsEl.createSvg('g', {
			cls: p.died !== undefined ? ['dynasty-card', 'dynasty-deceased'] : 'dynasty-card',
			attr: { tabindex: 0, role: 'group', 'aria-label': cardLabel(p), 'data-person': p.id },
		});
		const colour = house?.color;
		if (isColour(colour)) {
			card.style.setProperty('--dynasty-house-color', colour);
			// D27: only a house colour is lifted in the dark theme, not the no-house grey.
			card.addClass('dynasty-has-house');
		}
		cards.set(p.id, card);

		// The second focus and highlight ring, under the card: the accent alone can be too weak in a theme.
		card.createSvg('rect', { cls: 'dynasty-card-ring', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
		card.createSvg('rect', { cls: 'dynasty-card-bg', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
		card.createSvg('rect', { cls: 'dynasty-card-strip', attr: { x: box.x, y: box.y, width: t.stripW, height: box.h } });

		const tx = box.x + t.padX;
		const tall = isTall(geo, box);
		const ct = tall ? tallText : t;
		const n = opts.badges?.hidden.get(p.id);
		// A sideways badge sits inside the card's top right corner: the name and the sign end left of it.
		const inCard = sideways && !!n;
		const nameCut = inCard ? cut : 0;
		const full = card.createSvg('g', { cls: 'dynasty-card-full' });
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
			card.setAttribute('aria-label', `${cardLabel(p)}, ${SIGN_CARD_LABEL}`);
		}
		const nameW = (sign ? t.nameWithSignW : t.textW) - nameCut;
		const names = [name];
		if (tall && ct.name2Baseline !== undefined) {
			const second = nameEl(ct.name2Baseline);
			names.push(second);
			const run = () => {
				const [a, b] = nameLines(p.name, nameW, (s) => opts.measure(s, nameFont));
				name.setText(a);
				second.setText(b ?? '');
			};
			run();
			fitters.push(run);
		} else fitted(name, p.name, nameW, nameFont);
		const fullSign = ct.sign;
		if (sign) drawSign(full, box.x, box.y, inCard ? moved(fullSign) : fullSign);
		if (link) {
			for (const el of names) {
				el.setAttribute('data-href', link.linktext);
				links.set(el, link.linktext);
			}
		}
		if (p.title) {
			fitted(full.createSvg('text', { cls: 'dynasty-card-title', attr: { x: tx, y: box.y + ct.titleBaseline } }), p.title, t.textW, smallFont);
		}
		const dates = dateLine(p);
		if (dates) {
			const y = box.y + (p.title ? ct.datesBaseline : ct.titleBaseline);
			fitted(full.createSvg('text', { cls: 'dynasty-card-dates', attr: { x: tx, y } }), dates, t.textW, smallFont);
		}

		const compact = card.createSvg('text', {
			cls: 'dynasty-card-compact',
			attr: { x: box.x + t.stripW + 0.5 * f, y: box.y + compactBaseline(box.h) },
		});
		// Unsigned, the Compact name ends 0.25 em from the card's edge, not 0.5 em like the Full name.
		fitted(compact, p.name, (sign ? compactWithSignW : compactW) - (inCard ? cut + (sign ? 0 : 0.25 * f) : 0), compactFont);
		if (sign) {
			const cs = tall ? compactSign(box.h) : baseCompactSign;
			drawSign(card.createSvg('g', { cls: 'dynasty-card-compact-sign' }), box.x, box.y, inCard ? moved(cs) : cs);
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
			el.createSvg('circle', { cls: 'dynasty-focus-badge-mark', attr: { cx, cy, r } });
			el.createSvg('path', { cls: 'dynasty-focus-badge-plus', attr: { d: `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}`, 'stroke-width': 0.25 * r } });
			badges.push({ person: p.id, el, hit, mark, ...(inCard ? { card: { x: box.x, y: box.y, w: box.w, h: box.h } } : {}) });
		}
	}

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
		const el = tagsEl.createSvg('g', {
			cls: 'dynasty-tag',
			attr: { tabindex: 0, role: 'button', 'aria-label': farTagLabel(g, tag.spouses), 'data-person': tag.person },
		});
		const hit = hitsEl.createSvg('rect', { cls: 'dynasty-tag-hit', attr: { x: tag.hit.x, y: tag.hit.y, width: tag.hit.w, height: tag.hit.h, 'data-person': tag.person } });
		// The pill never grows past its zone (FarTag.zoneW): in `sideways` the tap area can be wider than the card's edge.
		const zone = tag.zoneW ?? tag.hit.w;
		// One rendering per level of detail, like the cards; a class on the <svg> shows one.
		const pill = (cls: string, font: string, fontEm: number, h: number, text: string, fitText: boolean) => {
			const pad = h / 2;
			const part = el.createSvg('g', { cls });
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
		tags.push({ tag, el, hit });
	}

	return { cards, tags, badges, links, refit: () => fitters.forEach((run) => run()) };
}

function addPart(parent: SVGElement, part: LegendPart): void {
	const el = parent.createSvg(part.tag, { cls: part.cls, attr: part.attr });
	if (part.text !== undefined) el.setText(part.text);
	for (const c of part.children ?? []) addPart(el, c);
}

/** Fills the legend popover (D25): one row per line kind and the D14 sign, each sample drawn like the tree. */
export function buildLegend(list: HTMLElement): void {
	for (const r of legendRows()) {
		const row = list.createDiv({ cls: r.kind === 'sign' ? 'dynasty-legend-row dynasty-legend-sign' : 'dynasty-legend-row' });
		const sample = row.createSvg('svg', { cls: 'dynasty-legend-sample', attr: { width: r.w, height: r.h, viewBox: `0 0 ${r.w} ${r.h}` } });
		for (const part of r.parts) addPart(sample, part);
		row.createSpan({ cls: 'dynasty-legend-label', text: r.label });
	}
}
