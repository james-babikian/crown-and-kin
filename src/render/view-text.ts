/*
 * Fixed text of the tree view: the toolbar and its menus, the banner and the problem list, the
 * read-only note, the full-screen view, the focus menu, the relation finder and the phone list.
 * They have this one home so that the view code and the tests read the same words;
 * `ui-text.ts` re-exports every name. Simplified Technical English (ASD-STE100) and the project word list apply.
 */

/** The word on the "You" tab of the marked person; the same word as the relation text of that person. */
export const ME_WORD = 'You';

/** The placeholder of every box that searches for a person. The windows and the line of succession use it too. */
export const PERSON_PLACEHOLDER = 'Type a name';

/** The error view, the banner for blocking problems (spec §8), the Fit and legend buttons, and the partner list title. */
export const UI = {
	errorTitle: 'The plugin cannot show this tree',
	internalError: 'The plugin cannot show this tree because of an error in the plugin. Close the note. Open it again.',
	startFailed: 'Crown and Kin could not start one of its features. Some features, such as trees or calendars, may not work. Close Obsidian and open it again, because this can fix a short fault. If this message shows again, update Crown and Kin and Obsidian, or report the problem.',
	bannerTitle: 'Editing is off',
	bannerLead: 'Correct these problems. Then you can edit this tree:',
	fit: 'Fit the tree in the view',
	legend: 'Show the line styles',
	legendTitle: 'Line styles',
	spouseListTitle: 'Partners',
} as const;

/** Toolbar badge label for `count` problems. */
export function problemsLabel(count: number): string {
	return count === 1 ? 'This tree has 1 problem. Show the problem.' : `This tree has ${count} problems. Show the problems.`;
}

/** Title of the problem list for `count` problems. */
export function problemsTitle(count: number): string {
	return count === 1 ? '1 problem in this tree' : `${count} problems in this tree`;
}

/** Hint text shown above the problem list. */
export const PROBLEMS_HINT = 'Select a problem to show the people it is about.';

/** Read-only trees (spec §6.1) and the resize handle (spec §7.5). */
export const BLOCK_UI = {
	openSource: 'Open note',
	openSourceLabel: 'Open note: open the note that contains this tree',
	// D176 (2): the same result as the hidden "Edit this block" button of Obsidian.
	showText: 'Show the tree text',
	showTextLabel: 'Show the tree text: open the note and show the text of this tree',
	readOnly: 'Read only',
	resizeLabel: 'Drag to change the height of the tree',
} as const;

/** The empty block (spec §5.9) and the toolbar button (spec §6.10). */
export const ADD_UI = {
	addFirst: 'Add first person',
	empty: 'This tree has no people.',
	// B-0001 (WCAG 2.5.3): the spoken name starts with the words on the button ("Add person" on the computer row).
	addPerson: 'Add person: add a person to the tree',
} as const;

/** The full-screen view (spec §7.1), its toolbar buttons (spec §6.10) and Find. */
export const FULL_UI = {
	expand: 'Show the tree in a full-screen view',
	close: 'Close the full-screen view',
	dialog: 'Tree in a full-screen view',
	find: 'Find a person in the tree',
	findTitle: 'Find a person',
	findPlaceholder: PERSON_PLACEHOLDER,
	gone: 'The plugin cannot find this tree in the note now. It closed the full-screen view.',
	invalid: 'The tree text has an error now. The plugin closed the full-screen view.',
	failed: 'The plugin closed the full-screen view because of an error in the plugin.',
} as const;

/** Focus mode and the pin (spec §5.6, §6.3, §6.10, D18). */
export const FOCUS_UI = {
	focus: 'Focus on a person in the tree',
	pickerTitle: 'Focus on a person',
	pickerPlaceholder: PERSON_PLACEHOLDER,
	/** D132, D263 B2: the Focus button of the toolbar opens the list (Choose a person) with no focus on, and clears the focus in one tap while one shows. */
	choose: 'Choose a person',
	chooseLabel: 'Choose a person: show only the family of the person that you choose',
	clear: 'Clear focus',
	clearLabel: 'Clear focus: show all people again',
	/** D246: the sentence of the bar at the top of the tree while a focus shows. */
	bar: (name: string) => `Focus on ${name}`,
	/** The accessible name and the tooltip of the Focus button while a focus shows: it says what a tap does (D263 B2). */
	focusOn: 'Focus is on. Select this button to clear the focus and show all people.',
	focusHere: 'Focus here',
	focusHereLabel: (name: string) => `Focus here: show only the family of ${name}`,
	pin: 'Pin focus here',
	pinLabel: (name: string) => `Pin focus here: always open this tree on the family of ${name}`,
	unpin: 'Remove pin',
	unpinLabel: (name: string) => `Remove pin: do not open this tree on the family of ${name} each time`,
	/** The `+` badge on a card with relatives who are not shown. */
	badgeLabel: (name: string, hidden: number) =>
		hidden === 1 ? `Show the family of ${name}. The tree does not show 1 relative.` : `Show the family of ${name}. The tree does not show ${hidden} relatives.`,
} as const;

