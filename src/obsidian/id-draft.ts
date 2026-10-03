/*
 * The pure part of the Id change of the Houses window and the Titles window (spec §13.17 rule 5,
 * D109, D110): which ids the draft changes, which of them is refused and why, what the button "Make id
 * from the name" gives, the `set-house-id` / `set-title-id` ops, and which refusal text a failed
 * write gets. No `obsidian` import, so vitest runs it; `houses-window.ts`, `titles-window.ts` and
 * `titles-draft.ts` use it.
 */

import type { Op } from '../core/edit';
import { checkNewId, makeIdFromName } from '../core/id-gen';
import { isMap, str, type Raw } from '../core/tolerate';
import { ID_UI } from '../render/ui-text';

/** Which kind of item a window edits. */
export type IdKind = 'house' | 'title';

/** Why a draft id is refused: the three codes of `checkNewId`. */
export type IdReason = 'empty' | 'characters' | 'taken';

/** What the id logic needs of a row of either window. `id` null: a row that is not saved. */
export interface IdRow {
	key: string;
	id: string | null;
	/** The Id field as typed; absent for a row that is not saved. */
	idDraft?: string;
	name: string;
	/** Marked for deletion: the row sends no id change, but its saved id stays taken. */
	deleted: boolean;
}

/** The id in the field, with the spaces at both ends removed. */
export const draftId = (r: IdRow): string => (r.idDraft ?? r.id ?? '').trim();

/** True if the row sends an id change: a saved row that is not deleted and whose field differs from the saved id. */
export function idChanged(r: IdRow): boolean {
	return r.id !== null && !r.deleted && r.idDraft !== undefined && r.idDraft.trim() !== r.id;
}

/**
 * The ids that rows not yet saved would get, by key, in row order. They are made from the saved ids
 * only: an id that a changed row takes must not be the one a new row would get.
 */
function newRowIds(kind: IdKind, rows: readonly IdRow[]): Map<string, string> {
	const taken = new Set<string>(rows.flatMap((r) => (r.id !== null ? [r.id] : [])));
	const out = new Map<string, string>();
	for (const r of rows) {
		if (r.id !== null || r.deleted || r.name.trim() === '') continue;
		const id = makeIdFromName(kind, r.name.trim(), taken);
		taken.add(id);
		out.set(r.key, id);
	}
	return out;
}

/**
 * The ids that are taken for `row` (rule 5): the saved ids of all other rows (also rows marked for
 * deletion), the draft ids of the other rows, the ids that new rows would get, and the values that
 * people name which no item has (`dangling`). The saved id of `row` itself is not in the set.
 */
function takenFor(rows: readonly IdRow[], row: IdRow, dangling: Iterable<string>, fresh: ReadonlyMap<string, string>): Set<string> {
	const taken = new Set<string>(dangling);
	for (const r of rows) {
		if (r.key === row.key) continue;
		if (r.id !== null) taken.add(r.id);
		if (r.id !== null && !r.deleted) {
			const d = draftId(r);
			if (d !== '') taken.add(d);
		}
	}
	for (const id of fresh.values()) taken.add(id);
	return taken;
}

/** The refused id drafts, by row key. A row with an unchanged field is never checked. */
export function idProblems(kind: IdKind, rows: readonly IdRow[], dangling: Iterable<string>): Map<string, IdReason> {
	const out = new Map<string, IdReason>();
	const fresh = newRowIds(kind, rows);
	const names = [...dangling];
	for (const r of rows) {
		if (!idChanged(r)) continue;
		const why = checkNewId(draftId(r), takenFor(rows, r, names, fresh));
		if (why !== null) out.set(r.key, why);
	}
	return out;
}

/** Why `value` would be refused as the id of `row` (the small Id window checks while the owner types); null when it is allowed. */
export function idProblemFor(kind: IdKind, rows: readonly IdRow[], row: IdRow, value: string, dangling: Iterable<string>): IdReason | null {
	const probe = rows.map((r) => (r.key === row.key ? { ...r, idDraft: value } : r));
	return idProblems(kind, probe, dangling).get(row.key) ?? null;
}

/**
 * What the button "Make id from the name" puts in the field of `row`: the id that a new item with the
 * draft name would get, also unused by the other drafts. Null when the name is empty.
 */
export function idFromName(kind: IdKind, rows: readonly IdRow[], row: IdRow, dangling: Iterable<string>): string | null {
	const name = row.name.trim();
	if (name === '') return null;
	return makeIdFromName(kind, name, takenFor(rows, row, dangling, newRowIds(kind, rows)));
}

/** The `set-house-id` or `set-title-id` ops of the draft, in row order. Rows that sent no change are not in the list. */
export function idOps(kind: IdKind, rows: readonly IdRow[]): Op[] {
	const out: Op[] = [];
	for (const r of rows) {
		if (!idChanged(r)) continue;
		out.push(kind === 'house' ? { kind: 'set-house-id', id: r.id!, newId: draftId(r) } : { kind: 'set-title-id', id: r.id!, newId: draftId(r) });
	}
	return out;
}

/** True for the two ops that change an id. */
export const isIdOp = (op: Op): boolean => op.kind === 'set-house-id' || op.kind === 'set-title-id';

/** The ids that people name (`house` or `card-title`) when no item has them: such an id is taken, so no new id can join the people by accident. */
export function danglingIds(data: unknown, kind: IdKind): string[] {
	if (!isMap(data as Raw)) return [];
	const d = data as Record<string, Raw>;
	const items = Array.isArray(d[kind === 'house' ? 'houses' : 'titles']) ? (d[kind === 'house' ? 'houses' : 'titles'] as Raw[]) : [];
	const have = new Set<string>();
	for (const it of items) {
		const id = isMap(it) ? str(it.id) : undefined;
		if (id !== undefined) have.add(id);
	}
	const key = kind === 'house' ? 'house' : 'card-title';
	const out = new Set<string>();
	for (const p of Array.isArray(d.people) ? (d.people as Raw[]) : []) {
		const v = isMap(p) ? str(p[key]) : undefined;
		if (v !== undefined && !have.has(v)) out.add(v);
	}
	return [...out];
}

/** The text of a refused id (a row's message), by reason. */
export const reasonText = (why: IdReason): string => ID_UI[why];

/**
 * The text for a failed write that carried id ops, or null when the refusal is not about an id (the
 * window then uses its own text). `id-taken` and `bad-value` are never the "changed under the window"
 * case: only `unknown-house` and `unknown-title` are. Another op of the same batch can also refuse
 * with `bad-value` and the word "alias" (for example a holder list written as an alias), so the
 * match is the exact words that `id-change.ts` uses and no other op uses.
 */
export function idRefusalText(code: string, detail: string | undefined): string | null {
	if (code === 'id-taken') return ID_UI.inUse;
	if (code !== 'bad-value') return null;
	const d = detail ?? '';
	if (/^A value of this id is a YAML anchor or alias\./.test(d)) return ID_UI.anchor;
	if (/^An id has the letters a to z, digits|^The new id must be text\.$/.test(d)) return ID_UI.notAllowed;
	return null;
}
