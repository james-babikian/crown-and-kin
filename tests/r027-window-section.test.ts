import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Scripted answers of the person picker (a person id as `{kind: 'person', id}`, or null for Cancel).
const answers: unknown[] = [];
const picks: { exclude: string[]; title: string; allowNew: boolean }[] = [];
vi.mock('../src/obsidian/person-picker', () => ({
	pickPerson: async (_app: unknown, _g: unknown, exclude: Set<string>, _placeholder: string, title: string, allowNew: boolean) => {
		picks.push({ exclude: [...exclude], title, allowNew });
		return answers.shift() ?? null;
	},
}));

import { closePluginModals } from '../src/obsidian/plugin-modals';
import { successionHints } from '../src/obsidian/succession-section';
import { emptySuccession } from '../src/obsidian/titles-draft';
import { SUCCESSION_UI as T } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, dispatchWindow, fakeWin, installDom, resetDom, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { BODY_16, choose, ctl, lineRows, notes, openWin, page, section, tapChoice, type Opened } from './r027-window-support';
import { backToList } from './lw-support';
import { click, type } from './s113-c-support';

/*
 * Version 0.2.7, WP3 (contract E, D.3, J, K, L): the Succession section of the Titles window. The real window runs on the
 * fake DOM. Sample tree 16 gives the four rules; small made-up trees give the messages and the states.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	answers.length = 0;
	picks.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = false;
	device.width = 1280;
	device.height = 800;
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A made-up tree: one title `crown` with `extra` keys and `holders`, and a small house. */
function mini(extra = '', holders = '      - {person: rex, from: 1100}', people = ''): string {
	return [
		'titles:',
		'  - id: crown',
		'    name: Crown',
		...(extra ? extra.split('\n').map((l) => `    ${l}`) : []),
		'    holders:',
		holders,
		'people:',
		'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
		'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
		'  - {id: miss, name: Miss Ardent, sex: f, born: 1102, parents: [rex]}',
		'  - {id: late, name: Late Ardent, sex: m, born: 1150, parents: [rex]}',
		'  - {id: elder, name: Elder Ardent, sex: m, born: 990}',
		'  - {id: lost, name: Lost Ardent, sex: m, born: 1101, died: 1110, parents: [rex]}',
		people,
		'',
	]
		.filter((l) => l !== '')
		.join('\n');
}

const texts = (p: FEl) => section(p).getText();
const tap = (el: FEl | null) => dispatch(el!, 'click');

describe('placement', () => {
	it('stands after the holder list and before Other actions, in a saved title', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		const order = p.children.map((c) => c.getAttribute('data-section') ?? c.classes.values().next().value);
		const holderAt = order.indexOf('dynasty-holder-panel');
		const successionAt = order.indexOf('succession');
		const actionsAt = order.indexOf('dynasty-lw-actions');
		expect(holderAt).toBeGreaterThan(-1);
		expect(successionAt).toBeGreaterThan(holderAt);
		expect(actionsAt).toBeGreaterThan(successionAt);
		expect(section(p).querySelector('.dynasty-sheet-section-title')!.getText()).toBe(T.heading);
	});

	it('shows only the "new title" text for a title that is not saved yet', () => {
		const o = openWin();
		tap(o.content.querySelector('button.dynasty-lw-add'));
		const p = o.content.querySelector('.dynasty-lw-page')!;
		const s = section(p);
		expect(s.querySelector('[data-hint="new-title"]')!.getText()).toBe(T.newTitle);
		expect(s.querySelectorAll('select, input, button')).toHaveLength(0);
	});
});