/** The toolbar's More button (D49) and the relation finder (spec §13.2, D47, D48). */
export const FINDER_UI = {
	more: 'Show more actions',
	relation: 'Relation',
	relationLabel: 'Relation: find the relation between two people',
	firstTitle: 'Select the first person',
	secondTitle: 'Select the second person',
	/** The picker of "Show the relation to…" in the edit sheet. */
	otherTitle: 'Select the other person',
	placeholder: PERSON_PLACEHOLDER,
	/** The first row of a picker when the tree has a mark: the marked person. */
	you: (name: string) => `You: ${name}`,
	showSteps: 'Show the steps',
	hideSteps: 'Hide the steps',
	moreSteps: (n: number) => (n === 1 ? 'and 1 more step' : `and ${n} more steps`),
	other: 'Other relation',
	otherLabel: (second: string, first: string) => `Other relation: show the next relation of ${second} and ${first}`,
	whole: 'Show in the whole tree',
	lineOnly: 'Show only the line',
	/** D212 (phone-banner-row): on a phone the banner has one row, with this link that opens a menu of the other actions. */
	options: 'Options',
	optionsLabel: 'Options: open a list of actions for this relation',
	close: 'Close',
	closeLabel: 'Close: show the tree as it was before',
} as const;

/** D28: the first view on an upright phone leaves children of the person outside the box. */
export const HINT_UI = {
	up: (n: number) => (n === 1 ? '↑ 1 more child' : `↑ ${n} more children`),
	down: (n: number) => (n === 1 ? '↓ 1 more child' : `↓ ${n} more children`),
} as const;

/** D144: the list that replaces the tree in a note on a phone (spec §5.5). */
export const PHONE_LIST_UI = {
	addPerson: 'Add person',
	addPersonLabel: ADD_UI.addPerson,
	findLabel: 'Find: find a person in the tree to show the family of that person',
	backLabel: (name: string) => `Back: show the family of ${name} again`,
	expandLabel: 'Expand: show the tree in a full-screen view',
	// D209 item 7: a heading follows the count of its rows. The person at the top has a heading for a screen reader only.
	headParent: 'Parent',
	headParents: 'Parents',
	headPartner: 'Partner',
	headPartners: 'Partners',
	headChild: 'Child',
	headChildren: 'Children',
	headYou: 'You',
	headPerson: 'This person',
	withPartner: (name: string) => `With ${name}`,
	noPartner: 'No partner listed',
	otherChildren: 'Other children',
	/** The accessible name of the list. */
	region: (name: string) => `Family of ${name}`,
	/**
	 * The accessible name of a name button. D210: `link` is the lower-case kind of link ("guardian"), `of` the person at the top of the list; `word` the
	 * relation to You. "Your" stands before the relation only when a link names a second person, so that two relations do not run together. The marked
	 * person says who the person is; a place in a line of succession (`as.place`) is not a relation to You.
	 */
	goLabel: (name: string, word?: string, link?: { lower: string; of: string }, as?: { you?: boolean; place?: boolean }) => {
		const from = link ? `, ${link.lower} of ${link.of}` : '';
		// The marked person keeps a place in a line of succession, so that the Show view does not lose it.
		if (as?.you) return `${name}${from}${word && as.place ? `, ${word}` : ''}. This person is you.`;
		const rel = word ? `, ${link && !as?.place ? 'your ' : ''}${word}` : '';
		return `${name}${from}${rel}. Show the family of ${name}.`;
	},
	editLabel: (name: string) => `Edit ${name}`,
	you: 'You',
	savedElsewhere: 'The plugin saved the person. Tap Find to see this person.',
} as const;

/**
 * D210: the kind of parent link seen from the person at the top of the phone list, as the first item of a row's text line. The words are those of
 * the relation finder's steps (`parentStepWord`, `childStepWord` in `core/relations.ts`) in capital form; the order is male, female, other. A birth
 * parent has a word only when the person also has an adoptive parent; a birth child has none.
 */
export const LINK_WORDS = {
	parent: {
		birth: ['Birth father', 'Birth mother', 'Birth parent'],
		adoptive: ['Adoptive father', 'Adoptive mother', 'Adoptive parent'],
		ward: ['Guardian', 'Guardian', 'Guardian'],
		rumoured: ['Rumoured father', 'Rumoured mother', 'Rumoured parent'],
	},
	child: {
		adoptive: ['Adopted son', 'Adopted daughter', 'Adopted child'],
		ward: ['Ward', 'Ward', 'Ward'],
		rumoured: ['Rumoured son', 'Rumoured daughter', 'Rumoured child'],
	},
} as const;

/** Toolbar of the tree view: the name of the row, the Houses button and the Focus menu item for the marked person. */
export const TOOLBAR_UI = {
	/** F13: Obsidian shows this name as a tooltip over the free points of the toolbar, so it says what the bar holds (it was only "Tree"). */
	region: 'Tools for this tree',
	housesLabel: 'Houses: edit the houses of the tree',
	focusOnYou: 'Focus on you',
} as const;

/** Notices of the tree view and of the link update that follows a rename. */
export const VIEW_NOTICE = {
	/** The update of the links in one note stopped because a write of the note took too long. */
	renameGaveUp: (note: string, old: string, next: string) =>
		`After a rename, the plugin updates the links in the trees. In the note ${note}, this update took too long, and the plugin stopped it. If a tree in the note still has the link “${old}”, replace it with “${next}”.`,
} as const;
