/*
 * Pan and zoom on Pointer Events (spec §7.2, §7.6): one transformed <g>, updates in
 * requestAnimationFrame, never a re-layout. The level of detail changes in `onSettle`, after the
 * gesture ends, and in `onFill`, when a pinch draws the real view to fill empty space (D19); never
 * in the frames between.
 *
 * During a pinch the <g> keeps the view it had when the pinch began, and a CSS transform on an HTML
 * wrapper around the <svg> scales and moves that picture instead. A change of scale on the <g>, or a
 * CSS transform on the <svg> itself, makes the browser lay out and shape every SVG text again for
 * the new screen size: with 400 cards a phone cannot do that 60 times a second. A
 * transform on an HTML parent does not reach the SVG text layout. When the pinch ends, the <g>
 * takes the real view and the wrapper transform goes, in the same frame. While a pinch leaves empty
 * space around the wrapped picture, the real view is drawn about every 250 ms during the pinch, and
 * the wrapper goes on from that picture (owner decision D19).
 *
 * D365 (1), D374 (2): a one-finger drag of any tree on iOS does the same (`wrapDrag`). WebKit lays out all SVG text again for each write of the <g>
 * transform (about 120 ms for 1,000 people on the iPhone), and a CSS transform on the wrapper costs nothing, so the <g> keeps the view the drag began
 * with. An empty strip can show at the leading edge; the real view is drawn when the strip shows and the last drawing is `FILL_MS` old, and when the
 * drag ends. Other engines keep the write in each frame.
 *
 * D366: on that path in the full-screen view the drawn picture is larger than the screen by the margin of `DRAG_MARGIN` on each side (the <svg> is bigger and
 * offset by the margin, so the picture on screen is the same). `covers` then stays true for a drag up to the margin, and the <g> is written only when the view leaves the
 * drawn picture. At the lift the <g> is not written while the picture still covers the view and has the scale it was drawn at: the wrapper keeps its transform (a
 * pure move) and the class. The <g> is written at the next view change that is not a wrapped drag (a pinch, a wheel, `setView`), at a new size and when the margin
 * changes. A write at the lift would lay out all SVG text of the tree again for nothing, 170 ms on the iPhone for 1,000 people.
 *
 * D367: the margin is a rule (`MarginRule`): a number of screens on each side, or `range`, every view that a pan can reach at the drawn zoom (from the pan
 * limits), up to `RANGE_CAP_PX` on each side, with the fill beyond it. The release rule is `range` (`DRAG_MARGIN`; the fourth iPhone drag test: no fill write
 * in a swipe). The margin is fixed when the <g> is written and kept in `drawn`; a move or a press never computes it again, so a press after a held lift
 * writes no <g> while the view stays inside the drawn picture. Only a change of the rule or of the path (`marginKey`) makes the drawn picture stale. The box of the <svg> grows only at a draw at rest or at a fill of a wrapped gesture, never in a frame of a wheel zoom.
 * A margin wider than one screen holds more than a content fill attaches (one screen past each side, `boxNearView`): while the wrapper shows the picture, the content
 * near the view is filled again before the screen leaves half of that band (`leftFill`), with no <g> write, so no card on screen is an empty shell.
 *
 * Embedded ('embed'): only a mouse pans. A finger or a pen never pans an embedded tree, also on a
 * laptop with a touchscreen: the drag scrolls the note (CSS touch-action: pan-y). A plain wheel is
 * left to the note; Ctrl/Cmd+wheel (and a trackpad pinch, which arrives as Ctrl+wheel) zooms.
 * Full screen ('full'): every pointer pans with one finger or the mouse, two fingers pinch, a
 * double-tap on empty background zooms 2×, a plain wheel pans and Ctrl/Cmd+wheel zooms.
 *
 * Spec §13.15: the tree view attaches card content that is near the view. `onFirstDraw` runs once,
 * right after the first write of the scene transform, in the same task (`onSettle` cannot do this: it runs
 * before that write). `onFill` also runs during a wheel or trackpad zoom, but only when
 * the visible rectangle leaves the last filled one and at most once for each frame. A drag pan never
 * fills (except a wrapped drag, see above); it ends at its settle. `visibleRect` is the one owner of the conversion from a `View` and the
 * viewport size to a layout `Rect`.
 *
 * 0.3 (D235): no view change slides. `setView` shows the new view in the next frame, whatever the caller: Fit, Find, the reveal after an
 * edit and the double tap. In the full-screen view a drag or wheel pan of a tree that is smaller than the free area (`freeArea`: the space
 * between the bars) keeps the whole tree inside that area (D222, `panLimits`).
 */

