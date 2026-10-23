import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { closePluginModals } from '../../src/view/plugin-modals';
import { FEl, clock, device, dispatch, fakeDoc, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { sample12 } from '../acceptance/relations-support';
import { click, stripNotDisabled, writingHandle } from '../support/s113-c-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * r032, fix round of WP-3 (the supervisor rulings after the G2 review). A change of a parent type, and the choice of a partnership for
 * a new child, update the page in place: the select that the user used is the same element after the choice and keeps its focus,
 * and the page and the written note equal what a build gives.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	device.coarse = true;
	device.width = 390;
	device.height = 844;
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

/** A text picture of an element and everything in it (ids and links between ids are counters, so they are left out). */
function snap(el: FEl, depth = 0): string {
	const attrs = [...el.attrs.entries()].filter(([k]) => !['id', 'for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].includes(k)).sort().map(([k, v]) => `${k}=${v}`).join(' ');
	const form = el.tag === 'select' || el.tag === 'input' || el.tag === 'option' ? ` value=${el.value} checked=${el.checked} disabled=${el.disabled}` : '';
	const head = `${'  '.repeat(depth)}<${el.tag} .${[...el.classes].sort().join('.')} ${attrs}${form}${el.hidden ? ' hidden' : ''}> ${el.text}`;
	return [head, ...el.children.map((c) => snap(c, depth + 1))].join('\n');
}

const build = (s: EditSheet) => (s as unknown as { build(): void }).build();
const modalOf = (s: EditSheet) => (s as unknown as { modalEl: FEl }).modalEl;
const contains = (root: FEl, el: FEl): boolean => root === el || root.children.some((c) => contains(c, el));

function open(body: string, personId: string) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId, sourcePath: 'n.md' })!;
	s.open();
	return { h, s, modal: modalOf(s) };
}

// Bran has a birth parent, an adoptive parent and a ward parent: he has a sibling group and the field "Shown under".
const THREE = [
	'people:',
	'  - id: a',
	'    name: Aldric',
	'  - id: c',
	'    name: Cora',
	'  - id: d',
	'    name: Dag',
	'  - id: b',
	'    name: Bran',
	'    parents: [a, { id: c, type: adoptive }, { id: d, type: ward }]',
	'  - id: e',
	'    name: Edda',
	'    parents: [a, { id: c, type: adoptive }]',
	'unions:',
	'  - partners: [a, c]',
	'',
].join('\n');

