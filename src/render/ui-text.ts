/*
 * Fixed text of the windows, the edit sheet, the settings and the Notices. Simplified Technical English (ASD-STE100) and the project word list
 * apply. Problem sentences themselves come from `src/core/messages.ts`. The texts of the tree
 * view are in `view-text.ts` and the texts of the line of succession in `succession-text.ts`;
 * this file re-exports their names, so old imports keep working.
 */

import type { DeleteSummary } from '../core/family-query';
import type { PictureProblem } from '../core/pictures';
import { quote } from '../core/quote';
import { SUCCESSION_UI } from './succession-text';
import { PERSON_PLACEHOLDER } from './view-text';

// Moved to their own files (one home each). These names stay importable from here.
export { ADD_UI, BLOCK_UI, FINDER_UI, FOCUS_UI, FULL_UI, HINT_UI, PHONE_LIST_UI, PROBLEMS_HINT, UI, problemsLabel, problemsTitle } from './view-text';
export { SUCCESSION_UI };

/** Texts that two or more windows show in the same words (D112 X10): one constant each. */
const STALE_TEXT = 'The tree changed after you opened this window. The plugin did not save. Your changes are still in the window. Select Save again to save them.';
const MAKE_NOTE_TEXT = 'Make a note with this table';
/** The four texts of a Save that the plugin cannot do, the same in the Houses window and in the Notices about writes. */
const SAVE_FAILED = {
	missing: 'The plugin cannot find this tree in the note. It did not save your changes. Your changes are still in the window.',
	invalid: 'The plugin cannot save. The tree text has an error. Your changes are still in the window.',
	refused: 'The plugin cannot save this change safely. The note did not change. Your changes are still in the window.',
	failed: 'The plugin cannot save your changes because of an error in the plugin. Your changes are still in the window.',
} as const;

