/*
 * The sentences of edit refusals that more than one place in the core writes. Each one has a
 * single copy here, so a change of wording cannot miss a place. Warning texts for the reader are
 * in `messages.ts`; these are the `detail` of a refused edit.
 */

import { quote } from './quote';

export const REFUSAL_TEXT = {
	houseName: 'A house must have a name.',
	armsLink: 'The arms must be a link.',
	personName: 'A person must have a name.',
	titleName: 'A title must have a name.',
	maleNameText: 'The name for a man must be text.',
	femaleNameText: 'The name for a woman must be text.',
	pluralText: 'The plural must be text.',
	holderNeeds: 'A holder needs a person or a name.',
	newIdText: 'The new id must be text without spaces at the ends.',
	// The ID window compares a refusal with these two exactly (`idRefusalText`), so they are constants, not literals.
	idCharacters: 'An ID has only letters, digits and hyphens.',
	idNotText: 'The new ID must be a word or a number.',
	unknownParentType: 'Unknown parent type.',
	unknownUnionType: 'Unknown partnership type.',
	unknownEndedBy: 'This is not a choice for “Ended by”. Use Divorce, Annulment or Death.',
	alreadyParent: 'This person is already a parent of that type.',
	notWritable: 'The change cannot be written. Edit the note text.',
	commentWouldChange: 'The change cannot be written without a change to a comment. Edit the note text.',
	otherValuesWouldChange: 'The change cannot be written without a change to other values. Edit the note text.',
	// The calendar block (spec §14 rule 2).
	calendarName: 'A calendar must have a name.',
	calendarKind: 'A calendar is a cycle calendar or an era calendar.',
	calendarFormats: 'The formats must be a list of texts.',
	calendarNumber: 'The start and the length of a calendar or an era must be whole numbers.',
	calendarLength: 'The length of a cycle or an era is a number of years. Write a whole number, 1 or more.',
	eraName: 'An era must have a name.',
	unknownCalendar: 'The note has no calendar at this place. Edit the note text.',
	unknownEra: 'The calendar has no era at this place. Edit the note text.',
	calendarsNotList: 'The calendars of this block are not a list. Edit the note text.',
	calendarAlias: 'This calendar is written as a YAML alias. Edit the note text.',
	notEraCalendar: 'Only an era calendar has eras.',
	// The name lists (spec §14 rules 13 and 16). The texts of the Calendars window for a list are `LIST_REFUSAL_TEXT` below.
	nameLinesTooMany: 'A name list has at most 60 names. Remove some text lines.',
	nameLineEmpty: 'A text line has a short form but no name. Write the name before the comma.',
	nameTooLong: 'A name or a short form has 1 to 40 characters. Shorten the text.',
	nameShortComma: 'A short form cannot have a comma. Correct the list in the note, or write the list again in the Calendars window.',
	listName: 'A name list must have a name.',
	listNames: 'A name list has 1 to 60 names. Each name is text.',
	listKnown: 'The known year must be a whole number. Its name must be one of the names of the list.',
	listMarker: 'The marker is not valid. Use 1 to 24 letters, digits or hyphens. Start with a letter. Do not use year, cycle or era.',
	listShow: 'Show on cards must be short, full or none.',
	listsTooMany: 'A calendar and the plain years have at most 4 name lists.',
	unknownList: 'The calendar has no name list at this place. Edit the note text.',
	plainNotMap: 'The plain years of this block are not a group of keys. Edit the note text.',
} as const;

/** What a refusal of a name list (spec §14 rule 16) knows: where it is, the list and the text that the refusal names. */
export interface ListRefusalInfo {
	calendar: string;
	plain?: boolean;
	list?: number;
	listName?: string;
	detail?: string;
	marker?: string;
}

const curly = quote;
const whereOf = (r: ListRefusalInfo): string => (r.plain ? 'the plain years' : `the calendar ${curly(r.calendar)}`);
const listOf = (r: ListRefusalInfo): string => (r.listName ? `the name list ${curly(r.listName)}` : `name list ${(r.list ?? 0) + 1}`);

/**
 * The sentences of the Calendars window for a name list, a marker or a marker place in a format (spec §14 rule 16), by the key of the
 * refusal. Each takes the refusal record. A key that is not here has no sentence (`calendarRefusalText` then uses its fallback).
 */
export const LIST_REFUSAL_TEXT: Readonly<Record<string, (r: ListRefusalInfo) => string>> = {
	'calendar-marker-unknown': (r) => `The format ${curly(r.detail ?? '')} has the marker ${curly(`{${r.marker ?? ''}}`)}, but no name list of ${whereOf(r)} has this marker. Add a name list with this marker, or remove the marker from the format.`,
	'calendar-marker-twice': (r) => `The format ${curly(r.detail ?? '')} has the same marker two times. Use each marker one time.`,
	'calendar-marker-touching': (r) => `In the format ${curly(r.detail ?? '')}, a marker stands directly next to another marker or number, so the plugin cannot tell where one ends. Put a word or a space between them.`,
	'list-name-empty': (r) => `A name list of ${whereOf(r)} has no name. Write a name for the list.`,
	'list-name-length': (r) => `Name list ${(r.list ?? 0) + 1} of ${whereOf(r)} has a name with more than 60 characters. Write a name with 60 characters or fewer.`,
	'list-no-names': (r) => `${upperFirst(listOf(r))} of ${whereOf(r)} has no names. Write at least one name.`,
	'lists-too-many': (r) => `${upperFirst(whereOf(r))} ${r.plain ? 'have' : 'has'} more than 4 name lists. Remove a list.`,
	'names-too-many': (r) => `${upperFirst(listOf(r))} has more than 60 names. Remove some names.`,
	'name-twice': (r) => `${upperFirst(listOf(r))} has the text ${curly(r.detail ?? '')} two times. Each name and each short form must be different, so that the plugin can find the year of a name.`,
	'name-short-comma': (r) => `In ${listOf(r)}, the short form ${curly(r.detail ?? '')} has a comma. A short form cannot have a comma. Correct the list in the note, or write the list again in the Calendars window.`,
	'list-name-twice': (r) => `${upperFirst(whereOf(r))} ${r.plain ? 'have' : 'has'} two name lists with the name ${curly(r.detail ?? '')}. Give each list its own name.`,
	'name-length': (r) => `In ${listOf(r)}, a name or a short form has no text or has more than 40 characters. Write 1 to 40 characters.`,
	'marker-invalid': (r) => `The marker of ${listOf(r)} is not valid. Use 1 to 24 letters, digits or hyphens. Start with a letter. Do not use year, cycle or era.`,
	'marker-twice': (r) => `Two name lists of ${whereOf(r)} have the marker ${curly(r.detail ?? '')}. Give each list its own marker.`,
	'known-no-year': (r) => `The plugin cannot read the known year of ${listOf(r)}. ${r.plain ? 'Write a plain year, for example 1273.' : 'Write a date that the calendar can read.'}`,
	'known-no-name': (r) => `The known year of ${listOf(r)} has no name, or its name is not in the list. Write a name or a short form from the list.`,
};

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
