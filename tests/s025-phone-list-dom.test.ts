import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { listData, listWord } from '../src/obsidian/phone-list';
import { buildPhoneList, setListEditable, showListPicture, type PhoneListSpec } from '../src/render/dom/phone-list-dom';
import { PHONE_LIST_UI } from '../src/render/ui-text';
import { FEl, dispatch, installDom, resetDom } from './acceptance/fake-dom';
import { iconCalls, resetObsidian } from './acceptance/fake-obsidian';
import { build } from './helpers';

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
			expect(b.getAttribute('aria-label')).toBeTruthy();
		}
	});
});

describe('sections, headings and rows', () => {
	it('has the sections parents, person and children in this order', () => {
		const { list } = make();
		expect(list.querySelectorAll('.dynasty-list-section').map((s) => s.getAttribute('data-section'))).toEqual(['parents', 'person', 'children']);
		expect(list.querySelectorAll('.dynasty-list-head').map((h) => h.getText())).toEqual([PHONE_LIST_UI.headParents, PHONE_LIST_UI.headYou, PHONE_LIST_UI.headChildren]);
	});

	it('says "This person" when the centre is not the marked person, and leaves out empty sections', () => {
		const { list } = make({ centre: 'lena' });
		expect(list.querySelectorAll('.dynasty-list-head').map((h) => h.getText())).toEqual([PHONE_LIST_UI.headParents, PHONE_LIST_UI.headPerson]);
		expect(list.querySelector('[data-section="children"]')).toBeNull();
		const top = make({ centre: 'aldric' });
		expect(top.list.querySelector('[data-section="parents"]')).toBeNull();
	});

	it('lists the rows in order and counts them', () => {
		const { list, res } = make();
		const ids = list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person'));
		expect(ids).toEqual(['aldric', 'isolde', 'gareth', 'roderick', 'marta', 'lena', 'kit', 'pia']);
		expect(res.rows).toBe(ids.length);
	});

	it('writes the sub-headings of the children, with the years of the partner', () => {
		const { list } = make();
		expect(list.querySelectorAll('.dynasty-list-sub').map((h) => h.getText())).toEqual([PHONE_LIST_UI.withPartner('Marta', '1133–1170'), PHONE_LIST_UI.noPartner, PHONE_LIST_UI.otherChildren]);
	});

	it('leaves the years out of rows and sub-headings when dates are off', () => {
		const { list } = make({ showDates: false });
		expect(list.querySelector('.dynasty-list-sub')!.getText()).toBe(PHONE_LIST_UI.withPartner('Marta'));
		expect(row(list, 'marta').querySelector('.dynasty-list-meta')).toBeNull();
	});

	it('marks the marked person and says "You"', () => {
		const { list } = make();
		expect(row(list, 'roderick').classes.has('dynasty-list-me')).toBe(true);
		expect(row(list, 'aldric').classes.has('dynasty-list-me')).toBe(false);
		expect(row(list, 'roderick').querySelector('.dynasty-list-word')!.getText()).toBe('You');
	});

	it('shows the name, the sobriquet in curly marks, the word, the years and the title', () => {
		const { list } = make();
		const r = row(list, 'roderick');
		expect(r.querySelector('.dynasty-list-name')!.getText()).toBe(`Roderick ${'“'}the Bold${'”'}`);
		expect(r.querySelector('.dynasty-list-sob')!.getText()).toBe(` “the Bold”`);
		expect(r.querySelector('.dynasty-list-meta')!.getText()).toBe('You · 1131–1190');
		const a = row(list, 'aldric');
		expect(a.querySelector('.dynasty-list-meta')!.getText()).toBe('Father · b. 1102');
		expect(a.querySelector('.dynasty-list-title')!.getText()).toBe('Duke of Valmont');
	});

	it('shows no word and a lone year line for a person that has no word', () => {
		const { list } = make();
		const m = row(list, 'marta');
		expect(m.querySelector('.dynasty-list-word')).toBeNull();
		expect(m.querySelector('.dynasty-list-meta')!.getText()).toBe('1133–1170');
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
		expect(row(list, 'aldric').querySelector('.dynasty-list-go')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.goLabel('Aldric', 'father'));
		expect(row(list, 'marta').querySelector('.dynasty-list-go')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.goLabel('Marta'));
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
		expect(pencil.getAttribute('aria-label')).toBe(PHONE_LIST_UI.editLabel('Marta'));
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
		expect(buttons[0].getAttribute('aria-label')).toBe(PHONE_LIST_UI.editLabel('Roderick'));
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
	it('asks for the two picture places of every row, empty at first', () => {
		const { list, spy } = make();
		expect(spy.slots).toEqual(list.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')));
		expect(list.querySelectorAll('.dynasty-list-arms')).toHaveLength(spy.slots.length);
		expect(list.querySelectorAll('.dynasty-list-portrait')).toHaveLength(spy.slots.length);
		expect(list.querySelectorAll('.has-picture')).toHaveLength(0);
	});

	it('puts a picture into a slot with an empty alt text', () => {
		let slot: HTMLElement | null = null;
		make({ pictures: (s, id) => void (id === 'aldric' && (slot = s.arms)) });
		expect(slot).not.toBeNull();
		showListPicture(slot!, 'blob:copy');
		const el = slot as unknown as FEl;
		expect(el.classes.has('has-picture')).toBe(true);
		const img = el.querySelector('img')!;
		expect(img.getAttribute('src')).toBe('blob:copy');
		expect(img.getAttribute('alt')).toBe('');
		expect(img.classes.has('dynasty-picture')).toBe(true);
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
