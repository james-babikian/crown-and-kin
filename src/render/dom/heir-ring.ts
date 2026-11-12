// The ordinal marks of the heirs in the Show view of a line of succession: the word tab ("1st") of the Full level and the small numbered ring of the Compact
// and Overview levels (spec §13.21 rule 36, D334 Q3). The tab is drawn inside the card; the ring has its own layer above the cards, so it is never under a
// ribbon or a name. A ring is made once per heir; the level class decides if it shows, and `placeRings` moves it with the zoom. Two rings that would touch at the
// Overview level on a computer stand one above the other (D338 point 1), and on a phone with a sideways tree the Compact ring stands on the left edge of its card
// (D338 point 2; both D341). Where that edge place covers another card or touches a fold button, the ring keeps the corner of the word tab (D348 3).
import { ORDINAL_EM } from '../../layout/geometry';
import type { Rect } from '../../layout/model';
import { TAB_TEXT_BASE_EM } from '../scene-model';

/** The size of a ring on the screen, in px: a fixed height, and a width that follows the digits. The text size is `--dynasty-type-small` (12 px or more). */
export const RING_PX = { h: 17, perDigit: 8, pad: 9 } as const;
/** px: the room two rings keep on the screen: the 3 px halo of each ring means that two rings closer than this touch. */
export const RING_CLEAR = 3;
/** px: how far one step of a stagger lifts a ring: its own height and the clear room, so a lifted ring touches none of the unlifted ring beside it. */
export const RING_LIFT = RING_PX.h + RING_CLEAR;

/** Where the ring of one heir stands, in scene units, at each level. */
export interface RingSpec {
	text: string;
	/** Compact: the bottom corner of the word tab (the right corner on a Roundel card, the left corner on a text card), where the ring's own corner stands. */
	tab: { x: number; y: number; left: boolean };
	/** Overview: the middle of the top edge of the block, where the ring's middle stands. */
	top: { x: number; y: number };
	/** The card of the heir: the one card its ring may lie over. */
	block: Rect;
	/** Compact, a phone with a sideways tree: the middle of the left edge of the card, where the ring's middle stands and where the child line arrives; `room` is how far the Compact name starts right of the edge. */
	edge: { x: number; y: number; room: number };
}

/** A drawn ring. */
export interface HeirRing {
	el: SVGGElement;
	spec: RingSpec;
	/** Ring width on the screen, px. */
	w: number;
	/** Every card of the layout: a ring that is lifted, or put on an edge, keeps off the cards of other people. */
	cards: readonly Rect[];
	/** The visible marks of the fold controls the scene draws, in scene units: the ring on the left edge keeps off them. The rectangles are the live ones of the scene (a sign is measured late). */
	folds: readonly Rect[];
	/** The one path that holds the stems of all lifted rings, under the rings: a hairline from each lifted ring down to its block. */
	stems: SVGPathElement;
	/** The level, zoom and device the transform was written for; nothing is written again for the same triple. */
	stamp: string;
}

/** The digits of an ordinal ("21st" gives "21"); undefined for an open branch ("?") or any text without a digit. */
export function ringNumber(ordinal: string): string | undefined {
	const m = /^\d+/.exec(ordinal);
	return m ? m[0] : undefined;
}

/**
 * Draws the word tab of an heir into its Full group, as before, and adds the spec of the ring of the same heir to `specs` (none for an open branch). The tab
 * is hidden from screen readers, the card label says the place.
 */
export function drawOrdinalTab(full: SVGGElement, box: Rect, tab: Rect, ordinal: string, f: number, roundel: boolean, specs: RingSpec[], nameLeft: number): void {
	// A card-colour base keeps the border and the line above the card from showing through.
	const el = full.createSvg('g', { cls: 'dynasty-ordinal-tab-group', attr: { 'aria-hidden': 'true' } });
	const rect = { x: box.x + tab.x, y: box.y + tab.y, width: tab.w, height: tab.h, rx: ORDINAL_EM.corner * f };
	el.createSvg('rect', { cls: 'dynasty-ordinal-tab-base', attr: rect });
	el.createSvg('rect', { cls: 'dynasty-ordinal-tab', attr: rect });
	el.createSvg('text', { cls: 'dynasty-ordinal-tab-text', attr: { x: box.x + tab.x + tab.w / 2, y: box.y + tab.y + tab.h / 2 + TAB_TEXT_BASE_EM * f } }).setText(ordinal);
	const text = ringNumber(ordinal);
	if (text !== undefined) specs.push({ text, tab: { x: roundel ? box.x + tab.x + tab.w : box.x + tab.x, y: box.y + tab.y + tab.h, left: !roundel }, top: { x: box.x + box.w / 2, y: box.y }, block: box, edge: { x: box.x, y: box.y + box.h / 2, room: nameLeft } });
}

