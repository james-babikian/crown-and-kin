import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { computeGenerations } from '../../src/core/generations';
import { computeModelOrder } from '../../src/core/order';
import { fixtureSource } from './load';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { FEl, dispatch, fakeWin, installDom, resetDom } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { graphOf, housePageModule, tableCellOf } from './m10-support';
import { fakeHandle } from './tree-view-fakes';

/*
 * Spec §13.12 (D55, D88, D89), §13.11 "Note name" and the M10 core contract rules 13–18: the rows
 * of the house page and of its table note. Small trees give exact expected values worked out by
 * hand; sample tree 6 gives the members, the generation numbers and the order of each house, with
 * the two functions the contract names as the sources (`computeGenerations`, `computeModelOrder`).
 * These tests wait for WP 10.1.
 */

/** Aldric (house v) and Beatrice (o) with two children; Ella (no house) marries Cedric; two grandchildren. */
const SMALL = [
	'houses:',
	'  - id: v',
	'    name: House Valmont',
	'    color: "#8b1e3f"',
	'    arms: "[[v.png]]"',
	'  - id: o',
	'    name: House Orsini',
	'    color: "#1e4f8b"',
	'  - id: e',
	'    name: House Empty',
	'    color: "#123456"',
	'titles:',
	'  - id: duke',
	'    name: Duke of Valmont',
	'    holders:',
	'      - {person: aldric, number: II, from: 1131, to: 1160}',
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    house: v',
	'    born: 1100',
	'    died: 1160',
	'  - id: beatrice',
	'    name: Beatrice Orsini',
	'    house: o',
	'  - id: cedric',
	'    name: Cedric Valmont',
	'    title: Heir of Valmont',
	'    house: v',
	'    born: c. 1130',
	'    parents: [aldric, beatrice]',
	'  - id: dorian',
	'    name: Dorian Orsini',
	'    house: o',
	'    parents: [aldric, beatrice]',
	'  - id: ella',
	'    name: Ella Harrow',
	'  - id: gwen',
	'    name: Gwen|Pipe Valmont',
	'    house: v',
	'    born: "1160|1161"',
	'    parents: [cedric, ella]',
	'  - id: fenn',
	'    name: Fenn Valmont',
	'    house: v',
	'    born: 1150',
	'    parents: [cedric, ella]',
	'unions:',
	'  - partners: [aldric, beatrice]',
	'  - partners: [cedric, ella]',
	'',
].join('\n');

describe('rules 13–16: the page of a house (small tree, exact rows)', () => {
	it('members are only the people whose house it is; generation 1 is the oldest generation with a member (D88, D89)', async () => {
		const { housePage } = await housePageModule();
		const page = housePage(graphOf(SMALL), 'v')!;
		expect(page.count).toBe(4);
		expect(page.rows.map((r) => [r.id, r.generation])).toEqual([
			['aldric', 1],
			['cedric', 2],
			// Two people of one generation: in the order of the tree text (D2 sibling order), not by name (Gwen is written before Fenn).
			['gwen', 3],
			['fenn', 3],
		]);
	});

	it('the house: id, name, colour and arms as written', async () => {
		const { housePage } = await housePageModule();
		const page = housePage(graphOf(SMALL), 'v')!;
		expect(page.house.id).toBe('v');
		expect(page.house.name).toBe('House Valmont');
		expect(page.house.color).toBe('#8b1e3f');
		expect(page.house.arms).toBe('[[v.png]]');
		const o = housePage(graphOf(SMALL), 'o')!;
		expect(o.house.arms).toBeUndefined();
	});

	it('cells: the regnal name (D58), the title with its reign (rule 16), the dates as written', async () => {
		const { housePage } = await housePageModule();
		const rows = new Map(housePage(graphOf(SMALL), 'v')!.rows.map((r) => [r.id, r]));
		expect(rows.get('aldric')).toMatchObject({ name: 'Aldric II', title: 'Duke of Valmont (r. 1131–1160)', born: '1100', died: '1160' });
		// A written title, no reign: the written text. No died: ''.
		expect(rows.get('cedric')).toMatchObject({ name: 'Cedric Valmont', title: 'Heir of Valmont', born: 'c. 1130', died: '' });
		// No title and no dates: empty cells.
		expect(rows.get('fenn')).toMatchObject({ name: 'Fenn Valmont', title: '', born: '1150', died: '' });
	});

	it('a partner from another house, and a partner with no house, are not listed (D89)', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(SMALL);
		expect(housePage(g, 'o')!.rows.map((r) => [r.id, r.generation])).toEqual([
			['beatrice', 1],
			['dorian', 2],
		]);
		expect(housePage(g, 'v')!.rows.map((r) => r.id)).not.toContain('ella');
		expect(housePage(g, 'v')!.rows.map((r) => r.id)).not.toContain('beatrice');
	});

	it('a house with no person: a page with count 0 and no rows; an id that is not a house: null', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(SMALL);
		const empty = housePage(g, 'e')!;
		expect(empty.count).toBe(0);
		expect(empty.rows).toEqual([]);
		expect(empty.house.name).toBe('House Empty');
		expect(housePage(g, 'nobody')).toBeNull();
	});

	it('D88: the numbers count on over a generation with no member (generations 1 and 3 of the tree)', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(
			[
				'houses:',
				'  - {id: v, name: House V}',
				'  - {id: o, name: House O}',
				'  - {id: w, name: House W}',
				'people:',
				'  - {id: a, name: A Vee, house: v}',
				'  - {id: p, name: P Oh, house: o}',
				'  - {id: q, name: Q Oh, house: w, parents: [a, p]}',
				'  - {id: z, name: Z Zed}',
				'  - {id: t, name: T Vee, house: v, parents: [q, z]}',
				'  - {id: u, name: U Dub, house: w, parents: [q, z]}',
				'unions:',
				'  - partners: [a, p]',
				'  - partners: [q, z]',
				'',
			].join('\n'),
		);
		// v has people in the generations 0 and 2 of the tree: 1 and 3.
		expect(housePage(g, 'v')!.rows.map((r) => [r.id, r.generation])).toEqual([
			['a', 1],
			['t', 3],
		]);
		// w has people in generations 1 and 2: the oldest of them is 1.
		expect(housePage(g, 'w')!.rows.map((r) => [r.id, r.generation])).toEqual([
			['q', 1],
			['u', 2],
		]);
	});

	it('the page reads the graph it is given: the whole tree (focus mode and folds do not change it, D89)', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(SMALL);
		// The same call twice gives the same rows; the function has no fold or focus parameter.
		expect(housePage(g, 'v')!.rows).toEqual(housePage(g, 'v')!.rows);
	});
});

