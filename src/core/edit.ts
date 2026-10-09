/**
 * Edits of a block body through the `yaml` Document API (spec §3, §6.2). Pure: no `obsidian`
 * import. `yaml-edit.ts` implements `applyOp`.
 *
 * Formatting rules for a written value (see the decision notes):
 * - Untouched nodes keep their comments, key order, quoting and flow style (§6.2).
 * - A changed value keeps its existing scalar style if that style can hold the new text;
 *   otherwise it is written plain if plain YAML reads it back as the same string, else in
 *   double quotes.
 * - `born`, `died`, `start`, `end` and ids are text: `born: 1103` stays plain.
 * - A new key goes in the §4.1 field order relative to the keys already there.
 * - Setting a field to null removes the key (and only that key's lines).
 * - Picture links (`portrait`, house `arms`; spec §13.0 item 3) are always written in double
 *   quotes. The caller gives the link text (the Obsidian side makes it); no op checks that the
 *   file exists.
 */

import type { InheritIllegitimate, InheritRule, InheritThrough, SuccessionRule } from './succession-keys';

/**
 * Person fields the edit sheet can set (§6.3 "Fields"); `card-title` is written by "Show on the
 * card" (§13.3, D62), `portrait` by Select portrait and Remove portrait (§13.7).
 */
export type PersonField = 'name' | 'sobriquet' | 'title' | 'card-title' | 'house' | 'sex' | 'born' | 'died' | 'illegitimate' | 'childless' | 'link' | 'portrait' | 'portrait-crop' | 'notes' | 'placement';

/** A value an edit can write for a person field: text, a boolean (`illegitimate` and `childless` only), or `null` to remove the key. */
export type FieldValue = string | boolean | null;

/** Sets or clears one or more fields of an existing person (§6.3 "Fields"). */
export interface SetPersonFields {
	kind: 'set-person-fields';
	id: string;
	/**
	 * Only the fields that changed. `null` removes the key. `illegitimate: false` and `childless: false` remove the key.
	 * `id` gives a person with no written id that id: refused with `id-taken` if a person or a
	 * reference uses it, `bad-value` if the person has a written id.
	 */
	fields: Partial<Record<PersonField, FieldValue>> & { id?: string };
}

/** Sets or clears one tree option (`start`, `focus`, `me`, `generations` or `height`). `me` is the "This is me" mark (spec §13.1, D42). */
export interface SetOption {
	kind: 'set-option';
	key: 'start' | 'focus' | 'me' | 'generations' | 'height';
	/** `null` removes the key; removing the last key removes `options`. */
	value: string | number | null;
}

/** "New house…" in the edit sheet (§6.3) and the Houses window. The id is generated from the name (§6.8). */
export interface AddHouse {
	kind: 'add-house';
	name: string;
	color?: string;
	/** Spec §13.6: the arms picture link. Empty text (or null) writes nothing; another type is refused `bad-value`. */
	arms?: string;
}

/** Several ops in one write (for example a new house and the person's fields). Applied in order; later ops may use ids created by earlier ones via `EditResult.created`. */
export interface Batch {
	kind: 'batch';
	ops: Op[];
}

// ---- Relationship ops ----

/** The parent types a parent entry can have (spec §4.2). */
export type ParentKind = 'birth' | 'adoptive' | 'ward' | 'rumoured';
/** The partnership types a union can have (spec §4.1). */
export type UnionKind = 'marriage' | 'betrothal' | 'concubinage' | 'affair';

/**
 * A listed union, by its position in the `unions` list, its partners and its source text.
 * `applyOp` refuses with `unknown-union` if the union at `index` does not have exactly these
 * partners (in either order) or, when `text` is given, if that union's source text (comments
 * and surrounding whitespace ignored) differs. The text check matters when one couple has
 * several unions: after one of them is removed, an old index can point at a sibling union with
 * the same partners. `familyOf` fills `text`; callers pass the ref back unchanged.
 */
export interface UnionRef {
	index: number;
	partners: [string, string];
	text?: string;
}

/**
 * Where a new person goes in `people` (§6.2). `after-siblings`: directly after the last existing
 * child whose placement parents are exactly `parents` (and, for two parents, whose primary union
 * is `union` when given); if there is none, directly after the last of those parents.
 * `before` / `after`: directly before or after that person. Absent: appended.
 * With `after-siblings` and a `union` that is not the pair's last-listed union, `add-person`
 * also writes `union:` on the new person (giving that union an id if it has none), so the child
 * is placed under the intended union (§4.3).
 */
