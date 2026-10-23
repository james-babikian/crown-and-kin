// Step 4.2 of WP-4 (the architecture notes §5.7): the line of succession, the tree warning list, the cards and the
// phone list read their dates through the reader of the tree. These tests add to `tests/render/dates-line.test.ts` (step 4.0): the year text as written
// (a title `year: 0` and `year: 1700/01`, the vet's item 1), the notes `died-no-year` (at most one for a person, the cap), the date warnings
// of a draft view, the tree warning list (scope and shape), and the places that draw a date (the scene, the saved picture, the Show view).
import { describe, expect, it } from 'vitest';
import { buildTreeDates, compileCalendars, PLAIN_READER, type TreeDates } from '../../src/core/dates';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { issueText } from '../../src/core/messages';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../../src/core/succession';
import type { Title } from '../../src/core/types';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { buildScene } from '../../src/render/dom/scene';
import { SUCCESSION_UI } from '../../src/render/succession-text';
import { renderSvg } from '../../src/render/svg-string';
import { oldestParent } from '../../src/view/phone-list';
import { successionDrawn } from '../../src/view/succession-view';
import { FEl } from '../acceptance/fake-dom';
import { ALDRIC, LONG_COUNT, REIGN_NAMES, graphOf, issueCodes, lineOf, notesOf, warningsOf } from '../dates-support';
import { useFakeDom } from '../support/fake-dom-setup';

/** A title tree: Rolf rules, Cade is his child. `extra` adds people and `title` the keys of the title. */
function tree(opts: { people?: string; title?: string; holder?: string; rule?: string } = {}): string {
	return `people:
  - {id: r, name: Rolf, sex: m}
${opts.people ?? '  - {id: c, name: Cade, sex: m, born: 1020, parents: [r]}\n'}
titles:
  - id: crown
    name: Crown
${opts.rule ?? '    succession: eldest-child\n'}${opts.title ?? '    year: "1109"\n'}    holders:
      - ${opts.holder ?? '{person: r}'}
`;
}

describe('the year text of the line, as written (vet item 1; spec §14 rule 7)', () => {
	it('a title year 0 gives Y = 0 and the text "0", not "1 BC"', () => {
		const res = lineOf(tree({ title: '    year: "0"\n' }));
		expect(res.year).toBe(0);
		expect(res.yearText).toBe('0');
		expect(SUCCESSION_UI.lineAfter('Rolf', res.yearText)).toBe('After Rolf in 0');
		expect(SUCCESSION_UI.bar('Crown', res.yearText)).toBe('Line of succession: Crown, 0');
		expect(SUCCESSION_UI.noRuler(res.yearText)).toBe('The title has no holder in 0, so there is no line of succession.');
	});

	it('a title year 1700/01 gives Y = 1701 and the text "1700/01"', () => {
		const res = lineOf(tree({ title: '    year: "1700/01"\n' }));
		expect(res.year).toBe(1701);
		expect(res.yearText).toBe('1700/01');
		expect(SUCCESSION_UI.lineAfter('Rolf', res.yearText)).toBe('After Rolf in 1700/01');
		expect(SUCCESSION_UI.coRulers(2, 'Rolf', res.yearText)).toBe('2 holders rule in 1700/01. The line is after Rolf.');
	});

	it('every sentence that names YEAR says the text as written; a number still shows with formatYear until step 4.3', () => {
		const t = 'Aldric 10';
		expect(SUCCESSION_UI.heirNotAlive('Ann', t)).toBe('Ann is not alive in Aldric 10, so the plugin does not use Ann as a named heir.');
		expect(SUCCESSION_UI.heirNotBorn('Ann', t)).toBe('Ann is not born yet in Aldric 10, so the plugin does not use Ann as a named heir.');
		expect(SUCCESSION_UI.old('Ann', 110, t)).toBe('Ann is older than 110 years in Aldric 10. If Ann is dead, add a death date.');
		expect(SUCCESSION_UI.rulerNotInTree(t)).toBe('The holder of the title in Aldric 10 is not in the tree. The plugin cannot show the line of succession.');
		expect(SUCCESSION_UI.barNoHeir('Crown', t)).toBe('Line of succession: Crown, Aldric 10. No heir in the tree.');
		expect(SUCCESSION_UI.bar('Crown', -199)).toBe('Line of succession: Crown, 200 BC');
		expect(SUCCESSION_UI.bar('Crown', null)).toBe('Line of succession: Crown, now');
	});

	it('the Show view bar names the text that gives Y, with a calendar and with a plain year', () => {
		const settings = { limit: 5, oldAge: 110, youngDeathAge: 0 };
		const withCalendar = graphOf(tree({ title: '    year: "Aldric 10"\n' }), compileCalendars([ALDRIC], true));
		expect(successionDrawn(withCalendar, 'crown', settings)?.sentence).toBe('Line of succession: Crown, Aldric 10');
		const plain = graphOf(tree({ title: '    year: "c. 1109"\n' }));
		expect(successionDrawn(plain, 'crown', settings)?.sentence).toBe('Line of succession: Crown, c. 1109');
		const zero = graphOf(tree({ people: '  - {id: c, name: Cade, sex: m, born: -50, parents: [r]}\n', title: '    year: "0"\n' }));
		expect(successionDrawn(zero, 'crown', settings)?.sentence).toBe('Line of succession: Crown, 0');
	});

	it('the year text is trimmed, and "now" has none for every kind of result', () => {
		expect(lineOf(tree({ title: '    year: " 1210 "\n' })).yearText).toBe('1210');
		expect(lineOf(tree({ title: '' })).yearText).toBeNull();
		expect(lineOf(tree({ rule: '', title: '' })).yearText).toBeNull();
	});

	it('a result with no ruler or a ruler outside the tree keeps the text', () => {
		expect(lineOf(tree({ title: '    year: "1000"\n', holder: '{person: r, from: 1050}' })).yearText).toBe('1000');
		expect(lineOf(tree({ title: '    year: "1100"\n', holder: '{name: Somebody}' }))).toMatchObject({ kind: 'ruler-not-in-tree', yearText: '1100' });
	});
});

