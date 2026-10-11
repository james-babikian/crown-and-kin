/*
 * `TreeView` is the plugin's core Obsidian class: one instance draws and runs one `dynasty` code
 * block, as an embed in a note or inside the full-screen modal. `main.ts` creates an embed's
 * `TreeView` from the Markdown code block processor; `full-screen.ts` creates a second one, sharing
 * the same block handle and view state, when the user expands a tree. A `TreeView` parses the
 * block's text (`core/parse`), derives the family graph (`core/derive`), lays it out
 * (`layout/index`), and draws it as SVG (`render/dom/scene`), then wires pan and zoom
 * (`render/dom/pan-zoom`), the toolbar, sheets and popovers on top of it. It never lets an error
 * escape into Obsidian or blank the note (spec §8): every entry point runs through `guard`.
 *
 * Reading guide, in the order the file lays them out:
 * - Host and view-place types (`TreeHost`, `FullSource`, `FullHost`, `ViewPlace`) that connect a
 *   `TreeView` to the plugin and to the full-screen modal.
 * - Small free functions that read fonts and the safe-area inset from probe elements, and hash a
 *   block's text for its key.
 * - The `TreeView` class:
 *   - Fields: everything remembered between renders (the drawn graph, the view, focus, layout cache).
 *   - Construction and block resolution: finding and keeping the block's `Handle` (spec §6.1),
 *     across renames, edits from elsewhere and Live Preview's late-resolved blocks.
 *   - Fonts and theme: reading the note's resolved fonts and theme colours (spec §5.8, §7.7).
 *   - `render`: the main render pipeline, from parsed text to a drawn scene.
 *   - Focus mode: choosing and applying the session, pin or phone focus (spec §5.6), and the static
 *     `focusState`/`redrawState`/`dropOwnFocus` helpers that other views and sheets use to redraw
 *     every `TreeView` that shares one block's state.
 *   - The phone list (D144): `renderList`, its bar, a tap on a name, Back and Find (`listGo`), the saved person's flash.
 *   - Sizing and layout: the height of a tree in a note, sideways re-layout (D24).
 *   - First views, pan/zoom wiring, card and tag presses, the D28 hints.
 *   - The toolbar, its buttons, and the legend, problems and More popovers.
 *   - The relation finder (spec §13.2): its flow, its result bar, the small tree of the line.
 *   - Titles (spec §13.3–§13.5): the card labels of the drawn graph go into the scene and the tall
 *     cards; the More item "Titles" opens the Titles window (`titles-window.ts`).
 * - Small free functions used only by the class, at the end of the file.
 *
 * Card content on demand (M11, spec §13.15; the scene builds shells, see `render/dom/scene.ts`):
 * - S5 When the tree fills. `fillNear` runs at the first draw, at each settle and pinch fill, during a
 *   wheel or trackpad zoom (through `onFill`, only when the view leaves the last filled rectangle) and
 *   in a new scene. The cases below use `fillPerson` and the idle chain uses `fillChunk`. A drag pan
 *   never fills; it ends at its settle.
 *   a. First draw: `PanZoomOptions.onFirstDraw` runs once, right after the first write of the scene
 *      transform: `fillNear`, then `showTree`.
 *   b. Settle and pinch fill: `settled` and `onFill` call `fillNear` next to `fillFolds` (folds first).
 *   c. Before focus: a capture `focus` listener on the HTML wrapper fills the card, tag or badge that
 *      gets the focus, before `revealPerson`. It is `focus`, not `focusin`, and it is not on the SVG
 *      (Chromium makes an SVG element with a focus listener a Tab stop).
 *   d. Before a highlight, e. before a reveal, f. before the sheet opens by keyboard or code: fill the
 *      person first.
 *   (0.2.1, rule 4: the lines and partnership signs follow the same calls; `fillNear`, `fillPerson`, `fillChunk` and
 *   `fillAll` build them too, and `pendingLines` keeps the idle chain running until they are built.)
 *   g. Idle: after the first view the rest is attached in idle chunks (`later`, at most
 *      `IDLE_CARDS_PER_CHUNK` cards, stop at `IDLE_STOP_MS`), nearest to the view first, one chain for
 *      each scene. A chunk that finds the view busy asks again; it never drops the chain. Folds go
 *      first and the two kinds never share an idle callback. The static phone preview starts no chain.
 *   i. A new scene (`redraw`) fills near in the same task, stops the old chain and starts its own.
 * - S6 The live pictures work on slots of attached cards; the fold controls keep their M10 rule.
 * - S7 Hide until the first view. The `.dynasty-canvas` wrapper of the svg is `hidden` until the first
 *   transform is written (the browser then lays out the tree once). `showTree()` is idempotent and never
 *   throws. It runs after `fillNear` in `firstDraw`, in the `guard` catch, in a `finally` of `resized`, and
 *   before any code that reads layout (`highlight`). The error box and the empty tree are built shown.
 * - S8 One `TreeHost.parseCache` serves the read paths (`parse`); see `core/parse-cache.ts`.
 * - S10 Accessibility does not change: every shell keeps its Tab stop, name, role and order.
 * - The root attributes `data-dynasty-cards-pending` (`CARDS_PENDING_ATTR`; the lint rule wants a plain string here) and `data-dynasty-lines-pending` (`LINES_PENDING_ATTR`, 0.2.1) and the event `FILL_ALL_EVENT` (both in `render/dom/scene.ts`)
 *   are the harness hooks: the harness fills everything, then reads card content.
 */

import { Keymap, MarkdownRenderChild, Notice, getLinkpath, setIcon, type App, type HoverParent, type HoverPopover, type MarkdownPostProcessorContext, type MarkdownSectionInformation, type TFile } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import { hardErrorText, issueText } from '../core/messages';
import { findBlocks } from '../core/block-locate';
import { focusGenerationsFor, focusSubgraph } from '../core/focus-subgraph';
import { foldHidden, personFolds, pruneFolds, unfoldFor, type FoldControl, type FoldKey } from '../core/folds';
import type { ParseCache } from '../core/parse-cache';
import { parseDynasty } from '../core/parse';
import { portraitCropOf } from '../core/portrait-crop';
import { pictureIssue, type PictureOwner, type PictureProblem } from '../core/pictures';
import { findRelation, lineSubgraph, type RelationOptions } from '../core/relations';
import type { FinderResult, RelationLine } from '../core/relations';
import { cardLabels, needsLabels, type CardLabel } from '../core/titles';
import type { ParseResult, Person, Tree } from '../core/types';
import { FOLD_EM } from '../layout/fold-spots';
import { cardForm, geometryFor } from '../layout/geometry';
import { DEFAULT_FAR_RULE, NEVER_FAR_RULE } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings, Orientation, PersonBox, Rect } from '../layout/model';
import { fontsChanged, parsePx, usesFamily, type FontState } from '../render/fonts';
import { clearMeasureCache, measureText, usableFamily } from '../render/dom/measure';
import { calloutBackdrop } from '../render/dom/theme-read';
import { wireCardTips, type CardTips } from '../render/dom/card-tip';
import { PanZoom, visibleRect } from '../render/dom/pan-zoom';
import type { PictureSlot } from '../render/dom/pictures';
import { FILL_ALL_EVENT, buildLegend, buildScene, discPath, lodClass, type CardLink, type Scene, type SceneOptions } from '../render/dom/scene';
import { sameTall } from '../render/dom/tall-cards';
import { parseBreakList } from '../render/break-words';
import { buildPhoneList, failListPicture, restoreListPictures, setListEditable, showListPicture, type ListPictureSlots } from '../render/dom/phone-list-dom';
import { buildCallout, fitLegend, Popover, type PopoverOptions } from '../render/dom/widgets';
import { SIGN_CARD_LABEL, cardLabel, familyOf, finderSentence, linkTarget, startPerson, stepSentences, type RenderTiming } from '../render/tree-info';
import { ADD_UI, BLOCK_UI, FINDER_UI, FOCUS_UI, FOLD_UI, FULL_UI, HINT_UI, PHONE_LIST_UI, PROBLEMS_HINT, SAVE_UI, SHEET, SUCCESSION_UI, TITLES_UI, UI, WRITE_TEXT, problemsLabel, problemsTitle } from '../render/ui-text';
import { TOOLBAR_UI } from '../render/view-text';
import {
	centreOn,
	isPan,
	chooseLod,
	bandShift,
	clearBand,
	defaultView,
	embedHeight,
	enlargeHit,
	FIT_MARGIN,
	fitView,
	foldHit,
	keepSpot,
	resizeView,
	treeBounds,
	type Lod,
	type Size,
	type View,
} from '../render/view-math';
import { sameBody as sameBodyAfterTidy } from '../core/block-match';
import type { Handle, HandleRegistry } from './block-handle';
import { lastHeight, rememberHeight } from './block-height';
import { carryState, focusKey, newBlockState, type BlockState, type FinderState } from './block-state';
import { EditSheet, type SheetFolds } from './edit-sheet';
import { PHONE_FOCUS_MIN_PEOPLE, badgeTap, chooseFocus, clearToolbar, finderFirstView, finderOrientation, focusView, isPhoneWindow, keepTopCardWhole, orientationFor, outsideBox, parentsAbove, sidewaysView, tagHitBelow } from './focus-mode';
import { cutBack, planFolds, withFolds, type FoldPlan } from './fold-view';
import type { FoldRef } from '../render/dom/folds';
import { FullScreenModal } from './full-screen';
import { HousesWindow } from './houses-window';
import { createLivePictures, zoomStep, type LivePictures } from './live-pictures';
import { measuredLayout, type MeasuredResult } from './measured-layout';
import { linkWord, listData, listStart, listWord, popTrail, pushTrail } from './phone-list';
import { pickPerson, type PickerContext } from './person-picker';
import type { CopyBox, PictureCopy, PictureStore, ResolvedPicture } from './picture-store';
import { pluginModalOpen } from './plugin-modals';
import { relationsFor, validMe } from './relation-cache';
import { SaveWindow, savePicture, type SaveSource } from './save-picture';
import { DEFAULT_SETTINGS, reducedMotion, type DynastySettings } from './settings';
import { PHONE_MIN_SCALE, cardPosition, lineWords, linePeople, successionDrawn, successionFirstView, type SuccessionDrawn } from './succession-view';
import { TitlesWindow } from './titles-window';

/** D144: after a move the keyboard focus (and so a screen reader) goes to the heading of the centre section of the list. */
const LIST_FOCUS = '.dynasty-list-section[data-section="person"] .dynasty-list-head';
/**
 * D144, D209: the small picture copies of a list row, in CSS px (about twice the size on the screen, for a sharp copy): the arms of the large row are
 * 35 px high under a portrait and 56 px high alone; the portrait is 36 px in a row and 56 px in the large row.
 */
const LIST_ARMS_BOX: CopyBox = { w: 96, h: 120, fit: 'meet' };
const LIST_PORTRAIT_BOX: CopyBox = { w: 96, h: 96, fit: 'portrait' };
const HERO_PORTRAIT_BOX: CopyBox = { w: 128, h: 128, fit: 'portrait' };

/** The most cards attached in one idle chunk. */
const IDLE_CARDS_PER_CHUNK = 25;
/** An idle chunk stops when the idle callback has less than this many ms left. */
const IDLE_STOP_MS = 4;

/** The same text is the usual answer, and it needs no copy of the whole body (`sameBody` tidies both texts first). */
const sameBody = (a: string, b: string): boolean => a === b || sameBodyAfterTidy(a, b);

/** What a tree view needs from the plugin. */
export interface TreeHost {
	app: App;
	/** One handle per block (spec §6.1). A block's view state lives on its handle. */
	handles: HandleRegistry;
	/** View state of read-only blocks, which have no handle, keyed by note path and text. */
	looseStates: Map<string, BlockState>;
	views: Set<TreeView>;
	recordTiming(t: RenderTiming): void;
	/** Spec §9: read on every render; `onSettingsChange` follows a change. */
	readonly settings: DynastySettings;
	/** M9 contract O3: the plugin's one picture store (absent in hosts without pictures, for example the unit fakes). */
	readonly pictures?: PictureStore;
	/** M11: the parse that the read paths share; a host without one (a unit fake) parses each time. */
	readonly parseCache?: ParseCache;
	/**
	 * 0.2.8 contract B.5 (D183): set only by the plugin. On a cold start a tree draws a box of its last known height until `ready(el)` (the
	 * plugin styles and the stored settings are in) and until the place of its block is known, for at most `START_LIMIT_MS`. `cache()` is false until the
	 * metadata cache has finished once (or the limit has passed), so no warning about a missing picture counts before it is true.
	 * Absent in a host that has no cold start (the unit fakes): the tree draws at once.
	 */
	readonly startedUp?: { ready(el: HTMLElement): boolean; cache(): boolean };
}

/** D183: the longest a tree waits for the styles, the settings and its block place on a cold start, in ms. */
export const START_LIMIT_MS = 2000;
/**
 * The hard cap of the wait for the plugin styles, in ms. Obsidian reads styles.css after `onload`, and on a cold iPhone that can take longer than
 * `START_LIMIT_MS`; a tree drawn before the styles has no layout at all. The settings and the block place keep the shorter limit.
 */
export const STYLES_LIMIT_MS = 8000;
/** A block whose section Obsidian does not tell yet is asked again for this long (ms) before it is called read only. */
const SECTION_LIMIT_MS = 5000;
/** The wait between two asks for the section of a block, in ms. */
const SECTION_STEP_MS = 250;
/** The wait between two looks at the start conditions, in ms. */
const START_STEP_MS = 50;
/** The least time between two asks for the section during the start wait. */
const ASK_GAP_MS = 100;
/** The height of the box that stands in for a tree on a phone, when no height of the block is known, in px. */
const PHONE_PLACEHOLDER_PX = 260;

/** What a full-screen view takes over from the embedded view that opened it (spec §7.1). */
export interface FullSource {
	key: string;
	sourcePath: string;
	source: string;
	handle: Handle | null;
	peeked: Handle | null;
	readOnly: boolean;
	/** After its first view, the keyboard focus goes here (the result's sentence when a static preview opened the view with it). */
	focusDue?: string | null;
}

/** The modal around a full-screen view. */
export interface FullHost {
	/** Closes the full-screen view; with a text, also shows it as a Notice. */
	close(notice: string | null): void;
	/** Closes the full-screen view, then runs `then` (opens a note) when the note under it is back in place. */
	leave(then: () => void): void;
	/** A person to centre on and highlight when the view opens (a far-couple tag on a touch embed). */
	target: string | null;
	/**
	 * D21: this view's own focus (a badge tap in a static embed opened it), until the user chooses a
	 * focus in the view; `id: null` is all people, for this view only (a saved person it did not draw).
	 */
	focus: { id: string | null } | null;
}

/** Where a view is: an embed in a note (with Obsidian's context), or the full-screen view. */
export type ViewPlace = { kind: 'embed'; ctx: MarkdownPostProcessorContext } | { kind: 'full'; from: FullSource; host: FullHost };

/** What stays in place when the folds change (F10): the control that was tapped ('spot'), or a person's card (the sheet actions). */
type FoldAnchor = { kind: 'spot'; key: FoldKey } | { kind: 'person'; id: string };

/** Where the view was, relative to the card nearest its centre, in em: survives a font change. */
interface Anchor {
	person: string;
	dx: number;
	dy: number;
	scale: number;
	byUser: boolean;
	/** No card was under the toolbar band before the change. */
	bandClear: boolean;
}

/** The relation finder's result as one view draws it (spec §13.2). */
interface FinderDrawn {
	state: FinderState;
	result: FinderResult;
	/** The line of the relation that shows, or of the chain; null when the two people have no relation. */
	line: RelationLine | null;
}

/** One arms or portrait link of the whole tree, and whose it is (M9 contract O2). */
interface PictureUse {
	owner: PictureOwner;
	link: string;
}

/**
 * The pictures of the whole tree as this view resolved them (spec §13.0 item 3 "Problems"; O1, O2):
 * each link once, the warnings found at render, and the ones the background check of the files found.
 */
interface PictureInfo {
	/** Every valid house with arms and every person with a portrait, in tree order; also with "Show portraits on cards" off. */
	uses: PictureUse[];
	/** Each written link, resolved once. */
	resolved: Map<string, ResolvedPicture>;
	/** The warnings of the file check (too large, not a picture), by use index. */
	found: Map<number, CodedIssue>;
}

/** Numbers the result bars, for their `aria-labelledby`. */
let resultIds = 0;

/** Runs `fn` in the next idle time (a timer where the browser has no idle callback, as Safari); the fold and card chains share it. */
function later(fn: (idle: { timeRemaining(): number }) => void): void {
	const ric = (globalThis as unknown as { requestIdleCallback?: (f: typeof fn, o: { timeout: number }) => number }).requestIdleCallback;
	if (ric) ric.call(globalThis, fn, { timeout: 1500 });
	else setTimeout(() => fn({ timeRemaining: () => 8 }), 300);
}

/** The page-preview source id for card names: `main.ts` registers it, and the tree view sends it with each hover-link event. */
export const HOVER_SOURCE = 'dynasty-tree';
const HIGHLIGHT_MS = 2000;
/** The person a save just changed in a phone list and the time the row flash ends; kept per block, so a second build keeps the flash. */
const savedFlashes = new WeakMap<BlockState, { id: string; until: number }>();
/** After css-change, the theme colours are read once more this much later (a theme's sheet can still load). */
export const THEME_RECHECK_MS = 400;
const RESOLVE_RETRIES_MS = [250, 1000];
// Events that must not reach the editor: in Live Preview they would move the cursor into the
// block and show its source (spec §7.2).
const STOPPED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend'];

/**
 * Reads the fonts with a probe element styled `font-size: var(--font-text-size)`: its computed
 * size is always in px, whatever unit the theme or a snippet uses (rem, calc(), ...). `el` is the
 * block's container, the parent of `.dynasty-root`, so an em value resolves once, exactly as it
 * does for the root; when the block is not in the document yet, the body is used.
 */
function readFonts(el: HTMLElement): FontState {
	const host = el.isConnected ? el : (el.doc ?? document).body;
	const probe = host.createDiv({ cls: 'dynasty-font-probe' });
	try {
		return fontsOf(probe);
	} finally {
		probe.remove();
	}
}

/** The `--dynasty-callout-bg` value set on each toolbar and hint (so an equal value is not set again). */
const calloutBgSet = new WeakMap<HTMLElement, string | null>();

function fontsOf(probe: HTMLElement): FontState {
	const cs = getComputedStyle(probe);
	const v = (name: string) => cs.getPropertyValue(name).trim();
	return {
		px: parsePx(cs.fontSize) ?? 16,
		text: usableFamily(cs.fontFamily || 'sans-serif'),
		ui: usableFamily(v('--font-interface') || 'sans-serif'),
		bold: /^\d{3}$/.test(v('--bold-weight')) ? v('--bold-weight') : '600',
	};
}

/** `env(safe-area-inset-top)` in px, read from the view's probe element (spec §7.5). */
function safeTop(probe: HTMLElement | null): number {
	return probe?.isConnected ? (parsePx(getComputedStyle(probe).paddingTop) ?? 0) : 0;
}

/** Stable, short text hash for a block key when Obsidian cannot say where the block is. */
function shortHash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

/** Options of `TreeView.redrawState`. */
interface RedrawOptions {
	target?: string[] | null;
	origin?: TreeView | null;
	except?: TreeView | null;
	keepOwn?: boolean;
}

/** The order of the parts of each toolbar, by class (0.2.8, G.13); `orderBar` sorts the bar by it. */
const BAR_ORDER = {
	desktop: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-find', 'dynasty-focus', 'dynasty-fit', 'dynasty-sep-a', 'dynasty-houses-button', 'dynasty-titles-button', 'dynasty-sep-b', 'dynasty-more', 'dynasty-grow', 'dynasty-warning-badge', 'dynasty-expand', 'dynasty-close'],
	phone: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-houses-button', 'dynasty-focus', 'dynasty-find', 'dynasty-more', 'dynasty-warning-badge', 'dynasty-close'],
	list: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-show-text', 'dynasty-grow', 'dynasty-list-find', 'dynasty-list-back', 'dynasty-warning-badge', 'dynasty-expand'],
} as const;

/** The least size of the text of an Overview fold sign on the screen, in px, and the most it grows. */
const MIN_SIGN_TEXT_PX = 11;
const MAX_SIGN_BOOST = 8;

/**
 * One rendered `dynasty` block. It never throws into Obsidian: every entry point catches and,
 * at worst, shows the internal-error box (spec §8).
 */