/** Makes the layer of the rings above the cards and one ring for each spec. No layer is made without a spec, so a tree without a line is unchanged. */
export function buildRings(parent: SVGGElement, specs: readonly RingSpec[], persons: ReadonlyMap<string, Rect>, folds: readonly Rect[] = []): HeirRing[] {
	if (!specs.length) return [];
	const cards = [...persons.values()];
	const layer = parent.createSvg('g', { cls: 'dynasty-heir-numbers', attr: { 'aria-hidden': 'true' } });
	// First in the layer, so every ring covers the stems.
	const stems = layer.createSvg('path', { cls: 'dynasty-heir-number-stems', attr: { d: '' } });
	return specs.map((spec) => {
		const w = Math.max(RING_PX.h, spec.text.length * RING_PX.perDigit + RING_PX.pad);
		const el = layer.createSvg('g', { cls: 'dynasty-heir-number' });
		const rect = { x: -w / 2, y: -RING_PX.h / 2, width: w, height: RING_PX.h, rx: RING_PX.h / 2 };
		el.createSvg('rect', { cls: 'dynasty-heir-number-base', attr: rect });
		el.createSvg('rect', { cls: 'dynasty-heir-number-rim', attr: rect });
		el.createSvg('text', { cls: 'dynasty-heir-number-text', attr: { x: 0, y: 0, dy: '0.35em' } }).setText(spec.text);
		return { el, spec, w, cards, folds, stems, stamp: '' };
	});
}

const round = (n: number) => Math.round(n * 1000) / 1000;
/** Scene units of play when a ring is compared with a card: the places are rounded to a thousandth. */
const SLACK = 0.01;
/** The most steps more that a ring goes up to leave the cards of other people. */
const EXTRA_LIFTS = 2;
/** The most steps a ring goes up to clear the rings beside it: a bound for the loop, far above what a line of heirs needs. */
const LIFT_LIMIT = 200;
/** D343 4 A: a ring never stands more than 4 steps (80 px) above its place; above it, a touch is accepted. */
export const MAX_RING_STEPS = 4;

/** The rectangle of a ring of `w` screen px with its middle at (x, y), in scene units at the scale 1 / k. */
function ringRect(x: number, y: number, w: number, k: number): Rect {
	return { x: x - (w / 2) * k, y: y - (RING_PX.h / 2) * k, w: w * k, h: RING_PX.h * k };
}

/** True when `r` lies over a card other than the ring's own. */
function coversCard(r: Rect, cards: readonly Rect[], own: Rect): boolean {
	const same = (c: Rect) => c.x === own.x && c.y === own.y && c.w === own.w && c.h === own.h;
	return cards.some((c) => !same(c) && r.x < c.x + c.w - SLACK && c.x < r.x + r.w - SLACK && r.y < c.y + c.h - SLACK && c.y < r.y + r.h - SLACK);
}

/** True when `r`, with the halo of the ring around it (`RING_CLEAR` / 2 on each side, 1.5 px: half the 3 px stroke of the base), touches a mark of a fold control. */
function touchesFold(r: Rect, folds: readonly Rect[], k: number): boolean {
	const halo = (RING_CLEAR / 2) * k;
	return folds.some((f) => r.x - halo < f.x + f.w && f.x < r.x + r.w + halo && r.y - halo < f.y + f.h && f.y < r.y + r.h + halo);
}

/** One ring on the screen: where its block's top stands (screen px), its width, and how many steps it stands above that place. */
interface Stand {
	x: number;
	y: number;
	w: number;
	level: number;
}

/** True when two rings on the screen touch each other. */
function standsTouch(a: Stand, b: Stand): boolean {
	return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + RING_CLEAR && Math.abs(a.y - a.level * RING_LIFT - (b.y - b.level * RING_LIFT)) < RING_PX.h + RING_CLEAR;
}

/**
 * How many steps of `RING_LIFT` each ring stands above its place at the Overview level (same order as `rings`). A ring that would touch one already placed
 * goes up to the first step where it touches no ring, or up to `EXTRA_LIFTS` steps more if that takes it off a card of another person,
 * and never more than `MAX_RING_STEPS` steps (D343 4 A).
 * The rings are taken in the order of their places (left to right, then top to bottom, then the number), never in the order of `rings`, so the result does not
 * depend on the order of the people in the note.
 */
