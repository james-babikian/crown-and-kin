import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { HousesWindow, firstFreeColour, houseOps, loadHouses, rowsOf } from '../../src/obsidian/houses-window';
import { HOUSE_PALETTE } from '../../src/render/styles';
import { HOUSES, HOUSE_COLOUR_NAMES, REMOVE, SHEET, WRITE_TEXT } from '../../src/render/ui-text';
import { TOOLBAR_UI } from '../../src/render/view-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, installDom, resetDom, runTimers, settle } from './fake-dom';
import { noticeList, notices, openModals, resetObsidian } from './fake-obsidian';
import { embed, fakeHandle, openFullScreen, phone, type FakeHandle } from './tree-view-fakes';
import { backButton, backToList, listRows, openPage, pageOf, rowOf } from '../lw-support';

const last = <T>(a: T[]): T | undefined => a[a.length - 1];

/*
 * WP6.3: the Houses window and its toolbar button (spec §6.10, §6.1, §5.2, §7.4, §7.5; D1, D32, D36;
 * The decision notes "M6 design gate"). The real TreeView and HousesWindow run on the fakes. The handle's
 * write applies the op with the real `applyOp` (the WP6.1 house ops), so a Save is checked on the
 * text it writes.
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
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// House colours from the palette of D32 (never copies of its values): Dark red, Dark blue; Green chosen below.
const P = HOUSE_PALETTE;
const SOURCE = `houses:
  - id: valmont
    name: House Valmont
    color: "${P[0]}"
  - id: orsini
    name: House Orsini
    color: "${P[8]}"
  - id: thorne
    name: House Thorne

people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
  - id: isolde
    name: Isolde Orsini
    house: orsini
  - id: lucan
    name: Lucan Orsini
    house: orsini

unions:
  - partners: [aldric, isolde]
`;

const BLOCKED = `people:
  - id: a
    name: A
  - id: a
    name: B
`;

/** A handle whose writes apply the op to its body, as the real handle does (spec §6.1), and keep one undo step. */
function writingHandle(body = SOURCE): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	const undo: string[] = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		undo.push(h.body);
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => {
		const prev = undo.pop();
		if (prev === undefined) return { ok: false, code: 'empty' };
		h.body = prev;
		return { ok: true, body: prev };
	}) as never);
	return h;
}

const toolbar = (root: FEl) =>
	Array.from(root.querySelector('.dynasty-toolbar')?.children ?? [])
		.map((b) => [...b.classes].find((c) => c.startsWith('dynasty-') && c !== 'dynasty-tool') ?? '')
		// The bars between the groups and the free room are no buttons.
		.filter((c) => c && c !== 'dynasty-sep' && c !== 'dynasty-grow');

const housesWindows = () => openModals.filter((m) => (m as unknown) instanceof HousesWindow) as unknown as HousesWindow[];

async function openWindow(o: { handle?: FakeHandle & { ops: Op[] }; source?: string } = {}) {
	const handle = o.handle ?? writingHandle(o.source);
	const e = await embed(handle.body, { handle });
	const button = e.el.querySelector('.dynasty-houses-button');
	expect(button).not.toBeNull();
	button!.focus();
	dispatch(button!, 'click');
	await settle();
	const win = housesWindows()[0];
	expect(win).toBeDefined();
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	const modal = (win as unknown as { modalEl: FEl }).modalEl;
	return { ...e, handle, win, content, modal, button: button! };
}

// 0.2.5 (D134): the window is a list and an edit page. A row is a button of the list; the fields are on the page.
const rows = (content: FEl) => listRows(content);
const row = (content: FEl, id: string) => rowOf(content, id);
/** The edit page of a house: back to the list first when another page is open. */
function pageFor(content: FEl, id: string): FEl {
	if (backButton(content)) backToList(content);
	return openPage(content, id);
}
const nameField = (content: FEl) => pageOf(content).querySelector('textarea.dynasty-lw-field')!;
const nameInput = (content: FEl, id: string) => pageFor(content, id).querySelector('textarea.dynasty-lw-field')!;
const deleteOf = (content: FEl, id: string) => pageFor(content, id).querySelector('.dynasty-house-delete')!;
const byText = (el: FEl, sel: string, text: string) => el.querySelectorAll(sel).find((b) => b.getText() === text) ?? null;
const save = (content: FEl) => dispatch(content.querySelector('.dynasty-sheet-save')!, 'click');

