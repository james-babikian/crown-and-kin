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
 * Embedded ('embed'): only a mouse pans. A finger or a pen never pans an embedded tree, also on a
 * laptop with a touchscreen: the drag scrolls the note (CSS touch-action: pan-y). A plain wheel is
 * left to the note; Ctrl/Cmd+wheel (and a trackpad pinch, which arrives as Ctrl+wheel) zooms.
 * Full screen ('full'): every pointer pans with one finger or the mouse, two fingers pinch, a
 * double-tap on empty background zooms 2×, a plain wheel pans and Ctrl/Cmd+wheel zooms.
 *
 * M11 (spec §13.15): the tree view attaches card content that is near the view. `onFirstDraw` runs once,
 * right after the first write of the scene transform, in the same task (`onSettle` cannot do this: it runs
 * before that write). `onFill` also runs during a wheel or trackpad zoom, but only when
 * the visible rectangle leaves the last filled one and at most once for each frame. A drag pan never
 * fills; it ends at its settle. `visibleRect` is the one owner of the conversion from a `View` and the
 * viewport size to a layout `Rect`.
 *
 * 0.3 (D235): no view change slides. `setView` shows the new view in the next frame, whatever the caller: Fit, Find, the reveal after an
 * edit and the double tap. In the full-screen view a drag or wheel pan of a tree that is smaller than the free area (`freeArea`: the space
 * between the bars) keeps the whole tree inside that area (D222, `panLimits`).
 */

import type { Rect } from '../../layout/model';
import { clampTo, doubleTapView, isDoubleTap, isPan, panFrom, panLimits, pinchView, scaleLimits, transformFor, wheelFactor, zoomAt, type FreeArea, type Point, type Size, type View } from '../view-math';

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
	/** A pinch drew the real view to fill empty space (D19); the pinch goes on. */
	onFill?: (view: View) => void;
	/** Once, right after the first write of the scene transform, in the same task. No pan, pinch, wheel zoom or later `setView` calls it. */
	onFirstDraw?: (view: View) => void;
	/** Runs an entry point (event, frame, timer) so that an error cannot escape into Obsidian (spec §8). */
	guard: (fn: () => void) => void;
	/**
	 * D222: the bars of the full-screen view, in screen px (cached values, never a read of the page on a pointer move). A drag or wheel pan of a tree that is smaller
	 * than the free area between them keeps the whole tree inside that area. Absent: the 0.2.8 limits.
	 */
	freeArea?: () => FreeArea;
	/** Once at the start of each drag (a press that can begin a pan), never on a move: the caller refreshes the cached `freeArea` here. */
	onDragStart?: () => void;
}

/** Wheel zoom counts as settled after this long without another wheel event. */
const WHEEL_SETTLE_MS = 180;
/** Presses here are not gestures: HTML controls on top of the tree handle their own. */
const CONTROLS = '.dynasty-toolbar, .dynasty-popover, .dynasty-result';
/** A press on these is not on the empty background (no double-tap zoom there). */
const TARGETS = '.dynasty-card, .dynasty-tag, .dynasty-tag-hit, .dynasty-focus-badge, .dynasty-toolbar, .dynasty-popover, .dynasty-result';

/** The layout rectangle that `view` shows in a viewport of `size`; null when the scale or the size is not positive. The one owner of this conversion. */
export function visibleRect(view: View, size: Size): Rect | null {
	if (!(view.scale > 0) || !(size.w > 0) || !(size.h > 0)) return null;
	return { x: view.cx - size.w / 2 / view.scale, y: view.cy - size.h / 2 / view.scale, w: size.w / view.scale, h: size.h / view.scale };
}

/** The class that turns on the wrapper transform (styles.css). */
export const GESTURE_CLASS = 'dynasty-gesture';

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
 * wrapper can show `view` from the drawn picture with no empty space at the edges.
 */
export function covers(drawn: View, view: View, size: Size): boolean {
	const e = 0.5;
	const hw = (s: number) => size.w / 2 / s;
	const hh = (s: number) => size.h / 2 / s;
	const tol = e / drawn.scale;
	return (
		view.cx - hw(view.scale) >= drawn.cx - hw(drawn.scale) - tol &&
		view.cx + hw(view.scale) <= drawn.cx + hw(drawn.scale) + tol &&
		view.cy - hh(view.scale) >= drawn.cy - hh(drawn.scale) - tol &&
		view.cy + hh(view.scale) <= drawn.cy + hh(drawn.scale) + tol
	);
}

/** D19: while a pinch leaves empty space, the real view is drawn at most this often ("about 4 times per second"). */
export const FILL_MS = 250;

/**
 * When a pinch frame must draw the real view (D19): the wrapped picture leaves empty space in the
 * viewport, and the last real drawing is at least `FILL_MS` old. Otherwise, the time in ms until a
 * fill is due (0 when the picture covers the viewport, so none is due).
 */
export function fillDue(drawn: View, view: View, size: Size, now: number, drawnAt: number): { fill: boolean; waitMs: number } {
	if (covers(drawn, view, size)) return { fill: false, waitMs: 0 };
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
}

