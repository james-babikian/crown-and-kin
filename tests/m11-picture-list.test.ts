import { beforeEach, describe, expect, it } from 'vitest';
import { speedTest } from './support/speed-test';
import { PICKER_SEARCH_LIMIT, type PickerRow, type PickerState, type PictureFileLike, type PictureTree } from '../src/core/picture-list';
import { isShown, pictureListModule, vf, type PictureListModule } from './acceptance/m11-support';

/*
 * WP 11.0 (spec §13.14, D92; `src/core/picture-list.ts` header): the picture list model, pure.
 * The module `src/core/picture-list.ts` is added by WP 11.1: until then every test here fails with a message
 * that names the module. Names in the trees use ASCII letters and digits only, so the sort order does not
 * depend on the locale of the machine (P4). Expected values are written by hand from the rules P1–P10 (now in the header of core/picture-list.ts).
 * Run: npx vitest run tests/m11-picture-list.test.ts
 */

let M: PictureListModule;
beforeEach(async () => {
	M = await pictureListModule();
});

const keys = (rows: readonly PickerRow[]) => rows.map((r) => M.rowKey(r));
const tree = (paths: string[]): PictureTree => M.buildPictureTree(paths.map(vf), isShown);

/** A vault with folders, dot folders, a folder with no picture, an unshown format and root pictures. */
const VAULT = [
	'Art/Arms/lion.png',
	'Art/Arms/eagle.svg',
	'Art/notes.md',
	'Art/Portraits/Old/a.jpg',
	'Art/.hidden/y.png',
	'Empty/readme.md',
	'Only/x.heic',
	'.obsidian/x.png',
	'.trash/deep/z.png',
	'root.png',
	'z.webp',
	'Notes/deep/note.md',
];

describe('P1 to P3: buildPictureTree', () => {
	it('keeps only the pictures the test accepts; a folder with no picture, an empty folder and dot folders do not exist', () => {
		const t = tree(VAULT);
		expect(t.folders.map((f) => f.path)).toEqual(['Art']);
		expect([...t.byPath.keys()].sort()).toEqual(['Art', 'Art/Arms', 'Art/Portraits', 'Art/Portraits/Old']);
		expect([...t.entries.keys()].sort()).toEqual(['Art/Arms/eagle.svg', 'Art/Arms/lion.png', 'Art/Portraits/Old/a.jpg', 'root.png', 'z.webp']);
	});

	it('counts: a folder counts its pictures and those of all its sub-folders; the tree counts every shown picture', () => {
		const t = tree(VAULT);
		expect(t.count).toBe(5);
		expect(t.byPath.get('Art')!.count).toBe(3);
		expect(t.byPath.get('Art/Arms')!.count).toBe(2);
		expect(t.byPath.get('Art/Portraits')!.count).toBe(1);
		expect(t.byPath.get('Art/Portraits/Old')!.count).toBe(1);
	});

	it('names, depths and the folder of each entry; the vault root has no folder', () => {
		const t = tree(VAULT);
		expect(t.byPath.get('Art')!.name).toBe('Art');
		expect(t.byPath.get('Art')!.depth).toBe(1);
		expect(t.byPath.get('Art/Arms')!.name).toBe('Arms');
		expect(t.byPath.get('Art/Arms')!.depth).toBe(2);
		expect(t.byPath.get('Art/Portraits/Old')!.depth).toBe(3);
		expect(t.entries.get('Art/Arms/lion.png')!.folder).toBe('Art/Arms');
		expect(t.entries.get('root.png')!.folder).toBe('');
		expect(t.pictures.map((e) => e.file.path)).toEqual(['root.png', 'z.webp']);
		expect(t.byPath.get('Art')!.pictures).toEqual([]);
		expect(t.byPath.get('Art/Arms')!.pictures.map((e) => e.file.name)).toEqual(['eagle.svg', 'lion.png']);
	});

	it('the entry keeps the file object that it was given', () => {
		const files = ['A/x.png', 'y.png'].map(vf);
		const t = M.buildPictureTree(files, isShown);
		expect(t.entries.get('A/x.png')!.file).toBe(files[0]);
		expect(t.pictures[0].file).toBe(files[1]);
	});

	it('the test that decides "picture" is the caller\'s: it is asked for files, not the extension', () => {
		const files = ['A/x.png', 'A/y.png'].map(vf);
		const t = M.buildPictureTree(files, (f) => f.name === 'y.png');
		expect([...t.entries.keys()]).toEqual(['A/y.png']);
	});

	it('a vault with no picture gives an empty tree', () => {
		const t = tree(['a.md', 'B/c.md']);
		expect(t.count).toBe(0);
		expect(t.folders).toEqual([]);
		expect(t.pictures).toEqual([]);
		expect(t.byPath.size).toBe(0);
	});

	it('a folder that has only dot-folder pictures is not built (count 0)', () => {
		const t = tree(['A/.git/x.png', 'A/readme.md']);
		expect(t.folders).toEqual([]);
		expect(t.count).toBe(0);
	});
});

