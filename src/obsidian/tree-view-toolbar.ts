/*
 * The bars of a tree view (0.3.3, WP-1 A1): the toolbar of the computer and of the phone, the order of its parts, the menus (Focus, More, the legend, the problem
 * list), the edit controls that follow the block's state (`updateEditUi`), Find and the Focus picker, and the resize handle. Sixth layer of the chain listed in
 * `tree-view.ts`.
 */

import { Keymap, Notice, setIcon } from 'obsidian';
import type { CodedIssue } from '../core/messages';
import { issueText } from '../core/messages';
import { buildFocusBar } from '../render/dom/focus-bar';
import { buildLegend } from '../render/dom/scene';
import { setListEditable } from '../render/dom/phone-list-dom';
import { buildCallout, fitLegend, Popover, type PopoverOptions } from '../render/dom/widgets';
import { ADD_UI, BLOCK_UI, FINDER_UI, FOCUS_UI, FULL_UI, PHONE_LIST_UI, PROBLEMS_HINT, SAVE_UI, SHEET, TITLES_UI, UI, WRITE_TEXT, problemsLabel, problemsTitle } from '../render/ui-text';
import { CALENDAR_UI } from '../render/calendar-text';
import { TOOLBAR_UI } from '../render/view-text';
import { pickPerson } from './person-picker';
import { pluginModalOpen } from '../view/plugin-modals';
import { openCalendars } from './calendar-window';
import { chooseCalendarNote } from './calendar-note-choice';
import { TreeViewPictures } from './tree-view-pictures';

/** The order of the parts of each toolbar, by class (0.2.8, G.13); `orderBar` sorts the bar by it. */
const BAR_ORDER = {
	desktop: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-find', 'dynasty-focus', 'dynasty-fit', 'dynasty-sep-a', 'dynasty-houses-button', 'dynasty-titles-button', 'dynasty-sep-b', 'dynasty-more', 'dynasty-grow', 'dynasty-warning-badge', 'dynasty-expand', 'dynasty-close'],
	phone: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-houses-button', 'dynasty-focus', 'dynasty-find', 'dynasty-more', 'dynasty-warning-badge', 'dynasty-close'],
	list: ['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-add-person', 'dynasty-show-text', 'dynasty-grow', 'dynasty-list-find', 'dynasty-list-back', 'dynasty-warning-badge', 'dynasty-expand'],
} as const;

/**
 * A bar in `parent` with the role and label of a toolbar, and `button`, which adds an icon-only button to it. `first` puts the bar first in
 * `parent`, so Tab reaches the buttons before the cards and the list (spec §5.2); the bar of an empty tree stays where it is made.
 */
export function toolbarIn(parent: HTMLElement, first = true): { bar: HTMLElement; button: (icon: string, label: string, cls: string) => HTMLButtonElement } {
	const bar = parent.createDiv({ cls: 'dynasty-toolbar', attr: { role: 'toolbar', 'aria-label': TOOLBAR_UI.region } });
	if (first) parent.prepend(bar);
	const button = (icon: string, label: string, cls: string) => {
		const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', cls], attr: { 'aria-label': label, type: 'button' } });
		setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
		return b;
	};
	return { bar, button };
}

/** The toolbar and its menus, and the controls that depend on whether the block can be edited. */
export abstract class TreeViewToolbar extends TreeViewPictures {
	/**
	 * D246 (F2): while a focus shows, the bar at the top of the tree says whose family it is and has the link Clear focus (one tap, on every device). The Focus button
	 * does the same since D263 (B2). A static touch embed (D1) has no controls, so it has no bar. Clear focus is `focusOn(null)`: it writes nothing, a pin stays in the note.
	 */
	protected buildFocusBar(viewport: HTMLElement, before: HTMLElement, name: string): void {
		if (!this.full && this.coarse) return;
		buildFocusBar(viewport, before, {
			sentence: FOCUS_UI.bar(name),
			clear: FOCUS_UI.clear,
			clearLabel: FOCUS_UI.clearLabel,
			phone: this.barKind() === 'phone',
			onClear: (byKeyboard) =>
				this.guard(() => {
					// The redraw builds the Focus button again; a key press has the keyboard focus on the new button.
					if (byKeyboard) this.focusDue = '.dynasty-focus';
					this.focusOn(null);
				}),
		});
	}

