import { describe, expect, it } from 'vitest';
import { compileCalendars } from '../../src/core/dates';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { cardLabels } from '../../src/core/titles';
import { fitCardText } from '../../src/render/date-fit';
import { marksForSvg } from '../../src/render/date-bidi';
import { cardNameLines, isolateLines, runsText, titleLines } from '../../src/render/name-lines';
import { dateLineShown, reignShown, shownReignIsolated } from '../../src/render/tree-info';
import { list } from '../dates-support/names';
import { build } from '../support/helpers';
import { visual } from './bidi-reference';

/*
 * Dates on a card (SVG text). WebKit ignores a first-strong isolate in an SVG text (seen on an iPhone: "حوالي 1108–1170" drew "1170–1108 حوالي"), so the card and the
 * saved picture write left-to-right marks (U+200E) instead (`marksForSvg`). The proof is the reference bidi algorithm (`visual`), run on the text as drawn, and
 * again with U+2066 to U+2069 taken out: a card text holds no isolate, so both runs must give the same picture. All people are made up.
 */

const LRM = String.fromCharCode(0x200e);
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
const ISOLATES = /[⁦-⁩]/g;
const shownLtr = (word: string) => [...word].reverse().join('');
const ARABIC = 'حوالي 1108';
const ARABIC_SEEN = `1108 ${shownLtr('حوالي')}`;
const HEBREW = 'בערך 1105';
const HEBREW_SEEN = `1105 ${shownLtr('בערך')}`;

/** What the eye sees for a card text: the same with an isolate-aware and an isolate-blind engine. */
function seen(text: string): string {
	const withSupport = visual(text, 0);
	expect(visual(text.replace(ISOLATES, ''), 0), JSON.stringify(text)).toBe(withSupport);
	return withSupport;
}

const TREE = `
titles:
  - id: qadi
    name: Qadi
    holders:
      - {person: a, from: "${ARABIC}", to: 1170}
people:
  - {id: a, name: Ann, born: "${ARABIC}", died: 1170}
  - {id: b, name: Bo, born: "${HEBREW}", died: 1170}
  - {id: c, name: Cy, born: "١٠٠٠", died: "١٠٧٤"}
  - {id: d, name: Di, born: 1100, died: "${ARABIC}"}
  - {id: e, name: Ed, born: "${ARABIC}", died: "${HEBREW}"}
  - {id: f, name: Fay, born: "${ARABIC}"}
  - {id: h, name: Hal, died: "${HEBREW}"}
  - {id: i, name: Ida, born: "${ARABIC}", died: yes}
  - {id: j, name: Jo, born: 1100, died: 1170}
`;
const { g } = build(TREE);
const card = (id: string) => marksForSvg(dateLineShown(g.byId.get(id)!, g.dates), true)!;

describe('marksForSvg', () => {
	it('turns each isolate end into a mark and keeps a Latin text byte for byte', () => {
		expect(marksForSvg(`${FSI}${ARABIC}${PDI}–1170`)).toBe(`${LRM}${ARABIC}${LRM}–1170`);
		expect(marksForSvg(`b. ${FSI}${ARABIC}${PDI}`)).toBe(`b. ${LRM}${ARABIC}${LRM}`);
		expect(marksForSvg(`${FSI}a${PDI}${FSI}b${PDI}`)).toBe(`${LRM}a${LRM}b${LRM}`);
		expect(marksForSvg('1100–1170', true)).toBe('1100–1170');
		expect(marksForSvg(undefined)).toBeUndefined();
	});

	it('puts a mark at the start and at the end of a whole line, and not twice', () => {
		expect(marksForSvg(`b. ${FSI}${ARABIC}${PDI}`, true)).toBe(`${LRM}b. ${LRM}${ARABIC}${LRM}`);
		expect(marksForSvg(`${FSI}${ARABIC}${PDI}`, true)).toBe(`${LRM}${ARABIC}${LRM}`);
	});

	it('the card dates line has a mark on each side of every part', () => {
		expect(card('a')).toBe(`${LRM}${ARABIC}${LRM}–1170${LRM}`);
		expect(card('d')).toBe(`${LRM}1100–${LRM}${ARABIC}${LRM}`);
		expect(card('f')).toBe(`${LRM}b. ${LRM}${ARABIC}${LRM}`);
		expect(card('j')).toBe('1100–1170');
	});
});

describe('the dates line of a card reads in the written order, with and without isolate support', () => {
	it('an Arabic word and years', () => {
		expect(seen(card('a'))).toBe(`${ARABIC_SEEN}–1170`);
	});

	it('a Hebrew word and years', () => {
		expect(seen(card('b'))).toBe(`${HEBREW_SEEN}–1170`);
	});

	it('a range of Arabic-Indic digits', () => {
		expect(seen(card('c'))).toBe('١٠٠٠–١٠٧٤');
	});

	it('Latin years first, an Arabic date last', () => {
		expect(seen(card('d'))).toBe(`1100–${ARABIC_SEEN}`);
	});

	it('an Arabic date and a Hebrew date', () => {
		expect(seen(card('e'))).toBe(`${ARABIC_SEEN}–${HEBREW_SEEN}`);
	});

	it('"b. ", "d. " and the sign', () => {
		expect(seen(card('f'))).toBe(`b. ${ARABIC_SEEN}`);
		expect(seen(card('h'))).toBe(`d. ${HEBREW_SEEN}`);
		expect(seen(card('i'))).toBe(`b. ${ARABIC_SEEN} †`);
	});

	it('the plain isolate-blind text of the same line would read backwards (the fault of the iPhone)', () => {
		const blind = visual(`${FSI}${ARABIC}${PDI}–1170`.replace(ISOLATES, ''), 0);
		expect(blind.startsWith('1170')).toBe(true);
		const digits = visual('١٠٠٠–١٠٧٤', 0);
		expect(digits).toBe('١٠٧٤–١٠٠٠');
	});
});

