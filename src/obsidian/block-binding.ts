/*
 * The binding of one `TreeView` to its block in the note (spec §6.1): finding the block's `Handle`,
 * asking Obsidian again for the section of a late block, the retries, the look for the block after a
 * change of the note, the follow of a rename, and the wait at a cold start (D183) before the first
 * draw. `TreeView` owns one `BlockBinding`. It holds the state of this work (the key, the path, the
 * section, the handle, the timers); the view reads it through small getters and calls the binding for
 * the rest. The binding draws nothing: what needs the view (a draw, the placeholder box, the edit
 * controls, a changed body) comes back through `BindingOwner`. Split out of `tree-view.ts` in 0.3.2
 * (WP-1d) with no change of behaviour or timing.
 */

import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import { sameBody } from '../core/block-match';
import { findBlocks } from '../core/block-locate';
import { FULL_UI } from '../render/ui-text';
import { carryState, type BlockState } from '../view/block-state';
import { moveRelationBlock } from '../view/relation-cache';
import type { Handle, HandleRegistry } from './block-handle';

/** D183: the longest a tree waits for the styles, the settings and its block place on a cold start, in ms. */
export const START_LIMIT_MS = 2000;
/**
 * The hard cap of the wait for the plugin styles, in ms. Obsidian reads styles.css after `onload`, and on a cold iPhone that can take longer than
 * `START_LIMIT_MS`; a tree drawn before the styles has no layout at all. The settings and the block place keep the shorter limit.
 */
export const STYLES_LIMIT_MS = 8000;
/** A block whose section Obsidian does not tell yet is asked again for this long (ms) before it is called read only. */
const SECTION_LIMIT_MS = 5000;
/** The wait between two asks for the section of a block, in ms. */
const SECTION_STEP_MS = 250;
/** The wait between two looks at the start conditions, in ms. */
const START_STEP_MS = 50;
/** The least time between two asks for the section during the start wait. */
const ASK_GAP_MS = 100;
const RESOLVE_RETRIES_MS = [250, 1000];

/** What the binding needs of the plugin host (`TreeHost` has all of it). */
export interface BindingHost {
	/** One handle per block (spec §6.1). */
	handles: HandleRegistry;
	/** View state of read-only blocks, which have no handle, keyed by note path and text. */
	looseStates: Map<string, BlockState>;
	/** D183: absent in a host that has no cold start; the tree then draws at once. */
	readonly startedUp?: { ready(el: HTMLElement): boolean; cache(): boolean };
}

/** The full-screen modal, as far as the binding uses it. */
export interface BindingFull {
	close(notice: string | null): void;
}

/** What a full-screen view takes over from the embedded view that opened it. */
export interface BindingSource {
	key: string;
	sourcePath: string;
	handle: Handle | null;
	peeked: Handle | null;
	readOnly: boolean;
}

/** Where the view is: an embed in a note, or the full-screen view. */
export type BindingPlace = { kind: 'embed'; ctx: MarkdownPostProcessorContext } | { kind: 'full'; from: BindingSource; host: BindingFull };

/** What the view gives back to its binding. */
export interface BindingOwner {
	/** The text that the view rendered. */
	source(): string;
	unloaded(): boolean;
	/** Runs `fn`; an error never reaches Obsidian (spec §8). */
	guard(fn: () => void): void;
	updateEditUi(): void;
	/** The start conditions hold: draw the tree. */
	render(): void;
	/** The start conditions do not hold yet: show the box of the last known height. */
	showPlaceholder(): void;
	/** The handle's body changed. */
	changed(h: Handle, body: string): void;
}

/** Stable, short text hash for a block key when Obsidian cannot say where the block is. */
function shortHash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return (h >>> 0).toString(36);
}

/** The view-state key of a block: its place when Obsidian told it, else the text. */
function blockKey(path: string, ordinal: number | null, source: string): string {
	return `${path}\u0000${ordinal !== null ? `#${ordinal}` : `text ${shortHash(source)}`}`;
}

