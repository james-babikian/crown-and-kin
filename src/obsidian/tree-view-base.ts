/*
 * The bottom layer of `TreeView` (0.3.3, WP-1 A1; split out of `tree-view.ts` with no change of behaviour). `TreeView` is a chain of classes,
 * one file for each concern, and the chain is listed in `tree-view.ts`. This first class holds what every layer shares: the host contract, the
 * state of one view (every field), the open timing of spec §7.7, the access to the block's memory, and the cross-view calls (the static methods
 * that draw every view of one block again after a focus, folds, finder or Show view change). The state stays in one object on purpose: the layers
 * are one view, and the tests read its fields. The `abstract` methods at the end are implemented by the layers above.
 */

import { MarkdownRenderChild, type App, type HoverParent, type HoverPopover } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/messages';
import { foldHidden, personFolds, unfoldFor, type FoldControl, type FoldKey } from '../core/folds';
import type { ParseCache } from '../core/parse-cache';
import { parseBody, parseDynasty } from '../core/parse';
import { isEmpty, isMap } from '../core/tolerate';
import type { RelationOptions } from '../core/relations';
import type { CardLabel } from '../core/titles';
import type { ParseResult, Tree } from '../core/types';
import type { Geometry, LaidOut, LayoutSettings, Orientation, PersonBox, Rect } from '../layout/model';
import type { FontState } from '../render/fonts';
import type { CardTips } from '../render/dom/card-tip';
import { PanZoom } from '../render/dom/pan-zoom';
import type { Scene, SceneOptions } from '../render/dom/scene';
import { parseBreakList } from '../render/break-words';
import { Popover } from '../render/dom/widgets';
import type { RenderTiming } from '../render/tree-info';
import type { Lod, View } from '../render/view-math';
import type { Handle, HandleRegistry } from './block-handle';
import { BlockBinding } from './block-binding';
import { newBlockState, type BlockState } from '../view/block-state';
import { datesForTree, type CalendarIndex, type DatesFor } from '../view/calendar-index';
import type { CalendarTree, SetLinkResult } from './calendar-link';
import type { SheetFolds } from './edit-sheet';
import { setFolds, type FoldPlan } from '../view/fold-view';
import type { LivePictures } from './live-pictures';
import type { LargeBar } from '../view/large-tree';
import type { MeasuredResult } from '../view/measured-layout';
import { pushTrail, type ListFrom } from '../view/phone-list';
import { pluginWindowOpen } from '../view/plugin-modals';
import type { PickerContext } from './person-picker';
import type { PictureCopy, PictureStore } from './picture-store';
import type { FinderDrawn } from '../view/render-plan';
import { DEFAULT_SETTINGS, type DynastySettings } from '../view/settings';
import type { SuccessionDrawn } from '../view/succession-view';
import { OPEN_GAP_MS, type OpenTime, type FullSource, type FullHost, type ViewPlace, type FoldAnchor, type Anchor, type KeepPlace, type PictureInfo } from './tree-view-types';

/** Elements that `refocusAfterRedraw` focused and whose `focus` event has not come yet, each with the call that ends the mark. */
const restoreMarks = new WeakMap<Element, () => void>();

/** Whether an element shows its keyboard focus ring now; an engine with no `:focus-visible` shows it on every focus. */
export function showsRing(el: Element): boolean {
	try {
		return el.matches(':focus-visible');
	} catch {
		return true;
	}
}

/** What a tree view needs from the plugin. `TreeHost` (in `tree-view.ts`) is this with the views typed as `TreeView`. */
export interface ViewHost {
	app: App;
	/** One handle per block (spec §6.1). A block's view state lives on its handle. */
	handles: HandleRegistry;
	/** View state of read-only blocks, which have no handle, keyed by note path and text. */
	looseStates: Map<string, BlockState>;
	views: Set<TreeViewBase>;
	recordTiming(t: RenderTiming): void;
	/**
	 * Opens the full-screen view of a block (spec §7.1). The plugin makes the modal; `tree-view.ts` does not import `full-screen.ts`, which itself
	 * hosts a `TreeView`, so the two files do not import each other. `focus` is D21: the family to show, from a badge tap in a static embed.
	 */
	openFull(from: FullSource, target: string | null, opener: HTMLElement, focus: string | null): void;
	/** Is a full-screen view of the block with view-state key `key` open? */
	isFullOpenFor(key: string): boolean;
	/** Is any full-screen view open? */
	hasFullOpen(): boolean;
	/** Spec §9: read on every render; `onSettingsChange` follows a change. */
	readonly settings: DynastySettings;
	/** M9 contract O3: the plugin's one picture store (absent in hosts without pictures, for example the unit fakes). */
	readonly pictures?: PictureStore;
	/** Spec §14 rule 9: the calendar index. A tree gets its date reader from it; absent in a host with no calendars (the unit fakes): plain years. */
	readonly dates?: CalendarIndex;
	/** M11: the parse that the read paths share; a host without one (a unit fake) parses each time. */
	readonly parseCache?: ParseCache;
	/**
	 * 0.2.8 contract B.5 (D183): set only by the plugin. On a cold start a tree draws a box of its last known height until `ready(el)` (the
	 * plugin styles and the stored settings are in) and until the place of its block is known, for at most `START_LIMIT_MS`. `cache()` is false until the
	 * metadata cache has finished once (or the limit has passed), so no warning about a missing picture counts before it is true.
	 * Absent in a host that has no cold start (the unit fakes): the tree draws at once.
	 */
	readonly startedUp?: { ready(el: HTMLElement): boolean; cache(): boolean };
	/** Spec §7.7 (render timing): the opens of blocks that have not shown a tree yet, by block key; absent in a host that keeps none (each view then times its own renders). */
	readonly opens?: Map<string, OpenTime>;
}

