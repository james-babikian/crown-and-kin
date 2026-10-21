/*
 * Every issue and error the plugin can report about a tree, and the message text for each one
 * (spec §8). A problem gets a stable code, so `validate.ts`, `parse.ts` and the render code can
 * find and test problems by code without depending on the wording. `issueText` and `hardErrorText`
 * turn a code and its parameters into the sentence the user sees. Keep new wording in Simplified
 * Technical English, using the project word list. Quote marks are curly (D99); only the
 * YAML example that the user types keeps straight quotes.
 */

import { slugify } from './id-gen';
import { quote } from './quote';
import { REFUSAL_TEXT } from './refusal-text';
import { INHERIT_ILLEGITIMATE, INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES } from './succession-keys';
import { PARENT_LIMIT } from './parent-types';

/** Tree not rendered (spec §8). */
export type HardErrorCode =
	/** params: detail (parser message). `line` is set when known. */
	| 'yaml-invalid'
	/** The block body is YAML but not a map. */
	| 'not-a-map';

/** A hard error, with the parameters `hardErrorText` needs to word it. */
export interface HardError {
	code: HardErrorCode;
	/** 1-based line in the block body. */
	line?: number;
	detail?: string;
}

/** Tree rendered, editing disabled, banner shown (spec §8). */
export type BlockingCode =
	/** params: id, name (of the first person with the id) */
	| 'duplicate-person-id'
	/** params: id */
	| 'duplicate-union-id';

