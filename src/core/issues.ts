/**
 * Milestone 1 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Every problem the plugin reports has a stable code. Text lives in one STE message table
 * (`src/core/messages.ts`, WP1.2), so wording can change without touching the checks, and
 * tests assert codes rather than sentences.
 */

/** Tree not rendered (spec §8). */
export type HardErrorCode =
	/** params: detail (parser message). `line` is set when known. */
	| 'yaml-invalid'
	/** The block body is YAML but not a map. */
	| 'not-a-map';

export interface HardError {
	code: HardErrorCode;
	/** 1-based line in the block body. */
	line?: number;
	detail?: string;
}

/** Tree rendered, editing disabled, banner shown (spec §8). */
export type BlockingCode =
	/** params: id */
	| 'duplicate-person-id'
	/** params: id */
	| 'duplicate-union-id';

/** Tree rendered, warning badge (spec §8, §4.1). */
export type WarningCode =
	// Missing references.
	/** params: person, ref */
	| 'missing-parent'
	/** params: union (label), ref */
	| 'missing-partner'
	/** params: person, ref */
	| 'missing-house'
	/** A person's `union` names no union. params: person, ref */
	| 'missing-union'
	/** A person's `union` exists but is not a union of their placement parents. params: person, ref */
	| 'union-not-of-parents'
	/** params: ref */
	| 'missing-start'
	/** params: ref */
	| 'missing-focus'
	// Structure.
	/** params: person, type, count */
	| 'too-many-parents'
	/** params: union (label), count */
	| 'union-partner-count'
	/** params: union (label), person */
	| 'union-same-partner'
	/** The people involved, in order. params: people (names, in order), dropped (child name) */
	| 'cycle'
	/** params: person */
	| 'self-parent'
	/** `placement` names a type the person has no parents of. params: person, placement */
	| 'placement-without-parents'
	/** params: house */
	| 'house-color-null'
	/** params: id */
	| 'duplicate-house-id'
	// Unknown values: kept in the YAML, drawn with default styling.
	/** params: union (label), value */
	| 'unknown-union-type'
	/** params: person, value */
	| 'unknown-placement'
	/** params: person, value */
	| 'unknown-parent-type'
	// Shape problems that are not silently tolerated (spec §8 "Tolerated silently" is not reported).
	/** A person, house or union entry is not a map. params: section, index */
	| 'entry-not-map'
	/** A person or house has no id. params: section, index */
	| 'missing-id'
	/** A section that must be a list or map has another shape. params: section */
	| 'section-wrong-shape';

export type IssueCode = BlockingCode | WarningCode;

export type IssueParams = Record<string, string | number | string[]>;

export interface CodedIssue {
	code: IssueCode;
	level: 'blocking' | 'warning';
	params: IssueParams;
	/** People (or houses/unions, by id) the issue is about; used to highlight cards. */
	ids?: string[];
}

/*
 * WP1.2 migrates `types.ts` to these shapes:
 *   Tree.issues: CodedIssue[]   (replaces Issue)
 *   ParseResult = { ok: true; tree: Tree } | { ok: false; error: HardError }
 */

/** Implemented in `src/core/messages.ts` (WP1.2). Returns one or two STE sentences. */
export type IssueText = (issue: CodedIssue) => string;
export type HardErrorText = (error: HardError) => string;
