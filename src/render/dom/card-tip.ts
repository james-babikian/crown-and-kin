/*
 * The plugin's own tooltip for a card (D145, the 0.2.5 contract C.3.4). With "Show relation names on cards" off the card has
 * no relation word, so a small label under the card tells it when the pointer rests on the card or the card gets the
 * keyboard focus. Obsidian's own tooltips do not work on SVG elements, so this is a plain HTML element in the viewport.
 *
 * How it fits in: `tree-view.ts` calls `wireCardTips` once for each render and keeps the handle. It calls `hide()` and
 * then `shown()` when a pan or zoom ends, and `destroy()` when the view is torn down. This file knows nothing of
 * settings, relations or the pan and zoom: the caller answers `enabled()`, `busy()` and `text(id)`.
 *
 * Cost: the listeners are delegated. There are 7 on the viewport and none on a card (Chromium also makes an SVG
 * element that has a `focus` listener a Tab stop, so a listener per card would be wrong as well as slow). The one
 * layout read happens when the tip shows.
 *
 * The screen reader is not told twice: the tip is `aria-hidden`, and the card's own label already holds the relation.
 */

/** What `wireCardTips` needs from the tree view. */
export interface CardTipOptions {
	/** The HTML viewport. The tip is a child of it; the listeners are on it. */
	host: HTMLElement;
	/** The relation text of a person, or undefined when the person has none (then no tip shows). */
	text(id: string): string | undefined;
	/** True while a tip may show at all (the setting is off, a mark exists, the device is not a phone). Asked at each use. */
	enabled(): boolean;
	/** True while the view pans or zooms by a gesture: the cards are not where they will rest. */
	busy(): boolean;
	/** Milliseconds a mouse rests on a card before the tip shows (default 400). */
	delayMs?: number;
}

/** The handle of one wired viewport. */
export interface CardTips {
	/** Removes the tip and stops a wait that runs. Cheap when there is nothing to hide. */
	hide(): void;
	/** The view has settled: a card that got the keyboard focus while the view moved gets its tip now. */
	shown(): void;
	/** Removes the tip, the timer and every listener. The handle does nothing after it. */
	destroy(): void;
}

/** The gap in px between the card and the tip, and between the tip and the viewport edge. */
const GAP = 8;
const EDGE = 4;

