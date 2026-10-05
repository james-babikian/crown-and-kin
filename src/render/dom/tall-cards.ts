/*
 * Finds which cards need two or three text lines for their name (D29, D37, D81) or two for their title text line with
 * a reign (D61) instead of one truncated line, and which cards lift their arms box and portrait (rule B, D126 4).
 * `tree-view.ts` calls `tallCardsFor` and `tallTitlesFor` before layout, and passes their answers in as
 * `settings.tallCards` and `settings.tallTitles` so the layout makes exactly these cards taller; `sameTall` lets it
 * skip a re-layout when an answer has not changed. 0.2.4: the name is broken with `cardNameLines` and the room that the
 * arms box and the portrait leave (`nameRoom`), the same call that `scene.ts` and `svg-string.ts` make to draw it.
 */

import type { FamilyGraph } from '../../core/derive';
import type { CardLabel } from '../../core/titles';
import type { Person } from '../../core/types';
import { boxesClear, boxesShown, cardBoxes, cardText, nameRoom, nameSlots, relationY, roomAt, smallLineOf, tallExtra, type CardText } from '../../layout/geometry';
import { couldBeSigned } from '../../layout/illegitimate-sign';
import type { Geometry, NameLineCount, NameRoom } from '../../layout/model';
import type { BreakList } from '../break-words';
import { cardNameLines, titleLines, type NameMeasure } from '../name-lines';
import { ME_RING_INNER } from '../styles';
import { dateLine } from '../tree-info';
import { relationFont, type Measure, type SceneFonts } from './scene';

/**
 * D29, D81: the people whose name needs two or three text lines (`tall`) and the ones that need three (`long`, a subset of `tall`), both sorted.
 * `slots` holds the name slots of each tall card (2 or 3): a names-only card with the D14 sign and a one-line name has two (D126 3), and so
 * has the marked person's Compact card with the sign (D129).
 * `lifted` (rule B, D126 4) holds the people whose arms box and portrait move one small text line up so that the relation text fits.
 */
export interface TallNames {
	tall: string[];
	long: string[];
	slots: ReadonlyMap<string, NameLineCount>;
	lifted: ReadonlySet<string>;
}

/** What `tallCardsFor` reads besides the graph and the geometry. */
export interface TallExtra {
	/** The people whose card shows a portrait ("Show portraits on cards" on and the style shows it). */
	portraits?: ReadonlySet<string>;
	/** The user's break places (D118). */
	breaks?: BreakList;
	/** The marked person (D41): the card has a ring that the arms box, the portrait and the D14 sign keep clear of. */
	marked?: string;
	/** The relation text of each card, only when the words show (the setting on and the card whole): rule B reads it. Absent: nothing lifts. */
	relations?: ReadonlyMap<string, { text: string }>;
	/** "Show dates on cards" (spec §13.3): off leaves the reign out of the title text line, which moves the relation text line. Absent = on. */
	showDates?: boolean;
}

