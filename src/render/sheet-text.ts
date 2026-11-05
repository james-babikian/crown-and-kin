/*
 * Fixed text of the edit sheet and its flows: the sheet, the Family section, Add parent, child and partner, the new person, the partnership
 * editor, the delete and remove confirmations, the mark "This is me" and the note buttons.
 * Simplified Technical English (ASD-STE100) and the project word list apply. `ui-text.ts` re-exports every name, so old imports keep working.
 */

import type { DeleteSummary } from '../core/family-query';
import { quote } from '../core/quote';
import { addedAsParent, ownText } from './change-text';
import { isolateName } from './name-bidi';
import { SUCCESSION_UI } from './succession-text';
import { lowerFirst } from './text-join';
import { PERSON_PLACEHOLDER } from './view-text';
import { TITLES_UI } from './window-text';

/** The edit sheet (spec §6.3, §7.4). */
export const SHEET = {
	save: 'Save',
	/** D330 O-15: the quiet key text beside Save on a computer (Windows, Linux). */
	saveKeysCtrl: 'Ctrl+Enter',
	/** D330 O-15: the same on a Mac. */
	saveKeysCmd: 'Cmd+Enter',
	/** F6: the label of Save and the status line while a write of a large tree runs. */
	saveWait: 'Wait',
	savingStatus: 'Wait. The plugin saves your changes.',
	cancel: 'Cancel',
	close: 'Close',
	name: 'Name',
	// D98: the free text under the name. The Titles section holds titles with a number and dates.
	title: 'Title shown under the name',
	titleHint: `Write any text, for example ${quote('Warden of the East')}. For a title with a number and dates, use the Titles section below.`,
	// D122: the sobriquet shows after the name in quote marks.
	sobriquet: 'Sobriquet',
	sobriquetHint: `The card shows this text after the name, in quote marks. The plugin adds the quote marks. An example is ${quote('the Wise')}.`,
	house: 'House',
	noHouse: 'No house',
	newHouse: 'New house…',
	unknownHouse: (id: string) => `Unknown house (${id})`,
	newHouseName: 'Name of the new house',
	newHouseColour: 'Colour of the new house',
	sex: 'Sex',
	sexNone: 'Not recorded',
	sexMale: 'Male',
	sexFemale: 'Female',
	sexOther: (v: string) => `Other (${v})`,
	born: 'Born',
	died: 'Died',
	illegitimate: 'Illegitimate',
	// A person who died with no children; the line of succession then shows no open branch.
	childless: 'No children',
	childlessHint: 'If the person had no children, tick this box. The line of succession then shows no open branch for the person.',
	link: 'Linked note',
	linkPlaceholder: '[[Note name]]',
	notes: 'Notes',
	shownUnder: 'Shown under',
	shownUnderHint: 'The tree shows this person under these parents.',
	placement: { birth: 'Birth parents', adoptive: 'Adoptive parents', ward: 'Guardians' } as Record<string, string>,
	placementOther: (v: string) => `Other (${v})`,
	openLink: 'Open linked note',
	needName: 'Enter a name.',
	needHouseName: 'Enter a name for the new house.',
	discardTitle: 'Discard changes?',
	discardText: 'You did not save the changes to this person.',
	discard: 'Discard changes',
	keepEditing: 'Continue to edit',
	unnamed: 'Person with no name',
	// D106, D113 item 5: the small grey text line at the end of the sheet of a person whose ID is written.
	idLine: (id: string) => `ID: ${id}`,
} as const;

/** Names of parent types, as the sheet and the flows show them. */
const PARENT_TYPE_TEXT: Record<string, string> = { birth: 'Birth parent', adoptive: 'Adoptive parent', ward: 'Guardian', rumoured: 'Rumoured parent' };
/** Names of partnership types, as the sheet and the flows show them. */
export const UNION_TYPE_TEXT: Record<string, string> = { marriage: 'Marriage', betrothal: 'Betrothal', concubinage: 'Concubinage', affair: 'Affair' };

/** A parent type's name, or "Other (x)" for a type the plugin does not know. */
export const parentTypeText = (t: string) => ownText(PARENT_TYPE_TEXT, t) ?? `Other (${t})`;

/** "Marriage", or "Other (x)" for a type the plugin does not know; null is an implicit union. */
export function unionTypeText(t: string | null): string {
	if (t === null) return FAMILY.noPartnership;
	return ownText(UNION_TYPE_TEXT, t) ?? `Other (${t})`;
}

