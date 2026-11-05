import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted answers for each step of a flow (choices, then the picker); the specs of the steps are kept for the texts.
const answers: unknown[] = [];
const specs: { title: string; text?: string[]; choices: { label: string; detail?: string }[]; list?: string[] }[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({
	choose: async (_app: unknown, spec: (typeof specs)[number]) => {
		specs.push(spec);
		return answers.shift() ?? null;
	},
}));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { EditSheet } from '../../src/obsidian/edit-sheet';
import { partnerLinkDetail } from '../../src/obsidian/union-edit';
import { CHANGE_UI } from '../../src/render/change-text';
import { SHEET, UNION_EDIT } from '../../src/render/ui-text';
import { FEl, clock, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';
import { writingHandle } from '../support/windows-sheets-support';

/*
 * D330 W-05, O-13, O-14, O-34 item 2, UX-03, UX-08: the partnership window (the title role, Start and End side by side, "Kind", Cancel that asks), the change line
 * after its Save, the words "ended by …" in every list of partnerships, and the words of the New or existing step of Add child and Add parent.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	answers.length = 0;
	specs.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
});

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const BODY = [
	'people:',
	'  - {id: e, name: Edmund Vane, sex: m, born: 1100}',
	'  - {id: a, name: Agnes Thorne, sex: f, born: 1105}',
	'  - {id: r, name: Rina Vane, sex: f, born: 1110}',
	'  - {id: t, name: Tilda Vane, sex: f, born: 1112}',
	'  - {id: k, name: Kit Vane, parents: [e, a], born: 1130}',
	'unions:',
	'  - {partners: [e, a], start: 1126, end: 1131, ended-by: divorce}',
	'  - {partners: [e, r], type: betrothal, start: 1140, ended-by: divorce}',
	'  - {partners: [e, t], type: handfasting, ended-by: death}',
	'',
].join('\n');

function open(body: string, id: string) {
	const h = writingHandle(body);
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return { h, s };
}
const modalOf = (s: unknown) => (s as { modalEl: FEl }).modalEl;
const top = () => openModals[openModals.length - 1] as unknown as { modalEl: FEl; contentEl: FEl };

describe('the partner row says how a marriage ended (UX-03)', () => {
	it('shows "ended by …" for a marriage and a type word of the tree, never for another kind, and only for a value that the plugin reads', () => {
		const { s } = open(BODY, 'e');
		const rows = modalOf(s).querySelectorAll('.dynasty-family-row[data-partner]');
		const text = (id: string) => rows.find((r) => r.getAttribute('data-partner') === id)!.querySelector('.dynasty-family-detail')!.getText();
		expect(text('a')).toBe('⚭ Marriage, 1126–1131, ended by divorce');
		// A betrothal never shows it, also when the note has a value (D310).
		expect(text('r')).toBe('⚭ Betrothal, from 1140');
		// A type word of the tree's own is drawn as a marriage and shows it.
		expect(text('t')).toBe('⚭ Other (handfasting), ended by death');
	});

	it('partnerLinkDetail: aliases read, unknown values and no value give no part, a missing type is a marriage', () => {
		expect(partnerLinkDetail({ type: 'marriage', start: '1126', end: '1131', endedBy: 'divorced' })).toBe('Marriage, 1126–1131, ended by divorce');
		expect(partnerLinkDetail({ type: 'marriage', endedBy: 'ANNULLED' })).toBe('Marriage, ended by annulment');
		expect(partnerLinkDetail({ type: 'marriage', endedBy: 'death' })).toBe('Marriage, ended by death');
		expect(partnerLinkDetail({ type: 'marriage', endedBy: 'moved away' })).toBe('Marriage');
		expect(partnerLinkDetail({ type: 'marriage' })).toBe('Marriage');
		expect(partnerLinkDetail({ type: 'marriage', endedBy: 'constructor' })).toBe('Marriage');
		expect(partnerLinkDetail({ type: 'concubinage', endedBy: 'divorce' })).toBe('Concubinage');
		expect(partnerLinkDetail({ type: 'affair', start: '1130', endedBy: 'death' })).toBe('Affair, from 1130');
		// A pair with no recorded partnership has no ending to show.
		expect(partnerLinkDetail({ type: null, endedBy: 'divorce' })).toBe('No recorded partnership');
	});

	it('the other-parent step of Add child and the list of "already partners" show it too', async () => {
		const { s } = open(BODY, 'e');
		// Add child: the step lists the partnerships of Edmund, in union order.
		answers.push(null);
		dispatch(modalOf(s).querySelector('.dynasty-add-child')!, 'click');
		await settle();
		const other = specs.find((x) => x.choices.some((c) => c.label === 'Agnes Thorne'))!;
		expect(other.choices.find((c) => c.label === 'Agnes Thorne')!.detail).toBe('Marriage, 1126–1131, ended by divorce');
		expect(other.choices.find((c) => c.label === 'Rina Vane')!.detail).toBe('Betrothal, from 1140');
		// Add partner, an existing person who is a partner already: the list names the partnership with the ending.
		specs.length = 0;
		answers.push('existing', { kind: 'person', id: 'a' }, null);
		dispatch(modalOf(s).querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		const already = specs.find((x) => x.list !== undefined)!;
		expect(already.list).toEqual(['Marriage, 1126–1131, ended by divorce']);
	});

	it('"Partnership of the parents" of a new child shows it', async () => {
		// Two partnerships of the same pair: the choice of the new child lists both.
		const body = BODY.replace('  - {partners: [e, r], type: betrothal, start: 1140, ended-by: divorce}', '  - {partners: [e, a], start: 1140, ended-by: annulment}');
		const h = writingHandle(body);
		const s = EditSheet.createNew({} as never, { handle: h as never, sourcePath: 'n.md', newPerson: { kind: 'child', parent: 'e', other: 'a' } } as never)!;
		s.open();
		const options = modalOf(s).querySelector('[data-field="partnership"] select')!.querySelectorAll('option').map((o) => o.getText());
		expect(options).toEqual(['Select a partnership', 'Marriage, 1126–1131, ended by divorce', 'Marriage, from 1140, ended by annulment']);
	});
});

describe('the partnership window (W-05, O-34 item 2)', () => {
	function openWindow() {
		const { h, s } = open(BODY, 'e');
		const edit = modalOf(s).querySelector('.dynasty-family-row[data-partner="a"] .dynasty-edit-union')!;
		dispatch(edit, 'click');
		return { h, s, w: top() };
	}

	it('the couple\'s names are the first line in the title role of the person window (the name font), and Start and End stand in one grid', () => {
		const { w } = openWindow();
		const title = w.modalEl.querySelector('.dynasty-union-title')!;
		expect(title.getText()).toBe(UNION_EDIT.of('Edmund Vane', 'Agnes Thorne'));
		expect(title.hasClass('dynasty-title')).toBe(true);
		expect(title.hasClass('is-name')).toBe(true);
		const body = w.modalEl.querySelector('.dynasty-sheet-body')!;
		const grid = body.querySelector('.dynasty-grid')!;
		expect(grid.querySelectorAll('.dynasty-sheet-field').map((f) => f.getAttribute('data-field'))).toEqual(['union-start', 'union-end']);
		// Kind first, then the pair of dates, then Ended by.
		const order = body.children.map((c) => c.getAttribute('data-field') ?? (c.hasClass('dynasty-grid') ? 'dates' : c.getAttribute('class')));
		expect(order.filter((o) => o === 'union-type' || o === 'dates' || o === 'union-ended-by')).toEqual(['union-type', 'dates', 'union-ended-by']);
	});

	it('the field says "Kind"; a screen reader hears "Kind of partnership" from a hidden text, not from an aria-label', () => {
		const { w } = openWindow();
		expect(w.modalEl.querySelector('[data-field="union-type"] label')!.getText()).toBe('Kind');
		const select = w.modalEl.querySelector('[data-field="union-type"] select')!;
		expect(select.getAttribute('aria-label')).toBeNull();
		const name = w.modalEl.querySelector(`[id="${select.getAttribute('aria-labelledby')}"]`)!;
		expect(name.getText()).toBe('Kind of partnership');
		expect(name.getText().startsWith('Kind')).toBe(true);
		expect(UNION_EDIT.typeLabel).toBe('Kind of partnership');
	});

	it('Cancel with a typed change asks "Discard changes?" as Esc does; Cancel with no change closes at once', async () => {
		const { w } = openWindow();
		const cancel = w.modalEl.querySelector('.dynasty-sheet-cancel')!;
		const end = w.modalEl.querySelector('[data-field="union-end"] input') as FEl;
		end.value = '1135';
		dispatch(end, 'input');
		dispatch(cancel, 'click');
		const box = w.modalEl.querySelector('.dynasty-sheet-confirm')!;
		expect(box.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(box.querySelector('.dynasty-sheet-confirm-text')!.getText()).toBe(UNION_EDIT.discardText);
		expect(openModals).toHaveLength(2);
		dispatch(box.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(openModals).toHaveLength(2);
		// A second try, then "Discard changes" closes the window.
		dispatch(cancel, 'click');
		dispatch(w.modalEl.querySelector('.dynasty-sheet-discard')!, 'click');
		await settle();
		expect(openModals).toHaveLength(1);

		const again = openWindow().w;
		dispatch(again.modalEl.querySelector('.dynasty-sheet-cancel')!, 'click');
		await settle();
		expect(again.modalEl.querySelector('.dynasty-sheet-confirm')).toBeNull();
	});

	it('Save writes, closes the window and the person window says what changed, with Undo', async () => {
		const { h, s, w } = openWindow();
		const end = w.modalEl.querySelector('[data-field="union-end"] input') as FEl;
		end.value = '1135';
		dispatch(end, 'input');
		dispatch(w.modalEl.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(h.body).toContain('end: 1135');
		const line = modalOf(s).querySelector('.dynasty-sheet-change .dynasty-sheet-change-text')!;
		expect(line.getText()).toBe(CHANGE_UI.changedPartnership('Edmund Vane', 'Agnes Thorne'));
		expect(line.getText()).toBe('The plugin changed the partnership of Edmund Vane and Agnes Thorne.');
		expect(modalOf(s).querySelector('.dynasty-sheet-change-undo')).not.toBeNull();
		// The row now shows the new end.
		const row = modalOf(s).querySelectorAll('.dynasty-family-row[data-partner]').find((r) => r.getAttribute('data-partner') === 'a')!;
		expect(row.querySelector('.dynasty-family-detail')!.getText()).toBe('⚭ Marriage, 1126–1135, ended by divorce');
		// Undo puts the partnership back.
		dispatch(modalOf(s).querySelector('.dynasty-sheet-change-undo')!, 'click');
		await settle();
		expect(h.body).toContain('end: 1131');
	});

	it('a Save of a marriage whose reason changes shows the new reason in its row', async () => {
		const { s, w } = openWindow();
		const select = w.modalEl.querySelector('[data-field="union-ended-by"] select') as FEl;
		select.value = 'annulment';
		dispatch(select, 'change');
		dispatch(w.modalEl.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		const row = modalOf(s).querySelectorAll('.dynasty-family-row[data-partner]').find((r) => r.getAttribute('data-partner') === 'a')!;
		expect(row.querySelector('.dynasty-family-detail')!.getText()).toBe('⚭ Marriage, 1126–1131, ended by annulment');
	});
});

describe('the New or existing step names who is added (UX-08)', () => {
	it('Add child names the parent, and both parents once the user chose the other parent', async () => {
		const { s } = open(BODY, 'e');
		// The other parent is chosen: Agnes. Then the New or existing step says both names.
		answers.push('p0', null);
		dispatch(modalOf(s).querySelector('.dynasty-add-child')!, 'click');
		await settle();
		const step = specs.find((x) => x.title === 'Add a child' && x.text?.[0]?.includes('Select a new person'))!;
		expect(step.text).toEqual(['Add a child of Edmund Vane and Agnes Thorne. Select a new person or a person who is in the tree.']);
	});

	it('Add child with no other parent names one parent and never a second one', async () => {
		const body = ['people:', '  - {id: e, name: Edmund Vane, sex: m}', ''].join('\n');
		const { s } = open(body, 'e');
		answers.push(null);
		dispatch(modalOf(s).querySelector('.dynasty-add-child')!, 'click');
		await settle();
		expect(specs[0]!.text).toEqual(['Add a child of Edmund Vane. Select a new person or a person who is in the tree.']);
	});

	it('Add parent names the type of the parent that the user chose', async () => {
		const { s } = open(BODY, 'k');
		answers.push('adoptive', null);
		dispatch(modalOf(s).querySelector('.dynasty-add-parent')!, 'click');
		await settle();
		const step = specs.find((x) => x.text?.[0]?.includes('Select a new person'))!;
		expect(step.text).toEqual(['Add an adoptive parent to Kit Vane. Select a new person or a person who is in the tree.']);
	});

	it('Add partner keeps its own text, and a step with one choice still shows (the order of spec §6.4 stays)', async () => {
		const body = ['people:', '  - {id: e, name: Edmund Vane, sex: m}', ''].join('\n');
		const { s } = open(body, 'e');
		answers.push(null);
		dispatch(modalOf(s).querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		expect(specs).toHaveLength(1);
		expect(specs[0]!.text).toEqual(['Add a partner to Edmund Vane. Select a new person or a person who is in the tree.']);
		// The one person of the tree is the person of the window: no existing person can be added, and the step still shows with its two options.
		expect(specs[0]!.choices.map((c) => c.label)).toHaveLength(2);
	});
});

describe('the option that keeps the phone list on the person of the window (O-09b hook)', () => {
	it('is off by default: the list starts at the person that the write highlights', async () => {
		const { h, s } = open(BODY, 'k');
		const host = (s as unknown as { flowHost(): { commit(ops: unknown[], highlight: string): Promise<unknown> } }).flowHost();
		await host.commit([{ kind: 'add-union', partners: ['k', 'r'] }], 'r');
		expect(h.state.lastEdited).toBe('r');
	});

	it('Add partner with an existing person sets it: the last edited person is the person of the window', async () => {
		const { h, s } = open(BODY, 'k');
		answers.push('existing', { kind: 'person', id: 'r' }, 'marriage');
		dispatch(modalOf(s).querySelector('.dynasty-add-partner')!, 'click');
		await settle();
		expect(h.state.lastEdited).toBe('k');
	});

	it('with `keepList` the last edited person is the person of the window', async () => {
		const { h, s } = open(BODY, 'k');
		const host = (s as unknown as { flowHost(): { commit(ops: unknown[], highlight: string, o?: { keepList?: boolean }): Promise<unknown> } }).flowHost();
		await host.commit([{ kind: 'add-union', partners: ['k', 'r'] }], 'r', { keepList: true });
		expect(h.state.lastEdited).toBe('k');
	});
});