import type { Rect } from '../../layout/model';
import { clampTo, doubleTapView, isDoubleTap, isPan, panFrom, panLimits, pinchView, scaleLimits, transformFor, wheelFactor, zoomAt, type FreeArea, type Point, type Size, type View } from '../view-math';
import { SCENE_TAP_GROUPS, SCENE_TAP_TARGETS } from '../tap-targets';

/** Everything `PanZoom` needs from the tree view to run gestures on one drawn tree. */
export interface PanZoomOptions {
	viewport: HTMLElement;
	scene: SVGGElement;
	/** The HTML element around the <svg> that takes the CSS transform during a pinch; it fills the drawing area from its top left corner. */
	wrapper?: HTMLElement;
	/**
	 * D212 (bars in flow): the screen px between the top of `viewport` and the top of the drawing area, where the toolbar and the banner stand above the tree in a
	 * note. The size that `resize` gets is the size of the drawing area. Default: 0 (the whole viewport, the full-screen view).
	 */
	frameTop?: () => number;
	bounds: Rect;
	fontPx: number;
	/** False on a touch-first device: the embedded tree is a static preview (D1). */
	interactive: boolean;
	mode: 'embed' | 'full';
	/** After a gesture ends or a view is set. `byUser` is false for views the plugin chose. */
	onSettle: (view: View, byUser: boolean) => void;
	/** A pinch drew the real view to fill empty space (D19); the pinch goes on. `ahead` true: no <g> write, only the content near the view (D367, `leftFill`). */
	onFill?: (view: View, ahead?: boolean) => void;
	/** Once, right after the first write of the scene transform, in the same task. No pan, pinch, wheel zoom or later `setView` calls it. */
	onFirstDraw?: (view: View) => void;
	/** Runs an entry point (event, frame, timer) so that an error cannot escape into Obsidian (spec §8). */
	guard: (fn: () => void) => void;
	/**
	 * D222: the bars of the full-screen view, in screen px (cached values, never a read of the page on a pointer move). A drag or wheel pan of a tree that is smaller
	 * than the free area between them keeps the whole tree inside that area. Absent: the limits of the whole viewport.
	 */
	freeArea?: () => FreeArea;
	/** Once at the start of each drag (a press that can begin a pan), never on a move: the caller refreshes the cached `freeArea` here. */
	onDragStart?: () => void;
	/**
	 * Asked once when a drag turns into a pan: true moves the wrapper during this drag and writes the <g> at its end and when empty space shows
	 * (D365 (1)). Absent or false: the <g> is written in each frame.
	 */
	wrapDrag?: () => boolean;
	/** D367: the margin rule, asked with `wrapDrag` (a new size, a set view, the start of a pan). Absent or null: `DRAG_MARGIN`. */
	marginRule?: () => MarginRule | null;
}

/** Wheel zoom counts as settled after this long without another wheel event. */
const WHEEL_SETTLE_MS = 180;
/** Presses here are not gestures: HTML controls on top of the tree handle their own. */
const CONTROLS = '.dynasty-toolbar, .dynasty-popover, .dynasty-result';
/** A press on these is not on the empty background (no double-tap zoom there). */
const TARGETS = ['.dynasty-card', ...SCENE_TAP_GROUPS, ...SCENE_TAP_TARGETS, '.dynasty-toolbar', '.dynasty-popover', '.dynasty-result'].join(', ');

/** The layout rectangle that `view` shows in a viewport of `size`; null when the scale or the size is not positive. The one owner of this conversion. */
export function visibleRect(view: View, size: Size): Rect | null {
	if (!(view.scale > 0) || !(size.w > 0) || !(size.h > 0)) return null;
	return { x: view.cx - size.w / 2 / view.scale, y: view.cy - size.h / 2 / view.scale, w: size.w / view.scale, h: size.h / view.scale };
}

/** The class that turns on the wrapper transform (styles.css). */
export const GESTURE_CLASS = 'dynasty-gesture';

/** The class of a wrapper whose <svg> is larger than the screen (D366); the style sheet reads the four custom properties of the <svg>. */
export const MARGIN_CLASS = 'dynasty-margin';

/**
 * The CSS transform (origin at the wrapper's top left corner) that makes the picture drawn at
 * `drawn` look like `view`: a screen point q of the drawn picture goes to k·q + (tx, ty). A tree
 * point p is on screen at (p − c)·s + size/2.
 */
