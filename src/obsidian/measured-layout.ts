/*
 * The layout of a drawn tree with its text measured first (D29, D37, D61) and its picture sets
 * (spec §13.6, §13.7; M9 contract L1–L4). The tree view lays out every tree it draws with this, and
 * "Save as picture" (`save-picture.ts`) lays the saved picture out again with the same steps, so the
 * cards on screen and in the file follow one rule. Pure but for `measure` and the layout cache.
 *
 * The order is fixed and no step reads a later one: the picture sets, the drawn geometry, the tall
 * titles, the tall cards (with the arms cards), then the layout. A picture that still loads, is
 * missing or fails keeps its room, so pictures and their problems never change a layout.
 */

import type { FamilyGraph } from '../core/derive';
import type { CardLabel } from '../core/titles';
import { drawnGeometry } from '../layout/geometry';
import { armsCards, illegitimateSigns, layoutTree, pictureSets } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings } from '../layout/model';
import type { Measure, SceneFonts } from '../render/dom/scene';
import type { BreakList } from '../render/break-words';
import { tallCardsFor, tallTitlesFor, titleMeasure } from '../render/dom/tall-cards';

/** What `measuredLayout` needs beyond the graph, the geometry and the base settings. */
export interface MeasuredOptions {
	fonts: SceneFonts;
	measure: Measure;
	/** Focus mode: people with relatives who are not shown. Not read since 0.2.4 (the `+` badge sits on the corner and no longer narrows a name); kept so callers compile. */
	hidden?: ReadonlyMap<string, number>;
	/** M8: the card labels of the drawn graph. */
	labels?: ReadonlyMap<string, CardLabel>;
	/** "Show dates on cards": off leaves the reign out of the title text line (D61). */
	showDates: boolean;
	/** "Show portraits on cards" (O10). */
	showPortraits: boolean;
	/**
	 * M10 (F1): the people that folds hide. They are left out of the tall-card and tall-title answers, so hidden people never change
	 * the settings or the cache key. Not the same as `hidden` (the focus badge counts). Absent = the `foldHidden` of `base`.
	 */
	foldHidden?: ReadonlySet<string>;
	/** Whether the cards show the arms box (default true). A names-only style that shows portraits only sets it false (contract 6.1). */
	showArms?: boolean;
	/** The user's break places for names (D118). */
	breaks?: BreakList;
	/** The marked person (D41): the arms box, the portrait and the D14 sign keep clear of its ring. */
	marked?: string;
	/** The relation text of each card, only when the words show: rule B reads it (D126 4). Absent: nothing lifts. */
	relations?: ReadonlyMap<string, { text: string }>;
}

/** What `measuredLayout` returns: the layout, its settings, and the people whose boxes lift (rule B, `TallNames.lifted`). */
export interface MeasuredResult {
	laid: LaidOut;
	settings: LayoutSettings;
	/** Set on every path, also when no card is tall: a lift needs no taller card. */
	lifted: ReadonlySet<string>;
}

/**
 * Lays `g` out (L4): 1. the picture sets from the graph and the setting; 2. the drawn geometry;
 * 3. the title text lines that need two text lines; 4. the names that need two or three text lines, beside the
 * arms where a card has arms; 5. the layout. Only when the D14 sign changes a name's text line count does the
 * layout run twice (the sign comes from the lines of a layout with no tall cards). Pictures and their
 * loading never feed back into these steps. M10 (F1): the fold settings of `base` (`foldHidden`, `foldedFamilies`,
 * `foldControls`) go into the layout as they are (`o.foldHidden` fills `foldHidden` when `base` has none), and the
 * people that folds hide are skipped in steps 3 and 4. Step 4 also decides rule B, which boxes lift one text line (`lifted`).
 */
export function measuredLayout(g: FamilyGraph, geo: Geometry, base: LayoutSettings, o: MeasuredOptions): MeasuredResult {
	const picked = pictureSets(g, o.showPortraits);
	const sets = o.showArms === false ? { ...picked, arms: [] } : picked;
	const plain: LayoutSettings = { ...base };
	delete plain.tallCards;
	delete plain.longNames;
	delete plain.tallTitles;
	delete plain.arms;
	delete plain.portraits;
	delete plain.foldHidden;
	delete plain.foldedFamilies;
	delete plain.foldControls;
	// M10: empty lists stay out, so a tree with no folds has the M9 cache key.
	const skip = o.foldHidden ?? new Set(base.foldHidden);
	const hiddenList = [...new Set(base.foldHidden?.length ? base.foldHidden : (o.foldHidden ?? []))].sort();
	if (hiddenList.length) plain.foldHidden = hiddenList;
	if (base.foldedFamilies?.length) plain.foldedFamilies = [...new Set(base.foldedFamilies)].sort();
	if (base.foldControls) plain.foldControls = true;
	// L1: empty lists stay out, so a tree with no pictures has the M8 cache key.
	if (sets.arms.length) plain.arms = sets.arms;
	if (sets.portraits.length) plain.portraits = sets.portraits;
	const drawn = drawnGeometry(geo, plain);
	const arms = sets.arms.length ? armsCards(g, sets.arms) : undefined;
	const titles = o.labels && !drawn.namesOnly ? tallTitlesFor(g, o.labels, drawn, o.showDates, titleMeasure(drawn, o.fonts, o.measure)).filter((id) => !skip.has(id)) : [];
	const titled: LayoutSettings = titles.length ? { ...plain, tallTitles: titles } : plain;
	const skipping = skip.size ? skip : undefined;
	const extra = {
		portraits: new Set(sets.portraits),
		showDates: o.showDates,
		...(o.breaks ? { breaks: o.breaks } : {}),
		...(o.marked !== undefined ? { marked: o.marked } : {}),
		...(o.relations ? { relations: o.relations } : {}),
	};
	let tall = tallCardsFor(g, drawn, o.fonts, o.measure, undefined, o.labels, arms, skipping, extra);
	if (tall === undefined) {
		const first = layoutTree(g, geo, titled, o.fonts.text);
		tall = tallCardsFor(g, drawn, o.fonts, o.measure, illegitimateSigns(g, first.edges), o.labels, arms, skipping, extra) ?? { tall: [], long: [], slots: new Map(), lifted: new Set<string>() };
		if (!tall.tall.length) return { laid: first, settings: titled, lifted: tall.lifted };
	}
	const settings: LayoutSettings = tall.tall.length ? { ...titled, tallCards: tall.tall, ...(tall.long.length ? { longNames: tall.long } : {}) } : titled;
	return { laid: layoutTree(g, geo, settings, o.fonts.text), settings, lifted: tall.lifted };
}
