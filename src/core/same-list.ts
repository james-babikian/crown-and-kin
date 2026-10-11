/**
 * One list comparison for the core files: used by the relation cache (to tell if two blood lines are the same) and by
 * the title edits (to skip a write that would not change the stored list). It is a leaf: it imports nothing.
 */

/** True if both lists have the same length and the same items in the same order (compared with `===`). */
export function sameList<T>(s: readonly T[], t: readonly T[]): boolean {
	if (s === t) return true;
	if (s.length !== t.length) return false;
	for (let i = 0; i < s.length; i++) if (s[i] !== t[i]) return false;
	return true;
}