/** One view's hold on its block: handle, place, retries and the cold-start wait. */
export class BlockBinding {
	/** The key of the block's view state, shared by the embed and the full-screen view. */
	key: string;
	sourcePath: string;
	/** The section of the block; null until Obsidian tells it (on a cold start it can answer null first and a section later). */
	info: MarkdownSectionInformation | null;
	/** What Obsidian reported for this block, on the root as `data-dynasty-section` for the test harness. */
	sectionNote: string;
	/** The handle's state only for the view state until `resolve` has checked the block: never written through. */
	peeked: Handle | null;
	ready: Promise<Handle | null>;
	/** No handle (transclusion, Canvas card, hover popover, or the block cannot be told apart): no edits (spec §6.1). */
	readOnly: boolean;
	/**
	 * The place of the block is not known YET (D183): a retry or a new ask for the section is still to come. The "Read only" label and the "Open note" chip
	 * wait for it to end, so they never flash on a block that is only late.
	 */
	placePending: boolean;
	/** The block's handle once known; null while it resolves, and for a read-only view. */
	handle: Handle | null = null;
	/** The box of the last known height is on the page (the tree draws once the start conditions hold). */
	waiting = false;
	/** `onload` starts the cold-start clock (ms of `performance.now`). */
	startAt = 0;
	/** The look for the block in the note's editor has ended (a sure answer). */
	lateTried = false;
	/** The handle this view lost (detached): its session state moves to the next handle of the block (D6). */
	private lost: Handle | null = null;
	/** A look for the block after a change of the note is under way (D7). */
	private lateBusy = false;
	private unwatch: (() => void) | null = null;
	private unsubscribe: (() => void) | null = null;
	private retries = 0;
	private retryTimer = 0;
	private startTimer = 0;
	private sectionTimer = 0;
	/** `onload` has run: a section found later starts its own look for the handle. */
	private started = false;
	private lastAskAt = -Infinity;
	private readonly ctx: MarkdownPostProcessorContext | null;
	private readonly full: BindingFull | null;

	constructor(
		private readonly host: BindingHost,
		private readonly el: HTMLElement,
		place: BindingPlace,
		private readonly owner: BindingOwner,
	) {
		const source = owner.source();
		if (place.kind === 'full') {
			// The same handle, key and so view state as the embed (spec §7.1).
			const f = place.from;
			this.full = place.host;
			this.sourcePath = f.sourcePath;
			this.info = null;
			this.ctx = null;
			this.readOnly = f.readOnly || !f.handle;
			this.placePending = false;
			this.sectionNote = 'full';
			this.peeked = f.handle ?? f.peeked;
			this.key = f.key;
			this.ready = Promise.resolve(this.readOnly ? null : f.handle);
			return;
		}
		const ctx = place.ctx;
		this.ctx = ctx;
		this.full = null;
		this.sourcePath = ctx.sourcePath;
		const info = ctx.getSectionInfo(el);
		this.info = info;
		this.readOnly = info === null;
		this.placePending = info === null;
		this.sectionNote = info ? `${info.lineStart}-${info.lineEnd}` : 'none';
		const ordinal = info ? host.handles.quickOrdinal(info, source) : null;
		// Only for the view state until `resolve` has checked the block: never written through.
		// F-VIEW-03: a handle whose body is not this block's text belongs to another block (the registry has not read a change of the note yet),
		// so the view starts with a state of its own and takes the right handle's state in `attach`.
		const peek = ordinal === null ? null : host.handles.peek(ctx.sourcePath, ordinal);
		this.peeked = peek && sameBody(peek.body, source) ? peek : null;
		this.key = blockKey(ctx.sourcePath, ordinal, source);
		this.ready = info ? host.handles.resolve(ctx.sourcePath, info, source).catch(() => null) : Promise.resolve(null);
	}

	/** Obsidian called `onload` of the view: look at the note, draw or wait, and follow the handle. */
	onload(): void {
		// D7: a view that gave up finding its block tries again when the note changes (the pasted copy is deleted).
		if (this.info && !this.full) this.watch();
		this.owner.guard(() => this.begin());
		if (this.info || this.full) {
			void this.ready.then((h) => this.owner.guard(() => this.attach(h)));
		}
		this.started = true;
		if (!this.info && this.ctx) this.watchSection();
	}

	/** The view ends: no timer of the binding fires any more. */
	clearTimers(): void {
		const win = this.el.win;
		if (this.startTimer) win.clearTimeout(this.startTimer);
		if (this.sectionTimer) win.clearTimeout(this.sectionTimer);
		if (this.retryTimer) win.clearTimeout(this.retryTimer);
	}

	/** The view ends: the handle's changes and the note's changes are not followed any more. */
	release(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.unwatch?.();
		this.unwatch = null;
	}

	/** D7: the note's changes are watched, once. */
	private watch(): void {
		this.unwatch ??= this.host.handles.watchNote?.((path) => this.owner.guard(() => this.noteModified(path))) ?? null;
	}

