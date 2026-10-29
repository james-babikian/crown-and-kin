/*
 * What titles change on cards and in texts (spec §13.3–§13.5, D56, D58, D61–D63, D65, D66): the card labels
 * (shown title, its male or female form, ruler name with number, reign), the reign texts, the names the picker and Find
 * match, the "Show on the card" op, the Delete title counts and the table note. Everything is
 * computed here from the family graph, so the views, the headless SVG, accessible names and
 * measuring all agree. The renderers get the labels from their callers (`SceneOptions.labels`).
 *
 * Rules for titles that the types do not show (rules 6–8 are in `title-ops.ts`):
 * 1. Reading (`parse.ts`): `titles` is read like `houses`; a title with no id gives `missing-id`
 *    and the first title with an id wins (`duplicate-title-id`). `holders: aldric` and a plain
 *    string item are `{person: <it>}`; numbers are read as text. There is no `missing-id` for holders.
 * 2. Validation (`validate.ts`): a `person` naming nobody gives `missing-holder`; the entry stays
 *    only with a `name`. Code treats a `person` not in `g.byId` as not in the tree. A `card-title`
 *    the person does not hold gives `card-title-not-held`, and the card ignores it.
 * 3. Subgraphs keep `titles` unchanged; the views show only the whole tree's issues.
 * 4. Card labels come only from `cardLabels(g)`. Renderers get them from their callers
 *    (`SceneOptions.labels`, `SvgOptions.labels`); absent labels mean the drawing without labels. Relation
 *    names, finder sentences, far-couple tags and the problem list keep the full `Person.name`.
 * 5. Layout: a card in `tallTitles` is one small text line taller; the layout sets `tallName` and
 *    `tallTitle` on a box only when true, so trees without titles lay out as before.
 */

import type { FamilyGraph } from './derive';
import type { Holder, Person, Title } from './types';

/** One title that a person holds: the title and this person's entries of it, in list order. */
export interface Holding {
	title: Title;
	entries: Holder[];
}

/** What a card shows for a person, beyond the basic fields (spec §13.3, §13.5). */
export interface CardLabel {
	/** Every title the person holds, in `titles` list order (the edit sheet lists these). */
	holdings: Holding[];
	/** The shown title (D62): `card-title` if valid, else the first holding; undefined with no holdings. */
	shown?: Holding;
	/** True when `card-title` is valid (then `title` is the shown title's name, D63). */
	selected: boolean;
	/** The name text line (D58, D131): the ruler name and number of the first numbered entry of `shown` ("Roderick II"), else the written ruler name of its first entry with an `as` ("Marta"), else `Person.name`. */
	name: string;
	/** D122: the person's sobriquet (bare text, no marks). The card adds it after `name`; the screen-reader label does not (D127). */
	sobriquet?: string;
	/**
	 * The title text line without the reign: the shown title's name if `selected` (D63); else the
	 * written `Person.title` if any; else the shown title's name (D56); undefined if none. The
	 * shown title's name is `titleNameFor` it (D65, D66); a written title stays as written.
	 */
	title?: string;
	/** `reignText(shown.entries)`, or undefined. */
	reign?: string;
	/** D131: set only when true. `name` came from an entry that has a number (not from a written `as` alone). */
	numbered?: true;
}

/** One entry's reign without "r." and parentheses: "1131–1160", "from 1131", "until 1160", or undefined. */
export function entryReign(entry: Holder): string | undefined {
	if (!entry) return undefined;
	if (entry.from !== undefined && entry.to !== undefined) return `${entry.from}–${entry.to}`;
	if (entry.from !== undefined) return `from ${entry.from}`;
	if (entry.to !== undefined) return `until ${entry.to}`;
	return undefined;
}

/**
 * The §13.3 reign for the entries of one holding: the `entryReign` of each entry that has one,
 * joined with ", ", "r. " before the first, in parentheses: "(r. 1131–1140, from 1145)".
 * Undefined when no entry has a reign.
 */