describe('rules 14 and 15 on sample tree 6: members, numbers and order of every house', () => {
	it('each house lists exactly its people, by generation and then in model order', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(fixtureSource('06'));
		const gens = computeGenerations(g);
		const order = computeModelOrder(g, gens).items.filter((i) => i.kind === 'person').map((i) => (i as { id: string }).id);
		const place = new Map(order.map((id, k) => [id, k]));
		let listed = 0;
		for (const id of g.houses.keys()) {
			const members = g.people.filter((p) => p.house === id).map((p) => p.id);
			const page = housePage(g, id)!;
			expect(page.count, id).toBe(members.length);
			expect(page.rows.map((r) => r.id).sort(), id).toEqual([...members].sort());
			if (!members.length) continue;
			const oldest = Math.min(...members.map((m) => gens.get(m)!));
			const want = [...members].sort((a, b) => gens.get(a)! - gens.get(b)! || place.get(a)! - place.get(b)!);
			expect(
				page.rows.map((r) => r.id),
				id,
			).toEqual(want);
			expect(
				page.rows.map((r) => r.generation),
				id,
			).toEqual(want.map((m) => gens.get(m)! - oldest + 1));
			expect(page.rows[0].generation, id).toBe(1);
			listed += members.length;
		}
		// Every person with a house is on exactly one page.
		expect(listed).toBe(g.people.filter((p) => p.house !== undefined).length);
		expect(listed).toBeGreaterThan(30);
	});

	it('the cells are the card texts of the whole tree (name of the card, born and died as written)', async () => {
		const { housePage } = await housePageModule();
		const g = graphOf(fixtureSource('06'));
		for (const id of g.houses.keys()) {
			for (const row of housePage(g, id)!.rows) {
				const p = g.byId.get(row.id)!;
				expect(row.name, row.id).toBe(p.name);
				expect(row.title, row.id).toBe(p.title ?? '');
				expect(row.born, row.id).toBe(p.born ?? '');
				expect(row.died, row.id).toBe(p.died ?? '');
			}
		}
	});
});

