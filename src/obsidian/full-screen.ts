/*
 * The full-screen view (spec §7.1): an Obsidian Modal that fills the viewport, on desktop and touch
 * alike, with a second TreeView of the same block. That view shares the embed's BlockHandle and
 * view state and follows the handle, so edits from here re-render it like the embed. The modal
 * closes with Close, Esc or the Android back button (Obsidian closes the top modal), and when its
 * block disappears or cannot be drawn any more (with a Notice).
 */

import { Modal, Notice, TFile, type EventRef } from 'obsidian';
import { FULL_UI } from '../render/ui-text';
import { isPhoneSideways } from '../view/focus-mode';
import { isPhoneWidth } from './modal-layout';
import { nameDialog } from './sheet-parts';
import { TreeView, type FullHost, type FullSource, type TreeHost } from './tree-view';
import { TreeViewBase, showsRing } from './tree-view-base';

// Obsidian's sidebar swipe and pull-down gestures listen above the modal; these must not reach them (spec §7.2).
const STOPPED = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'];

/** The full-screen view (spec §7.1): an Obsidian Modal that hosts a second `TreeView` of the same block. */
export class FullScreenModal extends Modal implements FullHost {
	/** Open full-screen views; the plugin closes them when it unloads, so none writes to a note after that. */
	static readonly openViews = new Set<FullScreenModal>();
	private tree: TreeView | null = null;
	focus: { id: string | null } | null;
	private readonly cleanup: (() => void)[] = [];
	private closing = false;
	/** Runs once the note under the view has its scroll position back (a link opens after Close). */
	private after: (() => void) | null = null;
	/** The note's scroll position when the view opened, restored on close (spec §7.1). */
	private readonly scrolls: { el: HTMLElement; top: number; left: number }[] = [];
	/** Expand had the keyboard focus when the view opened (and showed its ring or not): it gets the focus back on close, also when an edit drew the note's tree again (G5 0.4). */
	private readonly expandBack: { visible: boolean } | null;

