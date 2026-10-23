/*
 * `TreeView` is the plugin's core Obsidian class: one instance draws and runs one `kin` code
 * block, as an embed in a note or inside the full-screen modal. `main.ts` creates an embed's
 * `TreeView` from the Markdown code block processor; `full-screen.ts` creates a second one, sharing
 * the same block handle and view state, when the user expands a tree. A `TreeView` parses the
 * block's text (`core/parse`), derives the family graph (`core/derive`), lays it out
 * (`layout/index`), and draws it as SVG (`render/dom/scene`), then wires pan and zoom
 * (`render/dom/pan-zoom`), the toolbar, sheets and popovers on top of it. It never lets an error
 * escape into Obsidian or blank the note (spec §8): every entry point runs through `guard`.
 *
 * Since 0.3.3 (WP-1 A1) the class is a chain of layers, one file for each concern, from the bottom:
 * - `tree-view-base.ts` `TreeViewBase`: the host contract, every field, the open timing, the block's memory and the cross-view calls (`focusState`,
 *   `redrawState`, `listGo`, `showFinder`, `changeFolds` ...). The layers above call members of each other; a call to a layer above is an `abstract` method here.
 * - `tree-view-lifecycle.ts`: load and unload, settings, theme, fonts, `guard`, the start-up wait and the kept height.
 * - `tree-view-placement.ts`: sizes, bars kept free, the direction (D24), resize and the first views.
 * - `tree-view-scene.ts`: content on demand, the idle chain, the presses and keys, reveal and highlight (the "Card content on demand" notes are in its header).
 * - `tree-view-pictures.ts`: picture links, live pictures, the file check and the saved picture.
 * - `tree-view-toolbar.ts`: the toolbar, its menus and the edit controls.
 * - `tree-view-actions.ts`: the windows of a person, Titles and Houses, Expand, folds and focus.
 * - `tree-view-finder.ts`: the relation finder's bar and the Show view's bar.
 * - `tree-view-list.ts`: the phone list, the empty block and the bar of a very large tree.
 * - this file: the render pipeline (`render` applies what `planRender` returns and builds the DOM of the plan), and the exports other files use.
 * Shared types and constants are in `tree-view-types.ts`. The block's binding to the note is `block-binding.ts`; the decisions of a render are
 * `view/render-plan.ts`.
 */

import { setIcon } from 'obsidian';
import type { FamilyGraph } from '../core/derive';
import type { HardError } from '../core/messages';
import { hardErrorText } from '../core/messages';
import type { CardLabel } from '../core/titles';
import type { ParseResult } from '../core/types';
import { LayoutStopped } from '../layout/index';
import type { Geometry, LaidOut, LayoutSettings, Orientation } from '../layout/model';
import type { FontState } from '../render/fonts';
import { clearMeasureCache, measureText } from '../render/dom/measure';
import { readFonts } from '../render/dom/page-reads';
import { wireCardTips } from '../render/dom/card-tip';
import { PanZoom } from '../render/dom/pan-zoom';
import { FILL_ALL_EVENT, buildScene, lodClass, type SceneOptions } from '../render/dom/scene';
import { sameTall } from '../render/dom/tall-cards';
import { parseBreakList } from '../render/break-words';
import { buildCallout, Popover } from '../render/dom/widgets';
import type { RenderTiming } from '../render/tree-info';
import { FOCUS_UI, FULL_UI, UI } from '../render/ui-text';
import { treeBounds } from '../render/view-math';
import { START_LIMIT_MS, STYLES_LIMIT_MS } from './block-binding';
import { newBlockState, type BlockState } from '../view/block-state';
import type { FoldRef } from '../render/dom/folds';
import { askInGroups, drawBudget, rememberStop, wasStopped } from '../view/large-tree';
import { measuredLayout, type MeasuredResult } from '../view/measured-layout';
import { relationsFor, type TreeRelations } from '../view/relation-cache';
import { planRender, type RenderInputs, type StateChanges, type TreePlan } from '../view/render-plan';
import { foldLabel, lineMarks } from '../view/tree-view-helpers';
import { BIG_TREE_CLASS, keepsStandingLayer } from './move-layer';
import { TreeViewList } from './tree-view-list';
import type { ViewHost } from './tree-view-base';
export { HOVER_SOURCE, OPEN_GAP_MS, THEME_RECHECK_MS } from './tree-view-types';
export type { FullHost, FullSource, OpenTime, ViewPlace } from './tree-view-types';