/** Tree rendered, warning badge (spec §8, §4.1). */
export type WarningCode =
	// Missing references.
	/** params: person, ref */
	| 'missing-parent'
	/** params: union (label), partners (names), ref, absent (the ids that name nobody) */
	| 'missing-partner'
	/** params: person, ref */
	| 'missing-house'
	/** A person's `union` names no union. params: person, ref */
	| 'missing-union'
	/** A person's `union` exists but is not a union of their placement parents. params: person, ref */
	| 'union-not-of-parents'
	/** params: ref */
	| 'missing-start'
	/** params: ref */
	| 'missing-focus'
	/** `options.me` names nobody (spec §13.1). params: ref */
	| 'missing-me'
	/** `options.me` is a list or a map, not one person id (spec §13.1). No params. */
	| 'me-not-id'
	// Structure.
	/** More parents of one type than `PARENT_LIMIT` allows. params: person, type, count; limit (2, or 8 for rumoured) */
	| 'too-many-parents'
	/** params: union (label), partners (names), count */
	| 'union-partner-count'
	/** params: union (label), partners (names), person */
	| 'union-same-partner'
	/** The people involved, in order. params: people (names, in order), parent and dropped (the names on the dropped link) */
	| 'cycle'
	/** params: person */
	| 'self-parent'
	/** `placement` names a type the person has no parents of. params: person, placement */
	| 'placement-without-parents'
	/** params: house (name), id; value when an unquoted colour was read as a comment */
	| 'house-color-null'
	/** params: id, house (name of the first house with the id) */
	| 'duplicate-house-id'
	// Titles (spec §13.3, §13.4).
	/** params: id, title (name of the first title with the id) */
	| 'duplicate-title-id'
	/** A holder's `person` names nobody. params: title (name), ref; name when the entry has one */
	| 'missing-holder'
	/** A holder with no `person` and no `name`. params: title (name), index (1-based) */
	| 'holder-empty'
	/** A `card-title` that names no title the person holds. params: person (name), ref */
	| 'card-title-not-held'
	// Pictures (spec §13.6, §13.7). Found by the Obsidian side (they need the vault), never by `validate.ts`; built by `pictureIssue`.
	/** A picture link that opens no file. params: owner ('arms' | 'portrait'), house or person (name), file (the path as written) */
	| 'missing-picture'
	/** A picture link that is a web address. params: owner, house or person */
	| 'picture-web'
	/** A file the plugin cannot show. params: owner, house or person, file; format when it is a known picture format (HEIC, AVIF, …) */
	| 'picture-not-image'
	/** A picture of more than 40 million pixels. params: owner, house or person, file; pixels (millions, rounded up) when known */
	| 'picture-too-large'
	// Succession keys on a title (contract 0.2.7 A.5, K.4). Found by `validate.ts`.
	/** `succession` names no rule. params: title (name), value (as written, or the flow text of a list or map) */
	| 'unknown-succession'
	/** `inherit` names no rule. params: title (name), value */
	| 'unknown-inherit'
	/** `inherit-through` is not men, women or anyone. params: title (name), value */
	| 'unknown-inherit-through'
	/** `inherit-illegitimate` is not no, after or equal. params: title (name), value */
	| 'unknown-inherit-illegitimate'
	/** `year` has no year in it, and the title has a rule or a named heir. params: title (name), value */
	| 'year-unreadable'
	/** `heir` names nobody. params: title (name), ref */
	| 'missing-heir'
	/** `exclude` names nobody. params: title (name), ref */
	| 'missing-excluded'
	/** A `sex` that is a spelling of m or f, but not m or f. params: person (name), value */
	| 'sex-spelling'
	/** A `died` that is a doubt, not a date; the plugin counts the person as dead. params: person (name), value */
	| 'died-doubtful'
	/** A dead person with `childless: true` who is the birth parent of another person (M.6). params: person (name), child (name) */
	| 'childless-has-child'
	// Dates and calendars (spec §14). Found by `validate.ts` and `derive.ts`, only for a title with a rule or a named heir (rule 5), and never before the calendars are ready (rule 7).
	// params of the four date warnings: where ('year' | 'born' | 'died' | 'reign'), value (the date text), title (name) for 'year' and 'reign', person (name) for 'born' and 'died'; `fits-two-calendars` adds calendars (names).
	/** A plain year 0 (the plugin reads it as 1 BC). */
	| 'year-zero'
	/** Year 0 of a cycle or an era. */
	| 'calendar-year-zero'
	/** A year above the length of its cycle or era. */
	| 'calendar-year-past-end'
	/** A date that fits two calendars with different years. */
	| 'fits-two-calendars'
	/** A calendar with no example, used beside plain years or another calendar. params: calendar (name) */
	| 'calendar-no-anchor'
	/** The `calendar` option names a note that does not exist or holds no calendar. params: note (the link as written) */
	| 'calendar-note-missing'
	/** The same cycle format or era name in two calendar notes. params: calendar (name), note (path), other (path) */
	| 'calendar-duplicate'
	// The `kin-calendar` block (spec §14 rule 2). Found by `parseCalendarBlock`.
	/** The block is not YAML, or is not a map with a list `calendars`. params: note (path) */
	| 'calendar-block-invalid'
	/** One calendar of the list cannot be used. params: note (path), index (1-based), why ('not-map' | 'no-name' | 'kind' | 'era') */
	| 'calendar-entry-invalid'
	// Holding a title through the spouse (0.2.8 contract A.2, D195). Only for a title with `succession` or `heir`; the key is then ignored.
	/** The holder has no partner. params: person, title (name) */
	| 'through-spouse-no-partner'
	/** The holder has partners, but all are betrothals, concubines or affairs (D205). params: person, title (name) */
	| 'through-spouse-no-marriage'
	/** Several candidates, none an ancestor or a descendant of another holder. params: person, title, count, partners (names), example (an id) */
	| 'through-spouse-no-claim'
	/** Several candidates, more than one an ancestor or a descendant of another holder. params: person, title, count, partners (names), example (an id) */
	| 'through-spouse-several-claims'
	/** The written id is the holder. params: person, title (name) */
	| 'through-spouse-self'
	/** The written id is a person who is not a partner. params: person, title, ref, other (name) */
	| 'through-spouse-not-partner'
	/** The written id names nobody. params: person, title, ref */
	| 'through-spouse-unknown-person'
	// Portrait crop (spec §13.13). Found by `validate.ts`: it needs no vault.
	/** A `portrait-crop` that is not three numbers, on a person with a `portrait`. params: person (name) */
	| 'bad-portrait-crop'
	// Unknown values: kept in the YAML, drawn with default styling.
	/** Only a near-typo of a known type (0.2.8 I13); any other word is drawn as a marriage with no warning. params: union (label), partners (names), value, suggestion */
	| 'unknown-union-type'
	/** params: person, value */
	| 'unknown-placement'
	/** params: person, value, parent (name); suggestion when the value is a near-typo of a known type */
	| 'unknown-parent-type'
	// Shape problems that are not silently tolerated (spec §8 "Tolerated silently" is not reported).
	/**
	 * A person, house, union, title, holder or parent entry is not a map (a holder can also be a
	 * string). params: section, index; person for a parent entry; title (name) for a holder
	 */
	| 'entry-not-map'
	/** A person, house, title or parent entry has no id. params: section, index; name when written; person for a parent entry; example (an unused person id) for a person */
	| 'missing-id'
	/** A section that must be a list or map has another shape. params: section; title (name) for `holders` */
	| 'section-wrong-shape';

/** Every issue code the plugin can report: a `BlockingCode` or a `WarningCode`. */
export type IssueCode = BlockingCode | WarningCode;

/** The named values an issue's message is built from (person names, ids, counts, and so on). */
export type IssueParams = Record<string, string | number | string[]>;

/** One issue found in a tree: its code, severity, message parameters, and the ids it is about. */
export interface CodedIssue {
	code: IssueCode;
	level: 'blocking' | 'warning';
	params: IssueParams;
	/** People (or houses/unions, by id) the issue is about; used to highlight cards. */
	ids?: string[];
}

/** One issue; `ids` is left out when there are none. */
export function codedIssue(code: IssueCode, level: CodedIssue['level'], params: IssueParams, ids?: string[]): CodedIssue {
	return ids?.length ? { code, level, params, ids } : { code, level, params };
}

/*
 * Every sentence the plugin shows about a problem in a tree. Simplified Technical English
 * (ASD-STE100): short sentences, active voice, one instruction each, and the word list
 * ("partnership", not "union"; "person", not "node"). Say what is wrong, then what to do.
 * People are named by their name; an id appears for things that do not exist, and after the name
 * of a person in a duplicate id warning.
 */

type P = IssueParams;

