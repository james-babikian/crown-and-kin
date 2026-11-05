/*
 * Small DOM pieces of the tree view: Obsidian-style callouts (spec §5.8: warning and error boxes
 * use Obsidian's own callout styles) and a popover that closes on Escape or a press outside it,
 * with a hook for what must happen when it closes (the legend lets go of its arms pictures). A phone sheet also closes with a swipe down (D220).
 * The arrow keys move between the rows of a popover list, as in a menu. The phone list in a note opens its small problem pop-up as a panel under its bar: no sheet, no grip, no cover.
 */

import { mediaMatches } from './page-reads';
import { attachSheetSwipe } from './sheet-swipe';

/** Puts a named icon into an element. The plugin shell passes Obsidian's `setIcon`; this layer never imports `obsidian` itself. */
export type IconFn = (el: HTMLElement, name: string) => void;

/** The two elements of a built callout: the whole box, and the element to fill with its content. */
export interface Callout {
	root: HTMLElement;
	content: HTMLElement;
}

/** Builds an Obsidian-style warning or error callout inside `parent`, with an empty content area. */
export function buildCallout(parent: HTMLElement, type: 'warning' | 'error', title: string, cls: string, icon: IconFn): Callout {
	const root = parent.createDiv({ cls: ['callout', cls], attr: { 'data-callout': type } });
	const head = root.createDiv({ cls: 'callout-title' });
	icon(head.createDiv({ cls: 'callout-icon' }), type === 'error' ? 'zap' : 'alert-triangle');
	head.createDiv({ cls: 'callout-title-inner', text: title });
	const content = root.createDiv({ cls: 'callout-content' });
	return { root, content };
}

/** Where a pop-up panel hangs, and how the note makes room for it. */
export interface PanelOptions {
	/** The screen rectangle that the panel hangs from (the bar). It is read again after each scroll. */
	anchor: () => DOMRect;
	/** Scrolls the note so that the anchor stands just under the header of the note. Called once, when the room under the anchor is small. */
	bringUp?: () => void;
}

/** How a popover is placed and shaped: near its opener on a computer, a sheet from the bottom on the full-screen view of a phone, a panel under the bar in a note. */
export interface PopoverOptions {
	/** A sheet from the bottom of the host with a grip, a dimmed cover and a tap outside that closes it (the full-screen view of a phone). Needs no anchor. */
	sheet?: boolean;
	/** A small panel under a bar at the right edge of the host: no grip, no swipe, no cover. A tap outside closes it (the pop-up of the phone list in a note). */
	panel?: PanelOptions;
	/** With an anchor: the menu starts at the anchor's left edge (`start`, the toolbar menus), ends at the anchor's right edge (`end`, the problem list at the right of the bar) or is centred on it (`centre`, the default). */
	align?: 'start' | 'centre' | 'end';
	/** With `sheet`: true when movement is reduced (D126), so the swipe closes or snaps back at once. Default: the device setting. */
	reduced?: () => boolean;
}

/**
 * Makes the open legend as compact as it needs to be to show all its rows. A note embed is only 500 px high, and the rows alone are taller. When the
 * content is taller than the box, the class `is-tight` (rows 22 px, no gaps, less padding) is added. Returns whether it was added. A box that is still too short
 * scrolls inside, as before.
 */
export function fitLegend(el: HTMLElement): boolean {
	if (el.scrollHeight <= el.clientHeight + 1) return false;
	el.addClass('is-tight');
	return true;
}

/**
 * Arrow Up and Down (and Home, End) on a row of a popover list move the focus to the next row, as in a menu (WCAG 2.1.1). The rows wrap round.
 * Returns whether the key moved the focus; any other key, or a key with the focus outside the rows, is left alone.
 */
export function menuKey(el: HTMLElement, e: KeyboardEvent): boolean {
	if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return false;
	if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return false;
	const rows = Array.from(el.querySelectorAll<HTMLElement>('.dynasty-popover-item')).filter((r) => !(r as HTMLButtonElement).disabled);
	const at = rows.indexOf(el.doc.activeElement as HTMLElement);
	if (at < 0 || rows.length === 0) return false;
	const n = rows.length;
	const to = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
	rows[to].focus();
	return true;
}

