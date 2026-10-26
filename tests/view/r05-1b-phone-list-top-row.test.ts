import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { listData, listWord } from '../../src/view/phone-list';
import { buildPhoneList, type PhoneListSpec } from '../../src/render/dom/phone-list-dom';
import { dateLine } from '../../src/render/tree-info';
import { PHONE_LIST_UI } from '../../src/render/ui-text';
import { FEl, installDom, resetDom } from '../acceptance/fake-dom';
import { accName } from '../acceptance/accessible-name';
import { resetObsidian, setIcon } from '../acceptance/fake-obsidian';
import { visual } from '../render/bidi-reference';
import { build } from '../support/helpers';

/*
 * 0.5 step 1b (D302): the top row of the phone list has the same house strip as every other row, in every colour case and with arms. And the repair of the
 * right-to-left dates: each born and died date is an isolate of its own, the dash stays outside, the text does not change. All people are made up.
 */

const TREE = `
houses:
  - {id: valmont, name: House Valmont, color: "#8b1e3f"}
  - {id: odd, name: House Odd, color: "not a colour"}
people:
  - {id: aldric, name: Aldric, sex: m, born: 1102, died: 1161, house: valmont, title: Duke of Valmont}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: gareth, name: Gareth, sex: m, born: 1104, house: ghost}
  - {id: pia, name: Pia, sex: f, born: 1135, house: odd, parents: [aldric, isolde]}
  - {id: nur, name: Nur, sex: f, born: "حوالي 1108", died: 1170, house: valmont, parents: [aldric, isolde]}
  - {id: yusuf, name: Yusuf, sex: m, born: 1109, died: "حوالي 1171", parents: [aldric, isolde]}
  - {id: sal, name: Sal, sex: m, born: 1112, died: yes, parents: [aldric, isolde]}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;
const g = build(TREE).g;

function make(centre: string, over: Partial<PhoneListSpec> = {}): { list: FEl; row: FEl } {
	const parent = new FEl('div', { cls: 'dynasty-viewport' });
	const spec: PhoneListSpec = {
		g,
		data: listData(g, centre),
		me: null,
		showDates: true,
		editable: true,
		word: (id) => listWord(id, { me: null, showRelations: false, cards: new Map() }),
		icon: setIcon as unknown as PhoneListSpec['icon'],
		onGo: () => undefined,
		onEdit: () => undefined,
		...over,
	};
	const list = buildPhoneList(parent as unknown as HTMLElement, spec).list as unknown as FEl;
	return { list, row: list.querySelector(`.dynasty-list-row[data-person="${centre}"]`)! };
}

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});
afterAll(() => {
	delete (globalThis as Record<string, unknown>).CSS;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});

const css = readFileSync('styles.css', 'utf8');
const rule = (selector: string): string => {
	const at = css.indexOf(`\n${selector} {`);
	return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('D302: the top row has the house strip', () => {
	const strips = (row: FEl) => row.querySelectorAll('.dynasty-list-strip');

	it('has one strip, the first part of the row button, hidden from screen readers, with the house colour only as the custom property of the row', () => {
		const { row } = make('aldric');
		expect(row.classes.has('dynasty-list-hero')).toBe(true);
		expect(strips(row)).toHaveLength(1);
		const strip = strips(row)[0];
		expect(strip.getAttribute('aria-hidden')).toBe('true');
		// R05 look repair 2: the strip and the text stand in one lead box (the first part of the row button), so the strip is as tall as the text.
		const lead = strip.parentElement!;
		expect(lead.classes.has('dynasty-list-lead')).toBe(true);
		expect(lead.parentElement!.classes.has('dynasty-list-whole')).toBe(true);
		expect(lead.parentElement!.children[0]).toBe(lead);
		expect(lead.children.map((c) => [...c.classes][0])).toEqual(['dynasty-list-strip', 'dynasty-list-text']);
		expect(row.styleProps.get('--dynasty-house-color')).toBe('#8b1e3f');
		expect(row.classes.has('dynasty-has-house')).toBe(true);
		for (const k of ['style', 'fill', 'stroke', 'color']) expect(strip.attrs.has(k)).toBe(false);
	});

	it('has the strip also when the house has arms (the arms still show, in their column)', () => {
		const { row } = make('aldric', { has: () => ({ portrait: false, arms: true }) });
		expect(strips(row)).toHaveLength(1);
		expect(row.querySelectorAll('.dynasty-hero-arms')).toHaveLength(1);
		expect(row.styleProps.get('--dynasty-house-color')).toBe('#8b1e3f');
	});

	it('has the strip with a portrait and arms', () => {
		const { row } = make('aldric', { has: () => ({ portrait: true, arms: true }) });
		expect(strips(row)).toHaveLength(1);
		expect(row.querySelectorAll('.dynasty-hero-portrait, .dynasty-hero-arms')).toHaveLength(2);
	});

	it('has the strip with no arms', () => {
		const { row } = make('aldric', { has: () => ({ portrait: false, arms: false }) });
		expect(strips(row)).toHaveLength(1);
		expect(row.querySelector('.dynasty-hero-col')).toBeNull();
	});

	for (const [name, id] of [['no house', 'isolde'], ['an unknown house id', 'gareth'], ['a house with no valid colour', 'pia']] as const) {
		it(`has the neutral strip for ${name}: the strip is there and the row writes no colour`, () => {
			const { row } = make(id);
			expect(strips(row)).toHaveLength(1);
			expect(row.styleProps.size).toBe(0);
			expect(row.classes.has('dynasty-has-house')).toBe(false);
		});
	}

	it('keeps the same strip in the other rows (parents, partners, children), with no lead box', () => {
		const { list } = make('aldric');
		for (const r of list.querySelectorAll('.dynasty-list-row')) expect(strips(r), r.getAttribute('data-person') ?? '').toHaveLength(1);
		const small = Array.from(list.querySelectorAll('.dynasty-list-row')).filter((r) => !r.classes.has('dynasty-list-hero'));
		expect(small.length).toBeGreaterThan(0);
		for (const r of small) {
			expect(r.querySelector('.dynasty-list-lead'), r.getAttribute('data-person') ?? '').toBeNull();
			expect(r.querySelector('.dynasty-list-strip')!.parentElement!.classes.has('dynasty-list-go')).toBe(true);
		}
		expect(list.querySelectorAll('.dynasty-list-lead')).toHaveLength(1);
	});

	it('makes the lead box a flex row that stretches the strip to the height of the text, with the strip rule kept', () => {
		const lead = rule('.dynasty-list-lead');
		expect(lead).toMatch(/display:\s*flex/);
		expect(lead).toMatch(/align-items:\s*stretch/);
		expect(lead).toMatch(/gap:\s*12px/);
		expect(lead).toMatch(/flex:\s*1 1 auto/);
		expect(lead).toMatch(/min-width:\s*0/);
		expect(rule('.dynasty-list-strip')).toMatch(/align-self:\s*stretch/);
	});

	it('does not change the accessible name or the text of the top row', () => {
		const { row } = make('aldric');
		expect(accName(row.querySelector('button')!)).toBe(PHONE_LIST_UI.editLabel('Aldric'));
		expect(row.querySelector('.dynasty-list-text')!.getText()).toContain('Aldric');
	});

	it('draws the strip from the neutral border colour by default and from the house colour in both themes, with no colour value in the rule', () => {
		const strip = rule('.dynasty-list-strip');
		expect(strip).toContain('var(--dynasty-house-color, var(--background-modifier-border-hover))');
		expect(strip).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
		// The dark rule is for every row with a house: the top row is a .dynasty-list-row too.
		expect(css).toContain('.theme-dark .dynasty-list-row.dynasty-has-house .dynasty-list-strip');
	});
});

describe('D302 repair: right-to-left dates in the list', () => {
	/** What a browser makes of the row: an element with dir="auto" and the isolate rule is a first-strong isolate (U+2068 ... U+2069). */
	const bidiText = (el: FEl): string => {
		const inner = el.text + el.children.map(bidiText).join('');
		return el.getAttribute('dir') === 'auto' ? `⁨${inner}⁩` : inner;
	};
	const rtl = (s: string) => Array.from(s).reverse().join('');
	const topYears = (centre: string) => make(centre).row.querySelector('.dynasty-list-years')!;
	const rowYears = (id: string) => make('aldric').list.querySelector(`.dynasty-list-row[data-person="${id}"] .dynasty-list-years`)!;

	it('puts the born and the died date each in an element with dir="auto" and the dash outside', () => {
		const y = rowYears('nur');
		expect(y.children.map((c) => [c.attrs.get('dir') ?? '', c.getText()])).toEqual([['auto', 'حوالي 1108'], ['', '–'], ['auto', '1170']]);
		for (const c of y.children.filter((x) => x.getAttribute('dir'))) expect(c.classes.has('dynasty-list-date')).toBe(true);
		expect(y.children[1].classes.has('dynasty-list-date')).toBe(false);
	});

	it('also for the died date, and for one date alone with its sign', () => {
		expect(rowYears('yusuf').children.map((c) => c.attrs.get('dir') ?? '')).toEqual(['auto', '', 'auto']);
		expect(rowYears('sal').children.map((c) => [c.attrs.get('dir') ?? '', c.getText()])).toEqual([['', 'b. '], ['auto', '1112'], ['', ' †']]);
	});

	it('keeps the text exactly as dateLine gives it: no control character, the same textContent', () => {
		for (const id of ['nur', 'yusuf', 'sal', 'pia']) {
			const y = rowYears(id);
			expect(y.getText(), id).toBe(dateLine(g.byId.get(id)!, g.dates));
			expect(y.getText()).not.toMatch(/[⁦-⁩‎‏؜]/);
		}
		expect(topYears('aldric').getText()).toBe(dateLine(g.byId.get('aldric')!, g.dates));
	});

	it('is set also in the top row', () => {
		expect(topYears('nur').children.map((c) => c.attrs.get('dir') ?? '')).toEqual(['auto', '', 'auto']);
	});

	it('shows the dates in the order they are written (UAX #9 reference): the born part, the dash, the died part', () => {
		const word = 'حوالي';
		const plain = dateLine(g.byId.get('nur')!, g.dates)!;
		// The fault: with no isolate the range turns round.
		expect(visual(plain, 0)).toBe(`1170–1108 ${rtl(word)}`);
		expect(visual(bidiText(rowYears('nur')), 0)).toBe(`1108 ${rtl(word)}–1170`);
		// The Arabic word in the died date: the born year, the dash, then the died part.
		expect(visual(bidiText(rowYears('yusuf')), 0)).toBe(`1109–1171 ${rtl(word)}`);
	});

	it('has the isolate rule in the CSS for the date element', () => {
		expect(rule('.dynasty-list-date')).toContain('unicode-bidi: isolate');
	});
});
