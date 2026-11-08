/*
 * Fixed text of the line of succession: the Succession section of the Titles window, the line,
 * the Show bar and the open-branch rows. It has this one home; `ui-text.ts` re-exports
 * `SUCCESSION_UI`. Simplified Technical English (ASD-STE100) and the project word list apply.
 */
import { andList } from '../core/messages';
import { DOUBTFUL_DIED, formatYear, type InheritIllegitimate, type InheritRule, type InheritThrough, type SuccessionRule } from '../core/succession-keys';
import { quote } from '../core/quote';
import { isolateName } from './name-bidi';
import { PERSON_PLACEHOLDER } from './view-text';

/**
 * The year in a sentence of the line: the text that gives Y, as written (`SuccessionResult.yearText`, spec §14 rule 7), or null for "now".
 * A number is the internal year and shows with `formatYear`; the Titles window still passes `result.year` until step 4.3 moves it to `yearText`.
 */
type YearInText = string | number | null;
const yearIn = (year: string | number): string => (typeof year === 'number' ? formatYear(year) : year);

/** A `died` text that only says "yes": the row of an open branch then gives no date. */
const BARE_DEATH_WORDS: readonly string[] = ['yes', 'true', 'dead', 'died', 'deceased'];

/** The one separator of the bar sentence, between the year and the rule (B-0036). */
export const BAR_SEPARATOR = ' · ';

/**
 * The Succession section of the Titles window (J, K, L), the line of succession, and the texts of the
 * Show button and its question. A text with a year has two forms: `year` is the text that gives Y (`YearInText`), or null for "now".
 */
