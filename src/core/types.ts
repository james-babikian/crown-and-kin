/*
 * The shape of a parsed tree: people, unions, houses, titles and options (spec §4, §13.4). `parse.ts` builds a
 * `Tree` from a block's YAML; `validate.ts`, `derive.ts` and the render code read it. These types
 * hold values as read from the YAML, before validation removes anything unsafe to draw.
 */

import type { CodedIssue, HardError } from './messages';
import type { InheritThrough } from './succession-keys';

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
	/** Spec §4.1, D122: shown after the name in curly double marks. Present only when written and not empty; `normaliseSobriquet` (core/sobriquet.ts) reads it. */
	sobriquet?: string;
	title?: string;
	/** Spec §13.3, D62: the id of the title the card shows, as written. Present only when written. */
	cardTitle?: string;
	house?: string;
	sex?: string;
	born?: string;
	died?: string;
	parents: ParentRef[];
	placement?: string;
	illegitimate: boolean;
	/** M.5: the person died with no children; set only when true. Only a dead person's open branch reads it. */
	childless?: true;
	union?: string;
	link?: string;
	/** Spec §13.7: the portrait picture link, as written (flattened like `link`); absent when not written or empty. */
	portrait?: string;
	/** Spec §13.13, D79: the text of `portrait-crop` as written (a list or map as JSON text); absent when not written or empty. */
	portraitCrop?: string;
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
	/** Spec §13.6: the arms picture link, as written (flattened like `link`); absent when not written or empty. */
	arms?: string;
}

/** One holder entry of a title, as written (spec §13.4). All values are text as written. */
export interface Holder {
	/** The written person id; wins over `name`. It may name nobody (`missing-holder`). */
	person?: string;
	/** A holder who is not in the tree, or the fallback when `person` names nobody. */
	name?: string;
	/** The ruler name when it is not the first word of the person's name (§13.5). */
	as?: string;
	/** Free text, for example "II"; never checked (§13.5, D59). */
	number?: string;
	from?: string;
	to?: string;
	/** Position of the item in the written `holders` list, counting skipped items. */
	index: number;
	/** The item's source text without comments, whitespace runs as one space (like `Union.text`). */
	text?: string;
}

/** One title of the `titles` section (spec §13.4). `numbering` and `count-with` are kept, never read (D59). */
export interface Title {
	id: string;
	/** The id when no name is written. */
	name: string;
	/** D66: `male-name`, the name for a holder with `sex: m`; absent when not written or empty. */
	maleName?: string;
	/** D65: `female-name`, the name for a holder with `sex: f`; absent when not written or empty. */
	femaleName?: string;
	/** The heading of the holder list and the table note name; the name when absent. */
	plural: string;
	/** Holder entries that survived validation, in written order (the order of succession). */
	holders: Holder[];
	/** Position in the written `titles` list. */
	index: number;
	/** As read: the number of items in the written `holders` list, holders or not (the Delete title confirmation). */
	items: number;
	/** Contract 0.2.7 A: `succession` as written, trimmed; the rule is `readRule` of it. Present only when written. */
	succession?: string;
	/** `inherit` as written, trimmed; the rule is `readInherit` of it. Present only when written. */
	inherit?: string;
	/** K.1: `inherit-through`, set only for a usable value (old forms read as the current one). */
	inheritThrough?: InheritThrough;
	/** `inherit-illegitimate`, set only for `after` or `equal` (`no` and an absent key are the same). */
	inheritIllegitimate?: 'after' | 'equal';
	/** `inherit-adopted`, set only when it reads as true. */
	inheritAdopted?: true;
	/** L.1: `heirs-of-body`, set only when it reads as true. */
	heirsOfBody?: true;
	/** `year` as written; the year is `yearOf` of it. */
	year?: string;
	/** K.3: the ids of `heir` in written order (one id or a list). An empty list gives undefined. */
	heirs?: string[];
	/** K.3: the ids of `exclude` in written order. */
	exclude?: string[];
	/** A.1: the flow text of a succession key whose value is a list or a map (or, for the last three, a text the plugin cannot use). */
	badKeys?: Partial<Record<BadKey, string>>;
}

/** The title keys that can hold a value the plugin cannot use (A.1, K.4). */
export type BadKey = 'succession' | 'inherit' | 'inherit-through' | 'inherit-illegitimate' | 'year' | 'heir' | 'exclude';

/** The `options` section of a block: the start person, the focus person, and the generation and height limits. */
export interface TreeOptions {
	start?: string;
	focus?: string;
	/** Spec §13.1, D42: the "This is me" mark. */
	me?: string;
	generations?: number;
	height?: number;
}

/** A whole parsed block: its houses, titles, people and unions, plus any shape issues found while reading. */
export interface Tree {
	options: TreeOptions;
	houses: House[];
	/**
	 * Spec §13.4: every title with an id, in list order, duplicates included (validation keeps the
	 * first); holders as read, before validation. Absent when the block has no `titles` key.
	 */
	titles?: Title[];
	people: Person[];
	unions: Union[];
	/** Shape problems found while reading; `deriveFamilies` adds the rest. */
	issues: CodedIssue[];
}

/** The result of parsing a block: the `Tree` on success, or a `HardError` that stops it drawing at all. */
export type ParseResult =
	| { ok: true; tree: Tree }
	| { ok: false; error: HardError };
