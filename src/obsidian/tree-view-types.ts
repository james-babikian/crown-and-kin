/*
 * Types and constants that several layers of `TreeView` share (0.3.3, WP-1 A1): the places a view can be in, the open timing of spec §7.7, the anchor that a
 * redraw keeps, the picture facts of a tree, and the page-preview source. `tree-view.ts` exports the ones other files use.
 */

import type { MarkdownPostProcessorContext } from 'obsidian';
import type { CodedIssue } from '../core/messages';
import type { FoldKey } from '../core/folds';
import type { PictureOwner } from '../core/pictures';
import type { Orientation, Rect } from '../layout/model';
import type { View } from '../render/view-math';
import type { Handle } from './block-handle';
import type { ResolvedPicture } from './picture-store';

/**
 * Spec §7.7 (render timing): one open of a block. Obsidian can call the code-block processor again for the same block (the Reading view
 * renders more than once), and each call makes a new view that renders again. The time the user waits runs from the first call to the
 * first tree they see, so the parts of all those renders are summed and the clock runs from `start`.
 */
export interface OpenTime {
	/** The first call of the processor, in ms of `performance.now`. */
	start: number;
	/** The end of the last render of this open (the call itself, before a render): a later call after `OPEN_GAP_MS` starts a new open. */
	last: number;
	parseMs: number;
	layoutMs: number;
	drawMs: number;
}

/**
 * An open that has shown no tree goes on with a later call of the processor only within this time, in ms. Obsidian renders a note again
 * within a moment; a user who comes back later has a new wait, and the idle time between must not count in it.
 */
export const OPEN_GAP_MS = 5_000;

/** What a full-screen view takes over from the embedded view that opened it (spec §7.1). */
export interface FullSource {
	key: string;
	sourcePath: string;
	source: string;
	handle: Handle | null;
	peeked: Handle | null;
	readOnly: boolean;
	/** After its first view, the keyboard focus goes here (the result's sentence when a static preview opened the view with it). */
	focusDue?: string | null;
}

/** The modal around a full-screen view. */
export interface FullHost {
	/** Closes the full-screen view; with a text, also shows it as a Notice. */
	close(notice: string | null): void;
	/** Closes the full-screen view, then runs `then` (opens a note) when the note under it is back in place. */
	leave(then: () => void): void;
	/** A person to centre on and highlight when the view opens (a far-couple tag on a touch embed). */
	target: string | null;
	/**
	 * D21: this view's own focus (a badge tap in a static embed opened it), until the user chooses a
	 * focus in the view; `id: null` is all people, for this view only (a saved person it did not draw).
	 */
	focus: { id: string | null } | null;
}

/** Where a view is: an embed in a note (with Obsidian's context), or the full-screen view. */
export type ViewPlace = { kind: 'embed'; ctx: MarkdownPostProcessorContext } | { kind: 'full'; from: FullSource; host: FullHost };

/** What stays in place when the folds change (F10): the control that was tapped ('spot'), or a person's card (the sheet actions). */
export type FoldAnchor = { kind: 'spot'; key: FoldKey } | { kind: 'person'; id: string };

/** Where the view was, relative to the card nearest its centre, in em: survives a font change. */
export interface Anchor {
	person: string;
	dx: number;
	dy: number;
	scale: number;
	byUser: boolean;
	/** No card was under the toolbar band before the change. */
	bandClear: boolean;
}

/** D244: the view and the card boxes before an edit, kept over its re-render so that the edited card keeps its place. */
export interface KeepPlace {
	/** The person whose sheet was saved. */
	id: string;
	before: ReadonlyMap<string, Rect>;
	view: View;
	orientation: Orientation;
	until: number;
}

/** One arms or portrait link of the whole tree, and whose it is (M9 contract O2). */
export interface PictureUse {
	owner: PictureOwner;
	link: string;
}

/**
 * The pictures of the whole tree as this view resolved them (spec §13.0 item 3 "Problems"; O1, O2):
 * each link once, the warnings found at render, and the ones the background check of the files found.
 */
export interface PictureInfo {
	/** Every valid house with arms and every person with a portrait, in tree order; also with "Show portraits on cards" off. */
	uses: PictureUse[];
	/** Each written link, resolved once. */
	resolved: Map<string, ResolvedPicture>;
	/** The warnings of the file check (too large, not a picture), by use index. */
	found: Map<number, CodedIssue>;
}

export const HIGHLIGHT_MS = 2000;

/** The page-preview source id for card names: `main.ts` registers it, and the tree view sends it with each hover-link event. */
export const HOVER_SOURCE = 'crown-and-kin';

/** After css-change, the theme colours are read once more this much later (a theme's sheet can still load). */
export const THEME_RECHECK_MS = 400;