describe('the note died-no-year (spec §14 rule 5; the architecture notes §5.7)', () => {
	const DEAD = (id: string, extra = '') => `  - {id: ${id}, name: ${id.toUpperCase()}, sex: f, born: 1060, died: "fell in the war", parents: [r]${extra}}\n`;

	it('its text names the person and the text that gives Y', () => {
		expect(SUCCESSION_UI.diedNoYear('Cora', 'c. 1109')).toBe('The plugin cannot read a year in the death date of Cora. So in this line, it counts Cora as dead in c. 1109. To change this, write a year in the death date.');
	});

	it('a person who is reached, named as an heir and an open-branch row gets one note', () => {
		const src = tree({
			people: DEAD('c1') + '  - {id: c2, name: Cade, sex: m, born: 1070, parents: [r]}\n',
			title: '    year: "1109"\n    heir: [c1]\n    inherit: men-only\n    inherit-through: anyone\n',
		});
		const res = lineOf(src);
		expect(res.namedHeirs).toEqual([{ id: 'c1', state: 'not-alive' }]);
		expect(res.openBranches.map((b) => b.id)).toContain('c1');
		expect(notesOf(res, 'died-no-year').filter((n) => n.params.person === 'c1')).toHaveLength(1);
	});

	it('the people the walk reached are cut at the length of the line', () => {
		let people = '';
		for (let i = 0; i < 12; i++) people += DEAD(`d${i}`).replace('sex: f', 'sex: m');
		const res = lineOf(tree({ people }), undefined, {}, 4);
		expect(res.heirs).toEqual([]);
		expect(notesOf(res, 'died-no-year')).toHaveLength(4);
	});

	it('a ruler, an ancestor and an excluded person are out of the line for another reason, so they get no note (the excluded person has no row)', () => {
		const src = `people:
  - {id: g, name: Gran, sex: m, born: 900, died: "long ago"}
  - {id: r, name: Rolf, sex: m, born: 950, died: "in the war", parents: [g]}
  - {id: x, name: Xan, sex: m, born: 1000, died: "in a fire", childless: true, parents: [r]}
titles:
  - id: crown
    name: Crown
    succession: eldest-child
    year: "1109"
    exclude: [x]
    holders:
      - {person: r, from: 1000}
`;
		expect(notesOf(lineOf(src), 'died-no-year')).toEqual([]);
	});

	it('a death date that cannot be read is dead in a calendar year too (the year in the note is the calendar text)', () => {
		const src = tree({
			people: DEAD('c1'),
			title: '    year: "Aldric 10"\n',
		}).replace('born: 1060', 'born: "Aldric 1"');
		const res = lineOf(src, compileCalendars([ALDRIC], true));
		expect(notesOf(res, 'died-no-year')).toEqual([{ kind: 'died-no-year', params: { person: 'c1', year: 'Aldric 10' } }]);
	});
});

