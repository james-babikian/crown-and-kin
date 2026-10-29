/*
 * The texts of the dates and calendars that the plugin shows (spec §14): the grey line under Born and Died, the test line of the Calendars window, the
 * window itself, the More list items, the table of the `kin-calendar` block and the choice of a calendar note. Simplified Technical English (ASD-STE100): short
 * sentences, active voice, present tense, the words "Calendars", "Calendar note", "Same year as", "Start" and "Length (years)". The warning sentences of the
 * tree list are in `src/core/messages.ts`, the refusals of the window in `CALENDAR_REFUSAL_TEXT` there. This file is separate from `ui-text.ts`, which is at the
 * size limit of the test `size-rule`.
 */

import { formatInternalYear } from '../core/dates';
import { andList } from '../core/messages';
import { isolateDate } from './date-bidi';

/** The grey line under Born and Died and the test line (spec §14 rule 6). */
export const DATE_READOUT_UI = {
	noYear: 'No year found. Write a year, or add a format for this date in a calendar.',
	samePlace: 'Two formats read the same words and give different years. No year found. Change a format.',
	fitsTwo: (calendars: readonly string[]) => `This date fits ${andList(calendars)}, with different years. No year found. Change a format.`,
	/** "The Long Count: Cycle 3, Year 10 = year 130"; the era form has the era name for `span`. */
	match: (calendar: string, span: string, count: number, year: number) => `${calendar}: ${span}, Year ${count} = ${formatInternalYear(year)}`,
	alsoSame: (calendars: readonly string[]) => `It also fits ${andList(calendars)}, with the same year.`,
	dual: (year: number) => `The plugin reads this as ${formatInternalYear(year)}.`,
	yearZero: 'Year 0 counts as the year before Year 1. Check that you mean this.',
	pastEnd: 'This year is after the end of its cycle or era. The plugin counts on from the last year.',
	/** One sentence for each name list after the year (spec §14 rule 15): "Planets: Saturn." The full name stands here, also when the cards show the short form. */
	listName: (list: string, name: string) => `${list}: ${name}.`,
	/** A written name that is not the name of the year (spec §14 rule 14). It stands in place of the sentence "<list>: <name>." of that list. */
	nameMismatch: (list: string, expected: string, written: string) => `In the list ${list}, this year is ${expected}. The date says ${written}. The plugin uses the year of the date.`,
} as const;

/** The More list, the command and the choice of a calendar note. */
export const CALENDAR_UI = {
	more: 'Calendars',
	moreLabel: 'Calendars: add or change the calendars',
	noteMore: 'Calendar note',
	noteMoreLabel: 'Calendar note: select the note with the calendars of this tree',
	command: 'Open the Calendars window',
	noteTitle: 'Calendar note',
	noteText: 'Select the note with the calendars for this tree.',
	noCalendar: 'No calendar',
	noCalendarDetail: 'The tree reads only plain years, such as 1205.',
	inUse: 'In use',
	/** Stands under the choice while the plugin still looks for calendar notes (the list can grow). */
	stillLooking: 'The plugin still looks for calendar notes. More notes can appear in this list.',
	noNotes: 'No calendar note exists yet. To make one, select “Calendars” in the More list and save a calendar. The plugin then makes the note, and this tree uses it.',
	noteChosen: (name: string) => `This tree uses the calendar note “${name}”.`,
	noCalendarChosen: 'This tree uses no calendar. It reads plain years only.',
	noteFailed: 'The plugin cannot change the tree text, so your choice is not saved.',
} as const;

/** The sentence that says how long the names take to repeat. */
const T_REPEAT = (count: number): string => (count === 1 ? 'The name repeats every year.' : `The names repeat every ${count} years.`);

