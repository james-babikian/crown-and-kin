/*
 * Pure helpers that turn the model into what a card, the legend, the timing Notice and the relation
 * finder (M7, `RelationTexts`) show. Used by the tree view, the scene, the legend, and others. Every string here is plugin text, so it
 * obeys Simplified Technical English (ASD-STE100) and the project word list.
 */
import type { FamilyGraph } from '../core/derive';
import { linkText } from '../core/link-text';
import { CURLY_APOSTROPHE } from '../core/quote';
import type { FinderResult, Relation, RelationStep } from '../core/relations';
import type { CardLabel } from '../core/titles';
import type { Person } from '../core/types';
import type { StrokeKind } from '../layout/model';

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

/** D123: the texts of a relation that a rumoured link could change (contract 2.4). */
export const MAYBE_TEXT = {
	/** Appended to `Relation.text` on the card when `maybe.effect` is 'full'. */
	cardFull: ', maybe full',
	sheet: (lower: string) => `If every rumoured link is true, this person is your ${lower}.`,
	spoken: (lower: string) => `or ${lower} if the rumoured links are true`,
} as const;

/** The relation text of a card: "Half-brother, maybe full" when a rumoured parent would make the relation full; else `rel.text`. */
export function cardRelationText(rel: Relation): string {
	return rel.maybe?.effect === 'full' ? `${rel.text}${MAYBE_TEXT.cardFull}` : rel.text;
}

/** The relation as the screen-reader label says it. The rare "maybe half" case adds nothing; the sheet and the "Also" list carry it. */
export function spokenRelation(rel: Relation): string {
	return rel.maybe?.effect === 'full' ? `${rel.lower}, ${MAYBE_TEXT.spoken(rel.maybe.lower)}` : rel.lower;
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
export function familyOf(g: FamilyGraph, id: string): { partners: string[]; children: string[] } {
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

/** The dates text line of a card: "born–died", "b. born" or "d. died"; none without dates. */
export function dateLine(p: Person): string | undefined {
	if (p.born && p.died) return `${p.born}–${p.died}`;
	if (p.born) return `b. ${p.born}`;
	if (p.died) return `d. ${p.died}`;
	return undefined;
}

/**
 * What a screen reader says for a card: name, title and dates, then (spec §13.1) the relation to the
 * marked person in lower case ("half-sister"; "you" on the marked card). With the card's `label`
 * (M8, spec §13.3, §13.5) the name and title are the card's: "Roderick II, Duke of Valmont (r.
 * 1160–1190), 1140–1190". The reign stays also when "Show dates on cards" hides it, like the dates.
 */
export function cardLabel(p: Person, relation?: string, label?: CardLabel): string {
	const name = label ? label.name : p.name;
	const title = label ? [label.title, label.reign].filter((x) => x !== undefined && x !== '').join(' ') : p.title;
	return [name, title, dateLine(p), relation].filter((x) => x !== undefined && x !== '').join(', ');
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

/** Legend labels for each line style; `STROKES[kind].label` in styles.ts reads them from here. */
export const LEGEND_LABELS: Record<StrokeKind, string> = {
	marriage: 'Marriage',
	betrothal: 'Betrothal',
	concubinage: 'Concubinage',
	affair: 'Affair',
	implicit: 'Parents with no recorded partnership',
	descent: 'Child',
	illegitimate: 'Illegitimate child',
	'birth-link': 'Birth parent of a child shown under other parents',
	adoptive: 'Adoptive parent',
	ward: 'Guardian of a ward',
	rumoured: 'Rumoured parent',
};

/** Legend label for the card sign (spec D14): illegitimacy that no dashed line shows. */
export const SIGN_LEGEND_LABEL = 'Illegitimate child (no dashed line)';

/** M9 (spec §13.6 "Legend", §13.8): the heading of the legend's houses part, on screen and in a saved picture. */
export const LEGEND_HOUSES_LABEL = 'Houses';

/** M9 (spec §13.8, D74): the heading of the line styles part of a saved picture's legend. */
export const LEGEND_LINES_LABEL = 'Line styles';

/** Screen-reader text added to a card with the sign. */
export const SIGN_CARD_LABEL = 'illegitimate';

/** Legend order: partnerships, then children, then other parents. */
export const LEGEND_ORDER: StrokeKind[] = [
	'marriage',
	'betrothal',
	'concubinage',
	'affair',
	'implicit',
	'descent',
	'illegitimate',
	'adoptive',
	'ward',
	'rumoured',
	'birth-link',
];

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

// A plain function, so that `RELINFO.more` and `RELINFO.stripLabel` share one text and the object does not refer to itself.
const moreText = (n: number) => `${n} more`;

/** D146, D147: the texts of the relation infobox (computer) and the strip (phone). */
export const RELINFO = {
	title: 'Relation to you',
	/** The short count in the closed strip: "7 more", "1 more". */
	more: moreText,
	/** The accessible name of the strip head. It holds the whole visible text word for word (WCAG 2.5.3): the sentence, then the count. "Relation to you: Second cousin. 7 more." */
	stripLabel: (sentence: string, others: number) => (others === 0 ? sentence : `${sentence} ${moreText(others)}.`),
} as const;

/** What the infobox and the strip show for one person. */
export interface RelationInfo {
	kind: 'relation' | 'me' | 'none';
	/** 'Relation to you' for kind 'relation'; '' for 'me' and 'none'. */
	title: string;
	/** 'Second cousin' (no full stop) for 'relation'; 'This is you.' for 'me'; 'No relation to you in this tree.' for 'none'. */
	value: string;
	/** The whole first text line: 'Relation to you: Second cousin.' (= `relationSummary().main`). */
	sentence: string;
	/** `relationSummary().also` and `.maybe` (D123: only from the first relation). */
	also?: string;
	maybe?: string;
	/** The number of other relations: `rels.length - 1` for 'relation', else 0. This is the strip count; "Also" names at most 3 of them. */
	others: number;
}

/** Builds `RelationInfo` from the same `Relation[]` as `relationSummary`; the sentences come from `relationSummary` (one source). */
export function relationInfo(rels: readonly Relation[] | undefined, isMe: boolean): RelationInfo {
	const sum = relationSummary(rels, isMe);
	if (isMe) return { kind: 'me', title: '', value: sum.main, sentence: sum.main, others: 0 };
	if (!rels?.length) return { kind: 'none', title: '', value: sum.main, sentence: sum.main, others: 0 };
	const info: RelationInfo = { kind: 'relation', title: RELINFO.title, value: rels[0].text, sentence: sum.main, others: rels.length - 1 };
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
	const main = `${RELINFO.title}: ${rels[0].text}.`;
	// The card shows the first relation only, so the sheet explains the maybe of that one only.
	const maybe = rels[0].maybe ? { maybe: MAYBE_TEXT.sheet(rels[0].maybe.lower) } : {};
	const others = rels.slice(1);
	if (!others.length) return { main, ...maybe };
	const names = others.slice(0, ALSO_SHOWN).map((r) => r.lower);
	const more = others.length - names.length;
	return { main, also: `Also: ${names.join(', ')}${more > 0 ? `, and ${more} more` : ''}.`, ...maybe };
};

/** The three builders as one `RelationTexts`, so the compiler keeps them in step with it. */
export const RELATION_TEXTS: RelationTexts = { finderSentence, stepSentences, relationSummary };
