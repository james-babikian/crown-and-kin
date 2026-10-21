/*
 * The pure parts of the Show view of a line of succession (contract 0.2.7 F, M.9): what the tree draws for a title (the ruler,
 * the heirs, the open branches, the ordinal texts, the bar sentence), the first view, and the words of the phone list. No DOM
 * and no state, so the tests run it on plain data. `tree-view.ts` keeps the state (`BlockState.succession`)
 * and calls these functions at each render.
 */

import type { FamilyGraph } from '../core/derive';
import { successionLine, specOf, type SuccessionResult } from '../core/succession';
import { ordinal } from '../core/succession-keys';
import type { Title } from '../core/types';
import type { Orientation, Rect } from '../layout/model';
import type { ListWord } from '../render/dom/phone-list-dom';
import { SUCCESSION_UI } from '../render/ui-text';
import { FIT_MIN_NAME_PX, READABLE_NAME_PX, START_TOP_GAP, fitScale, fitView, type Size, type View } from '../render/view-math';
import { finderFirstView, fittedNamePx } from './focus-mode';

/** The mark on the tab of an open branch (M.9). */
export const BRANCH_MARK = '?';
/** On a phone the first view never shows the names smaller than this scale (prototype finding 2: a plain fit gave names of about 8 px). */
export const PHONE_MIN_SCALE = 0.75;

/** What the Show view draws for one title. */
export interface SuccessionDrawn {
	/** The title id. */
	titleId: string;
	result: SuccessionResult;
	/** R, the ruler the line is after. */
	ruler: string;
	/** The heirs in line order: they get the outline and an ordinal tab. */
	heirs: string[];
	/** The open branches in line order: they get the "?" tab and no outline. */
	branches: string[];
	/** The text of each tab: "1st" … for an heir, "?" for a branch. */
	ordinals: Map<string, string>;
	/** The bar: "Line of succession: TITLE, YEAR", with "No heir in the tree." when nobody is in the line. */
	sentence: string;
}

/** The settings the line reads (K.10, M.7). */
export interface LineSettings {
	limit: number;
	oldAge: number;
	youngDeathAge: number;
}

/**
 * The Show view for title `titleId`, computed again from the whole tree `whole` at each render (F.7). Null when the title is gone or its
 * saved line is not `kind: 'line'` (no rule, no ruler, a rule with an error): the caller then ends the view (F.1).
 */
export function successionDrawn(whole: FamilyGraph, titleId: string, s: LineSettings): SuccessionDrawn | null {
	const title: Title | undefined = whole.titles.find((t) => t.id === titleId);
	if (!title) return null;
	const result = successionLine(whole, title, specOf(title), s.limit, s.oldAge, s.youngDeathAge);
	if (result.kind !== 'line' || result.ruler === undefined || !whole.byId.has(result.ruler)) return null;
	const heirs = result.heirs.filter((id) => whole.byId.has(id));
	const branches = result.openBranches.map((b) => b.id).filter((id) => whole.byId.has(id) && !heirs.includes(id));
	const ordinals = new Map<string, string>();
	heirs.forEach((id, i) => ordinals.set(id, ordinal(i + 1)));
	for (const id of branches) ordinals.set(id, BRANCH_MARK);
	const name = title.name || title.id;
	const sentence = heirs.length ? SUCCESSION_UI.bar(name, result.yearText) : SUCCESSION_UI.barNoHeir(name, result.yearText);
	return { titleId, result, ruler: result.ruler, heirs, branches, ordinals, sentence };
}

/** The people the view must show: R, the heirs and the branches (F.2, M.9). They open the folds that hide them. */
export const linePeople = (d: SuccessionDrawn): string[] => [d.ruler, ...d.heirs, ...d.branches];

/** What a card's screen-reader label adds while the view is open: ", 2nd in line" or ", open branch" (F.4). Undefined for any other card. */
export function cardPosition(d: SuccessionDrawn | null, id: string): string | undefined {
	if (!d) return undefined;
	const mark = d.ordinals.get(id);
	if (mark === undefined) return undefined;
	return mark === BRANCH_MARK ? SUCCESSION_UI.openBranchCard : SUCCESSION_UI.inLine(mark);
}

/** The relation words of the phone list while the view is open (F.6): "2nd in line" for an heir, "Open branch" for a branch. */
export function lineWords(d: SuccessionDrawn): Map<string, ListWord> {
	const out = new Map<string, ListWord>();
	for (const [id, mark] of d.ordinals) {
		const text = mark === BRANCH_MARK ? SUCCESSION_UI.openBranchWord : SUCCESSION_UI.inLine(mark);
		// D209 item 8: the place in the line is bold in the text colour.
		out.set(id, { text, lower: text.toLowerCase(), strong: true });
	}
	return out;
}

