/*
 * Small parts of the window family (0.2.8 contract C, G.1, G.7, G.8): one row anatomy (title and detail, then the picture at the right, then the actions),
 * the round lead of a person (a portrait, and nothing when the person has none: D213), the short menu that Obsidian draws (a popover on a
 * computer, a sheet from the bottom on a phone), and the pictures of the rows. The windows (`edit-sheet.ts`, `titles-window.ts`,
 * `houses-window.ts`) use them; nothing here reads or writes a note.
 */

import { Menu, setIcon } from 'obsidian';
import { startCropOf } from './crop-tool';
import type { PictureCopy, PictureStore } from './picture-store';

// ---------- the short menu ----------

/** One item of a menu. */
export interface MenuEntry {
	label: string;
	icon?: string;
	warning?: boolean;
	disabled?: boolean;
	run(): void;
}

/** A menu item or a separator line. */
export type MenuItems = readonly (MenuEntry | 'sep')[];

/** Shows Obsidian's menu under `anchor`. A failing action never leaves an exception in Obsidian (spec §8). */
export function showMenu(anchor: HTMLElement, items: MenuItems): Menu {
	const menu = new Menu();
	for (const it of items) {
		if (it === 'sep') {
			menu.addSeparator();
			continue;
		}
		menu.addItem((i) => {
			i.setTitle(it.label);
			if (it.icon) i.setIcon(it.icon);
			if (it.warning) i.setWarning(true);
			if (it.disabled) i.setDisabled(true);
			i.onClick(() => {
				try {
					it.run();
				} catch (e) {
					console.error('Crown and Kin: a menu action failed', e);
				}
			});
		});
	}
	const r = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: r.left, y: r.bottom });
	return menu;
}

// ---------- the pictures of the rows ----------

/** One picture of a row: its slot, the cancel switch of its request and the copy once it arrived. */
interface RowEntry {
	slot: HTMLElement;
	ctl: AbortController;
	copy: PictureCopy | null;
	started: boolean;
	start(): void;
}

/** The nearest ancestor that scrolls, so that "on screen" means "in the visible part of the list". Null: the page itself. */
function scrollParent(el: HTMLElement): HTMLElement | null {
	const view = el.ownerDocument.defaultView;
	for (let p = el.parentElement; p; p = p.parentElement) {
		const y = view?.getComputedStyle(p).overflowY;
		if (y === 'auto' || y === 'scroll') return p;
	}
	return null;
}

/**
 * The small pictures of the rows of one window: the portrait in a round lead and the arms in an arms lead. Each is a copy
 * from the store that the window releases when it closes. A row makes its lead only when `has` says that a picture can come
 * (D213: no initials, no empty ring). A picture that arrives after the window closed is released at once.
 *
 * A row asks the store only when its lead is on screen or near it (a picker over 300 people does not decode 300 pictures
 * at once). When the window closes, or a row is drawn again, the waiting requests are cancelled and the copies go back.
 */
export class RowPictures {
	private readonly entries = new Set<RowEntry>();
	private readonly bySlot = new Map<Element, RowEntry>();
	private watcher: IntersectionObserver | null = null;
	private watcherDoc: Document | null = null;
	private closed = false;
	/** The size at which the next sweep of rows that left the page runs. */
	private sweepAt = 64;

	constructor(
		private readonly store: PictureStore | undefined,
		private readonly sourcePath: string,
	) {}

	/**
	 * True when `link` names a picture file that the store can find. A row decides from this, not from the load: a lead that
	 * is made only after the copy arrived would move the text of the row.
	 */
	has(link: string | undefined): boolean {
		const text = link?.trim();
		if (!this.store || !text || this.closed) return false;
		return this.store.resolve(text, this.sourcePath).ok;
	}

