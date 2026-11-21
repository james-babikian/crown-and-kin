/*
 * The cards of a scene (see `scene.ts`): for each person a card shell with its tap areas and the content that the shell holds, the `+` badge
 * of focus mode and the fold controls that follow it in the Tab order. In a lazy scene the content waits until a fill attaches it
 * (spec §13.15 rule 1, S1 and S2); a late card also waits for its relation word (D352 item 1).
 */

import type { House, Person } from '../../core/types';
import { isDead } from '../../core/succession-keys';
import { ME_RING_INNER } from '../styles';
import { ordinalTabRect, ribbonWidth, roundelPics, showsArms, youTabRect, type ShownLines } from '../../layout/geometry';
import { illegitimateSigns } from '../../layout/index';
import type { PersonBox, PlacedFoldControl, Rect } from '../../layout/model';
import { isColour } from '../colour-check';
import { marksForSvg } from '../date-bidi';
import { SIGN_CARD_LABEL, cardLabel, dateLine, reignShown } from '../tree-info';
import { HIT_EM, ribbonPath } from '../view-math';
import { drawFold, type FoldRef } from './folds';
import type { BadgeRef } from './scene-types';
import type { CornerTracker } from './scene-corner';
import type { SceneCtx } from './scene-ctx';
import type { CardKit, CardOut, CardPartsOf } from './scene-card-text';
import type { LateCard } from './scene-fill';
import { BADGE_RADIUS_EM, discPath, parentNames, stateCls } from './scene-parts';

/** R026 fit: the detail group of a card, and whether the card has made it (a lazy card makes it when it is filled). */
export interface BodyRef {
	person: string;
	card: SVGGElement;
	body: SVGGElement;
	made: boolean;
	/** True while the group is a child of its card. */
	in: boolean;
	/** True while a delayed item waits to put the group back. */
	waiting: boolean;
}

/** The detail groups of all cards and whether they are in the document (`Scene.setDetail`). */
export interface BodyState {
	list: BodyRef[];
	detail: boolean;
}

/** What the card layer made. */
export interface CardsOut extends CardOut {
	cards: Map<string, SVGGElement>;
	badges: BadgeRef[];
	folds: FoldRef[];
	/** B8 3: the step that makes the focus ring of a lazy card, by person. */
	rings: Map<string, () => void>;
	late: Map<string, LateCard>;
	bodies: BodyState;
}

/** What the card loop reads for every card. */
interface Env {
	ctx: SceneCtx;
	kit: CardKit;
	corner: CornerTracker;
	out: CardsOut;
	cardsEl: SVGGElement;
	badgeHitsEl: SVGGElement;
	hitsEl: SVGGElement;
	openFoldHitsEl: SVGGElement;
	foldsAfter: Map<string, PlacedFoldControl[]>;
	signed: Set<string>;
	heirIds: Set<string>;
	ordinalIds: Set<string>;
	/** Set only in a lazy scene with late words: true when the word of an id is worked out already. */
	known: ((id: string) => boolean) | undefined;
}

type Word = { text: string; lower: string } | undefined;

/** The parts of one card that the delayed and late steps work on. */
interface Made {
	box: PersonBox;
	p: Person;
	card: SVGGElement;
	bg: SVGRectElement;
	bodyRef: BodyRef;
	isLate: boolean;
	/** The word now and the fits of the last drawing; `fitsOn` is true once a refit runs them. */
	live: { relation: Word; runs: (() => void)[]; fitsOn: boolean };
	/** Draws the content of the card into its body with `rel`. `blank` keeps the word line empty. Gives the text fits of a lazy card. */
	drawBody: (rel: Word, blank?: boolean) => (() => void)[];
	labelOf: (r: Word) => string;
	ringNow: boolean;
	ringInfo: { cls: string; attr: Record<string, number> };
}

/** A control is drawn right after the card (and badge) of the later of its parents, so the Tab key reaches it next. */
function foldPlan(ctx: SceneCtx): Map<string, PlacedFoldControl[]> {
	const { opts, layout } = ctx;
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
	return foldsAfter;
}

