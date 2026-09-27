/**
 * Milestone 2 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Edits of a block body through the `yaml` Document API (spec §3, §6.2). Pure: no `obsidian`
 * import. `yaml-edit.ts` implements `applyOp` (WP2.3). Milestone 3 adds relationship ops to
 * the `Op` union.
 *
 * Formatting rules for a written value (supervisor decision, see the decision notes):
 * - Untouched nodes keep their comments, key order, quoting and flow style (§6.2).
 * - A changed value keeps its existing scalar style if that style can hold the new text;
 *   otherwise it is written plain if plain YAML reads it back as the same string, else in
 *   double quotes.
 * - `born`, `died`, `start`, `end` and ids are text: `born: 1103` stays plain.
 * - A new key goes in the §4.1 field order relative to the keys already there.
 * - Setting a field to null removes the key (and only that key's lines).
 */

/** Person fields the edit sheet can set in milestone 2 (§6.3 "Fields"). */
export type PersonField = 'name' | 'title' | 'house' | 'sex' | 'born' | 'died' | 'illegitimate' | 'link' | 'notes' | 'placement';

export type FieldValue = string | boolean | null;

export interface SetPersonFields {
	kind: 'set-person-fields';
	id: string;
	/** Only the fields that changed. `null` removes the key. `illegitimate: false` removes the key. */
	fields: Partial<Record<PersonField, FieldValue>>;
}

export interface SetOption {
	kind: 'set-option';
	key: 'start' | 'focus' | 'generations' | 'height';
	/** `null` removes the key; removing the last key removes `options`. */
	value: string | number | null;
}

/** "New house…" in the edit sheet (§6.3). The id is generated from the name (§6.8). */
export interface AddHouse {
	kind: 'add-house';
	name: string;
	color?: string;
}

/** Several ops in one write (for example a new house and the person's fields). Applied in order; later ops may use ids created by earlier ones via `EditResult.created`. */
export interface Batch {
	kind: 'batch';
	ops: Op[];
}

// ---- Milestone 3: relationship ops (frozen by the supervisor) ----

export type ParentKind = 'birth' | 'adoptive' | 'ward' | 'rumoured';
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

/** Delete a person (§6.7): the item, their id from every parent entry, their unions, and `options.start`/`focus` if they point to them. Nobody else is deleted. */
export interface DeletePerson {
	kind: 'delete-person';
	id: string;
}

// ---- Milestone 6: houses (frozen by the supervisor) ----

/**
 * Houses window (§6.10, D32): rename and/or recolour a house. Only given fields change;
 * `color: null` removes the colour. The id never changes (§4.1). Acts on the first house with the
 * id (the one the tree uses); an empty name or a colour that is not `#rrggbb` gives `bad-value`;
 * a colour is always written in double quotes. If `color:` reads as null because an unquoted
 * `#rrggbb` became an end-of-line comment, the op replaces that comment.
 */
export interface EditHouse {
	kind: 'edit-house';
	id: string;
	name?: string;
	color?: string | null;
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
 * Link maintenance (§6.9, D6; WP6.1). For each person `link` whose target (normalised with
 * `NormaliseTarget` from `link-rewrite-contract.ts`) is a key of `map`, write the new target
 * `map[key]`, keeping `#heading`, `|alias` and a trailing `.md` if the old text had it. A value
 * keeps its written style (quotes, the unquoted nested form) only if that style can hold the new
 * text; otherwise the M2 value-quoting rule applies. Nothing else in the body changes. Allowed on
 * a tree with blocking issues (it touches only `link` values). `EditResult.changed` gives the
 * number of links changed (0 = the body is unchanged).
 */
export interface RewriteLinksOp {
	kind: 'rewrite-links';
	map: Record<string, string>;
}

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
	| RewriteLinksOp;

/** Picks an unused person id from a name (§6.8); `yaml-edit.ts` exports it. */
export type NewPersonId = (body: string, name: string) => string;

export type EditRefusal =
	/** The body does not parse, or the top level is not a map. */
	| 'invalid-yaml'
	/** The tree has blocking issues (§8); editing is off. */
	| 'blocked'
	/** The op names a person who is not in the block. */
	| 'unknown-person'
	/** A value is not allowed (for example an empty name). */
	| 'bad-value'
	/** M3: a `UnionRef` does not match the union at that index. */
	| 'unknown-union'
	/** M3: the new person's id already exists. */
	| 'id-taken'
	/** M3: the person already has 2 parents of that type (§4.2). */
	| 'limit'
	/** M3: the link would make someone their own ancestor (§6.6). */
	| 'cycle'
	/** M3: `move-sibling` at the start or end of the group. */
	| 'no-sibling'
	/** M6: `edit-house` / `delete-house` name a house that is not in the block. */
	| 'unknown-house';

export type EditResult =
	| {
			ok: true;
			body: string;
			/** Ids created by this op, in order (for example the new house id). */
			created: string[];
			/** M6: for `rewrite-links`, the number of links changed (0 = the body is unchanged). */
			changed?: number;
			/** M3: side effects the UI must mention (`auto-union`: a marriage was added, §6.4). */
			effects?: ('auto-union')[];
	  }
	| { ok: false; code: EditRefusal; detail?: string };

export type ApplyOp = (body: string, op: Op) => EditResult;
