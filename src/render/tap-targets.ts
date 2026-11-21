/*
 * The one list of the places in the tree that take a press of their own (D375 (1)). The style sheet gives them back their touch under the
 * scene's `pointer-events: none`, and the pan code reads the same list, so a tap on one of them is never a tap on the empty background.
 * A test checks `styles/01-base.css` against this list and scans `src/` and `styles/` for a new tap place.
 */

/** The shapes inside the scene that a person can tap or press. */
export const SCENE_TAP_TARGETS: readonly string[] = [
	'.dynasty-card-bg',
	'.dynasty-card-crown-hit',
	'.dynasty-tag-hit',
	'.dynasty-tag-over',
	'.dynasty-fold-hit',
	'.dynasty-focus-badge-hit',
	'.dynasty-name-link',
];

/** The groups whose every part takes the press (the pill, the disc, the text of a tag, a fold button and a badge). */
export const SCENE_TAP_GROUPS: readonly string[] = ['.dynasty-tag', '.dynasty-fold', '.dynasty-focus-badge'];

/** The class of the transparent rectangle that takes each press on the empty background. */
export const HIT_CLASS = 'dynasty-hit';

/** The reach of the hit rectangle around the origin, in px. The iPhone study measured this size. */
export const HIT_REACH = 100000;