/** What a render of a tree carries from `render` into the methods that draw it. */
interface DrawContext {
	/** The start of the render, for the timing. */
	t0: number;
	/** The start of the time budget: the render, or the tap that asked for the draw. */
	clockFrom: number;
	orientation: Orientation;
}

/** The parts of the DOM of a tree that the other parts of the draw build into. */
interface TreeFrame {
	root: HTMLElement;
	viewport: HTMLElement;
	canvas: HTMLElement;
	sceneEl: SVGGElement;
}

export { START_LIMIT_MS, STYLES_LIMIT_MS };

/** What a tree view needs from the plugin. The views of the host are `TreeView`s. */
export interface TreeHost extends ViewHost {
	readonly views: Set<TreeView>;
}

/**
 * One rendered `kin` block. It never throws into Obsidian: every entry point catches and,
 * at worst, shows the internal-error box (spec §8).
 */
export class TreeView extends TreeViewList {
	/** The fields that a render starts from: nothing of the old draw is left. */
	protected resetDrawn(): void {
		this.emptyEl = null;
		this.errorBox = null;
		this.large = null;
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
	}

	/** What `planRender` reads (`view/render-plan.ts`): the parse and the facts of this view; it changes none of it. */
	protected renderInputs(parsed: ParseResult, orientation: Orientation, fontsOverride: FontState | null): RenderInputs {
		return {
			parsed,
			settings: this.settings,
			// A block with no memory yet reads a fresh one; the memory is made in `applyChanges`, only when a tree or a bar is drawn.
			state: this.peekState() ?? newBlockState(),
			coarse: this.coarse,
			phone: this.isPhone(),
			full: this.full ? { focus: this.full.focus, target: this.full.target } : null,
			orientation,
			pendingTarget: this.pendingTarget,
			stopChecked: this.stopChecked,
			stopped: (count) => wasStopped(this.key, count, this.source),
			fonts: () => fontsOverride ?? readFonts(this.containerEl),
			clock: () => performance.now(),
			dates: this.readerOf(parsed),
		};
	}

	/** Applies the changes that `planRender` asked for to the block's memory and to this view, and returns the block's memory. */
	protected applyChanges(c: StateChanges): BlockState {
		const st = this.ensureState();
		Object.assign(st, c.block);
		const finder = st.finder;
		if (finder && c.finderIndex !== undefined) finder.index = c.finderIndex;
		if (finder && c.finderWhole) finder.whole = true;
		if (c.fullFocus && this.full) this.full.focus = c.fullFocus;
		if (c.pendingTarget) this.pendingTarget = c.pendingTarget;
		if (c.stopChecked) this.stopChecked = true;
		return st;
	}

	/** Draws the block again. The decisions are in `planRender`; this applies its changes and builds the DOM of the plan. */
	protected render(fontsOverride: FontState | null): void {
		this.binding.waiting = false;
		this.foldsStale = false;
		this.teardown();
		this.listMode = false;
		const el = this.containerEl;
		el.empty();
		this.resetDrawn();
		// D24: sideways on a phone in portrait. Set first, so a block with no tree follows a turn too.
		const orientation = this.orientationNow();
		this.orientation = orientation;
		const t0 = performance.now();
		// Spec §7.7 (time budget): the time budget counts from the start of this render, or from the tap that asked for it. Read at once, so a stale tap never counts later.
		const clockFrom = this.budgetFrom ?? t0;
		this.budgetFrom = null;
		const { plan, stateChanges } = planRender(this.renderInputs(this.parse(this.source), orientation, fontsOverride));
		if (plan.kind === 'invalid-full') {
			// No tree comes of this open: the next open of the full-screen view is a new wait.
			this.dropOpen();
			this.full?.close(FULL_UI.invalid);
			return;
		}
		if (plan.kind === 'error') {
			this.renderError(el, plan.error, orientation);
			return;
		}
		if (plan.kind === 'empty') {
			this.dropOpen();
			this.renderEmpty(el, plan.whole);
			return;
		}
		if (plan.kind === 'list') {
			this.renderList(el, plan.tree, plan.whole, t0, plan.t1);
			return;
		}
		const st = this.applyChanges(stateChanges);
		if (plan.kind === 'bar') this.renderBar(el, plan.tree, plan.whole, plan.bar, plan.barCount, orientation);
		else this.drawTree(el, plan, { t0, clockFrom, orientation });
		if (stateChanges.sessionChanged) TreeView.redrawState(this.host, st, { except: this });
	}

