// Step 4.3 of WP-4 (spec §14 rule 2): the section "The calendar note" of docs/format.md lists the keys of the `kin-calendar` block, in the write order of the code, and its example
// block is a block that the plugin reads without a problem.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findBlocks } from '../src/core/block-locate';
import { CALENDAR_ORDER, ERA_ORDER, parseCalendarBlock } from '../src/core/calendar-block';
import { CALENDAR_KEYS } from '../scripts/format/calendar-doc';

describe('the calendar note in docs/format.md', () => {
	it('lists every key of a calendar and of an era, in the write order of the code', () => {
		expect(CALENDAR_KEYS.filter((k) => k.scope === 'calendar').map((k) => k.key)).toEqual(CALENDAR_ORDER);
		expect(CALENDAR_KEYS.filter((k) => k.scope === 'era').map((k) => k.key)).toEqual(ERA_ORDER);
	});

	it('has the section, and an example block that the plugin reads with two calendars and no issue', () => {
		const doc = readFileSync('docs/format.md', 'utf8').replace(/\r\n/g, '\n');
		expect(doc).toContain('## The calendar note');
		const block = findBlocks(doc, 'kin-calendar')[0];
		const read = parseCalendarBlock(block.body, 'Calendars.md', 0);
		expect(read.issues).toEqual([]);
		expect(read.calendars.map((c) => c.name)).toEqual(['The Long Count', 'Reign names']);
	});

	it('names the calendar option and the limit of older versions', () => {
		const doc = readFileSync('docs/format.md', 'utf8');
		expect(doc).toContain('`calendar` in `options`');
		expect(doc).toContain('Third Age 3019');
	});
});
