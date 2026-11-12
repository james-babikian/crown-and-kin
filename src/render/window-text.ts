/*
 * Fixed text of the Houses window, the Titles window, the Id field, the person window and the house page, the search lists of the windows,
 * and the Notices about writes. Simplified Technical English (ASD-STE100) and the project word list apply.
 * `ui-text.ts` re-exports every name, so old imports keep working.
 */

import { quote } from '../core/quote';
import { isolateName } from './name-bidi';
import { PERSON_PLACEHOLDER } from './view-text';

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

/** D32: names of the house colours of `HOUSE_PALETTE`, in the same order. */
export const HOUSE_COLOUR_NAMES = ['Dark red', 'Red', 'Orange', 'Gold', 'Olive', 'Green', 'Blue green', 'Light blue', 'Dark blue', 'Purple', 'Brown', 'Grey'] as const;

/** The Houses window and its toolbar button (spec §6.10, D32, D36). */
export const HOUSES = {
	title: 'Houses',
	none: 'This tree has no houses.',
	newHouse: 'New house',
	/** D330 UX-22: the placeholder of the name of a new house, under the one heading "New house". */
	namePlaceholder: 'For example: House Plantagenet',
	nameLabel: 'Name of the house',
	count: (n: number) => (n === 0 ? 'No people' : n === 1 ? '1 person' : `${n} people`),
	delete: 'Delete',
	deleteLabel: (house: string) => `Delete ${house}`,
	add: 'Add house',
	paletteTitle: (house: string) => `Colour of ${house}`,
	otherColour: 'Other colour',
	confirmTitle: (house: string) => `Delete ${isolateName(house)}?`,
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
	deleted: (houses: string[]) => (houses.length === 1 ? `The plugin deleted ${isolateName(houses[0])}.` : `The plugin deleted ${houses.length} houses.`),
	/** D334 Q4: the Notice after Save, with Undo; a new house and a changed house read alike. */
	saved: (houses: string[]) => (houses.length === 1 ? (/^house /i.test(houses[0].trim()) ? `The plugin saved ${isolateName(houses[0])}.` : `The plugin saved the house ${isolateName(houses[0])}.`) : `The plugin saved ${houses.length} houses.`),
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
	windowTitle: (item: string) => `ID of ${isolateName(item)}`,
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
	characters: 'Use only small letters, digits and hyphens (-).',
	taken: 'This ID is in use. Enter a different ID.',
	/** The note of a new row whose name gives an ID that a changed row has taken. */
	newName: 'This name gives an ID that is in use. Enter a different name.',
	/** The second sentence of the question: what else a change of id changes. */
	places: (n: number) =>
		n === 0 ? 'The plugin changes nothing else.' : n === 1 ? 'The plugin also changes the ID in the text of 1 person.' : `The plugin also changes the ID in the text of ${n} people.`,
	confirmTitle: (n: number) => (n === 1 ? 'Change the ID?' : 'Change the IDs?'),
	confirmLine: (item: string, from: string, to: string, places: string) => `${isolateName(item)}: the plugin changes the ID ${quote(from)} to ${quote(to)}. ${places}`,
	change: (n: number) => (n === 1 ? 'Change the ID' : 'Change the IDs'),
	keep: 'Do not change',
	changed: (n: number) => (n === 1 ? 'The plugin changed the ID.' : `The plugin changed ${n} IDs.`),
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
	/** The first action row of the holder form (D330 O-18). */
	showCardRow: 'Show the card in the tree',
	moveEarlier: 'Move earlier',
	moveLater: 'Move later',
	remove: 'Remove',
	addHolder: 'Add holder',
	addHolderLabel: (title: string) => `Add holder: add a holder to ${title}`,
	pickerTitle: 'Select the holder',
	pickerPlaceholder: PERSON_PLACEHOLDER,
	/** The first row of the holder picker; it shows the typed name, so the user sees what the row will add. */
	notInTreeRow: (typed: string) => (typed.trim() ? `A holder who is not in the tree: ${quote(isolateName(typed.trim()))}` : 'A holder who is not in the tree'),
	needName: 'Enter a name for each title.',
	discardText: 'You did not save the changes to the titles.',
	cannotOpen: 'The plugin cannot show the titles. The tree text has an error.',
	stale: STALE_TEXT,
	personGone: 'The plugin cannot save a holder. The person is not in the tree now. Your changes are still in the window.',
	deleteTitle: (title: string) => `Delete ${isolateName(title)}?`,
	deleteHolders: (n: number) =>
		n === 1 ? 'The plugin also removes the list of its 1 holder. The people stay in the tree.' : `The plugin also removes the list of its ${n} holders. The people stay in the tree.`,
	deleteCards: (n: number) => (n === 1 ? '1 card then shows a different title or no title.' : `${n} cards then show a different title or no title.`),
	deleted: (titles: string[]) => (titles.length === 1 ? `The plugin deleted ${isolateName(titles[0])}.` : `The plugin deleted ${titles.length} titles.`),
	/** D334 Q4: the Notice after Save, with Undo; a new title and a changed title read alike. */
	saved: (titles: string[]) => (titles.length === 1 ? `The plugin saved the title ${isolateName(titles[0])}.` : `The plugin saved ${titles.length} titles.`),
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
	/** D341: the grey example of the name of a holder who is not in the tree. */
	holderNamePlaceholder: 'For example: Rosamund de Clifford',
	number: 'Number',
	numberPlaceholder: 'For example: II',
	ruler: 'Ruler name',
	from: 'From',
	until: 'Until',
	preview: (full: string, shown: string) => `${isolateName(full)} shows as: ${isolateName(shown)}`,
	// D195: the tick box of a holder, and its hints.
	holderTickLabel: 'Holds the title through the spouse',
	holderTickHint: 'If you tick this box, the line of succession follows the relatives of the spouse, as if the spouse held the title.',
	holderTickDisabled: 'This holder is not a person in the tree. To use this tick box, select a person in the tree as the holder.',
	// I15, D188 item 23.
	rulerHint: 'If you leave this field empty, the ruler name is the first word of the name of the holder. If the first word is not the ruler name, for example “Sir”, write the ruler name here.',
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
	addTitleText: (name: string) => `Select a title for ${isolateName(name)}.`,
	newTitleChoice: 'New title…',
	newTitleDetail: 'Enter a title that is not in the tree.',
	removed: (person: string, title: string) => `The plugin removed ${isolateName(person)} from the holders of ${isolateName(title)}.`,
	/** Added to the Delete person confirmation (D57). */
	deleteHolder: (name: string, titles: number) =>
		titles === 1 ? `The plugin also removes ${isolateName(name)} from the holders of 1 title.` : `The plugin also removes ${isolateName(name)} from the holders of ${titles} titles.`,
} as const;