/**
 * `clampPan` with the limits widened to hold `from`. A pinch can leave the view outside the pan
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
	/** The view and size the scene's transform attribute shows, and when it was drawn. */
	private drawn: { view: View; size: Size; at: number } | null = null;
	/** A D19 fill that waits for its time while the fingers do not move. */
	private fillTimer = 0;
	/** The frame that runs the settle of a pan, after its pointer-up handler (M11). */
	private settleFrame = 0;
	/** The wrapper transform is on (a pinch runs). */
	private wrapped = false;
	private firstDrawn = false;
	/** M11 (B1): the rectangle of the last fill or settle, and whether a wheel zoom runs. A plain pan never fills. */
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
		this.size = size;
		this.schedule();
	}

	/** Shows `view` in the next frame (never a slide, D235) and settles on it. */
	setView(view: View, opts: { byUser?: boolean } = {}): void {
		this.view = view;
		this.schedule();
		this.settled(view, opts.byUser ?? false);
	}

	/** Calls `onSettle` and keeps the rectangle that the caller has filled for this view. */
	private settled(view: View, byUser: boolean): void {
		this.filled = visibleRect(view, this.size);
		this.o.onSettle(view, byUser);
	}

	/** During a wheel zoom: fills once the view leaves the last filled rectangle. At most once per frame, as `apply` runs once per frame. */
	private fillIfLeft(): void {
		if (!this.view || !this.o.onFill || !this.wheelZoom) return;
		const r = visibleRect(this.view, this.size);
		const f = this.filled;
		if (!r) return;
		const eps = 0.5;
		if (f && r.x >= f.x - eps && r.y >= f.y - eps && r.x + r.w <= f.x + f.w + eps && r.y + r.h <= f.y + f.h + eps) return;
		this.filled = r;
		this.o.onFill(this.view);
	}

	private schedule(): void {
		if (this.frame) return;
		const win = this.o.viewport.win ?? window;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = 0;
			this.o.guard(() => this.apply());
		});
	}

	private apply(): void {
		if (!this.view || this.size.w <= 0 || this.size.h <= 0) return;
		const w = this.o.wrapper;
		const d = this.drawn;
		const sameSize = !!d && d.size.w === this.size.w && d.size.h === this.size.h && d.view.scale > 0;
		const win = this.o.viewport.win ?? window;
		if (this.fillTimer) {
			win.clearTimeout(this.fillTimer);
			this.fillTimer = 0;
		}
		if (w && d && sameSize && this.pinch) {
			const due = fillDue(d.view, this.view, this.size, performance.now(), d.at);
			if (due.fill) {
				// Draw the real view under the pinch and go on wrapping from it (D19). The class stays,
				// so the wrapper keeps its layer.
				this.o.scene.setAttribute('transform', transformFor(this.view, this.size));
				this.drawn = { view: this.view, size: this.size, at: performance.now() };
				w.style.setProperty('--dynasty-gesture-transform', 'matrix(1, 0, 0, 1, 0, 0)');
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
			return;
		}
		// The picture already shows this view (a pinch or wheel zoom that ended on the view it was drawn at): no second write, so no second text layout.
		const shown = !!d && sameSize && d.view.scale === this.view.scale && d.view.cx === this.view.cx && d.view.cy === this.view.cy;
		if (!shown) {
			this.o.scene.setAttribute('transform', transformFor(this.view, this.size));
			this.drawn = { view: this.view, size: this.size, at: performance.now() };
		}
		if (this.wrapped && w) {
			w.removeClass(GESTURE_CLASS);
			w.style.setProperty('--dynasty-gesture-transform', 'none');
		}
		this.wrapped = false;
		this.fillIfLeft();
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
		if (!this.view || (e.target as Element | null)?.closest?.(CONTROLS)) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (!this.full) {
			if (e.pointerType !== 'mouse' || !e.isPrimary) return;
			this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.view, panning: false, type: e.pointerType, onBackground: false };
			return;
		}
		this.pointers.set(e.pointerId, this.local(e));
		if (this.pinch) return;
		if (this.pointers.size === 1) {
			const onBackground = !(e.target as Element | null)?.closest?.(TARGETS);
			this.o.guard(() => this.o.onDragStart?.());
			this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.view, panning: false, type: e.pointerType, onBackground };
			return;
		}
		// A second finger: the pan (or the tap) becomes a pinch, which never opens a sheet.
		const ids = [...this.pointers.keys()].slice(0, 2) as [number, number];
		const pts = ids.map((id) => this.pointers.get(id)!) as [Point, Point];
		this.drag = null;
		this.lastTap = null;
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
		if (!d || d.id !== e.pointerId) return;
		const dx = e.clientX - d.x;
		const dy = e.clientY - d.y;
		if (!d.panning) {
			if (!isPan(dx, dy)) return;
			d.panning = true;
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
				this.drag = { id: restId, x: rest.x + r.left, y: rest.y + r.top, start: this.view, panning: true, type: 'touch', onBackground: false };
				return;
			}
			this.endPan(e.pointerId);
			return;
		}
		const d = this.drag;
		if (!d || d.id !== e.pointerId || (!had && this.full)) {
			if (d && d.id === e.pointerId) this.drag = null;
			return;
		}
		this.drag = null;
		if (d.panning) {
			this.endPan(e.pointerId);
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

	private endPan(pointerId: number): void {
		this.o.viewport.removeClass('dynasty-panning');
		try {
			if (this.o.viewport.hasPointerCapture(pointerId)) this.o.viewport.releasePointerCapture(pointerId);
		} catch {
			// Already released.
		}
		// The click that follows this pointerup is part of the pan.
		this.suppressClick = true;
		(this.o.viewport.win ?? window).setTimeout(() => this.o.guard(() => (this.suppressClick = false)), 0);
		this.settleSoon();
	}

	/**
	 * M11: the work at the end of a pan (level of detail, fills, saving the view) runs in the next frame, not in the pointer-up
	 * handler, so the handler returns at once and the browser can paint. The settle reads the view of that frame.
	 */
	private settleSoon(): void {
		if (this.settleFrame) return;
		const win = this.o.viewport.win ?? window;
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
		if (!zoom && (e.target as Element | null)?.closest?.(CONTROLS)) return;
		e.preventDefault();
		e.stopPropagation();
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
		const win = this.o.viewport.win ?? window;
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
		for (const f of this.off.splice(0)) f();
		const win = this.o.viewport.win ?? window;
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
