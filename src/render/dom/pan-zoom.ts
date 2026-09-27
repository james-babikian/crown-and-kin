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
 * the wrapper goes on from that picture (owner decision D19). An animation (double-tap)
 * uses the wrapper too, but only while it shows a part of the picture already drawn: a zoom out or
 * a move to another part would show empty space.
 *
 * Embedded ('embed'): only a mouse pans. A finger or a pen never pans an embedded tree, also on a
 * laptop with a touchscreen: the drag scrolls the note (CSS touch-action: pan-y). A plain wheel is
 * left to the note; Ctrl/Cmd+wheel (and a trackpad pinch, which arrives as Ctrl+wheel) zooms.
 * Full screen ('full'): every pointer pans with one finger or the mouse, two fingers pinch, a
 * double-tap on empty background zooms 2×, a plain wheel pans and Ctrl/Cmd+wheel zooms.
 */

import type { Rect } from '../../layout/model';
import { clampPan, doubleTapView, isDoubleTap, isPan, panFrom, pinchView, scaleLimits, transformFor, wheelFactor, zoomAt, type Point, type Size, type View } from '../view-math';

/** Everything `PanZoom` needs from the tree view to run gestures on one drawn tree. */
export interface PanZoomOptions {
	viewport: HTMLElement;
	scene: SVGGElement;
	/** The HTML element around the <svg> that takes the CSS transform during a pinch; it fills the viewport from its top left corner. */
	wrapper?: HTMLElement;
	bounds: Rect;
	fontPx: number;
	/** False on a touch-first device: the embedded tree is a static preview (D1). */
	interactive: boolean;
	mode: 'embed' | 'full';
	/** After a gesture or an animation ends. `byUser` is false for views the plugin chose. */
	onSettle: (view: View, byUser: boolean) => void;
	/** A pinch drew the real view to fill empty space (D19); the pinch goes on. */
	onFill?: (view: View) => void;
	/** Runs an entry point (event, frame, timer) so that an error cannot escape into Obsidian (spec §8). */
	guard: (fn: () => void) => void;
}

/** Wheel zoom counts as settled after this long without another wheel event. */
const WHEEL_SETTLE_MS = 180;
const ANIMATE_MS = 280;
/** Presses here are not gestures: HTML controls on top of the tree handle their own. */
const CONTROLS = '.dynasty-toolbar, .dynasty-popover';
/** A press on these is not on the empty background (no double-tap zoom there). */
const TARGETS = '.dynasty-card, .dynasty-tag, .dynasty-tag-hit, .dynasty-focus-badge, .dynasty-toolbar, .dynasty-popover';

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