	/** The text of the block cannot be read: the error box stands in place of a tree. */
	protected renderError(el: HTMLElement, error: HardError, orientation: Orientation): void {
		this.laid = null;
		this.dropOpen();
		const box = buildCallout(el, 'error', UI.errorTitle, 'dynasty-error', setIcon);
		box.root.setAttribute('data-dynasty-orientation', orientation);
		box.content.createDiv({ cls: 'dynasty-error-detail', text: hardErrorText(error, this.source) });
		this.errorBox = box.content;
		this.updateEditUi();
		this.watchLate(box.root, () => this.updateEditUi());
	}

	/** Lays the planned tree out. Null when the time budget stopped it: the bar with no button then stands in place of the tree. */
	protected layOutPlan(el: HTMLElement, plan: TreePlan, rel: TreeRelations | null, c: DrawContext): MeasuredResult | null {
		// Spec §7.7 (time budget): the draw of a whole tree stops before its next phase when it passes the budget.
		const stop = plan.budget ? drawBudget(c.clockFrom) : undefined;
		let result: MeasuredResult;
		try {
			result = this.layOut(plan.g, plan.geo, plan.laidBase, plan.fonts, plan.labels, plan.foldPlan.hidden, stop);
			// WP-K: the names of the cards that are drawn, in one request (all cards of the whole tree, the people of a focus family); the scene reads each from the lookup.
			// Spec §7.7 (time budget): the request of a whole tree is cut into groups, with the time check between them.
			if (rel) askInGroups((ids) => rel.cards.getMany(ids), result.laid.layout.persons.keys(), stop);
		} catch (e) {
			if (!(e instanceof LayoutStopped)) throw e;
			// Spec §7.7 (time budget): the draw passed its time budget before its next phase. Nothing of it was cached; the bar with no button stays until the tree text changes.
			rememberStop(this.key, plan.count, this.source);
			this.renderBar(el, plan.tree, plan.whole, plan.onStop, plan.count, c.orientation);
			return null;
		}
		// D51: on an upright phone the small tree is also laid out top to bottom. The first view, which
		// knows the free area between the result bar and the toolbar, draws the direction with larger names.
		const alt = plan.alt;
		this.finderAlt = alt ? { ...this.layOut(plan.g, alt.geo, alt.base, plan.fonts, plan.labels, plan.foldPlan.hidden), geo: alt.geo } : null;
		return result;
	}

	/** Takes the planned tree and its layout as the drawn one. */
	protected adoptDrawn(plan: TreePlan, laid: LaidOut): void {
		// A view of one family means nothing in another: the new family gets its own first view.
		if (this.familyKey !== null && this.familyKey !== plan.familyKey) this.carry = null;
		this.familyKey = plan.familyKey;
		this.drawnKey = plan.drawnKey;
		this.focusId = plan.focusId;
		this.focusStale = false;
		this.g = plan.g;
		this.whole = plan.whole;
		this.laid = laid;
		this.fonts = plan.fonts;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.optionsStart = plan.tree.options.start;
		this.optionsHeight = plan.tree.options.height;
		this.lod = null;
		// O2: the picture warnings that need no file read go on the first badge.
		this.textIssues = plan.whole.issues;
		this.resolvePictures(plan.whole);
	}

