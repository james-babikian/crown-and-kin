/*
 * The texts of the dates and calendars that the plugin shows (spec §14): the grey line under Born and Died, the test line of the Calendars window, the
 * window itself, the More list items, the table of the `kin-calendar` block and the choice of a calendar note. Simplified Technical English (ASD-STE100): short
 * sentences, active voice, present tense, the words "Calendars", "Calendar note", "Same year as", "Start" and "Length (years)". The warning sentences of the
 * tree list are in `src/core/messages.ts`, the refusals of the window in `CALENDAR_REFUSAL_TEXT` there. This file is separate from `ui-text.ts`, which is at the
 * size limit of the test `size-rule`.
 */

import { formatInternalYear } from '../core/dates';

const list = (names: readonly string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The grey line under Born and Died and the test line (spec §14 rule 6). */
export const DATE_READOUT_UI = {
	noYear: 'No year found. Write a year, or add a format for this date in a calendar.',
	samePlace: 'Two formats read the same words and give different years. No year found. Change a format.',
	fitsTwo: (calendars: readonly string[]) => `This date fits ${list(calendars)}, with different years. No year found. Change a format.`,
	/** "The Long Count: Cycle 3, Year 10 = year 130"; the era form has the era name for `span`. */
	match: (calendar: string, span: string, count: number, year: number) => `${calendar}: ${span}, Year ${count} = ${formatInternalYear(year)}`,
	alsoSame: (calendars: readonly string[]) => `It also fits ${list(calendars)}, with the same year.`,
	dual: (year: number) => `The plugin reads this as ${formatInternalYear(year)}.`,
	yearZero: 'Year 0 counts as the year before Year 1. Check that you mean this.',
	pastEnd: 'This year is after the end of its cycle or era. The plugin counts on from the last year.',
} as const;

/** The More list, the command and the choice of a calendar note. */
export const CALENDAR_UI = {
	more: 'Calendars',
	moreLabel: 'Calendars: add or change the calendars',
	noteMore: 'Calendar note',
	noteMoreLabel: 'Calendar note: select the note with the calendars of this tree',
	command: 'Open the Calendars window',
	noteTitle: 'Calendar note',
	noteText: 'Select the note with the calendars for this tree. If you select none, the tree uses every calendar note.',
	everyNote: 'Every calendar note',
	everyNoteDetail: 'The tree uses the calendars of all calendar notes.',
	inUse: 'In use',
	noNotes: 'No calendar note exists yet. Select “Calendars” in the More list and save a calendar. The plugin then makes the note.',
	noteChosen: (name: string) => `This tree uses the calendar note “${name}”.`,
	everyChosen: 'This tree uses every calendar note.',
	noteFailed: 'The plugin cannot change the tree text, so your choice is not saved.',
} as const;

/** The Calendars window. */
export const CALENDAR_WINDOW_UI = {
	title: 'Calendars',
	intro: 'A calendar lets the plugin find the year in a date of your world. An example is “the 10th Year of the Third Cycle”. The plugin needs the year for the line of succession, for ages and for the order of brothers and sisters. A cycle calendar has cycles of the same length. An era calendar has named eras, for example “the 3rd Year of the Qinglong Emperor”. The plugin never changes the text of a date.',
	noteLabel: 'Calendar note',
	folder: (folder: string) => `Folder: ${folder === '' ? 'main folder of the vault' : folder}`,
	newNote: 'New calendar note',
	newNoteName: 'Name of the new note',
	newNoteFolder: 'Folder of the new note',
	newNoteHint: 'The plugin makes this note when you save.',
	noNoteMeta: 'No calendar note exists.',
	noNoteHint: 'The plugin makes the note “Calendars” when you save.',
	changesFirst: 'Save or cancel your changes before you change the note.',
	addCycles: 'Add cycle calendar',
	addEras: 'Add era calendar',
	kindCycles: 'Cycle calendar',
	kindEras: 'Era calendar',
	nameLabel: 'Name',
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
	removeCalendar: (name: string) => `Remove the calendar ${name || 'without a name'}`,
	removeEra: (name: string) => `Remove the era ${name || 'without a name'}`,
	testLabel: 'Test a date. The number after “year” is the plain year that the date equals.',
	testPlaceholder: 'Write a date to see how the plugin reads it',
	save: 'Save',
	discardText: 'The plugin discards your changes to the calendars.',
	saved: 'The plugin saved the calendars.',
	madeNote: (name: string) => `The plugin made the note “${name}”.`,
	cannotMake: 'The plugin cannot make the note. Check the name and the folder.',
	// The draft stays in the window after each of these three (the window never closes on an error), so the texts say so.
	stale: 'The plugin did not save the calendars, because the note moved or changed, for example by a sync. Your changes stay in this window until you close it. Open the window again to see the note as it is now.',
	cannotSave: 'The plugin cannot save the calendars. Your changes stay in this window. Try again, or close the window and open it again.',
	cannotOpen: 'The plugin cannot open the Calendars window. Run the command again.',
	cannotOpenHere: 'The plugin cannot switch to the other note. The window stays on the current note. Close the window and try again.',
	refusalHead: 'The plugin cannot save yet. Correct this error:',
	/** A refusal in the line at the top of the window: it names its calendar, as the card does. */
	refusalFor: (name: string, text: string) => `${name === '' ? 'Calendar without a name' : `Calendar “${name}”`}: ${text}`,
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
	error: 'The text of this calendar block has an error. Open the note in Source mode and correct it.',
} as const;
