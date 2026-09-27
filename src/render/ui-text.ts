/*
 * Fixed text that the tree view and the edit sheet show: toolbar labels, the banner, the lists, the
 * sheet and the Notices. STE rules and
 * The project word list apply. Problem sentences themselves come from `src/core/messages.ts`.
 */

export const UI = {
	errorTitle: 'The plugin cannot show this tree',
	internalError: 'The plugin cannot show this tree because of an error in the plugin. Close the note. Open it again.',
	bannerTitle: 'Editing is off',
	bannerLead: 'Correct these problems. Then you can edit this tree:',
	fit: 'Fit the tree in the view',
	legend: 'Show the line styles',
	legendTitle: 'Line styles',
	spouseListTitle: 'Partners',
} as const;

/** Toolbar badge label and list title for `count` problems. */
export function problemsLabel(count: number): string {
	return count === 1 ? 'This tree has 1 problem. Show the problem.' : `This tree has ${count} problems. Show the problems.`;
}

export function problemsTitle(count: number): string {
	return count === 1 ? '1 problem in this tree' : `${count} problems in this tree`;
}

export const PROBLEMS_HINT = 'Select a problem to show the people it is about.';

/** Read-only trees (spec §6.1) and the resize handle (spec §7.5). */
export const BLOCK_UI = {
	openSource: 'Open note',
	openSourceLabel: 'Open the note that contains this tree.',
	readOnly: 'Read only',
	resizeLabel: 'Drag to change the height of the tree.',
} as const;

/** The edit sheet (spec §6.3, §7.4). */
export const SHEET = {
	save: 'Save',
	cancel: 'Cancel',
	close: 'Close',
	name: 'Name',
	title: 'Title',
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
} as const;

/** Names of parent types and partnership types, as the sheet and the flows show them. */
export const PARENT_TYPE_TEXT: Record<string, string> = { birth: 'Birth parent', adoptive: 'Adoptive parent', ward: 'Guardian', rumoured: 'Rumoured parent' };
export const UNION_TYPE_TEXT: Record<string, string> = { marriage: 'Marriage', betrothal: 'Betrothal', concubinage: 'Concubinage', affair: 'Affair' };

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
	heading: 'Family',
	parents: 'Parents',
	noParents: 'This person has no recorded parents.',
	parentTypeLabel: (name: string) => `Type of parent: ${name}`,
	remove: 'Remove as parent',
	removeParentLabel: (name: string) => `Remove ${name} as a parent`,
	partners: 'Partners',
	noPartners: 'This person has no recorded partners.',
	noPartnership: 'No recorded partnership',
	edit: 'Edit',
	editLabel: (name: string) => `Edit the partnership with ${name}`,
	removePartnership: 'Remove partnership',
	removePartnershipLabel: (name: string) => `Remove the partnership with ${name}`,
	siblings: 'Position among siblings',
	position: (i: number, n: number) => `Position ${i} of ${n}`,
	moveEarlier: 'Move earlier',
	moveLater: 'Move later',
	actions: 'Actions',
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
	typeFull: 'This person has 2 parents of this type.',
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
	pickerParent: 'Type the name of the parent',
	pickerChild: 'Type the name of the child',
	pickerPartner: 'Type the name of the partner',
	pickerEmpty: 'No person has this name.',
	createNew: (text: string) => (text.trim() ? `Create a new person "${text.trim()}"` : 'Create a new person'),
	autoUnion: (a: string, b: string) => `The plugin also added a marriage of ${a} and ${b}. To change its type, open the sheet of ${a}. Then select Edit under Partners.`,
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
	partnershipText: (type: string, a: string, b: string) =>
		`The plugin removes the ${type.toLowerCase()} of ${a} and ${b}. If ${a} and ${b} have children, the children stay connected to both parents.`,
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
export function deleteText(name: string, s: { unions: number; childLinks: number; clearsStart: boolean; clearsFocus: boolean }): string[] {
	const out: string[] = [];
	if (s.unions > 0) out.push(s.unions === 1 ? 'The plugin also removes 1 partnership of this person.' : `The plugin also removes ${s.unions} partnerships of this person.`);
	if (s.childLinks > 0) out.push(s.childLinks === 1 ? `The plugin removes ${name} as a parent of 1 person.` : `The plugin removes ${name} as a parent of ${s.childLinks} people.`);
	if (s.clearsStart) out.push('The tree starts at this person now. After the delete, it will start at a different person.');
	if (s.clearsFocus) out.push('The tree shows the family of this person now. After the delete, it will show all people.');
	out.push('The plugin does not delete other people.');
	return out;
}

