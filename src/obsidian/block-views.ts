/*
 * The calls between the views of one block: focus, list, folds, finder, Show view and the focus that goes back to a button. A block can have
 * several views at once (the note, a second tab, the full-screen view), and each call acts on all of them. `BlockViews` is made for one call
 * from the host and the block state; it keeps no view, so a view that unloads leaves it and a closed view is never held (no leak). The views
 * are found in `host.views` each time, as they were before this file existed. `ViewPort` is the narrow public face of a view that these
 * calls need, because the members of `TreeViewBase` are protected.
 */

import { pushTrail } from '../view/phone-list';
import { setFolds } from '../view/fold-view';
import type { FoldKey } from '../core/folds';
import type { BlockState } from '../view/block-state';
import type { FoldAnchor, FullHost } from './tree-view-types';

/** What the calls between views need from one view: its place, its state and the few actions that draw it again. */
export interface ViewPort<V = unknown> {
	readonly view: V;
	readonly unloaded: boolean;
	readonly full: FullHost | null;
	readonly coarse: boolean;
	/** True once the view has drawn a first view (pan and zoom exist). */
	readonly seen: boolean;
	readonly phone: boolean;
	readonly foreign: boolean;
	readonly state: BlockState | null;
	readonly viewport: HTMLElement | null;
	focusDue: string | null;
	pendingTarget: string[] | null;
	syncFocus(own?: boolean): void;
	/** Runs `fn` so that nothing it throws reaches the note (spec §8). */
	guard(fn: () => void): void;
	showFound(id: string): void;
	openSheet(id: string): void;
	openFull(focusDue: string): void;
	foldsChanged(anchor: FoldAnchor | null, targets: string[]): void;
}

/** What a host holds for each view: its port. The view type is a parameter so that this file does not import `tree-view-base.ts`. */
export interface ViewLike<V> {
	readonly port: ViewPort<V>;
}

/** Options of `BlockViews.redrawState`. */
interface RedrawOptions<V> {
	target?: string[] | null;
	origin?: V | null;
	except?: V | null;
	keepOwn?: boolean;
}

/** The kind of views a redraw skips, as a test on one view. */
type Skip<V> = (v: ViewPort<V>) => boolean;

/** The views of one block, found in the host when a call is made. */
export class BlockViews<V extends ViewLike<V>> {
	private constructor(private readonly host: { readonly views: Set<V> }, private readonly st: BlockState) {}

	/** The views of the block `st` in `host`; a cheap object that holds no view. */
	static of<V extends ViewLike<V>>(host: { readonly views: Set<V> }, st: BlockState): BlockViews<V> {
		return new BlockViews(host, st);
	}

	/** The views that are not unloaded and show this block, in the order of the host. */
	private ports(): ViewPort<V>[] {
		const out: ViewPort<V>[] = [];
		for (const v of this.host.views) if (!v.port.unloaded && v.port.state === this.st) out.push(v.port);
		return out;
	}

	/** The views that are not unloaded and show this block. */
	views(): V[] {
		return this.ports().map((p) => p.view);
	}

	/** The view that shows the block now, of the kind asked (`full` or a note), preferring one with a first view. */
	private portOf(full: boolean, keep: (p: ViewPort<V>) => boolean = () => true): ViewPort<V> | undefined {
		const same = this.ports().filter((p) => !!p.full === full && keep(p));
		return same.find((p) => p.seen) ?? same[0];
	}

	/** The view that shows the block now, of the kind asked (`full` or a note), preferring one with a first view. */
	viewOf(full: boolean): V | undefined {
		return this.portOf(full)?.view;
	}

	/**
	 * Draws the views of the block that `skip` does not skip again, in the order of the host. Only `origin` gets `target`. The tests are read as each
	 * view comes, not before, because a draw can unload another view. `own` is the argument of `syncFocus`; `clearOwn` ends the D21 own focus of a
	 * full-screen view first.
	 */
	private redrawViews(skip: Skip<V>, target: string[] | null = null, origin: V | null = null, o: { own?: boolean; clearOwn?: boolean } = {}): void {
		for (const v of [...this.host.views]) {
			const p = v.port;
			if (p.unloaded || p.state !== this.st || skip(p)) continue;
			if (o.clearOwn && p.full) p.full.focus = null;
			p.pendingTarget = v === origin ? target : null;
			p.syncFocus(o.own);
		}
	}

