/*
 * The shape of a parsed tree: people, unions, houses and options (spec §4). `parse.ts` builds a
 * `Tree` from a block's YAML; `validate.ts`, `derive.ts` and the render code read it. These types
 * hold values as read from the YAML, before validation removes anything unsafe to draw.
 */

import type { CodedIssue, HardError } from './messages';

/** The parent types a parent entry can have (spec §4.2). */
export const PARENT_TYPES = ['birth', 'adoptive', 'ward', 'rumoured'] as const;
/** One of `PARENT_TYPES`. */
export type ParentType = (typeof PARENT_TYPES)[number];

/** Parent types that can decide where a card is drawn. Rumoured never can. */
export const PLACEMENT_TYPES = ['birth', 'adoptive', 'ward'] as const;
/** One of `PLACEMENT_TYPES`. */
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

/** The partnership types a union can have (spec §4.1). */
export const UNION_TYPES = ['marriage', 'betrothal', 'concubinage', 'affair'] as const;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** True if `t` is a known parent type. */
export const isParentType = (t: unknown): t is ParentType => isOneOf(PARENT_TYPES, t);

/** True if `t` is a parent type that can decide where a card is drawn. */
export const isPlacementType = (t: unknown): t is PlacementType => isOneOf(PLACEMENT_TYPES, t);

/** True if `t` is a known union type. */
export const isUnionType = (t: unknown): t is (typeof UNION_TYPES)[number] => isOneOf(UNION_TYPES, t);

/** Unknown parent types are read as birth, as validation does (§8). */
export function parentKind(type: string | undefined): ParentType {
	return isParentType(type) ? type : 'birth';
}

/** A parent entry as read from `parents:`, before validation checks the reference. */
export interface ParentRef {
	id: string;
	/** Kept as written; unknown values produce a warning and are treated as birth. */
	type: string;
}

/** One person, as read from the `people` list. */
export interface Person {
	id: string;
	name: string;
	title?: string;
	house?: string;
	sex?: string;
	born?: string;
	died?: string;
	parents: ParentRef[];
	placement?: string;
	illegitimate: boolean;
	union?: string;
	link?: string;
	notes?: string;
	/** Position in the `people` list. Sibling order derives from this. */
	index: number;
}

/** One partnership, as read from the `unions` list. */
export interface Union {
	id?: string;
	partners: string[];
	type: string;
	start?: string;
	end?: string;
	index: number;
	/** The item's source text without comments, whitespace runs as one space (`UnionRef.text`). */
	text?: string;
}

/** One house, as read from the `houses` list. */
export interface House {
	id: string;
	name: string;
	color?: string;
}

/** The `options` section of a block: the start person, the focus person, and the generation and height limits. */
export interface TreeOptions {
	start?: string;
	focus?: string;
	generations?: number;
	height?: number;
}

/** A whole parsed block: its houses, people and unions, plus any shape issues found while reading. */
export interface Tree {
	options: TreeOptions;
	houses: House[];
	people: Person[];
	unions: Union[];
	/** Shape problems found while reading; `deriveFamilies` adds the rest. */
	issues: CodedIssue[];
}

/** The result of parsing a block: the `Tree` on success, or a `HardError` that stops it drawing at all. */
export type ParseResult =
	| { ok: true; tree: Tree }
	| { ok: false; error: HardError };
