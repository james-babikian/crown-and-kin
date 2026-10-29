/*
 * The draft logic of the edit sheet that needs no window: loading the sheet's data from the
 * block text (`loadSheet`), the shape of the draft, the lookup of a partnership again in new data, and the helpers that give a person with no written id a first id
 * when a write names them (spec §6.3, §8).
 */

import type { FamilyGraph } from '../core/derive';
import { deriveDated, type DatesFor } from '../view/calendar-index';
import type { Op, UnionRef } from '../core/edit';
import { issueText } from '../core/messages';
import { parseBody, readTree, referencedIds } from '../core/parse';
import { isMap } from '../core/tolerate';
import { PLACEMENT_TYPES, type Person, type Tree } from '../core/types';
import { familyOf, type FamilyView } from '../core/family-query';
import { hasNoWrittenId, idsForPeople } from '../view/person-ids';

/** The draft fields that hold free text; a change of one is written as that text. */
export const TEXT_FIELDS = ['name', 'sobriquet', 'title', 'born', 'died', 'link', 'notes'] as const;

/** The value of `Draft.house` that stands for a house made in this window. */
export const NEW_HOUSE = '\u0000new';

/** The fields of the person window as the user edits them, before a Save. */
export interface Draft {
	name: string;
	/** D122: the model value, without the quote marks; the typed text is written as typed. */
	sobriquet: string;
	title: string;
	house: string;
	sex: string;
	born: string;
	died: string;
	illegitimate: boolean;
	/** The person died with no children (`childless`); the line of succession then shows no open branch for the person. */
	childless: boolean;
	link: string;
	/** Spec §13.7: the portrait link; '' = none. */
	portrait: string;
	/** Spec §13.13: the selected part of the portrait as written text; '' = none (the automatic part). */
	portraitCrop: string;
	/** The personal arms link; '' = none. */
	arms: string;
	notes: string;
	placement: string;
}

/** The data that the person window loads: the body, the tree, the person and the family. */
export interface Loaded {
	body: string;
	/** The body as plain data, for the id of a new house. */
	data: unknown;
	tree: Tree;
	g: FamilyGraph;
	/** The person; for a new person, a blank one that is not in the tree. */
	person: Person;
	/** Null for a new person. */
	fam: FamilyView | null;
	blocking: string[];
}

/** The result of `loadSheet`: the loaded data, an unparsable block, or the person is not in the tree. */
export type SheetLoad = { kind: 'ok'; data: Loaded } | { kind: 'invalid' } | { kind: 'gone' };

/** The new-house fields of a draft before the user types in them. */
export const blankHouse = () => ({ name: '', color: '#888888' });

/** A person with no id and no fields, the starting point for a new-person draft. */
export const blankPerson = (): Person => ({ id: '', name: '', parents: [], illegitimate: false, index: -1 });

/** The sheet's data for a person (or a new person, `id` null), or why there is none. */
export function loadSheet(body: string, id: string | null, dates?: DatesFor): SheetLoad {
	const parsed = parseBody(body);
	if (!parsed.ok) return { kind: 'invalid' };
	const tree = readTree(parsed.doc, parsed.data, body);
	const g = deriveDated(tree, dates);
	const person = id === null ? blankPerson() : g.byId.get(id);
	if (!person) return { kind: 'gone' };
	const blocking = g.issues.filter((i) => i.level === 'blocking').map(issueText);
	const fam = id === null ? null : familyOf(g, id);
	return { kind: 'ok', data: { body, data: parsed.data, tree, g, person, fam, blocking } };
}

/** The draft that starts from a loaded person. */
export function draftOf(l: Loaded): Draft {
	const p = l.person;
	return {
		name: p.name,
		sobriquet: p.sobriquet ?? '',
		title: p.title ?? '',
		house: p.house ?? '',
		sex: p.sex ?? '',
		born: p.born ?? '',
		died: p.died ?? '',
		illegitimate: p.illegitimate,
		childless: p.childless === true,
		link: p.link ?? '',
		portrait: p.portrait ?? '',
		portraitCrop: p.portraitCrop ?? '',
		arms: p.arms ?? '',
		notes: p.notes ?? '',
		placement: p.placement ?? (p.id ? l.g.placementType.get(p.id) : undefined) ?? '',
	};
}

/** Placement types the person has parents of (spec §4.3); an unknown parent type counts as birth. */
export function placementChoices(p: Person): string[] {
	const out = new Set<string>();
	for (const ref of p.parents) {
		if (ref.type === 'rumoured') continue;
		out.add((PLACEMENT_TYPES as readonly string[]).includes(ref.type) ? ref.type : 'birth');
	}
	return PLACEMENT_TYPES.filter((t) => out.has(t));
}

/**
 * Finds a chosen partnership again in new data. The same index with the same text wins; else the
 * one union with the same text. Two unions of a couple can have the same text (a second
 * partnership with no id or dates), so several text matches are ambiguous: the user must choose.
 */
