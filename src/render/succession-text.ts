/*
 * Fixed text of the line of succession: the Succession section of the Titles window, the line,
 * the Show bar and the open-branch rows. It has this one home; `ui-text.ts` re-exports
 * `SUCCESSION_UI`. Simplified Technical English (ASD-STE100) and the project word list apply.
 */
import { DOUBTFUL_DIED, formatYear, type InheritIllegitimate, type InheritRule, type InheritThrough, type SuccessionRule } from '../core/succession-keys';
import { PERSON_PLACEHOLDER } from './view-text';

/** "A", "A and B", "A, B and C". */
const andList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** A `died` text that only says "yes": the row of an open branch then gives no date. */
const BARE_DEATH_WORDS: readonly string[] = ['yes', 'true', 'dead', 'died', 'deceased'];

/**
 * The Succession section of the Titles window (contract 0.2.7 D.3, J, K, L), the line of succession, and the texts of the
 * Show button and its question. A text with a year has two forms: `year` is the number, or null for "now".
 */
export const SUCCESSION_UI = {
	heading: 'Succession',
	ruleLabel: 'Rule',
	ruleNone: 'None',
	// D187: the technical term in brackets.
	rules: {
		'eldest-child': 'Eldest child first (primogeniture)',
		'youngest-child': 'Youngest child first (ultimogeniture)',
		'siblings-first': 'Siblings before children (seniority)',
		'nearest-relative': 'Nearest relative first (proximity of blood)',
		'born-in-reign': 'Born during the reign first (porphyrogeniture)',
	} satisfies Record<SuccessionRule, string>,
	inheritLabel: 'Who can inherit',
	inherits: {
		'men-only': 'Men only (agnatic)',
		'men-first-in-house': 'Men first in the whole house (semi-Salic)',
		'men-first': 'Men first (male preference)',
		'no-preference': 'No preference (equal)',
		'women-first': 'Women first (female preference)',
		'women-first-in-house': 'Women first in the whole house (reverse semi-Salic)',
		'women-only': 'Women only (enatic)',
	} satisfies Record<InheritRule, string>,
	throughLabel: 'The right to inherit comes from',
	// The first choice writes no key: the test of "Who can inherit" decides who passes a claim on (K.1).
	throughSame: 'The same as Who can inherit',
	throughs: {
		men: 'Men (patrilineal)',
		women: 'Women (matrilineal)',
		anyone: 'Anyone (cognatic)',
	} satisfies Record<InheritThrough, string>,
	salic: 'This is the Salic law.',
	salicReverse: 'This is the reverse of the Salic law.',
	// F-DOCS-02: a man whose claim comes through a woman is in the first group only with "Anyone".
	houseMen: 'All men of the male line of the house come before all women, whatever the generation or degree. A man whose claim comes through a woman is in this group only if “The right to inherit comes from” is “Anyone”.',
	houseWomen: 'All women of the female line of the house come before all men, whatever the generation or degree. A woman whose claim comes through a man is in this group only if “The right to inherit comes from” is “Anyone”.',
	siblingsHint: 'The oldest generation of the house comes first: aunts and uncles, then brothers, sisters and cousins, then children.',
	nearestHint: 'Nearness is the number of steps through the family. A child is 1, a brother or sister is 2, an aunt, uncle, niece or nephew is 3, a cousin is 4.',
	matrilinealHint: 'With “Women (matrilineal)” and “Eldest child first”, the son of an elder sister comes before a brother of the ruler. If you want brothers first, choose “Siblings before children” or “Nearest relative first”.',
	rulerNoSex: (ruler: string) => `${ruler} has no sex value, so no claim passes through ${ruler}.`,
	yearLabel: 'Year',
	yearHint: 'If you leave this empty, the line is for the end of the last reign. If the last reign has no end, the line is for now. A child born after this year is not in the line.',
	illLabel: 'Children with the box “Illegitimate” ticked',
	ills: {
		no: 'They cannot inherit',
		after: 'They inherit after all people who do not have the box “Illegitimate” ticked',
		equal: 'They have the same right to inherit as the other children',
	} satisfies Record<InheritIllegitimate, string>,
	illHint: 'If you choose “Women only”, “Women first” or “Women first in the whole house”, only the mother’s side counts. If the box “Illegitimate” does not matter, choose the last option.',
	adopted: 'Adopted children can inherit',
	adoptedHint: 'Wards and rumoured children never inherit.',
	body: 'Only descendants of the first holder can inherit',
	bodyHint: (first: string) => `The first holder is ${first}. Only the descendants of ${first} are in the line. If the title goes to a new house, make a new title.`,
	// F-KIN-07: the first entry has a name only, so the first holder is the next entry that names a person in the tree.
	bodyHintSkipped: (first: string, entry: string) =>
		`The first holder in the tree is ${first}, so only the descendants of ${first} are in the line of succession. The first entry, ${entry}, is not a person in the tree. To use ${entry}, select a person in the tree as that holder. If the title goes to a new house, make a new title.`,
	outsideBody: (ruler: string, first: string) =>
		`${ruler} is not a descendant of ${first}, so nobody can inherit this title. Check the choices for adopted children and for children with the box “Illegitimate” ticked.`,
	// Named heirs and excluded people (K.3).
	heirsLabel: 'Named heirs',
	heirsHint: 'The named heirs come first, in the order of this list. The rule gives the order of the other people.',
	heirsNone: 'This title has no named heir.',
	addHeir: 'Add named heir',
	addHeirLabel: (title: string) => `Add named heir: add a named heir to ${title}`,
	heirPickerTitle: 'Select a named heir',
	excludeLabel: 'Excluded people',
	excludeHint: 'An excluded person is never in the line. The children of an excluded person stay in the line.',
	excludeNone: 'This title has no excluded person.',
	addExclude: 'Add excluded person',
	addExcludeLabel: (title: string) => `Add excluded person: add an excluded person to ${title}`,
	excludePickerTitle: 'Select an excluded person',
	pickerPlaceholder: PERSON_PLACEHOLDER,
	removeLabel: (who: string) => `Remove ${who}`,
	moveEarlierLabel: (who: string) => `Move earlier: ${who}`,
	moveLaterLabel: (who: string) => `Move later: ${who}`,
	// The state of a named heir (K.3, L.9): `year` is a number, or null for "now".
	heirNotAlive: (name: string, year: number | null) => (year === null ? `${name} is dead, so the plugin does not use ${name} as a named heir.` : `${name} is not alive in ${formatYear(year)}, so the plugin does not use ${name} as a named heir.`),
	heirNotBorn: (name: string, year: number | null) => (year === null ? `${name} is not born yet, so the plugin does not use ${name} as a named heir.` : `${name} is not born yet in ${formatYear(year)}, so the plugin does not use ${name} as a named heir.`),
	heirIsRuler: (name: string) => `${name} is the ruler of this line, so the plugin does not use ${name} as a named heir.`,
	heirExcluded: (name: string) => `${name} is in the list of excluded people, so ${name} is not in the line.`,
	heirNotInTree: 'No person in the tree has this ID.',
	// The line.
	lineHeading: (ruler: string, year: number | null) => (year === null ? `Line of succession after ${ruler} now` : `Line of succession after ${ruler} in ${formatYear(year)}`),
	// The bold heading above the rows of the Line of succession section.
	lineAfter: (ruler: string, year: number | null) => (year === null ? `After ${ruler} now` : `After ${ruler} in ${formatYear(year)}`),
	lineRowLabel: (name: string, ordinal: string) => `${ordinal} ${name}: show the card in the tree`,
	more: 'and more people',
	// Open branches (M.8): a person who died and has no children in the tree. DIED is the text of the note.
	branchMark: '?',
	branchRow: (name: string, died: string) => {
		const text = died.trim();
		const word = text.toLowerCase();
		if (text === '' || BARE_DEATH_WORDS.includes(word)) return `Open branch of ${name}: no children in the tree`;
		if (DOUBTFUL_DIED.includes(word)) return `Open branch of ${name} (death not confirmed): no children in the tree`;
		return `Open branch of ${name} (died ${text}): no children in the tree`;
	},
	branchRowLabel: (row: string) => `${row}: show the card in the tree`,
	branchNote: 'A grey row shows a person who died and has no children in the tree. The person may have children that are not in the tree yet. If the person had no children, tick “No children” in the person window.',
	moreBranches: 'and more open branches',
	noHeir: 'No heir in the tree',
	heirCount: (n: number) => (n === 1 ? '1 heir' : `${n} heirs`),
	// A written value that the plugin cannot read (the first option of a dropdown): VALUE is the text of the note, if the window can show it.
	unknownValue: (value: string | null) => (value === null ? 'Unknown value' : `Unknown value (${value})`),
	yearBad: (text: string) => `The plugin cannot read the year in the note: ${text}. If you type a year here, the plugin replaces it.`,
	old: (name: string, age: number, year: number | null) => {
		const years = age === 1 ? '1 year' : `${age} years`;
		return year === null ? `${name} is older than ${years}. If ${name} is dead, add a death date.` : `${name} is older than ${years} in ${formatYear(year)}. If ${name} is dead, add a death date.`;
	},
	noRuler: (year: number | null) => (year === null ? 'The title has no holder now, so there is no line of succession.' : `The title has no holder in ${formatYear(year)}, so there is no line of succession.`),
	rulerNotInTree: (year: number | null) =>
		year === null ? 'The holder of the title is not in the tree now. The plugin cannot show the line of succession.' : `The holder of the title in ${formatYear(year)} is not in the tree. The plugin cannot show the line of succession.`,
	badRule: 'The succession rule in the tree text has an error. Open the list of warnings.',
	newTitle: 'Save the title first. Then you can set a succession rule.',
	coRulers: (n: number, ruler: string, year: number | null) => (year === null ? `${n} holders rule now. The line is after ${ruler}.` : `${n} holders rule in ${formatYear(year)}. The line is after ${ruler}.`),
	// The notes under and above the line (SuccessionResult.notes, 0.2.8). The window shows them as quiet text lines.
	orderFromNote: (a: string, b: string) => `The order of ${a} and ${b} comes from the order in the note. Add a birth year to change it.`,
	orderFromNoteSameYear: (a: string, b: string) => `The order of ${a} and ${b} comes from the order in the note, because both have the same birth year.`,
	orderContradiction: (names: string | readonly string[]) =>
		`The birth years and the order in the note do not agree for ${typeof names === 'string' ? names : andList(names)}. The plugin puts the people who have a birth year in the order of the birth years.`,
	coRulersNotInLine: 'The other holders are not in the line of succession, unless they are named heirs.',
	bornInReignNoFrom: (parent: string) =>
		`${parent} has no start year as a holder of this title. So the rule “Born during the reign first” puts the children of ${parent} in the order of “Eldest child first”. Add a start year in the field “From”.`,
	throughSpouseNote: (holder: string, spouse: string) => `${holder} holds the title through the spouse, ${spouse}. The line of succession is for ${spouse}.`,
	noYearDate: (name: string) => `The plugin cannot read a year in the date of ${name}.`,
	noYearReign: (name: string) => `The plugin cannot read a year in the reign of ${name}.`,
	leftOutNoSex: (n: number) => (n === 1 ? '1 person has no “sex: m” or “sex: f”, so this rule does not include this person.' : `${n} people have no “sex: m” or “sex: f”, so this rule does not include them.`),
	noBirthYear: (n: number) => (n === 1 ? '1 heir has no birth year, so this rule cannot put this heir in order.' : `${n} heirs have no birth year, so this rule cannot put them in order.`),
	show: 'Show',
	showLabel: 'Show the line of succession on the tree',
	// The Show view (F.3, F.6): the bar above the tree, the card label and the row of the phone list.
	bar: (title: string, year: number | null) => (year === null ? `Line of succession: ${title}, now` : `Line of succession: ${title}, ${formatYear(year)}`),
	barNoHeir: (title: string, year: number | null) => `${year === null ? `Line of succession: ${title}, now` : `Line of succession: ${title}, ${formatYear(year)}`}. No heir in the tree.`,
	barClose: 'Close',
	barCloseLabel: 'Close the line of succession',
	inLine: (ordinal: string) => `${ordinal} in line`,
	openBranchWord: 'Open branch',
	openBranchCard: 'open branch',
	unsavedTitle: 'Save your changes?',
	unsaved: 'You did not save your changes. The plugin shows the line only after you save them. Save them now?',
	saveAndShow: 'Save and show',
	// The setting texts are in SETTINGS_UI. The delete texts (K.3, A.6):
	deleteHeir: (name: string, titles: number) => (titles === 1 ? `The plugin also removes ${name} as the named heir of 1 title.` : `The plugin also removes ${name} as the named heir of ${titles} titles.`),
	deleteExcluded: (name: string, titles: number) =>
		titles === 1 ? `The plugin also removes ${name} from the excluded people of 1 title.` : `The plugin also removes ${name} from the excluded people of ${titles} titles.`,
} as const;
