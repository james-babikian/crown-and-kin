// Step 4.2 of WP-4 (the architecture notes §5.7): the fence language is a parameter of `findBlocks`, `ordinalForSection` and the block numbering
// (`kin` by default, `kin-calendar` for a calendar note), and `core/note-make.ts` chooses the unique path of the note that the Calendars window makes.
import { describe, expect, it } from 'vitest';
import { CALENDAR_LANGUAGE, KIN_LANGUAGE, findBlocks, ordinalForSection, replaceBody } from '../src/core/block-locate';
import { calendarNotePath, uniqueNotePath } from '../src/core/note-make';

const NOTE = ['intro', '```kin', 'a: 1', '```', '```kin-calendar', 'calendars: []', '```', '```kin', 'b: 2', '```', '```kin-calendar extra words', 'calendars:', '  - name: X', '```', ''].join('\n');

describe('findBlocks: the language of the fence', () => {
	it('is kin by default, and a kin-calendar block is no kin block', () => {
		expect(findBlocks(NOTE).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
		expect(findBlocks(NOTE, KIN_LANGUAGE).map((b) => b.ordinal)).toEqual([0, 1]);
	});

	it('finds the kin-calendar blocks, numbered for their own language', () => {
		const blocks = findBlocks(NOTE, CALENDAR_LANGUAGE);
		expect(blocks.map((b) => [b.ordinal, b.body])).toEqual([
			[0, 'calendars: []'],
			[1, 'calendars:\n  - name: X'],
		]);
		expect(blocks[1].openLine).toBe(10);
	});

	it('takes the first word of the info string, case-sensitive, and does not read a longer name as the shorter one', () => {
		expect(findBlocks('```kin-calendar\na: 1\n```')).toEqual([]);
		expect(findBlocks('```kin\na: 1\n```', CALENDAR_LANGUAGE)).toEqual([]);
		expect(findBlocks('```Kin-Calendar\na: 1\n```', CALENDAR_LANGUAGE)).toEqual([]);
		expect(findBlocks('```kin-calendars\na: 1\n```', CALENDAR_LANGUAGE)).toEqual([]);
	});

	it('a calendar block inside a longer fence is content, as a kin block is', () => {
		expect(findBlocks('````md\n```kin-calendar\ncalendars: []\n```\n````', CALENDAR_LANGUAGE)).toEqual([]);
	});

	it('replaceBody writes a calendar block back and leaves the rest of the note as it was', () => {
		const block = findBlocks(NOTE, CALENDAR_LANGUAGE)[0];
		const text = replaceBody(NOTE, block, 'calendars:\n  - name: Y');
		expect(text).toBe(NOTE.replace('calendars: []', 'calendars:\n  - name: Y'));
		expect(findBlocks(text).map((b) => b.body)).toEqual(['a: 1', 'b: 2']);
	});
});

describe('ordinalForSection: the language of the fence', () => {
	it('gives the number among the blocks of the asked language', () => {
		// The second calendar block opens on line 10.
		expect(ordinalForSection(NOTE, 10, 13, 'calendars:\n  - name: X', CALENDAR_LANGUAGE)).toBe(1);
		expect(ordinalForSection(NOTE, 1, 3, 'a: 1')).toBe(0);
		expect(ordinalForSection(NOTE, 7, 9, 'b: 2')).toBe(1);
		expect(ordinalForSection(NOTE, 4, 6, 'calendars: []')).toBeNull();
	});
});

describe('uniqueNotePath and calendarNotePath', () => {
	const taken = (...paths: string[]) => (path: string) => paths.includes(path);

	it('the first calendar note is Calendars.md at the root of the vault', () => {
		expect(calendarNotePath(taken())).toBe('Calendars.md');
	});

	it('a taken name gets 1, then 2 and so on', () => {
		expect(calendarNotePath(taken('Calendars.md'))).toBe('Calendars 1.md');
		expect(calendarNotePath(taken('Calendars.md', 'Calendars 1.md'))).toBe('Calendars 2.md');
		expect(calendarNotePath(taken('Calendars.md', 'Calendars 2.md'))).toBe('Calendars 1.md');
	});

	it('takes a folder, and the caller decides how a name is compared (a vault ignores case)', () => {
		expect(uniqueNotePath('Eras', taken('Far Land/Eras.md'), 'Far Land')).toBe('Far Land/Eras 1.md');
		const ignoreCase = (path: string) => path.toLowerCase() === 'calendars.md';
		expect(calendarNotePath(ignoreCase)).toBe('Calendars 1.md');
	});

	it('does not loop for ever when every path is taken', () => {
		expect(calendarNotePath(() => true)).toMatch(/^Calendars \d+\.md$/);
	});
});
