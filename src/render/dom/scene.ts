/*
 * Builds the tree's SVG content with Obsidian's createSvg. Colours and fonts come only from the
 * dynasty- classes in styles.css; the one value written per card is --dynasty-house-color.
 * Each card carries all three levels of detail (spec §5.4); a class on the <svg> picks one, so a
 * level change is a class change, never a rebuild. The relation text, the marked card (D40, D41)
 * and the relation finder's line (D47, from `line-highlight.ts`) are classes too. With card
 * labels (`SceneOptions.labels`), the name and title text lines come from them (spec §13.3, §13.5).
 * A card whose box has `arms` or `portrait` gets empty picture slots (`Scene.pictures`, filled
 * by the tree view through `dom/pictures.ts`); its name makes room for the arms, and its small text
 * lines beside the portrait are narrower (spec §13.6, §13.7, D76–D78). The legend gains the houses.
 * With `SceneOptions.folds`, the fold controls of the layout (`dom/folds.ts`): each in the Tab order after the
 * card of the later of its parents, its tap area in the hit layer below the cards.
 * Spec §13.15 rule 1: with `SceneOptions.lazyCards` (only the tree view sets it; the headless
 * `renderSvg`, the tests, the spike and Save as a picture stay eager and complete) each card, far-couple
 * tag and focus badge is a shell plus its content:
 * - S1 Shell and content. A card shell is the `<g class="dynasty-card ...">` with `tabindex`, `role`,
 *   `aria-label`, `data-person`, every class and the `--dynasty-house-color` style, plus its
 *   `rect.dynasty-card-bg` (the size and hit area). Its content is every other child (strip,
 *   full, compact levels). The focus ring is not part of that content; only `fillPerson` and `fillAll`
 *   make it, because it shows only for the keyboard focus and the highlight and both fill the person first.
 *   A tag shell has its attributes and hit rect, its content the three pill groups.
 *   A badge shell has its attributes and hit rect, its content the circle and the plus path. Fold controls
 *   keep their own rule (`FoldRef.fill`). A shell never moves, so the Tab order, the names and the roles
 *   exist from the build on.
 * - S2 Built detached, attached later. The content is created in a detached holder, `fitted`, the
 *   `fitters`, `links` and `PictureSlot`s are registered as in an eager scene, and the holder's children
 *   move into the shell at fill. After a fill the shell has exactly the eager children in the eager
 *   order, so an eager and a filled lazy scene serialise byte for byte the same. The text of a card and of a far-couple tag is cut
 *   to fit (the `fitters`) at fill, not at build, because nobody sees it before; a refit runs the fits that have run.
 * - S3 Near the view. `boxNearView` (`view-math.ts`) decides which items a fill attaches.
 * - Spec §13.15 rule 4: lines and partnership signs are delayed too. A lazy scene does not make
 *   their elements at build time; it keeps each one's box (`pathBox`) and builds the element at fill, into its
 *   layer at its place (`orderedLayer`), so the layer after `fillAll` is the eager layer byte for byte. They have
 *   no tap area, so a missing one never costs a tap. `SceneFill.pendingLines` counts them; they are not in
 *   `pending` and not in the numbers the fill calls return.
 * - S4 `Scene.fill` (`SceneFill`) is the fill API; an eager scene has one that does nothing. The
 *   tree view decides when to call it (see `obsidian/tree-view.ts`). `Scene.cards`, `tags`, `badges`,
 *   `links`, `pictures` and `folds` contain every item from the build on.
 * A card has one of two forms (`Geometry.form`). The Roundel (a tree from top to bottom) has its text
 * centred on an axis, a round medallion and the arms on its top edge (a Full and a Compact slot for each picture), a footer plate for
 * the relation word, and a tap area over the part that sticks out above the card. The text card (sideways) has its text at the left, no
 * pictures at all (`Scene.pictures` stays empty, so nothing is fetched) and the same plate. D179: the classic card and the card size are gone. The "You" tab belongs to the card whose id
 * is `TreeLayout.youTab`, whatever the form; nothing else decides it. The scene writes no `data-relation` and draws no tooltip:
 * the tooltip belongs to the tree view.
 * `buildScene` only joins the layers. Each layer has its own file and all share one context (`scene-ctx.ts`): lines and markers
 * (`scene-lines.ts`), cards (`scene-cards.ts`, with `scene-card-text.ts` for their content), tags (`scene-tags.ts`), the corner radius
 * (`scene-corner.ts`) and the pure parts (`scene-parts.ts`).
 */