describe('P4: the sort', () => {
	it('comparePictureNames: natural numbers, no case', () => {
		expect(M.comparePictureNames('a2', 'a10')).toBeLessThan(0);
		expect(M.comparePictureNames('a10', 'a2')).toBeGreaterThan(0);
		expect(M.comparePictureNames('a', 'B')).toBeLessThan(0);
		expect(M.comparePictureNames('B', 'a')).toBeGreaterThan(0);
		expect(M.comparePictureNames('abc', 'ABC')).toBe(0);
		expect(M.comparePictureNames('x', 'x')).toBe(0);
	});

	it('folders and pictures sort by name (with the extension); folders first inside a folder', () => {
		const t = tree(['R/c.png', 'R/Folder10/p.png', 'R/folder2/p.png', 'R/Folder1/p.png', 'R/a10.png', 'R/a2.png', 'R/A1.png', 'R/a.png', 'R/a.jpg']);
		const r = t.byPath.get('R')!;
		expect(r.folders.map((f) => f.name)).toEqual(['Folder1', 'folder2', 'Folder10']);
		expect(r.pictures.map((e) => e.file.name)).toEqual(['a.jpg', 'a.png', 'A1.png', 'a2.png', 'a10.png', 'c.png']);
		expect(keys(M.pickerRows(t, new Set(['R']), null))).toEqual([
			'device',
			'folder:R',
			'folder:R/Folder1',
			'folder:R/folder2',
			'folder:R/Folder10',
			'picture:R/a.jpg',
			'picture:R/a.png',
			'picture:R/A1.png',
			'picture:R/a2.png',
			'picture:R/a10.png',
			'picture:R/c.png',
		]);
	});

	it('the top folders come first and then the pictures of the root; the root has no row', () => {
		const t = tree(['b.png', 'B/x.png', 'A/x.png', 'a.png']);
		expect(t.folders.map((f) => f.path)).toEqual(['A', 'B']);
		expect(keys(M.pickerRows(t, new Set(), null))).toEqual(['device', 'folder:A', 'folder:B', 'picture:a.png', 'picture:b.png']);
	});

	it('a tie between two names is broken by the full path by code point, whatever the order of the input', () => {
		const paths = ['x/a.png', 'x/A.png', 'art/p.png', 'Art/p.png'];
		const a = tree(paths);
		const b = tree([...paths].reverse());
		for (const t of [a, b]) {
			expect(t.byPath.get('x')!.pictures.map((e) => e.file.path)).toEqual(['x/A.png', 'x/a.png']);
			expect(t.folders.map((f) => f.path)).toEqual(['Art', 'art', 'x']);
		}
	});

	it('the same input gives the same tree twice', () => {
		const paths = ['b/2.png', 'b/10.png', 'a/1.png', 'a/B.png', 'a/b.png', 'c.png'];
		expect(keys(M.pickerRows(tree(paths), new Set(['a', 'b']), null))).toEqual(keys(M.pickerRows(tree(paths), new Set(['a', 'b']), null)));
	});
});