describe('rule 17: the table note text', () => {
	it('only the table: the header, the separator and one row per member; the text ends with one line break', async () => {
		const { housePage, houseTableNote } = await housePageModule();
		const text = houseTableNote(housePage(graphOf(SMALL), 'v')!);
		expect(text).toBe(
			[
				'| Generation | Name | Title | Born | Died |',
				'| --- | --- | --- | --- | --- |',
				'| 1 | Aldric II | Duke of Valmont (r. 1131–1160) | 1100 | 1160 |',
				'| 2 | Cedric Valmont | Heir of Valmont | c. 1130 |  |',
				'| 3 | Gwen\\|Pipe Valmont |  | 1160\\|1161 |  |',
				'| 3 | Fenn Valmont |  | 1150 |  |',
				'',
			].join('\n'),
		);
		expect(text.endsWith('\n')).toBe(true);
		expect(text.endsWith('\n\n')).toBe(false);
	});

	it('no heading and no other text line (D86, spec §13.12)', async () => {
		const { housePage, houseTableNote } = await housePageModule();
		const lines = houseTableNote(housePage(graphOf(SMALL), 'o')!).split('\n');
		expect(lines.slice(0, 2)).toEqual(['| Generation | Name | Title | Born | Died |', '| --- | --- | --- | --- | --- |']);
		expect(lines.filter((l) => l !== '' && !l.startsWith('|'))).toEqual([]);
		expect(lines).toHaveLength(2 + 2 + 1);
	});

	it('"|" in a cell is escaped, and text line breaks become spaces (tableCell)', async () => {
		const cell = await tableCellOf();
		expect(cell('a|b')).toBe('a\\|b');
		expect(cell('a\nb')).toBe('a b');
		expect(cell('a\r\nb')).toBe('a b');
		expect(cell('plain')).toBe('plain');
		expect(cell('')).toBe('');
	});
});

describe('rule 18: the note name', () => {
	it('"House Valmont, people" (D55, spec §13.12)', async () => {
		const { houseNoteName } = await housePageModule();
		expect(houseNoteName({ id: 'v', name: 'House Valmont' })).toBe('House Valmont, people');
	});

	it('cleaned as §13.11 says: forbidden characters removed, a leading "." removed, spaces joined', async () => {
		const { houseNoteName } = await housePageModule();
		expect(houseNoteName({ id: 'v', name: 'House: Val/mont*' })).toBe('House Valmont, people');
		expect(houseNoteName({ id: 'v', name: 'House   Valmont' })).toBe('House Valmont, people');
		expect(houseNoteName({ id: 'v', name: '.Hidden House' })).toBe('Hidden House, people');
	});
});

describe('performance (spec §13.12): the largest house of sample tree 7', () => {
	it('opens in well under 200 ms, table text included', async () => {
		const { housePage, houseTableNote } = await housePageModule();
		const g = graphOf(fixtureSource('07'));
		const sizes = [...g.houses.keys()].map((id) => [id, g.people.filter((p) => p.house === id).length] as const);
		const [largest, size] = sizes.reduce((a, b) => (b[1] > a[1] ? b : a));
		expect(size).toBeGreaterThan(20);
		const start = performance.now();
		const page = housePage(g, largest)!;
		houseTableNote(page);
		const ms = performance.now() - start;
		expect(page.count).toBe(size);
		// The target is 200 ms on a mid-range phone; a computer must be far below it.
		expect(ms).toBeLessThan(200);
	});
});

/* Adopted from the M10 review C (`m10/review-c`, finding 4). Waits for the fix round (C2). */
describe('review C: People in the Houses window (spec §13.12)', () => {
	beforeAll(() => {
		installDom();
		(globalThis as Record<string, unknown>).window ??= fakeWin;
	});
	beforeEach(() => {
		resetDom();
		resetObsidian();
	});
	afterEach(() => vi.restoreAllMocks());

	const BODY = `houses:
  - id: valmont
    name: House Valmont
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
`;

	it('a tap on a name still shows the card when the edit page of a house is open in the Houses window', () => {
		const app = {
			fileManager: { getNewFileParent: () => ({ path: '/', name: '', isRoot: () => true, children: [] }), generateMarkdownLink: () => '' },
			vault: { create: vi.fn(), createFolder: vi.fn(), getAbstractFileByPath: () => null, getRoot: () => ({ path: '/', children: [] }) },
		};
		const shown: string[] = [];
		const win = HousesWindow.create(app as never, { handle: fakeHandle('Trees/Tree.md', BODY) as never, sourcePath: 'Trees/Tree.md', people: { show: (id: string) => shown.push(id), openNote: () => undefined } } as never)!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		// 0.2.5 (D134): People is on the edit page of the house.
		dispatch(content.querySelectorAll('button.dynasty-lw-row')[0], 'click');
		dispatch(content.querySelector('.dynasty-lw-page .dynasty-house-people')!, 'click');
		const page = openModals[1] as unknown as { contentEl: FEl };
		dispatch(page.contentEl.querySelectorAll('.dynasty-hp-row')[0], 'click');
		expect(shown).toEqual(['aldric']);
	});
});