/** Draws the fold controls of `list` into the card layer. */
function drawFolds(env: Env, list: readonly PlacedFoldControl[] | undefined): void {
	const { ctx, cardsEl, hitsEl, openFoldHitsEl } = env;
	const { opts, layout, g, f } = ctx;
	for (const c of list ?? []) {
		const label = opts.folds!.label(c, parentNames(c, layout, g));
		env.out.folds.push(drawFold({ controls: cardsEl, hits: hitsEl, openHits: openFoldHitsEl, fonts: opts.fonts, measure: opts.measure, em: f, label, fitters: ctx.fitters, ...(layout.orientation === 'sideways' ? { anchored: true } : {}), ...(opts.folds!.wire ? { wire: opts.folds!.wire } : {}), ...(opts.folds!.lazy ? { lazy: true } : {}) }, c));
	}
}

/** The card shell: its `<g>` with the attributes, classes and house colour, the second focus ring of an eager card and the bg rect. */
function cardShell(env: Env, box: PersonBox, p: Person, house: House | undefined, isMe: boolean, sign: boolean, label: string) {
	const { ctx, cardsEl } = env;
	const { roundel, lazy } = ctx;
	const cls = ['dynasty-card', ...(roundel ? ['dynasty-card-r1'] : ['dynasty-card-tc']), ...(isDead(p) ? ['dynasty-deceased'] : []), ...(env.heirIds.has(p.id) ? ['dynasty-heir'] : []), ...(isMe ? ['dynasty-card-me'] : []), ...stateCls(ctx.look.card(p.id))];
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
	if (sign) card.addClass('dynasty-signed');
	env.out.cards.set(p.id, card);

	// The second focus and highlight ring, under the card: the accent alone can be too weak in a theme.
	// A lazy card keeps only its bg rect (its size and hit area). Its ring is made by `fillPerson` and `fillAll` only (B8 3): the ring shows only
	// for the keyboard focus and the highlight, and both ask for the person first.
	const ringInfo = { cls: 'dynasty-card-ring', attr: { x: box.x, y: box.y, width: box.w, height: box.h } };
	const ringNow = !lazy;
	if (ringNow) card.createSvg('rect', ringInfo);
	const bg = card.createSvg('rect', { cls: 'dynasty-card-bg', attr: { x: box.x, y: box.y, width: box.w, height: box.h } });
	return { card, bg, ringInfo, ringNow };
}

/**
 * A press on the part that sticks out above the card (the halo, the arms, the tab) opens the sheet and never pans; it is in the shell, so a card that is not filled yet has it.
 * The ordinal tab has no tap target of its own; a press on it is a press on the card, through the same crown area as the "You" tab.
 */
function crownHit(ctx: SceneCtx, card: SVGGElement, box: PersonBox, rp: ReturnType<typeof roundelPics> | undefined, tab: Rect | undefined, ordTab: Rect | undefined): void {
	const above: number[] = [];
	if (rp?.portrait) above.push(rp.cx - rp.haloR, rp.cx + rp.haloR);
	if (rp?.arms) above.push(rp.arms.x, rp.arms.x + rp.arms.w);
	if (tab) above.push(tab.x, tab.x + tab.w);
	if (ordTab) above.push(ordTab.x, ordTab.x + ordTab.w);
	if (above.length && ctx.geo.reach) {
		const x0 = Math.min(...above);
		card.createSvg('rect', { cls: 'dynasty-card-crown-hit', attr: { x: box.x + x0, y: box.y - ctx.geo.reach, width: Math.max(...above) - x0, height: ctx.geo.reach } });
	}
}

/** The fits of a lazy card run when its content is attached, and again at a refit, always the ones of its last drawing. */
function runFits(ctx: SceneCtx, live: Made['live']): void {
	for (const run of live.runs) run();
	if (live.fitsOn) return;
	live.fitsOn = true;
	ctx.fitters.push(() => live.runs.forEach((run) => run()));
}

