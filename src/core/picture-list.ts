/*
 * The picture list model (spec §13.14, D92 to D95). It turns the vault's file list into a folder tree,
 * the visible rows of the picker, the search list, the keyboard and tap rules, and the preview window.
 * It holds no state and never reads a file, so the picker view (`obsidian/picture-picker.ts`) only
 * draws what it returns. Pure: no `obsidian` import.
 *
 * Picture list rules, P1 to P10:
 *
 * P1 Input. `buildPictureTree(files, isPicture)` gets every vault file (`app.vault.getFiles()`) and the
 *    test "the plugin can show this file" (`isShownPictureExtension(f.extension)`, the §13.0 item 3
 *    formats). It keeps only pictures. It never reads a file.
 * P2 Hidden. A picture is left out if any segment of its folder path starts with "." (a dot folder such
 *    as `.obsidian` or `.trash`). A folder is built only if its count is at least 1, so an empty folder
 *    and a folder with no shown picture do not exist in the tree. The vault root has no row and no
 *    `PictureFolder`; its pictures are `PictureTree.pictures`.
 * P3 Counts. `PictureFolder.count` = the pictures in the folder and in all its sub-folders (only shown
 *    pictures, dot folders excluded). `PictureTree.count` = every shown picture.
 * P4 Sort. One comparator, `comparePictureNames(a, b)`: one shared `Intl.Collator(undefined, { numeric:
 *    true, sensitivity: 'base' })`; when it returns 0, the two full paths compared by code
 *    point decide, so the order never changes between two builds. Folders sort by their own name,
 *    pictures by file name (with the extension). In a folder, sub-folders come first, then pictures.
 *    At the top: the top folders, then the root's pictures. The collator depends on the locale of the
 *    machine, so a test uses names whose order is the same in every locale (ASCII letters and digits).
 * P5 Open set. `openSetFor(tree, currentPath)` = the folder of the current picture and every folder
 *    that holds it (paths, "a", "a/b", "a/b/c"). The current picture counts only if it is a picture in
 *    the tree (shown format, not in a dot folder, exists); otherwise, and for `null`, the set is empty
 *    (all folders closed). A picture at the vault root gives an empty set.
 * P6 Rows (the folder view). `pickerRows(tree, open, current)` gives the visible rows in order: the
 *    device row (`kind: 'device'`, always first), then for each folder its row and, only if the folder
 *    is in `open`, its content (sub-folders, then pictures) at `depth + 1`; then the root's pictures at
 *    depth 0. A closed folder builds NO rows for its content (a vault of 2 000 pictures in 100 folders
 *    builds 100 rows plus the open ones). A picture row has `inUse` true only for the current picture
 *    (P5 path; the same file). The number of rows is bounded by the open folders, not by the vault. A
 *    vault with no shown picture gives the device row alone (the view adds the "no pictures" text).
 * P7 Rows (the search). `searchRows(tree, query, current, limit = PICKER_SEARCH_LIMIT)`: the query is
 *    split on whitespace; a picture matches when its path has every word, both folded by `foldForMatch` (case, accents and quote look-alikes ignored, D100; each path is folded once, with the ranking). A query with no word is not a search: the caller uses `pickerRows`. A query that has text but folds to no word (a lone accent mark) finds no picture. Result: the device
 *    row, then at most `limit` matches, each a picture row at depth 0 in the P4 order (file name, then
 *    folder path; the entries are ranked once in `buildPictureTree`, so a search only filters and stops
 *    after `limit` + 1), and `more` = there are more matches than `limit` (200). The row shows the folder
 *    under the name; a picture at the vault root shows the `topFolder` text there.
 *    `inUse` is set here too. The search ignores which folders are open. The search list has no folder
 *    row, so while the search field has a word the cursor is never on a folder row.
 * P8 Keyboard and taps (pure reducers). The search field keeps the DOM focus; the rows are reached with
 *    `aria-activedescendant`. The state is `PickerState`: one CURSOR (the row the keys act
 *    on; it can be on the device row, a folder row or a picture row), one SELECTED picture (the picture
 *    that **Select** chooses) and the flag `armed`. The cursor is kept by row identity (`rowKey`: the
 *    device row, or "folder:" / "picture:" plus the path), never by index, so it stays on its row when
 *    the rows change. A cursor whose row is not in `rows` acts as no cursor.
 *    - Cursor and selection. The cursor moving onto a picture row selects that picture; the cursor
 *      moving onto a folder row or the device row leaves the selected picture as it was, so **Select**
 *      stays usable (spec: "folder rows are never selected"). The selected picture stays selected when
 *      its folder closes (its row is then not shown, so its highlight is not visible, but **Select**
 *      still chooses it) and when the list switches.
 *    - `armed` is true when a second tap on the selected picture's row chooses it. It is false only
 *      at open for the current picture, so a first tap on the current picture selects nothing new
 *      and does not choose; it sets `armed`. Moving the cursor onto a picture, or a tap on another
 *      picture, selects it and sets `armed` true.
 *    - `pickerKey(rows, state, key)` returns the new state and one action:
 *      - ArrowDown / ArrowUp: the next / previous row, wrapping; with no cursor, Down goes to
 *        row 0 and Up to the last row.
 *      - ArrowRight: on a closed folder row, action 'open'; ArrowLeft: on an open folder row, 'close';
 *        elsewhere nothing (the caller does not `preventDefault`, so a caret still moves).
 *      - Enter: on a folder row 'toggle' (open or close); on a picture row 'choose' (always, with or
 *        without `armed`: a keyboard user has already moved the cursor onto it, so only a tap needs the
 *        second tap); on the device row 'device' (the file choice). With no
 *        cursor: nothing. Enter on a picture row with no selection does nothing (this is the case the
 *        spec words "Enter does nothing" cover; it cannot occur, because the cursor selects).
 *      - Space: like Enter on a folder row only; elsewhere nothing and no `preventDefault`, because the
 *        key types a space in the search field.
 *      The folder actions (open, close, toggle by Space or Enter) need a folder row, which exists only
 *      while the search field has no word. The caller calls `preventDefault` only when the reducer
 *      returned an action other than 'none' or moved the cursor.
 *    - `pickerTap(rows, state, key)` (a tap on the row with this `rowKey`): a folder row gives
 *      'toggle', moves the cursor to it and keeps the selected picture; a picture row that is selected
 *      and `armed` gives 'choose'; any other picture row becomes selected and cursor, `armed` true,
 *      action 'none'; the device row gives 'device' at once.
 *    - `pickerSwitch(rows, state)` runs when the list switches (a search starts or clears): the cursor
 *      goes to the selected picture's row if the new rows show it, else to none. The selected picture
 *      and `armed` do not change.
 *    **Select** is enabled when `selected` is not null (a folder or the device row alone never enables
 *    it) and chooses the selected picture even if its row is not shown. The keys are heard on the modal
 *    (capture), not only on the search field, so a touch device with a hardware keyboard works; a key on
 *    the Select or Cancel button is left alone.
 * P9 Current picture. The caller passes the current picture as a file (`current`). At open: if it is a picture in the tree, `selected` = `cursor` = its row, its folders
 *    are open, its row has the "In use" mark and `armed` is false; else all folders are closed,
 *    nothing is selected, there is no cursor and `armed` is false. The mark stays on the current
 *    picture's row (in the folder view and in the search list) for as long as the picker is open,
 *    wherever the selection moves. The open folders last only while the picker is open (nothing is
 *    stored).
 * P10 Preview window (pure). `previewNear(row, scroller, margin = scroller.bottom - scroller.top)` is
 *    true when the row's rect (client px) meets the scroller's rect grown by `margin` above and below
 *    (one scroller height, spec §13.14). `previewOrder` sorts the near rows by their distance from the
 *    visible part (the rows in view first). Both use rects, not row numbers, because on a phone the list
 *    sits below the search field inside the sheet body (the scroller).
 */

