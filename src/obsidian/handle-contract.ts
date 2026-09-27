/**
 * Milestone 2 contract (frozen by the supervisor; change only through the supervisor).
 *
 * The public face of a BlockHandle (spec §6.1), used by the tree view and the edit sheet.
 * `block-handle.ts` implements it (WP2.4); its pure parts live in `src/core/block.ts`.
 */
import type { EditResult, Op } from '../core/edit';

export interface BlockKey {
	/** Vault path of the note. Re-keyed on rename. */
	path: string;
	/** Index among the note's `dynasty` blocks (see `LocatedBlock.ordinal`). */
	ordinal: number;
}

export type WriteOutcome =
	| { ok: true; body: string; created: string[] }
	/**
	 * `stale`: the block changed since the handle last read or wrote it; the handle has re-read it
	 * and emitted `changed`. `missing`: the block is gone. `refused`: the op was refused.
	 */
	| { ok: false; code: 'stale' | 'missing' }
	| { ok: false; code: 'refused'; refusal: Extract<EditResult, { ok: false }> };

export type UndoOutcome = { ok: true; body: string } | { ok: false; code: 'empty' | 'changed' | 'missing' };

export interface BlockHandle {
	readonly key: BlockKey;
	/** The body the handle last rendered or wrote (`expectedBody`, §6.1). */
	readonly body: string;
	/** Queued; writes on one handle never overlap. */
	write(op: Op): Promise<WriteOutcome>;
	/** Plugin undo (D8). */
	undo(): Promise<UndoOutcome>;
	readonly canUndo: boolean;
	/** Fired after each write, undo, re-read after a stale write, and external change of this block's body. Returns an unsubscribe function. */
	onChanged(listener: (body: string) => void): () => void;
}

/**
 * M6 (WP6.4, §6.9): a handle for any block of a Markdown note, also one that was never drawn or
 * whose note is closed (the registry reads the note and creates the handle). `null` if the note
 * or the block is gone. Writes through it follow the normal stale check.
 */
export type ForBlock = (path: string, ordinal: number) => Promise<BlockHandle | null>;
