/*
 * Draws the fold controls of one tree into the scene (spec §13.10): the round
 * "−" button of an open family and the "+ N" sign of a folded one. `scene.ts` calls `drawFold` once for
 * each control of `TreeLayout.folds`. Colours and sizes of text come only from `dynasty-fold-*` classes
 * (the CSS block is added with the tree view); this file writes geometry and text. The tree view wires the
 * clicks and keys, and sizes the tap area at each settle and change of level (`foldHit` in `view-math.ts`).
 *
 * Look and hit area (F6, F7; 0.2.8 C01, G.13):
 * - Button: a small square chip `FOLD_CHIP_EM` (0.95 em) across, with rounded corners and a minus; the layout still reserves the 1.2 em circle.
 *   Sign: a chip 1.25 em high and (text width + 0.9 em) wide with 0.25 em corners, "+ N" at 0.8 em, weight 600, centred on the spot (D206). Full and Compact draw the
 *   same size in em. Overview draws the larger sign (`FOLD_EM.signHeightOverview`) in its own group,
 *   chosen by the level class. The "+ N" sign works at every level; the button shows in Full and
 *   Compact only, and a hidden control is not in the Tab order.
 * - Sideways sign (D207): the sign starts where the open chip starts (`FOLD_CHIP_EM` / 2 before the spot) and grows to the right; the line meets the middle of its left end.
 *   The Overview sign starts 0.625 em before the spot and has 0.45 em at each side of its text, so the text moves 0.15 em left at that level (a class rule in `26-folds.css`).
 * - Hit area: a square of at least `FOLD_HIT_PX` screen px and 3 em, centred on the mark, in the hit layer below
 *   the cards, so a card wins where they meet. The tree view cuts it back where it meets the hit area
 *   of a tag, a `+` badge or a D14 sign; those win over a fold.
 * - Both controls have `role="button"`, `tabindex="0"`, an accessible name, and an SVG `<title>` for
 *   the mouse-pointer tooltip (Obsidian's `aria-label` tooltip does not work on SVG elements).
 */

import { FOLD_EM } from '../../layout/fold-spots';
import type { PlacedFoldControl, Rect } from '../../layout/model';
import { foldHit } from '../view-math';
import { FOLD_CHIP_EM, signText, type Measure, type SceneFonts } from '../scene-model';

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

/** The corner radius of the chip and of the sign, in em. */
const FOLD_CORNER_EM = { chip: 0.15, sign: 0.25 } as const;

/** Where the text of a sign of a sideways layout starts at Full and Compact: 0.45 em inside the pill, which starts where the open chip starts. */
const textStart = (spot: { x: number }, em: number) => spot.x - (FOLD_CHIP_EM / 2) * em + 0.45 * em;

/** What `drawFold` needs from the scene. */
export interface FoldDrawing {
	/** The layer of the visible controls (the cards' layer: a control follows the card of its later parent in the Tab order). */
	controls: SVGGElement;
	/** The layer of the tap areas (below the cards). */
	hits: SVGGElement;
	/** A group inside the tap-area layer for the open buttons: the Overview level hides it as one element (R026 fit). Without it, an open button's tap area goes into `hits`. */
	openHits?: SVGGElement;
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
	/** True in a sideways layout: the line runs along the sign, so the sign starts at the spot. Absent: the sign is centred on the spot, on the line (D206). */
	anchored?: boolean;
	/** Called once when a control gets its tap area (the tree view wires its listeners). */
	wire?: (ref: FoldRef) => void;
}

/**
 * Draws one control: an open one as a circle with a minus; a folded one as a pill with "+ N" (a Full
 * and Compact pill 1.25 em high, and a larger Overview pill 2 em high that share one text, which sits at the
 * same x; a class on the tree picks the pill and the text size). The pill is centred on the spot, on the line (D206); in a sideways
 * layout (`anchored`) the line runs along the sign, so the pill's left half-circle is centred on the spot. The `<title>` child gives the mouse-pointer tooltip (F16).
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
		const side = FOLD_CHIP_EM * em;
		mark = { x: spot.x - side / 2, y: spot.y - side / 2, w: side, h: side };
		inner = () => {
			el.createSvg('title').setText(d.label);
			el.createSvg('rect', { cls: 'dynasty-fold-button', attr: { x: spot.x - side / 2, y: spot.y - side / 2, width: side, height: side, rx: FOLD_CORNER_EM.chip * em } });
			const arm = 0.28 * em;
			el.createSvg('path', { cls: 'dynasty-fold-minus', attr: { d: `M${spot.x - arm} ${spot.y}H${spot.x + arm}`, 'stroke-width': 0.11 * em } });
		};
	} else {
		const text = signText(control.count);
		const h1 = FOLD_EM.signHeight * em;
		const h2 = FOLD_EM.signHeightOverview * em;
		const anchored = !!d.anchored;
		// A centred pill gets its x once its width is known; a sideways one starts at a fixed x (D207).
		const m: Rect = { x: anchored ? spot.x - (FOLD_CHIP_EM / 2) * em : spot.x, y: spot.y - h1 / 2, w: 0, h: h1 };
		const mo: Rect = { x: anchored ? spot.x - (FOLD_EM.signHeight / 2) * em : spot.x, y: spot.y - h2 / 2, w: 0, h: h2 };
		mark = m;
		markOverview = mo;
		inner = () => {
			el.createSvg('title').setText(d.label);
			const pill = (cls: string, r: Rect) => el.createSvg('rect', { cls, attr: { x: r.x, y: r.y, width: r.w, height: r.h, rx: FOLD_CORNER_EM.sign * em } });
			const full = pill('dynasty-fold-pill', m);
			const big = pill('dynasty-fold-pill-big', mo);
			const label = el.createSvg('text', { cls: anchored ? ['dynasty-fold-text', 'is-sideways'] : 'dynasty-fold-text', attr: { x: anchored ? textStart(spot, em) : spot.x, y: spot.y + 0.35 * FOLD_EM.signText * em } });
			if (!anchored) label.setAttribute('text-anchor', 'middle');
			label.setText(text);
			const run = () => {
				const small = `600 ${FOLD_EM.signText * em}px ${d.fonts.ui}`;
				const large = `600 ${FOLD_EM.signTextOverview * em}px ${d.fonts.ui}`;
				// The Full pill has 0.45 em at each side of the text. A centred Overview pill has the extra room of its larger height besides; a sideways one (D207) has 0.45 em at each side too.
				m.w = d.measure(text, small) + FOLD_EM.signPad * em;
				mo.w = d.measure(text, large) + (FOLD_EM.signPad + (anchored ? 0 : (FOLD_EM.signHeightOverview - FOLD_EM.signHeight) / 2)) * em;
				if (!anchored) {
					m.x = spot.x - m.w / 2;
					mo.x = spot.x - mo.w / 2;
					full.setAttribute('x', String(m.x));
					big.setAttribute('x', String(mo.x));
				}
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
		const box = foldHit(mark, 1, em);
		ref.hit = (control.folded ? d.hits : (d.openHits ?? d.hits)).createSvg('rect', { cls: 'dynasty-fold-hit', attr: { x: box.x, y: box.y, width: box.w, height: box.h, 'data-fold': key } });
		d.wire?.(ref);
	};
	// A sign stays eager: it is the only sign of a hidden family, and it is few.
	if (control.folded || !d.lazy) ref.fill();
	return ref;
}