	/** Draws the planned tree: the layout, the DOM, the pan and zoom, and the timing of the render. */
	protected drawTree(el: HTMLElement, plan: TreePlan, c: DrawContext): void {
		this.meId = plan.me;
		this.successionDrawn = plan.succession;
		this.finderDrawn = plan.finder;
		this.foldPlan = plan.foldPlan;
		// Spec §13.1: the names are kept per tree and mark (relation-cache.ts). Their time counts in the §7.7 time: it is in the layout part.
		const rel = plan.relationsFor !== null ? relationsFor(plan.whole, plan.relationsFor, this.relationOptions, this.key) : null;
		const result = this.layOutPlan(el, plan, rel, c);
		if (!result) return;
		const t2 = performance.now();
		this.adoptDrawn(plan, result.laid);
		const frame = this.buildFrame(el, plan, c.orientation);
		this.buildTreeScene(frame, plan, result, rel);
		this.buildTreeControls(frame, plan);
		const t3 = performance.now();
		const open = this.account(c.t0, plan.t1, t2, t3);
		const timing: RenderTiming = {
			path: this.sourcePath,
			people: plan.g.people.length,
			...(plan.sub ? { of: plan.whole.people.length } : {}),
			...open.parts,
			...(this.full ? { full: true } : {}),
		};
		this.timing = { t0: open.start, t: timing };
		this.host.recordTiming(timing);
	}

	/** D285: the canvas of a tree with very many cards keeps no standing layer (`move-layer.ts`); the style sheet reads the class. */
	protected markBigTree(canvas: HTMLElement): void {
		const big = !keepsStandingLayer(this.laid?.layout.persons.size ?? 0);
		if (canvas.hasClass(BIG_TREE_CLASS) !== big) canvas.toggleClass(BIG_TREE_CLASS, big);
	}

	/** The root, the banner, the viewport and the empty svg of a tree. */
	protected buildFrame(el: HTMLElement, plan: TreePlan, orientation: Orientation): TreeFrame {
		const { whole, finder, succession } = plan;
		const root = el.createDiv({ cls: 'dynasty-root', attr: { 'data-dynasty-people': String(plan.g.people.length), 'data-dynasty-section': this.binding.sectionNote, 'data-dynasty-orientation': orientation } });
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
		this.markBigTree(canvas);
		const svg = canvas.createSvg('svg', { cls: 'dynasty-svg', attr: { width: '100%', height: '100%' } });
		// S7: the browser lays the tree out only when its first view is written (`firstDraw`); until then it takes no style or
		// layout time. The wrapper hides, not the svg: the colour rule allows no inline `display`, and the svg is its only child.
		canvas.hidden = true;
		this.canvasEl = canvas;
		this.svg = svg;
		// The layout clamps the font size; the card text must use the size the layout used.
		svg.style.setProperty('--dynasty-font-size', `${plan.geo.fontPx}px`);
		// Obsidian's aria-label tooltips work only on HTML elements and fail on SVG ones. The CSS
		// turns them off with --no-tooltip; this also covers versions without that switch.
		svg.addEventListener('pointerover', (e) => e.stopPropagation());
		const sceneEl = svg.createSvg('g', { cls: 'dynasty-scene' });
		// S5c: a card gets its content before the browser scrolls to it. `focus` does not bubble; the capture phase sees it first.
		// The listener is on the HTML wrapper: Chromium makes an SVG element that has a focus listener a Tab stop of its own.
		canvas.addEventListener('focus', (e) => this.guard(() => this.fillFocused(e.target)), true);
		return { root, viewport, canvas, sceneEl };
	}

	/** The scene of the tree: the options, the cards, the tips and the live pictures. */
	protected buildTreeScene(frame: TreeFrame, plan: TreePlan, result: MeasuredResult, rel: TreeRelations | null): void {
		const { root, viewport, sceneEl } = frame;
		const { me, finder, succession, labels, sub } = plan;
		const breaks = this.breakList();
		const opts: SceneOptions = {
			lazyCards: true,
			fonts: plan.fonts,
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
			...(plan.canFold ? { folds: { buttons: true, label: foldLabel, lazy: true, wire: (f: FoldRef) => this.wireFoldHit(f) } } : {}),
		};
		this.scene = buildScene(sceneEl, plan.g, result.laid, opts);
		this.lastLayout = { geo: plan.geo, settings: result.settings, sceneEl, opts };
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
	}

