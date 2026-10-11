/*
 * Finds which cards need two or three text lines for their name (D29, D37, D81) or two for their title text line with
 * a reign (D61) instead of one truncated line.
 * `tree-view.ts` calls `tallCardsFor` and `tallTitlesFor` before layout, and passes their answers in as
 * `settings.tallCards` and `settings.tallTitles` so the layout makes exactly these cards taller; `sameTall` lets it
 * skip a re-layout when an answer has not changed. The name is broken with `cardNameLines` and the room that `nameRoom` gives,
 * the same call that `scene.ts` and `svg-string.ts` make to draw it. 0.2.6 (D179): no picture narrows a name (the classic card is gone),
 * so rule B (the lift) and the second name slot of D129 are gone too; the inner edge of the mark's border is passed to `nameRoom`
 * (the Roundel's room depends on it).
 */

import type { FamilyGraph } from '../../core/derive';
import { sameList } from '../../core/same-list';
import type { CardLabel } from '../../core/titles';
import type { Person } from '../../core/types';
import { cardText, nameRoom } from '../../layout/geometry';
import { couldBeSigned } from '../../layout/illegitimate-sign';
import type { Geometry, NameLineCount, NameRoom } from '../../layout/model';
import type { BreakList } from '../break-words';
import { cardNameLines, titleLines, type NameMeasure } from '../name-lines';
import { ME_RING_INNER } from '../styles';
import type { Measure, SceneFonts } from './scene';

/** D29, D81: the people whose name needs two or three text lines (`tall`) and the ones that need three (`long`, a subset of `tall`), both sorted. */
export interface TallNames {
	tall: string[];
	long: string[];
}

/** What `tallCardsFor` reads besides the graph and the geometry. */
export interface TallExtra {
	/** The user's break places (D118). */
	breaks?: BreakList;
	/** The marked person (D41): the card has a border (D153) whose inner edge the D14 sign keeps clear of. */
	marked?: string;
}

/**
 * D29, D37, D81: the people whose name needs two or three text lines on their card (`tall`) and those
 * that need three (`long`; a name that needs more is cut with "…" on the third), in every layout.
 * `geo` is the geometry the cards are drawn with (`drawnGeometry`); the width is the one `buildScene`
 * gives the name: the card's text width, less the D14 sign (`nameRoom`, spec §13.9). The name is measured in the note font's bold name font, the sobriquet in regular weight. With `labels`
 * (M8), the name measured is the card's name text line (`CardLabel.name`, "Roderick II", D58) and the sobriquet follows it (D122).
 * People in `skip` (hidden by folds) are left out. The layout then makes exactly these
 * cards taller. Both lists are sorted, so equal sets compare equal. Pure but for `measure`.
 *
 * The D14 sign comes from the lines (`illegitimateSigns`). Without `signed`, the answer is `undefined` when the sign changes the
 * name slots of someone who could be signed (`couldBeSigned`); the caller then lays the tree out once with no tall cards and asks again
 * with that layout's signs. Most trees need no layout for this.
 */
export function tallCardsFor(
	g: FamilyGraph,
	geo: Geometry,
	fonts: SceneFonts,
	measure: Measure,
	signed?: ReadonlySet<string>,
	labels?: ReadonlyMap<string, CardLabel>,
	skip?: ReadonlySet<string>,
	extra?: TallExtra,
): TallNames | undefined {
	const t1 = cardText(geo);
	const bold = `${fonts.bold} ${t1.nameSize}px ${fonts.text}`;
	const regular = `400 ${t1.nameSize}px ${fonts.text}`;
	const nameMeasure: NameMeasure = (s, sob) => measure(s, sob ? regular : bold);
	// The name room of a card with no marked ring is the same for every such person.
	const rooms = new Map<boolean, NameRoom>();

	const plan = (p: Person, name: string, sob: string | undefined, isSigned: boolean): NameLineCount => {
		const ring = extra?.marked === p.id ? ME_RING_INNER : undefined;
		let room = ring === undefined ? rooms.get(isSigned) : undefined;
		if (!room) {
			room = nameRoom(geo, t1, isSigned, ring);
			if (ring === undefined) rooms.set(isSigned, room);
		}
		return cardNameLines(name, sob, room, nameMeasure, 3, extra?.breaks).length as NameLineCount;
	};

	const tall: string[] = [];
	const long: string[] = [];
	for (const p of g.people) {
		if (skip?.has(p.id)) continue;
		const label = labels?.get(p.id);
		const name = label?.name ?? p.name;
		if (!name) continue;
		const sob = label?.sobriquet ?? p.sobriquet;
		let slots = plan(p, name, sob, false);
		if (couldBeSigned(g, p)) {
			if (signed) {
				if (signed.has(p.id)) slots = plan(p, name, sob, true);
			} else if (plan(p, name, sob, true) !== slots) return undefined;
		}
		if (slots > 1) tall.push(p.id);
		if (slots > 2) long.push(p.id);
	}
	return { tall: tall.sort(), long: long.sort() };
}

/** Same people, same order (both lists from `tallCardsFor`, or none). */
export const sameTall = (a: readonly string[] | undefined, b: readonly string[] | undefined) => sameList(a ?? [], b ?? []);

/**
 * D61 (spec §13.3): the people whose title text line (`titleLines`) takes two text lines, sorted.
 * `geo` is the drawn geometry (`drawnGeometry`); the width is the card's text width, as `buildScene`
 * gives the title. `measure` measures in the small card font (`titleMeasure`). With `showDates`
 * off the reign is left out, so no card needs two text lines for its title. Pure but for `measure`.
 */
export function tallTitlesFor(g: FamilyGraph, labels: ReadonlyMap<string, CardLabel>, geo: Geometry, showDates: boolean, measure: (s: string) => number): string[] {
	if (!showDates) return [];
	const w = cardText(geo).textW;
	const out: string[] = [];
	for (const p of g.people) {
		const label = labels.get(p.id);
		if (label?.reign && titleLines(label.title, label.reign, w, measure).length > 1) out.push(p.id);
	}
	return out.sort();
}

/** The `measure` for `tallTitlesFor`: text width in the small card font (0.85 em, regular) that `buildScene` draws the title with. */
export function titleMeasure(geo: Geometry, fonts: SceneFonts, measure: Measure): (s: string) => number {
	const font = `400 ${cardText(geo).smallSize}px ${fonts.text}`;
	return (s) => measure(s, font);
}
