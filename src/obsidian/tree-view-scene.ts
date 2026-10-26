/*
 * The drawn scene (0.3.3, WP-1 A1): the cards, tags, fold controls and badges of the scene after it is built. It fills their content on demand, wires the
 * presses and keys, and moves and highlights the view to a card. Fourth layer of the chain listed in `tree-view.ts`.
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

import { Keymap, getLinkpath } from 'obsidian';
import type { Person } from '../core/types';
import { FOLD_EM } from '../layout/fold-spots';
import type { LaidOut, Rect } from '../layout/model';
import { visibleRect } from '../render/dom/pan-zoom';
import { discPath, type CardLink, type Scene } from '../render/dom/scene';
import { SIGN_CARD_LABEL, cardLabel, linkTarget } from '../render/tree-info';
import { HINT_UI } from '../render/ui-text';
import { centreOn, isPan, foldHit, type View } from '../render/view-math';
import { outsideBox, tagHitBelow, tagHitSide, tagNextTops } from '../view/focus-mode';
import { cutBack } from '../view/fold-view';
import type { FoldRef } from '../render/dom/folds';
import { pluginModalOpen } from '../view/plugin-modals';
import { cardPosition } from '../view/succession-view';
import { TreeViewPlacement } from './tree-view-placement';
import { viewCard } from './viewer-sources';
import { TreeViewBase } from './tree-view-base';
import { HIGHLIGHT_MS, HOVER_SOURCE } from './tree-view-types';
import { hintSide } from './hint-place';
import { later } from '../view/idle';

/** The most cards attached in one idle chunk. */
const IDLE_CARDS_PER_CHUNK = 25;

/** An idle chunk stops when the idle callback has less than this many ms left. */
const IDLE_STOP_MS = 4;

/** The least size of the text of an Overview fold sign on the screen, in px, and the most it grows. */
const MIN_SIGN_TEXT_PX = 11;

const MAX_SIGN_BOOST = 8;

/** Writes the four numbers of a rectangle, each only when it changes: a write of the same value still restyles the element (D285). */
function setRect(el: Element, r: Rect): void {
	const x = String(r.x);
	const y = String(r.y);
	const w = String(r.w);
	const h = String(r.h);
	if (el.getAttribute('x') !== x) el.setAttribute('x', x);
	if (el.getAttribute('y') !== y) el.setAttribute('y', y);
	if (el.getAttribute('width') !== w) el.setAttribute('width', w);
	if (el.getAttribute('height') !== h) el.setAttribute('height', h);
}

/** True when two lists of tap areas hold the same rectangles in the same order. */
function sameRects(a: readonly Rect[], b: readonly Rect[]): boolean {
	return a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h);
}

/** The scene of a drawn tree: content on demand, the idle chain, the presses and keys, and the moves of the view to a card. */
export abstract class TreeViewScene extends TreeViewPlacement {
	/** The layout, scene and zoom that `tapAreas` and the tag and badge tap areas were placed for (`placeTapAreas`). */
	private tapFor: { laid: LaidOut; scene: Scene; scale: number } | null = null;
	/** Counts the new sets of `tapAreas`; a fold control placed for an older set is placed again when it is near the view. */
	private tapEpoch = 0;
	/** What each fold control was placed for: the level, the zoom and the set of cut-back areas. */
	private readonly foldStamp = new WeakMap<FoldRef, string>();
	/** The scene, level and zoom that the sizes of the Overview signs were last set for (`refreshSignBoosts`). */
	private boostFor: { scene: Scene; lod: string | null; scale: number } | null = null;

	/**
	 * Starts the pulse of the cards in the frame after the one that writes the new view (D235): it must start after the card is drawn in its new place. The frame
	 * of the pan and zoom is asked for first, and frames run in the order they were asked for. A new call or a redraw replaces the one that waits.
	 */
	protected pulse(ids: string[]): void {
		this.cancelPulse();
		const win = this.containerEl.win;
		const scene = this.scene;
		this.pulseFrame = win.requestAnimationFrame(() => {
			this.pulseFrame = 0;
			this.guard(() => {
				if (this.scene === scene) this.highlight(ids);
			});
		});
	}