import { foldForMatch } from './fold';

/** The part of a vault file that the model needs; `TFile` satisfies it (so the model stays free of `obsidian`). */
export interface PictureFileLike {
	/** The vault path, for example "Art/Arms/lion.png". */
	path: string;
	/** The file name with its extension. */
	name: string;
	extension: string;
}

/** One picture in the tree. */
interface PictureEntry<F extends PictureFileLike = PictureFileLike> {
	file: F;
	/** The folder path, '' for the vault root. */
	folder: string;
}

/** One folder that holds at least one shown picture. */
interface PictureFolder<F extends PictureFileLike = PictureFileLike> {
	/** The path from the vault root, for example "Art/Arms". */
	path: string;
	/** The last segment, for example "Arms". */
	name: string;
	/** 1 for a top folder. */
	depth: number;
	/** The pictures in this folder and all its sub-folders; at least 1. */
	count: number;
	/** Sub-folders in P4 order. */
	folders: PictureFolder<F>[];
	/** The pictures directly in this folder in P4 order. */
	pictures: PictureEntry<F>[];
}

/** The whole picture tree of a vault (P1 to P4). */
export interface PictureTree<F extends PictureFileLike = PictureFileLike> {
	/** The top folders in P4 order. */
	folders: PictureFolder<F>[];
	/** The pictures at the vault root in P4 order. */
	pictures: PictureEntry<F>[];
	/** Every shown picture. */
	count: number;
	/** Every folder by path, for `openSetFor` and the toggle. */
	byPath: ReadonlyMap<string, PictureFolder<F>>;
	/** Every picture by path. */
	entries: ReadonlyMap<string, PictureEntry<F>>;
}

