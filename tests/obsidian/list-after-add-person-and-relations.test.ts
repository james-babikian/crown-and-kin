import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Scripted answers for the steps of an Add flow (choices, then the picker).
const answers: unknown[] = [];
vi.mock('../../src/obsidian/choice-modal', () => ({ choose: async () => answers.shift() ?? null }));
vi.mock('../../src/obsidian/person-picker', () => ({ pickPerson: async () => answers.shift() ?? null }));

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { PHONE_LIST_UI } from '../../src/render/view-text';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, dispatch, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { embed, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { stripNotDisabled, type, writingHandle } from '../support/windows-sheets-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 O-09a and O-09b (spec §5.5, rung 4): after Add person from the bar (the tree has people), Add partner and Add child with a new person, the phone list
 * stays where it is. A Notice names the new person when the list has no row for them. An empty tree shows the new person.
 */

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	answers.length = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(stripNotDisabled(qs));
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const PEOPLE = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: roderick, name: Roderick, sex: m, born: 1131, parents: [aldric, isolde]}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick]}
  - {id: zed, name: Zed, sex: m, born: 1160}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;

const root = (el: FEl) => el.querySelector('.dynasty-root')!;
const centre = (el: FEl) => root(el).getAttribute('data-dynasty-focus');
const from = (el: FEl) => root(el).getAttribute('data-dynasty-list-from');
const named = (name: string) => PHONE_LIST_UI.savedElsewhereName(name);

/** A handle that, like the real one, tells its views in the same step as a write. */
async function open(src: string) {
	phone();
	const handle = writingHandle(src);
	const write = handle.write.getMockImplementation()!;
	handle.write.mockImplementation((async (op: never) => {
		const out = (await (write as (o: never) => Promise<{ ok: boolean; body?: string }>)(op)) as { ok: boolean; body?: string };
		if (out.ok) handle.change(out.body!);
		return out;
	}) as never);
	const e = await embed(src, { host: fakeHost(), handle });
	return { ...e, handle };
}

/** A block with no people: the view has no viewport to size, so `embed` does not fit it. */
async function openEmpty() {
	phone();
	const body = 'people: []\n';
	const handle = writingHandle(body);
	const write = handle.write.getMockImplementation()!;
	handle.write.mockImplementation((async (op: never) => {
		const out = (await (write as (o: never) => Promise<{ ok: boolean; body?: string }>)(op)) as { ok: boolean; body?: string };
		if (out.ok) handle.change(out.body!);
		return out;
	}) as never);
	const host = fakeHost();
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
	const el = new FEl('div');
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: '' }), addChild: () => {} };
	new TreeView(host as never, el as unknown as HTMLElement, body, { kind: 'embed', ctx } as never).load();
	await settle();
	return { el, handle };
}

const redraw = async () => {
	await settle();
	await settle();
	resizeAll();
	flushFrames();
};
const top = () => (openModals[openModals.length - 1] as unknown as { modalEl: FEl }).modalEl;

/** Add person from the bar, type a name, Save. */
async function addPersonFromBar(el: FEl, name: string) {
	dispatch(el.querySelector('.dynasty-add-person')!, 'click', { button: 0, detail: 1 });
	await settle();
	type(top().querySelector('[data-field="name"] input')!, name);
	dispatch(top().querySelector('.dynasty-sheet-save')!, 'click');
	await redraw();
}

