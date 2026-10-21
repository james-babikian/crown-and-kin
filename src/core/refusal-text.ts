/*
 * The sentences of edit refusals that more than one place in the core writes. Each one has a
 * single copy here, so a change of wording cannot miss a place. Warning texts for the reader are
 * in `messages.ts`; these are the `detail` of a refused edit.
 */

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
} as const;