describe('the line of sample tree 16 (the expected lines are in the comments of the fixture)', () => {
	const cases: [string, string, string[], boolean][] = [
		['duke-of-carrowmere', 'Line of succession after Bertram now', ['Fenwick Carrow', 'Jasper Carrow', 'Cedric Carrow', 'Dunstan Carrow'], false],
		['countess-of-harrowfen', 'Line of succession after Matilda in 1215', ['Clara Harrow', 'Agnes Harrow', 'Dagmar Harrow', 'Sunniva Harrow', 'Tilde Harrow'], true],
		['margrave-of-the-salt-coast', 'Line of succession after Bram now', ['Dorian Saltmarsh', 'Leif Saltmarsh', 'Finn Saltmarsh', 'Hale Saltmarsh', 'Elowen Saltmarsh'], true],
		['lord-of-wetherby', 'Line of succession after Wystan now', ['Sam Wether', 'Cass Wether', 'Bertie Wether', 'Quill Penn', 'Ronan Penn'], false],
	];
	for (const [id, heading, names, more] of cases) {
		it(`${id}: the heading, ${names.length} rows${more ? ', "and more people"' : ''} and Show`, () => {
			const o = openWin();
			const p = page(o, id);
			expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(heading);
			expect(lineRows(p)).toEqual(names.map((n, i) => `${['1st', '2nd', '3rd', '4th', '5th'][i]}${n}`));
			expect(!!p.querySelector('.dynasty-succ-more')).toBe(more);
			expect(p.querySelector('.dynasty-succ-more')?.getText() ?? '').toBe(more ? T.more : '');
			const show = p.querySelector('button.dynasty-succ-show')!;
			expect(show.getText()).toBe(T.show);
			expect(show.getAttribute('aria-label')).toBe(T.showLabel);
		});
	}

	it('a tap on a name shows the card like a holder name, and asks first when the draft has changes', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		dispatch(p.querySelectorAll('.dynasty-succ-row button.dynasty-holder-name')[1], 'click');
		expect(o.shown).toEqual(['jasper-carrow']);
		expect(o.closed.n).toBe(1);
	});

	it('a row has a name for a screen reader that tells the place and the action', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		expect(p.querySelector('.dynasty-succ-row button')!.getAttribute('aria-label')).toBe(T.lineRowLabel('Fenwick Carrow', '1st'));
	});

	it('warns under the row of an old heir, with the number of the setting', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		expect(notes(p, 'old')).toEqual([T.old('Cedric Carrow', 110, null)]);
		const w = openWin(BODY_16, { succession: { limit: () => 5, oldAge: () => 100 } });
		const older = notes(page(w, 'duke-of-carrowmere'), 'old');
		expect(older.length).toBeGreaterThan(0);
		expect(older[0]).toContain('older than 100 years');
		const none = openWin(BODY_16, { succession: { limit: () => 5, oldAge: () => 0 } });
		expect(notes(page(none, 'duke-of-carrowmere'), 'old')).toEqual([]);
	});

	it('the length of the line follows the setting', () => {
		const o = openWin(BODY_16, { succession: { limit: () => 2, oldAge: () => 110 } });
		const p = page(o, 'duke-of-carrowmere');
		expect(lineRows(p)).toHaveLength(2);
		expect(p.querySelector('.dynasty-succ-more')).not.toBeNull();
	});
});

