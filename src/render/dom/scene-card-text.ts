/*
 * What a card is made of (see `scene.ts`): the parts that do not depend on its relation word (name text lines, picture slots, tabs),
 * the Full group (name, sign, title, dates, relation word) and the Compact name. `cardKit` binds them to one scene's context; the card
 * loop in `scene-cards.ts` calls them for each card.
 */

import type { Person } from '../../core/types';
import { ROUNDEL_EM, cardTexts, nameCountOf, nameRoom, relationY, ribbonWidth, signBelowRing, signBottomOf, type CardText, type ShownLines, type roundelPics } from '../../layout/geometry';
import type { CardLabel } from '../../core/titles';
import type { NameLineCount, PersonBox, Rect } from '../../layout/model';
import { marksForSvg } from '../date-bidi';
import { pickReign } from '../date-fit';
import { cardNameLines, svgNameLines, titleLines, type NameMeasure } from '../name-lines';
import { COMPACT_NAME_EM, FRAME_STROKE_PX, TAB_TEXT_BASE_EM } from '../scene-model';
import { ME_RING_INNER } from '../styles';
import { dateLineShown, shownReignIsolated } from '../tree-info';
import { ME_WORD } from '../view-text';
import { drawOrdinalTab, type RingSpec } from './heir-ring';
import type { PictureOwner, PictureSlot } from './pictures';
import type { SceneCtx } from './scene-ctx';
import { relationFont, setRuns, signAt } from './scene-parts';

/** What a card's Full group needs of its person beyond the box and the word. */
export interface CardWords {
	cl: CardLabel | undefined;
	shownName: string;
	sign: boolean;
	isMe: boolean;
	titleText: string | undefined;
	reign: string | undefined;
}

/** The scene's lists that the parts of a card add to. */
export interface CardOut {
	/** Name elements that are links, with their link text. */
	links: Map<SVGTextElement, string>;
	/** The empty picture slots, in card order. */
	pictures: PictureSlot[];
	/** The numbered rings of the heirs. */
	ringSpecs: RingSpec[];
}

/** The content of a card that does not depend on its word. */
export interface CardPartsOf {
	tx: number;
	names: SVGTextElement[];
	tail: SVGElement[];
}

/** The name text lines of a card, with their links. */
function nameLines(mk: typeof createSvg, ctx: SceneCtx, out: CardOut, box: PersonBox, p: Person, ct0: CardText, tx: number): SVGTextElement[] {
	const link = ctx.opts.link(p);
	const count = nameCountOf(box);
	// The baseline is set when the card is drawn (`drawFull`); the attribute keeps its place.
	const nameEl = () => mk('text', { cls: link ? ['dynasty-card-name', 'dynasty-name-link', ...(link.resolved ? [] : ['is-unresolved'])] : 'dynasty-card-name', attr: { x: tx, y: 0 } });
	const names = [nameEl()];
	if (count > 1 && ct0.name2Baseline !== undefined) {
		names.push(nameEl());
		if (count > 2 && ct0.name3Baseline !== undefined) names.push(nameEl());
	}
	if (link) {
		for (const el of names) {
			el.setAttribute('data-href', link.linktext);
			out.links.set(el, link.linktext);
		}
	}
	return names;
}

/**
 * The empty picture slots of a card, arms first and then the portrait, with the Compact slot of each after the Full ones. One set of elements serves both levels. The
 * Compact level shows the Full group with its text hidden (styles.css), so the medallion and the arms are the same elements at both levels, at the same places; the live
 * pictures choose slots by level, so each picture has a Compact slot that shares the element and the frame with its Full slot.
 */
