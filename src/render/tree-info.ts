/*
 * Pure helpers that turn the model into what a card, the legend, the timing Notice and the relation
 * finder (M7, `RelationTexts`) show. Used by the tree view, the scene, the legend, and others. Every string here is plugin text, so it
 * obeys Simplified Technical English (ASD-STE100) and the project word list.
 */
import { PLAIN_READER, type DateReader, type TreeDates } from '../core/dates';
import type { FamilyGraph } from '../core/derive';
import { linkText } from '../core/link-text';
import { CURLY_APOSTROPHE } from '../core/quote';
import { DOUBTFUL_DIED, isDead } from '../core/succession-keys';
import type { FinderResult, Relation, RelationStep } from '../core/relations';
import { cardLabels, entryReign, type CardLabel } from '../core/titles';
import type { Holder, Person } from '../core/types';

// The legend texts live in legend-text.ts (one home each); these names stay importable from here.
export { LEGEND_HOUSES_LABEL, LEGEND_LABELS, LEGEND_LINES_LABEL, LEGEND_ORDER, SIGN_LEGEND_LABEL } from './legend-text';

/** The relation text builders below (spec §13.1, §13.2). Names come from `g.byId`; an empty name uses the id; the possessive is always "’s" (D99). */
export interface RelationTexts {
	/** "Wren is Roderick's half-sister." for `relations[index]`; the chain and none sentences of §13.2 otherwise. */
	finderSentence(g: FamilyGraph, r: FinderResult, index: number): string;
	/** At most 8 step sentences, then the count of the others ("and 4 more steps"). */
	stepSentences(g: FamilyGraph, steps: readonly RelationStep[]): { shown: string[]; more: number };
	/**
	 * The sheet's lines: `main` "Relation to you: Second cousin." (the marked person: "This is you.";
	 * no relation: "No relation to you in this tree."); `also` "Also: brother-in-law, third cousin."
	 * for `rels[1..3]`, with ", and N more" before the full stop when there are more than 4.
	 */
	relationSummary(rels: readonly Relation[] | undefined, isMe: boolean): { main: string; also?: string; maybe?: string };
}

/**
 * D123, D174: the texts of a relation that a rumoured link, or a parent who is not listed, could
 * change (spec §13.1). The cause picks the sheet and spoken words; the effect picks the card words.
 */
export const MAYBE_TEXT = {
	/** Appended to `Relation.text` on the card when `maybe.effect` is 'full'. */
	cardFull: ', maybe full',
	/** Appended to `Relation.text` on the card when `maybe.effect` is 'half' (D174 rule 4). */
	cardHalf: ', maybe half',
	/** The sheet paragraph when a rumoured link is part of the doubt. */
	sheet: (lower: string) => `If every rumoured link is true, this person is your ${lower}.`,
	/** The sheet paragraph when only a parent who is not listed is the doubt (D174), form 'same-person': both people list the same one parent (F-KIN-08). */
	sheetUnlistedSame: (lower: string) => `If the parent that the note does not name is the same person for both, this person is your ${lower}.`,
	/** The same, form 'other-parent': one person lists both parents and the other lists one of them (F-KIN-08). */
	sheetUnlistedOther: (lower: string) => `If this person${CURLY_APOSTROPHE}s other parent is also your parent, this person is your ${lower}.`,
	/** D176 (4): the sheet paragraph when only some of the rumoured links can be true together (`maybe.some`). */
	sheetSome: (lower: string) => `If some of the rumoured links are true, this person is your ${lower}.`,
	spoken: (lower: string) => `or ${lower} if the rumoured links are true`,
	spokenUnlistedSame: (lower: string) => `or ${lower} if the parent that the note does not name is the same person for both`,
	spokenUnlistedOther: (lower: string) => `or ${lower} if this person${CURLY_APOSTROPHE}s other parent is also your parent`,
	spokenSome: (lower: string) => `or ${lower} if some rumoured links are true`,
} as const;

