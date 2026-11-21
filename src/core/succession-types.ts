/*
 * The two shapes that the succession engine and the result of the line share: the keys of a title as the engine reads them
 * (`SuccessionSpec`) and a quiet note (`SuccessionNote`). They sit here so that the engine files and `succession.ts` need no import
 * of each other. `succession.ts` exports both again, so callers keep their import path.
 */

import type { InheritRule, InheritThrough, SuccessionRule } from './succession-keys';

/** The succession keys of one title as the engine reads them; the Titles window passes its draft in the same shape. */
export interface SuccessionSpec {
	rule?: SuccessionRule;
	inherit: InheritRule;
	/** Who passes a claim on. Absent: the test of `inherit` decides. */
	inheritThrough?: InheritThrough;
	illegitimate: 'no' | 'after' | 'equal';
	adopted: boolean;
	/** Only the first holder and the people who descend from the first holder can inherit. */
	body?: boolean;
	year?: string;
	/** The named heirs in order. */
	heirs?: string[];
	/** The people who are never in the line. */
	exclude?: string[];
	/** Set by `specOf` when a written value cannot be used: the line is 'bad-rule'. */
	bad?: 'succession' | 'inherit' | 'inherit-through' | 'inherit-illegitimate';
}


/**
 * A quiet note under or above the line. The window turns `kind` and `params` into a text of
 * `SUCCESSION_UI`. Params hold person ids, except `entry` of `body-skipped`, which is the name written in the holder entry.
 * - `order-from-note` {a, b}: two neighbouring children of one parent, in line order, ordered only by the order in the note;
 *   {a, b, reason: 'same-year'} when both have the same birth year (without `reason`, a birth year is missing).
 * - `order-contradiction` {people}: birth years and the order in the note do not agree for these children, in written order.
 * - `co-rulers-not-in-line` {}: the other holders (`coRulers`) are not in the line.
 * - `born-in-reign-no-from` {parent}: the parent holds this title, but no entry has a readable start year, so the children keep their rank.
 * - `through-spouse` {holder, spouse}: the holder holds the title through the spouse; the line is for the spouse.
 * - `body-skipped` {first, entry}: with `heirs-of-body`, the first holder is `first` because the first entry `entry` is not a person in the tree.
 * - `died-no-year` {person, year} (spec §14 rule 5): the `died` text of `person` has text but no year, so the plugin counts the person as dead in `year`,
 *   the text that gives Y, as written. For a person the walk reached who is out of the line only for this reason, for a named heir who is not alive only for
 *   this reason, and for an open-branch row that this death date causes; once for a person.
 */
export interface SuccessionNote {
	kind: 'order-from-note' | 'order-contradiction' | 'co-rulers-not-in-line' | 'born-in-reign-no-from' | 'through-spouse' | 'body-skipped' | 'died-no-year';
	params: Record<string, string | string[]>;
}
