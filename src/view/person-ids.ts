/*
 * New ids for people who have no written id (spec §8, D104). A person with no written id is named `~N` after
 * their place in the list, and a `~N` written as a reference names nobody. So a write that names such a person
 * first gives them an id. The edit sheet and the Titles window share this rule. No `obsidian` import, so vitest
 * runs it.
 */

import type { FamilyGraph } from '../core/derive';
import { nextPersonId } from '../core/id-gen';
import { referencedIds } from '../core/parse';
import { isMap, str, type Raw } from '../core/tolerate';

/** True for a person with no written id: the tree names them `~N`. `data` is the body as plain data (`parseBody`). */
export function hasNoWrittenId(g: FamilyGraph, data: unknown, id: string): boolean {
	const p = g.byId.get(id);
	if (!p || !isMap(data) || !Array.isArray(data.people)) return false;
	const raw = data.people[p.index] as Raw;
	return str(isMap(raw) ? raw.id : undefined) !== id;
}

/**
 * The new id of each person in `names` who has no written id, in the order of `names` (D104: the first person gets the
 * lowest free number). A name that is not a person in the tree, or who has an id, gets none. `taken` are more ids that
 * a new id must not be, besides every id and reference written in the block.
 */
export function idsForPeople(g: FamilyGraph, data: unknown, names: Iterable<string | null | undefined>, taken: Iterable<string> = []): Map<string, string> {
	const ids = new Map<string, string>();
	const used = new Set<string>([...(isMap(data) ? referencedIds(data) : []), ...taken]);
	for (const id of names) {
		if (typeof id !== 'string' || ids.has(id) || !hasNoWrittenId(g, data, id)) continue;
		const next = nextPersonId(used);
		used.add(next);
		ids.set(id, next);
	}
	return ids;
}
