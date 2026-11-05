/*
 * Small parts of the window family: one row anatomy (title and detail, then the picture at the right, then the actions),
 * the round lead of a person (a portrait, and nothing when the person has none: D213), the short menu that Obsidian draws (a popover on a
 * computer, a sheet from the bottom on a phone), and the pictures of the rows. The windows (`edit-sheet.ts`, `titles-window.ts`,
 * `houses-window.ts`) use them, and the question box that they draw over themselves; nothing here reads or writes a note.
 */

import { Menu, setIcon } from 'obsidian';
import { startCropOf } from './crop-tool';
import type { PictureCopy, PictureStore } from './picture-store';
import { uniqueId } from './sheet-parts';

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

// ---------- the question over a window ----------

/** One button of a question box. `detail` makes it a choice with a second text line, drawn in the choice list above the actions. */
export interface ConfirmBoxButton {
	label: string;
	detail?: string;
	/** Passed to the element as given: the sites keep the form (a string or a list) that they draw today. */
	cls: string | string[];
	run(): void;
}

/**
 * What a question box has. `labelled` is the id prefix of the title: with it the box names itself for a screen reader
 * (`aria-labelledby`); without it the box has no name, as two of the windows draw it today. `scroll` puts the title and
 * the text in their own scrolling part, above the buttons.
 */
export interface ConfirmBoxSpec {
	title: string;
	text?: readonly string[];
	labelled?: string;
	scroll?: boolean;
	buttons: readonly ConfirmBoxButton[];
}

/** Draws a question box over `modalEl` and gives the first button the focus. The caller keeps the layer, to remove it later. */
export function confirmBox(modalEl: HTMLElement, spec: ConfirmBoxSpec): { layer: HTMLElement; buttons: HTMLElement[] } {
	const layer = modalEl.createDiv({ cls: 'dynasty-sheet-confirm', attr: { role: 'alertdialog', 'aria-modal': 'true' } });
	const box = layer.createDiv({ cls: 'dynasty-sheet-confirm-box' });
	const top = spec.scroll ? box.createDiv({ cls: 'dynasty-sheet-confirm-scroll' }) : box;
	const titleEl = top.createDiv({ cls: 'dynasty-sheet-confirm-title', text: spec.title });
	if (spec.labelled !== undefined) {
		const id = uniqueId(spec.labelled);
		titleEl.setAttribute('id', id);
		layer.setAttribute('aria-labelledby', id);
	}
	for (const t of spec.text ?? []) top.createDiv({ cls: 'dynasty-sheet-confirm-text', text: t });
	const choices = spec.buttons.some((b) => b.detail !== undefined) ? box.createDiv({ cls: 'dynasty-choice-options' }) : null;
	const row = box.createDiv({ cls: 'dynasty-sheet-confirm-actions' });
	const buttons = spec.buttons.map((b) => {
		const choice = b.detail !== undefined && choices !== null;
		const el = (choice ? choices : row).createEl('button', { cls: b.cls, text: choice ? undefined : b.label, attr: { type: 'button' } });
		if (choice) {
			el.createSpan({ cls: 'dynasty-choice-label', text: b.label });
			el.createSpan({ cls: 'dynasty-choice-detail', text: b.detail });
		}
		el.addEventListener('click', () => b.run());
		return el;
	});
	buttons[0]?.focus();
	return { layer, buttons };
}

// ---------- the pictures of the rows ----------

/** One picture of a row: its slot, the cancel switch of its request and the copy once it arrived. */
interface RowEntry {
	slot: HTMLElement;
	/** What the picture is made from: the file and the size. The same signature on the same slot is the same picture. */
	sig: string;
	ctl: AbortController;
	copy: PictureCopy | null;
	/** The copy of the picture that the slot showed before; it goes back to the store when the new picture is drawn. */
	carry: PictureCopy | null;
	failed: boolean;
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
	/** Every entry by its slot (`bySlot` holds only those that wait for the watcher). */
	private readonly bySlotAll = new Map<Element, RowEntry>();
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

