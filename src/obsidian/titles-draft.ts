/*
 * The pure part of the title editing (spec §13.4, §13.5): what a holder's text lines say, how the
 * holder form turns its fields into holder values (`as` only when the ruler name changed), and the
 * Titles window's draft: its rows (with the "Name of the list", D64, the "Name for a man", D66, and the "Name for a woman", D65), whether it changed, the one `batch` that Save writes
 * (with ids for holder people who have none), the Id field of each title (§13.17 rule 5, D109), and how the draft follows a tree that changed under the window. No `obsidian` import, so vitest runs it;
 * `titles-window.ts`, `holder-form.ts` and `sheet-titles.ts` use it.
 */

import type { FamilyGraph } from '../core/derive';
import type { HolderFields, HolderRef, Op } from '../core/edit';
import { nextPersonId } from '../core/id-gen';
import { referencedIds } from '../core/parse';
import { entryReign, rulerName } from '../core/titles';
import { isMap, str, type Raw } from '../core/tolerate';
import type { Holder, Title } from '../core/types';
import { draftId, idChanged, idOps, isIdOp, type IdRow } from './id-draft';

/** The written values of one holder entry (spec §13.4); absent = no key. */
export interface HolderValues {
	person?: string;
	name?: string;
	as?: string;
	number?: string;
	from?: string;
	to?: string;
}

/** The keys a draft can change on an existing holder; `person` never changes. */
const EDIT_KEYS = ['name', 'as', 'number', 'from', 'to'] as const;
/** §13.0 item 1: the key order of a new holder. */
const ADD_KEYS = ['person', 'name', 'as', 'number', 'from', 'to'] as const;

/** The values of a holder as read. */
export function valuesOf(h: Holder): HolderValues {
	const out: HolderValues = {};
	for (const k of ADD_KEYS) if (h[k] !== undefined) out[k] = h[k];
	return out;
}

/** The ref that ops use for a holder read from the tree (`Holder.index` and `Holder.text`). */
export function refOf(title: string, h: Holder): HolderRef {
	return {
		title,
		index: h.index,
		...(h.person !== undefined ? { person: h.person } : {}),
		...(h.name !== undefined ? { name: h.name } : {}),
		...(h.text !== undefined ? { text: h.text } : {}),
	};
}

/** `rulerName` for draft values (it needs no index). */
export const rulerOf = (v: HolderValues, personName: string | undefined): string => rulerName({ ...v, index: 0 }, personName);

/** The person's name when the holder is in the tree; undefined for a holder who is not. */
export function personNameOf(g: FamilyGraph | null, v: HolderValues): string | undefined {
	return v.person !== undefined ? g?.byId.get(v.person)?.name : undefined;
}

/** What a holder row shows (spec §13.4): "Aldric II", the full name if different, the reign, and if the holder is in the tree. */
export interface HolderText {
	/** The ruler name with the number ("Aldric II"). */
	ruler: string;
	/** D122: the sobriquet of the person, bare text (the row adds the curly marks); absent for a holder who is not in the tree. */
	sobriquet?: string;
	/** The full name when it says more than the ruler name, else undefined. */
	full?: string;
	/** `entryReign`: "1131–1160", "from 1131", "until 1160", or undefined. */
	reign?: string;
	inTree: boolean;
}

/** The text lines of a holder row in the Titles window. */
export function holderText(g: FamilyGraph | null, v: HolderValues): HolderText {
	const personName = personNameOf(g, v);
	const inTree = personName !== undefined;
	const plain = rulerOf(v, personName);
	const base = plain || v.person || '';
	const ruler = v.number !== undefined ? `${base} ${v.number}`.trim() : base;
	const fullName = personName ?? v.name ?? v.person ?? '';
	const reign = entryReign({ ...v, index: 0 });
	const sobriquet = v.person !== undefined ? g?.byId.get(v.person)?.sobriquet : undefined;
	return { ruler, ...(sobriquet !== undefined ? { sobriquet } : {}), ...(fullName && fullName !== base ? { full: fullName } : {}), ...(reign !== undefined ? { reign } : {}), inTree };
}

/** The fields of the holder form (all text as typed). `name` only for a holder who is not in the tree. */
export interface HolderFormFields {
	number: string;
	ruler: string;
	from: string;
	to: string;
	name?: string;
}