	/** The toolbar, the bars, the card presses, the pan and zoom and the observers of a tree. */
	protected buildTreeControls(frame: TreeFrame, plan: TreePlan): void {
		const { root, viewport, canvas } = frame;
		const { finder, succession, sub, focus, whole } = plan;
		this.popover = new Popover(viewport);
		this.buildToolbar(viewport);
		if (finder) this.buildResultBar(viewport, canvas, finder, whole);
		if (succession) this.buildSuccessionBar(viewport, canvas, succession);
		// One bar at a time (G2 S3): both bars stand at the same place at the top, so a finder result that draws no line ("not related") would be covered by the focus bar and its Close could not be reached.
		if (sub && focus !== null && !finder) this.buildFocusBar(viewport, canvas, whole.byId.get(focus)?.name || focus);
		this.wireCardPresses(viewport);
		this.updateEditUi();
		this.panZoom = this.makePanZoom(frame, plan.geo);
		this.fontProbe = root.createDiv({ cls: 'dynasty-font-probe' });
		// Only the full-screen view reads the safe area (its toolbar can be at the bottom).
		if (this.full) this.safeProbe = root.createDiv({ cls: 'dynasty-safe-probe' });
		// D28: the hint labels stay in the tree, hidden until a first view counts children outside the box.
		if (this.orientation === 'sideways') for (const dir of ['up', 'down']) viewport.createDiv({ cls: 'dynasty-hint-slot', attr: { 'data-dir': dir } });
		this.observer = new ResizeObserver(() => this.guard(() => this.resized()));
		this.observer.observe(viewport);
		// A banner that grows (the steps open, a long sentence wraps) takes room from the drawing area below it without a change of the box.
		if (viewport.hasClass('is-flow')) for (const bar of Array.from(viewport.querySelectorAll<HTMLElement>(':scope > .dynasty-toolbar, :scope > .dynasty-result'))) this.observer.observe(bar);
	}

	protected makePanZoom(frame: TreeFrame, geo: Geometry): PanZoom {
		return new PanZoom({
			viewport: frame.viewport,
			scene: frame.sceneEl,
			wrapper: frame.canvas,
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
				// D285: a new level changes the signs of every control, but the tap areas are placed only near the view.
				if (this.applyLod(v)) {
					this.refreshSignBoosts(v);
					this.placeFolds(v, this.foldsDue(v));
				}
				this.fillFolds(v);
				this.fillNear(v);
			},
			onFirstDraw: (v) => this.firstDraw(v),
			guard: (fn) => this.guard(fn),
			// D222: only the full-screen view keeps a small tree between its bars (the values are cached by `measureInsets`).
			...(this.full
				? {
						freeArea: () => ({ top: this.insetTop, bottom: this.insetBottom }),
						// A bar can change height without a resize; one read per drag, never per move.
						onDragStart: () => {
							if (this.viewport) this.measureInsets(this.viewport);
						},
					}
				: {}),
		});
	}

	/** Static touch embed (D1) or full-screen view: CSS decides the gestures and the toolbar place from these. */
	protected placeClasses(root: HTMLElement): void {
		if (this.full) root.addClass('dynasty-full');
		else if (this.coarse) root.addClass('dynasty-static');
	}

	/**
	 * Lays `g` out with its text measured first and its picture sets (`measuredLayout`): a name or a
	 * title text line that needs two text lines makes its card taller (D29, D37, D61); a card with arms
	 * measures its name beside them, and the portrait room follows "Show portraits on cards" (spec
	 * §13.6, §13.7, O10). "Show dates on cards" off leaves the reign out.
	 */
	protected layOut(
		g: FamilyGraph,
		geo: Geometry,
		base: LayoutSettings,
		fonts: SceneOptions['fonts'],
		labels?: ReadonlyMap<string, CardLabel>,
		foldHidden?: ReadonlySet<string>,
		shouldStop?: () => boolean,
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
		}, shouldStop);
	}

	/** The user's break places (D118); `parseBreakList` keeps the last text, so this costs nothing when the setting is the same. */
	protected breakList(): ReturnType<typeof parseBreakList> {
		return parseBreakList(this.settings.breakWords);
	}

	/** Draws a new layout of the note preview in place (D29): the viewport, toolbar and observers stay. */
	protected redraw(g: FamilyGraph, laid: LaidOut): void {
		const last = this.lastLayout;
		if (!last || !this.panZoom) return;
		this.laid = laid;
		this.bounds = treeBounds(laid.layout.width, laid.layout.height);
		this.panZoom.setBounds(this.bounds);
		if (this.canvasEl) this.markBigTree(this.canvasEl);
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
	protected recheckTall(fresh = false): boolean {
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
}