describe('the date warnings of a line (spec §14 rule 5; dateWarnings)', () => {
	it('a plain 0 in the title year gives year-zero with the text as written', () => {
		const res = lineOf(tree({ title: '    year: "0"\n' }));
		expect(warningsOf(res)).toEqual([{ warning: 'year-zero', what: 'year', text: '0' }]);
	});

	it('a plain 0 in the birth date of an heir gives year-zero for that person', () => {
		const res = lineOf(tree({ people: '  - {id: c, name: Cade, sex: m, born: "0", parents: [r]}\n', title: '    year: "5"\n' }));
		expect(res.heirs).toEqual(['c']);
		expect(warningsOf(res)).toContainEqual({ warning: 'year-zero', id: 'c', what: 'born', text: '0' });
	});

	it('a draft view with a calendar reads the draft title (the Titles window), and the saved view reads none', () => {
		const g = graphOf(tree({ title: '    year: "1109"\n' }));
		const view = buildTreeDates(compileCalendars([REIGN_NAMES], true), g.people, g.titles);
		const run = successionLine as unknown as (g: FamilyGraph, t: Title, s: SuccessionSpec, limit: number, old: number, young: number, d: TreeDates) => SuccessionResult;
		const res = run(g, g.titles[0], { ...specOf(g.titles[0]), year: 'Qinglong Emperor 12' }, 5, 110, 0, view);
		expect(res.year).toBe(141);
		expect(warningsOf(res as unknown as Record<string, unknown>).map((w) => w.warning)).toEqual(['calendar-year-past-end']);
		const saved = successionLine(g, g.titles[0], { ...specOf(g.titles[0]), year: 'Qinglong Emperor 12' }, 5, 110);
		expect(saved.year).toBeNull();
		expect(saved.dateWarnings).toEqual([]);
	});

	it('the default view is the graph\'s own: a graph made with a reader gives the calendar line', () => {
		const g = graphOf(tree({ title: '    year: "Aldric 10"\n' }), compileCalendars([ALDRIC], true));
		expect(successionLine(g, g.titles[0], specOf(g.titles[0]), 5, 110).year).toBe(1109);
	});

	it('the ruler search reads the holder texts: a warning for `from` and for `to`, once for each place', () => {
		const res = lineOf(tree({ title: '', holder: '{person: r, from: "Qinglong Emperor 0", to: "Qinglong Emperor 12"}' }), compileCalendars([REIGN_NAMES], true));
		expect(res.kind).toBe('line');
		expect(warningsOf(res)).toEqual([
			{ warning: 'calendar-year-zero', entry: 0, what: 'reign', text: 'Qinglong Emperor 0' },
			{ warning: 'calendar-year-past-end', entry: 0, what: 'reign', text: 'Qinglong Emperor 12' },
		]);
	});
});