	protected cancelPulse(): void {
		if (this.pulseFrame) this.containerEl.win.cancelAnimationFrame(this.pulseFrame);
		this.pulseFrame = 0;
	}

	/** The handler of a press or key on a fold control. */
	protected foldAct(f: FoldRef): (e: Event) => void {
		return (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			// I37: only a key press gets its fold control back with the keyboard focus after the redraw; a tap or a click leaves no focus ring on it.
			this.foldByKey = e.type === 'keydown' || (e as MouseEvent).detail === 0;
			this.guard(() => this.toggleFold(f.control));
		};
	}

	/** Wires the tap area of a control; the scene calls it once, when the control is filled. */
	protected wireFoldHit(f: FoldRef): void {
		const hit = f.hit;
		if (!hit) return;
		// The level of detail hides an open button and its tap area together (styles.css).
		hit.addClass(f.control.folded ? 'is-folded' : 'is-open');
		hit.addEventListener('click', this.foldAct(f));
		hit.addEventListener('pointerenter', () => f.el.addClass('is-hover'));
		hit.addEventListener('pointerleave', () => f.el.removeClass('is-hover'));
	}

	/**
	 * The test for "near the view" of the fold controls: within one screen of the view's centre on each side. The fill and the placing of the tap areas use
	 * the same window. Null when the view has no size yet.
	 */
	protected foldWindow(view: View): ((f: FoldRef) => boolean) | null {
		const vp = this.viewport;
		if (!vp || view.scale <= 0) return null;
		const area = this.panZoom?.size ?? { w: vp.clientWidth, h: vp.clientHeight };
		const w = area.w / view.scale;
		const h = area.h / view.scale;
		return (f) => Math.abs(f.control.spot.x - view.cx) <= w && Math.abs(f.control.spot.y - view.cy) <= h;
	}

	/**
	 * Gives the open controls near `view` their drawing and tap area (they start as empty shells: 600 extra
	 * elements slowed the first view by 12 %). The rest follow in idle chunks, so a pan never meets an empty control.
	 * Only the controls that it fills get their tap area placed here (D285: a pass over all of them at each settle cost seconds on a very large tree).
	 */
	protected fillFolds(view: View): void {
		const scene = this.scene;
		const near = this.foldWindow(view);
		if (!scene || !near) return;
		const filled: FoldRef[] = [];
		for (const f of scene.folds) {
			if (f.filled || !near(f)) continue;
			f.fill();
			filled.push(f);
		}
		if (filled.length) this.placeFolds(view, filled);
	}

	/** Fold controls or card content still wait for the idle chain. A static phone preview has no idle fill of cards (S5g). */
	protected idleWork(scene: Scene): boolean {
		return scene.folds.some((f) => !f.filled) || ((!!this.full || !this.coarse) && (scene.fill.pending > 0 || scene.fill.pendingLines > 0));
	}