/** P1 to P4: builds the tree. Pure; never throws (a file with a bad path is left out). */
type BuildPictureTree = <F extends PictureFileLike>(files: readonly F[], isPicture: (file: F) => boolean) => PictureTree<F>;

/** P4: the comparator of folder names and file names. */
type ComparePictureNames = (a: string, b: string) => number;

/** P5: the folder paths that are open at the start for the current picture's path (null: none). */
type OpenSetFor = (tree: PictureTree, currentPath: string | null) => Set<string>;

/** One row of the list. */
export type PickerRow<F extends PictureFileLike = PictureFileLike> =
	| { kind: 'device' }
	| { kind: 'folder'; folder: PictureFolder<F>; depth: number; open: boolean }
	| { kind: 'picture'; entry: PictureEntry<F>; depth: number; inUse: boolean };

/** P6: the visible rows of the folder view; a closed folder builds no rows for its content. */
type PickerRows = <F extends PictureFileLike>(tree: PictureTree<F>, open: ReadonlySet<string>, current: string | null) => PickerRow<F>[];

/** The most matches the search list shows (spec §13.14). */
export const PICKER_SEARCH_LIMIT = 200;

/** P7: the flat search list. `more` is true when there are more than `limit` matches. */
type SearchRows = <F extends PictureFileLike>(
	tree: PictureTree<F>,
	query: string,
	current: string | null,
	limit?: number,
) => { rows: PickerRow<F>[]; more: boolean };

/** P8: the identity of a row: 'device', "folder:PATH" or "picture:PATH". Stable when the rows change. */
export type PickerRowKey = string;

/** P8: the identity of `row`. */
type RowKeyOf = (row: PickerRow) => PickerRowKey;

/** P8: the picker's keyboard and tap state. */
export interface PickerState {
	/** The row the keys act on, by identity; null for none. */
	cursor: PickerRowKey | null;
	/** The path of the selected picture; null for none. **Select** chooses it. */
	selected: string | null;
	/** True when a tap or Enter on the selected picture's row chooses it (false only at open). */
	armed: boolean;
}

/** P8: the keys the reducer knows. */
export type PickerKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Enter' | ' ';

