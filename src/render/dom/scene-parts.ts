/*
 * The pure parts of the scene (see `scene.ts`): the size constants of the Compact name, the tags and the badge, the sign geometry,
 * the class of a part on the relation finder's line, the layer that keeps build order and the names of a fold's parents.
 * They hold no state and make no element of their own, so every layer file of the scene can import them without a cycle.
 */

import type { FamilyGraph } from '../../core/derive';
import type { CardText } from '../../layout/geometry';
import type { PlacedFoldControl, TreeLayout } from '../../layout/model';
import type { LineState } from '../line-highlight';
import type { NameRun } from '../name-lines';
import { COMPACT_NAME_EM } from '../scene-model';

/** D203: at the Compact level a long name shrinks down to this size, in em, before it is cut. */
export const COMPACT_NAME_MIN_EM = 1.05;
/** The sizes a Compact name can have, in em, largest first. The steps are made by repeated subtraction, so the font strings (and the measure cache keys) stay as they were. */
export const COMPACT_STEPS: readonly number[] = (() => {
	const steps = [COMPACT_NAME_EM];
	for (let em = COMPACT_NAME_EM; em > COMPACT_NAME_MIN_EM + 1e-9; ) steps.push((em = Math.max(COMPACT_NAME_MIN_EM, em - 0.05)));
	return steps;
})();

/**
 * The index in `COMPACT_STEPS` of the size of a Compact name: the first size whose width `widthAt(k)` fits in `maxW`, else the smallest. This is the result of a walk down from
 * the top size, but a canvas measure is the cost, and the width follows the size almost linearly, so the room gives a first guess that one or two measures confirm.
 */
export function compactNameStep(widthAt: (k: number) => number, maxW: number): number {
	const w0 = widthAt(0);
	if (!(w0 > maxW)) return 0;
	const last = COMPACT_STEPS.length - 1;
	const want = (COMPACT_NAME_EM * maxW) / w0;
	let k = 1;
	while (k < last && COMPACT_STEPS[k] > want + 1e-9) k++;
	// `misfit` is the largest step that is known not to fit.
	let misfit = 0;
	while (k < last && widthAt(k) > maxW) misfit = k++;
	while (k - 1 > misfit && widthAt(k - 1) <= maxW) k--;
	return k;
}

/** D345 1 A: tag text at the Compact level is two thirds of the Compact name, so the name stays the first thing on the card and more of a name fits. */
export const TAG_COMPACT_FONT_EM = COMPACT_NAME_EM / 1.5;
/** The sign pill of the Overview shows two signs and no name, so it keeps its size: as large as the Compact name. */
export const TAG_SIGN_FONT_EM = COMPACT_NAME_EM;
/** Radius of the focus-mode `+` badge, in em. Its centre lies on the arc of the card's rounded top right corner, the middle of that arc. */
export const BADGE_RADIUS_EM = 0.55;
// All font sizes are set in styles.css from --dynasty-font-size (spec §5.8: nothing that styles
// text is written into SVG attributes); these constants are what the measurement assumes.

/**
 * The path of the badge's tap disc: the circle of radius `r` around (`cx`, `cy`), with nothing above the line `top` (the
 * strip that a tag tap area covers). The tree view sets it again at each settled zoom (`badgeTap`).
 */
export function discPath(cx: number, cy: number, r: number, top: number): string {
	const n = (v: number) => String(Math.round(v * 100) / 100);
	const cut = cy - top;
	if (!(r > 0)) return '';
	if (cut >= r) return `M${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}Z`;
	// A chord at `top`: the big arc runs round the bottom.
	const dx = Math.sqrt(Math.max(0, r * r - cut * cut));
	return `M${n(cx - dx)} ${n(top)}A${n(r)} ${n(r)} 0 ${cut > 0 ? 1 : 0} 0 ${n(cx + dx)} ${n(top)}Z`;
}

/**
 * The "illegitimate" sign (spec D14) for the Compact name, `scale` times the note font: the Full sign
 * from `cardText`, scaled about its top right end, then moved so it is centred on the capitals of
 * a name whose baseline is at `baseline`. Coordinates are from the card's top left corner.
 */
export function signAt(t: CardText, scale: number, baseline: number, rightX: number): CardText['sign'] {
	const s = t.sign;
	const size = (s.x1 - s.x2) * scale;
	// The sign is 1.125 em of the note font; the Compact name is `scale` times the note font (not the Full name size, 0.85 em).
	const top = baseline - 0.35 * ((s.x1 - s.x2) / 1.125) * scale - size / 2;
	return { x1: rightX, y1: top, x2: rightX - size, y2: top + size, width: s.width * scale, dash: [s.dash[0] * scale, s.dash[1] * scale] };
}

/** The class of a part on the relation finder's line, or of a part faded beside it (D47). */
export const stateCls = (s: LineState): string[] => (s === 'on' ? ['dynasty-on-line'] : s === 'faded' ? ['dynasty-faded'] : []);

/** The font the relation text is measured with: 0.85 em italic, "You" bold italic (styles.css, D117); `bold` is the bold weight of the page. */
export const relationFont = (size: number, family: string, you: boolean, bold = '700') => (you ? `italic ${bold} ${size}px ${family}` : `italic 400 ${size}px ${family}`);

/** D122: sets the pieces of a name text line: the name as text, the sobriquet in a regular `tspan`. */
export function setRuns(el: SVGTextElement, runs: readonly NameRun[]): void {
	el.empty();
	for (const r of runs) {
		if (r.sob) el.createSvg('tspan', { cls: 'dynasty-card-sob' }).setText(r.text);
		else el.appendText(r.text);
	}
}

/**
 * A layer whose members are made one by one in any order and still stand in their build order, so a layer that is
 * filled late serialises like one that was built at once. `reserve` takes the next place; `put` puts an element there.
 */
export function orderedLayer(parent: SVGElement): { reserve: () => number; put: (slot: number, el: SVGElement) => SVGElement } {
	const els: (SVGElement | undefined)[] = [];
	// The slots that have an element, in order: the first one after a new slot is the element to insert before.
	const done: number[] = [];
	return {
		reserve: () => els.push(undefined) - 1,
		put(slot, el) {
			let lo = 0;
			let hi = done.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (done[mid] < slot) lo = mid + 1;
				else hi = mid;
			}
			parent.insertBefore(el, lo < done.length ? els[done[lo]]! : null);
			done.splice(lo, 0, slot);
			els[slot] = el;
			return el;
		},
	};
}

/**
 * The names of the parents of a fold control. The parents of a group are named from left to right (from top to bottom sideways), so the order of the
 * child's list never shows in the label.
 */
export function parentNames(c: PlacedFoldControl, layout: TreeLayout, g: FamilyGraph): string[] {
	const along = (id: string) => {
		const b = layout.persons.get(id);
		return b ? (layout.orientation === 'sideways' ? b.y : b.x) : Infinity;
	};
	const ordered = c.union === undefined && c.parents.length > 2 ? [...c.parents].sort((a, b) => along(a) - along(b) || (a < b ? -1 : a > b ? 1 : 0)) : c.parents;
	return ordered.map((id) => g.byId.get(id)?.name ?? id);
}