describe('Person window: a parent-type change updates the page in place', () => {
	const CASES: { name: string; body: string; person: string; parent: string; to: string }[] = [
		{ name: 'a birth parent becomes rumoured (the sibling place and "Shown under" can change)', body: THREE, person: 'b', parent: 'a', to: 'rumoured' },
		{ name: 'an adoptive parent becomes a ward', body: THREE, person: 'b', parent: 'c', to: 'ward' },
		{ name: 'a ward becomes birth (a type that is full: the other rows lock it)', body: THREE, person: 'b', parent: 'd', to: 'birth' },
		{ name: 'the only parent becomes adoptive', body: ['people:', '  - id: a', '    name: Aldric', '  - id: b', '    name: Bran', '    parents: [a]', ''].join('\n'), person: 'b', parent: 'a', to: 'adoptive' },
		{ name: 'in the window of the marked person, whose rows show relation words', body: sample12().source, person: 'gwen', parent: '', to: 'adoptive' },
	];
	for (const c of CASES) {
		it(`${c.name}: same select, same focus, and the page of a build`, async () => {
			const { h, s, modal } = open(c.body, c.person);
			const row = c.parent ? modal.querySelector(`[data-parent="${c.parent}"]`) : modal.querySelector('.dynasty-family-row[data-parent]');
			const sel = row!.querySelector('select')!;
			const parent = row!.getAttribute('data-parent')!;
			const from = sel.value;
			sel.focus();
			sel.value = c.to === from ? 'ward' : c.to;
			dispatch(sel, 'change');
			await settle();
			expect(h.ops, 'one write, as before').toEqual([expect.objectContaining({ kind: 'set-parent-type', child: c.person, parent, from })]);
			expect(modal.querySelector(`[data-parent="${parent}"] select`), 'the select the user used is the one on the page').toBe(sel);
			expect(contains(modal, sel)).toBe(true);
			expect(fakeDoc.activeElement, 'it keeps the focus').toBe(sel);
			const inPlace = snap(modal);
			build(s);
			expect(modal.querySelector(`[data-parent="${parent}"] select`)).not.toBe(sel);
			expect(snap(modal), 'the page equals the page of a build').toBe(inPlace);
		});
	}

	it('the row follows the new type and the other selects lock the types that are full', async () => {
		const { modal } = open(THREE, 'b');
		const selA = modal.querySelector('[data-parent="a"] select')!;
		const selC = modal.querySelector('[data-parent="c"] select')!;
		const disabled = (sel: FEl) => sel.children.filter((o) => o.disabled).map((o) => o.getAttribute('value'));
		expect(disabled(selC)).toEqual([]);
		selA.value = 'adoptive';
		dispatch(selA, 'change');
		await settle();
		expect(modal.querySelector('[data-parent="a"]')!.getAttribute('data-type')).toBe('adoptive');
		// Two adoptive parents is the most: the ward parent may not become adoptive, and no other row may.
		const selD = modal.querySelector('[data-parent="d"] select')!;
		expect(disabled(selD)).toEqual(['adoptive']);
		expect(modal.querySelector('[data-parent="a"] select')).toBe(selA);
	});

	it('the next change on the same select writes with the new type as "from"', async () => {
		const { h, modal } = open(THREE, 'b');
		const sel = modal.querySelector('[data-parent="a"] select')!;
		sel.value = 'rumoured';
		dispatch(sel, 'change');
		await settle();
		sel.value = 'birth';
		dispatch(sel, 'change');
		await settle();
		expect(h.ops.map((o) => [(o as { from: string }).from, (o as { to: string }).to])).toEqual([
			['birth', 'rumoured'],
			['rumoured', 'birth'],
		]);
		expect(modal.querySelector('[data-parent="a"] select')).toBe(sel);
	});

	it('the remove button of a row uses the new type', async () => {
		const { h, modal } = open(THREE, 'b');
		const sel = modal.querySelector('[data-parent="a"] select')!;
		sel.value = 'rumoured';
		dispatch(sel, 'change');
		await settle();
		await click(modal.querySelector('[data-parent="a"] .dynasty-remove-parent'));
		await settle();
		const removal = h.ops.find((o) => o.kind === 'remove-parent');
		expect(removal).toEqual(expect.objectContaining({ parent: 'a', type: 'rumoured' }));
	});

	it('a change that carries typed text writes the text too, and the page is built again (the old rule)', async () => {
		const { h, modal } = open(THREE, 'b');
		const name = modal.querySelector('[data-field="name"] input')!;
		name.value = 'Brannoc';
		dispatch(name, 'input');
		const sel = modal.querySelector('[data-parent="a"] select')!;
		sel.value = 'rumoured';
		dispatch(sel, 'change');
		await settle();
		expect(JSON.stringify(h.ops)).toContain('Brannoc');
		expect(modal.querySelector('[data-field="name"] input')!.value).toBe('Brannoc');
		expect(modal.querySelector('[data-parent="a"]')!.getAttribute('data-type')).toBe('rumoured');
	});

	it('text typed while the write runs is not lost', async () => {
		const h = writingHandle(THREE);
		let go: () => void = () => undefined;
		const gate = new Promise<void>((r) => (go = r));
		const real = h.write.getMockImplementation()!;
		h.write.mockImplementation((async (op: never) => {
			await gate;
			return (real as (o: never) => Promise<unknown>)(op);
		}) as never);
		const s = EditSheet.create({} as never, { handle: h as never, personId: 'b', sourcePath: 'n.md' })!;
		s.open();
		const modal = modalOf(s);
		const sel = modal.querySelector('[data-parent="a"] select')!;
		sel.value = 'rumoured';
		dispatch(sel, 'change');
		const name = modal.querySelector('[data-field="name"] input')!;
		name.value = 'Brannoc';
		dispatch(name, 'input');
		go();
		await settle();
		await settle();
		expect(modal.querySelector('[data-field="name"] input')).toBe(name);
		expect(name.value).toBe('Brannoc');
		expect((s as unknown as { isDirty(): boolean }).isDirty(), 'the typed name is still a change').toBe(true);
	});
});