describe('the reign of a card', () => {
	const label = cardLabels(g).get('a')!;

	it('reads in the written order', () => {
		const reign = marksForSvg(shownReignIsolated(label, g.dates, 'shown'))!;
		expect(seen(reign)).toBe(`(r. ${ARABIC_SEEN}–1170)`);
		expect(marksForSvg(reignShown(label, label.reign, g.dates, 'none'))).toBe(`(r. ${LRM}${ARABIC}${LRM}–1170)`);
	});

	it('reads in the written order with the names of the years of a calendar', () => {
		const parsed = parseDynasty(`titles:
  - {id: t, name: Qadi, holders: [{person: a, from: 1273, to: 1280}, {person: b, from: 1290}]}
people:
  - {id: a, name: Ann, born: 1273, died: 1280}
  - {id: b, name: Bo, born: 1290}
`);
		if (!parsed.ok) throw new Error('bad tree');
		const names = list({ names: [{ name: 'الجمل', short: 'جمل' }, { name: 'الثور', short: 'ثور' }], show: 'short' });
		const named = deriveFamilies(parsed.tree, { dates: compileCalendars([], true, [], [names]) });
		const lab = cardLabels(named).get('a')!;
		const reign = marksForSvg(shownReignIsolated(lab, named.dates, 'shown'))!;
		expect(reign).toContain(LRM);
		expect(/[⁦-⁩]/.test(reign)).toBe(false);
		const v = seen(reign);
		expect(v.indexOf('1273')).toBeGreaterThan(-1);
		expect(v.indexOf('1273')).toBeLessThan(v.indexOf('1280'));
		expect(v.indexOf(shownLtr('جمل'))).toBeLessThan(v.indexOf('1280'));
		const dateLine = marksForSvg(dateLineShown(named.byId.get('a')!, named.dates), true)!;
		expect(seen(dateLine).startsWith('1273')).toBe(true);
	});
});

describe('a cut or broken card text', () => {
	const per = (s: string) => [...s.replace(/[‎⁦-⁩]/g, '')].length * 6;

	it('a dates line cut inside the Arabic date keeps the order and ends with the ellipsis', () => {
		const text = card('a');
		for (let room = 3; room < 8; room++) {
			const cut = fitCardText(text, undefined, room * 6, per, false);
			expect(cut.endsWith('…'), JSON.stringify(cut)).toBe(true);
			expect(/[⁦-⁩]/.test(cut)).toBe(false);
			seen(cut);
		}
		const cut = fitCardText(text, undefined, per(`${ARABIC}–11…`), per, false);
		expect(seen(cut)).toBe(`${ARABIC_SEEN}–11…`);
	});

	it('a title broken inside the date: every text line reads in order and holds no isolate', () => {
		const label = cardLabels(g).get('a')!;
		const reign = marksForSvg(shownReignIsolated(label, g.dates, 'shown'))!;
		for (const width of [100, 130]) {
			const lines = titleLines('Qadi', reign, width, per);
			expect(lines.length).toBeGreaterThan(1);
			for (const l of lines) {
				expect(/[⁦-⁩]/.test(l), JSON.stringify(lines)).toBe(false);
				seen(l);
			}
			expect(lines.join(' ').replace(/‎/g, '')).toBe(`Qadi ${reign.replace(/‎/g, '')}`);
		}
		const two = titleLines('Qadi', reign, 100, per);
		const second = seen(two[1]);
		expect(second.indexOf('1108') < second.indexOf('1170') || !second.includes('1108')).toBe(true);
	});
});

describe('the name lines of a card with and without isolate support', () => {
	const blind = (s: string) => s.replace(ISOLATES, '');
	const measure = (s: string) => [...s.replace(/[‎⁦-⁩]/g, '')].length * 8;
	const picture = (name: string, room: number) => {
		const lines = isolateLines(cardNameLines(name, undefined, room, measure, 3, undefined)).map(runsText);
		return { withSupport: lines.map((l) => visual(l, 0)), blind: lines.map((l) => visual(blind(l), 0)) };
	};

	it('a name in one script reads the same without the isolate, on one line and on wrapped lines', () => {
		for (const name of ['يوسف الحداد', 'דוד לוי', 'Avi אבי Cohen', 'Layla ليلى']) {
			for (const room of [1000, 70]) {
				const p = picture(name, room);
				expect(p.blind, `${name} ${room}`).toEqual(p.withSupport);
			}
		}
	});

	it('the zero-width mark has no width for the card measure', () => {
		expect(measure(`${LRM}1108${LRM}`)).toBe(measure('1108'));
	});
});
