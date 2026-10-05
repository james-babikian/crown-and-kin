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
 *   - Sizing and layout: the note preview's height and narrow-card width, sideways re-layout (D24).
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
import { findRelation, lineSubgraph } from '../core/relations';
import type { FinderResult, RelationLine } from '../core/relations';
import { cardLabels, needsLabels, type CardLabel } from '../core/titles';
import type { ParseResult, Person, Tree } from '../core/types';
import { FOLD_EM } from '../layout/fold-spots';
import { geometryFor, namesOnlyGeometry } from '../layout/geometry';
import { DEFAULT_FAR_RULE, NEVER_FAR_RULE } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings, Orientation, PersonBox, Rect } from '../layout/model';
import { fontsChanged, parsePx, usesFamily, type FontState } from '../render/fonts';
import { clearMeasureCache, measureText, usableFamily } from '../render/dom/measure';
import { calloutBackdrop, plusChoice } from '../render/dom/theme-read';
import { PanZoom, visibleRect } from '../render/dom/pan-zoom';
import { setLegendArms, type PictureSlot } from '../render/dom/pictures';
import { FILL_ALL_EVENT, buildLegend, buildScene, discPath, lodClass, type CardLink, type Scene, type SceneOptions } from '../render/dom/scene';
import { sameLifted, sameTall } from '../render/dom/tall-cards';
import { parseBreakList } from '../render/break-words';
import { buildCallout, Popover } from '../render/dom/widgets';
import { legendHouses } from '../render/legend';
import { familyOf, finderSentence, linkTarget, startPerson, stepSentences, type RenderTiming } from '../render/tree-info';
import { ADD_UI, BLOCK_UI, FINDER_UI, FOCUS_UI, FOLD_UI, FULL_UI, HEIGHT_UI, HINT_UI, HOUSES, PROBLEMS_HINT, SAVE_UI, TITLES_UI, UI, WRITE_TEXT, problemsLabel, problemsTitle } from '../render/ui-text';
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
import { sameBody } from '../core/block-match';
import type { Handle, HandleRegistry } from './block-handle';
import { carryState, focusKey, newBlockState, type BlockState, type FinderState } from './block-state';
import { EditSheet, type SheetFolds } from './edit-sheet';
import { NARROW_MAX_EM, PHONE_FOCUS_MIN_PEOPLE, badgeTap, chooseFocus, clearToolbar, finderFirstView, finderOrientation, focusView, isPhoneWindow, narrowCardWidth, orientationFor, outsideBox, sidewaysView, tagHitBelow } from './focus-mode';
import { cutBack, planFolds, withFolds, type FoldPlan } from './fold-view';
import type { FoldRef } from '../render/dom/folds';
import { FullScreenModal } from './full-screen';
import { openHousePage } from './house-page-window';
import { HousesWindow } from './houses-window';
import { createLivePictures, zoomStep, type LivePictures } from './live-pictures';
import { measuredLayout, type MeasuredResult } from './measured-layout';
import { pickPerson } from './person-picker';
import type { CopyBox, PictureCopy, PictureStore, ResolvedPicture } from './picture-store';
import { pluginModalOpen } from './plugin-modals';
import { relationsFor, validMe } from './relation-cache';
import { SaveWindow, savePicture, type SaveSource } from './save-picture';
import { DEFAULT_SETTINGS, phoneHeightSteps, reducedMotion, type DynastySettings, type PhoneCardStyle } from './settings';
import { TitlesWindow } from './titles-window';

/** The most cards attached in one idle chunk. */
const IDLE_CARDS_PER_CHUNK = 25;
/** An idle chunk stops when the idle callback has less than this many ms left. */
const IDLE_STOP_MS = 4;

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
}

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

/** O3: the legend's arms box, in CSS px (styles.css `.dynasty-legend-arms`). */
const LEGEND_ARMS_BOX: CopyBox = { w: 20, h: 24, fit: 'meet' };

/** Runs `fn` in the next idle time (a timer where the browser has no idle callback, as Safari); the fold and card chains share it. */
function later(fn: (idle: { timeRemaining(): number }) => void): void {
	const ric = (globalThis as unknown as { requestIdleCallback?: (f: typeof fn, o: { timeout: number }) => number }).requestIdleCallback;
	if (ric) ric.call(globalThis, fn, { timeout: 1500 });
	else setTimeout(() => fn({ timeRemaining: () => 8 }), 300);
}