	/** Fills `slot` with the picture of `link` when the store can make one. A slot whose picture cannot be made gets `is-failed` and is not drawn. */
	show(slot: HTMLElement, link: string | undefined, o: { px: number; fit: 'portrait' | 'meet'; crop?: string }): void {
		const store = this.store;
		const text = link?.trim();
		if (!store || !text || this.closed) return;
		const found = store.resolve(text, this.sourcePath);
		if (!found.ok) return;
		const part = o.crop ? startCropOf(o.crop) : null;
		if (this.entries.size >= this.sweepAt) {
			this.sweep();
			this.sweepAt = Math.max(64, this.entries.size * 2);
		}
		const entry: RowEntry = {
			slot,
			ctl: new AbortController(),
			copy: null,
			started: false,
			start: () => {
				if (entry.started || this.closed) return;
				entry.started = true;
				this.unwatch(entry);
				void store
					.acquire(found.file, { w: o.px, h: o.px, fit: o.fit, ...(part && o.fit === 'portrait' ? { crop: part } : {}) }, entry.ctl.signal)
					.then((c) => {
						if (!c || !('url' in c)) {
							slot.addClass('is-failed');
							return;
						}
						// The row left the page, or the window closed, while the picture was made.
						if (this.closed || entry.ctl.signal.aborted || !this.entries.has(entry)) {
							c.release();
							return;
						}
						entry.copy = c;
						slot.empty();
						slot.addClass('has-picture');
						slot.createEl('img', { attr: { src: c.url, alt: '' } });
					})
					.catch((e) => console.error('Crown and Kin: cannot show a picture in a row', e));
			},
		};
		this.entries.add(entry);
		if (!this.watch(entry)) entry.start();
	}

	/** Watches the lead until it is near the visible part. False when the system cannot watch (the request then starts at once). */
	private watch(entry: RowEntry): boolean {
		const doc = entry.slot.ownerDocument;
		const Observer = doc?.defaultView?.IntersectionObserver;
		if (!Observer) return false;
		try {
			if (!this.watcher || this.watcherDoc !== doc) {
				this.watcher?.disconnect();
				const root = scrollParent(entry.slot);
				this.watcher = new Observer(
					(seen) => {
						for (const x of seen) if (x.isIntersecting) this.bySlot.get(x.target)?.start();
					},
					{ root, rootMargin: '240px 0px' },
				);
				this.watcherDoc = doc;
			}
			this.bySlot.set(entry.slot, entry);
			this.watcher.observe(entry.slot);
			return true;
		} catch {
			return false;
		}
	}

	private unwatch(entry: RowEntry): void {
		if (this.bySlot.delete(entry.slot)) this.watcher?.unobserve(entry.slot);
	}

	private drop(entry: RowEntry): void {
		this.unwatch(entry);
		entry.ctl.abort();
		entry.copy?.release();
		entry.copy = null;
		this.entries.delete(entry);
	}

	/** Lets go of the pictures of rows that are not on the page any more. */
	private sweep(): void {
		for (const e of [...this.entries]) if (e.slot.isConnected === false) this.drop(e);
	}

	/** The rows inside `root` are drawn again: lets go of their pictures and cancels their requests. */
	forget(root: HTMLElement): void {
		for (const e of [...this.entries]) if (root.contains(e.slot)) this.drop(e);
	}

	/** Lets go of every copy and cancels every request that waits; later arrivals are released at once. */
	release(): void {
		this.closed = true;
		for (const e of [...this.entries]) this.drop(e);
		this.watcher?.disconnect();
		this.watcher = null;
	}
}

/** What the round lead of a person needs. */
export interface LeadPerson {
	name: string;
	portrait?: string;
	portraitCrop?: string;
}

/**
 * The round lead of a person row (G.1): the portrait when the person has one that the store can find, else nothing and null (D213: no
 * initials and no empty ring). The slot is made at once and the picture fills it when the copy comes. `px` is the size in CSS px.
 */
export function personLead(parent: HTMLElement, p: LeadPerson, pictures: RowPictures | undefined, px = 32): HTMLElement | null {
	if (!pictures?.has(p.portrait)) return null;
	const lead = parent.createSpan({ cls: ['dynasty-row-lead', 'is-picture', px > 32 ? 'is-large' : 'is-small'], attr: { 'aria-hidden': 'true' } });
	pictures.show(lead, p.portrait, { px, fit: 'portrait', ...(p.portraitCrop ? { crop: p.portraitCrop } : {}) });
	return lead;
}

/** An icon in a lead (the mark of an action, a hash mark for the ID). It stays before the text; it is no picture. */
export function iconLead(parent: HTMLElement, icon: string): HTMLElement {
	const lead = parent.createSpan({ cls: ['dynasty-row-lead', 'is-icon'], attr: { 'aria-hidden': 'true' } });
	setIcon(lead, icon);
	return lead;
}

// ---------- one row anatomy ----------

/** The parts of a drawn row. */
export interface RowParts {
	row: HTMLElement;
	title: HTMLElement;
	sub: HTMLElement;
	/** The actions at the right of a row; made on the first call. A row that is a button has none. */
	actions(): HTMLElement;
}