/** Wires the delegated listeners of the card tip on `o.host`. */
export function wireCardTips(o: CardTipOptions): CardTips {
	const host = o.host;
	const win = host.win;
	const delay = o.delayMs ?? 400;
	let tip: HTMLElement | null = null;
	let timer: number | null = null;
	// The card that a keyboard focus found while the view moved; `shown()` shows it.
	let waiting: { id: string; card: Element } | null = null;
	// The card under a mouse press: it stays quiet until the pointer has left it.
	let pressed: Element | null = null;
	// A focus that follows a mouse press is not a keyboard focus.
	let byPointer = false;
	let dead = false;

	const stop = () => {
		if (timer !== null) win.clearTimeout(timer);
		timer = null;
	};
	const hide = () => {
		stop();
		tip?.remove();
		tip = null;
	};

	const cardOf = (target: EventTarget | null): { id: string; card: Element } | null => {
		const card = (target as Element | null)?.closest?.('.dynasty-card') ?? null;
		const id = card?.getAttribute('data-person');
		return card && id ? { id, card } : null;
	};

	const show = (id: string, card: Element) => {
		hide();
		if (dead || !o.enabled()) return;
		const text = o.text(id);
		if (!text) return;
		const c = card.getBoundingClientRect();
		const v = host.getBoundingClientRect();
		const el = host.createDiv({ cls: 'dynasty-tip', text, attr: { 'aria-hidden': 'true', 'data-person': id } });
		tip = el;
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const centre = c.left + c.width / 2 - v.left;
		// The tip stays inside the viewport; the arrow keeps pointing at the card.
		const low = w / 2 + EDGE;
		const high = v.width - w / 2 - EDGE;
		const x = Math.max(low, Math.min(centre, high));
		const arrow = Math.max(-(w / 2 - GAP), Math.min(centre - x, w / 2 - GAP));
		const under = c.bottom - v.top + GAP;
		const above = under + h > v.height && c.top - v.top - GAP - h >= 0;
		el.toggleClass('dynasty-tip-above', above);
		el.style.setProperty('--dynasty-tip-x', `${x}px`);
		el.style.setProperty('--dynasty-tip-y', `${above ? c.top - v.top - GAP : under}px`);
		el.style.setProperty('--dynasty-tip-arrow', `${arrow}px`);
	};

	// A fault in here must never reach the note: the tip just goes.
	const attempt = (fn: () => void) => {
		try {
			fn();
		} catch {
			hide();
		}
	};

	const onMove = (e: PointerEvent) =>
		attempt(() => {
			if (e.pointerType !== 'mouse' || !o.enabled()) {
				hide();
				return;
			}
			const hit = cardOf(e.target);
			if (hit?.card !== pressed) pressed = null;
			if (!hit || (e.target as Element).closest?.('.dynasty-name-link')) {
				hide();
				return;
			}
			if (hit.card === pressed) return;
			if (tip?.getAttribute('data-person') === hit.id) return;
			hide();
			timer = win.setTimeout(() => {
				timer = null;
				attempt(() => {
					if (!o.busy()) show(hit.id, hit.card);
				});
			}, delay);
		});
	const onLeave = () => attempt(hide);
	const onDown = (e: PointerEvent) =>
		attempt(() => {
			hide();
			waiting = null;
			byPointer = true;
			pressed = e.pointerType === 'mouse' ? (cardOf(e.target)?.card ?? null) : null;
		});
	const onWheel = () =>
		attempt(() => {
			hide();
			waiting = null;
		});
	const onKey = (e: KeyboardEvent) =>
		attempt(() => {
			byPointer = false;
			// The key event goes on: this only watches.
			if (e.key !== 'Escape') return;
			hide();
			waiting = null;
		});
	// Shows the card that waits, if the view is at rest. Called after a focus (once the card's own focus handler has run) and
	// by `shown()` when a pan or zoom ends.
	const showWaiting = () => {
		const w = waiting;
		if (!w || dead || o.busy()) return;
		waiting = null;
		show(w.id, w.card);
	};
	const onFocus = (e: FocusEvent) =>
		attempt(() => {
			const hit = cardOf(e.target);
			const wasPointer = byPointer;
			byPointer = false;
			if (!hit || wasPointer || !o.enabled()) return;
			stop();
			waiting = hit;
			// The card's own focus handler runs after this capture listener and may start a move of the view to the card. One
			// tick later `busy()` tells whether it did; if so, `shown()` takes over when the view settles.
			timer = win.setTimeout(() => {
				timer = null;
				attempt(showWaiting);
			}, 0);
		});
	const onBlur = () =>
		attempt(() => {
			hide();
			waiting = null;
		});

	host.addEventListener('pointermove', onMove);
	host.addEventListener('pointerleave', onLeave);
	host.addEventListener('pointerdown', onDown);
	host.addEventListener('wheel', onWheel, { passive: true });
	host.addEventListener('keydown', onKey);
	// `focus` and `blur` do not bubble; the capture phase sees them from the host.
	host.addEventListener('focus', onFocus, true);
	host.addEventListener('blur', onBlur, true);

	return {
		hide,
		shown() {
			attempt(showWaiting);
		},
		destroy() {
			dead = true;
			hide();
			waiting = null;
			host.removeEventListener('pointermove', onMove);
			host.removeEventListener('pointerleave', onLeave);
			host.removeEventListener('pointerdown', onDown);
			host.removeEventListener('wheel', onWheel);
			host.removeEventListener('keydown', onKey);
			host.removeEventListener('focus', onFocus, true);
			host.removeEventListener('blur', onBlur, true);
		},
	};
}