/** The late card (its word is written later) and the delayed step that attaches the content of a lazy card. */
function wireLazy(env: Env, m: Made): void {
	const { ctx, out } = env;
	const { box, p, card, bg, live, bodyRef } = m;
	if (m.isLate) {
		const lc: LateCard = {
			box,
			drawn: false,
			write: () => {
				out.late.delete(p.id);
				live.relation = ctx.opts.relations?.get(p.id);
				card.setAttribute('aria-label', m.labelOf(live.relation));
				if (!lc.drawn) return;
				// The content was attached with an empty word line: it is drawn again with the word, in place.
				lc.drawn = false;
				live.runs = m.drawBody(live.relation);
				runFits(ctx, live);
			},
		};
		out.late.set(p.id, lc);
	}
	if (!ctx.lazy) return;
	let ringMade = m.ringNow;
	out.rings.set(p.id, () => {
		if (ringMade) return;
		ringMade = true;
		card.insertBefore(createSvg('rect', m.ringInfo), bg);
	});
	let drawn = !m.isLate;
	ctx.delay(p.id, box, true, () => {
		if (!drawn) {
			drawn = true;
			// A fill outside a gesture wrote the word first; a fill during a gesture leaves the card late, with an empty word line.
			const lc = out.late.get(p.id);
			if (lc) lc.drawn = true;
			live.runs = m.drawBody(live.relation, !!lc);
		}
		runFits(ctx, live);
		bodyRef.made = true;
		if (out.bodies.detail) {
			card.appendChild(bodyRef.body);
			bodyRef.in = true;
		}
	});
}

/**
 * The `+` badge goes right after its card: the Tab key reaches a card, then its own badge. It shows over its own card's corner; a card drawn
 * later still wins where the two meet.
 */
function addBadge(env: Env, box: PersonBox, p: Person, n: number, bg: SVGRectElement): void {
	const { ctx, cardsEl, badgeHitsEl, corner } = env;
	const { f, lazy } = ctx;
	const r = BADGE_RADIUS_EM * f;
	const arm = 0.5 * r;
	// An outline disc whose centre lies on the middle of the arc of the card's rounded top right corner, so the disc sits in the corner
	// and does not stick out of it. The corner radius comes from the theme at run time, so the places are set again when it becomes known (`setCornerRadius`).
	const mark = { x: 0, y: 0, w: 2 * r, h: 2 * r };
	const el = cardsEl.createSvg('g', {
		cls: 'dynasty-focus-badge',
		attr: { tabindex: 0, role: 'button', 'aria-label': ctx.opts.badges!.label(p, n), 'data-person': p.id, 'data-hidden': n },
	});
	// The square is below the cards, so the own card wins over it; the disc is the one part of the badge that wins over its card. Its first size is 3 em; the tree view sizes it again at each settled zoom.
	const hitSide = HIT_EM * f;
	const hit = badgeHitsEl.createSvg('rect', { cls: 'dynasty-focus-badge-hit', attr: { x: 0, y: 0, width: hitSide, height: hitSide, 'data-badge': p.id } });
	const disc = el.createSvg('path', { cls: 'dynasty-focus-badge-disc' });
	const bb = ctx.holderFor(el);
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
	place(corner.barRadius(bg));
	corner.bars.push(place);
	if (lazy) ctx.delay(p.id, mark, false, () => ctx.attachChildren(bb, el));
	env.out.badges.push({ person: p.id, el, hit, disc, mark });
}