	/**
	 * The block's handle is known. With none, the view becomes read-only. With one, the view follows
	 * its `changed` events: after a write or an outside change it shows the new body (spec §6.1).
	 */
	attach(h: Handle | null): void {
		if (this.owner.unloaded()) return;
		if (!h) {
			this.handle = null;
			// A retry is still to come: the block may only be late (D183), so it is not read only yet and nothing says so.
			if (this.info && this.retries < RESOLVE_RETRIES_MS.length) {
				this.placePending = true;
				this.retryResolve();
				return;
			}
			if (!this.readOnly || this.placePending) {
				this.readOnly = true;
				this.placePending = false;
				this.owner.updateEditUi();
			}
			this.retryResolve();
			return;
		}
		this.readOnly = false;
		this.placePending = false;
		if (this.handle !== h) this.takeOverState(h);
		this.handle = h;
		this.unsubscribe?.();
		this.unsubscribe = h.onChanged((body) => this.owner.guard(() => this.owner.changed(h, body)));
		this.owner.updateEditUi();
	}

	/** A new handle of the same block (the old one was detached): the session state follows the block. */
	private takeOverState(h: Handle): void {
		if (this.lost) carryState(this.lost.state, h.state);
		this.lost = null;
		// The body tells a different block from the one the lines suggested: move a view state across.
		const loose = this.host.looseStates.get(this.key);
		if (loose?.view && !h.state.view) {
			h.state.view = loose.view;
			h.state.viewFor = loose.viewFor;
			h.state.views = { ...loose.views };
		}
		if (loose && !h.state.focus) h.state.focus = loose.focus;
		// D144: the Back trail of the phone list belongs to the session position, so it moves with it.
		if (loose && h.state.listBack === undefined) h.state.listBack = loose.listBack;
		if (loose && h.state.autoFocus === null) {
			h.state.autoFocus = loose.autoFocus;
			h.state.autoMark = loose.autoMark;
		}
		if (loose && !h.state.folds.size) h.state.folds = new Set(loose.folds);
		// D257: the memory of the automatic folds moves only where the handle holds none (the rule of `carryState`).
		if (loose && h.state.autoFor === undefined && !h.state.autoFolds) {
			h.state.autoFolds = loose.autoFolds && new Set([...loose.autoFolds].filter((k) => h.state.folds.has(k)));
			h.state.autoFor = loose.autoFor;
		}
		// Spec §7.7 (tap memory): a tap on "Draw the tree" before the handle was known still counts.
		if (loose && h.state.largeTapped === undefined) h.state.largeTapped = loose.largeTapped;
	}

	/**
	 * Obsidian gives no section for a block in a callout in Live Preview. If the block is in the
	 * note's own editor (not an embed) and its body matches exactly one block of the note, it is
	 * that block, and the view can edit it. Synchronous, so the block's view state applies at once.
	 */
	lateResolve(ask = true): void {
		if (ask) this.askSection();
		if (this.info || this.full || this.lateTried || this.handle) return;
		// I07: a call before the block is in the page, or before it is in the note's editor, says nothing yet; only a sure answer ends the tries.
		if (!this.el.isConnected) return;
		// A side view of another plugin is no editor and no reading view: nothing will ever make this block known, so there is no wait.
		if (this.inForeignView() || !this.inNoteView()) {
			this.lateTried = true;
			this.endPlacePending();
			return;
		}
		if (!this.host.handles.inEditorOf(this.el, this.sourcePath)) return;
		this.lateTried = true;
		const h = this.host.handles.resolveByBody(this.sourcePath, this.owner.source());
		this.ready = Promise.resolve(h);
		if (h) this.attach(h);
	}

	/**
	 * Asks Obsidian for the section of the block once more (D183). In a Reading view on a cold start the first answer can be null and a later one a section;
	 * `lateResolve` cannot help there. When a section comes, the view takes the place of a block it can edit and looks for its handle.
	 */
	askSection(minGap = 0): void {
		const ctx = this.ctx;
		if (!ctx || this.info || this.full || this.owner.unloaded()) return;
		// The start tick and the section timer both ask: within one gap, one ask is enough (a note with many trees makes many asks).
		const now = performance.now();
		if (now - this.lastAskAt < minGap) return;
		this.lastAskAt = now;
		let info: MarkdownSectionInformation | null = null;
		try {
			info = ctx.getSectionInfo(this.el);
		} catch {
			// Obsidian cannot tell yet: the next look asks again.
		}
		if (!info) return;
		this.takeSection(info);
		if (!this.started) return;
		void this.ready.then((h) => this.owner.guard(() => this.attach(h)));
	}