export type Placement =
	| { kind: 'after-siblings'; parents: string[]; union?: UnionRef }
	| { kind: 'before'; id: string }
	| { kind: 'after'; id: string };

/**
 * A new person as one block map with keys in §4.1 order (§6.2). The id is chosen by the caller
 * with `newPersonId`, so a batch can refer to it; `applyOp` refuses `id-taken` if it exists.
 * `parents` is written as a flow sequence: birth parents as plain ids, other types as flow maps (§4.2).
 */
export interface AddPerson {
	kind: 'add-person';
	id: string;
	fields: Partial<Record<PersonField, FieldValue>>;
	parents?: { id: string; type: ParentKind }[];
	at?: Placement;
}

/** Add one parent entry to an existing person. Refused with `limit` if the person already has 2 of that type, `cycle` if the parent is the child or a descendant (through any type). */
export interface AddParent {
	kind: 'add-parent';
	child: string;
	parent: string;
	type: ParentKind;
	/**
	 * Add child with an existing child and a chosen partnership (§6.4): when the child's placement
	 * parents after this op are exactly the union's partners and the union is not the pair's
	 * last-listed one, also write `union:` on the child (giving the union an id if it has none),
	 * so the child sits under the chosen union (§4.3).
	 */
	union?: UnionRef;
	/**
	 * If this gives the child two parents of `type` with no union between them, also add a
	 * `marriage` union (§6.4). Only for `birth` and `adoptive` parents (guardians and rumoured
	 * parents are not assumed to be a couple). The result then lists `auto-union` in `effects`.
	 * Default true.
	 */
	autoUnion?: boolean;
}

/** Add a union. If the pair already has one or more unions and the last-listed one has children, those children keep it: the op gives that union an `id` if it has none and sets `union:` on them (§4.3; the decision notes "Second union for a couple"). A union with no children gets no id. */
export interface AddUnion {
	kind: 'add-union';
	partners: [string, string];
	type?: UnionKind;
	start?: string;
	end?: string;
}

/** Sets or clears the type, start or end of an existing union. */
export interface EditUnion {
	kind: 'edit-union';
	union: UnionRef;
	/** `null` removes the key (for `type`: back to the default, marriage). */
	fields: Partial<Record<'type' | 'start' | 'end', string | null>>;
}

/** Remove only the union item (D5, §6.7). Children keep both parents. */
export interface RemoveUnion {
	kind: 'remove-union';
	union: UnionRef;
}

/** Change the type of one parent entry, rewriting it in the §4.2 form. Refused with `limit` if the new type is full. */
export interface SetParentType {
	kind: 'set-parent-type';
	child: string;
	parent: string;
	from: ParentKind;
	to: ParentKind;
}

/** Remove one parent entry (§6.7). Removing the last one removes the `parents` key. */
export interface RemoveParent {
	kind: 'remove-parent';
	child: string;
	parent: string;
	type: ParentKind;
}

/** Swap the whole YAML item (with its comments) with the previous or next sibling in the same group (§6.5, D2). Refused with `no-sibling` at the end of the group. */
export interface MoveSibling {
	kind: 'move-sibling';
	id: string;
	direction: 'earlier' | 'later';
}

/**
 * Delete a person (§6.7): the item, their id from every parent entry, their unions, and
 * `options.start`, `focus` and `me` if they point to them. Nobody else is deleted. D57: also every
 * written holder item whose `person` is the id, in every title with an id (also one that loses to
 * a duplicate id); a title that loses its last holder keeps `holders: []`.
 */
export interface DeletePerson {
	kind: 'delete-person';
	id: string;
}

// ---- Houses ----

/**
 * Houses window (§6.10, D32, §13.6): rename, recolour and/or change the arms of a house. Only given
 * fields change; `color: null` removes the colour, `arms: null` (or empty text) the arms; `arms`
 * of another type than text is refused `bad-value`; a value equal to the read one (compared like
 * `link`) writes nothing. The id changes only with `set-house-id` (§13.17). Acts on the first house with the
 * id (the one the tree uses); an empty name or a colour that is not `#rrggbb` gives `bad-value`;
 * a colour is always written in double quotes. If `color:` reads as null because an unquoted
 * `#rrggbb` became an end-of-line comment, the op replaces that comment.
 */
export interface EditHouse {
	kind: 'edit-house';
	id: string;
	name?: string;
	color?: string | null;
	arms?: string | null;
}