/**
 * The first view of the Show view (F.2): the ruler and the heirs fitted into the free area below `insetTop` (the bar), as
 * `finderFirstView` does it. `bounds` is the box around the ruler and the heirs; the open branches are not in it, so a far branch
 * cannot shrink the view. When the whole line would need names under 11 px, the view fits the ruler and the longest run of heirs
 * (1st, 2nd, ...) that fits with names of 11 px or more. Only when the ruler and the 1st heir do not fit together, the view starts at the
 * ruler at the readable zoom, whole and on screen (G5 fix; spec §13.21 rule 35). On a phone (`minScale` > 0) no fit goes below `minScale`.
 */
export function successionFirstView(bounds: Rect, size: Size, fontPx: number, insetTop: number, ruler: Rect, heirs: readonly Rect[], orientation: Orientation, minScale = 0): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const area = { w: size.w, h: size.h - top };
	const f = fontPx > 0 ? fontPx : 16;
	const fits = (box: Rect) => area.w > 0 && fittedNamePx(box, area, f) >= FIT_MIN_NAME_PX && !(fitScale(box, area) < minScale);
	if (heirs.length > 0 && area.w > 0 && !fits(bounds)) {
		// The caller's box has a margin round the cards; a shorter run gets the same margin.
		const all = union([ruler, ...heirs]);
		const mx = Math.max(0, all.x - bounds.x);
		const my = Math.max(0, all.y - bounds.y);
		for (let k = heirs.length - 1; k >= 1; k--) {
			const run = union([ruler, ...heirs.slice(0, k)]);
			const box = { x: run.x - mx, y: run.y - my, w: run.w + 2 * mx, h: run.h + 2 * my };
			if (fits(box)) return fitView(box, size, insetTop);
		}
		// The ruler and the 1st heir do not fit together at readable names: the view starts at the ruler (spec §13.21 rule 35), leaned
		// towards the 1st heir as far as the ruler stays whole. The user pans to the heirs.
		const pair = union([ruler, heirs[0]]);
		const aim = { x: pair.x - mx, y: pair.y - my, w: pair.w + 2 * mx, h: pair.h + 2 * my };
		return startAt(aim, size, insetTop, ruler, orientation, Math.max(minScale, READABLE_NAME_PX / f));
	}
	// A line with no heir: the ruler stays first. `finderFirstView` centres on the first card when the cards do not fit side by side.
	const fit = finderFirstView(bounds, size, fontPx, insetTop, [ruler, ...heirs], orientation);
	if (!(minScale > 0) || fit.scale >= minScale || !(size.w > 0)) return fit;
	return startAt(bounds, size, insetTop, ruler, orientation, minScale);
}

/** The smallest box round `boxes`. */
function union(boxes: readonly Rect[]): Rect {
	const x0 = Math.min(...boxes.map((b) => b.x));
	const y0 = Math.min(...boxes.map((b) => b.y));
	const x1 = Math.max(...boxes.map((b) => b.x + b.w));
	const y1 = Math.max(...boxes.map((b) => b.y + b.h));
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A view at `scale` that puts the ruler at the start of the free area and keeps as much of the tree as the area holds (as `finderFirstView`). */
function startAt(bounds: Rect, size: Size, insetTop: number, ruler: Rect, orientation: Orientation, scale: number): View {
	const top = Math.max(0, Math.min(insetTop, size.h - 1));
	const halfW = size.w / 2 / scale;
	const halfH = (size.h - top) / 2 / scale;
	const pad = START_TOP_GAP;
	const along = (lo: number, hi: number, centre: number, bLo: number, bLen: number, half: number) => {
		if (hi - lo + 2 * pad > 2 * half) return centre;
		return Math.min(lo - pad + half, Math.max(hi + pad - half, bLo + bLen / 2));
	};
	let cx: number;
	let cy: number;
	if (orientation === 'sideways') {
		cx = ruler.x - pad + halfW;
		cy = along(ruler.y, ruler.y + ruler.h, ruler.y + ruler.h / 2, bounds.y, bounds.h, halfH);
	} else {
		cy = ruler.y - pad + halfH;
		cx = along(ruler.x, ruler.x + ruler.w, ruler.x + ruler.w / 2, bounds.x, bounds.w, halfW);
	}
	return { scale, cx, cy: cy - top / 2 / scale };
}