function personRowYears(born: string, died: string, range?: string): string {
	return born && died ? (range ?? `${born}–${died}`) : born ? `b. ${born}` : died ? `d. ${died}` : '';
}

/**
 * The window family: the sections of the person window, the
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
	sumNames: (title: string, n: number) => `${isolateName(title)} · ${n === 0 ? 'no other names' : n === 1 ? '1 other name' : `${n} other names`}`,
	sumHolders: (count: number, newest: string) => `${count === 0 ? 'No holders' : count === 1 ? '1 holder' : `${count} holders`}${newest ? ` · newest: ${newest}` : ''}`,
	sumPeopleHeader: (n: number, gens: number) => (n === 0 ? 'No people' : `${n === 1 ? '1 person' : `${n} people`} in ${gens === 1 ? '1 generation' : `${gens} generations`}`),
	// The header of the person window.
	relationYour: (lower: string) => `Your ${lower}`,
	moreLabel: (n: number) => `${n} more: show the other relations`,
	portraitOf: (name: string) => `Portrait of ${name}`,
	/** The text link at the left of "Open all" for a person with no portrait (D209 item 5, D218 item 8). */
	addPortrait: 'Add portrait or arms',
	/** D330 UX-19: the same link when the person has a portrait or personal arms: it opens the menu. */
	portraitAndArms: 'Portrait and arms',
	/** D213: the text link in the header of a house page that has no arms. */
	addArms: 'Add arms',
	/** The same words inside a sentence ("Portrait of this person"). */
	thisPersonInSentence: 'this person',
	armsOfPerson: (name: string) => `Personal arms of ${name}`,
	saveFirst: 'Save the person first. Then you can select a portrait.',
	selectPart: 'Select the part of the portrait',
	selectPersonalArms: 'Select personal arms',
	removePersonalArms: 'Remove personal arms',
	pickArms: (name: string) => `Select personal arms for ${isolateName(name)}`,
	pickPortraitHint: 'After you select a picture, select the part of it to show.',
	pickArmsHint: 'The card shows the personal arms in the same place as the house arms.',
	// Navigation inside a window.
	/** The name of a person row. `word` and `dates`: what the row shows under the name; the name holds the visible text in the same order (WCAG 2.5.3). */
	openPersonLabel: (name: string, word?: string, dates?: string) => `${[name, word, dates].filter(Boolean).join(', ')}. Open this person.`,
	backToLabel: (name: string) => `Back to ${name}`,
	listMetaTitles: (n: number) => (n === 1 ? '1 title' : `${n} titles`),
	listMetaHouses: (n: number) => (n === 1 ? '1 house' : `${n} houses`),
	// The People section of the house page (D202 (2)).
	/** The years of a person row: "1131–1161", "b. 1131" for a birth year alone, "d. 1161" for a death year alone. */
	personRowYears,
	personRowSub: (generation: number, born: string, died: string, range?: string) => [`Generation ${generation}`, personRowYears(born, died, range)].filter(Boolean).join(' · '),
	// The Find window.
	findRowSub: (relation: string, years: string, title: string) => [relation, years, title].filter(Boolean).join(' · '),
} as const;

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
	/** D330 UX-17: the same text with the person that the edit changed: "The plugin undid the change to Edric Valmont in “01-three-generations”." */
	undoDoneChange: (person: string, note: string) => `The plugin undid the change to ${isolateName(person)} in ${quote(note)}.`,
	/** D346: the same after a rename: the name before the undo, then the name that the tree shows again. "The plugin undid the change to Aldric III. The name is Aldric the Elder again." */
	undoDoneRename: (now: string, was: string) => `The plugin undid the change to ${isolateName(now)}. The name is ${isolateName(was)} again.`,
	/** D284: the question when the last tree edit is in a note that is not the active note. */
	undoAskTitle: (note: string) => `Undo the last tree edit in ${quote(note)}?`,
	/** The two sentences of the question: the first names the note in a line that everyone can see, also on a phone (the title can be cut). */
	undoAskText: (note: string): string[] => [`The last tree edit is in the note ${quote(note)}, not in the active note.`, `If you select Undo, the plugin reverses that edit in ${quote(note)}.`],
	undoEmpty: 'There is no tree edit to undo.',
	undoChanged: 'The plugin cannot undo the last tree edit. The tree changed after the edit. Make the change again by hand.',
	undoMissing: 'The plugin cannot find the tree of the last edit.',
	cycle: 'The plugin cannot make this change. A person cannot be their own ancestor.',
	limit: (type?: string) =>
		type === 'rumoured'
			? 'The plugin cannot make this change. A person can have only 8 rumoured parents.'
			: type === 'birth' || type === 'begetter'
				? 'The plugin cannot make this change. A person can have only 2 parents by blood. Birth parents and begetters count together.'
				: 'The plugin cannot make this change. A person can have only 2 parents of each type.',
	/** D332: the refusal `alreadyBloodParent`, shown when a person would be both a birth parent and a begetter of one child. */
	alreadyBloodParent: 'The plugin cannot make this change. A person cannot be a birth parent and a begetter of the same child.',
	noSibling: 'There is no sibling in that direction.',
	needNameFirst: 'First, enter a name for this person.',
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

