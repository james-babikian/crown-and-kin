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
} as const;
