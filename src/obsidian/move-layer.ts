/*
 * The size above which a drawn tree keeps no standing compositor layer (D285). In the full-screen view on a touch device the canvas keeps
 * `will-change: transform` for the whole life of the view (styles/01-base.css), which made a pinch cheap on a tree of 400 people. On a tree of
 * thousands of people the browser's layer builder then took most of every frame (Blink, the harness phone profile: a pan move of the 2 978-person
 * tree took 5.7 to 17 s with the layer and 0.2 to 0.6 s without). The tree view sets the class below on the canvas of such a tree; the style sheet
 * takes the layer away, also for the pinch.
 */

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
