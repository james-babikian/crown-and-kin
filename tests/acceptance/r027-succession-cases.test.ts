import { describe, expect, it } from 'vitest';
import { specOf } from '../../src/core/succession';
import { RUNS } from './r027-cases-data';
import { lineOfRun, successionCodes } from './r027-support';

/*
 * Version 0.2.7, WP2: the case table of the succession rules (an internal study,
 * S01 to S58; the 0.2.7 contract sections B, C and K; spec D170 to D188). Every run of the table is one test of
 * `successionLine(g, title, specOf(title), limit, oldAge)`: the tree text has the keys of the run on the
 * title, the expected line is the latest line of the table (`r027-cases-data.ts` explains the runs that a
 * later section of the table or the contract changed). The expected lines are written by hand from the
 * table; the engine is not run to make them. These tests wait for WP 2 (`src/core/succession.ts`).
 * Run: npx vitest run tests/acceptance/r027-succession-cases.test.ts
 */

describe('the case table: every run gives the line of the table', () => {
	for (const run of RUNS) {
		it(run.id, () => {
			const { g, title, result } = lineOfRun(run);
			const want = run.want;
			expect(result.kind).toBe(want.kind ?? 'line');
			expect(successionCodes(g)).toEqual(want.warns ?? []);
			if (want.bad !== undefined) expect(specOf(title).bad).toBe(want.bad);
			else expect(specOf(title).bad).toBeUndefined();
			if (result.kind !== 'line') return;
			expect(result.heirs).toEqual(want.heirs);
			expect(result.more).toBe(want.more ?? false);
			if (want.named) expect(result.namedHeirs.map((n) => [n.id, n.state])).toEqual(want.named);
			else expect(result.namedHeirs).toEqual([]);
			// The warning of contract B.4: only a run that says so has an heir older than 110 years with no death date.
			expect(result.old).toEqual(want.old ?? []);
		});
	}
});

describe('the case table: the run ids', () => {
	it('every run has its own id', () => {
		const ids = RUNS.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