describe('the messages', () => {
	it('shows no line for a title with no rule and no named heir, and hides the block', () => {
		const o = openWin(mini());
		const p = page(o, 'crown');
		expect((p.querySelector('.dynasty-succ-line') as FEl).hidden).toBe(true);
		expect(p.querySelector('button.dynasty-succ-show')).toBeNull();
	});

	it('shows "No heir in the tree" with Show when nobody can inherit', () => {
		const o = openWin(mini('succession: eldest-child', '      - {person: elder}'));
		const p = page(o, 'crown');
		expect(p.querySelector('[data-msg="no-heir"]')!.getText()).toBe(T.noHeir);
		expect(p.querySelector('button.dynasty-succ-show')).not.toBeNull();
		expect(lineRows(p)).toHaveLength(0);
	});

	it('says there is no holder in the year, and shows no Show button', () => {
		const o = openWin(mini('succession: eldest-child\nyear: 1050'));
		const p = page(o, 'crown');
		expect(p.querySelector('[data-msg="no-ruler"]')!.getText()).toBe(T.noRuler(1050));
		expect(p.querySelector('button.dynasty-succ-show')).toBeNull();
	});

	it('says the holder is not in the tree', () => {
		const o = openWin(mini('succession: eldest-child', '      - {name: Nobody Known, from: 1100}'));
		const p = page(o, 'crown');
		expect(p.querySelector('[data-msg="ruler-not-in-tree"]')!.getText()).toBe(T.rulerNotInTree(null));
		expect(p.querySelector('button.dynasty-succ-show')).toBeNull();
	});

	it('says the rule in the tree text has an error, and the rule shows as None', () => {
		const o = openWin(mini('succession: salic'));
		const p = page(o, 'crown');
		expect(p.querySelector('[data-msg="bad-rule"]')!.getText()).toBe(T.badRule);
		// A bad rule keeps its own first option, selected, so that choosing None removes it (G2b, ruling 1).
		const select = ctl(p, 'rule')!.querySelector('select')!;
		expect(select.value).toBe('?');
		expect(select.querySelector('option')!.getText()).toBe('Unknown value (salic)');
		expect(p.querySelector('button.dynasty-succ-show')).toBeNull();
	});

	it('says "N holders rule in YEAR" when two entries rule at the same time', () => {
		const o = openWin(mini('succession: eldest-child\nyear: 1120', '      - {person: rex, from: 1100}\n      - {person: elder, from: 1100}'));
		const p = page(o, 'crown');
		expect(notes(p, 'co-rulers')).toEqual([T.coRulers(2, 'Elder', 1120)]);
	});

	it('says a date has no year, for a person and for a reign', () => {
		const people = '  - {id: vague, name: Vague Ardent, sex: m, born: long ago, parents: [rex]}';
		const o = openWin(mini('succession: eldest-child\nyear: 1120', '      - {person: rex, from: 1100}', people));
		const p = page(o, 'crown');
		expect(notes(p, 'no-year')).toEqual([T.noYearDate('Vague Ardent')]);
		const r = openWin(mini('succession: eldest-child\nyear: 1120', '      - {person: elder, from: spring}\n      - {person: rex, from: 1100}'));
		expect(notes(page(r, 'crown'), 'no-year-reign')).toEqual([T.noYearReign('Elder')]);
	});

	it('says how many people the one-sex rule left out for lack of a sex value', () => {
		const people = '  - {id: nosex, name: Nosex Ardent, born: 1105, parents: [rex]}';
		const o = openWin(mini('succession: eldest-child\ninherit: men-only', '      - {person: rex, from: 1100}', people));
		expect(notes(page(o, 'crown'), 'no-sex')).toEqual([T.leftOutNoSex(1)]);
	});

	it('says how many heirs have no birth year for "Born during the reign first"', () => {
		const people = '  - {id: nodate, name: Nodate Ardent, sex: m, parents: [rex]}';
		const o = openWin(mini('succession: born-in-reign', '      - {person: rex, from: 1100}', people));
		expect(notes(page(o, 'crown'), 'no-birth-year')).toEqual([T.noBirthYear(1)]);
	});

	it('says the ruler has no sex value when "The right to inherit comes from" is written', () => {
		const o = openWin(mini('succession: eldest-child\ninherit-through: anyone', '      - {person: nosex, from: 1100}', '  - {id: nosex, name: Nosex Ardent, born: 1070}'));
		expect(notes(page(o, 'crown'), 'ruler-no-sex')).toEqual([T.rulerNoSex('Nosex Ardent')]);
	});

	it('says nobody can inherit when the ruler is outside the body of the first holder', () => {
		const people = '  - {id: lone, name: Lone Ardent, sex: m, born: 1080}';
		const o = openWin(mini('succession: eldest-child\nheirs-of-body: true', '      - {person: rex, from: 1050}\n      - {person: lone, from: 1100}', people));
		const p = page(o, 'crown');
		expect(notes(p, 'outside-body')).toEqual([T.outsideBody('Lone', 'Rex')]);
		expect(p.querySelector('[data-msg="no-heir"]')).toBeNull();
	});
});

