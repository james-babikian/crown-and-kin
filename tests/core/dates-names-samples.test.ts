// Names contract §5 (WP-6 step 1): no list captures an existing date. Every date text of every sample tree reads the same year with a full
// set of calendars and name lists loaded as it does with the calendars alone.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileCalendars, type Calendar, type NameList } from '../../src/core/dates';
import { parseDynasty } from '../../src/core/parse';
import { FULL_SET, type CalendarDef } from '../dates-support';
import { PLANETS } from '../dates-support/names';

const planets = (marker?: string): NameList => ({ name: 'Planets', ...(marker ? { marker } : {}), names: PLANETS, known: { year: 1273, index: 0 }, show: 'short' });
const animals = (marker?: string): NameList => ({ name: 'Animals', ...(marker ? { marker } : {}), names: [{ name: 'Rat' }, { name: 'Ox' }, { name: 'Dog', short: 'Do' }], known: { year: 1000, index: 1 }, show: 'full' });

/** The full set, each format with a group for each of two lists added at the end. */
const WITH_LISTS: Calendar[] = (FULL_SET as CalendarDef[]).map((c) => ({ ...c, formats: c.formats.map((f) => `${f} {planet} {animal}`), lists: [planets('planet'), animals('animal')] }) as Calendar);

describe('the sample trees with name lists loaded', () => {
	const texts: { file: string; text: string }[] = [];
	for (const file of readdirSync('fixtures').filter((f) => f.endsWith('.md'))) {
		for (const m of readFileSync(`fixtures/${file}`, 'utf8').matchAll(/^```kin\r?\n([\s\S]*?)^```/gm)) {
			const parsed = parseDynasty(m[1]);
			if (!parsed.ok) continue;
			const tree = parsed.tree;
			for (const t of [...tree.people.flatMap((p) => [p.born, p.died]), ...(tree.titles ?? []).flatMap((title) => [title.year, ...title.holders.flatMap((h) => [h.from, h.to])])]) if (t !== undefined) texts.push({ file, text: t });
		}
	}

	it('there are many date texts', () => {
		expect(texts.length).toBeGreaterThan(300);
	});

	it('reads the same year, flags and source as the calendars alone, and no wrong name', () => {
		const alone = compileCalendars(FULL_SET as Calendar[], true);
		const lists = compileCalendars(WITH_LISTS, true, [], [planets(), animals()]);
		expect(lists.hasLists).toBe(true);
		let named = 0;
		for (const { file, text } of texts) {
			const a = alone.read(text)!;
			const b = lists.read(text)!;
			expect(b.year, `${file} ${text}`).toBe(a.year);
			expect({ ...b, names: undefined, whole: undefined, warnings: undefined }).toEqual({ ...a, names: undefined, whole: undefined, warnings: undefined });
			expect(b.warnings.filter((w) => w !== 'calendar-name-mismatch'), `${file} ${text}`).toEqual(a.warnings);
			// No sample text writes a name, so none can be wrong.
			expect(b.warnings.includes('calendar-name-mismatch'), `${file} ${text}`).toBe(false);
			if (b.names) named++;
		}
		// The plain years of the samples are whole texts: they get names.
		expect(named).toBeGreaterThan(100);
	});
});
