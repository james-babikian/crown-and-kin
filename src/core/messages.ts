/*
 * Every issue and error the plugin can report about a tree, and the message text for each one
 * (spec §8). A problem gets a stable code, so `validate.ts`, `parse.ts` and the render code can
 * find and test problems by code without depending on the wording. `issueText` and `hardErrorText`
 * turn a code and its parameters into the sentence the user sees. Keep new wording in Simplified
 * Technical English, using the project word list.
 */

import { slugify } from './id-gen';

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
	/** params: person, type, count */
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
	// Portrait crop (spec §13.13). Found by `validate.ts`: it needs no vault.
	/** A `portrait-crop` that is not three numbers, on a person with a `portrait`. params: person (name) */
	| 'bad-portrait-crop'
	// Unknown values: kept in the YAML, drawn with default styling.
	/** params: union (label), partners (names), value */
	| 'unknown-union-type'
	/** params: person, value */
	| 'unknown-placement'
	/** params: person, value, parent (name) */
	| 'unknown-parent-type'
	// Shape problems that are not silently tolerated (spec §8 "Tolerated silently" is not reported).
	/**
	 * A person, house, union, title, holder or parent entry is not a map (a holder can also be a
	 * string). params: section, index; person for a parent entry; title (name) for a holder
	 */
	| 'entry-not-map'
	/** A person, house, title or parent entry has no id. params: section, index; name when written; person for a parent entry */
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
 * People are named by their name; ids appear only for things that do not exist.
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

const q = (x: string) => `"${x}"`;
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
	const partners = strings(p, 'partners').map((x) => (absent.includes(x) ? q(x) : x));
	if (partners.length) return `the partnership of ${andList(partners)}`;
	return byLabel(p);
}

function byLabel(p: P): string {
	const label = s(p, 'union', '');
	if (/^#\d+$/.test(label)) return `partnership ${label.slice(1)} in the "unions" list`;
	return label ? `the partnership ${q(label)}` : 'a partnership';
}

function house(p: P): string {
	const name = s(p, 'house', '');
	const id = s(p, 'id', '');
	if (name && name !== id) return name;
	return id ? `the house ${q(id)}` : 'a house';
}

const ENTRY: Record<string, { what: string; start: string }> = {
	people: { what: 'a person', start: 'Start each person with "- id:".' },
	houses: { what: 'a house', start: 'Start each house with "- id:".' },
	unions: { what: 'a partnership', start: 'Start each partnership with "- partners:".' },
	titles: { what: 'a title', start: 'Start each title with "- id:".' },
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
		return `Entry ${index} in the parents of ${person(p)} is not a person id. Write an id, or a parent such as {id: aldric, type: adoptive}.`;
	}
	if (section === 'holders') return `Entry ${index} in ${holdersOf(p)} is not a holder. ${HOLDER_FORM}`;
	const e = ENTRY[section] ?? ENTRY.people;
	return `Entry ${index} in the "${section}" list is not ${e.what}, so the tree does not show it. ${e.start}`;
}

function missingId(p: P): string {
	const section = s(p, 'section', 'people');
	const index = s(p, 'index', '?');
	const name = s(p, 'name', '');
	if (section === 'parents') return `Entry ${index} in the parents of ${person(p)} has no id. Add the id of the parent.`;
	if (section === 'houses') {
		const who = name || `Entry ${index} in the "houses" list`;
		return `${who} has no id, so the tree does not use this house. Add an id, for example: id: ${name ? slugify(name) : 'valmont'}.`;
	}
	if (section === 'titles') {
		const who = name || `Entry ${index} in the "titles" list`;
		return `${who} has no id, so the tree does not use this title. Add an id, for example: id: ${name ? slugify(name) : 'duke-of-valmont'}.`;
	}
	const who = name || `Entry ${index} in the "people" list`;
	return `${who} has no id. Add an id, for example: id: ${name ? slugify(name) : 'aldric'}.`;
}

function sectionWrongShape(p: P): string {
	const section = s(p, 'section', 'people');
	if (section === 'options') return 'The "options" section is not a set of options, so the tree ignores it. Write each option like this: start: aldric.';
	if (section === 'holders') {
		const name = s(p, 'title', '');
		return `The holders of ${name ? `the title ${name}` : 'a title'} are not a list, so the tree ignores them. ${HOLDER_FORM}`;
	}
	const e = ENTRY[section] ?? ENTRY.people;
	return `The "${section}" section is not a list, so the tree ignores it. ${e.start}`;
}