/** One card: its shell, its tap areas, its content (now or delayed), its badge and the fold controls that come after it. */
function drawCard(env: Env, box: PersonBox, p: Person): void {
	const { ctx, kit, corner, out } = env;
	const { g, opts, geo, roundel, lazy, layout } = ctx;
	const house = p.house ? g.houses.get(p.house) : undefined;
	const isMe = opts.me !== undefined && p.id === opts.me;
	const isLate = !!env.known && !env.known(p.id);
	const live: Made['live'] = { relation: isLate ? undefined : opts.relations?.get(p.id), runs: [], fitsOn: false };
	// The card's name and title text lines; without a label, the person's own.
	const cl = opts.labels?.get(p.id);
	const shownName = cl ? cl.name : p.name;
	const sign = env.signed.has(p.id);
	// §13.1: the label names the relation, also when a class hides the text on the card. A late card names it when its word is written.
	const labelOf = (r: Word) => {
		const label = cardLabel(p, isMe ? 'you' : r?.lower, cl, undefined, g.dates);
		return sign ? `${label}, ${SIGN_CARD_LABEL}` : label;
	};
	const { card, bg, ringInfo, ringNow } = cardShell(env, box, p, house, isMe, sign, labelOf(live.relation));
	// The Roundel's medallion and arms stand on the top edge; the text card has none (it never reads the picture flags).
	// D204: a card shows the arms of its person or else of its house.
	const rp = roundel ? roundelPics(geo, { arms: showsArms(box, p.arms, house), portrait: !!box.portrait }) : undefined;
	// The ordinal tab replaces the "You" tab of the same card.
	const ordinal = env.ordinalIds.has(p.id) ? opts.ordinals?.get(p.id) : undefined;
	const tab = layout.youTab === p.id && !ordinal ? youTabRect(geo, !!rp?.portrait, !!rp?.arms) : undefined;
	const ordTab = ordinal ? ordinalTabRect(geo, !!rp?.portrait, !!rp?.arms, [...ordinal].length) : undefined;
	crownHit(ctx, card, box, rp, tab, ordTab);
	// R026 fit: the level-specific parts of a card (bar, Full group, Compact text, sign, arms) are in one group. The Overview level hides that one group, so the browser
	// restyles one element for each card, not every part (a class swap on the root restyled 3 000 elements, 108 ms at 4x CPU). A lazy card makes the group apart and attaches it whole.
	const body = lazy ? createSvg('g', { cls: 'dynasty-card-body' }) : card.createSvg('g', { cls: 'dynasty-card-body' });
	const bodyRef: BodyRef = { person: p.id, card, body, made: !lazy, in: !lazy, waiting: false };
	out.bodies.list.push(bodyRef);
	// The house ribbon is a path with the card's own rounded corners; on the marked card it lies inside the thick border. The radius comes
	// from the theme at run time (`readCornerRadius`), so the path is made again when it becomes known (`setCornerRadius`).
	const rib = ribbonWidth(geo);
	const inset = isMe ? ME_RING_INNER : 0;
	const ribbonD = (r: number) => ribbonPath(box.x + inset, box.y + inset, roundel ? box.w - 2 * inset : rib, roundel ? rib : box.h - 2 * inset, rib, Math.max(0, r - inset), roundel ? 'top' : 'left');
	// An eager card makes its parts in its body, a lazy one apart; `drawBody` puts them in their places either way.
	const mk: typeof createSvg = lazy ? createSvg : (tag, o) => body.createSvg(tag, o);
	const ribbon = mk('path', { cls: 'dynasty-card-ribbon', attr: { d: ribbonD(corner.barRadius(bg)) } });
	corner.bars.push((r) => ribbon.setAttribute('d', ribbonD(r)));
	// The lines that exist are centred in the body, so the text block needs to know which small lines the person has. The dates line counts even when "Show dates on cards" is off (the class hides it), as the saved picture centres it.
	const titleText = cl ? cl.title : p.title;
	const reign = cl && opts.showDates !== false ? marksForSvg(reignShown(cl, cl.reign, g.dates, 'none')) : undefined;
	const shown: ShownLines = { title: !!(titleText || reign), dates: !!dateLine(p, g.dates, { names: 'none' }) };
	// The parts of the content that do not depend on the word are made once (the name links, the picture slots and the ring of an ordinal tab are known
	// from the build on); `drawBody` places them. The D177 centring moves text lines up or down, never sideways.
	const n = opts.badges?.hidden.get(p.id);
	const parts: CardPartsOf = kit.cardParts(mk, box, p, kit.textOf(box, shown), rp, tab, ordTab, ordinal);
	const drawBody = (rel: Word, blank = false): (() => void)[] => {
		body.empty();
		ctx.pendingFits = lazy ? [] : null;
		body.appendChild(ribbon);
		// D177 (10): a card with no relation word, in a tree with relation words, centres its text in the whole card. An empty word line that waits for its word does not.
		const ct = kit.textOf(box, shown, geo.relationLine === true && !!opts.relations && !blank && !rel?.text);
		kit.drawFull(body.createSvg('g', { cls: 'dynasty-card-full' }), box, p, ct, parts, rel, { cl, shownName, sign, isMe, titleText, reign });
		kit.drawCompact(body, box, ct, shownName, sign, isMe);
		const runs = ctx.pendingFits ?? [];
		ctx.pendingFits = null;
		return runs;
	};
	if (!isLate) live.runs = drawBody(live.relation);
	wireLazy(env, { box, p, card, bg, bodyRef, isLate, live, drawBody, labelOf, ringNow, ringInfo });
	if (n && opts.badges) addBadge(env, box, p, n, bg);
	drawFolds(env, env.foldsAfter.get(p.id));
	env.foldsAfter.delete(p.id);
}

