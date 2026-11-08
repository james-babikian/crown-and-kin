/*
 * Fixed text of the settings tab, the commands Insert family tree and Show render timing, and the Notices and the report of the update of
 * tree links after a rename. Simplified Technical English (ASD-STE100) and the project word list apply.
 * `ui-text.ts` re-exports every name, so old imports keep working.
 */

import { quote } from '../core/quote';

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
	/** The line of succession. */
	successionLength: 'Length of the line of succession',
	successionLengthDesc: 'This is the number of people that the line of succession shows. Use a number from 1 to 20.',
	oldAge: 'Warn about people older than',
	oldAgeDesc: 'The plugin warns about a person in the line of succession who is older than this number of years and has no death year. Use a number from 0 to 1000. Use 0 to stop the warning.',
	youngDeathAge: 'Age for open branches',
	youngDeathAgeDesc: 'For a person who died younger than this age, the line of succession shows no open branch. The note must give the birth year and the death year. Use a number from 0 to 1000. Use 0 to show every open branch.',
	/** Which cards show the arms of a house. */
	armsOnCards: 'Arms on cards',
	armsFew: 'Founders and holders',
	armsAll: 'Every card',
	armsOnCardsDesc: 'Choose which cards show the arms of a house. For example, with the first choice, the founder of House Valmont shows the arms. A person who married into a house also shows them. A child of the founder shows them only if the child holds a title. A card always shows personal arms.',
	/** D188 item 10. */
	manyParents: 'Warn about more than 2 parents',
	manyParentsDesc: 'If this is on, the plugin warns when a person has more than 2 parents of one type: birth, adoptive, ward or begetter. It also warns when a person has more than 2 parents by blood. Birth parents and begetters together are the parents by blood. If this is off, the plugin gives no warning for these. A person can have up to 8 rumoured parents. The plugin always warns about more than 8 rumoured parents.',
	phoneDirection: 'Tree direction on a phone held upright',
	directionSideways: 'Sideways',
	directionDown: 'Like the computer',
	phoneDirectionDesc: 'This sets the direction of the tree in the full-screen view on a phone that you hold upright. For example, Sideways puts the parents at the left, and Like the computer puts them at the top.',
	/** D174 (spec §9): the text is the spec's, word for word. */
	oneParentUnknown: 'Assume an unknown second parent',
	oneParentUnknownDesc:
		'If this setting is on, a person with one listed parent has a second parent who is not known. Two people with the same listed parent show as half-siblings. If this setting is off, two people who list only the same parent show as full siblings. If a person lists fewer than two other parents, a rumoured parent shows that a parent is not known.',
	/** Spec §13.7. */
	portraits: 'Show portraits on cards',
	portraitsDesc: 'If this is on, the cards show the portraits of the people.',
	/** D113 item 4. */
	houseGeneration: 'Show generation on the house page',
	houseGenerationDesc: 'If this is on, the house page shows the generation of each person. If this is off, the house page does not show it. The note that you make from the house page always has the generation.',
	generations: 'Generations in focus mode',
	generationsDesc: 'This is the number of generations above and below the person in focus mode. The default is 3. A tree can have its own number.',
	/** Spec §13.0 item 3. */
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
	/** The same sentence with straight marks: the plugin writes it into the user's note, and it keeps that text plain ASCII. */
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
type RenamedKind = 'note' | 'picture' | 'both';

const RENAMED_NOTE_PROGRESS = 'The plugin updates the tree links to the renamed note. This can take some time.';
const RENAMED_NOTE_NO_LINKS = 'The trees have no links to the renamed note. The plugin did not change a tree.';

/** "the renamed note", "the renamed picture" or "the renamed notes and pictures". */
function renamedWhat(kind: RenamedKind): string {
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