/** A string param, or the fallback when it is absent or empty, so no text shows "undefined". */
function s(p: P, key: string, fallback: string): string {
	const v = p[key];
	if (typeof v === 'string' && v.trim() !== '') return v;
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return fallback;
}

function n(p: P, key: string): number {
	const v = p[key];
	const num = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(num) ? num : 0;
}

function strings(p: P, key: string): string[] {
	const v = p[key];
	return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "A", "A and B", "A, B and C". */
function andList(xs: string[]): string {
	if (xs.length <= 1) return xs[0] ?? '';
	return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const person = (p: P) => s(p, 'person', 'A person');

/** How a union is named in text: by its partners, else by its id, else by its place in the list. */
function partnership(p: P): string {
	const absent = strings(p, 'absent');
	const partners = strings(p, 'partners').map((x) => (absent.includes(x) ? quote(x) : x));
	if (partners.length) return `the partnership of ${andList(partners)}`;
	return byLabel(p);
}

function byLabel(p: P): string {
	const label = s(p, 'union', '');
	if (/^#\d+$/.test(label)) return `partnership ${label.slice(1)} in the “unions” list`;
	return label ? `the partnership ${quote(label)}` : 'a partnership';
}

function house(p: P): string {
	const name = s(p, 'house', '');
	const id = s(p, 'id', '');
	if (name && name !== id) return name;
	return id ? `the house ${quote(id)}` : 'a house';
}

const ENTRY: Record<string, { what: string; start: string }> = {
	people: { what: 'a person', start: 'Start each person with “- id:”.' },
	houses: { what: 'a house', start: 'Start each house with “- id:”.' },
	unions: { what: 'a partnership', start: 'Start each partnership with “- partners:”.' },
	titles: { what: 'a title', start: 'Start each title with “- id:”.' },
};

/** The title a holder issue is about: "the title Duke of Valmont", or "a title" when the name is missing. */
const titleOf = (p: P) => {
	const name = s(p, 'title', '');
	return name ? `the title ${name}` : 'a title';
};
const holdersOf = (p: P) => {
	const name = s(p, 'title', '');
	return name ? `the holders of ${name}` : 'the holders of a title';
};
const HOLDER_FORM = 'Write each holder like this: - {person: aldric}.';

function entryNotMap(p: P): string {
	const section = s(p, 'section', 'people');
	const index = s(p, 'index', '?');
	if (section === 'parents') {
		return `Entry ${index} in the parents of ${person(p)} is not a person ID. Write an ID, or a parent such as {id: aldric, type: adoptive}.`;
	}
	if (section === 'holders') return `Entry ${index} in ${holdersOf(p)} is not a holder. ${HOLDER_FORM}`;
	const e = ENTRY[section] ?? ENTRY.people;
	return `Entry ${index} in the “${section}” list is not ${e.what}, so the tree does not show it. ${e.start}`;
}

function missingId(p: P): string {
	const section = s(p, 'section', 'people');
	const index = s(p, 'index', '?');
	const name = s(p, 'name', '');
	if (section === 'parents') return `Entry ${index} in the parents of ${person(p)} has no ID. Add the ID of the parent.`;
	if (section === 'houses') {
		const who = name || `Entry ${index} in the “houses” list`;
		return `${who} has no ID, so the tree does not use this house. Add an ID, for example: id: ${name ? slugify(name) : 'valmont'}.`;
	}
	if (section === 'titles') {
		const who = name || `Entry ${index} in the “titles” list`;
		return `${who} has no ID, so the tree does not use this title. Add an ID, for example: id: ${name ? slugify(name) : 'duke-of-valmont'}.`;
	}
	const who = name || `Entry ${index} in the “people” list`;
	// The reader gives an id that no person has; `p1` only when the text comes without one.
	return `${who} has no ID. Add an ID, for example: id: ${s(p, 'example', 'p1')}.`;
}

/** D105: the name shows with the id as `NAME (id)`; the brackets mark the id, so it has no quote marks. */
function duplicatePersonId(p: P): string {
	const id = s(p, 'id', '?');
	const name = s(p, 'name', '');
	if (name && name !== id) return `${name} (${id}) has the same ID as another person. To edit the tree again, give each person a different ID.`;
	return `More than one person has the ID ${quote(id)}. To edit the tree again, give each person a different ID.`;
}

function sectionWrongShape(p: P): string {
	const section = s(p, 'section', 'people');
	if (section === 'options') return 'The “options” section is not a set of options, so the tree ignores it. Write each option like this: start: aldric.';
	if (section === 'holders') {
		const name = s(p, 'title', '');
		return `The holders of ${name ? `the title ${name}` : 'a title'} are not a list, so the tree ignores them. ${HOLDER_FORM}`;
	}
	const e = ENTRY[section] ?? ENTRY.people;
	return `The “${section}” section is not a list, so the tree ignores it. ${e.start}`;
}

/**
 * Whose picture a picture warning is about, as the start of its first sentence, and the verb forms
 * that agree with it: "The arms of House Valmont use", "The portrait of Aldric Valmont uses".
 */
function pictureOwner(p: P): { who: string; uses: string; is: string; other: string } {
	// 0.2.8 contract A.1: the personal arms of a person.
	if (s(p, 'owner', '') === 'person-arms') return { who: `The personal arms of ${s(p, 'person', 'a person')}`, uses: 'use', is: 'are', other: 'select other arms' };
	if (s(p, 'owner', '') === 'portrait' || (s(p, 'owner', '') === '' && s(p, 'person', '') !== '')) {
		return { who: `The portrait of ${s(p, 'person', 'a person')}`, uses: 'uses', is: 'is', other: 'select another portrait' };
	}
	return { who: `The arms of ${s(p, 'house', 'a house')}`, uses: 'use', is: 'are', other: 'select other arms' };
}

const PICTURE_FORMATS = 'Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.';

function pictureNotImage(p: P): string {
	const o = pictureOwner(p);
	const file = quote(s(p, 'file', '?'));
	const format = s(p, 'format', '');
	if (format) return `${o.who} ${o.uses} the picture ${file}. The plugin cannot show ${format} pictures. Save the picture as PNG or JPEG. Then select it again.`;
	return `${o.who} ${o.uses} the file ${file}, which is not a picture. ${PICTURE_FORMATS}`;
}

function pictureTooLarge(p: P): string {
	const o = pictureOwner(p);
	const pixels = typeof p.pixels === 'number' && Number.isFinite(p.pixels) && p.pixels > 0 ? ` (${p.pixels} million pixels)` : '';
	return `${o.who} ${o.uses} the picture ${quote(s(p, 'file', '?'))}, which is too large${pixels}. Use a picture with 40 million pixels or less.`;
}

/** The start of a date warning: which text it is about (spec §14 rule 5). */
function dateHead(p: P): string {
	const value = s(p, 'value', '?');
	switch (s(p, 'where', 'year')) {
		case 'born':
		case 'died':
			return `${person(p)} has “${s(p, 'where', 'born')}: ${value}”.`;
		case 'reign':
			return `${cap(titleOf(p))} has the reign date ${quote(value)}.`;
		default:
			return `${cap(titleOf(p))} has “year: ${value}”.`;
	}
}

const ISSUE_TEXT: { [C in IssueCode]: (p: P) => string } = {
	'duplicate-person-id': duplicatePersonId,
	'duplicate-union-id': (p) => `More than one partnership has the ID ${quote(s(p, 'id', '?'))}. To edit the tree again, give each partnership a different ID.`,

	'missing-parent': (p) => `${person(p)} has a parent with the ID ${quote(s(p, 'ref', '?'))}, but no person has this ID. Correct the ID, or add the person.`,
	'missing-partner': (p) =>
		`The tree does not show ${partnership(p)}, because no person has the ID ${quote(s(p, 'ref', '?'))}. Correct the ID, or add the person.`,
	'missing-house': (p) => `${person(p)} has the house ${quote(s(p, 'ref', '?'))}, but no house has this ID. Correct the ID, or add the house.`,
	'missing-union': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} has “union: ${ref}”, but no partnership has this ID. Correct the ID, or remove “union: ${ref}”.`;
	},
	'union-not-of-parents': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} has “union: ${ref}”, but this partnership is not between the parents of ${person(p)}. Correct the ID, or remove “union: ${ref}”.`;
	},
	'missing-start': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the ID ${quote(ref)}, so the tree cannot start at this person. Correct the ID, or remove “start: ${ref}”.`;
	},
	'missing-focus': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the ID ${quote(ref)}, so the tree cannot show the family of this person. Correct the ID, or remove “focus: ${ref}”.`;
	},
	'missing-me': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the ID ${quote(ref)}, so the tree cannot show how people relate to you. Correct the ID, or remove “me: ${ref}”.`;
	},
	'me-not-id': () => '“me” in the options does not name one person. Write one person ID after “me:”.',

	'too-many-parents': (p) => {
		const type = s(p, 'type', 'birth');
		const limit = n(p, 'limit') || (type === 'rumoured' ? PARENT_LIMIT.rumoured : PARENT_LIMIT.birth);
		if (type === 'rumoured') {
			return `${person(p)} has ${n(p, 'count')} rumoured parents, but a person can have only ${limit} of this type. If a person has more than ${limit}, a relation name can lack a “maybe”. Remove the extra parents, or change their type.`;
		}
		return `${person(p)} has ${n(p, 'count')} ${type} parents, but a person can have only ${limit} of each type. Remove the extra parents, or change their type.`;
	},
	'union-partner-count': (p) => {
		const partners = strings(p, 'partners');
		const what = partners.length
			? `a partnership with ${plural(partners.length, 'person', 'people')}: ${andList(partners)}`
			: `${byLabel(p)}, because it has ${plural(n(p, 'count'), 'person', 'people')}`;
		// A partnership of 3 or more people gets an example of the right form (I12).
		const example = n(p, 'count') >= 3 ? ' Write one partnership for each pair, for example “- partners: [aldric, isolde]”.' : '';
		return `The tree does not show ${what}. Give each partnership exactly 2 people.${example}`;
	},
	'union-same-partner': (p) =>
		`The tree does not show ${byLabel(p)}, because it has ${s(p, 'person', 'the same person')} two times. Change one partner to a different person.`,
	'cycle': (p) => {
		const people = strings(p, 'people');
		const who = people.length ? andList(people) : 'Some people';
		return `${who} are ancestors of each other, so the tree has a time loop. The tree does not show the line from ${s(p, 'parent', 'one parent')} to ${s(p, 'dropped', 'one child')}. If this is a mistake, correct the parents.`;
	},
	'self-parent': (p) => `The parents of ${person(p)} include ${person(p)}. If this is a mistake, remove ${person(p)} from these parents.`,
	'placement-without-parents': (p) => {
		const t = s(p, 'placement', '?');
		return `${person(p)} has “placement: ${t}”, but has no ${t} parents. Add ${t} parents, or remove “placement: ${t}”.`;
	},
	'house-color-null': (p) => {
		const value = s(p, 'value', '');
		if (value) return `${cap(house(p))} has no colour. Put quotes around the colour: color: "${value}".`;
		return `${cap(house(p))} has no colour. If you wrote a colour, put quotes around it, for example: color: "#8b1e3f".`;
	},
	'duplicate-house-id': (p) => `More than one house has the ID ${quote(s(p, 'id', '?'))}, and the tree uses only the first. Give each house a different ID.`,
	'duplicate-title-id': (p) => `More than one title has the ID ${quote(s(p, 'id', '?'))}, and the tree uses only the first. Give each title a different ID.`,
	'missing-holder': (p) =>
		`${cap(titleOf(p))} has a holder with the ID ${quote(s(p, 'ref', '?'))}, but no person has this ID. Correct the ID, or write the name of the holder.`,
	'holder-empty': (p) => `Entry ${s(p, 'index', '?')} in ${holdersOf(p)} has no person and no name. Add “person:” or “name:”.`,
	'card-title-not-held': (p) =>
		`${person(p)} has “card-title: ${s(p, 'ref', '?')}”, but ${person(p)} does not hold a title with this ID. The card shows the first title instead. Correct the ID, or remove it.`,

	'unknown-union-type': (p) => {
		const suggestion = s(p, 'suggestion', '');
		const hint = suggestion ? ` If you mean ${quote(suggestion)}, write ${quote(`type: ${suggestion}`)}.` : '';
		return `${cap(partnership(p))} has the type ${quote(s(p, 'value', '?'))}. The plugin shows it as a marriage.${hint}`;
	},
	'unknown-placement': (p) => `${person(p)} has the unknown placement ${quote(s(p, 'value', '?'))}. Use birth, adoptive or ward.`,
	'unknown-parent-type': (p) => {
		const suggestion = s(p, 'suggestion', '');
		const hint = suggestion ? ` If you mean ${quote(suggestion)}, write ${quote(`type: ${suggestion}`)}.` : '';
		const parent = s(p, 'parent', 'a parent');
		return `${person(p)} has the parent ${parent} with the type ${quote(s(p, 'value', '?'))}, which the plugin does not know. The plugin counts ${parent} as a birth parent of ${person(p)}. Use birth, adoptive, ward or rumoured.${hint}`;
	},

	'missing-picture': (p) => {
		const o = pictureOwner(p);
		return `${o.who} ${o.uses} the picture ${quote(s(p, 'file', '?'))}, but the vault has no file with this name. Correct the link, or ${o.other}.`;
	},
	'picture-web': (p) => {
		const o = pictureOwner(p);
		return `${o.who} ${o.is} a web address. The plugin shows only pictures from the vault. Save the picture in the vault. Then select it again.`;
	},
	'picture-not-image': pictureNotImage,
	'picture-too-large': pictureTooLarge,
	'bad-portrait-crop': (p) =>
		`The plugin cannot read the selected part of the portrait of ${s(p, 'person', 'a person')}, so the card shows the automatic part. Select the part again, or remove ${quote('portrait-crop')}.`,

	'unknown-succession': (p) => {
		const value = s(p, 'value', '?');
		const lower = value.trim().toLowerCase();
		const hint =
			lower === 'salic'
				? ' For the Salic law, use “succession: eldest-child” with “inherit: men-only”.'
				: lower === 'semi-salic'
					? ' For the semi-Salic law, use “succession: eldest-child” with “inherit: men-first-in-house”.'
					: '';
		return `${cap(titleOf(p))} has “succession: ${value}”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: ${SUCCESSION_RULES.join(', ')}.${hint}`;
	},
	'unknown-inherit': (p) =>
		`${cap(titleOf(p))} has “inherit: ${s(p, 'value', '?')}”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: ${INHERIT_RULES.join(', ')}.`,
	'unknown-inherit-through': (p) =>
		`${cap(titleOf(p))} has “inherit-through: ${s(p, 'value', '?')}”. The plugin does not know this rule, so it shows no line of succession. Use one of these rules: ${INHERIT_THROUGH.join(', ')}.`,
	'unknown-inherit-illegitimate': (p) =>
		`${cap(titleOf(p))} has “inherit-illegitimate: ${s(p, 'value', '?')}”. The plugin does not know this value, so it shows no line of succession. Use one of these values: ${INHERIT_ILLEGITIMATE.join(', ')}.`,
	'year-unreadable': (p) =>
		`${cap(titleOf(p))} has “year: ${s(p, 'value', '?')}”. The plugin cannot find a year in it. The line of succession uses the end of the last reign. If the last reign has no end, the line is for now. Write the year as a number, for example “year: 1210”.`,
	'missing-heir': (p) => `${cap(titleOf(p))} has “heir: ${s(p, 'ref', '?')}”, but no person has this ID. Correct the ID, or remove it.`,
	'missing-excluded': (p) => `${cap(titleOf(p))} has “exclude: ${s(p, 'ref', '?')}”, but no person has this ID. Correct the ID, or remove it.`,
	'sex-spelling': (p) => {
		const value = s(p, 'value', '?');
		return `${person(p)} has “sex: ${value}”. The plugin reads only “m” and “f” as a man and a woman. If you mean a man or a woman, write “sex: m” or “sex: f”.`;
	},
	'died-doubtful': (p) => {
		const value = s(p, 'value', '?');
		return `${person(p)} has “died: ${value}”. The plugin counts ${person(p)} as dead. If ${person(p)} is alive, remove “died: ${value}” from the note.`;
	},

	'childless-has-child': (p) => {
		const name = person(p);
		return `${name} has “childless: true”, but ${s(p, 'child', 'a person')} is a child of ${name} in the tree. Remove “childless: true”, or correct the parents of ${s(p, 'child', 'a person')}.`;
	},

	'year-zero': (p) => `${dateHead(p)} There is no year 0. The plugin reads 0 as 1 BC. If you mean AD 1, write “1”. For a year before that, write a number with a minus sign, such as ${quote('-5')}, for 5 BC.`,
	'calendar-year-zero': (p) => `${dateHead(p)} A cycle or an era has no Year 0. The plugin counts this date as the year before Year 1. If you mean Year 1, correct the date.`,
	'calendar-year-past-end': (p) =>
		`${dateHead(p)} The year in this date is after the last year of its cycle or era. The plugin continues the count past the end. If this is a mistake, correct the date. If the cycle or era is longer, change its length in the Calendars window.`,
	'fits-two-calendars': (p) => {
		const calendars = strings(p, 'calendars');
		const which = calendars.length > 1 ? `the calendars ${andList(calendars.map(quote))}` : 'two calendars';
		return `${dateHead(p)} The date fits ${which} and gives a different year in each. As a result, the plugin uses no year for this date. Change the date, or change a calendar so that only one calendar fits it.`;
	},
	'calendar-no-anchor': (p) =>
		`The calendar ${quote(s(p, 'calendar', '?'))} has no “Same year as” date that links it to plain years. So the plugin counts its Year 1 as plain year 1. The tree also has plain years or dates of another calendar. As a result, the order of dates and the ages can be wrong. In the Calendars window, add a “Same year as” date to the calendar.`,
	'calendar-note-missing': (p) =>
		`The tree uses the calendar note ${quote(s(p, 'note', '?'))}, but this note does not exist or has no calendar. As a result, the plugin reads no dates in your own calendars. Correct the link, or choose another calendar note with “Calendar note” in the More list.`,
	'calendar-duplicate': (p) =>
		`The notes ${quote(s(p, 'note', '?'))} and ${quote(s(p, 'other', '?'))} both have the calendar ${quote(s(p, 'calendar', '?'))} with the same cycle format or era name. A date that fits both can have no year. Change a format or an era name in one note.`,
	'calendar-block-invalid': (p) =>
		`The calendar block in the note ${quote(s(p, 'note', '?'))} has an error, so the plugin ignores it. The tree uses no calendar from this block. Edit the text of the block in the note. The block must have a list under “calendars:”.`,
	'calendar-entry-invalid': (p) => {
		const why = { 'not-map': 'it is not a group of keys, such as “name:”', 'no-name': 'it has no name', kind: 'its “kind:” is not “cycles” or “eras”', era: 'one of its eras has no name' }[s(p, 'why', 'kind')] ?? 'it has an error';
		return `Calendar ${s(p, 'index', '?')} in the block of the note ${quote(s(p, 'note', '?'))} cannot be used, because ${why}. The plugin ignores it. Edit the text of the block in the note.`;
	},

	'through-spouse-no-partner': (p) =>
		`${person(p)} holds ${titleOf(p)} with “through-spouse”, but ${person(p)} has no partner in the tree. The plugin ignores “through-spouse”. Add a partnership for ${person(p)}, or remove “through-spouse”.`,
	'through-spouse-no-marriage': (p) =>
		`${person(p)} holds ${titleOf(p)} with “through-spouse”, but the tree shows no marriage for ${person(p)}. The plugin ignores “through-spouse”. Add a marriage, write the ID of a partner, or remove “through-spouse”.`,
	'through-spouse-no-claim': (p) => {
		const count = n(p, 'count');
		const none = count === 2 ? 'Neither is' : 'None of them is';
		return `${person(p)} has ${count} partners: ${andList(strings(p, 'partners'))}. ${none} an ancestor or a descendant of a holder of ${titleOf(p)}. As a result, the plugin cannot choose a partner and ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: ${s(p, 'example', 'anna')}”.`;
	},
	'through-spouse-several-claims': (p) =>
		`${person(p)} has ${n(p, 'count')} partners who are ancestors or descendants of a holder of ${titleOf(p)}: ${andList(strings(p, 'partners'))}. The plugin cannot choose a partner, so it ignores “through-spouse”. Write the ID of one partner, for example “through-spouse: ${s(p, 'example', 'anna')}”.`,
	'through-spouse-self': (p) => `${person(p)} holds ${titleOf(p)} with “through-spouse”, but the ID after it is the ID of ${person(p)}. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse”.`,
	'through-spouse-not-partner': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} holds ${titleOf(p)} with “through-spouse: ${ref}”, but ${s(p, 'other', ref)} is not a partner of ${person(p)}. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse: ${ref}”.`;
	},
	'through-spouse-unknown-person': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} holds ${titleOf(p)} with “through-spouse: ${ref}”, but no person has the ID ${quote(ref)}. The plugin ignores “through-spouse”. Write the ID of a partner, or remove “through-spouse: ${ref}”.`;
	},

	'entry-not-map': entryNotMap,
	'missing-id': missingId,
	'section-wrong-shape': sectionWrongShape,
};

/**
 * The refusals of the Calendars window (spec §14 rule 3): `checkFormat` and `checkCalendars` give a key, and this table gives
 * the sentence. `other` is the name of the other calendar that the refusal names. Like the issue texts, they are plugin texts.
 */
export const CALENDAR_REFUSAL_TEXT = {
	'calendar-format-cycle': () => 'A cycle format needs {year} and {cycle}, one time each. It cannot have any other word in curly brackets. An example is “{year} Year of the {cycle} Cycle”.',
	'calendar-format-era': () => 'An era format needs {year} and {era}, one time each. It cannot have any other word in curly brackets. An example is “{era} {year}”.',
	'calendar-format-touching': () => 'In this format, {cycle} and {year} are next to each other, so the plugin cannot tell where one ends. Put a word or a space between them.',
	'calendar-format-duplicate': (calendar: string, other?: string) =>
		other ? `The calendar ${quote(calendar)} and the calendar ${quote(other)} have the same format. A date in this format would fit both. Change one format.` : `The calendar ${quote(calendar)} has the same format two times. Change one format.`,
	'calendar-era-duplicate': (calendar: string, other?: string) =>
		other ? `The calendar ${quote(calendar)} and the calendar ${quote(other)} have the same era name. A date with this name would fit both. Change one era name.` : `The calendar ${quote(calendar)} has the same era name two times. Change one era name.`,
	// The two sentences that a refused edit also gives are written once, in `refusal-text.ts`.
	'calendar-length': () => REFUSAL_TEXT.calendarLength,
	'calendar-number': () => REFUSAL_TEXT.calendarNumber,
} as const;

/** The sentence for a refusal of `checkFormat` or `checkCalendars`; any other key gives a plain fallback (spec §8: never throw). */
export function calendarRefusalText(refusal: { calendar: string; key: string; other?: string }): string {
	const make = refusal ? (CALENDAR_REFUSAL_TEXT as Record<string, ((calendar: string, other?: string) => string) | undefined>)[refusal.key] : undefined;
	return make ? make(refusal.calendar, refusal.other) : 'The calendar has an error. Correct the calendar.';
}

/** Every issue code that has a message, for tests that read the whole table. */
export const ISSUE_CODES = Object.keys(ISSUE_TEXT) as IssueCode[];

/** The sentence to show the user for one issue. */
export const issueText = (issue: CodedIssue): string => {
	const make = ISSUE_TEXT[issue.code] as ((p: P) => string) | undefined;
	return make ? make(issue.params ?? {}) : 'The tree has a problem.';
};

const BLOCK_ERROR = 'The tree text has an error. Correct the text to show the tree.';

/**
 * The "Details" of a hard error that the plugin finds itself (WP-H2), in plain words. They are the `detail` of a
 * `yaml-invalid` error, so the box shows them after "Details:".
 */
export const LIMIT_DETAIL = {
	/** The aliases (`*name`) expand to far more nodes than the text could hold (F1). */
	tooLarge: `The mark ${quote('*')} repeats text that you named with the mark ${quote('&')}. The tree text uses these marks so often that the plugin cannot read it. Replace some of the marks ${quote('*')} with the text that they repeat.`,
	/** The text nests so deep that the parser runs out of room (F3). */
	tooDeep: 'The tree text goes too many levels deep. A level is a list or a section inside another list or section. Remove the extra levels.',
	/** The same key twice in one section; the plugin checks this itself (F2). */
	duplicateKey: (key?: string): string => {
		// The key is the user's own text; a long or odd one would not read well in a sentence.
		const end = 'Delete one of the text lines, or change the name of the field.';
		if (key !== undefined && /^[A-Za-z][\w-]{0,30}$/.test(key)) return `One person or section has the field ${quote(`${key}:`)} two times. ${end}`;
		return `One person or section has the same field two times, for example two ${quote('name:')} text lines. ${end}`;
	},
} as const;

/**
 * F8: the parser's own English, in plain words. Each entry tests the first sentence of the parser's message and gives the Details of the box. The
 * parser's words (flow sequence, mapping, scalar, alias) mean nothing to the owner of a note. A message that no entry knows is not shown.
 */
const PLAIN_DETAIL: [RegExp, (m: RegExpMatchArray) => string][] = [
	[/^Sequence item without - indicator/, () => `This text line does not fit the list above it. Check the spaces at the start of the text line. Each item of a list starts with ${quote('-')}.`],
	[/^Nested mappings are not allowed/, () => `The value of a field has a colon ${quote(':')} in it. Put the value in quote marks.`],
	[/^Flow sequence .*end with a \]/, () => `A list in square brackets is not closed, or its next text line starts too far to the left. Add the bracket ${quote(']')} at the end of the list.`],
	[/^Flow map .*end with a \}/, () => `A section in curly brackets is not closed. Add the bracket ${quote('}')} at the end of the section.`],
	[/^Tabs are not allowed as indentation/, () => 'This text line starts with a tab. Use spaces in place of the tab.'],
	[/^Missing closing .?quote/, () => 'A quote mark is not closed. Add the quote mark at the end of the text.'],
	[/^Plain value cannot start with reserved character (.+)$/, (m) => `A value starts with the character ${quote(m[1])}. This character has a special use. Put the value in quote marks.`],
	[/^All mapping items must start at the same column/, () => 'The text lines of one person or section do not start at the same place. Use the same number of spaces at the start of each of them.'],
	[/^All sequence items must start at the same column/, () => 'The items of one list do not start at the same place. Use the same number of spaces at the start of each of them.'],
	[/^Source contains multiple documents/, () => `The tree text has a text line with only three dashes ${quote('---')}. Delete that text line.`],
	[/^Unresolved alias .*: (.+)$/, (m) => `The mark ${quote(`*${m[1]}`)} repeats text. No text above it has the mark ${quote(`&${m[1]}`)}. Put ${quote(`&${m[1]}`)} at the start of the text to repeat, above ${quote(`*${m[1]}`)}. Or delete ${quote(`*${m[1]}`)}. Check that both marks have the same name.`],
	[/^Block collections are not allowed within flow collections/, () => 'A text line that starts a list or a section stands inside brackets. Check that every bracket is closed. Write the content of the brackets on one text line, or remove the brackets.'],
	[/^Implicit keys .*single line/, () => 'The name of a field goes over more than one text line. Write the whole name on one text line.'],
	[/^Implicit map keys need to be followed/, () => `A text line has a name but no colon after it. Add a colon ${quote(':')} after the name.`],
	[/^Missing , (between|or :)/, (m) => (m[1] === 'or :' ? `Two items in curly brackets have no comma or colon between them. Add a comma ${quote(',')} between two items. Or add a colon ${quote(':')} between a name and its value.` : `Two items in brackets have no comma between them. Add a comma ${quote(',')} between the items.`)],
	[/^Invalid escape sequence/, () => `A text in double quote marks has a backslash ${quote('\\')} that the plugin cannot read. Delete the backslash, or write it two times.`],
];

/** What the box says when the parser's message has no entry above. It does not repeat the parser's words. */
const UNKNOWN_DETAIL = 'The plugin cannot say more. Check the text lines of the tree text for a quote mark or a bracket that is not closed. Start with the text line that the box names and go up.';

/** True for a detail that the plugin wrote itself in plain words (`LIMIT_DETAIL`). */
const isPlainDetail = (detail: string): boolean => detail === LIMIT_DETAIL.tooLarge || detail === LIMIT_DETAIL.tooDeep || detail.startsWith('One person or section has the ');

/** The words that follow "Details:": the plugin's own text as it is, a parser message in plain words, or the one text for a message that has no entry. */
function plainDetail(detail: string): string {
	if (isPlainDetail(detail)) return detail;
	for (const [test, say] of PLAIN_DETAIL) {
		const m = detail.match(test);
		if (m) return say(m);
	}
	return UNKNOWN_DETAIL;
}

/** The number of text lines in a block body: a last text line that ends with a line break has no empty text line after it. */
const textLines = (source: string): number => {
	const n = source.split(/\r\n|\r|\n/).length;
	return /[\r\n]$/.test(source) ? n - 1 : n;
};

const HARD_ERROR_TEXT: { [C in HardErrorCode]: (e: HardError, source?: string) => string } = {
	'yaml-invalid': (e, source) => {
		// F8: the parser can report the end of the text, one text line after the last (an open bracket or quote mark); the box names a text line that the text has.
		const line = e.line !== undefined && source !== undefined ? Math.max(1, Math.min(e.line, textLines(source))) : e.line;
		const where = line !== undefined ? `Text line ${line} of the tree text has an error. Correct this text line to show the tree.` : BLOCK_ERROR;
		return e.detail ? `${where} Details: ${plainDetail(e.detail)}` : where;
	},
	'not-a-map': () => 'The tree text does not have sections such as “people:”. To show the tree, put each person in a list below “people:”.',
};

/**
 * The sentence to show the user for a hard error (the tree cannot be drawn at all). With the block body (`source`) the text line that the box names
 * is a text line that the body has (F8).
 */
export const hardErrorText = (error: HardError, source?: string): string => {
	const make = HARD_ERROR_TEXT[error.code] as ((e: HardError, source?: string) => string) | undefined;
	return make ? make(error, source) : BLOCK_ERROR;
};