function type(input: FEl, text: string): void {
	input.value = text;
	dispatch(input, 'input');
}

describe('the Houses button (D36, spec §6.10)', () => {
	it('sits after Add person in the desktop embed', async () => {
		const { el } = await embed(SOURCE, { handle: writingHandle() });
		// 0.2.8 (G.13): Add person, Find, Focus, Fit | Houses, Titles | More … Expand.
		expect(toolbar(el)).toEqual(['dynasty-add-person', 'dynasty-find', 'dynasty-focus', 'dynasty-fit', 'dynasty-houses-button', 'dynasty-titles-button', 'dynasty-more', 'dynasty-expand']);
		const b = el.querySelector('.dynasty-houses-button')!;
		expect(b.tag).toBe('button');
		expect(b.getAttribute('aria-label')).toBe(TOOLBAR_UI.housesLabel);
	});

	it('is in the full-screen view, on the computer and on a phone', async () => {
		const desk = await openFullScreen(SOURCE);
		expect(toolbar(desk.root)).toEqual(['dynasty-add-person', 'dynasty-find', 'dynasty-focus', 'dynasty-fit', 'dynasty-houses-button', 'dynasty-titles-button', 'dynasty-more', 'dynasty-close']);
		desk.modal.close();
		phone();
		const ph = await openFullScreen(SOURCE);
		// The phone's bottom bar (G.13): Add person, Houses, Focus, Find, More, Close; Fit and Titles are in More.
		expect(toolbar(ph.root)).toEqual(['dynasty-add-person', 'dynasty-houses-button', 'dynasty-focus', 'dynasty-find', 'dynasty-more', 'dynasty-close']);
	});

	it('is not in the static phone preview (D1), a read-only tree or a tree with editing off', async () => {
		phone();
		const still = await embed(SOURCE, { handle: writingHandle() });
		// D144: the bar above the list of a phone note is Add person, Find and Expand (Back comes after a move).
		expect(toolbar(still.el)).toEqual(['dynasty-add-person', 'dynasty-show-text', 'dynasty-list-find', 'dynasty-expand']);
		resetDom();
		const ro = await embed(SOURCE);
		expect(ro.el.querySelector('.dynasty-houses-button')).toBeNull();
		const blocked = await embed(BLOCKED, { handle: writingHandle(BLOCKED) });
		expect(blocked.el.querySelector('.dynasty-houses-button')).toBeNull();
		expect(blocked.el.querySelector('.dynasty-read-only-label')).not.toBeNull();
	});

	it('opens a Houses window that lists every house with its colour and number of people', async () => {
		const { content, modal } = await openWindow();
		expect(modal.hasClass('dynasty-sheet')).toBe(true);
		expect(modal.hasClass('dynasty-houses')).toBe(true);
		expect(content.querySelector('.dynasty-sheet-title')!.getText()).toBe(HOUSES.title);
		expect(rows(content).map((r) => r.getAttribute('data-house'))).toEqual(['valmont', 'orsini', 'thorne']);
		expect(rows(content).map((r) => r.querySelector('.dynasty-lw-row-name')!.getText())).toEqual(['House Valmont', 'House Orsini', 'House Thorne']);
		expect(rows(content).map((r) => r.querySelector('.dynasty-lw-row-sum')!.getText())).toEqual(['1 person', '2 people', 'No people']);
		// 0.2.8 (D213, D214): the house colour is a small dot before the count; a house with no arms (and this window has no pictures) has no lead at all.
		const dot = (id: string) => row(content, id).querySelector('.dynasty-lw-dot');
		// Only the custom property carries the colour (spec §5.8).
		expect(dot('valmont')!.styleProps.get('--dynasty-house-color')).toBe(P[0]);
		expect(dot('thorne')).toBeNull();
		expect(row(content, 'valmont').querySelector('.dynasty-row-lead')).toBeNull();
	});
});

