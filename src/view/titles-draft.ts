/*
 * The pure part of the title editing (spec §13.4, §13.5): what a holder's text lines say, how the
 * holder form turns its fields into holder values (`as` only when the ruler name changed, and the tick box "Holds the title through
 * the spouse", D195), and the Titles window's draft: its rows (with the "Name for a man", D66, and the "Name for a woman", D65; the
 * window no longer shows the "Name of the list" and never writes it, so a written `plural` stays, D201), whether it changed, the one `batch` that Save writes
 * (with ids for holder people who have none), the Id field of each title (§13.17 rule 5, D109), and how the draft follows a tree that changed under the window. No `obsidian` import, so vitest runs it;
 * `titles-window.ts`, `holder-form.ts` and `sheet-titles.ts` use it.
 */

import type { FamilyGraph } from '../core/derive';
import type { EditTitle, HolderFields, HolderRef, Op } from '../core/edit';
import type { SuccessionSpec } from '../core/succession';
import { readInherit, readRule, type InheritIllegitimate, type InheritRule, type InheritThrough, type SuccessionRule } from '../core/succession-keys';
import { sameList } from '../core/same-list';
import { entryReign, rulerName } from '../core/titles';
import { entryReignText, isolateReign } from '../render/tree-info';
import type { Holder, Title } from '../core/types';
import { draftId, idChanged, idOps, isIdOp, type IdRow } from './id-draft';
import { idsForPeople } from './person-ids';

/** The written values of one holder entry (spec §13.4); absent = no key. */
export interface HolderValues {
	person?: string;
	name?: string;
	as?: string;
	number?: string;
	from?: string;
	to?: string;
	/** D195: the key `through-spouse`. `'true'` from the tick box, or the id of the partner as written by hand. Absent: off. */
	throughSpouse?: string;
}

/** The keys a draft can change on an existing holder; `person` never changes. */
const EDIT_KEYS = ['name', 'as', 'number', 'from', 'to', 'throughSpouse'] as const;
/** §13.0 item 1: the key order of a new holder (`through-spouse` comes after `to`). */
const ADD_KEYS = ['person', 'name', 'as', 'number', 'from', 'to', 'throughSpouse'] as const;
/** The key that a draft value is written under. */
const WRITE_KEY: Record<(typeof ADD_KEYS)[number], keyof HolderFields> = { person: 'person', name: 'name', as: 'as', number: 'number', from: 'from', to: 'to', throughSpouse: 'through-spouse' };

/** The values of a holder as read. */
export function valuesOf(h: Holder): HolderValues {
	const out: HolderValues = {};
	for (const k of ADD_KEYS) {
		if (k === 'throughSpouse') {
			if (h.throughSpouse !== undefined) out.throughSpouse = h.throughSpouse === true ? 'true' : h.throughSpouse;
		} else if (h[k] !== undefined) out[k] = h[k];
	}
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
	// Spec §14 rule 15: the dates of a reign show the name of their year; the form (holder-form.ts) keeps the written text.
	// The row draws this text, so each right-to-left date is isolated (a range keeps its written order).
	const reign = g ? isolateReign(entryReignText({ ...v, index: 0 }, g.dates, 'shown'), [v], g.dates) : entryReign({ ...v, index: 0 });
	const sobriquet = v.person !== undefined ? g?.byId.get(v.person)?.sobriquet : undefined;
	return { ruler, ...(sobriquet !== undefined ? { sobriquet } : {}), ...(fullName && fullName !== base ? { full: fullName } : {}), ...(reign !== undefined ? { reign } : {}), inTree };
}

/** True when the entry has a number or a written ruler name: the row then keeps the ruler text in bold and shows the full name under it. */
export function keepsRulerText(v: HolderValues): boolean {
	return v.number !== undefined || (v.as ?? '').trim() !== '';
}

/** The bold name of a holder row (spec §13.4): the ruler text for a numbered or written entry, else the full name. The heading of the line of succession uses it too (§13.21 rule 30). */
export function holderLead(text: HolderText, v: HolderValues): string {
	return !keepsRulerText(v) && text.full ? text.full : text.ruler;
}

/** The fields of the holder form (all text as typed). `name` only for a holder who is not in the tree. */
export interface HolderFormFields {
	number: string;
	ruler: string;
	from: string;
	to: string;
	name?: string;
	/** The tick box "Holds the title through the spouse" (D195). */
	throughSpouse?: boolean;
}