/** The edit sheet (spec §6.3, §7.4). */
export const SHEET = {
	save: 'Save',
	/** F6: the label of Save and the status line while a write of a large tree runs. */
	saveWait: 'Wait',
	savingStatus: 'Wait. The plugin saves your changes.',
	cancel: 'Cancel',
	close: 'Close',
	name: 'Name',
	// D98: the free text under the name. The Titles section holds titles with a number and dates.
	title: 'Title text on the card',
	titleHint: 'This text shows under the name on the card. For a title with a number and dates, use the Titles section below.',
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
	// M.8: a person who died with no children; the line of succession then shows no open branch.
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
export const PARENT_TYPE_TEXT: Record<string, string> = { birth: 'Birth parent', adoptive: 'Adoptive parent', ward: 'Guardian', rumoured: 'Rumoured parent' };
/** Names of partnership types, as the sheet and the flows show them. */
export const UNION_TYPE_TEXT: Record<string, string> = { marriage: 'Marriage', betrothal: 'Betrothal', concubinage: 'Concubinage', affair: 'Affair' };

/** A parent type's name, or "Other (x)" for a type the plugin does not know. */
export const parentTypeText = (t: string) => PARENT_TYPE_TEXT[t] ?? `Other (${t})`;

/** "Marriage", or "Other (x)" for a type the plugin does not know; null is an implicit union. */
export function unionTypeText(t: string | null): string {
	if (t === null) return FAMILY.noPartnership;
	return UNION_TYPE_TEXT[t] ?? `Other (${t})`;
}

/** "1129–1161", "from 1129", "until 1161" or "". */
export function unionDates(start?: string, end?: string): string {
	if (start && end) return `${start}–${end}`;
	if (start) return `from ${start}`;
	if (end) return `until ${end}`;
	return '';
}

/** One partner row: "Marriage, from 1129". */
export function partnerDetail(type: string | null, start?: string, end?: string): string {
	return [unionTypeText(type), unionDates(start, end)].filter(Boolean).join(', ');
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
	parentTypeText: (name: string) => `Select the type of parent for ${name}.`,
	typeFull: (limit: number) => `This person has ${limit} parents of this type.`,
	newOrExisting: (name: string, what: string) => `Add a ${what} to ${name}. Select a new person or a person who is in the tree.`,
	newPerson: 'New person',
	newPersonDetail: 'Enter a person who is not in the tree.',
	existingPerson: 'Person in the tree',
	existingPersonDetail: 'Select a person who is in the tree.',
	noneToPick: 'No person in the tree fits this choice.',
	addChildTitle: 'Add a child',
	otherParentText: (name: string) => `${name} is one parent of this child. Select the other parent.`,
	noOtherParent: 'No other parent',
	noOtherParentDetail: (name: string) => `The child has only ${name} as a parent.`,
	childTypeTitle: 'Type of parent',
	childTypeText: (child: string, parents: string) => `${child} has birth parents now. Select how ${parents} are related to ${child}.`,
	childTypeTextOne: (child: string, parent: string) => `${child} has birth parents now. Select how ${parent} is related to ${child}.`,
	childTypeFull: 'The child cannot have more parents of this type.',
	alreadyChild: (child: string, parent: string) => `${child} is a child of ${parent} now.`,
	addPartnerTitle: 'Add a partner',
	unionTypeTitle: 'Type of partnership',
	unionTypeText: (a: string, b: string) => `Select the type of partnership of ${a} and ${b}.`,
	existingTitle: 'These people are already partners',
	existingText: (a: string, b: string, n: number) => (n === 1 ? `${a} and ${b} have this partnership now:` : `${a} and ${b} have these partnerships now:`),
	existingWarn: 'If you continue, the plugin adds one more partnership. It does not change the partnerships above.',
	addAnother: 'Add one more partnership',
	pickerParent: PERSON_PLACEHOLDER,
	pickerChild: PERSON_PLACEHOLDER,
	pickerPartner: PERSON_PLACEHOLDER,
	pickerEmpty: 'No person has this name.',
	/** The accessible name of the search field of every person list (the placeholder is not a name). */
	pickerSearchLabel: 'Find a person',
	createNew: (text: string) => (text.trim() ? `Create a new person ${quote(text.trim())}` : 'Create a new person'),
	autoUnion: (a: string, b: string) => `The plugin also added a marriage of ${a} and ${b}. To change its type, open the person window of ${a}. Open Family. Then select Edit under Partners.`,
} as const;

/** The sheet for a new person (spec §6.3 "New people are drafts"). */
export const NEW_SHEET = {
	titlePerson: 'New person',
	titleParent: 'New parent',
	titleChild: 'New child',
	titlePartner: 'New partner',
	parentOf: (type: string, child: string) => `${parentTypeText(type)} of ${child}`,
	childOf: (a: string, b: string | null) => (b ? `Child of ${a} and ${b}` : `Child of ${a}`),
	partnerOf: (name: string) => `Partner of ${name}`,
	unionType: 'Type of partnership',
	saveAnother: 'Save and add another child',
	savedAnother: (name: string) => `The plugin saved ${name}. Enter the next child.`,
	discardText: 'You did not save this new person.',
	partnership: 'Partnership of the parents',
	choosePartnership: 'Select a partnership',
	partnershipLost: 'The partnership that you selected is not in the tree now. Select the partnership again.',
	partnershipGone: 'The partnership that you selected is not in the tree now. The child will have both parents, with no recorded partnership.',
	needPartnership: 'Select the partnership of the parents.',
	relativeGone: (name: string) => `${name} is not in the tree now. The plugin cannot add this person as a relative of ${name}.`,
	relativeGoneHelp: 'You can add this person with no parents, children or partners, or select Cancel.',
	noRelatives: 'Add with no parents, children or partners',
} as const;

/** The partnership editor (spec §6.3 Partners, Edit). */
export const UNION_EDIT = {
	title: 'Edit partnership',
	of: (a: string, b: string) => `${a} and ${b}`,
	type: 'Type of partnership',
	start: 'Start',
	end: 'End',
	gone: 'This partnership is not in the tree now. The plugin cannot save your changes.',
	discardText: 'You did not save the changes to this partnership.',
	ambiguous: 'The tree changed, and the plugin cannot find the partnership that you selected. Select Cancel. Then select Edit on the partnership again.',
} as const;

/** Delete and remove confirmations and their Notices (spec §6.7, D5). */
export const REMOVE = {
	deleteTitle: (name: string) => `Delete ${name}?`,
	deleteConfirm: 'Delete',
	removeConfirm: 'Remove partnership',
	cancel: 'Cancel',
	partnershipTitle: 'Remove partnership?',
	// Only the first letter changes: a type that the owner wrote keeps its own capitals (C5).
	partnershipText: (type: string, a: string, b: string) =>
		`The plugin removes the ${type.charAt(0).toLowerCase()}${type.slice(1)} of ${a} and ${b}. If ${a} and ${b} have children, the children stay connected to both parents.`,
	canUndo: 'You can undo this.',
	deleted: (name: string) => `The plugin deleted ${name}. You can undo this.`,
	removedPartnership: (a: string, b: string) => `The plugin removed the partnership of ${a} and ${b}. You can undo this.`,
	removedParent: (parent: string, child: string) => `The plugin removed ${parent} as a parent of ${child}. You can undo this.`,
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
	if (s.childLinks > 0) out.push(s.childLinks === 1 ? `The plugin removes ${name} as a parent of 1 person.` : `The plugin removes ${name} as a parent of ${s.childLinks} people.`);
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

/** D32: names of the house colours of `HOUSE_PALETTE`, in the same order. */
export const HOUSE_COLOUR_NAMES = ['Dark red', 'Red', 'Orange', 'Gold', 'Olive', 'Green', 'Blue green', 'Light blue', 'Dark blue', 'Purple', 'Brown', 'Grey'] as const;

/** The Houses window and its toolbar button (spec §6.10, D32, D36). */
export const HOUSES = {
	title: 'Houses',
	none: 'This tree has no houses.',
	newHouse: 'New house',
	nameLabel: 'Name of the house',
	count: (n: number) => (n === 0 ? 'No people' : n === 1 ? '1 person' : `${n} people`),
	delete: 'Delete',
	deleteLabel: (house: string) => `Delete ${house}`,
	add: 'Add house',
	paletteTitle: (house: string) => `Colour of ${house}`,
	otherColour: 'Other colour',
	confirmTitle: (house: string) => `Delete ${house}?`,
	// D113 item 1: the question gives the number only; the singular and plural texts agree.
	confirmPeople: (n: number) => (n === 1 ? '1 person has this house.' : `${n} people have this house.`),
	confirmAsk: (n: number) => (n === 1 ? 'Select what happens to this person.' : 'Select what happens to these people.'),
	clearLabel: (n: number) => (n === 1 ? 'Remove the house from this person' : 'Remove the house from these people'),
	clearDetail: (n: number) => (n === 1 ? 'This person will have no house. The card will show no house colour.' : 'These people will have no house. Their cards will show no house colour.'),
	keepLabel: (n: number) => (n === 1 ? 'Keep the house for this person' : 'Keep the house for these people'),
	keepDetail: (n: number) =>
		n === 1
			? 'The tree text keeps the house for this person. The tree will show a warning for this person.'
			: 'The tree text keeps the house for these people. The tree will show a warning for each of them.',
	cancel: 'Cancel',
	discardText: 'You did not save the changes to the houses.',
	cannotOpen: 'The plugin cannot show the houses. The tree text has an error.',
	needName: 'Enter a name for each house.',
	deleted: (houses: string[]) => (houses.length === 1 ? `The plugin deleted ${houses[0]}. You can undo this.` : `The plugin deleted ${houses.length} houses. You can undo this.`),
	stale: STALE_TEXT,
	...SAVE_FAILED,
} as const;

/**
 * The Id field of the Houses window and the Titles window (spec §13.17 rule 5, D109): the field, the
 * button that makes an id from the name, the reasons for a refused id, the question before Save and
 * the Notice after it.
 */
export const ID_UI = {
	label: 'ID',
	aria: (item: string) => `ID of ${item}`,
	/** The small button on a saved row of the Houses window and the Titles window (D110). */
	open: 'Change ID',
	openAria: (item: string) => `Change ID: change the ID of ${item}`,
	/** The title of the small window. */
	windowTitle: (item: string) => `ID of ${item}`,
	hint: (kind: 'house' | 'title') => `The ID is a short name. The plugin uses it to find this ${kind}. Most users never change it.`,
	use: 'Use this ID',
	/** The small grey note of a row whose id is waiting for Save. */
	newId: (id: string) => `New ID: ${id}`,
	/** The button that drops the new id of a row. "Reset" is the portrait crop button. */
	keepOld: 'Keep old ID',
	keepOldAria: (item: string) => `Keep old ID: keep the old ID of ${item}`,
	make: 'Make ID from the name',
	makeAria: (item: string) => `Make ID from the name: make the ID of ${item} from the name`,
	empty: 'Enter an ID.',
	characters: 'Use only letters, digits and hyphens (-).',
	taken: 'This ID is in use. Enter a different ID.',
	/** The note of a new row whose name gives an ID that a changed row has taken. */
	newName: 'This name gives an ID that is in use. Enter a different name.',
	/** The second sentence of the question: what else a change of id changes. */
	places: (n: number) =>
		n === 0 ? 'The plugin changes nothing else.' : n === 1 ? 'The plugin also changes the ID in the text of 1 person.' : `The plugin also changes the ID in the text of ${n} people.`,
	confirmTitle: (n: number) => (n === 1 ? 'Change the ID?' : 'Change the IDs?'),
	confirmLine: (item: string, from: string, to: string, places: string) => `${item}: the plugin changes the ID ${quote(from)} to ${quote(to)}. ${places}`,
	change: (n: number) => (n === 1 ? 'Change the ID' : 'Change the IDs'),
	keep: 'Do not change',
	changed: (n: number) => (n === 1 ? 'The plugin changed the ID. You can undo this.' : `The plugin changed ${n} IDs. You can undo this.`),
	inUse: 'The plugin cannot save. An ID in this window is in use in the tree now. The note did not change. Your changes are still in the window.',
	notAllowed: 'The plugin cannot save. An ID in this window has a character that is not allowed. The note did not change. Your changes are still in the window.',
	anchor:
		'The plugin cannot save. The tree text writes an ID in this window with a YAML anchor (&name) or alias (*name). These marks copy text from another place in the tree text. Edit the ID in the tree text yourself. The note did not change. Your changes are still in the window.',
} as const;

/**
 * Titles and holders (spec §13.3–§13.5, D54–D63): the More item, the Titles window, the holder
 * form, the Titles section of the edit sheet, the table note and the delete confirmations. Plugin
 * texts say "holder"; "Ruler name" is only a field label (spec §13.0 item 5).
 */
export const TITLES_UI = {
	// The More list (D49, D52).
	more: 'Titles',
	moreLabel: 'Titles: edit the titles of the tree',
	// The Titles window.
	title: 'Titles',
	intro: 'Each title has a list of holders. The list starts with the first holder and ends with the newest holder.',
	none: 'This tree has no titles.',
	newTitle: 'New title',
	nameLabel: 'Name of the title',
	// D66: the male form of the title, which the card of a man holder shows.
	maleLabel: 'Name for a man',
	// D201: the three examples show how the title is written with a jurisdiction name.
	namePlaceholder: 'For example: Duchy of Normandy',
	malePlaceholder: 'For example: Duke of Normandy',
	maleAria: (title: string) => `Name for a man: the name of ${title} for a man holder`,
	// D65: the female form of the title, which the card of a woman holder shows.
	femaleLabel: 'Name for a woman',
	femalePlaceholder: 'For example: Duchess of Normandy',
	femaleAria: (title: string) => `Name for a woman: the name of ${title} for a woman holder`,
	delete: 'Delete',
	deleteLabel: (title: string) => `Delete ${title}`,
	add: 'Add title',
	noHolders: 'This title has no holders.',
	notInTree: 'Not in the tree',
	showCardLabel: (holder: string) => `${holder}: show the card in the tree`,
	/** A reign after a name: "(r. 1160–1207)". */
	reign: (years: string) => `(r. ${years})`,
	edit: 'Edit',
	editLabel: (holder: string) => `Edit ${holder}`,
	moveEarlier: 'Move earlier',
	moveLater: 'Move later',
	remove: 'Remove',
	addHolder: 'Add holder',
	addHolderLabel: (title: string) => `Add holder: add a holder to ${title}`,
	pickerTitle: 'Select the holder',
	pickerPlaceholder: PERSON_PLACEHOLDER,
	/** The first row of the holder picker. */
	notInTreeRow: 'A holder who is not in the tree',
	needName: 'Enter a name for each title.',
	discardText: 'You did not save the changes to the titles.',
	cannotOpen: 'The plugin cannot show the titles. The tree text has an error.',
	stale: STALE_TEXT,
	personGone: 'The plugin cannot save a holder. The person is not in the tree now. Your changes are still in the window.',
	deleteTitle: (title: string) => `Delete ${title}?`,
	deleteHolders: (n: number) =>
		n === 1 ? 'The plugin also removes the list of its 1 holder. The people stay in the tree.' : `The plugin also removes the list of its ${n} holders. The people stay in the tree.`,
	deleteCards: (n: number) => (n === 1 ? '1 card then shows a different title or no title.' : `${n} cards then show a different title or no title.`),
	deleted: (titles: string[]) => (titles.length === 1 ? `The plugin deleted ${titles[0]}. You can undo this.` : `The plugin deleted ${titles.length} titles. You can undo this.`),
	// The table note (D55, D60).
	makeNote: MAKE_NOTE_TEXT,
	makeNoteLabel: (title: string) => `Make a note with this table: a note with the list of holders of ${title}`,
	noteTitle: 'Make a note with the saved list?',
	noteText: 'You did not save the changes in this window. The note will have the list of holders that the tree has now.',
	noteConfirm: 'Make the note',
	noteMade: (name: string) => `The plugin made the note ${quote(name)}.`,
	noteFailed: 'The plugin cannot make the note.',
	noteGone: 'This title is not in the tree now. The plugin did not make a note.',
	// The holder form (spec §13.5).
	formEdit: 'Edit holder',
	formNew: 'New holder',
	titleName: 'Name of the title',
	holderName: 'Name of the holder',
	number: 'Number',
	numberPlaceholder: 'II',
	ruler: 'Ruler name',
	from: 'From',
	until: 'Until',
	preview: (full: string, shown: string) => `${full} shows as: ${shown}`,
	// D195: the tick box of a holder, and its hints.
	holderTickLabel: 'Holds the title through the spouse',
	holderTickHint: 'If you tick this box, the line of succession follows the relatives of the spouse, as if the spouse held the title.',
	holderTickDisabled: 'This holder is not a person in the tree. To use this tick box, select a person in the tree as the holder.',
	// I15, D188 item 23.
	rulerHint: 'If you leave this field empty, the ruler name is the first word of the name of the holder. If the name starts with a word such as “Ser”, write the ruler name here.',
	needTitleName: 'Enter a name for the title.',
	needHolderName: 'Enter the name of the holder.',
	formDiscardText: 'You did not save the changes to this holder.',
	noneHeld: 'This person holds no title.',
	onCard: 'On the card',
	showOnCard: 'Show on the card',
	showOnCardLabel: (title: string) => `Show on the card: show ${title} on the card of this person`,
	entryNone: 'No number and no dates',
	entryEditLabel: (title: string, entry: string) => `Edit ${title}, ${entry}`,
	entryRemoveLabel: (title: string, entry: string) => `Remove ${title}, ${entry}`,
	addTitle: 'Add title',
	addTitleText: (name: string) => `Select a title for ${name}.`,
	newTitleChoice: 'New title…',
	newTitleDetail: 'Enter a title that is not in the tree.',
	removed: (person: string, title: string) => `The plugin removed ${person} from the holders of ${title}. You can undo this.`,
	/** Added to the Delete person confirmation (D57). */
	deleteHolder: (name: string, titles: number) =>
		titles === 1 ? `The plugin also removes ${name} from the holders of 1 title.` : `The plugin also removes ${name} from the holders of ${titles} titles.`,
} as const;

function personRowYears(born: string, died: string, range?: string): string {
	return born && died ? (range ?? `${born}–${died}`) : born ? `b. ${born}` : died ? `d. ${died}` : '';
}

/**
 * The window family of 0.2.8 (contract C, G.7, G.10; an internal study §5): the sections of the person window, the
 * title page and the house page, their summaries, the header of the person window, and the new texts of the People section.
 * A section title that exists in another table (`FAMILY.heading`, `TITLES_UI.heading`, …) has the same words here.
 */
export const WINDOW_UI = {
	openAll: 'Open all',
	openAllLabel: 'Open all sections',
	closeAll: 'Close all',
	closeAllLabel: 'Close all sections',
	sectionDetails: 'Details',
	sectionFamily: 'Family',
	sectionTitles: 'Titles',
	sectionNotes: 'Notes',
	sectionActions: 'Actions',
	sectionNames: 'Names',
	sectionHolders: 'Holders',
	sectionLine: 'Line of succession',
	sectionRules: 'Rules of succession',
	sectionPeople: 'People',
	sectionOther: 'Other actions',
	colour: 'Colour',
	children: 'Children',
	noChildren: 'This person has no children in the tree.',
	// Section summaries (a closed section shows one text line; parts are joined with " · ").
	noTitles: 'No titles',
	sumNotesNone: 'No notes',
	sumNotesLinked: (name: string) => `Linked note: ${name}`,
	andMore: (n: number) => `and ${n} more`,
	/** "2 parents", "1 parent" or "No parents"; "1 partner" or "no partner"; "1 child" or "no children". */
	sumFamilyParts: (parents: number, partners: number, children: number): string[] => [
		parents === 0 ? 'No parents' : parents === 1 ? '1 parent' : `${parents} parents`,
		partners === 0 ? 'no partner' : partners === 1 ? '1 partner' : `${partners} partners`,
		children === 0 ? 'no children' : children === 1 ? '1 child' : `${children} children`,
	],
	/** D201: only the names for a man and a woman count. */
	sumNames: (title: string, n: number) => `${title} · ${n === 0 ? 'no other names' : n === 1 ? '1 other name' : `${n} other names`}`,
	sumHolders: (count: number, newest: string) => `${count === 0 ? 'No holders' : count === 1 ? '1 holder' : `${count} holders`}${newest ? ` · newest: ${newest}` : ''}`,
	sumPeopleHeader: (n: number, gens: number) => (n === 0 ? 'No people' : `${n === 1 ? '1 person' : `${n} people`} in ${gens === 1 ? '1 generation' : `${gens} generations`}`),
	// The header of the person window.
	relationYour: (lower: string) => `Your ${lower}`,
	moreLabel: (n: number) => `${n} more: show the other relations`,
	enterName: 'Enter a name below',
	portraitOf: (name: string) => `Portrait of ${name}`,
	/** The text link at the left of "Open all" for a person with no portrait (D209 item 5, D218 item 8). */
	addPortrait: 'Add portrait or arms',
	/** The same link for a person that has personal arms already: only the portrait is missing. */
	addPortraitHasArms: 'Add portrait',
	/** D213: the text link in the header of a house page that has no arms. */
	addArms: 'Add arms',
	/** The placeholder of the search box of a list window on a phone, which has no heading: "Search 4 titles". */
	searchWithCount: (count: string) => `Search ${count}`,
	/** The same words inside a sentence ("Portrait of this person"). */
	thisPersonInSentence: 'this person',
	armsOfPerson: (name: string) => `Personal arms of ${name}`,
	saveFirst: 'Save the person first. Then you can select a portrait.',
	selectPart: 'Select the part of the portrait',
	selectPersonalArms: 'Select personal arms',
	removePersonalArms: 'Remove personal arms',
	pickArms: (name: string) => `Select personal arms for ${name}`,
	pickPortraitHint: 'After you select a picture, select the part of it to show.',
	pickArmsHint: 'The card shows the personal arms in the same place as the house arms.',
	// Navigation inside a window (G.7).
	/** The name of a person row. `word`: the relation word that the row shows under the name; the name holds the visible text in the same order (WCAG 2.5.3). */
	openPersonLabel: (name: string, word?: string) => `${word ? `${name}, ${word}` : name}. Open this person.`,
	backToLabel: (name: string) => `Back to ${name}`,
	listMetaTitles: (n: number) => (n === 1 ? '1 title' : `${n} titles`),
	listMetaHouses: (n: number) => (n === 1 ? '1 house' : `${n} houses`),
	// The People section of the house page (D202 (2), G.10).
	/** The years of a person row: "1131–1161", "b. 1131" for a birth year alone, "d. 1161" for a death year alone. */
	personRowYears,
	personRowSub: (generation: number, born: string, died: string, range?: string) => [`Generation ${generation}`, personRowYears(born, died, range)].filter(Boolean).join(' · '),
	// The Find window (G.3).
	findRowSub: (relation: string, years: string, title: string) => [relation, years, title].filter(Boolean).join(' · '),
} as const;

/** The settings tab (spec §9, D33). */
export const SETTINGS_UI = {
	groups: { view: 'Tree view', cards: 'Cards', relations: 'Relations and warnings', succession: 'Line of succession', housePage: 'House page', focus: 'Focus mode', links: 'Links', repair: 'Repair' },
	heightDesktop: 'Height on a computer or tablet',
	heightDesktopDesc: 'This is the height of a tree in a note, in pixels. The default is 500. If you drag the bottom edge of a tree, that tree keeps its new height.',
	/** D118: the user's own break places in long names. */
	breakWords: 'Break places in long names',
	breakWordsDesc: `The plugin can break a long word into parts. Write one word on each text line. Put a hyphen at each place where the word can break. An example is ${quote('Long-na-munda')}. If a name has a hyphen, write each part on its own text line. The plugin breaks a word from this list only at your places.`,
	/** D124 item 5, D126. */
	reduceMotion: 'Reduce movement',
	reduceMotionDesc: 'If you choose On, the tree changes at once and does not move slowly. If you choose Follow the device, the tree uses the setting of your phone or your computer.',
	reduceFollow: 'Follow the device',
	reduceOn: 'On',
	reduceOff: 'Off',
	dates: 'Show dates on cards',
	datesDesc: 'If this is on, the cards show when each person was born and died, and the years of each reign.',
	relations: 'Show relation names on cards',
	relationsDesc: `If this is on, each card shows how the person is related to you. A person in the tree must have the mark ${quote('This is me')}. If this is off, the cards are shorter. On a computer, a small label then shows the relation when you rest the pointer on a card. The list in a note on a phone follows this setting.`,
	/** D150: the direction of the full-screen tree on a phone held upright. */
	/** Contract 0.2.7 E.6, J.8: the line of succession. */
	successionLength: 'Length of the line of succession',
	successionLengthDesc: 'This is the number of people that the line of succession shows. Use a number from 1 to 20.',
	oldAge: 'Warn about people older than',
	oldAgeDesc: 'The plugin warns about a person in the line of succession who is older than this number of years and has no death year. Use a number from 0 to 1000. Use 0 to stop the warning.',
	youngDeathAge: 'Age for open branches',
	youngDeathAgeDesc: 'For a person who died younger than this age, the line of succession shows no open branch. The note must give the birth year and the death year. Use a number from 0 to 1000. Use 0 to show every open branch.',
	/** 0.2.8 contract A.4, D204: which cards show the arms of a house. */
	armsOnCards: 'Arms on cards',
	armsFew: 'Founders, married-in people and holders',
	armsAll: 'Every card',
	armsOnCardsDesc: `${quote('Founders, married-in people and holders')} shows the arms of a house on two kinds of card. The first kind is a person with no parent in the same house, for example a founder or a person who married into the tree. The second kind is a person who is a holder of a title in the Titles window. ${quote('Every card')} shows the arms on each person with a house. A card always shows personal arms. The list in a note on a phone does not follow this setting. In that list, only the person at the top shows arms. Those arms are the personal arms of the person, or else the arms of the house.`,
	/** 0.2.8 contract A.5, D188 item 10. */
	manyParents: 'Warn about more than 2 parents of a type',
	manyParentsDesc: 'If this is on, the plugin warns when a person has more than 2 parents of one type. The types are birth, adoptive and ward. If this is off, the plugin gives no warning for these types. A person can have up to 8 rumoured parents. The plugin always warns about more than 8 rumoured parents.',
	phoneDirection: 'Tree direction on a phone held upright',
	directionSideways: 'Sideways',
	directionDown: 'Like the computer',
	phoneDirectionDesc: 'This is how the tree looks in the full-screen view on a phone that you hold upright. If you choose Sideways, the generations go from left to right. If you choose Like the computer, the generations go from top to bottom. A phone on its side, a tablet and a computer always show the tree from top to bottom. The setting is the same for all trees.',
	/** D174 (spec §9): the text is the spec's, word for word. */
	oneParentUnknown: 'Assume an unknown second parent',
	oneParentUnknownDesc:
		'If this setting is on, a person with one listed parent has a second parent who is not known. Two people with the same listed parent show as half-siblings. If this setting is off, two people who list only the same parent show as full siblings. If a person lists fewer than two other parents, a rumoured parent shows that a parent is not known.',
	/** Spec §13.7 (M9 contract O10). */
	portraits: 'Show portraits on cards',
	portraitsDesc: 'If this is on, the cards show the portraits of the people.',
	/** D113 item 4. */
	houseGeneration: 'Show generation on the house page',
	houseGenerationDesc: 'If this is on, the house page shows the generation of each person. If this is off, the house page does not show it. The note that you make from the house page always has the generation.',
	generations: 'Generations in focus mode',
	generationsDesc: 'This is the number of generations above and below the person in focus mode. The default is 3. A tree can have its own number.',
	/** Spec §13.0 item 3 (M9 contract O8). */
	links: 'Update tree links when you rename a note or a picture',
	linksDesc: 'If you rename a note or a picture, the plugin changes the links to it in all trees. If this is off, the links do not change.',
	cache: 'Arrange all trees again',
	cacheDesc: 'The plugin remembers how it arranged each tree. This makes trees open quickly. If a tree looks wrong, select Arrange again.',
	cacheButton: 'Arrange again',
	cacheDone: 'The plugin will arrange each tree again when it shows the tree.',
} as const;

/** The command Insert family tree (spec §5.9, D34). */
export const INSERT_UI = {
	command: 'Insert family tree',
	/** The same sentence with straight marks: the plugin writes it into the owner's note, and it keeps that text plain ASCII (as in 0.2.0). */
	noteHint: 'To add the first person, select "Add first person" in Reading view or Live Preview.',
} as const;

/** The command that shows how long the last tree took to draw (spec §7.7). */
export const TIMING_UI = {
	command: 'Show render timing',
} as const;

/** Notices after a note was renamed (spec §6.9, D6, D35). */
export const RENAME_UI = {
	/** D35: only the numbers. */
	updated: (links: number, trees: number) => `The plugin changed ${links === 1 ? '1 link' : `${links} links`} in ${trees === 1 ? '1 tree' : `${trees} trees`}.`,
	failed: (note: string, old: string, next: string) => `The plugin cannot change the link ${quote(old)} in a tree in the note ${quote(note)}. Replace ${quote(old)} with ${quote(next)} by hand.`,
	moreFailed: (trees: number) => (trees === 1 ? 'The plugin also cannot change the links in 1 other tree.' : `The plugin also cannot change the links in ${trees} other trees.`),
	/** After 2 s, while the update runs (also while it waits for Obsidian's own link update); for notes, pictures or both (spec §13.0 item 3). */
	progressFor: (kind: RenamedKind) => (kind === 'note' ? RENAMED_NOTE_PROGRESS : `The plugin updates the tree links to ${renamedWhat(kind)}. This can take some time.`),
	/** Only after the progress Notice: it tells the user that the update ended. */
	noLinksFor: (kind: RenamedKind) => (kind === 'note' ? RENAMED_NOTE_NO_LINKS : `The trees have no links to ${renamedWhat(kind)}. The plugin did not change a tree.`),
	/** A tree named the old note, but its link now opens another note that existed at the rename. */
	kept: (link: string, note: string, other: string) =>
		`The plugin did not change the link ${quote(link)} in a tree in the note ${quote(note)}. The link now opens a different note with the same name: ${quote(other)}.`,
	moreKept: (trees: number) => (trees === 1 ? 'The plugin also did not change the links in 1 other tree for the same reason.' : `The plugin also did not change the links in ${trees} other trees for the same reason.`),
	/** An error stopped the whole update. */
	stopped: (what: string) => `The plugin cannot complete the update of the tree links to ${what}. Some trees can still have the old link. Change these links by hand.`,
	command: 'Show the last link update',
	report: linkReportText,
} as const;

/** What a rename was about: notes only, pictures only, or both (a folder rename). */
export type RenamedKind = 'note' | 'picture' | 'both';

const RENAMED_NOTE_PROGRESS = 'The plugin updates the tree links to the renamed note. This can take some time.';
const RENAMED_NOTE_NO_LINKS = 'The trees have no links to the renamed note. The plugin did not change a tree.';

/** "the renamed note", "the renamed picture" or "the renamed notes and pictures". */
export function renamedWhat(kind: RenamedKind): string {
	return kind === 'note' ? 'the renamed note' : kind === 'picture' ? 'the renamed picture' : 'the renamed notes and pictures';
}

/** The kind of a list of renames: notes only, pictures only, or both. */
export function renamedKind(renames: { from: string; picture?: boolean }[]): RenamedKind {
	const pictures = renames.filter((r) => r.picture).length;
	return pictures === 0 ? 'note' : pictures === renames.length ? 'picture' : 'both';
}

/** What the command "Show the last link update" tells (rename-links.ts fills it). */
export interface LinkReportText {
	/** `picture`: the renamed file is a picture (spec §13.0 item 3). */
	renames: { from: string; to: string; picture?: boolean }[];
	state: 'running' | 'done' | 'failed' | 'stopped';
	ms: number;
	notes: number;
	read: number;
	unread: number;
	trees: number;
	links: number;
	changedTrees: number;
	skipped: { note: string; link: string; other: string }[];
	failed: string[];
}

/** The renamed note in a Notice: `"Old"`, or the number of notes (or pictures) after a folder rename. */
export function renamedText(renames: { from: string; picture?: boolean }[]): string {
	if (renames.length === 1) return `${quote(renames[0].from)}`;
	const kind = renamedKind(renames);
	return `${renames.length} ${kind === 'note' ? 'renamed notes' : kind === 'picture' ? 'renamed pictures' : 'renamed notes and pictures'}`;
}

/** Most notes that the report names in each list. */
const REPORT_NAMES = 3;

function linkReportText(r: LinkReportText | null, enabled: boolean): string {
	const off = enabled ? '' : ` The setting ${quote(SETTINGS_UI.links)} is off.`;
	if (!r) return `The plugin did not update tree links after Obsidian started.${off}`;
	const kind = renamedKind(r.renames);
	const what = r.renames.length === 1 ? `${quote(r.renames[0].from)} to ${quote(r.renames[0].to)}` : `${r.renames.length} ${kind === 'note' ? 'notes' : kind === 'picture' ? 'pictures' : 'notes and pictures'}`;
	const head = {
		running: `The plugin still updates the tree links after the rename of ${what}.`,
		done: `The last link update was after the rename of ${what}. It took ${(r.ms / 1000).toFixed(1)} seconds.`,
		failed: `The last link update was after the rename of ${what}. An error stopped it before the end.`,
		stopped: `The last link update was after the rename of ${what}. It stopped before the end. The plugin will continue it at the next start.`,
	}[r.state];
	// One paragraph per topic (STE rule 11); the command shows each paragraph as its own block.
	const notes = [`Notes in the vault: ${r.notes}. Notes that the plugin read: ${r.read}.`];
	if (r.unread) notes.push(`Notes that the plugin cannot read: ${r.unread}.`);
	const groups = [[head], notes, [`Trees with a link to ${renamedWhat(kind)}: ${r.trees}. Changed links: ${r.links}. Changed trees: ${r.changedTrees}.`]];
	if (r.skipped.length) {
		groups.push([
			`Links that the plugin did not change: ${r.skipped.length}.`,
			...r.skipped.slice(0, REPORT_NAMES).map((s) => `The link ${quote(s.link)} in the note ${quote(s.note)} opens a different note with the same name: ${quote(s.other)}.`),
		]);
	}
	if (r.failed.length) {
		groups.push([`Trees that the plugin cannot change: ${r.failed.length}.`, ...r.failed.slice(0, REPORT_NAMES).map((n) => `The plugin cannot change a tree in the note ${quote(n)}.`)]);
	}
	return groups.map((g) => g.join(' ')).join('\n\n') + off;
}

/** Notices about writes (spec §6.1). */
export const WRITE_TEXT = {
	/** The drag of the tree's bottom edge: no window holds a draft, so the text does not speak of one. */
	stale: 'The tree changed after you opened it. The plugin did not save your changes. It loaded the tree again.',
	/** F11: the one text of a stale Save in the edit sheet, the Houses window and the Titles window. The Notice and the red line in the window say the same words. */
	staleWindow: STALE_TEXT,
	...SAVE_FAILED,
	personGone: 'This person is not in the tree now. The plugin cannot save your changes. You can copy your text from the window.',
	personNotFound: 'This person is not in the tree now.',
	blocked: 'The plugin cannot save. Editing is off for this tree.',
	heightFailed: 'The plugin cannot save the new height of the tree.',
	undoCommand: 'Undo last tree edit',
	undoDone: 'The plugin undid the last tree edit.',
	/** D284: the command names the note that it changed. */
	undoDoneIn: (note: string) => `The plugin undid the last tree edit in ${quote(note)}.`,
	/** D284: the question when the last tree edit is in a note that is not the active note. */
	undoAskTitle: (note: string) => `Undo the last tree edit in ${quote(note)}?`,
	/** The two sentences of the question: the first names the note in a line that everyone can see, also on a phone (the title can be cut). */
	undoAskText: (note: string): string[] => [`The last tree edit is in the note ${quote(note)}, not in the active note.`, `If you select Undo, the plugin reverses that edit in ${quote(note)}.`],
	undoEmpty: 'There is no tree edit to undo.',
	undoChanged: 'The plugin cannot undo the last tree edit. The tree changed after the edit.',
	undoMissing: 'The plugin cannot find the tree of the last edit.',
	cycle: 'The plugin cannot make this change. A person cannot be their own ancestor.',
	limit: (type?: string) => (type === 'rumoured' ? 'The plugin cannot make this change. A person can have only 8 rumoured parents.' : 'The plugin cannot make this change. A person can have only 2 parents of each type.'),
	noSibling: 'There is no sibling in that direction.',
	needNameFirst: 'First, enter a name for this person.',
} as const;

/**
 * Arms, portraits and the picture picker (spec §13.6, §13.7; D67–D69, D75–D78; M9 contract O6, O7,
 * B2, B8). "Colours from the arms" shows the exact colours of the arms (D68).
 */
export const PICTURES_UI = {
	// The Houses window (spec §13.6).
	/** The accessible name of the arms box of a house; a tap on it opens the picker. */
	armsLabel: (house: string) => `Select the arms of ${house}`,
	/** The spoken name of the arms button of a house in the Houses window (it opens a menu). */
	armsButtonLabel: (house: string) => `Change the arms of ${house}`,
	selectArms: 'Select arms',
	removeArms: 'Remove arms',
	coloursFromArms: 'Colours from the arms',
	armsColourLabel: (n: number) => `Colour ${n} from the arms`,
	// The edit sheet (spec §13.7).
	selectPortrait: 'Select portrait',
	removePortrait: 'Remove portrait',
	// The picture picker (spec §13.6 "Picture picker", D69).
	pickerPortraitTitle: (name: string) => `Select a portrait for ${name}`,
	/** The short title in the bar of the picture picker on a phone (D212 picker-grid). */
	pickerBarPortrait: 'Portrait',
	pickerBarArms: 'Arms',
	search: 'Type the name of a picture',
	searchLabel: 'Find a picture in the vault',
	fromDevice: 'Add a picture from this device',
	fromDeviceDetail: 'The plugin copies the picture into the attachment folder of this note.',
	topFolder: 'Top folder of the vault',
	noMatch: 'The vault has no picture with this name.',
	noPictures: 'The vault has no pictures.',
	select: 'Select',
	cancel: 'Cancel',
	added: (name: string, folder: string) =>
		folder ? `The plugin added the picture ${quote(name)} to the folder ${quote(folder)}.` : `The plugin added the picture ${quote(name)} to the top folder of the vault.`,
	addFailed: 'The plugin cannot add the picture because of an error. Try again.',
} as const;

/** The picture list (spec §13.14, D92 to D95): the folder rows, the mark on the current picture and the search limit. */
export const PICKER_UI = {
	inUse: 'In use',
	inUseLabel: 'This picture is in use now',
	openFolder: (path: string) => `Open the folder ${path}`,
	closeFolder: (path: string) => `Close the folder ${path}`,
	more: 'The vault has more pictures with this name. Type more of the name.',
} as const;

/**
 * B2 (spec §13.6 "Picture picker"): the Notice for a file from the device that fails the format or
 * size check (§13.0 item 3). The plugin writes no file then.
 */
export function deviceNotice(problem: PictureProblem): string {
	if (problem?.code === 'picture-not-image' && problem.format) return `The plugin cannot show this ${problem.format} picture. Save the picture as PNG or JPEG. Then select it again.`;
	if (problem?.code === 'picture-too-large') {
		return typeof problem.pixels === 'number'
			? `This picture is too large (${problem.pixels} million pixels). Use a picture with 40 million pixels or less.`
			: 'This picture is too large. Use a picture with 40 million pixels or less.';
	}
	return 'This file is not a picture. Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.';
}

/**
 * Save as picture (spec §13.8, D70–D74; M9 contract O11, B8): the More item, the window with the
 * kind of file, and the Notices of the save.
 */
export const SAVE_UI = {
	more: 'Save as picture',
	moreLabel: 'Save as picture: save the tree as a picture',
	title: 'Save as a picture',
	/** The accessible name of the two choices of the window. */
	kindLabel: 'Kind of file',
	png: 'PNG',
	pngDetail: 'A picture that most apps and devices can open.',
	svg: 'SVG',
	svgDetail: 'A picture that stays sharp at every size.',
	save: 'Save',
	cancel: 'Cancel',
	progress: 'The plugin makes the picture. This can take some time.',
	saved: (name: string, folder: string) =>
		folder ? `The plugin saved the picture ${quote(name)} in the folder ${quote(folder)}.` : `The plugin saved the picture ${quote(name)} in the top folder of the vault.`,
	small: 'The tree is very large. The names are small in this picture.',
	smallSvg: 'If you want sharp names, save the tree as SVG (a picture that stays sharp at every size).',
	share: 'Share',
	shareLabel: (name: string) => `Share the picture ${quote(name)}`,
	failed: 'The plugin cannot save the picture because of an error. Try again.',
} as const;

/**
 * The portrait crop tool (spec §13.13, D79, D90): the button in the edit sheet, the window and
 * its hints. The buttons also show their label as a tooltip.
 */
export const CROP_UI = {
	title: (name: string) => `Select the part of the portrait of ${name}`,
	hintTouch: 'Move the picture with one finger. Zoom with two fingers.',
	hintMouse: 'Drag the picture to move it. Use the mouse wheel or the slider to zoom.',
	zoomOut: 'Zoom out',
	zoomIn: 'Zoom in',
	sliderLabel: 'Zoom',
	save: 'Save',
	cancel: 'Cancel',
	reset: 'Reset',
	resetLabel: 'Reset: select the automatic part again',
	loading: 'The plugin loads the picture.',
	problem: 'The plugin cannot show this picture.',
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

/**
 * The house page (spec §13.12, D55, D88, D89): the People button, the window
 * with its table, and the note made from the table.
 */
export const HOUSE_PAGE_UI = {
	none: 'No person in the tree has this house.',
	makeNote: MAKE_NOTE_TEXT,
	makeNoteLabel: (house: string) => `Make a note with this table: the plugin makes a note with the people of ${house}`,
	noteMade: (name: string) => `The plugin made the note ${quote(name)}.`,
	noteFailed: (name: string) => `The plugin cannot make the note ${quote(name)}.`,
} as const;

/**
 * Fold a branch (spec §13.10, D83–D85): the accessible names and tooltips of the fold
 * button and the "+ N" sign, and the two buttons of the edit sheet. `names` are the parents' names.
 */
export const FOLD_UI = {
	hideDescendants: 'Hide descendants',
	showDescendants: 'Show descendants',
	hideDescendantsLabel: (name: string) => `Hide descendants: hide the people below ${name}`,
	showDescendantsLabel: (name: string) => `Show descendants: show the hidden people below ${name}`,
	/** The button of an open family: no count. */
	hideLabel: (names: readonly string[]) => `Hide the people below ${names.join(' and ')}`,
	/** The sign of a folded family, with the number of hidden people. */
	showLabel: (names: readonly string[], count: number) =>
		count === 1 ? `Show the hidden person below ${names.join(' and ')}` : `Show the ${count} hidden people below ${names.join(' and ')}`,
} as const;

/** D134, D138: the searchable lists of the Titles window and the Houses window. */
export const WIN_LIST_UI = {
	searchTitles: 'Search titles',
	searchHouses: 'Search houses',
	clearSearch: 'Clear the search',
	matchTitles: (shown: number, all: number) => `${shown} of ${all} ${all === 1 ? 'title' : 'titles'} ${shown === 1 ? 'matches' : 'match'}.`,
	matchHouses: (shown: number, all: number) => `${shown} of ${all} ${all === 1 ? 'house' : 'houses'} ${shown === 1 ? 'matches' : 'match'}.`,
	noResultTitles: (q: string) => `No title matches ${quote(q)}.`,
	noResultHouses: (q: string) => `No house matches ${quote(q)}.`,
	holder: (name: string) => `Holder: ${name}`,
	person: (name: string) => `Person: ${name}`,
	id: (id: string) => `ID: ${id}`,
	stateNew: 'New',
	stateChanged: 'Changed',
	stateCheckId: 'Check the ID',
	backTitles: 'Back to the list of titles',
	backHouses: 'Back to the list of houses',
	editPage: (name: string) => `Page to edit ${name}`,
} as const;

/** A number of people with a comma as the thousands separator ("1,600"): normal English, and a space can read as two numbers. */
export function groupCount(n: number): string {
	return String(Math.max(0, Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The low bar of a very large tree (D159, D223, D226, D227; spec §7.7). The words are final (clarity-editor, 2026-10-13); all of them
 * are here, so one edit changes every surface. `n` is the people count, `m` the limit that applies.
 */
export const LARGE_UI = {
	/** The name of the bar for a screen reader (a hidden text, not an `aria-label`: Obsidian shows an `aria-label` as a tooltip). */
	region: 'Large tree',
	/** Above the first limit, with the button. */
	ask: (n: number) => `This tree has ${groupCount(n)} people. The plugin can take several seconds to draw it. Obsidian does not answer in that time.`,
	drawButton: 'Draw the tree',
	/** The button of a bar that does not draw (D227 item 3): it opens the person picker, then the family of the chosen person shows. */
	chooseButton: 'Choose a person',
	/** Above the top that applies on a computer or a tablet. */
	top: (n: number, m: number) => `This tree has ${groupCount(n)} people. The plugin does not draw a tree with more than ${groupCount(m)} people. The plugin does not change your note. Choose a person to see the family of that person.`,
	/** Above the phone top, in the full-screen view. */
	phoneTop: (n: number, m: number) => `This tree has ${groupCount(n)} people. On a phone, the plugin does not draw a whole tree with more than ${groupCount(m)} people. Choose a person to see the family of that person.`,
	/** After a tap on the button: the button area shows this, and a screen reader reads it. */
	busy: 'Wait. The plugin draws the tree.',
	/** A draw that passed its time budget. */
	slow: 'The plugin stopped because this tree took too long to draw. The plugin does not change your note. Choose a person to see a family. To draw the whole tree, make the tree smaller in the note.',
	/** A focus family whose own people pass the top (a pin with very many generations, or a chosen person with a very large family). */
	focusTop: (n: number, m: number) => `The family of this person has ${groupCount(n)} people. The plugin does not draw a family with more than ${groupCount(m)} people. The plugin does not change your note. Choose another person to see a smaller family.`,
	/** The button of that bar. */
	chooseOtherButton: 'Choose another person',
} as const;
