import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { linkWord, listData, listWord } from '../src/obsidian/phone-list';
import { buildPhoneList, setListEditable, showListPicture, type PhoneListSpec } from '../src/render/dom/phone-list-dom';
import { PHONE_LIST_UI } from '../src/render/ui-text';
import { FEl, dispatch, installDom, resetDom } from './acceptance/fake-dom';
import { iconCalls, resetObsidian } from './acceptance/fake-obsidian';
import { build } from './helpers';
import { accName } from './acceptance/accessible-name';

/*
 * 0.2.5, WP-C2a (D144; contract C.3.1): the DOM of the phone list, on the fake DOM. Roles and names, the sections and
 * sub-headings, the two kinds of tap, read-only, the house colour and the pictures. All people are made up.
 */

const TREE = `
houses:
  - {id: valmont, name: House Valmont, color: "#8b1e3f"}
  - {id: odd, name: House Odd, color: "not a colour"}
people:
  - {id: aldric, name: Aldric, sex: m, born: 1102, house: valmont, title: Duke of Valmont}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: gareth, name: Gareth, sex: m, born: 1104}
  - {id: roderick, name: Roderick, sobriquet: the Bold, sex: m, born: 1131, died: 1190, house: valmont, parents: [aldric, isolde, {id: gareth, type: rumoured}]}
  - {id: pia, name: Pia, sex: f, born: 1135, house: odd, parents: [aldric, isolde, {id: roderick, type: adoptive}]}
  - {id: marta, name: Marta, sex: f, born: 1133, died: 1170}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick, marta]}
  - {id: kit, name: Kit, sex: m, parents: [roderick]}
unions:
  - {partners: [aldric, isolde], type: marriage}
  - {partners: [roderick, marta], type: marriage}
`;
const g = build(TREE).g;

type Spy = { go: string[]; edit: [string, boolean][]; slots: string[] };

function make(over: Partial<PhoneListSpec> & { centre?: string } = {}): { parent: FEl; spy: Spy; list: FEl; res: ReturnType<typeof buildPhoneList> } {
	const spy: Spy = { go: [], edit: [], slots: [] };
	const centre = over.centre ?? 'roderick';
	const cards = new Map([
		['aldric', { text: 'Father', lower: 'father' }],
		['pia', { text: 'Sister', lower: 'sister' }],
	]);
	const parent = new FEl('div', { cls: 'dynasty-viewport' });
	const spec: PhoneListSpec = {
		g,
		data: listData(g, centre),
		me: 'roderick',
		showDates: true,
		editable: true,
		word: (id) => listWord(id, { me: 'roderick', showRelations: true, cards }),
		pictures: (_slots, id) => void spy.slots.push(id),
		onGo: (id) => void spy.go.push(id),
		onEdit: (id, tap) => void spy.edit.push([id, tap]),
		...over,
	};
	const res = buildPhoneList(parent as unknown as HTMLElement, spec);
	return { parent, spy, list: res.list as unknown as FEl, res };
}

const row = (list: FEl, id: string) => list.querySelector(`.dynasty-list-row[data-person="${id}"]`)!;