/** The view `e` (0 to 1, eased) of the way from `from` to `to`: the zoom changes geometrically, so the motion looks even. */
export function animView(from: View, to: View, e: number): View {
	return { scale: from.scale * Math.pow(to.scale / from.scale, e), cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e };
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
function clampFrom(view: View, from: View, bounds: Rect): View {
	const x0 = Math.min(bounds.x, from.cx);
	const y0 = Math.min(bounds.y, from.cy);
	const x1 = Math.max(bounds.x + bounds.w, from.cx);
	const y1 = Math.max(bounds.y + bounds.h, from.cy);
	return clampPan(view, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
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
	private anim: { from: View; to: View; t0: number } | null = null;
	private animSettleUser = false;
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
	/** The wrapper transform is on (a pinch runs). */
	private wrapped = false;
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

	/** The tree was laid out again with other card sizes (the note preview's narrow cards). */
	setBounds(bounds: Rect): void {
		this.o.bounds = bounds;
	}

	/** The current scale limits, from the bounds, viewport size and font size. */
	get limits() {
		return scaleLimits(this.o.bounds, this.size, this.o.fontPx);
	}

	/** True while a press may still become a pan, or a pan, pinch or animation runs. */
	get busy(): boolean {
		return this.drag !== null || this.pinch !== null || this.anim !== null;
	}

	/** The viewport changed size: re-applies the current view (or animation) to the new size. */
	resize(size: Size): void {
		this.size = size;
		this.schedule();
	}

	/** Shows `view` now, or animates to it. */
	setView(view: View, opts: { animate?: boolean; byUser?: boolean } = {}): void {
		if (opts.animate && this.view && this.size.w > 0) {
			this.anim = { from: this.view, to: view, t0: performance.now() };
			this.animSettleUser = opts.byUser ?? false;
			this.schedule();
			return;
		}
		this.anim = null;
		this.view = view;
		this.schedule();
		this.o.onSettle(view, opts.byUser ?? false);
	}

	/** A press or the wheel stops an animation where it is; that view is settled (LOD, shared view). */
	private stopAnim(): void {
		if (!this.anim) return;
		this.anim = null;
		// The next frame puts the view where the animation stopped on the scene (off the wrapper).
		this.schedule();
		if (this.view) this.o.onSettle(this.view, this.animSettleUser);
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
		if (this.anim) {
			const { from, to, t0 } = this.anim;
			const k = Math.min(1, (performance.now() - t0) / ANIMATE_MS);
			this.view = animView(from, to, 1 - Math.pow(1 - k, 3));
			if (k < 1) this.schedule();
			else {
				this.anim = null;
				this.view = to;
				this.o.onSettle(to, this.animSettleUser);
			}
		}
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
		if (w && d && sameSize && this.anim && covers(d.view, this.view, this.size)) {
			w.style.setProperty('--dynasty-gesture-transform', gestureMatrix(d.view, this.view, this.size));
			if (!this.wrapped) {
				w.addClass(GESTURE_CLASS);
				this.wrapped = true;
			}
			return;
		}
		this.o.scene.setAttribute('transform', transformFor(this.view, this.size));
		this.drawn = { view: this.view, size: this.size, at: performance.now() };
		if (this.wrapped && w) {
			w.removeClass(GESTURE_CLASS);
			w.style.setProperty('--dynasty-gesture-transform', 'none');
		}
		this.wrapped = false;
	}

	private local(e: PointerEvent | WheelEvent): Point {
		const r = this.o.viewport.getBoundingClientRect();
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
			this.stopAnim();
			this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: this.view, panning: false, type: e.pointerType, onBackground: false };
			return;
		}
		this.pointers.set(e.pointerId, this.local(e));
		this.stopAnim();
		if (this.pinch) return;
		if (this.pointers.size === 1) {
			const onBackground = !(e.target as Element | null)?.closest?.(TARGETS);
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
		this.view = clampFrom(panFrom(d.start, dx, dy), d.start, this.o.bounds);
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
				const r = this.o.viewport.getBoundingClientRect();
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
			this.setView(doubleTapView(this.view, at, this.size, this.limits), { animate: true, byUser: true });
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
		if (this.view) this.o.onSettle(this.view, true);
	}

	private wheel(e: WheelEvent): void {
		if (!this.view) return;
		const zoom = e.ctrlKey || e.metaKey;
		if (!zoom && !this.full) return;
		// A plain wheel over the legend or the problem list scrolls that list, as a press there is its own.
		if (!zoom && (e.target as Element | null)?.closest?.(CONTROLS)) return;
		e.preventDefault();
		e.stopPropagation();
		this.stopAnim();
		if (zoom) {
			const at = this.local(e);
			this.view = zoomAt(this.view, wheelFactor(e.deltaY, e.deltaMode), at.x, at.y, this.size, this.limits);
		} else {
			const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.size.h : 1;
			// Shift+wheel on a mouse scrolls sideways; some systems send it as a vertical delta.
			const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
			const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
			this.view = clampFrom(panFrom(this.view, -dx, -dy), this.view, this.o.bounds);
		}
		this.schedule();
		const win = this.o.viewport.win ?? window;
		win.clearTimeout(this.settleTimer);
		this.settleTimer = win.setTimeout(() => {
			this.o.guard(() => {
				if (this.view) this.o.onSettle(this.view, true);
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
		this.frame = 0;
		this.anim = null;
		this.drag = null;
		this.pinch = null;
		this.pointers.clear();
		if (this.wrapped) this.o.wrapper?.removeClass(GESTURE_CLASS);
		this.wrapped = false;
	}
}
