/*
 * Draws the fold controls of one tree into the scene (spec §13.10): the round
 * "−" button of an open family and the "+ N" sign of a folded one. `scene.ts` calls `drawFold` once for
 * each control of `TreeLayout.folds`. Colours and sizes of text come only from `dynasty-fold-*` classes
 * (the CSS block is added with the tree view); this file writes geometry and text. The tree view wires the
 * clicks and keys, and sizes the tap area at each settle and change of level (`foldHit` in `view-math.ts`).
 *
 * Look and hit area (F6, F7):
 * - Button: a circle 1.2 em across with a minus. Sign: a pill 1.25 em high and (text width + 0.9 em)
 *   wide, "+ N" at 0.8 em, weight 600, anchored on the left at the spot. Full and Compact draw the
 *   same size in em. Overview draws the larger sign (`FOLD_EM.signHeightOverview`) in its own group,
 *   chosen by the level class. The "+ N" sign works at every level; the button shows in Full and
 *   Compact only, and a hidden control is not in the Tab order.
 * - Hit area: a square of at least `FOLD_HIT_PX` screen px, centred on the mark, in the hit layer below
 *   the cards, so a card wins where they meet. The tree view cuts it back where it meets the hit area
 *   of a tag, a `+` badge or a D14 sign; those win over a fold.
 * - Both controls have `role="button"`, `tabindex="0"`, an accessible name, and an SVG `<title>` for
 *   the mouse-pointer tooltip (Obsidian's `aria-label` tooltip does not work on SVG elements).
 */

import { FOLD_EM, FOLD_HIT_PX } from '../../layout/fold-spots';
import type { PlacedFoldControl, Rect } from '../../layout/model';
import { foldHit } from '../view-math';
import type { Measure, SceneFonts } from './scene';

/** The control sizes in em and the smallest hit area in px, re-exported from the layout, which needs the same numbers to place a control. */
export { FOLD_EM, FOLD_HIT_PX };

/** One drawn control in the scene. */
export interface FoldRef {
	control: PlacedFoldControl;
	/** The visible group, class `dynasty-fold` with `is-open` or `is-folded`; it is the control for keyboard and screen reader. */
	el: SVGGElement;
	/** The invisible tap area, class `dynasty-fold-hit`, in the hit layer below the cards; absent until `fill` ran. */
	hit?: SVGRectElement;
	/** True when the control has its drawing and tap area. A folded sign is always filled; an open button is filled at once unless the scene is lazy. */
	filled: boolean;
	/** Makes the drawing and the tap area of a control that was drawn as an empty shell. Safe to call again. */
	fill(): void;
	/** The visible button or sign at Full and Compact, layout px. */
	mark: Rect;
	/** The larger sign at Overview (signs only), layout px. */
	markOverview?: Rect;
}

/** The text of a sign for `count` hidden people. */
export const signText = (count: number) => `+ ${count}`;

/** Where the text of a sign starts, from the spot: the same x at every level, so one text serves the Full and the Overview pill. */
const textStart = (spot: { x: number }, em: number) => spot.x - (FOLD_EM.signHeight / 2) * em + 0.45 * em;

/** What `drawFold` needs from the scene. */
export interface FoldDrawing {
	/** The layer of the visible controls (the cards' layer: a control follows the card of its later parent in the Tab order). */
	controls: SVGGElement;
	/** The layer of the tap areas (below the cards). */
	hits: SVGGElement;
	fonts: SceneFonts;
	measure: Measure;
	/** Layout px of one em. */
	em: number;
	/** The accessible name and tooltip. */
	label: string;
	/** The scene's list of texts to measure again when a web font has loaded. */
	fitters: (() => void)[];
	/** True: an open button is drawn as an empty shell and gets its drawing and tap area at `fill` (first view speed). Only the tree view sets it. */
	lazy?: boolean;
	/** Called once when a control gets its tap area (the tree view wires its listeners). */
	wire?: (ref: FoldRef) => void;
}

