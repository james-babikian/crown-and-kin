/*
 * The house page (spec §13.12, D55, D88, D89): the people of one house from the whole tree's graph,
 * numbered by generation and in the model order of the layout, and the Markdown table that "Make a
 * note with this table" writes. The Houses window and the table-note code call it; the layout does
 * not. The cells are the card texts, so they agree with what the tree shows.
 *
 * Rules (D55, D88, D89):
 * - Members are the people whose `house` is the house id, from the whole tree's graph (focus mode and
 *   folds do not change it). Partners from other houses are not listed. A house with no member gives a
 *   page with `count` 0 and no rows; an id that is not in `g.houses` gives null.
 * - Generation (D88): `computeGenerations(g)`; the member's number is its generation minus the smallest
 *   generation among the members, plus 1. Numbers count on over a generation with no member.
 * - Order: by generation, then by the person's place in the model order (`computeModelOrder`, which
 *   keeps the sibling order of D2), not by the final left-to-right place of the layout.
 * - Cells: `name` is the regnal name of D58; `title` is the title text line as the card shows it, with
 *   the reign, joined with one space, or ''; `born` and `died` as written, or ''.
 * - Table note: only the table (header, separator, one row per member), every cell through `tableCell`,
 *   one line break at the end. The note name is cleaned as `noteName` cleans it.
 */

import type { FamilyGraph } from './derive';
import { computeGenerations } from './generations';
import { computeModelOrder } from './order';
import { cardLabels, noteName, tableCell } from './titles';
import type { House } from './types';

/** One row of the house page and of its table note. */
export interface HousePageRow {
	id: string;
	/** D88: 1 = the oldest generation with a member of the house. */
	generation: number;
	/** The card's name text line (regnal name, D58). */
	name: string;
	/** The card's title text line with its reign; '' when none. */
	title: string;
	born: string;
	died: string;
}

/** The house page: the house, the number of people and the rows in order. */
export interface HousePage {
	house: Pick<House, 'id' | 'name' | 'color' | 'arms'>;
	count: number;
	rows: readonly HousePageRow[];
}

/** The page of house `houseId` of the whole tree's graph; null when the house is not in `g.houses`. */
export function housePage(g: FamilyGraph, houseId: string): HousePage | null {
	const house = g?.houses?.get(houseId);
	if (!house) return null;
	const head: HousePage['house'] = { id: house.id, name: house.name, ...(house.color !== undefined ? { color: house.color } : {}), ...(house.arms !== undefined ? { arms: house.arms } : {}) };
	const members = g.people.filter((p) => p.house === houseId);
	if (!members.length) return { house: head, count: 0, rows: [] };

	const gens = computeGenerations(g);
	const place = new Map<string, number>();
	computeModelOrder(g, gens).items.forEach((item, k) => {
		if (item.kind === 'person') place.set(item.id, k);
	});
	const gen = (id: string) => gens.get(id) ?? 0;
	const at = (id: string) => place.get(id) ?? Number.MAX_SAFE_INTEGER;
	const sorted = [...members].sort((a, b) => gen(a.id) - gen(b.id) || at(a.id) - at(b.id) || a.index - b.index);
	const oldest = gen(sorted[0].id);
	const labels = cardLabels(g);
	const rows = sorted.map((p): HousePageRow => {
		const label = labels.get(p.id);
		return {
			id: p.id,
			generation: gen(p.id) - oldest + 1,
			name: label?.name ?? p.name,
			title: [label?.title, label?.reign].filter((x) => x !== undefined && x !== '').join(' '),
			born: p.born ?? '',
			died: p.died ?? '',
		};
	});
	return { house: head, count: rows.length, rows };
}

/** The text of the table note: only the table, one row per member, ending with one line break. */
export function houseTableNote(page: HousePage): string {
	const lines = ['| Generation | Name | Title | Born | Died |', '| --- | --- | --- | --- | --- |'];
	for (const r of page?.rows ?? []) lines.push(`| ${r.generation} | ${tableCell(r.name)} | ${tableCell(r.title)} | ${tableCell(r.born)} | ${tableCell(r.died)} |`);
	return lines.join('\n') + '\n';
}

/** The note name of a house table, cleaned as §13.11 says. */
export function houseNoteName(house: Pick<House, 'id' | 'name'>): string {
	return noteName(`${house?.name ?? ''}, people`, 'House, people');
}