/**
 * D29, D37, D81: the people whose name needs two or three text lines on their card (`tall`) and those
 * that need three (`long`; a name that needs more is cut with "…" on the third), in every layout.
 * `geo` is the geometry the cards are drawn with (`drawnGeometry`); the width is the one `buildScene`
 * gives the name: the card's text width, less the D14 sign, and for the final text line the room that the arms box and the portrait
 * leave (`nameRoom`, spec §13.9). The name is measured in the note font's bold name font, the sobriquet in regular weight. With `labels`
 * (M8), the name measured is the card's name text line (`CardLabel.name`, "Roderick II", D58) and the sobriquet follows it (D122).
 * `arms` is the people of `armsCards` (M9). People in `skip` (hidden by folds) are left out. The layout then makes exactly these
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
	arms?: ReadonlySet<string>,
	skip?: ReadonlySet<string>,
	extra?: TallExtra,
): TallNames | undefined {
	const t1 = cardText(geo);
	const bold = `${fonts.bold} ${t1.nameSize}px ${fonts.text}`;
	const regular = `400 ${t1.nameSize}px ${fonts.text}`;
	const nameMeasure: NameMeasure = (s, sob) => measure(s, sob ? regular : bold);
	// The text positions of a card depend on its slot count only; the name room of a card with no marked ring is the same for every such person.
	const texts = new Map<number, CardText>([[1, t1]]);
	const textFor = (slots: number): CardText => {
		let t = texts.get(slots);
		if (!t) texts.set(slots, (t = cardText(geo, slots as NameLineCount)));
		return t;
	};
	const rooms = new Map<string, NameRoom>();

	const plan = (p: Person, name: string, sob: string | undefined, isSigned: boolean): { slots: NameLineCount; lifted: boolean } => {
		const isMe = extra?.marked === p.id;
		const ring = isMe ? ME_RING_INNER : undefined;
		// E4: a marked Normal card with the D14 sign shows no arms and no portrait below 11 px: the boxes and the pushed-down sign would touch.
		const show = boxesShown(geo, isMe, isSigned);
		const wantArms = show && !!arms?.has(p.id);
		const wantPortrait = show && !!extra?.portraits?.has(p.id);
		// D126 3, D129: a names-only card with the sign, and the marked Compact card with the sign, have a second name slot.
		const twoSlot = nameSlots(geo, 1, isSigned, isMe) === 2;
		const t = textFor(twoSlot ? 2 : 1);
		const boxH = geo.cardH + (twoSlot ? tallExtra(geo) : 0);
		const key = `${wantArms ? 1 : 0}${wantPortrait ? 1 : 0}${isSigned ? 1 : 0}`;
		let room = ring === undefined ? rooms.get(key) : undefined;
		if (!room) {
			room = nameRoom(geo, t, isSigned, wantArms || wantPortrait ? cardBoxes(geo, t, boxH, { arms: wantArms, portrait: wantPortrait, ...(ring === undefined ? {} : { ring }) }).boxes : []);
			if (ring === undefined) rooms.set(key, room);
		}
		const lines = cardNameLines(name, sob, room, nameMeasure, 3, extra?.breaks).length as NameLineCount;
		const slots = nameSlots(geo, lines, isSigned, isMe);
		return { slots, lifted: wantLift(p, slots, isSigned, wantArms, wantPortrait, ring, isMe) };
	};

	/** Rule B (D126 4): true when the relation text is wider than the room beside the boxes but fits the text width, and the lifted boxes keep clear (E4). */
	const wantLift = (p: Person, slots: NameLineCount, isSigned: boolean, wantArms: boolean, wantPortrait: boolean, ring: number | undefined, isMe: boolean): boolean => {
		if (geo.namesOnly || !geo.relationLine || !(wantArms || wantPortrait)) return false;
		const text = extra?.relations?.get(p.id)?.text;
		if (!text) return false;
		const t = textFor(slots);
		const label = labels?.get(p.id);
		const title = label ? label.title : p.title;
		const reign = label && extra?.showDates !== false ? label.reign : undefined;
		const y = relationY(t, !!title || !!reign, !!dateLine(p));
		if (y === undefined) return false;
		const boxH = geo.cardH + (slots - 1) * tallExtra(geo);
		const o = { arms: wantArms, portrait: wantPortrait, ...(ring === undefined ? {} : { ring }) };
		const w = measure(text, relationFont(t.smallSize, fonts.text, isMe, fonts.bold));
		if (w > t.textW || w <= roomAt(geo, t, y, t.smallSize, cardBoxes(geo, t, boxH, o).boxes)) return false;
		const up = cardBoxes(geo, t, boxH, { ...o, lift: smallLineOf(geo) });
		// A lift that leaves the text beside a box (a card with no title line has its relation text one line higher) helps nothing.
		if (w > roomAt(geo, t, y, t.smallSize, up.boxes)) return false;
		return boxesClear(geo, t, [...(up.arms ? [up.arms.full] : []), ...(up.portrait ? [up.portrait] : [])], { signed: isSigned, ...(ring === undefined ? {} : { ring }) });
	};

	const tall: string[] = [];
	const long: string[] = [];
	const slotsOf = new Map<string, NameLineCount>();
	const lifted = new Set<string>();
	for (const p of g.people) {
		if (skip?.has(p.id)) continue;
		const label = labels?.get(p.id);
		const name = label?.name ?? p.name;
		if (!name) continue;
		const sob = label?.sobriquet ?? p.sobriquet;
		let result = plan(p, name, sob, false);
		if (couldBeSigned(g, p)) {
			if (signed) {
				if (signed.has(p.id)) result = plan(p, name, sob, true);
			} else {
				const withSign = plan(p, name, sob, true);
				if (withSign.slots !== result.slots || withSign.lifted !== result.lifted) return undefined;
			}
		}
		if (result.slots > 1) {
			tall.push(p.id);
			slotsOf.set(p.id, result.slots);
		}
		if (result.slots > 2) long.push(p.id);
		if (result.lifted) lifted.add(p.id);
	}
	return { tall: tall.sort(), long: long.sort(), slots: slotsOf, lifted };
}

/** Same people, same order (both lists from `tallCardsFor`, or none). */
export const sameTall = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (a ?? []).length === (b ?? []).length && (a ?? []).every((id, i) => id === b![i]);

/** The same people in two `lifted` sets (or none). */
export const sameLifted = (a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined) => (a?.size ?? 0) === (b?.size ?? 0) && [...(a ?? [])].every((id) => b!.has(id));

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