/** "1129–1161", "from 1129", "until 1161" or "". */
export function unionDates(start?: string, end?: string): string {
	if (start && end) return `${start}–${end}`;
	if (start) return `from ${start}`;
	if (end) return `until ${end}`;
	return '';
}

/**
 * D330 UX-03: the "ended by" part of a partner row: "ended by divorce". `endedBy` is a value of `ENDED_BY`, already gated by the caller
 * (a marriage or an unknown type word, and a value that `readEndedBy` reads). A missing or unknown value gives "".
 */
export function endedByText(endedBy: string | null | undefined): string {
	const word = endedBy ? UNION_EDIT.ended.values[endedBy] : undefined;
	return word ? `ended by ${lowerFirst(word)}` : '';
}

/** One partner row: "Marriage, from 1129", or "Marriage, 1126–1131, ended by divorce" when the caller passes the gated `endedBy`. */
export function partnerDetail(type: string | null, start?: string, end?: string, endedBy?: string | null): string {
	return [unionTypeText(type), unionDates(start, end), endedByText(endedBy)].filter(Boolean).join(', ');
}

/** The Family and Actions sections of the sheet (spec §6.3). */
export const FAMILY = {
	parents: 'Parents',
	noParents: 'This person has no recorded parents.',
	parentTypeLabel: (name: string) => `Type of parent: ${name}`,
	// C8: the name of a button starts with the text that the button shows, so voice control finds it by that text.
	removeParentLabel: (name: string) => `Remove as parent: remove ${name} as a parent`,
	partners: 'Partners',
	noPartners: 'This person has no recorded partners.',
	noPartnership: 'No recorded partnership',
	edit: 'Edit',
	editLabel: (name: string) => `Edit the partnership with ${name}`,
	removePartnershipLabel: (name: string) => `Remove partnership: remove the partnership with ${name}`,
	siblings: 'Position among siblings',
	position: (i: number, n: number) => `Position ${i} of ${n}`,
	moveEarlier: 'Move earlier',
	moveLater: 'Move later',
	/** The visible text of the "+ Add" link at each group heading (D212); the full name of each link is "Add parent", "Add child" or "Add partner". */
	addLink: 'Add',
	addParent: 'Add parent',
	addChild: 'Add child',
	addPartner: 'Add partner',
	deletePerson: 'Delete person',
} as const;

/** The steps of Add parent, Add child and Add partner (spec §6.4), and the picker (spec §6.6). */
export const FLOW = {
	cancel: 'Cancel',
	addParentTitle: 'Add a parent',
	parentTypeText: (name: string) => `Select the type of parent for ${isolateName(name)}.`,
	typeFull: (limit: number) => `This person has ${limit} parents of this type.`,
	newOrExisting: (name: string, what: string) => `Add a ${what} to ${isolateName(name)}. Select a new person or a person who is in the tree.`,
	newPerson: 'New person',
	newPersonDetail: 'Enter a person who is not in the tree.',
	existingPerson: 'Person in the tree',
	existingPersonDetail: 'Select a person who is in the tree.',
	noneToPick: 'No person in the tree fits this choice.',
	addChildTitle: 'Add a child',
	otherParentText: (name: string) => `${isolateName(name)} is one parent of this child. Select the other parent.`,
	noOtherParent: 'No other parent',
	noOtherParentDetail: (name: string) => `The child has only ${isolateName(name)} as a parent.`,
	childTypeTitle: 'Type of parent',
	childTypeText: (child: string, parents: string) => `${isolateName(child)} has birth parents now. Select how ${isolateName(parents)} are related to ${isolateName(child)}.`,
	childTypeTextOne: (child: string, parent: string) => `${isolateName(child)} has birth parents now. Select how ${isolateName(parent)} is related to ${isolateName(child)}.`,
	childTypeFull: 'The child cannot have more parents of this type.',
	alreadyChild: (child: string, parent: string) => `${isolateName(child)} is a child of ${isolateName(parent)} now.`,
	addPartnerTitle: 'Add a partner',
	unionTypeTitle: 'Type of partnership',
	unionTypeText: (a: string, b: string) => `Select the type of partnership of ${isolateName(a)} and ${isolateName(b)}.`,
	existingTitle: 'These people are already partners',
	existingText: (a: string, b: string, n: number) => (n === 1 ? `${isolateName(a)} and ${isolateName(b)} have this partnership now:` : `${isolateName(a)} and ${isolateName(b)} have these partnerships now:`),
	existingWarn: 'If you continue, the plugin adds one more partnership. It does not change the partnerships above.',
	addAnother: 'Add one more partnership',
	pickerParent: PERSON_PLACEHOLDER,
	pickerChild: PERSON_PLACEHOLDER,
	pickerPartner: PERSON_PLACEHOLDER,
	pickerEmpty: 'No person has this name.',
	/** The accessible name of the search field of every person list (the placeholder is not a name). */
	pickerSearchLabel: 'Find a person',
	createNew: (text: string) => (text.trim() ? `Create a new person ${quote(isolateName(text.trim()))}` : 'Create a new person'),
	/** D330 UX-08: the first sentence of the New or existing step of Add child, with the second sentence of `newOrExisting`; `parents` are one or two names (the second only when the user chose it in the other-parent step). */
	newOrExistingChild: (parents: readonly string[]) => `Add a child of ${parents.map(isolateName).join(' and ')}. Select a new person or a person who is in the tree.`,
	/** D330 UX-08: the same step of Add parent; `type` is the parent type, and the words are those of the text line after the write. */
	newOrExistingParent: (type: string, name: string) => `Add ${addedAsParent(type)} to ${isolateName(name)}. Select a new person or a person who is in the tree.`,
	autoUnion: (a: string, b: string) => `The plugin also added a marriage of ${isolateName(a)} and ${isolateName(b)}. To change its type, open the person window of ${isolateName(a)}. Open Family. Then select Edit under Partners.`,
} as const;