function pictureSlots(mk: typeof createSvg, f: number, box: PersonBox, p: Person, rp: NonNullable<ReturnType<typeof roundelPics>>, tail: SVGElement[]): PictureSlot[] {
	const full2: PictureSlot[] = [];
	const place = (r: Rect): Rect => ({ x: box.x + r.x, y: box.y + r.y, w: r.w, h: r.h });
	if (rp.arms) {
		const el = mk('g', { cls: 'dynasty-arms' });
		const rect = place(rp.arms);
		// D219: the gap round the arms follows the outline of the picture. It is drawn when the picture and its outline are in the slot (`setArmsGap`), never before.
		// The slot's owner: the person (personal arms) or the house.
		const owner: PictureOwner = p.arms ? { person: p.id } : { house: p.house! };
		full2.push({ kind: 'arms', lod: 'full', person: p.id, owner, rect, el, gap: ROUNDEL_EM.halo * f, align: rp.armsAlign });
		tail.push(el);
	}
	if (rp.portrait) {
		const rect = place(rp.portrait);
		const el = mk('g', { cls: 'dynasty-portrait' });
		// D219: a gap in the colour of the page round the picture keeps the line and the card edge off it. The frame is a thin outline on the picture's edge
		// that shows only while the picture is missing or has not come (the style).
		el.createSvg('circle', { cls: 'dynasty-r1-halo', attr: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r: rp.haloR } });
		const frame = el.createSvg('circle', { cls: 'dynasty-portrait-frame', attr: { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, r: rp.ringR - FRAME_STROKE_PX / 2 } });
		full2.push({ kind: 'portrait', lod: 'full', person: p.id, rect, el, frame });
		tail.push(el);
	}
	return [...full2, ...full2.map((slot): PictureSlot => ({ ...slot, lod: 'compact' }))];
}

/** D148: the small "You" tab on the top edge. It stands in the Full group, so the Compact and Overview levels hide it; the border still marks the person. */
function youTab(mk: typeof createSvg, f: number, box: PersonBox, tab: Rect): SVGElement {
	const tabEl = mk('g', { cls: 'dynasty-r1-tab-group' });
	const shape = { x: box.x + tab.x, y: box.y + tab.y, width: tab.w, height: tab.h, rx: tab.h / 2 };
	// D153: the base is a card-colour pill with a wide edge, so the border and the line above the card do not show through it.
	tabEl.createSvg('rect', { cls: 'dynasty-r1-tab-base', attr: shape });
	tabEl.createSvg('rect', { cls: 'dynasty-r1-tab', attr: shape });
	tabEl.createSvg('text', { cls: 'dynasty-r1-tab-text', attr: { x: box.x + tab.x + tab.w / 2, y: box.y + tab.y + tab.h / 2 + TAB_TEXT_BASE_EM * f } }).setText(ME_WORD);
	return tabEl;
}

/** The measures and helpers that the drawing of a card's text shares. */
function cardMetrics(ctx: SceneCtx) {
	const { opts, geo, t, f, textFont } = ctx;
	const nameFont = textFont(t.nameSize, opts.fonts.bold);
	const smallFont = textFont(t.smallSize);
	// The Compact name is 1.5 em of the note font, not of the Full name size (0.85 em).
	const compactSize = COMPACT_NAME_EM * f;
	// The sideways card's Compact name starts 0.6 em after the ribbon and ends 0.6 em before the edge.
	const compactW = geo.cardW - ribbonWidth(geo) - 1.2 * f;
	// D29, D61: a tall card has two Full name or title text lines; its Compact name stays one line, centred.
	const cardTextFor = cardTexts(geo);
	const textOf = (box: PersonBox, shown?: ShownLines, wordless = false): CardText => cardTextFor(nameCountOf(box), box.tallTitle, shown, wordless);
	// The Roundel's Compact name is centred in the body below the crown; every other card has no crown.
	const compactBaseline = (h: number, crown = 0) => crown + (h - crown) / 2 + 0.35 * compactSize;
	const compactSign = (h: number) => signAt(t, COMPACT_NAME_EM, compactBaseline(h), t.sign.x1);
	const baseCompactSign = compactSign(geo.cardH);
	const regularFont = textFont(t.nameSize);
	const nameMeasure: NameMeasure = (s, sob) => opts.measure(s, sob ? regularFont : nameFont);
	return {
		smallFont,
		compactSize,
		compactW,
		textOf,
		measureSmall: (s: string) => opts.measure(s, smallFont),
		compactBaseline,
		compactSign,
		baseCompactSign,
		// The Compact name stops short of the sign by the same clear gap as the Full name.
		compactWithSignW: compactW - (baseCompactSign.x1 - baseCompactSign.x2) - 0.5 * f,
		nameMeasure,
		drawSign: (parentEl: SVGGElement, x: number, y: number, s: CardText['sign']) =>
			parentEl.createSvg('line', {
				cls: 'dynasty-sign',
				attr: { x1: x + s.x1, y1: y + s.y1, x2: x + s.x2, y2: y + s.y2, 'stroke-width': s.width, 'stroke-dasharray': s.dash.join(' ') },
			}),
	};
}