export function reignText(entries: readonly Holder[]): string | undefined {
	const parts = (Array.isArray(entries) ? entries : []).map(entryReign).filter((r): r is string => r !== undefined);
	return parts.length ? `(r. ${parts.join(', ')})` : undefined;
}

/** The ruler name of a holder (§13.5): `as`, else the first word of the person's name, else `name`. */
export function rulerName(holder: Holder, personName: string | undefined): string {
	if (holder?.as !== undefined) return holder.as;
	const first = personName?.trim().split(/\s+/)[0];
	if (first) return first;
	return holder?.name ?? '';
}

/**
 * The name of `title` for `person` (D65, D66): the `male-name` for a person with `sex: m`, the
 * `female-name` for a person with `sex: f`, else the name. Only the exact values `m` and `f` count,
 * as §13.1 reads them (D12); any other value, none, or a form the title lacks gets the name.
 */
export function titleNameFor(title: Title, person: Pick<Person, 'sex'> | undefined): string {
	if (!title) return '';
	const sex = person?.sex;
	if (sex === 'm' && title.maleName !== undefined) return title.maleName;
	if (sex === 'f' && title.femaleName !== undefined) return title.femaleName;
	return title.name;
}

/** D131: the text of one holder entry, the ruler name and then the number if the entry has one ("Aldric II", "Marta"). It does not decide whether a card shows it. */
export function entryRulerText(entry: Holder, personName: string | undefined): string {
	return entry.number === undefined ? rulerName(entry, personName) : `${rulerName(entry, personName)} ${entry.number}`;
}

/** "Aldric II" for a numbered entry, else undefined. */
const numbered = (entry: Holder, personName: string): string | undefined => (entry.number === undefined ? undefined : `${rulerName(entry, personName)} ${entry.number}`);

const labelsOf = new WeakMap<FamilyGraph, ReadonlyMap<string, CardLabel>>();

/** Card labels for every person of the graph, by id; memoised per graph. */
export function cardLabels(g: FamilyGraph): ReadonlyMap<string, CardLabel> {
	if (!g || typeof g !== 'object') return new Map();
	const known = labelsOf.get(g);
	if (known) return known;
	const holdings = new Map<string, Holding[]>();
	for (const title of g.titles ?? []) {
		const mine = new Map<string, Holder[]>();
		for (const h of title.holders) {
			// A holder whose `person` names nobody is not in the tree (rule 2 above).
			if (h.person === undefined || !g.byId.has(h.person)) continue;
			const list = mine.get(h.person);
			if (list) list.push(h);
			else mine.set(h.person, [h]);
		}
		for (const [id, entries] of mine) {
			const list = holdings.get(id);
			if (list) list.push({ title, entries });
			else holdings.set(id, [{ title, entries }]);
		}
	}
	const out = new Map<string, CardLabel>();
	for (const p of g.people) {
		const held = holdings.get(p.id) ?? [];
		const chosen = p.cardTitle === undefined ? undefined : held.find((h) => h.title.id === p.cardTitle);
		const shown = chosen ?? held[0];
		const label: CardLabel = { holdings: held, selected: chosen !== undefined, name: p.name };
		if (p.sobriquet !== undefined) label.sobriquet = p.sobriquet;
		if (shown) {
			label.shown = shown;
			// D131: a number comes first; with none, a written `as` counts. An entry with neither keeps the full name.
			const entry = shown.entries.find((e) => e.number !== undefined) ?? shown.entries.find((e) => e.as !== undefined);
			const text = entry ? entryRulerText(entry, p.name) : '';
			if (entry && text.trim() !== '') {
				label.name = text;
				if (entry.number !== undefined) label.numbered = true;
			}
		}
		const title = chosen ? titleNameFor(chosen.title, p) : p.title ?? (shown ? titleNameFor(shown.title, p) : undefined);
		if (title !== undefined) label.title = title;
		const reign = shown ? reignText(shown.entries) : undefined;
		if (reign !== undefined) label.reign = reign;
		out.set(p.id, Object.freeze(label));
	}
	labelsOf.set(g, out);
	return out;
}