/**
 * Whose picture a picture warning is about, as the start of its first sentence, and the verb forms
 * that agree with it: "The arms of House Valmont use", "The portrait of Aldric Valmont uses".
 */
function pictureOwner(p: P): { who: string; uses: string; is: string; other: string } {
	if (s(p, 'owner', '') === 'portrait' || (s(p, 'owner', '') === '' && s(p, 'person', '') !== '')) {
		return { who: `The portrait of ${s(p, 'person', 'a person')}`, uses: 'uses', is: 'is', other: 'select another portrait' };
	}
	return { who: `The arms of ${s(p, 'house', 'a house')}`, uses: 'use', is: 'are', other: 'select other arms' };
}

const PICTURE_FORMATS = 'Select a PNG, JPEG, WebP, GIF, BMP or SVG picture.';

function pictureNotImage(p: P): string {
	const o = pictureOwner(p);
	const file = q(s(p, 'file', '?'));
	const format = s(p, 'format', '');
	if (format) return `${o.who} ${o.uses} the picture ${file}. The plugin cannot show ${format} pictures. Save the picture as PNG or JPEG. Then select it again.`;
	return `${o.who} ${o.uses} the file ${file}, which is not a picture. ${PICTURE_FORMATS}`;
}

function pictureTooLarge(p: P): string {
	const o = pictureOwner(p);
	const pixels = typeof p.pixels === 'number' && Number.isFinite(p.pixels) && p.pixels > 0 ? ` (${p.pixels} million pixels)` : '';
	return `${o.who} ${o.uses} the picture ${q(s(p, 'file', '?'))}, which is too large${pixels}. Use a picture with 40 million pixels or less.`;
}