/** The sheet paragraph for an 'unlisted' cause; the form says which of the two sentences is true (F-KIN-08). */
const sheetUnlisted = (m: { lower: string; unlistedForm?: 'same-person' | 'other-parent' }) => (m.unlistedForm === 'other-parent' ? MAYBE_TEXT.sheetUnlistedOther(m.lower) : MAYBE_TEXT.sheetUnlistedSame(m.lower));

/** The relation text of a card: "Half-brother, maybe full" or "Sister, maybe half" when the relation has a maybe; else `rel.text`. */
export function cardRelationText(rel: Relation): string {
	if (!rel.maybe) return rel.text;
	return `${rel.text}${rel.maybe.effect === 'full' ? MAYBE_TEXT.cardFull : MAYBE_TEXT.cardHalf}`;
}

/** Splits a card relation text into the relation word and its maybe suffix (D176 5); the suffix is '' when there is none. */
export function splitMaybe(text: string): { word: string; suffix: string } {
	for (const suffix of [MAYBE_TEXT.cardFull, MAYBE_TEXT.cardHalf]) if (text.endsWith(suffix) && text.length > suffix.length) return { word: text.slice(0, -suffix.length), suffix };
	return { word: text, suffix: '' };
}

/** The relation as the screen-reader label says it: "half-brother, or brother if the rumoured links are true" when the relation has a maybe. */
export function spokenRelation(rel: Relation): string {
	if (!rel.maybe) return rel.lower;
	const m = rel.maybe;
	const tail = m.cause === 'unlisted' ? (m.unlistedForm === 'other-parent' ? MAYBE_TEXT.spokenUnlistedOther(m.lower) : MAYBE_TEXT.spokenUnlistedSame(m.lower)) : m.some ? MAYBE_TEXT.spokenSome(m.lower) : MAYBE_TEXT.spoken(m.lower);
	return `${rel.lower}, ${tail}`;
}

/**
 * Start person (spec §5.5): `start` if that person exists, else the first person in document
 * order who has no placement parents. The tree view passes the last edited person as `start`
 * when there is one, else `options.start`.
 */
export function startPerson(g: FamilyGraph, start: string | undefined): string | null {
	if (start !== undefined && g.byId.has(start)) return start;
	for (const p of g.people) {
		if (!(g.placementParents.get(p.id)?.length ?? 0)) return p.id;
	}
	return g.people[0]?.id ?? null;
}

/**
 * Partners and placement children of `id`, each once, in union order: the cards the readable
 * default view tries to show next to the start person (spec §5.5, D13).
 */
export function partnersAndChildren(g: FamilyGraph, id: string): { partners: string[]; children: string[] } {
	const partners = new Set<string>();
	const children = new Set<string>();
	for (const key of g.unionsOf.get(id) ?? []) {
		const u = g.unionByKey.get(key);
		if (!u) continue;
		for (const p of u.partners) if (p !== id) partners.add(p);
		for (const c of u.children) children.add(c);
	}
	for (const c of g.soloChildren.get(id) ?? []) children.add(c);
	return { partners: [...partners], children: [...children] };
}

/** I19: the sign of a dead person whose `died` holds no year ("yes", "true", a doubt such as "?"); '†?' for a doubt, '†' for any other text without a year. */
export const DEAD_SIGN = '†';
export const DEAD_SIGN_DOUBT = '†?';

/** Screen-reader words for the two signs (the character itself is not read). */
export const CARD_SPOKEN_DEAD = 'dead';
export const CARD_SPOKEN_DEAD_DOUBT = 'dead, but the death text is not clear';

/** What the date helpers need of the dates view: `read`, and (when known) `reader.hasLists`, so a tree with no name list pays nothing. */
export type DatesRead = Pick<TreeDates, 'read'> & { readonly reader?: Pick<DateReader, 'hasLists'> };

/** Which names a short date shows (spec §14 rule 15): the lists' own setting, full names, or none. */
export type NamesForm = 'shown' | 'full' | 'none';

