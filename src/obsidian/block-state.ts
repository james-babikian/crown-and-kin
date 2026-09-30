/*
 * The per-block memory kept for the session (spec §5.5): the last view, the last-edited
 * person, the session focus and the "just saved" highlight. Each `Handle` owns its state
 * (`block-handle.ts`: `readonly state = newBlockState()`); `main.ts` keeps only `looseStates`, for
 * views with no handle. Only the focus and fold fields end when the note closes (`endSessionFocus`).
 */

import type { FoldKey } from '../core/folds';
import type { Orientation, SidewaysCards } from '../layout/model';
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
	 * The folded families of the block (spec §13.10, D84): until the note closes, like the session focus. The
	 * view drops the keys of families that no longer exist after each parse of the whole tree. They are never
	 * written to the note.
	 */
	folds: Set<FoldKey>;
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

/** An embed in a note, or the full-screen view. */
export type ViewKind = 'embed' | 'full';

/** A fresh, empty `BlockState` for a block that has not drawn yet. */
export const newBlockState = (): BlockState => ({ view: null, lastEdited: null, highlight: null, viewFor: '', views: {}, focus: null, autoFocus: null, shown: null, finder: null, folds: new Set() });

/**
 * The key of a drawn tree for `BlockState.viewFor`: the focus person and the generations, or '' for
 * the whole tree; `sideways` trees (D24) have their own keys, by card kind too (the note preview's narrow
 * cards, the full-screen view's normal cards), so a view never moves to another layout of the family.
 */
export const focusKey = (id: string | null, n = 0, orientation: Orientation = 'down', cards: SidewaysCards = 'normal') =>
	(orientation === 'sideways' ? (cards === 'narrow' ? 'sideways-narrow|' : 'sideways|') : '') + (id === null ? '' : `focus:${id}:${n}`);

/** The note closed: the session focus, the folds and the finder's result end (spec §5.6, §13.2, §13.10). The rest of the view state stays for the session (§5.5). */
export function endSessionFocus(st: BlockState): void {
	st.focus = null;
	st.autoFocus = null;
	st.shown = null;
	st.finder = null;
	st.folds.clear();
}