	/**
	 * Moves the list of a block to `id` and draws every view of the block again. `push` (a tap on a name, Find) puts
	 * `from`, the person the list stood on, on the Back trail; `pop` (Back) cuts the trail back to `id`. Through the
	 * block state, like `focusState`, so the full-screen view that Expand opens stands on the same person.
	 */
	listGo(id: string, how: 'push' | 'pop', from: string | null, origin: V | null = null): void {
		const st = this.st;
		if (how === 'push') {
			if (from !== null && from !== id) st.listBack = pushTrail(st.listBack, from);
		} else {
			const at = st.listBack?.lastIndexOf(id) ?? -1;
			st.listBack = at >= 0 ? st.listBack!.slice(0, at) : st.listBack;
		}
		st.focus = { id };
		st.shown = null;
		st.finder = null;
		st.succession = null;
		this.redrawState({ origin });
	}

	/**
	 * Sets the session focus in a block's state and draws every view of that block again. Through
	 * the state, not a view: the view that opened a sheet can be gone (Obsidian draws a block again
	 * after each write), so the sheet acts on whatever views show the block now.
	 */
	focusState(id: string | null, target: string[] | null = null, origin: V | null = null): void {
		const st = this.st;
		st.focus = { id };
		// Any other change of the family starts a new Back trail of the phone list (D144).
		st.listBack = undefined;
		// A choice of the user replaces a pending "show the saved person", the finder's result (spec §13.2) and the Show view of a line of succession.
		st.shown = null;
		st.finder = null;
		st.succession = null;
		this.redrawState({ target, origin });
	}

	/**
	 * Every view whose block state is this one draws its focus again (a choice of the user replaces a D21
	 * badge focus). Only `origin`, the view that ran Find or the problem list, gets `target`: the
	 * others just redraw (a static preview keeps its first view, D1). `except` does not redraw.
	 * `keepOwn` keeps the D21 own focus of full-screen views.
	 */
	redrawState(opts: RedrawOptions<V> = {}): void {
		const { target = null, origin = null, except = null, keepOwn = false } = opts;
		this.redrawViews((p) => p.view === except, target, origin, { clearOwn: !keepOwn });
	}

	/**
	 * A pin write is about to start: the D21 own focus of every full-screen view of the block ends,
	 * so the redraw after the write shows the new pin (or the default after Remove pin). Returns
	 * the way back, for a write that wrote nothing.
	 */
	dropOwnFocus(): () => void {
		const dropped: [FullHost, { id: string | null }][] = [];
		for (const v of this.host.views) {
			const p = v.port;
			const own = p.full?.focus;
			if (p.unloaded || !p.full || !own || p.state !== this.st) continue;
			dropped.push([p.full, own]);
			p.full.focus = null;
		}
		return () => {
			for (const [full, own] of dropped) if (full.focus === null) full.focus = own;
		};
	}

	/**
	 * A holder's name in the Titles window (spec §13.4): the view of the same kind that opened the window
	 * (Obsidian can have drawn it again) centres and highlights the person, like Find.
	 */
	showFound(full: boolean, id: string): void {
		// Two views can share one state (a note open in two tabs): the one that shows a tree wins.
		this.portOf(full)?.showFound(id);
	}

	/** A row of the line of succession opens that person's window; the view that opened the Titles window may be drawn again by now. */
	openPersonOf(full: boolean, id: string, own: V | null): void {
		const v = own?.port ?? this.portOf(full, (p) => !p.foreign);
		v?.openSheet(id);
	}

	/**
	 * A window closed: the focus goes back to the button that opened it (Houses, or More for Titles;
	 * spec §5.2). After a write Obsidian can draw the block again a little later, and the button the
	 * focus went back to is then gone: look again for a short time, but never take the focus from
	 * somewhere the user put it.
	 */
	refocusButton(full: boolean, sel: string, step = 0): void {
		let button: HTMLElement | null = null;
		for (const v of this.host.views) {
			const p = v.port;
			if (p.unloaded || !!p.full !== full || p.state !== this.st) continue;
			const b = p.viewport?.querySelector<HTMLElement>(sel) ?? null;
			if (b?.isConnected) button = b;
		}
		const doc = button?.doc ?? activeDocument;
		const active = doc.activeElement as HTMLElement | null;
		if (button && active !== button && (!active || active === doc.body || !active.isConnected || active.closest(sel))) button.focus();
		const wait = [150, 600][step];
		if (wait !== undefined) (doc.defaultView ?? window).setTimeout(() => this.refocusButton(full, sel, step + 1), wait);
	}