/**
 * Delete a house (§6.10, D32). `people: 'clear'` also removes `house:` from every person of that
 * house; `'keep'` leaves their `house:` (the tree then warns about a missing house).
 */
export interface DeleteHouse {
	kind: 'delete-house';
	id: string;
	people: 'clear' | 'keep';
}

/**
 * Houses window, Id field (§13.17 rule 5, D109): changes the id of a house and the `house` of every
 * written person who has the old id, in one write. `newId` equal to `id` is a no-op. Refused with
 * nothing changed: `bad-value` for an empty `newId`, one with a character other than a-z, 0-9 and
 * hyphen or with no letter and no digit, two houses with the old id, and an alias or an anchor on
 * a value to change; `unknown-house` if no house has the old id; `id-taken` if a house has `newId`
 * or a person writes `house: <newId>` (a reference that no house has).
 */
export interface SetHouseId {
	kind: 'set-house-id';
	id: string;
	newId: string;
}

// ---- Titles (spec §13.3–§13.5) ----

/** The fields of a holder that ops can write. `null` (or empty text) removes the key. */
export type HolderFields = Partial<Record<'person' | 'name' | 'as' | 'number' | 'from' | 'to', string | null>>;

/**
 * A written holder item: its title, its index in the written `holders` list, who it names and
 * its `text`. `applyOp` refuses `unknown-holder` if the item at `index` does not name the same
 * `person` (or, with no `person`, the same `name`), or when `text` is given and differs. Like
 * `UnionRef`, callers pass back what they read (`Holder.index`, `Holder.text`).
 */
export interface HolderRef {
	title: string;
	index: number;
	person?: string;
	name?: string;
	text?: string;
}

/** Picks an unused title id from a name (§6.8, own namespace); `taken` adds ids chosen earlier in the same batch. */
export type NewTitleId = (body: string, name: string, taken?: ReadonlySet<string>) => string;

/** Add a title at the end of `titles`; the caller chooses the id (`newTitleId`); refused `id-taken`. */
export interface AddTitle {
	kind: 'add-title';
	id: string;
	name: string;
	/** D66: the name for a holder with `sex: m`; empty text writes nothing. */
	maleName?: string;
	/** D65: the name for a holder with `sex: f`; empty text writes nothing. */
	femaleName?: string;
	plural?: string;
}

/**
 * Rename a title or change its male name, female name, plural or succession keys; `null` (or empty text) removes the key.
 * The id changes only with `set-title-id` (§13.17). The succession fields (contract 0.2.7 A.3, K.3, K.4) must hold a canonical
 * value, else `bad-value`; a person id in `heirs` or `exclude` that is not already written must name a person, else `unknown-person`.
 */
export interface EditTitle {
	kind: 'edit-title';
	id: string;
	name?: string;
	maleName?: string | null;
	femaleName?: string | null;
	plural?: string | null;
	succession?: SuccessionRule | null;
	inherit?: InheritRule | null;
	inheritThrough?: InheritThrough | null;
	/** `'no'` removes the key; a value that the written text already reads as keeps the text. */
	inheritIllegitimate?: InheritIllegitimate;
	/** `true` writes `true` unless the written text already reads as true; `false` removes the key. */
	inheritAdopted?: boolean;
	/** L.1: as `inheritAdopted`, for the key `heirs-of-body`; `null` removes the key like `false`. */
	heirsOfBody?: boolean | null;
	year?: string | null;
	/** The named heirs in order; one id is written as a scalar, several as a flow list; `null` or `[]` removes the key. */
	heirs?: string[] | null;
	exclude?: string[] | null;
}

/** Delete a title with its holders (the `card-title` cleanup removes the `card-title`s that name it). */
export interface DeleteTitle {
	kind: 'delete-title';
	id: string;
}

/** Sheet: append one holder at the end of the list (the newest ruler). Needs `person` (refused `unknown-person` if not in the tree) or `name`. */
export interface AddHolder {
	kind: 'add-holder';
	title: string;
	fields: HolderFields;
}

/** Sheet: change fields of one holder; a block-map item stays a block map. */
export interface EditHolder {
	kind: 'edit-holder';
	holder: HolderRef;
	fields: HolderFields;
}

/** Sheet: remove one holder item with its comments. */
export interface RemoveHolder {
	kind: 'remove-holder';
	holder: HolderRef;
}

