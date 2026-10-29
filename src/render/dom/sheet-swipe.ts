/*
 * The swipe down that closes a phone sheet (spec §0 D220). A finger that starts on the grip or the title row, or anywhere on the sheet while its
 * list is scrolled to the top, pulls the sheet down with the finger. On release the sheet closes when the pull is long or fast enough, else it moves back.
 * Only touch pointers count: a mouse drag on a computer does nothing. The sheet moves through one custom property, so a move costs no layout.
 * A sheet that closes stays off the screen until its owner has taken it away (D262): the reset comes with the function that takes the swipe away.
 */

/** A pull of this many px closes the sheet, or of this share of its height, whichever is less. */
export const SWIPE_CLOSE_PX = 100;
/** The share of the height of the sheet that a pull must reach to close it. */
export const SWIPE_CLOSE_SHARE = 0.3;
/** A flick faster than this (px per ms) closes the sheet, however short the pull. */
export const SWIPE_FLICK = 0.5;
/** The finger must move this far before the gesture is judged: a tap never counts as a swipe. */
const SLOP = 6;
/** The speed is measured over this last part of the move (ms). */
const SPEED_WINDOW_MS = 120;
/** The time of the move back or out, when movement is not reduced (ms). */
export const SWIPE_SETTLE_MS = 200;
/** The spots where a swipe starts at any scroll position: the grip and the title row. */
const HANDLES = '.dynasty-sheet-grip, .dynasty-sheet-head';
const PULLED = 'is-pulled';
const SETTLING = 'is-settling';

/** True when a pull of `dy` px on a sheet `height` px high, released at `speed` px per ms, closes the sheet (D220). */
export function swipeCloses(dy: number, height: number, speed: number): boolean {
	return dy >= SWIPE_CLOSE_PX || (height > 0 && dy >= SWIPE_CLOSE_SHARE * height) || speed > SWIPE_FLICK;
}

/** What the swipe needs from its sheet. */
export interface SwipeHooks {
	/** Closes the sheet the way the Close button does (focus back to the opener). */
	close: () => void;
	/** True when movement is reduced (D126): the sheet then closes or snaps back at once. */
	reduced: () => boolean;
	/** False while the sheet must not start a swipe (the picture viewer, while its picture is zoomed). Default: always on. */
	enabled?: () => boolean;
}

/** The speed of the last part of the move, in px per ms (0 for a finger that stood still). */
function releaseSpeed(samples: readonly { t: number; y: number }[]): number {
	const last = samples[samples.length - 1];
	const first = samples.find((s) => last.t - s.t <= SPEED_WINDOW_MS) ?? last;
	return last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
}

interface Track {
	id: number;
	x0: number;
	y0: number;
	/** The finger may start a swipe: it began on a handle, or the list is at its top. */
	eligible: boolean;
	engaged: boolean;
	dy: number;
	samples: { t: number; y: number }[];
}

/**
 * Makes `sheet` close with a swipe down. Returns a function that takes the listeners away, stops a move that is still running and resets the sheet; the code that made the sheet
 * calls it when the sheet is gone (or in the same task as its removal), because a closed sheet keeps its pull until then.
 */
