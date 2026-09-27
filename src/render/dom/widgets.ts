import { setIcon } from 'obsidian';

/*
 * Small DOM pieces of the tree view: Obsidian-style callouts (spec §5.8: warning and error boxes
 * use Obsidian's own callout styles) and a popover that closes on Escape or a press outside it.
 */

export interface Callout {
	root: HTMLElement;
	content: HTMLElement;
}

export function buildCallout(parent: HTMLElement, type: 'warning' | 'error', title: string, cls: string): Callout {
	const root = parent.createDiv({ cls: ['callout', cls], attr: { 'data-callout': type } });
	const head = root.createDiv({ cls: 'callout-title' });
	setIcon(head.createDiv({ cls: 'callout-icon' }), type === 'error' ? 'zap' : 'alert-triangle');
	head.createDiv({ cls: 'callout-title-inner', text: title });
	const content = root.createDiv({ cls: 'callout-content' });
	return { root, content };
}

export class Popover {
	private el: HTMLElement | null = null;
	private cleanup: (() => void)[] = [];
	private opener: Element | null = null;

	constructor(private readonly host: HTMLElement) {}

	get isOpen(): boolean {
		return this.el !== null;
	}

	/** The open popover's kind, so a second press on the same toolbar button closes it. */
	get kind(): string | null {
		return this.el?.getAttribute('data-kind') ?? null;
	}

	/**
	 * Opens a popover. With `anchor` (a screen rectangle, for example a far-couple tag), it opens
	 * below the anchor, or above it if there is no room below, inside the host.
	 */
	open(kind: string, build: (el: HTMLElement) => void, opener: Element | null, anchor?: DOMRect): HTMLElement {
		this.close();
		const el = this.host.createDiv({ cls: ['dynasty-popover', `dynasty-popover-${kind}`], attr: { 'data-kind': kind, role: 'dialog' } });
		this.el = el;
		this.opener = opener;
		build(el);
		if (anchor) this.place(el, anchor);
		const doc = this.host.doc;
		const outside = (e: Event) => {
			const t = e.target as Node | null;
			if (!t || el.contains(t) || (opener && opener.contains(t))) return;
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

	private place(el: HTMLElement, anchor: DOMRect): void {
		const host = this.host.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const gap = 4;
		const x = Math.max(gap, Math.min(host.width - w - gap, anchor.left + anchor.width / 2 - w / 2 - host.left));
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

	close(refocus = false): void {
		for (const c of this.cleanup.splice(0)) c();
		this.el?.remove();
		this.el = null;
		const opener = this.opener as (Element & { focus?: () => void }) | null;
		if (refocus) opener?.focus?.();
		this.opener = null;
	}
}