describe('the tree warning list (spec §14 rules 5 and 7)', () => {
	const reign = (ready = true) => compileCalendars([REIGN_NAMES], ready);

	it('a plain year 0 gives year-zero with a sentence that names the title and the text', () => {
		const g = graphOf(tree({ title: '    year: "0"\n' }));
		const issue = g.issues.find((i) => i.code === 'year-zero')!;
		expect(issue.params).toMatchObject({ where: 'year', title: 'Crown', value: '0' });
		expect(issueText(issue)).toBe('The title Crown has “year: 0”. There is no year 0. The plugin reads 0 as 1 BC. If you mean AD 1, write “1”. For a year before that, write a number with a minus sign, such as “-5”, for 5 BC.');
	});

	it('only the people the line can read: a named heir, the holders and their descendants', () => {
		const people = `  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 12", parents: [r]}
  - {id: n, name: Nora, sex: f, born: "Qinglong Emperor 13"}
  - {id: u, name: Una, sex: f, born: "Qinglong Emperor 14"}
`;
		const g = graphOf(tree({ people, title: '    year: "Jianwen Emperor 5"\n    heir: [n]\n' }), reign());
		const named = g.issues.filter((i) => i.code === 'calendar-year-past-end').map((i) => i.params.person);
		expect(named).toEqual(['Cade', 'Nora']);
		expect(g.issues.find((i) => i.params.person === 'Cade')?.ids).toEqual(['c']);
	});

	it('a date that fits two calendars names both calendars in the sentence', () => {
		const other = { ...REIGN_NAMES, id: 'Other.md#0#0', name: 'Reign names (copy)', note: 'Other.md', kind: { type: 'eras' as const, eras: [{ name: 'Qinglong Emperor', start: 500, length: 11 }] } };
		const g = graphOf(tree({ people: '  - {id: c, name: Cade, sex: m, born: "Qinglong Emperor 3", parents: [r]}\n', title: '    year: "1109"\n' }), compileCalendars([REIGN_NAMES, other], true));
		const issue = g.issues.find((i) => i.code === 'fits-two-calendars')!;
		expect(issue.params.calendars).toEqual(['Reign names', 'Reign names (copy)']);
		expect(issueText(issue)).toContain('“Reign names” and “Reign names (copy)”');
	});

	it('a shape error of `year` (a list) still gives year-unreadable before the calendars are ready; a text does not', () => {
		const list = tree({ title: '    year: [1, 2]\n' });
		expect(issueCodes(graphOf(list, reign(false)))).toContain('year-unreadable');
		const text = tree({ title: '    year: "Year 5 of Cycle 3"\n' });
		expect(issueCodes(graphOf(text, reign(false)))).not.toContain('year-unreadable');
	});

	it('the problem of the calendar set becomes an issue with the note name', () => {
		// D289: a tree uses one calendar note, so the only problem of the set is the note that is missing (the "calendar-duplicate" problem is gone).
		const problems = [{ key: 'calendar-note-missing' as const, note: '[[Calendars of the Far Land]]' }];
		const g = graphOf(tree(), compileCalendars([], true, problems));
		const missing = g.issues.find((i) => i.code === 'calendar-note-missing')!;
		expect(issueText(missing)).toContain('“[[Calendars of the Far Land]]”');
		expect(graphOf(tree(), compileCalendars([], false, problems)).issues.filter((i) => i.code.startsWith('calendar-'))).toEqual([]);
	});

	it('calendar-no-anchor names the calendar, once for each calendar, and only for a tree with a title that needs the year', () => {
		const people = '  - {id: c, name: Cade, sex: m, born: "100", parents: [r]}\n';
		const g = graphOf(tree({ people, title: '    year: "Year 5 of Cycle 3"\n' }), compileCalendars([LONG_COUNT], true));
		const issues = g.issues.filter((i) => i.code === 'calendar-no-anchor');
		expect(issues).toHaveLength(1);
		expect(issueText(issues[0])).toContain('“The Long Count”');
		const noRule = graphOf(tree({ people, rule: '', title: '    year: "Year 5 of Cycle 3"\n' }), compileCalendars([LONG_COUNT], true));
		expect(issueCodes(noRule)).not.toContain('calendar-no-anchor');
	});

	it('a graph with no reader gives no calendar issue, and the default reader is the plain one', () => {
		const g = deriveFamilies(parseOrThrow(tree({ title: '    year: "1210"\n' })));
		expect(g.issues.filter((i) => i.code.startsWith('calendar-') || i.code === 'fits-two-calendars')).toEqual([]);
		expect(g.dates.reader).toBe(PLAIN_READER);
	});
});

function parseOrThrow(src: string) {
	const parsed = parseDynasty(src);
	if (!parsed.ok) throw new Error(parsed.error.code);
	return parsed.tree;
}

describe('the places that draw a date read it through g.dates (spec §14 rule 7: cards, saved picture, phone list)', () => {
	useFakeDom({ css: true, createSvg: true });
	const SRC = `people:
  - {id: a, name: Aldric, died: "Year 5 of Cycle 3"}
  - {id: b, name: Bertram, born: 1100, died: "fell in the war"}
`;
	const draw = (g: ReturnType<typeof graphOf>) => {
		clearLayoutCache();
		const laid = layoutTree(g, cardForm(geometryFor(12), 'down'), { ...DEFAULT_LAYOUT_SETTINGS }, 'test');
		const root = new FEl('g');
		buildScene(root as unknown as SVGGElement, g, laid, { fonts: { text: 'serif', ui: 'sans', bold: '700' }, measure: () => 10, link: () => null });
		const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
		const dates = all(root).filter((e) => e.hasClass('dynasty-card-dates')).map((e) => e.getText());
		return { dates, svg: renderSvg(g, laid.layout, laid.edges, {}) };
	};

	it('a calendar death date shows as written on the card and in the saved picture; with no calendar it shows the sign', () => {
		const withCalendar = draw(graphOf(SRC, compileCalendars([LONG_COUNT], true)));
		expect(withCalendar.dates).toContain('d. Year 5 of Cycle 3');
		expect(withCalendar.svg).toContain('d. Year 5 of Cycle 3');
		const plain = draw(graphOf(SRC));
		expect(plain.dates).not.toContain('d. Year 5 of Cycle 3');
		expect(plain.dates).toContain('†');
		expect(plain.svg).not.toContain('d. Year 5 of Cycle 3');
	});

	it('the phone list stands on the oldest parent by the calendar year of the birth', () => {
		const src = `people:
  - {id: p1, name: Pia, born: "Aldric 30"}
  - {id: p2, name: Paul, born: "Aldric 10"}
  - {id: k1, name: Kit, born: 1200, parents: [p1]}
  - {id: k2, name: Kay, born: 1210, parents: [p2]}
`;
		expect(oldestParent(graphOf(src, compileCalendars([ALDRIC], true)))).toBe('p2');
		expect(oldestParent(graphOf(src))).toBe('p1');
	});
});