/** The Calendars window. */
export const CALENDAR_WINDOW_UI = {
	title: 'Calendars',
	/** The line under the head while the window has a calendar; the long text below stands in the empty window. */
	introShort: 'A calendar tells the plugin how to find the year in a date of your world.',
	intro: 'A calendar lets the plugin find the year in a date of your world. An example is “the 10th Year of the Third Cycle”. The plugin needs the year for the line of succession, for ages and for the order of brothers and sisters. A cycle calendar has cycles of the same length. An era calendar has named eras, for example “the 3rd Year of the Qinglong Emperor”. The plugin never changes the text of a date.',
	noteLabel: 'Calendar note',
	folder: (folder: string) => `Folder: ${folder === '' ? 'main folder of the vault' : folder}`,
	newNote: 'New calendar note',
	newNoteName: 'Name of the new note',
	newNoteFolder: 'Folder of the new note',
	newNoteHint: 'The plugin makes this note when you save.',
	noNoteMeta: 'No calendar note exists.',
	noNoteHint: 'The plugin makes the note “Calendars” when you save.',
	// The line before Save in a window that opened from a tree (D289, D290): it says what Save does to the tree.
	treeNewNote: (name: string) => `This tree uses no calendar now. When you save, the plugin makes the note “${name}”. Then this tree uses it.`,
	treeUsesNote: (name: string) => `This tree uses no calendar now. When you save, it uses the note “${name}”. This is also true when you change no calendar.`,
	treeStillUses: (name: string) => `This tree still uses the note “${name}”, not the new note. To use the new note, save, and then select “Calendar note” in the More list.`,
	treeReadOnly: 'The plugin cannot change this tree here. For example, the tree has an error, or it shows in another note or a Canvas. When you save, the plugin saves the calendars in the note, but this tree does not use the note. To make the tree use it, open the note of the tree and select “Calendar note” in the More list.',
	changesFirst: 'Save or cancel your changes before you change the note.',
	addCalendar: 'Add calendar',
	addCycles: 'Add cycle calendar',
	addEras: 'Add era calendar',
	kindCycles: 'Cycle calendar',
	kindEras: 'Era calendar',
	nameLabel: 'Name',
	namePlaceholderCycles: 'For example: The Long Count',
	namePlaceholderEras: 'For example: Reign names',
	formatsLabel: 'Formats',
	formatsHintCycles: 'A format shows how you write a date. Write {year} where the year number is, and {cycle} where the cycle number is. Write one format on each text line.',
	formatsHintEras: 'A format shows how you write a date. Write {year} where the year number is, and {era} where the era name is. Write one format on each text line.',
	formatsPlaceholderCycles: 'For example: {year} Year of the {cycle} Cycle',
	formatsPlaceholderEras: 'For example: {era} {year}',
	noFormats: 'This calendar has no format. The plugin cannot read a date with it. Add a format.',
	lengthLabel: 'Length (years)',
	lengthOptional: 'Length (years), optional',
	startLabel: 'Start',
	sameAsLabel: 'Same year as',
	sameAsPlaceholder: 'A date in another calendar, or a plain year',
	cycleLabel: 'Cycle',
	yearLabel: 'Year',
	exampleHintCycles: 'Write a Cycle and a Year of this calendar, for example Cycle 3 and Year 21. Then, in “Same year as”, write a date in another calendar or a plain year for that same year. An example is 1203.',
	exampleHintEras: 'Write a Year of this era, for example 3. Then, in “Same year as”, write a date in another calendar or a plain year for that same year. An example is 1203.',
	lengthHintCycles: 'The number of years in one cycle.',
	lengthHintEras: 'The number of years in this era. Leave it empty if the era has no end.',
	startNow: (year: number) => `Start: ${formatInternalYear(year)}. This is the plain year of Year 1 of this calendar.`,
	startNone: 'No “Same year as” date. The calendar starts at year 1. If you use other calendars or plain years, write a date in “Same year as”.',
	/** In place of the help of Start, while the calendar has no “Same year as” date and the tree has other years (the long sentence stays in the tree list). */
	startNoAnchor: 'No “Same year as” date. The plugin counts year 1 of this calendar as plain year 1. The tree also has dates in other calendars or plain years. Then the order of dates and the ages can be wrong. To correct this, write a date in “Same year as”.',
	startKept: (year: number) => `The calendar starts at ${formatInternalYear(year)}. To change this, write a date in “Same year as”.`,
	exampleBack: (text: string, year: number) => `Example: ${text} = ${formatInternalYear(year)}`,
	sameAsCycle: 'This calendar and another calendar use each other to find their start, so neither can start. Change one “Same year as” date.',
	startUnreadable: 'The plugin cannot read the start in the note, because it is not a whole number. To set a start, write a date in “Same year as”.',
	sameAsBad: 'The plugin cannot read a year in this date. Write a plain year, or a date that fits another calendar.',
	numberBad: 'Write whole numbers in Cycle and Year.',
	erasLabel: 'Eras',
	eraName: 'Era name',
	addEra: 'Add era',
	noEras: 'This calendar has no era. Add an era.',
	remove: 'Remove',
	// The name begins with the words of the visible link (WCAG 2.5.3).
	removeCalendar: (name: string) => `Remove this calendar: ${name || 'without a name'}`,
	removeThisCalendar: 'Remove this calendar',
	/** A quiet line under the link: what changes in the tree when the calendar is gone. */
	removeNote: 'If you remove this calendar, the plugin no longer reads dates in this calendar as years. Cards show these dates as written. The line of succession then uses plain years only.',
	removeEra: (name: string) => `Remove the era ${name || 'without a name'}`,
	// The summary line of a closed section (spec §14 rule 16).
	summaryYears: (n: number) => (n === 1 ? '1 year in a cycle' : `${n} years in a cycle`),
	summaryFormats: (n: number) => (n === 0 ? 'No format' : n === 1 ? '1 format' : `${n} formats`),
	summaryEras: (names: readonly string[]) => (names.length === 0 ? 'No era' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`),
	summaryNoLists: 'No name list',
	summaryLists: (names: readonly string[]) => `${names.length === 1 ? 'Name list' : 'Name lists'}: ${names.join(', ')}`,
	summaryUnnamedList: 'A list with no name',
	// The name lists (spec §14 rule 16).
	plainTitle: 'Plain years',
	plainHint: 'A plain year is a number, for example 1273. A name list here gives each plain year a name that repeats.',
	listsLabel: 'Name lists',
	addList: 'Add name list',
	noLists: 'No name list. A name list gives each year a name from a list that repeats, for example a planet.',
	listName: 'Name of the list',
	listNamePlaceholder: 'For example: Planets',
	// The name begins with the words of the visible link (WCAG 2.5.3).
	removeThisList: 'Remove this list',
	removeList: (name: string) => `Remove this list: ${name || 'without a name'}`,
	markerLabel: 'Marker',
	markerPlaceholder: 'For example: {planet}',
	markerHint: 'Write one short word in curly brackets, for example {planet}.',
	/** The one word in curly brackets in `markerHint`: the hint shows it on one text line, never broken inside. */
	markerHintKeep: ['{planet}'] as readonly string[],
	namesLabel: 'Names in order',
	namesPlaceholder: 'For example: Saturn, Sa',
	namesHint: 'Write one name on each text line. To add a short form for the cards, write it after a comma, for example Saturn, Sa. The names repeat in this order, one name for each year. If a name has its own comma, write a comma at the end of the text line. An example is Mary, Queen of Scots,',
	knownLabel: 'Known year',
	knownNameLabel: 'Name of that year',
	knownHint: 'Write a date and the name of its year. The plugin then counts the names of all other years from this one. For example, if year 1273 is Saturn, year 1274 is the next name in the list.',
	knownBack: (date: string, year: number, name: string, count: number) => `${isolateDate(date)} = ${formatInternalYear(year)}. The name of this year is ${name}. ${T_REPEAT(count)}`,
	/** The known year of the plain years: the date is a plain year, so the line has no "=". */
	knownBackPlain: (year: number, name: string, count: number) => `The name of ${formatInternalYear(year)} is ${name}. ${T_REPEAT(count)}`,
	knownDateBad: 'The plugin cannot read a year in this date. Write a date that this calendar can read.',
	knownDateBadPlain: 'The plugin cannot read a year in this date. Write a plain year, for example 1273.',
	knownNameBad: 'This name is not in the list. Write a name or a short form from the list.',
	showLabel: 'Name of the year on cards',
	showHint: 'The plugin adds the name after a date on cards and in lists. A date that already has the name shows as you wrote it.',
	showShort: 'Short form',
	showFull: 'Full name',
	showNone: 'Do not show',
	testLabel: 'Test a date',
	/** Shows while the cursor is in the field. */
	testHint: 'The plugin shows the date as a plain year, for example “year 1273”.',
	testPlaceholder: 'Write a date to see how the plugin reads it',
	save: 'Save',
	discardText: 'The plugin discards your changes to the calendars.',
	saved: 'The plugin saved the calendars.',
	madeNote: (name: string) => `The plugin made the note “${name}”.`,
	// The end of the one Notice after a Save in a window that can set the key of the tree.
	keyNow: (name: string) => `This tree now uses the note “${name}”.`,
	keyNowMade: 'This tree now uses it.',
	keyHas: 'This tree already uses a calendar note. The plugin did not change the tree.',
	keyFailed: 'The plugin could not change this tree, so it does not use the note yet. To use the note, select “Calendar note” in the More list.',
	cannotMake: 'The plugin cannot make the note. Check the name and the folder.',
	// The draft stays in the window after each of these three (the window never closes on an error), so the texts say so.
	stale: 'The plugin did not save the calendars, because the note moved or changed, for example by a sync. Your changes stay in this window until you close it. Open the window again to see the note as it is now.',
	cannotSave: 'The plugin cannot save the calendars. Your changes stay in this window. Try again, or close the window and open it again.',
	/** The core refused the change and gave the reason in a sentence. */
	cannotSaveBecause: (reason: string) => `The plugin cannot save the calendars. ${reason} Your changes stay in this window.`,
	cannotOpen: 'The plugin cannot open the Calendars window. Run the command again.',
	cannotOpenHere: 'The plugin cannot switch to the other note. The window stays on the current note. Close the window and try again.',
	/** The one line at the top after a Save with errors: each error stands once, under its field, in a section that is open. */
	refusalSummary: (count: number) => (count === 1 ? 'Correct the error in the open section.' : `Correct the ${count} errors in the open sections.`),
	/** The head over an error that belongs to no section (the whole note); the error stands under it. */
	refusalHead: (count: number) => (count === 1 ? 'Correct this error:' : 'Correct these errors:'),
} as const;

/** The `kin-calendar` block in a note: the table of each calendar and its Edit button. */
export const CALENDAR_BLOCK_UI = {
	edit: 'Edit',
	editLabel: (name: string) => `Edit the calendars: ${name}`,
	empty: 'This calendar note has no calendar yet. Select Edit to add one.',
	formats: 'Formats',
	length: 'Length (years)',
	start: 'Start',
	era: 'Era',
	noFormats: 'No format',
	noLength: 'No length (no end)',
	nameList: 'Name list',
	plainYears: 'Plain years',
	/** The names of a list in the table: the first few, with the short form after each, and "and N more". */
	listNames: (names: readonly { name: string; short?: string }[]) => {
		const shown = names.slice(0, 3).map((n) => (n.short ? `${n.name} (${n.short})` : n.name));
		return names.length > 3 ? `${shown.join(', ')} and ${names.length - 3} more` : shown.join(', ');
	},
	listMarker: (name: string, marker: string | undefined) => (marker ? `${name}, marker {${marker}}` : name),
	listKnown: (year: number, name: string) => `Known year: ${formatInternalYear(year)} = ${name}`,
	error: 'The text of this calendar block has an error. Open the note in Source mode and correct it.',
} as const;
