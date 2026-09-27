import type { PlanWrite, UndoStack } from './block';
import { findBlocks, locateBlock, replaceBody } from './block-locate';

export const planWrite: PlanWrite = (text, ordinal, expectedBody, edit) => {
	const block = locateBlock(text, ordinal);
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
	if (after.length !== findBlocks(text).length || after[ordinal]?.body !== newBody) {
		return { ok: false, code: 'rejected', reason: 'The new text would change where the tree ends in the note.' };
	}
	return { ok: true, newText, newBody, oldBody: block.body };
};

export const UNDO_LIMIT = 20;

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
	};
}
