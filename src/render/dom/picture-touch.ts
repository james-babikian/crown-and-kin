/*
 * The touch of the picture viewer (spec §0 D256): a pinch and a double tap zoom the picture, one finger moves it while it is zoomed, and a sideways swipe
 * at rest changes the picture. Only touch and pen pointers count; a mouse does nothing here (a computer has no zoom). The swipe down that closes the sheet
 * (`sheet-swipe.ts`) is off while the picture is zoomed (its `enabled` hook asks `zoomed()`), and a second finger ends a swipe that has begun. The maths is in
 * `picture-gestures.ts`.
 */

import { REST, doubleTapView, isDoubleTap, isTap, panView, pinchView, settleView, sideSwipe, type Point, type Size, type View } from './picture-gestures';

/** What the touch code needs from the viewer. */
export interface TouchHooks {
	/** The element that takes the touch. */
	stage: HTMLElement;
	/** The size of the shown picture and of the stage now; null while no picture shows. */
	sizes(): { shown: Size; stage: Size } | null;
	/** The view changed: draw it. */
	apply(v: View): void;
	/** A sideways swipe at rest: 1 for the next picture, -1 for the one before. */
	side(dir: 1 | -1): void;
}

/** The handle of the touch code. */
export interface PictureTouch {
	view(): View;
	zoomed(): boolean;
	/** Back to rest (a new picture). */
	reset(): void;
	/** Keeps the zoom and the move but lets them fit new sizes (the stage changed). */
	refit(): void;
	dispose(): void;
}

interface Finger {
	x: number;
	y: number;
	x0: number;
	y0: number;
	t0: number;
}

/** The touch state of one stage. A class, so each step is a short method. */
class StageTouch implements PictureTouch {
	private readonly fingers = new Map<number, Finger>();
	private v: View = REST;
	private pinch: { start: View; mid: Point; dist: number } | null = null;
	// A gesture that had two fingers is neither a tap nor a swipe, even when one finger lifts first.
	private multi = false;
	private lastTap: { t: number; x: number; y: number } | null = null;
	private readonly listeners: [string, (e: PointerEvent) => void][];

	constructor(private readonly hooks: TouchHooks) {
		const guard = (fn: (e: PointerEvent) => void) => (e: PointerEvent) => {
			try {
				fn(e);
			} catch (err) {
				console.error('Crown and Kin: the picture touch failed', err);
			}
		};
		this.listeners = [
			['pointerdown', guard((e) => this.down(e))],
			['pointermove', guard((e) => this.move(e))],
			['pointerup', guard((e) => this.up(e, false))],
			['pointercancel', guard((e) => this.up(e, true))],
			// The swipe down of the sheet takes the pointer from the stage: the stage then hears no more of that finger.
			['lostpointercapture', guard((e) => this.lost(e))],
		];
		for (const [type, fn] of this.listeners) hooks.stage.addEventListener(type, fn as EventListener);
	}

	view = (): View => this.v;
	zoomed = (): boolean => this.v.scale > 1;

	reset(): void {
		this.fingers.clear();
		this.pinch = null;
		this.multi = false;
		this.lastTap = null;
		this.set(REST);
	}

	refit(): void {
		const s = this.hooks.sizes();
		if (s && this.v.scale > 1) this.set(panView(this.v, 0, 0, s.shown, s.stage));
	}

	dispose(): void {
		for (const [type, fn] of this.listeners) this.hooks.stage.removeEventListener(type, fn as EventListener);
		this.fingers.clear();
	}

	private set(v: View): void {
		this.v = v;
		this.hooks.apply(v);
	}

	/** A point from the centre of the stage. */
	private centre(x: number, y: number): Point {
		const r = this.hooks.stage.getBoundingClientRect();
		return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
	}

	private pair(): { mid: Point; dist: number } | null {
		const [a, b] = [...this.fingers.values()];
		if (!a || !b) return null;
		return { mid: this.centre((a.x + b.x) / 2, (a.y + b.y) / 2), dist: Math.hypot(a.x - b.x, a.y - b.y) };
	}

	private down(e: PointerEvent): void {
		if (e.pointerType === 'mouse') return;
		this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
		try {
			this.hooks.stage.setPointerCapture(e.pointerId);
		} catch {
			/* a pointer that is gone: the moves stop by themselves */
		}
		if (this.fingers.size !== 2) return;
		this.multi = true;
		this.lastTap = null;
		const p = this.pair();
		this.pinch = p ? { start: this.v, mid: p.mid, dist: p.dist } : null;
	}

	private move(e: PointerEvent): void {
		const f = this.fingers.get(e.pointerId);
		const s = this.hooks.sizes();
		if (!f || !s) return;
		const dx = e.clientX - f.x;
		const dy = e.clientY - f.y;
		f.x = e.clientX;
		f.y = e.clientY;
		if (this.fingers.size === 2 && this.pinch) {
			const now = this.pair();
			if (now) this.set(pinchView(this.pinch.start, this.pinch, now, s.shown, s.stage));
		} else if (this.fingers.size === 1 && this.v.scale > 1) this.set(panView(this.v, dx, dy, s.shown, s.stage));
	}

	private up(e: PointerEvent, cancelled: boolean): void {
		const f = this.fingers.get(e.pointerId);
		if (!f) return;
		this.fingers.delete(e.pointerId);
		try {
			this.hooks.stage.releasePointerCapture(e.pointerId);
		} catch {
			/* nothing was captured */
		}
		if (this.pinch) {
			this.pinch = null;
			this.set(settleView(this.v));
		}
		if (this.fingers.size > 0) return;
		const was = this.multi;
		this.multi = false;
		const s = this.hooks.sizes();
		if (!was && !cancelled && s) this.ended(e, f, s);
	}

	/** The last finger lifted after a gesture of one finger: a tap, a double tap or a sideways swipe. */
	private ended(e: PointerEvent, f: Finger, s: { shown: Size; stage: Size }): void {
		const dx = e.clientX - f.x0;
		const dy = e.clientY - f.y0;
		const t = performance.now();
		if (isTap(dx, dy)) {
			const now = { t, x: e.clientX, y: e.clientY };
			if (isDoubleTap(this.lastTap, now)) {
				this.lastTap = null;
				this.set(doubleTapView(this.v, this.centre(e.clientX, e.clientY), s.shown, s.stage));
			} else this.lastTap = now;
		} else if (this.v.scale <= 1) {
			const dir = sideSwipe(dx, dy, t - f.t0);
			if (dir !== 0) this.hooks.side(dir);
		}
	}

	private lost(e: PointerEvent): void {
		this.fingers.delete(e.pointerId);
		if (this.fingers.size === 0) {
			this.pinch = null;
			this.multi = false;
		}
	}
}

/** Attaches the touch code to `hooks.stage`. */
export function attachPictureTouch(hooks: TouchHooks): PictureTouch {
	return new StageTouch(hooks);
}
