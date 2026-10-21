import { describe, expect, it } from 'vitest';
import { CALENDAR_BLOCK_UI, CALENDAR_UI, CALENDAR_WINDOW_UI, DATE_READOUT_UI } from '../src/render/calendar-text';

/*
 * Step 4.3 of WP-4: the texts of the dates and calendars obey the owner's rules for plugin text (ASD-STE100): sentences of 20 words or fewer, no -ing word, no contraction, none of the words of the
 * word list that the owner forbids, and the words "Calendars", "Calendar note", "Same year as", "Start" and "Length (years)" where the brief asks for them.
 */

const sample = (table: Record<string, unknown>): string[] =>
	Object.values(table).flatMap((v) => {
		if (typeof v === 'string') return [v];
		if (typeof v !== 'function') return [];
		const out: string[] = [];
		for (const args of [['Aldric'], [130], [['One', 'Two']], ['Long Count', 'Cycle 3', 10, 130], [['A']], ['Cycle 3', 130], [''], ['x', 130]]) {
			try {
				const t = (v as (...a: unknown[]) => unknown)(...args);
				if (typeof t === 'string') out.push(t);
			} catch {
				/* this argument set does not fit */
			}
		}
		return out;
	});

const all = [CALENDAR_UI, CALENDAR_WINDOW_UI, DATE_READOUT_UI, CALENDAR_BLOCK_UI].flatMap(sample);

describe('the texts of dates and calendars', () => {
	it('has every table', () => {
		expect(all.length).toBeGreaterThan(80);
	});

	it('has no sentence of more than 20 words', () => {
		const sentences = all.flatMap((t) => t.split(/(?<=[.!?])\s+(?=[A-Z])/));
		for (const s of sentences) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(20);
	});

	it('has no -ing word, no contraction and no straight quote mark', () => {
		for (const t of all) {
			// The names a user typed ("Aldric", the words of an example format) are not plugin text.
			expect(t, t).not.toMatch(/\b[A-Za-z]{3,}ing\b/);
			expect(t, t).not.toMatch(/\b(don't|can't|isn't|doesn't|won't|it's)\b/i);
			expect(t, t).not.toMatch(/"/);
		}
	});

	it('uses none of the words that the owner word list forbids', () => {
		const banned = /\b(graph|diagram|chart|node|box|tile|union|edge|path|stroke|layer|rank|partition|file|document|commit|fixture|sprint|phase)\b/i;
		for (const t of all) expect(t, t).not.toMatch(banned);
	});

	it('uses the words of the brief', () => {
		expect(CALENDAR_UI.more).toBe('Calendars');
		expect(CALENDAR_UI.noteMore).toBe('Calendar note');
		expect(CALENDAR_WINDOW_UI.sameAsLabel).toBe('Same year as');
		expect(CALENDAR_WINDOW_UI.startLabel).toBe('Start');
		expect(CALENDAR_WINDOW_UI.lengthLabel).toBe('Length (years)');
		expect(CALENDAR_WINDOW_UI.newNote).toBe('New calendar note');
		expect(CALENDAR_WINDOW_UI.title).toBe('Calendars');
	});

	it('writes a year before year 1 with the minus sign of the grey line', () => {
		expect(DATE_READOUT_UI.match('A', 'Era', 3, -2)).toBe('A: Era, Year 3 = year −2');
	});

	it('names every screen-reader label of a control that shows a text with that text first (spec §7.5 R1)', () => {
		expect(CALENDAR_UI.moreLabel.startsWith(`${CALENDAR_UI.more}:`)).toBe(true);
		expect(CALENDAR_UI.noteMoreLabel.startsWith(`${CALENDAR_UI.noteMore}:`)).toBe(true);
		expect(CALENDAR_BLOCK_UI.editLabel('Count').startsWith(`${CALENDAR_BLOCK_UI.edit}`)).toBe(true);
		for (const label of [CALENDAR_UI.moreLabel, CALENDAR_UI.noteMoreLabel, CALENDAR_BLOCK_UI.editLabel('Count')]) expect(label.endsWith('.')).toBe(false);
	});
});