/**
 * The short date `text` with the name of its year (spec §14 rule 15, D273): only a whole date gets names, one space after the date, in list order.
 * A list with a written name gets nothing (no doubling), also when the written name is wrong. `'shown'` follows the `show` of each list,
 * `'full'` uses the full names of every list that is not `none`, `'none'` adds nothing (a search text, a test for a sign).
 */
export function shownDate(text: string, dates: DatesRead, form: NamesForm): string {
	// A tree with no list never reads the born text here: this keeps the cost of 0.3.2.
	if (form === 'none' || dates.reader?.hasLists === false) return text;
	const r = dates.read(text);
	if (!r?.whole || !r.names) return text;
	const add: string[] = [];
	for (const n of r.names) {
		if (n.show === 'none' || n.written) continue;
		add.push(form === 'full' || n.show === 'full' || n.short === undefined ? n.name : n.short);
	}
	return add.length ? `${text.trimEnd()} ${add.join(' ')}` : text;
}

/** The en dash of a date range, and the thin space (U+2009) that goes on each side of it when a date of the range has a name or an approximate word (D278). */
const DASH = '\u2013';
const THIN = '\u2009';

/** A date that starts with the word of an approximate year ("c. 1131", "ca. 1131", "about 1131", "circa 1131"; spec §14 rule 4). */
const APPROX_WORD = /^\s*(?:(?:c|ca)\.|about|circa)(?=[\s\d])/i;

/** True when the date `raw` has a name of its year, written or added (`shown` is the same date with the names that the cards add), or starts with an approximate word. */
function hasNameOrWord(raw: string, shown: string, dates: DatesRead): boolean {
	if (APPROX_WORD.test(raw) || shown !== raw) return true;
	return dates.reader?.hasLists !== false && dates.read(raw)?.names?.some((n) => n.written) === true;
}

/**
 * The two dates of a range with the dash between them: "1131–1160". A date that has a name of its year or an approximate word ("22.13 Sa", "c. 1131") would touch the dash
 * ("Sa–c."), so a thin space goes on each side of it. A plain range keeps the plain dash. `from` and `to` are the dates as written and as shown (with the names added).
 */
export function dateRange(from: { raw: string; shown: string }, to: { raw: string; shown: string }, dates: DatesRead): string {
	return `${from.shown}${rangeDash(from, to, dates)}${to.shown}`;
}

/** The dash between the two dates of a range, with a thin space on each side when a date has a name or an approximate word (see `dateRange`). */
function rangeDash(from: { raw: string; shown: string }, to: { raw: string; shown: string }, dates: DatesRead): string {
	const spaced = hasNameOrWord(from.raw, from.shown, dates) || hasNameOrWord(to.raw, to.shown, dates);
	return spaced ? `${THIN}${DASH}${THIN}` : DASH;
}

/** The born and died dates of a person row with their names, and the range that joins them (undefined when a date is missing): the same text as on the card. */
export function shownYears(born: string, died: string, dates: DatesRead): { born: string; died: string; range: string | undefined } {
	const [b, d] = [born, died].map((x) => shownDate(x, dates, 'shown'));
	return { born: b, died: d, range: born && died ? dateRange({ raw: born, shown: b }, { raw: died, shown: d }, dates) : undefined };
}

/** One holder entry as the reign text of a card has it ("22.13 Sa – 23.20 Ve", "from 1131", "until 1160"): the same as `entryReign` of the core, with the names of the dates (spec §14 rule 15) and `dateRange`. */
export function entryReignText(entry: Holder, dates: DatesRead, form: NamesForm): string | undefined {
	const shown = shownHolder(entry, dates, form);
	if (entry.from !== undefined && entry.to !== undefined) return dateRange({ raw: entry.from, shown: shown.from! }, { raw: entry.to, shown: shown.to! }, dates);
	return entryReign(shown);
}

