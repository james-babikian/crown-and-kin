import { Keymap, MarkdownRenderChild, Notice, getLinkpath, setIcon, type App, type HoverParent, type HoverPopover, type MarkdownPostProcessorContext, type MarkdownSectionInformation } from 'obsidian';
import { deriveFamilies, type FamilyGraph } from '../core/derive';
import type { CodedIssue } from '../core/issues';
import { hardErrorText, issueText } from '../core/messages';
import { findBlocks } from '../core/block-locate';
import { focusGenerationsFor, focusSubgraph } from '../core/focus-subgraph';
import { parseDynasty } from '../core/parse';
import type { Person, Tree } from '../core/types';
import { drawnGeometry, geometryFor } from '../layout/geometry';
import { DEFAULT_FAR_RULE, illegitimateSigns, layoutTree } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings, Orientation, PersonBox, Rect } from '../layout/model';
import { fontsChanged, parsePx, usesFamily, type FontState } from '../render/fonts';
import { clearMeasureCache, measureText, usableFamily } from '../render/dom/measure';
import { calloutBackdrop, plusChoice } from '../render/dom/theme-read';
import { PanZoom } from '../render/dom/pan-zoom';
import { buildLegend, buildScene, lodClass, type CardLink, type Scene, type SceneOptions } from '../render/dom/scene';
import { sameTall, tallCardsFor } from '../render/dom/tall-cards';
import { buildCallout, Popover } from '../render/dom/widgets';
import { familyOf, linkTarget, startPerson, type RenderTiming } from '../render/tree-info';
import { ADD_UI, BLOCK_UI, FOCUS_UI, FULL_UI, HINT_UI, HOUSES, PROBLEMS_HINT, UI, WRITE_TEXT, problemsLabel, problemsTitle } from '../render/ui-text';
import {
	centreOn,
	isPan,
	chooseLod,
	bandShift,
	clearBand,
	defaultView,
	embedHeight,
	enlargeHit,
	fitView,
	resizeView,
	treeBounds,
	type Lod,
	type Size,
	type View,
} from '../render/view-math';
import { focusKey, newBlockState, sameBody, type BlockState, type Handle, type HandleRegistry } from './block-handle';
import { EditSheet } from './edit-sheet';
import { NARROW_MAX_EM, PHONE_FOCUS_MIN_PEOPLE, badgeHit, badgeHitInCard, chooseFocus, clearToolbar, focusView, isPhoneWindow, narrowCardWidth, orientationFor, outsideBox, sidewaysView, tagHitBelow } from './focus-mode';
import { FullScreenModal } from './full-screen';
import { HousesWindow } from './houses-window';
import { pickPerson } from './person-picker';
import { pluginModalOpen } from './plugin-modals';
import { DEFAULT_SETTINGS, type DynastySettings } from './settings-contract';

/** What a tree view needs from the plugin. */
export interface TreeHost {
	app: App;
	/** One handle per block (spec §6.1). A block's view state lives on its handle. */
	handles: HandleRegistry;
	/** View state of read-only blocks, which have no handle, keyed by note path and text. */
	looseStates: Map<string, BlockState>;
	views: Set<TreeView>;
	recordTiming(t: RenderTiming): void;
	/** Spec §9 (M6 contract): read on every render; `onSettingsChange` follows a change. */
	readonly settings: DynastySettings;
}

