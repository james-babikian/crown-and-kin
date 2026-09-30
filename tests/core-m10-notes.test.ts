import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { houseNoteName, housePage, houseTableNote } from '../src/core/house-page';
import { linkedNotePath, personNoteName } from '../src/core/note-make';
import { parseDynasty } from '../src/core/parse';
import { tableCell } from '../src/core/titles';

/* WP 10.1 unit tests for `house-page.ts` and `note-make.ts`: edges that the acceptance tests do not name. */

describe('housePage edges', () => {
	const text = ['houses:', '  - {id: v, name: House V}', 'people:', '  - {id: a, name: A, house: v}', ''].join('\n');
	const g = () => {
		const r = parseDynasty(text);
		if (!r.ok) throw new Error('parse');
		return deriveFamilies(r.tree);
	};

	it('the only member is generation 1; the table has a header, a separator and one row', () => {
		const page = housePage(g(), 'v')!;
		expect(page.rows.map((r) => r.generation)).toEqual([1]);
		expect(houseTableNote(page).split('\n')).toHaveLength(4);
	});

	it('a made-up graph or id does not throw', () => {
		expect(housePage(undefined as never, 'v')).toBeNull();
		expect(housePage(g(), undefined as never)).toBeNull();
		expect(houseTableNote(undefined as never)).toBe('| Generation | Name | Title | Born | Died |\n| --- | --- | --- | --- | --- |\n');
	});

	it('houseNoteName with an empty name is still a name; tableCell is the titles helper', () => {
		expect(houseNoteName({ id: 'x', name: '' })).toBe(', people');
		expect(tableCell('a|b')).toBe('a\\|b');
	});
});

describe('note names and paths', () => {
	it('personNoteName does not throw on a missing name', () => {
		expect(personNoteName(undefined as never)).toBe('Person');
	});

	it('linkedNotePath: repeated slashes and a trailing slash', () => {
		expect(linkedNotePath('[[People//Kings/Aldric]]')).toEqual({ folder: 'People/Kings', name: 'Aldric', path: 'People/Kings/Aldric.md' });
		expect(linkedNotePath('[[People/]]')).toEqual({ folder: '', name: 'People', path: 'People.md' });
		expect(linkedNotePath('[[.md]]')).toBeNull();
		expect(linkedNotePath('mailto:a@b.c')).toBeNull();
		expect(linkedNotePath(5 as never)).toBeNull();
	});
});
