/*
 * The per-block memory kept for the session (spec §5.5): the last view, the last-edited
 * person, the session focus and the "just saved" highlight. Each `Handle` owns its state
 * (`block-handle.ts`: `readonly state = newBlockState()`); `main.ts` keeps only `looseStates`, for
 * views with no handle. Only the focus, fold and "Draw the tree" fields end when the note closes (`endSessionFocus`).
 */

import type { FoldKey } from '../core/folds';
import type { Orientation } from '../layout/model';
import type { View } from '../render/view-math';
import type { SessionFocus } from './focus-mode';

/** Plugin memory for one block for the session (spec §5.5): kept on the handle, so it follows a rename. */
export interface BlockState {
	/** The view to restore after a re-render; set once the user moved the view, and before each write. */
	view: View | null;
	/** The person most recently edited in this block: the start person (spec §5.5). */
	lastEdited: string | null;
	/** A person to highlight and show once, in every view that renders before `until`. */
	highlight: { id: string; until: number } | null;
	/**
	 * The focus key (`focusKey`) of the tree that `view` belongs to: a view of one focus family
	 * means nothing in another, so it is used only while the same family is drawn.
	 */
	viewFor: string;
	/**
	 * The last stored view of each orientation (D24), with its `viewFor`: a turn of the phone keeps
	 * the other orientation's view. `view`/`viewFor` above are the most recent of these.
	 */
	views: Partial<Record<Orientation, { view: View; viewFor: string }>>;
	/** The session focus (spec §5.6, D18): until the note closes. */
	focus: SessionFocus | null;
	/** The focus the phone rule chose, kept so that an edit does not move it; until the note closes. */
	autoFocus: string | null;
	/** The marked person when `autoFocus` was chosen (D234): a new, changed or removed mark chooses again. */
	autoMark?: string | null;
	/**
	 * A person just saved, to show once (§5.5): the first view of `place` (the kind of view whose
	 * sheet or toolbar wrote) that renders after the write takes it, and shows all people if its
	 * family does not draw the person. A focus the user chooses clears it.
	 */
	shown: { id: string; place: ViewKind } | null;
	/**
	 * The relation finder's result (spec §13.2): until Close or until the note closes (like D22). The
	 * computer and the full-screen view show it; the static phone preview never does (D1).
	 */
	finder: FinderState | null;
	/**
	 * The Show view of a line of succession (contract 0.2.7 F.1): the title that the tree shows the line of, until Close, Esc, a focus
	 * choice or the note closes. It is a temporary view like the finder's result, and only one of the two shows at a time. It writes nothing.
	 */
	succession: SuccessionState | null;
	/**
	 * The folded families of the block (spec §13.10, D84): until the note closes, like the session focus. The
	 * view drops the keys of families that no longer exist after each parse of the whole tree. They are never
	 * written to the note.
	 */
	folds: Set<FoldKey>;
	/**
	 * D144: the Back stack of the phone list, newest last, at most 20 entries (the oldest drops out). Session only: cleared
	 * when the note closes. Optional so that `newBlockState()` stays as it is.
	 */
	listBack?: string[];
	/**
	 * 0.3 (spec §7.7, D223): the user tapped "Draw the tree" on the low bar of this block. Every later render of the block in the session draws the tree with no
	 * bar (an edit, a setting, a fold, Find), until the note closes. It never lifts the top (the second limit, the phone top). Optional so that `newBlockState()` stays as it is.
	 */
	largeTapped?: boolean;
}

/** What the relation finder shows (spec §13.2, D47, D48); it writes nothing to the note. */
export interface FinderState {
	/** The second person is named as a relative of the first. */
	first: string;
	second: string;
	/** The relation that shows ("Other relation" moves it on). */
	index: number;
	/** "Show in the whole tree": the whole tree with the line, the other parts faded; else the small tree of the line. */
	whole: boolean;
	/** "Show the steps" is on. */
	steps: boolean;
}

/** What the Show view of the line of succession shows (contract 0.2.7 F.1): the id of the title. */
export interface SuccessionState {
	title: string;
}

/** An embed in a note, or the full-screen view. */
export type ViewKind = 'embed' | 'full';

/** A fresh, empty `BlockState` for a block that has not drawn yet. */
export const newBlockState = (): BlockState => ({ view: null, lastEdited: null, highlight: null, viewFor: '', views: {}, focus: null, autoFocus: null, shown: null, finder: null, succession: null, folds: new Set() });

/**
 * The key of a drawn tree for `BlockState.viewFor`: the focus person and the generations, or '' for
 * the whole tree; `sideways` trees (D24) have their own keys, so a view never moves to another layout of the family.
 */
export const focusKey = (id: string | null, n = 0, orientation: Orientation = 'down') => (orientation === 'sideways' ? 'sideways|' : '') + (id === null ? '' : `focus:${id}:${n}`);

/** The note closed: the session focus, the folds and the finder's result and the Show view of the line of succession end (spec §5.6, §13.2, §13.10). The rest of the view state stays for the session (§5.5). */
export function endSessionFocus(st: BlockState): void {
	st.focus = null;
	st.autoFocus = null;
	st.autoMark = null;
	st.shown = null;
	st.finder = null;
	st.succession = null;
	st.folds.clear();
	st.listBack = undefined;
	st.largeTapped = undefined;
}

/**
 * A view found its block again under a new handle: the session memory of the lost handle (focus, folds,
 * finder, last edited person, saved view) moves to the new one. A field that the new state already holds
 * stays, so a handle that other views already use is never overwritten.
 */
export function carryState(from: BlockState, to: BlockState): void {
	if (from === to) return;
	if (!to.view && from.view) {
		to.view = from.view;
		to.viewFor = from.viewFor;
	}
	if (!Object.keys(to.views).length) to.views = { ...from.views };
	to.lastEdited ??= from.lastEdited;
	to.highlight ??= from.highlight;
	to.focus ??= from.focus;
	if (to.autoFocus === null && from.autoFocus !== null) {
		to.autoFocus = from.autoFocus;
		to.autoMark = from.autoMark;
	}
	to.shown ??= from.shown;
	// One temporary view at a time (F.1): the one that `to` holds wins, and then `from` gives neither.
	if (!to.finder && !to.succession) {
		to.finder = from.finder;
		to.succession = from.finder ? null : from.succession;
	}
	if (!to.folds.size) to.folds = new Set(from.folds);
	to.listBack ??= from.listBack;
	to.largeTapped ??= from.largeTapped;
}