import type { FamilyGraph } from '../../core/derive';
import type { LaidOut } from '../../layout/model';
import { TAG_FONT_EM } from '../styles';
import { ME_WORD } from '../view-text';
import { buildRings } from './heir-ring';
import { buildCards, makeSetDetail, type CardsOut } from './scene-cards';
import { cardKit } from './scene-card-text';
import { cornerTracker } from './scene-corner';
import { makeCtx } from './scene-ctx';
import { eagerFill, lazyFill, type LateCard } from './scene-fill';
import { buildLines } from './scene-lines';
import { buildTags } from './scene-tags';
import type { Scene, SceneOptions } from './scene-types';

// The word moved to view-text.ts (all plugin texts live there); other modules still read it from here.
export { ME_WORD };
// The pure parts moved to scene-parts.ts and the corner radius to scene-corner.ts; they are read from here as before.
export { BADGE_RADIUS_EM, COMPACT_NAME_MIN_EM, COMPACT_STEPS, TAG_COMPACT_FONT_EM, TAG_SIGN_FONT_EM, compactNameStep, discPath, relationFont, signAt } from './scene-parts';
export { readCornerRadius, resetLearnedCornerRadius } from './scene-corner';

/** The DOM event that makes the tree view attach all delayed content at once (for the harness and the tests). */
export const FILL_ALL_EVENT = 'dynasty-fill-all';
/** The root attribute with `SceneFill.pending` ('0' on an empty root; the harness helper counts a missing attribute as 0). */
export const CARDS_PENDING_ATTR = 'data-dynasty-cards-pending';
/** The root attribute with `SceneFill.pendingLines` (lines and partnership signs that are not built yet). */
export const LINES_PENDING_ATTR = 'data-dynasty-lines-pending';

export type { SceneFill, SceneWords } from './scene-fill';
export type { CardLink, Scene, SceneFolds, SceneOptions, SceneRelations } from './scene-types';

/** Tag text size in em of the note font (D353 2 A; one constant for the live tree and the headless renderer, `render/styles.ts`). */
export { TAG_FONT_EM };

/** The class name on the `<svg>` that picks one level of detail (spec §5.4). */
export const lodClass = (lod: string) => `dynasty-lod-${lod}`;

/** Draws the whole tree's SVG content (lines, markers, cards, badges, tags) into `parent`. */
export function buildScene(parent: SVGGElement, g: FamilyGraph, laid: LaidOut, opts: SceneOptions): Scene {
	const ctx = makeCtx(parent, g, laid, opts);
	const corner = cornerTracker(opts.cornerRadius);
	buildLines(ctx);

	// The tags' enlarged tap areas lie below the cards: at a low zoom a 44 px area can cover a whole
	// small card, and a press on a card must open its sheet (spec §7.2). The visible pills stay on top.
	// The badge squares lie under all of these, so a tag or a fold control wins where it meets one.
	const badgeHitsEl = parent.createSvg('g', { cls: 'dynasty-badge-hits' });
	const hitsEl = parent.createSvg('g', { cls: 'dynasty-tag-hits' });
	// The tap areas of the open fold buttons share one group, so the Overview level hides them with one rule. It moves to the end of the layer after the tags are made (below).
	const openFoldHitsEl = hitsEl.createSvg('g', { cls: 'dynasty-fold-hits-open' });

	const out: CardsOut = { cards: new Map(), badges: [], folds: [], links: new Map(), pictures: [], ringSpecs: [], rings: new Map(), late: new Map<string, LateCard>(), bodies: { list: [], detail: true } };
	buildCards(ctx, cardKit(ctx, out), corner, out, { badgeHitsEl, hitsEl, openFoldHitsEl });
	const tags = buildTags(ctx, hitsEl);

	// A tap area made later (a lazy button) lies after the tag areas; the group takes that place for every button, as before.
	hitsEl.appendChild(openFoldHitsEl);

	const { cards, rings, late } = out;
	const filler = ctx.lazy
		? lazyFill({ delayed: ctx.delayed, byPerson: ctx.byPerson, lateLines: ctx.lateLines, late, persons: ctx.layout.persons, has: (id) => cards.has(id), rings, ask: (ids) => opts.relations?.getMany?.(ids), most: opts.lateWords, attachItem: ctx.attachItem, putLine: ctx.putLine, cardsLeft: () => ctx.cardsLeft })
		: { ...eagerFill((id) => cards.has(id)), reset: () => undefined };

	return { cards, tags, badges: out.badges, links: out.links, pictures: out.pictures, folds: out.folds, rings: buildRings(parent, out.ringSpecs, ctx.layout.persons, out.folds.map((c) => c.mark)), refit: () => ctx.fitters.forEach((run) => run()),
		setCornerRadius: corner.set,
		syncCornerRadius: corner.sync,
		setDetail: makeSetDetail(ctx, out.bodies, filler.reset),
		showLevel: ctx.showLevel,
		fill: filler.fill,
		words: filler.words,
	};
}

export { buildLegend } from './legend-dom';
