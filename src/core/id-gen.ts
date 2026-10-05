/*
 * Generates ids (spec §6.8, §13.17): a numbered id for a new person, a slug of the name for a new
 * house or title, an id made from the partners' ids for a union. It also checks an id that a
 * person types for a house or a title. `yaml-edit.ts`, `title-ops.ts` and `relationship-ops.ts`
 * call these when an op adds an item; the Houses and Titles windows call `checkNewId` and
 * `makeIdFromName`; `edit-sheet.ts` and `titles-draft.ts` call `nextPersonId`; the reader uses
 * `personIdSource` for the many examples of people with no id.
 */

import { foldForMatch } from './fold';
import { str, type Raw, type RawMap } from './tolerate';

/** Turns a display name into a slug: "Aldric Valmont" → "aldric-valmont", "Þórr" → "thorr". */
export function slugify(name: string): string {
	// The search fold lower-cases before the letter map and repeats until stable, so a capital ẞ or a letter such as Ǣ gives the same text as in search.
	const slug = foldForMatch(name)
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (slug === '') return 'person';
	return /^\d+$/.test(slug) ? `p-${slug}` : slug;
}

/** A new id for `name` that isn't in `taken`: "aldric", then "aldric-2", "aldric-3"… */
export function uniqueId(name: string, taken: ReadonlySet<string>): string {
	const base = slugify(name);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** An id of the form `p<digits>`; the digits are the number. */
const PERSON_NUMBER = /^p(\d+)$/;
/** More digits than this are not counted: the number stays exact in a double. */
const MAX_DIGITS = 15;

/**
 * The id of a new person (D104, §13.17 rule 1): `p` and the highest number of a `p<digits>` id in
 * `taken`, plus 1. `taken` holds every id the tree writes or names for a person. The result is never in `taken`.
 */
export function nextPersonId(taken: ReadonlySet<string>): string {
	return personIdSource(new Set(taken))();
}

/** The highest number of a `p<digits>` id in `taken`, 0 if there is none. */
function highestPersonNumber(taken: ReadonlySet<string>): number {
	let max = 0;
	for (const id of taken) {
		const m = typeof id === 'string' ? PERSON_NUMBER.exec(id) : null;
		if (m && m[1].length <= MAX_DIGITS) max = Math.max(max, Number(m[1]));
	}
	return max;
}

/**
 * A function that gives a new person id on each call and adds it to `taken`. The sequence is the one
 * that `nextPersonId(taken)` followed by `taken.add(id)` gives, but `taken` is scanned once, so a
 * reader that needs many ids does not take quadratic time. Later changes to `taken` by others are
 * only seen as ids that the counter must skip.
 */
export function personIdSource(taken: Set<string>): () => string {
	// Each id given is above the highest number and above all earlier ids, so a counter is enough.
	// Only ids of 15 digits can make the skip loop run: their successor is not counted above.
	let n = highestPersonNumber(taken) + 1;
	return () => {
		while (taken.has(`p${n}`)) n++;
		const id = `p${n}`;
		taken.add(id);
		n++;
		return id;
	};
}

/** The text a new title id is made from: a name with no usable letters is a "title", not a "person". */
function titleBase(name: string): string {
	return slugify(name) === 'person' && !/person/i.test(name) ? 'title' : name;
}

/** A new title id from a name that is not in `taken` (§6.8, own namespace). */
export function uniqueTitleId(name: string, taken: ReadonlySet<string>): string {
	return uniqueId(titleBase(name), taken);
}

/**
 * The id the button "Make id from the name" gives (§13.17 rule 5): what a new house, or a new title,
 * with this name would get. `taken` must not hold the item's own saved id.
 */
export function makeIdFromName(kind: 'house' | 'title', name: string, taken: ReadonlySet<string>): string {
	const text = typeof name === 'string' ? name : '';
	return kind === 'title' ? uniqueTitleId(text, taken) : uniqueId(text, taken);
}

/**
 * Why a house or title id that a person typed is refused, or null. The caller trims the text first.
 * `characters` also covers an id with no letter and no digit, such as "-".
 */
export function checkNewId(id: string, taken: ReadonlySet<string>): null | 'empty' | 'characters' | 'taken' {
	if (typeof id !== 'string' || id.trim() === '') return 'empty';
	if (!/^[a-z0-9-]+$/.test(id) || !/[a-z0-9]/.test(id)) return 'characters';
	return taken.has(id) ? 'taken' : null;
}

/** A new id for `name` that no item of the raw list `items` has (houses and unions each have their own ids, §6.8). */
export function newIdIn(items: Raw, name: string): string {
	const taken = new Set<string>();
	if (Array.isArray(items)) for (const item of items) {
		const id = str((item as RawMap | null)?.id);
		if (id !== undefined) taken.add(id);
	}
	return uniqueId(name, taken);
}
