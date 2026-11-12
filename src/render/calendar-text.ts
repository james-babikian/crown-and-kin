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
	/** D330 UX-10: added after `noYear` when the line of succession skips a date with no year. */
	noYearSuccession: 'The line of succession does not use this date.',
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
	noCalendarDetail: 'The tree reads only plain years, for example 936.',
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

/** D330 O-25: the one purpose line of the Calendars window, also in place of the short line. */
// text-lint: description
const PURPOSE_LINE = 'A calendar lets the plugin find the year in dates, for example “the 3rd Year of the 92nd Olympiad” or “Qinglong Emperor 3”.';

/** The Calendars window. */
export const CALENDAR_WINDOW_UI = {
	title: 'Calendars',
	/** The line under the head while the window has a calendar; the long text below stands in the empty window. */
	introShort: PURPOSE_LINE,
	intro: PURPOSE_LINE,
	noteLabel: 'Calendar note',
	folder: (folder: string) => `Folder: ${folder === '' ? 'top folder of the vault' : folder}`,
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
	namePlaceholderCycles: 'For example: Greek Olympiads',
	namePlaceholderEras: 'For example: Reign names',
	formatsLabel: 'Formats',
	formatsHintCycles: 'A format shows how you write a date. Write {year} where the year number is, and {cycle} where the cycle number is. Write one format on each text line.',
	formatsHintEras: 'A format shows how you write a date. Write {year} where the year number is, and {era} where the era name is. Write one format on each text line.',
	formatsPlaceholderCycles: 'For example: {year} Year of the {cycle} Olympiad',
	formatsPlaceholderEras: 'For example: {era} {year}',
	noFormats: 'This calendar has no format. The plugin cannot read a date with it. Add a format.',
	lengthLabel: 'Length (years)',
	startLabel: 'Start',
	sameAsLabel: 'Same year as',
	sameAsPlaceholder: 'A date in another calendar, or a plain year',
	cycleLabel: 'Cycle',
	/** D341: the Cycle field shows the same grey 1 as the Year field; an empty Cycle means 1. */
	cyclePlaceholder: '1',
	yearLabel: 'Year',
	/** D330 O-23: the placeholder of the Year field of the reading line. */
	yearPlaceholder: '1',
	/** D330 UX-11: the hints of the four fields of the reading line. */
	cycleHint: 'Write a cycle number of this calendar, for example 92.',
	yearHintCycles: 'Write a year number in that cycle, for example 3.',
	sameAsHint: 'Write the same year in another calendar, or as a plain year, for example 867.',
	/** D330 UX-11: the heading over the name and the folder of the new note. */
	noteGroup: 'Note for the calendars',
	lengthHintCycles: 'The number of years in one cycle.',
	startNow: (year: number) => `Start: ${formatInternalYear(year)}. This is the plain year of Year 1 of this calendar.`,
	startNone: 'No “Same year as” date. The calendar starts at year 1. If you use other calendars or plain years, write a date in “Same year as”.',
	/** In place of the help of Start, while the calendar has no “Same year as” date and the tree has other years (the long sentence stays in the tree list). */
	startNoAnchor: 'No “Same year as” date. The plugin counts year 1 of this calendar as plain year 1. The tree also has dates in other calendars or plain years. Then the order of dates and the ages can be wrong. To correct this, write a date in “Same year as”.',
	startKept: (year: number) => `The calendar starts at ${formatInternalYear(year)}. To change this, write a date in “Same year as”.`,
	exampleBack: (text: string, year: number) => `${text} = ${formatInternalYear(year)}`,
	sameAsCycle: 'This calendar and another calendar use each other to find their start, so neither can start. Change one “Same year as” date.',
	startUnreadable: 'The plugin cannot read the start in the note, because it is not a whole number. To set a start, write a date in “Same year as”.',
	sameAsBad: 'The plugin cannot read a year in this date. Write a plain year, or a date that fits another calendar.',
	numberBad: 'Write whole numbers in Cycle and Year.',
	/** D342: the text field of the eras, one era on each text line. */
	erasLabel: 'Eras',
	erasPlaceholder: 'For example: Reign of Aldric, 1100',
	erasHint: 'Write one era on each text line: the name, a comma and the first year. For an end, add “to” and the last year. If you write no end, the era ends where the next era starts. The list below shows how the plugin reads each text line.',
	noEras: 'This calendar has no era. Write one era on each text line, for example “Reign of Aldric, 1100”.',
	/** D342: the refusals of one text line of the eras; each names its text line. */
	eraLineNoYear: (line: number) => `Text line ${line}: write the name, a comma and the first year.`,
	eraLineLastBad: (line: number) => `Text line ${line}: the plugin cannot read the year after “to”. Write a plain year, or a date in another calendar.`,
	eraLineOrder: (line: number) => `Text line ${line}: the last year is before the first year. Write a last year that is not before the first year.`,
	eraLineTwice: (line: number, other: number) => `Text line ${line}: text line ${other} has the same era name. Give each era its own name.`,
	eraLineCycle: (line: number) => `Text line ${line}: the first year is a date that needs this calendar to be read. Write a plain year.`,
	/** D342: the reading list under the eras, "Reign of Aldric 1 = year 1100" and at the right "to 1139" or "no end". The era name stands before this text. */
	eraFirst: (year: number) => `1 = ${formatInternalYear(year)}`,
	eraEnd: (year: number) => `to ${year < 0 ? `−${-year}` : year}`,
	eraNoEnd: 'no end',
	/** In the reading list, for an era whose first year the note holds as text that is not a whole number. */
	eraUnreadable: 'The plugin cannot read the first year of this era in the note. Write the first year again in the Eras field.',
	// The name begins with the words of the visible link (WCAG 2.5.3).
	removeCalendar: (name: string) => `Remove this calendar: ${name || 'without a name'}`,
	removeThisCalendar: 'Remove this calendar',
	/** A quiet line under the link: what changes in the tree when the calendar is gone. */
	removeNote: 'If you remove this calendar, the plugin no longer reads dates in this calendar as years. Cards show these dates as written. The line of succession then uses plain years only.',
	// The summary line of a closed section (spec §14 rule 16).
	summaryYears: (n: number) => (n === 1 ? '1 year in a cycle' : `${n} years in a cycle`),
	summaryFormats: (n: number) => (n === 0 ? 'No format' : n === 1 ? '1 format' : `${n} formats`),
	summaryEras: (names: readonly string[]) => (names.length === 0 ? 'No era' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`),
	summaryNoLists: 'No name list',
	summaryLists: (names: readonly string[]) => `${names.length === 1 ? 'Name list' : 'Name lists'}: ${names.join(', ')}`,
	summaryUnnamedList: 'A list with no name',
	// The name lists (spec §14 rule 16).
	plainTitle: 'Plain years',
	plainHint: 'A plain year is a number, for example 1178. A name list gives each plain year a name from a list that repeats, for example the names of planets.',
	listsLabel: 'Name lists',
	addList: 'Add name list',
	noLists: 'No name list.',
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
	namesHint: 'Write one name on each text line. To add a short form for the cards, write it after a comma, for example “Saturn, Sa”. The names repeat in this order, one name for each year. If a name has its own comma, end the text line with a comma, for example “Mary, Queen of Scots,”.',
	knownLabel: 'Known year',
	knownNameLabel: 'Name of that year',
	knownHint: 'Write a date and the name of its year. The plugin then counts the names of all other years from this one. For example, if year 1178 is Saturn, year 1179 is the next name in the list.',
	knownBack: (date: string, year: number, name: string, count: number) => `${isolateDate(date)} = ${formatInternalYear(year)}. The name of this year is ${name}. ${T_REPEAT(count)}`,
	/** The known year of the plain years: the date is a plain year, so the line has no "=". */
	knownBackPlain: (year: number, name: string, count: number) => `The name of ${formatInternalYear(year)} is ${name}. ${T_REPEAT(count)}`,
	knownDateBad: 'The plugin cannot read a year in this date. Write a date that this calendar can read.',
	knownDateBadPlain: 'The plugin cannot read a year in this date. Write a plain year, for example 1178.',
	knownNameBad: 'This name is not in the list. Write a name or a short form from the list.',
	showLabel: 'Name of the year on cards',
	showHint: 'The plugin adds the name after a date on cards and in lists. A date that already has the name shows as you wrote it.',
	showShort: 'Short form',
	showFull: 'Full name',
	showNone: 'Do not show',
	testLabel: 'Test a date',
	testPlaceholder: 'Write a date to see how the plugin reads it',
	save: 'Save',
	discardText: 'You did not save the changes to the calendars.',
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
	/** D342: an era with no length that ends where the next era starts. */
	noLengthEnds: (year: number) => `No length (to ${formatInternalYear(year)})`,
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
