import { describe, expect, it } from 'vitest';
import { datesApi, graphOf, lineOf, LONG_COUNT, notesOf } from '../dates-support';
import { bornDateUnread } from '../../src/view/succession-notes';

/*
 * D319 item 3c (spec §13.21 rules 5 and 9): a child whose birth date has text but no year breaks the order of the note. The line with "now" reads no births, so it showed only the
 * break ("the birth years and the order do not agree") and not the date that caused it. The window names that date now, under the row of the person.
 */

const SRC = (title: string) => `people:
  - {id: r, name: Rolf, sex: m}
  - {id: a, name: Odalys, sex: f, born: 1210, parents: [r]}
  - {id: p, name: Perrin, sex: m, born: "Third Cycle, Year the Tenth", parents: [r]}
  - {id: t, name: Tobias, sex: m, born: 1205, parents: [r]}
titles:
  - id: crown
    name: Crown
    succession: eldest-child
${title}    holders:
      - {person: r}
`;

const dates = () => datesApi.compileCalendars([LONG_COUNT], true);

describe('a birth date with no year that breaks the order of the note', () => {
	it('with "now" the line names the date of the person, and the break stays', () => {
		const res = lineOf(SRC(''), dates());
		expect(res.year).toBeNull();
		expect(notesOf(res, 'order-contradiction')).toHaveLength(1);
		expect(res.noYear).toEqual([]);
		const g = graphOf(SRC(''), dates());
		expect(bornDateUnread(res, g, 'p')).toBe(true);
		expect(bornDateUnread(res, g, 'a')).toBe(false);
		expect(bornDateUnread(res, g, 't')).toBe(false);
	});

	it('a line with a year says it once (the line read births already)', () => {
		const res = lineOf(SRC('    year: "1250"\n'), dates());
		expect(res.noYear.filter((n) => n.id === 'p' && n.what === 'born')).toHaveLength(1);
	});

	it('a line with no break and "now" keeps its old result (no note for a date that did not matter)', () => {
		const src = SRC('').replace('"Third Cycle, Year the Tenth"', '1207');
		const res = lineOf(src, dates());
		expect(bornDateUnread(res, graphOf(src, dates()), 'p')).toBe(false);
	});
});