describe('P5: openSetFor', () => {
	let t: PictureTree;
	beforeEach(() => {
		t = tree(VAULT);
	});

	it('the folder of the current picture and every folder that holds it', () => {
		expect([...M.openSetFor(t, 'Art/Portraits/Old/a.jpg')].sort()).toEqual(['Art', 'Art/Portraits', 'Art/Portraits/Old']);
		expect([...M.openSetFor(t, 'Art/Arms/lion.png')].sort()).toEqual(['Art', 'Art/Arms']);
	});

	it('a picture at the vault root, a missing file, a hidden file, a file that is not shown, and null give an empty set', () => {
		expect(M.openSetFor(t, 'root.png').size).toBe(0);
		expect(M.openSetFor(t, 'Art/Arms/missing.png').size).toBe(0);
		expect(M.openSetFor(t, '.obsidian/x.png').size).toBe(0);
		expect(M.openSetFor(t, 'Art/.hidden/y.png').size).toBe(0);
		expect(M.openSetFor(t, 'Only/x.heic').size).toBe(0);
		expect(M.openSetFor(t, 'Art/notes.md').size).toBe(0);
		expect(M.openSetFor(t, null).size).toBe(0);
	});
});

describe('P6: pickerRows', () => {
	let t: PictureTree;
	beforeEach(() => {
		t = tree(['A/B/b1.png', 'A/a1.png', 'A/a2.png', 'C/c1.png', 'r1.png', 'r2.png']);
	});

	it('all folders closed: the device row, the top folders, then the pictures of the root', () => {
		const rows = M.pickerRows(t, new Set(), null);
		expect(keys(rows)).toEqual(['device', 'folder:A', 'folder:C', 'picture:r1.png', 'picture:r2.png']);
		expect(rows[0]).toEqual({ kind: 'device' });
		expect(rows.filter((r) => r.kind === 'folder').every((r) => r.kind === 'folder' && !r.open)).toBe(true);
	});

	it('an open folder shows its sub-folders, then its pictures; a closed sub-folder builds no rows', () => {
		const rows = M.pickerRows(t, new Set(['A']), null);
		expect(keys(rows)).toEqual(['device', 'folder:A', 'folder:A/B', 'picture:A/a1.png', 'picture:A/a2.png', 'folder:C', 'picture:r1.png', 'picture:r2.png']);
		const a = rows.find((r) => r.kind === 'folder' && r.folder.path === 'A');
		expect(a && a.kind === 'folder' && a.open).toBe(true);
	});

	it('the content of an open folder is one level deeper than its row; the root pictures are as deep as the top folders', () => {
		const rows = M.pickerRows(t, new Set(['A', 'A/B']), null);
		const depth = (key: string) => {
			const r = rows.find((x) => M.rowKey(x) === key)!;
			return r.kind === 'device' ? -1 : r.depth;
		};
		expect(depth('folder:A/B')).toBe(depth('folder:A') + 1);
		expect(depth('picture:A/a1.png')).toBe(depth('folder:A') + 1);
		expect(depth('picture:A/B/b1.png')).toBe(depth('folder:A/B') + 1);
		expect(depth('folder:C')).toBe(depth('folder:A'));
		expect(depth('picture:r1.png')).toBe(depth('folder:A'));
	});

	it('a folder that is open only in the set but whose parent is closed shows nothing', () => {
		expect(keys(M.pickerRows(t, new Set(['A/B']), null))).toEqual(['device', 'folder:A', 'folder:C', 'picture:r1.png', 'picture:r2.png']);
	});

	it('inUse is true only for the current picture, in the folder view; nothing when it is not shown', () => {
		const inUse = (rows: PickerRow[]) => rows.filter((r) => r.kind === 'picture' && r.inUse).map((r) => M.rowKey(r));
		expect(inUse(M.pickerRows(t, new Set(['A']), 'A/a2.png'))).toEqual(['picture:A/a2.png']);
		expect(inUse(M.pickerRows(t, new Set(), 'r1.png'))).toEqual(['picture:r1.png']);
		expect(inUse(M.pickerRows(t, new Set(), 'A/a2.png'))).toEqual([]);
		expect(inUse(M.pickerRows(t, new Set(['A']), 'A/missing.png'))).toEqual([]);
		expect(inUse(M.pickerRows(t, new Set(['A']), null))).toEqual([]);
	});

	it('a vault with no shown picture gives the device row alone', () => {
		expect(M.pickerRows(tree(['a.md']), new Set(), null)).toEqual([{ kind: 'device' }]);
	});

	it('a closed folder builds no rows for its content: 100 folders of 20 pictures give 101 rows, 121 with one folder open', () => {
		const paths: string[] = [];
		for (let f = 0; f < 100; f++) for (let p = 0; p < 20; p++) paths.push(`F${String(f).padStart(3, '0')}/pic${p}.png`);
		const big = tree(paths);
		expect(M.pickerRows(big, new Set(), null)).toHaveLength(101);
		expect(M.pickerRows(big, new Set(['F007']), null)).toHaveLength(121);
		expect(M.pickerRows(big, M.openSetFor(big, 'F050/pic3.png'), 'F050/pic3.png')).toHaveLength(121);
	});

	it('the input tree is not changed', () => {
		const before = keys(M.pickerRows(t, new Set(['A']), null));
		M.pickerRows(t, new Set(['A', 'A/B', 'C']), 'A/a1.png');
		expect(keys(M.pickerRows(t, new Set(['A']), null))).toEqual(before);
	});
});