/** What the form shows first: the values, and the ruler name that the plugin uses now (§13.5). */
export function formStart(v: HolderValues, personName: string | undefined, askName: boolean): HolderFormFields {
	return { number: v.number ?? '', ruler: rulerOf(v, personName), from: v.from ?? '', to: v.to ?? '', ...(askName ? { name: v.name ?? '' } : {}) };
}

const clean = (s: string | undefined) => {
	const t = (s ?? '').trim();
	return t === '' ? undefined : t;
};

/**
 * The holder values after the form (spec §13.5). `as` changes only when the owner changed the ruler
 * name: the same text as at the start keeps `as` as it was; the default ruler name (the first word
 * of the person's name, or the holder's name) or an empty field removes it; any other text is `as`.
 */
export function formResult(before: HolderValues, personName: string | undefined, f: HolderFormFields): HolderValues {
	const out: HolderValues = { ...before };
	const set = (k: keyof HolderValues, v: string | undefined) => {
		if (v === undefined) delete out[k];
		else out[k] = v;
	};
	set('number', clean(f.number));
	set('from', clean(f.from));
	set('to', clean(f.to));
	if (f.name !== undefined) set('name', clean(f.name));
	const ruler = f.ruler.trim();
	const atStart = rulerOf(before, personName);
	const plain = rulerOf({ ...out, as: undefined }, personName);
	if (ruler === atStart) set('as', before.as);
	else if (ruler === '' || ruler === plain) set('as', undefined);
	else set('as', ruler);
	return out;
}

/** The live preview under the form's fields (§13.5): "Ser Gareth Orsini shows as: Gareth I". */
export function previewParts(personName: string | undefined, f: HolderFormFields): { full: string; shown: string } {
	const name = clean(f.name);
	const plain = rulerOf({ ...(name !== undefined ? { name } : {}) }, personName);
	const ruler = f.ruler.trim() || plain;
	const number = f.number.trim();
	return { full: personName ?? name ?? '', shown: number ? `${ruler} ${number}` : ruler };
}

/** The fields an edit writes: only the changed ones, `null` for a removed key. */
export function changedFields(base: HolderValues, now: HolderValues): HolderFields {
	const out: HolderFields = {};
	for (const k of EDIT_KEYS) if (base[k] !== now[k]) out[k] = now[k] ?? null;
	return out;
}

/** The fields of a new holder, in the §13.0 key order. */
export function addFields(v: HolderValues): HolderFields {
	const out: HolderFields = {};
	for (const k of ADD_KEYS) if (v[k] !== undefined) out[k] = v[k];
	return out;
}

// ---------- the Titles window's draft ----------

/** One holder of the window's draft. `ref` null: a holder added in this window. */
export interface HolderRow {
	key: string;
	ref: HolderRef | null;
	/** The values as read; null for a new holder. */
	base: HolderValues | null;
	values: HolderValues;
}

/** One title of the window's draft. `id` null: a title added in this window. */
export interface TitleRow {
	key: string;
	id: string | null;
	/** The Id field as typed (§13.17 rule 5); absent for a title that is new in the draft. */
	idDraft?: string;
	name: string;
	/** The name as read; null for a new title. */
	baseName: string | null;
	/**
	 * The "Name of the list" field as typed (D64): the heading of the holder list and the table note
	 * name. Empty when the title has no plural of its own (none is written, or it is the name).
	 */
	plural: string;
	/** The field as read; null for a new title. */
	basePlural: string | null;
	/** The "Name for a man" field as typed (D66, `male-name`); empty when none is written. */
	maleName: string;
	/** The field as read; null for a new title. */
	baseMaleName: string | null;
	/** The "Name for a woman" field as typed (D65, `female-name`); empty when none is written. */
	femaleName: string;
	/** The field as read; null for a new title. */
	baseFemaleName: string | null;
	deleted: boolean;
	holders: HolderRow[];
	/** The holders as read, in order (copies): a move, a removal or an edit changes the list. */
	baseRows: HolderRow[];
}

/** The window's rows for the titles of a tree (the titles the tree uses, spec §13.4). */
export function titleRows(g: FamilyGraph, key: () => string): TitleRow[] {
	return (g.titles ?? []).map((t) => rowOf(t, key));
}