/** The sheet for a new person (spec §6.3 "New people are drafts"). */
export const NEW_SHEET = {
	titlePerson: 'New person',
	/** D330 UX-22: the placeholder of the name of a new person, under the one heading "New person". */
	namePlaceholder: 'For example: Edmund Vane',
	titleParent: 'New parent',
	titleChild: 'New child',
	titlePartner: 'New partner',
	parentOf: (type: string, child: string) => `${parentTypeText(type)} of ${isolateName(child)}`,
	childOf: (a: string, b: string | null) => (b ? `Child of ${isolateName(a)} and ${isolateName(b)}` : `Child of ${isolateName(a)}`),
	partnerOf: (name: string) => `Partner of ${isolateName(name)}`,
	unionType: 'Type of partnership',
	saveAnother: 'Save and add another child',
	savedAnother: (name: string) => `The plugin saved ${isolateName(name)}. Enter the next child.`,
	discardText: 'You did not save this new person.',
	partnership: 'Partnership of the parents',
	choosePartnership: 'Select a partnership',
	partnershipLost: 'The partnership that you selected is not in the tree now. Select the partnership again.',
	partnershipGone: 'The partnership that you selected is not in the tree now. The child will have both parents, with no recorded partnership.',
	needPartnership: 'Select the partnership of the parents.',
	relativeGone: (name: string) => `${isolateName(name)} is not in the tree now. The plugin cannot add this person as a relative of ${isolateName(name)}.`,
	relativeGoneHelp: 'You can add this person with no parents, children or partners, or select Cancel.',
	noRelatives: 'Add with no parents, children or partners',
} as const;

/** The partnership editor (spec §6.3 Partners, Edit). */
export const UNION_EDIT = {
	/** Heard by a screen reader before the two names, which are the visible title. */
	purpose: 'Edit partnership',
	of: (a: string, b: string) => `${isolateName(a)} and ${isolateName(b)}`,
	type: 'Kind',
	/** D330 O-34: the screen-reader name of the field "Kind". */
	typeLabel: 'Kind of partnership',
	start: 'Start', end: 'End',
	ended: { label: 'Ended by', none: 'Not known', values: { divorce: 'Divorce', annulment: 'Annulment', death: 'Death' } as Record<string, string>, hint: 'After a divorce or an annulment, relation names on cards start with “Former”, for example “Former husband”.' },
	gone: 'This partnership is not in the tree now. The plugin cannot save your changes.',
	discardText: 'You did not save the changes to this partnership.',
	ambiguous: 'The tree changed, and the plugin cannot find the partnership that you selected. Select Cancel. Then select Edit on the partnership again.',
} as const;