/** The empty block (spec §5.9) and the toolbar button (spec §6.10). */
export const ADD_UI = {
	addFirst: 'Add first person',
	empty: 'This tree has no people.',
	addPerson: 'Add a person to the tree',
} as const;

/** The full-screen view (spec §7.1), its toolbar buttons (spec §6.10) and Find. */
export const FULL_UI = {
	expand: 'Show the tree in a full-screen view',
	close: 'Close the full-screen view',
	dialog: 'Tree in a full-screen view',
	find: 'Find a person in the tree',
	findTitle: 'Find a person',
	findPlaceholder: 'Type the name of the person',
	gone: 'The plugin cannot find this tree in the note now. It closed the full-screen view.',
	invalid: 'The tree text has an error now. The plugin closed the full-screen view.',
	failed: 'The plugin closed the full-screen view because of an error in the plugin.',
} as const;

/** Focus mode and the pin (spec §5.6, §6.3, §6.10, D18). */
export const FOCUS_UI = {
	focus: 'Focus on a person in the tree',
	pickerTitle: 'Focus on a person',
	pickerPlaceholder: 'Type the name of the person',
	showAll: 'Show all people',
	focusHere: 'Focus here',
	focusHereLabel: (name: string) => `Show only the family of ${name}`,
	pin: 'Pin focus here',
	pinLabel: (name: string) => `Always open this tree on the family of ${name}`,
	unpin: 'Remove pin',
	unpinLabel: (name: string) => `Do not always open this tree on the family of ${name}`,
	/** The `+` badge on a card with relatives who are not shown. */
	badgeLabel: (name: string, hidden: number) =>
		hidden === 1 ? `Show the family of ${name}. The tree does not show 1 relative.` : `Show the family of ${name}. The tree does not show ${hidden} relatives.`,
} as const;

/** D32: names of the house colours of `HOUSE_PALETTE`, in the same order. */
export const HOUSE_COLOUR_NAMES = ['Dark red', 'Red', 'Orange', 'Gold', 'Olive', 'Green', 'Blue green', 'Light blue', 'Dark blue', 'Purple', 'Brown', 'Grey'] as const;

/** The Houses window and its toolbar button (spec §6.10, D32, D36). */
export const HOUSES = {
	button: 'Edit the houses of the tree',
	title: 'Houses',
	intro: 'The colour of a house shows on the cards of the people of that house.',
	none: 'This tree has no houses.',
	newHouse: 'New house',
	swatchLabel: (house: string) => `Change the colour of ${house}`,
	nameLabel: 'Name of the house',
	count: (n: number) => (n === 0 ? 'No people' : n === 1 ? '1 person' : `${n} people`),
	delete: 'Delete',
	deleteLabel: (house: string) => `Delete ${house}`,
	add: 'Add house',
	paletteTitle: (house: string) => `Colour of ${house}`,
	otherColour: 'Other colour',
	confirmTitle: (house: string) => `Delete ${house}?`,
	confirmPeople: (names: string[]) =>
		names.length === 1 ? `1 person has this house: ${names[0]}.` : `${names.length} people have this house: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`,
	confirmAsk: 'Select what happens to these people.',
	clearLabel: 'Remove the house from these people',
	clearDetail: 'These people will have no house. Their cards will show no house colour.',
	keepLabel: 'Keep the house for these people',
	keepDetail: 'The tree text keeps the house for these people. The tree will show a warning for each of them.',
	cancel: 'Cancel',
	discardText: 'You did not save the changes to the houses.',
	cannotOpen: 'The plugin cannot show the houses. The tree text has an error.',
	needName: 'Enter a name for each house.',
	deleted: (houses: string[]) => (houses.length === 1 ? `The plugin deleted ${houses[0]}. You can undo this.` : `The plugin deleted ${houses.length} houses. You can undo this.`),
	stale: 'The tree changed after you opened this window. The plugin did not save. Your changes are still in the window. Select Save again to save them.',
	missing: 'The plugin cannot find this tree in the note. It did not save your changes. Your changes are still in the window.',
	invalid: 'The plugin cannot save. The tree text has an error. Your changes are still in the window.',
	refused: 'The plugin cannot save this change safely. The note did not change. Your changes are still in the window.',
	failed: 'The plugin cannot save your changes because of an error in the plugin. Your changes are still in the window.',
} as const;