/** The reign text of the entries, "(r. 1131–1140, from 1145)": the same as `reignText` of the core, with `entryReignText`. */
export function reignOf(entries: readonly Holder[], dates: DatesRead, form: NamesForm): string | undefined {
	const parts = entries.map((e) => entryReignText(e, dates, form)).filter((r): r is string => r !== undefined);
	return parts.length ? `(r. ${parts.join(', ')})` : undefined;
}

/**
 * The reign of a card label (`CardLabel.reign`, "(r. 22.30–23.20)") with the names of its dates (spec §14 rule 15). The label keeps the text as written;
 * this builds the same text again from the entries, with `shownDate` for each date. Without a list it is the label's own text, except that a range with
 * an approximate word ("c.") has the thin spaces around its dash (D278).
 */
export function shownReign(label: Pick<CardLabel, 'reign' | 'shown'> | undefined, dates: DatesRead, form: NamesForm): string | undefined {
	if (!label?.reign || !label.shown) return label?.reign;
	// No names and no approximate word in a range: the label's own text is the answer, and no card pays for building it again.
	const names = form !== 'none' && dates.reader?.hasLists !== false;
	const approx = label.shown.entries.some((e) => e.from !== undefined && e.to !== undefined && (APPROX_WORD.test(e.from) || APPROX_WORD.test(e.to)));
	return names || approx ? (reignOf(label.shown.entries, dates, form) ?? label.reign) : label.reign;
}

/** The title of a card label with its reign, the reign with the names of its years (spec §14 rule 15); `written` when the tree has no list or the person has no label. */
export function titleWithNames(g: FamilyGraph, id: string, written: string): string {
	const label = written && g.dates.reader?.hasLists ? cardLabels(g).get(id) : undefined;
	return label ? [label.title, shownReign(label, g.dates, 'shown')].filter((x) => x !== undefined && x !== '').join(' ') : written;
}

/** The title text of the head of the person window: with a reign, the reign shows the names of its years, as the card does (spec §14 rule 15); the label keeps the text as written. */
export function headTitle(label: Pick<CardLabel, 'title' | 'reign' | 'shown'> | undefined, titleText: string, dates: DatesRead): string {
	return label?.title && label.reign ? `${titleText} ${shownReign(label, dates, 'shown') ?? label.reign}` : titleText;
}

/** A holder entry (or the values of a holder form) with `from` and `until` as short dates with names (spec §14 rule 15); the text of a reign is built from it with `entryReign`. */
export function shownHolder<T extends { from?: string; to?: string }>(entry: T, dates: DatesRead, form: NamesForm): T {
	const date = (text: string | undefined) => (text === undefined ? undefined : shownDate(text, dates, form));
	return { ...entry, ...(entry.from !== undefined ? { from: date(entry.from) } : {}), ...(entry.to !== undefined ? { to: date(entry.to) } : {}) };
}

/**
 * The two parts of a card's dates (I19): the text with the years, and the sign of a dead person with no death year.
 * A `died` that means alive (K.7: "no", "false") gives neither a death year nor the sign. A death text that fits a calendar of the
 * tree has a year, so it shows as written and not as the sign (spec §14 rule 7); `dates` reads it. `names` says which names follow a whole date (rule 15).
 */
function dateParts(p: Person, dates: DatesRead, names: NamesForm = 'shown'): { text?: string; sign?: string; pieces?: DatePieces } {
	const dead = isDead(p);
	const died = dead ? p.died : undefined;
	const hasYear = died !== undefined && dates.read(died)?.year !== undefined;
	const sign = dead && !hasYear ? (DOUBTFUL_DIED.includes(p.died!.trim().toLowerCase()) ? DEAD_SIGN_DOUBT : DEAD_SIGN) : undefined;
	let pieces: DatePieces | undefined;
	if (p.born && hasYear) {
		const from = { raw: p.born, shown: shownDate(p.born, dates, names) };
		const to = { raw: died, shown: shownDate(died, dates, names) };
		pieces = { lead: '', born: from.shown, dash: rangeDash(from, to, dates), died: to.shown };
	} else if (p.born) pieces = { lead: 'b. ', born: shownDate(p.born, dates, names), dash: '' };
	else if (hasYear) pieces = { lead: 'd. ', dash: '', died: shownDate(died, dates, names) };
	const text = pieces && `${pieces.lead}${pieces.born ?? ''}${pieces.dash}${pieces.died ?? ''}`;
	return { ...(text !== undefined ? { text } : {}), ...(sign !== undefined ? { sign } : {}), ...(pieces ? { pieces } : {}) };
}

