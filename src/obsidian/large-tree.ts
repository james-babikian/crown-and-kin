/*
 * Very large trees (spec §0 D159, D223, D226; §7.7). Pure rules, so a test can read them without a view: the three limits, the rule that
 * says when a block shows the low bar in place of the tree, the memory of a draw that took too long, and the time budget of a draw.
 * `tree-view.ts` counts the people right after the parse, asks `largeBar` once the focus is known, and draws the bar (`large-bar.ts`).
 */

import type { Tree } from '../core/types';
import { LayoutStopped } from '../layout/index';

/** D226: above this many people the tree of a note does not draw by itself; a tap on "Draw the tree" draws it. */
export const FIRST_LIMIT = 1500;
/** D226: above this many people the plugin never draws the tree. */
export const SECOND_LIMIT = 5000;
/** D226: the whole tree of the phone's full-screen view has a lower top (memory and draw time). */
export const PHONE_WHOLE_LIMIT = 3000;
/** Spec §7.7 (time budget): a draw that passes this time stops before its next phase, in ms. It is a backstop; the iPhone test measures the real time. */
export const TIME_BUDGET_MS = 15_000;
/** Spec §7.7 (time budget): the relation names of the cards are asked for in groups of about this many people, with the time check between them. */
export const RELATION_GROUP = 300;

/**
 * Which bar shows. `ask`: above the first limit, with the button; `top`: above the top that applies, no button; `slow`: a draw that took too long, no
 * button. `limit` is the number that the text of `top` names (0 for `slow`).
 */
export interface LargeBar {
	kind: 'ask' | 'top' | 'slow';
	limit: number;
	/** True when the bar stands for a focus family (a chosen person or a pin) whose own people pass the top, not for the whole tree. */
	family?: boolean;
}

/** What the rule needs to know about one render. */
export interface BarFacts {
	/** The people count right after the parse (spec §7.7: the entries of the `people` list, duplicates included). */
	count: number;
	/** This render would draw the whole tree: no focus family and no short finder line. */
	whole: boolean;
	/** The full-screen view. */
	full: boolean;
	/** A phone (a coarse pointer and a screen with a short side under 600 px). */
	phone: boolean;
	/** The user tapped "Draw the tree" for this block in this session (spec §7.7). */
	tapped: boolean;
	/** A draw of this exact text took too long before (spec §7.7). */
	stopped: boolean;
}

/** The people of a parsed tree, counted before any other work (spec §7.7). */
export function peopleCount(tree: Tree): number {
	return tree.people.length;
}

/**
 * Spec §7.7: the bar of this render, or null when the tree draws. A focus family and the phone list never get here. The full-screen view of a computer
 * or a tablet is reached only from a drawn tree, so it has no first limit; the top of every whole-tree render is the second limit, and the phone's
 * full-screen view has the lower phone top.
 */
export function largeBar(f: BarFacts): LargeBar | null {
	if (!f.whole) return null;
	if (f.stopped) return { kind: 'slow', limit: 0 };
	const over = drawnBar(f.count, f.full, f.phone);
	if (over) return over;
	if (f.count > FIRST_LIMIT && !f.tapped && (!f.full || f.phone)) return { kind: 'ask', limit: FIRST_LIMIT };
	return null;
}

/**
 * The top for the people that a render draws (D226, D227 item 2): the second limit, and the lower phone top in the phone's full-screen view. It holds for
 * a whole tree and also for a focus family, so a pin with a large `generations` cannot draw what the plugin never draws. Null when the count is within it.
 */
export function drawnBar(drawn: number, full: boolean, phone: boolean): LargeBar | null {
	const top = full && phone ? PHONE_WHOLE_LIMIT : SECOND_LIMIT;
	return drawn > top ? { kind: 'top', limit: top } : null;
}

/** The time check of a draw: true once more than `ms` have passed since `from`. A fake clock goes in as `now`. */
export function drawBudget(from: number, now: () => number = () => performance.now(), ms = TIME_BUDGET_MS): () => boolean {
	return () => now() - from > ms;
}

/**
 * Asks for the relation names of `ids` in groups, checking `shouldStop` after each group (spec §7.7); a group is one request, so no group is cut in the middle.
 * Without a check it is one request, as in 0.2.8. `ask` is the lookup's `getMany`.
 */
export function askInGroups(ask: (ids: string[]) => unknown, ids: Iterable<string>, shouldStop?: () => boolean): void {
	if (!shouldStop) {
		ask([...ids]);
		return;
	}
	let group: string[] = [];
	for (const id of ids) {
		group.push(id);
		if (group.length < RELATION_GROUP) continue;
		ask(group);
		group = [];
		if (shouldStop()) throw new LayoutStopped();
	}
	if (group.length) ask(group);
}

/** A draw that stopped: the tree text it was for. A later render of this text shows the bar with no button (spec §7.7). */
const stopped = new Map<string, { count: number; text: string }>();
const STOPPED_KEPT = 64;

/** Remembers that the draw of this block text took too long; `key` is the block key. */
export function rememberStop(key: string, count: number, text: string): void {
	stopped.delete(key);
	stopped.set(key, { count, text });
	while (stopped.size > STOPPED_KEPT) stopped.delete(stopped.keys().next().value!);
}

/** True when a draw of exactly this text took too long; a changed text (the count or the words) is a new tree. */
export function wasStopped(key: string, count: number, text: string): boolean {
	const hit = stopped.get(key);
	if (!hit) return false;
	if (hit.count === count && hit.text === text) return true;
	stopped.delete(key);
	return false;
}

/** Forgets every stopped draw (tests, and the plugin when it unloads). */
export function clearStops(): void {
	stopped.clear();
}
