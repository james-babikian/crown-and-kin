import { describe, expect } from 'vitest';
import { speedTest } from '../support/speed-test';
import { compileCalendars, type Calendar } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { dateLine } from '../../src/render/tree-info';
import { checkDraft, newCalendar } from '../../src/view/calendar-draft';
import { listData, listIds, listStart } from '../../src/view/phone-list';
import { fixtureNote, topLevelBlocks } from '../acceptance/load';
import { timedRatio } from '../support/speed-ref';

/*
 * Step 4.3 of WP-4 (spec §14 rule 11, rule 9 "memo"): the phone list of the largest sample tree with a calendar set of 50 eras. A tree draws the list from its graph: the derive reads the
 * dates of the titles once, and each row reads its own dates through the memo of the reader. The time is a ratio to a fixed piece of work timed in the same run (tests/support/speed-ref.ts),
 * so a busy machine does not fail it; the limit catches a real slowdown (many times the plain reader), not noise.
 */

const tree = (() => {
	const parsed = parseDynasty(topLevelBlocks(fixtureNote('07'))[0]);
	if (!parsed.ok) throw new Error('sample tree 7 does not parse');
	return parsed.tree;
})();

/** An era calendar with 50 eras, and a cycle calendar, as a user with a long history would write them. */
function manyEras(): Calendar[] {
	const eras = Array.from({ length: 50 }, (_, i) => ({ name: `Reign of King ${i + 1}`, start: 100 + i * 20, length: 20 }));
	return [
		{ id: 'Calendars.md#0#0', name: 'Kings', note: 'Calendars.md', formats: ['{era} Year {year}', '{year}th year of {era}'], kind: { type: 'eras', eras } },
		{ id: 'Calendars.md#0#1', name: 'Long Count', note: 'Calendars.md', formats: ['{year} Year of the {cycle} Cycle'], kind: { type: 'cycles', length: 60, start: 1 } },
	];
}

/** What a phone list does with the dates of a tree: the derive, the start of the list and the date line of every row of the list and of the whole tree. */
function listJob(reader: ReturnType<typeof compileCalendars>) {
	return () => {
		const g = deriveFamilies(tree, { dates: reader });
		const start = listStart({ session: null, pin: undefined, me: null, edited: null, g });
		const data = listData(g, start!.id);
		let lines = 0;
		for (const p of g.people) if (dateLine(p, g.dates)) lines++;
		return { rows: listIds(data).length, lines, people: g.people.length };
	};
}

describe('the phone list with 50 eras', () => {
	speedTest('reads every date of the largest sample tree in at most about four times the time of the plain reader', () => {
		const plain = timedRatio(listJob(compileCalendars([], true)), 5);
		const many = timedRatio(listJob(compileCalendars(manyEras(), true)), 5);
		expect(many.out.people).toBe(plain.out.people);
		expect(many.out.lines).toBe(plain.out.lines);
		// A date that fits no format is tried against 100 formats once, and then comes from the memo.
		expect(many.ratio, `plain ${plain.ms.toFixed(1)} ms, with 50 eras ${many.ms.toFixed(1)} ms, reference ${many.refMs.toFixed(1)} ms`).toBeLessThan(Math.max(plain.ratio * 4, 0.8));
	});

	speedTest('the second read of the same tree comes from the memo and is not slower than the first', () => {
		const reader = compileCalendars(manyEras(), true);
		const job = listJob(reader);
		const first = timedRatio(job, 1);
		const second = timedRatio(job, 3);
		expect(second.ratio).toBeLessThanOrEqual(first.ratio * 1.5 + 0.05);
	});
});

/** The text lines of 20 000 characters that cost the most for the search of the last comma: many commas, many "to", and one comma with a long text after it. */
const LONG_LINES = ['a,'.repeat(10_000), ', to '.repeat(4_000), `Name, ${'x to '.repeat(4_000)}`, `${'Reign of Aldric '.repeat(1_250)}, 1100`];

describe('a very long text line in the eras box (D342)', () => {
	speedTest('reads four text lines of 20 000 characters in about the time of the reference work, not one reading for each comma', () => {
		let n = 0;
		const job = () => {
			const d = Object.assign(newCalendar('eras', () => n++), { name: 'Reigns', formats: '{era} {year}', erasText: LONG_LINES.join('\n') });
			return checkDraft([d], 'Calendars.md');
		};
		const r = timedRatio(job, 5);
		expect(r.out.calendars[0].kind).toEqual({ type: 'eras', eras: [{ name: 'Reign of Aldric '.repeat(1_250).trim(), start: 1100 }] });
		// Measured: 0.5 to 0.8 of the reference. With one reading for each comma, the first text line alone took about 20 times the reference.
		expect(r.ratio, `${r.ms.toFixed(1)} ms, reference ${r.refMs.toFixed(1)} ms`).toBeLessThan(1);
	});
});