/**
 * Draws one control: an open one as a circle with a minus; a folded one as a pill with "+ N" (a Full
 * and Compact pill 1.25 em high, and a larger Overview pill 2 em high that share one text, which starts at the
 * same x; a class on the tree picks the pill and the text size). Both are left-anchored: the pill's left
 * half-circle is centred on the spot. The `<title>` child gives the mouse-pointer tooltip (F16).
 * A lazy open button is only the group with its Tab stop and name; its five elements cost layout time at the
 * first view, so `fill` adds them later.
 */
export function drawFold(d: FoldDrawing, control: PlacedFoldControl): FoldRef {
	const { spot } = control;
	const em = d.em;
	const key = control.key;
	const el = d.controls.createSvg('g', {
		cls: ['dynasty-fold', control.folded ? 'is-folded' : 'is-open'],
		attr: { tabindex: 0, role: 'button', 'aria-label': d.label, 'data-fold': key },
	});
	let mark: Rect;
	let markOverview: Rect | undefined;
	let inner: () => void;
	if (!control.folded) {
		const r = (FOLD_EM.button / 2) * em;
		mark = { x: spot.x - r, y: spot.y - r, w: 2 * r, h: 2 * r };
		inner = () => {
			el.createSvg('title').setText(d.label);
			el.createSvg('circle', { cls: 'dynasty-fold-button', attr: { cx: spot.x, cy: spot.y, r } });
			const arm = FOLD_EM.minusHalf * r;
			el.createSvg('path', { cls: 'dynasty-fold-minus', attr: { d: `M${spot.x - arm} ${spot.y}H${spot.x + arm}`, 'stroke-width': FOLD_EM.minusStroke * r } });
		};
	} else {
		const text = signText(control.count);
		const h1 = FOLD_EM.signHeight * em;
		const h2 = FOLD_EM.signHeightOverview * em;
		const m: Rect = { x: spot.x - h1 / 2, y: spot.y - h1 / 2, w: 0, h: h1 };
		const mo: Rect = { x: spot.x - h2 / 2, y: spot.y - h2 / 2, w: 0, h: h2 };
		mark = m;
		markOverview = mo;
		inner = () => {
			el.createSvg('title').setText(d.label);
			const pill = (cls: string, r: Rect) => el.createSvg('rect', { cls, attr: { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.h / 2 } });
			const full = pill('dynasty-fold-pill', m);
			const big = pill('dynasty-fold-pill-big', mo);
			const label = el.createSvg('text', { cls: 'dynasty-fold-text', attr: { x: textStart(spot, em), y: spot.y + 0.35 * FOLD_EM.signText * em } });
			label.setText(text);
			const run = () => {
				const small = `600 ${FOLD_EM.signText * em}px ${d.fonts.ui}`;
				const large = `600 ${FOLD_EM.signTextOverview * em}px ${d.fonts.ui}`;
				// The Full pill has 0.45 em at each side of the text. The Overview pill starts further left, so its
				// text has the extra room at the left and 0.45 em at the right.
				m.w = d.measure(text, small) + FOLD_EM.signPad * em;
				mo.w = d.measure(text, large) + (FOLD_EM.signPad + (FOLD_EM.signHeightOverview - FOLD_EM.signHeight) / 2) * em;
				full.setAttribute('width', String(m.w));
				big.setAttribute('width', String(mo.w));
			};
			run();
			d.fitters.push(run);
		};
	}
	const ref: FoldRef = { control, el, mark, ...(markOverview ? { markOverview } : {}), filled: false, fill: () => undefined };
	ref.fill = () => {
		if (ref.filled) return;
		ref.filled = true;
		inner();
		const box = foldHit(mark, 1);
		ref.hit = d.hits.createSvg('rect', { cls: 'dynasty-fold-hit', attr: { x: box.x, y: box.y, width: box.w, height: box.h, 'data-fold': key } });
		d.wire?.(ref);
	};
	// A sign stays eager: it is the only sign of a hidden family, and it is few.
	if (control.folded || !d.lazy) ref.fill();
	return ref;
}