	/** The banner above a tree that has problems that stop editing (spec §8). */
	protected buildBanner(root: HTMLElement, blocking: readonly CodedIssue[]): void {
		if (!blocking.length) return;
		const banner = buildCallout(root, 'warning', UI.bannerTitle, 'dynasty-banner', setIcon);
		banner.content.createDiv({ text: UI.bannerLead });
		const list = banner.content.createEl('ul');
		for (const i of blocking) list.createEl('li', { text: issueText(i) });
	}

	/** The block can be edited in a window here: an editable view, not the static phone preview (D1, D36). */
	protected canEditWindows(): boolean {
		return !this.readOnly && !this.blocked && !this.inForeignView() && !!this.handle && (!!this.full || !this.coarse);
	}

	/**
	 * Read-only views get "Open note" and no edit affordances (spec §6.1). An editable view
	 * on a desktop gets the resize handle (spec §7.5), unless editing is off (spec §8).
	 */
	protected updateEditUi(): void {
		// Spec §7.7: the low bar of a very large tree has no edit tools; the tree is edited after "Draw the tree" or in the text.
		if (this.large) return;
		const errorBox = this.errorBox;
		if (errorBox) {
			this.updateErrorUi(errorBox);
			return;
		}
		const empty = this.emptyEl;
		if (empty) {
			const foreign = empty.isConnected && this.inForeignView();
			const ro = this.readOnly || foreign;
			empty.parentElement?.toggleClass('dynasty-read-only', ro);
			empty.querySelector<HTMLButtonElement>('.dynasty-add-first')?.toggle(!ro);
			// A block whose place is only not known YET says nothing (D183).
			const say = ro && (foreign || !this.binding.placePending);
			let label = empty.querySelector<HTMLElement>('.dynasty-read-only-label');
			if (say && !label) label = empty.createDiv({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
			else if (!say && label) label.remove();
			return;
		}
		const vp = this.viewport;
		const root = vp?.parentElement;
		if (!vp || !root) return;
		const foreign = vp.isConnected && this.inForeignView();
		const readOnly = this.readOnly || foreign;
		// A block whose place is only not known YET shows no label and no chip (D183); the edit tools stay away.
		const say = readOnly && (foreign || !this.binding.placePending);
		root.toggleClass('dynasty-read-only', readOnly);
		let bar = vp.querySelector<HTMLElement>('.dynasty-toolbar');
		if (!bar) {
			bar = vp.createDiv({ cls: 'dynasty-toolbar' });
			// First in the viewport, so Tab reaches the toolbar before the cards (spec §5.2).
			vp.prepend(bar);
		}
		let open = bar.querySelector<HTMLElement>('.dynasty-open-source');
		if (say && !open) {
			open = bar.createEl('button', { cls: ['dynasty-tool', 'dynasty-open-source'], attr: { type: 'button', 'aria-label': BLOCK_UI.openSourceLabel } });
			setIcon(open.createSpan({ cls: 'dynasty-tool-icon' }), 'file-symlink');
			open.createSpan({ cls: 'dynasty-tool-text', text: BLOCK_UI.openSource });
			open.addEventListener('click', (e) => this.guard(() => this.openSource(e)));
		} else if (!say && open) {
			open.remove();
			open = null;
		}
		// Say why a press on a card does nothing.
		const noEdits = readOnly || this.blocked;
		if (this.listEl) setListEditable(this.listEl, !noEdits);
		let label = bar.querySelector<HTMLElement>('.dynasty-read-only-label');
		const showLabel = say || this.blocked;
		if (showLabel && !label) {
			label = bar.createSpan({ cls: 'dynasty-read-only-label', text: BLOCK_UI.readOnly });
		} else if (!showLabel && label) {
			label.remove();
			label = null;
		}
		// Spec §6.10: "Add person" on embedded desktop and embedded touch views that can be edited. The computer row shows its word (0.2.8, G.13); the phone bars show the icon.
		const canAdd = !noEdits && !!this.handle;
		const kind = this.barKind();
		let add = bar.querySelector<HTMLElement>('.dynasty-add-person');
		if (canAdd && !add) {
			add = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-add-person'], attr: { 'aria-label': this.listMode ? PHONE_LIST_UI.addPersonLabel : ADD_UI.addPerson, type: 'button' } });
			setIcon(add.createSpan({ cls: 'dynasty-tool-icon' }), 'user-plus');
			if (kind === 'desktop') {
				add.addClass('dynasty-tool-main');
				add.createSpan({ cls: 'dynasty-tool-text', text: PHONE_LIST_UI.addPerson });
			}
			add.addEventListener('click', () => this.guard(() => void this.openNewPerson()));
		} else if (!canAdd && add) {
			add.remove();
			add = null;
		}
		// D176 (2): in the list (no More list) the button for the tree text sits next to Add person.
		const canText = this.listMode && this.canShowText();
		let text = bar.querySelector<HTMLElement>('.dynasty-show-text');
		if (canText && !text) {
			text = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-show-text'], attr: { 'aria-label': BLOCK_UI.showTextLabel, type: 'button' } });
			setIcon(text.createSpan({ cls: 'dynasty-tool-icon' }), 'code');
			text.addEventListener('click', () => this.guard(() => void this.showText()));
		} else if (!canText && text) {
			text.remove();
			text = null;
		}
		// D36: Houses next to Add person, on the computer and in the full-screen view; not in the static touch embed (D1).
		const canHouses = canAdd && (!!this.full || !this.coarse);
		let houses = bar.querySelector<HTMLElement>('.dynasty-houses-button');
		if (canHouses && !houses) {
			houses = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-houses-button'], attr: { 'aria-label': TOOLBAR_UI.housesLabel, type: 'button' } });
			setIcon(houses.createSpan({ cls: 'dynasty-tool-icon' }), 'castle');
			houses.addEventListener('click', () => this.guard(() => void this.openHouses()));
		} else if (!canHouses && houses) {
			houses.remove();
			houses = null;
		}
		// Titles leave the More list on the computer (0.2.8, G.13): a button of their own next to Houses. On a phone they stay in More.
		const canTitles = kind === 'desktop' && this.canEditWindows();
		let titles = bar.querySelector<HTMLElement>('.dynasty-titles-button');
		if (canTitles && !titles) {
			titles = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-titles-button'], attr: { 'aria-label': TITLES_UI.moreLabel, type: 'button' } });
			setIcon(titles.createSpan({ cls: 'dynasty-tool-icon' }), 'crown');
			titles.addEventListener('click', () => this.guard(() => void this.openTitles()));
		} else if (!canTitles && titles) {
			titles.remove();
			titles = null;
		}
		bar.querySelector<HTMLElement>('.dynasty-sep-a')?.toggle(!!houses || !!titles);
		this.orderBar(bar);
		if (!bar.childElementCount) bar.remove();
		// The toolbar can be wider now (Add person): the D28 hint stays left of it.
		this.placeHints();
		const resizable = !this.full && !readOnly && !this.coarse && !this.blocked && !!this.handle && !this.isPhone();
		let grip = root.querySelector<HTMLElement>(':scope > .dynasty-resize');
		// The handle stands below the box, inside the root: the root changes height and the box does not, so the resize observer
		// of the box says nothing. The kept height of the next cold start is the height of the root (D183).
		if (resizable && !grip) {
			grip = this.buildResizeHandle(root, vp);
			this.keepHeight();
		} else if (!resizable && grip) {
			grip.remove();
			this.keepHeight();
		}
	}

	/** F8: the error box has "Show the tree text" while the block is known and can be edited here; the button leaves again if it cannot (a read-only view). */
	protected updateErrorUi(content: HTMLElement): void {
		const can = !this.readOnly && !this.inForeignView() && !!this.handle;
		const button = content.querySelector<HTMLElement>('.dynasty-error-button');
		if (can && !button) {
			content.createEl('button', { cls: 'dynasty-error-button', text: BLOCK_UI.showText, attr: { type: 'button' } }).addEventListener('click', () => this.guard(() => void this.showText()));
		} else if (!can && button) button.remove();
	}

	/** The block can be edited here (the same test as for "Add person" in the bar): the item "Show the tree text" needs it. */
	protected canShowText(): boolean {
		return !this.readOnly && !this.blocked && !this.inForeignView() && !!this.handle;
	}

	/**
	 * "Show the tree text" (D176 item 2): the note opens for edits with the cursor at the start of the block text. The
	 * full-screen view closes first (`openNote`), so the note is visible. The block comes from the handle, which tracks it.
	 */
	protected async showText(): Promise<void> {
		const handle = await this.validHandle();
		if (!handle || this.unloaded) return;
		const { path, ordinal } = handle.key;
		this.openNote(() => this.host.handles.showSource(path, ordinal).then(() => undefined));
	}

	protected openSource(e: MouseEvent): void {
		const where = Keymap.isModEvent(e);
		this.openNote(() => this.host.app.workspace.openLinkText(this.sourcePath, '', where));
	}

	/** Desktop resize handle (spec §7.5): a drag changes the height; the release writes `options.height`. */
	protected buildResizeHandle(root: HTMLElement, vp: HTMLElement): HTMLElement {
		const grip = root.createDiv({ cls: 'dynasty-resize', attr: { role: 'separator', 'aria-orientation': 'horizontal', 'aria-label': BLOCK_UI.resizeLabel } });
		let drag: { pointer: number; y: number; h: number; moved: boolean } | null = null;
		grip.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || !e.isPrimary || e.pointerType === 'touch') return;
			e.preventDefault();
			drag = { pointer: e.pointerId, y: e.clientY, h: vp.getBoundingClientRect().height, moved: false };
			try {
				grip.setPointerCapture(e.pointerId);
			} catch {
				// The drag still works without capture.
			}
			root.addClass('dynasty-resizing');
		});
		grip.addEventListener('pointermove', (e) => {
			if (!drag || drag.pointer !== e.pointerId) return;
			const h = Math.round(Math.min(5000, Math.max(100, drag.h + e.clientY - drag.y)));
			drag.moved ||= Math.abs(e.clientY - drag.y) >= 2;
			this.dragHeight = h;
			this.updateHeight();
		});
		const end = (e: PointerEvent) => {
			const d = drag;
			if (!d || d.pointer !== e.pointerId) return;
			drag = null;
			root.removeClass('dynasty-resizing');
			const h = this.dragHeight;
			// A press with no real drag writes nothing: the box goes back to its height, and later settings apply.
			if (!d.moved || h === null || h === this.optionsHeight) {
				this.resetHeight();
				return;
			}
			this.guard(() => {
				this.writeHeight(h).catch((e) => {
					console.error('Crown and Kin: cannot save the height', e);
					this.heightFailed();
				});
			});
		};
		grip.addEventListener('pointerup', end);
		grip.addEventListener('pointercancel', end);
		return grip;
	}

	protected async writeHeight(h: number): Promise<void> {
		const handle = await this.validHandle();
		if (!handle) {
			this.heightFailed();
			return;
		}
		this.keepView();
		const out = await handle.write({ kind: 'set-option', key: 'height', value: h });
		if (!out.ok) {
			if (out.code === 'stale') {
				new Notice(WRITE_TEXT.stale);
				this.resetHeight();
			} else this.heightFailed();
		}
	}

	protected heightFailed(): void {
		new Notice(WRITE_TEXT.heightFailed);
		this.resetHeight();
	}

	protected resetHeight(): void {
		if (this.unloaded) return;
		this.dragHeight = null;
		this.updateHeight();
	}

	/** Find (spec §6.10): the picker with every person; centres and highlights the choice, no focus mode. */
	protected async find(): Promise<void> {
		const g = this.whole;
		// A retired view is only a picture: its toolbar opens nothing.
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FULL_UI.findPlaceholder, FULL_UI.findTitle, false, null, null, this.pickerContext());
		if (picked?.kind !== 'person' || this.unloaded) return;
		// Spec §7.7: there is no tree to centre in under the low bar; the person's family is the way on.
		if (this.large) {
			this.guard(() => this.focusOn(picked.id));
			return;
		}
		// Find never enters focus mode (spec §6.10); a person outside the focus family is shown in the whole tree.
		this.guard(() => this.showPeople([picked.id]));
	}

	/** Toolbar Focus (spec §5.6, §6.6): the picker with every person of the whole tree, and no "Create" row. */
	protected async pickFocusPerson(): Promise<void> {
		const g = this.whole;
		// A retired view is only a picture: its toolbar opens nothing.
		if (!g || this.unloaded) return;
		const picked = await pickPerson(this.host.app, g, new Set(), FOCUS_UI.pickerPlaceholder, FOCUS_UI.pickerTitle, false, null, null, this.pickerContext());
		if (picked?.kind !== 'person' || this.unloaded) {
			// No choice: the keyboard focus goes back to the Focus button (spec §5.2), as for the finder's pickers.
			this.guard(() => this.refocusTool('.dynasty-focus'));
			return;
		}
		this.guard(() => this.focusOn(picked.id));
	}

	/**
	 * How the toolbar menus open (0.2.8, G.13): a sheet from the bottom of the phone's full-screen view, else a menu under the button that opened it.
	 */
	protected menuPlace(opener: HTMLElement): { anchor?: DOMRect; opts: PopoverOptions } {
		return this.barKind() === 'phone' ? { opts: { sheet: true, reduced: () => this.reduced() } } : { anchor: opener.getBoundingClientRect(), opts: { align: 'start' } };
	}

	/** One row of a toolbar menu: its icon, its text and the accessible name; a key press gives the focus back to the opener, a picker or a new menu takes it itself. */
	protected menuItem(pop: Popover, el: HTMLElement, icon: string, text: string, cls: string, run: (keyboard: boolean) => void, label?: string): HTMLElement {
		const b = el.createEl('button', { cls: ['dynasty-popover-item', 'dynasty-more-item', cls], attr: { type: 'button', role: 'menuitem' } });
		if (label) b.setAttribute('aria-label', label);
		setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), icon);
		b.createSpan({ cls: 'dynasty-more-text', text });
		b.addEventListener('click', (e) => {
			pop.close(!e.detail);
			this.guard(() => run(!e.detail));
		});
		return b;
	}

	/**
	 * The Focus button of the toolbar (D132, D263 B2). While a focus shows, one tap clears it: all people show again, nothing is written and a pin stays in the
	 * note (`focusOn(null)`). Choose a person and Focus on you are one tap further then (Clear focus, then Focus); a `+` badge and Focus here in the person window
	 * change the focus at once. With no focus the button opens the list: Choose a person opens the picker, Focus on you (only with a marked person) shows the
	 * family of that person.
	 */
	protected toggleFocusList(opener: HTMLElement, keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (this.focusId !== null) {
			pop.close();
			// The redraw builds the Focus button again; a key press has the keyboard focus on the new button.
			if (keyboard) this.focusDue = '.dynasty-focus';
			this.focusOn(null);
			return;
		}
		if (pop.kind === 'focus') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'focus',
			(el) => {
				const first = this.menuItem(pop, el, 'user', FOCUS_UI.choose, 'dynasty-focus-choose', () => void this.pickFocusPerson(), FOCUS_UI.chooseLabel);
				const me = this.meId;
				if (me !== null) this.menuItem(pop, el, 'user-check', TOOLBAR_UI.focusOnYou, 'dynasty-focus-me', () => this.focusOn(me));
				// Enter or Space on Focus moves the focus into the list (spec §5.2).
				if (keyboard) first.focus();
			},
			opener,
			where.anchor,
			where.opts,
		);
		opener.setAttribute('aria-expanded', 'true');
		pop.whenClosed(() => opener.setAttribute('aria-expanded', 'false'));
	}

	/** Which toolbar this view has (0.2.8, G.13): the row of the computer, the bar at the bottom of the phone's full-screen view, or the bar of the phone list. */
	protected barKind(): 'desktop' | 'phone' | 'list' {
		if (this.listMode) return 'list';
		return this.full && this.isPhone() ? 'phone' : 'desktop';
	}

	/**
	 * The order of the toolbar (0.2.8, G.13), by class: the computer row is Add person, Find, Focus, Fit | Houses, Titles | More … Expand (or Close); the phone's
	 * bottom bar is Add person, Houses, Focus, Find, More, Close; the list's bar is Add person, the tree text … Find, Back, Expand. The problem badge is
	 * always next to the last button. A part that the view does not make is simply not in the bar. Only what is out of place moves: a move takes the keyboard focus from a button.
	 */
	protected orderBar(bar: HTMLElement): void {
		const order = BAR_ORDER[this.barKind()];
		const rank = (el: Element) => {
			const i = order.findIndex((c) => (el as HTMLElement).hasClass(c));
			return i < 0 ? order.length : i;
		};
		const want = Array.from(bar.children).sort((a, b) => rank(a) - rank(b));
		want.forEach((e, i) => {
			const at = bar.children[i] ?? null;
			if (at !== e) bar.insertBefore(e, at);
		});
	}

	protected buildToolbar(viewport: HTMLElement): void {
		const { bar, button } = toolbarIn(viewport);
		const kind = this.barKind();
		// §6.10: Add person, Houses and Titles are added by updateEditUi once the block's handle is known. A static touch embed
		// has no Find, Focus or More (D1): it shows what the block and the session choose.
		if (this.full || !this.coarse) {
			const find = button('search', FULL_UI.find, 'dynasty-find');
			find.addEventListener('click', () => this.guard(() => void this.find()));
			const on = this.focusId !== null;
			const focus = button('crosshair', on ? FOCUS_UI.focusOn : FOCUS_UI.focus, 'dynasty-focus');
			focus.toggleClass('is-active', on);
			// While a focus shows, a tap clears it and opens no menu (D263 B2). The name says what the tap does, so the button is no toggle (no aria-pressed).
			if (!on) {
				focus.setAttribute('aria-haspopup', 'true');
				focus.setAttribute('aria-expanded', 'false');
			}
			focus.addEventListener('click', (e) => this.guard(() => this.toggleFocusList(focus, !e.detail)));
			if (kind === 'desktop') {
				const fit = button('minimize', UI.fit, 'dynasty-fit');
				fit.addEventListener('click', () => this.guard(() => this.fit()));
				// The two bars between the groups: the first goes while the block cannot be edited (no Houses, no Titles).
				bar.createSpan({ cls: ['dynasty-sep', 'dynasty-sep-a'], attr: { 'aria-hidden': 'true' } });
				bar.createSpan({ cls: ['dynasty-sep', 'dynasty-sep-b'], attr: { 'aria-hidden': 'true' } });
			}
			// D49: new actions go into one More list; the static touch preview has none (D1, like D36).
			const more = button('more-horizontal', FINDER_UI.more, 'dynasty-more');
			more.setAttribute('aria-haspopup', 'true');
			more.addEventListener('click', (e) => this.guard(() => this.toggleMore(more, !e.detail)));
		}
		if (kind !== 'phone') bar.createSpan({ cls: 'dynasty-grow', attr: { 'aria-hidden': 'true' } });
		this.updateBadge(bar);
		if (this.full) this.closeButton(bar);
		else {
			// Corner brackets read as "full screen"; Fit uses the brackets turned inward.
			const expand = button('maximize', FULL_UI.expand, 'dynasty-expand');
			expand.addEventListener('click', () => this.guard(() => void this.openFull(null)));
		}
		this.orderBar(bar);
	}

	protected closeButton(bar: HTMLElement): void {
		const full = this.full;
		if (!full) return;
		const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-close'], attr: { 'aria-label': FULL_UI.close, type: 'button' } });
		setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), 'x');
		b.addEventListener('click', () => full.close(null));
	}

	/**
	 * Closes an open popover (legend, partner list, problems, More) with the focus back on its opener,
	 * else the relation finder's result (spec §13.2) or the Show view of a line of succession; false if none was open. The full-screen view
	 * asks first when Obsidian closes it (Esc, Android back).
	 */
	closePopover(): boolean {
		const pop = this.popover;
		if (pop?.isOpen) {
			pop.close(true);
			return true;
		}
		if (this.unloaded) return false;
		if (this.successionDrawn) {
			this.closeSuccession();
			return true;
		}
		if (!this.finderDrawn) return false;
		this.closeFinder();
		return true;
	}

	/** The line styles (D25, D196 item 3): a menu under the More button on the computer; on a phone a sheet with Close, and a tap outside closes it. */
	protected toggleLegend(opener: HTMLElement): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'legend') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'legend',
			(el) => {
				if (where.opts.sheet) {
					const head = el.createDiv({ cls: 'dynasty-sheet-head' });
					head.createSpan({ cls: 'dynasty-popover-title', text: UI.legendTitle });
					const close = head.createEl('button', { cls: ['dynasty-link', 'dynasty-sheet-close'], text: SHEET.close, attr: { type: 'button' } });
					close.addEventListener('click', () => pop.close(true));
				} else el.createDiv({ cls: 'dynasty-popover-title', text: UI.legendTitle });
				buildLegend(el.createDiv({ cls: 'dynasty-legend' }));
				// A sheet has its own height rules (rows of 40 px, scrolls); only the menu of a computer is made compact to fit a short box.
				if (!where.opts.sheet) fitLegend(el);
			},
			opener,
			where.anchor,
			where.opts,
		);
	}

	protected toggleProblems(opener: HTMLElement, issues: CodedIssue[], keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'problems') {
			pop.close();
			return;
		}
		const whole = this.whole;
		pop.open(
			'problems',
			(el) => {
				const c = buildCallout(el, 'warning', problemsTitle(issues.length), 'dynasty-problems', setIcon);
				// In focus mode a problem can be about people who are not drawn: like Find, the button then shows all people (spec §6.10).
				const shown = issues.map((i) => ({ issue: i, people: (i.ids ?? []).filter((id) => whole?.byId.has(id) && (this.g?.byId.has(id) || this.focusId !== null)) }));
				if (shown.some((s) => s.people.length)) c.content.createDiv({ cls: 'dynasty-problems-hint', text: PROBLEMS_HINT });
				const list = c.content.createEl('ul', { cls: 'dynasty-problems-list' });
				for (const { issue, people } of shown) {
					const li = list.createEl('li', { cls: issue.level === 'blocking' ? 'dynasty-problem is-blocking' : 'dynasty-problem' });
					if (!people.length) {
						li.setText(issueText(issue));
						continue;
					}
					const b = li.createEl('button', { cls: 'dynasty-problem-button', text: issueText(issue) });
					b.addEventListener('click', () => {
						pop.close();
						this.guard(() => {
							// D1: the static touch preview never moves; like a tag tap (D17), the full-screen view opens on the person.
							if (!this.full && this.coarse) void this.openFull(people[0]);
							else this.showPeople(people);
						});
					});
				}
				// Enter or Space on the badge moves the focus into the list: its buttons come last in the Tab order (spec §5.2).
				if (keyboard) el.querySelector<HTMLElement>('.dynasty-problem-button')?.focus();
			},
			opener,
		);
	}

	/**
	 * The problem badge shows the problems as they are now (spec §8): made, changed or removed in place.
	 * A picture warning that the file check finds later changes only the badge (O2).
	 */
	protected updateBadge(bar: HTMLElement | null = this.viewport?.querySelector<HTMLElement>(':scope > .dynasty-toolbar') ?? null): void {
		if (!bar) return;
		const issues = this.allIssues();
		let badge = bar.querySelector<HTMLElement>(':scope > .dynasty-warning-badge');
		if (!issues.length) {
			badge?.remove();
			return;
		}
		if (!badge) {
			const b = bar.createEl('button', { cls: ['clickable-icon', 'dynasty-tool', 'dynasty-warning-badge'], attr: { type: 'button' } });
			setIcon(b.createSpan({ cls: 'dynasty-tool-icon' }), 'alert-triangle');
			b.createSpan({ cls: 'dynasty-warning-count' });
			// A click that a key makes has no press count (detail 0); a mouse or touch press has 1 or more.
			b.addEventListener('click', (e) => this.guard(() => this.toggleProblems(b, this.allIssues(), !e.detail)));
			// Before Close or Expand, as when the toolbar is built.
			this.orderBar(bar);
			badge = b;
		}
		const label = problemsLabel(issues.length);
		if (badge.getAttribute('aria-label') !== label) badge.setAttribute('aria-label', label);
		const count = badge.querySelector<HTMLElement>('.dynasty-warning-count');
		if (count && count.getText() !== String(issues.length)) count.setText(String(issues.length));
	}

	/**
	 * The More button (D49, 0.2.8 G.13): the menu of the toolbar. On a phone Fit and Titles come first (the phone's bar has neither button); then the line
	 * styles (the legend), Relation (spec §13.2), Save as picture (spec §13.8) and, where the block can be edited, Show the tree text. Titles of the computer have a button of their own.
	 */
	protected toggleMore(opener: HTMLElement, keyboard: boolean): void {
		const pop = this.popover;
		if (!pop) return;
		if (pop.kind === 'more') {
			pop.close();
			return;
		}
		const where = this.menuPlace(opener);
		pop.open(
			'more',
			(el) => {
				const item = (icon: string, text: string, cls: string, run: () => void, label?: string) => this.menuItem(pop, el, icon, text, cls, run, label);
				const rows: HTMLElement[] = [];
				if (this.barKind() === 'phone') {
					rows.push(item('minimize', UI.fit, 'dynasty-more-fit', () => this.fit()));
					// Spec §13.4, D49: the Titles window, where the block can be edited.
					if (this.canEditWindows()) rows.push(item('crown', TITLES_UI.more, 'dynasty-more-titles', () => void this.openTitles(), TITLES_UI.moreLabel));
				}
				rows.push(item('book-open', UI.legend, 'dynasty-more-legend', () => this.toggleLegend(opener)));
				rows.push(item('route', FINDER_UI.relation, 'dynasty-more-relation', () => void this.startFinder(), FINDER_UI.relationLabel));
				// Spec §13.8, O11: wherever the More list is, read-only views included.
				if (this.laid) rows.push(item('image-down', SAVE_UI.more, 'dynasty-more-save', () => this.openSave(), SAVE_UI.moreLabel));
				// Spec §14 rule 7: the Calendars window of every tree, and the calendar note of the tree where the block can be edited.
				if (this.host.dates) rows.push(item('calendar-days', CALENDAR_UI.more, 'dynasty-more-calendars', () => this.openCalendarWindow(), CALENDAR_UI.moreLabel));
				if (this.host.dates && this.canEditWindows()) rows.push(item('calendar-check', CALENDAR_UI.noteMore, 'dynasty-more-calendar-note', () => void this.chooseNote(), CALENDAR_UI.noteMoreLabel));
				// D176 (2): the last item, where the block can be edited.
				if (this.canShowText()) rows.push(item('code', BLOCK_UI.showText, 'dynasty-more-text-source', () => void this.showText(), BLOCK_UI.showTextLabel));
				// Enter or Space on More moves the focus into the list (spec §5.2).
				if (keyboard) rows[0].focus();
			},
			opener,
			where.anchor,
			where.opts,
		);
	}

	/** More → Calendars (spec §14 rule 7): the window with the calendars of this tree's calendar notes. */
	protected openCalendarWindow(): void {
		if (this.host.dates) void openCalendars(this.host.app, this.host.dates, { treePath: this.sourcePath, link: this.reading?.link, onClosed: () => this.refocusTool('.dynasty-more') });
	}

	/** More → Calendar note (spec §14 rule 7): the one calendar note of this tree, or every calendar note. */
	protected async chooseNote(): Promise<void> {
		const h = await this.validHandle();
		if (h && this.host.dates && !this.unloaded) await chooseCalendarNote(this.host.app, this.host.dates, h, this.sourcePath, this.reading?.link);
		this.guard(() => this.refocusTool('.dynasty-more'));
	}

	/**
	 * A picker closed with no choice: the keyboard focus goes back to the toolbar button that led to
	 * it (More, Focus; spec §5.2), as the item that had it is gone with its list. Not while another
	 * window of the plugin is open.
	 */
	protected refocusTool(selector: string): void {
		if (this.unloaded || pluginModalOpen()) return;
		const tool = this.viewport?.querySelector<HTMLElement>(selector);
		if (tool?.isConnected) tool.focus();
	}
}