/**
 * What the form shows first: the values, and the written ruler name (§13.5, D131). The field is empty
 * when the entry has no `as`, so typed text can be told from the default, which `rulerHint` gives.
 */
export function formStart(v: HolderValues, askName: boolean): HolderFormFields {
	return { number: v.number ?? '', ruler: v.as ?? '', from: v.from ?? '', to: v.to ?? '', throughSpouse: v.throughSpouse !== undefined, ...(askName ? { name: v.name ?? '' } : {}) };
}

/** The default ruler name that the empty form field shows as a hint: the first word of the person's name, or the typed name of a holder who is not in the tree. */
export function rulerHint(personName: string | undefined, name: string | undefined): string {
	const typed = clean(name);
	return rulerOf({ ...(typed !== undefined ? { name: typed } : {}) }, personName);
}

const clean = (s: string | undefined) => {
	const t = (s ?? '').trim();
	return t === '' ? undefined : t;
};

/**
 * The holder values after the form (spec §13.5, D131). `as` changes only when the user changed the
 * ruler name: the same text as at the start keeps `as` as it was; an empty field removes it; any
 * other text is `as`. The exception: with a number, the default ruler name (the first word of the
 * person's name, or the holder's name) removes it, because the card shows it anyway. With no number
 * the default is kept, because only a written `as` makes the card show the ruler name.
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
	// The box on: a hand-written id stays (the box showed it ticked); off: the key goes (D195).
	if (!f.throughSpouse) delete out.throughSpouse;
	else if (out.throughSpouse === undefined) out.throughSpouse = 'true';
	const ruler = f.ruler.trim();
	const atStart = formStart(before, false).ruler.trim();
	const plain = rulerOf({ ...out, as: undefined }, personName);
	if (ruler === atStart) set('as', before.as);
	else if (ruler === '' || (out.number !== undefined && ruler === plain)) set('as', undefined);
	else set('as', ruler);
	return out;
}

/**
 * The live preview under the form's fields (§13.5, D131): "Ser Gareth Orsini shows as: Gareth I".
 * With no number it shows what the card will show: the ruler name that Save will write as `as`, else
 * the full name. `before` is the entry as it was, so a typed text can be told from the start text.
 */
export function previewParts(personName: string | undefined, f: HolderFormFields, before: HolderValues = {}): { full: string; shown: string } {
	const name = clean(f.name);
	const full = personName ?? name ?? '';
	const number = f.number.trim();
	if (number) {
		const plain = rulerOf({ ...(name !== undefined ? { name } : {}) }, personName);
		return { full, shown: `${f.ruler.trim() || plain} ${number}` };
	}
	return { full, shown: formResult(before, personName, f).as ?? full };
}

/** The fields an edit writes: only the changed ones, `null` for a removed key. */
export function changedFields(base: HolderValues, now: HolderValues): HolderFields {
	const out: HolderFields = {};
	for (const k of EDIT_KEYS) if (base[k] !== now[k]) out[WRITE_KEY[k]] = now[k] ?? null;
	return out;
}