export function ringLevels(rings: readonly HeirRing[], scale: number): number[] {
	const levels: number[] = rings.map(() => 0);
	const k = 1 / scale;
	const at = (i: number) => rings[i].spec.top;
	const order = rings.map((_, i) => i).sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y || Number(rings[a].spec.text) - Number(rings[b].spec.text) || a - b);
	const widest = Math.max(0, ...rings.map((r) => r.w));
	const placed: number[] = [];
	for (const i of order) {
		const stand = (n: number, level: number): Stand => ({ x: at(n).x * scale, y: at(n).y * scale, w: rings[n].w, level });
		const touches = (j: number, level: number) => standsTouch(stand(i, level), stand(j, levels[j]));
		// Only a ring close enough to the left can be touched: the places are sorted, so the scan stops at the first ring that is too far.
		const near: number[] = [];
		for (let n = placed.length - 1; n >= 0; n--) {
			if ((at(i).x - at(placed[n]).x) * scale >= (widest + rings[i].w) / 2 + RING_CLEAR) break;
			near.push(placed[n]);
		}
		const clear = (level: number) => !near.some((j) => touches(j, level));
		const free = (level: number) => clear(level) && !coversCard(ringRect(at(i).x, at(i).y - level * RING_LIFT * k, rings[i].w, k), rings[i].cards, rings[i].spec.block);
		let level = 0;
		if (!clear(0)) {
			level = 1;
			while (level < LIFT_LIMIT && !clear(level)) level++;
			// Up to `EXTRA_LIFTS` steps more are allowed when they take the ring off a card.
			for (let extra = 1; extra <= EXTRA_LIFTS && !free(level); extra++) if (free(level + extra)) level += extra;
			level = Math.min(level, MAX_RING_STEPS);
		}
		levels[i] = level;
		placed.push(i);
	}
	return levels;
}

/** The path of the stems: for each lifted ring, a line from the bottom of the ring down to the top of its block (scene units). */
function stemPath(rings: readonly HeirRing[], levels: readonly number[], k: number): string {
	return rings.map((r, i) => (levels[i] ? `M${round(r.spec.top.x)} ${round(r.spec.top.y)}V${round(r.spec.top.y - (levels[i] * RING_LIFT - RING_PX.h / 2) * k)}` : '')).join('');
}

/** The middle of the Compact ring of a phone with a sideways tree: centred on the left edge of its card, or undefined where that would cover another card or touch a fold button (D348 3). */
function edgeSpot(r: HeirRing, k: number): { x: number; y: number } | undefined {
	const { x, y, room } = r.spec.edge;
	// Where the Compact name starts nearer than half the ring, the ring moves left until it leaves the first letter free.
	const at = x - Math.max(0, (r.w / 2 + RING_CLEAR / 2) * k - room);
	const rect = ringRect(at, y, r.w, k);
	return coversCard(rect, r.cards, r.spec.block) || touchesFold(rect, r.folds, k) ? undefined : { x: at, y };
}

/**
 * Puts each ring at its place for the level and the zoom: the group is scaled by 1/zoom, so the ring keeps its size on the screen (the scene itself is scaled by
 * the zoom). The Full level shows no ring, so nothing is written there. Like the sign boost of the Overview, this runs at a settle and at a fill, never in a pan frame.
 * `phone` is the device (`isPhoneDevice`), never the window width: on a phone with a sideways tree (a text card) the Compact ring stands on the left edge of its
 * card, unless another card or a fold button stands within its reach (then it keeps the corner of the word tab).
 */
export function placeRings(rings: readonly HeirRing[], lod: string | null, scale: number, phone = false): void {
	if ((lod !== 'compact' && lod !== 'overview') || !(scale > 0)) return;
	const stamp = `${lod}|${scale}|${phone ? 'phone' : 'other'}`;
	if (rings.every((r) => r.stamp === stamp)) return;
	const k = Number((1 / scale).toPrecision(9));
	// The Overview ring is not shown on a phone, so nothing is lifted there.
	const levels = lod === 'overview' && !phone ? ringLevels(rings, scale) : null;
	rings[0].stems.setAttribute('d', levels ? stemPath(rings, levels, k) : '');
	rings.forEach((r, i) => {
		if (r.stamp === stamp) return;
		r.stamp = stamp;
		const level = levels?.[i] ?? 0;
		let spot: { x: number; y: number } | undefined;
		if (lod === 'overview') spot = { x: r.spec.top.x, y: r.spec.top.y - level * RING_LIFT * k };
		else if (phone && r.spec.tab.left) spot = edgeSpot(r, k);
		if (!spot) {
			const half = (r.w / 2) * k;
			spot = { x: r.spec.tab.left ? r.spec.tab.x + half : r.spec.tab.x - half, y: r.spec.tab.y - (RING_PX.h / 2) * k };
		}
		r.el.setAttribute('transform', `translate(${round(spot.x)} ${round(spot.y)}) scale(${k})`);
	});
}
