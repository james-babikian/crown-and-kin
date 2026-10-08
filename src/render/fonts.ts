/**
 * Compares the note's fonts (spec §5.8) so `tree-view.ts` can tell whether a font change needs a
 * new layout and measurement. When fonts did not change, the tree view does not redraw: it
 * rechecks tall cards and reads the theme; CSS does the rest. `FontState` is a plain snapshot that
 * the tree view builds from the page and keeps to diff the next one against.
 */
import { geometryFor } from '../layout/geometry';

/**
 * The fonts a tree is drawn with, as read from the page (spec §5.8). `px` is the resolved note
 * font size exactly as read; the layout clamps it (`geometryFor`), so comparisons go through
 * `fontsChanged`, never through a clamped copy.
 */
export interface FontState {
	px: number;
	text: string;
	ui: string;
	bold: string;
}

/** A computed CSS length in px ("17.6px"), or null for anything else. */
export function parsePx(value: string): number | null {
	const m = /^\s*(\d+(?:\.\d+)?|\.\d+)px\s*$/.exec(value);
	if (!m) return null;
	const n = Number(m[1]);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Whether the tree must be laid out and measured again. Only what changes the layout or the
 * text measurement counts: the font size as the layout uses it, the two font families and the
 * bold weight. Anything else (a theme or colour change) is left to CSS.
 */
export function fontsChanged(a: FontState, b: FontState): boolean {
	return geometryFor(a.px).fontPx !== geometryFor(b.px).fontPx || a.text !== b.text || a.ui !== b.ui || a.bold !== b.bold;
}

/** Family names in a CSS font-family list, without quotes, in lower case. */
export function familyNames(list: string): string[] {
	return list
		.split(',')
		.map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
		.filter((f) => f !== '');
}

/** True if a font that just loaded is one of the families the tree measures with. */
export function usesFamily(state: FontState, loaded: string[]): boolean {
	const mine = new Set([...familyNames(state.text), ...familyNames(state.ui)]);
	return loaded.some((f) => familyNames(f).some((n) => mine.has(n)));
}