/** The settings tab (spec §9, D33). */
export const SETTINGS_UI = {
	groups: { height: 'Height in a note', cards: 'Cards', focus: 'Focus mode', links: 'Links', repair: 'Repair' },
	heightDesktop: 'Height on a computer or tablet',
	heightDesktopDesc: 'This is the height of a tree in a note, in pixels. The default is 500. If you drag the bottom edge of a tree, that tree keeps its new height.',
	heightPhone: 'Height on a phone',
	heightPhoneDesc: 'This is the height of a tree in a note, as a part of the screen height. The default is 60%.',
	cardSize: 'Card size',
	cardSizeDesc: 'Compact cards show more people on the screen. Normal cards show more of each name.',
	cardNormal: 'Normal',
	cardCompact: 'Compact',
	dates: 'Show dates on cards',
	datesDesc: 'If this is on, the cards show when each person was born and died.',
	generations: 'Generations in focus mode',
	generationsDesc: 'This is the number of generations above and below the person in focus mode. The default is 3. A tree can have its own number.',
	links: 'Update tree links when you rename a note',
	linksDesc: 'If you rename a note, the plugin changes the links to that note in all trees. If this is off, the links do not change.',
	cache: 'Arrange all trees again',
	cacheDesc: 'The plugin keeps the arrangement of each tree in memory. This makes trees open quickly. If a tree looks wrong, select Arrange again.',
	cacheButton: 'Arrange again',
	cacheDone: 'The plugin will arrange each tree again when it shows the tree.',
} as const;

/** The command Insert family tree (spec §5.9, D34). */
export const INSERT_UI = {
	command: 'Insert family tree',
	hint: 'To add the first person, select "Add first person" in Reading view or Live Preview.',
} as const;

/** Notices after a note was renamed (spec §6.9, D6, D35). */
export const RENAME_UI = {
	/** D35: only the numbers. */
	updated: (links: number, trees: number) => `The plugin changed ${links === 1 ? '1 link' : `${links} links`} in ${trees === 1 ? '1 tree' : `${trees} trees`}.`,
	failed: (note: string, old: string, next: string) => `The plugin cannot change the link "${old}" in a tree in the note "${note}". Replace "${old}" with "${next}" by hand.`,
	moreFailed: (trees: number) => (trees === 1 ? 'The plugin also cannot change the links in 1 other tree.' : `The plugin also cannot change the links in ${trees} other trees.`),
	/** After 2 s, while the update runs (also while it waits for Obsidian's own link update). */
	progress: 'The plugin updates the tree links to the renamed note. This can take some time.',
	/** Only after the progress Notice: it tells the user that the update ended. */
	noLinks: 'The trees have no links to the renamed note. The plugin did not change a tree.',
	/** A tree named the old note, but its link now opens another note that existed at the rename. */
	kept: (link: string, note: string, other: string) =>
		`The plugin did not change the link "${link}" in a tree in the note "${note}". The link now opens a different note with the same name: "${other}".`,
	moreKept: (trees: number) => (trees === 1 ? 'The plugin also did not change the links in 1 other tree for the same reason.' : `The plugin also did not change the links in ${trees} other trees for the same reason.`),
	/** An error stopped the whole update. */
	stopped: (what: string) => `The plugin cannot complete the update of the tree links to ${what}. Some trees can still have the old link. Change these links by hand.`,
	command: 'Show the last link update',
	report: linkReportText,
} as const;