/** The extra texts the picker and Find match for a person (§13.5, D131): "Aldric II" for every numbered entry and the written `as` of an unnumbered entry, once each. */
export function searchNames(label: CardLabel, personName: string): string[] {
	const out: string[] = [];
	for (const h of label?.holdings ?? []) {
		for (const e of h.entries) {
			const text = numbered(e, personName) ?? (e.as !== undefined && e.as.trim() !== '' ? e.as : undefined);
			if (text !== undefined && !out.includes(text)) out.push(text);
		}
	}
	return out;
}

/** The picker row suffix (§13.5): "(Aldric II)" for the shown holding's numbered entry, else the first numbered entry; undefined with none. */
export function pickerSuffix(label: CardLabel, personName: string): string | undefined {
	const first = (entries: readonly Holder[]) => {
		for (const e of entries) {
			const text = numbered(e, personName);
			if (text !== undefined) return text;
		}
		return undefined;
	};
	let text = label?.shown ? first(label.shown.entries) : undefined;
	for (const h of label?.holdings ?? []) text ??= first(h.entries);
	return text === undefined ? undefined : `(${text})`;
}

/**
 * The Delete title confirmation (§13.4): `holders` = the written holder items of the first title
 * with the id; `cards` = the people whose shown title is this title (their card then shows a
 * different title or none).
 */
export function describeDeleteTitle(g: FamilyGraph, id: string): { holders: number; cards: number } {
	const written = (g?.writtenTitles ?? []).find((t) => t.id === id);
	let cards = 0;
	for (const label of cardLabels(g).values()) if (label.shown?.title.id === id) cards++;
	return { holders: written ? written.items : 0, cards };
}

/**
 * The Id confirmation for a title (§13.17 rule 5): the written people whose `card-title` is `id`.
 * `g` is the graph of the whole parsed body, never of a focus view.
 */
export function describeTitleIdChange(g: FamilyGraph, id: string): { people: number } {
	return { people: (g?.people ?? []).filter((p) => p.cardTitle === id).length };
}

/**
 * §13.11 note-name cleaning: forbidden characters and control characters removed, spaces joined,
 * trimmed; `fallback` when empty (the title id for a table note).
 */
export function noteName(text: string, fallback: string): string {
	const clean = (typeof text === 'string' ? text : '')
		// Tabs and text line breaks become spaces below; the other control characters break a file name on Windows.
		.replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, '')
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.trim();
	return clean === '' ? fallback : clean;
}

/** A table cell: "|" escaped, text lines joined, so the table stays one row per entry. */
export const tableCell = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\|/g, '\\|');

/**
 * The table note text (D55, §13.4): a Markdown table with the columns "Ruler", "Name", "Reign",
 * one row per holder entry in list order; "|" in values is escaped as "\|". Names come from `g`.
 */
export function holderTable(g: FamilyGraph, title: Title): string {
	const rows = ['| Ruler | Name | Reign |', '| --- | --- | --- |'];
	for (const h of title?.holders ?? []) {
		const person = h.person === undefined ? undefined : g?.byId.get(h.person);
		const full = person ? person.name : h.name ?? '';
		const ruler = rulerName(h, person?.name);
		const rulerCell = h.number === undefined ? ruler : `${ruler} ${h.number}`;
		// The full name shows only when it says more than the ruler name.
		const name = full === ruler ? '' : full;
		rows.push(`| ${tableCell(rulerCell)} | ${tableCell(name)} | ${tableCell(entryReign(h) ?? '')} |`);
	}
	return rows.join('\n') + '\n';
}

/**
 * True when the drawn graph needs card labels: it has titles (spec §13.4) or a person has a sobriquet (D122).
 * A tree with neither draws with no labels.
 */
export function needsLabels(g: FamilyGraph): boolean {
	return (g.titles?.length ?? 0) > 0 || g.people.some((p) => p.sobriquet !== undefined);
}
