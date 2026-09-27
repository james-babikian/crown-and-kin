import type { CodedIssue, HardError } from './issues';

export const PARENT_TYPES = ['birth', 'adoptive', 'ward', 'rumoured'] as const;
export type ParentType = (typeof PARENT_TYPES)[number];

/** Parent types that can decide where a card is drawn. Rumoured never can. */
export const PLACEMENT_TYPES = ['birth', 'adoptive', 'ward'] as const;
export type PlacementType = (typeof PLACEMENT_TYPES)[number];

export const UNION_TYPES = ['marriage', 'betrothal', 'concubinage', 'affair'] as const;

export interface ParentRef {
	id: string;
	/** Kept as written; unknown values produce a warning and are treated as birth. */
	type: string;
}

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

export interface House {
	id: string;
	name: string;
	color?: string;
}

export interface TreeOptions {
	start?: string;
	focus?: string;
	generations?: number;
	height?: number;
}

export interface Tree {
	options: TreeOptions;
	houses: House[];
	people: Person[];
	unions: Union[];
	/** Shape problems found while reading; `deriveFamilies` adds the rest. */
	issues: CodedIssue[];
}

export type ParseResult =
	| { ok: true; tree: Tree }
	| { ok: false; error: HardError };