async function openWindow(el: FEl, personId: string) {
	dispatch(el.querySelector(`.dynasty-list-row[data-person="${personId}"] .dynasty-list-edit`)!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	return top();
}

/** The Add child or Add partner button of the open window, then the answers, then the name and Save of the new person's window. */
async function addNew(button: string, name: string, ...steps: unknown[]) {
	answers.push(...steps, 'new');
	const window = top();
	dispatch(window.querySelector(button)!, 'click');
	await settle();
	type(top().querySelector('[data-field="name"] input')!, name);
	dispatch(top().querySelector('.dynasty-sheet-save')!, 'click');
	await redraw();
	return window;
}

describe('Add person from the bar on a phone (D330, rung 4)', () => {
	it('with people in the tree the list stays on the person it showed, and a Notice names the new person', async () => {
		const { el, handle } = await open(PEOPLE);
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		await addPersonFromBar(el, 'Wulf Stranger');
		expect(handle.body).toContain('Wulf Stranger');
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		expect(notices.filter((n) => n === named('Wulf Stranger'))).toHaveLength(1);
		expect(notices).not.toContain(PHONE_LIST_UI.savedElsewhere);
	});

	it('the list stays on the person of an earlier Save (rung 4 holds)', async () => {
		const { el, handle } = await open(PEOPLE);
		handle.state.lastSaved = 'lena';
		handle.change(`${PEOPLE}# again\n`);
		await redraw();
		expect([centre(el), from(el)]).toEqual(['lena', 'edited']);
		await addPersonFromBar(el, 'Wulf Stranger');
		expect([centre(el), from(el)]).toEqual(['lena', 'edited']);
		expect(handle.state.lastSaved).toBe('lena');
		expect(notices.filter((n) => n === named('Wulf Stranger'))).toHaveLength(1);
	});

	it('a later draw does not move the list either', async () => {
		const { el, handle } = await open(PEOPLE);
		await addPersonFromBar(el, 'Wulf Stranger');
		handle.change(`${handle.body}# later\n`);
		await redraw();
		expect(centre(el)).toBe('aldric');
		expect(notices.filter((n) => n === named('Wulf Stranger'))).toHaveLength(1);
	});

	it('a pin stays and the Notice names the new person', async () => {
		const { el } = await open(`options:\n  focus: roderick\n\n${PEOPLE}`);
		expect([centre(el), from(el)]).toEqual(['roderick', 'pin']);
		await addPersonFromBar(el, 'Wulf Stranger');
		expect([centre(el), from(el)]).toEqual(['roderick', 'pin']);
		expect(notices.filter((n) => n === named('Wulf Stranger'))).toHaveLength(1);
	});

	it('a mark stays and the Notice names the new person', async () => {
		const { el } = await open(`options:\n  me: lena\n\n${PEOPLE}`);
		expect([centre(el), from(el)]).toEqual(['lena', 'me']);
		await addPersonFromBar(el, 'Wulf Stranger');
		expect([centre(el), from(el)]).toEqual(['lena', 'me']);
		expect(notices.filter((n) => n === named('Wulf Stranger'))).toHaveLength(1);
	});

	it('an empty tree shows the new person', async () => {
		const { el, handle } = await openEmpty();
		dispatch(el.querySelector('.dynasty-add-first')!, 'click', { button: 0, detail: 1 });
		await settle();
		type(top().querySelector('[data-field="name"] input')!, 'Wulf Stranger');
		dispatch(top().querySelector('.dynasty-sheet-save')!, 'click');
		await redraw();
		expect(handle.body).toContain('Wulf Stranger');
		expect(root(el).getAttribute('data-dynasty-people')).toBe('1');
		expect(notices).not.toContain(named('Wulf Stranger'));
	});
});

describe('Add partner and Add child with a new person from the person window (D330)', () => {
	it('Add partner: the list stays on the person it showed, also after the windows close', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'roderick');
		const window = await addNew('.dynasty-add-partner', 'Tilda Vane');
		expect(handle.body).toContain('Tilda Vane');
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		expect(handle.state.lastEdited).toBe('roderick');
		expect(handle.state.lastSaved ?? null).toBeNull();
		expect(notices.filter((n) => n === named('Tilda Vane'))).toHaveLength(1);
		dispatch(window.querySelector('.dynasty-sheet-cancel')!, 'click');
		await redraw();
		expect(openModals).toHaveLength(0);
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		expect(handle.state.listHold).toBe(false);
	});

	it('Add partner: while the person window is open, a later draw keeps the list', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'roderick');
		await addNew('.dynasty-add-partner', 'Tilda Vane');
		expect(handle.state.listHold).toBe(true);
		handle.change(`${handle.body}# later\n`);
		await redraw();
		expect(centre(el)).toBe('aldric');
	});

	it('Add child: the list stays on the parent, and the new child has a row with the flash outline', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'aldric');
		// Aldric has a partner: the other-parent step comes first.
		await addNew('.dynasty-add-child', 'Wulf Vane', 'p0');
		expect(handle.body).toContain('Wulf Vane');
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		expect(handle.state.lastEdited).toBe('aldric');
		expect(el.querySelector('.dynasty-list-row.dynasty-list-flash')).not.toBeNull();
		expect(notices.filter((n) => n.includes('Wulf Vane'))).toHaveLength(0);
	});

	it('a second child is added with no extra steps: the person window is still open on the same person', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'aldric');
		await addNew('.dynasty-add-child', 'Wulf Vane', 'p0');
		await addNew('.dynasty-add-child', 'Ada Vane', 'p0');
		expect(handle.body).toContain('Wulf Vane');
		expect(handle.body).toContain('Ada Vane');
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
		expect(handle.state.lastEdited).toBe('aldric');
	});

	it('Add child from a person with no children: the list stays on the person it showed, not on the new oldest parent', async () => {
		// Nobody has a child, so the list stands on the first root. Isolde is older: she is the oldest parent as soon as she has a child.
		const couple = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1110}
  - {id: isolde, name: Isolde, sex: f, born: 1100}
unions:
  - {partners: [aldric, isolde], type: marriage}
`;
		const { el } = await open(couple);
		expect([centre(el), from(el)]).toEqual(['aldric', 'first']);
		await openWindow(el, 'isolde');
		await addNew('.dynasty-add-child', 'Wulf Vane', 'p0');
		expect([centre(el), from(el)]).toEqual(['aldric', 'first']);
	});

	it('Add child with a person who is in the tree already keeps the list, and the last edited person is the parent', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'roderick');
		answers.push('existing', { kind: 'person', id: 'zed' });
		dispatch(top().querySelector('.dynasty-add-child')!, 'click');
		await redraw();
		expect(centre(el)).toBe('aldric');
		expect(handle.state.lastEdited).toBe('roderick');
	});
});

describe('a Save of a change to a person still moves the list (rung 4)', () => {
	it('Save in the window of a person moves the list to that person', async () => {
		const { el, handle } = await open(PEOPLE);
		await openWindow(el, 'roderick');
		type(top().querySelector('[data-field="title"] input')!, 'Duke');
		dispatch(top().querySelector('.dynasty-sheet-save')!, 'click');
		await redraw();
		expect(handle.state.lastSaved).toBe('roderick');
		expect([centre(el), from(el)]).toEqual(['roderick', 'edited']);
	});
});