describe('P7: searchRows', () => {
	let t: PictureTree;
	beforeEach(() => {
		t = tree(['b/x.png', 'a/x.png', 'a/w.png', 'Art/Arms/lion.png', 'Art/Portraits/lionel.png', 'root-lion.png']);
	});

	it('every word must be in the path, without case; the device row is first; rows are pictures at depth 0', () => {
		const r = M.searchRows(t, 'ART lion', null);
		expect(keys(r.rows)).toEqual(['device', 'picture:Art/Arms/lion.png', 'picture:Art/Portraits/lionel.png']);
		expect(r.more).toBe(false);
		for (const row of r.rows.slice(1)) expect(row.kind === 'picture' && row.depth).toBe(0);
	});

	it('the order is the file name, then the folder path', () => {
		expect(keys(M.searchRows(t, 'png', null).rows).slice(1, 5)).toEqual(['picture:Art/Arms/lion.png', 'picture:Art/Portraits/lionel.png', 'picture:root-lion.png', 'picture:a/w.png']);
		expect(keys(M.searchRows(t, 'x.png', null).rows)).toEqual(['device', 'picture:a/x.png', 'picture:b/x.png']);
	});

	it('a folder name matches, because the whole path is searched; a search has no folder row', () => {
		const r = M.searchRows(t, 'arms', null);
		expect(keys(r.rows)).toEqual(['device', 'picture:Art/Arms/lion.png']);
		expect(M.searchRows(t, 'png', null).rows.some((x) => x.kind === 'folder')).toBe(false);
	});

	it('no match gives the device row alone', () => {
		const r = M.searchRows(t, 'zzz', null);
		expect(r.rows).toEqual([{ kind: 'device' }]);
		expect(r.more).toBe(false);
	});

	it('the limit is 200 matches and `more` says that there are more', () => {
		expect(PICKER_SEARCH_LIMIT).toBe(200);
		const many = tree(Array.from({ length: 250 }, (_, i) => `p/pic${String(i).padStart(3, '0')}.png`));
		const r = M.searchRows(many, 'pic', null);
		expect(r.rows).toHaveLength(201);
		expect(r.more).toBe(true);
		expect(M.rowKey(r.rows[1])).toBe('picture:p/pic000.png');
		expect(M.rowKey(r.rows[200])).toBe('picture:p/pic199.png');
		const small = M.searchRows(many, 'pic', null, 3);
		expect(small.rows).toHaveLength(4);
		expect(small.more).toBe(true);
	});

	it('exactly the limit gives no `more`', () => {
		const exact = tree(Array.from({ length: 200 }, (_, i) => `p/pic${String(i).padStart(3, '0')}.png`));
		const r = M.searchRows(exact, 'pic', null);
		expect(r.rows).toHaveLength(201);
		expect(r.more).toBe(false);
		expect(M.searchRows(exact, 'pic', null, 199).more).toBe(true);
	});

	it('inUse is set for the current picture, wherever it is in the list', () => {
		const inUse = (rows: PickerRow[]) => rows.filter((r) => r.kind === 'picture' && r.inUse).map((r) => M.rowKey(r));
		expect(inUse(M.searchRows(t, 'lion', 'Art/Portraits/lionel.png').rows)).toEqual(['picture:Art/Portraits/lionel.png']);
		expect(inUse(M.searchRows(t, 'lion', 'root-lion.png').rows)).toEqual(['picture:root-lion.png']);
		expect(inUse(M.searchRows(t, 'x.png', 'Art/Arms/lion.png').rows)).toEqual([]);
	});

	it('the search does not depend on which folders are open, and it changes nothing', () => {
		const before = keys(M.pickerRows(t, new Set(), null));
		M.searchRows(t, 'lion', null);
		expect(keys(M.pickerRows(t, new Set(), null))).toEqual(before);
	});
});

