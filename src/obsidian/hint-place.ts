/*
 * Where the D28 first-view hint ("↓ 9 more children") may stand. The label sits in a corner of the tree box at the right; with a theme's
 * fonts it can be wider or the first view can put a card there, and then the label covered the card. The tree view measures the label as it is
 * drawn and asks here for a side that covers no card: the right as before, else the left, else none (the view then shows no hint, and the slot keeps
 * the text in `data-dynasty-hint-dropped` for the harness).
 */

import type { Rect } from '../layout/model';
import type { Size, View } from '../render/view-math';

/**
 * The side where a hint of the screen box `hint` (at the right edge; px from the top left of the tree box) covers none of `cards` (tree units) at `view`.
 * The left place is the mirror of the right one, with the same gap to the edge. Null: both places cover a card.
 */
export function hintSide(cards: Iterable<Rect>, view: View, size: Size, hint: Rect): 'right' | 'left' | null {
	if (!(view.scale > 0)) return 'right';
	const left: Rect = { x: size.w - hint.x - hint.w, y: hint.y, w: hint.w, h: hint.h };
	let rightFree = true;
	let leftFree = true;
	for (const c of cards) {
		const x = size.w / 2 + (c.x - view.cx) * view.scale;
		const y = size.h / 2 + (c.y - view.cy) * view.scale;
		const screen = { x, y, w: c.w * view.scale, h: c.h * view.scale };
		if (rightFree && meets(screen, hint)) rightFree = false;
		if (leftFree && meets(screen, left)) leftFree = false;
		if (!rightFree && !leftFree) return null;
	}
	return rightFree ? 'right' : 'left';
}

/** True when two screen boxes overlap; boxes that only touch do not (the look of a hint that fits stays as it was). */
function meets(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