describe('the hints', () => {
	const d = (o: Partial<ReturnType<typeof emptySuccession>>) => ({ ...emptySuccession(), ...o });

	it('the Salic hint shows only for eldest child, men only and "Men" as the line', () => {
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'men-only', through: 'men' })).inherit).toEqual([T.salic]);
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'men-only' })).inherit).toEqual([]);
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'women-only', through: 'women' })).inherit).toEqual([T.salicReverse]);
		expect(successionHints(d({ rule: 'youngest-child', inherit: 'men-only', through: 'men' })).inherit).toEqual([]);
	});

	it('the house hint shows for a house form with Siblings before children or Nearest relative first', () => {
		expect(successionHints(d({ rule: 'siblings-first', inherit: 'men-first-in-house' })).inherit).toEqual([T.houseMen]);
		expect(successionHints(d({ rule: 'nearest-relative', inherit: 'women-first-in-house' })).inherit).toEqual([T.houseWomen]);
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'men-first-in-house' })).inherit).toEqual([]);
	});

	it('the rule hints: the oldest generation, and the steps of nearness', () => {
		expect(successionHints(d({ rule: 'siblings-first' })).rule).toBe(T.siblingsHint);
		expect(successionHints(d({ rule: 'nearest-relative' })).rule).toBe(T.nearestHint);
		expect(successionHints(d({ rule: 'eldest-child' })).rule).toBeNull();
	});

	it('the matrilineal hint shows for Men only with "Women (matrilineal)" and Eldest child first', () => {
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'men-only', through: 'women' })).through).toBe(T.matrilinealHint);
		expect(successionHints(d({ rule: 'nearest-relative', inherit: 'men-only', through: 'women' })).through).toBeNull();
	});

	it('the illegitimate hint shows for a women rule unless the last option is chosen', () => {
		for (const inherit of ['women-only', 'women-first', 'women-first-in-house'] as const) {
			expect(successionHints(d({ rule: 'eldest-child', inherit, illegitimate: 'no' })).illegitimate).toBe(true);
			expect(successionHints(d({ rule: 'eldest-child', inherit, illegitimate: 'equal' })).illegitimate).toBe(false);
		}
		expect(successionHints(d({ rule: 'eldest-child', inherit: 'men-only' })).illegitimate).toBe(false);
		expect(successionHints(d({ inherit: 'women-only' })).illegitimate).toBe(false);
	});

	it('the hints are on the page, next to their field', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		expect(ctl(p, 'inherit')!.parentElement!.querySelector('[data-hint="inherit"]')!.getText()).toBe(T.salic);
		const h = page(openWin(), 'countess-of-harrowfen');
		expect(ctl(h, 'illegitimate')!.parentElement!.querySelector('[data-hint="illegitimate"]')!.getText()).toBe(T.illHint);
		const m = page(openWin(), 'margrave-of-the-salt-coast');
		expect(texts(m)).toContain(T.houseMen);
		expect(texts(m)).toContain(T.siblingsHint);
		expect(texts(page(openWin(), 'lord-of-wetherby'))).toContain(T.nearestHint);
	});
});