/** The parts of the dates text before they are joined: the lead ("b. ", "d. " or nothing), the born date, the dash of a range and the died date. */
interface DatePieces {
	lead: string;
	born?: string;
	dash: string;
	died?: string;
}

/** One part of the dates text line: a date of its own (`date`), or plain text (the lead, the dash, the sign). */
export interface DateSegment {
	text: string;
	/** Set on a born or died date, which the list isolates for the text direction (an Arabic word before a number would turn the range round). */
	date?: 'born' | 'died';
}

/**
 * The dates text line of `dateLine` in parts: the born date and the died date each in a part of their own, the lead, the dash and the sign between them. The
 * parts joined are exactly the text of `dateLine`. The list uses this to isolate each date for the text direction; the card keeps the plain string.
 */
export function dateLineParts(p: Person, dates: DatesRead, opts: { names?: NamesForm } = {}): DateSegment[] | undefined {
	const { sign, pieces } = dateParts(p, dates, opts.names);
	const out: DateSegment[] = [];
	if (pieces) {
		if (pieces.lead) out.push({ text: pieces.lead });
		if (pieces.born !== undefined) out.push({ text: pieces.born, date: 'born' });
		if (pieces.dash) out.push({ text: pieces.dash });
		if (pieces.died !== undefined) out.push({ text: pieces.died, date: 'died' });
		if (sign !== undefined) out.push({ text: ` ${sign}` });
	} else if (sign !== undefined) out.push({ text: sign });
	return out.length ? out : undefined;
}

/**
 * The dates text line of a card: "born–died", "b. born" or "d. died"; none without dates. A dead person with no death year
 * (I19) gets a sign after the birth text: "b. 1131 †", or "†" alone; "†?" if the `died` text is a doubt. A whole date gets the name of its
 * year after it (spec §14 rule 15); `opts.names` is `'none'` for the second try of the cut and for a test of a sign.
 */
export function dateLine(p: Person, dates: DatesRead, opts: { names?: NamesForm } = {}): string | undefined {
	const { text, sign } = dateParts(p, dates, opts.names);
	if (text !== undefined && sign !== undefined) return `${text} ${sign}`;
	return text ?? sign;
}

/**
 * What a screen reader says for a card: name, title and dates, then (spec §13.1) the relation to the
 * marked person in lower case ("half-sister"; "you" on the marked card). With the card's `label`
 * (M8, spec §13.3, §13.5) the name and title are the card's: "Roderick II, Duke of Valmont (r.
 * 1160–1190), 1140–1190". The reign stays also when "Show dates on cards" hides it, like the dates.
 * 0.2.7 (F.4): while the Show view of a line of succession is open, `inLine` ("2nd in line", "open branch") comes last.
 * `dates` reads the death text like `dateLine` does. Every caller in `src` passes `g.dates`; it is optional so that the older
 * tests can leave it out (they read plain years).
 */
export function cardLabel(p: Person, relation?: string, label?: CardLabel, inLine?: string, dates?: DatesRead): string {
	const name = label ? label.name : p.name;
	// The label says the full names of the years and never cuts them (spec §14 rule 15).
	const title = label ? [label.title, shownReign(label, dates ?? PLAIN_READER, 'full')].filter((x) => x !== undefined && x !== '').join(' ') : p.title;
	// The sign is a character, so the label says it with words (ruling 14).
	const { text, sign } = dateParts(p, dates ?? PLAIN_READER, 'full');
	const dead = sign === undefined ? undefined : sign === DEAD_SIGN_DOUBT ? CARD_SPOKEN_DEAD_DOUBT : CARD_SPOKEN_DEAD;
	return [name, title, text, dead, relation, inLine].filter((x) => x !== undefined && x !== '').join(', ');
}