	/**
	 * Fills `slot` with the picture of `link` when the store can make one. A slot whose picture cannot be made gets `is-failed` and is not drawn.
	 * A slot that already shows (or waits for) the same picture keeps it and makes no new request. A slot that gets another picture keeps the
	 * old one in view until the new one has arrived, so a slot that changes its picture is never empty. `now`: the slot is always in view (the
	 * header of a window), so the request starts at once and does not wait for the watcher.
	 */
	show(slot: HTMLElement, link: string | undefined, o: { px: number; fit: 'portrait' | 'meet'; crop?: string; now?: boolean }): void {
		const store = this.store;
		const text = link?.trim();
		if (!store || !text || this.closed) return;
		const found = store.resolve(text, this.sourcePath);
		if (!found.ok) {
			// The new link names no file: the slot must not keep the picture of the link before, whose copy goes back now.
			this.clearSlot(slot);
			return;
		}
		const part = o.crop ? startCropOf(o.crop) : null;
		const sig = [found.file.path, o.px, o.fit, o.crop ?? ''].join('|');
		const before = this.bySlotAll.get(slot);
		if (before?.sig === sig && !before.failed) return;
		let carry: PictureCopy | null = null;
		if (before) {
			carry = before.copy ?? before.carry;
			before.carry = null;
			before.copy = null;
			this.drop(before);
		}
		if (this.entries.size >= this.sweepAt) {
			this.sweep();
			this.sweepAt = Math.max(64, this.entries.size * 2);
		}
		const entry: RowEntry = {
			slot,
			sig,
			ctl: new AbortController(),
			copy: null,
			carry,
			failed: false,
			started: false,
			start: () => {
				if (entry.started || this.closed) return;
				entry.started = true;
				this.unwatch(entry);
				slot.removeClass('is-failed');
				void store
					.acquire(found.file, { w: o.px, h: o.px, fit: o.fit, ...(part && o.fit === 'portrait' ? { crop: part } : {}) }, entry.ctl.signal)
					.then((c) => this.arrived(entry, c))
					.catch((e) => console.error('Crown and Kin: cannot show a picture in a row', e));
			},
		};
		this.entries.add(entry);
		this.bySlotAll.set(slot, entry);
		if (o.now || !this.watch(entry)) entry.start();
	}

	/** The request of `entry` ended: the copy goes into its slot, or, when it could not be made, the slot is emptied. */
	private arrived(entry: RowEntry, c: Awaited<ReturnType<PictureStore['acquire']>>): void {
		const slot = entry.slot;
		// The row left the page, the picture was replaced, or the window closed, while the picture was made.
		if (this.closed || entry.ctl.signal.aborted || !this.entries.has(entry)) {
			if (c && 'url' in c) c.release();
			return;
		}
		if (!c || !('url' in c)) {
			entry.failed = true;
			entry.carry?.release();
			entry.carry = null;
			// The copy of the old picture is back in the store, so its picture must not stay in view.
			slot.empty();
			slot.removeClass('has-picture');
			slot.addClass('is-failed');
			return;
		}
		entry.copy = c;
		slot.addClass('has-picture');
		// The picture that stands in the slot gets the new source: the old picture stays in view until the new one has loaded.
		const img = slot.querySelector('img');
		if (img) img.setAttribute('src', c.url);
		else {
			slot.empty();
			slot.createEl('img', { attr: { src: c.url, alt: '' } });
		}
		entry.carry?.release();
		entry.carry = null;
	}

	/** Gives back the picture of `slot` (copy and request) and empties the slot. */
	private clearSlot(slot: HTMLElement): void {
		const before = this.bySlotAll.get(slot);
		if (!before) return;
		this.drop(before);
		slot.empty();
		slot.removeClass('has-picture', 'is-failed');
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
		entry.carry?.release();
		entry.carry = null;
		this.entries.delete(entry);
		if (this.bySlotAll.get(entry.slot) === entry) this.bySlotAll.delete(entry.slot);
	}

	/** Lets go of the pictures of rows that are not on the page any more. */
	private sweep(): void {
		for (const e of [...this.entries]) if (!e.slot.isConnected) this.drop(e);
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
 * The round lead of a person row: the portrait when the person has one that the store can find, else nothing and null (D213: no
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
