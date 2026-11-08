// The ordinal marks of the heirs in the Show view of a line of succession: the word tab ("1st") of the Full level and the small numbered ring of the Compact
// and Overview levels (spec §13.21 rule 36, D334 Q3). The tab is drawn inside the card; the ring has its own layer above the cards, so it is never under a
// ribbon or a name. A ring is made once per heir; the level class decides if it shows, and `placeRings` moves it with the zoom.
import { ORDINAL_EM } from '../../layout/geometry';
import type { Rect } from '../../layout/model';
import { TAB_TEXT_BASE_EM } from '../scene-model';

/** The size of a ring on the screen, in px: a fixed height, and a width that follows the digits. The text size is `--dynasty-type-small` (12 px or more). */
export const RING_PX = { h: 17, perDigit: 8, pad: 9 } as const;

/** Where the ring of one heir stands, in scene units, at each level. */
export interface RingSpec {
	text: string;
	/** Compact: the bottom corner of the word tab (the right corner on a Roundel card, the left corner on a text card), where the ring's own corner stands. */
	tab: { x: number; y: number; left: boolean };
	/** Overview: the middle of the top edge of the block, where the ring's middle stands. */
	top: { x: number; y: number };
}

/** A drawn ring. */
export interface HeirRing {
	el: SVGGElement;
	spec: RingSpec;
	/** Ring width on the screen, px. */
	w: number;
	/** The level and zoom the transform was written for; nothing is written again for the same pair. */
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
export function drawOrdinalTab(full: SVGGElement, box: Rect, tab: Rect, ordinal: string, f: number, roundel: boolean, specs: RingSpec[]): void {
	// A card-colour base keeps the border and the line above the card from showing through.
	const el = full.createSvg('g', { cls: 'dynasty-ordinal-tab-group', attr: { 'aria-hidden': 'true' } });
	const rect = { x: box.x + tab.x, y: box.y + tab.y, width: tab.w, height: tab.h, rx: ORDINAL_EM.corner * f };
	el.createSvg('rect', { cls: 'dynasty-ordinal-tab-base', attr: rect });
	el.createSvg('rect', { cls: 'dynasty-ordinal-tab', attr: rect });
	el.createSvg('text', { cls: 'dynasty-ordinal-tab-text', attr: { x: box.x + tab.x + tab.w / 2, y: box.y + tab.y + tab.h / 2 + TAB_TEXT_BASE_EM * f } }).setText(ordinal);
	const text = ringNumber(ordinal);
	if (text !== undefined) specs.push({ text, tab: { x: roundel ? box.x + tab.x + tab.w : box.x + tab.x, y: box.y + tab.y + tab.h, left: !roundel }, top: { x: box.x + box.w / 2, y: box.y } });
}

/** Makes the layer of the rings above the cards and one ring for each spec. No layer is made without a spec, so a tree without a line is unchanged. */
export function buildRings(parent: SVGGElement, specs: readonly RingSpec[]): HeirRing[] {
	if (!specs.length) return [];
	const layer = parent.createSvg('g', { cls: 'dynasty-heir-numbers', attr: { 'aria-hidden': 'true' } });
	return specs.map((spec) => {
		const w = Math.max(RING_PX.h, spec.text.length * RING_PX.perDigit + RING_PX.pad);
		const el = layer.createSvg('g', { cls: 'dynasty-heir-number' });
		const rect = { x: -w / 2, y: -RING_PX.h / 2, width: w, height: RING_PX.h, rx: RING_PX.h / 2 };
		el.createSvg('rect', { cls: 'dynasty-heir-number-base', attr: rect });
		el.createSvg('rect', { cls: 'dynasty-heir-number-rim', attr: rect });
		el.createSvg('text', { cls: 'dynasty-heir-number-text', attr: { x: 0, y: 0, dy: '0.35em' } }).setText(spec.text);
		return { el, spec, w, stamp: '' };
	});
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Puts each ring at its place for the level and the zoom: the group is scaled by 1/zoom, so the ring keeps its size on the screen (the scene itself is scaled by
 * the zoom). The Full level shows no ring, so nothing is written there. Like the sign boost of the Overview, this runs at a settle and at a fill, never in a pan frame.
 */
export function placeRings(rings: readonly HeirRing[], lod: string | null, scale: number): void {
	if ((lod !== 'compact' && lod !== 'overview') || !(scale > 0)) return;
	const stamp = `${lod}|${scale}`;
	const k = Number((1 / scale).toPrecision(9));
	for (const r of rings) {
		if (r.stamp === stamp) continue;
		r.stamp = stamp;
		let x: number;
		let y: number;
		if (lod === 'overview') ({ x, y } = r.spec.top);
		else {
			const half = (r.w / 2) * k;
			x = r.spec.tab.left ? r.spec.tab.x + half : r.spec.tab.x - half;
			y = r.spec.tab.y - (RING_PX.h / 2) * k;
		}
		r.el.setAttribute('transform', `translate(${round(x)} ${round(y)}) scale(${k})`);
	}
}