/**
 * Titles window: the whole final holder list of one title. Each item is an existing holder
 * (`ref`, checked against the body before this op, with optional changed `fields`) or a new one
 * (`add`). Existing items keep their comments and style and move as whole items; items not
 * listed are removed; only changed values are written. Each existing ref may appear once.
 */
export interface SetHolders {
	kind: 'set-holders';
	title: string;
	items: ({ ref: HolderRef; fields?: HolderFields } | { add: HolderFields })[];
}

/**
 * Titles window, Id field (§13.17 rule 5, D109): like `SetHouseId` for a title and the `card-title`
 * of the people. The holders are person ids and do not change. Refusals: `unknown-title` for an
 * old id that no title has; `id-taken` for a title with `newId` or a person who writes
 * `card-title: <newId>`; `bad-value` as for `SetHouseId`.
 */
export interface SetTitleId {
	kind: 'set-title-id';
	id: string;
	newId: string;
}

/** The title ops (spec §13.4); `title-ops.ts` carries them out. They act on the first title with the id. */
export type TitleOp = AddTitle | EditTitle | DeleteTitle | AddHolder | EditHolder | RemoveHolder | SetHolders | SetTitleId;

/**
 * Link maintenance (§6.9, D6, §13.0 item 3). For each person `link`, person `portrait` and house
 * `arms` whose target (normalised with `NormaliseTarget` from `link-rewrite.ts`) is a key of `map`,
 * write the new target `map[key]`, keeping `#heading`, `|alias`, a leading `!` and a trailing `.md`
 * if the old text had it. A value keeps its written style (quotes, the unquoted nested form) only
 * if that style can hold the new text; otherwise the value-quoting rule (spec §3) applies. Nothing
 * else in the body changes. Allowed on a tree with blocking issues (it touches only these values).
 * `EditResult.changed` gives the number of values changed (0 = the body is unchanged): a person
 * whose `link` and `portrait` both change counts 2; an item written once and used again through a
 * YAML alias counts once per value.
 */
export interface RewriteLinksOp {
	kind: 'rewrite-links';
	map: Record<string, string>;
}

/** Every edit operation `applyOp` accepts. */
export type Op =
	| SetPersonFields
	| SetOption
	| AddHouse
	| Batch
	| AddPerson
	| AddParent
	| AddUnion
	| EditUnion
	| RemoveUnion
	| SetParentType
	| RemoveParent
	| MoveSibling
	| DeletePerson
	| EditHouse
	| DeleteHouse
	| SetHouseId
	| TitleOp
	| RewriteLinksOp;

/** Picks an unused numbered person id (§6.8, §13.17 rule 1); `yaml-edit.ts` exports it. The name is unused. */
export type NewPersonId = (body: string, name: string) => string;

/** Why `applyOp` refused an edit, instead of throwing (spec §8). */
export type EditRefusal =
	/** The body does not parse, or the top level is not a map. */
	| 'invalid-yaml'
	/** The tree has blocking issues (§8); editing is off. */
	| 'blocked'
	/** The op names a person who is not in the block. */
	| 'unknown-person'
	/** A value is not allowed (for example an empty name). */
	| 'bad-value'
	/** A `UnionRef` does not match the union at that index. */
	| 'unknown-union'
	/** The id already exists: a new person's id, a new title's id, or the new id of a house or a title (also when a person already writes it as a reference). */
	| 'id-taken'
	/** The person already has 2 parents of that type (§4.2). */
	| 'limit'
	/** The link would make someone their own ancestor (§6.6). */
	| 'cycle'
	/** `move-sibling` at the start or end of the group. */
	| 'no-sibling'
	/** `edit-house` / `delete-house` name a house that is not in the block. */
	| 'unknown-house'
	/** A title op names a title id that no title in the block has. */
	| 'unknown-title'
	/** A `HolderRef` does not match the holder item at that index. */
	| 'unknown-holder';

/** The result of `applyOp`: the new body and any created ids or effects, or a refusal code and detail. */
export type EditResult =
	| {
			ok: true;
			body: string;
			/** Ids created by this op, in order (for example the new house id). */
			created: string[];
			/** For `rewrite-links`, the number of link, portrait and arms values changed (0 = the body is unchanged). */
			changed?: number;
			/** Side effects the UI must mention (`auto-union`: a marriage was added, §6.4). */
			effects?: ('auto-union')[];
	  }
	| { ok: false; code: EditRefusal; detail?: string };

/** Applies one edit operation to a block body; returns the new body, or a refusal (spec §8: never throws). */
export type ApplyOp = (body: string, op: Op) => EditResult;