type Metrics = ReturnType<typeof cardMetrics>;

/**
 * D61: the title text line from a card label, on the box's one or two text lines. A box the layout
 * did not make taller shows one text line, cut with "…", until the tree view lays it out again.
 */
function titleDrawer(ctx: SceneCtx, m: Metrics) {
	const { t, addFit, fit } = ctx;
	return (fullEl: SVGGElement, box: PersonBox, ct: CardText, title: string | undefined, plainReign: string | undefined, namedReign: string | undefined) => {
		const x = box.x + (ct.anchorX ?? t.padX);
		const first = fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.titleBaseline } });
		const second = box.tallTitle && ct.title2Baseline !== undefined ? fullEl.createSvg('text', { cls: 'dynasty-card-title', attr: { x, y: box.y + ct.title2Baseline } }) : undefined;
		const run = () => {
			// Spec §14 rule 15: a one-line room that cannot hold the names takes the plain reign, so a text that needs a cut is always the plain one.
			const lines = titleLines(title, pickReign(title, namedReign, plainReign, t.textW, m.measureSmall, !!second), t.textW, m.measureSmall);
			if (second) {
				first.setText(lines[0] ?? '');
				second.setText(lines[1] ?? '');
			} else first.setText(lines.length > 1 ? fit([title, plainReign].filter(Boolean).join(' '), t.textW, m.smallFont) : (lines[0] ?? ''));
		};
		addFit(run);
	};
}

/** The Full group of a card: the name text lines, the D14 sign, the title, the dates, the relation word (`rel`), then the pictures and tabs. */
function fullDrawer(ctx: SceneCtx, m: Metrics) {
	const { g, opts, geo, t, addFit, fitted } = ctx;
	const drawTitle = titleDrawer(ctx, m);
	return (full: SVGGElement, box: PersonBox, p: Person, ct: CardText, parts: CardPartsOf, rel: { text: string } | undefined, o: CardWords) => {
		const { names, tail, tx } = parts;
		const bases = [ct.nameBaseline, ct.name2Baseline, ct.name3Baseline];
		names.forEach((el, i) => {
			el.setAttribute('y', String(box.y + (bases[i] ?? 0)));
			full.appendChild(el);
		});
		// D122: the sobriquet follows the name at the Full level (Compact and Overview show the name only).
		const sob = o.cl?.sobriquet ?? p.sobriquet;
		// D96: on the marked card the sign keeps clear of the mark's inner ring. The Roundel's room depends on the marked ring.
		const markRing = o.isMe ? ME_RING_INNER : undefined;
		const room = nameRoom(geo, ct, o.sign, markRing);
		addFit(() => {
			// A box the layout made taller for fewer text lines than the name needs shows at most that many until the tree view lays it out again.
			const lines = svgNameLines(cardNameLines(o.shownName, sob, room, m.nameMeasure, names.length as NameLineCount, opts.breaks));
			names.forEach((el, i) => setRuns(el, lines[i] ?? []));
		});
		if (o.sign) m.drawSign(full, box.x, box.y, markRing === undefined ? ct.sign : signBelowRing(ct.sign, markRing));
		// D61: with a label, the title text line carries the reign, unless dates are off.
		const hasTitle = !!o.titleText || !!o.reign;
		if (o.cl) {
			if (hasTitle) drawTitle(full, box, ct, o.titleText, o.reign, marksForSvg(shownReignIsolated(o.cl, g.dates, 'shown')));
		} else if (p.title) {
			fitted(full.createSvg('text', { cls: 'dynasty-card-title', attr: { x: tx, y: box.y + ct.titleBaseline } }), p.title, ct.textW, m.smallFont);
		}
		const dates = marksForSvg(dateLineShown(p, g.dates), true);
		const datesBaseline = hasTitle ? ct.datesBaseline : ct.titleBaseline;
		if (dates) fitted(full.createSvg('text', { cls: 'dynasty-card-dates', attr: { x: tx, y: box.y + datesBaseline } }), dates, ct.textW, m.smallFont, false, marksForSvg(dateLineShown(p, g.dates, { names: 'none' }), true));
		const relY = relationY(ct);
		if (rel?.text && relY !== undefined) {
			// D40: a name too long for the card ends with "…"; the sheet shows it in full.
			// D176 (5): a text with a maybe keeps " ?" when it is cut, so the word and the suffix are cut apart.
			// D268: before it is cut, the text tries the short forms; only the drawn card does (the sheet, the label and the list keep the whole text).
			fitted(full.createSvg('text', { cls: 'dynasty-card-relation', attr: { x: tx, y: box.y + relY } }), rel.text, ct.relationW ?? ct.textW, relationFont(t.smallSize, opts.fonts.text, o.isMe, opts.fonts.bold), true);
		}
		for (const el of tail) full.appendChild(el);
	};
}

