/*
 * Keeps a window still while a press is under way (D319). A help text that hides, or a grey date line that changes, when a field loses the focus moves the buttons
 * below it between the press and the release, and then the click lands on the wrong thing or on nothing. While a press runs in the window, the help texts that
 * show at the press stay, and a change that waits for the blur is held back. Both end at the click, a short time after the release when no click comes, or
 * at the latest a fixed time after the press when no release comes.
 * One mechanism for mouse, pen and touch: it reads no device, only the pointer events.
 */

/** After a release the window waits this long for a click, then lets the held changes go. */
const CLICK_WAIT_MS = 500;

/** A press that has no release for this long lets go of the held changes, so a lost pointerup cannot hold them for ever. */
const PRESS_MAX_MS = 1500;

interface Hold {
	pressing: boolean;
	/** One waiting change for each key, so a field that blurs twice repaints once. */
	waiting: Map<unknown, () => void>;
	held: HTMLElement[];
}

const holds = new WeakMap<HTMLElement, Hold>();

/**
 * Starts the hold for a window (`root` is its frame, which has the class `dynasty-sheet`). Returns the function that stops it when the window closes.
 */
export function holdLayoutOnPress(root: HTMLElement): () => void {
	const hold: Hold = { pressing: false, waiting: new Map(), held: [] };
	holds.set(root, hold);
	const doc = root.doc;
	const win = root.win;
	let timer: number | null = null;
	const stopTimer = (): void => {
		if (timer !== null) win.clearTimeout(timer);
		timer = null;
	};
	const release = (): void => {
		stopTimer();
		doc.removeEventListener('pointerup', afterRelease, true);
		doc.removeEventListener('pointercancel', afterRelease, true);
		hold.pressing = false;
		for (const h of hold.held.splice(0)) h.removeClass('is-held');
		const run = [...hold.waiting.values()];
		hold.waiting.clear();
		for (const fn of run) {
			try {
				fn();
			} catch (e) {
				console.error('Crown and Kin: a held change failed', e);
			}
		}
	};
	function afterRelease(): void {
		stopTimer();
		timer = win.setTimeout(release, CLICK_WAIT_MS);
	}
	const press = (e: PointerEvent): void => {
		// A right-button press opens a menu and the page may never get its pointerup; it moves no button, so it holds nothing.
		if (e.button > 0) return;
		stopTimer();
		hold.pressing = true;
		// A press that never ends (a native select drag, a Ctrl-click menu) lets go after this time. A normal release restarts the timer.
		timer = win.setTimeout(release, PRESS_MAX_MS);
		// A hidden hint (`display: none`) has no offset parent. The visible ones are the help of the field that has the focus now.
		for (const h of Array.from(root.querySelectorAll<HTMLElement>('.dynasty-sheet-hint.is-on-focus'))) {
			if (h.offsetParent !== null) {
				h.addClass('is-held');
				hold.held.push(h);
			}
		}
		doc.addEventListener('pointerup', afterRelease, true);
		doc.addEventListener('pointercancel', afterRelease, true);
	};
	root.addEventListener('pointerdown', press, true);
	root.addEventListener('click', release, true);
	return () => {
		stopTimer();
		root.removeEventListener('pointerdown', press, true);
		root.removeEventListener('click', release, true);
		doc.removeEventListener('pointerup', afterRelease, true);
		doc.removeEventListener('pointercancel', afterRelease, true);
		holds.delete(root);
	};
}

/**
 * Runs `change` now, or after the press when a press is under way in the window of `el`. A later call with the same `key` replaces the earlier one. Outside a
 * window with a hold (a note, a test) it runs at once.
 */
export function afterPress(el: HTMLElement, key: unknown, change: () => void): void {
	const root = el.closest<HTMLElement>('.dynasty-sheet');
	const hold = root ? holds.get(root) : undefined;
	if (hold?.pressing) hold.waiting.set(key, change);
	else change();
}