describe('P8: rowKey', () => {
	it('the device row, "folder:" plus the path, "picture:" plus the path', () => {
		const t = tree(['A/B/x.png', 'y.png']);
		const rows = M.pickerRows(t, new Set(['A', 'A/B']), null);
		expect(keys(rows)).toEqual(['device', 'folder:A', 'folder:A/B', 'picture:A/B/x.png', 'picture:y.png']);
	});
});

describe('P8: pickerKey', () => {
	// Rows: 0 device, 1 folder A (open), 2 folder A/B (closed), 3 picture A/a1.png, 4 picture r.png.
	let t: PictureTree;
	let rows: PickerRow[];
	beforeEach(() => {
		rows = M.pickerRows(tree(['A/a1.png', 'A/B/b1.png', 'r.png']), new Set(['A']), null);
		t = tree(['A/a1.png', 'A/B/b1.png', 'r.png']);
	});
	const K = ['device', 'folder:A', 'folder:A/B', 'picture:A/a1.png', 'picture:r.png'];
	const st = (cursor: string | null, selected: string | null = null, armed = false): PickerState => ({ cursor, selected, armed });
	const key = (state: PickerState, k: Parameters<PictureListModule['pickerKey']>[2]) => M.pickerKey(rows, state, k);

	it('the fixture rows are as expected', () => {
		expect(keys(rows)).toEqual(K);
	});

	it('ArrowDown with no cursor goes to row 0; ArrowUp with no cursor goes to the last row', () => {
		expect(key(st(null), 'ArrowDown').state.cursor).toBe('device');
		expect(key(st(null), 'ArrowUp').state.cursor).toBe('picture:r.png');
		expect(key(st(null), 'ArrowDown').action).toBe('none');
	});

	it('the arrows move one row and wrap at both ends', () => {
		expect(key(st('device'), 'ArrowDown').state.cursor).toBe('folder:A');
		expect(key(st('folder:A/B'), 'ArrowDown').state.cursor).toBe('picture:A/a1.png');
		expect(key(st('picture:r.png'), 'ArrowDown').state.cursor).toBe('device');
		expect(key(st('picture:A/a1.png'), 'ArrowUp').state.cursor).toBe('folder:A/B');
		expect(key(st('device'), 'ArrowUp').state.cursor).toBe('picture:r.png');
	});

	it('a cursor that moves onto a picture selects it and arms it; onto a folder or the device row it keeps the selected picture', () => {
		const onPicture = key(st('folder:A/B'), 'ArrowDown').state;
		expect(onPicture).toEqual({ cursor: 'picture:A/a1.png', selected: 'A/a1.png', armed: true });
		const toFolder = key(st('picture:A/a1.png', 'A/a1.png', true), 'ArrowUp').state;
		expect(toFolder.cursor).toBe('folder:A/B');
		expect(toFolder.selected).toBe('A/a1.png');
		const toDevice = key(st('picture:r.png', 'r.png', true), 'ArrowDown').state;
		expect(toDevice.cursor).toBe('device');
		expect(toDevice.selected).toBe('r.png');
	});

	it('a cursor whose row is not in the rows acts as no cursor', () => {
		expect(key(st('folder:Gone'), 'ArrowDown').state.cursor).toBe('device');
		expect(key(st('picture:Gone.png'), 'ArrowUp').state.cursor).toBe('picture:r.png');
		expect(key(st('folder:Gone'), 'Enter').action).toBe('none');
	});

	it('the cursor stays on its row when the rows change (by identity, not by index)', () => {
		const closed = M.pickerRows(t, new Set(), null);
		expect(keys(closed)).toEqual(['device', 'folder:A', 'picture:r.png']);
		expect(M.pickerKey(closed, st('picture:r.png', 'r.png', true), 'ArrowUp').state.cursor).toBe('folder:A');
		expect(M.pickerKey(rows, st('picture:r.png', 'r.png', true), 'ArrowUp').state.cursor).toBe('picture:A/a1.png');
	});

	it('ArrowRight opens a closed folder; ArrowLeft closes an open folder; elsewhere nothing and the state is the same', () => {
		expect(key(st('folder:A/B'), 'ArrowRight')).toEqual({ state: st('folder:A/B'), action: 'open' });
		expect(key(st('folder:A'), 'ArrowLeft')).toEqual({ state: st('folder:A'), action: 'close' });
		for (const [cursor, k] of [
			['folder:A', 'ArrowRight'],
			['folder:A/B', 'ArrowLeft'],
			['picture:A/a1.png', 'ArrowRight'],
			['picture:A/a1.png', 'ArrowLeft'],
			['device', 'ArrowRight'],
			['device', 'ArrowLeft'],
			[null, 'ArrowRight'],
			[null, 'ArrowLeft'],
		] as const) {
			const before = st(cursor, 'r.png', true);
			expect(key(before, k)).toEqual({ state: before, action: 'none' });
		}
	});

	it('Enter: a folder row toggles, a picture row chooses, the device row gives "device"; no cursor does nothing', () => {
		expect(key(st('folder:A'), 'Enter').action).toBe('toggle');
		expect(key(st('folder:A/B'), 'Enter').action).toBe('toggle');
		expect(key(st('picture:r.png', 'r.png', true), 'Enter').action).toBe('choose');
		expect(key(st('device'), 'Enter').action).toBe('device');
		const none = st(null, 'r.png', true);
		expect(key(none, 'Enter')).toEqual({ state: none, action: 'none' });
	});

	it('Space acts on a folder row only; on any other row the state is the same and the action is "none" (no preventDefault)', () => {
		expect(key(st('folder:A'), ' ').action).toBe('toggle');
		expect(key(st('folder:A/B'), ' ').action).toBe('toggle');
		for (const cursor of ['device', 'picture:r.png', null]) {
			const before = st(cursor, 'r.png', true);
			expect(key(before, ' ')).toEqual({ state: before, action: 'none' });
		}
	});

	it('keys do not change the reducer input', () => {
		const before = st('folder:A', 'r.png', true);
		const copy = { ...before };
		key(before, 'ArrowDown');
		key(before, 'Enter');
		expect(before).toEqual(copy);
	});
});

