// G2 review of step 4.2 of WP-4 (dates): failing tests for the tree warning list that `validate.ts` builds from the date reader
// (the architecture notes §5.7; spec §14 rule 5: the warnings show "as notes at the same places in the Titles window").
import { describe, expect, it } from 'vitest';
import { compileCalendars } from '../../src/core/dates';
import { specOf, successionLine } from '../../src/core/succession';
import { ALDRIC, copyOf, graphOf } from '../dates-support';

describe('review 4.2: the tree warning list and the line meet the same date warnings', () => {
	it('F1: a person the line reads who is not a descendant of a holder (a sibling heir) still gets the warning in the tree list', () => {
		const g = graphOf(`people:
  - {id: p, name: Papa, sex: m, born: 960, died: 1010}
  - {id: r, name: Rolf, sex: m, born: 1000, parents: [p]}
  - {id: s, name: Sib, sex: m, born: "0", parents: [p]}
titles:
  - id: crown
    name: Crown
    succession: siblings-first
    year: "1100"
    holders:
      - {person: r}
`);
		const line = successionLine(g, g.titles[0], specOf(g.titles[0]), 5, 110);
		// The line reads Sib (a brother of the holder) and the Titles window gets the warning.
		expect(line.heirs).toContain('s');
		expect(line.dateWarnings).toContainEqual({ warning: 'year-zero', id: 's', what: 'born', text: '0' });
		// The tree list must show the same warning for the same person.
		const tree = g.issues.filter((i) => i.code === 'year-zero').map((i) => i.ids);
		expect(tree).toContainEqual(['s']);
	});

	it('F2: one date of one person gives one warning, also when two titles with rules reach the person', () => {
		const g = graphOf(`people:
  - {id: r, name: Rolf, sex: m, born: 1000}
  - {id: c, name: Cade, sex: m, born: "0", parents: [r]}
titles:
  - id: a
    name: Alpha
    succession: eldest-child
    year: "1100"
    holders:
      - {person: r}
  - id: b
    name: Beta
    succession: eldest-child
    year: "1100"
    holders:
      - {person: r}
`);
		expect(g.issues.filter((i) => i.code === 'year-zero')).toHaveLength(1);
	});

	it('F3: a title year that fits two calendars gives the warning fits-two-calendars and not also year-unreadable ("write the year as a number")', () => {
		const reader = compileCalendars([ALDRIC, copyOf(ALDRIC, 'Other.md', { kind: { type: 'eras', eras: [{ name: 'Aldric', start: 1200 }] } })], true);
		const g = graphOf(`people:
  - {id: r, name: Rolf, sex: m, born: 1000}
titles:
  - id: crown
    name: Crown
    succession: eldest-child
    year: "Aldric 10"
    holders:
      - {person: r}
`, reader);
		const codes = g.issues.map((i) => i.code);
		expect(codes).toContain('fits-two-calendars');
		expect(codes).not.toContain('year-unreadable');
	});
});
