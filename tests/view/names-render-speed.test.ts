import { describe, expect } from 'vitest';
import { compileCalendars, type Calendar, type NameList } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardLabel, dateLine } from '../../src/render/tree-info';
import { listData, listIds, listStart } from '../../src/view/phone-list';
import { fixtureNote, topLevelBlocks } from '../acceptance/load';
import { timedRatio } from '../support/speed-ref';
import { speedTest } from '../support/speed-test';

/*
 * Names contract §5 "Speed" (WP-6 step 2, spec §7.7 gate, one case): the phone list of the largest sample tree with 50 eras, against the same calendars with two name lists. A tree
 * draws the list from its graph: the derive reads the dates of the titles once, and each row reads its own dates (and, with a list, the born date too) through the memo of
 * the reader. Every round reads cold. The time is a ratio to a fixed piece of work timed in the same run (tests/support/speed-ref.ts), so a busy machine does not fail it. The numbers go to the report.
 */

/** Sample tree 7 (389 people) and 80 more people with dates in the eras, the cycles and plain years, so that the list has more than 400 people. */
const tree = (() => {
	const parsed = parseDynasty(topLevelBlocks(fixtureNote('07'))[0]);
	if (!parsed.ok) throw new Error('sample tree 7 does not parse');
	const extra = Array.from({ length: 80 }, (_, i) => ({
		...parsed.tree.people[0],
		id: `extra-${i}`,
		name: `Extra ${i}`,
		parents: [],
		born: i % 3 === 0 ? `Reign of King ${1 + (i % 50)} Year ${1 + (i % 19)}` : i % 3 === 1 ? `${1 + (i % 59)} Year of the ${1 + (i % 7)} Cycle` : String(1100 + i),
		died: i % 2 ? undefined : String(1200 + i),
		index: parsed.tree.people.length + i,
	}));
	return { ...parsed.tree, people: [...parsed.tree.people, ...extra] };
})();

const planets: NameList = { name: 'Planets', marker: 'planet', names: ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'].map((name) => ({ name, short: name.slice(0, 2) })), known: { year: 1273, index: 0 }, show: 'short' };
const animals: NameList = { name: 'Animals', marker: 'animal', names: ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'].map((name) => ({ name })), known: { year: 1000, index: 1 }, show: 'full' };

/** An era calendar with 50 eras, and a cycle calendar, as a user with a long history would write them; `lists` adds two name lists and their places. */
function manyEras(lists: boolean): Calendar[] {
	const eras = Array.from({ length: 50 }, (_, i) => ({ name: `Reign of King ${i + 1}`, start: 100 + i * 20, length: 20 }));
	const mark = (f: string) => (lists ? `${f} {planet} {animal}` : f);
	return [
		{ id: 'Calendars.md#0#0', name: 'Kings', note: 'Calendars.md', formats: ['{era} Year {year}', '{year}th year of {era}'].map(mark), kind: { type: 'eras', eras }, ...(lists ? { lists: [planets, animals] } : {}) },
		{ id: 'Calendars.md#0#1', name: 'Long Count', note: 'Calendars.md', formats: ['{year} Year of the {cycle} Cycle'].map(mark), kind: { type: 'cycles', length: 60, start: 1 }, ...(lists ? { lists: [planets, animals] } : {}) },
	];
}
/** The same two lists for the plain years: a plain-year list has no marker. */
const plainLists = (): NameList[] => [planets, animals].map(({ name, names, known, show }) => ({ name, names, known, show }));

/** What a phone list does with the dates of a tree: the derive, the start of the list, and the date line and the spoken label of every person (the list rows and the Find rows). */
function listJob(makeReader: () => ReturnType<typeof compileCalendars>) {
	return () => {
		// The reader is made inside the job, so that every round reads cold (no memo from an earlier round).
		const g = deriveFamilies(tree, { dates: makeReader() });
		const start = listStart({ session: null, pin: undefined, me: null, edited: null, g });
		const data = listData(g, start!.id);
		let lines = 0;
		let named = 0;
		for (const p of g.people) {
			const line = dateLine(p, g.dates);
			if (line) lines++;
			if (line !== dateLine(p, g.dates, { names: 'none' })) named++;
			cardLabel(p, undefined, undefined, undefined, g.dates);
		}
		return { rows: listIds(data).length, lines, named, people: g.people.length };
	};
}

describe('the phone list with 50 eras and two name lists', () => {
	speedTest('reads every date of the largest sample tree in at most about twice the time of the same calendars with no list (numbers in the message)', () => {
		const without = timedRatio(listJob(() => compileCalendars(manyEras(false), true)), 7);
		const marked = timedRatio(listJob(() => compileCalendars(manyEras(true), true)), 7);
		const plainToo = timedRatio(listJob(() => compileCalendars(manyEras(true), true, [], plainLists())), 7);
		expect(without.out.people).toBeGreaterThan(400);
		expect(marked.out.people).toBe(without.out.people);
		expect(marked.out.lines).toBe(without.out.lines);
		expect(plainToo.out.lines).toBe(without.out.lines);
		// With the plain-year lists the plain years of the tree get their names: this is the work that is new.
		expect(plainToo.out.named).toBeGreaterThan(0);
		const report = `people ${without.out.people}; no list ${without.ms.toFixed(1)} ms; two lists in the calendars ${marked.ms.toFixed(1)} ms; and two plain-year lists (${plainToo.out.named} dates with a name) ${plainToo.ms.toFixed(1)} ms; reference ${without.refMs.toFixed(1)} ms`;
		process.stderr.write(`names speed: ${report}\n`);
		expect(marked.ratio, report).toBeLessThan(Math.max(without.ratio * 2, 0.8));
		expect(plainToo.ratio, report).toBeLessThan(Math.max(without.ratio * 3, 1.2));
	});
});