	constructor(
		private readonly host: TreeHost,
		private readonly from: FullSource,
		public target: string | null,
		opener: HTMLElement,
		/** D21: the family to show, from a badge tap in a static embed; not the block's session focus. */
		focusId: string | null = null,
	) {
		super(host.app);
		this.focus = focusId === null ? null : { id: focusId };
		const active = opener.doc?.activeElement;
		this.expandBack = active && opener.contains(active) && active.matches('.dynasty-expand') ? { visible: showsRing(active) } : null;
		for (let el: HTMLElement | null = opener.parentElement; el; el = el.parentElement) {
			if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) this.scrolls.push({ el, top: el.scrollTop, left: el.scrollLeft });
		}
	}

	override onOpen(): void {
		const { modalEl, containerEl, contentEl } = this;
		containerEl.addClass('dynasty-fullscreen-container');
		modalEl.addClass('dynasty-fullscreen');
		// Named by its (hidden) title, not aria-label: Obsidian shows an aria-label as a tooltip on
		// every free point of the modal. nameDialog also sets role="dialog" and aria-modal (spec §13.18 rule 11).
		this.setTitle(FULL_UI.dialog);
		nameDialog(modalEl, this.titleEl);
		contentEl.addClass('dynasty-fullscreen-content');
		const win = modalEl.win ?? window;
		// D242: `is-phone` (a window under 600 px) and `is-phone-side` (a phone held sideways) give the same bottom bar. The sideways test
		// is the one that picks the phone's buttons, so the look and the button set agree. The tree reads the coarse pointer when it is made; so does this.
		const coarse = win.matchMedia?.('(pointer: coarse)')?.matches === true;
		const layout = () => {
			modalEl.toggleClass('is-phone', isPhoneWidth(win));
			const was = modalEl.hasClass('is-phone-side');
			const now = isPhoneSideways(coarse, win);
			if (was === now) return;
			modalEl.toggleClass('is-phone-side', now);
			// The bar is an overlay, so the box of the tree keeps its size when the bar changes edge: the free area is measured again.
			this.tree?.barMoved();
		};
		layout();
		// A turn can send the event before the window has its new size (iOS), so the class is checked again shortly after.
		let later = 0;
		const turned = () => {
			layout();
			win.clearTimeout(later);
			later = win.setTimeout(layout, 300);
		};
		win.addEventListener('resize', layout);
		win.addEventListener('orientationchange', turned);
		this.cleanup.push(() => {
			win.removeEventListener('resize', layout);
			win.removeEventListener('orientationchange', turned);
			win.clearTimeout(later);
		});
		for (const type of STOPPED) {
			const stop = (e: Event) => e.stopPropagation();
			containerEl.addEventListener(type, stop);
			this.cleanup.push(() => containerEl.removeEventListener(type, stop));
		}
		FullScreenModal.openViews.add(this);
		// For the page preview of a linked name, which Obsidian puts outside the modal (styles.css).
		const body = (modalEl.doc ?? document).body;
		body.addClass('dynasty-fullscreen-open');
		this.cleanup.push(() => {
			FullScreenModal.openViews.delete(this);
			if (![...FullScreenModal.openViews].some((m) => (m.modalEl.doc ?? document).body === body)) body.removeClass('dynasty-fullscreen-open');
		});
		this.watchNote();
		// The note's tree of the same block is hidden now: it stops asking for pictures, so this view gets them first.
		for (const v of this.host.views) {
			if (v.stateKey === this.from.key && !v.isFull) v.pausePictures();
		}
		const box = contentEl.createDiv({ cls: 'dynasty-fullscreen-tree' });
		try {
			this.tree = new TreeView(this.host, box, this.from.source, { kind: 'full', from: this.from, host: this });
			this.tree.load();
		} catch (e) {
			console.error('Crown and Kin: cannot show the full-screen view', e);
			this.close(FULL_UI.failed);
		}
	}

	/** The note's path now: the tree view follows a rename (the plugin tells every view). */
	private get notePath(): string {
		return this.tree?.notePath ?? this.from.sourcePath;
	}

	/** The block's note is deleted, or (for a read-only view, which has no handle) changed. */
	private watchNote(): void {
		const vault = this.app.vault;
		const refs: EventRef[] = [
			vault.on('delete', (f) => {
				if (f.path === this.notePath) this.close(FULL_UI.gone);
			}),
			vault.on('modify', (f) => {
				if (f.path !== this.notePath || !(f instanceof TFile) || !this.tree || this.from.handle) return;
				vault.cachedRead(f).then(
					(text) => this.tree?.stillThere(text),
					() => this.tree?.stillThere(null),
				);
			}),
		];
		this.cleanup.push(() => refs.forEach((r) => vault.offref(r)));
	}

	/**
	 * `notice` absent: Obsidian closes the view (Esc, Android back). An open legend or partner list
	 * closes first, with the focus back on its opener (spec §5.2); Obsidian's own Esc handler runs
	 * before any listener of the plugin, so the tree cannot stop that key itself. The plugin passes a
	 * string or null; Obsidian 1.13 passes the event that closed the view (a phone showed the Notice
	 * "[object PointerEvent]"), so only a non-empty string is a Notice text.
	 */
	override close(notice?: unknown): void {
		const byObsidian = notice !== null && typeof notice !== 'string';
		if (byObsidian && !this.closing && this.tree?.closePopover()) return;
		if (this.closing) return;
		this.closing = true;
		if (typeof notice === 'string' && notice !== '') new Notice(notice);
		super.close();
	}

	/** Closes the view, then runs `then` (opens a note) once the note under it has its scroll back (spec §7.1). */
	leave(then: () => void): void {
		if (!this.closing) {
			this.after = then;
			this.close(null);
			return;
		}
		// Already closed (hard error, block gone, plugin unload) under a sheet: the note still opens.
		then();
	}

	/** Is a full-screen view of the block with view-state key `key` open? */
	static isOpenFor(key: string): boolean {
		return [...FullScreenModal.openViews].some((m) => !m.closing && (m.tree?.stateKey ?? m.from.key) === key);
	}

	/** The plugin unloads: close every full-screen view. */
	static closeAll(): void {
		for (const m of [...FullScreenModal.openViews]) {
			try {
				m.close(null);
			} catch (e) {
				console.error('Crown and Kin: cannot close the full-screen view', e);
			}
		}
		FullScreenModal.openViews.clear();
	}

	override onClose(): void {
		this.closing = true;
		for (const c of this.cleanup.splice(0)) {
			try {
				c();
			} catch (e) {
				console.error('Crown and Kin: cannot clean up the full-screen view', e);
			}
		}
		const key = this.tree?.stateKey ?? this.from.key;
		try {
			this.tree?.unload();
		} catch (e) {
			console.error('Crown and Kin: cannot close the full-screen view', e);
		}
		this.tree = null;
		this.contentEl.empty();
		for (const v of this.host.views) {
			if (v.stateKey !== key || v.isFull) continue;
			v.adoptView();
			v.resumePictures();
		}
		// Focus returns to the note when the modal closes; that must not move the note (spec §7.1).
		const restore = () => {
			for (const s of this.scrolls) {
				if (!s.el.isConnected) continue;
				if (s.el.scrollTop !== s.top) s.el.scrollTop = s.top;
				if (s.el.scrollLeft !== s.left) s.el.scrollLeft = s.left;
			}
		};
		restore();
		const after = this.after;
		this.after = null;
		const back = this.expandBack;
		(this.modalEl.win ?? window).requestAnimationFrame(() => {
			restore();
			try {
				if (back) TreeViewBase.refocusAfterRedraw(this.host, (v) => v.stateKey === key && !v.isFull, (vp) => vp.querySelector<HTMLElement>('.dynasty-expand'), back.visible);
			} catch (e) {
				console.error('Crown and Kin: cannot give the focus back', e);
			}
			// Opened only now, so that the note's history entry keeps its scroll position.
			try {
				after?.();
			} catch (e) {
				console.error('Crown and Kin: cannot open the note', e);
			}
		});
	}
}