/** The gap between an anchor and the popover that opens next to it, and between the popover and the edge of the room. */
const POPOVER_GAP = 4;
/** A side has "useful room" when the box fits there, or when it has at least this much (a title, the hint and a row or two). */
const USEFUL_ROOM = 200;
/** A panel ends this far above the foot of the visible screen (or of the floating bar of a theme), and this far above the foot of the box that holds it. */
const PANEL_FOOT_GAP = 8;
/** A press outside a panel closes it when it ends within this distance of where it began (a tap); a longer one is a scroll of the note. */
const TAP_SLOP = 10;
/** The click that follows a closing tap comes within this time; a longer wait means no click is coming. */
const CLICK_WAIT_MS = 400;
/** The bar stands this far under the top of the visible area after the note has scrolled for a popover. */
const SCROLL_MARGIN = 8;

/** A vertical span on the screen, in pixels from the top of the window. */
export interface PlaceBox {
	top: number;
	bottom: number;
}

/** What `planPlace` needs: the host, the anchor and the visible band (all on the screen) and the height of the box. */
export interface PlaceInput {
	host: PlaceBox;
	anchor: PlaceBox;
	band: PlaceBox;
	h: number;
	/** True after the note has scrolled once: the plan then never asks for a second scroll. */
	noScroll?: boolean;
}

/** The side that a popover takes, the room on that side, and how far the note must scroll first (0 for none; positive moves the content up). */
export interface PlacePlan {
	up: boolean;
	room: number;
	scroll: number;
}

/**
 * Decides where a popover opens (CH-01, UX-05, K-06). The room on a side is the part of the host that is on the screen. If neither side has useful room and the host
 * reaches out of the visible band, the answer is a scroll that puts the anchor near the top of the band; the caller scrolls and asks again. If that cannot help, the room of
 * the host alone is used, so a box is cut to a strip only when the host itself is that small.
 */
export function planPlace(i: PlaceInput): PlacePlan {
	const sides = (band: PlaceBox) => {
		const floor = Math.max(i.host.top, band.top);
		const ceil = Math.min(i.host.bottom, band.bottom);
		return { below: ceil - i.anchor.bottom - 2 * POPOVER_GAP, above: i.anchor.top - floor - 2 * POPOVER_GAP };
	};
	const pick = (s: { below: number; above: number }) => {
		const up = i.h > s.below && s.above > s.below;
		return { up, room: up ? s.above : s.below };
	};
	const need = Math.min(i.h, USEFUL_ROOM);
	let take = pick(sides(i.band));
	if (take.room >= need) return { ...take, scroll: 0 };
	const reaches = i.host.top < i.band.top || i.host.bottom > i.band.bottom;
	if (!reaches) return { ...take, scroll: 0 };
	const scroll = i.anchor.top - (i.band.top + SCROLL_MARGIN);
	if (!i.noScroll && scroll > 0) return { ...take, scroll };
	const alone = pick(sides({ top: -Infinity, bottom: Infinity }));
	if (alone.room > take.room) take = alone;
	return { ...take, scroll: 0 };
}