/** What a full-screen view takes over from the embedded view that opened it (spec §7.1). */
export interface FullSource {
	key: string;
	sourcePath: string;
	source: string;
	handle: Handle | null;
	peeked: Handle | null;
	readOnly: boolean;
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

/** `env(safe-area-inset-top)` in px, read from a probe element (spec §7.5). */
function safeTop(el: HTMLElement): number {
	const probe = el.createDiv({ cls: 'dynasty-safe-probe' });
	try {
		return parsePx(getComputedStyle(probe).paddingTop) ?? 0;
	} finally {
		probe.remove();
	}
}

/** Stable, short text hash for a block key when Obsidian cannot say where the block is. */
function shortHash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

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
	/** WP5.5c: the narrow card width for the note preview's box, once the box has a width; the width the layout used. */
	private narrowW: number | undefined;
	private narrowUsed: number | undefined;
	/** What the last render laid out and drew with, so the note preview can lay out again in place (WP5.5c). */
	private redo: { geo: Geometry; settings: LayoutSettings; sceneEl: SVGGElement; opts: SceneOptions } | null = null;
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
	private laid: LaidOut | null = null;
	private scene: Scene | null = null;
	private svg: SVGSVGElement | null = null;
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
	 * A font probe that stays in the tree (G5 fix round): a probe added to the page later makes the
	 * engine compute the style of every element again, about 0.35 s for sample tree 7 on a slow phone.
	 */
	private fontProbe: HTMLElement | null = null;
	private lod: Lod | null = null;
	private bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private start: string | null = null;
	private optionsStart: string | undefined;
	private optionsHeight: number | undefined;
	private blocked = false;
	private readonly timers = new Set<number>();
	private readonly info: MarkdownSectionInformation | null;
	/** What Obsidian reported for this block, on the root as `data-dynasty-section` for the test harness. */
	private readonly sectionNote: string;
	/** The block's handle once known; null while it resolves, and for a read-only view. */
	private handle: Handle | null = null;
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
	private retries = 0;
	private retryTimer = 0;

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
			// The generations matter only while a focus family is drawn.
			if (prev.cardSize === now.cardSize && (prev.focusGenerations === now.focusGenerations || this.focusId === null)) {
				root?.toggleClass('dynasty-no-dates', !now.showDates);
				this.updateHeight();
				return;
			}
			this.carry = prev.cardSize === now.cardSize ? this.anchor() : null;
			this.render(this.fonts);
		});
	}

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
		this.guard(() => this.render(null));
		if (this.info || this.full) {
			void this.ready.then((h) => this.guard(() => this.attach(h)));
		}
	}

	override onunload(): void {
		this.unloaded = true;
		if (this.retryTimer) this.containerEl.win.clearTimeout(this.retryTimer);
		if (this.turnTimer) this.containerEl.win.clearTimeout(this.turnTimer);
		this.host.views.delete(this);
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.teardown();
	}

	/** Plugin memory for this block (spec §5.5): on the handle, or keyed by text for a read-only block. */
	private blockState(): BlockState {
		const h = this.handle ?? this.peeked;
		if (h) return h.state;
		let st = this.host.looseStates.get(this.key);
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
			// The body tells a different block from the one the lines suggested: move a view state across.
			const loose = this.host.looseStates.get(this.key);
			if (loose?.view && !h.state.view) {
				h.state.view = loose.view;
				h.state.viewFor = loose.viewFor;
				h.state.views = { ...loose.views };
			}
			if (loose && !h.state.focus) h.state.focus = loose.focus;
			if (loose && h.state.autoFocus === null) h.state.autoFocus = loose.autoFocus;
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
	 * The handle this view may write through: only one whose body is what this view rendered
	 * (supervisor rule). A stale view re-reads, then finds its block again, or writes nothing.
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
		if (this.full && !parseDynasty(body).ok) {
			this.full.close(FULL_UI.invalid);
			return;
		}
		this.source = body;
		this.dragHeight = null;
		this.carry = this.anchor();
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
		const old = this.handle;
		this.handle = null;
		const h = await this.host.handles.resolveUnique(this.sourcePath, this.source).catch(() => null);
		if (this.unloaded) return;
		if (!h) {
			this.full?.close(FULL_UI.gone);
			return;
		}
		if (old && old !== h && !h.state.view) Object.assign(h.state, old.state);
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
	 * WP6.5: what one CSS rule cannot follow in every theme. The toolbar in a callout shows the
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
		for (const el of Array.from(vp.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-hint'))) {
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
		this.carry = this.anchor();
		clearMeasureCache();
		this.render(fonts);
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
		return { person: best.id, dx: (v.cx - best.cx) / f, dy: (v.cy - best.cy) / f, scale: v.scale, byUser: this.blockState().view !== null, bandClear };
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
		this.teardown();
		const el = this.containerEl;
		el.empty();
		this.emptyEl = null;
		this.viewport = null;
		this.fontProbe = null;
		// A new PanZoom has no view yet: its first sized resize sets the first view anyway.
		this.firstDue = false;
		this.hintOn = false;
		this.hintKids = [];
		const win = el.win;
		// D24: sideways on a phone in portrait. Set first, so a block with no tree follows a turn too.
		const orientation = orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen);
		this.orientation = orientation;
		const t0 = performance.now();
		const parsed = parseDynasty(this.source);
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
		const geo = geometryFor(fonts.px, this.settings.cardSize);
		// The static note preview has narrow cards, as wide as its box allows for two whole generations (WP5.5c).
		const cards = this.full ? ('normal' as const) : ('narrow' as const);
		this.narrowUsed = orientation === 'sideways' && cards === 'narrow' ? (this.narrowW ?? narrowCardWidth(el.clientWidth, geo.fontPx)) : undefined;
		const base: LayoutSettings =
			orientation === 'sideways'
				? { sweeps: 4, far: DEFAULT_FAR_RULE, orientation, sidewaysCards: cards, ...(this.narrowUsed !== undefined ? { narrowCardW: this.narrowUsed } : {}) }
				: { sweeps: 4, far: DEFAULT_FAR_RULE };
		const focus = this.pickFocus(parsed.tree, whole);
		// Focus mode (spec §5.6): only the focus family is laid out and drawn; the whole tree's
		// problems stay on the badge, and every edit reads the whole block (the decision notes M5). D23: the
		// static preview on a phone shows 1 generation up and down, so the children show below.
		const n = !this.full && this.coarse && isPhoneWindow(true, win.innerWidth, win.innerHeight) ? 1 : focusGenerationsFor(parsed.tree.options, this.settings.focusGenerations);
		let sub = focus !== null ? focusSubgraph(parsed.tree, focus, n) : null;
		// §5.5: a person just saved is shown once, by the first view of the kind that saved them
		// (the decision notes WP5.2 fix round 2). If its family does not draw them, it shows all people, like Find.
		const st = this.blockState();
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
		const g = sub ? deriveFamilies(sub.tree) : whole;
		const { laid, settings } = this.layOut(g, geo, base, fonts, sub?.hidden);
		const t2 = performance.now();
		// A saved view of normal cards means nothing on compact cards (spec §9 card size).
		const size = geo.cardSize === 'compact' ? '|compact' : '';
		const family = focusKey(sub ? focus : null, n) + size;
		// A view of one family means nothing in another: the new family gets its own first view.
		if (this.familyKey !== null && this.familyKey !== family) this.carry = null;
		this.familyKey = family;
		this.drawnKey = focusKey(sub ? focus : null, n, orientation, cards) + size;
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

		const root = el.createDiv({ cls: 'dynasty-root', attr: { 'data-dynasty-people': String(g.people.length), 'data-dynasty-section': this.sectionNote, 'data-dynasty-orientation': orientation } });
		if (this.focusId !== null) root.setAttribute('data-dynasty-focus', this.focusId);
		this.placeClasses(root);
		// Spec §9: the dates hide, the cards keep their size (the layout does not change).
		root.toggleClass('dynasty-no-dates', !this.settings.showDates);
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
		// The HTML wrapper takes the CSS transform during a pinch (PanZoom, WP5.3).
		const canvas = viewport.createDiv({ cls: 'dynasty-canvas' });
		const svg = canvas.createSvg('svg', { cls: 'dynasty-svg', attr: { width: '100%', height: '100%' } });
		this.svg = svg;
		// The layout clamps the font size; the card text must use the size the layout used.
		svg.style.setProperty('--dynasty-font-size', `${geo.fontPx}px`);
		// Obsidian's aria-label tooltips work only on HTML elements and fail on SVG ones. The CSS
		// turns them off with --no-tooltip; this also covers versions without that switch.
		svg.addEventListener('pointerover', (e) => e.stopPropagation());
		const sceneEl = svg.createSvg('g', { cls: 'dynasty-scene' });
		const opts: SceneOptions = {
			fonts,
			measure: measureText,
			link: (p) => this.cardLink(p),
			badges: sub ? { hidden: sub.hidden, label: (p, n) => FOCUS_UI.badgeLabel(p.name, n) } : undefined,
		};
		this.scene = buildScene(sceneEl, g, laid, opts);
		this.redo = { geo, settings, sceneEl, opts };
		this.wireScene(this.scene);
		// Keyboard focus on a card makes the browser scroll this overflow-hidden box, which would
		// shift the tree against the pan/zoom transform. Keep it at 0 and pan instead.
		viewport.addEventListener('scroll', () => {
			viewport.scrollTop = 0;
			viewport.scrollLeft = 0;
		});
		this.popover = new Popover(viewport);
		this.buildToolbar(viewport, whole.issues);
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
			// less text to lay out, so the fills are cheaper (WP5.3: 83–133 ms instead of 133–167 ms at 4×).
			onFill: (v) => this.applyLod(v),
			guard: (fn) => this.guard(fn),
		});
		this.fontProbe = root.createDiv({ cls: 'dynasty-font-probe' });
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
		if (sessionChanged) TreeView.redrawState(this.host, st, null, null, this);
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
		const root = el.createDiv({ cls: 'dynasty-root dynasty-empty-root', attr: { 'data-dynasty-people': '0', 'data-dynasty-section': this.sectionNote, 'data-dynasty-orientation': this.orientation } });
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
	 * D30: a phone, upright or on its side, takes the phone height and ignores `options.height`. The
	 * screen decides, not the window: an on-screen keyboard makes a tablet's window lower than 600 px,
	 * but not its screen (the decision notes "WP6.3 fix round").
	 */
	private phoneHeight(): boolean {
		const win = this.containerEl.win;
		const screen = win.screen;
		return isPhoneWindow(this.coarse, screen?.width || win.innerWidth, screen?.height || win.innerHeight);
	}

	/**
	 * The focus person to draw, or null for the whole tree (the decision notes M5 priority: session focus,
	 * pin, the phone rule of D20, whole tree).
	 */
	private pickFocus(tree: Tree, whole: FamilyGraph): string | null {
		// D21: a full-screen view opened by a badge tap in a static embed shows that family, until the user chooses another focus there.
		const own = this.full?.focus;
		if (own && (own.id === null || whole.byId.has(own.id))) return own.id;
		const st = this.blockState();
		const win = this.containerEl.win;
		const choice = chooseFocus({
			session: st.focus,
			pin: tree.options.focus,
			phone: isPhoneWindow(this.coarse, win.innerWidth, win.innerHeight),
			auto: st.autoFocus,
			has: (id) => whole.byId.has(id),
			large: () => whole.people.length > PHONE_FOCUS_MIN_PEOPLE,
			start: () => {
				const edited = st.lastEdited;
				return startPerson(whole, edited !== null && whole.byId.has(edited) ? edited : tree.options.start);
			},
		});
		if (choice.dropSession) st.focus = null;
		st.autoFocus = choice.auto;
		return choice.id;
	}

	/**
	 * Sets the session focus of this block (Focus, Focus here, a `+` badge; null: Show all people)
	 * and draws every view of the block again with it (spec §5.6). Nothing is written.
	 */
	focusOn(id: string | null, target: string[] | null = null): void {
		TreeView.focusState(this.host, this.blockState(), id, target, this);
	}

	/**
	 * Sets the session focus in a block's state and draws every view of that block again. Through
	 * the state, not a view: the view that opened a sheet can be gone (Obsidian draws a block again
	 * after each write), so the sheet acts on whatever views show the block now.
	 */
	static focusState(host: TreeHost, st: BlockState, id: string | null, target: string[] | null = null, origin: TreeView | null = null): void {
		st.focus = { id };
		// A choice of the user replaces a pending "show the saved person".
		st.shown = null;
		TreeView.redrawState(host, st, target, origin);
	}

	/**
	 * Every view whose block state is `st` draws its focus again (a choice of the user replaces a D21
	 * badge focus). Only `origin`, the view that ran Find or the problem list, gets `target`: the
	 * others just redraw (a static preview keeps its first view, D1). `except` does not redraw.
	 */
	static redrawState(host: TreeHost, st: BlockState, target: string[] | null = null, origin: TreeView | null = null, except: TreeView | null = null, keepOwn = false): void {
		for (const v of [...host.views]) {
			if (v.unloaded || v === except || v.blockState() !== st) continue;
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
			if (v.unloaded || !v.full || !own || v.blockState() !== st) continue;
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
		const phone = this.phoneHeight();
		const h = this.dragHeight !== null && !phone ? `${this.dragHeight}px` : embedHeight(this.optionsHeight, phone, { desktop: `${s.embedHeightDesktop}px`, phone: `${s.embedHeightPhone}vh` });
		this.viewport?.style.setProperty('--dynasty-height', h);
	}

	/**
	 * Lays the note preview out again, in place, when its box asks for another narrow card width
	 * (WP5.5c): only the scene is drawn again, so the viewport, toolbar and observers stay. True when
	 * it did; the caller then sets the first view.
	 */
	private fitNarrow(box: number): boolean {
		const redo = this.redo;
		const g = this.g;
		if (this.orientation !== 'sideways' || this.full || !redo || !g || !this.panZoom || !(box > 0)) return false;
		const f = redo.geo.fontPx;
		const want = narrowCardWidth(box, f);
		if (want === undefined || want === (this.narrowUsed ?? NARROW_MAX_EM * f)) return false;
		this.narrowW = want;
		this.narrowUsed = want;
		// D29: the names that need two text lines depend on the card width.
		const next = this.layOut(g, redo.geo, { ...redo.settings, narrowCardW: want }, redo.opts.fonts, redo.opts.badges?.hidden);
		redo.settings = next.settings;
		this.redraw(g, next.laid);
		return true;
	}

	/**
	 * Lays `g` out. The names are measured first with the real font (D29, D37): a name that needs two
	 * text lines makes its card taller. Only when the D14 sign decides it for someone does the layout
	 * run twice (the sign comes from the lines of a layout with no tall cards).
	 */
	private layOut(g: FamilyGraph, geo: Geometry, base: LayoutSettings, fonts: SceneOptions['fonts'], hidden?: ReadonlyMap<string, number>): { laid: LaidOut; settings: LayoutSettings } {
		const plain: LayoutSettings = { ...base };
		delete plain.tallCards;
		const drawn = drawnGeometry(geo, plain);
		const sideways = plain.orientation === 'sideways';
		let tall = tallCardsFor(g, drawn, sideways, fonts, measureText, hidden);
		if (tall === undefined) {
			const first = layoutTree(g, geo, plain, fonts.text);
			tall = tallCardsFor(g, drawn, sideways, fonts, measureText, hidden, illegitimateSigns(g, first.edges)) ?? [];
			if (!tall.length) return { laid: first, settings: plain };
		}
		const settings = tall.length ? { ...plain, tallCards: tall } : plain;
		return { laid: layoutTree(g, geo, settings, fonts.text), settings };
	}

	/** Draws a new layout of the note preview in place (WP5.5c, D29): the viewport, toolbar and observers stay. */
	private redraw(g: FamilyGraph, laid: LaidOut): void {
		const redo = this.redo;
		if (!redo || !this.panZoom) return;
		this.laid = laid;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.panZoom.setBounds(this.bounds);
		this.popover?.close();
		redo.sceneEl.empty();
		this.scene = buildScene(redo.sceneEl, g, laid, redo.opts);
		this.wireScene(this.scene);
		if (this.lod && this.svg) this.svg.removeClass(lodClass(this.lod));
		this.lod = null;
		this.carry = null;
		this.firstDue = true;
	}

	/**
	 * D29, D37 after a web font loaded or the CSS changed: the names are measured again, and if another
	 * set of cards needs two text lines, the tree is laid out again in place. The static touch preview
	 * shows its first view (D1); other views keep the same tree point at the centre (spec §7.5).
	 */
	private recheckTall(fresh = false): boolean {
		const redo = this.redo;
		const g = this.g;
		if (!redo || !g || !this.panZoom) return false;
		// css-change: the widths cached for the same font text can belong to the face that was in use before.
		if (fresh) clearMeasureCache();
		const next = this.layOut(g, redo.geo, redo.settings, redo.opts.fonts, redo.opts.badges?.hidden);
		if (sameTall(next.settings.tallCards, redo.settings.tallCards)) {
			if (fresh) this.scene?.refit();
			return false;
		}
		const keep = this.full || !this.coarse ? this.anchor() : null;
		redo.settings = next.settings;
		this.redraw(g, next.laid);
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
		const vp = this.viewport;
		const pz = this.panZoom;
		if (!vp || !pz || !this.laid) return;
		if (this.turnDue()) {
			this.checkTurn();
			return;
		}
		// WP5.5c: the note preview's narrow cards follow its box (the box has no width before the first
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
		let carried = this.carry ? this.fromAnchor(this.carry) : null;
		const carriedByUser = this.carry?.byUser ?? false;
		// Larger cards around the same centre can reach up under the toolbar; if none was there
		// before, move the view down just enough.
		if (carried && this.carry?.bandClear) carried = clearBand(carried, size, this.insetTop, [...this.laid.layout.persons.values()]);
		this.carry = null;
		const st = this.blockState();
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
		this.showEdited(st);
	}

	/**
	 * The toolbar bands that views chosen by the plugin keep free: at the top, or at the bottom for
	 * the full-screen toolbar on a phone (spec §7.5).
	 */
	private measureInsets(vp: HTMLElement): void {
		const bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		const atBottom = !!bar && bar.offsetTop > vp.clientHeight / 2;
		// With the toolbar at the bottom, the top band is the phone's status bar or notch (safe area).
		this.insetTop = bar && !atBottom ? bar.offsetTop + bar.offsetHeight + 4 : this.full ? safeTop(vp) : 0;
		this.insetBottom = bar && atBottom ? vp.clientHeight - bar.offsetTop + 4 : 0;
		this.barBox = bar && !atBottom && Number.isFinite(bar.offsetLeft) && bar.offsetWidth > 0 ? { left: bar.offsetLeft, right: bar.offsetLeft + bar.offsetWidth, top: bar.offsetTop, bottom: bar.offsetTop + bar.offsetHeight + 4 } : null;
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
			const v = this.savedView(this.blockState());
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
		this.reveal(box);
		this.highlight([hl.id]);
	}

	/** The view a tree opens with: the focus view (D18, §5.6) in focus mode, else the default view (§5.5). */
	private firstView(laid: LaidOut, size: Size): View {
		const id = this.focusId;
		if (laid.layout.orientation === 'sideways') return this.sidewaysFirst(laid, size, id ?? this.startId());
		if (id === null) return this.defaultViewFor(laid, size);
		const persons = laid.layout.persons;
		const me = persons.get(id) ?? null;
		const children = this.g ? familyOf(this.g, id).children.map((c) => persons.get(c)).filter((b): b is PersonBox => !!b) : [];
		// D23: with no parent drawn above, the person sits near the top (D13), not in the middle of an empty view.
		const parentIds = this.g?.placementParents.get(id) ?? [];
		const atTop = !parentIds.length;
		const parents = parentIds.map((p) => persons.get(p)).filter((b): b is PersonBox => !!b);
		const v = this.aboveBottomBar(size, (area) => focusView(this.bounds, area, laid.layout.geometry.fontPx, me, this.insetTop, children, atTop, parents));
		// Not clearBand (which clears the whole width): only the cards and badges under the toolbar
		// itself move the view down, and never so far that the focus card leaves the free area.
		if (!this.barBox) return v;
		const boxes = [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)];
		return clearToolbar(v, size, this.barBox, boxes, me, size.h - this.insetBottom);
	}

	/** Start person (spec §5.5): the person last edited in this block, else options.start, else the first root. */
	private startId(): string | null {
		const edited = this.blockState().lastEdited;
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
		const boxes = (ids: Iterable<string>) => [...ids].map((x) => persons.get(x)).filter((b): b is PersonBox => !!b);
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
		this.hintKids = boxes(kids);
		const view = sidewaysView(
			size,
			laid.layout.geometry.fontPx,
			{
				me,
				partners: fam && id !== null ? boxes(near(id, fam.partners)) : [],
				children: g ? kids.flatMap((c) => boxes([c]).map((card) => ({ card, partners: boxes(near(c, familyOf(g, c).partners)) }))) : [],
				parents: id !== null && g ? boxes(g.placementParents.get(id) ?? []) : [],
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
		this.start = this.startId();
		const persons = laid.layout.persons;
		const startBox = this.start ? (persons.get(this.start) ?? null) : null;
		const fam = this.start && this.g ? familyOf(this.g, this.start) : null;
		const boxes = (ids: string[]) => ids.map((id) => persons.get(id)).filter((b): b is PersonBox => !!b);
		const family = fam ? { partners: boxes(fam.partners), children: boxes(fam.children) } : null;
		return this.aboveBottomBar(size, (area) => {
			const v = defaultView(this.bounds, area, laid.layout.geometry.fontPx, startBox, this.insetTop, family);
			// A toolbar taller than the gap between rows could still reach the row above the start person.
			return clearBand(v, area, this.insetTop, [...persons.values()]);
		});
	}

	private applyLod(view: View): void {
		const svg = this.svg;
		const laid = this.laid;
		if (!svg || !laid) return;
		const lod = chooseLod(this.lod, view.scale * laid.layout.geometry.fontPx);
		if (lod !== this.lod) {
			if (this.lod) svg.removeClass(lodClass(this.lod));
			svg.addClass(lodClass(lod));
			this.lod = lod;
		}
	}

	private settled(view: View, byUser: boolean): void {
		const laid = this.laid;
		if (!this.svg || !laid) return;
		this.applyLod(view);
		// Tag hit areas stay at least 44 screen px at low zoom (spec §7.5, the decision notes).
		const place = (hit: SVGRectElement, r: Rect) => {
			hit.setAttribute('x', String(r.x));
			hit.setAttribute('y', String(r.y));
			hit.setAttribute('width', String(r.w));
			hit.setAttribute('height', String(r.h));
		};
		// D31: in `down` the tap area hangs below its card; `sideways` hit areas already do (WP5.5a).
		const down = laid.layout.orientation !== 'sideways';
		for (const t of this.scene?.tags ?? []) place(t.hit, down ? tagHitBelow(t.tag.hit, laid.layout.persons.get(t.tag.person), view.scale) : enlargeHit(t.tag.hit, view.scale));
		// The same for the `+` badges of focus mode (spec §7.5).
		for (const b of this.scene?.badges ?? []) place(b.hit, b.card ? badgeHitInCard(b.mark, b.card, view.scale, laid.layout.geometry.fontPx) : badgeHit(b.mark, view.scale, laid.layout.geometry.fontPx));
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
			let el = vp.querySelector<HTMLElement>(`:scope > .dynasty-hint-${dir}`);
			const n = counts[dir];
			if (!n) {
				el?.remove();
				continue;
			}
			if (!el) {
				el = vp.createDiv({ cls: ['dynasty-hint', `dynasty-hint-${dir}`] });
				this.paintCalloutBg();
			}
			el.setText(HINT_UI[dir](n));
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
		const st = this.blockState();
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
		// A `+` badge refocuses on its person and opens no sheet (spec §5.6).
		for (const b of scene.badges) {
			const act = (e: Event) => {
				e.preventDefault();
				e.stopPropagation();
				// D21: a static touch embed does not change; the full-screen view opens on that family.
				this.guard(() => (!this.full && this.coarse ? void this.openFull(null, b.person) : this.focusOn(b.person)));
			};
			b.el.addEventListener('click', act);
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
				here: (person) => TreeView.focusState(this.host, h.state, person),
				changed: () => TreeView.redrawState(this.host, h.state, null, null, null, true),
				pinning: () => TreeView.dropOwnFocus(this.host, h.state),
			},
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
		});
		if (!sheet) {
			new Notice(WRITE_TEXT.invalid);
			return;
		}
		sheet.open();
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
			onClosed: () => TreeView.refocusHouses(this.host, st, full),
		});
		win?.open();
	}

	/**
	 * The Houses window closed: the focus goes back to the Houses button (spec §5.2). After a write
	 * Obsidian can draw the block again a little later, and the button the focus went back to is then
	 * gone: look again for a short time, but never take the focus from somewhere the user put it.
	 */
	private static refocusHouses(host: TreeHost, st: BlockState, full: boolean, step = 0): void {
		let button: HTMLElement | null = null;
		for (const v of host.views) {
			if (v.unloaded || !!v.full !== full || v.blockState() !== st) continue;
			const b = v.viewport?.querySelector<HTMLElement>('.dynasty-houses-button') ?? null;
			if (b?.isConnected) button = b;
		}
		const doc = button?.doc ?? document;
		const active = doc.activeElement as HTMLElement | null;
		const free = !active || active === doc.body || !active.isConnected || !!active.closest?.('.dynasty-houses-button');
		if (button && free && active !== button) button.focus();
		const wait = [150, 600][step];
		if (wait !== undefined) (doc.defaultView ?? window).setTimeout(() => TreeView.refocusHouses(host, st, full, step + 1), wait);
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
		const resizable = !this.full && !readOnly && !this.coarse && !this.blocked && !!this.handle && !this.phoneHeight();
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
			if (!d.moved || h === null || h === this.optionsHeight) return;
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
		this.showPerson(id);
	}

	/** Expand (spec §6.10, §7.1): the same block, handle and view state in a full-screen modal. */
	private async openFull(target: string | null, focus: string | null = null): Promise<void> {
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
		};
		new FullScreenModal(this.host, from, target, this.containerEl, focus).open();
	}

	/** Find (spec §6.10): the picker with every person; centres and highlights the choice, no focus mode. */
	private async find(): Promise<void> {
		const g = this.whole;
		if (!g) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false);
		if (picked?.kind !== 'person' || this.unloaded) return;
		// Find never enters focus mode (spec §6.10); a person outside the focus family is shown in the whole tree.
		this.guard(() => {
			if (this.laid?.layout.persons.has(picked.id)) this.showPerson(picked.id);
			else this.focusOn(null, [picked.id]);
		});
	}

	/** Toolbar Focus (spec §5.6, §6.6): the picker with every person of the whole tree, and no "Create" row. */
	private async pickFocusPerson(): Promise<void> {
		const g = this.whole;
		if (!g) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FOCUS_UI.pickerPlaceholder, FOCUS_UI.pickerTitle, false);
		if (picked?.kind !== 'person' || this.unloaded) return;
		this.guard(() => this.focusOn(picked.id));
	}

	/** Centres the view on a person and highlights the card briefly (spec §5.3, D10). */
	showPerson(id: string, others: string[] = []): void {
		const box = this.laid?.layout.persons.get(id);
		const pz = this.panZoom;
		if (!box || !pz?.view || !this.laid) return;
		const target = this.centreFree(centreOn(pz.view, box, this.laid.layout.geometry.fontPx));
		pz.setView(target, { animate: true, byUser: true });
		this.highlight([id, ...others]);
	}

	/**
	 * In the full-screen view a person is centred in the free area between the toolbar bands (the
	 * phone's bottom bar and top safe area, the desktop toolbar), not in the whole viewport, so the
	 * card and its neighbours do not sit under a toolbar (WP4.3).
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
		for (const id of ids) {
			const card = this.scene?.cards.get(id);
			if (!card) continue;
			card.removeClass('dynasty-highlight');
			// Restart the animation when the same card is highlighted again.
			void card.getBoundingClientRect();
			card.addClass('dynasty-highlight');
			const t = win.setTimeout(() => {
				this.timers.delete(t);
				card.removeClass('dynasty-highlight');
			}, HIGHLIGHT_MS);
			this.timers.add(t);
		}
	}

	private buildToolbar(viewport: HTMLElement, issues: CodedIssue[]): void {
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
			// Arrows inward, "the whole tree in view": a magnifier next to Find looked the same (phone bar).
			const fit = button('shrink', UI.fit, 'dynasty-fit');
			fit.addEventListener('click', () => this.guard(() => this.fit()));
			const legend = button('info', UI.legend, 'dynasty-legend-button');
			legend.addEventListener('click', () => this.guard(() => this.toggleLegend(legend)));
		}
		if (issues.length) {
			const badge = button('alert-triangle', problemsLabel(issues.length), 'dynasty-warning-badge');
			badge.createSpan({ cls: 'dynasty-warning-count', text: String(issues.length) });
			badge.addEventListener('click', () => this.guard(() => this.toggleProblems(badge, issues)));
		}
		if (this.full) this.closeButton(bar);
		else {
			// Corner brackets read as "full screen"; Fit uses shrink (the decision notes WP1.4, M4).
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

	/** Closes an open popover (legend, partner list, problems) with the focus back on its opener; false if none was open. */
	closePopover(): boolean {
		const pop = this.popover;
		if (!pop?.isOpen) return false;
		pop.close(true);
		return true;
	}

	private toggleLegend(opener: HTMLElement): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'legend') {
			pop.close();
			return;
		}
		pop.open(
			'legend',
			(el) => {
				el.createDiv({ cls: 'dynasty-popover-title', text: UI.legendTitle });
				buildLegend(el.createDiv({ cls: 'dynasty-legend' }));
			},
			opener,
		);
	}

	private toggleProblems(opener: HTMLElement, issues: CodedIssue[]): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'problems') {
			pop.close();
			return;
		}
		const persons = this.laid?.layout.persons;
		const whole = this.whole;
		pop.open(
			'problems',
			(el) => {
				const c = buildCallout(el, 'warning', problemsTitle(issues.length), 'dynasty-problems');
				// In focus mode a problem can be about people who are not drawn: like Find, the button then shows all people (spec §6.10).
				const shown = issues.map((i) => ({ issue: i, people: (i.ids ?? []).filter((id) => whole?.byId.has(id) && (persons?.has(id) || this.focusId !== null)) }));
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
							if (people.every((id) => persons?.has(id))) this.showPerson(people[0], people.slice(1));
							else this.focusOn(null, people);
						});
					});
				}
			},
			opener,
		);
	}
}

/**
 * Puts the given elements first in `bar`, in this order, moving only what is out of place: a move
 * takes the keyboard focus from a button.
 */
function orderFirst(bar: HTMLElement, els: (HTMLElement | null)[]): void {
	const want = els.filter((e): e is HTMLElement => !!e);
	const now = Array.from(bar.children).slice(0, want.length);
	if (want.every((e, i) => now[i] === e)) return;
	for (let i = want.length - 1; i >= 0; i--) bar.prepend(want[i]);
}
