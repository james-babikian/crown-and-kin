/*
 * The relation words that come after the first view (spec §13.1, D352 item 1). In a whole tree of `LATE_WORDS_MIN_CARDS` cards or more, the
 * tree view does not ask the word of every card before the first frame: the first fill asks the words of the cards near the first view, and
 * this queue writes the others in idle time, `WORDS_PER_CHUNK` people at a time, never while a pan or a zoom runs. The scene keeps which
 * card still waits (`SceneWords`, `render/dom/scene-fill.ts`); a fill that reaches such a card first asks its word itself.
 */

import type { Rect } from '../layout/model';
import type { SceneWords } from '../render/dom/scene-fill';
import { TIMED_WAIT_MS, whenIdle } from './idle';

/**
 * The fewest drawn cards for which the words come late. Below it the view asks every word before the first frame, as before: sample tree 7
 * (389 cards) gains only about 2 ms of 11 ms (computer) from it, and its screen-reader labels would lack the relation for a moment. A
 * generated tree of 500 people gains about 100 ms on the computer. It is also the size from which the canvas keeps no standing layer.
 */
export const LATE_WORDS_MIN_CARDS = 500;

/**
 * People in one idle chunk. Each request of the lookup works its memos out again (`relationLookup` releases them after each request), so
 * small chunks cost more in total: all words of the 1 000-person tree in one request 267 ms, in chunks of 100 346 ms, of 20 401 ms, of 10
 * 424 ms (node). 20 keeps one chunk short (about 8 ms at 1 000 people, 12 ms at 2 000) for a little more total idle work.
 */
export const WORDS_PER_CHUNK = 20;

/** A wheel event this recent (ms) still counts as a running wheel zoom or pan; the pan and zoom settle 180 ms after the last one. */
export const WHEEL_QUIET_MS = 250;

/**
 * The waits of an idle chunk. A browser with no idle callback (Safari) runs the next chunk after the timer: about one frame, so the time in which
 * a card far from the view still has the label without its relation stays short (D352 item 1). The card content chain keeps its own waits.
 */
const WAITS = { timeout: 1000, fallbackMs: TIMED_WAIT_MS };

/** True when a whole tree of `cards` drawn cards gets its words late. */
export function wordsComeLate(cards: number, min = LATE_WORDS_MIN_CARDS): boolean {
	return cards >= min;
}

/** What the queue needs from the tree view; it captures the scene's own words, so a new scene never gets the words of an old one. */
export interface WordQueue {
	words: SceneWords;
	/** The view's rectangle in tree coordinates (the nearest cards go first), or null before the first view. */
	view(): Rect | null;
	/** True while a pan or a zoom runs: the chunk waits for the next idle time. */
	busy(): boolean;
	/** False once the scene is gone; the queue then ends. */
	alive(): boolean;
	/** After each chunk that wrote words. */
	wrote?(): void;
	/** The view's safe wrapper (spec §8): it reports a fault of a chunk like every other fault of the view. */
	guard(fn: () => void): void;
}

/** Starts the idle queue of the late words; gives the function that stops it. A fault in a chunk stops the queue: the next fills write the words that are left. */
export function startWordQueue(q: WordQueue): () => void {
	let cancel: (() => void) | null = null;
	let stopped = false;
	const next = () => {
		if (!stopped && q.words.pending > 0) cancel = whenIdle(step, WAITS);
	};
	const step = () => {
		cancel = null;
		if (stopped || !q.alive()) return;
		let more = false;
		q.guard(() => {
			// "Names never compute during pan or zoom" (spec §13.1): the chunk waits, the queue goes on.
			if (!q.busy()) {
				const ids = q.words.due(q.view(), WORDS_PER_CHUNK);
				if (!ids.length) return;
				q.words.write(ids);
				q.wrote?.();
			}
			more = true;
		});
		if (more) next();
		else stopped = true;
	};
	next();
	return () => {
		stopped = true;
		cancel?.();
		cancel = null;
	};
}
