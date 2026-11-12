// The "insert at a place" form of `add-era` (D342): the Calendars window puts an era that the user types between two text lines at that place in the note.
// The other eras keep their bytes and their comments; the data check refuses any other difference, as for every edit of the block.
import { describe, expect, it } from 'vitest';
import { editCalendarBlock, parseCalendarBlock, type CalendarOp } from '../../src/core/calendar-block';
import { commentsOf } from '../../src/core/yaml-patch';

const ok = (body: string, op: CalendarOp): string => {
	const r = editCalendarBlock(body, op);
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}\n${body}`);
	return r.body;
};
const names = (body: string, cal = 0) => {
	const k = parseCalendarBlock(body, 'Calendars.md', 0).calendars[cal].kind;
	return k.type === 'eras' ? k.eras.map((e) => e.name) : [];
};
const comments = (body: string) => commentsOf(body).map((c) => c.text);
const add = (body: string, at: number | undefined, name = 'New', start = 1120): string => ok(body, { kind: 'add-era', calendar: 0, era: { name, start }, ...(at === undefined ? {} : { at }) });

const ONE_LINE = `calendars:
  - name: Reigns
    kind: eras
    formats: ["{era} {year}"]
    eras:
      # the first king
      - {name: Aldric, start: 1100}  # crowned young
      # the second king
      - {name: Bran, start: 1140, length: 20}
      - {name: Cara, start: 1170}
`;

const BLOCK = `calendars:
  - name: Reigns
    kind: eras
    formats: ["{era} {year}"]
    eras:
      - name: Aldric
        start: 1100 # crowned young
      -   name: Bran
          start: 1140
`;

const FLOW = `calendars:
  - {name: Reigns, kind: eras, formats: ["{era} {year}"], eras: [{name: Aldric, start: 1100}, {name: Bran, start: 1140}]} # two kings
`;

describe('add-era with a place: the new era goes in front of the era at that place', () => {
	it('in a list of one-line eras: in front of the comment lines that the era at the place owns, every other text line as written', () => {
		const body = add(ONE_LINE, 1);
		expect(names(body)).toEqual(['Aldric', 'New', 'Bran', 'Cara']);
		expect(body).toBe(ONE_LINE.replace('      # the second king\n', '      - {name: New, start: 1120}\n      # the second king\n'));
		expect(comments(body)).toEqual(comments(ONE_LINE));
	});

	it('at place 0 the new era is the first; the comment of the first king stays above Aldric', () => {
		const body = add(ONE_LINE, 0);
		expect(names(body)).toEqual(['New', 'Aldric', 'Bran', 'Cara']);
		expect(body).toBe(ONE_LINE.replace('      # the first king\n', '      - {name: New, start: 1120}\n      # the first king\n'));
	});

	it('in a list of block-map eras, at the column of the keys of the era at the place', () => {
		const body = add(BLOCK, 1);
		expect(names(body)).toEqual(['Aldric', 'New', 'Bran']);
		expect(body).toBe(BLOCK.replace('      -   name: Bran', '      -   {name: New, start: 1120}\n      -   name: Bran'));
		expect(comments(body)).toEqual(comments(BLOCK));
	});

	it('in a flow list, as an entry in front of the era at the place', () => {
		const body = add(FLOW, 1);
		expect(names(body)).toEqual(['Aldric', 'New', 'Bran']);
		expect(body).toBe(FLOW.replace('{name: Bran', '{name: New, start: 1120}, {name: Bran'));
	});

	it('a place at or past the end, or no place, appends the era as before', () => {
		const end = add(ONE_LINE, undefined);
		expect(add(ONE_LINE, 3)).toBe(end);
		expect(add(ONE_LINE, 99)).toBe(end);
		expect(names(end)).toEqual(['Aldric', 'Bran', 'Cara', 'New']);
	});

	it('refuses a place that is not a whole number from 0, and never throws', () => {
		for (const at of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(editCalendarBlock(ONE_LINE, { kind: 'add-era', calendar: 0, era: { name: 'X', start: 1 }, at }).ok, String(at)).toBe(false);
	});

	it('keeps an era with an anchor and the alias of another calendar to it as they were', () => {
		const shared = `calendars:
  - name: Reigns
    kind: eras
    formats: ["{era} {year}"]
    eras:
      - &first {name: Aldric, start: 1100}
      - {name: Bran, start: 1140}
  - name: Copy
    kind: eras
    formats: ["{era}: {year}"]
    eras: [*first]
`;
		const body = add(shared, 1);
		expect(names(body)).toEqual(['Aldric', 'New', 'Bran']);
		expect(names(body, 1)).toEqual(['Aldric']);
	});
});