describe('P8: pickerTap', () => {
	let rows: PickerRow[];
	beforeEach(() => {
		rows = M.pickerRows(tree(['A/a1.png', 'A/B/b1.png', 'r.png']), new Set(['A']), null);
	});
	const st = (cursor: string | null, selected: string | null = null, armed = false): PickerState => ({ cursor, selected, armed });

	it('a tap on a folder row toggles, moves the cursor to it and keeps the selected picture', () => {
		const r = M.pickerTap(rows, st('picture:r.png', 'r.png', true), 'folder:A/B');
		expect(r.action).toBe('toggle');
		expect(r.state.cursor).toBe('folder:A/B');
		expect(r.state.selected).toBe('r.png');
	});

	it('the first tap on a picture selects it and arms it; the second tap on the same row chooses it', () => {
		const first = M.pickerTap(rows, st(null), 'picture:A/a1.png');
		expect(first).toEqual({ state: { cursor: 'picture:A/a1.png', selected: 'A/a1.png', armed: true }, action: 'none' });
		expect(M.pickerTap(rows, first.state, 'picture:A/a1.png').action).toBe('choose');
	});

	it('a tap on another picture selects that one and does not choose', () => {
		const r = M.pickerTap(rows, st('picture:A/a1.png', 'A/a1.png', true), 'picture:r.png');
		expect(r).toEqual({ state: { cursor: 'picture:r.png', selected: 'r.png', armed: true }, action: 'none' });
	});

	it('the current picture at open counts its first tap as the first tap: it does not choose, and the second tap does', () => {
		const open = st('picture:A/a1.png', 'A/a1.png', false);
		const first = M.pickerTap(rows, open, 'picture:A/a1.png');
		expect(first.action).toBe('none');
		expect(first.state.selected).toBe('A/a1.png');
		expect(first.state.armed).toBe(true);
		expect(M.pickerTap(rows, first.state, 'picture:A/a1.png').action).toBe('choose');
	});

	it('the device row gives "device" at once', () => {
		expect(M.pickerTap(rows, st(null), 'device').action).toBe('device');
		expect(M.pickerTap(rows, st('picture:r.png', 'r.png', true), 'device').action).toBe('device');
	});
});