export class TreeView extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	private key: string;
	private sourcePath: string;
	private readonly coarse: boolean;
	/** Fonts as read, not clamped: compared with `fontsChanged` only. */
	private fonts: FontState | null = null;
	/** A view to restore after the next re-render (font change, late web font). */
	private carry: Anchor | null = null;
	/** Height of the toolbar band at the top of the viewport, kept free in plugin-chosen views. */
	private insetTop = 0;
	/** The last value of `--dynasty-bars` set on the box, so that an unchanged height sets nothing. */
	private barsPx = '';
	/** The same at the bottom: the full-screen toolbar on a phone (spec §7.5). */
	private insetBottom = 0;
	/** Set for the full-screen view (spec §7.1); null for an embed. */
	private readonly full: FullHost | null;
	/** The drawn graph: the whole tree, or the focus family in focus mode (spec §5.6). */
	private g: FamilyGraph | null = null;
	/** The whole tree's graph: its problems, Find and the Focus picker (edits read the block themselves). */
	private whole: FamilyGraph | null = null;
	/** The focus person drawn, or null for the whole tree. */
	private focusId: string | null = null;
	/** `focusKey` of the last render, with its orientation (the key of saved views); null before the first. */
	private drawnKey: string | null = null;
	/** The same without the orientation: a turn of the phone keeps the family, and so the view's centre. */
	private familyKey: string | null = null;
	/** How the drawn tree is laid out (D24): `sideways` on a phone in portrait. */
	private orientation: Orientation = 'down';
	/** A turn of the phone (D24) waits for the window to report its new size (iOS reports it late). */
	private turnTimer = 0;
	/** What the last render laid out and drew with, so the note preview can lay out again in place. */
	private lastLayout: { geo: Geometry; settings: LayoutSettings; sceneEl: SVGGElement; opts: SceneOptions } | null = null;
	/** A person to centre and highlight in the next first view (Find of a person outside the focus family). */
	private pendingTarget: string[] | null = null;
	/** The toolbar at the top of the viewport, in viewport px (null when it is at the bottom). */
	private barBox: { left: number; right: number; top: number; bottom: number } | null = null;
	/**
	 * The next sized resize shows the first view: the tree was laid out again in place (D29 names after a font
	 * change), perhaps while its box had no height yet.
	 */
	private firstDue = false;
	/** D28: the children of the first view's person, and whether the hint still counts them (until the user moves the view). */
	private hintKids: PersonBox[] = [];
	private hintOn = false;
	/** The session focus changed while a full-screen view of this block was open: draw again when it closes. */
	private focusStale = false;
	/** The block's folds changed while this view had no size (the other mode of the note): it draws again when it shows (M10 F10). */
	private foldsStale = false;
	/** The last press on a fold control came from the keyboard (I37): the redraw puts the keyboard focus back on the new control only then. */
	private foldByKey = false;
	private laid: LaidOut | null = null;
	/** M10 (F1): the folds this draw applied, so the settle, the sheet and the saved picture use the same people. */
	private foldPlan: FoldPlan | null = null;
	/** The scene whose fold controls and card content are being filled in idle time (one chain for both), so a redraw does not start a second chain. */
	private idleScene: Scene | null = null;
	/** The tap areas of the tags and `+` badges at the last settle: a fold's tap area is cut back where it meets them (F7). */
	private tapAreas: Rect[] = [];
	private scene: Scene | null = null;
	private svg: SVGSVGElement | null = null;
	/** The wrapper of the svg: hidden until the first view (S7). */
	private canvasEl: HTMLElement | null = null;
	private viewport: HTMLElement | null = null;
	/** The "Add first person" box of a block with no people (spec §5.9); null when a tree is drawn. */
	private emptyEl: HTMLElement | null = null;
	private panZoom: PanZoom | null = null;
	/** The tip of a card (D145); null in list mode and before the first draw. */
	private tips: CardTips | null = null;
	private popover: Popover | null = null;
	private observer: ResizeObserver | null = null;
	/** D183: watches the root of the block, so its height is read after the browser has laid the page out (`keepHeight`). */
	private heightWatch: ResizeObserver | null = null;
	private heightRoot: HTMLElement | null = null;
	/** The viewport whose theme colours were read or are due (a new render draws a new one). */
	private themeRead: HTMLElement | null = null;
	/** `--dynasty-callout-bg` as last read: the toolbar and the D28 hints take it. */
	private calloutBg: string | null = null;
	/**
	 * A font probe that stays in the tree: a probe added to the page later makes the
	 * engine compute the style of every element again, about 0.35 s for sample tree 7 on a slow phone.
	 */
	private fontProbe: HTMLElement | null = null;
	/** The same for `env(safe-area-inset-top)` in the full-screen view. */
	private safeProbe: HTMLElement | null = null;
	private lod: Lod | null = null;
	private bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private optionsStart: string | undefined;
	private optionsHeight: number | undefined;
	private blocked = false;
	private readonly timers = new Set<number>();
	/** The section of the block; null until Obsidian tells it (on a cold start it can answer null first and a section later). */
	private info: MarkdownSectionInformation | null;
	/** What Obsidian reported for this block, on the root as `data-dynasty-section` for the test harness. */
	private sectionNote: string;
	/** The render context, kept to ask for the section again; null in the full-screen view. */
	private readonly ctx: MarkdownPostProcessorContext | null;
	/**
	 * The place of the block is not known YET (D183): a retry or a new ask for the section is still to come. The "Read only" label and the "Open note" chip
	 * wait for it to end, so they never flash on a block that is only late.
	 */
	private placePending = false;
	private sectionTimer = 0;
	/** `onload` has run: a section found later starts its own look for the handle. */
	private started = false;
	private lastAskAt = -Infinity;
	/** The block's handle once known; null while it resolves, and for a read-only view. */
	private handle: Handle | null = null;
	/** The handle this view lost (detached): its session state moves to the next handle of the block (D6). */
	private lost: Handle | null = null;
	/** A look for the block after a change of the note is under way (D7). */
	private lateBusy = false;
	private unwatch: (() => void) | null = null;
	private peeked: Handle | null = null;
	private ready: Promise<Handle | null>;
	/** No handle (transclusion, Canvas card, hover popover, or the block cannot be told apart): no edits (spec §6.1). */
	private readOnly: boolean;
	private unsubscribe: (() => void) | null = null;
	/** Height set by a resize drag, until the note has the new `options.height`. */
	private dragHeight: number | null = null;
	/** A touch or pen press on a card that can still become a tap (spec §7.2). */
	private tap: { pointer: number; x: number; y: number; person: string } | null = null;
	private lastTap = 0;
	/** A Tab key is down and its focus move has not happened yet (see keyFocus). */
	private tabbing = false;
	private unloaded = false;
	/** Expand was pressed and the full-screen view is about to open. */
	private opening = false;
	private lateTried = false;
	/** Timing of the last render, until its first view has been painted (spec §7.7). */
	private timing: { t0: number; t: RenderTiming } | null = null;
	/** The marked person of the drawn tree (spec §13.1), or null. */
	private meId: string | null = null;
	/** The relation finder's result that this view draws (spec §13.2), or null. */
	private finderDrawn: FinderDrawn | null = null;
	/** The Show view of a line of succession that this view draws (contract 0.2.7 F), or null. Only one of the two temporary views shows at a time. */
	private successionDrawn: SuccessionDrawn | null = null;
	/**
	 * After the next first view, the keyboard focus goes here: the result's sentence, or a button by its
	 * class. Only the view the user acted in (or the full-screen view it opened) sets it, so a view that
	 * Obsidian draws again, or another pane of the note, never takes the focus.
	 */
	private focusDue: string | null = null;
	/** D51: the finder's small tree laid out top to bottom on an upright phone, until the first view picks the direction. */
	private finderAlt: (MeasuredResult & { geo: Geometry }) | null = null;
	private retries = 0;
	private retryTimer = 0;
	/** D183: when this view started (ms of `performance.now`), and the timer of the cold-start wait. */
	private startAt = 0;
	private startTimer = 0;
	/** The box of the last known height is on the page (the tree draws once the start conditions hold). */
	private waiting = false;
	/** The problems of the whole tree's text (spec §8); the picture warnings come on top (`allIssues`). */
	private textIssues: CodedIssue[] = [];
	/** M9: the pictures of the whole tree, resolved at render (O1, O2); null with no picture store. */
	private pictureInfo: PictureInfo | null = null;
	/** M9: the live pictures of the drawn scene (O5). */
	private live: LivePictures | null = null;
	/** The first view was ready for use: the live pictures may load (spec §13.0 item 3 "Pictures never delay the first view"). */
	private picturesOn = false;
	/** Raised by every render: a background check or a start of the pictures from before it does nothing. */
	private pictureToken = 0;
	private unsubPictures: (() => void) | null = null;
	/** D144: this view drew the phone list. A turn of the phone and the card settings do not touch a list; it has no scene, no layout and no view. */
	private listMode = false;
	/** The list that is drawn, for `updateEditUi`; null when there is none. */
	private listEl: HTMLElement | null = null;
	/** The small picture copies of the rows, held until the list is drawn again or goes away. */
	private listCopies: PictureCopy[] = [];
	/** The person of the large row, the only row with arms (D209 rule A: the personal arms, else the arms of the house). */
	private listCentre: string | null = null;
	/** Stops the picture requests of the rows that still wait. */
	private listAbort: AbortController | null = null;

	constructor(
		private readonly host: TreeHost,
		containerEl: HTMLElement,
		private source: string,
		place: ViewPlace,
	) {
		super(containerEl);
		this.coarse = containerEl.win.matchMedia('(pointer: coarse)').matches;
		if (place.kind === 'full') {
			// The same handle, key and so view state as the embed (spec §7.1).
			const f = place.from;
			this.full = place.host;
			this.sourcePath = f.sourcePath;
			this.info = null;
			this.ctx = null;
			this.readOnly = f.readOnly || !f.handle;
			this.sectionNote = 'full';
			this.peeked = f.handle ?? f.peeked;
			this.key = f.key;
			this.ready = Promise.resolve(this.readOnly ? null : f.handle);
			this.focusDue = f.focusDue ?? null;
			return;
		}
		const ctx = place.ctx;
		this.ctx = ctx;
		this.full = null;
		this.sourcePath = ctx.sourcePath;
		const info = ctx.getSectionInfo(containerEl);
		this.info = info;
		this.readOnly = info === null;
		this.placePending = info === null;
		this.sectionNote = info ? `${info.lineStart}-${info.lineEnd}` : 'none';
		const ordinal = info ? host.handles.quickOrdinal(info, source) : null;
		// Only for the view state until `resolve` has checked the block: never written through.
		// F-VIEW-03: a handle whose body is not this block's text belongs to another block (the registry has not read a change of the note yet),
		// so the view starts with a state of its own and takes the right handle's state in `attach`.
		const peek = ordinal === null ? null : host.handles.peek(ctx.sourcePath, ordinal);
		this.peeked = peek && sameBody(peek.body, source) ? peek : null;
		this.key = `${ctx.sourcePath}\u0000${ordinal !== null ? `#${ordinal}` : `text ${shortHash(source)}`}`;
		this.ready = info ? host.handles.resolve(ctx.sourcePath, info, source).catch(() => null) : Promise.resolve(null);
	}

	/** True for the full-screen view (spec §7.1). */
	get isFull(): boolean {
		return this.full !== null;
	}

	/** The path of the block's note; follows a rename. */
	get notePath(): string {
		return this.sourcePath;
	}

	/** The key of the block's view state, shared by the embed and the full-screen view. */
	get stateKey(): string {
		return this.key;
	}

	/** The plugin's settings (spec §9); the defaults for a host that has none. */
	private get settings(): DynastySettings {
		return this.host.settings ?? DEFAULT_SETTINGS;
	}

	/** G.1, G.3: what the person picker needs for portraits and relation words (Find, Focus, the finder). */
	private pickerContext(): PickerContext {
		return { sourcePath: this.sourcePath, me: this.meId, relationOptions: this.relationOptions, ...(this.host.pictures ? { pictures: this.host.pictures } : {}) };
	}

	/** D174: the options of every relation call of this view (cards, finder, sheet, saved picture), from the settings. */
	private get relationOptions(): RelationOptions {
		return { oneParentUnknown: this.settings.oneParentUnknown };
	}

	/**
	 * True when the tree is not on screen: its box is in the page with no layout parent (a closed fold), or it is not in the page at all (the reading view
	 * of another tab is taken out of the page). Its redraw can wait for the open trees.
	 */
	get offScreen(): boolean {
		const el = this.containerEl;
		return !el.isConnected || el.offsetParent === null;
	}

	/**
	 * A setting changed (spec §9): the view draws again with it; the tree point at the centre is kept. The
	 * dates only change a class, and the heights only the box (D30).
	 */
	onSettingsChange(prev: DynastySettings): void {
		this.guard(() => {
			if (this.unloaded) return;
			const now = this.settings;
			// D150: the direction decides only on a phone held upright, so a computer, a tablet and a phone on its side do not turn.
			if (prev.phoneDirection !== now.phoneDirection && !this.listMode && this.turnDue()) {
				this.checkTurn();
				return;
			}
			// 0.2.7 F.1: an open Show view draws again for the length of the line and the age for open branches (the age of the warning needs no redraw, K.10).
			if ((prev.successionLength !== now.successionLength || prev.youngDeathAge !== now.youngDeathAge) && (this.successionDrawn !== null || (this.listMode && !!this.peekState()?.succession))) {
				if (!this.listMode) this.carry = this.keptAnchor();
				this.render(this.fonts);
				return;
			}
			// D144: a list follows only the three settings that it shows, and the sibling setting (D174) when a mark gives relation words;
			// a new direction or break list changes nothing in it.
			if (this.listMode) {
				const kinWords = prev.oneParentUnknown !== now.oneParentUnknown && this.meId !== null;
				// 0.2.8: the list does not follow "Arms on cards" (D209 item 6: only the top row shows arms), so a change of it draws the list again
				// without need; the badge counts by "Warn about more than 2 parents of a type".
				const arms = prev.armsOnCards !== now.armsOnCards;
				if (prev.showDates !== now.showDates || prev.showRelations !== now.showRelations || prev.showPortraits !== now.showPortraits || kinWords || arms || prev.warnManyParents !== now.warnManyParents) this.render(this.fonts);
				return;
			}
			const root = this.viewport?.parentElement ?? null;
			// The generations matter only while a focus family is drawn. Spec §13.3: "Show dates on cards"
			// also takes the reign off the title text line, which can change a card's height (D61).
			const reigns = prev.showDates !== now.showDates && hasReign(this.lastLayout?.opts.labels);
			// O10: "Show portraits on cards" gives or takes the portrait room: the tree is laid out again.
			const portraits = prev.showPortraits !== now.showPortraits && hasPortraits(this.g);
			// D118: a new list of break places can change which names need more text lines.
			const breaks = prev.breakWords !== now.breakWords;
			// D145: with a mark the plate with the relation word is part of the card, so the setting changes the card height: the tree is laid out again.
			const plate = prev.showRelations !== now.showRelations && this.meId !== null;
			// D174: the sibling setting gives other relation names. The card texts, the plate (D145), the list and the finder's result are made at a render,
			// so the view draws again; the new layout measures the new texts. A view with no mark and no finder shows none.
			const kin = prev.oneParentUnknown !== now.oneParentUnknown && (this.finderDrawn !== null || this.meId !== null);
			// D126 (1): "Reduce movement" is read when a movement starts, so a change needs no redraw.
			// 0.2.8 (D206): "Arms on cards" gives or takes the arms room of a card, so the tree is laid out again; "Warn about more than 2 parents" changes the badge.
			const armsRoom = prev.armsOnCards !== now.armsOnCards && hasArms(this.g);
			const warns = prev.warnManyParents !== now.warnManyParents;
			if (!reigns && !portraits && !breaks && !plate && !kin && !armsRoom && !warns && (prev.focusGenerations === now.focusGenerations || this.focusId === null)) {
				root?.toggleClass('dynasty-no-dates', !now.showDates);
				this.updateHeight();
				return;
			}
			this.carry = this.keptAnchor();
			this.render(this.fonts);
		});
	}

	/** Obsidian calls this once the block's container is in the DOM: wires listeners and renders it. */
	override onload(): void {
		this.startAt = performance.now();
		this.host.views.add(this);
		for (const type of STOPPED_EVENTS) {
			this.registerDomEvent(this.containerEl, type as keyof HTMLElementEventMap, (e) => e.stopPropagation(), { passive: true });
		}
		// A focus that a Tab key makes arrives between the Tab's keydown and the next focusin (the browser
		// sends focus before focusin), keyup, press or click (see keyFocus).
		if (this.coarse && !this.full) {
			const win = this.containerEl.win;
			this.registerDomEvent(win, 'keydown', (e) => {
				if (e.key === 'Tab') this.tabbing = true;
			}, { capture: true });
			for (const type of ['focusin', 'keyup', 'pointerdown', 'click'] as const) this.registerDomEvent(win, type, () => (this.tabbing = false), { capture: true });
		}
		// A turn of the phone (D24, spec §7.5): any of these can be the first to report it.
		const win = this.containerEl.win;
		const turned = () => this.guard(() => this.checkTurn());
		this.registerDomEvent(win, 'resize', turned);
		this.registerDomEvent(win, 'orientationchange', () => {
			turned();
			// iOS can send orientationchange before the window has its new size.
			if (this.turnTimer) win.clearTimeout(this.turnTimer);
			this.turnTimer = win.setTimeout(() => {
				this.turnTimer = 0;
				if (!this.unloaded) turned();
			}, 300);
		});
		const portrait = win.matchMedia?.('(orientation: portrait)');
		if (portrait?.addEventListener) {
			portrait.addEventListener('change', turned);
			this.register(() => portrait.removeEventListener('change', turned));
		}
		// Esc closes the relation finder's result or the Show view of a line of succession and gives the focus back (spec §13.2, contract 0.2.7 F.1). The window hears
		// it first, as for the popovers, so a full-screen view around the tree stays open.
		this.registerDomEvent(
			win,
			'keydown',
			(e) => {
				if (e.key !== 'Escape' || !(this.finderDrawn || this.successionDrawn) || this.popover?.isOpen) return;
				const active = this.containerEl.doc?.activeElement ?? null;
				if (!active || !this.viewport?.contains(active)) return;
				e.stopPropagation();
				e.preventDefault();
				this.guard(() => (this.successionDrawn ? this.closeSuccession() : this.closeFinder()));
			},
			{ capture: true },
		);
		// O9: a picture file changed, came or went: the pictures of this tree follow (no new layout).
		const store = this.host.pictures;
		if (store) this.unsubPictures = store.onChange((paths) => this.guard(() => this.picturesChanged(paths)));
		// The metadata cache indexes a new picture file late: a list with a missing link looks again when it has resolved.
		const mc = this.host.app?.metadataCache;
		if (store && mc && typeof mc.on === 'function') this.registerEvent(mc.on('resolved', () => this.guard(() => this.linksResolved())));
		// D7: a view that gave up finding its block tries again when the note changes (the pasted copy is deleted).
		if (this.info && !this.full) this.unwatch ??= this.host.handles.watchNote?.((path) => this.guard(() => this.noteModified(path))) ?? null;
		this.guard(() => this.begin());
		if (this.info || this.full) {
			void this.ready.then((h) => this.guard(() => this.attach(h)));
		}
		this.started = true;
		if (!this.info && this.ctx) this.watchSection();
	}

	/** Obsidian calls this when the block leaves the note: stops timers and tears the scene down. */
	override onunload(): void {
		this.unloaded = true;
		if (this.startTimer) this.containerEl.win.clearTimeout(this.startTimer);
		if (this.sectionTimer) this.containerEl.win.clearTimeout(this.sectionTimer);
		if (this.retryTimer) this.containerEl.win.clearTimeout(this.retryTimer);
		if (this.turnTimer) this.containerEl.win.clearTimeout(this.turnTimer);
		this.host.views.delete(this);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.unsubPictures?.();
		this.unsubPictures = null;
		this.unwatch?.();
		this.unwatch = null;
		this.teardown();
	}

	/**
	 * The plugin is turned off while this tree is on the page (Obsidian does not unload a note's render
	 * children then): the tree stays as a read-only picture, its listeners and observers go, and no
	 * card, button or key writes through the old handle registry any more.
	 */
	retire(): void {
		if (this.unloaded) return;
		this.readOnly = true;
		this.placePending = false;
		this.guard(() => this.updateEditUi());
		this.unload();
	}

	/** Plugin memory for this block (spec §5.5): on the handle, or keyed by text for a read-only block; null if there is none yet. */
	private peekState(): BlockState | null {
		const h = this.handle ?? this.peeked;
		return h ? h.state : (this.host.looseStates.get(this.key) ?? null);
	}

	/** The same; a read-only block with none gets a new one (only the newest 500 are kept). */
	private ensureState(): BlockState {
		let st = this.peekState();
		if (!st) {
			st = newBlockState();
			this.host.looseStates.set(this.key, st);
			while (this.host.looseStates.size > 500) this.host.looseStates.delete(this.host.looseStates.keys().next().value!);
		}
		return st;
	}

	/**
	 * The block's handle is known. With none, the view becomes read-only. With one, the view follows
	 * its `changed` events: after a write or an outside change it shows the new body (spec §6.1).
	 */
	private attach(h: Handle | null): void {
		if (this.unloaded) return;
		if (!h) {
			this.handle = null;
			// A retry is still to come: the block may only be late (D183), so it is not read only yet and nothing says so.
			if (this.info && this.retries < RESOLVE_RETRIES_MS.length) {
				this.placePending = true;
				this.retryResolve();
				return;
			}
			if (!this.readOnly || this.placePending) {
				this.readOnly = true;
				this.placePending = false;
				this.updateEditUi();
			}
			this.retryResolve();
			return;
		}
		this.readOnly = false;
		this.placePending = false;
		if (this.handle !== h) {
			// A new handle of the same block (the old one was detached): the session state follows the block.
			if (this.lost) carryState(this.lost.state, h.state);
			this.lost = null;
			// The body tells a different block from the one the lines suggested: move a view state across.
			const loose = this.host.looseStates.get(this.key);
			if (loose?.view && !h.state.view) {
				h.state.view = loose.view;
				h.state.viewFor = loose.viewFor;
				h.state.views = { ...loose.views };
			}
			if (loose && !h.state.focus) h.state.focus = loose.focus;
			// D144: the Back trail of the phone list belongs to the session position, so it moves with it.
			if (loose && h.state.listBack === undefined) h.state.listBack = loose.listBack;
			if (loose && h.state.autoFocus === null) h.state.autoFocus = loose.autoFocus;
			if (loose && !h.state.folds.size) h.state.folds = new Set(loose.folds);
		}
		this.handle = h;
		this.unsubscribe?.();
		this.unsubscribe = h.onChanged((body) => this.guard(() => this.changed(h, body)));
		this.updateEditUi();
	}

	/**
	 * Obsidian gives no section for a block in a callout in Live Preview. If the block is in the
	 * note's own editor (not an embed) and its body matches exactly one block of the note, it is
	 * that block, and the view can edit it. Synchronous, so the block's view state applies at once.
	 */
	private lateResolve(ask = true): void {
		if (ask) this.askSection();
		if (this.info || this.full || this.lateTried || this.handle) return;
		// I07: a call before the block is in the page, or before it is in the note's editor, says nothing yet; only a sure answer ends the tries.
		if (!this.containerEl.isConnected) return;
		// A side view of another plugin is no editor and no reading view: nothing will ever make this block known, so there is no wait.
		if (this.inForeignView() || !this.inNoteView()) {
			this.lateTried = true;
			this.endPlacePending();
			return;
		}
		if (!this.host.handles.inEditorOf(this.containerEl, this.sourcePath)) return;
		this.lateTried = true;
		const h = this.host.handles.resolveByBody(this.sourcePath, this.source);
		this.ready = Promise.resolve(h);
		if (h) this.attach(h);
	}

	/**
	 * Asks Obsidian for the section of the block once more (D183). In a Reading view on a cold start the first answer can be null and a later one a section;
	 * `lateResolve` cannot help there. When a section comes, the view takes the place of a block it can edit and looks for its handle.
	 */
	private askSection(minGap = 0): void {
		const ctx = this.ctx;
		if (!ctx || this.info || this.full || this.unloaded) return;
		// The start tick and the section timer both ask: within one gap, one ask is enough (a note with many trees makes many asks).
		const now = performance.now();
		if (now - this.lastAskAt < minGap) return;
		this.lastAskAt = now;
		let info: MarkdownSectionInformation | null = null;
		try {
			info = ctx.getSectionInfo(this.containerEl);
		} catch {
			// Obsidian cannot tell yet: the next look asks again.
		}
		if (!info) return;
		this.info = info;
		this.sectionNote = `${info.lineStart}-${info.lineEnd}`;
		const ordinal = this.host.handles.quickOrdinal(info, this.source);
		const peek = ordinal === null ? null : this.host.handles.peek(this.sourcePath, ordinal);
		this.peeked = peek && sameBody(peek.body, this.source) ? peek : null;
		const oldKey = this.key;
		this.key = `${this.sourcePath}\u0000${ordinal !== null ? `#${ordinal}` : `text ${shortHash(this.source)}`}`;
		// The view state that the session kept under the text key follows the block to its place key.
		const loose = this.host.looseStates.get(oldKey);
		if (loose && oldKey !== this.key && !this.host.looseStates.has(this.key)) {
			this.host.looseStates.set(this.key, loose);
			this.host.looseStates.delete(oldKey);
		}
		this.readOnly = false;
		this.placePending = false;
		this.ready = this.host.handles.resolve(this.sourcePath, info, this.source).catch(() => null);
		// D7: also for a section that comes before `onload` ends, so a view that loses its block tries again when the note changes.
		this.unwatch ??= this.host.handles.watchNote?.((path) => this.guard(() => this.noteModified(path))) ?? null;
		if (!this.started) return;
		void this.ready.then((h) => this.guard(() => this.attach(h)));
	}

	/** The look for the section goes on every `SECTION_STEP_MS` until `SECTION_LIMIT_MS` has passed since the start; then the block is read only for good. */
	private watchSection(): void {
		if (this.sectionTimer || this.unloaded || this.info) return;
		this.sectionTimer = this.containerEl.win.setTimeout(() => {
			this.sectionTimer = 0;
			this.guard(() => {
				this.askSection(ASK_GAP_MS);
				if (this.info || this.unloaded) return;
				if (performance.now() - this.startAt >= SECTION_LIMIT_MS) this.endPlacePending();
				else this.watchSection();
			});
		}, SECTION_STEP_MS);
	}

	/** No more asks are to come: a block with no place is read only, and now the label and the chip say so. */
	private endPlacePending(): void {
		if (!this.placePending) return;
		this.placePending = false;
		this.updateEditUi();
	}

	/** Finds this view's block again, from Obsidian's section and the rendered body (spec §6.1). */
	private async reResolve(): Promise<Handle | null> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.lost = this.handle ?? this.lost;
		this.handle = null;
		const info = this.info;
		let h: Handle | null = null;
		if (info) h = await this.host.handles.resolve(this.sourcePath, info, this.source).catch(() => null);
		else if (!this.inForeignView() && this.host.handles.inEditorOf(this.containerEl, this.sourcePath)) h = this.host.handles.resolveByBody(this.sourcePath, this.source);
		this.ready = Promise.resolve(h);
		if (this.unloaded) return null;
		this.guard(() => this.attach(h));
		return h;
	}

	/**
	 * The handle this view may write through: only one whose body is what this view rendered.
	 * A stale view re-reads, then finds its block again, or writes nothing.
	 */
	private async validHandle(): Promise<Handle | null> {
		let h = await this.ready;
		if (h && !h.detached && sameBody(h.body, this.source)) return h;
		if (h) await h.refresh();
		h = this.handle;
		if (h && !h.detached && sameBody(h.body, this.source)) return h;
		h = await this.reResolve();
		return h && !h.detached && sameBody(h.body, this.source) ? h : null;
	}

	/** The note was renamed: later writes and "Open note" use the new path. */
	renamed(oldPath: string, newPath: string): void {
		if (this.sourcePath !== oldPath) return;
		this.sourcePath = newPath;
		if (this.key.startsWith(`${oldPath}\u0000`)) this.key = newPath + this.key.slice(oldPath.length);
	}

	/**
	 * Right after a note opens, or after an outside change, the editor text can briefly differ from
	 * what Obsidian rendered. Try again a little later before the view stays read-only.
	 */
	private retryResolve(): void {
		const info = this.info;
		if (!info || this.retries >= RESOLVE_RETRIES_MS.length) return;
		// Not in `timers`: a re-render clears those, and this must still run.
		this.retryTimer = this.containerEl.win.setTimeout(() => {
			this.retryTimer = 0;
			if (this.unloaded || this.handle) return;
			this.ready = this.host.handles.resolve(this.sourcePath, info, this.source).catch(() => null);
			void this.ready.then((h) => this.guard(() => this.attach(h)));
		}, RESOLVE_RETRIES_MS[this.retries++]);
	}

	/**
	 * The note changed after this view gave up finding its block (`retryResolve` made its last try): look
	 * once more, so that the view is editable again when the copy that made two blocks alike is gone.
	 */
	private noteModified(path: string): void {
		const info = this.info;
		if (path !== this.sourcePath || !info || this.unloaded || this.handle || this.lateBusy || this.retryTimer) return;
		if (this.retries < RESOLVE_RETRIES_MS.length) return;
		this.lateBusy = true;
		this.ready = this.host.handles.resolve(this.sourcePath, info, this.source).catch(() => null);
		void this.ready
			.then((h) => {
				this.lateBusy = false;
				if (h && !this.handle) this.guard(() => this.attach(h));
			})
			.catch(() => {
				this.lateBusy = false;
			});
	}

	/**
	 * The handle changed. A detached handle no longer knows its block: find the block again from
	 * what this view rendered. Otherwise the handle's new body is this block's new text: show it.
	 */
	private changed(h: Handle, body: string): void {
		if (h !== this.handle) return;
		if (h.detached) {
			if (this.full) void this.fullReattach();
			else void this.reResolve();
			return;
		}
		if (sameBody(body, this.source)) return;
		// The full-screen view closes when its block can no longer be drawn (spec §7.1).
		if (this.full && !this.parse(body).ok) {
			this.full.close(FULL_UI.invalid);
			return;
		}
		this.source = body;
		this.dragHeight = null;
		this.carry = this.keptAnchor();
		if (this.carry) this.carry.byUser = true;
		this.render(this.fonts);
	}

	/**
	 * The full-screen view has no section to find its block again: only a block with the same body,
	 * unique in the note, is still its block. Otherwise it closes with a Notice (spec §7.1).
	 */
	private async fullReattach(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.lost = this.handle ?? this.lost;
		this.handle = null;
		const h = await this.host.handles.resolveUnique(this.sourcePath, this.source).catch(() => null);
		if (this.unloaded) return;
		if (!h) {
			this.full?.close(FULL_UI.gone);
			return;
		}
		this.ready = Promise.resolve(h);
		this.guard(() => this.attach(h));
	}

	/** Read-only full-screen view: the note changed. Close unless the block is still there with the same text. */
	stillThere(text: string | null): void {
		if (!this.full || this.handle || this.unloaded) return;
		if (text === null || !findBlocks(text).some((b) => sameBody(b.body, this.source))) this.full.close(FULL_UI.gone);
	}

	/**
	 * Is this block inside something that shows another note's content (an embed, a Canvas card, a
	 * hover preview)? Obsidian can report a section there, but spec §6.1 wants such views read-only.
	 */
	private inForeignView(): boolean {
		return !!this.containerEl.closest('.markdown-embed, .internal-embed, .canvas-node, .hover-popover, .popover');
	}

	/** Is this block inside a note's own editor or reading view? Not so in the side view of another plugin. */
	private inNoteView(): boolean {
		return !!this.containerEl.closest('.markdown-source-view, .markdown-reading-view, .markdown-preview-view, .cm-editor');
	}

	/** Called by the plugin on `css-change`: re-measure and re-layout only if a font changed (§5.8). */
	onCssChange(): void {
		this.guard(() => {
			// A list reads no fonts; only the callout colour of its bar follows the theme.
			if (this.listMode) {
				if (this.containerEl.isConnected) this.readTheme();
				return;
			}
			if (!this.fonts || !this.containerEl.isConnected) return;
			const now = this.blockFonts();
			if (fontsChanged(now, this.fonts)) this.rerender(now);
			// D29: the same fonts can measure other widths once a theme's font face is in use.
			else this.recheckTall(true);
			this.readTheme();
		});
	}

	/**
	 * The scene is in the document only after it is built, so the card corner radius is read at the first fill that finds it connected (every ribbon and badge needs it).
	 * The scene reads the card's own computed `rx` (the theme sets it from --radius-m); reading a theme variable here gave 4 px in themes with an 8 px card corner.
	 */
	private learnRadius(): void {
		if (this.viewport?.isConnected) this.scene?.syncCornerRadius();
	}

	/** A theme change can change the card corner radius; the ribbons and badges are then drawn again. */
	private recheckRadius(): void {
		if (this.viewport?.isConnected) this.scene?.syncCornerRadius(true);
	}

	/** Called by the plugin `THEME_RECHECK_MS` after `css-change`: a theme can change its colours a frame later (its style sheet still loads). */
	recheckTheme(): void {
		this.guard(() => {
			this.readTheme();
			this.recheckRadius();
		});
	}

	/** The fonts at the block's place in the note. */
	private blockFonts(): FontState {
		const probe = this.fontProbe;
		return probe?.isConnected && probe.parentElement?.parentElement === this.containerEl ? fontsOf(probe) : readFonts(this.containerEl);
	}

	/**
	 * What one CSS rule cannot follow in every theme. The toolbar in a callout shows the
	 * callout's own background as the theme paints it (spec §10).
	 */
	private readTheme(): boolean {
		const vp = this.viewport;
		if (!vp?.parentElement || !vp.isConnected) return false;
		// Outside a callout there is nothing to read (no computed style, spec §7.7).
		this.calloutBg = vp.closest('.callout') ? calloutBackdrop<HTMLElement>(vp, (e) => getComputedStyle(e).backgroundColor) : null;
		this.paintCalloutBg();
		return true;
	}

	/**
	 * The callout background goes on the toolbar and the hints themselves, not on the root: a custom
	 * property that changes on the root makes the engine compute the style of every card again.
	 */
	private paintCalloutBg(): void {
		const vp = this.viewport;
		if (!vp) return;
		for (const el of Array.from(vp.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-hint-slot, :scope > .dynasty-result'))) {
			const now = calloutBgSet.get(el) ?? null;
			if (now === this.calloutBg) continue;
			if (this.calloutBg === null) el.style.removeProperty('--dynasty-callout-bg');
			else el.style.setProperty('--dynasty-callout-bg', this.calloutBg);
			calloutBgSet.set(el, this.calloutBg);
		}
	}

	/**
	 * Reads the theme for a new viewport once its first frame is drawn (spec §7.7): a read before it
	 * would make the engine compute the style of the whole new tree an extra time.
	 */
	private readThemeSoon(vp: HTMLElement): void {
		if (this.themeRead === vp) return;
		this.themeRead = vp;
		const win = this.containerEl.win;
		win.requestAnimationFrame(() => {
			const t = win.setTimeout(() => {
				this.timers.delete(t);
				this.guard(() => {
					if (this.viewport === vp && !this.readTheme()) this.themeRead = null;
				});
			}, 0);
			this.timers.add(t);
		});
	}

	/**
	 * Called by the plugin when web fonts finish loading. If one of ours loaded, the text was
	 * perhaps measured with a fallback font: truncate it again in place. The layout does not
	 * depend on text widths, so nothing moves and nothing is rebuilt.
	 */
	onFontsLoaded(families: string[]): void {
		this.guard(() => {
			if (!this.fonts || !this.scene || !usesFamily(this.fonts, families)) return;
			// D29: a name measured with a fallback font can need one text line more, or one less.
			if (this.recheckTall()) return;
			this.scene.refit();
		});
	}

	/** Re-lays out with new fonts and keeps the same tree point at the viewport centre (spec §7.5). */
	private rerender(fonts: FontState): void {
		this.carry = this.keptAnchor();
		clearMeasureCache();
		this.render(fonts);
	}

	/** The anchor a redraw keeps: none in the static touch preview, which shows its first view (D1). */
	private keptAnchor(): Anchor | null {
		return this.full || !this.coarse ? this.anchor() : null;
	}

	private anchor(): Anchor | null {
		const v = this.panZoom?.view;
		const laid = this.laid;
		if (!v || !laid) return null;
		let best: { id: string; d: number; cx: number; cy: number } | null = null;
		for (const b of laid.layout.persons.values()) {
			const cx = b.x + b.w / 2;
			const cy = b.y + b.h / 2;
			const d = (cx - v.cx) ** 2 + (cy - v.cy) ** 2;
			if (!best || d < best.d) best = { id: b.id, d, cx, cy };
		}
		if (!best) return null;
		const f = laid.layout.geometry.fontPx;
		const bandClear = !this.panZoom || this.topClear(v, this.panZoom.size, [...laid.layout.persons.values()]);
		return { person: best.id, dx: (v.cx - best.cx) / f, dy: (v.cy - best.cy) / f, scale: v.scale, byUser: !!this.peekState()?.view, bandClear };
	}

	private fromAnchor(a: Anchor): View | null {
		const b = this.laid?.layout.persons.get(a.person);
		if (!b || !this.laid) return null;
		const f = this.laid.layout.geometry.fontPx;
		return { scale: a.scale, cx: b.x + b.w / 2 + a.dx * f, cy: b.y + b.h / 2 + a.dy * f };
	}

	private guard(fn: () => void): void {
		try {
			fn();
		} catch (e) {
			console.error('Dynasty Tree: the tree view failed', e);
			// S7: a tree hidden until its first view must not stay hidden after an error.
			this.showTree();
			if (this.full) {
				// On a phone the full-screen view has no other way out: close it (spec §8).
				try {
					this.teardown();
				} catch {
					// Closing still works.
				}
				this.full.close(FULL_UI.failed);
				return;
			}
			try {
				this.teardown();
				this.containerEl.empty();
				buildCallout(this.containerEl, 'error', UI.errorTitle, 'dynasty-error').content.createDiv({ text: UI.internalError });
			} catch {
				// Nothing more can be done safely; the rest of the note still renders.
			}
		}
	}

	private teardown(): void {
		// B11: a new scene or the end of the view releases every picture copy of the old one.
		this.pictureToken++;
		this.picturesOn = false;
		this.live?.destroy();
		this.live = null;
		this.releaseList();
		this.tips?.destroy();
		this.tips = null;
		this.panZoom?.destroy();
		this.panZoom = null;
		this.popover?.close();
		this.popover = null;
		this.observer?.disconnect();
		this.observer = null;
		this.heightWatch?.disconnect();
		this.heightWatch = null;
		this.heightRoot = null;
		for (const t of this.timers) this.containerEl.win.clearTimeout(t);
		this.timers.clear();
		this.hoverPopover = null;
	}

	/**
	 * D183: the first draw. On a cold start the page can show the block before the plugin styles are applied and before Obsidian says where the block is,
	 * so the tree would show without style, read only, with a count of warnings that are not true yet. Until the styles and the settings are in and the
	 * block place is known (or known to be out of reach: an embed, a Canvas card, a page preview), the view shows an empty box of the last known height. A timer
	 * looks again every `START_STEP_MS`, not only the resize observer, and after `START_LIMIT_MS` the tree draws as it is.
	 */
	private begin(): void {
		if (!this.waitingToStart()) {
			this.render(null);
			return;
		}
		this.showPlaceholder();
		this.startTick();
	}

	/** True while the start conditions do not hold yet. A host with no `startedUp` and a full-screen view never wait. */
	private waitingToStart(): boolean {
		const su = this.host.startedUp;
		if (!su || this.full || this.unloaded) return false;
		this.askSection(ASK_GAP_MS);
		const age = performance.now() - this.startAt;
		// Only the cap of the styles ends the wait for them; the shorter limit holds for the settings and the block place (see `STYLES_LIMIT_MS`).
		if (age >= STYLES_LIMIT_MS) return false;
		if (!su.ready(this.containerEl)) return true;
		if (age >= START_LIMIT_MS) return false;
		if (this.info || this.handle) return false;
		this.lateResolve(false);
		return !(this.handle || this.lateTried);
	}

	/**
	 * The box that stands in for the tree. An svg of the height, because the plugin styles may not be there yet and a style attribute is not allowed.
	 * The `display` attribute makes it a block with no style sheet: an inline svg sits on a text baseline and the root grows by the gap under it.
	 */
	private showPlaceholder(): void {
		const el = this.containerEl;
		el.empty();
		this.waiting = true;
		const phone = this.coarse && this.isPhone();
		const px = lastHeight(this.host.app, this.key) ?? (phone ? PHONE_PLACEHOLDER_PX : this.settings.embedHeightDesktop);
		const box = el.createDiv({ cls: ['dynasty-root', 'dynasty-placeholder'], attr: { 'aria-busy': 'true', 'data-dynasty-placeholder': '' } });
		box.createSvg('svg', { cls: 'dynasty-placeholder-box', attr: { width: '100%', height: String(Math.round(px)), display: 'block', 'aria-hidden': 'true' } });
	}

	private startTick(): void {
		if (this.startTimer || this.unloaded) return;
		const win = this.containerEl.win;
		this.startTimer = win.setTimeout(() => {
			this.startTimer = 0;
			this.guard(() => this.startLook());
		}, START_STEP_MS);
	}

	/** One look at the start conditions: the tree draws when they hold, else the timer looks again. */
	private startLook(): void {
		if (!this.waiting || this.unloaded) return;
		if (this.waitingToStart()) {
			this.startTick();
			return;
		}
		this.waiting = false;
		this.render(null);
	}

	/** The plugin tells that a start condition came (the styles, the stored settings, the metadata cache): look at once, and count the pictures again. */
	startUpDone(): void {
		this.guard(() => {
			if (this.unloaded) return;
			if (this.waiting) {
				this.startLook();
				return;
			}
			// A tree that drew before the metadata cache was ready had no count of missing pictures: look again.
			this.picturesLookAgain();
		});
	}

	/** The pictures are resolved again (the metadata cache learned a file): the badge, the cards and the list rows follow. */
	private picturesLookAgain(): void {
		const whole = this.whole;
		if (!whole || !this.pictureInfo) return;
		this.resolvePictures(whole);
		this.updateBadge();
		this.live?.refresh([]);
		this.refillList();
		if (this.picturesOn) this.checkPictures();
	}

	/**
	 * The height of this block's root is kept for the next cold start (D183). A read of `offsetHeight` in the middle of the first draw lays the whole page out
	 * early (46 ms at 4x CPU on sample tree 07b) and again when the draw goes on. So a resize observer reads it, once the page is laid out, and again when the
	 * root changes (the resize handle comes later than the first draw).
	 */
	private keepHeight(): void {
		// The full-screen view is as high as the window; its height must not stand in for the note block (D183).
		if (this.full) return;
		const root = this.viewport?.parentElement ?? this.listEl?.parentElement?.parentElement ?? null;
		if (!root?.isConnected) return;
		if (typeof ResizeObserver !== 'function') {
			this.readHeight(root);
			return;
		}
		if (this.heightRoot === root) return;
		this.heightWatch?.disconnect();
		this.heightRoot = root;
		this.heightWatch = new ResizeObserver(() => this.guard(() => this.readHeight(root)));
		this.heightWatch.observe(root);
	}

	private readHeight(root: HTMLElement): void {
		if (root.isConnected && root.offsetHeight > 0) rememberHeight(this.host.app, this.key, root.offsetHeight);
	}

	private render(fontsOverride: FontState | null): void {
		this.waiting = false;
		this.foldsStale = false;
		this.teardown();
		this.listMode = false;
		const el = this.containerEl;
		el.empty();
		this.emptyEl = null;
		this.viewport = null;
		this.fontProbe = null;
		this.safeProbe = null;
		// A new PanZoom has no view yet: its first sized resize sets the first view anyway.
		this.firstDue = false;
		this.hintOn = false;
		this.hintKids = [];
		this.finderDrawn = null;
		this.successionDrawn = null;
		this.finderAlt = null;
		// D24: sideways on a phone in portrait. Set first, so a block with no tree follows a turn too.
		const orientation = this.orientationNow();
		this.orientation = orientation;
		const t0 = performance.now();
		const parsed = this.parse(this.source);
		if (!parsed.ok && this.full) {
			this.full.close(FULL_UI.invalid);
			return;
		}
		if (!parsed.ok) {
			this.laid = null;
			const box = buildCallout(el, 'error', UI.errorTitle, 'dynasty-error');
			box.root.setAttribute('data-dynasty-orientation', orientation);
			box.content.createDiv({ cls: 'dynasty-error-detail', text: hardErrorText(parsed.error) });
			return;
		}
		// A.5: "Warn about more than 2 parents of a type". The derive is not cached (`parse-cache.ts`), so the setting needs no cache key; `onSettingsChange` draws again.
		const whole = deriveFamilies(parsed.tree, { warnManyParents: this.settings.warnManyParents });
		const t1 = performance.now();
		if (!whole.people.length && !whole.issues.some((i) => i.level === 'blocking')) {
			this.renderEmpty(el, whole);
			return;
		}
		// D144: a tree in a note on a phone is a list. No fonts, no layout, no scene.
		if (!this.full && this.coarse && this.isPhone()) {
			this.renderList(el, parsed.tree, whole, t0, t1);
			return;
		}
		const fonts = fontsOverride ?? readFonts(el);
		// D143, D150: the card form of the direction (the Roundel top to bottom, the text card sideways).
		const geo = cardForm(geometryFor(fonts.px), orientation);
		const base: LayoutSettings = orientation === 'sideways' ? { sweeps: 4, far: DEFAULT_FAR_RULE, orientation } : { sweeps: 4, far: DEFAULT_FAR_RULE };
		const focus = this.updateFocus(parsed.tree, whole);
		const st = this.ensureState();
		// F9: a fold whose family has no child any more (or no parent) ends with the parse; a text that does not parse keeps the folds.
		const kept = pruneFolds(whole, st.folds);
		if (kept !== st.folds) st.folds = new Set(kept);
		// Spec §13.2: the finder's result is computed again from the new text at each render; with a
		// line it replaces the focus family (the search uses the whole tree), and Close brings it back.
		// 0.2.7 F.1: the Show view of a line of succession is computed from the new text too; it replaces the finder's result (one temporary view at a time).
		const succession = this.successionFor(st, whole);
		this.successionDrawn = succession;
		const finder = succession ? null : this.finderFor(st, whole);
		this.finderDrawn = finder;
		// A tag or a problem in the static preview opened this view on a person (D17). If the small tree
		// of the line does not draw them, the result shows in the whole tree, so the person can be centred.
		const target = this.full?.target;
		if (finder?.line && !finder.state.whole && target && whole.byId.has(target) && !finder.line.people.includes(target)) finder.state.whole = true;
		const small = finder?.line && !finder.state.whole ? finder.line : null;
		// Focus mode (spec §5.6): only the focus family is laid out and drawn; the whole tree's
		// problems stay on the badge, and every edit reads the whole block.
		const n = focusGenerationsFor(parsed.tree.options, this.settings.focusGenerations);
		let sub = focus !== null && !finder?.line && !succession ? focusSubgraph(parsed.tree, focus, n) : null;
		// A tag or a problem in the static preview opened this view on a person its family does not draw:
		// this view shows all people (D21: its own focus), so the person can be centred.
		if (this.full && sub && target && whole.byId.has(target) && !sub.tree.people.some((p) => p.id === target)) {
			this.full.focus = { id: null };
			sub = null;
		}
		// §5.5: a person just saved is shown once, by the first view of the kind that saved them.
		// If its family does not draw them, it shows all people, like Find.
		const saved = st.shown;
		let sessionChanged = false;
		if (saved && saved.place === (this.full ? 'full' : 'embed')) {
			st.shown = null;
			if (sub && whole.byId.has(saved.id) && !sub.tree.people.some((p) => p.id === saved.id)) {
				// A D21 full-screen view changes only its own focus; otherwise the session changes.
				if (this.full?.focus) this.full.focus = { id: null };
				else {
					st.focus = { id: null };
					sessionChanged = true;
				}
				this.pendingTarget = [saved.id];
				sub = null;
			}
		}
		// D47: the small tree of the line has only its people, and a couple on it is never split.
		const g = small ? lineSubgraph(whole, small) : sub ? deriveFamilies(sub.tree) : whole;
		// Spec §13.1: the names come from the whole tree, also in focus mode, and are kept per tree and
		// mark (relation-cache.ts). Their time counts in the §7.7 time: it is in the layout part.
		const me = validMe(whole, parsed.tree.options.me);
		this.meId = me;
		const rel = me !== null && !small ? relationsFor(whole, me, this.relationOptions) : null;
		// M10 (F1, F8): the computer and the full-screen view apply the folds; the static phone preview never does.
		const canFold = !!this.full || !this.coarse;
		const lineIds = this.linePeopleNow();
		let plan = planFolds(g, whole, st.folds, canFold, lineIds);
		// F11: a person that a flow asked for (a tag or a problem in the preview, Find outside the focus family) is shown.
		if (canFold && plan.hidden.size) {
			const asked = (this.full?.target ? [this.full.target] : (this.pendingTarget ?? [])).filter((id) => plan.hidden.has(id));
			if (asked.length) {
				st.folds = new Set(unfoldFor(g, whole, st.folds, asked));
				plan = planFolds(g, whole, st.folds, canFold, lineIds);
			}
		}
		this.foldPlan = plan;
		// D145: the plate with the relation word is part of the card only while the setting shows it, so the setting changes the layout.
		// Without the plate a marked person gets the "You" tab; so does the finder's small tree, which has no relation words (`rel` is null there).
		const relationLine = rel !== null && this.settings.showRelations;
		const marked = (s: LayoutSettings): LayoutSettings => (relationLine ? { ...s, relationLine: true } : me !== null ? { ...s, youTab: me } : s);
		// 0.2.7 F.4: the heirs and the open branches get a tab above their cards; the ids only, never the texts (a cached layout would keep a stale text).
		const shaped = (s: LayoutSettings): LayoutSettings => (succession ? { ...marked(s), ordinalCards: [...succession.ordinals.keys()] } : marked(s));
		const laidBase: LayoutSettings = withFolds(shaped(small ? { ...base, far: NEVER_FAR_RULE } : base), plan, canFold);
		// Spec §13.3, §13.5: the card labels of the drawn graph. A tree with no titles draws as in M7 (no labels).
		const labels = needsLabels(g) ? cardLabels(g) : undefined;
		const { laid, settings } = this.layOut(g, geo, laidBase, fonts, labels, plan.hidden);
		// D51: on an upright phone the small tree is also laid out top to bottom. The first view, which
		// knows the free area between the result bar and the toolbar, draws the direction with larger names.
		// The other direction has its own card form (the Roundel), so it gets its own geometry; `geo` has the text card.
		const altGeo = cardForm(geometryFor(fonts.px), 'down');
		this.finderAlt = small && orientation === 'sideways' ? { ...this.layOut(g, altGeo, withFolds(shaped({ sweeps: 4, far: NEVER_FAR_RULE }), plan, canFold), fonts, labels, plan.hidden), geo: altGeo } : null;
		const t2 = performance.now();
		// The finder's tree has its own key: its views never replace the saved view of the family.
		const finderKey = succession ? `succession:${succession.titleId}|` : finder?.line ? `finder:${finder.state.first}>${finder.state.second}:${finder.state.index}:${finder.state.whole ? 'whole' : 'line'}|` : '';
		const family = finderKey + focusKey(sub ? focus : null, n);
		// A view of one family means nothing in another: the new family gets its own first view.
		if (this.familyKey !== null && this.familyKey !== family) this.carry = null;
		this.familyKey = family;
		this.drawnKey = finderKey + focusKey(sub ? focus : null, n, orientation);
		this.focusId = sub ? focus : null;
		this.focusStale = false;
		this.g = g;
		this.whole = whole;
		this.laid = laid;
		this.fonts = fonts;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.optionsStart = parsed.tree.options.start;
		this.optionsHeight = parsed.tree.options.height;
		this.lod = null;

		// O2: the picture warnings that need no file read go on the first badge.
		this.textIssues = whole.issues;
		this.resolvePictures(whole);

		const root = el.createDiv({ cls: 'dynasty-root', attr: { 'data-dynasty-people': String(g.people.length), 'data-dynasty-section': this.sectionNote, 'data-dynasty-orientation': orientation } });
		if (this.focusId !== null) root.setAttribute('data-dynasty-focus', this.focusId);
		if (finder) root.setAttribute('data-dynasty-finder', !finder.line ? 'none' : finder.state.whole ? 'whole' : 'line');
		if (succession) root.setAttribute('data-dynasty-succession', succession.titleId);
		this.placeClasses(root);
		// Spec §9: the dates hide, the cards keep their size (the layout does not change). The same for the relation names (D40).
		root.toggleClass('dynasty-no-dates', !this.settings.showDates);
		const blocking = whole.issues.filter((i) => i.level === 'blocking');
		this.blocked = blocking.length > 0;
		this.buildBanner(root, blocking);

		// D212 (bars-in-flow): in a note the toolbar and the banner stand above the tree, in the flow of the box; the drawing area is what is left below them.
		// The full-screen view keeps them over the tree (its toolbar is at the foot on a phone).
		const viewport = root.createDiv({ cls: ['dynasty-viewport', ...(this.full ? [] : ['is-flow'])] });
		this.viewport = viewport;
		this.barsPx = '';
		this.updateHeight();
		// The HTML wrapper takes the CSS transform during a pinch (see PanZoom).
		const canvas = viewport.createDiv({ cls: 'dynasty-canvas' });
		const svg = canvas.createSvg('svg', { cls: 'dynasty-svg', attr: { width: '100%', height: '100%' } });
		// S7: the browser lays the tree out only when its first view is written (`firstDraw`); until then it takes no style or
		// layout time. The wrapper hides, not the svg: the colour rule allows no inline `display`, and the svg is its only child.
		canvas.hidden = true;
		this.canvasEl = canvas;
		this.svg = svg;
		// The layout clamps the font size; the card text must use the size the layout used.
		svg.style.setProperty('--dynasty-font-size', `${geo.fontPx}px`);
		// Obsidian's aria-label tooltips work only on HTML elements and fail on SVG ones. The CSS
		// turns them off with --no-tooltip; this also covers versions without that switch.
		svg.addEventListener('pointerover', (e) => e.stopPropagation());
		const sceneEl = svg.createSvg('g', { cls: 'dynasty-scene' });
		// S5c: a card gets its content before the browser scrolls to it. `focus` does not bubble; the capture phase sees it first.
		// The listener is on the HTML wrapper: Chromium makes an SVG element that has a focus listener a Tab stop of its own.
		canvas.addEventListener('focus', (e) => this.guard(() => this.fillFocused(e.target)), true);
		const breaks = this.breakList();
		const opts: SceneOptions = {
			lazyCards: true,
			fonts,
			measure: measureText,
			...(breaks.size ? { breaks } : {}),
			link: (p) => this.cardLink(p),
			badges: sub ? { hidden: sub.hidden, label: (p, n) => FOCUS_UI.badgeLabel(p.name, n) } : undefined,
			...(rel ? { relations: rel.cards } : {}),
			...(me !== null ? { me } : {}),
			...(finder?.line ? { line: lineMarks(finder.line, finder.state.whole) } : {}),
			...(succession ? { heirs: succession.heirs, ordinals: succession.ordinals } : {}),
			...(labels ? { labels } : {}),
			showDates: this.settings.showDates,
			...(canFold ? { folds: { buttons: true, label: foldLabel, lazy: true, wire: (f: FoldRef) => this.wireFoldHit(f) } } : {}),
		};
		this.scene = buildScene(sceneEl, g, laid, opts);
		this.lastLayout = { geo, settings, sceneEl, opts };
		this.markPositions();
		this.wireScene(this.scene);
		// D145: the tip of a card (relation text) with the setting "Show relation names on cards" off. The marked card has its "You" tab.
		this.tips = wireCardTips({
			host: viewport,
			text: (id) => (id === me ? undefined : rel?.cards.get(id)?.text),
			enabled: () => !this.settings.showRelations && me !== null && rel !== null && !this.isPhone(),
			busy: () => this.panZoom?.busy ?? false,
		});
		this.makeLive();
		root.setAttribute('data-dynasty-cards-pending', String(this.scene.fill.pending));
		root.setAttribute('data-dynasty-lines-pending', String(this.scene.fill.pendingLines));
		// T1: the harness asks for all the content at once.
		root.addEventListener(FILL_ALL_EVENT, () =>
			this.guard(() => {
				this.scene?.fill.fillAll();
				this.syncPending();
			}),
		);
		// Keyboard focus on a card makes the browser scroll this overflow-hidden box, which would
		// shift the tree against the pan/zoom transform. Keep it at 0 and pan instead.
		viewport.addEventListener('scroll', () => {
			viewport.scrollTop = 0;
			viewport.scrollLeft = 0;
		});
		this.popover = new Popover(viewport);
		this.buildToolbar(viewport);
		if (finder) this.buildResultBar(viewport, canvas, finder, whole);
		if (succession) this.buildSuccessionBar(viewport, canvas, succession);
		this.wireCardPresses(viewport);
		this.updateEditUi();

		this.panZoom = new PanZoom({
			viewport,
			scene: sceneEl,
			wrapper: canvas,
			frameTop: () => this.frameTop(),
			bounds: this.bounds,
			fontPx: geo.fontPx,
			// A touch embed is a static preview (D1); the full-screen view always pans and zooms (spec §7.2).
			interactive: !!this.full || !this.coarse,
			mode: this.full ? 'full' : 'embed',
			onSettle: (v, byUser) => this.settled(v, byUser),
			// A D19 fill in a pinch out also takes the level of detail for its zoom: the smaller level has
			// less text to lay out, so the fills are cheaper (measured: 83–133 ms instead of 133–167 ms at 4×).
			onFill: (v) => {
				if (this.applyLod(v)) this.placeFolds(v);
				this.fillFolds(v);
				this.fillNear(v);
			},
			onFirstDraw: (v) => this.firstDraw(v),
			guard: (fn) => this.guard(fn),
			reduced: () => this.reduced(),
		});
		this.fontProbe = root.createDiv({ cls: 'dynasty-font-probe' });
		// Only the full-screen view reads the safe area (its toolbar can be at the bottom).
		if (this.full) this.safeProbe = root.createDiv({ cls: 'dynasty-safe-probe' });
		// D28: the hint labels stay in the tree, hidden until a first view counts children outside the box.
		if (orientation === 'sideways') for (const dir of ['up', 'down']) viewport.createDiv({ cls: 'dynasty-hint-slot', attr: { 'data-dir': dir } });
		this.observer = new ResizeObserver(() => this.guard(() => this.resized()));
		this.observer.observe(viewport);
		// A banner that grows (the steps open, a long sentence wraps) takes room from the drawing area below it without a change of the box.
		if (viewport.hasClass('is-flow')) for (const bar of Array.from(viewport.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-result'))) this.observer.observe(bar);
		const t3 = performance.now();
		const timing: RenderTiming = {
			path: this.sourcePath,
			people: g.people.length,
			...(sub ? { of: whole.people.length } : {}),
			parseMs: t1 - t0,
			layoutMs: t2 - t1,
			drawMs: t3 - t2,
			totalMs: t3 - t0,
			...(this.full ? { full: true } : {}),
		};
		this.timing = { t0, t: timing };
		this.host.recordTiming(timing);
		if (sessionChanged) TreeView.redrawState(this.host, st, { except: this });
	}

	/** The banner above a tree that has problems that stop editing (spec §8). */
	private buildBanner(root: HTMLElement, blocking: readonly CodedIssue[]): void {
		if (!blocking.length) return;
		const banner = buildCallout(root, 'warning', UI.bannerTitle, 'dynasty-banner');
		banner.content.createDiv({ text: UI.bannerLead });
		const list = banner.content.createEl('ul');
		for (const i of blocking) list.createEl('li', { text: issueText(i) });
	}

	/**
	 * D144, contract C.3.1: a tree in a note on a phone is a list of the family of one person. The start chain picks
	 * the person (`listStart`); a tap on a name, Find and Back move it through the block state, so the full-screen
	 * view that Expand opens stands on the same person. Nothing is laid out or drawn as a tree, and nothing is written.
	 */
	private renderList(el: HTMLElement, tree: Tree, whole: FamilyGraph, t0: number, t1: number): void {
		const st = this.ensureState();
		this.listMode = true;
		this.laid = this.scene = this.svg = this.lastLayout = this.canvasEl = this.panZoom = null;
		this.drawnKey = this.familyKey = null;
		this.pendingTarget = null;
		const kept = pruneFolds(whole, st.folds);
		if (kept !== st.folds) st.folds = new Set(kept);
		const me = validMe(whole, tree.options.me);
		this.meId = me;
		// A session choice that names nobody (the person was deleted) ends; a trail with no session position means nothing.
		if (st.focus?.id != null && !whole.byId.has(st.focus.id)) st.focus = null;
		if (!st.focus || st.focus.id === null) st.listBack = undefined;
		const start = listStart({ session: st.focus?.id, pin: tree.options.focus, me, edited: st.lastEdited, g: whole });
		const centre = start?.id ?? whole.people[0].id;
		this.g = this.whole = whole;
		this.focusId = centre;
		this.focusStale = false;
		this.textIssues = whole.issues;
		this.resolvePictures(whole);
		// §5.5: a person just saved shows once. The list never moves for it: the row flashes, or a Notice says where to look.
		const saved = st.shown?.place === 'embed' ? st.shown.id : null;
		if (saved !== null) {
			st.shown = null;
			savedFlashes.set(st, { id: saved, until: performance.now() + HIGHLIGHT_MS });
		}

		const root = el.createDiv({
			cls: ['dynasty-root', 'dynasty-list-root'],
			attr: { 'data-dynasty-section': this.sectionNote, 'data-dynasty-orientation': 'list', 'data-dynasty-focus': centre, 'data-dynasty-list-from': start?.from ?? 'first', 'data-dynasty-cards-pending': '0', 'data-dynasty-lines-pending': '0' },
		});
		this.placeClasses(root);
		const blocking = whole.issues.filter((i) => i.level === 'blocking');
		this.blocked = blocking.length > 0;
		this.buildBanner(root, blocking);
		const viewport = root.createDiv({ cls: ['dynasty-viewport', 'dynasty-list-viewport'] });
		this.viewport = viewport;
		this.barsPx = '';
		// The warning badge opens its problem list in this popover.
		this.popover = new Popover(viewport);
		this.buildListBar(viewport, st);
		const t2 = performance.now();

		const labels = needsLabels(whole) ? cardLabels(whole) : undefined;
		const rel = me !== null && this.settings.showRelations ? relationsFor(whole, me, this.relationOptions) : null;
		// 0.2.7 F.6: while the Show view is open, the list has the bar at its top, and each heir (each open branch) says its place in the place of the relation word.
		const succession = this.successionFor(st, whole);
		this.successionDrawn = succession;
		const words = succession ? lineWords(succession) : null;
		const ctl = new AbortController();
		this.listAbort = ctl;
		const token = this.pictureToken;
		this.listCentre = centre;
		const data = listData(whole, centre);
		const result = buildPhoneList(viewport, {
			g: whole,
			data,
			me,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			editable: !this.readOnly && !this.blocked && !this.inForeignView(),
			word: (id) => words?.get(id) ?? listWord(id, { me, showRelations: this.settings.showRelations, cards: rel?.cards }),
			link: (row) => linkWord(whole, data, row),
			...(succession ? { bar: { sentence: succession.sentence, closeLabel: SUCCESSION_UI.barCloseLabel, onClose: () => this.guard(() => this.closeSuccession()) } } : {}),
			...(labels ? { labels } : {}),
			pictures: (slots, id) => this.listPictures(whole, slots, id, ctl.signal, token),
			onGo: (id) => this.guard(() => this.listMove(id)),
			onEdit: (id, fromTap) => this.guard(() => this.activate(id, fromTap)),
		});
		this.listEl = result.list;
		root.setAttribute('data-dynasty-people', String(result.rows));
		if (succession) root.setAttribute('data-dynasty-succession', succession.titleId);
		// A second build soon after the save (a note change event) must keep the flash, so the flash lives in the block state, not in this build.
		const flash = savedFlashes.get(st);
		const left = flash ? flash.until - performance.now() : 0;
		if (flash && left > 0 && whole.byId.has(flash.id)) {
			const row = result.list.querySelector<HTMLElement>(`.dynasty-list-row[data-person="${flash.id}"]`);
			if (row) this.flashRow(row, left);
			else if (saved !== null) new Notice(PHONE_LIST_UI.savedElsewhere);
		} else if (flash) {
			savedFlashes.delete(st);
		}
		this.observer = new ResizeObserver(() =>
			this.guard(() => {
				this.lateResolve();
				this.updateEditUi();
				this.readThemeSoon(viewport);
				this.keepHeight();
			}),
		);
		this.observer.observe(viewport);
		this.updateEditUi();
		const moved = this.focusDue !== null;
		this.takeFocus();
		// After a move the list may start above the part of the note that shows: bring its top into view.
		if (moved && viewport.getBoundingClientRect().top < 0) viewport.scrollIntoView({ block: 'start' });
		const t3 = performance.now();
		const timing: RenderTiming = { path: this.sourcePath, people: whole.people.length, parseMs: t1 - t0, layoutMs: t2 - t1, drawMs: t3 - t2, totalMs: t3 - t0 };
		this.timing = { t0, t: timing };
		this.host.recordTiming(timing);
		this.markInteractive();
		this.keepHeight();
		// F-VIEW-01: the list checks its picture files too, so a file that is too large or not a picture shows on the badge.
		this.startPictures();
	}

	/** The bar above the list (D144, 0.2.8 G.13): the same flat row as the computer's toolbar: Add person and the tree text (made by `updateEditUi`) at the left, then Find, Back after a move, the problem badge and Expand. */
	private buildListBar(viewport: HTMLElement, st: BlockState): void {
		const bar = viewport.createDiv({ cls: 'dynasty-toolbar', attr: { role: 'toolbar', 'aria-label': TOOLBAR_UI.region } });
		// First in the viewport, so Tab reaches the bar before the list.
		viewport.prepend(bar);
		// D182: the phone bar shows icons only; the full text is in the aria-label.
		const button = (icon: string, label: string, cls: string) => {
			const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', cls], attr: { 'aria-label': label, type: 'button' } });
			setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
			return b;
		};
		bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
		button('search', PHONE_LIST_UI.findLabel, 'dynasty-list-find').addEventListener('click', () => this.guard(() => void this.listFind()));
		const back = st.listBack?.length ? popTrail(st.listBack, (id) => !!this.whole?.byId.has(id)) : null;
		if (back) {
			const name = this.whole?.byId.get(back.id)?.name ?? back.id;
			button('arrow-left', PHONE_LIST_UI.backLabel(name), 'dynasty-list-back').addEventListener('click', () => this.guard(() => this.listBackTap()));
		}
		this.updateBadge(bar);
		button('maximize', PHONE_LIST_UI.expandLabel, 'dynasty-expand').addEventListener('click', () => this.guard(() => void this.openFull(null)));
		this.orderBar(bar);
	}

	/** A tap on a name of the list: the list moves to that person and the old person goes on the Back trail. */
	private listMove(id: string): void {
		if (id === this.focusId) return;
		this.focusDue = LIST_FOCUS;
		TreeView.listGo(this.host, this.ensureState(), id, 'push', this.focusId, this);
	}

	/** Back: the list returns to the newest person of the trail who is still in the tree. */
	private listBackTap(): void {
		const st = this.ensureState();
		const back = popTrail(st.listBack, (id) => !!this.whole?.byId.has(id));
		if (!back) return;
		this.focusDue = LIST_FOCUS;
		TreeView.listGo(this.host, st, back.id, 'pop', this.focusId, this);
	}

	/** Find: the picker of the whole tree; a choice moves the list, no choice gives the keyboard focus back to Find. */
	private async listFind(): Promise<void> {
		const g = this.whole;
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false, null, null, this.pickerContext());
		if (this.unloaded) return;
		if (picked?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-list-find'));
			return;
		}
		this.guard(() => this.listMove(picked.id));
	}

	/**
	 * Moves the list of a block to `id` and draws every view of the block again. `push` (a tap on a name, Find) puts
	 * `from`, the person the list stood on, on the Back trail; `pop` (Back) cuts the trail back to `id`. Through the
	 * block state, like `focusState`, so the full-screen view that Expand opens stands on the same person.
	 */
	static listGo(host: TreeHost, st: BlockState, id: string, how: 'push' | 'pop', from: string | null, origin: TreeView | null = null): void {
		if (how === 'push') {
			if (from !== null && from !== id) st.listBack = pushTrail(st.listBack, from);
		} else {
			const at = st.listBack?.lastIndexOf(id) ?? -1;
			st.listBack = at >= 0 ? st.listBack!.slice(0, at) : st.listBack;
		}
		st.focus = { id };
		st.shown = null;
		st.finder = null;
		st.succession = null;
		TreeView.redrawState(host, st, { origin });
	}

	/** A still outline on the row of a person that a save changed, for two seconds (no animation, so Reduce movement has nothing to change). */
	private flashRow(row: HTMLElement, ms: number = HIGHLIGHT_MS): void {
		row.addClass('dynasty-list-flash');
		const win = this.containerEl.win;
		const t = win.setTimeout(() => {
			this.timers.delete(t);
			row.removeClass('dynasty-list-flash');
		}, ms);
		this.timers.add(t);
	}

	/**
	 * The small picture copies of one row (0.2.8): the portrait when "Show portraits on cards" is on, and for the large row the arms (D209 rule A: the personal
	 * arms first, else the arms of the house; the list does not follow "Arms on cards"). The row made a place for each picture it has. The portrait of the large row is 56 px, the others 36 px.
	 */
	private listPictures(whole: FamilyGraph, slots: ListPictureSlots, id: string, signal: AbortSignal, token: number): void {
		const store = this.host.pictures;
		const info = this.pictureInfo;
		const p = whole.byId.get(id);
		if (!p) return;
		if (!store || !info) {
			// No store: nothing will ever fill the places.
			for (const slot of [slots.arms, slots.portrait]) failListPicture(slot);
			return;
		}
		const su = this.host.startedUp;
		// D213: a file that the metadata cache may not know yet keeps its place; any other file that cannot show leaves no empty place.
		const fileOf = (link: string | undefined): TFile | null | 'wait' => {
			const r = link !== undefined ? info.resolved.get(link) : undefined;
			if (r?.ok) return r.file;
			return r && r.code === 'missing-picture' && su && !su.cache() ? 'wait' : null;
		};
		const load = (file: TFile | null | 'wait', box: CopyBox, slot: HTMLElement) => {
			if (file === 'wait') return;
			if (!file) {
				failListPicture(slot);
				return;
			}
			const live = () => !signal.aborted && token === this.pictureToken && !this.unloaded && slot.isConnected;
			void store.acquire(file, box, signal).then(
				(c) => {
					if (!c || !('url' in c)) {
						if (live()) this.guard(() => failListPicture(slot));
						return;
					}
					if (!live()) {
						c.release();
						return;
					}
					this.listCopies.push(c);
					this.guard(() => showListPicture(slot, c.url));
				},
				(e: unknown) => {
					console.error('Dynasty Tree: cannot show a picture in the list', e);
					if (live()) this.guard(() => failListPicture(slot));
				},
			);
		};
		const hero = this.listCentre === id;
		if (hero && slots.arms) load(fileOf(p.arms ?? (p.house !== undefined ? whole.houses.get(p.house)?.arms : undefined)), LIST_ARMS_BOX, slots.arms);
		if (this.settings.showPortraits && slots.portrait) {
			const crop = portraitCropOf(p);
			load(fileOf(p.portrait), { ...(hero ? HERO_PORTRAIT_BOX : LIST_PORTRAIT_BOX), ...(crop ? { crop } : {}) }, slots.portrait);
		}
	}

	/** The picture copies of the rows go back to the store (the list is drawn again, or the view ends). */
	private releaseList(): void {
		this.listAbort?.abort();
		this.listAbort = null;
		for (const c of this.listCopies.splice(0)) c.release();
		this.listEl = null;
	}

	/**
	 * The first view is set: the next frame draws the cards, and the input is already wired. The frame
	 * after that starts only when that one has been painted, so its start is the time to interactive
	 * (spec §7.7). The owner reads it with the "Show render timing" command.
	 */
	private markInteractive(): void {
		const m = this.timing;
		if (!m) return;
		this.timing = null;
		const win = this.containerEl.win;
		win.requestAnimationFrame(() => win.requestAnimationFrame(() => (m.t.interactiveMs = performance.now() - m.t0)));
	}

	/** A block with no people: one "Add first person" button (spec §5.9). */
	private renderEmpty(el: HTMLElement, g: FamilyGraph): void {
		this.g = g;
		this.laid = null;
		this.scene = null;
		this.svg = null;
		this.blocked = false;
		const root = el.createDiv({ cls: 'dynasty-root dynasty-empty-root', attr: { 'data-dynasty-cards-pending': '0', 'data-dynasty-people': '0', 'data-dynasty-section': this.sectionNote, 'data-dynasty-orientation': this.orientation } });
		this.placeClasses(root);
		const box = root.createDiv({ cls: 'dynasty-empty' });
		this.emptyEl = box;
		box.createDiv({ cls: 'dynasty-empty-text', text: ADD_UI.empty });
		const add = box.createEl('button', { cls: ['mod-cta', 'dynasty-add-first'], text: ADD_UI.addFirst, attr: { type: 'button' } });
		add.addEventListener('click', () => this.guard(() => void this.openNewPerson()));
		// On a phone, Close is the only way out of the full-screen view, also after the last person is deleted.
		if (this.full) {
			const bar = root.createDiv({ cls: 'dynasty-toolbar', attr: { role: 'toolbar', 'aria-label': TOOLBAR_UI.region } });
			bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
			this.closeButton(bar);
		}
		this.updateEditUi();
		// A block in a callout in Live Preview has no section: it is found once it is in the note (see lateResolve).
		this.observer = new ResizeObserver(() =>
			this.guard(() => {
				this.lateResolve();
				this.updateEditUi();
			}),
		);
		this.observer.observe(box);
	}

	/**
	 * A phone, upright or on its side: a tree in a note is a list (D144), and the full-screen view has the D20 focus
	 * family. The screen decides, not the window: an on-screen keyboard makes a tablet's window lower than 600 px, but not its screen.
	 */
	private isPhone(): boolean {
		const win = this.containerEl.win;
		const screen = win.screen;
		return isPhoneWindow(this.coarse, screen?.width || win.innerWidth, screen?.height || win.innerHeight);
	}

	/**
	 * D126 (1): movement is reduced, by the setting or, with "Follow the device", by the device. Read from the view's own window
	 * (a pop-out window has its own media query) each time a movement starts, so a change of the device setting counts at once.
	 */
	private reduced(): boolean {
		const prefers = this.containerEl.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
		return reducedMotion(this.settings.reduceMotion, prefers);
	}

	/**
	 * The focus person to draw, or null for the whole tree (priority order: session focus,
	 * pin, the phone rule of D20, whole tree). Also updates the block state: it drops a session
	 * focus that no longer applies and stores the D20 automatic focus.
	 */
	private updateFocus(tree: Tree, whole: FamilyGraph): string | null {
		// D21: a full-screen view opened by a badge tap in a static embed shows that family, until the user chooses another focus there.
		const own = this.full?.focus;
		if (own && (own.id === null || whole.byId.has(own.id))) return own.id;
		const st = this.ensureState();
		const choice = chooseFocus({
			session: st.focus,
			pin: tree.options.focus,
			phone: this.isPhone(),
			auto: st.autoFocus,
			has: (id) => whole.byId.has(id),
			large: () => whole.people.length > PHONE_FOCUS_MIN_PEOPLE,
			// Spec §5.5: the person last edited, `options.start`, the first root. The marked person does not count here (D144: the family of a large tree's full-screen view); it only decides the first view (`startId`).
			start: () => startPerson(whole, [st.lastEdited, tree.options.start].find((id) => id != null && whole.byId.has(id)) ?? undefined),
		});
		if (choice.dropSession) st.focus = null;
		st.autoFocus = choice.auto;
		return choice.id;
	}

	/**
	 * Sets the session focus of this block (Focus, Focus here, a `+` badge; null: Clear focus)
	 * and draws every view of the block again with it (spec §5.6). Nothing is written.
	 */
	focusOn(id: string | null, target: string[] | null = null): void {
		const st = this.ensureState();
		if (id !== null && (this.full || !this.coarse)) TreeView.unfoldForFocus(this.host, st, id);
		TreeView.focusState(this.host, st, id, target, this);
	}

	/**
	 * Sets the session focus in a block's state and draws every view of that block again. Through
	 * the state, not a view: the view that opened a sheet can be gone (Obsidian draws a block again
	 * after each write), so the sheet acts on whatever views show the block now.
	 */
	static focusState(host: TreeHost, st: BlockState, id: string | null, target: string[] | null = null, origin: TreeView | null = null): void {
		st.focus = { id };
		// Any other change of the family starts a new Back trail of the phone list (D144).
		st.listBack = undefined;
		// A choice of the user replaces a pending "show the saved person", the finder's result (spec §13.2) and the Show view of a line of succession (contract 0.2.7 F.1).
		st.shown = null;
		st.finder = null;
		st.succession = null;
		TreeView.redrawState(host, st, { target, origin });
	}

	/**
	 * Every view whose block state is `st` draws its focus again (a choice of the user replaces a D21
	 * badge focus). Only `origin`, the view that ran Find or the problem list, gets `target`: the
	 * others just redraw (a static preview keeps its first view, D1). `except` does not redraw.
	 * `keepOwn` keeps the D21 own focus of full-screen views.
	 */
	static redrawState(host: TreeHost, st: BlockState, opts: RedrawOptions = {}): void {
		const { target = null, origin = null, except = null, keepOwn = false } = opts;
		for (const v of [...host.views]) {
			if (v.unloaded || v === except || v.peekState() !== st) continue;
			if (v.full && !keepOwn) v.full.focus = null;
			v.pendingTarget = v === origin ? target : null;
			v.syncFocus();
		}
	}

	/**
	 * A pin write is about to start: the D21 own focus of every full-screen view of the block ends,
	 * so the redraw after the write shows the new pin (or the default after Remove pin). Returns
	 * the way back, for a write that wrote nothing.
	 */
	static dropOwnFocus(host: TreeHost, st: BlockState): () => void {
		const dropped: [FullHost, { id: string | null }][] = [];
		for (const v of host.views) {
			const own = v.full?.focus;
			if (v.unloaded || !v.full || !own || v.peekState() !== st) continue;
			dropped.push([v.full, own]);
			v.full.focus = null;
		}
		return () => {
			for (const [full, own] of dropped) if (full.focus === null) full.focus = own;
		};
	}

	/** The block's focus changed: draw again. An embed under an open full-screen view of the block waits until it closes. */
	syncFocus(own = false): void {
		this.guard(() => {
			if (this.unloaded) return;
			if (!own && !this.full && FullScreenModal.isOpenFor(this.key)) {
				this.focusStale = true;
				return;
			}
			this.carry = null;
			this.render(this.fonts);
		});
	}

	/** Static touch embed (D1) or full-screen view: CSS decides the gestures and the toolbar place from these. */
	private placeClasses(root: HTMLElement): void {
		if (this.full) root.addClass('dynasty-full');
		else if (this.coarse) root.addClass('dynasty-static');
	}

	private updateHeight(): void {
		// The full-screen view fills the modal (spec §7.1).
		if (this.full) return;
		// A tree in a note on a phone is a list with its natural height (D144), so only the computer and the tablet have a height.
		const desktop = `${this.settings.embedHeightDesktop}px`;
		const h = this.dragHeight !== null ? `${this.dragHeight}px` : embedHeight(this.optionsHeight, false, { desktop, phone: desktop });
		this.viewport?.style.setProperty('--dynasty-height', h);
		// The bars stand above the drawing area, so a short box (`height: 100`) with a banner would leave it no room. The style sheet keeps a minimum for the area.
		const bars = `${Math.round(this.frameTop())}px`;
		if (bars !== this.barsPx) {
			this.barsPx = bars;
			this.viewport?.style.setProperty('--dynasty-bars', bars);
		}
	}

	/**
	 * Lays `g` out with its text measured first and its picture sets (`measuredLayout`): a name or a
	 * title text line that needs two text lines makes its card taller (D29, D37, D61); a card with arms
	 * measures its name beside them, and the portrait room follows "Show portraits on cards" (spec
	 * §13.6, §13.7, O10). "Show dates on cards" off leaves the reign out.
	 */
	private layOut(
		g: FamilyGraph,
		geo: Geometry,
		base: LayoutSettings,
		fonts: SceneOptions['fonts'],
		labels?: ReadonlyMap<string, CardLabel>,
		foldHidden?: ReadonlySet<string>,
	): MeasuredResult {
		const breaks = this.breakList();
		return measuredLayout(g, geo, base, {
			fonts,
			measure: measureText,
			labels,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			armsOnCards: this.settings.armsOnCards,
			...(foldHidden?.size ? { foldHidden } : {}),
			...(breaks.size ? { breaks } : {}),
			...(this.meId !== null ? { marked: this.meId } : {}),
		});
	}

	/** The user's break places (D118); `parseBreakList` keeps the last text, so this costs nothing when the setting is the same. */
	private breakList(): ReturnType<typeof parseBreakList> {
		return parseBreakList(this.settings.breakWords);
	}

	/** Draws a new layout of the note preview in place (D29): the viewport, toolbar and observers stay. */
	private redraw(g: FamilyGraph, laid: LaidOut): void {
		const last = this.lastLayout;
		if (!last || !this.panZoom) return;
		this.laid = laid;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.panZoom.setBounds(this.bounds);
		this.popover?.close();
		this.tips?.hide();
		this.live?.destroy();
		this.live = null;
		last.sceneEl.empty();
		this.scene = buildScene(last.sceneEl, g, laid, last.opts);
		this.markPositions();
		this.wireScene(this.scene);
		this.makeLive();
		if (this.lod && this.svg) this.svg.removeClass(lodClass(this.lod));
		this.lod = null;
		this.carry = null;
		this.firstDue = true;
		// S5i: the new scene shows its near cards in this task and runs its own idle chain (the old one stops: its scene is gone).
		const view = this.panZoom.view;
		if (view) this.fillNear(view);
		else this.syncPending();
		this.startIdleSoon();
	}

	/**
	 * D29, D37 after a web font loaded or the CSS changed: the names (and D61 the title text lines) are
	 * measured again, and if another set of cards needs two text lines, the tree is laid out again in place. The static touch preview
	 * shows its first view (D1); other views keep the same tree point at the centre (spec §7.5).
	 */
	private recheckTall(fresh = false): boolean {
		const last = this.lastLayout;
		const g = this.g;
		if (!last || !g || !this.panZoom) return false;
		// css-change: the widths cached for the same font text can belong to the face that was in use before.
		if (fresh) clearMeasureCache();
		const next = this.layOut(g, last.geo, last.settings, last.opts.fonts, last.opts.labels);
		const sameCards = sameTall(next.settings.tallCards, last.settings.tallCards) && sameTall(next.settings.tallTitles, last.settings.tallTitles) && sameTall(next.settings.longNames, last.settings.longNames);
		if (sameCards) {
			if (fresh) this.scene?.refit();
			return false;
		}
		const keep = this.keptAnchor();
		last.settings = next.settings;
		this.redraw(g, next.laid);
		if (keep) this.carry = keep;
		this.resized();
		return true;
	}

	/** The orientation that the window, the screen and the setting "Tree direction on a phone held upright" ask for now (D24, D150). */
	private orientationNow(): Orientation {
		const win = this.containerEl.win;
		return orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen, this.settings.phoneDirection);
	}

	/** The orientation the window asks for (D24) differs from the drawn one. */
	private turnDue(): boolean {
		// A list has no direction: a turn of the phone does not draw it again (D144).
		if (this.listMode) return false;
		return this.orientationNow() !== this.orientation;
	}

	/**
	 * The phone was turned (D24): lay the tree out again in the new orientation (a new layout, not a
	 * pan or zoom of the old one, so spec §7.6 holds). The full-screen view keeps the person nearest
	 * the centre at the centre, at the same zoom (spec §7.5); the static note preview has no view of
	 * its own to keep and shows the first view of the new orientation (D1).
	 */
	private checkTurn(): void {
		if (this.unloaded || !this.turnDue()) return;
		if (!this.laid) {
			// An empty block or a block with an error has nothing to lay out: only its orientation changes.
			this.orientation = this.orientationNow();
			for (const e of Array.from(this.containerEl.querySelectorAll('[data-dynasty-orientation]'))) e.setAttribute('data-dynasty-orientation', this.orientation);
			return;
		}
		const a = this.full ? this.anchor() : null;
		this.carry = a ? { ...a, dx: 0, dy: 0, bandClear: false } : null;
		this.render(this.fonts);
	}

	private resized(): void {
		const svg = this.svg;
		try {
			this.resizedNow();
		} finally {
			// S7: whatever this resize did, the tree shows in the next frame. That frame comes after the one that the pan and zoom
			// code asked for in this call, so the first view is already written when the svg shows. Only the svg that was here
			// at the start: a new render has its own first view to wait for.
			const win = this.containerEl.win;
			if (svg) {
				win.requestAnimationFrame(() => {
					if (svg === this.svg) this.showTree();
				});
			}
		}
	}

	private resizedNow(): void {
		const vp = this.viewport;
		const pz = this.panZoom;
		if (!vp || !pz || !this.laid) return;
		if (this.turnDue()) {
			this.checkTurn();
			return;
		}
		if (this.foldsStale && vp.clientWidth > 0) {
			this.carry = this.keptAnchor();
			this.render(this.fonts);
			return;
		}
		this.updateHeight();
		this.updateEditUi();
		// The first resize comes once the block is in the note, inside its callout if it has one.
		this.readThemeSoon(vp);
		const size = { w: vp.clientWidth, h: vp.clientHeight - this.frameTop(vp) };
		// A box with a width but no height yet: `firstDue` stays, so the next sized resize shows the first view.
		if (size.w <= 0 || size.h <= 0) return;
		const first = pz.view === null || this.firstDue;
		this.firstDue = false;
		const oldSize = pz.size;
		pz.resize(size);
		this.measureInsets(vp);
		if (!first) {
			// Resize or rotation: the same tree point stays at the centre (spec §7.5).
			const now = pz.view;
			if (now && !pz.busy) {
				const v = resizeView(now, oldSize, size, pz.limits);
				if (v.scale !== now.scale || v.cx !== now.cx || v.cy !== now.cy) pz.setView(v);
				// The same view in a larger box: no settle comes, but the cards that now show need their pictures.
				else {
					this.showPictures(now);
					this.fillNear(now);
				}
			}
			return;
		}
		this.lateResolve();
		// The first render may run before the block is in the document, with the body's fonts.
		// Once attached, the block's own fonts count (a CSS snippet can scope them).
		const attached = this.blockFonts();
		if (this.fonts && fontsChanged(attached, this.fonts)) {
			this.rerender(attached);
			return;
		}
		this.pickFinderDirection(size);
		let carried = this.carry ? this.fromAnchor(this.carry) : null;
		const carriedByUser = this.carry?.byUser ?? false;
		// Larger cards around the same centre can reach up under the toolbar; if none was there
		// before, move the view down just enough.
		if (carried && this.carry?.bandClear) carried = this.clearTop(carried, size, [...this.laid.layout.persons.values()]);
		this.carry = null;
		const st = this.ensureState();
		const targets = this.full?.target ? [this.full.target] : (this.pendingTarget ?? []);
		const targetBox = targets.length ? this.laid.layout.persons.get(targets[0]) : undefined;
		if (this.full) this.full.target = null;
		this.pendingTarget = null;
		if (carried) pz.setView(carried, { byUser: carriedByUser });
		else if (targetBox) {
			// A far-couple tag on a touch embed opened this view (spec §0 D17), or Find or the problem
			// list chose people outside the focus family: centre on the (first) person.
			pz.setView(this.centreFree(centreOn(this.firstView(this.laid, size), targetBox, this.laid.layout.geometry.fontPx)), { byUser: true });
			this.highlight(targets);
		}
		// The touch embed is a static preview that always shows the default view (spec §7.2).
		else {
			const saved = this.savedView(st);
			if (saved && (this.full || !this.coarse)) pz.setView(saved);
			else {
				const v = this.firstView(this.laid, size);
				// D28: set before the view, so its settle counts the children outside the box.
				this.hintOn = this.laid.layout.orientation === 'sideways';
				pz.setView(v);
			}
		}
		this.markInteractive();
		this.keepHeight();
		this.startPictures();
		this.showEdited(st);
		this.takeFocus();
	}

	/**
	 * D212 (bars-in-flow): the screen px from the top of the tree box to the top of the drawing area. In a note the toolbar and the banner stand above the
	 * tree, so this is the foot of the last of them; in the full-screen view they lie over the tree and it is 0. The pan and zoom code works in the drawing area.
	 */
	private frameTop(vp: HTMLElement | null = this.viewport): number {
		if (!vp?.hasClass('is-flow')) return 0;
		let bottom = 0;
		for (const bar of Array.from(vp.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-result'))) {
			const end = bar.offsetTop + bar.offsetHeight;
			if (Number.isFinite(end)) bottom = Math.max(bottom, end);
		}
		return bottom;
	}

	/**
	 * The toolbar bands that views chosen by the plugin keep free: at the top, or at the bottom for
	 * the full-screen toolbar on a phone (spec §7.5). In a note the bars are above the drawing area (`frameTop`), so nothing is kept free.
	 */
	private measureInsets(vp: HTMLElement): void {
		if (vp.hasClass('is-flow')) {
			this.insetTop = 0;
			this.insetBottom = 0;
			this.barBox = null;
			return;
		}
		const bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		const atBottom = !!bar && bar.offsetTop > vp.clientHeight / 2;
		// With the toolbar at the bottom, the top band is the phone's status bar or notch (safe area).
		this.insetTop = bar && !atBottom ? bar.offsetTop + bar.offsetHeight + 4 : this.full ? safeTop(this.safeProbe) : 0;
		this.insetBottom = bar && atBottom ? vp.clientHeight - bar.offsetTop + 4 : 0;
		// Spec §13.2: the finder's result bar is at the top of the view; a view chosen by the plugin keeps it free too.
		const result = vp.querySelector<HTMLElement>(':scope > .dynasty-result');
		if (result && result.offsetHeight > 0) this.insetTop = Math.max(this.insetTop, result.offsetTop + result.offsetHeight + 4);
		this.barBox = bar && !atBottom && Number.isFinite(bar.offsetLeft) && bar.offsetWidth > 0 ? { left: bar.offsetLeft, right: bar.offsetLeft + bar.offsetWidth, top: bar.offsetTop, bottom: bar.offsetTop + bar.offsetHeight + 4 } : null;
	}

	/**
	 * D51, D203 item 2: the first view of the finder's small tree on an upright phone draws it top to bottom, in the free area below the
	 * result bar and above the toolbar (before 0.2.8 the direction with the larger names won).
	 * The other layout replaces the drawn one in place; the window's orientation stays the view's own,
	 * so the D24 turn logic sees no turn.
	 */
	private pickFinderDirection(size: Size): void {
		const alt = this.finderAlt;
		this.finderAlt = null;
		const now = this.laid;
		const g = this.g;
		const last = this.lastLayout;
		if (!alt || !now || !g || !last) return;
		const top = Math.max(0, Math.min(this.insetTop, size.h - 1));
		const area = { w: size.w, h: Math.max(1, size.h - top - Math.max(0, this.insetBottom)) };
		const facts = (l: LaidOut) => ({ bounds: treeBounds(l.layout.width, l.layout.height), fontPx: l.layout.geometry.fontPx });
		// 0.2.8 (D203 item 2): on a phone the line of the finder is always drawn top to bottom (the whole tree stays sideways); elsewhere the larger names decide.
		if (!this.isPhone() && finderOrientation(area, facts(now), facts(alt.laid)) !== alt.laid.layout.orientation) return;
		last.settings = alt.settings;
		// The geometry follows the direction too: a later layout of this tree (a font change) must not mix the text card with a top-to-bottom tree.
		last.geo = alt.geo;
		this.redraw(g, alt.laid);
		this.firstDue = false;
		this.viewport?.parentElement?.setAttribute('data-dynasty-orientation', alt.laid.layout.orientation);
	}

	/** A view chosen for the area above the bottom toolbar, shown in the whole viewport. */
	private aboveBottomBar(size: Size, make: (area: Size) => View): View {
		const b = Math.max(0, Math.min(this.insetBottom, size.h - 1));
		if (!b) return make(size);
		const v = make({ w: size.w, h: size.h - b });
		return v.scale > 0 ? { scale: v.scale, cx: v.cx, cy: v.cy + b / 2 / v.scale } : v;
	}

	/** Called when the full-screen view closes: a desktop embed of the same block shows the view state it left (spec §7.1). */
	adoptView(): void {
		if (this.focusStale && !this.full) {
			this.syncFocus(true);
			return;
		}
		this.guard(() => {
			const pz = this.panZoom;
			const st = this.peekState();
			const v = st ? this.savedView(st) : null;
			if (this.full || this.coarse || !pz?.view || !v) return;
			pz.setView(v);
		});
	}

	/** After an edit, the edited person is highlighted briefly and panned into view if off screen (spec §5.5). */
	private showEdited(st: BlockState): void {
		const hl = st.highlight;
		if (!hl || performance.now() > hl.until) return;
		const box = this.laid?.layout.persons.get(hl.id);
		if (!box) return;
		this.fillPerson(hl.id);
		this.reveal(box);
		this.highlight([hl.id]);
	}

	/** The view a tree opens with: the focus view (D18, §5.6) in focus mode, else the default view (§5.5). */
	private firstView(laid: LaidOut, size: Size): View {
		if (this.finderDrawn?.line) return this.finderView(laid, size, this.finderDrawn);
		if (this.successionDrawn) return this.successionView(laid, size, this.successionDrawn);
		const id = this.focusId;
		if (laid.layout.orientation === 'sideways') return this.sidewaysFirst(laid, size, id ?? this.startId());
		if (id === null) return this.defaultViewFor(laid, size);
		const persons = laid.layout.persons;
		const me = persons.get(id) ?? null;
		const children = this.g ? boxesOf(persons, familyOf(this.g, id).children) : [];
		// D23: with no parent drawn above, the person sits near the top (D13), not in the middle of an empty view.
		const parentIds = this.g?.placementParents.get(id) ?? [];
		const atTop = !parentIds.length;
		const parents = boxesOf(persons, parentIds);
		const v = this.aboveBottomBar(size, (area) => focusView(this.bounds, area, laid.layout.geometry.fontPx, me, this.insetTop, children, atTop, parents));
		// Not clearBand (which clears the whole width): only the cards and badges under the toolbar
		// itself move the view down, and never so far that the focus card leaves the free area.
		// With no toolbar over the tree (a note, D212) the top card is whole when nothing is cut by the top of the drawing area.
		if (!this.barBox) return this.keepTopWhole(v, size, laid, me ? [me] : []);
		const boxes = [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)];
		return clearToolbar(v, size, this.barBox, boxes, me, size.h - this.insetBottom);
	}

	/** Start person (spec §5.5, G.4): the person last edited in this block, else options.start, else the marked person ("You"), else the first root. */
	private startId(): string | null {
		const g = this.g;
		if (!g) return null;
		const edited = this.peekState()?.lastEdited ?? null;
		return startPerson(g, [edited, this.optionsStart, this.meId].find((id) => id != null && g.byId.has(id)) ?? undefined);
	}

	/**
	 * First view in `sideways` (D24), for a focus family and a whole tree alike: see `sidewaysView`.
	 * The top of the free area is below the toolbar box in the note and the safe area in full screen;
	 * its bottom is above the full-screen toolbar on a phone.
	 */
	private sidewaysFirst(laid: LaidOut, size: Size, id: string | null): View {
		const persons = laid.layout.persons;
		const g = this.g;
		const fam = id !== null && g ? familyOf(g, id) : null;
		// Children drawn next to the person: a child placed with other parents is drawn elsewhere.
		const kids = fam && g ? fam.children.filter((c) => (g.placementParents.get(c) ?? []).includes(id!)) : [];
		// Far partners (D10) are drawn elsewhere and shown by a tag: not part of the group.
		const near = (who: string, partners: string[]) => {
			const far = laid.layout.farTags.get(who)?.spouses ?? [];
			return partners.filter((p) => !far.includes(p));
		};
		const top = Math.max(0, Math.min(this.insetTop, size.h - 1));
		const bottom = Math.max(top + 1, size.h - this.insetBottom);
		const me = id !== null ? (persons.get(id) ?? null) : null;
		this.hintKids = boxesOf(persons, kids);
		const view = sidewaysView(
			size,
			laid.layout.geometry.fontPx,
			{
				me,
				partners: fam && id !== null ? boxesOf(persons, near(id, fam.partners)) : [],
				children: g ? kids.flatMap((c) => boxesOf(persons, [c]).map((card) => ({ card, partners: boxesOf(persons, near(c, familyOf(g, c).partners)) }))) : [],
				parents: id !== null && g ? boxesOf(persons, g.placementParents.get(id) ?? []) : [],
			},
			top,
			bottom,
			{ x: 0, y: 0, w: 0, h: 0 },
		).view;
		// The group starts below the toolbar box, but a card above it in the children's column (or above a
		// tall group's person) can reach under the note's toolbar: move down, as D18 does.
		if (!this.barBox) return this.keepTopWhole(view, size, laid, me ? [me] : []);
		return clearToolbar(view, size, this.barBox, [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)], me, bottom);
	}

	private defaultViewFor(laid: LaidOut, size: Size): View {
		const start = this.startId();
		const persons = laid.layout.persons;
		const startBox = start ? (persons.get(start) ?? null) : null;
		const fam = start && this.g ? familyOf(this.g, start) : null;
		const family = fam ? { partners: boxesOf(persons, fam.partners), children: boxesOf(persons, fam.children) } : null;
		// 0.2.8 (G.4): the readable view of a note shows the row of the parents above the start person.
		const parents = start && this.g ? boxesOf(persons, this.g.placementParents.get(start) ?? []) : [];
		return this.aboveBottomBar(size, (area) => {
			const v0 = defaultView(this.bounds, area, laid.layout.geometry.fontPx, startBox, this.insetTop, family);
			const v = startBox ? parentsAbove(v0, area, this.insetTop, startBox, parents) : v0;
			// A toolbar taller than the gap between rows could still reach the row above the start person.
			return this.clearTop(v, area, [...persons.values()], startBox ? [startBox] : []);
		});
	}

	/**
	 * Moves a view down just enough that no card is under the bars over the tree (the full-screen view), or cut by the top of the drawing area when the bars stand
	 * above it (a note, D212 `bars-in-flow`).
	 */
	private clearTop(v: View, size: Size, boxes: Rect[], keys: readonly Rect[] = []): View {
		return this.insetTop > 0 ? clearBand(v, size, this.insetTop, boxes) : keepTopCardWhole(v, size, 0, size.h, boxes, keys);
	}

	/** True when `clearTop` would not move the view. */
	private topClear(v: View, size: Size, boxes: Rect[]): boolean {
		return this.insetTop > 0 ? bandShift(v, size, this.insetTop, boxes) === 0 : keepTopCardWhole(v, size, 0, size.h, boxes, []) === v;
	}

	/** Sets the level of detail class for `view`; true when the level changed. */
	private applyLod(view: View): boolean {
		const svg = this.svg;
		const laid = this.laid;
		if (!svg || !laid) return false;
		const lod = chooseLod(this.lod, view.scale * laid.layout.geometry.fontPx);
		if (lod === this.lod) return false;
		// R026 fit: the groups leave first, so the class change below has nothing to restyle in them (and a lazy card that fills at Overview does not put its group back).
		if (lod === 'overview') this.scene?.setDetail(false);
		if (this.lod) svg.removeClass(lodClass(this.lod));
		svg.addClass(lodClass(lod));
		if (this.lod === 'overview' || this.lod === null) this.scene?.setDetail(true);
		this.lod = lod;
		return true;
	}

	/** The handler of a press or key on a fold control. */
	private foldAct(f: FoldRef): (e: Event) => void {
		return (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			// I37: only a key press gets its fold control back with the keyboard focus after the redraw; a tap or a click leaves no focus ring on it.
			this.foldByKey = e.type === 'keydown' || (e as MouseEvent).detail === 0;
			this.guard(() => this.toggleFold(f.control));
		};
	}

	/** Wires the tap area of a control; the scene calls it once, when the control is filled. */
	private wireFoldHit(f: FoldRef): void {
		const hit = f.hit;
		if (!hit) return;
		// The level of detail hides an open button and its tap area together (styles.css).
		hit.addClass(f.control.folded ? 'is-folded' : 'is-open');
		hit.addEventListener('click', this.foldAct(f));
		hit.addEventListener('pointerenter', () => f.el.addClass('is-hover'));
		hit.addEventListener('pointerleave', () => f.el.removeClass('is-hover'));
	}

	/**
	 * Gives the open controls near `view` their drawing and tap area (they start as empty shells: 600 extra
	 * elements slowed the first view by 12 %). The rest follow in idle chunks, so a pan never meets an empty control.
	 */
	private fillFolds(view: View): void {
		const scene = this.scene;
		const vp = this.viewport;
		if (!scene || !vp || view.scale <= 0) return;
		const area = this.panZoom?.size ?? { w: vp.clientWidth, h: vp.clientHeight };
		const w = area.w / view.scale;
		const h = area.h / view.scale;
		let filled = false;
		for (const f of scene.folds) {
			if (f.filled) continue;
			const { x, y } = f.control.spot;
			if (Math.abs(x - view.cx) <= w && Math.abs(y - view.cy) <= h) {
				f.fill();
				filled = true;
			}
		}
		if (filled) this.placeFolds(view);
	}

	/** Fold controls or card content still wait for the idle chain. A static phone preview has no idle fill of cards (S5g). */
	private idleWork(scene: Scene): boolean {
		return scene.folds.some((f) => !f.filled) || ((!!this.full || !this.coarse) && (scene.fill.pending > 0 || scene.fill.pendingLines > 0));
	}

	/**
	 * S5g: starts the one idle chain of the scene after its first view has been drawn and had its frames (the same
	 * moment as the pictures). A chain that already runs for this scene is left alone.
	 */
	private startIdleSoon(): void {
		const scene = this.scene;
		if (!scene || this.idleScene === scene || !this.idleWork(scene)) return;
		const win = this.containerEl.win;
		// Two frames, as for the pictures; the first chunk then waits for idle time by itself.
		win.requestAnimationFrame(() =>
			win.requestAnimationFrame(() =>
				this.guard(() => {
					if (!this.unloaded && this.scene === scene) this.startIdle(scene);
				}),
			),
		);
	}

	private startIdle(scene: Scene): void {
		if (this.idleScene === scene || !this.idleWork(scene)) return;
		this.idleScene = scene;
		const step = (idle: { timeRemaining(): number }) => {
			if (this.unloaded || this.scene !== scene) return;
			this.guard(() => {
				const pz = this.panZoom;
				// A gesture is running: ask again, never drop the chain.
				if (pz?.busy) {
					later(step);
					return;
				}
				// The M10 fold controls go first, and the two kinds never share one idle callback.
				let n = 0;
				for (const f of scene.folds) {
					if (f.filled) continue;
					f.fill();
					if (++n >= 40 || idle.timeRemaining() < IDLE_STOP_MS) break;
				}
				const v = pz?.view;
				if (n) {
					if (v) this.placeFolds(v);
				} else if (scene.fill.pending > 0 || scene.fill.pendingLines > 0) {
					const rect = v && pz ? visibleRect(v, pz.size) : null;
					// No view yet: the first draw or the next settle starts the chain again.
					if (!rect) {
						this.idleScene = null;
						return;
					}
					scene.fill.fillChunk(rect, IDLE_CARDS_PER_CHUNK);
					this.syncPending();
				}
				if (this.idleWork(scene)) later(step);
				// R026 fit: the work can come back (a level change puts the card groups back), so the next start must not be blocked.
				else this.idleScene = null;
			});
		};
		later(step);
	}

	/** The delayed card content near `view` (S3, S5a, S5b). A view with no size has no near part: the first draw or settle fills it. */
	private fillNear(view: View): void {
		this.learnRadius();
		const pz = this.panZoom;
		const scene = this.scene;
		if (!pz || !scene) return;
		const rect = visibleRect(view, pz.size);
		if (rect) scene.fill.fillNear(rect);
		this.syncPending();
	}

	/** The content of one person's card, badge and tags now (S5c to S5f): before a focus, a highlight, a reveal or the sheet. */
	private fillPerson(id: string): void {
		this.learnRadius();
		this.scene?.fill.fillPerson(id);
		this.syncPending();
	}

	/** T1: the root tells the harness how many cards, tags and badges wait for their content. */
	private syncPending(): void {
		const root = this.viewport?.parentElement;
		const scene = this.scene;
		if (!root || !scene) return;
		const n = String(scene.fill.pending);
		if (root.getAttribute('data-dynasty-cards-pending') !== n) root.setAttribute('data-dynasty-cards-pending', n);
		const lines = String(scene.fill.pendingLines);
		if (root.getAttribute('data-dynasty-lines-pending') !== lines) root.setAttribute('data-dynasty-lines-pending', lines);
	}

	/** S7: the tree's svg shows. Safe to repeat and never throws, so that an error path can call it. */
	private showTree(): void {
		try {
			if (this.canvasEl) this.canvasEl.hidden = false;
		} catch {
			// A tree that stays hidden is worse than any message; nothing else to do here.
		}
	}

	/** S5a: the first write of the scene transform is done: the cards near the view get their content, then the tree shows. */
	private firstDraw(view: View): void {
		try {
			this.fillNear(view);
		} finally {
			this.showTree();
		}
	}

	/** S8: the parse of a block text, shared through the host's cache. The caller must not change the result. */
	private parse(text: string): ParseResult {
		return this.host.parseCache?.get(this.sourcePath, text) ?? parseDynasty(text);
	}

	/**
	 * F7: the tap areas of the fold controls at `view`'s zoom: 44 screen px, centred on the mark that shows at the
	 * level (the Overview sign is larger), and cut back where they meet a far-couple tag or a `+` badge. A card wins
	 * over a tap area by its place in the hit layer.
	 */
	private placeFolds(view: View): void {
		const overview = this.lod === 'overview';
		const fontPx = this.laid?.layout.geometry.fontPx ?? 0;
		for (const f of this.scene?.folds ?? []) {
			// An unfilled control has no tap area yet; `fillFolds` places it after it fills.
			if (!f.filled || !f.hit) continue;
			let visible = overview && f.markOverview ? f.markOverview : f.mark;
			// The Overview sign keeps a readable size on screen: it grows about its spot (its left edge stays), like the hit areas.
			const boost = overview && f.markOverview && fontPx > 0 && view.scale > 0 ? Math.min(MAX_SIGN_BOOST, Math.max(1, MIN_SIGN_TEXT_PX / (FOLD_EM.signTextOverview * fontPx * view.scale))) : 1;
			const { x: sx, y: sy } = f.control.spot;
			if (boost > 1) {
				f.el.setAttribute('transform', `translate(${sx} ${sy}) scale(${boost}) translate(${-sx} ${-sy})`);
				visible = { x: sx + (visible.x - sx) * boost, y: sy + (visible.y - sy) * boost, w: visible.w * boost, h: visible.h * boost };
			} else f.el.removeAttribute('transform');
			const r = cutBack(foldHit(visible, view.scale, fontPx), visible, this.tapAreas);
			f.hit.setAttribute('x', String(r.x));
			f.hit.setAttribute('y', String(r.y));
			f.hit.setAttribute('width', String(r.w));
			f.hit.setAttribute('height', String(r.h));
		}
	}

	private settled(view: View, byUser: boolean): void {
		const laid = this.laid;
		if (!this.svg || !laid) return;
		// D145: a pan or zoom moves the card, so the tip goes; a card that got the keyboard focus during the move gets its tip now.
		this.tips?.hide();
		this.tips?.shown();
		this.applyLod(view);
		this.showPictures(view);
		// Tag hit areas stay at least 44 screen px at low zoom (spec §7.5, the decision notes).
		const place = (hit: SVGRectElement, r: Rect) => {
			hit.setAttribute('x', String(r.x));
			hit.setAttribute('y', String(r.y));
			hit.setAttribute('width', String(r.w));
			hit.setAttribute('height', String(r.h));
		};
		// D31: in `down` the tap area hangs below its card; `sideways` hit areas already do.
		const down = laid.layout.orientation !== 'sideways';
		const areas: Rect[] = [];
		for (const t of this.scene?.tags ?? []) {
			const r = down ? tagHitBelow(t.tag.hit, laid.layout.persons.get(t.tag.person), view.scale) : enlargeHit(t.tag.hit, view.scale);
			place(t.hit, r);
			areas.push(r);
		}
		// The same for the `+` badges of focus mode (spec §7.5, contract 4.2): the square below the cards, capped (the layout's node gap in
		// `sideways`, half the own card in `down`) and clipped at the tag tap areas of the other people; the disc above the cards.
		const geo = laid.layout.geometry;
		const tagHits = [...laid.layout.farTags.values()];
		for (const b of this.scene?.badges ?? []) {
			const cap = down ? (laid.layout.persons.get(b.person)?.h ?? geo.cardH) / 2 : geo.nodeGap;
			const { square, disc } = badgeTap(b.mark, view.scale, geo.fontPx, cap, tagHits.filter((t) => t.person !== b.person).map((t) => t.hit));
			place(b.hit, square);
			b.disc.setAttribute('d', discPath(disc.cx, disc.cy, disc.r, disc.top));
			// A fold control's tap area gives way to the disc only; elsewhere in the square the fold control wins (contract 4.2 E1).
			const top = Math.max(disc.top, disc.cy - disc.r);
			areas.push({ x: disc.cx - disc.r, y: top, w: 2 * disc.r, h: disc.cy + disc.r - top });
		}
		this.tapAreas = areas;
		this.fillFolds(view);
		this.fillNear(view);
		this.placeFolds(view);
		this.startIdleSoon();
		if (byUser) {
			this.storeView(view);
			this.hintOn = false;
		}
		this.updateHint(view);
	}

	/**
	 * D28: on the upright phone, the first view names the person's children whose cards it leaves outside
	 * the box: "↑ 1 more child" at the top edge (left of the note's toolbar), "↓ 3 more children" at the
	 * bottom edge (above the full-screen toolbar). A plain label, not a button. It goes when the user
	 * moves the view.
	 */
	private updateHint(view: View): void {
		const vp = this.viewport;
		const pz = this.panZoom;
		if (!vp) return;
		let counts = { up: 0, down: 0 };
		if (this.hintOn && pz && this.laid?.layout.orientation === 'sideways') {
			const size = pz.size;
			// 0.2.8: the toolbar is a band over the full width, so the free area starts below it.
			const top = Math.max(0, this.insetTop);
			counts = outsideBox(view, size, this.hintKids, top, size.h - this.insetBottom);
		}
		for (const dir of ['up', 'down'] as const) {
			// No element is added after the draw: only the classes of the slot change.
			const el = vp.querySelector<HTMLElement>(`:scope > .dynasty-hint-slot[data-dir="${dir}"]`);
			if (!el) continue;
			const n = counts[dir];
			const text = n ? HINT_UI[dir](n) : '';
			if (el.hasClass('dynasty-hint') !== !!n) {
				el.toggleClass('dynasty-hint', !!n);
				el.toggleClass(`dynasty-hint-${dir}`, !!n);
			}
			if (el.getText() !== text) el.setText(text);
		}
		this.placeHints();
	}

	/**
	 * Puts the D28 hints beside the toolbar as it is now: the note's toolbar gets its Add person button
	 * only when the block's handle is known, after the first view.
	 */
	private placeHints(): void {
		const vp = this.viewport;
		const up = vp?.querySelector<HTMLElement>(':scope > .dynasty-hint-up') ?? null;
		const down = vp?.querySelector<HTMLElement>(':scope > .dynasty-hint-down') ?? null;
		if (!vp || (!up && !down)) return;
		// 0.2.8: the toolbar is a band over the full width, so the hint at the top stands below the bands that the view keeps free.
		up?.style.setProperty('--dynasty-hint-top', `${this.frameTop(vp) + Math.max(0, this.insetTop) + 4}px`);
		down?.style.setProperty('--dynasty-hint-bottom', `${this.insetBottom + 4}px`);
	}

	private storeView(view: View): void {
		// The finder's tree and the Show view are not the family: after Close the family's own saved view comes back (spec §13.2, contract 0.2.7 F.2).
		if (this.finderDrawn?.line || this.successionDrawn) return;
		const st = this.ensureState();
		st.view = view;
		st.viewFor = this.drawnKey ?? '';
		st.views[this.orientation] = { view, viewFor: st.viewFor };
	}

	/** The saved view of the drawn family in the drawn orientation (D24: kept per orientation), or null. */
	private savedView(st: BlockState): View | null {
		const s = st.views[this.orientation];
		return s && s.viewFor === this.drawnKey ? s.view : null;
	}

	private cardLink(p: Person): CardLink | null {
		// On a touch-first device the whole card is one tap target; the edit sheet opens the note (§5.2).
		if (this.coarse) return null;
		const linktext = linkTarget(p.link);
		if (!linktext) return null;
		const dest = this.host.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), this.sourcePath);
		return { linktext, resolved: dest !== null };
	}

	/**
	 * Opens a note (a linked name, the source note). The full-screen view closes first, so the note
	 * does not open behind it, and the tree note keeps its scroll position (spec §5.2, §7.1).
	 */
	private openNote(open: () => Promise<void>): void {
		const go = () => void open().catch((err) => console.error('Dynasty Tree: cannot open the note', err));
		if (this.full) this.full.leave(go);
		else go();
	}

	/** S5c: the element that got the focus is a card, tag or badge shell: it gets its content before the view moves to it. */
	private fillFocused(target: EventTarget | null): void {
		const id = (target as Element | null)?.getAttribute?.('data-person');
		if (id) this.fillPerson(id);
	}

	private wireScene(scene: Scene): void {
		for (const [nameEl, linktext] of scene.links) {
			nameEl.addEventListener('click', (e) => {
				this.guard(() => {
					e.preventDefault();
					e.stopPropagation();
					const where = Keymap.isModEvent(e);
					this.openNote(() => this.host.app.workspace.openLinkText(linktext, this.sourcePath, where));
				});
			});
			nameEl.addEventListener('auxclick', (e) => {
				if (e.button !== 1) return;
				this.guard(() => {
					e.preventDefault();
					this.openNote(() => this.host.app.workspace.openLinkText(linktext, this.sourcePath, 'tab'));
				});
			});
			nameEl.addEventListener('mouseover', (e) => {
				this.guard(() => {
					this.host.app.workspace.trigger('hover-link', {
						event: e,
						source: HOVER_SOURCE,
						hoverParent: this,
						targetEl: nameEl,
						linktext,
						sourcePath: this.sourcePath,
					});
				});
			});
		}
		for (const [id, card] of scene.cards) {
			card.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				this.guard(() => this.activate(id));
			});
			card.addEventListener('focus', () => this.guard(() => this.keyFocus() && this.revealPerson(id)));
		}
		for (const t of scene.tags) {
			const act = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
				this.guard(() => this.tagActivated(t.tag.spouses, t.el, t.hit));
			};
			t.el.addEventListener('click', act);
			t.hit.addEventListener('click', act);
			// The pill shows the hover of its tap area too, which is not inside the tag's element.
			t.hit.addEventListener('pointerenter', () => t.el.addClass('is-hover'));
			t.hit.addEventListener('pointerleave', () => t.el.removeClass('is-hover'));
			t.el.addEventListener('focus', () => this.guard(() => this.keyFocus() && this.reveal(t.tag.hit)));
			t.el.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') act(e);
			});
		}
		// M10 (F6, F7, F16): the fold buttons and "+ N" signs. Both the visible group and the tap area toggle; Enter and Space too.
		for (const f of scene.folds) {
			const act = this.foldAct(f);
			f.el.addEventListener('click', act);
			f.el.addEventListener('focus', () => {
				this.guard(() => {
					// Fill first: the drawing and tap area must exist before the view moves to the control.
					if (!f.filled) {
						f.fill();
						const v = this.panZoom?.view;
						if (v) this.placeFolds(v);
					}
					return this.keyFocus() && this.reveal(f.mark);
				});
			});
			f.el.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') act(e);
			});
		}
		// A `+` badge refocuses on its person and opens no sheet (spec §5.6).
		for (const b of scene.badges) {
			const act = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
				// D21: a static touch embed does not change; the full-screen view opens on that family. A badge is a
				// focus choice (D22), so it also ends a result of the finder that a full-screen view left open.
				this.guard(() => {
					if (this.full || !this.coarse) {
						this.focusOn(b.person);
						return;
					}
					const st = this.peekState();
					if (st) {
						const hadShow = st.succession !== null;
						st.finder = null;
						st.succession = null;
						if (hadShow) TreeView.listRedraw(this.host, st);
					}
					void this.openFull(null, b.person);
				});
			};
			b.el.addEventListener('click', act);
			// The square lies below the cards, outside the group: it acts alike and shows the hover on the badge, as a tag's tap area does.
			b.hit.addEventListener('click', act);
			b.hit.addEventListener('pointerenter', () => b.el.addClass('is-hover'));
			b.hit.addEventListener('pointerleave', () => b.el.removeClass('is-hover'));
			b.el.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') act(e);
			});
			b.el.addEventListener('focus', () => this.guard(() => this.keyFocus() && this.reveal(b.mark)));
		}
	}

	/**
	 * A mouse click, a touch or pen tap, or Enter on a card opens the edit sheet (spec §5.2, §7.2).
	 * A tap acts at once on release; the click that the browser sends after it is ignored. A pan
	 * never counts: PanZoom swallows the click after a mouse drag; a touch drag scrolls the note (embed)
	 * or moves past the 8 px threshold at some point (full screen).
	 */
	private wireCardPresses(viewport: HTMLElement): void {
		const person = (t: EventTarget | null) => ((t as Element | null)?.closest?.('.dynasty-card') as Element | null)?.getAttribute('data-person') ?? null;
		viewport.addEventListener('pointerdown', (e) => {
			// A second finger makes the press a pinch, never a tap (spec §7.2).
			if (!e.isPrimary) this.tap = null;
			if (e.pointerType === 'mouse' || !e.isPrimary) return;
			const id = person(e.target);
			this.tap = id ? { pointer: e.pointerId, x: e.clientX, y: e.clientY, person: id } : null;
		});
		// Once the finger has moved past the threshold, the press is a pan, even if it comes back to its start (spec §7.2).
		viewport.addEventListener('pointermove', (e) => {
			const t = this.tap;
			if (t && t.pointer === e.pointerId && isPan(e.clientX - t.x, e.clientY - t.y)) this.tap = null;
		});
		viewport.addEventListener('pointerup', (e) => {
			const t = this.tap;
			this.tap = null;
			if (!t || t.pointer !== e.pointerId || isPan(e.clientX - t.x, e.clientY - t.y)) return;
			this.lastTap = performance.now();
			this.guard(() => this.activate(t.person, true));
		});
		viewport.addEventListener('pointercancel', () => (this.tap = null));
		// Cancels the click and mouse events the browser makes from the tap, so they cannot reach the new sheet.
		viewport.addEventListener(
			'touchend',
			(e) => {
				if (performance.now() - this.lastTap < 50) e.preventDefault();
			},
			{ passive: false },
		);
		viewport.addEventListener('click', (e) => {
			if (performance.now() - this.lastTap < 800) return;
			const id = person(e.target);
			if (id) this.guard(() => this.activate(id));
		});
	}

	private activate(id: string, fromTap = false): void {
		if (this.readOnly || this.inForeignView()) return;
		this.fillPerson(id);
		void this.openSheet(id, fromTap);
	}

	private async openSheet(id: string, fromTap: boolean): Promise<void> {
		// A read-only embed never opens the edit sheet, also when a window calls this directly (G.7).
		if (this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly) return;
		const sheet = EditSheet.create(this.host.app, {
			handle: h,
			personId: id,
			sourcePath: this.sourcePath,
			beforeWrite: () => this.keepView(),
			fromTap,
			place: this.full ? 'full' : 'embed',
			openNote: (open) => this.openNote(open),
			focus: {
				here: (person) => {
					if (this.full || !this.coarse) TreeView.unfoldForFocus(this.host, h.state, person);
					TreeView.focusState(this.host, h.state, person);
				},
				changed: () => TreeView.redrawState(this.host, h.state, { keepOwn: true }),
				pinning: () => TreeView.dropOwnFocus(this.host, h.state),
			},
			finder: { show: (first, second) => TreeView.showFinder(this.host, h.state, first, second, this) },
			folds: this.sheetFolds(h),
			pictures: this.host.pictures,
			relationOptions: this.relationOptions,
		});
		if (!sheet) {
			new Notice(WRITE_TEXT.personNotFound);
			return;
		}
		sheet.open();
	}

	/** Toolbar "Add person" and "Add first person": a sheet for a new person, added at the end (spec §6.10, §5.9). */
	private async openNewPerson(): Promise<void> {
		if (this.readOnly || this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly) return;
		const sheet = EditSheet.createNew(this.host.app, {
			handle: h,
			sourcePath: this.sourcePath,
			beforeWrite: () => this.keepView(),
			newPerson: { kind: 'person' },
			place: this.full ? 'full' : 'embed',
			openNote: (open) => this.openNote(open),
			pictures: this.host.pictures,
			relationOptions: this.relationOptions,
		});
		if (!sheet) {
			new Notice(WRITE_TEXT.invalid);
			return;
		}
		sheet.open();
	}

	/**
	 * More → Titles (spec §13.4, D49, D52): the Titles window of this block, on the computer and in the
	 * full-screen view (never in the static phone preview, spec §13.0 item 7).
	 */
	private async openTitles(): Promise<void> {
		if (!this.canEditWindows()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly || this.unloaded) return;
		const st = h.state;
		const full = !!this.full;
		const host = this.host;
		const fromButton = !!this.viewport?.querySelector('.dynasty-titles-button');
		const win = TitlesWindow.create(this.host.app, {
			handle: h,
			sourcePath: this.sourcePath,
			reduced: () => this.reduced(),
			beforeWrite: () => this.keepView(),
			// The computer has a Titles button of its own; on the phone the window comes from More.
			onClosed: () => TreeView.refocusButton(host, st, full, fromButton ? '.dynasty-titles-button' : '.dynasty-more'),
			show: (id) => TreeView.showFound(host, st, full, id),
			openPerson: (id) => TreeView.openPersonOf(host, st, full, id, this.unloaded ? null : this),
			pictures: host.pictures,
			me: () => this.meId,
			relationOptions: () => this.relationOptions,
			// Contract 0.2.7 E.4, K.10, M.7: Show opens the view of the line; the settings come from the host, because this view can be drawn again after a Save.
			showLine: (title) => TreeView.showSuccession(host, st, title, this.unloaded ? null : this),
			succession: {
				limit: () => (host.settings ?? DEFAULT_SETTINGS).successionLength,
				oldAge: () => (host.settings ?? DEFAULT_SETTINGS).oldAge,
				youngDeathAge: () => (host.settings ?? DEFAULT_SETTINGS).youngDeathAge,
			},
		});
		win?.open();
	}

	/** The block can be edited in a window here: an editable view, not the static phone preview (D1, D36). */
	private canEditWindows(): boolean {
		return !this.readOnly && !this.blocked && !this.inForeignView() && !!this.handle && (!!this.full || !this.coarse);
	}

	/**
	 * A holder's name in the Titles window (spec §13.4): the view of the same kind that opened the window
	 * (Obsidian can have drawn it again) centres and highlights the person, like Find.
	 */
	private static showFound(host: TreeHost, st: BlockState, full: boolean, id: string): void {
		// Two views can share one state (a note open in two tabs): the one that shows a tree wins.
		const same = [...host.views].filter((x) => !x.unloaded && !!x.full === full && x.peekState() === st);
		const v = same.find((x) => !!x.panZoom?.view) ?? same[0];
		v?.guard(() => v.showFound(id));
	}

	/** G.7: a row of the line of succession opens that person's window; the view that opened the Titles window may be drawn again by now. */
	private static openPersonOf(host: TreeHost, st: BlockState, full: boolean, id: string, own: TreeView | null): void {
		const same = [...host.views].filter((x) => !x.unloaded && !x.inForeignView() && !!x.full === full && x.peekState() === st);
		const v = own ?? same.find((x) => !!x.panZoom?.view) ?? same[0];
		v?.guard(() => void v.openSheet(id, false));
	}

	/** Find's result (spec §6.10): a drawn person is centred and highlighted; else the view shows all people with them. */
	private showFound(id: string): void {
		if (!this.whole?.byId.has(id)) return;
		this.showPeople([id]);
	}

	/**
	 * F11: shows people of the whole tree. If the drawn graph has them all, a fold that hides one opens (only the
	 * folds that hide it) and the view centres on them; if it does not, the view shows all people, as Find does.
	 */
	private showPeople(ids: string[]): void {
		const g = this.g;
		if (g && ids.length && ids.every((id) => g.byId.has(id))) {
			if (!this.openFor(ids)) this.showPerson(ids[0], ids.slice(1));
		} else this.showOutside(ids);
	}

	/** Toolbar "Houses" (spec §6.10, D32, D36): the Houses window of this block. */
	private async openHouses(): Promise<void> {
		if (this.readOnly || this.blocked || this.inForeignView()) return;
		const h = await this.validHandle();
		if (!h || this.readOnly || this.unloaded) return;
		const st = h.state;
		const full = !!this.full;
		const win = HousesWindow.create(this.host.app, {
			handle: h,
			beforeWrite: () => this.keepView(),
			onClosed: () => TreeView.refocusButton(this.host, st, full, '.dynasty-houses-button'),
			sourcePath: this.sourcePath,
			pictures: this.host.pictures,
			showGeneration: () => this.settings.showHouseGeneration,
			reduced: () => this.reduced(),
			people: {
				// This view if it is still drawn; after a Save the note draws the tree again, and the view of the same state shows the card.
				show: (id) => (this.unloaded ? TreeView.showFound(this.host, st, full, id) : this.guard(() => this.showFound(id))),
				openNote: (open) => this.openNote(open),
			},
		});
		win?.open();
	}

	/**
	 * A window closed: the focus goes back to the button that opened it (Houses, or More for Titles;
	 * spec §5.2). After a write Obsidian can draw the block again a little later, and the button the
	 * focus went back to is then gone: look again for a short time, but never take the focus from
	 * somewhere the user put it.
	 */
	private static refocusButton(host: TreeHost, st: BlockState, full: boolean, sel: string, step = 0): void {
		let button: HTMLElement | null = null;
		for (const v of host.views) {
			if (v.unloaded || !!v.full !== full || v.peekState() !== st) continue;
			const b = v.viewport?.querySelector<HTMLElement>(sel) ?? null;
			if (b?.isConnected) button = b;
		}
		const doc = button?.doc ?? document;
		const active = doc.activeElement as HTMLElement | null;
		const free = !active || active === doc.body || !active.isConnected || !!active.closest?.(sel);
		if (button && free && active !== button) button.focus();
		const wait = [150, 600][step];
		if (wait !== undefined) (doc.defaultView ?? window).setTimeout(() => TreeView.refocusButton(host, st, full, sel, step + 1), wait);
	}

	/** The view survives the re-render after a write (spec §5.5). */
	private keepView(): void {
		const v = this.panZoom?.view;
		if (v && !this.unloaded) this.storeView(v);
	}

	/**
	 * Read-only views get "Open note" and no edit affordances (spec §6.1). An editable view
	 * on a desktop gets the resize handle (spec §7.5), unless editing is off (spec §8).
	 */
	private updateEditUi(): void {
		const empty = this.emptyEl;
		if (empty) {
			const foreign = empty.isConnected && this.inForeignView();
			const ro = this.readOnly || foreign;
			empty.parentElement?.toggleClass('dynasty-read-only', ro);
			empty.querySelector<HTMLButtonElement>('.dynasty-add-first')?.toggle(!ro);
			// A block whose place is only not known YET says nothing (D183).
			const say = ro && (foreign || !this.placePending);
			let label = empty.querySelector<HTMLElement>('.dynasty-read-only-label');
			if (say && !label) label = empty.createDiv({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
			else if (!say && label) label.remove();
			return;
		}
		const vp = this.viewport;
		const root = vp?.parentElement;
		if (!vp || !root) return;
		const foreign = vp.isConnected && this.inForeignView();
		const readOnly = this.readOnly || foreign;
		// A block whose place is only not known YET shows no label and no chip (D183); the edit tools stay away.
		const say = readOnly && (foreign || !this.placePending);
		root.toggleClass('dynasty-read-only', readOnly);
		let bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		if (!bar) {
			bar = vp.createDiv({ cls: 'dynasty-toolbar' });
			// First in the viewport, so Tab reaches the toolbar before the cards (spec §5.2).
			vp.prepend(bar);
		}
		let open = bar.querySelector<HTMLElement>('.dynasty-open-source');
		if (say && !open) {
			open = bar.createEl('button', { cls: ['dynasty-tool', 'dynasty-open-source'], attr: { type: 'button', 'aria-label': BLOCK_UI.openSourceLabel } });
			setIcon(open.createSpan({ cls: 'dynasty-tool-icon' }), 'file-symlink');
			open.createSpan({ cls: 'dynasty-tool-text', text: BLOCK_UI.openSource });
			open.addEventListener('click', (e) => this.guard(() => this.openSource(e)));
		} else if (!say && open) {
			open.remove();
			open = null;
		}
		// Say why a press on a card does nothing.
		const noEdits = readOnly || this.blocked;
		if (this.listEl) setListEditable(this.listEl, !noEdits);
		let label = bar.querySelector<HTMLElement>('.dynasty-read-only-label');
		const showLabel = say || this.blocked;
		if (showLabel && !label) {
			label = bar.createSpan({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
		} else if (!showLabel && label) {
			label.remove();
			label = null;
		}
		// Spec §6.10: "Add person" on embedded desktop and embedded touch views that can be edited. The computer row shows its word (0.2.8, G.13); the phone bars show the icon.
		const canAdd = !noEdits && !!this.handle;
		const kind = this.barKind();
		let add = bar.querySelector<HTMLElement>('.dynasty-add-person');
		if (canAdd && !add) {
			add = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-add-person'], attr: { 'aria-label': this.listMode ? PHONE_LIST_UI.addPersonLabel : ADD_UI.addPerson, type: 'button' } });
			setIcon(add.createSpan({ cls: 'dynasty-tool-icon' }), 'user-plus');
			if (kind === 'desktop') {
				add.addClass('dynasty-tool-main');
				add.createSpan({ cls: 'dynasty-tool-text', text: PHONE_LIST_UI.addPerson });
			}
			add.addEventListener('click', () => this.guard(() => void this.openNewPerson()));
		} else if (!canAdd && add) {
			add.remove();
			add = null;
		}
		// D176 (2): in the list (no More list) the button for the tree text sits next to Add person.
		const canText = this.listMode && this.canShowText();
		let text = bar.querySelector<HTMLElement>('.dynasty-show-text');
		if (canText && !text) {
			text = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-show-text'], attr: { 'aria-label': BLOCK_UI.showTextLabel, type: 'button' } });
			setIcon(text.createSpan({ cls: 'dynasty-tool-icon' }), 'code');
			text.addEventListener('click', () => this.guard(() => void this.showText()));
		} else if (!canText && text) {
			text.remove();
			text = null;
		}
		// D36: Houses next to Add person, on the computer and in the full-screen view; not in the static touch embed (D1).
		const canHouses = canAdd && (!!this.full || !this.coarse);
		let houses = bar.querySelector<HTMLElement>('.dynasty-houses-button');
		if (canHouses && !houses) {
			houses = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-houses-button'], attr: { 'aria-label': TOOLBAR_UI.housesLabel, type: 'button' } });
			setIcon(houses.createSpan({ cls: 'dynasty-tool-icon' }), 'castle');
			houses.addEventListener('click', () => this.guard(() => void this.openHouses()));
		} else if (!canHouses && houses) {
			houses.remove();
			houses = null;
		}
		// Titles leave the More list on the computer (0.2.8, G.13): a button of their own next to Houses. On a phone they stay in More.
		const canTitles = kind === 'desktop' && this.canEditWindows();
		let titles = bar.querySelector<HTMLElement>('.dynasty-titles-button');
		if (canTitles && !titles) {
			titles = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-titles-button'], attr: { 'aria-label': TITLES_UI.moreLabel, type: 'button' } });
			setIcon(titles.createSpan({ cls: 'dynasty-tool-icon' }), 'crown');
			titles.addEventListener('click', () => this.guard(() => void this.openTitles()));
		} else if (!canTitles && titles) {
			titles.remove();
			titles = null;
		}
		bar.querySelector<HTMLElement>('.dynasty-sep-a')?.toggle(!!houses || !!titles);
		this.orderBar(bar);
		if (!bar.childElementCount) bar.remove();
		// The toolbar can be wider now (Add person): the D28 hint stays left of it.
		this.placeHints();
		const resizable = !this.full && !readOnly && !this.coarse && !this.blocked && !!this.handle && !this.isPhone();
		let grip = root.querySelector<HTMLElement>(':scope > .dynasty-resize');
		// The handle stands below the box, inside the root: the root changes height and the box does not, so the resize observer
		// of the box says nothing. The kept height of the next cold start is the height of the root (D183).
		if (resizable && !grip) {
			grip = this.buildResizeHandle(root, vp);
			this.keepHeight();
		} else if (!resizable && grip) {
			grip.remove();
			this.keepHeight();
		}
	}

	/** The block can be edited here (the same test as for "Add person" in the bar): the item "Show the tree text" needs it. */
	private canShowText(): boolean {
		return !this.readOnly && !this.blocked && !this.inForeignView() && !!this.handle;
	}

	/**
	 * "Show the tree text" (D176 item 2): the note opens for edits with the cursor at the start of the block text. The
	 * full-screen view closes first (`openNote`), so the note is visible. The block comes from the handle, which tracks it.
	 */
	private async showText(): Promise<void> {
		const handle = await this.validHandle();
		if (!handle || this.unloaded) return;
		const { path, ordinal } = handle.key;
		this.openNote(() => this.host.handles.showSource(path, ordinal).then(() => undefined));
	}

	private openSource(e: MouseEvent): void {
		const where = Keymap.isModEvent(e);
		this.openNote(() => this.host.app.workspace.openLinkText(this.sourcePath, '', where));
	}

	/** Desktop resize handle (spec §7.5): a drag changes the height; the release writes `options.height`. */
	private buildResizeHandle(root: HTMLElement, vp: HTMLElement): HTMLElement {
		const grip = root.createDiv({ cls: 'dynasty-resize', attr: { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': BLOCK_UI.resizeLabel } });
		let drag: { pointer: number; y: number; h: number; moved: boolean } | null = null;
		grip.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return;
			e.preventDefault();
			drag = { pointer: e.pointerId, y: e.clientY, h: vp.getBoundingClientRect().height, moved: false };
			try {
				grip.setPointerCapture(e.pointerId);
			} catch {
				// The drag still works without capture.
			}
			root.addClass('dynasty-resizing');
		});
		grip.addEventListener('pointermove', (e) => {
			if (!drag || drag.pointer !== e.pointerId) return;
			const h = Math.round(Math.min(5000, Math.max(100, drag.h + e.clientY - drag.y)));
			drag.moved ||= Math.abs(e.clientY - drag.y) >= 2;
			this.dragHeight = h;
			this.updateHeight();
		});
		const end = (e: PointerEvent) => {
			const d = drag;
			if (!d || d.pointer !== e.pointerId) return;
			drag = null;
			root.removeClass('dynasty-resizing');
			const h = this.dragHeight;
			// A press with no real drag writes nothing: the box goes back to its height, and later settings apply.
			if (!d.moved || h === null || h === this.optionsHeight) {
				this.resetHeight();
				return;
			}
			this.guard(() => {
				this.writeHeight(h).catch((e) => {
					console.error('Dynasty Tree: cannot save the height', e);
					this.heightFailed();
				});
			});
		};
		grip.addEventListener('pointerup', end);
		grip.addEventListener('pointercancel', end);
		return grip;
	}

	private async writeHeight(h: number): Promise<void> {
		const handle = await this.validHandle();
		if (!handle) {
			this.heightFailed();
			return;
		}
		this.keepView();
		const out = await handle.write({ kind: 'set-option', key: 'height', value: h });
		if (!out.ok) {
			if (out.code === 'stale') {
				new Notice(WRITE_TEXT.stale);
				this.resetHeight();
			} else this.heightFailed();
		}
	}

	private heightFailed(): void {
		new Notice(WRITE_TEXT.heightFailed);
		this.resetHeight();
	}

	private resetHeight(): void {
		if (this.unloaded) return;
		this.dragHeight = null;
		this.updateHeight();
	}

	private tagActivated(spouses: readonly string[], tagEl: SVGGElement, hit: SVGRectElement): void {
		if (spouses.length === 1) {
			this.jumpTo(spouses[0]);
			return;
		}
		const g = this.g;
		if (!g || !this.popover) return;
		this.popover.open(
			'spouses',
			(el) => {
				el.createDiv({ cls: 'dynasty-popover-title', text: UI.spouseListTitle });
				for (const id of spouses) {
					const b = el.createEl('button', { cls: 'dynasty-popover-item', text: g.byId.get(id)?.name ?? id });
					b.addEventListener('click', () => {
						this.popover?.close();
						this.guard(() => this.jumpTo(id));
					});
				}
				el.querySelector<HTMLElement>('button')?.focus();
			},
			tagEl,
			hit.getBoundingClientRect(),
		);
	}

	/**
	 * A far-couple tag was chosen. A static touch embed cannot move (D1): it opens the full-screen
	 * view centred on the partner and highlighted instead (spec §0 D17).
	 */
	private jumpTo(id: string): void {
		if (!this.full && this.coarse) {
			void this.openFull(id);
			return;
		}
		this.showPeople([id]);
	}

	/** Expand (spec §6.10, §7.1): the same block, handle and view state in a full-screen modal. */
	private async openFull(target: string | null, focus: string | null = null, focusDue: string | null = null): Promise<void> {
		if (this.unloaded || this.full || this.opening) return;
		const foreign = this.inForeignView();
		// A second press while the handle is checked must not open a second modal.
		this.opening = true;
		let h: Handle | null;
		try {
			h = this.readOnly || foreign ? null : await this.validHandle();
		} finally {
			this.opening = false;
		}
		if (this.unloaded) return;
		const from: FullSource = {
			key: this.key,
			sourcePath: this.sourcePath,
			source: this.source,
			handle: h,
			peeked: this.handle ?? this.peeked,
			readOnly: this.readOnly || foreign || !h,
			focusDue,
		};
		new FullScreenModal(this.host, from, target, this.containerEl, focus).open();
	}

	/** Find (spec §6.10): the picker with every person; centres and highlights the choice, no focus mode. */
	private async find(): Promise<void> {
		const g = this.whole;
		// A retired view is only a picture: its toolbar opens nothing.
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false, null, null, this.pickerContext());
		if (picked?.kind !== 'person' || this.unloaded) return;
		// Find never enters focus mode (spec §6.10); a person outside the focus family is shown in the whole tree.
		this.guard(() => this.showPeople([picked.id]));
	}

	/** Toolbar Focus (spec §5.6, §6.6): the picker with every person of the whole tree, and no "Create" row. */
	private async pickFocusPerson(): Promise<void> {
		const g = this.whole;
		// A retired view is only a picture: its toolbar opens nothing.
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FOCUS_UI.pickerPlaceholder, FOCUS_UI.pickerTitle, false, null, null, this.pickerContext());
		if (picked?.kind !== 'person' || this.unloaded) {
			// No choice: the keyboard focus goes back to the Focus button (spec §5.2), as for the finder's pickers.
			this.guard(() => this.refocusTool('.dynasty-focus'));
			return;
		}
		this.guard(() => this.focusOn(picked.id));
	}

	/**
	 * How the toolbar menus open (0.2.8, G.13): a sheet from the bottom of the phone's full-screen view, else a menu under the button that opened it.
	 */
	private menuPlace(opener: HTMLElement): { anchor?: DOMRect; opts: PopoverOptions } {
		return this.barKind() === 'phone' ? { opts: { sheet: true, reduced: () => this.reduced() } } : { anchor: opener.getBoundingClientRect(), opts: { align: 'start' } };
	}

	/** One row of a toolbar menu: its icon, its text and the accessible name; a key press gives the focus back to the opener, a picker or a new menu takes it itself. */
	private menuItem(pop: Popover, el: HTMLElement, icon: string, text: string, cls: string, run: (keyboard: boolean) => void, label?: string): HTMLElement {
		const b = el.createEl('button', { cls: ['dynasty-popover-item', 'dynasty-more-item', cls], attr: { type: 'button', role: 'menuitem' } });
		if (label) b.setAttribute('aria-label', label);
		setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
		b.createSpan({ cls: 'dynasty-more-text', text });
		b.addEventListener('click', (e) => {
			pop.close(!e.detail);
			this.guard(() => run(!e.detail));
		});
		return b;
	}

	/**
	 * The Focus menu of the toolbar (D132, 0.2.8 G.13): Choose a person opens the picker, Focus on you (only with a marked person) shows the
	 * family of that person, Clear focus (only while a focus shows) shows all people. Clear focus is `focusOn(null)`, so it writes nothing: a pin stays in the note.
	 */
	private toggleFocusList(opener: HTMLElement, keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'focus') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'focus',
			(el) => {
				const first = this.menuItem(pop, el, 'user', FOCUS_UI.choose, 'dynasty-focus-choose', () => void this.pickFocusPerson(), FOCUS_UI.chooseLabel);
				const me = this.meId;
				if (me !== null) this.menuItem(pop, el, 'user-check', TOOLBAR_UI.focusOnYou, 'dynasty-focus-me', () => this.focusOn(me));
				if (this.focusId !== null) {
					el.createDiv({ cls: 'dynasty-menu-sep', attr: { role: 'separator' } });
					this.menuItem(pop, el, 'x', FOCUS_UI.clear, 'dynasty-focus-clear', (key) => {
						// The redraw builds the Focus button again; a key press has the keyboard focus on the new button.
						if (key) this.focusDue = '.dynasty-focus';
						this.focusOn(null);
					}, FOCUS_UI.clearLabel);
				}
				// Enter or Space on Focus moves the focus into the list (spec §5.2).
				if (keyboard) first.focus();
			},
			opener,
			where.anchor,
			where.opts,
		);
		opener.setAttribute('aria-expanded', 'true');
		pop.whenClosed(() => opener.setAttribute('aria-expanded', 'false'));
	}

	/** Centres the view on a person and highlights the card briefly (spec §5.3, D10). */
	showPerson(id: string, others: string[] = []): void {
		const box = this.laid?.layout.persons.get(id);
		const pz = this.panZoom;
		if (!box || !pz?.view || !this.laid) return;
		this.fillPerson(id);
		const target = this.centreFree(centreOn(pz.view, box, this.laid.layout.geometry.fontPx));
		pz.setView(target, { animate: true, byUser: true });
		this.highlight([id, ...others]);
	}

	/**
	 * In the full-screen view a person is centred in the free area between the toolbar bands (the
	 * phone's bottom bar and top safe area, the desktop toolbar), not in the whole viewport, so the
	 * card and its neighbours do not sit under a toolbar.
	 */
	private centreFree(v: View): View {
		if (!this.full || !(v.scale > 0)) return v;
		return { scale: v.scale, cx: v.cx, cy: v.cy - (this.insetTop - this.insetBottom) / 2 / v.scale };
	}

	/**
	 * May a focused card or tag pan the view to it? Elsewhere always: a card cut at the tree's edge
	 * would otherwise scroll the note. In a static touch embed (D1) only a focus that the Tab key
	 * made: a tap also focuses the card or tag under it, and a modal opened from it (the sheet, the
	 * full-screen view) gives the focus back on close, also after the user pressed Tab inside it.
	 */
	private keyFocus(): boolean {
		return !!this.full || !this.coarse || (this.tabbing && !this.modalAbove());
	}

	/**
	 * A modal (a sheet, a picker, a full-screen view) is open over the note. A static touch embed
	 * (D1) never moves then: a Tab in a phone sheet that has no focus yet can reach the tree below it.
	 */
	private modalAbove(): boolean {
		if (pluginModalOpen() || FullScreenModal.openViews.size > 0) return true;
		return !!this.containerEl.doc?.body?.querySelector?.('.modal-container');
	}

	private revealPerson(id: string): void {
		this.fillPerson(id);
		const box = this.laid?.layout.persons.get(id);
		if (box) this.reveal(box);
	}

	/** Tab moves through cards and tags; one that gets focus off screen is panned into view. */
	private reveal(box: Rect): void {
		const pz = this.panZoom;
		const v = pz?.view;
		if (!pz || !v || pz.busy) return;
		if (!this.full && this.coarse && this.modalAbove()) return;
		const halfW = pz.size.w / 2 / v.scale;
		const halfH = pz.size.h / 2 / v.scale;
		const inside = box.x >= v.cx - halfW && box.x + box.w <= v.cx + halfW && box.y >= v.cy - halfH && box.y + box.h <= v.cy + halfH;
		if (inside) return;
		pz.setView({ scale: v.scale, cx: box.x + box.w / 2, cy: box.y + box.h / 2 }, { animate: true, byUser: true });
	}

	private highlight(ids: string[]): void {
		const win = this.containerEl.win;
		// S5d, S7: the tree shows and the card has its content first.
		this.showTree();
		// D126 (1): with reduced movement the highlight is a still outline (styles.css `.dynasty-reduce-motion`).
		this.viewport?.parentElement?.toggleClass('dynasty-reduce-motion', this.reduced());
		for (const id of ids) {
			this.fillPerson(id);
			const card = this.scene?.cards.get(id);
			if (!card) continue;
			// M7: the same card again restarts its pulse. The class goes now and comes back in the next frame; a read of the layout (`getBoundingClientRect`) to flush the style would force a layout of the whole tree.
			if (card.hasClass('dynasty-highlight')) {
				card.removeClass('dynasty-highlight');
				win.requestAnimationFrame(() => {
					if (this.scene?.cards.get(id) === card) card.addClass('dynasty-highlight');
				});
			} else card.addClass('dynasty-highlight');
			const t = win.setTimeout(() => {
				this.timers.delete(t);
				card.removeClass('dynasty-highlight');
			}, HIGHLIGHT_MS);
			this.timers.add(t);
		}
	}

	/** Which toolbar this view has (0.2.8, G.13): the row of the computer, the bar at the bottom of the phone's full-screen view, or the bar of the phone list. */
	private barKind(): 'desktop' | 'phone' | 'list' {
		if (this.listMode) return 'list';
		return this.full && this.isPhone() ? 'phone' : 'desktop';
	}

	/**
	 * The order of the toolbar (0.2.8, G.13), by class: the computer row is Add person, Find, Focus, Fit | Houses, Titles | More … Expand (or Close); the phone's
	 * bottom bar is Add person, Houses, Focus, Find, More, Close; the list's bar is Add person, the tree text … Find, Back, Expand. The problem badge is
	 * always next to the last button. A part that the view does not make is simply not in the bar. Only what is out of place moves: a move takes the keyboard focus from a button.
	 */
	private orderBar(bar: HTMLElement): void {
		const order = BAR_ORDER[this.barKind()];
		const rank = (el: Element) => {
			const i = order.findIndex((c) => (el as HTMLElement).hasClass(c));
			return i < 0 ? order.length : i;
		};
		const want = Array.from(bar.children).sort((a, b) => rank(a) - rank(b));
		want.forEach((e, i) => {
			const at = bar.children[i] ?? null;
			if (at !== e) bar.insertBefore(e, at);
		});
	}

	private buildToolbar(viewport: HTMLElement): void {
		const bar = viewport.createDiv({ cls: 'dynasty-toolbar', attr: { role: 'toolbar', 'aria-label': TOOLBAR_UI.region } });
		// First in the viewport, so Tab reaches every toolbar button before the cards, badges and tags (spec §5.2).
		viewport.prepend(bar);
		const button = (icon: string, label: string, cls: string) => {
			const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', cls], attr: { 'aria-label': label, type: 'button' } });
			setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
			return b;
		};
		const kind = this.barKind();
		// §6.10: Add person, Houses and Titles are added by updateEditUi once the block's handle is known. A static touch embed
		// has no Find, Focus or More (D1): it shows what the block and the session choose.
		if (this.full || !this.coarse) {
			const find = button('search', FULL_UI.find, 'dynasty-find');
			find.addEventListener('click', () => this.guard(() => void this.find()));
			const on = this.focusId !== null;
			const focus = button('crosshair', on ? FOCUS_UI.focusOn : FOCUS_UI.focus, 'dynasty-focus');
			focus.toggleClass('is-active', on);
			focus.setAttribute('aria-pressed', String(on));
			// The Focus menu (Choose a person, Focus on you, Clear focus) always opens; a screen reader hears a menu.
			focus.setAttribute('aria-haspopup', 'true');
			focus.setAttribute('aria-expanded', 'false');
			focus.addEventListener('click', (e) => this.guard(() => this.toggleFocusList(focus, !e.detail)));
			if (kind === 'desktop') {
				const fit = button('minimize', UI.fit, 'dynasty-fit');
				fit.addEventListener('click', () => this.guard(() => this.fit()));
				// The two bars between the groups: the first goes while the block cannot be edited (no Houses, no Titles).
				bar.createSpan({ cls: ['dynasty-sep', 'dynasty-sep-a'], attr: { 'aria-hidden': 'true' } });
				bar.createSpan({ cls: ['dynasty-sep', 'dynasty-sep-b'], attr: { 'aria-hidden': 'true' } });
			}
			// D49: new actions go into one More list; the static touch preview has none (D1, like D36).
			const more = button('more-horizontal', FINDER_UI.more, 'dynasty-more');
			more.setAttribute('aria-haspopup', 'true');
			more.addEventListener('click', (e) => this.guard(() => this.toggleMore(more, !e.detail)));
		}
		if (kind !== 'phone') bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
		this.updateBadge(bar);
		if (this.full) this.closeButton(bar);
		else {
			// Corner brackets read as "full screen"; Fit uses the brackets turned inward.
			const expand = button('maximize', FULL_UI.expand, 'dynasty-expand');
			expand.addEventListener('click', () => this.guard(() => void this.openFull(null)));
		}
		this.orderBar(bar);
	}

	private closeButton(bar: HTMLElement): void {
		const full = this.full;
		if (!full) return;
		const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-close'], attr: { 'aria-label': FULL_UI.close, type: 'button' } });
		setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), 'x');
		b.addEventListener('click', () => full.close(null));
	}

	private fit(): void {
		const pz = this.panZoom;
		if (!pz?.view) return;
		pz.setView(this.aboveBottomBar(pz.size, (area) => fitView(this.bounds, area, this.insetTop)), { animate: true, byUser: true });
	}

	/**
	 * Closes an open popover (legend, partner list, problems, More) with the focus back on its opener,
	 * else the relation finder's result (spec §13.2) or the Show view of a line of succession; false if none was open. The full-screen view
	 * asks first when Obsidian closes it (Esc, Android back).
	 */
	closePopover(): boolean {
		const pop = this.popover;
		if (pop?.isOpen) {
			pop.close(true);
			return true;
		}
		if (this.unloaded) return false;
		if (this.successionDrawn) {
			this.closeSuccession();
			return true;
		}
		if (!this.finderDrawn) return false;
		this.closeFinder();
		return true;
	}

	/** The line styles (D25, D196 item 3): a menu under the More button on the computer; on a phone a sheet with Close, and a tap outside closes it. */
	private toggleLegend(opener: HTMLElement): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'legend') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'legend',
			(el) => {
				if (where.opts.sheet) {
					const head = el.createDiv({ cls: 'dynasty-sheet-head' });
					head.createSpan({ cls: 'dynasty-popover-title', text: UI.legendTitle });
					const close = head.createEl('button', { cls: ['dynasty-link', 'dynasty-sheet-close'], text: SHEET.close, attr: { type: 'button' } });
					close.addEventListener('click', () => pop.close(true));
				} else el.createDiv({ cls: 'dynasty-popover-title', text: UI.legendTitle });
				buildLegend(el.createDiv({ cls: 'dynasty-legend' }));
				// A sheet has its own height rules (rows of 40 px, scrolls); only the menu of a computer is made compact to fit a short box.
				if (!where.opts.sheet) fitLegend(el);
			},
			opener,
			where.anchor,
			where.opts,
		);
	}

	private toggleProblems(opener: HTMLElement, issues: CodedIssue[], keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'problems') {
			pop.close();
			return;
		}
		const whole = this.whole;
		pop.open(
			'problems',
			(el) => {
				const c = buildCallout(el, 'warning', problemsTitle(issues.length), 'dynasty-problems');
				// In focus mode a problem can be about people who are not drawn: like Find, the button then shows all people (spec §6.10).
				const shown = issues.map((i) => ({ issue: i, people: (i.ids ?? []).filter((id) => whole?.byId.has(id) && (this.g?.byId.has(id) || this.focusId !== null)) }));
				if (shown.some((s) => s.people.length)) c.content.createDiv({ cls: 'dynasty-problems-hint', text: PROBLEMS_HINT });
				const list = c.content.createEl('ul', { cls: 'dynasty-problems-list' });
				for (const { issue, people } of shown) {
					const li = list.createEl('li', { cls: issue.level === 'blocking' ? 'dynasty-problem is-blocking' : 'dynasty-problem' });
					if (!people.length) {
						li.setText(issueText(issue));
						continue;
					}
					const b = li.createEl('button', { cls: 'dynasty-problem-button', text: issueText(issue) });
					b.addEventListener('click', () => {
						pop.close();
						this.guard(() => {
							// D1: the static touch preview never moves; like a tag tap (D17), the full-screen view opens on the person.
							if (!this.full && this.coarse) void this.openFull(people[0]);
							else this.showPeople(people);
						});
					});
				}
				// Enter or Space on the badge moves the focus into the list: its buttons come last in the Tab order (spec §5.2).
				if (keyboard) el.querySelector<HTMLElement>('.dynasty-problem-button')?.focus();
			},
			opener,
		);
	}

	// ---------- folds (spec §13.10, D83–D85) ----------

	/** A tap or key on a fold button or sign: the family folds or opens, and the control stays at the same screen place (F10). */
	private toggleFold(c: FoldControl): void {
		const st = this.ensureState();
		const next = new Set(st.folds);
		if (c.folded) next.delete(c.key);
		else next.add(c.key);
		TreeView.changeFolds(this.host, st, next, { anchor: { kind: 'spot', key: c.key }, origin: this });
	}

	/**
	 * F10: sets the folds of a block and draws every view of it again (a static touch preview never applies a
	 * fold, so it stays). `anchor` and `targets` are for the view that acted: `origin`, or the view of the same
	 * kind that shows the block now (Obsidian can have drawn the acting view again). The other views keep their
	 * own view, as for a focus change.
	 */
	static changeFolds(host: TreeHost, st: BlockState, next: ReadonlySet<FoldKey>, o: { anchor?: FoldAnchor | null; origin?: TreeView | null; full?: boolean; targets?: string[] } = {}): void {
		st.folds = new Set(next);
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st && (v.full || !v.coarse));
		const kind = o.origin && !o.origin.unloaded ? !!o.origin.full : (o.full ?? false);
		const same = views.filter((v) => !!v.full === kind);
		const origin = o.origin && views.includes(o.origin) ? o.origin : (same.find((v) => !!v.panZoom?.view) ?? same[0] ?? null);
		for (const v of views) v.guard(() => v.foldsChanged(v === origin ? (o.anchor ?? null) : null, v === origin ? (o.targets ?? []) : []));
	}

	/**
	 * F10, F17: draws the tree again with the block's folds, in place: the graph, the fonts and the toolbar stay, only
	 * the layout and the scene are made again. The acting view keeps its anchor at the same screen place (`keepSpot`
	 * for a control; the card for a sheet action, or the first parent when the control is gone); others keep the card
	 * nearest their centre. With `targets`, the view then centres on them and highlights them.
	 */
	private foldsChanged(anchor: FoldAnchor | null, targets: string[]): void {
		if (this.unloaded) return;
		// An embed under an open full-screen view of the block draws again when that closes (as for a focus change).
		if (!this.full && FullScreenModal.isOpenFor(this.key)) {
			this.focusStale = true;
			return;
		}
		const { g, whole, lastLayout: last, panZoom: pz, laid } = this;
		if (!laid) return;
		// A view that has no size (the other mode of the note, hidden) draws when it shows: its resize sees `foldsStale`.
		if (!(this.viewport && this.viewport.clientWidth > 0)) {
			this.foldsStale = true;
			return;
		}
		if (!g || !whole || !last || !pz?.view || this.finderAlt) {
			this.carry = this.keptAnchor();
			this.pendingTarget = targets.length ? targets : null;
			this.render(this.fonts);
			return;
		}
		const view = pz.view;
		const control = anchor?.kind === 'spot' ? laid.layout.folds?.find((c) => c.key === anchor.key) : undefined;
		const keep = control?.spot ?? null;
		const near = anchor?.kind === 'person' ? this.anchorOn(anchor.id) : control ? this.anchorOn(control.parents[0]) : null;
		const fallback = near ?? this.keptAnchor();
		const active = this.containerEl.doc?.activeElement as Element | null | undefined;
		const focused = this.foldByKey ? (active?.closest?.('.dynasty-fold')?.getAttribute('data-fold') ?? null) : null;
		this.foldByKey = false;
		const plan = planFolds(g, whole, this.ensureState().folds, true, this.linePeopleNow());
		this.foldPlan = plan;
		const next = this.layOut(g, last.geo, withFolds(last.settings, plan, true), last.opts.fonts, last.opts.labels, plan.hidden);
		last.settings = next.settings;
		this.redraw(g, next.laid);
		// `redraw` asks for a first view; a fold keeps the view.
		this.firstDue = false;
		const to = anchor?.kind === 'spot' ? next.laid.layout.folds?.find((c) => c.key === anchor.key)?.spot : undefined;
		const kept = keep && to ? keepSpot(view, keep, to) : fallback ? this.fromAnchor(fallback) : null;
		pz.setView(kept ?? view, { byUser: true });
		if (targets.length) this.showPerson(targets[0], targets.slice(1));
		if (focused) this.scene?.folds.find((f) => f.control.key === focused)?.el.focus({ preventScroll: true });
	}

	/** The anchor of the card of `id` in the drawn tree: the view's centre relative to the card, in em. */
	private anchorOn(id: string | undefined): Anchor | null {
		const b = id !== undefined ? this.laid?.layout.persons.get(id) : undefined;
		const v = this.panZoom?.view;
		if (!b || !v || !this.laid) return null;
		const f = this.laid.layout.geometry.fontPx;
		return { person: id!, dx: (v.cx - (b.x + b.w / 2)) / f, dy: (v.cy - (b.y + b.h / 2)) / f, scale: v.scale, byUser: true, bandClear: false };
	}

	/**
	 * F11: opens the folds that hide `ids` in the drawn graph (and no other) and draws again with the view centred on
	 * them. False when no fold hides them, so the caller centres as before.
	 */
	private openFor(ids: string[]): boolean {
		const { g, whole, foldPlan: plan } = this;
		if (!g || !whole || !plan) return false;
		const hidden = ids.filter((id) => plan.hidden.has(id));
		if (!hidden.length) return false;
		const st = this.ensureState();
		TreeView.changeFolds(this.host, st, unfoldFor(g, whole, st.folds, hidden), { origin: this, targets: ids });
		return true;
	}

	/** The view that shows a block now, of the kind asked (`full` or a note), preferring one with a first view. */
	private static viewOf(host: TreeHost, st: BlockState, full: boolean): TreeView | undefined {
		const same = [...host.views].filter((v) => !v.unloaded && !!v.full === full && v.peekState() === st);
		return same.find((v) => !!v.panZoom?.view) ?? same[0];
	}

	/** The graph that Focus on `focus` will draw, made from `tree` as `render` makes it. */
	private focusGraph(tree: Tree, focus: string): FamilyGraph | null {
		const n = focusGenerationsFor(tree.options, this.settings.focusGenerations);
		const sub = focusSubgraph(tree, focus, n);
		return sub ? deriveFamilies(sub.tree) : null;
	}

	/**
	 * F11: Focus (the toolbar and Focus here) on a hidden person opens the folds that hide them in the family that
	 * Focus will draw. The state changes before the views draw the focus.
	 */
	private static unfoldForFocus(host: TreeHost, st: BlockState, id: string): void {
		if (!st.folds.size) return;
		const v = [...host.views].find((x) => !x.unloaded && x.whole && x.peekState() === st);
		const whole = v?.whole;
		if (!v || !whole || !foldHidden(whole, st.folds).has(id)) return;
		const parsed = v.parse(v.source);
		const drawn = (parsed.ok ? v.focusGraph(parsed.tree, id) : null) ?? whole;
		st.folds = new Set(unfoldFor(drawn, whole, st.folds, [id]));
	}

	/**
	 * F12: after an ok write of the sheet, opens the folds that hide the sheet's person and the people the write
	 * added, using the new text, and draws the views again with the view centred on them. Nothing changes before
	 * the write is ok, and nothing when no fold hides them.
	 */
	private static unfoldAfterWrite(host: TreeHost, st: BlockState, full: boolean, ids: readonly string[], body: string): void {
		if (!st.folds.size) return;
		const v = TreeView.viewOf(host, st, full);
		const parsed = v ? v.parse(body) : parseDynasty(body);
		if (!parsed.ok) return;
		const whole = deriveFamilies(parsed.tree);
		const known = ids.filter((id) => whole.byId.has(id));
		if (!known.length) return;
		// A static phone preview shows no fold, so a write there must not end the folds of the full-screen view.
		if (!full && v && v.coarse) return;
		// The graph the view draws after the write: its focus family, if that has them all.
		let drawn = whole;
		if (v && v.focusId !== null && !v.finderDrawn && whole.byId.has(v.focusId)) {
			const family = v.focusGraph(parsed.tree, v.focusId);
			if (family && known.every((id) => family.byId.has(id))) drawn = family;
		}
		const next = unfoldFor(drawn, whole, st.folds, known);
		if (next.size === st.folds.size) return;
		TreeView.changeFolds(host, st, next, { origin: v ?? null, full, targets: known });
	}

	/** F15: what the edit sheet gets of the folds (Hide descendants, Show descendants, and the unfold after a write). */
	private sheetFolds(h: Handle): SheetFolds {
		const host = this.host;
		const st = h.state;
		const full = !!this.full;
		const live = full || !this.coarse;
		const now = () => TreeView.viewOf(host, st, full);
		const state = (id: string) => {
			const v = now();
			if (live) return v?.g && v.foldPlan ? personFolds(v.g, v.foldPlan.effective, v.foldPlan.hidden, id) : { open: [], folded: [] };
			// The static preview never shows a fold: every family with children could fold, and none is folded (D85).
			return v?.whole ? personFolds(v.whole, new Set(), new Set(), id) : { open: [], folded: [] };
		};
		return {
			mode: live ? 'live' : 'preview',
			state,
			hide: (id) => {
				const next = new Set([...st.folds, ...state(id).open]);
				if (live) {
					TreeView.changeFolds(host, st, next, { anchor: { kind: 'person', id }, origin: now() ?? null, full });
					return;
				}
				// The preview does not change: the fold is made in the block's state, and the full-screen view opens on the person.
				st.folds = next;
				void now()?.openFull(id);
			},
			show: (id) => {
				const next = new Set(st.folds);
				for (const k of state(id).folded) next.delete(k);
				TreeView.changeFolds(host, st, next, { anchor: { kind: 'person', id }, origin: now() ?? null, full });
			},
			written: (ids) => {
				if (live) TreeView.unfoldAfterWrite(host, st, full, ids, h.body);
			},
		};
	}

	// ---------- pictures (spec §13.0 item 3, §13.6–§13.8; M9 contract O1–O5, O9–O11) ----------

	/** The problems of the badge: the tree text's, then the picture warnings in tree order (O2). */
	private allIssues(): CodedIssue[] {
		const info = this.pictureInfo;
		if (!info) return this.textIssues;
		const su = this.host.startedUp;
		const pics: CodedIssue[] = [];
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			// D183: until the metadata cache has finished, a picture that it does not know yet is no warning.
			if (r && !r.ok) {
				if (r.code !== 'missing-picture' || !su || su.cache()) pics.push(pictureIssue(u.owner, r));
			} else {
				const found = info.found.get(i);
				if (found) pics.push(found);
			}
		});
		return pics.length ? [...this.textIssues, ...pics] : this.textIssues;
	}

	/**
	 * The problem badge shows the problems as they are now (spec §8): made, changed or removed in place.
	 * A picture warning that the file check finds later changes only the badge (O2).
	 */
	private updateBadge(bar: HTMLElement | null = this.viewport?.querySelector<HTMLElement>(':scope > .dynasty-toolbar') ?? null): void {
		if (!bar) return;
		const issues = this.allIssues();
		let badge = bar.querySelector<HTMLElement>(':scope > .dynasty-warning-badge');
		if (!issues.length) {
			badge?.remove();
			return;
		}
		if (!badge) {
			const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-warning-badge'], attr: { type: 'button' } });
			setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), 'alert-triangle');
			b.createSpan({ cls: 'dynasty-warning-count' });
			// A click that a key makes has no press count (detail 0); a mouse or touch press has 1 or more.
			b.addEventListener('click', (e) => this.guard(() => this.toggleProblems(b, this.allIssues(), !e.detail)));
			// Before Close or Expand, as when the toolbar is built.
			this.orderBar(bar);
			badge = b;
		}
		const label = problemsLabel(issues.length);
		if (badge.getAttribute('aria-label') !== label) badge.setAttribute('aria-label', label);
		const count = badge.querySelector<HTMLElement>('.dynasty-warning-count');
		if (count && count.getText() !== String(issues.length)) count.setText(String(issues.length));
	}

	/**
	 * O1, O2: resolves every arms and portrait link of the whole tree once (web address, missing file,
	 * extension): also the portraits when "Show portraits on cards" is off. No file is read here.
	 */
	private resolvePictures(whole: FamilyGraph): void {
		const store = this.host.pictures;
		if (!store) {
			this.pictureInfo = null;
			return;
		}
		const uses: PictureUse[] = [];
		for (const h of whole.houses.values()) if (h.arms) uses.push({ owner: { kind: 'arms', house: { id: h.id, name: h.name } }, link: h.arms });
		for (const p of whole.people) {
			if (p.portrait) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name } }, link: p.portrait });
			// 0.2.8 (I05, contract A.1): the personal arms of a person have the same warnings as the arms of a house.
			if (p.arms) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name }, arms: true }, link: p.arms });
		}
		const resolved = new Map<string, ResolvedPicture>();
		for (const u of uses) if (!resolved.has(u.link)) resolved.set(u.link, store.resolve(u.link, this.sourcePath));
		const old = this.pictureInfo;
		// A found warning stays for a file that did not change (a change drops it first, see picturesChanged).
		const found = new Map<number, CodedIssue>();
		if (old) {
			uses.forEach((u, i) => {
				const j = old.uses.findIndex((o) => o.link === u.link && ownerKey(o.owner) === ownerKey(u.owner));
				const f = j >= 0 ? old.found.get(j) : undefined;
				if (f) found.set(i, f);
			});
		}
		this.pictureInfo = { uses, resolved, found };
	}

	/** The file of a picture slot, or the problem of its link (O1). */
	private pictureFile(slot: PictureSlot): TFile | PictureProblem {
		const info = this.pictureInfo;
		const personal = slot.owner && 'person' in slot.owner ? this.whole?.byId.get(slot.owner.person)?.arms : undefined;
		const link = slot.kind === 'arms' ? (personal ?? (slot.house !== undefined ? this.whole?.houses.get(slot.house)?.arms : undefined)) : this.whole?.byId.get(slot.person)?.portrait;
		const r = link !== undefined ? info?.resolved.get(link) : undefined;
		if (!r) return { ok: false, code: 'picture-not-image', file: link ?? '' };
		return r.ok ? r.file : r;
	}

	/** O5: the live pictures of the scene just drawn; the old ones go first. */
	private makeLive(): void {
		this.live?.destroy();
		this.live = null;
		const store = this.host.pictures;
		const slots = this.scene?.pictures ?? [];
		if (!store || !slots.length) return;
		const root = this.viewport?.parentElement ?? null;
		this.live = createLivePictures(slots, store, (s) => this.pictureFile(s), {
			// Spec §13.13: a card shows the part of the portrait that the tree text names.
			cropOf: (s) => {
				const person = s.kind === 'portrait' ? this.whole?.byId.get(s.person) : undefined;
				return person ? portraitCropOf(person) : null;
			},
			// B15: the harness reads how many pictures still wait.
			onPending: (n) => {
				const v = String(n);
				if (root?.isConnected && root.getAttribute('data-dynasty-pictures-pending') !== v) root.setAttribute('data-dynasty-pictures-pending', v);
			},
		});
		// Drawn again under an open full-screen view of the block (an edit there): it waits until the view closes.
		if (this.hiddenUnderFull()) this.live.pause();
	}

	/**
	 * Spec §13.0 item 3 "Pictures never delay the first view": the pictures start after the frame that
	 * made the first view ready for use (`markInteractive` measures that frame), then one background
	 * check of the files (O2).
	 */
	private startPictures(): void {
		if (this.picturesOn || !this.host.pictures || !this.pictureInfo) return;
		const token = this.pictureToken;
		const win = this.containerEl.win;
		win.requestAnimationFrame(() =>
			win.requestAnimationFrame(() => {
				const t = win.setTimeout(() => {
					this.timers.delete(t);
					this.guard(() => {
						if (token !== this.pictureToken || this.unloaded || this.picturesOn) return;
						this.picturesOn = true;
						const pz = this.panZoom;
						if (pz?.view && !pz.busy) this.showPictures(pz.view);
						this.checkPictures();
					});
				}, 0);
				this.timers.add(t);
			}),
		);
	}

	/**
	 * O5, B10: the pictures of the cards in or near `view` at the shown level of detail, with copies at
	 * the zoom step of its scale. Before the first view is ready, only the copies the store has now
	 * (B15: a tree drawn again after an edit shows them in its first frame).
	 */
	private showPictures(view: View): void {
		const live = this.live;
		const pz = this.panZoom;
		const lod = this.lod;
		if (!live || !pz || !lod) return;
		const rect = visibleRect(view, pz.size);
		if (!rect) return;
		if (this.picturesOn) live.update(rect, lod, zoomStep(view.scale));
		else live.prime(rect, lod, zoomStep(view.scale));
	}

	/**
	 * O2: one background check of each picture file (too large, not a picture by its bytes), at the
	 * store's lowest priority. A problem changes only the badge and the frames. When the check ends, the
	 * root gets `data-dynasty-pictures="checked"` (for the harness).
	 */
	private checkPictures(): void {
		const info = this.pictureInfo;
		const store = this.host.pictures;
		const root = this.viewport?.parentElement ?? null;
		if (!info || !store || !root || !info.uses.length) return;
		const token = this.pictureToken;
		root.removeAttribute('data-dynasty-pictures');
		const files = new Map<string, TFile>();
		for (const r of info.resolved.values()) if (r.ok) files.set(r.file.path, r.file);
		const current = () => token === this.pictureToken && !this.unloaded && this.pictureInfo === info;
		const one = async (file: TFile) => {
			let p: PictureProblem | null = null;
			try {
				p = await store.check(file);
			} catch (e) {
				console.error('Dynasty Tree: cannot check the picture', e);
			}
			const problem = p;
			if (problem && current()) this.guard(() => this.fileProblem(info, file, problem));
		};
		void Promise.all([...files.values()].map(one)).then(() => {
			if (current() && root.isConnected) root.setAttribute('data-dynasty-pictures', 'checked');
		});
	}

	/** O2: the file check found a problem: its warning goes on the badge and the cards show no picture. */
	private fileProblem(info: PictureInfo, file: TFile, p: PictureProblem): void {
		const drawn = this.g;
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (!r?.ok || r.file.path !== file.path) return;
			info.found.set(i, pictureIssue(u.owner, p));
			if (u.owner.kind === 'portrait') this.live?.problem(u.owner.person.id, u.owner.arms ? 'arms' : 'portrait');
			else if (drawn) {
				const house = u.owner.house.id;
				// A person with personal arms shows those, so a problem of the house arms is not theirs.
				for (const person of drawn.people) if (person.house === house && !person.arms) this.live?.problem(person.id, 'arms');
			}
		});
		this.updateBadge();
	}

	/**
	 * O9: picture files changed, came or went (main.ts groups the vault events). A tree that uses one of
	 * them, or has a link to a missing file, resolves its pictures again, updates its badge and fetches
	 * the new copies; nothing is laid out again.
	 */
	private picturesChanged(paths: readonly string[]): void {
		const info = this.pictureInfo;
		const whole = this.whole;
		if (!info || !whole || this.unloaded || !this.viewport) return;
		const touched = new Set(paths);
		const uses = [...info.resolved.values()].some((r) => (r.ok ? touched.has(r.file.path) : r.code === 'missing-picture'));
		if (!uses) return;
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (r?.ok && touched.has(r.file.path)) info.found.delete(i);
		});
		this.resolvePictures(whole);
		this.updateBadge();
		this.live?.refresh(paths);
		this.refillList();
		if (this.picturesOn) this.checkPictures();
	}

	/**
	 * The metadata cache finished indexing (I06: the tree on a computer looks too, not only the phone list). Only a view that has a link to a
	 * missing picture looks again, and only the links that were missing are asked: nothing else costs time when every picture is found.
	 */
	private linksResolved(): void {
		const info = this.pictureInfo;
		const whole = this.whole;
		const store = this.host.pictures;
		if (!info || !whole || !store || this.unloaded || !this.viewport) return;
		let late = false;
		for (const [link, r] of info.resolved) {
			if (!r.ok && r.code === 'missing-picture' && store.resolve(link, this.sourcePath).ok) {
				late = true;
				break;
			}
		}
		if (!late) return;
		this.picturesLookAgain();
	}

	/**
	 * The rows of the list get their picture copies again, in place: no new draw, so the scroll place and the
	 * focus stay. The old copies go back to the store once.
	 */
	private refillList(): void {
		const list = this.listEl;
		const whole = this.whole;
		if (!list || !whole || !list.isConnected) return;
		this.listAbort?.abort();
		for (const c of this.listCopies.splice(0)) c.release();
		const ctl = new AbortController();
		this.listAbort = ctl;
		const token = this.pictureToken;
		for (const row of Array.from(list.querySelectorAll<HTMLElement>('.dynasty-list-row[data-person]'))) {
			restoreListPictures(row);
			const arms = row.querySelector<HTMLElement>('.dynasty-hero-arms') ?? undefined;
			const portrait = row.querySelector<HTMLElement>('.dynasty-list-portrait, .dynasty-hero-portrait') ?? undefined;
			if (!arms && !portrait) continue;
			for (const slot of [arms, portrait]) {
				if (!slot) continue;
				slot.removeClass('has-picture');
				for (const img of Array.from(slot.querySelectorAll('img'))) img.remove();
			}
			this.listPictures(whole, { ...(arms ? { arms } : {}), ...(portrait ? { portrait } : {}) }, row.getAttribute('data-person') ?? '', ctl.signal, token);
		}
	}

	/** True for a note's tree while a full-screen view of the same block covers it. */
	private hiddenUnderFull(): boolean {
		return !this.full && FullScreenModal.isOpenFor(this.key);
	}

	/**
	 * A full-screen view of this block opened over this tree: its picture requests that wait stop, and
	 * it starts no new ones while it is hidden, so the full-screen view gets the store first.
	 */
	pausePictures(): void {
		this.guard(() => this.live?.pause());
	}

	/** The full-screen view over this tree closed: the pictures of the shown area load again. */
	resumePictures(): void {
		this.guard(() => {
			if (this.unloaded || this.hiddenUnderFull()) return;
			this.live?.resume();
		});
	}

	/**
	 * More → Save as picture (spec §13.8, O11): the window "Save as a picture", then the save of what
	 * this view draws now (P1). The view stays in use while the picture is made.
	 */
	private openSave(): void {
		const src = this.saveSource();
		if (!src) return;
		const app = this.host.app;
		const store = this.host.pictures;
		const host = this.host;
		const st = this.peekState();
		const full = !!this.full;
		new SaveWindow(app, {
			save: (kind) => void savePicture(app, store, src, kind),
			onClosed: () => {
				if (st) TreeView.refocusButton(host, st, full, '.dynasty-more');
			},
		}).open();
	}

	/** P1: the drawn graph and this view's settings, for the saved picture. */
	private saveSource(): SaveSource | null {
		const g = this.g;
		const laid = this.laid;
		const last = this.lastLayout;
		if (!g || !laid || !last) return null;
		const opts = last.opts;
		const name = this.sourcePath.split('/').pop() ?? this.sourcePath;
		const focus = this.focusId !== null ? this.whole?.byId.get(this.focusId)?.name : undefined;
		// The saved picture shows the card form of the direction it is drawn in, whole cards (D148 2A, D150 5): the geometry is made again, with no flag of the view.
		// The plate follows the mark, the finder's small tree and the setting, as at the draw; with no plate a marked person gets the "You" tab.
		const small = this.finderDrawn?.line && !this.finderDrawn.state.whole;
		const rel = this.meId !== null && !small && this.whole ? relationsFor(this.whole, this.meId, this.relationOptions) : null;
		const relationLine = rel !== null && this.settings.showRelations;
		const orientation = laid.layout.orientation ?? 'down';
		const breaks = this.breakList();
		return {
			g,
			...(opts.labels ? { labels: opts.labels } : {}),
			...(rel && relationLine ? { relations: rel.cards } : {}),
			...(opts.me !== undefined ? { me: opts.me } : {}),
			...(opts.line ? { line: opts.line } : {}),
			orientation,
			geo: cardForm(geometryFor(last.geo.fontPx), orientation),
			relationLine,
			...(this.meId !== null && !relationLine ? { youTab: this.meId } : {}),
			...(breaks.size ? { breaks } : {}),
			fonts: opts.fonts,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			armsOnCards: this.settings.armsOnCards,
			sourcePath: this.sourcePath,
			note: name.replace(/\.md$/i, ''),
			...(focus !== undefined ? { focusName: focus } : {}),
			...(this.foldPlan?.foldedList.length ? { folds: { hidden: this.foldPlan.hiddenList, folded: this.foldPlan.foldedList } } : {}),
			// F.5: while the Show view is open, the saved picture has the tabs, the outlines and the bar sentence.
			...(this.successionDrawn ? { succession: { ordinalCards: [...this.successionDrawn.ordinals.keys()], heirs: this.successionDrawn.heirs, ordinals: this.successionDrawn.ordinals, sentence: this.successionDrawn.sentence } } : {}),
		};
	}

	// ---------- the relation finder (spec §13.2, D47, D48, D49) ----------

	/**
	 * The finder's result to draw, from the block state and the whole tree `whole`: computed again at
	 * each render, so it follows every edit. A result whose person left the tree closes (spec §13.2).
	 * The static touch preview never draws one (D1): the full-screen view shows it.
	 */
	private finderFor(st: BlockState, whole: FamilyGraph): FinderDrawn | null {
		const f = st.finder;
		if (!f) return null;
		if (f.first === f.second || !whole.byId.has(f.first) || !whole.byId.has(f.second)) {
			st.finder = null;
			return null;
		}
		if (!this.full && this.coarse) return null;
		const result = findRelation(whole, f.first, f.second, this.relationOptions);
		const count = result.kind === 'named' ? result.relations.length : 1;
		// An edit can leave fewer relations than the one that showed.
		if (!(f.index >= 0 && f.index < count)) f.index = 0;
		const line = result.kind === 'named' ? (result.relations[f.index]?.relation.line ?? null) : result.kind === 'chain' ? result.line : null;
		return { state: f, result, line };
	}

	/**
	 * The banner of the relation finder's result (spec §13.2, D48; 0.2.8 G.13): one row under the toolbar with the sentence, then the links
	 * Show the steps, Other relation, Show in the whole tree (or back to the line only) and Close. On a phone Close is an X with a 44 px
	 * tap area. The links wrap under the sentence when the row is narrow; the steps open as a list under them.
	 */
	private buildResultBar(viewport: HTMLElement, before: HTMLElement, d: FinderDrawn, whole: FamilyGraph): void {
		const { state: f, result } = d;
		const name = (id: string) => whole.byId.get(id)?.name || id;
		// Named by its sentence, not aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', ...(this.barKind() === 'phone' ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order (spec §5.2).
		viewport.insertBefore(bar, before);
		bar.createDiv({ cls: 'dynasty-result-text', text: finderSentence(whole, result, f.index), attr: { id, role: 'status', tabindex: -1 } });
		const steps = result.kind === 'named' ? (result.relations[f.index]?.steps ?? []) : result.kind === 'chain' ? result.steps : [];
		const list = bar.createEl('ol', { cls: 'dynasty-result-steps' });
		const sentences = stepSentences(whole, steps);
		for (const t of sentences.shown) list.createEl('li', { text: t });
		if (sentences.more) list.createEl('li', { cls: 'dynasty-result-more-steps', text: FINDER_UI.moreSteps(sentences.more) });
		list.toggle(f.steps);
		const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
		const others = result.kind === 'named' && result.relations.length > 1 ? result.relations.length : 0;
		// Only the bar changes: the tree is not drawn again.
		const toggleSteps = (after: (shown: boolean) => void) => {
			f.steps = !f.steps;
			list.toggle(f.steps);
			after(f.steps);
		};
		if (this.barKind() === 'phone') {
			// D212 (phone-banner-row): one row, the sentence, the link "Options" and the X. The link opens the actions in a sheet.
			const options = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', 'dynasty-result-options'], attr: { type: 'button', 'aria-label': FINDER_UI.optionsLabel, 'aria-haspopup': 'true', 'aria-expanded': 'false' } });
			options.createSpan({ text: FINDER_UI.options });
			setIcon(options.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
			options.addEventListener('click', () => this.guard(() => this.toggleBannerOptions(options, { steps: steps.length > 0, others, line: !!d.line }, d, toggleSteps)));
		} else {
			const button = (text: string, cls: string, run: () => void, label?: string) => {
				const b = row.createEl('button', { cls: ['dynasty-result-button', 'dynasty-link', cls], text, attr: { type: 'button' } });
				if (label) b.setAttribute('aria-label', label);
				b.addEventListener('click', () => this.guard(run));
				return b;
			};
			if (steps.length) {
				const toggle = button(f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () =>
					toggleSteps((shown) => {
						toggle.setText(shown ? FINDER_UI.hideSteps : FINDER_UI.showSteps);
						toggle.setAttribute('aria-expanded', String(shown));
					}),
				);
				toggle.setAttribute('aria-expanded', String(f.steps));
			}
			if (others) button(FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % others }, '.dynasty-result-other'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
			if (d.line) button(f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-whole'));
		}
		this.closeLink(row, 'dynasty-result-close', FINDER_UI.close, FINDER_UI.closeLabel, () => this.closeFinder());
	}

	/**
	 * The menu of the link "Options" in the phone banner (D212): Show the steps (or Hide), Other relation and Show in the whole tree (or Show only
	 * the line), as a sheet from the bottom like the other menus of the phone. Each row does what the link of the computer's banner does.
	 */
	private toggleBannerOptions(opener: HTMLElement, has: { steps: boolean; others: number; line: boolean }, d: FinderDrawn, toggleSteps: (after: (shown: boolean) => void) => void): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'options') {
			pop.close();
			return;
		}
		const { state: f } = d;
		const name = (id: string) => this.whole?.byId.get(id)?.name || id;
		const where = this.menuPlace(opener);
		pop.open(
			'options',
			(el) => {
				if (has.steps) {
					this.menuItem(pop, el, 'list', f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () => toggleSteps(() => undefined));
				}
				if (has.others) {
					this.menuItem(pop, el, 'repeat', FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % has.others }, '.dynasty-result-options'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
				}
				if (has.line) {
					this.menuItem(pop, el, f.whole ? 'minimize-2' : 'maximize-2', f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-options'));
				}
			},
			opener,
			where.anchor,
			where.opts,
		);
		opener.setAttribute('aria-expanded', 'true');
		pop.whenClosed(() => opener.setAttribute('aria-expanded', 'false'));
	}

	/** The Close of a banner: the word as a link on the computer, an X with a 44 px tap area on a phone (0.2.8 G.13, I37). */
	private closeLink(row: HTMLElement, cls: string, text: string, label: string, run: () => void): HTMLElement {
		const icon = this.barKind() === 'phone';
		const b = row.createEl('button', { cls: ['dynasty-result-button', cls, ...(icon ? ['clickable-icon', 'dynasty-bar-x'] : ['dynasty-link'])], attr: { type: 'button', 'aria-label': label } });
		if (icon) setIcon(b.createSpan({ cls: 'dynasty-tool-icon', attr: { 'aria-hidden': 'true' } }), 'x');
		else b.setText(text);
		b.addEventListener('click', () => this.guard(run));
		return b;
	}

	/** Other relation, Show in the whole tree: the block's result changes, and its views draw it; the focus stays on the pressed button. */
	private finderChange(patch: Partial<FinderState>, refocus: string): void {
		const st = this.ensureState();
		if (!st.finder) return;
		Object.assign(st.finder, patch);
		this.focusDue = refocus;
		TreeView.finderRedraw(this.host, st);
	}

	/** Close (spec §13.2): the views show what they showed before (the focus family, or all people); the focus goes to the More button. */
	private closeFinder(): void {
		const st = this.ensureState();
		st.finder = null;
		this.focusDue = '.dynasty-more';
		TreeView.finderRedraw(this.host, st);
	}

	// ---------- the Show view of a line of succession (contract 0.2.7 F) ----------

	/**
	 * The Show view to draw, from the block state and the whole tree: computed again at each render, so it follows every edit (F.7). A
	 * title that is gone, or a saved line that is not `kind: 'line'` any more, ends the view (F.1). The static touch preview never
	 * draws the tree view (D1); the list on a phone draws the bar (F.6).
	 */
	private successionFor(st: BlockState, whole: FamilyGraph): SuccessionDrawn | null {
		const s = st.succession;
		if (!s) return null;
		const set = this.host.settings ?? DEFAULT_SETTINGS;
		const d = successionDrawn(whole, s.title, { limit: set.successionLength, oldAge: set.oldAge, youngDeathAge: set.youngDeathAge });
		if (!d) {
			st.succession = null;
			return null;
		}
		if (!this.full && this.coarse && !this.isPhone()) return null;
		return d;
	}

	/** The people that the folds must show: the finder's line, or the ruler, the heirs and the open branches of the Show view (F.2, M.9). */
	private linePeopleNow(): string[] | null {
		if (this.successionDrawn) return linePeople(this.successionDrawn);
		return this.finderDrawn?.line?.people ?? null;
	}

	/** The banner of the Show view (F.3, 0.2.8 G.13): the sentence and Close in one row, with the look and the place of the finder's banner. */
	private buildSuccessionBar(viewport: HTMLElement, before: HTMLElement, d: SuccessionDrawn): void {
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: ['dynasty-result', 'dynasty-succession-bar', ...(this.barKind() === 'phone' ? ['dynasty-result-phone'] : [])], attr: { role: 'group', 'aria-labelledby': id } });
		// After the toolbar and before the cards in the Tab order, like the finder's bar.
		viewport.insertBefore(bar, before);
		bar.createDiv({ cls: ['dynasty-result-text', 'dynasty-succession-text'], text: d.sentence, attr: { id, role: 'status', tabindex: -1 } });
		const row = bar.createDiv({ cls: 'dynasty-result-buttons' });
		this.closeLink(row, 'dynasty-succession-close', SUCCESSION_UI.barClose, SUCCESSION_UI.barCloseLabel, () => this.closeSuccession());
	}

	/** The cards of heirs and branches say their place in the screen-reader label (F.4). The scene's own text has none: it does not know the line. */
	private markPositions(): void {
		const d = this.successionDrawn;
		const scene = this.scene;
		const g = this.g;
		const opts = this.lastLayout?.opts;
		if (!d || !scene || !g || !opts) return;
		for (const id of d.ordinals.keys()) {
			const card = scene.cards.get(id);
			const p = g.byId.get(id);
			if (!card || !p) continue;
			const label = cardLabel(p, opts.me === id ? 'you' : opts.relations?.get(id)?.lower, opts.labels?.get(id), cardPosition(d, id));
			card.setAttribute('aria-label', card.hasClass('dynasty-signed') ? `${label}, ${SIGN_CARD_LABEL}` : label);
		}
	}

	/** Close, Esc: the views show what they showed before; the focus goes back to More (the list: to Find). */
	private closeSuccession(): void {
		const st = this.ensureState();
		st.succession = null;
		this.focusDue = this.listMode ? '.dynasty-list-find' : '.dynasty-more';
		TreeView.successionRedraw(this.host, st);
	}

	/**
	 * Show (Titles window, contract E.4): opens the view of the line of `title` in every view of the block that can draw it. It writes
	 * nothing. If only a phone list or a static preview shows the block, the full-screen view opens with it, as for the finder.
	 */
	static showSuccession(host: TreeHost, st: BlockState, title: string, origin: TreeView | null): void {
		st.succession = { title };
		// One temporary view at a time (F.1).
		st.finder = null;
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st);
		const shows = views.filter((v) => v.full || !v.coarse);
		if (shows.length) {
			const same = shows.filter((v) => !origin || !!v.full === !!origin.full);
			const at = origin && shows.includes(origin) ? origin : same.length === 1 ? same[0] : null;
			if (at) at.focusDue = '.dynasty-succession-text';
			TreeView.successionRedraw(host, st);
			return;
		}
		TreeView.successionRedraw(host, st);
		const preview = origin && views.includes(origin) ? origin : views[0];
		if (preview) void preview.openFull(null, null, '.dynasty-succession-text');
	}

	/**
	 * Every phone list of the block draws again at once, also under an open full-screen view (a list is cheap to draw). Esc in that view
	 * ends the finder first and leaves the view open, so a list that waited for the view to close would keep the old bar.
	 */
	private static listRedraw(host: TreeHost, st: BlockState): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || v.full || !v.coarse || !v.isPhone()) continue;
			v.pendingTarget = null;
			v.syncFocus(true);
		}
	}

	/** Every view of the block that can show the Show view or its bar draws again (F.2: this includes the phone list; never the static tablet preview, D1). */
	private static successionRedraw(host: TreeHost, st: BlockState): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || (!v.full && v.coarse && !v.isPhone())) continue;
			v.pendingTarget = null;
			v.syncFocus();
		}
	}

	/**
	 * The first view of the Show view (F.2): the ruler and the heirs below the bar. The open branches are not fitted. On a phone it
	 * never goes below the scale `PHONE_MIN_SCALE`: it starts at the ruler (prototype finding 2).
	 */
	private successionView(laid: LaidOut, size: Size, d: SuccessionDrawn): View {
		const persons = laid.layout.persons;
		const ruler = persons.get(d.ruler);
		const heirs = boxesOf(persons, d.heirs);
		if (!ruler) return this.defaultViewFor(laid, size);
		const bounds = around([ruler, ...heirs]);
		const v = this.aboveBottomBar(size, (area) => successionFirstView(bounds, area, laid.layout.geometry.fontPx, this.insetTop, ruler, heirs, laid.layout.orientation, this.isPhone() ? PHONE_MIN_SCALE : 0));
		return this.keepTopWhole(v, size, laid, [ruler, ...heirs]);
	}

	/** D212 (bars-in-flow): a first view that the plugin chooses never leaves a card cut in two by the toolbar and the banner at the top (`keepTopCardWhole`). */
	private keepTopWhole(v: View, size: Size, laid: LaidOut, keys: readonly Rect[]): View {
		return keepTopCardWhole(v, size, this.insetTop, size.h - Math.max(0, this.insetBottom), laid.layout.persons.values(), keys);
	}

	/**
	 * After a first view: the keyboard focus goes where a finder action in this view asked (a new
	 * result's sentence, which a screen reader reads and Esc closes; the pressed button of the bar;
	 * More after Close). Never while a sheet or a picker of the plugin is open.
	 */
	private takeFocus(): void {
		const sel = this.focusDue;
		this.focusDue = null;
		if (!sel || pluginModalOpen()) return;
		this.viewport?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
	}

	/**
	 * The first view of the finder's tree on every device: see `finderFirstView`. The line is the whole
	 * small tree, or its cards in "Show in the whole tree"; the free area is below the result bar and
	 * above a bottom toolbar.
	 */
	private finderView(laid: LaidOut, size: Size, d: FinderDrawn): View {
		const boxes = boxesOf(laid.layout.persons, d.line?.people ?? []);
		const bounds = d.state.whole && boxes.length ? around(boxes) : this.bounds;
		const sideways = laid.layout.orientation === 'sideways';
		// The oldest generation of the line: the smallest top edge (`down`) or left edge (sideways).
		const edge = (b: Rect) => (sideways ? b.x : b.y);
		const least = Math.min(...boxes.map(edge));
		const oldest = boxes.filter((b) => edge(b) <= least + 1);
		const v = this.aboveBottomBar(size, (area) => finderFirstView(bounds, area, laid.layout.geometry.fontPx, this.insetTop, oldest, laid.layout.orientation));
		return this.keepTopWhole(v, size, laid, boxes);
	}

	/**
	 * The More button (D49, 0.2.8 G.13): the menu of the toolbar. On a phone Fit and Titles come first (the phone's bar has neither button); then the line
	 * styles (the legend), Relation (spec §13.2), Save as picture (spec §13.8) and, where the block can be edited, Show the tree text. Titles of the computer have a button of their own.
	 */
	private toggleMore(opener: HTMLElement, keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'more') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'more',
			(el) => {
				const item = (icon: string, text: string, cls: string, run: () => void, label?: string) => this.menuItem(pop, el, icon, text, cls, run, label);
				const rows: HTMLElement[] = [];
				if (this.barKind() === 'phone') {
					rows.push(item('minimize', UI.fit, 'dynasty-more-fit', () => this.fit()));
					// Spec §13.4, D49: the Titles window, where the block can be edited.
					if (this.canEditWindows()) rows.push(item('crown', TITLES_UI.more, 'dynasty-more-titles', () => void this.openTitles(), TITLES_UI.moreLabel));
				}
				rows.push(item('book-open', UI.legend, 'dynasty-more-legend', () => this.toggleLegend(opener)));
				rows.push(item('route', FINDER_UI.relation, 'dynasty-more-relation', () => void this.startFinder(), FINDER_UI.relationLabel));
				// Spec §13.8, O11: wherever the More list is, read-only views included.
				if (this.laid) rows.push(item('image-down', SAVE_UI.more, 'dynasty-more-save', () => this.openSave(), SAVE_UI.moreLabel));
				// D176 (2): the last item, where the block can be edited.
				if (this.canShowText()) rows.push(item('code', BLOCK_UI.showText, 'dynasty-more-text-source', () => void this.showText(), BLOCK_UI.showTextLabel));
				// Enter or Space on More moves the focus into the list (spec §5.2).
				if (keyboard) rows[0].focus();
			},
			opener,
			where.anchor,
			where.opts,
		);
	}

	/** Relation (spec §13.2): the first person, then the second (not the first); the marked person is offered first. */
	private async startFinder(): Promise<void> {
		const g = this.whole;
		if (!g || this.unloaded) return;
		const st = this.ensureState();
		const me = this.meId;
		const a = await pickPerson(this.host.app, g, new Set(), FINDER_UI.placeholder, FINDER_UI.firstTitle, false, me, null, this.pickerContext());
		if (a?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-more'));
			return;
		}
		const b = await pickPerson(this.host.app, g, new Set([a.id]), FINDER_UI.placeholder, FINDER_UI.secondTitle, false, me !== a.id ? me : null, null, this.pickerContext());
		if (b?.kind !== 'person') {
			this.guard(() => this.refocusTool('.dynasty-more'));
			return;
		}
		this.guard(() => TreeView.showFinder(this.host, st, a.id, b.id, this.unloaded ? null : this));
	}

	/**
	 * A picker closed with no choice: the keyboard focus goes back to the toolbar button that led to
	 * it (More, Focus; spec §5.2), as the item that had it is gone with its list. Not while another
	 * window of the plugin is open.
	 */
	private refocusTool(selector: string): void {
		if (this.unloaded || pluginModalOpen()) return;
		const tool = this.viewport?.querySelector<HTMLElement>(selector);
		if (tool?.isConnected) tool.focus();
	}

	/**
	 * Shows `second` as a relative of `first` (spec §13.2) in every view of the block that can show it.
	 * It writes nothing. Through the block state, not a view: the view that opened a sheet can be gone.
	 * If only the static touch preview shows the block (D1), the preview does not change and the
	 * full-screen view opens with the result (like D17).
	 */
	static showFinder(host: TreeHost, st: BlockState, first: string, second: string, origin: TreeView | null): void {
		st.finder = { first, second, index: 0, whole: false, steps: false };
		// One temporary view at a time (contract 0.2.7 F.1). The finder skips the phone list, so a list under a Show view that ends here draws again.
		const hadShow = st.succession !== null;
		st.succession = null;
		if (hadShow) TreeView.listRedraw(host, st);
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st);
		const shows = views.filter((v) => v.full || !v.coarse);
		if (shows.length) {
			// The sentence takes the keyboard focus only in the view the user acted in. If Obsidian drew that
			// view again meanwhile (a write from its sheet), the one view of the same kind that replaced it.
			const same = shows.filter((v) => !origin || !!v.full === !!origin.full);
			const at = origin && shows.includes(origin) ? origin : same.length === 1 ? same[0] : null;
			if (at) at.focusDue = '.dynasty-result-text';
			TreeView.finderRedraw(host, st);
			return;
		}
		const preview = origin && views.includes(origin) ? origin : views[0];
		if (preview) void preview.openFull(null, null, '.dynasty-result-text');
	}

	/**
	 * Every view of the block that can show the finder's result draws again; never the static touch
	 * preview (D1). Only `origin` gets `target`, to centre and highlight (Find, the problem list).
	 */
	private static finderRedraw(host: TreeHost, st: BlockState, origin: TreeView | null = null, target: string[] | null = null): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || (!v.full && v.coarse)) continue;
			v.pendingTarget = v === origin ? target : null;
			v.syncFocus();
		}
	}

	/**
	 * Find or the problem list chose people that the view does not draw (spec §6.10). Find is not a
	 * focus choice, so a result of the finder stays (spec §13.2): its small tree switches to the whole
	 * tree, or, with no line, the view shows all people with the bar. Without a result the view shows
	 * all people, as before.
	 */
	private showOutside(ids: string[]): void {
		const st = this.ensureState();
		const f = st.finder;
		if (!f || !this.finderDrawn) {
			this.focusOn(null, ids);
			return;
		}
		if (this.finderDrawn.line) {
			f.whole = true;
			TreeView.finderRedraw(this.host, st, this, ids);
			return;
		}
		st.focus = { id: null };
		st.shown = null;
		TreeView.redrawState(this.host, st, { target: ids, origin: this });
	}
}