/** Whether an element is a scroll area: the note, a pane, a modal body. */
function scrollsY(win: Window, el: Element): boolean {
	// A test double of the window may have no `getComputedStyle`; the global one then answers.
	const overflow = (typeof win.getComputedStyle === 'function' ? win.getComputedStyle(el) : getComputedStyle(el)).overflowY;
	return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

/**
 * The part of the screen where a popover of `host` can be seen: the window, cut by the scroll areas around the host, by the header of a note on a phone, and by the
 * floating bar of a theme at the foot of a phone (Minimal's `.mobile-navbar`). A window of the plugin lies over that bar, so it does not count there.
 */
export function visibleBand(host: HTMLElement): PlaceBox {
	const win = host.win;
	const view = win.visualViewport;
	let top = view?.offsetTop ?? 0;
	let bottom = view ? view.offsetTop + view.height : win.innerHeight;
	if (!(bottom > top)) bottom = Infinity;
	// The cuts below only narrow the band. A page that cannot answer one of them (a window of another kind, a test double) keeps what is known, so a popover always opens.
	try {
		for (let n = host.parentElement; n; n = n.parentElement) {
			if (!scrollsY(win, n)) continue;
			const r = n.getBoundingClientRect();
			top = Math.max(top, r.top);
			bottom = Math.min(bottom, r.bottom);
		}
		if (!host.closest('.modal')) {
			const header = host.closest('.workspace-leaf-content')?.querySelector<HTMLElement>('.view-header')?.getBoundingClientRect().bottom;
			if (header !== undefined && header > top && header < bottom) top = header;
			const navbar = host.doc.querySelector<HTMLElement>('.mobile-navbar')?.getBoundingClientRect().top;
			if (navbar !== undefined && navbar > top && navbar < bottom) bottom = navbar;
		}
	} catch {
		// See the comment above.
	}
	return { top, bottom };
}

/** Scrolls the areas around `host`, the nearest first, by `delta` pixels (positive: the content moves up), as far as each can go. */
function scrollAreas(host: HTMLElement, delta: number): void {
	const win = host.win;
	let left = delta;
	for (let n = host.parentElement; n && left > 0; n = n.parentElement) {
		if (!scrollsY(win, n) || n.scrollHeight <= n.clientHeight) continue;
		const before = n.scrollTop;
		n.scrollTop = Math.min(n.scrollHeight - n.clientHeight, before + left);
		left -= n.scrollTop - before;
	}
}

/** A single popover attached to `host`: one open at a time, closed by Escape or a press outside it. */
export class Popover {
	private el: HTMLElement | null = null;
	private cover: HTMLElement | null = null;
	private cleanup: (() => void)[] = [];
	private opener: Element | null = null;

	constructor(private readonly host: HTMLElement) {}

	/** Whether a popover is currently open. */
	get isOpen(): boolean {
		return this.el !== null;
	}

	/** The open popover's kind, so a second press on the same toolbar button closes it. */
	get kind(): string | null {
		return this.el?.getAttribute('data-kind') ?? null;
	}

	/**
	 * Opens a popover. With `anchor` (a screen rectangle, for example a far-couple tag or a toolbar button), it opens
	 * below the anchor, or above it if there is no room below, inside the host. With `opts.sheet` it is a sheet from the bottom;
	 * with `opts.panel` it is a panel under a bar.
	 */
	open(kind: string, build: (el: HTMLElement) => void, opener: Element | null, anchor?: DOMRect, opts: PopoverOptions = {}): HTMLElement {
		this.close();
		const shape = opts.sheet ? ['is-sheet'] : opts.panel ? ['is-panel'] : [];
		const el = this.host.createDiv({ cls: ['dynasty-popover', `dynasty-popover-${kind}`, ...shape], attr: { 'data-kind': kind, role: 'dialog' } });
		this.el = el;
		this.opener = opener;
		if (opts.sheet) this.dressSheet(el, opts);
		build(el);
		if (anchor && !opts.sheet && !opts.panel) this.place(el, anchor, opts.align ?? 'centre');
		if (opts.sheet) this.watchMore(el);
		if (opts.panel) this.layPanel(el, opts.panel);
		this.listen(el, opener, opts);
		return el;
	}

	/** The cover, the grip and the swipe of a sheet. */
	private dressSheet(el: HTMLElement, opts: PopoverOptions): void {
		// The cover goes under the sheet and takes the tap that closes it, so the tap never reaches a card below.
		const cover = this.host.createDiv({ cls: 'dynasty-cover' });
		this.host.insertBefore(cover, el);
		this.cover = cover;
		cover.addEventListener('click', () => this.close(true));
		el.createDiv({ cls: 'dynasty-sheet-grip', attr: { 'aria-hidden': 'true' } });
		const win = this.host.win;
		const reduced = opts.reduced ?? (() => mediaMatches(win, '(prefers-reduced-motion: reduce)'));
		// The same close path as the Close button: the focus goes back to the opener.
		this.cleanup.push(attachSheetSwipe(el, { close: () => this.close(true), reduced }));
	}

	/** Closing by a press outside the popover and by Escape. */
	private listen(el: HTMLElement, opener: Element | null, opts: PopoverOptions): void {
		const doc = this.host.doc;
		const win = this.host.win;
		const inside = (t: Node | null) => !t || el.contains(t) || !!opener?.contains(t);
		const outside = (e: Event) => {
			// A sheet closes by its own cover (a click), after the press has ended.
			if (inside(e.target as Node | null) || (opts.sheet && this.cover?.contains(e.target as Node))) return;
			this.close();
		};
		// Esc closes the popover and gives the focus back to its opener (spec §5.2), also when the focus
		// is still on the opener (the legend takes no focus). The window hears it first, so the
		// full-screen view around the tree stays open.
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') {
				if (menuKey(el, e)) {
					e.stopPropagation();
					e.preventDefault();
				}
				return;
			}
			const active = doc.activeElement;
			if (!(active && (el.contains(active) || this.host.contains(active)))) return;
			e.stopPropagation();
			e.preventDefault();
			this.close(true);
		};
		win.addEventListener('keydown', key, true);
		this.cleanup.push(() => win.removeEventListener('keydown', key, true));
		if (opts.panel) {
			this.cleanup.push(this.listenTap(inside));
			return;
		}
		doc.addEventListener('pointerdown', outside, true);
		this.cleanup.push(() => doc.removeEventListener('pointerdown', outside, true));
	}

	/**
	 * A panel lies over a note that the finger scrolls, so a press that begins outside it closes it only when it ends as a tap: a scroll of the note ends in a cancel, or moves
	 * far. Returns the function that removes the listeners.
	 */
	private listenTap(inside: (t: Node | null) => boolean): () => void {
		const doc = this.host.doc;
		let down: { id: number; x: number; y: number } | null = null;
		const start = (e: Event) => {
			const p = e as PointerEvent;
			down = inside(p.target as Node | null) ? null : { id: p.pointerId, x: p.clientX, y: p.clientY };
		};
		const end = (e: Event) => {
			const p = e as PointerEvent;
			const d = down;
			down = null;
			if (!(d && p.pointerId === d.id && Math.hypot(p.clientX - d.x, p.clientY - d.y) <= TAP_SLOP)) return;
			this.close(true);
			this.swallowClick();
		};
		const cancel = () => {
			down = null;
		};
		doc.addEventListener('pointerdown', start, true);
		doc.addEventListener('pointerup', end, true);
		doc.addEventListener('pointercancel', cancel, true);
		return () => {
			doc.removeEventListener('pointerdown', start, true);
			doc.removeEventListener('pointerup', end, true);
			doc.removeEventListener('pointercancel', cancel, true);
		};
	}

	/**
	 * The tap that closed a panel must not also act on what lies under it (a row that moves the list, a person window). The click that follows the press is stopped once; the
	 * listener goes after that click, or after 400 ms if none comes. It outlives the panel, so it is not part of `cleanup`.
	 */
	private swallowClick(): void {
		const doc = this.host.doc;
		const win = this.host.win;
		let timer = 0;
		const stop = (e: Event) => {
			e.preventDefault();
			e.stopPropagation();
			off();
		};
		const off = () => {
			doc.removeEventListener('click', stop, true);
			win.clearTimeout(timer);
		};
		doc.addEventListener('click', stop, true);
		timer = win.setTimeout(off, CLICK_WAIT_MS);
	}

	/** Sets `has-more` while content lies below the foot of the box (a fade there, in the styles) and clears it at the end. Returns the function that sets it now. */
	private watchMore(el: HTMLElement): () => void {
		const cue = () => {
			const more = Number(el.scrollTop) + Number(el.clientHeight) < Number(el.scrollHeight) - 1;
			el.toggleClass('has-more', more);
		};
		el.addEventListener('scroll', cue);
		cue();
		return cue;
	}

	/**
	 * A panel hangs under its anchor, 4 px below it, at the right edge of the host. When the room under the anchor on the screen is smaller than the panel, the note scrolls
	 * first (`bringUp`) and the panel opens under the bar: it never opens above it. The note moves the panel with it, so the room follows every scroll.
	 * A panel lies over the part of the note that comes after a short box, and Obsidian cuts a block of Live Preview at its own edge (`contain: paint` on `.cm-embed-block`). So
	 * while the panel is open the box has a minimum height (`--dynasty-pop-need`) that holds the whole panel, and the panel is never cut.
	 */
	private layPanel(el: HTMLElement, p: PanelOptions): void {
		const host = this.host;
		host.addClass('has-pop-panel');
		const lay = () => {
			const below = p.anchor().bottom + POPOVER_GAP;
			const foot = visibleBand(host).bottom - PANEL_FOOT_GAP;
			const natural = Math.max(el.scrollHeight || 0, el.offsetHeight || 0);
			const y = Math.round(below - host.getBoundingClientRect().top);
			el.style.setProperty('--dynasty-pop-y', `${y}px`);
			host.style.setProperty('--dynasty-pop-need', `${y + natural + PANEL_FOOT_GAP}px`);
			return { natural, room: Number.isFinite(foot) ? foot - below : Infinity };
		};
		const first = lay();
		if (first.room < first.natural && p.bringUp) {
			p.bringUp();
			lay();
		}
		const win = host.win;
		win.addEventListener('scroll', lay, true);
		win.addEventListener('resize', lay);
		this.cleanup.push(() => {
			win.removeEventListener('scroll', lay, true);
			win.removeEventListener('resize', lay);
			host.removeClass('has-pop-panel');
			host.style.removeProperty('--dynasty-pop-need');
		});
	}

	/**
	 * Puts the popover next to its anchor, inside the host and inside the part of it that is on the screen (CH-01, UX-05, K-06). It opens below the anchor when
	 * its height fits there, else above it when that side has more room. When neither side has useful room (a bar at the foot of the window, a tree box that starts
	 * there), the note scrolls so that the bar stands near the top of the visible area, and the box opens below it; the box is never cut to a strip. Only a box that
	 * is still too short for its content keeps the side with more room and scrolls inside (`--dynasty-pop-room` caps its height).
	 */
	private place(el: HTMLElement, anchor: DOMRect, align: 'start' | 'centre' | 'end'): void {
		let host = this.host.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const gap = POPOVER_GAP;
		const left = align === 'start' ? anchor.left - host.left : align === 'end' ? anchor.right - w - host.left : anchor.left + anchor.width / 2 - w / 2 - host.left;
		const x = Math.max(gap, Math.min(host.width - w - gap, left));
		// A host with no size (nothing is laid out) keeps the old rule: below, clamped into the host.
		const laidOut = host.height > 0;
		let band = laidOut ? visibleBand(this.host) : null;
		let top = anchor.top;
		let bottom = anchor.bottom;
		let plan = band ? planPlace({ host, anchor: { top, bottom }, band, h }) : null;
		if (band && plan && plan.scroll > 0) {
			const before = host.top;
			scrollAreas(this.host, plan.scroll);
			host = this.host.getBoundingClientRect();
			// The anchor moved with the host; its rectangle was read before the scroll.
			top += host.top - before;
			bottom += host.top - before;
			band = visibleBand(this.host);
			plan = planPlace({ host, anchor: { top, bottom }, band, h, noScroll: true });
		}
		const up = plan?.up ?? false;
		const room = plan?.room ?? 0;
		const high = plan && room > 0 && h > room ? room : h;
		if (high < h) el.style.setProperty('--dynasty-pop-room', `${Math.floor(high)}px`);
		const want = up ? top - host.top - high - gap : bottom - host.top + gap;
		// Both are clamped, so an anchor outside the host (a focused tag off screen) still gives a visible list.
		const y = Math.max(gap, Math.min(want, host.height - high - gap));
		el.style.setProperty('--dynasty-pop-x', `${Math.round(x)}px`);
		el.style.setProperty('--dynasty-pop-y', `${Math.round(y)}px`);
		el.addClass('is-anchored');
	}

	/**
	 * Runs `fn` once when the open popover closes, in any way (Escape, a press outside, its button, a
	 * new popover, the view goes). With no popover open, `fn` runs now.
	 */
	whenClosed(fn: () => void): void {
		const once = () => {
			try {
				fn();
			} catch (e) {
				console.error('Crown and Kin: cannot close the popover', e);
			}
		};
		if (this.el) this.cleanup.push(once);
		else once();
	}

	/** Closes the open popover, if any; with `refocus`, gives the focus back to its opener. */
	close(refocus = false): void {
		for (const c of this.cleanup.splice(0)) c();
		this.el?.remove();
		this.el = null;
		this.cover?.remove();
		this.cover = null;
		// An element with no focus method (some SVG parts) takes no focus.
		const opener = this.opener as HTMLElement | null;
		if (refocus) opener?.focus?.();
		this.opener = null;
	}
}