describe('draft and Save (spec §6.10, D32)', () => {
	it('shows the 12 house colours and "Other colour" on the edit page of a house', async () => {
		const { content } = await openWindow();
		expect(content.querySelector('.dynasty-house-colour')).toBeNull();
		pageFor(content, 'valmont');
		const colours = content.querySelectorAll('.dynasty-house-colour');
		expect(colours.map((c) => c.getAttribute('data-colour'))).toEqual([...HOUSE_PALETTE]);
		expect(colours.map((c) => c.getAttribute('aria-label'))).toEqual([...HOUSE_COLOUR_NAMES]);
		expect(colours.map((c) => c.styleProps.get('--dynasty-house-color'))).toEqual([...HOUSE_PALETTE]);
		expect(colours.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-colour'))).toEqual([P[0]]);
		const other = content.querySelector('.dynasty-house-other input')!;
		expect(other.getAttribute('type')).toBe('color');
		expect(content.querySelector('.dynasty-house-other .dynasty-swatch')!.getAttribute('aria-label')).toBe(HOUSES.otherColour);
		// The page opens with the focus on Back, so no keyboard opens on a phone.
		expect(fakeDoc.activeElement).toBe(backButton(content));
	});

	it('Save writes every change in one batch, then closes; the note gets the new text', async () => {
		const { content, handle, win } = await openWindow();
		pageFor(content, 'valmont');
		dispatch(content.querySelector(`.dynasty-house-colour[data-colour="${P[5]}"]`)!, 'click');
		expect(content.querySelector(`.dynasty-house-colour[data-colour="${P[5]}"]`)!.getAttribute('aria-pressed')).toBe('true');
		type(nameInput(content, 'orsini'), 'House Orsini of Vel');
		backToList(content);
		dispatch(content.querySelector('.dynasty-house-add')!, 'click');
		const fresh = pageOf(content);
		// The new name field has the focus; the new house takes the first colour no house uses (D32).
		expect(fakeDoc.activeElement).toBe(fresh.querySelector('textarea'));
		expect(fresh.querySelectorAll('.dynasty-house-colour').filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-colour'))).toEqual([P[0]]);
		type(fresh.querySelector('textarea')!, 'House Harrow');
		expect(handle.write).not.toHaveBeenCalled();
		save(content);
		await settle();
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(handle.ops[0]).toEqual({
			kind: 'batch',
			ops: [
				{ kind: 'edit-house', id: 'valmont', color: P[5] },
				{ kind: 'edit-house', id: 'orsini', name: 'House Orsini of Vel' },
				{ kind: 'add-house', name: 'House Harrow', color: P[0] },
			],
		});
		expect(handle.body).toContain(`color: "${P[5]}"`);
		expect(handle.body).toContain('name: House Orsini of Vel');
		expect(handle.body).toContain(`name: House Harrow\n    color: "${P[0]}"`);
		expect(housesWindows()).not.toContain(win);
		// No house was deleted: no Notice.
		expect(notices).toEqual([]);
	});

	it('a colour from "Other colour" is written as #rrggbb', async () => {
		const { content, handle } = await openWindow();
		pageFor(content, 'thorne');
		const other = content.querySelector('.dynasty-house-other input')!;
		other.value = '#A0B1C2';
		dispatch(other, 'change');
		backToList(content);
		expect(row(content, 'thorne').querySelector('.dynasty-lw-dot')!.styleProps.get('--dynasty-house-color')).toBe('#a0b1c2');
		save(content);
		await settle();
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'edit-house', id: 'thorne', color: '#a0b1c2' }] });
	});

	it('Save with no change writes nothing and closes', async () => {
		const { content, handle, win } = await openWindow();
		type(nameInput(content, 'valmont'), 'House Valmont');
		save(content);
		await settle();
		expect(handle.write).not.toHaveBeenCalled();
		expect(housesWindows()).not.toContain(win);
	});

	it('an empty name is refused, and the field gets the focus', async () => {
		const { content, handle } = await openWindow();
		dispatch(content.querySelector('.dynasty-house-add')!, 'click');
		type(nameInput(content, 'orsini'), '  ');
		save(content);
		await settle();
		expect(handle.write).not.toHaveBeenCalled();
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(HOUSES.needName);
		// The page of the house with the empty name opens, and its field has the focus.
		expect(pageOf(content).getAttribute('data-house')).toBe('orsini');
		expect(fakeDoc.activeElement).toBe(nameField(content));
	});

	it('Cancel writes nothing; the focus goes back to the Houses button (spec §5.2)', async () => {
		const { content, handle, win, el } = await openWindow();
		type(nameInput(content, 'valmont'), 'Changed');
		dispatch(content.querySelector('.dynasty-sheet-cancel')!, 'click');
		expect(housesWindows()).not.toContain(win);
		expect(handle.write).not.toHaveBeenCalled();
		expect(fakeDoc.activeElement).toBe(el.querySelector('.dynasty-houses-button'));
	});

	it('after Save the focus goes back to the Houses button of the tree drawn again', async () => {
		const { content, el, handle } = await openWindow();
		type(nameInput(content, 'valmont'), 'House Valmont the Elder');
		save(content);
		await settle();
		// The note shows the new body: the plugin draws the block again (a new view with a new button).
		handle.change(handle.body);
		runTimers(1000);
		const now = el.querySelector('.dynasty-houses-button');
		expect(now).not.toBeNull();
		expect(fakeDoc.activeElement).toBe(now);
	});
});