/** The drawn graph has a person with a portrait (O10): only then does "Show portraits on cards" change its layout. */
function hasPortraits(g: FamilyGraph | null): boolean {
	return !!g?.people.some((p) => !!p.portrait);
}

/** The drawn graph has arms that a card could show (a house with arms, or a person with personal arms): only then does "Arms on cards" change its layout. */
function hasArms(g: FamilyGraph | null): boolean {
	return !!g?.people.some((p) => !!p.arms || (p.house !== undefined && !!g.houses.get(p.house)?.arms));
}

/** Tells two picture owners apart (a house and a person can share an id). */
function ownerKey(o: PictureOwner): string {
	return o.kind === 'arms' ? `arms:${o.house.id}` : `${o.arms ? 'person-arms' : 'portrait'}:${o.person.id}`;
}

/** Some card shows a reign (spec §13.3): "Show dates on cards" then changes the title text lines. */
function hasReign(labels: ReadonlyMap<string, CardLabel> | undefined): boolean {
	for (const l of labels?.values() ?? []) if (l.reign !== undefined) return true;
	return false;
}

/** F16: the accessible name and the tooltip of a fold control, from the parents' names. */
function foldLabel(c: FoldControl, names: readonly string[]): string {
	return c.folded ? FOLD_UI.showLabel(names, c.count) : FOLD_UI.hideLabel(names);
}

/** The finder's line as the scene marks it (D47); `fade` for "Show in the whole tree". */
function lineMarks(line: RelationLine, fade: boolean): NonNullable<SceneOptions['line']> {
	return { people: new Set(line.people), unions: new Set(line.unions), links: new Set(line.links.map((l) => `${l.parent}\u0000${l.child}`)), ...(fade ? { fade: true } : {}) };
}

/** The rectangle around `boxes`, with the tree's margin. */
function around(boxes: readonly Rect[], margin = FIT_MARGIN): Rect {
	const x0 = Math.min(...boxes.map((b) => b.x));
	const y0 = Math.min(...boxes.map((b) => b.y));
	const x1 = Math.max(...boxes.map((b) => b.x + b.w));
	const y1 = Math.max(...boxes.map((b) => b.y + b.h));
	return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

/** The drawn cards of `ids`, in the same order; people with no card are left out. */
function boxesOf(persons: ReadonlyMap<string, PersonBox>, ids: Iterable<string>): PersonBox[] {
	return [...ids].map((id) => persons.get(id)).filter((b): b is PersonBox => !!b);
}
