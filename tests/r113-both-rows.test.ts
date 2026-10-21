import { describe, expect, it } from 'vitest';

import { idFromName, idProblemFor, idProblems, reasonText, type IdKind, type IdRow } from '../src/view/id-draft';
import { ID_UI } from '../src/render/ui-text';

/*
 * Version 0.2.3, owner decision "3-both" (2026-10-03): when the draft ID of a saved row is refused because a new row
 * would get the same ID from its name, both rows are marked. The saved row keeps its reason; the new row gets the
 * reason "newName".
 */

const saved = (key: string, id: string, idDraft: string | undefined, name = key, deleted = false): IdRow => ({ key, id, idDraft, name, deleted });
const fresh = (key: string, name: string, deleted = false): IdRow => ({ key, id: null, name, deleted });
const check = (kind: IdKind, rows: IdRow[], dangling: string[] = []) => Object.fromEntries(idProblems(kind, rows, dangling));

describe.each([
	['house', 'House Valmont', 'house-valmont', 'House Other'],
	['title', 'King', 'king', 'Queen'],
] as const)('both rows are marked (%s)', (kind, name, id, other) => {
	const rows = (newName: string, extra: IdRow[] = []): IdRow[] => [saved('a', 'old', id, 'Old'), ...extra, fresh('n', newName)];

	it('marks the saved row as before and the new row with the new reason', () => {
		expect(check(kind, rows(name))).toEqual({ a: 'taken', n: 'newName' });
	});

	it('marks the new row when it comes before the saved row in the list', () => {
		expect(check(kind, [fresh('n', name), saved('a', 'old', id, 'Old')])).toEqual({ a: 'taken', n: 'newName' });
	});

	it('removes both marks when the name of the new row gives another ID', () => {
		expect(check(kind, rows(other))).toEqual({});
	});

	it('does not mark a new row whose ID is unique, or a new row without a name', () => {
		expect(check(kind, rows(''))).toEqual({});
		expect(check(kind, rows('   '))).toEqual({});
		expect(check(kind, [saved('a', 'old', 'other-id', 'Old'), fresh('n', name)])).toEqual({});
	});

	it('does not mark a deleted new row, and a deleted new row does not refuse the saved row', () => {
		expect(check(kind, [saved('a', 'old', id, 'Old'), fresh('n', name, true)])).toEqual({});
	});

	it('marks a new row once when it conflicts with two changed rows', () => {
		const two = [saved('a', 'old', id, 'Old'), saved('b', 'older', id, 'Older'), fresh('n', name)];
		expect(check(kind, two)).toEqual({ a: 'taken', b: 'taken', n: 'newName' });
	});

	it('marks only the new row whose ID conflicts, when there are two new rows', () => {
		const rs = [saved('a', 'old', id, 'Old'), fresh('n1', name), fresh('n2', other)];
		expect(check(kind, rs)).toEqual({ a: 'taken', n1: 'newName' });
	});

	it('marks the second of two new rows with the same name when its ID (with a number) is the draft ID', () => {
		// The first new row gets the plain ID, the second gets the ID with "-2".
		const rs = [saved('a', 'old', `${id}-2`, 'Old'), fresh('n1', name), fresh('n2', name)];
		expect(check(kind, rs)).toEqual({ a: 'taken', n2: 'newName' });
	});

	it('does not mark the new row when the saved row is unchanged or its change is refused for another reason', () => {
		expect(check(kind, [saved('a', id, id, name), fresh('n', name)])).toEqual({});
		expect(check(kind, [saved('a', 'old', 'Bad Id', 'Old'), fresh('n', name)])).toEqual({ a: 'characters' });
	});

	it('does not mark a new row when the saved row that has the ID is marked for deletion', () => {
		expect(check(kind, [saved('a', 'old', id, 'Old', true), fresh('n', name)])).toEqual({});
	});
});

describe('the other checks stay the same', () => {
	it('the small ID window (idProblemFor) never marks a new row and keeps its answers', () => {
		const rows = [saved('a', 'old', 'old', 'Old'), fresh('n', 'House Valmont')];
		expect(idProblemFor('house', rows, rows[0], 'house-valmont', [])).toBe('taken');
		expect(idProblemFor('house', rows, rows[0], 'house-other', [])).toBeNull();
		expect(idProblemFor('house', rows, rows[1], 'house-valmont', [])).toBeNull();
	});

	it('the button "Make ID from the name" still gives an ID that the draft does not use', () => {
		const rows = [saved('a', 'old', 'house-valmont', 'House Valmont'), fresh('n', 'House Valmont')];
		expect(idFromName('house', rows, rows[0], [])).toBe('house-valmont-2');
	});

	it('the text has two short sentences and ID in capitals', () => {
		expect(reasonText('newName')).toBe('This name gives an ID that is in use. Enter a different name.');
		expect(ID_UI.newName.split(/[.?!]\s*/).every((s) => s.split(' ').length <= 20)).toBe(true);
	});
});