/** P8: what a key or tap does. 'none' with the same state means the caller must not call `preventDefault`. */
export type PickerAction = 'none' | 'open' | 'close' | 'toggle' | 'choose' | 'device';

/** P8: the new state and the action for a key. */
type PickerKeyStep = (rows: readonly PickerRow[], state: PickerState, key: PickerKey) => { state: PickerState; action: PickerAction };

/** P8: the new state and the action for a tap on the row with this key. */
type PickerTapStep = (rows: readonly PickerRow[], state: PickerState, key: PickerRowKey) => { state: PickerState; action: PickerAction };

/** P8: the state after the list switches (a search starts or clears): the cursor goes to the selected picture's row if shown, else to none. */
type PickerSwitch = (rows: readonly PickerRow[], state: PickerState) => PickerState;

/** P8: the folder paths after opening or closing `path` (returns a new set). */
type ToggleFolder = (open: ReadonlySet<string>, path: string) => Set<string>;

/** P10: a rectangle in client px (what `getBoundingClientRect` gives). */
interface ClientBand {
	top: number;
	bottom: number;
}

/** P10: true when the row band meets the scroller band grown by `margin` (default: the scroller's height) above and below. */
type PreviewNear = (row: ClientBand, scroller: ClientBand, margin?: number) => boolean;

/** P10: the indexes of `rows` that are near, the ones in view first, then by distance from the view. */
type PreviewOrder = (rows: readonly ClientBand[], scroller: ClientBand) => number[];

// One collator for every comparison: `localeCompare` with options builds a new collator on each call.
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** P4: natural, case-blind order of two names. */
export const comparePictureNames: ComparePictureNames = (a, b) => COLLATOR.compare(a, b);

/** Code point order of two strings (the tie-break of P4; `<` on strings would compare UTF-16 units). */
function byCodePoint(a: string, b: string): number {
	const x = Array.from(a);
	const y = Array.from(b);
	const n = Math.min(x.length, y.length);
	for (let i = 0; i < n; i++) {
		const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
		if (d !== 0) return d;
	}
	return x.length - y.length;
}

function compareNamed(nameA: string, pathA: string, nameB: string, pathB: string): number {
	return comparePictureNames(nameA, nameB) || byCodePoint(pathA, pathB);
}

const entryOrder = (a: PictureEntry, b: PictureEntry) => compareNamed(a.file.name, a.file.path, b.file.name, b.file.path);
const folderOrder = (a: PictureFolder, b: PictureFolder) => compareNamed(a.name, a.path, b.name, b.path);

/** P1 to P4: builds the tree. Pure; a file with a bad path is left out. */
export const buildPictureTree: BuildPictureTree = <F extends PictureFileLike>(files: readonly F[], isPicture: (file: F) => boolean): PictureTree<F> => {
	const byPath = new Map<string, PictureFolder<F>>();
	const entries = new Map<string, PictureEntry<F>>();
	const topFolders: PictureFolder<F>[] = [];
	const rootPictures: PictureEntry<F>[] = [];
	let count = 0;

	for (const file of files) {
		if (typeof file?.path !== 'string' || file.path === '' || !isPicture(file)) continue;
		const segments = file.path.split('/');
		const folderSegments = segments.slice(0, -1);
		if (folderSegments.some((s) => s === '' || s.startsWith('.'))) continue;
		const folder = folderSegments.join('/');
		const entry: PictureEntry<F> = { file, folder };
		entries.set(file.path, entry);
		count++;
		if (folder === '') {
			rootPictures.push(entry);
			continue;
		}
		// Create the chain of folders, and count the picture in each of them.
		let parentPath = '';
		for (let i = 0; i < folderSegments.length; i++) {
			const path = folderSegments.slice(0, i + 1).join('/');
			let node = byPath.get(path);
			if (!node) {
				node = { path, name: folderSegments[i], depth: i + 1, count: 0, folders: [], pictures: [] };
				byPath.set(path, node);
				if (i === 0) topFolders.push(node);
				else byPath.get(parentPath)!.folders.push(node);
			}
			node.count++;
			parentPath = path;
		}
		byPath.get(folder)!.pictures.push(entry);
	}

	for (const node of byPath.values()) {
		node.folders.sort(folderOrder);
		node.pictures.sort(entryOrder);
	}
	topFolders.sort(folderOrder);
	rootPictures.sort(entryOrder);
	const tree: PictureTree<F> = { folders: topFolders, pictures: rootPictures, count, byPath, entries };
	// Rank once here so a search (which runs on every key) only filters.
	RANKED.set(tree, [...entries.values()].sort(entryOrder).map((entry) => ({ entry, folded: foldForMatch(entry.file.path) })));
	return tree;
};