/** The page-preview source id for card names: `main.ts` registers it, and the tree view sends it with each hover-link event. */
export const HOVER_SOURCE = 'dynasty-tree';
const HIGHLIGHT_MS = 2000;
/** Height of the D28 hint label in px (styles.css), to put it level with the toolbar. */
const HINT_HEIGHT = 28;
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
	/** The narrow card width for the note preview's box, once the box has a width; the width the layout used. */
	private narrowW: number | undefined;
	private narrowUsed: number | undefined;
	/** What the last render laid out and drew with, so the note preview can lay out again in place. */
	private lastLayout: { geo: Geometry; settings: LayoutSettings; sceneEl: SVGGElement; opts: SceneOptions } | null = null;
	/** A person to centre and highlight in the next first view (Find of a person outside the focus family). */
	private pendingTarget: string[] | null = null;
	/** The toolbar at the top of the viewport, in viewport px (null when it is at the bottom). */
	private barBox: { left: number; right: number; top: number; bottom: number } | null = null;
	/**
	 * The next sized resize shows the first view: the note preview was laid out again (a new narrow
	 * card width, D29 names after a font change), perhaps while its box had no height yet.
	 */
	private firstDue = false;
	/** D28: the children of the first view's person, and whether the hint still counts them (until the user moves the view). */
	private hintKids: PersonBox[] = [];
	private hintOn = false;
	/** The session focus changed while a full-screen view of this block was open: draw again when it closes. */
	private focusStale = false;
	/** The block's folds changed while this view had no size (the other mode of the note): it draws again when it shows (M10 F10). */
	private foldsStale = false;
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
	private popover: Popover | null = null;
	private observer: ResizeObserver | null = null;
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
	private readonly info: MarkdownSectionInformation | null;
	/** What Obsidian reported for this block, on the root as `data-dynasty-section` for the test harness. */
	private readonly sectionNote: string;
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
	/**
	 * After the next first view, the keyboard focus goes here: the result's sentence, or a button by its
	 * class. Only the view the user acted in (or the full-screen view it opened) sets it, so a view that
	 * Obsidian draws again, or another pane of the note, never takes the focus.
	 */
	private focusDue: string | null = null;
	/** D51: the finder's small tree laid out top to bottom on an upright phone, until the first view picks the direction. */
	private finderAlt: MeasuredResult | null = null;
	private retries = 0;
	private retryTimer = 0;
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
	/** The legend's arms copies, held while the legend shows them. */
	private legendCopies: PictureCopy[] = [];
	/** Stops the legend's arms requests that still wait (the legend closed). */
	private legendAbort: AbortController | null = null;
	private unsubPictures: (() => void) | null = null;

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
			this.readOnly = f.readOnly || !f.handle;
			this.sectionNote = 'full';
			this.peeked = f.handle ?? f.peeked;
			this.key = f.key;
			this.ready = Promise.resolve(this.readOnly ? null : f.handle);
			this.focusDue = f.focusDue ?? null;
			return;
		}
		const ctx = place.ctx;
		this.full = null;
		this.sourcePath = ctx.sourcePath;
		const info = ctx.getSectionInfo(containerEl);
		this.info = info;
		this.readOnly = info === null;
		this.sectionNote = info ? `${info.lineStart}-${info.lineEnd}` : 'none';
		const ordinal = info ? host.handles.quickOrdinal(info, source) : null;
		// Only for the view state until `resolve` has checked the block: never written through.
		this.peeked = ordinal === null ? null : host.handles.peek(ctx.sourcePath, ordinal);
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

	/**
	 * A setting changed (spec §9): the view draws again with it. A new card size gives a new layout,
	 * so the view starts at its first view; other changes keep the tree point at the centre. The
	 * dates only change a class, and the heights only the box (D30).
	 */
	onSettingsChange(prev: DynastySettings): void {
		this.guard(() => {
			if (this.unloaded) return;
			const now = this.settings;
			const root = this.viewport?.parentElement ?? null;
			// The generations matter only while a focus family is drawn. Spec §13.3: "Show dates on cards"
			// also takes the reign off the title text line, which can change a card's height (D61).
			const reigns = prev.showDates !== now.showDates && hasReign(this.lastLayout?.opts.labels);
			// O10: "Show portraits on cards" gives or takes the portrait room: the tree is laid out again.
			const portraits = prev.showPortraits !== now.showPortraits && hasPortraits(this.g);
			// D118: a new list of break places can change which names need more text lines.
			const breaks = prev.breakWords !== now.breakWords;
			// D119: the card style of the phone preview. Only the static note preview on a phone has one; no other view changes.
			const style = prev.phoneCardStyle !== now.phoneCardStyle && this.phoneStyle() !== null;
			// The marked names-only card puts "You" after the years, or at the text left when they are off: a class cannot move it.
			const you = prev.showDates !== now.showDates && this.lastLayout?.geo.namesOnly === true && this.meId !== null;
			// D126 (1): "Reduce movement" is read when a movement starts, so a change needs no redraw.
			if (!reigns && !portraits && !breaks && !style && !you && prev.cardSize === now.cardSize && (prev.focusGenerations === now.focusGenerations || this.focusId === null)) {
				root?.toggleClass('dynasty-no-dates', !now.showDates);
				root?.toggleClass('dynasty-no-relations', !now.showRelations);
				this.updateHeight();
				// Rule B lifts the boxes only while the relation words show (D126 4). The cards keep their size, so only the boxes may move.
				if (prev.showRelations !== now.showRelations) this.recheckTall();
				return;
			}
			this.carry = prev.cardSize === now.cardSize && !style ? this.keptAnchor() : null;
			this.render(this.fonts);
		});
	}

	/** Obsidian calls this once the block's container is in the DOM: wires listeners and renders it. */
	override onload(): void {
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
		// Esc closes the relation finder's result and gives the focus back (spec §13.2). The window hears
		// it first, as for the popovers, so a full-screen view around the tree stays open.
		this.registerDomEvent(
			win,
			'keydown',
			(e) => {
				if (e.key !== 'Escape' || !this.finderDrawn || this.popover?.isOpen) return;
				const active = this.containerEl.doc?.activeElement ?? null;
				if (!active || !this.viewport?.contains(active)) return;
				e.stopPropagation();
				e.preventDefault();
				this.guard(() => this.closeFinder());
			},
			{ capture: true },
		);
		// O9: a picture file changed, came or went: the pictures of this tree follow (no new layout).
		const store = this.host.pictures;
		if (store) this.unsubPictures = store.onChange((paths) => this.guard(() => this.picturesChanged(paths)));
		// D7: a view that gave up finding its block tries again when the note changes (the pasted copy is deleted).
		if (this.info && !this.full) this.unwatch = this.host.handles.watchNote?.((path) => this.guard(() => this.noteModified(path))) ?? null;
		this.guard(() => this.render(null));
		if (this.info || this.full) {
			void this.ready.then((h) => this.guard(() => this.attach(h)));
		}
	}

	/** Obsidian calls this when the block leaves the note: stops timers and tears the scene down. */
	override onunload(): void {
		this.unloaded = true;
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
			if (!this.readOnly) {
				this.readOnly = true;
				this.updateEditUi();
			}
			this.retryResolve();
			return;
		}
		this.readOnly = false;
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
			if (loose && h.state.heightStep === undefined) h.state.heightStep = loose.heightStep;
			if (loose && h.state.autoFocus === null) {
					h.state.autoFocus = loose.autoFocus;
					h.state.autoMark = loose.autoMark;
				}
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
	private lateResolve(): void {
		if (this.info || this.full || this.lateTried || this.handle) return;
		this.lateTried = true;
		if (this.inForeignView() || !this.host.handles.inEditorOf(this.containerEl, this.sourcePath)) return;
		const h = this.host.handles.resolveByBody(this.sourcePath, this.source);
		this.ready = Promise.resolve(h);
		if (h) this.attach(h);
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

	/** Called by the plugin on `css-change`: re-measure and re-layout only if a font changed (§5.8). */
	onCssChange(): void {
		this.guard(() => {
			if (!this.fonts || !this.containerEl.isConnected) return;
			const now = this.blockFonts();
			if (fontsChanged(now, this.fonts)) this.rerender(now);
			// D29: the same fonts can measure other widths once a theme's font face is in use.
			else this.recheckTall(true);
			this.readTheme();
		});
	}

	/** Called by the plugin `THEME_RECHECK_MS` after `css-change`: a theme can change its colours a frame later (its style sheet still loads). */
	recheckTheme(): void {
		this.guard(() => this.readTheme());
	}

	/** The fonts at the block's place in the note. */
	private blockFonts(): FontState {
		const probe = this.fontProbe;
		return probe?.isConnected && probe.parentElement?.parentElement === this.containerEl ? fontsOf(probe) : readFonts(this.containerEl);
	}

	/**
	 * What one CSS rule cannot follow in every theme. The toolbar in a callout shows the
	 * callout's own background as the theme paints it (spec §10); the `+` badge takes the text colour
	 * where the theme's text-on-accent is too weak on its accent.
	 */
	private readTheme(): boolean {
		const vp = this.viewport;
		const root = vp?.parentElement;
		if (!vp || !root || !vp.isConnected) return false;
		// Outside a callout there is nothing to read (no computed style, spec §7.7).
		this.calloutBg = vp.closest('.callout') ? calloutBackdrop<HTMLElement>(vp, (e) => getComputedStyle(e).backgroundColor) : null;
		this.paintCalloutBg();
		root.toggleClass('dynasty-plus-text', plusChoice(root));
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
		const bandClear = !this.panZoom || bandShift(v, this.panZoom.size, this.insetTop, laid.layout.persons.values()) === 0;
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
		this.releaseLegend();
		this.panZoom?.destroy();
		this.panZoom = null;
		this.popover?.close();
		this.popover = null;
		this.observer?.disconnect();
		this.observer = null;
		for (const t of this.timers) this.containerEl.win.clearTimeout(t);
		this.timers.clear();
		this.hoverPopover = null;
	}

	private render(fontsOverride: FontState | null): void {
		this.foldsStale = false;
		this.teardown();
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
		this.finderAlt = null;
		const win = el.win;
		// D24: sideways on a phone in portrait. Set first, so a block with no tree follows a turn too.
		const orientation = orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen);
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
		const whole = deriveFamilies(parsed.tree);
		const t1 = performance.now();
		if (!whole.people.length && !whole.issues.some((i) => i.level === 'blocking')) {
			this.renderEmpty(el, whole);
			return;
		}
		const fonts = fontsOverride ?? readFonts(el);
		// D119: the static note preview on a phone draws names-only cards, unless its style is the whole card. The full-screen view and the saved picture always draw whole cards.
		const style = this.phoneStyle();
		const names = style !== null && style !== 'whole';
		const geo = names ? namesOnlyGeometry(geometryFor(fonts.px, this.settings.cardSize)) : geometryFor(fonts.px, this.settings.cardSize);
		// The static note preview has narrow cards, as wide as its box allows for two whole generations.
		const cards = this.full ? ('normal' as const) : ('narrow' as const);
		this.narrowUsed = orientation === 'sideways' && cards === 'narrow' ? (this.narrowW ?? narrowCardWidth(el.clientWidth, geo.fontPx)) : undefined;
		const base: LayoutSettings =
			orientation === 'sideways'
				? { sweeps: 4, far: DEFAULT_FAR_RULE, orientation, sidewaysCards: cards, ...(this.narrowUsed !== undefined ? { narrowCardW: this.narrowUsed } : {}) }
				: { sweeps: 4, far: DEFAULT_FAR_RULE };
		const focus = this.updateFocus(parsed.tree, whole);
		const st = this.ensureState();
		// F9: a fold whose family has no child any more (or no parent) ends with the parse; a text that does not parse keeps the folds.
		const kept = pruneFolds(whole, st.folds);
		if (kept !== st.folds) st.folds = new Set(kept);
		// Spec §13.2: the finder's result is computed again from the new text at each render; with a
		// line it replaces the focus family (the search uses the whole tree), and Close brings it back.
		const finder = this.finderFor(st, whole);
		this.finderDrawn = finder;
		// A tag or a problem in the static preview opened this view on a person (D17). If the small tree
		// of the line does not draw them, the result shows in the whole tree, so the person can be centred.
		const target = this.full?.target;
		if (finder?.line && !finder.state.whole && target && whole.byId.has(target) && !finder.line.people.includes(target)) finder.state.whole = true;
		const small = finder?.line && !finder.state.whole ? finder.line : null;
		// Focus mode (spec §5.6): only the focus family is laid out and drawn; the whole tree's
		// problems stay on the badge, and every edit reads the whole block. D23: the
		// static preview on a phone shows 1 generation up and down, so the children show below.
		const n = !this.full && this.isPhone() ? 1 : focusGenerationsFor(parsed.tree.options, this.settings.focusGenerations);
		let sub = focus !== null && !finder?.line ? focusSubgraph(parsed.tree, focus, n) : null;
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
		// D119: a names-only card shows no relation word, so none is computed for the card pass (the full-screen view and the saved picture compute them).
		const rel = me !== null && !small && !names ? relationsFor(whole, me) : null;
		// M10 (F1, F8): the computer and the full-screen view apply the folds; the static phone preview never does.
		const canFold = !!this.full || !this.coarse;
		let plan = planFolds(g, whole, st.folds, canFold, finder?.line?.people ?? null);
		// F11: a person that a flow asked for (a tag or a problem in the preview, Find outside the focus family) is shown.
		if (canFold && plan.hidden.size) {
			const asked = (this.full?.target ? [this.full.target] : (this.pendingTarget ?? [])).filter((id) => plan.hidden.has(id));
			if (asked.length) {
				st.folds = new Set(unfoldFor(g, whole, st.folds, asked));
				plan = planFolds(g, whole, st.folds, canFold, finder?.line?.people ?? null);
			}
		}
		this.foldPlan = plan;
		// D40: with a mark every card has the relation text line, also when the setting hides the names.
		const laidBase: LayoutSettings = withFolds(small ? { ...base, far: NEVER_FAR_RULE } : rel ? { ...base, relationLine: true } : base, plan, canFold);
		// Spec §13.3, §13.5: the card labels of the drawn graph. A tree with no titles draws as in M7 (no labels).
		const labels = needsLabels(g) ? cardLabels(g) : undefined;
		const { laid, settings, lifted } = this.layOut(g, geo, laidBase, fonts, sub?.hidden, labels, plan.hidden, rel?.cards);
		// D51: on an upright phone the small tree is also laid out top to bottom. The first view, which
		// knows the free area between the result bar and the toolbar, draws the direction with larger names.
		this.finderAlt = small && orientation === 'sideways' ? this.layOut(g, geo, withFolds({ sweeps: 4, far: NEVER_FAR_RULE }, plan, canFold), fonts, undefined, labels, plan.hidden) : null;
		const t2 = performance.now();
		// A saved view of normal cards means nothing on compact cards (spec §9 card size).
		const size = geo.cardSize === 'compact' ? '|compact' : '';
		// The finder's tree has its own key: its views never replace the saved view of the family.
		const finderKey = finder?.line ? `finder:${finder.state.first}>${finder.state.second}:${finder.state.index}:${finder.state.whole ? 'whole' : 'line'}|` : '';
		const family = finderKey + focusKey(sub ? focus : null, n) + size;
		// A view of one family means nothing in another: the new family gets its own first view.
		if (this.familyKey !== null && this.familyKey !== family) this.carry = null;
		this.familyKey = family;
		this.drawnKey = finderKey + focusKey(sub ? focus : null, n, orientation, cards) + size;
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
		this.placeClasses(root);
		// Spec §9: the dates hide, the cards keep their size (the layout does not change). The same for the relation names (D40).
		root.toggleClass('dynasty-no-dates', !this.settings.showDates);
		root.toggleClass('dynasty-no-relations', !this.settings.showRelations);
		const blocking = whole.issues.filter((i) => i.level === 'blocking');
		this.blocked = blocking.length > 0;
		if (blocking.length) {
			const banner = buildCallout(root, 'warning', UI.bannerTitle, 'dynasty-banner');
			banner.content.createDiv({ text: UI.bannerLead });
			const list = banner.content.createEl('ul');
			for (const i of blocking) list.createEl('li', { text: issueText(i) });
		}

		const viewport = root.createDiv({ cls: 'dynasty-viewport' });
		this.viewport = viewport;
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
			...(lifted.size ? { lifted } : {}),
			link: (p) => this.cardLink(p),
			badges: sub ? { hidden: sub.hidden, label: (p, n) => FOCUS_UI.badgeLabel(p.name, n) } : undefined,
			...(rel ? { relations: rel.cards } : {}),
			...(me !== null ? { me } : {}),
			...(finder?.line ? { line: lineMarks(finder.line, finder.state.whole) } : {}),
			...(labels ? { labels } : {}),
			showDates: this.settings.showDates,
			...(canFold ? { folds: { buttons: true, label: foldLabel, lazy: true, wire: (f: FoldRef) => this.wireFoldHit(f) } } : {}),
		};
		this.scene = buildScene(sceneEl, g, laid, opts);
		this.lastLayout = { geo, settings, sceneEl, opts };
		this.wireScene(this.scene);
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
		this.wireCardPresses(viewport);
		this.updateEditUi();

		this.panZoom = new PanZoom({
			viewport,
			scene: sceneEl,
			wrapper: canvas,
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
		if (this.full) this.closeButton(root.createDiv({ cls: 'dynasty-toolbar' }));
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
	 * A phone, upright or on its side: the phone height of D30, the D20 focus family and the D23
	 * generations. The screen decides, not the window: an on-screen keyboard makes a tablet's window
	 * lower than 600 px, but not its screen.
	 */
	private isPhone(): boolean {
		const win = this.containerEl.win;
		const screen = win.screen;
		return isPhoneWindow(this.coarse, screen?.width || win.innerWidth, screen?.height || win.innerHeight);
	}

	/** D119: the card style of the static note preview on a phone; null for every other view (the computer, the full-screen view), which draws whole cards. */
	private phoneStyle(): PhoneCardStyle | null {
		return !this.full && this.isPhone() ? this.settings.phoneCardStyle : null;
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
		const me = validMe(whole, tree.options.me);
		const choice = chooseFocus({
			session: st.focus,
			pin: tree.options.focus,
			phone: this.isPhone(),
			auto: st.autoFocus,
			autoMark: st.autoMark,
			// D111: a marked person opens a small tree on a phone as a family too; the full-screen view keeps its rule.
			marked: !this.full && me !== null,
			...(this.full ? {} : { mark: me }),
			has: (id) => whole.byId.has(id),
			large: () => whole.people.length > PHONE_FOCUS_MIN_PEOPLE,
			// Spec §5.5 on a phone: the person last edited, `options.start`, the marked person, the first root.
			start: () => startPerson(whole, [st.lastEdited, tree.options.start, this.full ? null : me].find((id) => id != null && whole.byId.has(id)) ?? undefined),
		});
		if (choice.dropSession) st.focus = null;
		st.autoFocus = choice.auto;
		st.autoMark = choice.autoMark;
		return choice.id;
	}

	/**
	 * Sets the session focus of this block (Focus, Focus here, a `+` badge; null: Show all people)
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
		// A choice of the user replaces a pending "show the saved person", and the finder's result (spec §13.2).
		st.shown = null;
		st.finder = null;
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
		const s = this.settings;
		const phone = this.isPhone();
		// D120: the height button picks one of three heights; a note that was never touched has the start height (the middle step).
		const step = this.peekState()?.heightStep ?? 1;
		const phoneH = `${phoneHeightSteps(s.embedHeightPhone)[step]}vh`;
		const h = this.dragHeight !== null && !phone ? `${this.dragHeight}px` : embedHeight(this.optionsHeight, phone, { desktop: `${s.embedHeightDesktop}px`, phone: phoneH });
		this.viewport?.style.setProperty('--dynasty-height', h);
	}

	/** D120: the height button was pressed. The order is lower, start, upper, lower; every static preview of the block takes the new height at once. */
	private nextHeight(): void {
		const st = this.ensureState();
		st.heightStep = (((st.heightStep ?? 1) + 1) % 3) as 0 | 1 | 2;
		for (const v of this.host.views) if (!v.unloaded && !v.full && v.peekState() === st) v.updateHeight();
	}

	/**
	 * Lays the note preview out again, in place, when its box asks for another narrow card width:
	 * only the scene is drawn again, so the viewport, toolbar and observers stay. True when
	 * it did; the caller then sets the first view.
	 */
	private fitNarrow(box: number): boolean {
		const last = this.lastLayout;
		const g = this.g;
		if (this.orientation !== 'sideways' || this.full || !last || !g || !this.panZoom || !(box > 0)) return false;
		const f = last.geo.fontPx;
		const want = narrowCardWidth(box, f);
		if (want === undefined || want === (this.narrowUsed ?? NARROW_MAX_EM * f)) return false;
		this.narrowW = want;
		this.narrowUsed = want;
		// D29: the names that need two text lines depend on the card width.
		const next = this.layOut(g, last.geo, { ...last.settings, narrowCardW: want }, last.opts.fonts, last.opts.badges?.hidden, last.opts.labels, undefined, last.opts.relations);
		last.settings = next.settings;
		this.redraw(g, next.laid, next.lifted);
		return true;
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
		hidden?: ReadonlyMap<string, number>,
		labels?: ReadonlyMap<string, CardLabel>,
		foldHidden?: ReadonlySet<string>,
		relations?: ReadonlyMap<string, { text: string }>,
	): MeasuredResult {
		const breaks = this.breakList();
		// D119: a names-only card shows the arms (first style) or the portrait (second style), never both.
		const style = geo.namesOnly === true ? this.phoneStyle() : null;
		// Rule B reads the relation words only when they show (D126 4); the setting also hides them by a class, so it is read here.
		return measuredLayout(g, geo, base, {
			fonts,
			measure: measureText,
			hidden,
			labels,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits && style !== 'names-shield',
			...(style === 'names-portrait' ? { showArms: false } : {}),
			...(foldHidden?.size ? { foldHidden } : {}),
			...(breaks.size ? { breaks } : {}),
			...(this.meId !== null ? { marked: this.meId } : {}),
			...(relations && this.settings.showRelations ? { relations } : {}),
		});
	}

	/** The user's break places (D118); `parseBreakList` keeps the last text, so this costs nothing when the setting is the same. */
	private breakList(): ReturnType<typeof parseBreakList> {
		return parseBreakList(this.settings.breakWords);
	}

	/** Draws a new layout of the note preview in place (D29): the viewport, toolbar and observers stay. `lifted` is rule B's set of the layout. */
	private redraw(g: FamilyGraph, laid: LaidOut, lifted: ReadonlySet<string>): void {
		const last = this.lastLayout;
		if (!last || !this.panZoom) return;
		this.laid = laid;
		last.opts.lifted = lifted;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.panZoom.setBounds(this.bounds);
		this.popover?.close();
		this.live?.destroy();
		this.live = null;
		last.sceneEl.empty();
		this.scene = buildScene(last.sceneEl, g, laid, last.opts);
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
		const next = this.layOut(g, last.geo, last.settings, last.opts.fonts, last.opts.badges?.hidden, last.opts.labels, undefined, last.opts.relations);
		const sameCards = sameTall(next.settings.tallCards, last.settings.tallCards) && sameTall(next.settings.tallTitles, last.settings.tallTitles) && sameTall(next.settings.longNames, last.settings.longNames);
		// Rule B: a refit can move a relation text across the room beside the boxes. The layout does not change (card heights are the same), but the boxes move.
		if (sameCards && sameLifted(next.lifted, last.opts.lifted)) {
			if (fresh) this.scene?.refit();
			return false;
		}
		const keep = this.keptAnchor();
		last.settings = next.settings;
		this.redraw(g, next.laid, next.lifted);
		if (keep) this.carry = keep;
		this.resized();
		return true;
	}

	/** The orientation the window asks for (D24) differs from the drawn one. */
	private turnDue(): boolean {
		const win = this.containerEl.win;
		return orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen) !== this.orientation;
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
			const win = this.containerEl.win;
			this.orientation = orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen);
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
		// The note preview's narrow cards follow its box (the box has no width before the first
		// resize). A static preview then shows its first view again.
		this.fitNarrow(vp.clientWidth);
		this.updateHeight();
		this.updateEditUi();
		// The first resize comes once the block is in the note, inside its callout if it has one.
		this.readThemeSoon(vp);
		const size = { w: vp.clientWidth, h: vp.clientHeight };
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
		if (carried && this.carry?.bandClear) carried = clearBand(carried, size, this.insetTop, [...this.laid.layout.persons.values()]);
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
		this.startPictures();
		this.showEdited(st);
		this.takeFocus();
	}

	/**
	 * The toolbar bands that views chosen by the plugin keep free: at the top, or at the bottom for
	 * the full-screen toolbar on a phone (spec §7.5).
	 */
	private measureInsets(vp: HTMLElement): void {
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
	 * D51: the first view of the finder's small tree on an upright phone draws the direction in which the
	 * fitted line shows the larger names, in the free area below the result bar and above the toolbar.
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
		if (finderOrientation(area, facts(now), facts(alt.laid)) !== alt.laid.layout.orientation) return;
		last.settings = alt.settings;
		this.redraw(g, alt.laid, alt.lifted);
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
		if (!this.barBox) return v;
		const boxes = [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)];
		return clearToolbar(v, size, this.barBox, boxes, me, size.h - this.insetBottom);
	}

	/** Start person (spec §5.5): the person last edited in this block, else options.start, else the first root. */
	private startId(): string | null {
		const edited = this.peekState()?.lastEdited ?? null;
		return this.g ? startPerson(this.g, edited !== null && this.g.byId.has(edited) ? edited : this.optionsStart) : null;
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
		if (!this.barBox) return view;
		return clearToolbar(view, size, this.barBox, [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)], me, bottom);
	}

	private defaultViewFor(laid: LaidOut, size: Size): View {
		const start = this.startId();
		const persons = laid.layout.persons;
		const startBox = start ? (persons.get(start) ?? null) : null;
		const fam = start && this.g ? familyOf(this.g, start) : null;
		const family = fam ? { partners: boxesOf(persons, fam.partners), children: boxesOf(persons, fam.children) } : null;
		return this.aboveBottomBar(size, (area) => {
			const v = defaultView(this.bounds, area, laid.layout.geometry.fontPx, startBox, this.insetTop, family);
			// A toolbar taller than the gap between rows could still reach the row above the start person.
			return clearBand(v, area, this.insetTop, [...persons.values()]);
		});
	}

	/** Sets the level of detail class for `view`; true when the level changed. */
	private applyLod(view: View): boolean {
		const svg = this.svg;
		const laid = this.laid;
		if (!svg || !laid) return false;
		const lod = chooseLod(this.lod, view.scale * laid.layout.geometry.fontPx);
		if (lod === this.lod) return false;
		if (this.lod) svg.removeClass(lodClass(this.lod));
		svg.addClass(lodClass(lod));
		this.lod = lod;
		return true;
	}

	/** The handler of a press or key on a fold control. */
	private foldAct(f: FoldRef): (e: Event) => void {
		return (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
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
		const w = vp.clientWidth / view.scale;
		const h = vp.clientHeight / view.scale;
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
			});
		};
		later(step);
	}

	/** The delayed card content near `view` (S3, S5a, S5b). A view with no size has no near part: the first draw or settle fills it. */
	private fillNear(view: View): void {
		const pz = this.panZoom;
		const scene = this.scene;
		if (!pz || !scene) return;
		const rect = visibleRect(view, pz.size);
		if (rect) scene.fill.fillNear(rect);
		this.syncPending();
	}

	/** The content of one person's card, badge and tags now (S5c to S5f): before a focus, a highlight, a reveal or the sheet. */
	private fillPerson(id: string): void {
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
			const r = cutBack(foldHit(visible, view.scale), visible, this.tapAreas);
			f.hit.setAttribute('x', String(r.x));
			f.hit.setAttribute('y', String(r.y));
			f.hit.setAttribute('width', String(r.w));
			f.hit.setAttribute('height', String(r.h));
		}
	}

	private settled(view: View, byUser: boolean): void {
		const laid = this.laid;
		if (!this.svg || !laid) return;
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
			// In the note the toolbar is a box at the top right, not a band: the box starts at the top edge.
			const top = this.barBox ? 0 : Math.max(0, this.insetTop);
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
		const bar = vp.querySelector<HTMLElement>(':scope > .dynasty-toolbar');
		const atTop = !!bar && bar.offsetWidth > 0 && bar.offsetTop <= vp.clientHeight / 2;
		if (up) {
			// Level with the note's toolbar and left of it; in full screen below the top safe area.
			up.style.setProperty('--dynasty-hint-top', `${atTop ? bar!.offsetTop + Math.max(0, (bar!.offsetHeight - HINT_HEIGHT) / 2) : Math.max(0, this.insetTop) + 4}px`);
			if (atTop) up.style.setProperty('--dynasty-hint-right', `${Math.max(0, vp.clientWidth - bar!.offsetLeft) + 4}px`);
			else up.style.removeProperty('--dynasty-hint-right');
		}
		down?.style.setProperty('--dynasty-hint-bottom', `${this.insetBottom + 4}px`);
	}

	private storeView(view: View): void {
		// The finder's tree is not the family: after Close the family's own saved view comes back (spec §13.2).
		if (this.finderDrawn?.line) return;
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
					if (st) st.finder = null;
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
		const win = TitlesWindow.create(this.host.app, {
			handle: h,
			sourcePath: this.sourcePath,
			beforeWrite: () => this.keepView(),
			onClosed: () => TreeView.refocusButton(host, st, full, '.dynasty-more'),
			show: (id) => TreeView.showFound(host, st, full, id),
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
			const ro = this.readOnly || (empty.isConnected && this.inForeignView());
			empty.parentElement?.toggleClass('dynasty-read-only', ro);
			empty.querySelector<HTMLButtonElement>('.dynasty-add-first')?.toggle(!ro);
			let label = empty.querySelector<HTMLElement>('.dynasty-read-only-label');
			if (ro && !label) label = empty.createDiv({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
			else if (!ro && label) label.remove();
			return;
		}
		const vp = this.viewport;
		const root = vp?.parentElement;
		if (!vp || !root) return;
		const readOnly = this.readOnly || (vp.isConnected && this.inForeignView());
		root.toggleClass('dynasty-read-only', readOnly);
		let bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		if (!bar) {
			bar = vp.createDiv({ cls: 'dynasty-toolbar' });
			// First in the viewport, so Tab reaches the toolbar before the cards (spec §5.2).
			vp.prepend(bar);
		}
		let open = bar.querySelector<HTMLElement>('.dynasty-open-source');
		if (readOnly && !open) {
			open = bar.createEl('button', { cls: ['dynasty-tool', 'dynasty-open-source'], attr: { type: 'button', 'aria-label': BLOCK_UI.openSourceLabel } });
			setIcon(open.createSpan({ cls: 'dynasty-tool-icon' }), 'file-symlink');
			open.createSpan({ cls: 'dynasty-tool-text', text: BLOCK_UI.openSource });
			open.addEventListener('click', (e) => this.guard(() => this.openSource(e)));
		} else if (!readOnly && open) {
			open.remove();
			open = null;
		}
		// Say why a press on a card does nothing.
		const noEdits = readOnly || this.blocked;
		let label = bar.querySelector<HTMLElement>('.dynasty-read-only-label');
		if (noEdits && !label) {
			label = bar.createSpan({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
		} else if (!noEdits && label) {
			label.remove();
			label = null;
		}
		// Spec §6.10: "Add person" on embedded desktop and embedded touch views that can be edited.
		const canAdd = !noEdits && !!this.handle;
		let add = bar.querySelector<HTMLElement>('.dynasty-add-person');
		if (canAdd && !add) {
			add = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-add-person'], attr: { 'aria-label': ADD_UI.addPerson, type: 'button' } });
			setIcon(add.createSpan({ cls: 'dynasty-tool-icon' }), 'user-plus');
			add.addEventListener('click', () => this.guard(() => void this.openNewPerson()));
		} else if (!canAdd && add) {
			add.remove();
			add = null;
		}
		// D36: Houses next to Add person, on the computer and in the full-screen view; not in the static touch embed (D1).
		const canHouses = canAdd && (!!this.full || !this.coarse);
		let houses = bar.querySelector<HTMLElement>('.dynasty-houses-button');
		if (canHouses && !houses) {
			houses = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-houses-button'], attr: { 'aria-label': HOUSES.button, type: 'button' } });
			setIcon(houses.createSpan({ cls: 'dynasty-tool-icon' }), 'castle');
			houses.addEventListener('click', () => this.guard(() => void this.openHouses()));
		} else if (!canHouses && houses) {
			houses.remove();
			houses = null;
		}
		orderFirst(bar, [label, open, add, houses]);
		if (!bar.childElementCount) bar.remove();
		// The toolbar can be wider now (Add person): the D28 hint stays left of it.
		this.placeHints();
		const resizable = !this.full && !readOnly && !this.coarse && !this.blocked && !!this.handle && !this.isPhone();
		let grip = root.querySelector<HTMLElement>(':scope > .dynasty-resize');
		if (resizable && !grip) grip = this.buildResizeHandle(root, vp);
		else if (!resizable && grip) grip.remove();
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
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false);
		if (picked?.kind !== 'person' || this.unloaded) return;
		// Find never enters focus mode (spec §6.10); a person outside the focus family is shown in the whole tree.
		this.guard(() => this.showPeople([picked.id]));
	}

	/** Toolbar Focus (spec §5.6, §6.6): the picker with every person of the whole tree, and no "Create" row. */
	private async pickFocusPerson(): Promise<void> {
		const g = this.whole;
		// A retired view is only a picture: its toolbar opens nothing.
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FOCUS_UI.pickerPlaceholder, FOCUS_UI.pickerTitle, false);
		if (picked?.kind !== 'person' || this.unloaded) return;
		this.guard(() => this.focusOn(picked.id));
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

	private buildToolbar(viewport: HTMLElement): void {
		const bar = viewport.createDiv({ cls: 'dynasty-toolbar' });
		// First in the viewport, so Tab reaches every toolbar button before the cards, badges and tags (spec §5.2).
		viewport.prepend(bar);
		const button = (icon: string, label: string, cls: string) => {
			const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', cls], attr: { 'aria-label': label, type: 'button' } });
			setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
			return b;
		};
		// §6.10: Add person and Houses are added first by updateEditUi. A static touch embed
		// has neither Focus nor Show all people (D1): it shows what the block and the session choose.
		if (this.full || !this.coarse) {
			const focus = button('crosshair', FOCUS_UI.focus, 'dynasty-focus');
			focus.toggleClass('is-active', this.focusId !== null);
			focus.setAttribute('aria-pressed', String(this.focusId !== null));
			focus.addEventListener('click', () => this.guard(() => void this.pickFocusPerson()));
			if (this.focusId !== null) {
				const all = button('users', FOCUS_UI.showAll, 'dynasty-show-all');
				all.addEventListener('click', () => this.guard(() => this.focusOn(null)));
			}
		}
		if (this.full) {
			const find = button('search', FULL_UI.find, 'dynasty-find');
			find.addEventListener('click', () => this.guard(() => void this.find()));
		}
		if (this.full || !this.coarse) {
			// D52: on a phone, Fit and Legend are items of the More list, so the toolbar keeps one row and Close shows.
			if (!this.isPhone()) {
				// Arrows inward, "the whole tree in view": a magnifier next to Find looked the same (phone bar).
				const fit = button('shrink', UI.fit, 'dynasty-fit');
				fit.addEventListener('click', () => this.guard(() => this.fit()));
				const legend = button('info', UI.legend, 'dynasty-legend-button');
				legend.addEventListener('click', () => this.guard(() => this.toggleLegend(legend)));
			}
			// D49: new actions go into one More list; the static touch preview has none (D1, like D36).
			const more = button('more-horizontal', FINDER_UI.more, 'dynasty-more');
			more.setAttribute('aria-haspopup', 'true');
			more.addEventListener('click', (e) => this.guard(() => this.toggleMore(more, !e.detail)));
		}
		this.updateBadge(bar);
		if (this.full) this.closeButton(bar);
		else {
			// Corner brackets read as "full screen"; Fit uses shrink.
			// D120: only the static preview on a phone has the height button. It stays left of Expand, so Expand does not move.
			if (this.coarse && this.isPhone()) {
				const height = button('chevrons-up-down', HEIGHT_UI.button, 'dynasty-height');
				// An Obsidian whose icon set lacks this icon leaves the span empty; `move-vertical` is in every set.
				const slot = height.querySelector<HTMLElement>('.dynasty-tool-icon');
				if (slot && !slot.querySelector('svg')) setIcon(slot, 'move-vertical');
				height.addEventListener('click', () => this.guard(() => this.nextHeight()));
			}
			const expand = button('maximize', FULL_UI.expand, 'dynasty-expand');
			expand.addEventListener('click', () => this.guard(() => void this.openFull(null)));
		}
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
	 * else the relation finder's result (spec §13.2); false if neither was open. The full-screen view
	 * asks first when Obsidian closes it (Esc, Android back).
	 */
	closePopover(): boolean {
		const pop = this.popover;
		if (pop?.isOpen) {
			pop.close(true);
			return true;
		}
		if (!this.finderDrawn || this.unloaded) return false;
		this.closeFinder();
		return true;
	}

	private toggleLegend(opener: HTMLElement): void {
		const pop = this.popover;
		if (!pop) return;
		this.releaseLegend();
		if (pop.kind === 'legend') {
			pop.close();
			return;
		}
		pop.open(
			'legend',
			(el) => {
				el.createDiv({ cls: 'dynasty-popover-title', text: UI.legendTitle });
				// Spec §13.6 "Legend": the houses of the whole tree, with their arms.
				// M10 (H1): the house rows open the house page, which is read-only and so also works in a read-only tree.
				const { arms } = buildLegend(el.createDiv({ cls: 'dynasty-legend' }), this.whole ? legendHouses(this.whole) : undefined, this.canOpenHousePage() ? (id) => this.guard(() => this.openHousePage(id)) : undefined);
				this.fillLegendArms(arms);
			},
			opener,
		);
		// However the legend closes, its arms copies go back to the store at once.
		pop.whenClosed(() => this.releaseLegend());
	}

	/** The house page opens on the computer and in the full-screen view, never in the static phone preview or a foreign view (D36). */
	private canOpenHousePage(): boolean {
		return !!this.whole && !this.inForeignView() && (!!this.full || !this.coarse);
	}

	/** A tap on a house row of the legend (spec §13.12): the legend closes, the page opens on the saved tree. */
	private openHousePage(houseId: string): void {
		const whole = this.whole;
		if (!whole || this.unloaded) return;
		this.popover?.close();
		const st = this.peekState();
		const full = !!this.full;
		const host = this.host;
		openHousePage(this.host.app, {
			app: this.host.app,
			showGeneration: () => this.settings.showHouseGeneration,
			houseId,
			whole,
			sourcePath: this.sourcePath,
			pictures: this.host.pictures,
			// This view, if it is still there (a page opened from the legend has no write that can replace it).
			show: (id) => {
				if (!this.unloaded) this.guard(() => this.showFound(id));
				else if (st) TreeView.showFound(host, st, full, id);
			},
			openNote: (open) => this.openNote(open),
			onClosed: () => {
				if (st) TreeView.refocusButton(host, st, full, '.dynasty-legend-button');
			},
		});
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
		const focused = active?.closest?.('.dynasty-fold')?.getAttribute('data-fold') ?? null;
		const plan = planFolds(g, whole, this.ensureState().folds, true, this.finderDrawn?.line?.people ?? null);
		this.foldPlan = plan;
		const next = this.layOut(g, last.geo, withFolds(last.settings, plan, true), last.opts.fonts, last.opts.badges?.hidden, last.opts.labels, plan.hidden, last.opts.relations);
		last.settings = next.settings;
		this.redraw(g, next.laid, next.lifted);
		// `redraw` asks for a first view (a new narrow width); a fold keeps the view.
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
		const n = !this.full && this.isPhone() ? 1 : focusGenerationsFor(tree.options, this.settings.focusGenerations);
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
		const pics: CodedIssue[] = [];
		info.uses.forEach((u, i) => {
			const r = info.resolved.get(u.link);
			if (r && !r.ok) pics.push(pictureIssue(u.owner, r));
			else {
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
			const after = bar.querySelector<HTMLElement>(':scope > .dynasty-close, :scope > .dynasty-expand');
			if (after) bar.insertBefore(b, after);
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
		for (const p of whole.people) if (p.portrait) uses.push({ owner: { kind: 'portrait', person: { id: p.id, name: p.name } }, link: p.portrait });
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
		const link = slot.kind === 'arms' ? (slot.house !== undefined ? this.whole?.houses.get(slot.house)?.arms : undefined) : this.whole?.byId.get(slot.person)?.portrait;
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
			if (u.owner.kind === 'portrait') this.live?.problem(u.owner.person.id, 'portrait');
			else if (drawn) {
				const house = u.owner.house.id;
				for (const person of drawn.people) if (person.house === house) this.live?.problem(person.id, 'arms');
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
		if (this.picturesOn) this.checkPictures();
	}

	/** S4, O3: the legend's arms, from small copies held while the legend may show them. */
	private fillLegendArms(arms: Map<string, HTMLElement>): void {
		this.releaseLegend();
		const store = this.host.pictures;
		const whole = this.whole;
		const info = this.pictureInfo;
		if (!store || !whole || !info) return;
		const token = this.pictureToken;
		const ctl = new AbortController();
		this.legendAbort = ctl;
		for (const [house, el] of arms) {
			const link = whole.houses.get(house)?.arms;
			const r = link !== undefined ? info.resolved.get(link) : undefined;
			if (!r?.ok) continue;
			void store.acquire(r.file, LEGEND_ARMS_BOX, ctl.signal).then(
				(c) => {
					if (!c || !('url' in c)) return;
					if (ctl.signal.aborted || token !== this.pictureToken || this.unloaded || !el.isConnected) {
						c.release();
						return;
					}
					this.legendCopies.push(c);
					this.guard(() => setLegendArms(el, c.url));
				},
				(e: unknown) => console.error('Dynasty Tree: cannot show the arms in the legend', e),
			);
		}
	}

	/** The legend's arms copies go back to the store (the legend closes, or a new scene). */
	private releaseLegend(): void {
		this.legendAbort?.abort();
		this.legendAbort = null;
		for (const c of this.legendCopies.splice(0)) c.release();
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
		// The saved picture always shows whole cards (D119, contract 6.2): a names-only preview must not hand its flag on, so the geometry is made again.
		// The relation text line follows the mark and the finder's small tree, as `rel` does at the draw; the setting only hides the text (D40).
		const small = this.finderDrawn?.line && !this.finderDrawn.state.whole;
		const rel = this.meId !== null && !small && this.whole ? relationsFor(this.whole, this.meId) : null;
		const breaks = this.breakList();
		return {
			g,
			...(opts.labels ? { labels: opts.labels } : {}),
			...(rel && this.settings.showRelations ? { relations: rel.cards } : {}),
			...(opts.me !== undefined ? { me: opts.me } : {}),
			...(opts.line ? { line: opts.line } : {}),
			orientation: laid.layout.orientation ?? 'down',
			geo: geometryFor(last.geo.fontPx, last.geo.cardSize),
			relationLine: rel !== null,
			...(breaks.size ? { breaks } : {}),
			fonts: opts.fonts,
			showDates: this.settings.showDates,
			showPortraits: this.settings.showPortraits,
			sourcePath: this.sourcePath,
			note: name.replace(/\.md$/i, ''),
			...(focus !== undefined ? { focusName: focus } : {}),
			...(this.foldPlan?.foldedList.length ? { folds: { hidden: this.foldPlan.hiddenList, folded: this.foldPlan.foldedList } } : {}),
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
		const result = findRelation(whole, f.first, f.second);
		const count = result.kind === 'named' ? result.relations.length : 1;
		// An edit can leave fewer relations than the one that showed.
		if (!(f.index >= 0 && f.index < count)) f.index = 0;
		const line = result.kind === 'named' ? (result.relations[f.index]?.relation.line ?? null) : result.kind === 'chain' ? result.line : null;
		return { state: f, result, line };
	}

	/**
	 * The finder's result bar at the top of the view (spec §13.2, D48): the sentence, then Show the
	 * steps, Other relation, Show in the whole tree (or back to the line only) and Close. Every button
	 * is at least 44 px high (styles.css).
	 */
	private buildResultBar(viewport: HTMLElement, before: HTMLElement, d: FinderDrawn, whole: FamilyGraph): void {
		const { state: f, result } = d;
		const name = (id: string) => whole.byId.get(id)?.name || id;
		// Named by its sentence, not aria-label: Obsidian shows an aria-label as a tooltip on every free point of the bar.
		const id = `dynasty-result-${++resultIds}`;
		const bar = viewport.createDiv({ cls: 'dynasty-result', attr: { role: 'group', 'aria-labelledby': id } });
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
		const button = (text: string, cls: string, run: () => void, label?: string) => {
			const b = row.createEl('button', { cls: ['dynasty-result-button', cls], text, attr: { type: 'button' } });
			if (label) b.setAttribute('aria-label', label);
			b.addEventListener('click', () => this.guard(run));
			return b;
		};
		if (steps.length) {
			// Only the bar changes: the tree is not drawn again.
			const toggle = button(f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps, 'dynasty-result-steps-button', () => {
				f.steps = !f.steps;
				list.toggle(f.steps);
				toggle.setText(f.steps ? FINDER_UI.hideSteps : FINDER_UI.showSteps);
				toggle.setAttribute('aria-expanded', String(f.steps));
			});
			toggle.setAttribute('aria-expanded', String(f.steps));
		}
		if (result.kind === 'named' && result.relations.length > 1) {
			const n = result.relations.length;
			button(FINDER_UI.other, 'dynasty-result-other', () => this.finderChange({ index: (f.index + 1) % n }, '.dynasty-result-other'), FINDER_UI.otherLabel(name(f.second), name(f.first)));
		}
		if (d.line) button(f.whole ? FINDER_UI.lineOnly : FINDER_UI.whole, 'dynasty-result-whole', () => this.finderChange({ whole: !f.whole }, '.dynasty-result-whole'));
		button(FINDER_UI.close, 'dynasty-result-close', () => this.closeFinder(), FINDER_UI.closeLabel);
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
		return this.aboveBottomBar(size, (area) => finderFirstView(bounds, area, laid.layout.geometry.fontPx, this.insetTop, oldest, laid.layout.orientation));
	}

	/**
	 * The More button (D49): the list of the new actions (Relation; Titles where the block can be
	 * edited, spec §13.4); on a phone also Fit and the legend (D52), which the phone's toolbar does not have.
	 */
	private toggleMore(opener: HTMLElement, keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'more') {
			pop.close();
			return;
		}
		pop.open(
			'more',
			(el) => {
				const item = (icon: string, text: string, cls: string, run: () => void, label?: string) => {
					const b = el.createEl('button', { cls: ['dynasty-popover-item', 'dynasty-more-item', cls], attr: { type: 'button' } });
					if (label) b.setAttribute('aria-label', label);
					setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
					b.createSpan({ cls: 'dynasty-more-text', text });
					b.addEventListener('click', (e) => {
						// A key press on the item gives the focus back to More; a new popover or a picker takes it itself.
						pop.close(!e.detail);
						this.guard(run);
					});
					return b;
				};
				const first = item('route', FINDER_UI.relation, 'dynasty-more-relation', () => void this.startFinder(), FINDER_UI.relationLabel);
				// Spec §13.4, D49: the Titles window, where the block can be edited.
				if (this.canEditWindows()) item('crown', TITLES_UI.more, 'dynasty-more-titles', () => void this.openTitles(), TITLES_UI.moreLabel);
				// Spec §13.8, O11: wherever the More list is, read-only views included.
				if (this.laid) item('image-down', SAVE_UI.more, 'dynasty-more-save', () => this.openSave(), SAVE_UI.moreLabel);
				if (this.isPhone()) {
					item('shrink', UI.fit, 'dynasty-more-fit', () => this.fit());
					item('info', UI.legend, 'dynasty-more-legend', () => this.toggleLegend(opener));
				}
				// Enter or Space on More moves the focus into the list (spec §5.2).
				if (keyboard) first.focus();
			},
			opener,
		);
	}

	/** Relation (spec §13.2): the first person, then the second (not the first); the marked person is offered first. */
	private async startFinder(): Promise<void> {
		const g = this.whole;
		if (!g || this.unloaded) return;
		const st = this.ensureState();
		const me = this.meId;
		const a = await pickPerson(this.host.app, g, new Set(), FINDER_UI.placeholder, FINDER_UI.firstTitle, false, me);
		if (a?.kind !== 'person') {
			this.guard(() => this.refocusMore());
			return;
		}
		const b = await pickPerson(this.host.app, g, new Set([a.id]), FINDER_UI.placeholder, FINDER_UI.secondTitle, false, me !== a.id ? me : null);
		if (b?.kind !== 'person') {
			this.guard(() => this.refocusMore());
			return;
		}
		this.guard(() => TreeView.showFinder(this.host, st, a.id, b.id, this.unloaded ? null : this));
	}

	/**
	 * A picker of the finder closed with no choice: the keyboard focus goes back to More (spec §5.2),
	 * as the item that had it is gone with its list. Not while another window of the plugin is open.
	 */
	private refocusMore(): void {
		if (this.unloaded || pluginModalOpen()) return;
		const more = this.viewport?.querySelector<HTMLElement>('.dynasty-more');
		if (more?.isConnected) more.focus();
	}

	/**
	 * Shows `second` as a relative of `first` (spec §13.2) in every view of the block that can show it.
	 * It writes nothing. Through the block state, not a view: the view that opened a sheet can be gone.
	 * If only the static touch preview shows the block (D1), the preview does not change and the
	 * full-screen view opens with the result (like D17).
	 */
	static showFinder(host: TreeHost, st: BlockState, first: string, second: string, origin: TreeView | null): void {
		st.finder = { first, second, index: 0, whole: false, steps: false };
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

/** Tells two picture owners apart (a house and a person can share an id). */
function ownerKey(o: PictureOwner): string {
	return o.kind === 'arms' ? `arms:${o.house.id}` : `portrait:${o.person.id}`;
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

/**
 * Puts the given elements first in `bar`, in this order, moving only what is out of place: a move
 * takes the keyboard focus from a button.
 */
function orderFirst(bar: HTMLElement, els: (HTMLElement | null)[]): void {
	const want = els.filter((e): e is HTMLElement => !!e);
	want.forEach((e, i) => {
		const at = bar.children[i] ?? null;
		if (at !== e) bar.insertBefore(e, at);
	});
}