describe('P8: pickerSwitch and toggleFolder', () => {
	let t: PictureTree;
	beforeEach(() => {
		t = tree(['A/a1.png', 'r.png']);
	});
	const st = (cursor: string | null, selected: string | null, armed: boolean): PickerState => ({ cursor, selected, armed });

	it('the cursor goes to the selected picture\'s row if the new rows show it; the selection and armed do not change', () => {
		const search = M.searchRows(t, 'a1', null).rows;
		expect(M.pickerSwitch(search, st('folder:A', 'A/a1.png', true))).toEqual(st('picture:A/a1.png', 'A/a1.png', true));
		expect(M.pickerSwitch(search, st('device', 'A/a1.png', false))).toEqual(st('picture:A/a1.png', 'A/a1.png', false));
	});

	it('the cursor goes to none if the new rows do not show the selected picture, or nothing is selected', () => {
		const search = M.searchRows(t, 'r.png', null).rows;
		expect(M.pickerSwitch(search, st('picture:A/a1.png', 'A/a1.png', true))).toEqual(st(null, 'A/a1.png', true));
		expect(M.pickerSwitch(search, st('device', null, false))).toEqual(st(null, null, false));
		const folderView = M.pickerRows(t, new Set(), null);
		expect(M.pickerSwitch(folderView, st('picture:A/a1.png', 'A/a1.png', true))).toEqual(st(null, 'A/a1.png', true));
	});

	it('toggleFolder opens a closed folder and closes an open one, and returns a new set', () => {
		const start = new Set(['A']);
		const opened = M.toggleFolder(start, 'A/B');
		expect([...opened].sort()).toEqual(['A', 'A/B']);
		expect([...start]).toEqual(['A']);
		const closed = M.toggleFolder(opened, 'A');
		expect([...closed]).toEqual(['A/B']);
		expect(closed).not.toBe(opened);
	});
});

