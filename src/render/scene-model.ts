/*
 * The headless part of the scene: the constants and the two types that both drawing paths share. `render/dom/scene.ts` and `render/dom/folds.ts`
 * build the SVG elements from them; `render/svg-string.ts` and `render/saved-picture.ts` build the same picture as text. They live here, with no
 * DOM and no Obsidian, so the string renderer never has to load the DOM scene module (the architecture notes §3: a lower layer never imports a higher one).
 */

import { FOLD_EM } from '../layout/fold-spots';

/** Text width in px for a CSS font shorthand. */
export type Measure = (text: string, font: string) => number;

/** The resolved font families and weight the scene measures and draws text with. */
export interface SceneFonts {
	/** Resolved `font-family` of the note text (card text). */
	text: string;
	/** Resolved `font-family` of the interface (tags). */
	ui: string;
	/** Resolved bold weight, for measuring names. */
	bold: string;
}

/** The word on the "You" tab, in em of the note font (B.3.4). */
export const TAB_TEXT_EM = 0.8;
/** The baseline of the text of a tab, in em below the middle of the tab (0.3 em). */
export const TAB_TEXT_BASE_EM = 0.3;
/** D219: the width of the frame of an empty portrait, in px (the style gives it the same number); the frame lies inside the picture's edge. */
export const FRAME_STROKE_PX = 1;
/** "?" of the rumoured-parent marker, in em. */
export const RUMOUR_FONT_EM = 0.7;

/** The side of the square chip of an open fold button, in em (0.95 em). */
export const FOLD_CHIP_EM = FOLD_EM.chip;

/** The text of a fold sign for `count` hidden people. */
export const signText = (count: number) => `+ ${count}`;
