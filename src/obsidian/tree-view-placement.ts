/*
 * Where the view looks (0.3.3, WP-1 A1): the height of the box, the direction (D24), a resize, the bars that the view keeps free, the anchor that a redraw
 * keeps, and the first view of a tree, of the finder's small tree and of the Show view (spec §5.5, §5.6, D18, D222). Third layer of the chain listed in
 * `tree-view.ts`.
 */

import type { LaidOut, Orientation, Rect } from '../layout/model';
import { fontsChanged } from '../render/fonts';
import { safeSides, safeTop } from '../render/dom/page-reads';
import { lodClass } from '../render/dom/scene';
import { partnersAndChildren, startPerson } from '../render/tree-info';
import { centreOn, cardShown, centredOpening, chooseLod, bandShift, clearBand, defaultView, embedHeight, fitView, READABLE_NAME_PX, bringInView, betweenSides, resizeView, treeBounds, type FreeArea, type Size, type View } from '../render/view-math';
import type { BlockState } from '../view/block-state';
import { badgeTap, clearToolbar, finderFirstView, finderOrientation, focusView, keepTopCardWhole, orientationFor, parentsAbove, sidewaysView, signRights } from '../view/focus-mode';
import type { FinderDrawn } from '../view/render-plan';
import { PHONE_MIN_SCALE, successionFirstView, type SuccessionDrawn } from '../view/succession-view';
import { around, boxesOf } from '../view/tree-view-helpers';
import { TreeViewLifecycle } from './tree-view-lifecycle';
import { TreeViewBase } from './tree-view-base';
import type { Anchor } from './tree-view-types';

/** The placement of the view in its box: sizes, insets, anchors and the first views. */
export abstract class TreeViewPlacement extends TreeViewLifecycle {
	/** The anchor a redraw keeps: none in the static touch preview, which shows its first view (D1). */
	protected keptAnchor(): Anchor | null {
		return this.full || !this.coarse ? this.anchor() : null;
	}

