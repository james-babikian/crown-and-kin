/*
 * Small DOM pieces of the tree view: Obsidian-style callouts (spec §5.8: warning and error boxes
 * use Obsidian's own callout styles) and a popover that closes on Escape or a press outside it,
 * with a hook for what must happen when it closes (the legend lets go of its arms pictures). A phone sheet also closes with a swipe down (D220).
 */

import { setIcon } from 'obsidian';
import { attachSheetSwipe } from './sheet-swipe';

/** The two elements of a built callout: the whole box, and the element to fill with its content. */
export interface Callout {
	root: HTMLElement;
	content: HTMLElement;
}

/** Builds an Obsidian-style warning or error callout inside `parent`, with an empty content area. */
export function buildCallout(parent: HTMLElement, type: 'warning' | 'error', title: string, cls: string): Callout {
	const root = parent.createDiv({ cls: ['callout', cls], attr: { 'data-callout': type } });
	const head = root.createDiv({ cls: 'callout-title' });
	setIcon(head.createDiv({ cls: 'callout-icon' }), type === 'error' ? 'zap' : 'alert-triangle');
	head.createDiv({ cls: 'callout-title-inner', text: title });
	const content = root.createDiv({ cls: 'callout-content' });
	return { root, content };
}

/** How a popover is placed and shaped (0.2.8, G.13): near its opener on a computer, a sheet from the bottom on a phone. */
export interface PopoverOptions {
	/** A sheet from the bottom of the host with a grip, a dimmed cover and a tap outside that closes it (a phone). Needs no anchor. */
	sheet?: boolean;
	/** With an anchor: the menu starts at the anchor's left edge (`start`, the toolbar menus) or is centred on it (`centre`, the default). */
	align?: 'start' | 'centre';
	/** With `sheet`: true when movement is reduced (D126), so the swipe closes or snaps back at once. Default: the device setting. */
	reduced?: () => boolean;
}

/**
 * 0.2.8 (G5b): makes the open legend as compact as it needs to be to show all its rows. A note embed is only 500 px high, and the rows alone are taller. When the
 * content is taller than the box, the class `is-tight` (rows 22 px, no gaps, less padding) is added. Returns whether it was added. A box that is still too short
 * scrolls inside, as before.
 */
export function fitLegend(el: HTMLElement): boolean {
	if (el.scrollHeight <= el.clientHeight + 1) return false;
	el.addClass('is-tight');
	return true;
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
	 * below the anchor, or above it if there is no room below, inside the host. With `opts.sheet` it is a sheet from the bottom.
	 */
	open(kind: string, build: (el: HTMLElement) => void, opener: Element | null, anchor?: DOMRect, opts: PopoverOptions = {}): HTMLElement {
		this.close();
		const el = this.host.createDiv({ cls: ['dynasty-popover', `dynasty-popover-${kind}`, ...(opts.sheet ? ['is-sheet'] : [])], attr: { 'data-kind': kind, role: 'dialog' } });
		this.el = el;
		this.opener = opener;
		if (opts.sheet) {
			// The cover goes under the sheet and takes the tap that closes it, so the tap never reaches a card below.
			const cover = this.host.createDiv({ cls: 'dynasty-cover' });
			this.host.insertBefore(cover, el);
			this.cover = cover;
			cover.addEventListener('click', () => this.close(true));
			el.createDiv({ cls: 'dynasty-sheet-grip', attr: { 'aria-hidden': 'true' } });
			const win = this.host.win ?? window;
			const reduced = opts.reduced ?? (() => win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true);
			// The same close path as the Close button: the focus goes back to the opener.
			this.cleanup.push(attachSheetSwipe(el, { close: () => this.close(true), reduced }));
		}
		build(el);
		if (anchor && !opts.sheet) this.place(el, anchor, opts.align ?? 'centre');
		const doc = this.host.doc;
		const outside = (e: Event) => {
			const t = e.target as Node | null;
			if (!t || el.contains(t) || (opener && opener.contains(t))) return;
			// A sheet closes by its own cover (a click), after the press has ended.
			if (opts.sheet && this.cover?.contains(t)) return;
			this.close();
		};
		// Esc closes the popover and gives the focus back to its opener (spec §5.2), also when the focus
		// is still on the opener (the legend takes no focus). The window hears it first, so the
		// full-screen view around the tree stays open.
		const win = this.host.win ?? window;
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			const active = doc.activeElement;
			if (!(active && (el.contains(active) || this.host.contains(active)))) return;
			e.stopPropagation();
			e.preventDefault();
			this.close(true);
		};
		doc.addEventListener('pointerdown', outside, true);
		win.addEventListener('keydown', key, true);
		this.cleanup.push(() => doc.removeEventListener('pointerdown', outside, true));
		this.cleanup.push(() => win.removeEventListener('keydown', key, true));
		return el;
	}

	private place(el: HTMLElement, anchor: DOMRect, align: 'start' | 'centre'): void {
		const host = this.host.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const gap = 4;
		const left = align === 'start' ? anchor.left - host.left : anchor.left + anchor.width / 2 - w / 2 - host.left;
		const x = Math.max(gap, Math.min(host.width - w - gap, left));
		const below = anchor.bottom - host.top + gap;
		const above = anchor.top - host.top - h - gap;
		// Below if it fits, else above if that fits, else as close as the host allows. Both are
		// clamped, so an anchor outside the host (a focused tag off screen) still gives a visible list.
		const want = below + h <= host.height - gap || above < gap ? below : above;
		const y = Math.max(gap, Math.min(want, host.height - h - gap));
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
		const opener = this.opener as (Element & { focus?: () => void }) | null;
		if (refocus) opener?.focus?.();
		this.opener = null;
	}
}