/** Options of `TreeView.redrawState`. */
interface RedrawOptions {
	target?: string[] | null;
	origin?: TreeViewBase | null;
	except?: TreeViewBase | null;
	keepOwn?: boolean;
}

/** The state of one rendered `kin` block and the calls between the views of one block. Never made by itself: `TreeView` is the whole chain. */
export abstract class TreeViewBase extends MarkdownRenderChild implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	/** The binding to the block in the note: handle, place, retries and the cold-start wait (`block-binding.ts`). */
	protected readonly binding: BlockBinding;
	protected readonly coarse: boolean;
	/** Fonts as read, not clamped: compared with `fontsChanged` only. */
	protected fonts: FontState | null = null;
	/** A view to restore after the next re-render (font change, late web font). */
	protected carry: Anchor | null = null;
	/** The person the phone list stood on at its last render, and whether a redraw by the calendar index must keep it (a birth year can change who is the oldest). */
	protected listStartWas: { id: string; from: ListFrom } | null = null;
	protected keepStart = false;
	/** The calendar link and the reader key of the last render: a change of the index draws again only when the key differs (spec §14 rule 9). */
	protected reading: { link: string | undefined; key: string } | null = null;
	/** D244: the edited card's place before the edit; the first view after the re-render uses it, once. */
	protected keepPlace: KeepPlace | null = null;
	/** D244: the person whose sheet is about to save, for each block state (set just before the write; also for Add child, parent and partner). */
	protected static readonly sheetPerson = new WeakMap<BlockState, { id: string; until: number }>();
	/** Height of the toolbar band at the top of the viewport, kept free in plugin-chosen views. */
	protected insetTop = 0;
	/** The last value of `--dynasty-bars` set on the box, so that an unchanged height sets nothing. */
	protected barsPx = '';
	/** The same at the bottom: the full-screen toolbar on a phone (spec §7.5). */
	protected insetBottom = 0;
	/** V1: the side safe areas of the full-screen view (a phone held sideways); the views that the plugin chooses keep a card out of them. 0 in a note. */
	protected insetLeft = 0;
	protected insetRight = 0;
	/** Set for the full-screen view (spec §7.1); null for an embed. */
	protected readonly full: FullHost | null;
	/** The drawn graph: the whole tree, or the focus family in focus mode (spec §5.6). */
	protected g: FamilyGraph | null = null;
	/** The whole tree's graph: its problems, Find and the Focus picker (edits read the block themselves). */
	protected whole: FamilyGraph | null = null;
	/** The focus person drawn, or null for the whole tree. */
	protected focusId: string | null = null;
	/** `focusKey` of the last render, with its orientation (the key of saved views); null before the first. */
	protected drawnKey: string | null = null;
	/** The same without the orientation: a turn of the phone keeps the family, and so the view's centre. */
	protected familyKey: string | null = null;
	/** How the drawn tree is laid out (D24): `sideways` on a phone in portrait. */
	protected orientation: Orientation = 'down';
	/** A turn of the phone (D24) waits for the window to report its new size (iOS reports it late). */
	protected turnTimer = 0;
	/** What the last render laid out and drew with, so the note preview can lay out again in place. */
	protected lastLayout: { geo: Geometry; settings: LayoutSettings; sceneEl: SVGGElement; opts: SceneOptions } | null = null;
	/** A person to centre and highlight in the next first view (Find of a person outside the focus family). */
	protected pendingTarget: string[] | null = null;
	/** The toolbar at the top of the viewport, in viewport px (null when it is at the bottom). */
	protected barBox: { left: number; right: number; top: number; bottom: number } | null = null;
	/**
	 * The next sized resize shows the first view: the tree was laid out again in place (D29 names after a font
	 * change), perhaps while its box had no height yet.
	 */
	protected firstDue = false;
	/** D28: the children of the first view's person, and whether the hint still counts them (until the user moves the view). */
	protected hintKids: PersonBox[] = [];
	protected hintOn = false;
	/** The frame that starts the pulse after a view change (0.3, D235), or 0. */
	protected pulseFrame = 0;
	/** The session focus changed while a full-screen view of this block was open: draw again when it closes. */
	protected focusStale = false;
	/** F5: the focus rules have run once in this view; only the first run looks at a stopped draw. */
	protected stopChecked = false;
	/** The block's folds changed while this view had no size (the other mode of the note): it draws again when it shows (M10 F10). */
	protected foldsStale = false;
	/** The last press on a fold control came from the keyboard (I37): the redraw puts the keyboard focus back on the new control only then. */
	protected foldByKey = false;
	protected laid: LaidOut | null = null;
	/** M10 (F1): the folds this draw applied, so the settle, the sheet and the saved picture use the same people. */
	protected foldPlan: FoldPlan | null = null;
	/** The scene whose fold controls and card content are being filled in idle time (one chain for both), so a redraw does not start a second chain. */
	protected idleScene: Scene | null = null;
	/** The tap areas of the tags and `+` badges at the last settle: a fold's tap area is cut back where it meets them (F7). */
	protected tapAreas: Rect[] = [];
	protected scene: Scene | null = null;
	protected svg: SVGSVGElement | null = null;
	/** The wrapper of the svg: hidden until the first view (S7). */
	protected canvasEl: HTMLElement | null = null;
	protected viewport: HTMLElement | null = null;
	/** The "Add first person" box of a block with no people (spec §5.9); null when a tree is drawn. */
	protected emptyEl: HTMLElement | null = null;
	/** F8: the content of the error box that stands in place of a tree whose text cannot be read; it gets the button "Show the tree text" once the block is known. */
	protected errorBox: HTMLElement | null = null;
	protected panZoom: PanZoom | null = null;
	/** The tip of a card (D145); null in list mode and before the first draw. */
	protected tips: CardTips | null = null;
	protected popover: Popover | null = null;
	protected observer: ResizeObserver | null = null;
	/** D183: watches the root of the block, so its height is read after the browser has laid the page out (`keepHeight`). */
	protected heightWatch: ResizeObserver | null = null;
	protected heightRoot: HTMLElement | null = null;
	/** The viewport whose theme colours were read or are due (a new render draws a new one). */
	protected themeRead: HTMLElement | null = null;
	/** `--dynasty-callout-bg` as last read: the toolbar and the D28 hints take it. */
	protected calloutBg: string | null = null;
	/**
	 * A font probe that stays in the tree: a probe added to the page later makes the
	 * engine compute the style of every element again, about 0.35 s for sample tree 7 on a slow phone.
	 */
	protected fontProbe: HTMLElement | null = null;
	/** The same for `env(safe-area-inset-top)` in the full-screen view. */
	protected safeProbe: HTMLElement | null = null;
	protected lod: Lod | null = null;
	protected bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
	protected optionsStart: string | undefined;
	protected optionsHeight: number | undefined;
	protected blocked = false;
	protected readonly timers = new Set<number>();
	/** The timer that ends the ring of each card, so a new ring can clear the old one. */
	protected readonly ringTimers = new Map<Element, number>();
	/** Height set by a resize drag, until the note has the new `options.height`. */
	protected dragHeight: number | null = null;
	/** A touch or pen press on a card that can still become a tap (spec §7.2). */
	protected tap: { pointer: number; x: number; y: number; person: string } | null = null;
	protected lastTap = 0;
	/** A Tab key is down and its focus move has not happened yet (see keyFocus). */
	protected tabbing = false;
	protected unloaded = false;
	/** Expand was pressed and the full-screen view is about to open. */
	protected opening = false;
	/** Timing of the last render, until its first view has been painted (spec §7.7). */
	protected timing: { t0: number; t: RenderTiming } | null = null;
	/** The first call of the processor for this view (ms of `performance.now`). */
	protected readonly born = performance.now();
	/** The open that this view's renders add to, until a tree it drew has been seen (spec §7.7). */
	protected opened: OpenTime | null = null;
	/** True once a frame of this view's tree ran while its element was in the page: the user could see the tree (spec §7.7). */
	protected seenTree = false;
	/** The marked person of the drawn tree (spec §13.1), or null. */
	protected meId: string | null = null;
	/** The relation finder's result that this view draws (spec §13.2), or null. */
	protected finderDrawn: FinderDrawn | null = null;
	/** The Show view of a line of succession that this view draws (contract 0.2.7 F), or null. Only one of the two temporary views shows at a time. */
	protected successionDrawn: SuccessionDrawn | null = null;
	/**
	 * After the next first view, the keyboard focus goes here: the result's sentence, or a button by its
	 * class. Only the view the user acted in (or the full-screen view it opened) sets it, so a view that
	 * Obsidian draws again, or another pane of the note, never takes the focus.
	 */
	protected focusDue: string | null = null;
	/** D51: the finder's small tree laid out top to bottom on an upright phone, until the first view picks the direction. */
	protected finderAlt: (MeasuredResult & { geo: Geometry }) | null = null;
	/** The problems of the whole tree's text (spec §8); the picture warnings come on top (`allIssues`). */
	protected textIssues: CodedIssue[] = [];
	/** M9: the pictures of the whole tree, resolved at render (O1, O2); null with no picture store. */
	protected pictureInfo: PictureInfo | null = null;
	/** M9: the live pictures of the drawn scene (O5). */
	protected live: LivePictures | null = null;
	/** The first view was ready for use: the live pictures may load (spec §13.0 item 3 "Pictures never delay the first view"). */
	protected picturesOn = false;
	/** Raised by every render: a background check or a start of the pictures from before it does nothing. */
	protected pictureToken = 0;
	protected unsubPictures: (() => void) | null = null;
	/** D144: this view drew the phone list. A turn of the phone and the card settings do not touch a list; it has no scene, no layout and no view. */
	protected listMode = false;
	/** The list that is drawn, for `updateEditUi`; null when there is none. */
	protected listEl: HTMLElement | null = null;
	/** The small picture copies of the rows, held until the list is drawn again or goes away. */
	protected listCopies: PictureCopy[] = [];
	/** The person of the large row, the only row with arms (D209 rule A: the personal arms, else the arms of the house). */
	protected listCentre: string | null = null;
	/** Stops the picture requests of the rows that still wait. */
	protected listAbort: AbortController | null = null;
	/** 0.3 (spec §7.7, size limits): the low bar that this view shows in place of the tree (a very large tree), or null while it draws a tree, a list or an empty block. */
	protected large: LargeBar | null = null;
	/** The tap on "Draw the tree" started the work at this time (ms of `performance.now`): the time budget of the draw that follows counts from it (spec §7.7). */
	protected budgetFrom: number | null = null;

	constructor(
		protected readonly host: ViewHost,
		containerEl: HTMLElement,
		protected source: string,
		place: ViewPlace,
	) {
		super(containerEl);
		this.coarse = containerEl.win.matchMedia('(pointer: coarse)').matches;
		this.full = place.kind === 'full' ? place.host : null;
		this.binding = new BlockBinding(host, containerEl, place, {
			source: () => this.source,
			unloaded: () => this.unloaded,
			guard: (fn) => this.guard(fn),
			updateEditUi: () => this.updateEditUi(),
			render: () => this.render(null),
			showPlaceholder: () => this.showPlaceholder(),
			changed: (h, body) => this.changed(h, body),
		});
		if (place.kind === 'full') this.focusDue = place.from.focusDue ?? null;
		this.openNow(this.born);
	}

	protected get key(): string {
		return this.binding.key;
	}

	protected get sourcePath(): string {
		return this.binding.sourcePath;
	}

	/** No handle (transclusion, Canvas card, hover popover, or the block cannot be told apart): no edits (spec §6.1). */
	protected get readOnly(): boolean {
		return this.binding.readOnly;
	}

	/** The block's handle once known; null while it resolves, and for a read-only view. */
	protected get handle(): Handle | null {
		return this.binding.handle;
	}

	/** The open that the renders add to: the pending open of this block when the last render was lately, else a new one that starts at `from`. */
	protected openNow(from: number): OpenTime {
		const key = this.full ? `${this.key} (full-screen)` : this.key;
		const pending = this.host.opens?.get(key);
		// Another view of the block (a second pane) may have shown a tree and ended the open since: then this one is stale.
		if (this.opened && (!this.host.opens || pending === this.opened)) return this.opened;
		const open = pending && from - pending.last <= OPEN_GAP_MS ? pending : { start: from, last: from, parseMs: 0, layoutMs: 0, drawMs: 0 };
		this.host.opens?.set(key, open);
		this.sweepOpens(from);
		return (this.opened = open);
	}

	/** An open that no view holds and that is older than the gap is never continued (its block was left unseen): take it out, so the map does not grow. */
	protected sweepOpens(now: number): void {
		const opens = this.host.opens;
		if (!opens) return;
		const held = new Set<OpenTime | null>();
		for (const v of this.host.views) if (!v.unloaded) held.add(v.opened);
		for (const [k, o] of opens) if (now - o.last > OPEN_GAP_MS && !held.has(o)) opens.delete(k);
	}

	/** True when another view that is still alive adds to the same open (a second render of the same block that Obsidian made before this one went). */
	protected openHeldElsewhere(): boolean {
		for (const v of this.host.views) if (v !== this && !v.unloaded && v.opened !== null && v.opened === this.opened) return true;
		return false;
	}

	/** A render that shows no tree (an error, an empty block) ends the open: a later render is a new wait. */
	protected dropOpen(): void {
		const key = this.full ? `${this.key} (full-screen)` : this.key;
		if (this.opened && this.host.opens?.get(key) === this.opened) this.host.opens.delete(key);
		this.opened = null;
	}

	/** Adds the parts of this render to the open. The timing of the render reports the sums, and its clock starts with the open. */
	protected account(t0: number, t1: number, t2: number, t3: number): { start: number; parts: Pick<RenderTiming, 'parseMs' | 'layoutMs' | 'drawMs' | 'totalMs'> } {
		const o = this.openNow(t0);
		o.parseMs += t1 - t0;
		o.layoutMs += t2 - t1;
		o.drawMs += t3 - t2;
		o.last = t3;
		return { start: o.start, parts: { parseMs: o.parseMs, layoutMs: o.layoutMs, drawMs: o.drawMs, totalMs: o.parseMs + o.layoutMs + o.drawMs } };
	}

	/** True for the full-screen view (spec §7.1). */
	get isFull(): boolean {
		return this.full !== null;
	}

	/** The path of the block's note; follows a rename. */
	get notePath(): string {
		return this.sourcePath;
	}

	/**
	 * What the Calendars window needs to know of this tree (D289, D290). `link` is the option `calendar` as written; undefined when the tree names none or has not drawn yet.
	 * `setLink` is not null only for a tree with no key that has drawn and can be written: it has no problem that stops edits, and it is not read-only.
	 */
	calendarTree(): CalendarTree {
		const link = this.reading?.link;
		const named = !!link?.trim();
		const writable = this.reading !== null && !named && !!this.handle && !this.hasCalendarKey(this.handle.body) && !this.readOnly && !this.blocked && this.errorBox === null && !this.inForeignView() && (!!this.full || !this.coarse);
		return { treePath: this.sourcePath, link: named ? link : undefined, setLink: writable ? (value) => this.writeCalendarLink(value) : null };
	}

	/**
	 * True when the text has a key `calendar` under `options` with any value that is not empty. The parser reads a link only from text, so a map or a list there reads as "no
	 * link"; it is still the user's key, and Save never writes over it.
	 */
	private hasCalendarKey(body: string): boolean {
		const read = parseBody(body);
		if (!read.ok) return true;
		const data = read.data;
		const options = isMap(data) ? data.options : undefined;
		return isMap(options) && !isEmpty(options.calendar);
	}

	/** Writes the option `calendar`. The body is read again now: a sync may have added a key since the window opened, and then nothing is written. */
	private async writeCalendarLink(value: string): Promise<SetLinkResult> {
		const h = this.handle;
		if (!h) return 'failed';
		const parsed = parseDynasty(h.body);
		if (!parsed.ok) return 'failed';
		if (parsed.tree.options.calendar?.trim() || this.hasCalendarKey(h.body)) return 'has-key';
		const out = await h.write({ kind: 'set-option', key: 'calendar', value });
		return out.ok ? 'ok' : 'failed';
	}

	/** The key of the block's view state, shared by the embed and the full-screen view. */
	get stateKey(): string {
		return this.key;
	}

	/** The plugin's settings (spec §9); the defaults for a host that has none. */
	protected get settings(): DynastySettings {
		return this.host.settings ?? DEFAULT_SETTINGS;
	}

	/** G.1, G.3: what the person picker needs for portraits and relation words (Find, Focus, the finder). */
	protected pickerContext(): PickerContext {
		return { sourcePath: this.sourcePath, me: this.meId, relationOptions: this.relationOptions, relationBlock: this.key, ...(this.host.pictures ? { pictures: this.host.pictures } : {}) };
	}

	/** Spec §14: the date reader of a tree for the link it names as its calendar note; undefined without an index (a unit fake): plain years. */
	protected get datesFor(): DatesFor | undefined {
		const index = this.host.dates;
		return index && datesForTree(index, this.sourcePath);
	}

	/** D174: the options of every relation call of this view (cards, finder, sheet, saved picture), from the settings. */
	protected get relationOptions(): RelationOptions {
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

	/** Plugin memory for this block (spec §5.5): on the handle, or keyed by text for a read-only block; null if there is none yet. */
	protected peekState(): BlockState | null {
		const h = this.handle ?? this.binding.peeked;
		return h ? h.state : (this.host.looseStates.get(this.key) ?? null);
	}

	/** The same; a read-only block with none gets a new one (only the newest 500 are kept). */
	protected ensureState(): BlockState {
		let st = this.peekState();
		if (!st) {
			st = newBlockState();
			this.host.looseStates.set(this.key, st);
			while (this.host.looseStates.size > 500) this.host.looseStates.delete(this.host.looseStates.keys().next().value!);
		}
		return st;
	}

	/** A block in a callout in Live Preview has no section: it is found once it is in the note (`BlockBinding.lateResolve`). */
	protected lateResolve(ask = true): void {
		this.binding.lateResolve(ask);
	}

	/** Watches `el` for a size change, which is when a block in a callout gets its section: `lateResolve`, then `more`. The view keeps the observer in `observer`, and the teardown disconnects it. */
	protected watchLate(el: HTMLElement, more?: () => void): void {
		this.observer = new ResizeObserver(() =>
			this.guard(() => {
				this.lateResolve();
				more?.();
			}),
		);
		this.observer.observe(el);
	}

	/** The handle this view may write through (`BlockBinding.validHandle`). */
	protected validHandle(): Promise<Handle | null> {
		return this.binding.validHandle();
	}

	/** The note was renamed: later writes and "Open note" use the new path. */
	renamed(oldPath: string, newPath: string): void {
		this.binding.renamed(oldPath, newPath);
	}

	/** Read-only full-screen view: the note changed. Close unless the block is still there with the same text. */
	stillThere(text: string | null): void {
		this.binding.stillThere(text);
	}

	/** Is this block inside something that shows another note's content (`BlockBinding.inForeignView`)? Spec §6.1 wants such views read-only. */
	protected inForeignView(): boolean {
		return this.binding.inForeignView();
	}

	/**
	 * Moves the list of a block to `id` and draws every view of the block again. `push` (a tap on a name, Find) puts
	 * `from`, the person the list stood on, on the Back trail; `pop` (Back) cuts the trail back to `id`. Through the
	 * block state, like `focusState`, so the full-screen view that Expand opens stands on the same person.
	 */
	static listGo(host: ViewHost, st: BlockState, id: string, how: 'push' | 'pop', from: string | null, origin: TreeViewBase | null = null): void {
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
		TreeViewBase.redrawState(host, st, { origin });
	}

	/**
	 * Sets the session focus in a block's state and draws every view of that block again. Through
	 * the state, not a view: the view that opened a sheet can be gone (Obsidian draws a block again
	 * after each write), so the sheet acts on whatever views show the block now.
	 */
	static focusState(host: ViewHost, st: BlockState, id: string | null, target: string[] | null = null, origin: TreeViewBase | null = null): void {
		st.focus = { id };
		// Any other change of the family starts a new Back trail of the phone list (D144).
		st.listBack = undefined;
		// A choice of the user replaces a pending "show the saved person", the finder's result (spec §13.2) and the Show view of a line of succession (contract 0.2.7 F.1).
		st.shown = null;
		st.finder = null;
		st.succession = null;
		TreeViewBase.redrawState(host, st, { target, origin });
	}

	/**
	 * Every view whose block state is `st` draws its focus again (a choice of the user replaces a D21
	 * badge focus). Only `origin`, the view that ran Find or the problem list, gets `target`: the
	 * others just redraw (a static preview keeps its first view, D1). `except` does not redraw.
	 * `keepOwn` keeps the D21 own focus of full-screen views.
	 */
	static redrawState(host: ViewHost, st: BlockState, opts: RedrawOptions = {}): void {
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
	static dropOwnFocus(host: ViewHost, st: BlockState): () => void {
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

	/** S8: the parse of a block text, shared through the host's cache. The caller must not change the result. */
	protected parse(text: string): ParseResult {
		return this.host.parseCache?.get(this.sourcePath, text) ?? parseDynasty(text);
	}

	/**
	 * A holder's name in the Titles window (spec §13.4): the view of the same kind that opened the window
	 * (Obsidian can have drawn it again) centres and highlights the person, like Find.
	 */
	protected static showFound(host: ViewHost, st: BlockState, full: boolean, id: string): void {
		// Two views can share one state (a note open in two tabs): the one that shows a tree wins.
		const same = [...host.views].filter((x) => !x.unloaded && !!x.full === full && x.peekState() === st);
		const v = same.find((x) => !!x.panZoom?.view) ?? same[0];
		v?.guard(() => v.showFound(id));
	}

	/** G.7: a row of the line of succession opens that person's window; the view that opened the Titles window may be drawn again by now. */
	protected static openPersonOf(host: ViewHost, st: BlockState, full: boolean, id: string, own: TreeViewBase | null): void {
		const same = [...host.views].filter((x) => !x.unloaded && !x.inForeignView() && !!x.full === full && x.peekState() === st);
		const v = own ?? same.find((x) => !!x.panZoom?.view) ?? same[0];
		v?.guard(() => void v.openSheet(id, false));
	}

	/**
	 * A window closed: the focus goes back to the button that opened it (Houses, or More for Titles;
	 * spec §5.2). After a write Obsidian can draw the block again a little later, and the button the
	 * focus went back to is then gone: look again for a short time, but never take the focus from
	 * somewhere the user put it.
	 */
	protected static refocusButton(host: ViewHost, st: BlockState, full: boolean, sel: string, step = 0): void {
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
		if (wait !== undefined) (doc.defaultView ?? window).setTimeout(() => TreeViewBase.refocusButton(host, st, full, sel, step + 1), wait);
	}

	/**
	 * True once for the `focus` event of an element that `refocusAfterRedraw` marked: a restored focus is not a move of the user to a control, so it keeps the
	 * place of the view. A mark and not a time window: Chromium holds the event while the page has no OS focus and sends it after the code returned.
	 */
	static takeRestoreMark(el: Element): boolean {
		const clear = restoreMarks.get(el);
		clear?.();
		return !!clear;
	}

	/** Marks `el` for `takeRestoreMark`. The mark ends at the next input of the user or when `el` loses the focus, so a later Tab focus never uses it. */
	private static markRestore(el: HTMLElement): void {
		restoreMarks.get(el)?.();
		const win = el.win;
		const clear = () => {
			restoreMarks.delete(el);
			el.removeEventListener('blur', clear);
			win.removeEventListener('pointerdown', clear, true);
			win.removeEventListener('keydown', clear, true);
		};
		restoreMarks.set(el, clear);
		el.addEventListener('blur', clear);
		win.addEventListener('pointerdown', clear, true);
		win.addEventListener('keydown', clear, true);
	}

	/**
	 * G5 0.4 (WCAG 2.4.3): a window of the tree closed, and Obsidian gave the focus back to the element that had it when the window opened. After a write the
	 * redraw has replaced that element (a card, Expand), so the focus fell to the page. This puts it on the same place in the new drawing: `find` in the views that
	 * `match` picks. Only while the focus is on no control and no window of the plugin is open (an Undo Notice does not count: it holds no focus); it looks again a little later, as the redraw can come after the close.
	 */
	static refocusAfterRedraw(host: ViewHost, match: (v: TreeViewBase) => boolean, find: (viewport: HTMLElement) => HTMLElement | null, focusVisible: boolean, step = 0): void {
		let target: HTMLElement | null = null;
		for (const v of host.views) {
			if (v.unloaded || !v.viewport || !match(v)) continue;
			const t = find(v.viewport);
			if (t?.isConnected) target = t;
		}
		const doc = target?.doc ?? document;
		const active = doc.activeElement;
		const free = !active || active === doc.body || !active.isConnected;
		// Obsidian's own restore passes `focusVisible` too: no ring after a mouse close of a window opened by a mouse.
		if (target && free && !pluginWindowOpen()) {
			// The focus listener of the card must not pan a card that is still partly in view (keep place, D245).
			TreeViewBase.markRestore(target);
			target.focus({ preventScroll: true, focusVisible } as FocusOptions);
		}
		const wait = [150, 600][step];
		if (wait !== undefined) (doc.defaultView ?? window).setTimeout(() => TreeViewBase.refocusAfterRedraw(host, match, find, focusVisible, step + 1), wait);
	}

	/**
	 * The control of this view that has the keyboard focus now, if `is` accepts it, and whether it shows its focus ring: a window that opens now gives the focus
	 * back there when it closes (G5 0.4). Null when the focus is elsewhere (a tap on a phone leaves it on the page).
	 */
	protected focusReturn(is: (el: Element) => boolean): { visible: boolean } | null {
		const el = this.containerEl;
		const active = el.doc?.activeElement;
		if (!active || !el.contains(active) || !is(active)) return null;
		return { visible: showsRing(active) };
	}

	/** True when this view shows the block state `st`, in the full-screen view (`full`) or in the note; for `refocusAfterRedraw`. */
	static showsState(v: TreeViewBase, st: BlockState, full: boolean): boolean {
		return !!v.full === full && v.peekState() === st;
	}

	/**
	 * F10: sets the folds of a block and draws every view of it again (a static touch preview never applies a
	 * fold, so it stays). `anchor` and `targets` are for the view that acted: `origin`, or the view of the same
	 * kind that shows the block now (Obsidian can have drawn the acting view again). The other views keep their
	 * own view, as for a focus change.
	 */
	static changeFolds(host: ViewHost, st: BlockState, next: ReadonlySet<FoldKey>, o: { anchor?: FoldAnchor | null; origin?: TreeViewBase | null; full?: boolean; targets?: string[] } = {}): void {
		setFolds(st, next);
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st && (v.full || !v.coarse));
		const kind = o.origin && !o.origin.unloaded ? !!o.origin.full : (o.full ?? false);
		const same = views.filter((v) => !!v.full === kind);
		const origin = o.origin && views.includes(o.origin) ? o.origin : (same.find((v) => !!v.panZoom?.view) ?? same[0] ?? null);
		for (const v of views) v.guard(() => v.foldsChanged(v === origin ? (o.anchor ?? null) : null, v === origin ? (o.targets ?? []) : []));
	}

	/** The view that shows a block now, of the kind asked (`full` or a note), preferring one with a first view. */
	protected static viewOf(host: ViewHost, st: BlockState, full: boolean): TreeViewBase | undefined {
		const same = [...host.views].filter((v) => !v.unloaded && !!v.full === full && v.peekState() === st);
		return same.find((v) => !!v.panZoom?.view) ?? same[0];
	}

	/**
	 * F11: Focus (the toolbar and Focus here) on a hidden person opens the folds that hide them in the family that
	 * Focus will draw. The state changes before the views draw the focus.
	 */
	protected static unfoldForFocus(host: ViewHost, st: BlockState, id: string): void {
		if (!st.folds.size) return;
		const v = [...host.views].find((x) => !x.unloaded && x.whole && x.peekState() === st);
		const whole = v?.whole;
		if (!v || !whole || !foldHidden(whole, st.folds).has(id)) return;
		const parsed = v.parse(v.source);
		const drawn = (parsed.ok ? v.focusGraph(parsed.tree, id) : null) ?? whole;
		setFolds(st, unfoldFor(drawn, whole, st.folds, [id]));
	}

	/**
	 * F12: after an ok write of the sheet, opens the folds that hide the sheet's person and the people the write
	 * added, using the new text, and draws the views again with the view centred on them. Nothing changes before
	 * the write is ok, and nothing when no fold hides them.
	 */
	protected static unfoldAfterWrite(host: ViewHost, st: BlockState, full: boolean, ids: readonly string[], body: string): void {
		if (!st.folds.size) return;
		const v = TreeViewBase.viewOf(host, st, full);
		const parsed = v ? v.parse(body) : parseDynasty(body);
		if (!parsed.ok) return;
		const whole = deriveFamilies(parsed.tree, { dates: v?.whole?.dates.reader });
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
		TreeViewBase.changeFolds(host, st, next, { origin: v ?? null, full, targets: known });
	}

	/** F15: what the edit sheet gets of the folds (Hide descendants, Show descendants, and the unfold after a write). */
	protected sheetFolds(h: Handle): SheetFolds {
		const host = this.host;
		const st = h.state;
		const full = !!this.full;
		const live = full || !this.coarse;
		const now = () => TreeViewBase.viewOf(host, st, full);
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
					TreeViewBase.changeFolds(host, st, next, { anchor: { kind: 'person', id }, origin: now() ?? null, full });
					return;
				}
				// The preview does not change: the fold is made in the block's state, and the full-screen view opens on the person.
				setFolds(st, next);
				void now()?.openFull(id);
			},
			show: (id) => {
				const next = new Set(st.folds);
				for (const k of state(id).folded) next.delete(k);
				TreeViewBase.changeFolds(host, st, next, { anchor: { kind: 'person', id }, origin: now() ?? null, full });
			},
			written: (ids) => {
				if (live) TreeViewBase.unfoldAfterWrite(host, st, full, ids, h.body);
			},
		};
	}

	/**
	 * Show (Titles window, contract E.4): opens the view of the line of `title` in every view of the block that can draw it. It writes
	 * nothing. If only a phone list or a static preview shows the block, the full-screen view opens with it, as for the finder.
	 */
	static showSuccession(host: ViewHost, st: BlockState, title: string, origin: TreeViewBase | null): void {
		st.succession = { title };
		// One temporary view at a time (F.1).
		st.finder = null;
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st);
		const shows = views.filter((v) => v.full || !v.coarse);
		if (shows.length) {
			const same = shows.filter((v) => !origin || !!v.full === !!origin.full);
			const at = origin && shows.includes(origin) ? origin : same.length === 1 ? same[0] : null;
			if (at) at.focusDue = '.dynasty-succession-text';
			TreeViewBase.successionRedraw(host, st);
			return;
		}
		TreeViewBase.successionRedraw(host, st);
		const preview = origin && views.includes(origin) ? origin : views[0];
		if (preview) void preview.openFull(null, null, '.dynasty-succession-text');
	}

	/**
	 * Every phone list of the block draws again at once, also under an open full-screen view (a list is cheap to draw). Esc in that view
	 * ends the finder first and leaves the view open, so a list that waited for the view to close would keep the old bar.
	 */
	protected static listRedraw(host: ViewHost, st: BlockState): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || v.full || !v.coarse || !v.isPhone()) continue;
			v.pendingTarget = null;
			v.syncFocus(true);
		}
	}

	/** Every view of the block that can show the Show view or its bar draws again (F.2: this includes the phone list; never the static tablet preview, D1). */
	protected static successionRedraw(host: ViewHost, st: BlockState): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || (!v.full && v.coarse && !v.isPhone())) continue;
			v.pendingTarget = null;
			v.syncFocus();
		}
	}

	/**
	 * Shows `second` as a relative of `first` (spec §13.2) in every view of the block that can show it.
	 * It writes nothing. Through the block state, not a view: the view that opened a sheet can be gone.
	 * If only the static touch preview shows the block (D1), the preview does not change and the
	 * full-screen view opens with the result (like D17).
	 */
	static showFinder(host: ViewHost, st: BlockState, first: string, second: string, origin: TreeViewBase | null): void {
		st.finder = { first, second, index: 0, whole: false, steps: false };
		// One temporary view at a time (contract 0.2.7 F.1). The finder skips the phone list, so a list under a Show view that ends here draws again.
		const hadShow = st.succession !== null;
		st.succession = null;
		if (hadShow) TreeViewBase.listRedraw(host, st);
		const views = [...host.views].filter((v) => !v.unloaded && v.peekState() === st);
		const shows = views.filter((v) => v.full || !v.coarse);
		if (shows.length) {
			// The sentence takes the keyboard focus only in the view the user acted in. If Obsidian drew that
			// view again meanwhile (a write from its sheet), the one view of the same kind that replaced it.
			const same = shows.filter((v) => !origin || !!v.full === !!origin.full);
			const at = origin && shows.includes(origin) ? origin : same.length === 1 ? same[0] : null;
			if (at) at.focusDue = '.dynasty-result-text';
			TreeViewBase.finderRedraw(host, st);
			return;
		}
		const preview = origin && views.includes(origin) ? origin : views[0];
		if (preview) void preview.openFull(null, null, '.dynasty-result-text');
	}

	/**
	 * Every view of the block that can show the finder's result draws again; never the static touch
	 * preview (D1). Only `origin` gets `target`, to centre and highlight (Find, the problem list).
	 */
	protected static finderRedraw(host: ViewHost, st: BlockState, origin: TreeViewBase | null = null, target: string[] | null = null): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v.peekState() !== st || (!v.full && v.coarse)) continue;
			v.pendingTarget = v === origin ? target : null;
			v.syncFocus();
		}
	}

	// The layers above implement these; the chain of layers is listed in `tree-view.ts`.
	protected abstract breakList(): ReturnType<typeof parseBreakList>;
	protected abstract cancelPulse(): void;
	protected abstract changed(h: Handle, body: string): void;
	protected abstract checkTurn(): void;
	protected abstract closeFinder(): void;
	protected abstract closeSuccession(): void;
	protected abstract fillNear(view: View): void;
	protected abstract fillPerson(id: string): void;
	protected abstract focusGraph(tree: Tree, focus: string): FamilyGraph | null;
	abstract focusOn(id: string | null, target?: string[] | null): void;
	protected abstract foldsChanged(anchor: FoldAnchor | null, targets: string[]): void;
	protected abstract guard(fn: () => void): void;
	protected abstract isPhone(): boolean;
	protected abstract keepView(): void;
	protected abstract keptAnchor(): Anchor | null;
	protected abstract layOut(g: FamilyGraph, geo: Geometry, base: LayoutSettings, fonts: SceneOptions['fonts'], labels?: ReadonlyMap<string, CardLabel>, foldHidden?: ReadonlySet<string>, shouldStop?: () => boolean): MeasuredResult;
	protected abstract linePeopleNow(): string[] | null;
	protected abstract linksResolved(): void;
	protected abstract markInteractive(): void;
	protected abstract modalAbove(): boolean;
	protected abstract openFull(target: string | null, focus?: string | null, focusDue?: string | null): Promise<void>;
	protected abstract openHouses(): Promise<void>;
	protected abstract openNewPerson(): Promise<void>;
	protected abstract openSheet(id: string, fromTap: boolean): Promise<void>;
	protected abstract openTitles(): Promise<void>;
	protected abstract picturesChanged(paths: readonly string[]): void;
	protected abstract picturesLookAgain(): void;
	protected abstract placeClasses(root: HTMLElement): void;
	protected abstract pulse(ids: string[]): void;
	protected abstract recheckTall(fresh?: boolean): boolean;
	protected abstract redraw(g: FamilyGraph, laid: LaidOut): void;
	protected abstract refillList(): void;
	protected abstract releaseList(): void;
	protected abstract render(fontsOverride: FontState | null): void;
	protected abstract resized(): void;
	protected abstract reveal(box: Rect, kept?: boolean): void;
	protected abstract showFound(id: string): void;
	protected abstract showPeople(ids: string[]): void;
	protected abstract showPictures(view: View): void;
	protected abstract showPlaceholder(): void;
	protected abstract showTree(): void;
	protected abstract startFinder(): Promise<void>;
	protected abstract startPictures(): void;
	abstract syncFocus(own?: boolean): void;
	protected abstract tagActivated(spouses: readonly string[], tagEl: SVGGElement, hit: SVGRectElement): void;
	protected abstract takeFocus(): void;
	protected abstract toggleFold(c: FoldControl): void;
	protected abstract turnDue(): boolean;
	protected abstract updateBadge(bar?: HTMLElement | null): void;
	protected abstract updateEditUi(): void;
	protected abstract updateHeight(): void;
}
