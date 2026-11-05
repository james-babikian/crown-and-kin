/*
 * Which "person shown" marks of a block come from a write whose window is still open. The phone list says "The plugin saved X. Tap Find to see this
 * person." only for a Save that ends its window; a change that an open window wrote in place (a removal, a link, a move) is shown by that window itself.
 * The mark is the object in `BlockState.shown`, so the frozen state type does not change.
 */

const quiet = new WeakSet<object>();

/** Marks the `shown` object of a write that leaves its window open (D330 F03). */
export function markShownQuiet<T extends object>(shown: T): T {
	quiet.add(shown);
	return shown;
}

/** Is this `shown` mark from a write that left its window open? */
export function isShownQuiet(shown: object | null): boolean {
	return shown !== null && quiet.has(shown);
}