describe('P10: previewNear and previewOrder', () => {
	const scroller = { top: 0, bottom: 500 };
	const row = (top: number) => ({ top, bottom: top + 44 });

	it('a row is near when it meets the scroller grown by one scroller height above and below', () => {
		expect(M.previewNear(row(100), scroller)).toBe(true);
		expect(M.previewNear(row(999 - 44), scroller)).toBe(true);
		expect(M.previewNear(row(700), scroller)).toBe(true);
		expect(M.previewNear(row(1010), scroller)).toBe(false);
		expect(M.previewNear(row(-300), scroller)).toBe(true);
		expect(M.previewNear(row(-545), scroller)).toBe(false);
		expect(M.previewNear(row(-10000), scroller)).toBe(false);
	});

	it('the scroller\'s rect is in client px: it need not start at 0', () => {
		const s = { top: 300, bottom: 700 };
		expect(M.previewNear(row(1050), s)).toBe(true);
		expect(M.previewNear(row(1150), s)).toBe(false);
		expect(M.previewNear(row(-50), s)).toBe(true);
		expect(M.previewNear(row(-150), s)).toBe(false);
	});

	it('an explicit margin replaces the scroller height', () => {
		expect(M.previewNear(row(590), scroller, 100)).toBe(true);
		expect(M.previewNear(row(610), scroller, 100)).toBe(false);
		expect(M.previewNear(row(-130), scroller, 100)).toBe(true);
		expect(M.previewNear(row(-160), scroller, 100)).toBe(false);
		expect(M.previewNear(row(510), scroller, 0)).toBe(false);
	});

	it('previewOrder gives the indexes of the near rows, the ones in view first, then the nearest first; far rows are left out', () => {
		const rowsIn = [row(1200), row(700), row(100), row(-300), row(450)];
		const order = M.previewOrder(rowsIn, scroller);
		expect(order).toHaveLength(4);
		expect(new Set(order.slice(0, 2))).toEqual(new Set([2, 4]));
		expect(order.slice(2)).toEqual([1, 3]);
	});

	it('a row that is partly in view counts as in view', () => {
		const order = M.previewOrder([row(700), { top: 480, bottom: 524 }, row(-100)], scroller);
		expect(order[0]).toBe(1);
	});

	it('no rows give no order', () => {
		expect(M.previewOrder([], scroller)).toEqual([]);
	});
});

describe('spec §13.14 Large vaults: 2 000 pictures in 100 folders', () => {
	speedTest('the tree and the first rows are made in under 300 ms', () => {
		const files: PictureFileLike[] = [];
		for (let f = 0; f < 100; f++) for (let p = 0; p < 20; p++) files.push(vf(`Folder ${f}/Sub/picture ${p}.png`));
		const t0 = performance.now();
		const t = M.buildPictureTree(files, isShown);
		const rows = M.pickerRows(t, new Set(), null);
		const ms = performance.now() - t0;
		expect(rows).toHaveLength(101);
		expect(t.count).toBe(2000);
		expect(ms).toBeLessThan(300);
	});

	speedTest('one open folder of 2 000 pictures gives 2 001 rows and a search over them is fast', () => {
		const files = Array.from({ length: 2000 }, (_, i) => vf(`Big/p${i}.png`));
		const t = M.buildPictureTree(files, isShown);
		const t0 = performance.now();
		const rows = M.pickerRows(t, new Set(['Big']), null);
		const found = M.searchRows(t, 'p19', null);
		expect(performance.now() - t0).toBeLessThan(300);
		expect(rows).toHaveLength(2002);
		expect(found.rows.length).toBeGreaterThan(1);
	});
});
