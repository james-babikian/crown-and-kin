/**
 * Milestone 3 contract (frozen by the supervisor; change only through the supervisor).
 *
 * Read-only questions the edit sheet and the person picker ask about one person's family
 * (§6.3 "Family", §6.4, §6.6, §6.7). Pure: no `obsidian` import. `family-query.ts` implements
 * them (WP3.2) on the derived `FamilyGraph`.
 */
import type { FamilyGraph } from './derive';
import type { ParentKind, UnionKind, UnionRef } from './edit';

export interface ParentLink {
	id: string;
	type: ParentKind;
}

export interface PartnerLink {
	partner: string;
	/** Null for an implicit union (co-parents with no union recorded). */
	union: UnionRef | null;
	type: UnionKind | string | null;
	start?: string;
	end?: string;
}

export interface SiblingPosition {
	/** Siblings in the same group (same primary union, or same single parent), in `people` order, including the person. */
	group: string[];
	index: number;
	canMoveEarlier: boolean;
	canMoveLater: boolean;
}

export interface FamilyView {
	/** Every parent entry as written, in order (valid references only). */
	parents: ParentLink[];
	/** Listed unions in `unions` order, then implicit co-parents. */
	partners: PartnerLink[];
	/** Null when the person has no siblings in their group. */
	siblings: SiblingPosition | null;
	/** Placement-eligible parent types the person has (for "Shown under", §6.3). */
	placementTypes: ParentKind[];
	/** Parent types already at the limit of 2 (disabled in Add parent, §6.4). */
	fullTypes: ParentKind[];
	/** Choices for "other parent" in Add child: partners in union order, then implicit co-parents (§6.4). "No other parent" is added by the UI. */
	otherParentChoices: string[];
}

export type FamilyOf = (g: FamilyGraph, id: string) => FamilyView | null;

export type PickerAction = 'add-parent' | 'add-child' | 'add-spouse' | 'focus' | 'find';

/**
 * People the picker must not offer (§6.6): add-parent → the person, all their descendants
 * through any parent type, and people already their parent of `parentType`; add-child → the
 * person and all their ancestors through any parent type; add-spouse → the person; focus and
 * find → nobody.
 */
export type PickerExclusions = (g: FamilyGraph, id: string, action: PickerAction, parentType?: ParentKind) => Set<string>;

/** What "Delete person" changes, for the confirmation (§6.7). */
export interface DeleteSummary {
	/** Listed unions the person is a partner in. */
	unions: number;
	/** People who list the person as a parent (any type). */
	childLinks: number;
	clearsStart: boolean;
	clearsFocus: boolean;
}

export type DescribeDelete = (g: FamilyGraph, id: string, options: { start?: string; focus?: string }) => DeleteSummary;