	protected anchor(): Anchor | null {
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

	protected fromAnchor(a: Anchor): View | null {
		const b = this.laid?.layout.persons.get(a.person);
		if (!b || !this.laid) return null;
		const f = this.laid.layout.geometry.fontPx;
		return { scale: a.scale, cx: b.x + b.w / 2 + a.dx * f, cy: b.y + b.h / 2 + a.dy * f };
	}

	protected updateHeight(): void {
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

	/** The orientation that the window, the screen and the setting "Tree direction on a phone held upright" ask for now (D24, D150). */
	protected orientationNow(): Orientation {
		const win = this.containerEl.win;
		return orientationFor(this.coarse, win.innerWidth, win.innerHeight, win.screen, this.settings.phoneDirection);
	}

	/** The orientation the window asks for (D24) differs from the drawn one. */
	protected turnDue(): boolean {
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
	protected checkTurn(): void {
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

	protected resized(): void {
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

	protected resizedNow(): void {
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
		// D244: after a saved sheet the edited card keeps its place, which also keeps the toolbar band as the user left it.
		const kept = carried ? this.keptPlaceView(this.keepPlace, size) : null;
		this.keepPlace = null;
		if (kept) carried = kept;
		// Larger cards around the same centre can reach up under the toolbar; if none was there
		// before, move the view down just enough.
		else if (carried && this.carry?.bandClear) carried = this.clearTop(carried, size, [...this.laid.layout.persons.values()]);
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
			this.pulse(targets);
		}
		// The touch embed is a static preview that always shows the default view (spec §7.2).
		else {
			// F4: a saved view with no card on the screen (a pinch that left the tree, a window of another size) is not kept: the first view fits.
			const saved = this.shownView(this.savedView(st), size);
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
	protected frameTop(vp: HTMLElement | null = this.viewport): number {
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
	protected measureInsets(vp: HTMLElement): void {
		if (vp.hasClass('is-flow')) {
			this.insetTop = 0;
			this.insetBottom = 0;
			this.insetLeft = 0;
			this.insetRight = 0;
			this.barBox = null;
			return;
		}
		const sides = this.full ? safeSides(this.safeProbe) : { left: 0, right: 0 };
		this.insetLeft = sides.left;
		this.insetRight = sides.right;
		const bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		const atBottom = !!bar && bar.offsetTop > vp.clientHeight / 2;
		// With the toolbar at the bottom, the top band is the phone's status bar or notch (safe area).
		this.insetTop = bar && !atBottom ? bar.offsetTop + bar.offsetHeight + 4 : this.full ? safeTop(this.safeProbe) : 0;
		this.insetBottom = bar && atBottom ? vp.clientHeight - bar.offsetTop + 4 : 0;
		// Spec §13.2: the finder's result bar is at the top of the view; a view chosen by the plugin keeps it free too.
		const result = vp.querySelector<HTMLElement>(':scope > .dynasty-result');
		const resultBottom = result && result.offsetHeight > 0 ? result.offsetTop + result.offsetHeight + 4 : 0;
		if (resultBottom) this.insetTop = Math.max(this.insetTop, resultBottom);
		this.barBox = bar && !atBottom && Number.isFinite(bar.offsetLeft) && bar.offsetWidth > 0 ? { left: bar.offsetLeft, right: bar.offsetLeft + bar.offsetWidth, top: bar.offsetTop, bottom: bar.offsetTop + bar.offsetHeight + 4 } : null;
		// D246: the bar of focus mode (and the finder's bar) spans the whole width, so the band that the first view keeps clear of cards is the whole width too, down to its foot.
		if (this.barBox && resultBottom) this.barBox = { left: 0, right: vp.clientWidth, top: this.barBox.top, bottom: Math.max(this.barBox.bottom, resultBottom) };
	}

	/**
	 * D51, D203 item 2: the first view of the finder's small tree on an upright phone draws it top to bottom, in the free area below the
	 * result bar and above the toolbar (before 0.2.8 the direction with the larger names won).
	 * The other layout replaces the drawn one in place; the window's orientation stays the view's own,
	 * so the D24 turn logic sees no turn.
	 */
	protected pickFinderDirection(size: Size): void {
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

	/** A view chosen for the area above the bottom toolbar and between the side safe areas (V1), shown in the whole viewport. */
	protected aboveBottomBar(size: Size, make: (area: Size) => View): View {
		const b = Math.max(0, Math.min(this.insetBottom, size.h - 1));
		const inner = (area: Size) => betweenSides(area, this.insetLeft, this.insetRight, make);
		if (!b) return inner(size);
		const v = inner({ w: size.w, h: size.h - b });
		return v.scale > 0 ? { scale: v.scale, cx: v.cx, cy: v.cy + b / 2 / v.scale } : v;
	}

	/** The bars and the side safe areas that the views chosen by the plugin keep free (D222, V1); none in a note. */
	protected freeArea(): FreeArea | undefined {
		return this.full ? { top: this.insetTop, bottom: this.insetBottom, left: this.insetLeft, right: this.insetRight } : undefined;
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
			const v = st && pz ? this.shownView(this.savedView(st), pz.size) : null;
			if (this.full || this.coarse || !pz?.view || !v) return;
			pz.setView(v);
		});
	}

	/** After an edit, the edited person is highlighted briefly and panned into view if off screen (spec §5.5). */
	protected showEdited(st: BlockState): void {
		const hl = st.highlight;
		if (!hl || performance.now() > hl.until) return;
		const box = this.laid?.layout.persons.get(hl.id);
		if (!box) return;
		this.fillPerson(hl.id);
		// D245: the card that Add child, Add parent or Add partner made is not the card whose sheet was saved. If it is outside the free area the view moves only as far as needed,
		// so the edited card moves as little as it can. Every other edit keeps the reveal of spec §5.5.
		const sheet = TreeViewBase.sheetPerson.get(st);
		if (sheet && performance.now() <= sheet.until && sheet.id !== hl.id) this.bringIn(box);
		// D244 wins over G3 F3 and V1 here: the edited card keeps its place when the card is whole, even if its badge reaches under a bar or its edge into the notch.
		else this.reveal(box, true);
		this.pulse([hl.id]);
	}

	/** D245: the smallest pan that brings a new card wholly into the free area; same guards as `reveal`, no centring and no scale change. */
	protected bringIn(box: Rect): void {
		const pz = this.panZoom;
		const v = pz?.view;
		if (!pz || !v || pz.busy) return;
		if (!this.full && this.coarse && this.modalAbove()) return;
		const free = this.freeArea();
		const next = bringInView(v, box, { size: pz.size, ...(free ? { free } : {}) });
		if (next.cx !== v.cx || next.cy !== v.cy) pz.setView(next, { byUser: true });
	}

	/** The view a tree opens with: the focus view (D18, §5.6) in focus mode, else the default view (§5.5). */
	protected firstView(laid: LaidOut, size: Size): View {
		if (this.finderDrawn?.line) return this.finderView(laid, size, this.finderDrawn);
		if (this.successionDrawn) return this.successionView(laid, size, this.successionDrawn);
		const id = this.focusId;
		if (laid.layout.orientation === 'sideways') return this.sidewaysFirst(laid, size, id ?? this.startId());
		if (id === null) return this.defaultViewFor(laid, size, true);
		const persons = laid.layout.persons;
		const me = persons.get(id) ?? null;
		const children = this.g ? boxesOf(persons, partnersAndChildren(this.g, id).children) : [];
		// D23: with no parent drawn above, the person sits near the top (D13), not in the middle of an empty view.
		const parentIds = this.g?.placementParents.get(id) ?? [];
		const atTop = !parentIds.length;
		const parents = boxesOf(persons, parentIds);
		// The near partners count with the focus person when the names must go smaller to show a child (G3 F4); a far partner is drawn elsewhere (D10).
		const far = laid.layout.farTags.get(id)?.spouses ?? [];
		const partners = this.g ? boxesOf(persons, partnersAndChildren(this.g, id).partners.filter((p) => !far.includes(p))) : [];
		const v = this.aboveBottomBar(size, (area) => focusView(this.bounds, area, laid.layout.geometry.fontPx, me, this.insetTop, children, atTop, parents, partners));
		// Not clearBand (which clears the whole width): only the cards and badges under the toolbar
		// itself move the view down, and never so far that the focus card leaves the free area.
		// With no toolbar over the tree (a note, D212) the top card is whole when nothing is cut by the top of the drawing area.
		if (!this.barBox) return this.keepTopWhole(v, size, laid, me ? [me] : []);
		const boxes = [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)];
		return clearToolbar(v, size, this.barBox, boxes, me, size.h - this.insetBottom);
	}

	/** Start person (spec §5.5, G.4): the person last edited in this block, else options.start, else the marked person ("You"), else the first root. */
	protected startId(): string | null {
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
	protected sidewaysFirst(laid: LaidOut, size: Size, id: string | null): View {
		const persons = laid.layout.persons;
		const g = this.g;
		const fam = id !== null && g ? partnersAndChildren(g, id) : null;
		// Children drawn next to the person: a child placed with other parents is drawn elsewhere.
		const kids = fam && g ? fam.children.filter((c) => (g.placementParents.get(c) ?? []).includes(id!)) : [];
		// Far partners (D10) are drawn elsewhere and shown by a tag: not part of the group.
		const near = (who: string, partners: string[]) => partners.filter((p) => !(laid.layout.farTags.get(who)?.spouses ?? []).includes(p));
		const top = Math.max(0, Math.min(this.insetTop, size.h - 1));
		const bottom = Math.max(top + 1, size.h - this.insetBottom);
		const me = id !== null ? (persons.get(id) ?? null) : null;
		this.hintKids = boxesOf(persons, kids);
		// D257: the "+ N" sign of a folded family of a child counts as part of the child's column.
		const signs = signRights(laid.layout.folds, laid.layout.geometry.fontPx);
		// V1: the column starts beside the left safe area, not under it.
		const view = betweenSides(size, this.insetLeft, this.insetRight, (area) => sidewaysView(
			area,
			laid.layout.geometry.fontPx,
			{
				me,
				partners: fam && id !== null ? boxesOf(persons, near(id, fam.partners)) : [],
				children: g ? kids.flatMap((c) => boxesOf(persons, [c]).map((card) => ({ card, partners: boxesOf(persons, near(c, partnersAndChildren(g, c).partners)), sign: signs.get(c) }))) : [],
				parents: id !== null && g ? boxesOf(persons, g.placementParents.get(id) ?? []) : [],
			},
			top,
			bottom,
			{ x: 0, y: 0, w: 0, h: 0 },
		).view);
		// D222: a whole tree that fits between the bars opens centred there, at the same 14 px names. A focus family keeps its view (D18: the person near the top).
		// D246 F3 starts from the 14 px names; the smaller names of V4 are for a tree that is not centred.
		const small = this.focusId === null ? this.centredSmall(size, READABLE_NAME_PX / (laid.layout.geometry.fontPx > 0 ? laid.layout.geometry.fontPx : 16)) : null;
		if (small) {
			this.hintKids = [];
			return small;
		}
		// The group starts below the toolbar box, but a card above it in the children's column (or above a
		// tall group's person) can reach under the note's toolbar: move down, as D18 does.
		if (!this.barBox) return this.keepTopWhole(view, size, laid, me ? [me] : []);
		return clearToolbar(view, size, this.barBox, [...persons.values(), ...(this.scene?.badges ?? []).map((b) => b.mark)], me, bottom);
	}

	/**
	 * D222, D246 (F3): in the full-screen view only, the view that puts a small tree in the middle of the free area between the bars: at `scale` if it fits or only its
	 * empty margin is cut, else smaller so that no card is cut (see `centredOpening`); else null. The insets are the cached values of `measureInsets`.
	 */
	protected centredSmall(size: Size, scale: number): View | null {
		if (!this.full) return null;
		return centredOpening(this.bounds, size, scale, this.freeArea() ?? { top: 0, bottom: 0 }, this.laid?.layout.geometry.fontPx ?? 0);
	}

	/** The whole-tree view (§5.5). `centre`: the first view of the tree (not the Show view) centres a small tree in the full-screen view (D222). */
	protected defaultViewFor(laid: LaidOut, size: Size, centre = false): View {
		const start = this.startId();
		const persons = laid.layout.persons;
		const startBox = start ? (persons.get(start) ?? null) : null;
		const fam = start && this.g ? partnersAndChildren(this.g, start) : null;
		const family = fam ? { partners: boxesOf(persons, fam.partners), children: boxesOf(persons, fam.children) } : null;
		// 0.2.8 (G.4): the readable view of a note shows the row of the parents above the start person.
		const parents = start && this.g ? boxesOf(persons, this.g.placementParents.get(start) ?? []) : [];
		const plain = (area: Size) => defaultView(this.bounds, area, laid.layout.geometry.fontPx, startBox, this.insetTop, family);
		const small = centre ? this.centredSmall(size, this.aboveBottomBar(size, plain).scale) : null;
		if (small) return small;
		return this.aboveBottomBar(size, (area) => {
			const v0 = plain(area);
			const v = startBox ? parentsAbove(v0, area, this.insetTop, startBox, parents) : v0;
			// A toolbar taller than the gap between rows could still reach the row above the start person.
			return this.clearTop(v, area, [...persons.values()], startBox ? [startBox] : []);
		});
	}

	/**
	 * Moves a view down just enough that no card is under the bars over the tree (the full-screen view), or cut by the top of the drawing area when the bars stand
	 * above it (a note, D212 `bars-in-flow`).
	 */
	protected clearTop(v: View, size: Size, boxes: Rect[], keys: readonly Rect[] = []): View {
		return this.insetTop > 0 ? clearBand(v, size, this.insetTop, boxes) : keepTopCardWhole(v, size, 0, size.h, boxes, keys);
	}

	/** True when `clearTop` would not move the view. */
	protected topClear(v: View, size: Size, boxes: Rect[]): boolean {
		return this.insetTop > 0 ? bandShift(v, size, this.insetTop, boxes) === 0 : keepTopCardWhole(v, size, 0, size.h, boxes, []) === v;
	}

	/** Sets the level of detail class for `view`; true when the level changed. */
	protected applyLod(view: View): boolean {
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

	protected storeView(view: View): void {
		// The finder's tree and the Show view are not the family: after Close the family's own saved view comes back (spec §13.2, contract 0.2.7 F.2).
		if (this.finderDrawn?.line || this.successionDrawn) return;
		const st = this.ensureState();
		st.view = view;
		st.viewFor = this.drawnKey ?? '';
		st.views[this.orientation] = { view, viewFor: st.viewFor };
	}

	/** F4: `view` if a card of the drawn tree shows in it (in the free area between the bars of the full-screen view), else null. */
	protected shownView(view: View | null, size: Size): View | null {
		const laid = this.laid;
		if (!view || !laid) return view;
		return cardShown(view, size, laid.layout.persons.values(), this.full ? { top: this.insetTop, bottom: this.insetBottom } : undefined) ? view : null;
	}

	/** The saved view of the drawn family in the drawn orientation (D24: kept per orientation), or null. */
	protected savedView(st: BlockState): View | null {
		const s = st.views[this.orientation];
		return s && s.viewFor === this.drawnKey ? s.view : null;
	}

	/**
	 * In the full-screen view a person is centred in the free area between the toolbar bands (the
	 * phone's bottom bar and top safe area, the desktop toolbar), not in the whole viewport, so the
	 * card and its neighbours do not sit under a toolbar.
	 */
	protected centreFree(v: View): View {
		if (!this.full || !(v.scale > 0)) return v;
		return { scale: v.scale, cx: v.cx - (this.insetLeft - this.insetRight) / 2 / v.scale, cy: v.cy - (this.insetTop - this.insetBottom) / 2 / v.scale };
	}

	protected fit(): void {
		const pz = this.panZoom;
		if (!pz?.view) return;
		pz.setView(this.aboveBottomBar(pz.size, (area) => fitView(this.bounds, area, this.insetTop)), { byUser: true });
	}

	/** The anchor of the card of `id` in the drawn tree: the view's centre relative to the card, in em. */
	protected anchorOn(id: string | undefined): Anchor | null {
		const b = id !== undefined ? this.laid?.layout.persons.get(id) : undefined;
		const v = this.panZoom?.view;
		if (!b || !v || !this.laid) return null;
		const f = this.laid.layout.geometry.fontPx;
		return { person: id!, dx: (v.cx - (b.x + b.w / 2)) / f, dy: (v.cy - (b.y + b.h / 2)) / f, scale: v.scale, byUser: true, bandClear: false };
	}

	/**
	 * The first view of the Show view (F.2): the ruler and the heirs below the bar. The open branches are not fitted. On a phone it
	 * never goes below the scale `PHONE_MIN_SCALE`: it starts at the ruler (prototype finding 2).
	 */
	protected successionView(laid: LaidOut, size: Size, d: SuccessionDrawn): View {
		const persons = laid.layout.persons;
		const ruler = persons.get(d.ruler);
		const heirs = boxesOf(persons, d.heirs);
		if (!ruler) return this.defaultViewFor(laid, size);
		const bounds = around([ruler, ...heirs]);
		const v = this.aboveBottomBar(size, (area) => successionFirstView(bounds, area, laid.layout.geometry.fontPx, this.insetTop, ruler, heirs, laid.layout.orientation, this.isPhone() ? PHONE_MIN_SCALE : 0));
		return this.keepTopWhole(v, size, laid, [ruler, ...heirs]);
	}

	/** D212 (bars-in-flow): a first view that the plugin chooses never leaves a card cut in two by the toolbar and the banner at the top (`keepTopCardWhole`). */
	protected keepTopWhole(v: View, size: Size, laid: LaidOut, keys: readonly Rect[]): View {
		// A `+` badge sticks out above its card: it is not cut by the bar (G3 F3), and it does not stand in the safe area above the bar either (V3).
		// 0.3.1 fix3: in the full-screen view, where the bars lie over the tree, the badge's whole press square at this zoom keeps out of the band too,
		// so no part of it is under the opaque focus bar. In a note the bars stand above the drawing area and the circle counts, as before.
		const marks = (this.scene?.badges ?? []).map((b) => {
			if (!this.full) return b.mark;
			const sq = this.badgeTapAt(laid, b.person, b.mark, v.scale).square;
			// The square's lower part lies on the own card, which the card rule keeps clear; the box ends at the circle's foot, so a raise is as before.
			const x = Math.min(sq.x, b.mark.x);
			const y = Math.min(sq.y, b.mark.y);
			return { x, y, w: Math.max(sq.x + sq.w, b.mark.x + b.mark.w) - x, h: b.mark.y + b.mark.h - y };
		});
		return keepTopCardWhole(v, size, this.insetTop, size.h - Math.max(0, this.insetBottom), laid.layout.persons.values(), keys, marks);
	}

	/**
	 * The tap shape of the `+` badge of `person` (visible circle `mark`) at `scale` (spec §7.5, contract 4.2): the square is capped at the layout's node gap in
	 * `sideways` and at half the own card in `down`, and clipped at the tag tap areas of the other people (`badgeTap`). One place for the settle and the first view.
	 */
	protected badgeTapAt(laid: LaidOut, person: string, mark: Rect, scale: number): ReturnType<typeof badgeTap> {
		const geo = laid.layout.geometry;
		const cap = laid.layout.orientation !== 'sideways' ? (laid.layout.persons.get(person)?.h ?? geo.cardH) / 2 : geo.nodeGap;
		const avoid: Rect[] = [];
		for (const t of laid.layout.farTags.values()) if (t.person !== person) avoid.push(t.hit);
		return badgeTap(mark, scale, geo.fontPx, cap, avoid);
	}

	/**
	 * The first view of the finder's tree on every device: see `finderFirstView`. The line is the whole
	 * small tree, or its cards in "Show in the whole tree"; the free area is below the result bar and
	 * above a bottom toolbar.
	 */
	protected finderView(laid: LaidOut, size: Size, d: FinderDrawn): View {
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
}
