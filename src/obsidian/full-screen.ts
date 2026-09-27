import { Modal, Notice, TFile, type EventRef } from 'obsidian';
import { FULL_UI } from '../render/ui-text';
import { PHONE_MAX_WIDTH } from '../render/view-math';
import { TreeView, type FullHost, type FullSource, type TreeHost } from './tree-view';

/*
 * The full-screen view (spec §7.1): an Obsidian Modal that fills the viewport, on desktop and touch
 * alike, with a second TreeView of the same block. That view shares the embed's BlockHandle and
 * view state and follows the handle, so edits from here re-render it like the embed. The modal
 * closes with Close, Esc or the Android back button (Obsidian closes the top modal), and when its
 * block disappears or cannot be drawn any more (with a Notice).
 */

let titles = 0;

// Obsidian's sidebar swipe and pull-down gestures listen above the modal; these must not reach them (spec §7.2).
const STOPPED = ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'];

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
		for (let el: HTMLElement | null = opener.parentElement; el; el = el.parentElement) {
			if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) this.scrolls.push({ el, top: el.scrollTop, left: el.scrollLeft });
		}
	}

	override onOpen(): void {
		const { modalEl, containerEl, contentEl } = this;
		containerEl.addClass('dynasty-fullscreen-container');
		modalEl.addClass('dynasty-fullscreen');
		// Named by its (hidden) title, not aria-label: Obsidian shows an aria-label as a tooltip on
		// every free point of the modal.
		const titleId = `dynasty-fullscreen-title-${++titles}`;
		this.setTitle(FULL_UI.dialog);
		this.titleEl.setAttribute('id', titleId);
		modalEl.setAttribute('aria-labelledby', titleId);
		contentEl.addClass('dynasty-fullscreen-content');
		const win = modalEl.win ?? window;
		const layout = () => modalEl.toggleClass('is-phone', win.innerWidth < PHONE_MAX_WIDTH);
		layout();
		win.addEventListener('resize', layout);
		this.cleanup.push(() => win.removeEventListener('resize', layout));
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
		const box = contentEl.createDiv({ cls: 'dynasty-fullscreen-tree' });
		try {
			this.tree = new TreeView(this.host, box, this.from.source, { kind: 'full', from: this.from, host: this });
			this.tree.load();
		} catch (e) {
			console.error('Dynasty Tree: cannot show the full-screen view', e);
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
				console.error('Dynasty Tree: cannot close the full-screen view', e);
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
				console.error('Dynasty Tree: cannot clean up the full-screen view', e);
			}
		}
		const key = this.tree?.stateKey ?? this.from.key;
		try {
			this.tree?.unload();
		} catch (e) {
			console.error('Dynasty Tree: cannot close the full-screen view', e);
		}
		this.tree = null;
		this.contentEl.empty();
		for (const v of this.host.views) if (v.stateKey === key && !v.isFull) v.adoptView();
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
		(this.modalEl.win ?? window).requestAnimationFrame(() => {
			restore();
			// Opened only now, so that the note's history entry keeps its scroll position.
			try {
				after?.();
			} catch (e) {
				console.error('Dynasty Tree: cannot open the note', e);
			}
		});
	}
}