/** The fields of a new holder, in the §13.0 key order. */
export function addFields(v: HolderValues): HolderFields {
	const out: HolderFields = {};
	for (const k of ADD_KEYS) if (v[k] !== undefined) out[WRITE_KEY[k]] = v[k];
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

/**
 * The succession keys of one title in the window's draft. An empty text means "not written". `'?'` is
 * a written value that the plugin cannot read: it stays as it is until the user chooses another value.
 */
export interface SuccessionDraft {
	rule: SuccessionRule | '' | '?';
	inherit: InheritRule | '' | '?';
	through: InheritThrough | '' | '?';
	illegitimate: InheritIllegitimate | '?';
	adopted: boolean;
	body: boolean;
	year: string;
	/**
	 * The text of a `year` that the plugin cannot read (a list or a map). The Year field is empty then, as `specOf` reads no
	 * year; the text is only a hint. Not a field of its own: it never counts as a change.
	 */
	yearBad?: string;
	heirs: string[];
	exclude: string[];
}

/** The fields of `SuccessionDraft`, in the order the window shows them. */
export const SUCCESSION_FIELDS = ['rule', 'inherit', 'through', 'illegitimate', 'adopted', 'body', 'year', 'heirs', 'exclude'] as const;
/** One field name of `SuccessionDraft`. */
export type SuccessionField = (typeof SUCCESSION_FIELDS)[number];

/** The succession keys of a title as read. */
export function successionOf(t: Title): SuccessionDraft {
	const bad = t.badKeys ?? {};
	return {
		rule: readRule(t.succession) ?? (t.succession !== undefined || bad.succession !== undefined ? '?' : ''),
		inherit: readInherit(t.inherit) ?? (t.inherit !== undefined || bad.inherit !== undefined ? '?' : ''),
		through: t.inheritThrough ?? (bad['inherit-through'] !== undefined ? '?' : ''),
		illegitimate: t.inheritIllegitimate ?? (bad['inherit-illegitimate'] !== undefined ? '?' : 'no'),
		adopted: t.inheritAdopted === true,
		body: t.heirsOfBody === true,
		year: t.year ?? '',
		...(t.year === undefined && bad.year !== undefined ? { yearBad: bad.year } : {}),
		heirs: [...(t.heirs ?? [])],
		exclude: [...(t.exclude ?? [])],
	};
}

const copySuccession = (s: SuccessionDraft): SuccessionDraft => ({ ...s, heirs: [...s.heirs], exclude: [...s.exclude] });

/** One title of the window's draft. `id` null: a title added in this window. */
export interface TitleRow {
	key: string;
	id: string | null;
	/** The Id field as typed (§13.17 rule 5); absent for a title that is new in the draft. */
	idDraft?: string;
	name: string;
	/** The name as read; null for a new title. */
	baseName: string | null;
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
	/** The succession keys as typed; absent for a title that is new in the draft. */
	succ?: SuccessionDraft;
	/** The succession keys as read; absent for a title that is new in the draft. */
	baseSucc?: SuccessionDraft;
}

/** The window's rows for the titles of a tree (the titles the tree uses, spec §13.4). */
export function titleRows(g: FamilyGraph, key: () => string): TitleRow[] {
	return (g.titles ?? []).map((t) => rowOf(t, key));
}

function rowOf(t: Title, key: () => string): TitleRow {
	const holders = t.holders.map((h): HolderRow => ({ key: key(), ref: refOf(t.id, h), base: valuesOf(h), values: valuesOf(h) }));
const maleName = t.maleName ?? '';
	const femaleName = t.femaleName ?? '';
	const succ = successionOf(t);
	return {
		key: key(),
		id: t.id,
		idDraft: t.id,
		name: t.name,
		baseName: t.name,
maleName,
		baseMaleName: maleName,
		femaleName,
		baseFemaleName: femaleName,
		deleted: false,
		holders,
		baseRows: holders.map((h) => ({ ...h, values: { ...h.values } })),
		succ,
		baseSucc: copySuccession(succ),
	};
}

/** The row as the Id logic sees it. */
export const titleIdRow = (t: TitleRow): IdRow => ({ key: t.key, id: t.id, idDraft: t.idDraft, name: t.name, deleted: t.deleted });

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

/** The name of the saved title: the table note is made from the saved tree, not from the draft (D201: it uses the name of the title). */
export function savedListName(t: TitleRow): string {
	return t.baseName || t.name.trim();
}

const sameValues = (a: HolderValues | null, b: HolderValues) => !!a && Object.keys(changedFields(a, b)).length === 0;

/** True when the holder list of a title changed: order, a new or removed holder, or a changed value. */
export function holdersChanged(t: TitleRow): boolean {
	if (t.holders.length !== t.baseRows.length) return true;
	return t.holders.some((h, i) => h.key !== t.baseRows[i].key || !h.ref || !sameValues(h.base, h.values));
}

const nameChanged = (t: TitleRow) => t.baseName !== null && t.name.trim() !== t.baseName;
/** The user typed in the "Name for a man" field (D66); a stale Save keeps the text. */
const maleEdited = (t: TitleRow) => t.baseMaleName !== null && t.maleName.trim() !== t.baseMaleName.trim();
const maleChanged = (t: TitleRow) => t.baseMaleName !== null && maleNameOf(t) !== (t.baseMaleName.trim() || null);
/** The user typed in the "Name for a woman" field (D65); a stale Save keeps the text. */
const femaleEdited = (t: TitleRow) => t.baseFemaleName !== null && t.femaleName.trim() !== t.baseFemaleName.trim();
const femaleChanged = (t: TitleRow) => t.baseFemaleName !== null && femaleNameOf(t) !== (t.baseFemaleName.trim() || null);


/**
 * True when one succession field differs from the field as read. "Not written" and "No preference" for `inherit` are the
 * same value, and the year compares without the spaces around it.
 */
function successionDiffers(f: SuccessionField, s: SuccessionDraft, b: SuccessionDraft): boolean {
	if (f === 'heirs' || f === 'exclude') return !sameList(s[f], b[f]);
	if (f === 'year') return s.year.trim() !== b.year.trim();
	if (f === 'inherit') return s.inherit !== b.inherit && !(b.inherit === '' && s.inherit === 'no-preference');
	return s[f] !== b[f];
}

/** The succession fields that the user changed in the draft of a saved title (the `*Changed` flags). */
export function successionChanges(t: TitleRow): SuccessionField[] {
	if (!t.succ || !t.baseSucc) return [];
	const s = t.succ;
	const b = t.baseSucc;
	return SUCCESSION_FIELDS.filter((f) => successionDiffers(f, s, b));
}

/** The keys of an `edit-title` for the changed succession fields: only the changed ones, `null` for a removed key. */
export function successionEdit(t: TitleRow): Partial<EditTitle> {
	const out: Partial<EditTitle> = {};
	const s = t.succ;
	if (!s) return out;
	for (const f of successionChanges(t)) {
		if (f === 'rule') out.succession = s.rule === '' || s.rule === '?' ? null : s.rule;
		else if (f === 'inherit') out.inherit = s.inherit === '' || s.inherit === '?' ? null : s.inherit;
		else if (f === 'through') out.inheritThrough = s.through === '' || s.through === '?' ? null : s.through;
		else if (f === 'illegitimate') out.inheritIllegitimate = s.illegitimate === '?' ? 'no' : s.illegitimate;
		else if (f === 'adopted') out.inheritAdopted = s.adopted;
		else if (f === 'body') out.heirsOfBody = s.body;
		else if (f === 'year') out.year = s.year.trim() === '' ? null : s.year.trim();
		else if (f === 'heirs') out.heirs = s.heirs.length ? [...s.heirs] : null;
		else out.exclude = s.exclude.length ? [...s.exclude] : null;
	}
	// None removes the rule and the choice of who can inherit together, whatever the window did with the second.
	if (out.succession === null && t.baseSucc && t.baseSucc.inherit !== '') out.inherit = null;
	return out;
}

/** The draft as the line engine reads it (the same shape as `specOf` gives for a saved title). */
export function draftSpec(s: SuccessionDraft): SuccessionSpec {
	const spec: SuccessionSpec = {
		inherit: s.inherit === '' || s.inherit === '?' ? 'no-preference' : s.inherit,
		illegitimate: s.illegitimate === '?' ? 'no' : s.illegitimate,
		adopted: s.adopted,
	};
	if (s.rule !== '' && s.rule !== '?') spec.rule = s.rule;
	if (s.through !== '' && s.through !== '?') spec.inheritThrough = s.through;
	if (s.body) spec.body = true;
	if (s.year.trim() !== '') spec.year = s.year.trim();
	if (s.heirs.length) spec.heirs = [...s.heirs];
	if (s.exclude.length) spec.exclude = [...s.exclude];
	if (s.rule === '?') spec.bad = 'succession';
	else if (s.inherit === '?') spec.bad = 'inherit';
	else if (s.through === '?') spec.bad = 'inherit-through';
	else if (s.illegitimate === '?') spec.bad = 'inherit-illegitimate';
	return spec;
}

/**
 * The title as the line engine reads it for the draft: the saved title with the draft's holders. An entry that validation
 * would drop (a person who is not in the tree and has no name, or an empty entry) is left out, as in `g.titles`.
 */
export function draftTitle(g: FamilyGraph, t: TitleRow): Title | null {
	const saved = t.id !== null ? g.titles?.find((x) => x.id === t.id) : undefined;
	if (!saved) return null;
	const holders: Holder[] = [];
	t.holders.forEach((h, i) => {
		const v = h.values;
		if (v.person !== undefined && !g.byId.has(v.person) && v.name === undefined) return;
		if (v.person === undefined && v.name === undefined) return;
		holders.push({ index: i, ...v });
	});
	return { ...saved, holders };
}

/** True when Save has something to write. */
export function titlesDraftChanged(rows: readonly TitleRow[]): boolean {
	return rows.some((t) =>
		t.id === null ? !t.deleted : t.deleted || idChanged(titleIdRow(t)) || nameChanged(t) || maleChanged(t) || femaleChanged(t) || holdersChanged(t) || successionChanges(t).length > 0,
	);
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
adds.push({ kind: 'add-title', id, name, ...(maleName !== null ? { maleName } : {}), ...(femaleName !== null ? { femaleName } : {}) });
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
		const succession = successionEdit(t);
		if (nameChanged(t) || maleChanged(t) || femaleChanged(t) || Object.keys(succession).length) {
			// `null` removes the key: an empty field writes no male-name or female-name (D65, D66). The window never writes `plural` (D201): a written one stays.
			// The succession keys are only the ones the user changed, so an unrelated Save never touches a hand-written key.
			edits.push({
				kind: 'edit-title',
				id,
				...(nameChanged(t) ? { name: t.name.trim() } : {}),
				...(maleChanged(t) ? { maleName: maleNameOf(t) } : {}),
				...(femaleChanged(t) ? { femaleName: femaleNameOf(t) } : {}),
...succession,
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
 * tree's rows. A title the user changed keeps the user's name, names for a man and a woman, list name and holder list; each of its holders
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
const maleName = maleEdited(was) ? was.maleName : f.maleName;
		const femaleName = femaleEdited(was) ? was.femaleName : f.femaleName;
		const succ = rebaseSuccession(was, f);
		if (!holdersChanged(was)) {
			out.push({ ...f, key: was.key, idDraft, name, maleName, femaleName, deleted: was.deleted, ...(succ ? { succ } : {}) });
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
			// A value the user changed wins; the others take the new text.
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
		out.push({ ...f, key: was.key, idDraft, name, maleName, femaleName, deleted: was.deleted, holders, baseRows, ...(succ ? { succ } : {}) });
	}
	out.push(...rows.filter((t) => t.id === null));
	return out;
}

/** The succession keys on a tree that changed under the window: a field the user changed keeps the user's value; the others take the new text. */
function rebaseSuccession(was: TitleRow, fresh: TitleRow): SuccessionDraft | undefined {
	if (!fresh.succ) return undefined;
	const changed = new Set<SuccessionField>(successionChanges(was));
	if (!was.succ || !changed.size) return fresh.succ;
	const out = copySuccession(fresh.succ);
	const mine = was.succ;
	for (const f of changed) {
		if (f === 'heirs' || f === 'exclude') out[f] = [...mine[f]];
		else if (f === 'adopted' || f === 'body') out[f] = mine[f];
		else if (f === 'year') out.year = mine.year;
		else if (f === 'rule') out.rule = mine.rule;
		else if (f === 'inherit') out.inherit = mine.inherit;
		else if (f === 'through') out.through = mine.through;
		else out.illegitimate = mine.illegitimate;
	}
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
 * Save's ops, with an id for each holder person, named heir and excluded person who has no written id (spec §8: the tree names them
 * `~N` after their place in the list, and a `~N` written in `holders` names nobody). Like the edit
 * sheet, the same write first gives each such person an id (`set-person-fields`), then names them by
 * it. `data` is the body as plain data (`parseBody`).
 */
export function withHolderIds(ops: readonly Op[], g: FamilyGraph, data: unknown): Op[] {
	const named: (string | null | undefined)[] = [];
	for (const op of ops) {
		if (op.kind === 'set-holders') for (const item of op.items) named.push('add' in item ? item.add.person : item.fields?.person);
		// A named heir and an excluded person are written by id too: a person with no written id gets one first.
		else if (op.kind === 'edit-title') named.push(...(op.heirs ?? []), ...(op.exclude ?? []));
	}
	const ids = idsForPeople(g, data, named);
	if (!ids.size) return [...ops];
	const mapIds = (list: string[] | null | undefined) => (list ? list.map((id) => ids.get(id) ?? id) : list);
	const map = (fields: HolderFields): HolderFields => (typeof fields.person === 'string' && ids.has(fields.person) ? { ...fields, person: ids.get(fields.person)! } : fields);
	const give = [...ids].map(([id, next]): Op => ({ kind: 'set-person-fields', id, fields: { id: next } }));
	// The id changes of titles stay first (§13.17 rule 5); they name no holder person.
	const lead = ops.filter(isIdOp);
	const renamed = ops
		.filter((op) => !isIdOp(op))
		.map((op): Op => {
			if (op.kind === 'set-holders') return { ...op, items: op.items.map((item) => ('add' in item ? { add: map(item.add) } : item.fields ? { ...item, fields: map(item.fields) } : item)) };
			if (op.kind === 'edit-title' && (op.heirs || op.exclude)) return { ...op, ...(op.heirs ? { heirs: mapIds(op.heirs) } : {}), ...(op.exclude ? { exclude: mapIds(op.exclude) } : {}) };
			return op;
		});
	return [...lead, ...give, ...renamed];
}