/** D134, D138: the searchable lists of the Titles window and the Houses window. */
export const WIN_LIST_UI = {
	searchTitles: 'Search titles',
	searchHouses: 'Search houses',
	clearSearch: 'Clear the search',
	matchTitles: (shown: number, all: number) => `${shown} of ${all} ${all === 1 ? 'title' : 'titles'} ${shown === 1 ? 'matches' : 'match'}.`,
	matchHouses: (shown: number, all: number) => `${shown} of ${all} ${all === 1 ? 'house' : 'houses'} ${shown === 1 ? 'matches' : 'match'}.`,
	noResultTitles: (q: string) => `No title matches ${quote(q)}.`,
	noResultHouses: (q: string) => `No house matches ${quote(q)}.`,
	holder: (name: string) => `Holder: ${isolateName(name)}`,
	person: (name: string) => `Person: ${isolateName(name)}`,
	id: (id: string) => `ID: ${id}`,
	/** D330 O-17: the word in the bar of a phone, in place of the back link "Titles" and "Houses", on the title page and the house page. */
	barTitle: 'Title',
	barHouse: 'House',
	stateNew: 'New',
	stateChanged: 'Changed',
	stateCheckId: 'Check the ID',
	backTitles: 'Back to the list of titles',
	backHouses: 'Back to the list of houses',
	editPage: (name: string) => `Page to edit ${name}`,
} as const;
