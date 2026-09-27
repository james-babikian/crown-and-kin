/**
 * Milestone 2 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Finding a `dynasty` block in a note and planning a write to it (spec §6.1). Pure: no
 * `obsidian` import. `block-locate.ts` implements `findBlocks`, `locateBlock`, `ordinalForSection` and `replaceBody` (WP2.2);
 * `block-write.ts` implements `planWrite` and `UndoStack` (WP2.3).
 */

export interface LocatedBlock {
	/** Index of this block among the `dynasty` blocks of the note, from 0, in text order. */
	ordinal: number;
	/**
	 * 0-based line numbers of the opening and closing fence lines. `closeLine` is null for a block
	 * with no closing fence: it runs to the end of its container (the callout or list item), or to
	 * the end of the note at the top level (CommonMark).
	 */
	openLine: number;
	closeLine: number | null;
	/** Offsets into the note text of the first body character and one past the last (the body lines only, without the fence lines). */
	bodyStart: number;
	bodyEnd: number;
	/**
	 * The container prefix of every body line, for example `"> "`, `">"`, `"> > "`, or the
	 * indentation of a list item (spaces or tabs, as written). The body is parsed with this prefix
	 * removed. The opening fence line may carry a different prefix (the list marker in a fence
	 * written on the list-item line); fence lines are never rewritten.
	 */
	prefix: string;
	/** The body with the prefix removed from each line, lines joined with `\n`. */
	body: string;
	/** The note's line ending; a write keeps it. */
	eol: '\n' | '\r\n';
}

/** All `dynasty` blocks of a note in text order. Fences inside longer fences are skipped (§6.1). */
export type FindBlocks = (text: string) => LocatedBlock[];

/** The block with this ordinal, or null. */
export type LocateBlock = (text: string, ordinal: number) => LocatedBlock | null;

/**
 * Ordinal of the block that Obsidian rendered, from `getSectionInfo(el)` (0-based `lineStart` and
 * `lineEnd`) and the processor's `source`. For a block inside a callout or list, Obsidian may
 * report the whole container's lines, and one container can hold several blocks: take the blocks
 * whose opening fence lies in [lineStart, lineEnd]; if there is one, return it; if there are
 * several, return the one whose `body` equals `source` (line endings normalised, trailing newline
 * ignored). Null if there is none or the match is ambiguous (the view is then read-only).
 */
export type OrdinalForSection = (text: string, lineStart: number, lineEnd: number, source: string) => number | null;

/**
 * Puts a new body back into the note text: re-adds the prefix on every body line, keeps the
 * fence lines and the rest of the note byte for byte, and uses the note's line ending.
 */
export type ReplaceBody = (text: string, block: LocatedBlock, newBody: string) => string;

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
}