	/**
	 * F10: sets the folds of a block and draws every view of it again (a static touch preview never applies a
	 * fold, so it stays). `anchor` and `targets` are for the view that acted: `origin`, or the view of the same
	 * kind that shows the block now (Obsidian can have drawn the acting view again). The other views keep their
	 * own view, as for a focus change.
	 */
	changeFolds(next: ReadonlySet<FoldKey>, o: { anchor?: FoldAnchor | null; origin?: V | null; full?: boolean; targets?: string[] } = {}): void {
		setFolds(this.st, next);
		const views = this.ports().filter((p) => p.full || !p.coarse);
		const kind = o.origin && !o.origin.port.unloaded ? !!o.origin.port.full : (o.full ?? false);
		const same = views.filter((p) => !!p.full === kind);
		const origin = o.origin && views.some((p) => p.view === o.origin) ? o.origin.port : (same.find((p) => p.seen) ?? same[0] ?? null);
		for (const p of views) p.guard(() => p.foldsChanged(p === origin ? (o.anchor ?? null) : null, p === origin ? (o.targets ?? []) : []));
	}

	/**
	 * The end that Show view and the finder share: one temporary view at a time is set by the caller. If a view can show it, the one the user
	 * acted in (or the one view of the same kind that replaced it, if Obsidian drew that view again) takes the keyboard focus on the sentence
	 * and every view draws again. If only a phone list or a static preview shows the block (D1), the preview does not change and the
	 * full-screen view opens with the result (like D17). `redrawWithoutView` is for the Show view, which also draws a phone list.
	 */
	private showTemporary(origin: V | null, focusDue: string, redraw: () => void, redrawWithoutView: boolean): void {
		const views = this.ports();
		const shows = views.filter((p) => p.full || !p.coarse);
		if (shows.length) {
			const same = shows.filter((p) => !origin || !!p.full === !!origin.port.full);
			const at = origin && shows.some((p) => p.view === origin) ? origin.port : same.length === 1 ? same[0] : null;
			if (at) at.focusDue = focusDue;
			redraw();
			return;
		}
		if (redrawWithoutView) redraw();
		const preview = origin && views.some((p) => p.view === origin) ? origin.port : views[0];
		preview?.openFull(focusDue);
	}

	/**
	 * Show (Titles window): opens the view of the line of `title` in every view of the block that can draw it. It writes
	 * nothing. If only a phone list or a static preview shows the block, the full-screen view opens with it, as for the finder.
	 */
	showSuccession(title: string, origin: V | null): void {
		this.st.succession = { title };
		// One temporary view at a time.
		this.st.finder = null;
		this.showTemporary(origin, '.dynasty-succession-text', () => this.successionRedraw(), true);
	}

	/**
	 * Shows `second` as a relative of `first` (spec §13.2) in every view of the block that can show it.
	 * It writes nothing. Through the block state, not a view: the view that opened a sheet can be gone.
	 * If only the static touch preview shows the block (D1), the preview does not change and the
	 * full-screen view opens with the result (like D17).
	 */
	showFinder(first: string, second: string, origin: V | null): void {
		const st = this.st;
		st.finder = { first, second, index: 0, whole: false, steps: false };
		// One temporary view at a time.
		this.endShow();
		this.showTemporary(origin, '.dynasty-result-text', () => this.finderRedraw(), false);
	}

	/** Ends the Show view of a line of succession. The finder skips the phone list, so a list under a Show view that ends here draws again. */
	endShow(): void {
		const hadShow = this.st.succession !== null;
		this.st.succession = null;
		if (hadShow) this.listRedraw();
	}

	/**
	 * Every phone list of the block draws again at once, also under an open full-screen view (a list is cheap to draw). Esc in that view
	 * ends the finder first and leaves the view open, so a list that waited for the view to close would keep the old bar.
	 */
	listRedraw(): void {
		this.redrawViews((p) => !!p.full || !p.coarse || !p.phone, null, null, { own: true });
	}

	/** Every view of the block that can show the Show view or its bar draws again (this includes the phone list; never the static tablet preview, D1). */
	successionRedraw(): void {
		this.redrawViews((p) => !p.full && p.coarse && !p.phone);
	}

	/**
	 * Every view of the block that can show the finder's result draws again; never the static touch
	 * preview (D1). Only `origin` gets `target`, to centre and highlight (Find, the problem list).
	 */
	finderRedraw(origin: V | null = null, target: string[] | null = null): void {
		this.redrawViews((p) => !p.full && p.coarse, target, origin);
	}
}
