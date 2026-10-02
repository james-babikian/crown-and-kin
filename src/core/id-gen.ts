/*
 * Generates ids for a new person, house or union (spec §6.8), from a name or, for a union, from
 * its partners' ids. `yaml-edit.ts` and `relationship-ops.ts` call these when an op adds an item;
 * `edit-sheet.ts` and `messages.ts` also use `uniqueId` and `slugify`.
 */

import { COMBINING_MARKS, foldLetters } from './fold';
import { str, type Raw, type RawMap } from './tolerate';

/** Turns a display name into a slug: "Aldric Valmont" → "aldric-valmont", "Þórr" → "thorr". */
export function slugify(name: string): string {
	const slug = foldLetters(name)
		.normalize('NFKD')
		.replace(COMBINING_MARKS, '')
		.toLowerCase()
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

/** A new id for `name` that no item of the raw list `items` has (houses and unions each have their own ids, §6.8). */
export function newIdIn(items: Raw, name: string): string {
	const taken = new Set<string>();
	if (Array.isArray(items)) for (const item of items) {
		const id = str((item as RawMap | null)?.id);
		if (id !== undefined) taken.add(id);
	}
	return uniqueId(name, taken);
}