type Ranked = { entry: PictureEntry<PictureFileLike>; folded: string };
const RANKED = new WeakMap<object, Ranked[]>();

function rankedOf<F extends PictureFileLike>(tree: PictureTree<F>): Ranked[] {
	let ranked = RANKED.get(tree);
	if (!ranked) {
		// A tree that did not come from `buildPictureTree`: rank it on first use.
		ranked = [...tree.entries.values()].sort(entryOrder).map((entry) => ({ entry, folded: foldForMatch(entry.file.path) }));
		RANKED.set(tree, ranked);
	}
	return ranked;
}

/** P5: the folder of the current picture and every folder that holds it. */
export const openSetFor: OpenSetFor = (tree, currentPath) => {
	const open = new Set<string>();
	const entry = currentPath === null ? undefined : tree.entries.get(currentPath);
	if (!entry || entry.folder === '') return open;
	const segments = entry.folder.split('/');
	for (let i = 1; i <= segments.length; i++) open.add(segments.slice(0, i).join('/'));
	return open;
};

/** P6: the visible rows of the folder view; a closed folder builds no rows for its content. */
export const pickerRows: PickerRows = <F extends PictureFileLike>(tree: PictureTree<F>, open: ReadonlySet<string>, current: string | null): PickerRow<F>[] => {
	const rows: PickerRow<F>[] = [{ kind: 'device' }];
	const pictureRow = (entry: PictureEntry<F>, depth: number): PickerRow<F> => ({ kind: 'picture', entry, depth, inUse: entry.file.path === current });
	const walk = (folder: PictureFolder<F>) => {
		const isOpen = open.has(folder.path);
		rows.push({ kind: 'folder', folder, depth: folder.depth - 1, open: isOpen });
		if (!isOpen) return;
		for (const sub of folder.folders) walk(sub);
		for (const entry of folder.pictures) rows.push(pictureRow(entry, folder.depth));
	};
	for (const folder of tree.folders) walk(folder);
	for (const entry of tree.pictures) rows.push(pictureRow(entry, 0));
	return rows;
};

/** P7: the flat search list. */
export const searchRows: SearchRows = <F extends PictureFileLike>(tree: PictureTree<F>, query: string, current: string | null, limit: number = PICKER_SEARCH_LIMIT) => {
	const words = foldForMatch(query).split(/\s+/).filter(Boolean);
	const rows: PickerRow<F>[] = [{ kind: 'device' }];
	// A query that folds to nothing (a lone accent mark) is still a search and finds nothing. An empty query is the job of the caller.
	if (!words.length && query.trim() !== '') return { rows, more: false };
	let more = false;
	let taken = 0;
	for (const { entry, folded } of rankedOf(tree)) {
		if (!words.every((w) => folded.includes(w))) continue;
		// One match beyond the limit is enough to know that there are more.
		if (taken >= limit) {
			more = true;
			break;
		}
		rows.push({ kind: 'picture', entry: entry as PictureEntry<F>, depth: 0, inUse: entry.file.path === current });
		taken++;
	}
	return { rows, more };
};