	/** Obsidian told the section: the block has a place key, its view state follows it, and its handle is asked for. */
	private takeSection(info: MarkdownSectionInformation): void {
		const source = this.owner.source();
		this.info = info;
		this.sectionNote = `${info.lineStart}-${info.lineEnd}`;
		const ordinal = this.host.handles.quickOrdinal(info, source);
		const peek = ordinal === null ? null : this.host.handles.peek(this.sourcePath, ordinal);
		this.peeked = peek && sameBody(peek.body, source) ? peek : null;
		const oldKey = this.key;
		this.key = blockKey(this.sourcePath, ordinal, source);
		// The relation lookup of the block (relation-cache.ts) follows its key.
		moveRelationBlock(oldKey, this.key);
		// The view state that the session kept under the text key follows the block to its place key.
		const loose = this.host.looseStates.get(oldKey);
		if (loose && oldKey !== this.key && !this.host.looseStates.has(this.key)) {
			this.host.looseStates.set(this.key, loose);
			this.host.looseStates.delete(oldKey);
		}
		this.readOnly = false;
		this.placePending = false;
		this.ready = this.host.handles.resolve(this.sourcePath, info, source).catch(() => null);
		// D7: also for a section that comes before `onload` ends, so a view that loses its block tries again when the note changes.
		this.watch();
	}

	/** The look for the section goes on every `SECTION_STEP_MS` until `SECTION_LIMIT_MS` has passed since the start; then the block is read only for good. */
	watchSection(): void {
		if (this.sectionTimer || this.owner.unloaded() || this.info) return;
		this.sectionTimer = this.el.win.setTimeout(() => {
			this.sectionTimer = 0;
			this.owner.guard(() => {
				this.askSection(ASK_GAP_MS);
				if (this.info || this.owner.unloaded()) return;
				if (performance.now() - this.startAt >= SECTION_LIMIT_MS) this.endPlacePending();
				else this.watchSection();
			});
		}, SECTION_STEP_MS);
	}

	/** No more asks are to come: a block with no place is read only, and now the label and the chip say so. */
	endPlacePending(): void {
		if (!this.placePending) return;
		this.placePending = false;
		this.owner.updateEditUi();
	}