describe('the fields', () => {
	it('show what the tree text says', () => {
		const o = openWin();
		const p = page(o, 'countess-of-harrowfen');
		expect(ctl(p, 'rule')!.querySelector('select')!.value).toBe('youngest-child');
		expect(ctl(p, 'inherit')!.querySelector('select')!.value).toBe('women-first');
		expect(ctl(p, 'through')!.querySelector('select')!.value).toBe('');
		expect(ctl(p, 'year')!.querySelector('input')!.value).toBe('1215');
		expect(ctl(p, 'illegitimate')!.querySelector('select')!.value).toBe('after');
		expect(ctl(p, 'adopted')!.querySelector('input')!.checked).toBe(false);
		const m = page(openWin(), 'margrave-of-the-salt-coast');
		expect(ctl(m, 'adopted')!.querySelector('input')!.checked).toBe(true);
		expect(ctl(m, 'inherit')!.querySelector('select')!.value).toBe('men-first-in-house');
		const d = page(openWin(), 'duke-of-carrowmere');
		expect(ctl(d, 'through')!.querySelector('select')!.value).toBe('men');
	});

	it('the choices have the names with their terms; the third switch has its hint', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		const names = (key: string) => ctl(p, key)!.querySelectorAll('option').map((x) => x.getText());
		expect(names('rule')).toEqual([T.ruleNone, ...Object.values(T.rules)]);
		expect(names('inherit')).toEqual(Object.values(T.inherits));
		expect(names('through')).toEqual([T.throughSame, ...Object.values(T.throughs)]);
		expect(names('illegitimate')).toEqual(Object.values(T.ills));
		expect(ctl(p, 'body')!.getText()).toContain(T.body);
	});

	it('an unwritten "Who can inherit" shows as "No preference"; choosing a rule writes no "inherit"', async () => {
		const o = openWin(mini());
		const p = page(o, 'crown');
		expect(ctl(p, 'inherit')).toBeNull();
		choose(p, 'rule', 'eldest-child');
		expect(ctl(p, 'inherit')!.querySelector('select')!.value).toBe('no-preference');
		await click(o.content.querySelector('button[data-focus="save"]'));
		expect(o.handle.body).toContain('succession: eldest-child');
		expect(o.handle.body).not.toContain('inherit:');
	});

	it('a new rule gives a new line at once', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		expect(lineRows(p)).toEqual(['1stKid Ardent', '2ndMiss Ardent', '3rdLate Ardent']);
		choose(p, 'rule', 'youngest-child');
		expect(lineRows(p)).toEqual(['1stLate Ardent', '2ndMiss Ardent', '3rdKid Ardent']);
		choose(p, 'inherit', 'women-only');
		expect(lineRows(p)).toEqual(['1stMiss Ardent']);
	});

	it('None hides "Who can inherit" and the line, and clears who can inherit', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', '');
		expect(ctl(p, 'inherit')).toBeNull();
		expect(ctl(p, 'through')).toBeNull();
		expect((p.querySelector('.dynasty-succ-line') as FEl).hidden).toBe(true);
		choose(p, 'rule', 'eldest-child');
		expect(ctl(p, 'inherit')!.querySelector('select')!.value).toBe('no-preference');
	});

	it('the year changes the line on blur, and 300 ms after the last key press', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		const year = ctl(p, 'year')!.querySelector('input')!;
		expect(lineRows(p)).toHaveLength(3);
		type(year, '1101');
		// The draft has the text at once; the line waits.
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(T.lineHeading('Rex', null));
		runTimers(299);
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(T.lineHeading('Rex', null));
		runTimers(2);
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(T.lineHeading('Rex', 1101));
		type(year, '1103');
		dispatch(year, 'blur');
		expect(p.querySelector('.dynasty-succ-heading')!.getText()).toBe(T.lineHeading('Rex', 1103));
		expect(o.win.isDirty()).toBe(true);
	});

	it('the field is not drawn again while the owner types, so the focus stays', () => {
		const o = openWin(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1120');
		runTimers(400);
		expect(ctl(p, 'year')!.querySelector('input')).toBe(year);
	});

	it('the switch for adopted children changes the line', () => {
		const people = '  - {id: ward, name: Ward Ardent, sex: m, born: 1103, parents: [{id: rex, type: adoptive}]}';
		const o = openWin(mini('succession: eldest-child', '      - {person: rex, from: 1100}', people));
		const p = page(o, 'crown');
		expect(lineRows(p).some((r) => r.includes('Ward'))).toBe(false);
		const box = ctl(p, 'adopted')!.querySelector('input')!;
		box.checked = true;
		dispatch(box, 'change');
		expect(lineRows(p).some((r) => r.includes('Ward'))).toBe(true);
	});

	it('the hint of the body switch names the first holder', () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		expect(ctl(p, 'body')!.getText()).toContain(T.bodyHint('Wystan'));
	});
});