export function findUnion(candidates: UnionRef[], chosen: UnionRef): UnionRef | 'ambiguous' | null {
	const exact = candidates.find((u) => u.index === chosen.index && (chosen.text === undefined || u.text === chosen.text));
	if (exact) return exact;
	if (chosen.text === undefined) return null;
	const byText = candidates.filter((u) => u.text === chosen.text);
	if (byText.length > 1) return 'ambiguous';
	return byText[0] ?? null;
}

/** Keys of an op whose values never name a person. */
export const NOT_IDS = new Set(['kind', 'fields', 'text', 'name', 'color', 'key', 'type', 'from', 'to', 'direction', 'map', 'start', 'end', 'people']);

/** A copy of `v` (ops, a relation) with every string that can name a person mapped by `f`. */
export function mapIds<T>(v: T, f: (id: string) => string, key = ''): T {
	if (NOT_IDS.has(key)) return v;
	if (typeof v === 'string') return f(v) as T;
	if (Array.isArray(v)) return v.map((x: unknown) => mapIds(x, f)) as T;
	if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapIds(x, f, k)])) as T;
	return v;
}

/** Every string of the ops that can name a person. */
export function opNames(ops: Op[]): string[] {
	const out: string[] = [];
	mapIds(ops, (s) => {
		out.push(s);
		return s;
	});
	return out;
}

/** True for a person with no written id (spec §8 warning): the tree names them `~N`, after their place in the list. */
export function unwritten(l: Loaded, id: string): boolean {
	return hasNoWrittenId(l.g, l.data, id);
}

/**
 * The `~N` name of a person with no written id after the tree text changed. `~N` follows the place
 * in the list, so an edit above the person (sync, another pane) makes `~N` another person. The person is
 * found by their written fields, else by their name; null when no one matches, or more than one, so the
 * sheet never shows or saves to another person.
 */
export function sameUnwritten(was: Loaded, id: string, now: Loaded): string | null {
	const old = was.g.byId.get(id);
	const listOf = (l: Loaded): unknown[] | null => {
		const d = l.data;
		return isMap(d) && Array.isArray(d.people) ? d.people : null;
	};
	const text = (v: unknown): string | null => {
		try {
			return JSON.stringify(v) ?? null;
		} catch {
			return null;
		}
	};
	const before = listOf(was);
	const after = listOf(now);
	if (!old || !before || !after) return null;
	const oldText = text(before[old.index]);
	const candidates = now.g.people.filter((p) => unwritten(now, p.id));
	// Identical people cannot be told apart by their text: only the same place, with nothing changed above it, is certain.
	const unchangedAbove = text(before.slice(0, old.index)) === text(after.slice(0, old.index));
	const pick = (list: Person[]): string | null => (list.length === 1 ? list[0].id : unchangedAbove ? (list.find((p) => p.id === id)?.id ?? null) : null);
	const exact = oldText === null ? [] : candidates.filter((p) => text(after[p.index]) === oldText);
	if (exact.length) return pick(exact);
	return pick(candidates.filter((p) => p.name === old.name));
}

/** Every person id and reference written in the block, and `more`: a new id must be none of them. */
export function takenIds(l: Loaded, more: Iterable<string> = []): Set<string> {
	const data = l.data;
	return new Set([...(isMap(data) ? referencedIds(data) : []), ...more]);
}

/**
 * New ids for the people in `names` that have no written id, before a write that names them. Their
 * `~N` follows their place in the list: a move or a new person above changes it, and a `~N` written
 * as a reference names nobody.
 */
export function idsFor(l: Loaded, names: Iterable<string>): Map<string, string> {
	return idsForPeople(l.g, l.data, names);
}

/** The ops of one write that first gives each person of `ids` their id, then names them by it. */
export function withIds(ops: Op[], ids: ReadonlyMap<string, string>): Op[] {
	if (!ids.size) return ops;
	const give = [...ids].map(([id, next]): Op => ({ kind: 'set-person-fields', id, fields: { id: next } }));
	return [...give, ...mapIds(ops, (s) => ids.get(s) ?? s).map((op) => holderPersons(op, ids))];
}

/** A holder's `person` sits in `fields`, which `mapIds` leaves alone (they hold names): it names a person too. */
export function holderPersons(op: Op, ids: ReadonlyMap<string, string>): Op {
	if (op.kind === 'batch') return { ...op, ops: op.ops.map((o) => holderPersons(o, ids)) };
	if ((op.kind === 'add-holder' || op.kind === 'edit-holder') && typeof op.fields.person === 'string') {
		const next = ids.get(op.fields.person);
		if (next !== undefined) return { ...op, fields: { ...op.fields, person: next } };
	}
	return op;
}

/** Every string of the ops that can name a person, also a holder's `person` (see `holderPersons`). */
export function holderNames(ops: Op[]): string[] {
	const out: string[] = [];
	for (const op of ops) {
		if (op.kind === 'batch') out.push(...holderNames(op.ops));
		else if ((op.kind === 'add-holder' || op.kind === 'edit-holder') && typeof op.fields.person === 'string') out.push(op.fields.person);
	}
	return out;
}
