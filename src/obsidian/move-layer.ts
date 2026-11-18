/*
 * The size above which a drawn tree keeps no standing compositor layer (D285). In the full-screen view on a touch device the canvas keeps
 * `will-change: transform` for the whole life of the view (styles/01-base.css), which made a pinch cheap on a tree of 400 people. On a tree of
 * thousands of people the browser's layer builder then took most of every frame (Blink, the harness phone profile: a pan move of the 2 978-person
 * tree took 5.7 to 17 s with the layer and 0.2 to 0.6 s without). The tree view sets the class below on the canvas of such a tree; the style sheet
 * takes the layer away, also for the pinch.
 */

import { mediaMatches } from '../render/dom/page-reads';
import type { MarginRule } from '../render/dom/pan-zoom';

/** The class that the canvas of a big tree carries. The style sheet reads it; no style is written from code. */
export const BIG_TREE_CLASS = 'dynasty-big-tree';

/**
 * The most people (cards in the layout) of a tree that keeps the standing layer. The count is the people the layout draws, so a folded tree or a focus
 * family counts what it shows. Measured on the phone profile (CPU 4x, one pan move, median, the layer against none; pinch-in in the same order):
 * 389 people 66 against 67 ms; 500 people 200 to 230 against 70 ms; 800 people 450 to 500 against 85 to 100 ms; 1 000 people 560 against 100 ms;
 * 1 500 people 130 ms at the first zoom and 6.7 s at 1.4 times that; 2 500 people up to 10 s; the 2 978-person tree 14 to 26 s against 150 ms. The cost of the
 * layer grows faster than the size and with the zoom, and it is not steady (a tree of 2 900 people was fine at one zoom and took 11 s at another). Without the
 * layer, a pan move stayed under 0.25 s in every case measured. The layer made a pinch cheaper (about 65 ms against 100 to 300 ms a move for 500 to 1 500 people) when
 * the layer itself was cheap, so small trees keep it.
 */
export const STANDING_LAYER_MAX_PEOPLE = 500;

/** Does a tree of `people` cards keep the standing layer of the canvas? */
export function keepsStandingLayer(people: number): boolean {
	return people <= STANDING_LAYER_MAX_PEOPLE;
}

/** The attribute on the page root that only the harness and the speed tools set: `on` or `off` decides the path of a one-finger drag, whatever the tree size and the engine. */
export const PAN_WRAPPER_ATTR = 'data-dynasty-pan-wrapper';

/**
 * D367: the attribute on the page root that only the harness and the study build set: `0.5`, `1` or `3` (screens on each side) or `range` overrides the margin
 * rule of the drawn picture on the wrapped drag path (the release rule `DRAG_MARGIN`, `range` since the fourth drag test). A new value takes effect at the next draw
 * of the tree (the study build draws at rest).
 */
export const DRAG_MARGIN_ATTR = 'data-dynasty-drag-margin';

/** The study switch of the margin rule, read from the page root; null when it is absent or has another value. */
export function dragMarginOverride(doc: Document): MarginRule | null {
	const v = doc.documentElement?.getAttribute(DRAG_MARGIN_ATTR);
	if (v === 'range') return 'range';
	const n = v === '0.5' || v === '1' || v === '3' ? Number(v) : NaN;
	return Number.isFinite(n) ? n : null;
}

/**
 * D365 (1): does a one-finger drag move the HTML wrapper, and write the scene <g> only when the drag ends or empty space shows? True only on iOS (WebKit lays out all
 * SVG text again for each write of the <g> transform, about 120 ms for 1,000 people on the iPhone; Blink pays nothing, and a compositor layer on a big tree made
 * a Blink pan move cost seconds, D285) and only above `STANDING_LAYER_MAX_PEOPLE` cards: a tree of 500 or fewer keeps today's path. `override` is the harness switch.
 */
export function dragMovesWrapper(people: number, ios: boolean, override: 'on' | 'off' | null = null): boolean {
	if (override) return override === 'on';
	return ios && !keepsStandingLayer(people);
}

/**
 * True in the WebKit of iOS and iPadOS (the iPhone engine), found by a feature and not by `Platform` (spec §7): `-webkit-touch-callout` is known only there, and the
 * pointer is coarse.
 */
export function isIosWebKit(win: Window): boolean {
	if (!mediaMatches(win, '(pointer: coarse)')) return false;
	try {
		const css = (win as Window & { CSS?: { supports(p: string, v: string): boolean } }).CSS;
		return !!css?.supports('-webkit-touch-callout', 'none');
	} catch {
		return false;
	}
}

/** The harness switch of `dragMovesWrapper`, read from the page root at the start of a drag. */
export function panWrapperOverride(doc: Document): 'on' | 'off' | null {
	const v = doc.documentElement?.getAttribute(PAN_WRAPPER_ATTR);
	return v === 'on' || v === 'off' ? v : null;
}