describe('named heirs and excluded people', () => {
	const rowsOf = (p: FEl, key: string) => ctl(p, key)!.querySelectorAll('.dynasty-holder-row');
	const idsOf = (p: FEl, key: string) => rowsOf(p, key).map((r) => r.getAttribute('data-person'));

	it('lists the written ones in order, with Move earlier, Move later and Remove', () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		expect(idsOf(p, 'heirs')).toEqual(['sam-wether', 'cass-wether']);
		expect(idsOf(p, 'exclude')).toEqual(['osric-penn']);
		const buttons = rowsOf(p, 'heirs')[0].querySelectorAll('button').map((b) => b.getAttribute('aria-label'));
		expect(buttons).toEqual(['Show', T.moveEarlierLabel('Sam Wether'), T.moveLaterLabel('Sam Wether'), T.removeLabel('Sam Wether')].map((x, i) => (i === 0 ? 'Sam Wether: show the card in the tree' : x)));
		// The excluded person has only Remove (and the name).
		expect(rowsOf(p, 'exclude')[0].querySelectorAll('button.dynasty-holder-move')).toHaveLength(0);
		expect(rowsOf(p, 'exclude')[0].querySelector('button.dynasty-holder-remove')).not.toBeNull();
	});

	it('Move earlier and Move later swap rows, and the first row cannot move earlier', () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		expect(rowsOf(p, 'heirs')[0].querySelector('button.dynasty-succ-earlier')!.disabled).toBe(true);
		expect(rowsOf(p, 'heirs')[1].querySelector('button.dynasty-succ-later')!.disabled).toBe(true);
		tap(rowsOf(p, 'heirs')[0].querySelector('button.dynasty-succ-later'));
		expect(idsOf(p, 'heirs')).toEqual(['cass-wether', 'sam-wether']);
		expect(lineRows(p)[0]).toBe('1stCass Wether');
		tap(rowsOf(p, 'heirs')[1].querySelector('button.dynasty-succ-earlier'));
		expect(idsOf(p, 'heirs')).toEqual(['sam-wether', 'cass-wether']);
	});

	it('Remove takes a row away, and the line follows', () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		tap(rowsOf(p, 'heirs')[0].querySelector('button.dynasty-holder-remove'));
		expect(idsOf(p, 'heirs')).toEqual(['cass-wether']);
		expect(lineRows(p)[0]).toBe('1stCass Wether');
		tap(rowsOf(p, 'exclude')[0].querySelector('button.dynasty-holder-remove'));
		expect(idsOf(p, 'exclude')).toEqual([]);
		expect(ctl(p, 'exclude')!.getText()).toContain(T.excludeNone);
	});

	it('the empty texts of the two lists have the size of the hints around them', () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		for (const row of rowsOf(p, 'heirs')) tap(row.querySelector('button.dynasty-holder-remove'));
		for (const row of rowsOf(p, 'exclude')) tap(row.querySelector('button.dynasty-holder-remove'));
		for (const kind of ['heirs', 'exclude']) {
			const none = ctl(p, kind)!.querySelector('.dynasty-holder-none')!;
			expect(none.hasClass('dynasty-sheet-hint')).toBe(true);
		}
	});

	it('Add opens the picker with no "Create new person" and without the ruler or the people on the list', async () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		answers.push({ kind: 'person', id: 'fay-wether' });
		await click(ctl(p, 'heirs')!.querySelector('button.dynasty-succ-add'));
		expect(picks).toHaveLength(1);
		expect(picks[0].allowNew).toBe(false);
		expect(picks[0].title).toBe(T.heirPickerTitle);
		expect(picks[0].exclude.sort()).toEqual(['cass-wether', 'sam-wether', 'wystan-wether']);
		expect(idsOf(p, 'heirs')).toEqual(['sam-wether', 'cass-wether', 'fay-wether']);
	});

	it('Add to the excluded people uses its own picker title; Cancel changes nothing', async () => {
		const o = openWin();
		const p = page(o, 'lord-of-wetherby');
		await click(ctl(p, 'exclude')!.querySelector('button.dynasty-succ-add'));
		expect(picks[0].title).toBe(T.excludePickerTitle);
		expect(idsOf(p, 'exclude')).toEqual(['osric-penn']);
		expect(o.win.isDirty()).toBe(false);
	});

	it('shows the state of a named heir under its row: not alive, not born, the ruler, excluded', () => {
		const heirs = ['lost', 'late', 'rex', 'miss'];
		const o = openWin(mini(`succession: eldest-child\nyear: 1120\nheir: [${heirs.join(', ')}]\nexclude: miss`, '      - {person: rex, from: 1100}'));
		const p = page(o, 'crown');
		const note = (id: string) => rowsOf(p, 'heirs').find((r) => r.getAttribute('data-person') === id)!.querySelector('.dynasty-holder-note')?.getText();
		expect(note('lost')).toBe(T.heirNotAlive('Lost Ardent', 1120));
		expect(note('late')).toBe(T.heirNotBorn('Late Ardent', 1120));
		expect(note('rex')).toBe(T.heirIsRuler('Rex Ardent'));
		expect(note('miss')).toBe(T.heirExcluded('Miss Ardent'));
	});

	it('the notes of the named heirs follow the Year field', () => {
		const o = openWin(mini('succession: eldest-child\nheir: late', '      - {person: rex, from: 1100}'));
		const p = page(o, 'crown');
		const first = () => rowsOf(p, 'heirs')[0].querySelector('.dynasty-holder-note')?.getText() ?? '';
		expect(first()).toBe('');
		const year = ctl(p, 'year')!.querySelector('input')!;
		type(year, '1120');
		dispatch(year, 'blur');
		expect(first()).toBe(T.heirNotBorn('Late Ardent', 1120));
	});

	it('shows a name that is dangling as a row with its id and Remove', () => {
		const o = openWin(mini('succession: eldest-child\nheir: [ghost, kid]'));
		const p = page(o, 'crown');
		const row = rowsOf(p, 'heirs')[0];
		expect(row.getAttribute('data-person')).toBe('ghost');
		expect(row.querySelector('div.dynasty-holder-name')!.getText()).toBe('ghost');
		expect(row.getText()).toContain(T.heirNotInTree);
		expect(row.querySelector('button.dynasty-holder-name')).toBeNull();
		tap(row.querySelector('button.dynasty-holder-remove'));
		expect(idsOf(p, 'heirs')).toEqual(['kid']);
	});

	it('a named heir works without a rule: a line of the named heirs', () => {
		const o = openWin(mini('heir: kid'));
		const p = page(o, 'crown');
		expect(lineRows(p)).toEqual(['1stKid Ardent']);
		expect(ctl(p, 'inherit')).toBeNull();
	});
});