export function gestureTransform(drawn: View, view: View, size: Size): { k: number; tx: number; ty: number } {
	const k = view.scale / drawn.scale;
	return {
		k,
		tx: (size.w / 2) * (1 - k) + (drawn.cx - view.cx) * view.scale,
		ty: (size.h / 2) * (1 - k) + (drawn.cy - view.cy) * view.scale,
	};
}

/**
 * True if everything `view` shows is inside what `drawn` shows (within half a screen px): the
 * wrapper can show `view` from the drawn picture with no empty space at the edges. `drawnSize` is the size of the drawn picture when it is larger than the screen (D366).
 */
export function covers(drawn: View, view: View, size: Size, drawnSize: Size = size): boolean {
	const e = 0.5;
	const tol = e / drawn.scale;
	return (
		view.cx - size.w / 2 / view.scale >= drawn.cx - drawnSize.w / 2 / drawn.scale - tol &&
		view.cx + size.w / 2 / view.scale <= drawn.cx + drawnSize.w / 2 / drawn.scale + tol &&
		view.cy - size.h / 2 / view.scale >= drawn.cy - drawnSize.h / 2 / drawn.scale - tol &&
		view.cy + size.h / 2 / view.scale <= drawn.cy + drawnSize.h / 2 / drawn.scale + tol
	);
}

/** D19: while a pinch leaves empty space, the real view is drawn at most this often ("about 4 times per second"). */
export const FILL_MS = 250;

/**
 * D367: the margin rule of the wrapped path. A number is screens on each side (0.5 is 4 times the area of the screen, 1 is 9 times, 3 is 49 times); `range` is the
 * whole pan range at the drawn zoom, up to `RANGE_CAP_PX` on each side.
 */
export type MarginRule = number | 'range';

/**
 * D366, D367: the margin rule of the release: the whole pan range, up to `RANGE_CAP_PX` on each side. The fourth iPhone drag test chose it: the only size with no
 * fill write in a swipe (0 against 25 for 1 screen and 8 for 3 screens), with no close and no empty card, and a press cost equal to 3 screens.
 */
export const DRAG_MARGIN: MarginRule = 'range';

/**
 * D367: the most px that `range` draws past the screen on one side. Desktop WebKit 27.2, the 1,000-person tree at zoom 1 (the margin-cost measure of D367): a
 * wrapper move (0.03 ms), a 1-second wrapper pan (65 frames), a <g> write (22 ms) and the memory of the WebKit processes (within 3 MB) were the same with no
 * margin and with this cap on each side (842 times the area of the screen), with and without a layer, and also with the whole range of that tree (11,021 px).
 * The cap stays at a common texture limit of phone graphics chips, in case a layer ever holds the picture; at zoom 1 it is 32 swipes of 250 px before a fill.
 */
export const RANGE_CAP_PX = 8192;

/**
 * The margin of the drawn picture in px past each side of the screen under `rule` for `view`: `x` on the left and on the right, `y` above and below. A number is
 * screens of `size`. `range` holds every view a pan can reach at the zoom of `view`, from any view of that zoom (the centre stays inside `panLimits`, widened to hold
 * `view` as `clampFrom` does): the whole pan range on each side, up to `cap` px; beyond it, the fill draws the picture again. Both sides get the same margin, and
 * every view of one zoom the same, because a new place or size of the <svg> costs WebKit a second layout of all SVG text (47 ms against 23 ms for a <g> write
 * alone, desktop WebKit, 1,000 people): the box changes only with the zoom, and `drawScene` keeps a larger one.
 */
export function marginFor(rule: MarginRule, view: View, bounds: Rect, size: Size, free?: FreeArea, cap = RANGE_CAP_PX): Point {
	const s = view.scale;
	if (rule !== 'range') return { x: Math.round(size.w * rule), y: Math.round(size.h * rule) };
	const l = panLimits(bounds, s, size, free);
	const span = (lo: number, hi: number, c: number) => Math.min(cap, Math.max(0, Math.ceil((Math.max(hi, c) - Math.min(lo, c)) * s - 1e-6))) || 0;
	return { x: span(l.x0, l.x1, view.cx), y: span(l.y0, l.y1, view.cy) };
}

/**
 * When a pinch frame must draw the real view (D19): the wrapped picture leaves empty space in the
 * viewport, and the last real drawing is at least `FILL_MS` old. Otherwise, the time in ms until a
 * fill is due (0 when the picture covers the viewport, so none is due).
 */