const ISSUE_TEXT: { [C in IssueCode]: (p: P) => string } = {
	'duplicate-person-id': (p) => `More than one person has the id ${q(s(p, 'id', '?'))}. To edit the tree again, give each person a different id.`,
	'duplicate-union-id': (p) => `More than one partnership has the id ${q(s(p, 'id', '?'))}. To edit the tree again, give each partnership a different id.`,

	'missing-parent': (p) => `${person(p)} has a parent with the id ${q(s(p, 'ref', '?'))}, but no person has this id. Correct the id, or add the person.`,
	'missing-partner': (p) =>
		`The tree does not show ${partnership(p)}, because no person has the id ${q(s(p, 'ref', '?'))}. Correct the id, or add the person.`,
	'missing-house': (p) => `${person(p)} has the house ${q(s(p, 'ref', '?'))}, but no house has this id. Correct the id, or add the house.`,
	'missing-union': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} has "union: ${ref}", but no partnership has this id. Correct the id, or remove "union: ${ref}".`;
	},
	'union-not-of-parents': (p) => {
		const ref = s(p, 'ref', '?');
		return `${person(p)} has "union: ${ref}", but this partnership is not between the parents of ${person(p)}. Correct the id, or remove "union: ${ref}".`;
	},
	'missing-start': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the id ${q(ref)}, so the tree cannot start at this person. Correct the id, or remove "start: ${ref}".`;
	},
	'missing-focus': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the id ${q(ref)}, so the tree cannot show the family of this person. Correct the id, or remove "focus: ${ref}".`;
	},
	'missing-me': (p) => {
		const ref = s(p, 'ref', '?');
		return `No person has the id ${q(ref)}, so the tree cannot show how people relate to you. Correct the id, or remove "me: ${ref}".`;
	},
	'me-not-id': () => '"me" in the options does not name one person. Write one person id after "me:".',

	'too-many-parents': (p) =>
		`${person(p)} has ${n(p, 'count')} ${s(p, 'type', 'birth')} parents, but a person can have only 2 of each type. Remove the extra parents, or change their type.`,
	'union-partner-count': (p) => {
		const partners = strings(p, 'partners');
		const what = partners.length
			? `a partnership with ${plural(partners.length, 'person', 'people')}: ${andList(partners)}`
			: `${byLabel(p)}, because it has ${plural(n(p, 'count'), 'person', 'people')}`;
		return `The tree does not show ${what}. Give each partnership exactly 2 people.`;
	},
	'union-same-partner': (p) =>
		`The tree does not show ${byLabel(p)}, because it has ${s(p, 'person', 'the same person')} two times. Change one partner to a different person.`,
	'cycle': (p) => {
		const people = strings(p, 'people');
		const who = people.length ? andList(people) : 'Some people';
		return `${who} are ancestors of each other. If you do not correct their parents, the tree does not show the line from ${s(p, 'parent', 'one parent')} to ${s(p, 'dropped', 'one child')}.`;
	},
	'self-parent': (p) => `The parents of ${person(p)} include ${person(p)}. Remove ${person(p)} from these parents.`,
	'placement-without-parents': (p) => {
		const t = s(p, 'placement', '?');
		return `${person(p)} has "placement: ${t}", but has no ${t} parents. Add ${t} parents, or remove "placement: ${t}".`;
	},
	'house-color-null': (p) => {
		const value = s(p, 'value', '');
		if (value) return `${cap(house(p))} has no colour. Put quotes around the colour: color: "${value}".`;
		return `${cap(house(p))} has no colour. If you wrote a colour, put quotes around it, for example: color: "#8b1e3f".`;
	},
	'duplicate-house-id': (p) => `More than one house has the id ${q(s(p, 'id', '?'))}, and the tree uses only the first. Give each house a different id.`,
	'duplicate-title-id': (p) => `More than one title has the id ${q(s(p, 'id', '?'))}, and the tree uses only the first. Give each title a different id.`,
	'missing-holder': (p) =>
		`${cap(titleOf(p))} has a holder with the id ${q(s(p, 'ref', '?'))}, but no person has this id. Correct the id, or write the name of the holder.`,
	'holder-empty': (p) => `Entry ${s(p, 'index', '?')} in ${holdersOf(p)} has no person and no name. Add "person:" or "name:".`,
	'card-title-not-held': (p) =>
		`${person(p)} has "card-title: ${s(p, 'ref', '?')}", but ${person(p)} does not hold a title with this id. The card shows the first title instead. Correct the id, or remove it.`,

	'unknown-union-type': (p) =>
		`${cap(partnership(p))} has the unknown type ${q(s(p, 'value', '?'))}. Use marriage, betrothal, concubinage or affair.`,
	'unknown-placement': (p) => `${person(p)} has the unknown placement ${q(s(p, 'value', '?'))}. Use birth, adoptive or ward.`,
	'unknown-parent-type': (p) =>
		`${person(p)} has the parent ${s(p, 'parent', 'a parent')} with the unknown type ${q(s(p, 'value', '?'))}. Use birth, adoptive, ward or rumoured.`,

	'missing-picture': (p) => {
		const o = pictureOwner(p);
		return `${o.who} ${o.uses} the picture ${q(s(p, 'file', '?'))}, but the vault has no file with this name. Correct the link, or ${o.other}.`;
	},
	'picture-web': (p) => {
		const o = pictureOwner(p);
		return `${o.who} ${o.is} a web address. The plugin shows only pictures from the vault.`;
	},
	'picture-not-image': pictureNotImage,
	'picture-too-large': pictureTooLarge,
	'bad-portrait-crop': (p) =>
		`The plugin cannot read the selected part of the portrait of ${s(p, 'person', 'a person')}, so the card shows the automatic part. Select the part again, or remove ${q('portrait-crop')}.`,

	'entry-not-map': entryNotMap,
	'missing-id': missingId,
	'section-wrong-shape': sectionWrongShape,
};

/** The sentence to show the user for one issue. */
export const issueText = (issue: CodedIssue): string => {
	const make = ISSUE_TEXT[issue.code] as ((p: P) => string) | undefined;
	return make ? make(issue.params ?? {}) : 'The tree has a problem.';
};

const HARD_ERROR_TEXT: { [C in HardErrorCode]: (e: HardError) => string } = {
	'yaml-invalid': (e) => {
		const where =
			e.line !== undefined ? `The block has an error on text line ${e.line}. Correct this text line to show the tree.` : 'The block has an error. Correct the text to show the tree.';
		return e.detail ? `${where} Details: ${e.detail}` : where;
	},
	'not-a-map': () => 'The block does not have sections such as "people:". To show the tree, put each person in a list below "people:".',
};

/** The sentence to show the user for a hard error (the tree cannot be drawn at all). */
export const hardErrorText = (error: HardError): string => {
	const make = HARD_ERROR_TEXT[error.code] as ((e: HardError) => string) | undefined;
	return make ? make(error) : 'The block has an error. Correct the text to show the tree.';
};