function rowOf(t: Title, key: () => string): TitleRow {
	const holders = t.holders.map((h): HolderRow => ({ key: key(), ref: refOf(t.id, h), base: valuesOf(h), values: valuesOf(h) }));
	// The parser gives the name as the plural when none is written: the field then starts empty.
	const plural = t.plural.trim() === t.name.trim() ? '' : t.plural;
	const maleName = t.maleName ?? '';
	const femaleName = t.femaleName ?? '';
	return { key: key(), id: t.id, idDraft: t.id, name: t.name, baseName: t.name, plural, basePlural: plural, maleName, baseMaleName: maleName, femaleName, baseFemaleName: femaleName, deleted: false, holders, baseRows: holders.map((h) => ({ ...h, values: { ...h.values } })) };
}

/** The row as the Id logic sees it. */
export const titleIdRow = (t: TitleRow): IdRow => ({ key: t.key, id: t.id, idDraft: t.idDraft, name: t.name, deleted: t.deleted });

/** The plural that Save writes for the draft (D64): null for an empty field or the title name. */
export function pluralOf(t: TitleRow): string | null {
	const p = t.plural.trim();
	return p === '' || p === t.name.trim() ? null : p;
}

/** The `male-name` that Save writes for the draft (D66): null for an empty field. */
export function maleNameOf(t: TitleRow): string | null {
	const m = t.maleName.trim();
	return m === '' ? null : m;
}

/** The `female-name` that Save writes for the draft (D65): null for an empty field. */
export function femaleNameOf(t: TitleRow): string | null {
	const f = t.femaleName.trim();
	return f === '' ? null : f;
}

/** The heading of the title's holder list now: the draft plural, else the draft name ('' when both are empty). */
export function listName(t: TitleRow): string {
	return pluralOf(t) ?? t.name.trim();
}

/** The name of the saved list: the table note is made from the saved tree, not from the draft. */
export function savedListName(t: TitleRow): string {
	return t.basePlural?.trim() || t.baseName || t.name.trim();
}

const sameValues = (a: HolderValues | null, b: HolderValues) => !!a && Object.keys(changedFields(a, b)).length === 0;

/** True when the holder list of a title changed: order, a new or removed holder, or a changed value. */
export function holdersChanged(t: TitleRow): boolean {
	if (t.holders.length !== t.baseRows.length) return true;
	return t.holders.some((h, i) => h.key !== t.baseRows[i].key || !h.ref || !sameValues(h.base, h.values));
}

const nameChanged = (t: TitleRow) => t.baseName !== null && t.name.trim() !== t.baseName;
/** The owner typed in the "Name of the list" field (a stale Save keeps the text). */
const pluralEdited = (t: TitleRow) => t.basePlural !== null && t.plural.trim() !== t.basePlural.trim();
/** The plural to write differs from the one read; a value equal to the name counts as none. */
const pluralChanged = (t: TitleRow) => t.basePlural !== null && pluralOf(t) !== (t.basePlural.trim() || null);
/** The owner typed in the "Name for a man" field (D66); a stale Save keeps the text. */
const maleEdited = (t: TitleRow) => t.baseMaleName !== null && t.maleName.trim() !== t.baseMaleName.trim();
const maleChanged = (t: TitleRow) => t.baseMaleName !== null && maleNameOf(t) !== (t.baseMaleName.trim() || null);
/** The owner typed in the "Name for a woman" field (D65); a stale Save keeps the text. */
const femaleEdited = (t: TitleRow) => t.baseFemaleName !== null && t.femaleName.trim() !== t.baseFemaleName.trim();
const femaleChanged = (t: TitleRow) => t.baseFemaleName !== null && femaleNameOf(t) !== (t.baseFemaleName.trim() || null);

/** True when Save has something to write. */
export function draftChanged(rows: readonly TitleRow[]): boolean {
	return rows.some((t) => (t.id === null ? !t.deleted : t.deleted || idChanged(titleIdRow(t)) || nameChanged(t) || maleChanged(t) || femaleChanged(t) || pluralChanged(t) || holdersChanged(t)));
}

/**
 * The one `batch` of Save (spec §13.4, §13.0 item 6, §13.17 rule 5): the `set-title-id` ops first (the
 * other ops of a changed title name its new id), then `edit-title`, one `set-holders` per changed
 * title (the whole final list, with changed values only), `delete-title`, and last `add-title` (ids
 * from `newId`, which gets the ids chosen before it and every draft id) with the holders of each new
 * title. Empty if nothing changed.
 */