/**
 * The note a `link` value points to, as Obsidian link text (path and optional #heading).
 * Accepts `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[Alias](Note.md)` and a bare `Note`.
 */
export function linkTarget(link: string | undefined): string | null {
	if (typeof link !== 'string') return null;
	const s = linkText(link);
	return s === '' || s === '#' ? null : s;
}

/** Screen-reader text added to a card with the sign. */
export const SIGN_CARD_LABEL = 'illegitimate';

/** How long the last render took, for the "Show render timing" command (spec §7.7). */
export interface RenderTiming {
	/** Note path of the tree. */
	path: string;
	/** People drawn. */
	people: number;
	/** In focus mode: the people of the whole tree (the Notice says "38 of 389 people"). */
	of?: number;
	parseMs: number;
	layoutMs: number;
	drawMs: number;
	totalMs: number;
	/**
	 * From the start of the render to the first painted frame with the cards at their first view and
	 * the input wired (spec §7.7 "interactive"). Missing until that frame has been painted.
	 */
	interactiveMs?: number;
	/** The full-screen view drew the tree, not the note. */
	full?: boolean;
}

const ms = (n: number) => `${Math.max(0, Math.round(n))} ms`;

/** The "Show render timing" Notice (spec §7.7). */
export function timingText(t: RenderTiming | null): string {
	if (!t) return 'The plugin does not show a tree yet. Open a note with a tree. Then do this command again.';
	const who = t.of !== undefined && t.of !== t.people ? `the family, ${t.people} of ${t.of} people` : t.people === 1 ? '1 person' : `${t.people} people`;
	const where = `${t.path}, ${who}${t.full ? ', full-screen' : ''}`;
	const parts = `Time to read the text: ${ms(t.parseMs)}. Time to arrange the people: ${ms(t.layoutMs)}.`;
	if (t.interactiveMs === undefined) return `The last tree (${where}) took ${ms(t.totalMs)}. ${parts} Time to draw the tree: ${ms(t.drawMs)}.`;
	return `The last tree (${where}) was ready for use after ${ms(t.interactiveMs)}. ${parts} Time to make the cards and lines: ${ms(t.drawMs)}. Time to show them on the screen: ${ms(t.interactiveMs - t.totalMs)}.`;
}

/**
 * The visible text of a far-couple tag after its ⚭ sign (spec §5.3, D10): the partner's name, or
 * "N partners" for several (STE wording; the spec says spouses). Both renderers draw the sign apart.
 */
export function farTagName(g: FamilyGraph, spouses: string[]): string {
	return spouses.length === 1 ? (g.byId.get(spouses[0])?.name ?? spouses[0]) : `${spouses.length} partners`;
}

/** Screen-reader text for a far-couple tag; the visible text comes from `farTagName`. */
export function farTagLabel(g: FamilyGraph, spouses: string[]): string {
	if (spouses.length === 1) return `Show the partner ${farTagName(g, spouses)}.`;
	return `Show a list of ${spouses.length} partners.`;
}

/** A person's name as the card shows it; an empty or unknown name uses the id (spec §13.2). */
const shownName = (g: FamilyGraph, id: string) => g.byId.get(id)?.name || id;

/** "NAME is OF's WORD." One sentence of the relation finder (spec §13.2). */
const isOf = (g: FamilyGraph, person: string, of: string, word: string) => `${shownName(g, person)} is ${shownName(g, of)}${CURLY_APOSTROPHE}s ${word}.`;

/** The most step sentences the finder shows before "and N more steps" (spec §13.2). */
export const MAX_STEP_SENTENCES = 8;

