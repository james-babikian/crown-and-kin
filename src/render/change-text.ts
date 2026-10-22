/*
 * The texts of the text line below Details in the person window (spec §0 D267): what an action that writes at once changed (Add child, Add partner, Add
 * parent, "This is me"), and the Undo of that line. They follow the rules for plugin text (Simplified Technical English, ASD-STE100). One table, so a later session finds every word in one place.
 */

import { quote } from '../core/quote';

/** The word for the person who is added, by the type of the parent link. */
const ADDED_AS_PARENT: Record<string, string> = { birth: 'a parent', adoptive: 'an adoptive parent', ward: 'a guardian', rumoured: 'a rumoured parent' };
const ADDED_AS_CHILD: Record<string, string> = { birth: 'a child', adoptive: 'an adoptive child', ward: 'a ward', rumoured: 'a rumoured child' };

/**
 * The text line of the person window after Add child, Add partner, Add parent and "This is me" (spec §0 D267): it says what changed and offers Undo.
 * It stands below Details until the window closes. A later action of this kind replaces it.
 */
export const CHANGE_UI = {
	addedChild: (child: string, parents: string, type: string) => `The plugin added ${child} as ${ADDED_AS_CHILD[type] ?? 'a child'} of ${parents}.`,
	addedParent: (parent: string, child: string, type: string) => `The plugin added ${parent} as ${ADDED_AS_PARENT[type] ?? 'a parent'} of ${child}.`,
	/** Add parent that also added the marriage of the new parent and the other parent of the child (spec §6.4); one sentence, the Undo takes both away. */
	addedParentAndMarriage: (parent: string, child: string, type: string, other: string) =>
		`The plugin added ${parent} as ${ADDED_AS_PARENT[type] ?? 'a parent'} of ${child}. It also added a marriage of ${parent} and ${other}.`,
	addedPartner: (partner: string, other: string) => `The plugin added ${partner} as a partner of ${other}.`,
	markedMe: (name: string) => `The plugin marked ${name} with ${quote('This is me')}.`,
	unmarkedMe: (name: string) => `The plugin removed the mark ${quote('This is me')} from ${name}.`,
	/** The Undo button begins with its visible text, so voice control finds it. */
	undoLabel: 'Undo this change to the tree',
	/** The text line says what the Undo did, in the same place. */
	undone: 'The plugin undid the last change to the tree.',
} as const;
