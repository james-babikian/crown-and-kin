// G2 review of step 4.2 of WP-4 (dates): two items of severity "note" (see the report). They are tests of gaps, not of crashes.
import { describe, expect, it } from 'vitest';
import { planWrite } from '../../src/core/block-write';
import { compileCalendars } from '../../src/core/dates';
import { specOf, successionLine } from '../../src/core/succession';
import { ALDRIC, graphOf } from '../dates-support';

const TREE = `people:
  - {id: r, name: Rolf, sex: m, born: 1000}
  - {id: a, name: Ann, sex: f, born: "Aldric 3", parents: [r]}
  - {id: b, name: Bob, sex: m, born: "Aldric 7", parents: [r]}
titles:
  - id: crown
    name: Crown
    succession: born-in-reign
    year: "Aldric 40"
    holders:
      - {person: r, from: "Aldric 1"}
`;

describe('review 4.2 (notes)', () => {
	it('N1: before the calendars are ready no note about a missing year shows (spec §14 rule 7: "no date note ... shows")', () => {
		const g = graphOf(TREE, compileCalendars([ALDRIC], false));
		const res = successionLine(g, g.titles[0], specOf(g.titles[0]), 5, 110);
		// The calendar dates read as "no year" here, which is not the user's fault; the same tree once ready has neither.
		expect(res.noBirthYear).toBe(0);
		expect(res.notes.map((n) => n.kind)).not.toContain('born-in-reign-no-from');
	});

	it('N2: the write plan can address a kin-calendar block (4.3 needs it; planWrite finds only kin blocks and src/core is closed in 4.3)', () => {
		const note = '```kin\npeople: []\n```\n\n```kin-calendar\ncalendars: []\n```\n';
		// `planWrite(text, ordinal, expectedBody, edit, language)` does not exist: ordinal 0 of kin-calendar is read as ordinal 0 of kin.
		const plan = (planWrite as unknown as (...a: unknown[]) => ReturnType<typeof planWrite>)(note, 0, 'calendars: []', (b: string) => ({ ok: true as const, body: `${b}\n# x` }), 'kin-calendar');
		expect(plan.ok).toBe(true);
	});
});