	/**
	 * S5g: starts the one idle chain of the scene after its first view has been drawn and had its frames (the same
	 * moment as the pictures). A chain that already runs for this scene is left alone.
	 */
	protected startIdleSoon(): void {
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

	protected startIdle(scene: Scene): void {
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
				const made: FoldRef[] = [];
				for (const f of scene.folds) {
					if (f.filled) continue;
					f.fill();
					made.push(f);
					if (made.length >= 40 || idle.timeRemaining() < IDLE_STOP_MS) break;
				}
				const v = pz?.view;
				if (made.length) {
					// D285: only the controls of this chunk are placed; a pass over all filled controls in every chunk was quadratic.
					if (v) this.placeFolds(v, made);
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
	protected fillNear(view: View): void {
		this.learnRadius();
		const pz = this.panZoom;
		const scene = this.scene;
		if (!pz || !scene) return;
		const rect = visibleRect(view, pz.size);
		if (rect) scene.fill.fillNear(rect);
		this.syncPending();
	}

	/** The content of one person's card, badge and tags now (S5c to S5f): before a focus, a highlight, a reveal or the sheet. */
	protected fillPerson(id: string): void {
		this.learnRadius();
		this.scene?.fill.fillPerson(id);
		this.syncPending();
	}

	/** T1: the root tells the harness how many cards, tags and badges wait for their content. */
	protected syncPending(): void {
		const root = this.viewport?.parentElement;
		const scene = this.scene;
		if (!root || !scene) return;
		const n = String(scene.fill.pending);
		if (root.getAttribute('data-dynasty-cards-pending') !== n) root.setAttribute('data-dynasty-cards-pending', n);
		const lines = String(scene.fill.pendingLines);
		if (root.getAttribute('data-dynasty-lines-pending') !== lines) root.setAttribute('data-dynasty-lines-pending', lines);
	}

	/** S7: the tree's svg shows. Safe to repeat and never throws, so that an error path can call it. */
	protected showTree(): void {
		try {
			if (this.canvasEl) this.canvasEl.hidden = false;
		} catch {
			// A tree that stays hidden is worse than any message; nothing else to do here.
		}
	}

	/** S5a: the first write of the scene transform is done: the cards near the view get their content, then the tree shows. */
	protected firstDraw(view: View): void {
		try {
			this.fillNear(view);
		} finally {
			this.showTree();
		}
	}

	/**
	 * F7: the tap areas of the fold controls at `view`'s zoom: 44 screen px, centred on the mark that shows at the
	 * level (the Overview sign is larger), and cut back where they meet a far-couple tag or a `+` badge. A card wins
	 * over a tap area by its place in the hit layer. `which` is the set of controls to place (all by default). Each placed control
	 * keeps the zoom, the level and the cut-back areas it was placed for (`foldStamp`), so `foldsDue` can find the ones that need a new place.
	 */
	protected placeFolds(view: View, which: Iterable<FoldRef> = this.scene?.folds ?? []): void {
		const overview = this.lod === 'overview';
		const fontPx = this.laid?.layout.geometry.fontPx ?? 0;
		const stamp = `${this.lod}|${view.scale}|${this.tapEpoch}`;
		for (const f of which) {
			// An unfilled control has no tap area yet; `fillFolds` places it after it fills.
			if (!f.filled || !f.hit) continue;
			let visible = overview && f.markOverview ? f.markOverview : f.mark;
			const boost = this.signBoost(view, f, overview, fontPx);
			const { x: sx, y: sy } = f.control.spot;
			this.setSignBoost(f, boost);
			if (boost > 1) visible = { x: sx + (visible.x - sx) * boost, y: sy + (visible.y - sy) * boost, w: visible.w * boost, h: visible.h * boost };
			const r = cutBack(foldHit(visible, view.scale, fontPx), visible, this.tapAreas);
			setRect(f.hit, r);
			this.foldStamp.set(f, stamp);
		}
	}

	/** The Overview sign keeps a readable size on screen: it grows about its spot (its left edge stays), like the hit areas. 1 for every other mark. */
	private signBoost(view: View, f: FoldRef, overview: boolean, fontPx: number): number {
		if (!(overview && f.markOverview && fontPx > 0 && view.scale > 0)) return 1;
		return Math.min(MAX_SIGN_BOOST, Math.max(1, MIN_SIGN_TEXT_PX / (FOLD_EM.signTextOverview * fontPx * view.scale)));
	}

	private setSignBoost(f: FoldRef, boost: number): void {
		if (boost > 1) {
			const { x: sx, y: sy } = f.control.spot;
			const value = `translate(${sx} ${sy}) scale(${boost}) translate(${-sx} ${-sy})`;
			if (f.el.getAttribute('transform') !== value) f.el.setAttribute('transform', value);
		} else if (f.el.getAttribute('transform') !== null) f.el.removeAttribute('transform');
	}

	/**
	 * The size of the Overview signs follows the zoom, and they show on the screen at once, so it is kept right for every filled control when the zoom or the
	 * level changes (the tap areas are placed only near the view, `foldsDue`). Nothing is written when neither changed since the last call.
	 */
	protected refreshSignBoosts(view: View): void {
		const scene = this.scene;
		if (!scene) return;
		const last = this.boostFor;
		if (last && last.scene === scene && last.lod === this.lod && last.scale === view.scale) return;
		this.boostFor = { scene, lod: this.lod, scale: view.scale };
		const overview = this.lod === 'overview';
		const fontPx = this.laid?.layout.geometry.fontPx ?? 0;
		for (const f of scene.folds) if (f.filled) this.setSignBoost(f, this.signBoost(view, f, overview, fontPx));
	}

	/** The filled controls near `view` whose tap area was not placed for the zoom, the level and the cut-back areas that now hold. */
	protected foldsDue(view: View): FoldRef[] {
		const near = this.foldWindow(view);
		const scene = this.scene;
		if (!near || !scene) return [];
		const stamp = `${this.lod}|${view.scale}|${this.tapEpoch}`;
		return scene.folds.filter((f) => f.filled && f.hit && this.foldStamp.get(f) !== stamp && near(f));
	}

	/**
	 * Tag hit areas stay at least 44 screen px at low zoom (spec §7.5, the decision notes), and so do the `+` badges and their discs. They depend on the zoom, the layout
	 * and the scene only, so a settle at the same zoom (a pan) writes nothing and keeps `tapAreas` (D285: it was about 5 000 attribute writes per settle on a very large tree).
	 */
	protected placeTapAreas(view: View, laid: LaidOut): void {
		const scene = this.scene;
		const last = this.tapFor;
		const same = !!last && last.laid === laid && last.scene === scene && last.scale === view.scale;
		// A badge is placed again at each settle: a new card corner radius (a theme change) puts its places back to the first ones (`setCornerRadius`). Only a focus family has badges.
		if (same && !scene?.badges.length) return;
		if (!same) this.tapFor = scene ? { laid, scene, scale: view.scale } : null;
		// D31: in `down` the tap area hangs below its card. 0.3.1 fix3: in `sideways` it hangs from the card too, down to the next card at most;
		// a strip over the bottom of its own card wins when the gap is shorter than 44 screen px (`tagHitSide`).
		const down = laid.layout.orientation !== 'sideways';
		const below = down ? null : tagNextTops(laid.layout);
		const areas: Rect[] = [];
		for (const t of scene?.tags ?? []) {
			const card = laid.layout.persons.get(t.tag.person);
			const side = below ? tagHitSide(t.tag.hit, card, below.get(t.tag.person) ?? Infinity, view.scale, laid.layout.geometry.fontPx) : null;
			const r = side ? side.area : tagHitBelow(t.tag.hit, card, view.scale);
			setRect(t.hit, r);
			setRect(t.over, side?.over ?? { x: r.x, y: r.y, w: 0, h: 0 });
			areas.push(r);
		}
		// The same for the `+` badges of focus mode (spec §7.5, contract 4.2): the square below the cards, capped (the layout's node gap in
		// `sideways`, half the own card in `down`) and clipped at the tag tap areas of the other people; the disc above the cards.
		for (const b of scene?.badges ?? []) {
			const { square, disc } = this.badgeTapAt(laid, b.person, b.mark, view.scale);
			setRect(b.hit, square);
			const path = discPath(disc.cx, disc.cy, disc.r, disc.top);
			if (b.disc.getAttribute('d') !== path) b.disc.setAttribute('d', path);
			// A fold control's tap area gives way to the disc only; elsewhere in the square the fold control wins (contract 4.2 E1).
			const top = Math.max(disc.top, disc.cy - disc.r);
			areas.push({ x: disc.cx - disc.r, y: top, w: 2 * disc.r, h: disc.cy + disc.r - top });
		}
		// The fold controls are cut back against these areas. A badge moves with the card corner radius (a theme change, or the radius learnt after the first settle) with the same
		// layout and zoom, so a changed area also makes the stamp of the folds old.
		if (!same || !sameRects(this.tapAreas, areas)) this.tapEpoch++;
		this.tapAreas = areas;
	}

	protected settled(view: View, byUser: boolean): void {
		const laid = this.laid;
		if (!this.svg || !laid) return;
		// D145: a pan or zoom moves the card, so the tip goes; a card that got the keyboard focus during the move gets its tip now.
		this.tips?.hide();
		this.tips?.shown();
		this.applyLod(view);
		this.showPictures(view);
		this.placeTapAreas(view, laid);
		this.fillFolds(view);
		this.fillNear(view);
		this.refreshSignBoosts(view);
		this.placeFolds(view, this.foldsDue(view));
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
	protected updateHint(view: View): void {
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
			if (el.getAttribute('data-dynasty-hint-dropped') !== null) el.removeAttribute('data-dynasty-hint-dropped');
		}
		this.placeHints();
		for (const dir of ['up', 'down'] as const) if (counts[dir]) this.clearOfCards(dir, view);
	}

	/**
	 * G5 0.4: a hint never covers a card. With a theme's fonts the label is wider, and the first view can have a card in its corner: the label is measured as drawn
	 * and moves to the left corner, or goes when both corners cover a card. The right corner, as before, wherever it covers nothing.
	 */
	protected clearOfCards(dir: 'up' | 'down', view: View): void {
		const vp = this.viewport;
		const pz = this.panZoom;
		const laid = this.laid;
		const el = vp?.querySelector<HTMLElement>(`:scope > .dynasty-hint-${dir}`);
		if (!vp || !pz || !laid || !el) return;
		el.removeClass('is-left');
		const r = el.getBoundingClientRect();
		// Not laid out (a hidden tab, a unit fake): nothing to measure.
		if (!(r.width > 0 && r.height > 0)) return;
		const box = vp.getBoundingClientRect();
		const hint = { x: r.left - box.left - vp.clientLeft, y: r.top - box.top - vp.clientTop - this.frameTop(vp), w: r.width, h: r.height };
		const side = hintSide(laid.layout.persons.values(), view, pz.size, hint);
		if (side === 'left') el.addClass('is-left');
		else if (side === null) {
			// The text the hint would show stays on the slot for the harness (D28 counts the children; the drop is the reason there is no label).
			el.setAttribute('data-dynasty-hint-dropped', el.getText());
			el.removeClass('dynasty-hint', `dynasty-hint-${dir}`);
			el.setText('');
		}
	}

	/**
	 * Puts the D28 hints beside the toolbar as it is now: the note's toolbar gets its Add person button
	 * only when the block's handle is known, after the first view.
	 */
	protected placeHints(): void {
		const vp = this.viewport;
		const up = vp?.querySelector<HTMLElement>(':scope > .dynasty-hint-up') ?? null;
		const down = vp?.querySelector<HTMLElement>(':scope > .dynasty-hint-down') ?? null;
		if (!vp || (!up && !down)) return;
		// 0.2.8: the toolbar is a band over the full width, so the hint at the top stands below the bands that the view keeps free.
		up?.style.setProperty('--dynasty-hint-top', `${this.frameTop(vp) + Math.max(0, this.insetTop) + 4}px`);
		down?.style.setProperty('--dynasty-hint-bottom', `${this.insetBottom + 4}px`);
	}

	protected cardLink(p: Person): CardLink | null {
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
	protected openNote(open: () => Promise<void>): void {
		const go = () => void open().catch((err) => console.error('Crown and Kin: cannot open the note', err));
		if (this.full) this.full.leave(go);
		else go();
	}

	/** S5c: the element that got the focus is a card, tag or badge shell: it gets its content before the view moves to it. */
	protected fillFocused(target: EventTarget | null): void {
		const id = (target as Element | null)?.getAttribute?.('data-person');
		if (id) this.fillPerson(id);
	}

	protected wireScene(scene: Scene): void {
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
				this.guard(() => this.activate(id, false, e));
			});
			card.addEventListener('focus', () => this.guard(() => this.keyFocus() && this.revealPerson(id, TreeViewBase.takeRestoreMark(card))));
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
					if (this.keyFocus()) this.reveal(f.mark);
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
						if (hadShow) TreeViewBase.listRedraw(this.host, st);
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
	protected wireCardPresses(viewport: HTMLElement): void {
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
			this.guard(() => this.activate(t.person, true, e));
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
			if (id) this.guard(() => this.activate(id, false, e));
		});
	}

	/**
	 * A tap, a click or Enter on a card. An editable tree opens the person window. A tree that cannot change the note (shown from another note, a Canvas card, a hover
	 * preview, or no block found) opens the picture viewer at once if the person has a portrait or arms, else it does nothing (D269). `via` is the event of the press.
	 */
	protected activate(id: string, fromTap = false, via: Event | null = null): void {
		const foreign = this.inForeignView();
		// A block whose place is only not known YET opens nothing (D183).
		if (foreign || (this.readOnly && !this.binding.placePending)) {
			// A view that was retired or unloaded is only a picture: it must not open a window over the note.
			if (this.unloaded) return;
			this.viewCardPictures(id, via);
			return;
		}
		if (this.readOnly) return;
		this.fillPerson(id);
		void this.openSheet(id, fromTap);
	}

	/** D269: the picture viewer for the person of a card, with the same two small pictures as the person window; the arms on the card start it on the arms. */
	protected viewCardPictures(id: string, via: Event | null): void {
		const g = this.whole;
		const person = g?.byId.get(id);
		if (!g || !person || (!person.portrait && !person.arms && !(person.house && g.houses.get(person.house)?.arms))) return;
		const card = this.scene?.cards.get(id) ?? null;
		const kit = { app: this.host.app, pictures: this.host.pictures, sourcePath: this.sourcePath, g, person };
		viewCard(kit, card as HTMLElement | null, this.pressedArms(card, via) ? 'arms' : undefined);
	}

	/** Did the press land on the arms of the card? The pictures take no pointer events, so the place of the press is compared with the place of the arms. */
	protected pressedArms(card: Element | null, via: Event | null): boolean {
		if ((via?.target as Element | null)?.closest?.('.dynasty-arms')) return true;
		const m = via as MouseEvent | null;
		const box = card?.querySelector('.dynasty-arms')?.getBoundingClientRect();
		if (!m || !box || typeof m.clientX !== 'number' || box.width <= 0) return false;
		return m.clientX >= box.left && m.clientX <= box.right && m.clientY >= box.top && m.clientY <= box.bottom;
	}

	/** Centres the view on a person and highlights the card briefly (spec §5.3, D10). */
	showPerson(id: string, others: string[] = []): void {
		const box = this.laid?.layout.persons.get(id);
		const pz = this.panZoom;
		if (!box || !pz?.view || !this.laid) return;
		this.fillPerson(id);
		const target = this.centreFree(centreOn(pz.view, box, this.laid.layout.geometry.fontPx));
		pz.setView(target, { byUser: true });
		this.pulse([id, ...others]);
	}

	/**
	 * May a focused card or tag pan the view to it? Elsewhere always: a card cut at the tree's edge
	 * would otherwise scroll the note. In a static touch embed (D1) only a focus that the Tab key
	 * made: a tap also focuses the card or tag under it, and a modal opened from it (the sheet, the
	 * full-screen view) gives the focus back on close, also after the user pressed Tab inside it.
	 */
	protected keyFocus(): boolean {
		return !!this.full || !this.coarse || (this.tabbing && !this.modalAbove());
	}

	/**
	 * A modal (a sheet, a picker, a full-screen view) is open over the note. A static touch embed
	 * (D1) never moves then: a Tab in a phone sheet that has no focus yet can reach the tree below it.
	 */
	protected modalAbove(): boolean {
		if (pluginModalOpen() || this.host.hasFullOpen()) return true;
		return !!this.containerEl.doc?.body?.querySelector?.('.modal-container');
	}

	protected revealPerson(id: string, restored = false): void {
		this.fillPerson(id);
		const box = this.laid?.layout.persons.get(id);
		if (box) this.reveal(box, false, restored);
	}

	/** The card with its `+` badge: the badge sticks out above the card's top edge, and a card is only whole on the screen when its badge is (G3 F3). */
	protected withBadge(box: Rect): Rect {
		let out = box;
		for (const { mark } of this.scene?.badges ?? []) {
			const cx = mark.x + mark.w / 2;
			const cy = mark.y + mark.h / 2;
			if (cx < box.x - 1 || cx > box.x + box.w + 1 || cy < box.y - 1 || cy > box.y + box.h + 1) continue;
			const x = Math.min(out.x, mark.x);
			const y = Math.min(out.y, mark.y);
			out = { x, y, w: Math.max(out.x + out.w, mark.x + mark.w) - x, h: Math.max(out.y + out.h, mark.y + mark.h) - y };
		}
		return out;
	}

	/**
	 * A card or tag that is off screen (after an edit, or when it gets the focus with Tab) is brought into view at once. `kept` is the edit after a kept
	 * place (D244): then only the card counts and only the bars, so a card that is whole on the screen stays where it is, even with its badge under a bar
	 * or its edge in a side safe area. `restored` is a focus that `refocusAfterRedraw` gave back after a write (a sheet closed): the edit may have panned to a
	 * new card, so only a card wholly off screen pans.
	 */
	protected reveal(box: Rect, kept = false, restored = false): void {
		const pz = this.panZoom;
		const v = pz?.view;
		if (!pz || !v || pz.busy) return;
		if (!this.full && this.coarse && this.modalAbove()) return;
		// D222: a card never stays under a bar, so "inside" means inside the free area, not the whole viewport.
		const top = this.full ? this.insetTop : 0;
		const bottom = this.full ? this.insetBottom : 0;
		// V1: nor in a side safe area (the notch of a phone held sideways).
		const left = this.full && !kept ? this.insetLeft : 0;
		const right = this.full && !kept ? this.insetRight : 0;
		const worldLeft = v.cx + (left - pz.size.w / 2) / v.scale;
		const worldRight = v.cx + (pz.size.w / 2 - right) / v.scale;
		const worldTop = v.cy + (top - pz.size.h / 2) / v.scale;
		const worldBottom = v.cy + (pz.size.h / 2 - bottom) / v.scale;
		// The card alone for a restore: a card hidden except for its `+` badge is not in view.
		const seen = kept || restored ? box : this.withBadge(box);
		const inside = restored
			? seen.x < worldRight && seen.x + seen.w > worldLeft && seen.y < worldBottom && seen.y + seen.h > worldTop
			: seen.x >= worldLeft && seen.x + seen.w <= worldRight && seen.y >= worldTop && seen.y + seen.h <= worldBottom;
		if (inside) return;
		pz.setView(this.centreFree({ scale: v.scale, cx: box.x + box.w / 2, cy: box.y + box.h / 2 }), { byUser: true });
	}

	protected highlight(ids: string[]): void {
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
			// A second ring on the same card must last its full time: the old timer would end it early.
			const old = this.ringTimers.get(card);
			if (old !== undefined) {
				win.clearTimeout(old);
				this.timers.delete(old);
			}
			const t = win.setTimeout(() => {
				this.timers.delete(t);
				this.ringTimers.delete(card);
				card.removeClass('dynasty-highlight');
			}, HIGHLIGHT_MS);
			this.timers.add(t);
			this.ringTimers.set(card, t);
		}
	}

	/** The cards of heirs and branches say their place in the screen-reader label (F.4). The scene's own text has none: it does not know the line. */
	protected markPositions(): void {
		const d = this.successionDrawn;
		const scene = this.scene;
		const g = this.g;
		const opts = this.lastLayout?.opts;
		if (!d || !scene || !g || !opts) return;
		for (const id of d.ordinals.keys()) {
			const card = scene.cards.get(id);
			const p = g.byId.get(id);
			if (!card || !p) continue;
			const label = cardLabel(p, opts.me === id ? 'you' : opts.relations?.get(id)?.lower, opts.labels?.get(id), cardPosition(d, id), g.dates);
			card.setAttribute('aria-label', card.hasClass('dynasty-signed') ? `${label}, ${SIGN_CARD_LABEL}` : label);
		}
	}

	/**
	 * After a first view: the keyboard focus goes where a finder action in this view asked (a new
	 * result's sentence, which a screen reader reads and Esc closes; the pressed button of the bar;
	 * More after Close). Never while a sheet or a picker of the plugin is open.
	 */
	protected takeFocus(): void {
		const sel = this.focusDue;
		this.focusDue = null;
		if (!sel || pluginModalOpen()) return;
		this.viewport?.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true });
	}
}