/** The finder's sentence for `r` (spec §13.2): the relation at `index` for a named result, else the chain or "no relation" sentence. */
export const finderSentence: RelationTexts['finderSentence'] = (g, r, index) => {
	const pair = `${shownName(g, r.first)} and ${shownName(g, r.second)}`;
	if (r.kind === 'named') {
		const rel = r.relations[Math.min(Math.max(0, Math.trunc(index) || 0), r.relations.length - 1)];
		if (rel) return isOf(g, r.second, r.first, rel.relation.lower);
		return `${pair} have no relation in this tree.`;
	}
	if (r.kind === 'chain') {
		const others = Math.max(0, r.line.people.length - 2);
		if (!others) return `${pair} have a relation.`;
		return `${pair} have a relation through ${others} other ${others === 1 ? 'person' : 'people'}.`;
	}
	return `${pair} have no relation in this tree.`;
};

/** The step sentences of the finder (spec §13.2): at most 8, and how many more steps there are. */
export const stepSentences: RelationTexts['stepSentences'] = (g, steps: readonly RelationStep[]) => ({
	shown: steps.slice(0, MAX_STEP_SENTENCES).map((s) => isOf(g, s.person, s.of, s.word)),
	more: Math.max(0, steps.length - MAX_STEP_SENTENCES),
});

/** D146, D147: the texts of the relation infobox (computer) and the strip (phone). */
export const RELINFO = {
	title: 'Relation to you',
	/** The short count in the closed strip: "7 more", "1 more". */
	more: (n: number) => `${n} more`,
} as const;

/** What the infobox and the strip show for one person. */
export interface RelationInfo {
	kind: 'relation' | 'me' | 'none';
	/** 'Second cousin' (no full stop) for 'relation'; with a maybe it is the card text ('Half-sister, maybe full', F-KIN-08); 'This is you.' for 'me'; 'No relation to you in this tree.' for 'none'. */
	value: string;
	/** `relationSummary().also` and `.maybe` (D123: only from the first relation). */
	also?: string;
	maybe?: string;
	/** The number of other relations: `rels.length - 1` for 'relation', else 0. This is the strip count; "Also" names at most 3 of them. */
	others: number;
}

/** Builds `RelationInfo` from the same `Relation[]` as `relationSummary`; the sentences come from `relationSummary` (one source). */
export function relationInfo(rels: readonly Relation[] | undefined, isMe: boolean): RelationInfo {
	const sum = relationSummary(rels, isMe);
	if (isMe) return { kind: 'me', value: sum.main, others: 0 };
	if (!rels?.length) return { kind: 'none', value: sum.main, others: 0 };
	const info: RelationInfo = { kind: 'relation', value: cardRelationText(rels[0]), others: rels.length - 1 };
	if (sum.also !== undefined) info.also = sum.also;
	if (sum.maybe !== undefined) info.maybe = sum.maybe;
	return info;
}

/** How many other relations "Also:" names before "and N more" (spec §13.1). */
const ALSO_SHOWN = 3;

/** The edit sheet's relation text lines (spec §13.1): "Relation to you: …", then "Also: …" for the other relations. */
export const relationSummary: RelationTexts['relationSummary'] = (rels: readonly Relation[] | undefined, isMe) => {
	if (isMe) return { main: 'This is you.' };
	if (!rels?.length) return { main: 'No relation to you in this tree.' };
	// One source for the card, the header line of the window and the phone list (F-KIN-08).
	const main = `${RELINFO.title}: ${cardRelationText(rels[0])}.`;
	// The card shows the first relation only, so the sheet explains the maybe of that one only.
	const m = rels[0].maybe;
	const maybe = m ? { maybe: m.cause === 'unlisted' ? sheetUnlisted(m) : m.some ? MAYBE_TEXT.sheetSome(m.lower) : MAYBE_TEXT.sheet(m.lower) } : {};
	const others = rels.slice(1);
	if (!others.length) return { main, ...maybe };
	const names = others.slice(0, ALSO_SHOWN).map((r) => r.lower);
	const more = others.length - names.length;
	return { main, also: `Also: ${names.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`, ...maybe };
};