/** The Compact name of a card and its D14 sign, after the Full group. */
function compactDrawer(ctx: SceneCtx, m: Metrics) {
	const { geo, t, f, roundel, fittedShrinking } = ctx;
	return (body: SVGGElement, box: PersonBox, ct: CardText, shownName: string, sign: boolean, isMe: boolean) => {
		const tall = !!(box.tallName || box.tallTitle);
		const markRing = isMe ? ME_RING_INNER : undefined;
		const compact = body.createSvg('text', {
			cls: 'dynasty-card-compact',
			attr: roundel ? { x: box.x + (ct.anchorX ?? t.padX), y: box.y + m.compactBaseline(box.h, ct.r1?.crown ?? 0) } : { x: box.x + ribbonWidth(geo) + 0.6 * f, y: box.y + m.compactBaseline(box.h) },
		});
		// The Roundel's Compact sign is the Full one; its text is centred, so the name stops short of the sign only where the two can meet.
		const cs = sign ? (roundel ? ct.sign : tall ? m.compactSign(box.h) : m.baseCompactSign) : undefined;
		const shownCs = cs && markRing !== undefined ? signBelowRing(cs, markRing) : cs;
		// The Compact name's capitals are 0.7 em of its size above its baseline; a name under the sign (no crown, the sign level with line 1) takes the narrow room.
		const roundelCompactW = shownCs && m.compactBaseline(box.h, ct.r1?.crown ?? 0) - 0.7 * m.compactSize < signBottomOf(shownCs) ? ct.nameWithSignW : ct.textW;
		// Unsigned, the Compact name ends 0.25 em from the card's edge, not 0.5 em like the Full name. With the sign it ends 0.5 em before the sign.
		const compactNameW = roundel ? roundelCompactW : sign ? m.compactWithSignW : m.compactW;
		fittedShrinking(compact, shownName, compactNameW);
		if (shownCs) m.drawSign(body.createSvg('g', { cls: 'dynasty-card-compact-sign' }), box.x, box.y, shownCs);
	};
}

/** Binds the drawing of a card's parts to one scene: its text geometry, fits and lists. */
export function cardKit(ctx: SceneCtx, out: CardOut) {
	const { t, f, roundel, geo } = ctx;
	const m = cardMetrics(ctx);
	/** The parts of a card's content that do not depend on its word: the name text lines (with their links), the picture slots and the tabs. */
	const cardParts = (mk: typeof createSvg, box: PersonBox, p: Person, ct0: CardText, rp: ReturnType<typeof roundelPics> | undefined, tab: Rect | undefined, ordTab: Rect | undefined, ordinal: string | undefined): CardPartsOf => {
		const tx = box.x + (ct0.anchorX ?? t.padX);
		const names = nameLines(mk, ctx, out, box, p, ct0, tx);
		const tail: SVGElement[] = [];
		if (rp) out.pictures.push(...pictureSlots(mk, f, box, p, rp, tail));
		if (tab) tail.push(youTab(mk, f, box, tab));
		if (ordTab && ordinal) {
			// The word tab stands in the Full group and shows at the Full level only, like the "You" tab; the ring takes its place at the smaller levels.
			const holder = mk('g');
			drawOrdinalTab(holder, box, ordTab, ordinal, f, roundel, out.ringSpecs, ribbonWidth(geo) + 0.6 * f);
			tail.push(...(Array.from(holder.children) as SVGElement[]));
		}
		return { tx, names, tail };
	};
	return { textOf: m.textOf, cardParts, drawFull: fullDrawer(ctx, m), drawCompact: compactDrawer(ctx, m) };
}

/** The kit that `cardKit` makes. */
export type CardKit = ReturnType<typeof cardKit>;
