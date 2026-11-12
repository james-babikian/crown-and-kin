/*
 * Draws one pill of a far-couple tag into the live scene (spec §5.3, D10): the ring, the pill, the text and the partnership sign of one level of
 * detail. `scene.ts` calls `drawTagPill` three times for each tag (Full, Compact and the Overview sign pill) and runs the returned fit when the
 * tag's content is attached. A pill with a name places the ⚭ after the padding and the name at an exact x after the ⚭ and the sign, with the
 * saved picture's formula (`tagPillParts` in `render/styles.ts`), so both drawings keep the same gap before the name (D108). The name is a
 * `tspan` with the embedding a card name gets (`farTagSvgName`, D322).
 */
import { unionMarkClass } from '../legend';
import { TAG_MARK, UNION_MARKS, tagMarkSlot, tagNameRoom, tagPillParts, unionMark, type UnionShape } from '../styles';
import { farTagSvgName } from '../tree-info';

/** What one tag pill is drawn from. */
export interface TagPillSpec {
	/** The level class of the pill (`dynasty-tag-full`, `dynasty-tag-compact`, `dynasty-tag-sign`). */
	cls: string;
	/** The canvas font of the pill's text, and its size in px. */
	font: string;
	fontPx: number;
	/** The pill's height, its bottom (the card's bottom edge and the tag's foot) and its centre x. */
	h: number;
	bottom: number;
	x: number;
	/** The widest the pill may be (`FarTag.zoneW`). */
	zone: number;
	/** The lead text: "⚭ " before a name, or the whole text of a pill with no name. */
	lead: string;
	/** The name to fit after the lead; none for the Overview sign pill. */
	name?: string;
	/** The partnership sign of a far couple with no union dot. */
	shape?: UnionShape;
	measure: (text: string) => number;
	/** Cuts a text to a width (the card's cut, with the ellipsis). */
	fit: (text: string, maxW: number) => string;
}

/** Writes the x of a union mark's element from `unionMark`'s attributes. */
function placeMark(el: SVGElement, at: ReturnType<typeof unionMark>['attr']): void {
	if ('d' in at) el.setAttribute('d', at.d);
	else {
		el.setAttribute('cx', String(at.cx));
		el.setAttribute('cy', String(at.cy));
		el.setAttribute('r', String(at.r));
	}
}

/** Draws one tag pill into `holder` and returns its fit: it cuts the name to the room, sizes the pill and places the text and the sign. */
export function drawTagPill(holder: SVGGElement, s: TagPillSpec): () => void {
	const { h, bottom, x, zone, shape } = s;
	const pad = h / 2;
	const part = holder.createSvg('g', { cls: s.cls });
	const ring = part.createSvg('rect', { cls: 'dynasty-tag-ring', attr: { y: bottom - h, height: h, rx: h / 2 } });
	const rect = part.createSvg('rect', { cls: 'dynasty-tag-pill', attr: { y: bottom - h, height: h, rx: h / 2 } });
	const baseline = bottom - h / 2 + 0.35 * s.fontPx;
	const named = s.name !== undefined;
	const textEl = part.createSvg('text', { cls: 'dynasty-tag-text', attr: named ? { x, y: baseline } : { x, y: baseline, 'text-anchor': 'middle' } });
	textEl.setText(s.lead);
	const nameEl = named ? textEl.createSvg('tspan', { cls: 'dynasty-tag-name', attr: { x } }) : undefined;
	const markAt = (cx: number) => unionMark(shape!, cx, bottom - h / 2, UNION_MARKS[shape!].size * TAG_MARK.unit * s.fontPx);
	const markEl = shape ? part.createSvg(markAt(0).tag, { cls: ['dynasty-tag-mark', ...unionMarkClass(shape)], attr: markAt(0).attr }) : undefined;
	return () => {
		let w = Math.min(zone, s.measure(s.lead) + 2 * pad);
		let markX = 0;
		if (nameEl) {
			const sign = s.measure(s.lead);
			const slot = shape ? tagMarkSlot(shape, s.fontPx) : 0;
			const name = s.fit(s.name!, tagNameRoom(zone, pad, sign, slot));
			const parts = tagPillParts(x, zone, pad, sign, slot, s.measure(name));
			w = parts.w;
			markX = parts.markX;
			textEl.setAttribute('x', String(parts.signX));
			nameEl.setAttribute('x', String(parts.nameX));
			nameEl.setText(farTagSvgName(name));
		}
		for (const r of [ring, rect]) {
			r.setAttribute('x', String(x - w / 2));
			r.setAttribute('width', String(w));
		}
		if (markEl) placeMark(markEl, markAt(markX).attr);
	};
}
