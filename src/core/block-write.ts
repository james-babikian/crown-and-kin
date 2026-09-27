/*
 * Turns one edit into a plan for writing it back to the note, and keeps the plugin's undo history
 * (spec §6.1). `planWrite` locates the block, checks it still holds the expected body, runs the
 * edit and builds the new note text; `createUndoStack` gives `block-handle.ts` a small history of
 * past writes. No `obsidian` import: the caller does the actual file write.
 */

import { findBlocks, replaceBody } from './block-locate';

/** The result of `planWrite`: the new text and bodies on success, or why the write did not happen. */
export type WritePlan =
	| { ok: true; newText: string; newBody: string; oldBody: string }
	/** `stale`: the body differs from `expectedBody`. `missing`: no block with that ordinal. `rejected`: the edit refused (see `reason`). */
	| { ok: false; code: 'stale' | 'missing'; currentBody?: string }
	| { ok: false; code: 'rejected'; reason: string };

/**
 * Steps 1–6 of the §6.1 stale check as one pure function: locate, compare with
 * `expectedBody`, run `edit` on the body, and build the new note text.
 * `edit` returns the new body or a refusal reason.
 */
export type PlanWrite = (
	text: string,
	ordinal: number,
	expectedBody: string,
	edit: (body: string) => { ok: true; body: string } | { ok: false; reason: string },
) => WritePlan;

/** Plugin undo (§6.1, D8): the last 20 bodies a handle replaced. */
export interface UndoStack {
	/** Record one write: the body before and the body the plugin wrote. Keeps at most 20. */
	push(before: string, after: string): void;
	/** True if there is an entry and `currentBody` equals what the plugin last wrote. */
	canUndo(currentBody: string): boolean;
	/** On success returns the body to restore and drops the entry. */
	undo(currentBody: string): { ok: true; body: string } | { ok: false; code: 'empty' | 'changed' };
	readonly size: number;
	/** Rewrites every entry: a link update after a rename (spec §6.9) changes them all. */
	map(fn: (body: string) => string): void;
}

/** Implements `PlanWrite`. */
export const planWrite: PlanWrite = (text, ordinal, expectedBody, edit) => {
	const blocks = findBlocks(text);
	const block = blocks[ordinal];
	if (!block) return { ok: false, code: 'missing' };
	if (block.body !== expectedBody) return { ok: false, code: 'stale', currentBody: block.body };
	let result: ReturnType<typeof edit>;
	try {
		result = edit(block.body);
	} catch (e) {
		// §8: a failing edit must refuse the write, never escape into the write queue.
		return { ok: false, code: 'rejected', reason: e instanceof Error ? e.message : String(e) };
	}
	if (!result.ok) return { ok: false, code: 'rejected', reason: result.reason };
	// The body as the next locate will read it back, so the handle's expectedBody matches.
	const newBody = result.body.replace(/\r\n?/g, '\n');
	const newText = replaceBody(text, block, newBody);
	// A body line that reads as a fence would end the block early and spill the tree into the
	// note: the write must read back as the same blocks with this body.
	const after = findBlocks(newText);
	if (after.length !== blocks.length || after[ordinal]?.body !== newBody) {
		return { ok: false, code: 'rejected', reason: 'The new text would change where the tree ends in the note.' };
	}
	return { ok: true, newText, newBody, oldBody: block.body };
};

/** The number of past writes `createUndoStack` keeps. */
export const UNDO_LIMIT = 20;

/** Creates an empty `UndoStack`. */
export function createUndoStack(): UndoStack {
	const entries: { before: string; after: string }[] = [];
	return {
		push(before, after) {
			entries.push({ before, after });
			if (entries.length > UNDO_LIMIT) entries.splice(0, entries.length - UNDO_LIMIT);
		},
		canUndo(currentBody) {
			return entries.length > 0 && entries[entries.length - 1].after === currentBody;
		},
		undo(currentBody) {
			const top = entries[entries.length - 1];
			if (!top) return { ok: false, code: 'empty' };
			// Someone else changed the block since the plugin wrote it; undo would overwrite that.
			if (top.after !== currentBody) return { ok: false, code: 'changed' };
			entries.pop();
			return { ok: true, body: top.before };
		},
		get size() {
			return entries.length;
		},
		map(fn) {
			for (const e of entries) {
				e.before = fn(e.before);
				e.after = fn(e.after);
			}
		},
	};
}