/** Draws the card layer: every person's card and badge, with the fold controls after them. `els` are the tap-area layers that were made before it. */
export function buildCards(ctx: SceneCtx, kit: CardKit, corner: CornerTracker, out: CardsOut, els: { badgeHitsEl: SVGGElement; hitsEl: SVGGElement; openFoldHitsEl: SVGGElement }): void {
	const { g, opts, layout, lazy } = ctx;
	const cardsEl = ctx.parent.createSvg('g', { cls: 'dynasty-cards' });
	const heirIds = new Set(opts.heirs ?? []);
	const ordinalIds = new Set(layout.ordinalCards ?? []);
	// D352 item 1: the late cards (`scene-fill.ts`). The marked person, the heirs and the ordinal cards get their words now, in one request,
	// because the tree view gives their labels a place in the line (`markPositions`).
	const rels = opts.relations;
	const known = lazy && opts.lateWords !== undefined && rels?.known ? (id: string) => rels.known?.(id) === true : undefined;
	if (known) opts.relations?.getMany?.([...(opts.me !== undefined ? [opts.me] : []), ...heirIds, ...(opts.ordinals?.keys() ?? [])].filter((id) => layout.persons.has(id)));
	const env: Env = { ctx, kit, corner, out, cardsEl, ...els, foldsAfter: foldPlan(ctx), signed: illegitimateSigns(g, ctx.edges), heirIds, ordinalIds, known };
	for (const box of layout.persons.values()) {
		const p = g.byId.get(box.id);
		if (p) drawCard(env, box, p);
	}
	// A control whose parent has no person in the graph is still drawn.
	for (const list of env.foldsAfter.values()) drawFolds(env, list);
}

/** `Scene.setDetail`: takes the detail group of every card out of the document, or puts it back; `reset` tells the fill that there is new work. */
export function makeSetDetail(ctx: SceneCtx, bodies: BodyState, reset: () => void): (on: boolean) => void {
	return (on) => {
		if (on === bodies.detail) return;
		bodies.detail = on;
		// The groups that come back are new work: a finished chain at the same view centre must not skip them.
		reset();
		for (const b of bodies.list) {
			if (!b.made) continue;
			if (!on) {
				if (b.in) b.body.remove();
				b.in = false;
			} else if (!b.in && !b.waiting) {
				const box = ctx.layout.persons.get(b.person);
				if (ctx.lazy && box) {
					// The fill puts it back: the cards near the view now, the rest in idle chunks.
					b.waiting = true;
					ctx.delay(b.person, box, true, () => {
						b.waiting = false;
						if (bodies.detail && !b.in) {
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
}