	/** Finds this view's block again, from Obsidian's section and the rendered body (spec §6.1). */
	async reResolve(): Promise<Handle | null> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.lost = this.handle ?? this.lost;
		this.handle = null;
		const info = this.info;
		const source = this.owner.source();
		let h: Handle | null = null;
		if (info) h = await this.host.handles.resolve(this.sourcePath, info, source).catch(() => null);
		else if (!this.inForeignView() && this.host.handles.inEditorOf(this.el, this.sourcePath)) h = this.host.handles.resolveByBody(this.sourcePath, source);
		this.ready = Promise.resolve(h);
		if (this.owner.unloaded()) return null;
		this.owner.guard(() => this.attach(h));
		return h;
	}

	/**
	 * The handle this view may write through: only one whose body is what this view rendered.
	 * A stale view re-reads, then finds its block again, or writes nothing.
	 */
	async validHandle(): Promise<Handle | null> {
		let h = await this.ready;
		if (h && !h.detached && sameBody(h.body, this.owner.source())) return h;
		if (h) await h.refresh();
		h = this.handle;
		if (h && !h.detached && sameBody(h.body, this.owner.source())) return h;
		h = await this.reResolve();
		return h && !h.detached && sameBody(h.body, this.owner.source()) ? h : null;
	}

	/** The note was renamed: later writes and "Open note" use the new path. */
	renamed(oldPath: string, newPath: string): void {
		if (this.sourcePath !== oldPath) return;
		this.sourcePath = newPath;
		if (this.key.startsWith(`${oldPath}\u0000`)) this.key = newPath + this.key.slice(oldPath.length);
	}

	/**
	 * Right after a note opens, or after an outside change, the editor text can briefly differ from
	 * what Obsidian rendered. Try again a little later before the view stays read-only.
	 */
	private retryResolve(): void {
		const info = this.info;
		if (!info || this.retries >= RESOLVE_RETRIES_MS.length) return;
		// Not in the view's `timers`: a re-render clears those, and this must still run.
		this.retryTimer = this.el.win.setTimeout(() => {
			this.retryTimer = 0;
			if (this.owner.unloaded() || this.handle) return;
			this.ready = this.host.handles.resolve(this.sourcePath, info, this.owner.source()).catch(() => null);
			void this.ready.then((h) => this.owner.guard(() => this.attach(h)));
		}, RESOLVE_RETRIES_MS[this.retries++]);
	}

	/**
	 * The note changed after this view gave up finding its block (`retryResolve` made its last try): look
	 * once more, so that the view is editable again when the copy that made two blocks alike is gone.
	 */
	private noteModified(path: string): void {
		const info = this.info;
		if (path !== this.sourcePath || !info || this.owner.unloaded() || this.handle || this.lateBusy || this.retryTimer) return;
		if (this.retries < RESOLVE_RETRIES_MS.length) return;
		this.lateBusy = true;
		this.ready = this.host.handles.resolve(this.sourcePath, info, this.owner.source()).catch(() => null);
		void this.ready
			.then((h) => {
				this.lateBusy = false;
				if (h && !this.handle) this.owner.guard(() => this.attach(h));
			})
			.catch(() => {
				this.lateBusy = false;
			});
	}

	/**
	 * The full-screen view has no section to find its block again: only a block with the same body,
	 * unique in the note, is still its block. Otherwise it closes with a Notice (spec §7.1).
	 */
	async fullReattach(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.lost = this.handle ?? this.lost;
		this.handle = null;
		const h = await this.host.handles.resolveUnique(this.sourcePath, this.owner.source()).catch(() => null);
		if (this.owner.unloaded()) return;
		if (!h) {
			this.full?.close(FULL_UI.gone);
			return;
		}
		this.ready = Promise.resolve(h);
		this.owner.guard(() => this.attach(h));
	}

	/** Read-only full-screen view: the note changed. Close unless the block is still there with the same text. */
	stillThere(text: string | null): void {
		if (!this.full || this.handle || this.owner.unloaded()) return;
		if (text === null || !findBlocks(text).some((b) => sameBody(b.body, this.owner.source()))) this.full.close(FULL_UI.gone);
	}

	/**
	 * Is this block inside something that shows another note's content (an embed, a Canvas card, a
	 * hover preview)? Obsidian can report a section there, but spec §6.1 wants such views read-only.
	 */
	inForeignView(): boolean {
		return !!this.el.closest('.markdown-embed, .internal-embed, .canvas-node, .hover-popover, .popover');
	}

	/** Is this block inside a note's own editor or reading view? Not so in the side view of another plugin. */
	private inNoteView(): boolean {
		return !!this.el.closest('.markdown-source-view, .markdown-reading-view, .markdown-preview-view, .cm-editor');
	}

	/**
	 * D183: the first draw. On a cold start the page can show the block before the plugin styles are applied and before Obsidian says where the block is,
	 * so the tree would show without style, read only, with a count of warnings that are not true yet. Until the styles and the settings are in and the
	 * block place is known (or known to be out of reach: an embed, a Canvas card, a page preview), the view shows an empty box of the last known height. A timer
	 * looks again every `START_STEP_MS`, not only the resize observer, and after `START_LIMIT_MS` the tree draws as it is.
	 */
	begin(): void {
		if (!this.waitingToStart()) {
			this.owner.render();
			return;
		}
		this.owner.showPlaceholder();
		this.startTick();
	}

	/** True while the start conditions do not hold yet. A host with no `startedUp` and a full-screen view never wait. */
	private waitingToStart(): boolean {
		const su = this.host.startedUp;
		if (!su || this.full || this.owner.unloaded()) return false;
		this.askSection(ASK_GAP_MS);
		const age = performance.now() - this.startAt;
		// Only the cap of the styles ends the wait for them; the shorter limit holds for the settings and the block place (see `STYLES_LIMIT_MS`).
		if (age >= STYLES_LIMIT_MS) return false;
		if (!su.ready(this.el)) return true;
		if (age >= START_LIMIT_MS) return false;
		if (this.info || this.handle) return false;
		this.lateResolve(false);
		return !(this.handle || this.lateTried);
	}

	private startTick(): void {
		if (this.startTimer || this.owner.unloaded()) return;
		this.startTimer = this.el.win.setTimeout(() => {
			this.startTimer = 0;
			this.owner.guard(() => this.startLook());
		}, START_STEP_MS);
	}

	/** One look at the start conditions: the tree draws when they hold, else the timer looks again. */
	startLook(): void {
		if (!this.waiting || this.owner.unloaded()) return;
		if (this.waitingToStart()) {
			this.startTick();
			return;
		}
		this.waiting = false;
		this.owner.render();
	}
}
