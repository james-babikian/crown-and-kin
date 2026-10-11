import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { carryState, endSessionFocus, newBlockState, type BlockState } from '../src/obsidian/block-state';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache, relationsFor } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, type DynastySettings } from '../src/obsidian/settings';
import { TreeView } from '../src/obsidian/tree-view';
import { PHONE_LIST_UI } from '../src/render/ui-text';
import { FEl, clock, device, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fullViews, phone, phoneOnSide, sheets, tabletDevice, type FakeHandle } from './acceptance/tree-view-fakes';
import { build } from './helpers';

/*
 * 0.2.5, WP-C2b (D144; contract C.3.1): a tree in a note on a phone is a list. Made-up people only. The pure parts of the list
 * are in s025-phone-list-data.test.ts and its DOM in s025-phone-list-dom.test.ts; this file is the tree view that wires them.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const PEOPLE = `people:
  - {id: aldric, name: Aldric, sex: m, born: 1102}
  - {id: isolde, name: Isolde, sex: f, born: 1110}
  - {id: gareth, name: Gareth, sex: m, born: 1104}
  - {id: roderick, name: Roderick, sobriquet: the Bold, sex: m, born: 1131, died: 1190, parents: [aldric, isolde, {id: gareth, type: rumoured}]}
  - {id: pia, name: Pia, sex: f, born: 1135, parents: [aldric, isolde, {id: roderick, type: adoptive}]}
  - {id: marta, name: Marta, sex: f, born: 1133, died: 1170}
  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick, marta]}
  - {id: kit, name: Kit, sex: m, parents: [roderick]}
unions:
  - {partners: [aldric, isolde], type: marriage}
  - {partners: [roderick, marta], type: marriage}
`;
const tree = (...options: string[]) => `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}` : ''}${PEOPLE}`;
const PLAIN = tree();

function noteHandle(body: string): FakeHandle {
	return fakeHandle('n.md', body);
}

async function open(src: string, o: { handle?: FakeHandle | null; settings?: DynastySettings } = {}) {
	phone();
	const handle = o.handle === undefined ? noteHandle(src) : o.handle;
	const host = fakeHost(o.settings);
	const e = await embed(src, { host, handle });
	// A read-only block has no handle; the tests that use `handle` or `st` open an editable one.
	return { ...e, root: e.el, handle: handle as FakeHandle, host, st: (handle?.state ?? null) as BlockState };
}

const rootOf = (el: FEl) => el.querySelector('.dynasty-root')!;
const row = (el: FEl, id: string) => el.querySelector(`.dynasty-list-row[data-person="${id}"]`)!;
const ids = (el: FEl) => el.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')!);
const tools = (el: FEl) =>
	el
		.querySelector('.dynasty-toolbar')!
		.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!)
		// The free room between the buttons is no button.
		.filter((c) => c !== 'dynasty-grow');
const click = (target: FEl, init: Record<string, unknown> = {}) => dispatch(target, 'click', { button: 0, detail: 1, pointerType: 'touch', ...init });
const wordOf = (el: FEl, id: string) => row(el, id).querySelector('.dynasty-list-word')?.getText() ?? null;
const linkOf = (el: FEl, id: string) => row(el, id).querySelector('.dynasty-list-link')?.getText() ?? null;

async function tapName(root: FEl, id: string): Promise<void> {
	click(row(root, id).querySelector('.dynasty-list-go')!);
	await settle();
	resizeAll();
	flushFrames();
}

async function press(root: FEl, sel: string): Promise<void> {
	click(root.querySelector(sel)!);
	await settle();
	resizeAll();
	flushFrames();
}

describe('a tree in a note on a phone is a list (D144)', () => {
	it('has the list, the bar and no tree', async () => {
		const { el } = await open(PLAIN);
		const root = rootOf(el);
		expect(root.getAttribute('data-dynasty-orientation')).toBe('list');
		expect(root.hasClass('dynasty-list-root')).toBe(true);
		expect(el.querySelector('.dynasty-svg')).toBeNull();
		expect(el.querySelector('.dynasty-card')).toBeNull();
		expect(el.querySelector('.dynasty-height')).toBeNull();
		expect(el.querySelector('.dynasty-canvas')).toBeNull();
		const vp = el.querySelector('.dynasty-viewport')!;
		expect(vp.hasClass('dynasty-list-viewport')).toBe(true);
		// The bar is the first child (Tab reaches it first), the list the second.
		expect(vp.children.map((c) => [...c.classes][0])).toEqual(['dynasty-toolbar', 'dynasty-list']);
		expect(root.getAttribute('data-dynasty-cards-pending')).toBe('0');
		expect(root.getAttribute('data-dynasty-lines-pending')).toBe('0');
	});

	it('a phone on its side is still a list, a tablet keeps the static cards, a computer keeps its tree', async () => {
		phoneOnSide();
		const side = await embed(PLAIN, { handle: noteHandle(PLAIN) });
		expect(rootOf(side.el).getAttribute('data-dynasty-orientation')).toBe('list');
		resetDom();
		tabletDevice();
		const tablet = await embed(PLAIN, { handle: noteHandle(PLAIN) });
		expect(rootOf(tablet.el).getAttribute('data-dynasty-orientation')).toBe('down');
		expect(tablet.el.querySelector('.dynasty-list')).toBeNull();
		expect(tablet.el.querySelectorAll('.dynasty-card').length).toBeGreaterThan(0);
		resetDom();
		desktop();
		const desk = await embed(PLAIN, { handle: noteHandle(PLAIN) });
		expect(desk.el.querySelector('.dynasty-list')).toBeNull();
		expect(desk.el.querySelectorAll('.dynasty-card').length).toBeGreaterThan(0);
	});

	it('the full-screen view on a phone is still a tree', async () => {
		phone();
		const { openFullScreen } = await import('./acceptance/tree-view-fakes');
		const f = await openFullScreen(PLAIN);
		expect(f.root.querySelector('.dynasty-list')).toBeNull();
		expect(f.root.querySelector('.dynasty-svg')).not.toBeNull();
	});

	it('lists the family of the start person: parents, the person with the partner, the children by partnership', async () => {
		const { el } = await open(PLAIN);
		const root = rootOf(el);
		expect(root.getAttribute('data-dynasty-focus')).toBe('aldric');
		expect(ids(el)).toEqual(['aldric', 'isolde', 'roderick', 'pia']);
		expect(root.getAttribute('data-dynasty-people')).toBe('4');
	});

	it('writes nothing to the note', async () => {
		const { el, handle } = await open(PLAIN);
		await tapName(el, 'roderick');
		await press(el, '.dynasty-list-back');
		expect(handle.write).not.toHaveBeenCalled();
		expect(handle.body).toBe(PLAIN);
	});

	it('a block with no people keeps the empty box, a block with an error keeps the error box', async () => {
		phone();
		const mount = async (src: string) => {
			const el = new FEl('div');
			const ctx = { sourcePath: 'n.md', getSectionInfo: () => null, addChild: () => {} };
			const view = new TreeView(fakeHost() as never, el as unknown as HTMLElement, src, { kind: 'embed', ctx } as never);
			view.load();
			await settle();
			return el;
		};
		const empty = await mount('people: []\n');
		expect(empty.querySelector('.dynasty-empty')).not.toBeNull();
		expect(empty.querySelector('.dynasty-list')).toBeNull();
		const bad = await mount('people: [\n');
		expect(bad.querySelector('.dynasty-error')).not.toBeNull();
		expect(bad.querySelector('.dynasty-list')).toBeNull();
	});
});

describe('the start chain (D144)', () => {
	const from = (el: FEl) => rootOf(el).getAttribute('data-dynasty-list-from');
	const centre = (el: FEl) => rootOf(el).getAttribute('data-dynasty-focus');

	it('with no pin, no mark and no edit: the oldest person who has children', async () => {
		const { el } = await open(PLAIN);
		expect([centre(el), from(el)]).toEqual(['aldric', 'oldest']);
	});

	it('the person edited last, then the oldest', async () => {
		const handle = noteHandle(PLAIN);
		handle.state.lastEdited = 'kit';
		const { el } = await open(PLAIN, { handle });
		expect([centre(el), from(el)]).toEqual(['kit', 'edited']);
	});

	it('the marked person comes before the edited one', async () => {
		const src = tree('me: marta');
		const handle = noteHandle(src);
		handle.state.lastEdited = 'kit';
		const { el } = await open(src, { handle });
		expect([centre(el), from(el)]).toEqual(['marta', 'me']);
	});

	it('the pin comes before the mark; options.start is not in the chain', async () => {
		const src = tree('me: marta', 'focus: lena', 'start: kit');
		const { el } = await open(src);
		expect([centre(el), from(el)]).toEqual(['lena', 'pin']);
		resetDom();
		const only = await open(tree('start: kit'));
		expect([centre(only.el), from(only.el)]).toEqual(['aldric', 'oldest']);
	});

	it('a pin that names nobody is skipped', async () => {
		const { el } = await open(tree('focus: nobody', 'me: marta'));
		expect([centre(el), from(el)]).toEqual(['marta', 'me']);
	});

	it('the session choice comes first', async () => {
		const src = tree('focus: lena');
		const handle = noteHandle(src);
		handle.state.focus = { id: 'kit' };
		const { el } = await open(src, { handle });
		expect([centre(el), from(el)]).toEqual(['kit', 'session']);
	});

	it('"all people" as the session choice means nothing to a list', async () => {
		const src = tree('focus: lena');
		const handle = noteHandle(src);
		handle.state.focus = { id: null };
		const { el } = await open(src, { handle });
		expect([centre(el), from(el)]).toEqual(['lena', 'pin']);
	});

	it('an edit of another person does not move a list that stands on a pin or a mark', async () => {
		const src = tree('me: marta');
		const handle = noteHandle(src);
		const { el } = await open(src, { handle });
		handle.state.lastEdited = 'kit';
		handle.change(`${src}# edited\n`);
		resizeAll();
		flushFrames();
		expect(centre(el)).toBe('marta');
	});
});

describe('the bar', () => {
	it('Add person, Find, Expand; Back only after a move', async () => {
		const { el } = await open(PLAIN);
		expect(tools(el)).toEqual(['dynasty-add-person', 'dynasty-show-text', 'dynasty-list-find', 'dynasty-expand']);
		await tapName(el, 'roderick');
		expect(tools(el)).toEqual(['dynasty-add-person', 'dynasty-show-text', 'dynasty-list-find', 'dynasty-list-back', 'dynasty-expand']);
	});

	it('the bar buttons show icons only (D182); every button has a label', async () => {
		const { el } = await open(PLAIN);
		const bar = el.querySelector('.dynasty-toolbar')!;
		expect(bar.querySelector('.dynasty-add-person .dynasty-tool-icon')).not.toBeNull();
		expect(bar.querySelector('.dynasty-add-person .dynasty-tool-text')).toBeNull();
		expect(bar.querySelector('.dynasty-add-person')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.addPersonLabel);
		expect(bar.querySelector('.dynasty-list-find .dynasty-tool-icon')).not.toBeNull();
		expect(bar.querySelector('.dynasty-list-find .dynasty-tool-text')).toBeNull();
		expect(bar.querySelector('.dynasty-list-find')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.findLabel);
		expect(bar.querySelector('.dynasty-expand .dynasty-tool-icon')).not.toBeNull();
		expect(bar.querySelector('.dynasty-expand .dynasty-tool-text')).toBeNull();
		expect(bar.querySelector('.dynasty-expand')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.expandLabel);
	});

	it('a read-only list has Open note and no Add person', async () => {
		const { el } = await open(PLAIN, { handle: null });
		expect(tools(el)).toEqual(['dynasty-read-only-label', 'dynasty-open-source', 'dynasty-list-find', 'dynasty-expand']);
	});

	it('Expand opens the full-screen view of the same block, on the person of the list after a move', async () => {
		const { el, st } = await open(PLAIN);
		await tapName(el, 'roderick');
		await press(el, '.dynasty-expand');
		await settle();
		expect(fullViews()).toHaveLength(1);
		const modal = fullViews()[0].containerEl as unknown as FEl;
		expect(rootOf(modal).getAttribute('data-dynasty-focus')).toBe('roderick');
		expect(st.focus).toEqual({ id: 'roderick' });
	});

	it('Expand with no move shows the whole small tree', async () => {
		const { el } = await open(PLAIN);
		await press(el, '.dynasty-expand');
		await settle();
		const modal = fullViews()[0].containerEl as unknown as FEl;
		expect(rootOf(modal).getAttribute('data-dynasty-focus')).toBeNull();
	});
});

describe('a tap on a name moves the list, Back returns', () => {
	it('a tap moves the list to that person, pushes the old one and keeps the note as it is', async () => {
		const { el, st } = await open(PLAIN);
		await tapName(el, 'roderick');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('roderick');
		expect(st.focus).toEqual({ id: 'roderick' });
		expect(st.listBack).toEqual(['aldric']);
		expect(ids(el)).toEqual(['roderick', 'aldric', 'isolde', 'gareth', 'marta', 'lena', 'kit', 'pia']);
	});

	it('Back pops the trail and names the person it returns to', async () => {
		const { el, st } = await open(PLAIN);
		await tapName(el, 'roderick');
		await tapName(el, 'lena');
		expect(st.listBack).toEqual(['aldric', 'roderick']);
		expect(el.querySelector('.dynasty-list-back')!.getAttribute('aria-label')).toBe(PHONE_LIST_UI.backLabel('Roderick'));
		await press(el, '.dynasty-list-back');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('roderick');
		expect(st.listBack).toEqual(['aldric']);
		await press(el, '.dynasty-list-back');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('aldric');
		expect(el.querySelector('.dynasty-list-back')).toBeNull();
	});

	it('the centre row does not move the list; the heading of the centre section takes the focus after a move', async () => {
		const { el } = await open(PLAIN);
		await tapName(el, 'roderick');
		const head = el.querySelector('.dynasty-list-section[data-section="person"] .dynasty-list-head')!;
		expect(head.getAttribute('tabindex')).toBe('-1');
		expect((globalThis as { document: { activeElement: unknown } }).document.activeElement).toBe(head);
	});

	it('the trail holds 20 persons at most', async () => {
		const { el, st } = await open(PLAIN);
		for (let i = 0; i < 12; i++) {
			await tapName(el, 'roderick');
			await tapName(el, 'aldric');
		}
		expect(st.listBack!.length).toBeLessThanOrEqual(20);
	});

	it('Clear focus (and any other change of the family) starts a new trail', async () => {
		const { el, st, host } = await open(PLAIN);
		await tapName(el, 'roderick');
		TreeView.focusState(host as never, st!, null);
		await settle();
		resizeAll();
		flushFrames();
		expect(st.listBack).toBeUndefined();
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('aldric');
		expect(el.querySelector('.dynasty-list-back')).toBeNull();
	});

	it('the pin path (the session focus becomes null) drops the trail', async () => {
		const { el, st, handle } = await open(PLAIN);
		await tapName(el, 'roderick');
		expect(st.listBack).toEqual(['aldric']);
		st.focus = null;
		handle.change(`options:\n  focus: lena\n${PLAIN}`);
		resizeAll();
		flushFrames();
		expect(st.listBack).toBeUndefined();
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('lena');
		expect(el.querySelector('.dynasty-list-back')).toBeNull();
	});

	it('a session person who left the tree ends the session choice and the trail: the list is back on the start chain', async () => {
		const { el, st, handle } = await open(PLAIN);
		await tapName(el, 'roderick');
		await tapName(el, 'lena');
		expect(st.listBack).toEqual(['aldric', 'roderick']);
		handle.change(PLAIN.replace('  - {id: lena, name: Lena, sex: f, born: 1155, parents: [roderick, marta]}\n', ''));
		resizeAll();
		flushFrames();
		expect(st.focus).toBeNull();
		expect(st.listBack).toBeUndefined();
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('aldric');
		expect(el.querySelector('.dynasty-list-back')).toBeNull();
	});

	it('the session choice is kept when the full-screen view opens and closes (carry of the state)', () => {
		const from = newBlockState();
		from.listBack = ['a', 'b'];
		const to = newBlockState();
		carryState(from, to);
		expect(to.listBack).toEqual(['a', 'b']);
		endSessionFocus(to);
		expect(to.listBack).toBeUndefined();
	});
});

describe('Find', () => {
	function picker() {
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker'));
		if (!p) throw new Error('no picker is open');
		return p as unknown as { getSuggestions(q: string): unknown[]; renderSuggestion(i: unknown, el: FEl): void; onChooseSuggestion(i: unknown, e: unknown): void; close(): void };
	}

	async function choose(id: string): Promise<void> {
		const p = picker();
		const item = p.getSuggestions('').find((i) => {
			const e = new FEl('div');
			p.renderSuggestion(i, e);
			return e.getAttribute('data-person') === id;
		});
		if (!item) throw new Error(`the picker does not offer ${id}`);
		p.onChooseSuggestion(item, {});
		p.close();
		runTimers(0);
		await settle();
		resizeAll();
		flushFrames();
	}

	it('a person chosen in Find moves the list and pushes the old centre', async () => {
		const { el, st } = await open(PLAIN);
		await press(el, '.dynasty-list-find');
		await choose('kit');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('kit');
		expect(st.listBack).toEqual(['aldric']);
		expect(st.focus).toEqual({ id: 'kit' });
	});

	it('a picker closed with no choice changes nothing and gives the keyboard focus back to Find', async () => {
		const { el, st } = await open(PLAIN);
		await press(el, '.dynasty-list-find');
		picker().close();
		runTimers(0);
		await settle();
		expect(st.focus).toBeNull();
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('aldric');
		expect((globalThis as { document: { activeElement: unknown } }).document.activeElement).toBe(el.querySelector('.dynasty-list-find'));
	});
});

describe('the pencil and the centre row edit', () => {
	it('the pencil of another row opens the edit sheet of that person, from a touch', async () => {
		const { el } = await open(PLAIN);
		click(row(el, 'isolde').querySelector('.dynasty-list-edit')!);
		await settle();
		expect(sheets()).toHaveLength(1);
		expect(ids(el)).toContain('isolde');
	});

	it('the centre row is one button that edits', async () => {
		const { el } = await open(PLAIN);
		const whole = row(el, 'aldric').querySelector('.dynasty-list-edit')!;
		expect(row(el, 'aldric').querySelectorAll('button')).toHaveLength(1);
		click(whole);
		await settle();
		expect(sheets()).toHaveLength(1);
	});

	it('a list that cannot be edited has no pencils and an inert centre button, but a name still moves the list', async () => {
		const { el } = await open(PLAIN, { handle: null });
		for (const b of el.querySelectorAll('.dynasty-list-edit')) {
			if (!b.hasClass('dynasty-list-whole')) expect(b.hidden).toBe(true);
		}
		click(row(el, 'aldric').querySelector('.dynasty-list-whole')!);
		await settle();
		expect(sheets()).toHaveLength(0);
		expect(rootOf(el).hasClass('dynasty-read-only')).toBe(true);
		await tapName(el, 'pia');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('pia');
	});

	it('a block that sits in a transclusion is read-only too: no pencil, no Add person, the label, and a name still moves the list', async () => {
		phone();
		const handle = noteHandle(PLAIN);
		const host = fakeHost();
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
		const outer = new FEl('div', { cls: 'markdown-embed' });
		const el = new FEl('div');
		outer.appendChild(el);
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 40, text: '' }), addChild: () => {} };
		new TreeView(host as never, el as unknown as HTMLElement, PLAIN, { kind: 'embed', ctx } as never).load();
		await settle();
		resizeAll();
		flushFrames();
		expect(rootOf(el).hasClass('dynasty-read-only')).toBe(true);
		expect(el.querySelector('.dynasty-add-person')).toBeNull();
		expect(el.querySelector('.dynasty-read-only-label')).not.toBeNull();
		for (const b of el.querySelectorAll('.dynasty-list-edit')) if (!b.hasClass('dynasty-list-whole')) expect(b.hidden).toBe(true);
		click(row(el, 'aldric').querySelector('.dynasty-list-whole')!);
		await settle();
		expect(sheets()).toHaveLength(0);
		await tapName(el, 'pia');
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('pia');
	});
});

describe('the relation word on a row', () => {
	it('no mark: no word at all', async () => {
		const { el } = await open(PLAIN);
		expect(el.querySelectorAll('.dynasty-list-word')).toHaveLength(0);
	});

	it('a mark: the word of the relation cache, and "You" on the marked person', async () => {
		const src = tree('me: roderick');
		const { el } = await open(src);
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('roderick');
		const cards = relationsFor(build(src).g, 'roderick').cards;
		for (const id of ids(el)) {
			if (id === 'roderick') expect(wordOf(el, id)).toBe('You');
			// D210: in a list about You the word for the kind of link takes the place of the relation word.
			else if (linkOf(el, id) !== null) expect(wordOf(el, id)).toBeNull();
			else expect(wordOf(el, id)).toBe(cards.get(id)?.text ?? null);
		}
		expect(linkOf(el, 'gareth')).toBe('Rumoured father');
		expect(linkOf(el, 'pia')).toBe('Adopted daughter');
		expect(wordOf(el, 'aldric')).not.toBeNull();
		expect(row(el, 'roderick').hasClass('dynasty-list-me')).toBe(true);
	});

	it('a mark with "Show relation names on cards" off: only "You"', async () => {
		const src = tree('me: roderick');
		const { el } = await open(src, { settings: { ...DEFAULT_SETTINGS, showRelations: false } });
		expect(el.querySelectorAll('.dynasty-list-word').map((w) => w.getText())).toEqual(['You']);
	});

	it('a change of the setting draws the list again', async () => {
		const src = tree('me: roderick');
		const settings = { ...DEFAULT_SETTINGS };
		const { el, view, host } = await open(src, { settings });
		expect(el.querySelectorAll('.dynasty-list-word').length).toBeGreaterThan(1);
		const prev = { ...settings };
		(host.settings as DynastySettings).showRelations = false;
		view.onSettingsChange(prev);
		expect(el.querySelectorAll('.dynasty-list-word').map((w) => w.getText())).toEqual(['You']);
	});

	it('the dates follow "Show dates on cards"', async () => {
		const settings = { ...DEFAULT_SETTINGS };
		const { el, view, host } = await open(PLAIN, { settings });
		expect(row(el, 'aldric').querySelector('.dynasty-list-years')).not.toBeNull();
		const prev = { ...settings };
		(host.settings as DynastySettings).showDates = false;
		view.onSettingsChange(prev);
		expect(row(el, 'aldric').querySelector('.dynasty-list-years')).toBeNull();
	});

	it('a change of the direction, Reduce movement or the break list does not draw the list again', async () => {
		const settings = { ...DEFAULT_SETTINGS };
		const { el, view, host } = await open(PLAIN, { settings });
		const before = (host as { renders?: number }).renders;
		for (const patch of [{ phoneDirection: 'down' }, { reduceMotion: 'on' }, { breakWords: 'Long-name' }] as Partial<DynastySettings>[]) {
			const prev = { ...host.settings } as DynastySettings;
			Object.assign(host.settings as DynastySettings, patch);
			view.onSettingsChange(prev);
		}
		expect((host as { renders?: number }).renders).toBe(before);
		expect(rootOf(el).getAttribute('data-dynasty-orientation')).toBe('list');
	});
});

describe('a save never moves the list (C.3.1 "A saved person")', () => {
	const saved = (id: string) => ({ id, place: 'embed' as const });

	it('a person who has a row gets the flash class for 2 seconds, and no Notice', async () => {
		const src = tree('me: roderick');
		const { el, st, handle } = await open(src);
		st.shown = saved('lena');
		handle.change(`${src}# written\n`);
		resizeAll();
		flushFrames();
		expect(row(el, 'lena').hasClass('dynasty-list-flash')).toBe(true);
		expect(st.shown).toBeNull();
		expect(rootOf(el).getAttribute('data-dynasty-focus')).toBe('roderick');
		expect(notices).not.toContain(PHONE_LIST_UI.savedElsewhere);
		runTimers(2500);
		expect(row(el, 'lena').hasClass('dynasty-list-flash')).toBe(false);
	});

	it('a person with no row leaves the list, the session choice and the trail as they are, and shows a Notice once', async () => {
		const src = tree('me: roderick');
		const { el, st, handle } = await open(src);
		await tapName(el, 'lena');
		const rows = ids(el);
		const added = `${src.replace('unions:', '  - {id: zed, name: Zed}\nunions:')}`;
		st.shown = saved('zed');
		handle.change(added);
		resizeAll();
		flushFrames();
		expect(ids(el)).toEqual(rows);
		expect(st.focus).toEqual({ id: 'lena' });
		expect(st.listBack).toEqual(['roderick']);
		expect(el.querySelector('.dynasty-list-flash')).toBeNull();
		expect(notices.filter((n) => n === PHONE_LIST_UI.savedElsewhere)).toHaveLength(1);
		// A later draw with nothing saved shows no second Notice.
		handle.change(`${added}# again\n`);
		resizeAll();
		flushFrames();
		expect(notices.filter((n) => n === PHONE_LIST_UI.savedElsewhere)).toHaveLength(1);
	});

	it('a save of a person for another kind of view does not show here', async () => {
		const { el, st, handle } = await open(PLAIN);
		st.shown = { id: 'zed', place: 'full' };
		handle.change(`${PLAIN}# written\n`);
		resizeAll();
		flushFrames();
		expect(st.shown).not.toBeNull();
		expect(notices).not.toContain(PHONE_LIST_UI.savedElsewhere);
		expect(el.querySelector('.dynasty-list-flash')).toBeNull();
	});
});

describe('the problem badge in the list bar', () => {
	const WARN = tree().replace('unions:', '  - {id: zed, name: Zed, house: nowhere, parents: [roderick, marta]}\nunions:');

	it('stands before Expand; a tap opens the problem list; a name in it opens the full-screen view on that person', async () => {
		const { el } = await open(WARN);
		expect(tools(el)).toEqual(['dynasty-add-person', 'dynasty-show-text', 'dynasty-list-find', 'dynasty-warning-badge', 'dynasty-expand']);
		click(el.querySelector('.dynasty-warning-badge')!);
		const problem = el.querySelector('.dynasty-problem-button');
		expect(problem).not.toBeNull();
		click(problem!);
		await settle();
		resizeAll();
		flushFrames();
		expect(fullViews()).toHaveLength(1);
		// The full-screen view centres on the person of the problem and highlights the card.
		const full = fullViews()[0].containerEl as unknown as FEl;
		expect(full.querySelector('.dynasty-card[data-person="zed"]')?.hasClass('dynasty-highlight')).toBe(true);
	});

	it('a re-draw closes the popover', async () => {
		const { el, view } = await open(WARN);
		click(el.querySelector('.dynasty-warning-badge')!);
		expect(el.querySelector('.dynasty-popover')).not.toBeNull();
		(view as unknown as { onunload(): void }).onunload();
		expect(el.querySelector('.dynasty-popover')).toBeNull();
	});
});

describe('a turn of the phone does not draw the list again', () => {
	it('upright to its side: the same list, no new render', async () => {
		const { el, host } = await open(PLAIN);
		const before = (host as { renders?: number }).renders;
		device.width = 844;
		device.height = 390;
		resizeAll();
		runTimers(1000);
		flushFrames();
		expect((host as { renders?: number }).renders).toBe(before);
		expect(rootOf(el).getAttribute('data-dynasty-orientation')).toBe('list');
	});
});

describe('the block state', () => {
	it('a new handle of the same block takes the trail from the loose state', async () => {
		phone();
		const host = fakeHost();
		const loose = newBlockState();
		loose.focus = { id: 'roderick' };
		loose.listBack = ['aldric'];
		host.looseStates.set('n.md\u0000#0', loose);
		const handle = noteHandle(PLAIN);
		const e = await embed(PLAIN, { host, handle });
		await settle();
		expect(handle.state.listBack).toEqual(['aldric']);
		expect(handle.state.focus).toEqual({ id: 'roderick' });
		expect(e.el.querySelector('.dynasty-list')).not.toBeNull();
	});
});

describe('the pictures of the rows', () => {
	const PICS = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
people:
  - {id: ann, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: bo, name: Bo, house: va, born: 1130, parents: [ann]}
`;

	function store(hold = false) {
		const released: string[] = [];
		const asks: { path: string; fit: string; w: number }[] = [];
		const pending: (() => void)[] = [];
		let n = 0;
		const s = {
			resolve: (link: string) => ({ ok: true, file: { path: link.replace(/[[\]]/g, '') }, format: 'png' }),
			check: async () => null,
			acquire: (file: { path: string }, box: { fit: string; w: number }, signal?: AbortSignal) => {
				asks.push({ path: file.path, fit: box.fit, w: box.w });
				const url = `blob:c${n++}`;
				const copy = { url, w: 10, h: 10, release: () => void released.push(url) };
				if (!hold) return Promise.resolve(signal?.aborted ? null : copy);
				return new Promise((resolve) => pending.push(() => resolve(copy)));
			},
			onChange: () => () => {},
		};
		return { s, released, asks, pending };
	}

	async function withStore(o: ReturnType<typeof store>, settings: DynastySettings = DEFAULT_SETTINGS) {
		phone();
		const host = fakeHost(settings);
		(host as unknown as { pictures: unknown }).pictures = o.s;
		const handle = noteHandle(PICS);
		const e = await embed(PICS, { host, handle });
		await settle();
		return { ...e, handle };
	}

	it('the large row gets the arms of the house and the portrait of the person, as small copies; a child of the same house gets no arms (D206)', async () => {
		const o = store();
		const { el } = await withStore(o);
		// 0.2.8 (D209): the large row of the person in the centre has a column with the portrait and the arms under it.
		expect(row(el, 'ann').querySelector('.dynasty-hero-arms.has-picture img')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-portrait.has-picture img')).not.toBeNull();
		// Rule A: no other row shows arms, and Bo has no portrait, so his row has no picture place at all (D213).
		expect(row(el, 'bo').querySelector('.dynasty-hero-arms')).toBeNull();
		expect(row(el, 'bo').querySelector('.dynasty-list-pics')).toBeNull();
		expect(o.asks.filter((a) => a.fit === 'meet')).toHaveLength(1);
		expect(o.asks.filter((a) => a.fit === 'meet').every((a) => a.w === 96)).toBe(true);
		expect(o.asks.filter((a) => a.fit === 'portrait')).toHaveLength(1);
		expect(o.asks.filter((a) => a.fit === 'portrait').every((a) => a.w === 128)).toBe(true);
	});

	it('the list does not follow "Arms on cards" (D209 rule A): "every card" gives the child row no arms', async () => {
		const o = store();
		const { el } = await withStore(o, { ...DEFAULT_SETTINGS, armsOnCards: 'all' });
		expect(row(el, 'bo').querySelector('.dynasty-hero-arms')).toBeNull();
		expect(o.asks.filter((a) => a.fit === 'meet')).toHaveLength(1);
	});

	it('a child with a portrait has a 36 px place for it at the right of the row, and no arms', async () => {
		const o = store();
		const src = PICS.replace('parents: [ann]}', 'parents: [ann], portrait: "[[bo.png]]"}');
		phone();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = o.s;
		const { el } = await embed(src, { host, handle: noteHandle(src) });
		await settle();
		expect(row(el, 'bo').querySelector('.dynasty-list-portrait.has-picture img')).not.toBeNull();
		expect(row(el, 'bo').querySelector('.dynasty-hero-arms')).toBeNull();
		expect(o.asks.filter((a) => a.fit === 'portrait').map((a) => a.w).sort((x, y) => x - y)).toEqual([96, 128]);
	});

	it('"Show portraits on cards" off: no portrait is asked for', async () => {
		const o = store();
		const { el } = await withStore(o, { ...DEFAULT_SETTINGS, showPortraits: false });
		expect(o.asks.some((a) => a.fit === 'portrait')).toBe(false);
		expect(row(el, 'ann').querySelector('.dynasty-hero-portrait')).toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-arms.has-picture')).not.toBeNull();
		expect(row(el, 'ann').querySelector('.dynasty-hero-col.no-portrait')).not.toBeNull();
	});

	it('the copies go back to the store when the list is drawn again and when the view ends', async () => {
		const o = store();
		const { el, view, handle } = await withStore(o);
		expect(o.released).toEqual([]);
		handle.change(`${PICS}# edited\n`);
		await settle();
		const first = o.released.length;
		expect(first).toBe(2);
		(view as unknown as { onunload(): void }).onunload();
		expect(o.released.length).toBeGreaterThan(first);
		expect(new Set(o.released).size).toBe(o.released.length);
		expect(el.querySelector('.dynasty-popover')).toBeNull();
	});

	it('a copy that arrives after the list was drawn again is released at once, never shown', async () => {
		const o = store(true);
		const { el, handle } = await withStore(o);
		expect(o.asks).toHaveLength(2);
		handle.change(`${PICS}# edited\n`);
		await settle();
		const late = o.pending.splice(0);
		// The first draw's two requests answer now; the second draw's two are still waiting.
		for (const answer of late.slice(0, 2)) answer();
		await settle();
		expect(o.released).toHaveLength(2);
		expect(el.querySelector('.dynasty-picture')).toBeNull();
	});
});