/** What the command "Show the last link update" tells (rename-links.ts fills it). */
export interface LinkReportText {
	renames: { from: string; to: string }[];
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

/** The renamed note in a Notice: `"Old"`, or the number of notes after a folder rename. */
export function renamedText(renames: { from: string }[]): string {
	return renames.length === 1 ? `"${renames[0].from}"` : `${renames.length} renamed notes`;
}

/** Most notes that the report names in each list. */
const REPORT_NAMES = 3;

function linkReportText(r: LinkReportText | null, enabled: boolean): string {
	const off = enabled ? '' : ` The setting "${SETTINGS_UI.links}" is off.`;
	if (!r) return `The plugin did not update tree links after Obsidian started.${off}`;
	const what = r.renames.length === 1 ? `"${r.renames[0].from}" to "${r.renames[0].to}"` : `${r.renames.length} notes`;
	const head = {
		running: `The plugin still updates the tree links after the rename of ${what}.`,
		done: `The last link update was after the rename of ${what}. It took ${(r.ms / 1000).toFixed(1)} seconds.`,
		failed: `The last link update was after the rename of ${what}. An error stopped it before the end.`,
		stopped: `The last link update was after the rename of ${what}. It stopped before the end. The plugin will continue it at the next start.`,
	}[r.state];
	// One paragraph per topic (STE rule 11); the command shows each paragraph as its own block.
	const notes = [`Notes in the vault: ${r.notes}. Notes that the plugin read: ${r.read}.`];
	if (r.unread) notes.push(`Notes that the plugin cannot read: ${r.unread}.`);
	const groups = [[head], notes, [`Trees with a link to the renamed note: ${r.trees}. Changed links: ${r.links}. Changed trees: ${r.changedTrees}.`]];
	if (r.skipped.length) {
		groups.push([
			`Links that the plugin did not change: ${r.skipped.length}.`,
			...r.skipped.slice(0, REPORT_NAMES).map((s) => `The link "${s.link}" in the note "${s.note}" opens a different note with the same name: "${s.other}".`),
		]);
	}
	if (r.failed.length) {
		groups.push([`Trees that the plugin cannot change: ${r.failed.length}.`, ...r.failed.slice(0, REPORT_NAMES).map((n) => `The plugin cannot change a tree in the note "${n}".`)]);
	}
	return groups.map((g) => g.join(' ')).join('\n\n') + off;
}

/** D28: the first view on an upright phone leaves children of the person outside the box. */
export const HINT_UI = {
	up: (n: number) => (n === 1 ? '↑ 1 more child' : `↑ ${n} more children`),
	down: (n: number) => (n === 1 ? '↓ 1 more child' : `↓ ${n} more children`),
} as const;

/** Notices about writes (spec §6.1). */
export const WRITE_TEXT = {
	stale: 'The tree changed after you opened it. The plugin did not save your changes. It loaded the tree again.',
	staleInSheet: 'The tree changed after you opened this sheet. The plugin did not save. Your changes are still in the sheet. Select Save again to save them.',
	missing: 'The plugin cannot find this tree in the note. It did not save your changes. Your changes are still in the sheet.',
	personGone: 'This person is not in the tree now. The plugin cannot save your changes. You can copy your text from the sheet.',
	personNotFound: 'This person is not in the tree now.',
	blocked: 'The plugin cannot save. Editing is off for this tree.',
	invalid: 'The plugin cannot save. The tree text has an error. Your changes are still in the sheet.',
	refused: 'The plugin cannot save this change safely. The note did not change. Your changes are still in the sheet.',
	failed: 'The plugin cannot save your changes because of an error in the plugin. Your changes are still in the sheet.',
	heightFailed: 'The plugin cannot save the new height of the tree.',
	undoCommand: 'Undo last tree edit',
	undoDone: 'The plugin undid the last tree edit.',
	undoEmpty: 'There is no tree edit to undo.',
	undoChanged: 'The plugin cannot undo the last tree edit. The tree changed after the edit.',
	undoMissing: 'The plugin cannot find the tree of the last edit.',
	cycle: 'The plugin cannot make this change. A person cannot be their own ancestor.',
	limit: 'The plugin cannot make this change. A person can have only 2 parents of each type.',
	noSibling: 'There is no sibling in that direction.',
	needNameFirst: 'First, enter a name for this person.',
} as const;
