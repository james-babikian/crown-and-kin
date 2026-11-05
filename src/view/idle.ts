/*
 * Runs a task in the next idle time. The fold and card chains of a drawn tree, the person picker and the picture copies share it.
 */

/** What an idle step may ask: how many ms of the idle time are left (a fixed share where the browser gives none). */
export interface IdleBudget {
	timeRemaining(): number;
}

/** The two waits of an idle step: `timeout` for `requestIdleCallback`, and `fallbackMs` for the plain timer where the browser has no idle callback (Safari). */
export interface IdleWaits {
	timeout: number;
	fallbackMs: number;
}

/** Runs `fn` in idle time, or after `fallbackMs` where the browser has no idle callback; gives a function that cancels the step. */
export function whenIdle(fn: (idle: IdleBudget) => void, waits: IdleWaits): () => void {
	const g = window as unknown as { requestIdleCallback?: (f: typeof fn, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
	if (g.requestIdleCallback) {
		const id = g.requestIdleCallback.call(window, fn, { timeout: waits.timeout });
		return () => g.cancelIdleCallback?.call(window, id);
	}
	const id = window.setTimeout(() => fn({ timeRemaining: () => 8 }), waits.fallbackMs);
	return () => window.clearTimeout(id);
}

/** Runs `fn` in the next idle time (a timer where the browser has no idle callback, as Safari); the fold and card chains share it. */
export function later(fn: (idle: IdleBudget) => void): void {
	whenIdle(fn, { timeout: 1500, fallbackMs: 300 });
}
