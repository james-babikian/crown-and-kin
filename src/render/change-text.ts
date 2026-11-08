/*
 * The texts of the text line below Details in the person window (spec §0 D267): what an action that writes at once changed (Add child, Add partner, Add
 * parent, "This is me"), and the Undo of that line. They follow the rules for plugin text (Simplified Technical English, ASD-STE100). One table, so a later session finds every word in one place.
 */

import { quote } from '../core/quote';
import { isolateName } from './name-bidi';

/** A table value only for the table's own keys, so a type word such as "constructor" never reads an object built-in. */
export const ownText = (table: Record<string, string>, key: string): string | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);

/** The word for the person who is added, by the type of the parent link. */
const ADDED_AS_PARENT: Record<string, string> = { birth: 'a parent', adoptive: 'an adoptive parent', ward: 'a guardian', rumoured: 'a rumoured parent', begetter: 'a begetter' };
const ADDED_AS_CHILD: Record<string, string> = { birth: 'a child', adoptive: 'an adoptive child', ward: 'a ward', rumoured: 'a rumoured child', begetter: 'a begotten child' };

/** The words for a person who is added as a parent: "a parent", "an adoptive parent", "a guardian", "a rumoured parent", "a begetter". An unknown type gives "a parent". */
export const addedAsParent = (type: string): string => ownText(ADDED_AS_PARENT, type) ?? 'a parent';
const PARENT_TYPE_WORD: Record<string, string> = { birth: 'a birth parent', adoptive: 'an adoptive parent', ward: 'a guardian', rumoured: 'a rumoured parent', begetter: 'a begetter' };
/** The name of a parent type inside a sentence, with its article: "a birth parent", "an adoptive parent", "a guardian", "a rumoured parent", "a begetter". An unknown type gives "a parent of the type “x”". */
export const parentTypeWord = (type: string): string => ownText(PARENT_TYPE_WORD, type) ?? `a parent of the type ${quote(type)}`;

/** The words for a person who is added as a child: "a child", "an adoptive child", "a ward", "a rumoured child", "a begotten child". An unknown type gives "a child". */
export const addedAsChild = (type: string): string => ownText(ADDED_AS_CHILD, type) ?? 'a child';

/**
 * The text line of the person window after Add child, Add partner, Add parent and "This is me" (spec §0 D267): it says what changed and offers Undo.
 * It stands below Details until the window closes. A later action of this kind replaces it.
 */
export const CHANGE_UI = {
	/** `parents` is the list of the parents' names, each name isolated by the caller: a list is never one isolate. */
	addedChild: (child: string, parents: string, type: string) => `The plugin added ${isolateName(child)} as ${addedAsChild(type)} of ${parents}.`,
	addedParent: (parent: string, child: string, type: string) => `The plugin added ${isolateName(parent)} as ${addedAsParent(type)} of ${isolateName(child)}.`,
	/** Add parent that also added the marriage of the new parent and the other parent of the child (spec §6.4); one sentence, the Undo takes both away. */
	addedParentAndMarriage: (parent: string, child: string, type: string, other: string) =>
		`The plugin added ${isolateName(parent)} as ${addedAsParent(type)} of ${isolateName(child)}. It also added a marriage of ${isolateName(parent)} and ${isolateName(other)}.`,
	/** B-0054: the line after the user changes the kind of a parent link in the Family section. */
	changedParentType: (parent: string, child: string, from: string, to: string) =>
		`The plugin changed ${isolateName(parent)} from ${parentTypeWord(from)} to ${parentTypeWord(to)} of ${isolateName(child)}.`,
	/** B-0054: after Undo of that change; `type` is the type before the change, which Undo gave back. */
	undoneChangedParentType: (parent: string, child: string, type: string) => `The plugin changed ${isolateName(parent)} back to ${parentTypeWord(type)} of ${isolateName(child)}.`,
	addedPartner: (partner: string, other: string) => `The plugin added ${isolateName(partner)} as a partner of ${isolateName(other)}.`,
	markedMe: (name: string) => `The plugin marked ${isolateName(name)} with ${quote('This is me')}.`,
	unmarkedMe: (name: string) => `The plugin removed the mark ${quote('This is me')} from ${isolateName(name)}.`,
	/** D330 UX-03: the line after Save of a partnership window, with Undo. */
	changedPartnership: (a: string, b: string) => `The plugin changed the partnership of ${isolateName(a)} and ${isolateName(b)}.`,
	/** D330 UX-17: after Undo of Add child; `parents` is the joined names, each isolated, as in `addedChild`. */
	undoneAddedChild: (child: string, parents: string, type: string) => `The plugin undid the addition of ${isolateName(child)} as ${addedAsChild(type)} of ${parents}.`,
	/** D330 UX-17: after Undo of Add parent with no automatic marriage. */
	undoneAddedParent: (parent: string, child: string, type: string) => `The plugin undid the addition of ${isolateName(parent)} as ${addedAsParent(type)} of ${isolateName(child)}.`,
	/** D330 UX-17: after Undo of Add parent that also added the marriage of the new parent and the other parent (`other`). */
	undoneAddedParentAndMarriage: (parent: string, child: string, type: string, other: string) =>
		`The plugin undid the addition of ${isolateName(parent)} as ${addedAsParent(type)} of ${isolateName(child)}. It also removed the marriage of ${isolateName(parent)} and ${isolateName(other)}.`,
	/** D330 UX-17: after Undo of Add partner. */
	undoneAddedPartner: (partner: string, other: string) => `The plugin undid the addition of ${isolateName(partner)} as a partner of ${isolateName(other)}.`,
	/** D330 UX-17: after Undo of "This is me". */
	undoneMarkedMe: (name: string) => `The plugin undid the mark ${quote('This is me')} on ${isolateName(name)}.`,
	/** D330 UX-17: after Undo of the removal of "This is me". */
	undoneUnmarkedMe: (name: string) => `The plugin undid the removal of the mark ${quote('This is me')} from ${isolateName(name)}.`,
	/** The Undo button begins with its visible text, so voice control finds it. */
	undoLabel: 'Undo this change to the tree',
	/** The text line says what the Undo did, in the same place. */
	undone: 'The plugin undid the last change to the tree.',
} as const;