describe('Show and the unsaved question', () => {
	it('with no changes the window closes and the tree shows the line', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		tap(p.querySelector('button.dynasty-succ-show'));
		expect(o.lines).toEqual(['duke-of-carrowmere']);
		expect(openModals).not.toContain(o.win);
		expect(o.handle.ops).toHaveLength(0);
	});

	it('with unsaved changes it asks; Cancel keeps the window and the draft', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', 'youngest-child');
		tap(p.querySelector('button.dynasty-succ-show'));
		const q = o.modal.querySelector('.dynasty-sheet-confirm')!;
		expect(q.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(T.unsavedTitle);
		expect(q.querySelector('.dynasty-sheet-confirm-text')!.getText()).toBe(T.unsaved);
		expect(q.querySelectorAll('button').map((b) => b.getText())).toEqual(['Cancel', T.saveAndShow]);
		tap(q.querySelector('button.dynasty-sheet-keep'));
		expect(o.modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(o.lines).toEqual([]);
		expect(o.handle.ops).toHaveLength(0);
		expect(ctl(p, 'rule')!.querySelector('select')!.value).toBe('youngest-child');
	});

	it('Save and show writes one batch, closes the window and then shows the line', async () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', 'youngest-child');
		tap(p.querySelector('button.dynasty-succ-show'));
		await click(o.modal.querySelector('.dynasty-confirm-show'));
		expect(o.handle.ops).toHaveLength(1);
		expect(o.handle.ops[0].kind).toBe('batch');
		expect(o.handle.body).toContain('succession: youngest-child');
		expect(o.lines).toEqual(['duke-of-carrowmere']);
		expect(openModals).not.toContain(o.win);
	});

	it('Save and show keeps the window open when the write is refused', async () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', 'youngest-child');
		o.handle.write.mockImplementation((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'bad-value' } })) as never);
		tap(p.querySelector('button.dynasty-succ-show'));
		await click(o.modal.querySelector('.dynasty-confirm-show'));
		expect(o.lines).toEqual([]);
		expect(openModals).toContain(o.win);
	});

	it('a title that has a new id after Save and show is shown by the new id', async () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', 'youngest-child');
		const rows = (o.win as unknown as { rows: { id: string | null; idDraft?: string }[] }).rows;
		rows.find((t) => t.id === 'duke-of-carrowmere')!.idDraft = 'duke-of-x';
		tap(p.querySelector('button.dynasty-succ-show'));
		await click(o.modal.querySelector('.dynasty-confirm-show'));
		// The Id question comes first; the window stays open until it is answered.
		expect(o.lines).toEqual([]);
		expect(openModals).toContain(o.win);
		await click(o.modal.querySelector('.dynasty-id-change'));
		expect(o.lines).toEqual(['duke-of-x']);
	});

	it('a window opened without showLine closes with no error', () => {
		const o = openWin(BODY_16, { showLine: undefined });
		const p = page(o, 'duke-of-carrowmere');
		tap(p.querySelector('button.dynasty-succ-show'));
		expect(openModals).not.toContain(o.win);
	});
});