describe('restoreFocus: the narrowed rule', () => {
	it('a build still gives the focus to a button, but not to a new select, on a touch screen', () => {
		const { s, modal } = open(THREE, 'b');
		const sel = modal.querySelector('select.dynasty-family-select')!;
		sel.focus();
		build(s);
		expect(fakeDoc.activeElement?.tag).not.toBe('select');
	});

	it('a build gives the focus back to a new select on a computer (a pointer that is not coarse)', () => {
		device.coarse = false;
		device.width = 1280;
		const { s, modal } = open(THREE, 'b');
		modal.querySelector('select.dynasty-family-select')!.focus();
		build(s);
		const now = modal.querySelector('select.dynasty-family-select')!;
		expect(fakeDoc.activeElement).toBe(now);
	});
});

const TWO_UNIONS = [
	'people:',
	'  - id: a',
	'    name: Aldric',
	'  - id: b',
	'    name: Bella',
	'unions:',
	'  - partners: [a, b]',
	'    start: 1100',
	'  - partners: [a, b]',
	'    start: 1110',
	'',
].join('\n');

describe('New-child window: the choice of a partnership updates the page in place', () => {
	async function openChild(rebuild: boolean) {
		// resetDom puts the device back to a computer; both runs use the same phone.
		device.coarse = true;
		device.width = 390;
		device.height = 844;
		const h = writingHandle(TWO_UNIONS);
		const parent = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		parent.open();
		const child = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', parentSheet: parent, newPerson: { kind: 'child', parent: 'a', other: 'b' } } as never)!;
		child.open();
		await settle();
		const modal = modalOf(child);
		const field = modal.querySelector('.dynasty-sheet-relation select')!;
		expect(field, 'the child of a couple with two partnerships asks which one').not.toBeNull();
		const name = modal.querySelector('[data-field="name"] input')!;
		name.value = 'Cade';
		dispatch(name, 'input');
		field.focus();
		field.value = '1';
		dispatch(field, 'change');
		if (rebuild) build(child);
		return { h, child, modal, field };
	}

	it('the select that the user used is the same element and keeps its focus; the empty choice is gone', async () => {
		const { modal, field } = await openChild(false);
		expect(modal.querySelector('.dynasty-sheet-relation select')).toBe(field);
		expect(fakeDoc.activeElement).toBe(field);
		expect(field.children.map((o) => o.getAttribute('value'))).toEqual(['0', '1']);
		expect(field.value).toBe('1');
	});

	it('the page equals the page of a build, and Save writes what it wrote before', async () => {
		const a = await openChild(false);
		const inPlace = snap(a.modal);
		await click(a.modal.querySelector('.dynasty-sheet-save'));
		await settle();
		const written = JSON.stringify(a.h.ops);
		expect(a.h.ops.length).toBe(1);
		expect(written).toContain('Cade');
		resetDom();
		const b = await openChild(true);
		// A build puts the focus on the window itself (tabindex -1), because it does not focus a new select on a touch screen; that is the one difference.
		const plain = (t: string) => t.replace(/ tabindex=-1/g, '').replace(/\s+/g, ' ');
		expect(plain(snap(b.modal))).toBe(plain(inPlace));
		await click(b.modal.querySelector('.dynasty-sheet-save'));
		await settle();
		expect(JSON.stringify(b.h.ops)).toBe(written);
	});

	it('a partnership that was lost: the note goes away with the choice, and Save works', async () => {
		const h = writingHandle(TWO_UNIONS);
		const parent = EditSheet.create({} as never, { handle: h as never, personId: 'a', sourcePath: 'n.md' })!;
		parent.open();
		const child = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', parentSheet: parent, newPerson: { kind: 'child', parent: 'a', other: 'b', union: { index: 7, partners: ['a', 'b'], text: 'gone' } } } as never)!;
		child.open();
		const modal = modalOf(child);
		expect(modal.querySelector('.dynasty-sheet-relation-note')).not.toBeNull();
		const field = modal.querySelector('.dynasty-sheet-relation select')!;
		field.focus();
		field.value = '0';
		dispatch(field, 'change');
		expect(modal.querySelector('.dynasty-sheet-relation-note')).toBeNull();
		expect(modal.querySelector('.dynasty-sheet-relation select')).toBe(field);
		expect((child as unknown as { relBlocked: boolean }).relBlocked).toBe(false);
	});
});
