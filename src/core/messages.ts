import { slugify } from './id-gen';
import type { CodedIssue, HardError, HardErrorCode, HardErrorText, IssueCode, IssueParams, IssueText } from './issues';

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
};

function entryNotMap(p: P): string {
	const section = s(p, 'section', 'people');
	const index = s(p, 'index', '?');
	if (section === 'parents') {
		return `Entry ${index} in the parents of ${person(p)} is not a person id. Write an id, or a parent such as {id: aldric, type: adoptive}.`;
	}
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
	const who = name || `Entry ${index} in the "people" list`;
	return `${who} has no id. Add an id, for example: id: ${name ? slugify(name) : 'aldric'}.`;
}

function sectionWrongShape(p: P): string {
	const section = s(p, 'section', 'people');
	if (section === 'options') return 'The "options" section is not a set of options, so the tree ignores it. Write each option like this: start: aldric.';
	const e = ENTRY[section] ?? ENTRY.people;
	return `The "${section}" section is not a list, so the tree ignores it. ${e.start}`;
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

	'unknown-union-type': (p) =>
		`${cap(partnership(p))} has the unknown type ${q(s(p, 'value', '?'))}. Use marriage, betrothal, concubinage or affair.`,
	'unknown-placement': (p) => `${person(p)} has the unknown placement ${q(s(p, 'value', '?'))}. Use birth, adoptive or ward.`,
	'unknown-parent-type': (p) =>
		`${person(p)} has the parent ${s(p, 'parent', 'a parent')} with the unknown type ${q(s(p, 'value', '?'))}. Use birth, adoptive, ward or rumoured.`,

	'entry-not-map': entryNotMap,
	'missing-id': missingId,
	'section-wrong-shape': sectionWrongShape,
};

export const issueText: IssueText = (issue: CodedIssue) => {
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

export const hardErrorText: HardErrorText = (error: HardError) => {
	const make = HARD_ERROR_TEXT[error.code] as ((e: HardError) => string) | undefined;
	return make ? make(error) : 'The block has an error. Correct the text to show the tree.';
};