/** Delete and remove confirmations and their Notices (spec §6.7, D5). */
export const REMOVE = {
	deleteTitle: (name: string) => `Delete ${isolateName(name)}?`,
	deleteConfirm: 'Delete',
	removeConfirm: 'Remove partnership',
	cancel: 'Cancel',
	partnershipTitle: 'Remove partnership?',
	// Only the first letter changes: a type that the user wrote keeps its own capitals.
	partnershipText: (type: string, a: string, b: string) =>
		`The plugin removes the ${lowerFirst(type)} of ${isolateName(a)} and ${isolateName(b)}. If ${isolateName(a)} and ${isolateName(b)} have children, the children stay connected to both parents.`,
	canUndo: 'You can undo this.',
	deleted: (name: string) => `The plugin deleted ${isolateName(name)}. You can undo this.`,
	removedPartnership: (a: string, b: string) => `The plugin removed the partnership of ${isolateName(a)} and ${isolateName(b)}. You can undo this.`,
	/** D330 UX-17: the Notice after Undo of a delete. */
	undoneDelete: (name: string) => `The plugin undid the deletion of ${isolateName(name)}.`,
	removedParent: (parent: string, child: string) => `The plugin removed ${isolateName(parent)} as a parent of ${isolateName(child)}. You can undo this.`,
	undo: 'Undo',
	undoAlso: 'If you select Undo, the plugin also removes the other changes that you saved with this change.',
} as const;

/**
 * The delete confirmation (spec §6.7), in STE with the same meaning as the spec example:
 * what else changes, then that nobody else is deleted.
 */
export function deleteText(name: string, s: DeleteSummary): string[] {
	const out: string[] = [];
	if (s.unions > 0) out.push(s.unions === 1 ? 'The plugin also removes 1 partnership of this person.' : `The plugin also removes ${s.unions} partnerships of this person.`);
	if (s.childLinks > 0) out.push(s.childLinks === 1 ? `The plugin removes ${isolateName(name)} as a parent of 1 person.` : `The plugin removes ${isolateName(name)} as a parent of ${s.childLinks} people.`);
	if (s.holders && s.holders.entries > 0 && s.holders.titles > 0) out.push(TITLES_UI.deleteHolder(name, s.holders.titles));
	if (s.heirs && s.heirs > 0) out.push(SUCCESSION_UI.deleteHeir(name, s.heirs));
	if (s.excluded && s.excluded > 0) out.push(SUCCESSION_UI.deleteExcluded(name, s.excluded));
	if (s.clearsStart) out.push('The tree starts at this person now. After the delete, it will start at a different person.');
	if (s.clearsFocus) out.push('The tree shows the family of this person now. After the delete, it will show all people.');
	if (s.clearsMe) out.push(ME_UI.deleteClears);
	out.push('The plugin does not delete other people.');
	return out;
}

/** The mark "This is me" and the relation text of the edit sheet (spec §13.1, D40–D46). */
export const ME_UI = {
	mark: 'This is me',
	// A label begins with the text that the button shows, so voice control finds the button by that text.
	markLabel: (name: string) => `This is me: mark ${name} as you`,
	unmark: `Remove ${quote('This is me')}`,
	unmarkLabel: (name: string) => `Remove ${quote('This is me')} from ${name}`,
	showLine: 'Show the line',
	showLineLabel: (name: string) => `Show the line from you to ${name}`,
	showRelationTo: 'Show the relation to…',
	showRelationToLabel: (name: string) => `Show the relation to…: find the relation between ${name} and another person`,
	/** Added to the delete confirmation of the marked person (spec §13.1). */
	deleteClears: `This person has the mark ${quote('This is me')}. If you delete this person, no person in the tree will have the mark.`,
} as const;

/**
 * "Make a note for this person" (spec §13.11, D60, D86, D87): the two buttons of
 * the Actions section, the question when a note with that name exists, and the Notices.
 */
export const NOTE_UI = {
	make: 'Make a note',
	makeLabel: (name: string) => `Make a note: the plugin makes a note for ${name} and links it to this card`,
	makeLinked: 'Make the linked note',
	makeLinkedLabel: (name: string) => `Make the linked note: the plugin makes the note that the link of ${name} names`,
	/** The start of the one text line in a new note; the link back follows it. */
	treeLine: 'Tree: ',
	made: (name: string) => `The plugin made the note ${quote(name)} and linked it to the card.`,
	linkedTo: (name: string) => `The plugin linked the card to the note ${quote(name)}.`,
	madeOnly: (name: string) => `The plugin made the note ${quote(name)}.`,
	cannot: (name: string) => `The plugin cannot make the note ${quote(name)}.`,
	linkNotAdded: (name: string) => `The plugin made the note ${quote(name)}. It cannot add the link to the tree text. The note is in the vault. Add the link by hand.`,
	askTitle: (name: string) => `The vault has a note with the name ${quote(name)}.`,
	askLink: 'Link to this note',
	askNew: (name: string) => `Make a new note ${quote(name)}`,
	askCancel: 'Cancel',
	undone: (name: string) => `The plugin removed the link. The note ${quote(name)} is still in the vault.`,
} as const;