export function fillDue(drawn: View, view: View, size: Size, now: number, drawnAt: number, drawnSize: Size = size): { fill: boolean; waitMs: number } {
	if (covers(drawn, view, size, drawnSize)) return { fill: false, waitMs: 0 };
	const wait = drawnAt + FILL_MS - now;
	return wait <= 0 ? { fill: true, waitMs: 0 } : { fill: false, waitMs: wait };
}

/** `gestureTransform` as a CSS `matrix()`, rounded as `transformFor` is: 9 significant digits for the scale, 0.001 px for the move. */
export function gestureMatrix(drawn: View, view: View, size: Size): string {
	const { k, tx, ty } = gestureTransform(drawn, view, size);
	const r = (n: number) => Math.round(n * 1000) / 1000;
	const s = Number(k.toPrecision(9));
	return `matrix(${s}, 0, 0, ${s}, ${r(tx)}, ${r(ty)})`;
}

interface Drag {
	id: number;
	x: number;
	y: number;
	start: View;
	panning: boolean;
	type: string;
	onBackground: boolean;
	/** This pan moves the wrapper and not the <g> (`wrapDrag`). */
	wrap?: boolean;
}

/**
 * `clampTo` with the limits widened to hold `from`. A pinch can leave the view outside the pan
 * limits (it keeps the tree point under the fingers); a pan or wheel that follows then moves on from
 * there, never further out, and never jumps back to the limit.
 */
function clampFrom(view: View, from: View, bounds: Rect, size: Size, free: FreeArea | undefined): View {
	const l = panLimits(bounds, view.scale, size, free);
	return clampTo(view, { x0: Math.min(l.x0, from.cx), x1: Math.max(l.x1, from.cx), y0: Math.min(l.y0, from.cy), y1: Math.max(l.y1, from.cy) });
}

interface Pinch {
	ids: [number, number];
	from: [Point, Point];
	start: View;
}

/** Runs pan, zoom, pinch and double-tap gestures on one tree, and settles on a `View` for the caller. */
export class PanZoom {
	view: View | null = null;
	size: Size = { w: 0, h: 0 };
	private frame = 0;
	private settleTimer = 0;
	private drag: Drag | null = null;
	private pinch: Pinch | null = null;
	/** Pointers down in the viewport (full screen), in viewport px. */
	private readonly pointers = new Map<number, Point>();
	private lastTap: { t: number; p: Point } | null = null;
	private suppressClick = false;
	/**
	 * The view and size the scene's transform attribute shows, the margin of the drawn picture in px on each side (fixed at this write; the custom properties of
	 * the <svg> hold it too), the `marginKey` it was drawn under, and when it was drawn.
	 */
	private drawn: { view: View; size: Size; margin: Point; key: MarginRule | null; at: number } | null = null;
	/**
	 * D366, D367: the margin rule of the drawn picture, or null when it has no margin (only the wrapped path of the full-screen view has one). Asked at `resize`,
	 * `setView` and the start of a pan; a drawn picture of another key is stale.
	 */
	private marginKey: MarginRule | null = null;
	/** D366: the lift of a wrapped drag kept the wrapper transform; the next frame shows the view by it and writes no <g>. Ends at the next view change of another kind. */
	private holdRest = false;
	/** A D19 fill that waits for its time while the fingers do not move. */
	private fillTimer = 0;
	/** The frame that runs the settle of a pan, after its pointer-up handler. */
	private settleFrame = 0;
	/** The wrapper transform is on (a pinch runs). */
	private wrapped = false;
	private firstDrawn = false;
	/** The rectangle of the last fill or settle, and whether a wheel zoom runs. A plain pan never fills. */
	private filled: Rect | null = null;
	private wheelZoom = false;
	private readonly off: (() => void)[] = [];