describe('delete a house (D32, spec §6.1 Notice with Undo)', () => {
	it('with people: asks, "Remove the house from these people" clears it from them, and the Notice has Undo', async () => {
		const { content, modal, handle, win } = await openWindow();
		const del = deleteOf(content, 'orsini');
		expect(del.getAttribute('aria-label')).toBe(HOUSES.deleteLabel('House Orsini'));
		dispatch(del, 'click');
		const ask = modal.querySelector('.dynasty-sheet-confirm')!;
		expect(ask.getAttribute('role')).toBe('alertdialog');
		expect(ask.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(HOUSES.confirmTitle('House Orsini'));
		expect(ask.querySelectorAll('.dynasty-sheet-confirm-text').map((t) => t.getText())).toEqual([HOUSES.confirmPeople(2), HOUSES.confirmAsk(2)]);
		const clear = ask.querySelector('.dynasty-house-clear')!;
		expect(clear.querySelector('.dynasty-choice-label')!.getText()).toBe(HOUSES.clearLabel(2));
		expect(ask.querySelector('.dynasty-house-keep .dynasty-choice-label')!.getText()).toBe(HOUSES.keepLabel(2));
		// The first choice has the focus, for the keyboard.
		expect(fakeDoc.activeElement).toBe(clear);
		dispatch(clear, 'click');
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(rows(content).map((r) => r.getAttribute('data-house'))).toEqual(['valmont', 'thorne']);
		// Nothing is written before Save.
		expect(handle.write).not.toHaveBeenCalled();
		const before = handle.body;
		save(content);
		await settle();
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'delete-house', id: 'orsini', people: 'clear' }] });
		expect(handle.body).not.toContain('orsini');
		expect(housesWindows()).not.toContain(win);
		expect(notices).toEqual([HOUSES.deleted(['House Orsini'])]);
		const undo = noticeList[0].messageEl.querySelector('.dynasty-undo-button')!;
		expect(undo.getText()).toBe(REMOVE.undo);
		dispatch(undo, 'click');
		await settle();
		expect(handle.undo).toHaveBeenCalledTimes(1);
		expect(handle.body).toBe(before);
		expect(last(notices)).toBe(WRITE_TEXT.undoDone);
	});

	it('"Keep the house for these people" keeps their house key', async () => {
		const { content, modal, handle } = await openWindow();
		dispatch(deleteOf(content, 'orsini'), 'click');
		dispatch(modal.querySelector('.dynasty-house-keep')!, 'click');
		save(content);
		await settle();
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'delete-house', id: 'orsini', people: 'keep' }] });
		expect(handle.body.match(/house: orsini/g)).toHaveLength(2);
		expect(handle.body).not.toContain('House Orsini');
	});

	it('with no people: no question', async () => {
		const { content, modal, handle } = await openWindow();
		dispatch(deleteOf(content, 'thorne'), 'click');
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		// The list shows, and the focus goes to the row before the deleted one (D.3.7).
		expect(backButton(content)).toBeNull();
		expect(fakeDoc.activeElement).toBe(row(content, 'orsini'));
		save(content);
		await settle();
		expect(handle.ops[0]).toEqual({ kind: 'batch', ops: [{ kind: 'delete-house', id: 'thorne', people: 'clear' }] });
		expect(notices).toEqual([HOUSES.deleted(['House Thorne'])]);
	});

	it('a delete saved with other changes: one write, and the Notice says that Undo removes them too', async () => {
		const { content, handle } = await openWindow();
		type(nameInput(content, 'valmont'), 'House Valmont II');
		dispatch(deleteOf(content, 'thorne'), 'click');
		save(content);
		await settle();
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(notices).toEqual([`${HOUSES.deleted(['House Thorne'])} ${REMOVE.undoAlso}`]);
	});

	it('a new house deleted before Save is simply gone', async () => {
		const { content, handle } = await openWindow();
		dispatch(content.querySelector('.dynasty-house-add')!, 'click');
		const fresh = pageOf(content);
		type(fresh.querySelector('textarea')!, 'House Gone');
		dispatch(fresh.querySelector('.dynasty-house-delete')!, 'click');
		expect(rows(content)).toHaveLength(3);
		// Nothing is left to save, so the list has Close only.
		expect(content.querySelector('button[data-focus="save"]')).toBeNull();
		dispatch(content.querySelector('button[data-focus="cancel"]')!, 'click');
		await settle();
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('closing and questions (spec §6.3 commit model, §5.2 keyboard)', () => {
	it('Esc with changes asks "Discard changes?"; Continue to edit keeps the draft; Discard closes', async () => {
		const { content, modal, win, handle } = await openWindow();
		type(nameInput(content, 'valmont'), 'Changed');
		// The first close goes back from the page to the list; the second asks.
		win.close();
		expect(backButton(content)).toBeNull();
		win.close();
		const ask = modal.querySelector('.dynasty-sheet-confirm')!;
		expect(ask.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe(SHEET.discardTitle);
		expect(ask.querySelector('.dynasty-sheet-confirm-text')!.getText()).toBe(HOUSES.discardText);
		expect(housesWindows()).toContain(win);
		dispatch(byText(ask, 'button', SHEET.keepEditing)!, 'click');
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(nameInput(content, 'valmont').value).toBe('Changed');
		win.close();
		win.close();
		dispatch(byText(modal, 'button', SHEET.discard)!, 'click');
		expect(housesWindows()).not.toContain(win);
		expect(handle.write).not.toHaveBeenCalled();
	});

	it('Esc on an edit page goes back to the list, and the row keeps the focus', async () => {
		const { content, win } = await openWindow();
		pageFor(content, 'orsini');
		expect(content.querySelector('.dynasty-house-palette')).not.toBeNull();
		win.close();
		expect(housesWindows()).toContain(win);
		expect(content.querySelector('.dynasty-house-palette')).toBeNull();
		expect(fakeDoc.activeElement).toBe(row(content, 'orsini'));
		win.close();
		expect(housesWindows()).not.toContain(win);
	});

	it('Esc in the delete question closes only the question; the focus goes back to Delete', async () => {
		const { content, modal, win } = await openWindow();
		dispatch(deleteOf(content, 'orsini'), 'click');
		win.close();
		expect(modal.querySelector('.dynasty-sheet-confirm')).toBeNull();
		expect(housesWindows()).toContain(win);
		// The page stays open under the question; the house is still there.
		expect(pageOf(content).getAttribute('data-house')).toBe('orsini');
		expect(fakeDoc.activeElement).toBe(pageOf(content).querySelector('.dynasty-house-delete'));
	});

	it('every control is a button or a field with a name, so the window works by keyboard alone', async () => {
		const { content, modal } = await openWindow();
		const named = (c: FEl) => !!c.getAttribute('aria-label') || c.getText() !== '' || (c.getAttribute('id') && modal.querySelector(`label[for="${c.getAttribute('id')}"]`));
		// The colour field behind the "Other colour" swatch is hidden from the keyboard on purpose: the swatch is the control.
		const controlsOf = () => modal.all().filter((e) => ['button', 'input', 'select', 'textarea'].includes(e.tag) && e.getAttribute('aria-hidden') !== 'true');
		// The list: the search box and Add, the rows, then Close in the footer (the list has nothing to save).
		for (const c of controlsOf()) {
			expect(c.getAttribute('tabindex')).not.toBe('-1');
			expect(named(c), `${c.tag}.${[...c.classes].join('.')}`).toBeTruthy();
		}
		expect(controlsOf().map((c) => [...c.classes][0] ?? c.tag).slice(-1)).toEqual(['dynasty-sheet-cancel']);
		pageFor(content, 'valmont');
		const controls = controlsOf();
		for (const c of controls) {
			expect(c.getAttribute('tabindex')).not.toBe('-1');
			expect(named(c), `${c.tag}.${[...c.classes].join('.')}`).toBeTruthy();
		}
		// Back and the page first; Delete (in Other actions) last of the page; then Cancel and Save in the footer.
		const order = controls.map((c) => [...c.classes][0] ?? c.tag);
		expect(order.slice(-2)).toEqual(['dynasty-sheet-cancel', 'mod-cta']);
		expect(controls[controls.length - 3]!.hasClass('dynasty-house-delete')).toBe(true);
	});
});

describe('stale writes (spec §6.1)', () => {
	it('the tree changed after the window opened: nothing is written, the draft stays, the new text shows', async () => {
		const { content, handle, win } = await openWindow();
		type(nameInput(content, 'valmont'), 'My Valmont');
		// Someone adds a house in the note meanwhile.
		handle.body = SOURCE.replace('people:', '  - id: blackwood\n    name: House Blackwood\n\npeople:');
		save(content);
		await settle();
		expect(handle.write).not.toHaveBeenCalled();
		expect(notices).toEqual([WRITE_TEXT.staleWindow]);
		expect(housesWindows()).toContain(win);
		expect(content.querySelector('.dynasty-sheet-error')!.getText()).toBe(HOUSES.stale);
		// The open page stays, with the draft.
		expect(nameField(content).value).toBe('My Valmont');
		backToList(content);
		expect(rows(content).map((r) => r.getAttribute('data-house'))).toEqual(['valmont', 'orsini', 'thorne', 'blackwood']);
		// Save again: it writes the user's change on the new text.
		save(content);
		await settle();
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(handle.body).toContain('name: My Valmont');
		expect(handle.body).toContain('name: House Blackwood');
	});

	it('a house that is gone when the write runs: the stale message, and the draft stays', async () => {
		const handle = writingHandle();
		const { content, win } = await openWindow({ handle });
		type(nameInput(content, 'thorne'), 'House Thorne II');
		handle.write.mockImplementationOnce((async () => {
			handle.body = SOURCE.replace('  - id: thorne\n    name: House Thorne\n', '');
			return { ok: false, code: 'stale' };
		}) as never);
		save(content);
		await settle();
		expect(notices).toEqual([WRITE_TEXT.staleWindow]);
		expect(housesWindows()).toContain(win);
		expect(rows(content).map((r) => r.getAttribute('data-house'))).toEqual(['valmont', 'orsini']);
	});

	it('a refused write keeps the window and says why', async () => {
		const handle = writingHandle();
		const { content, win } = await openWindow({ handle });
		type(nameInput(content, 'valmont'), 'X');
		handle.write.mockImplementationOnce((async () => ({ ok: false, code: 'refused', refusal: { ok: false, code: 'bad-value' } })) as never);
		save(content);
		await settle();
		expect(notices).toEqual([HOUSES.refused]);
		expect(housesWindows()).toContain(win);
		expect(nameField(content).value).toBe('X');
	});
});

describe('pure parts', () => {
	it('loadHouses counts the people of each house once, and refuses a blocked or broken tree', () => {
		const l = loadHouses(SOURCE);
		expect(l.kind === 'ok' && l.data.houses.map((h) => [h.id, h.people])).toEqual([
			['valmont', ['Aldric Valmont']],
			['orsini', ['Isolde Orsini', 'Lucan Orsini']],
			['thorne', []],
		]);
		expect(loadHouses(BLOCKED).kind).toBe('blocked');
		expect(loadHouses('people: [').kind).toBe('invalid');
		expect(HousesWindow.create({} as never, { handle: fakeHandle('n.md', BLOCKED) as never })).toBeNull();
		expect(notices).toEqual([WRITE_TEXT.blocked]);
	});

	it('firstFreeColour takes the first house colour no house uses, and the first when all are used', () => {
		const l = loadHouses(SOURCE);
		if (l.kind !== 'ok') throw new Error('parse');
		const r = rowsOf(l.data);
		expect(firstFreeColour(r)).toBe(P[1]);
		const all = HOUSE_PALETTE.map((c, i) => ({ ...r[0], key: `k${i}`, colour: c.toUpperCase() }));
		expect(firstFreeColour(all)).toBe(HOUSE_PALETTE[0]);
	});

	it('houseOps: an unchanged colour in other letter case is no change; a colour that is not #rrggbb is never written', () => {
		const l = loadHouses(SOURCE.replace(`"${P[0]}"`, `"${P[0].toUpperCase()}"`));
		if (l.kind !== 'ok') throw new Error('parse');
		const r = rowsOf(l.data);
		r[0].colour = P[0];
		expect(houseOps(r)).toEqual([]);
		r[2].colour = 'red';
		expect(houseOps(r)).toEqual([]);
	});
});