describe('the phone layout', () => {
	const phone = (body = BODY_16): Opened => {
		device.width = 390;
		device.coarse = true;
		return openWin(body);
	};

	it('shows Rule, Who can inherit, The right to inherit comes from and the illegitimate choice as lists of buttons', async () => {
		const o = phone();
		const p = page(o, 'countess-of-harrowfen');
		expect(o.modal.hasClass('is-phone')).toBe(true);
		for (const key of ['rule', 'inherit', 'through', 'illegitimate']) {
			const group = ctl(p, key)!;
			expect(group.getAttribute('role')).toBe('radiogroup');
			expect(group.querySelector('select')).toBeNull();
			expect(group.querySelectorAll('button').length).toBeGreaterThan(2);
		}
		const picked = (key: string) => ctl(p, key)!.querySelectorAll('button').filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getText());
		expect(picked('rule')).toEqual([T.rules['youngest-child']]);
		expect(picked('inherit')).toEqual([T.inherits['women-first']]);
		expect(picked('through')).toEqual([T.throughSame]);
		expect(picked('illegitimate')).toEqual([T.ills.after]);
		// The year stays a text field.
		expect(ctl(p, 'year')!.querySelector('input')).not.toBeNull();
	});

	it('a tap on a button changes the draft and the line', async () => {
		const o = phone(mini('succession: eldest-child'));
		const p = page(o, 'crown');
		await tapChoice(p, 'rule', 'youngest-child');
		expect(lineRows(p)[0]).toBe('1stLate Ardent');
		await tapChoice(p, 'inherit', 'women-only');
		expect(lineRows(p)).toEqual(['1stMiss Ardent']);
		expect(ctl(p, 'inherit')!.querySelectorAll('button').filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getAttribute('data-value'))).toEqual(['women-only']);
		await tapChoice(p, 'illegitimate', 'equal');
		expect(o.win.isDirty()).toBe(true);
	});

	it('a button of a list has a place of 44 px or more in the style sheet', () => {
		const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
		const rule = /\.dynasty-sheet button\.dynasty-succ-choice \{[^}]*\}/.exec(css)![0];
		expect(rule).toContain('min-height: 44px');
		expect(css).toMatch(/\.dynasty-succ-body select\.dynasty-sheet-input,\s*\.dynasty-succ-body input\.dynasty-succ-year \{\s*min-height: 44px;/);
	});

	it('changes from dropdowns to buttons when the window gets narrow', async () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		expect(ctl(p, 'rule')!.querySelector('select')).not.toBeNull();
		device.width = 390;
		dispatchWindow('resize');
		await settle();
		expect(o.modal.hasClass('is-phone')).toBe(true);
		expect(ctl(p, 'rule')!.querySelector('select')).toBeNull();
		expect(ctl(p, 'rule')!.querySelectorAll('button').length).toBe(6);
	});
});

describe('the list of titles', () => {
	it('marks a title with a changed succession key as changed', () => {
		const o = openWin();
		const p = page(o, 'duke-of-carrowmere');
		choose(p, 'rule', 'youngest-child');
		backToList(o.content);
		expect(o.content.querySelector('button[data-title="duke-of-carrowmere"]')!.getText()).toContain('Changed');
	});
});