	constructor(private readonly o: PanZoomOptions) {
		if (!o.interactive) return;
		const vp = o.viewport;
		this.listen(vp, 'pointerdown', (e) => this.down(e as PointerEvent));
		this.listen(vp, 'pointermove', (e) => this.move(e as PointerEvent));
		this.listen(vp, 'pointerup', (e) => this.up(e as PointerEvent, false));
		this.listen(vp, 'pointercancel', (e) => this.up(e as PointerEvent, true));
		// Only the viewport's own capture counts: a touch is first captured by the element under the
		// finger, and that element's lostpointercapture bubbles up here when the pan takes the capture.
		this.listen(vp, 'lostpointercapture', (e) => {
			if (e.target === vp) this.up(e as PointerEvent, true);
		});
		// A pan never counts as a click (spec §7.2).
		this.listen(vp, 'click', (e) => {
			if (!this.suppressClick) return;
			this.suppressClick = false;
			e.stopPropagation();
			e.preventDefault();
		}, { capture: true });
		this.listen(vp, 'wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
	}

	private get full(): boolean {
		return this.o.mode === 'full';
	}

	private listen(el: HTMLElement, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
		const safe = (e: Event) => this.o.guard(() => fn(e));
		el.addEventListener(type, safe, opts);
		this.off.push(() => el.removeEventListener(type, safe, opts));
	}

	/** The tree was laid out again with other bounds (the note preview is drawn again in place after a fold or an edit). */
	setBounds(bounds: Rect): void {
		this.o.bounds = bounds;
	}

	/** The current scale limits, from the bounds, viewport size and font size. */
	get limits() {
		return scaleLimits(this.o.bounds, this.size, this.o.fontPx);
	}

	/** True while a press may still become a pan, or a pan or pinch runs. */
	get busy(): boolean {
		return this.drag !== null || this.pinch !== null;
	}

	/** The viewport changed size: re-applies the current view to the new size. */
	resize(size: Size): void {
		const same = size.w === this.size.w && size.h === this.size.h;
		this.size = size;
		this.askMargin();
		// The same size shows the same picture; a write here would end the rest transform of a lifted wrapped drag for nothing.
		if (same && this.drawn) return;
		this.holdRest = false;
		this.schedule();
	}

	/** D366: the margin follows the path of the drag. Only the full-screen view has one (a note keeps bars above the tree, and a finger never pans it on a phone). */
	private askMargin(): void {
		this.marginKey = this.full && !!this.o.wrapper && (this.o.wrapDrag?.() ?? false) ? (this.o.marginRule?.() ?? DRAG_MARGIN) : null;
	}

	/** The size of the picture the <g> draws into: the screen and the margin. */
	private drawSize(m: Point): Size {
		return { w: this.size.w + 2 * m.x, h: this.size.h + 2 * m.y };
	}

	/**
	 * Writes the real `view` on the scene, with the margin of the rule that holds now, and keeps what was drawn. The margin is fixed here and nowhere else. The margin
	 * properties and the <g> change in the same task, so one layout. `grow` false (a frame of a wheel zoom) keeps the box of the same path, rule and size.
	 */
	private drawScene(view: View, grow = true): void {
		const d = this.drawn;
		const key = this.marginKey;
		const need = key === null ? { x: 0, y: 0 } : marginFor(key, view, this.o.bounds, this.size, this.o.freeArea?.());
		// The box of the <svg> stays while it holds what this view needs (same path, rule and size): a new place or size of the <svg> costs WebKit a second text layout.
		const m = d && d.key === key && d.size.w === this.size.w && d.size.h === this.size.h && (!grow || (d.margin.x >= need.x && d.margin.y >= need.y)) ? d.margin : need;
		const w = this.o.wrapper;
		if (w && (m.x !== (d?.margin.x ?? 0) || m.y !== (d?.margin.y ?? 0))) {
			// On the <svg> itself: the properties do not inherit (styles/01-base.css), and the rule that offsets and widens the picture is on the <svg>.
			const svg = this.o.scene.parentElement as unknown as SVGElement | null;
			svg?.setCssProps({ '--dynasty-margin-left': `${m.x}px`, '--dynasty-margin-right': `${m.x}px`, '--dynasty-margin-top': `${m.y}px`, '--dynasty-margin-bottom': `${m.y}px` });
			w.toggleClass(MARGIN_CLASS, m.x > 0 || m.y > 0);
		}
		this.o.scene.setAttribute('transform', transformFor(view, this.drawSize(m)));
		this.drawn = { view, size: this.size, margin: m, key, at: performance.now() };
	}

	/** Shows `view` in the next frame (never a slide, D235) and settles on it. */
	setView(view: View, opts: { byUser?: boolean } = {}): void {
		this.view = view;
		this.holdRest = false;
		this.askMargin();
		this.schedule();
		this.settled(view, opts.byUser ?? false);
	}

	/** Calls `onSettle` and keeps the rectangle that the caller has filled for this view. */
	private settled(view: View, byUser: boolean): void {
		this.filled = visibleRect(view, this.size);
		this.o.onSettle(view, byUser);
	}

	/**
	 * True when a fill is due: the visible rectangle leaves the last filled one, grown by `k` of its size on each side (and half a px). The visible rectangle then
	 * counts as filled. A wheel zoom fills when it leaves the rectangle itself (`k` 0), at most once per frame, as `apply` runs once per frame; a wrapped gesture
	 * with a margin wider than one screen fills ahead (D367, see the header) at half of the band.
	 */
	private leftFill(k: number): boolean {
		const r = this.view && this.o.onFill ? visibleRect(this.view, this.size) : null;
		const f = this.filled;
		if (!r) return false;
		const ex = f ? f.w * k + 0.5 : 0;
		const ey = f ? f.h * k + 0.5 : 0;
		if (f && r.x >= f.x - ex && r.y >= f.y - ey && r.x + r.w <= f.x + f.w + ex && r.y + r.h <= f.y + f.h + ey) return false;
		this.filled = r;
		return true;
	}

	private schedule(): void {
		if (this.frame) return;
		const win = this.o.viewport.win;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = 0;
			this.o.guard(() => this.apply());
		});
	}

	private apply(): void {
		if (!this.view || this.size.w <= 0 || this.size.h <= 0) return;
		const w = this.o.wrapper;
		const d = this.drawn;
		// The margin of the drawn picture is not computed again here: the kept box of `range` can be larger than a new computation, and a mismatch would make the
		// first move of a press write the <g>.
		const sameSize = !!d && d.size.w === this.size.w && d.size.h === this.size.h && d.key === this.marginKey && d.view.scale > 0;
		const win = this.o.viewport.win;
		if (this.fillTimer) {
			win.clearTimeout(this.fillTimer);
			this.fillTimer = 0;
		}
		const wrapping = this.pinch !== null || (this.drag?.panning === true && this.drag.wrap === true) || this.holdRest;
		if (w && d && sameSize && wrapping) {
			const due = fillDue(d.view, this.view, this.size, performance.now(), d.at, this.drawSize(d.margin));
			if (due.fill) {
				// Draw the real view under the pinch and go on wrapping from it (D19). The class stays,
				// so the wrapper keeps its layer.
				this.drawScene(this.view);
				w.setCssProps({ '--dynasty-gesture-transform': 'matrix(1, 0, 0, 1, 0, 0)' });
				this.filled = visibleRect(this.view, this.size);
				this.o.onFill?.(this.view);
				return;
			}
			w.style.setProperty('--dynasty-gesture-transform', gestureMatrix(d.view, this.view, this.size));
			if (!this.wrapped) {
				w.addClass(GESTURE_CLASS);
				this.wrapped = true;
			}
			// The fingers can rest with empty space on screen: the fill still comes on time.
			if (due.waitMs > 0) {
				this.fillTimer = win.setTimeout(() => {
					this.fillTimer = 0;
					this.o.guard(() => this.schedule());
				}, due.waitMs);
			}
			if ((d.margin.x > this.size.w || d.margin.y > this.size.h) && this.leftFill(0.5)) this.o.onFill?.(this.view, true);
			return;
		}
		// The picture already shows this view (a pinch or wheel zoom that ended on the view it was drawn at): no second write, so no second text layout.
		const shown = !!d && sameSize && d.view.scale === this.view.scale && d.view.cx === this.view.cx && d.view.cy === this.view.cy;
		// A wheel zoom draws in each frame; a new box in each of them would be a second text layout each time.
		if (!shown) this.drawScene(this.view, !this.wheelZoom);
		this.holdRest = false;
		if (this.wrapped && w) {
			w.removeClass(GESTURE_CLASS);
			w.setCssProps({ '--dynasty-gesture-transform': 'none' });
		}
		this.wrapped = false;
		if (this.wheelZoom && this.leftFill(0)) this.o.onFill?.(this.view);
		// After the first write only: `onSettle` runs inside `setView`, before this write, so it cannot serve. The flag is set first so a throwing hook does not run twice.
		if (!this.firstDrawn) {
			this.firstDrawn = true;
			this.o.onFirstDraw?.(this.view);
		}
	}

	/** The screen top of the drawing area: the viewport's top plus the bands above the tree. */
	private areaTop(): { left: number; top: number } {
		const r = this.o.viewport.getBoundingClientRect();
		const band = this.o.frameTop?.() ?? 0;
		return { left: r.left, top: r.top + (Number.isFinite(band) ? band : 0) };
	}

	private local(e: PointerEvent | WheelEvent): Point {
		const r = this.areaTop();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private capture(id: number): void {
		try {
			this.o.viewport.setPointerCapture(id);
		} catch {
			// The pointer can already be gone; the gesture still works without capture.
		}
	}

	private down(e: PointerEvent): void {
		if (!this.view || (e.target as Element | null)?.closest(CONTROLS)) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (!this.full) {
			if (e.pointerType !== 'mouse' || !e.isPrimary) return;
			this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.view, panning: false, type: e.pointerType, onBackground: false };
			return;
		}
		this.pointers.set(e.pointerId, this.local(e));
		if (this.pinch) return;
		if (this.pointers.size === 1) {
			const onBackground = !(e.target as Element | null)?.closest(TARGETS);
			this.o.guard(() => this.o.onDragStart?.());
			this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.view, panning: false, type: e.pointerType, onBackground };
			return;
		}
		// A second finger: the pan (or the tap) becomes a pinch, which never opens a sheet.
		const ids = [...this.pointers.keys()].slice(0, 2) as [number, number];
		const pts = ids.map((id) => this.pointers.get(id)!) as [Point, Point];
		this.drag = null;
		this.lastTap = null;
		this.holdRest = false;
		this.pinch = { ids, from: pts, start: this.view };
		for (const id of ids) this.capture(id);
		if (e.pointerType !== 'touch') this.o.viewport.addClass('dynasty-panning');
	}

	private move(e: PointerEvent): void {
		if (this.full && this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, this.local(e));
		const p = this.pinch;
		if (p) {
			if (!p.ids.includes(e.pointerId)) return;
			e.preventDefault();
			const a = this.pointers.get(p.ids[0]);
			const b = this.pointers.get(p.ids[1]);
			if (!a || !b) return;
			this.view = pinchView(p.start, p.from, [a, b], this.size, this.limits);
			this.schedule();
			return;
		}
		const d = this.drag;
		if (d?.id !== e.pointerId) return;
		const dx = e.clientX - d.x;
		const dy = e.clientY - d.y;
		if (!d.panning) {
			if (!isPan(dx, dy)) return;
			d.panning = true;
			d.wrap = !!this.o.wrapper && (this.o.wrapDrag?.() ?? false);
			this.askMargin();
			this.holdRest = false;
			this.lastTap = null;
			this.capture(e.pointerId);
			// Only a mouse or pen shows the grab cursor. The class restyles every element of the tree (the
			// cursor is inherited): on a phone that cost one long frame at the start of each pan.
			if (e.pointerType !== 'touch') this.o.viewport.addClass('dynasty-panning');
		}
		e.preventDefault();
		this.view = clampFrom(panFrom(d.start, dx, dy), d.start, this.o.bounds, this.size, this.o.freeArea?.());
		this.schedule();
	}

	private up(e: PointerEvent, cancelled: boolean): void {
		const had = this.pointers.delete(e.pointerId);
		const p = this.pinch;
		if (p) {
			if (!p.ids.includes(e.pointerId)) return;
			this.pinch = null;
			// The next frame puts the real view on the scene and takes the wrapper transform away.
			this.schedule();
			// The finger that stays down goes on panning from here.
			const [restId, rest] = [...this.pointers][0] ?? [];
			if (restId !== undefined && rest && this.view) {
				const r = this.areaTop();
				// The finger left after a pinch pans on: on iOS it moves the wrapper too, as a fresh drag would (D365 (1)).
				this.drag = { id: restId, x: rest.x + r.left, y: rest.y + r.top, start: this.view, panning: true, type: 'touch', onBackground: false, wrap: !!this.o.wrapper && (this.o.wrapDrag?.() ?? false) };
				return;
			}
			this.endPan(e.pointerId);
			return;
		}
		const d = this.drag;
		if (d?.id !== e.pointerId || (!had && this.full)) {
			if (d?.id === e.pointerId) this.drag = null;
			return;
		}
		this.drag = null;
		if (d.panning) {
			this.endPan(e.pointerId, d.wrap === true);
			return;
		}
		if (cancelled || !this.full || d.type === 'mouse' || !d.onBackground) return;
		// A tap on empty background: the second one of a double-tap zooms 2× at that point (spec §7.2).
		const now = performance.now();
		const at = this.local(e);
		const last = this.lastTap;
		if (last && isDoubleTap(last.t, last.p, now, at) && this.view) {
			this.lastTap = null;
			this.setView(doubleTapView(this.view, at, this.size, this.limits), { byUser: true });
			return;
		}
		this.lastTap = { t: now, p: at };
	}

	private endPan(pointerId: number, wrapDrag = false): void {
		this.o.viewport.removeClass('dynasty-panning');
		try {
			if (this.o.viewport.hasPointerCapture(pointerId)) this.o.viewport.releasePointerCapture(pointerId);
		} catch {
			// Already released.
		}
		// The click that follows this pointerup is part of the pan.
		this.suppressClick = true;
		this.o.viewport.win.setTimeout(() => this.o.guard(() => (this.suppressClick = false)), 0);
		if (wrapDrag && this.holdAtLift()) {
			// D366: the picture still covers the view: no <g> write, so no text layout of the whole tree at the lift. A frame sets the final wrapper transform.
			this.holdRest = true;
			this.schedule();
		} else if (this.wrapped) {
			// A wrapped drag shows the real view in the frame that follows, before the settle frame reads it.
			this.schedule();
		}
		this.settleSoon();
	}

	/**
	 * True when the wrapper can keep showing the view from the drawn picture: same size and margin, the picture covers the view, and the scale is the one it was drawn
	 * at (a scaled picture at rest would be soft). The view moves to the nearest device pixel of the picture first, so the text at rest does not sit on a part of a pixel;
	 * the move is under one device pixel (0.17 px on an iPhone).
	 */
	private holdAtLift(): boolean {
		const d = this.drawn;
		const v = this.view;
		// Only with the margin (the full-screen view): a note view writes the <g> at the lift as before.
		if (this.marginKey === null || !d || !v || d.size.w !== this.size.w || d.size.h !== this.size.h) return false;
		if (d.key !== this.marginKey || Math.abs(v.scale / d.view.scale - 1) > 1e-9) return false;
		const size = this.drawSize(d.margin);
		if (!covers(d.view, v, this.size, size)) return false;
		const dpr = this.o.viewport.win.devicePixelRatio || 1;
		const snap = (move: number) => Math.round(move * dpr) / dpr;
		const next = { ...v, cx: d.view.cx - snap((d.view.cx - v.cx) * v.scale) / v.scale, cy: d.view.cy - snap((d.view.cy - v.cy) * v.scale) / v.scale };
		// The snap must not push a view that a pan limit stopped past that limit; then the unsnapped view stays.
		const kept = clampFrom(next, v, this.o.bounds, this.size, this.o.freeArea?.());
		if (covers(d.view, next, this.size, size) && kept.cx === next.cx && kept.cy === next.cy) this.view = next;
		return true;
	}

	/**
	 * The work at the end of a pan (level of detail, fills, saving the view) runs in the next frame, not in the pointer-up
	 * handler, so the handler returns at once and the browser can paint. The settle reads the view of that frame.
	 */
	private settleSoon(): void {
		if (this.settleFrame) return;
		const win = this.o.viewport.win;
		this.settleFrame = win.requestAnimationFrame(() => {
			this.settleFrame = 0;
			this.o.guard(() => {
				if (this.view) this.settled(this.view, true);
			});
		});
	}

	private wheel(e: WheelEvent): void {
		if (!this.view) return;
		const zoom = e.ctrlKey || e.metaKey;
		if (!zoom && !this.full) return;
		// A plain wheel over the legend or the problem list scrolls that list, as a press there is its own.
		if (!zoom && (e.target as Element | null)?.closest(CONTROLS)) return;
		e.preventDefault();
		e.stopPropagation();
		this.holdRest = false;
		if (zoom) {
			const at = this.local(e);
			this.wheelZoom = true;
			this.view = zoomAt(this.view, wheelFactor(e.deltaY, e.deltaMode), at.x, at.y, this.size, this.limits);
		} else {
			const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size.h : 1;
			// Shift+wheel on a mouse scrolls sideways; some systems send it as a vertical delta.
			const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
			const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
			this.view = clampFrom(panFrom(this.view, -dx, -dy), this.view, this.o.bounds, this.size, this.o.freeArea?.());
		}
		this.schedule();
		const win = this.o.viewport.win;
		win.clearTimeout(this.settleTimer);
		this.settleTimer = win.setTimeout(() => {
			this.o.guard(() => {
				this.wheelZoom = false;
				if (this.view) this.settled(this.view, true);
			});
		}, WHEEL_SETTLE_MS);
	}

	/** Removes all listeners and timers; called when the tree view tears down its scene. */
	destroy(): void {
		this.holdRest = false;
		for (const f of this.off.splice(0)) f();
		const win = this.o.viewport.win;
		if (this.frame) win.cancelAnimationFrame(this.frame);
		win.clearTimeout(this.settleTimer);
		win.clearTimeout(this.fillTimer);
		this.fillTimer = 0;
		if (this.settleFrame) win.cancelAnimationFrame(this.settleFrame);
		this.settleFrame = 0;
		this.frame = 0;
		this.drag = null;
		this.pinch = null;
		this.pointers.clear();
		if (this.wrapped) this.o.wrapper?.removeClass(GESTURE_CLASS);
		this.wrapped = false;
	}
}