/** P8: the identity of a row. */
export const rowKey: RowKeyOf = (row) => (row.kind === 'device' ? 'device' : row.kind === 'folder' ? `folder:${row.folder.path}` : `picture:${row.entry.file.path}`);

const PICTURE_PREFIX = 'picture:';

/** The index of the row with this key, or -1. */
function indexOfKey(rows: readonly PickerRow[], key: PickerRowKey | null): number {
	return key === null ? -1 : rows.findIndex((r) => rowKey(r) === key);
}

/** P8: the state after the cursor lands on `row` (a picture selects and arms; other rows keep the selection). */
function moveTo(state: PickerState, row: PickerRow): PickerState {
	const key = rowKey(row);
	if (row.kind === 'picture') return { cursor: key, selected: row.entry.file.path, armed: true };
	return { ...state, cursor: key };
}

/** P8: the new state and the action for a key. */
export const pickerKey: PickerKeyStep = (rows, state, key: PickerKey) => {
	const same = { state, action: 'none' as const };
	if (rows.length === 0) return same;
	const at = indexOfKey(rows, state.cursor);
	const row = at < 0 ? null : rows[at];
	switch (key) {
		case 'ArrowDown':
		case 'ArrowUp': {
			const next = at < 0 ? (key === 'ArrowDown' ? 0 : rows.length - 1) : (at + (key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
			return { state: moveTo(state, rows[next]), action: 'none' };
		}
		case 'ArrowRight':
			return row?.kind === 'folder' && !row.open ? { state, action: 'open' } : same;
		case 'ArrowLeft':
			return row?.kind === 'folder' && row.open ? { state, action: 'close' } : same;
		case 'Enter':
			if (!row) return same;
			if (row.kind === 'folder') return { state, action: 'toggle' };
			if (row.kind === 'device') return { state, action: 'device' };
			return state.selected === null ? same : { state, action: 'choose' };
		case ' ':
			return row?.kind === 'folder' ? { state, action: 'toggle' } : same;
		default:
			return same;
	}
};

/** P8: the new state and the action for a tap on the row with this key. */
export const pickerTap: PickerTapStep = (rows, state, key) => {
	const row = rows.find((r) => rowKey(r) === key);
	if (!row) return { state, action: 'none' };
	if (row.kind === 'device') return { state, action: 'device' };
	// A tap on a folder row leaves `armed` alone.
	if (row.kind === 'folder') return { state: { ...state, cursor: key }, action: 'toggle' };
	const path = row.entry.file.path;
	if (state.selected === path && state.armed) return { state: { ...state, cursor: key }, action: 'choose' };
	return { state: { cursor: key, selected: path, armed: true }, action: 'none' };
};

/** P8: the state after the list switches. */
export const pickerSwitch: PickerSwitch = (rows, state) => {
	const key = state.selected === null ? null : `${PICTURE_PREFIX}${state.selected}`;
	return { ...state, cursor: key !== null && indexOfKey(rows, key) >= 0 ? key : null };
};

/** P8: opens a closed folder or closes an open one; returns a new set. */
export const toggleFolder: ToggleFolder = (open, path) => {
	const next = new Set(open);
	if (!next.delete(path)) next.add(path);
	return next;
};

/** P10: true when the row band meets the scroller band grown by `margin` above and below. */
export const previewNear: PreviewNear = (row, scroller, margin = scroller.bottom - scroller.top) =>
	row.bottom >= scroller.top - margin && row.top <= scroller.bottom + margin;

/** P10: the indexes of the near rows, the ones in view first, then by distance from the view. */
export const previewOrder: PreviewOrder = (rows, scroller) => {
	const gap = (r: ClientBand) => Math.max(0, scroller.top - r.bottom, r.top - scroller.bottom);
	return rows
		.map((r, index) => ({ index, near: previewNear(r, scroller), d: gap(r) }))
		.filter((x) => x.near)
		.sort((a, b) => a.d - b.d || a.index - b.index)
		.map((x) => x.index);
};
