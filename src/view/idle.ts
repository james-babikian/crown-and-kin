/*
 * Runs a task in the next idle time. The fold and card chains of a drawn tree, the person picker and the picture copies share it.
 */

/** What an idle step may ask: how many ms of the idle time are left (a fixed share where the browser gives none). */
export interface IdleBudget {
	timeRemaining(): number;
	/** True where the budget is measured by the frame clock (no idle callback, as Safari): a chunk then works until the budget is spent, not for a fixed count. */
	timed?: boolean;
}

/** The work time of one chunk on the plain timer, in ms. */
export const TIMED_CHUNK_MS = 8;

/** The wait between two chunks on the plain timer, in ms; the same as the words queue (`late-words.ts`). */
export const TIMED_WAIT_MS = 16;

/** The plain-timer wait of `later` for callers that do not draw cards (the vault index on a phone keeps its 300 ms pause; D353 item 5 names only the card text). */
export const LATER_FALLBACK_MS = 300;

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
	const id = window.setTimeout(() => {
		// The clock starts when the chunk starts, so the budget counts only the work of the chunk.
		const t0 = performance.now();
		fn({ timeRemaining: () => Math.max(0, TIMED_CHUNK_MS - (performance.now() - t0)), timed: true });
	}, waits.fallbackMs);
	return () => window.clearTimeout(id);
}

/** Runs `fn` in the next idle time (a timer of `fallbackMs` where the browser has no idle callback, as Safari); the fold and card chains pass `TIMED_WAIT_MS`. */
export function later(fn: (idle: IdleBudget) => void, fallbackMs = LATER_FALLBACK_MS): void {
	whenIdle(fn, { timeout: 1500, fallbackMs });
}

/** The cards of one fill call in a timed chunk: small, so the budget is checked often. */
const TIMED_GROUP = 5;

/** True when a chunk that has made `made` items must stop: the fixed count and the idle time left of the browser, or (timed) ten times the fixed count (a cap against a stuck clock) and the spent budget. */
export function chunkDone(idle: IdleBudget, made: number, fixedMax: number, fixedStopMs: number): boolean {
	return idle.timed ? made >= fixedMax * 10 || idle.timeRemaining() <= 0 : made >= fixedMax || idle.timeRemaining() < fixedStopMs;
}

/** One chunk of fills: `fixedMax` items at once, or (timed) small groups of the same order until the budget is spent; `more` says whether work is left. */
export function runChunk(idle: IdleBudget, fixedMax: number, work: (max: number) => void, more: () => boolean): void {
	if (!idle.timed) return work(fixedMax);
	let n = 0;
	do work(TIMED_GROUP);
	while (more() && !chunkDone(idle, (n += TIMED_GROUP), fixedMax, 0));
}