export function windowOps(rows: readonly TitleRow[], newId: (name: string, taken: ReadonlySet<string>) => string): Op[] {
	const ids = idOps('title', rows.map(titleIdRow));
	const adds: Op[] = [];
	const addLists: Op[] = [];
	const edits: Op[] = [];
	const lists: Op[] = [];
	const deletes: Op[] = [];
	// A new title never gets an id that a changed title takes.
	const taken = new Set<string>(rows.flatMap((t) => (t.id !== null && !t.deleted && draftId(titleIdRow(t)) !== '' ? [draftId(titleIdRow(t))] : [])));
	for (const t of rows) {
		if (t.id === null) {
			if (t.deleted) continue;
			const name = t.name.trim();
			const id = newId(name, taken);
			taken.add(id);
			const maleName = maleNameOf(t);
			const femaleName = femaleNameOf(t);
			const plural = pluralOf(t);
			adds.push({ kind: 'add-title', id, name, ...(maleName !== null ? { maleName } : {}), ...(femaleName !== null ? { femaleName } : {}), ...(plural !== null ? { plural } : {}) });
			// A new title gets its `holders` key only with its first holder.
			if (t.holders.length) addLists.push({ kind: 'set-holders', title: id, items: t.holders.map((h) => ({ add: addFields(h.values) })) });
			continue;
		}
		if (t.deleted) {
			deletes.push({ kind: 'delete-title', id: t.id });
			continue;
		}
		// After its id op the title has its new id.
		const id = idChanged(titleIdRow(t)) ? draftId(titleIdRow(t)) : t.id;
		if (nameChanged(t) || maleChanged(t) || femaleChanged(t) || pluralChanged(t)) {
			// `null` removes the key: an empty field writes no male-name or female-name (D65, D66); an empty field or the title name writes no plural (D64).
			edits.push({
				kind: 'edit-title',
				id,
				...(nameChanged(t) ? { name: t.name.trim() } : {}),
				...(maleChanged(t) ? { maleName: maleNameOf(t) } : {}),
				...(femaleChanged(t) ? { femaleName: femaleNameOf(t) } : {}),
				...(pluralChanged(t) ? { plural: pluralOf(t) } : {}),
			});
		}
		if (!holdersChanged(t)) continue;
		const items = t.holders.map((h) => {
			if (!h.ref || !h.base) return { add: addFields(h.values) };
			// A holder ref names the title by its id: the new one, after the id op.
			const ref = id === t.id ? h.ref : { ...h.ref, title: id };
			const fields = changedFields(h.base, h.values);
			return Object.keys(fields).length ? { ref, fields } : { ref };
		});
		lists.push({ kind: 'set-holders', title: id, items });
	}
	return [...ids, ...edits, ...lists, ...deletes, ...adds, ...addLists];
}

/** The draft rows whose title name is empty and must be entered before Save. */
export function emptyNames(rows: readonly TitleRow[]): TitleRow[] {
	return rows.filter((t) => !t.deleted && t.name.trim() === '' && (t.id === null || nameChanged(t)));
}

/**
 * The draft on a tree that changed under the window (spec §6.1 stale write): `fresh` is the new
 * tree's rows. A title the owner changed keeps the owner's name, names for a man and a woman, list name and holder list; each of its holders
 * is found again by who it names and its text (else by its place among that person's entries); a
 * holder that is gone leaves the list; a holder added elsewhere goes at the end, so Save never removes
 * it. A title deleted elsewhere leaves the draft; new titles stay.
 */
