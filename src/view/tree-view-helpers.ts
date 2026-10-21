/*
 * Small pure helpers of the tree view (`src/obsidian/tree-view.ts`), moved out of it in WP-4 step 4.3 to keep that file within its size ceiling:
 * what the drawn graph holds (portraits, arms, reigns), the keys and labels of pictures and fold controls, the finder's line as the scene marks it, and the
 * rectangle around cards. None of them reads the page or Obsidian.
 */

import type { FamilyGraph } from '../core/derive';
import type { FoldControl } from '../core/folds';
import type { PictureOwner } from '../core/pictures';
import type { RelationLine } from '../core/relations';
import type { CardLabel } from '../core/titles';
import type { PersonBox, Rect } from '../layout/model';
import type { SceneOptions } from '../render/dom/scene';
import { FOLD_UI } from '../render/ui-text';
import { FIT_MARGIN } from '../render/view-math';

/** The drawn graph has a person with a portrait (O10): only then does "Show portraits on cards" change its layout. */
export function hasPortraits(g: FamilyGraph | null): boolean {
	return !!g?.people.some((p) => !!p.portrait);
}

/** The drawn graph has arms that a card could show (a house with arms, or a person with personal arms): only then does "Arms on cards" change its layout. */
export function hasArms(g: FamilyGraph | null): boolean {
	return !!g?.people.some((p) => !!p.arms || (p.house !== undefined && !!g.houses.get(p.house)?.arms));
}

/** Tells two picture owners apart (a house and a person can share an id). */
export function ownerKey(o: PictureOwner): string {
	return o.kind === 'arms' ? `arms:${o.house.id}` : `${o.arms ? 'person-arms' : 'portrait'}:${o.person.id}`;
}

/** Some card shows a reign (spec §13.3): "Show dates on cards" then changes the title text lines. */
export function hasReign(labels: ReadonlyMap<string, CardLabel> | undefined): boolean {
	for (const l of labels?.values() ?? []) if (l.reign !== undefined) return true;
	return false;
}

/** F16: the accessible name and the tooltip of a fold control, from the parents' names. */
export function foldLabel(c: FoldControl, names: readonly string[]): string {
	return c.folded ? FOLD_UI.showLabel(names, c.count) : FOLD_UI.hideLabel(names);
}

/** The finder's line as the scene marks it (D47); `fade` for "Show in the whole tree". */
export function lineMarks(line: RelationLine, fade: boolean): NonNullable<SceneOptions['line']> {
	return { people: new Set(line.people), unions: new Set(line.unions), links: new Set(line.links.map((l) => `${l.parent}\u0000${l.child}`)), ...(fade ? { fade: true } : {}) };
}

/** The rectangle around `boxes`, with the tree's margin. */
export function around(boxes: readonly Rect[], margin = FIT_MARGIN): Rect {
	const x0 = Math.min(...boxes.map((b) => b.x));
	const y0 = Math.min(...boxes.map((b) => b.y));
	const x1 = Math.max(...boxes.map((b) => b.x + b.w));
	const y1 = Math.max(...boxes.map((b) => b.y + b.h));
	return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

/** The drawn cards of `ids`, in the same order; people with no card are left out. */
export function boxesOf(persons: ReadonlyMap<string, PersonBox>, ids: Iterable<string>): PersonBox[] {
	return [...ids].map((id) => persons.get(id)).filter((b): b is PersonBox => !!b);
}