export const SUCCESSION_UI = {
	heading: 'Succession',
	ruleLabel: 'Rule',
	ruleNone: 'None',
	// D187: the technical term in brackets.
	rules: {
		'eldest-child': 'Eldest child first (primogeniture)',
		'youngest-child': 'Youngest child first (ultimogeniture)',
		'siblings-first': 'Oldest generation first (lateral succession)',
		'nearest-relative': 'Nearest relative first (proximity of blood)',
		'born-in-reign': 'Born during the reign first (porphyrogeniture)',
	} satisfies Record<SuccessionRule, string>,
	inheritLabel: 'Who can inherit',
	inherits: {
		'men-only': 'Men only (agnatic)',
		'men-first-in-house': 'Men first in the whole dynasty (semi-Salic)',
		'men-first': 'Men first (male preference)',
		'no-preference': 'No preference (equal)',
		'women-first': 'Women first (female preference)',
		'women-first-in-house': 'Women first in the whole dynasty (reverse semi-Salic)',
		'women-only': 'Women only (enatic)',
	} satisfies Record<InheritRule, string>,
	throughLabel: 'The right to inherit comes from',
	// The first choice writes no key: the test of "Who can inherit" decides who passes a claim on.
	throughSame: 'The same as Who can inherit',
	throughs: {
		men: 'Men (patrilineal)',
		women: 'Women (matrilineal)',
		anyone: 'Anyone (cognatic)',
	} satisfies Record<InheritThrough, string>,
	salic: 'This is the Salic law.',
	salicReverse: 'This is the reverse of the Salic law.',
	// A man whose claim comes through a woman is in the first group only with "Anyone".
	houseMen: 'The dynasty is all the descendants of the founders. Every man of the male line of the dynasty comes before every woman. This is true even if a woman is of an older generation or is nearer to the ruler. A man whose claim comes through a woman is in this group only if “The right to inherit comes from” is “Anyone”.',
	houseWomen: 'The dynasty is all the descendants of the founders. Every woman of the female line of the dynasty comes before every man. This is true even if a man is of an older generation or is nearer to the ruler. A woman whose claim comes through a man is in this group only if “The right to inherit comes from” is “Anyone”.',
	// D292: the rule goes by generation. The order of the list is the order of the levels of spec §13.21 rule 16.
	siblingsHint:
		'The oldest generation comes first: great-uncles and great-aunts, then aunts and uncles, then brothers, sisters and cousins, then children, nephews and nieces. Age does not decide between generations. For example, an uncle of the ruler comes before a brother of the ruler, even if the uncle is younger.',
	nearestHint: 'Nearness is the number of steps through the family. A child is 1, a brother or sister is 2, an aunt, uncle, niece or nephew is 3, a cousin is 4.',
	matrilinealHint:
		'If “The right to inherit comes from” is “Women (matrilineal)” and the rule is “Eldest child first (primogeniture)”, the son of an elder sister comes before a brother of the ruler. If you want brothers first, choose “Oldest generation first (lateral succession)” or “Nearest relative first (proximity of blood)” as the rule.',
	rulerNoSex: (ruler: string) => `${ruler} has no sex value, so no claim passes through ${ruler}.`,
	yearLabel: 'Year',
	yearHint: 'If you leave this empty, the line is for the end of the last reign. If the last reign has no end, the line is for now. A child born after this year is not in the line.',
	illLabel: 'Children with the box “Illegitimate” ticked',
	ills: {
		no: 'They cannot inherit',
		after: 'They inherit after all people who do not have the box “Illegitimate” ticked',
		equal: 'They have the same right to inherit as the other children',
	} satisfies Record<InheritIllegitimate, string>,
	// Shown only when a claim passes through women alone (inherit-through women, or not written with Women only). The last option is `ills.equal`.
	illHint: 'Here a claim passes only through women, so only the mother’s side counts. If the box “Illegitimate” does not matter, choose “They have the same right to inherit as the other children”.',
	// Women first in the whole dynasty with no written inherit-through: the first group is the women of the female line.
	illHintFirstGroup: 'The first group, the women of the female line, has a claim only through the mother’s side. For everyone else the father’s side also counts, so the box “Illegitimate” matters there.',
	adopted: 'Adopted children can inherit',
	adoptedHint: 'No claim passes through a guardian, a rumoured parent or a begetter.',
	body: 'Only descendants of the first holder can inherit',
	bodyHint: (first: string) => `The first holder is ${isolateName(first)}. Only the descendants of ${isolateName(first)} are in the line. If the title goes to a new house, make a new title.`,
	// D291: while the switch is off, the hint says what the switch would do; the next hint (`cadetHint`) shows only when it matters.
	bodyHintOff: (first: string) => `The first holder is ${isolateName(first)}. If you turn on this switch, only the descendants of ${isolateName(first)} are in the line.`,
	cadetHint: (name: string, first: string) =>
		`${isolateName(name)} is in the line of succession, but ${isolateName(name)} is not a descendant of ${isolateName(first)}. If only the descendants of ${isolateName(first)} can inherit this title, turn on this switch. Then ${isolateName(name)} leaves the line.`,
	// The first entry has a name only, so the first holder is the next entry that names a person in the tree.
	bodyHintSkipped: (first: string, entry: string) =>
		`The first holder in the tree is ${isolateName(first)}, so only the descendants of ${isolateName(first)} are in the line of succession. The first entry, ${isolateName(entry)}, is not a person in the tree. To use ${isolateName(entry)}, select a person in the tree as that holder. If the title goes to a new house, make a new title.`,
	bodyHintSkippedOff: (first: string, entry: string) =>
		`The first entry, ${isolateName(entry)}, is not a person in the tree, so the first holder in the tree is ${isolateName(first)}. If you turn on this switch, only the descendants of ${isolateName(first)} are in the line. To use ${isolateName(entry)}, select a person in the tree as that holder.`,
	outsideBody: (ruler: string, first: string) =>
		`${isolateName(ruler)} is not a descendant of ${isolateName(first)}, so nobody can inherit this title. Check the choices for adopted children and for children with the box “Illegitimate” ticked.`,
	// Named heirs and excluded people.
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
	moveEarlierLabel: (who: string) => `Move earlier: move ${who} earlier`,
	moveLaterLabel: (who: string) => `Move later: move ${who} later`,
	// The state of a named heir: `year` is a number, or null for "now".
	heirNotAlive: (name: string, year: YearInText) => (year === null ? `${isolateName(name)} is dead, so the plugin does not use ${isolateName(name)} as a named heir.` : `${isolateName(name)} is not alive in ${yearIn(year)}, so the plugin does not use ${isolateName(name)} as a named heir.`),
	heirNotBorn: (name: string, year: YearInText) => (year === null ? `${isolateName(name)} is not born yet, so the plugin does not use ${isolateName(name)} as a named heir.` : `${isolateName(name)} is not born yet in ${yearIn(year)}, so the plugin does not use ${isolateName(name)} as a named heir.`),
	heirIsRuler: (name: string) => `${isolateName(name)} is the ruler of this line, so the plugin does not use ${isolateName(name)} as a named heir.`,
	heirExcluded: (name: string) => `${isolateName(name)} is in the list of excluded people, so ${isolateName(name)} is not in the line.`,
	heirNotInTree: 'No person in the tree has this ID.',
	// The bold heading above the rows of the Line of succession section.
	lineAfter: (ruler: string, year: YearInText) => (year === null ? `After ${isolateName(ruler)} now` : `After ${isolateName(ruler)} in ${yearIn(year)}`),
	lineRowLabel: (name: string, ordinal: string) => `${ordinal} ${name}: show the card in the tree`,
	more: 'and more people',
	// Open branches: a person who died and has no children in the tree. DIED is the text of the note.
	branchMark: '?',
	branchRow: (name: string, died: string) => {
		const text = died.trim();
		const word = text.toLowerCase();
		if (text === '' || BARE_DEATH_WORDS.includes(word)) return `Open branch of ${isolateName(name)}: no children in the tree`;
		if (DOUBTFUL_DIED.includes(word)) return `Open branch of ${isolateName(name)} (death not confirmed): no children in the tree`;
		return `Open branch of ${isolateName(name)} (died ${text}): no children in the tree`;
	},
	branchRowLabel: (row: string) => `${row}: show the card in the tree`,
	branchNote: 'A grey row shows a person who died and has no children in the tree. The person may have children that are not in the tree yet. If the person had no children, tick “No children” in the person window.',
	moreBranches: 'and more open branches',
	noHeir: 'No heir in the tree',
	heirCount: (n: number) => (n === 1 ? '1 heir' : `${n} heirs`),
	// A written value that the plugin cannot read (the first option of a dropdown): VALUE is the text of the note, if the window can show it.
	unknownValue: (value: string | null) => (value === null ? 'Unknown value' : `Unknown value (${value})`),
	yearBad: (text: string) => `The plugin cannot read the year in the note: ${text}. If you type a year here, the plugin replaces it.`,
	old: (name: string, age: number, year: YearInText) => {
		const years = age === 1 ? '1 year' : `${age} years`;
		return year === null ? `${isolateName(name)} is older than ${years}. If ${isolateName(name)} is dead, add a death date.` : `${isolateName(name)} is older than ${years} in ${yearIn(year)}. If ${isolateName(name)} is dead, add a death date.`;
	},
	noRuler: (year: YearInText) => (year === null ? 'The title has no holder now, so there is no line of succession.' : `The title has no holder in ${yearIn(year)}, so there is no line of succession.`),
	rulerNotInTree: (year: YearInText) =>
		year === null ? 'The holder of the title is not in the tree now. The plugin cannot show the line of succession.' : `The holder of the title in ${yearIn(year)} is not in the tree. The plugin cannot show the line of succession.`,
	badRule: 'The succession rule in the tree text has an error. Open the list of warnings.',
	/** D330 O-22: the note on a title that is not saved yet, in place of the line of succession. */
	newTitleLine: 'Save the title first. Then you can show the line of succession.',
	coRulers: (n: number, ruler: string, year: YearInText) => (year === null ? `${n} holders rule now. The line is after ${ruler}.` : `${n} holders rule in ${yearIn(year)}. The line is after ${ruler}.`),
	// The notes under and above the line (SuccessionResult.notes). The window shows them as quiet text lines.
	orderFromNote: (a: string, b: string) => `The order of ${isolateName(a)} and ${isolateName(b)} comes from the order in the note. Add a birth year to change it.`,
	orderFromNoteSameYear: (a: string, b: string) => `The order of ${isolateName(a)} and ${isolateName(b)} comes from the order in the note, because both have the same birth year.`,
	orderContradiction: (names: string | readonly string[]) =>
		`The birth years and the order in the note do not agree for ${typeof names === 'string' ? isolateName(names) : andList(names.map(isolateName))}. The plugin puts the people who have a birth year in the order of the birth years.`,
	// D334 Q11: why the first heir is not a child of the ruler. `relation` is the lower-case word of the heir for the ruler ("sister"); `rule` is the name of the rule as the Rule list or the list of "Who can inherit" shows it.
	firstHeirNoChild: (ruler: string, heir: string, relation: string) => `${isolateName(ruler)} has no child in the tree. So the first place in the line goes to ${isolateName(heir)}, the ${relation} of ${isolateName(ruler)}.`,
	firstHeirDeadChild: (via: string, ruler: string) => `${isolateName(via)}, a child of ${isolateName(ruler)}, is dead. So the children of ${isolateName(via)} come first, in the place of ${isolateName(via)}.`,
	firstHeirByRule: (heir: string, rule: string) => `${isolateName(heir)} comes first because of the rule ${quote(rule)}.`,
	// The only living child of the ruler who would stand in front is left out by the box "Illegitimate" or by an adoption (the switch is off).
	firstHeirBarred: {
		illegitimate: (child: string, heir: string) =>
			`${isolateName(child)} has the box “Illegitimate” ticked. For this title, children with this box ticked cannot inherit. So the first place in the line goes to ${isolateName(heir)}.`,
		'illegitimate-after': (child: string, heir: string) =>
			`${isolateName(child)} has the box “Illegitimate” ticked. For this title, these children inherit after all people who do not have this box ticked. So the first place in the line goes to ${isolateName(heir)}.`,
		adopted: (child: string, heir: string) => `${isolateName(child)} is an adopted child. For this title, adopted children cannot inherit. So the first place in the line goes to ${isolateName(heir)}.`,
	},
	coRulersNotInLine: 'The other holders are not in the line of succession, unless they are named heirs.',
	bornInReignNoFrom: (parent: string) =>
		`${isolateName(parent)} has no start year as a holder of this title. So the rule “Born during the reign first” puts the children of ${isolateName(parent)} in the order of “Eldest child first”. Add a start year in the field “From”.`,
	throughSpouseNote: (holder: string, spouse: string) => `${isolateName(holder)} holds the title through the spouse, ${isolateName(spouse)}. The line of succession is for ${isolateName(spouse)}.`,
	// Only the birth date uses this text (`bornDateUnread`, `heirNotes`).
	noYearDate: (name: string) => `The plugin cannot read a year in the birth date of ${isolateName(name)}. To change this, write a year in the birth date.`,
	noYearReign: (name: string) => `The plugin cannot read a year in the reign of ${isolateName(name)}.`,
	// Spec §14 rule 5: a `died` text with text and no year. `year` is the text that gives Y, as written.
	diedNoYear: (name: string, year: string) => `The plugin cannot read a year in the death date of ${isolateName(name)}. So in this line, it counts ${isolateName(name)} as dead in ${year}. To change this, write a year in the death date.`,
	leftOutNoSex: (n: number) => (n === 1 ? '1 person has no “sex: m” or “sex: f”, so this rule does not include this person.' : `${n} people have no “sex: m” or “sex: f”, so this rule does not include them.`),
	noBirthYear: (n: number) => (n === 1 ? '1 heir has no birth year, so this rule cannot put this heir in order.' : `${n} heirs have no birth year, so this rule cannot put them in order.`),
	show: 'Show',
	showLabel: 'Show the line of succession on the tree',
	// The Show view: the bar above the tree, the card label and the row of the phone list.
	// B-0036: the bar names the rule after the year, with the one separator. `rule` is absent only for a line that the engine would refuse.
	bar: (title: string, year: YearInText, rule?: SuccessionRule) => `Line of succession: ${isolateName(title)}, ${year === null ? 'now' : yearIn(year)}${rule ? `${BAR_SEPARATOR}${SUCCESSION_UI.rules[rule]}` : ''}`,
	/** What a screen reader says in place of the middle dot of the bar: the dot is read as a word or not at all. */
	barSpokenSeparator: ', ',
	barNoHeir: (title: string, year: YearInText, rule?: SuccessionRule) => `${SUCCESSION_UI.bar(title, year, rule)}. No heir in the tree.`,
	barClose: 'Close',
	barCloseLabel: 'Close the line of succession',
	inLine: (ordinal: string) => `${ordinal} in line`,
	openBranchWord: 'Open branch',
	openBranchCard: 'open branch',
	unsavedTitle: 'Save your changes?',
	unsaved: 'You did not save your changes. The plugin shows the line only after you save them. Save them now?',
	saveAndShow: 'Save and show',
	// The setting texts are in SETTINGS_UI. The delete texts:
	deleteHeir: (name: string, titles: number) => (titles === 1 ? `The plugin also removes ${isolateName(name)} as the named heir of 1 title.` : `The plugin also removes ${isolateName(name)} as the named heir of ${titles} titles.`),
	deleteExcluded: (name: string, titles: number) =>
		titles === 1 ? `The plugin also removes ${isolateName(name)} from the excluded people of 1 title.` : `The plugin also removes ${isolateName(name)} from the excluded people of ${titles} titles.`,
} as const;
