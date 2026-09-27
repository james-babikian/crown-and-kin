/*
 * Pure helpers that turn the model into what a card, the legend and the timing Notice show. Used
 * by the tree view, the scene, the legend, and others. Every string here is plugin text, so it
 * obeys Simplified Technical English (ASD-STE100) and the project word list.
 */
import type { FamilyGraph } from '../core/derive';
import type { Person } from '../core/types';
import type { StrokeKind } from '../layout/model';

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

/** What a screen reader says for a card: name, title and dates. */
export function cardLabel(p: Person): string {
	return [p.name, p.title, dateLine(p)].filter((x) => x !== undefined && x !== '').join(', ');
}

/**
 * The note a `link` value points to, as Obsidian link text (path and optional #heading).
 * Accepts `[[Note]]`, `[[Note|Alias]]`, `[[Note#Heading]]`, `[Alias](Note.md)` and a bare `Note`.
 */
export function linkTarget(link: string | undefined): string | null {
	if (typeof link !== 'string') return null;
	let s = link.trim();
	const wiki = /^!?\[\[([^\]]*)\]\]$/.exec(s);
	const md = /^!?\[[^\]]*\]\(([^)]*)\)$/.exec(s);
	if (wiki) s = wiki[1].split('|')[0];
	else if (md) {
		s = md[1].trim().replace(/^<(.*)>$/, '$1');
		try {
			s = decodeURIComponent(s);
		} catch {
			// Keep the text as written if it is not valid percent-encoding.
		}
	}
	s = s.trim();
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