export function rebase(rows: readonly TitleRow[], fresh: readonly TitleRow[]): TitleRow[] {
	const old = new Map(rows.filter((t) => t.id !== null).map((t) => [t.id!, t]));
	const out: TitleRow[] = [];
	for (const f of fresh) {
		const was = old.get(f.id!);
		if (!was) {
			out.push(f);
			continue;
		}
		const name = nameChanged(was) ? was.name : f.name;
		// An id the user typed stays; else the row shows the new saved id.
		const idDraft = (was.idDraft ?? was.id!).trim() !== was.id ? was.idDraft : f.id!;
		const plural = pluralEdited(was) ? was.plural : f.plural;
		const maleName = maleEdited(was) ? was.maleName : f.maleName;
		const femaleName = femaleEdited(was) ? was.femaleName : f.femaleName;
		if (!holdersChanged(was)) {
			out.push({ ...f, key: was.key, idDraft, name, plural, maleName, femaleName, deleted: was.deleted });
			continue;
		}
		// Every holder as read is found again first, also those the draft removed: they stay removed.
		// Two passes: an entry with the same text must not lose it to an earlier entry of the same
		// person that is gone and falls back on "the next one of that person".
		const pool = [...f.holders];
		const hits = new Map<string, HolderRow>();
		for (const bySameText of [true, false]) {
			for (const b of was.baseRows) {
				if (hits.has(b.key)) continue;
				const hit = matchHolder(pool, b, bySameText);
				if (!hit) continue;
				pool.splice(pool.indexOf(hit), 1);
				hits.set(b.key, hit);
			}
		}
		const holders: HolderRow[] = [];
		for (const h of was.holders) {
			if (!h.ref || !h.base) {
				holders.push(h);
				continue;
			}
			const hit = hits.get(h.key);
			if (!hit) continue;
			const values: HolderValues = { ...hit.values };
			// A value the owner changed wins; the others take the new text.
			for (const k of ADD_KEYS) {
				if (h.values[k] === h.base[k]) continue;
				if (h.values[k] === undefined) delete values[k];
				else values[k] = h.values[k];
			}
			holders.push({ key: h.key, ref: hit.ref, base: hit.base, values });
		}
		// A holder added elsewhere goes at the end, so Save does not remove it.
		holders.push(...pool);
		const keyOf = (fh: HolderRow) => [...hits].find(([, v]) => v === fh)?.[0] ?? fh.key;
		const baseRows = f.holders.map((fh) => ({ ...fh, key: keyOf(fh), values: { ...fh.values } }));
		out.push({ ...f, key: was.key, idDraft, name, plural, maleName, femaleName, deleted: was.deleted, holders, baseRows });
	}
	out.push(...rows.filter((t) => t.id === null));
	return out;
}

const who = (v: HolderValues | null) => (v?.person !== undefined ? `p:${v.person}` : `n:${v?.name ?? ''}`);

/** The fresh holder that is the holder `b` as read: with `bySameText`, the same person (or name) and text; else the next one of that person. */
function matchHolder(pool: readonly HolderRow[], b: HolderRow, bySameText: boolean): HolderRow | undefined {
	const same = pool.filter((x) => who(x.base) === who(b.base));
	if (!bySameText) return same[0];
	return b.ref?.text !== undefined ? same.find((x) => x.ref?.text === b.ref!.text) : undefined;
}

/**
 * Save's ops, with an id for each holder person who has no written id (spec §8: the tree names them
 * `~N` after their place in the list, and a `~N` written in `holders` names nobody). Like the edit
 * sheet, the same write first gives each such person an id (`set-person-fields`), then names them by
 * it. `data` is the body as plain data (`parseBody`).
 */
export function withHolderIds(ops: readonly Op[], g: FamilyGraph, data: unknown): Op[] {
	const people = isMap(data) && Array.isArray(data.people) ? (data.people as Raw[]) : [];
	const unwritten = (id: string) => {
		const p = g.byId.get(id);
		if (!p) return false;
		const raw = people[p.index];
		return str(isMap(raw) ? raw.id : undefined) !== id;
	};
	const used = new Set<string>(isMap(data) ? referencedIds(data) : []);
	const ids = new Map<string, string>();
	const see = (person: string | null | undefined) => {
		if (typeof person !== 'string' || ids.has(person) || !unwritten(person)) return;
		const next = nextPersonId(used);
		used.add(next);
		ids.set(person, next);
	};
	for (const op of ops) if (op.kind === 'set-holders') for (const item of op.items) see('add' in item ? item.add.person : item.fields?.person);
	if (!ids.size) return [...ops];
	const map = (fields: HolderFields): HolderFields => (typeof fields.person === 'string' && ids.has(fields.person) ? { ...fields, person: ids.get(fields.person)! } : fields);
	const give = [...ids].map(([id, next]): Op => ({ kind: 'set-person-fields', id, fields: { id: next } }));
	// The id changes of titles stay first (§13.17 rule 5); they name no holder person.
	const lead = ops.filter(isIdOp);
	const named = ops.filter((op) => !isIdOp(op)).map((op): Op => (op.kind === 'set-holders' ? { ...op, items: op.items.map((item) => ('add' in item ? { add: map(item.add) } : item.fields ? { ...item, fields: map(item.fields) } : item)) } : op));
	return [...lead, ...give, ...named];
}
