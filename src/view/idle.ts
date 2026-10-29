/*
 * Runs a task in the next idle time. The fold and card chains of a drawn tree share it.
 */

/** Runs `fn` in the next idle time (a timer where the browser has no idle callback, as Safari); the fold and card chains share it. */
export function later(fn: (idle: { timeRemaining(): number }) => void): void {
	const ric = (window as unknown as { requestIdleCallback?: (f: typeof fn, o: { timeout: number }) => number }).requestIdleCallback;
	if (ric) ric.call(window, fn, { timeout: 1500 });
	else window.setTimeout(() => fn({ timeRemaining: () => 8 }), 300);
}