/** What a row shows. `tap`: the whole row is one button (no actions inside it). */
export interface RowOptions {
	cls?: string | string[];
	attr?: Record<string, string>;
	/**
	 * Draws the lead; the row calls it with itself. A picture lead (a portrait or arms) stands after the text, so the names line up
	 * with or without a picture (D213). A lead with `is-icon`, `is-list-icon` or `is-new` is a mark, not a picture: it stays before the text.
	 */
	lead?: (row: HTMLElement) => void;
	/** The ordinal of a line of succession ("1st"), shown before the lead. */
	ord?: string;
	tap?: () => void;
	/** The accessible name of a tap row. */
	label?: string;
	chevron?: boolean;
}

let rowCounter = 0;

/** Leads that are marks, not pictures. */
const MARK_LEADS = ['is-icon', 'is-list-icon', 'is-new'];

/** One row: `[ord] [mark] title / sub [picture] [actions or a chevron]`. The caller fills `title` and `sub`. */
export function buildRow(parent: HTMLElement, o: RowOptions = {}): RowParts {
	const classes = ['dynasty-row', ...(o.tap ? ['is-tap'] : []), ...(Array.isArray(o.cls) ? o.cls : o.cls ? [o.cls] : [])];
	// The attribute names come from the caller, so the colour rule of eslint.config.mjs cannot read them here: none of them is a colour.
	const attr: Record<string, string> = {};
	if (o.tap) attr.type = 'button';
	if (o.tap && o.label) attr['aria-label'] = o.label;
	for (const [k, v] of Object.entries(o.attr ?? {})) attr[k] = v;
	let row: HTMLElement;
	if (o.tap) {
		row = parent.createEl('button', { cls: classes, attr });
		const tap = o.tap;
		row.addEventListener('click', () => tap());
	} else row = parent.createDiv({ cls: classes, attr });
	if (o.ord) row.createSpan({ cls: 'dynasty-ord', text: o.ord });
	const text = row.createSpan({ cls: 'dynasty-row-text' });
	const title = text.createSpan({ cls: 'dynasty-row-title' });
	const sub = text.createSpan({ cls: 'dynasty-row-sub' });
	if (o.lead) {
		const made = row.children.length;
		o.lead(row);
		const lead = row.children[made] as HTMLElement | undefined;
		if (lead?.hasClass('dynasty-row-lead') && MARK_LEADS.some((c) => lead.hasClass(c))) row.insertBefore(lead, text);
	}
	// A tap row with no label gets its name from its two text lines. Joined by their ids, a text reader says "Gwen Daughter", not "GwenDaughter".
	if (o.tap && !o.label) {
		title.id = `dynasty-row-${++rowCounter}-t`;
		sub.id = `dynasty-row-${rowCounter}-s`;
		row.setAttribute('aria-labelledby', `${title.id} ${sub.id}`);
	}
	let actions: HTMLElement | null = null;
	if (o.tap && o.chevron !== false) setIcon(row.createSpan({ cls: 'dynasty-row-chev', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
	return {
		row,
		title,
		sub,
		actions() {
			actions ??= row.createDiv({ cls: 'dynasty-row-actions' });
			return actions;
		},
	};
}

/** A text button (a `dynasty-link` in a row, a `dynasty-btn` in an action row). */
export function textButton(parent: HTMLElement, cls: string | string[], text: string, run: () => void, o: { icon?: string; label?: string; focus?: string } = {}): HTMLButtonElement {
	const attr: Record<string, string> = { type: 'button' };
	if (o.label) attr['aria-label'] = o.label;
	if (o.focus) attr['data-focus'] = o.focus;
	const b = parent.createEl('button', { cls, attr });
	if (o.icon) setIcon(b.createSpan({ cls: 'dynasty-btn-icon', attr: { 'aria-hidden': 'true' } }), o.icon);
	b.createSpan({ text });
	b.addEventListener('click', () => run());
	return b;
}

/** An icon-only button (the "more" button of a row, a remove cross). */
export function iconButton(parent: HTMLElement, icon: string, label: string, run: (e: MouseEvent) => void, o: { cls?: string | string[]; focus?: string } = {}): HTMLButtonElement {
	const attr: Record<string, string> = { type: 'button', 'aria-label': label, title: label };
	if (o.focus) attr['data-focus'] = o.focus;
	const b = parent.createEl('button', { cls: ['dynasty-icon-btn', ...(Array.isArray(o.cls) ? o.cls : o.cls ? [o.cls] : [])], attr });
	setIcon(b, icon);
	b.addEventListener('click', (e) => run(e));
	return b;
}