beforeAll(() => {
	installDom();
	// The fake window has no CSS object; this one accepts a hex colour and refuses the rest.
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

afterAll(() => {
	delete (globalThis as Record<string, unknown>).CSS;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

/** The text line of a row without the spaces round the marks "·" (the marks are elements of their own). */
const metaText = (r: FEl) => (r.querySelector('.dynasty-list-meta')?.getText() ?? '').replace(/\s*·\s*/g, ' · ').trim();

describe('the list element and its roles', () => {
	it('is a region named for the person in the middle', () => {
		const { list } = make();
		expect(list.classes.has('dynasty-list')).toBe(true);
		expect(list.getAttribute('role')).toBe('region');
		expect(list.getAttribute('aria-label')).toBe(PHONE_LIST_UI.region('Roderick'));
	});

	it('uses only div, span and button: no ul, li or h1 to h6', () => {
		const { list } = make();
		const tags = new Set(list.all().map((e) => e.tag));
		expect([...tags].sort()).toEqual(['button', 'div', 'span']);
		for (const t of ['ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) expect(tags.has(t)).toBe(false);
	});

	it('gives each heading the role heading, a level and tabindex -1, and each row the role group', () => {
		const { list } = make();
		for (const h of list.querySelectorAll('.dynasty-list-head')) {
			expect(h.getAttribute('role')).toBe('heading');
			expect(h.getAttribute('aria-level')).toBe('3');
			expect(h.getAttribute('tabindex')).toBe('-1');
		}
		for (const s of list.querySelectorAll('.dynasty-list-sub')) expect(s.getAttribute('role')).toBe('heading');
		for (const r of list.querySelectorAll('.dynasty-list-row')) expect(r.getAttribute('role')).toBe('group');
	});

	it('makes every button a plain button with a name', () => {
		const { list } = make();
		const buttons = list.querySelectorAll('button');
		expect(buttons.length).toBeGreaterThan(0);
		for (const b of buttons) {
			expect(b.getAttribute('type')).toBe('button');
			expect(accName(b)).toBeTruthy();
			expect(b.getAttribute('aria-label')).toBeNull();
		}
	});
});

describe('sections, headings and rows', () => {
	it('has the sections person, parents, partners and children in this order (D209)', () => {
		const { list } = make();
		expect(list.querySelectorAll('.dynasty-list-section').map((s) => s.getAttribute('data-section'))).toEqual(['person', 'parents', 'partners', 'children']);
		expect(list.querySelectorAll('.dynasty-list-head').map((h) => h.getText())).toEqual([PHONE_LIST_UI.headYou, PHONE_LIST_UI.headParents, PHONE_LIST_UI.headPartner, PHONE_LIST_UI.headChildren]);
	});

	it('says "This person" when the centre is not the marked person, and leaves out empty sections', () => {
		const { list } = make({ centre: 'lena' });
		expect(list.querySelectorAll('.dynasty-list-head').map((h) => h.getText())).toEqual([PHONE_LIST_UI.headPerson, PHONE_LIST_UI.headParents]);
		expect(list.querySelector('[data-section="children"]')).toBeNull();
		expect(list.querySelector('[data-section="partners"]')).toBeNull();
		const top = make({ centre: 'aldric' });
		expect(top.list.querySelector('[data-section="parents"]')).toBeNull();
	});

	it('writes each heading in the singular for one row and the plural for more (D209 item 7)', () => {
		const heads = (centre: string) => make({ centre }).list.querySelectorAll('.dynasty-list-head').map((h) => h.getText());
		// Lena has two parents; Marta has one child (Lena) and one partner; Aldric has three children and one partner.
		expect(heads('lena')).toEqual([PHONE_LIST_UI.headPerson, PHONE_LIST_UI.headParents]);
		expect(heads('marta')).toEqual([PHONE_LIST_UI.headPerson, PHONE_LIST_UI.headPartner, PHONE_LIST_UI.headChild]);
		expect(heads('aldric')).toEqual([PHONE_LIST_UI.headPerson, PHONE_LIST_UI.headPartner, PHONE_LIST_UI.headChildren]);
	});

	it('lists the rows in order and counts them', () => {
		const { list, res } = make();
		const ids = list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person'));
		expect(ids).toEqual(['roderick', 'aldric', 'isolde', 'gareth', 'marta', 'lena', 'kit', 'pia']);
		expect(res.rows).toBe(ids.length);
	});

	it('writes the sub-headings of the children with the name of the partner only, and only when there is more than one group (D209 item 7)', () => {
		const { list } = make();
		expect(list.querySelectorAll('.dynasty-list-sub').map((h) => h.getText())).toEqual([PHONE_LIST_UI.withPartner('Marta'), PHONE_LIST_UI.noPartner, PHONE_LIST_UI.otherChildren]);
		// Marta's one group: no sub-heading. Aldric's one group: none either.
		expect(make({ centre: 'marta' }).list.querySelectorAll('.dynasty-list-sub')).toHaveLength(0);
		expect(make({ centre: 'aldric' }).list.querySelectorAll('.dynasty-list-sub')).toHaveLength(0);
	});

	it('leaves the years out of rows when dates are off', () => {
		const { list } = make({ showDates: false });
		expect(row(list, 'marta').querySelector('.dynasty-list-meta')).toBeNull();
	});

	it('marks the marked person and says "You"', () => {
		const { list } = make();
		expect(row(list, 'roderick').classes.has('dynasty-list-me')).toBe(true);
		expect(row(list, 'aldric').classes.has('dynasty-list-me')).toBe(false);
		expect(row(list, 'roderick').querySelector('.dynasty-list-word')!.getText()).toBe('You');
		// D209 item 1: "You" is the strong word; a relation word is not.
		expect(row(list, 'roderick').querySelector('.dynasty-list-word')!.classes.has('is-strong')).toBe(true);
		expect(row(list, 'aldric').querySelector('.dynasty-list-word')!.classes.has('is-strong')).toBe(false);
	});

	it('shows the name, the sobriquet in curly marks, the word, the years and the title', () => {
		const { list } = make();
		const r = row(list, 'roderick');
		expect(r.querySelector('.dynasty-list-name')!.getText()).toBe(`Roderick ${'“'}the Bold${'”'}`);
		expect(r.querySelector('.dynasty-list-sob')!.getText()).toBe('“the Bold”');
		// 0.2.8 (G.2): the items are one joined text line; the "·" between them is a mark of its own, so the text is read without the spaces round it.
		expect(metaText(r)).toBe('You · 1131–1190');
		const a = row(list, 'aldric');
		expect(metaText(a)).toBe('Father · b. 1102 · Duke of Valmont');
		expect(a.querySelector('.dynasty-list-title')!.getText()).toBe('Duke of Valmont');
	});

	it('shows no word and a lone year line for a person that has no word', () => {
		const { list } = make();
		const m = row(list, 'marta');
		expect(m.querySelector('.dynasty-list-word')).toBeNull();
		expect(metaText(m)).toBe('1133–1170');
		expect(row(list, 'kit').querySelector('.dynasty-list-meta')).toBeNull();
	});

	it('takes the name from the card label when the caller passes labels', () => {
		const labels = new Map([['roderick', { name: 'Roderick II', title: 'Duke of Valmont' }]]) as unknown as PhoneListSpec['labels'];
		const { list } = make({ labels });
		expect(row(list, 'roderick').querySelector('.dynasty-list-name')!.getText()).toContain('Roderick II');
		expect(row(list, 'roderick').querySelector('.dynasty-list-title')!.getText()).toBe('Duke of Valmont');
	});

	it('speaks the relation in the accessible name of the name button', () => {
		const { list } = make();
		expect(accName(row(list, 'aldric').querySelector('.dynasty-list-go')!)).toBe(PHONE_LIST_UI.goLabel('Aldric', 'father'));
		expect(accName(row(list, 'marta').querySelector('.dynasty-list-go')!)).toBe(PHONE_LIST_UI.goLabel('Marta'));
	});
});

describe('colour', () => {
	it('sets the house colour only as the custom property on the row', () => {
		const { list } = make();
		const r = row(list, 'aldric');
		expect(r.styleProps.get('--dynasty-house-color')).toBe('#8b1e3f');
		expect(r.classes.has('dynasty-has-house')).toBe(true);
		for (const e of list.all()) for (const k of e.styleProps.keys()) expect(k.startsWith('--dynasty-')).toBe(true);
	});

	it('writes nothing for a person with no house or a colour that CSS refuses', () => {
		const { list } = make();
		expect(row(list, 'isolde').styleProps.size).toBe(0);
		expect(row(list, 'isolde').classes.has('dynasty-has-house')).toBe(false);
		expect(row(list, 'pia').styleProps.size).toBe(0);
	});

	it('has no colour, style or fill attribute on any element', () => {
		const { list } = make();
		for (const e of list.all()) for (const k of ['style', 'fill', 'stroke', 'color', 'stop-color']) expect(e.attrs.has(k), `${e.tag}.${[...e.classes].join('.')} has ${k}`).toBe(false);
	});
});

describe('the two kinds of tap', () => {
	it('moves the list from the name button of another person', () => {
		const { list, spy } = make();
		dispatch(row(list, 'marta').querySelector('.dynasty-list-go')!, 'click');
		expect(spy.go).toEqual(['marta']);
		expect(spy.edit).toEqual([]);
	});

	it('opens the sheet from the pencil of another person, with fromTap only for a finger or a pen', () => {
		const { list, spy } = make();
		const pencil = row(list, 'marta').querySelector('.dynasty-list-edit')!;
		dispatch(pencil, 'click');
		dispatch(pencil, 'click', { pointerType: 'mouse' });
		dispatch(pencil, 'click', { pointerType: 'touch' });
		dispatch(pencil, 'click', { pointerType: 'pen' });
		expect(spy.edit).toEqual([
			['marta', false],
			['marta', false],
			['marta', true],
			['marta', true],
		]);
		expect(spy.go).toEqual([]);
		expect(accName(pencil)).toBe(PHONE_LIST_UI.editLabel('Marta'));
		expect(iconCalls).toContain('pencil');
	});

	it('gives the centre row one button that edits and covers the row', () => {
		const { list, spy } = make();
		const r = row(list, 'roderick');
		const buttons = r.querySelectorAll('button');
		expect(buttons).toHaveLength(1);
		expect(buttons[0].classes.has('dynasty-list-edit')).toBe(true);
		expect(buttons[0].classes.has('dynasty-list-whole')).toBe(true);
		expect(buttons[0].classes.has('dynasty-list-go')).toBe(false);
		expect(accName(buttons[0])).toBe(PHONE_LIST_UI.editLabel('Roderick'));
		dispatch(buttons[0], 'click', { pointerType: 'touch' });
		expect(spy.edit).toEqual([['roderick', true]]);
		expect(spy.go).toEqual([]);
	});

	it('gives every other row a name button and a pencil, and no more', () => {
		const { list } = make();
		for (const r of list.querySelectorAll('.dynasty-list-row')) {
			if (r.getAttribute('data-person') === 'roderick') continue;
			expect(r.querySelectorAll('button')).toHaveLength(2);
			expect(r.querySelectorAll('.dynasty-list-go')).toHaveLength(1);
			expect(r.querySelectorAll('.dynasty-list-edit')).toHaveLength(1);
		}
	});
});

describe('a read-only tree', () => {
	it('hides the pencils, makes the centre button inert and still moves the list', () => {
		const { list, spy } = make({ editable: false });
		expect(list.classes.has('is-read-only')).toBe(true);
		expect(row(list, 'marta').querySelector('.dynasty-list-edit')!.hidden).toBe(true);
		const whole = row(list, 'roderick').querySelector('.dynasty-list-edit')!;
		expect(whole.disabled).toBe(true);
		dispatch(whole, 'click');
		dispatch(row(list, 'marta').querySelector('.dynasty-list-edit')!, 'click');
		expect(spy.edit).toEqual([]);
		dispatch(row(list, 'marta').querySelector('.dynasty-list-go')!, 'click');
		expect(spy.go).toEqual(['marta']);
	});

	it('changes with setListEditable', () => {
		const { list, spy } = make({ editable: false });
		setListEditable(list as unknown as HTMLElement, true);
		expect(row(list, 'marta').querySelector('.dynasty-list-edit')!.hidden).toBe(false);
		expect(row(list, 'roderick').querySelector('.dynasty-list-edit')!.disabled).toBe(false);
		dispatch(row(list, 'marta').querySelector('.dynasty-list-edit')!, 'click');
		expect(spy.edit).toEqual([['marta', false]]);
		setListEditable(list as unknown as HTMLElement, false);
		expect(row(list, 'marta').querySelector('.dynasty-list-edit')!.hidden).toBe(true);
	});
});

describe('pictures and focus', () => {
	// Roderick (the centre, with a portrait and the arms of his house), Aldric (a portrait) and Marta (none).
	const has = (id: string) => ({ portrait: id === 'roderick' || id === 'aldric', arms: id === 'roderick' });

	it('makes a picture place only for a picture that the person has (D213)', () => {
		const { list, spy } = make({ has });
		expect(spy.slots).toEqual(list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')));
		// The large row: a column with the portrait and the arms. Aldric: a small portrait. No other row has a place, and none has an initials disc.
		expect(list.querySelectorAll('.dynasty-hero-col')).toHaveLength(1);
		expect(list.querySelectorAll('.dynasty-hero-portrait')).toHaveLength(1);
		expect(list.querySelectorAll('.dynasty-hero-arms')).toHaveLength(1);
		expect(list.querySelectorAll('.dynasty-list-portrait')).toHaveLength(1);
		expect(row(list, 'aldric').querySelector('.dynasty-list-portrait')).not.toBeNull();
		expect(row(list, 'marta').querySelector('.dynasty-list-pics')).toBeNull();
		expect(list.querySelectorAll('.dynasty-hero-pic')).toHaveLength(0);
		expect(list.querySelectorAll('.dynasty-mono')).toHaveLength(0);
		expect(list.querySelectorAll('.has-picture')).toHaveLength(0);
	});

	it('makes no column for the large row of a person with no picture, and the arms alone get a column with no portrait', () => {
		const none = make({ has: () => ({ portrait: false, arms: false }) });
		expect(none.list.querySelectorAll('.dynasty-hero-col')).toHaveLength(0);
		expect(row(none.list, 'roderick').querySelector('.dynasty-list-whole')!.classes.has('has-column')).toBe(false);
		const arms = make({ has: (id) => ({ portrait: false, arms: id === 'roderick' }) });
		expect(arms.list.querySelector('.dynasty-hero-col')!.classes.has('no-portrait')).toBe(true);
		expect(arms.list.querySelectorAll('.dynasty-hero-portrait')).toHaveLength(0);
		expect(row(arms.list, 'roderick').querySelector('.dynasty-list-whole')!.classes.has('has-column')).toBe(true);
	});

	it('without has, decides from the data: a portrait link, and for the centre the arms of the person or the house; arms in no other row (D209 rule A)', () => {
		const withPics = build(`
houses:
  - {id: h, name: House H, arms: "[[h.png]]"}
people:
  - {id: a, name: A, house: h, portrait: "[[a.png]]"}
  - {id: b, name: B, house: h, portrait: "[[b.png]]", parents: [a]}
  - {id: c, name: C, parents: [a]}
`).g;
		const base = { g: withPics, data: listData(withPics, 'a'), me: null, showDates: false, editable: true, word: () => null, onGo: () => undefined, onEdit: () => undefined };
		const list = buildPhoneList(new FEl('div', { cls: 'dynasty-viewport' }) as unknown as HTMLElement, base).list as unknown as FEl;
		expect(list.querySelectorAll('.dynasty-hero-arms')).toHaveLength(1);
		expect(list.querySelectorAll('.dynasty-hero-portrait')).toHaveLength(1);
		expect(row(list, 'b').querySelectorAll('.dynasty-list-portrait')).toHaveLength(1);
		expect(row(list, 'b').querySelector('.dynasty-hero-arms')).toBeNull();
		expect(row(list, 'c').querySelector('.dynasty-list-portrait')).toBeNull();
		const off = buildPhoneList(new FEl('div', { cls: 'dynasty-viewport' }) as unknown as HTMLElement, { ...base, showPortraits: false }).list as unknown as FEl;
		expect(off.querySelectorAll('.dynasty-list-portrait, .dynasty-hero-portrait')).toHaveLength(0);
	});

	it('puts a picture into a slot with an empty alt text, and does nothing for a place that was not made', () => {
		let slot: HTMLElement | undefined;
		make({ has, pictures: (s, id) => void (id === 'aldric' && (slot = s.portrait)) });
		expect(slot).toBeDefined();
		showListPicture(slot, 'blob:copy');
		const el = slot as unknown as FEl;
		expect(el.classes.has('has-picture')).toBe(true);
		const img = el.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('blob:copy');
		expect(img.getAttribute('alt')).toBe('');
		expect(img.classes.has('dynasty-picture')).toBe(true);
		expect(() => showListPicture(undefined, 'blob:copy')).not.toThrow();
	});

	it('returns the heading of the centre section for the focus', () => {
		const { res, list } = make();
		const centre = res.centre as unknown as FEl;
		expect(centre.classes.has('dynasty-list-head')).toBe(true);
		expect(centre.getText()).toBe(PHONE_LIST_UI.headYou);
		expect(list.querySelector('[data-section="person"]')!.children[0]).toBe(centre);
	});

	it('marks a person who is a child by a side link only', () => {
		const { list } = make();
		expect(row(list, 'gareth').getAttribute('data-link')).toBe('rumoured');
		expect(row(list, 'pia').getAttribute('data-link')).toBe('adoptive');
		expect(row(list, 'aldric').getAttribute('data-link')).toBeNull();
	});
});

describe('the kind of link as the first item of the text line (D210)', () => {
	const spec = (centre: string, me: string | null, showRelations = true): Partial<PhoneListSpec> & { centre: string } => {
		const data = listData(g, centre);
		const cards = new Map([['aldric', { text: 'Father', lower: 'father' }]]);
		return { centre, data, me, link: (r) => linkWord(g, data, r), word: (id) => listWord(id, { me, showRelations, cards }) };
	};

	it('puts the link word first in plain italic, and the label names the link', () => {
		const { list } = make(spec('roderick', 'roderick'));
		const pia = row(list, 'pia');
		expect(metaText(pia)).toBe('Adopted daughter · b. 1135');
		expect(pia.querySelector('.dynasty-list-link')!.classes.has('dynasty-list-word')).toBe(false);
		expect(accName(pia.querySelector('.dynasty-list-go')!)).toBe(PHONE_LIST_UI.goLabel('Pia', undefined, { lower: 'adopted daughter', of: 'Roderick' }));
		expect(accName(pia.querySelector('.dynasty-list-go')!)).toContain('Pia, adopted daughter of Roderick');
		expect(metaText(row(list, 'gareth'))).toBe('Rumoured father · b. 1104');
		expect(accName(row(list, 'gareth').querySelector('.dynasty-list-go')!)).toContain('Gareth, rumoured father of Roderick');
	});

	it('keeps the relation word after the link word when the list is about someone else, also with relation names off', () => {
		// Pia is marked; the list is about Roderick. Pia is his adopted daughter, and "You" stays bold after the link word.
		const on = make(spec('roderick', 'pia')).list;
		expect(metaText(row(on, 'pia'))).toBe('Adopted daughter · You · b. 1135');
		expect(row(on, 'pia').querySelector('.dynasty-list-word')!.classes.has('is-strong')).toBe(true);
		expect(row(on, 'pia').querySelector('.dynasty-list-link')!.classes.has('is-strong')).toBe(false);
		const off = make(spec('roderick', 'aldric', false)).list;
		expect(metaText(row(off, 'pia'))).toBe('Adopted daughter · b. 1135');
		expect(metaText(row(on, 'aldric'))).toBe('Father · b. 1102 · Duke of Valmont');
	});

	it('replaces the relation word when the list is about You', () => {
		// The relation cache of the list names Pia "Sister"; the link word takes its place.
		const data = listData(g, 'roderick');
		const cards = new Map([['pia', { text: 'Daughter', lower: 'daughter' }], ['aldric', { text: 'Father', lower: 'father' }]]);
		const { list } = make({ data, me: 'roderick', link: (r) => linkWord(g, data, r), word: (id) => listWord(id, { me: 'roderick', showRelations: true, cards }) });
		expect(metaText(row(list, 'pia'))).toBe('Adopted daughter · b. 1135');
		expect(row(list, 'pia').querySelector('.dynasty-list-word')).toBeNull();
		// A birth parent has no link word, so the relation word stays.
		expect(metaText(row(list, 'aldric'))).toBe('Father · b. 1102 · Duke of Valmont');
		expect(row(list, 'aldric').querySelector('.dynasty-list-link')).toBeNull();
	});
});