export function attachSheetSwipe(sheet: HTMLElement, hooks: SwipeHooks): () => void {
	let track: Track | null = null;
	let settle: number | null = null;
	// From a closing release to the detach: the sheet takes no new swipe, and nothing brings it back up.
	let closing = false;
	// A touch that ended a swipe over a button must not press it.
	let swallow = false;
	let swallowTimer: number | null = null;
	const win = sheet.win ?? window;

	const guard = (fn: () => void) => {
		try {
			fn();
		} catch (e) {
			console.error('Crown and Kin: the sheet swipe failed', e);
			reset();
		}
	};

	const setPull = (px: number) => sheet.style.setProperty('--dynasty-sheet-pull', `${Math.round(px)}px`);

	function reset(): void {
		if (settle !== null) win.clearTimeout(settle);
		settle = null;
		track = null;
		closing = false;
		sheet.removeClass(PULLED, SETTLING);
		sheet.style.removeProperty('--dynasty-sheet-pull');
	}

	/** Moves the sheet to `px` and runs `then` when it is there: at once when movement is reduced. */
	function moveTo(px: number, then: () => void): void {
		if (hooks.reduced()) {
			// Also at once: a closing sheet is off the screen before the code that made it closes it, so a close animation has nothing to show.
			setPull(px);
			then();
			return;
		}
		sheet.addClass(SETTLING);
		setPull(px);
		settle = win.setTimeout(() => {
			settle = null;
			guard(then);
		}, SWIPE_SETTLE_MS);
	}

	const down = (e: PointerEvent) => {
		if (closing) return;
		if (e.pointerType !== 'touch' || !e.isPrimary) {
			// A second finger turns the swipe into something else (a pinch): drop it.
			if (track && e.pointerType === 'touch') reset();
			return;
		}
		if (settle !== null) reset();
		if (hooks.enabled && !hooks.enabled()) return;
		const target = e.target as Element | null;
		const onHandle = !!target?.closest?.(HANDLES);
		track = { id: e.pointerId, x0: e.clientX, y0: e.clientY, eligible: onHandle || sheet.scrollTop <= 0, engaged: false, dy: 0, samples: [{ t: performance.now(), y: e.clientY }] };
	};

	const move = (e: PointerEvent) => {
		const t = track;
		if (!t || e.pointerId !== t.id) return;
		const dy = e.clientY - t.y0;
		const dx = e.clientX - t.x0;
		t.samples.push({ t: performance.now(), y: e.clientY });
		if (!t.engaged) {
			if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
			// Judged once. A move up or sideways, or a start in a scrolled list, belongs to the list.
			if (!t.eligible || dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
				track = null;
				return;
			}
			t.engaged = true;
			// Capture keeps the move coming to the sheet when the finger leaves it; the browser may refuse for a pointer that is gone.
			try {
				sheet.setPointerCapture(t.id);
			} catch {
				/* the move still reaches the sheet while the finger stays on it */
			}
			sheet.addClass(PULLED);
		}
		t.dy = Math.max(0, dy);
		setPull(t.dy);
	};

	const finish = (e: PointerEvent, cancelled: boolean) => {
		const t = track;
		if (!t || e.pointerId !== t.id) return;
		track = null;
		if (!t.engaged) return;
		// The last sample is the release itself, so a finger that stopped before it lifted has no speed.
		if (Number.isFinite(e.clientY)) t.samples.push({ t: performance.now(), y: e.clientY });
		try {
			sheet.releasePointerCapture(t.id);
		} catch {
			/* already released */
		}
		swallow = true;
		if (swallowTimer !== null) win.clearTimeout(swallowTimer);
		swallowTimer = win.setTimeout(() => (swallow = false), 400);
		const h = sheet.offsetHeight || sheet.clientHeight || 0;
		if (!cancelled && swipeCloses(t.dy, h, releaseSpeed(t.samples))) {
			// D262: no reset before the close. Obsidian slides a phone modal out from the transform that it has; a sheet back at the top showed for one frame
			// and slid out a second time. The settle class goes, because a transition that still runs would win over that slide.
			closing = true;
			moveTo(Math.max(h, t.dy), () => {
				sheet.removeClass(SETTLING);
				hooks.close();
			});
		} else moveTo(0, reset);
	};

	// A touch that moves down on a list at its top must not scroll the page or bounce the list: pointer events alone cannot stop that.
	const touchMove = (e: TouchEvent) => {
		const t = track;
		if (t?.engaged && e.cancelable) e.preventDefault();
	};
	const click = (e: Event) => {
		if (!swallow) return;
		e.preventDefault();
		e.stopPropagation();
	};
	const up = (e: PointerEvent) => guard(() => finish(e, false));
	const cancel = (e: PointerEvent) => guard(() => finish(e, true));
	const downG = (e: PointerEvent) => guard(() => down(e));
	const moveG = (e: PointerEvent) => guard(() => move(e));

	sheet.addEventListener('pointerdown', downG);
	sheet.addEventListener('pointermove', moveG);
	sheet.addEventListener('pointerup', up);
	sheet.addEventListener('pointercancel', cancel);
	sheet.addEventListener('touchmove', touchMove, { passive: false });
	sheet.addEventListener('click', click, true);
	return () => {
		sheet.removeEventListener('pointerdown', downG);
		sheet.removeEventListener('pointermove', moveG);
		sheet.removeEventListener('pointerup', up);
		sheet.removeEventListener('pointercancel', cancel);
		sheet.removeEventListener('touchmove', touchMove);
		sheet.removeEventListener('click', click, true);
		if (swallowTimer !== null) win.clearTimeout(swallowTimer);
		reset();
	};
}
