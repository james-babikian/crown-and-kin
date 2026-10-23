import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBlocks } from '../../src/core/block-locate';
import { openCalendars as openCalendarsToday } from '../../src/obsidian/calendar-window';
import { calendarBlockProcessor } from '../../src/obsidian/calendar-block-view';
import { CALENDAR_WINDOW_UI } from '../../src/render/calendar-text';
import { calVault, calendarKeys, calendarNotesOf, firstCalendarName, cycleNote, eraNote, fakeCalApp, hasField, calField, lastMenu, lastModal, makeIndex, openModals, press, saveWindow, settleReal, typeInto, type CalIndexLike } from '../support/r04-calendar-fakes';
import { FEl, dispatch, resetDom, runTimers } from './fake-dom';
import { notices, resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-3a, step T0, package C: the Calendars window (the index contract 4.3, D289, D290; test list 10; the plan of the gate for the key). Opened from a tree with no key, the window shows the first
 * calendar note by name and Save writes that note as the key of the tree, even with no change (D290). The table of 4.3 says which notes the window can show for each opening.
 * `setLink` writes the key and answers 'ok', 'has-key' or 'failed'. A tree that names a note keeps its key. An empty new-note draft saved makes nothing. A named note with no calendar block gets
 * the block when you save. "Test a date" reads the draft only. The words of the new lines are drafts: the tests take them from the text table (`CALENDAR_WINDOW_UI`), never from this file.
 * Written from the contract before the code existed; package C built the code and turned the tests on.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

/** The new lines of the window (the index contract 4.3): their names are those of the contract, their words are drafts. */
interface WindowUi {
	treeNewNote(name: string): string;
	treeUsesNote(name: string): string;
	treeStillUses(name: string): string;
	treeReadOnly: string;
	noNoteMeta: string;
	newNote: string;
}
const T = CALENDAR_WINDOW_UI as unknown as WindowUi;

type SetLinkResult = 'ok' | 'has-key' | 'failed';
interface TreeSpec {
	treePath?: string;
	link?: string;
	setLink?: ((link: string) => Promise<SetLinkResult>) | null;
}
interface OpenOptions {
	tree?: TreeSpec | null;
	note?: string;
	links?: Record<string, string>;
	/** The fence index says it is complete (default), or not yet. */
	complete?: () => boolean;
	/** The fence notes, if they are not the notes with a calendar block. */
	fenceNotes?: () => string[];
	/** Other trees that name a note: the index has read these notes before the window opens. */
	otherTrees?: { treePath: string; link: string }[];
}
type OpenCalendars = (app: unknown, index: unknown, o: { tree: unknown; note?: string; onClosed?: () => void }) => Promise<void>;
const openCalendars = openCalendarsToday as unknown as OpenCalendars;

async function prepare(files: Record<string, string>, o: OpenOptions = {}) {
	const { app, notes, created } = fakeCalApp(files);
	const vault = calVault({}, o.links);
	vault.notes = notes;
	const index = await makeIndex(vault, { notes: o.fenceNotes ?? (() => calendarNotesOf(notes)), ...(o.complete ? { complete: o.complete } : {}) });
	await index.start();
	for (const t of o.otherTrees ?? []) index.readerFor(t.treePath, t.link);
	await settleReal();
	const tree = o.tree === null ? null : { treePath: 'tree.md', link: undefined, setLink: null, ...o.tree };
	return { app, notes, created, vault, index, tree };
}

async function open(files: Record<string, string>, o: OpenOptions = {}) {
	const p = await prepare(files, o);
	await openCalendars(p.app, p.index, { tree: p.tree, ...(o.note ? { note: o.note } : {}) });
	await settleReal();
	return { ...p, win: lastModal(), c: lastModal().contentEl };
}

const setLinkSpy = (result: SetLinkResult = 'ok') => vi.fn<(link: string) => Promise<SetLinkResult>>(async () => result);

const ALPHA = 'Worlds/Alpha.md';
const BETA = 'Beta.md';
const FILES = { [ALPHA]: cycleNote('Alpha Count'), [BETA]: eraNote('Beta Eras', 'Aldric', 100), 'tree.md': 'plain' };

/** Adds a cycle calendar with the empty-window button and fills it in. */
async function addCycleCalendar(c: FEl, name = 'Count'): Promise<void> {
	await press(c, '.dynasty-cal-add-cycles');
	const keys = calendarKeys(c);
	const k = keys[keys.length - 1];
	typeInto(c, `${k}-name`, name);
	typeInto(c, `${k}-formats`, '{year} of {cycle}');
	typeInto(c, `${k}-length`, '12');
}

describe('what the window shows for each opening (the index contract 4.3, the table; D290)', () => {
	it('a tree with no key: the first calendar note by name (not by path), the other notes in the select, no new-note draft', async () => {
		const o = await open(FILES, { tree: { setLink: setLinkSpy() } });
		expect(firstCalendarName(o.c)).toBe('Alpha Count');
		expect(hasField(o.c, 'new-name')).toBe(false);
		const select = o.c.querySelector('[data-focus="cal:note"]')!;
		expect(select.querySelectorAll('option').map((e) => e.getText())).toEqual(['Alpha', 'Beta']);
		// The line before Save says what Save does.
		expect(o.c.getText()).toContain(T.treeUsesNote('Alpha'));
	});

	it('the select chooses another calendar note, and the line follows it', async () => {
		const o = await open(FILES, { tree: { setLink: setLinkSpy() } });
		const select = o.c.querySelector('[data-focus="cal:note"]')!;
		select.value = BETA;
		dispatch(select, 'change');
		await settleReal();
		expect(firstCalendarName(o.c)).toBe('Beta Eras');
		expect(o.c.getText()).toContain(T.treeUsesNote('Beta'));
		expect(o.c.getText()).not.toContain(T.treeUsesNote('Alpha'));
	});

	it('a tree with no key in a vault with no calendar note: a new-note draft named Calendars, and the line says the plugin makes it', async () => {
		const o = await open({ 'tree.md': 'plain' }, { tree: { setLink: setLinkSpy() } });
		expect(calField(o.c, 'new-name').value).toBe('Calendars');
		expect(o.c.getText()).toContain(T.treeNewNote('Calendars'));
		expect(o.c.querySelector('[data-focus="cal:note"]')).toBeNull();
	});

	it('a tree that names a note that exists: only that note, and no select, although other notes exist', async () => {
		const o = await open(FILES, { tree: { link: '[[Beta]]', setLink: null }, links: { '[[Beta]]': BETA } });
		expect(firstCalendarName(o.c)).toBe('Beta Eras');
		expect(o.c.querySelector('[data-focus="cal:note"]')).toBeNull();
		expect(hasField(o.c, 'new-name')).toBe(false);
	});

	it('a tree that names a note that is missing: a new-note draft with the name and the folder of the link', async () => {
		const o = await open(FILES, { tree: { link: '[[Worlds/Far Land]]', setLink: null } });
		expect(calField(o.c, 'new-name').value).toBe('Far Land');
		expect(calField(o.c, 'new-folder').value).toBe('Worlds');
		await addCycleCalendar(o.c);
		await saveWindow(o.c);
		expect(o.created).toEqual(['Worlds/Far Land.md']);
	});

	it('no tree, a note given (the Edit button of a block): that note', async () => {
		const o = await open(FILES, { tree: null, note: BETA });
		expect(firstCalendarName(o.c)).toBe('Beta Eras');
		expect(o.c.getText()).not.toContain(T.treeUsesNote('Beta'));
	});

	it('no tree and no note given: the first note by name; with no calendar note at all: a new-note draft', async () => {
		const first = await open(FILES, { tree: null });
		expect(firstCalendarName(first.c)).toBe('Alpha Count');
		resetDom();
		resetObsidian();
		const none = await open({ 'tree.md': 'plain' }, { tree: null });
		expect(calField(none.c, 'new-name').value).toBe('Calendars');
	});

	it('a named note whose block cannot be read stops the window with its message', async () => {
		const bad = '```kin-calendar\ncalendars: not a list\n```\n';
		const o = await prepare({ 'Bad.md': bad, 'tree.md': 'plain' }, { links: { '[[Bad]]': 'Bad.md' } });
		await openCalendars(o.app, o.index, { tree: { treePath: 'tree.md', link: '[[Bad]]', setLink: null } });
		await settleReal();
		expect(openModals).toHaveLength(0);
		expect(notices.join(' ')).toContain('has an error');
	});

	it('the index reads no note for the window: it only lists the notes of the fence index', async () => {
		const o = await open(FILES, { tree: { setLink: setLinkSpy() } });
		expect(o.vault.reads).toEqual([]);
	});
});

describe('a tree with no key and the fence index not complete (the index contract 4.3, D290, gate pass 2 item 4)', () => {
	/** Runs the clock of the fake window on, one step of 100 ms at a time, with a turn of real time between the steps. */
	async function run(steps: number, each?: (step: number) => void): Promise<number | null> {
		for (let i = 0; i < steps; i++) {
			each?.(i);
			if (openModals.length) return i;
			runTimers(100);
			await new Promise<void>((r) => setTimeout(r, 15));
		}
		return null;
	}

	// ASSUMED API: how the window learns that the fence index is complete is not fixed in the contract. These tests use `IndexOptions.complete(): boolean`.
	it('waits for the notes up to 1 s: when the notes come in that time, the window opens on the first note, and never says that the vault has no calendar note', async () => {
		let complete = false;
		const files: Record<string, string> = { 'tree.md': 'plain' };
		const p = await prepare(files, { tree: { setLink: setLinkSpy() }, complete: () => complete, fenceNotes: () => calendarNotesOf(p.notes) });
		const opening = openCalendars(p.app, p.index, { tree: p.tree });
		await run(3);
		// Nothing opens while the fence index is not complete and the list is empty.
		expect(openModals).toHaveLength(0);
		complete = true;
		p.notes.set(ALPHA, cycleNote('Alpha Count'));
		await run(25);
		await opening;
		await settleReal();
		expect(openModals).toHaveLength(1);
		const c = lastModal().contentEl;
		expect(firstCalendarName(c)).toBe('Alpha Count');
		expect(hasField(c, 'new-name')).toBe(false);
		expect(c.getText()).not.toContain(T.noNoteMeta);
		expect(c.getText()).not.toContain(T.treeNewNote('Calendars'));
	});

	it('when the index is not complete after 1 s, the window opens, and still does not say that the vault has no calendar note', async () => {
		const p = await prepare({ 'tree.md': 'plain' }, { tree: { setLink: setLinkSpy() }, complete: () => false, fenceNotes: () => [] });
		const opening = openCalendars(p.app, p.index, { tree: p.tree });
		const at = await run(40);
		await opening;
		await settleReal();
		expect(openModals).toHaveLength(1);
		// It waited: it did not open at the first step.
		expect(at === null || at >= 5).toBe(true);
		const c = lastModal().contentEl;
		expect(c.getText()).not.toContain(T.noNoteMeta);
		expect(c.getText()).not.toContain(T.treeNewNote('Calendars'));
	});

	it('a complete index with no calendar note opens at once, with the draft and the line that says the plugin makes the note', async () => {
		const p = await prepare({ 'tree.md': 'plain' }, { tree: { setLink: setLinkSpy() }, complete: () => true });
		await openCalendars(p.app, p.index, { tree: p.tree });
		await settleReal();
		expect(openModals).toHaveLength(1);
		expect(lastModal().contentEl.getText()).toContain(T.treeNewNote('Calendars'));
	});
});

describe('Save in a window with setLink: the key is written (the index contract 4.3, D289, D290)', () => {
	it('a new note: the note is made, the index is told, then the key is set to the new note; one Notice; the window closes', async () => {
		const seen: { calendars: number; text: string | undefined }[] = [];
		const holder: { o?: Awaited<ReturnType<typeof open>> } = {};
		const setLink = vi.fn<(link: string) => Promise<SetLinkResult>>(async () => {
			// At this moment the note exists and the index has read it again.
			seen.push({ calendars: holder.o!.index.calendarsOf('Calendars.md').length, text: holder.o!.notes.get('Calendars.md') });
			return 'ok';
		});
		const o = await open({ 'tree.md': 'plain' }, { tree: { setLink } });
		holder.o = o;
		await addCycleCalendar(o.c);
		await saveWindow(o.c);
		expect(o.created).toEqual(['Calendars.md']);
		expect(setLink).toHaveBeenCalledTimes(1);
		expect(setLink).toHaveBeenCalledWith('[[Calendars]]');
		expect(seen).toHaveLength(1);
		expect(seen[0].calendars).toBe(1);
		expect(seen[0].text).toContain('name: Count');
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain('Calendars');
		expect(openModals).toHaveLength(0);
	});

	it('an existing note shown, with a change: the change is written and the key is set to that note', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { setLink } });
		typeInto(o.c, '0-length', '70');
		await saveWindow(o.c);
		expect(o.notes.get(ALPHA)).toContain('length: 70');
		expect(setLink).toHaveBeenCalledTimes(1);
		expect(setLink).toHaveBeenCalledWith('[[Alpha]]');
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain('Alpha');
		expect(openModals).toHaveLength(0);
	});

	it('the first note shown with NO change: Save still sets the key, writes nothing to the note, and closes the window', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { setLink } });
		const before = o.notes.get(ALPHA);
		await saveWindow(o.c);
		expect(setLink).toHaveBeenCalledTimes(1);
		expect(setLink).toHaveBeenCalledWith('[[Alpha]]');
		expect(o.notes.get(ALPHA)).toBe(before);
		expect(o.created).toEqual([]);
		expect(openModals).toHaveLength(0);
		expect(notices).toHaveLength(1);
	});

	it('another note chosen in the select, with no change: Save sets the key to the chosen note and makes no new note', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { setLink } });
		const select = o.c.querySelector('[data-focus="cal:note"]')!;
		select.value = BETA;
		dispatch(select, 'change');
		await settleReal();
		const before = new Map(o.notes);
		await saveWindow(o.c);
		expect(setLink).toHaveBeenCalledWith('[[Beta]]');
		expect(o.notes).toEqual(before);
		expect(o.created).toEqual([]);
	});

	it('a named-key window is not asked to set a key: a tree that names a note keeps its key, whatever the Save', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { link: '[[Beta]]', setLink }, links: { '[[Beta]]': BETA } });
		typeInto(o.c, '0-name', 'Renamed Eras');
		await saveWindow(o.c);
		expect(o.notes.get(BETA)).toContain('name: Renamed Eras');
		expect(setLink).not.toHaveBeenCalled();
	});

	it('an empty new-note draft: Save makes nothing and writes no key, like Cancel', async () => {
		const setLink = setLinkSpy();
		const o = await open({ 'tree.md': 'plain' }, { tree: { setLink } });
		await saveWindow(o.c);
		expect(o.created).toEqual([]);
		expect(setLink).not.toHaveBeenCalled();
		expect(openModals).toHaveLength(0);
		expect(notices).toEqual([]);
	});

	it('the Notice for each answer of setLink is one Notice, and the three are different', async () => {
		const said: Record<string, string[]> = {};
		for (const result of ['ok', 'has-key', 'failed'] as const) {
			resetDom();
			resetObsidian();
			const setLink = setLinkSpy(result);
			const o = await open(FILES, { tree: { setLink } });
			typeInto(o.c, '0-length', '71');
			await saveWindow(o.c);
			// The calendars are saved, whatever the answer.
			expect(o.notes.get(ALPHA)).toContain('length: 71');
			expect(setLink).toHaveBeenCalledTimes(1);
			said[result] = [...notices];
			expect(said[result]).toHaveLength(1);
		}
		expect(new Set([said.ok[0], said['has-key'][0], said.failed[0]]).size).toBe(3);
		expect(said.ok[0]).toContain('Alpha');
	});

	it("'has-key': the calendars stay saved and the tree is not changed by the window", async () => {
		const setLink = setLinkSpy('has-key');
		const o = await open(FILES, { tree: { setLink } });
		typeInto(o.c, '0-name', 'Renamed Count');
		await saveWindow(o.c);
		expect(o.notes.get(ALPHA)).toContain('name: Renamed Count');
		expect(setLink).toHaveBeenCalledTimes(1);
	});

	it('a Save that is refused (a bad format) writes nothing and sets no key', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { setLink } });
		typeInto(o.c, '0-formats', '{year} only');
		await saveWindow(o.c);
		expect(setLink).not.toHaveBeenCalled();
		expect(openModals).toHaveLength(1);
	});

	it('a note that changed while the window was open: the stale message, and no key', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { setLink } });
		typeInto(o.c, '0-length', '70');
		o.notes.set(ALPHA, cycleNote('Changed elsewhere'));
		await saveWindow(o.c);
		expect(setLink).not.toHaveBeenCalled();
		expect(openModals).toHaveLength(1);
		expect(o.notes.get(ALPHA)).toContain('Changed elsewhere');
	});
});

describe('a named note with no calendar block gets the block (the index contract 4.3, the table)', () => {
	const LORE = '# Lore\n\nThe long history of the house.\n';

	it('the window shows it with no calendars; Save writes the block into that note, and makes no other note', async () => {
		const o = await open({ 'Lore.md': LORE, 'tree.md': 'plain' }, { tree: { link: '[[Lore]]', setLink: null }, links: { '[[Lore]]': 'Lore.md' } });
		expect(calendarKeys(o.c)).toEqual([]);
		expect(hasField(o.c, 'new-name')).toBe(false);
		await addCycleCalendar(o.c);
		await saveWindow(o.c);
		const text = o.notes.get('Lore.md')!;
		expect(text.startsWith('# Lore\n\nThe long history of the house.')).toBe(true);
		expect(findBlocks(text, 'kin-calendar')).toHaveLength(1);
		expect(text).toContain('name: Count');
		expect(o.created).toEqual([]);
		expect([...o.notes.keys()].sort()).toEqual(['Lore.md', 'tree.md']);
		expect(o.index.calendarsOf('Lore.md').map((k) => k.name)).toEqual(['Count']);
	});

	it('a named note with an empty block gets its calendar in that block, not in a second one', async () => {
		const empty = '# Lore\n\n```kin-calendar\ncalendars: []\n```\n';
		const o = await open({ 'Lore.md': empty, 'tree.md': 'plain' }, { tree: { link: '[[Lore]]', setLink: null }, links: { '[[Lore]]': 'Lore.md' }, fenceNotes: () => ['Lore.md'] });
		await addCycleCalendar(o.c);
		await saveWindow(o.c);
		const text = o.notes.get('Lore.md')!;
		expect(findBlocks(text, 'kin-calendar')).toHaveLength(1);
		expect(text).toContain('name: Count');
		expect(o.created).toEqual([]);
	});

	it('with no change, Save writes nothing to the note', async () => {
		const o = await open({ 'Lore.md': LORE, 'tree.md': 'plain' }, { tree: { link: '[[Lore]]', setLink: null }, links: { '[[Lore]]': 'Lore.md' } });
		await saveWindow(o.c);
		expect(o.notes.get('Lore.md')).toBe(LORE);
		expect(o.created).toEqual([]);
	});
});

describe('the line before Save and "New calendar note" (the index contract 4.3, "The line before Save")', () => {
	it('"New calendar note" from a tree that names a note: an empty draft, the line says the tree still uses its note, Save makes the new note and the key is kept', async () => {
		const setLink = setLinkSpy();
		const o = await open(FILES, { tree: { link: '[[Beta]]', setLink }, links: { '[[Beta]]': BETA } });
		await press(o.c, '.dynasty-cal-new-note');
		expect(hasField(o.c, 'new-name')).toBe(true);
		expect(o.c.getText()).toContain(T.treeStillUses('Beta'));
		await addCycleCalendar(o.c, 'Far Count');
		await saveWindow(o.c);
		expect(o.created).toHaveLength(1);
		expect(o.notes.get(BETA)).toBe(FILES[BETA]);
		expect(setLink).not.toHaveBeenCalled();
	});

	it('a tree with no key that cannot be written: the line says so, and Save still saves the calendars but sets no key', async () => {
		const o = await open(FILES, { tree: { link: undefined, setLink: null } });
		expect(o.c.getText()).toContain(T.treeReadOnly);
		typeInto(o.c, '0-length', '65');
		await saveWindow(o.c);
		expect(o.notes.get(ALPHA)).toContain('length: 65');
		expect(openModals).toHaveLength(0);
	});

	it('"New calendar note" from a tree with no key: the draft, and the line for a new note', async () => {
		const o = await open(FILES, { tree: { setLink: setLinkSpy() } });
		await press(o.c, '.dynasty-cal-new-note');
		expect(hasField(o.c, 'new-name')).toBe(true);
		expect(o.c.getText()).toContain(T.treeNewNote(String(calField(o.c, 'new-name').value)));
	});

	it('"New calendar note" with a draft that has changes asks first, as before', async () => {
		const o = await open(FILES, { tree: { setLink: setLinkSpy() } });
		typeInto(o.c, '0-length', '70');
		await press(o.c, '.dynasty-cal-new-note');
		expect(hasField(o.c, 'new-name')).toBe(false);
	});
});

describe('"Test a date" and the warnings read the draft only (the index contract 4.3, rule 16)', () => {
	const BETA_CYCLES = cycleNote('Beta Count', '{year} Annum of the {cycle} Era', 5);
	const TWO = { [ALPHA]: cycleNote('Alpha Count'), 'Beta.md': BETA_CYCLES, 'tree.md': 'plain' };

	it('a date of another calendar note is not read: "Test a date" shows nothing of Beta while the window shows Alpha', async () => {
		const o = await open(TWO, { tree: { setLink: setLinkSpy() } });
		const input = o.c.querySelector('[data-focus="test:all"]')!;
		const line = () => o.c.querySelector('.dynasty-cal-testbox [data-readout]')?.getText() ?? '';
		input.value = '3 Annum of the 2 Era';
		dispatch(input, 'input');
		expect(line()).not.toContain('Beta Count');
		input.value = '3 Year of the 2 Cycle';
		dispatch(input, 'input');
		expect(line()).toContain('Alpha Count');
	});

	it('also when another tree has made the index read that other note', async () => {
		const o = await open(TWO, { tree: { setLink: setLinkSpy() }, links: { '[[Beta]]': BETA }, otherTrees: [{ treePath: 'other.md', link: '[[Beta]]' }] });
		expect(o.index.calendarsOf(BETA).map((k) => k.name)).toEqual(['Beta Count']);
		const input = o.c.querySelector('[data-focus="test:all"]')!;
		input.value = '3 Annum of the 2 Era';
		dispatch(input, 'input');
		expect(o.c.querySelector('.dynasty-cal-testbox [data-readout]')?.getText() ?? '').not.toContain('Beta Count');
	});

	it('the same format in another calendar note is no warning: nothing is shown, and Save goes ahead', async () => {
		const o = await open({ [ALPHA]: cycleNote('Alpha Count'), 'Beta.md': cycleNote('Beta Count') }, { tree: { setLink: setLinkSpy() }, links: { '[[Beta]]': BETA }, otherTrees: [{ treePath: 'other.md', link: '[[Beta]]' }] });
		expect(o.c.querySelectorAll('[data-warning]')).toHaveLength(0);
		typeInto(o.c, '0-length', '61');
		await saveWindow(o.c);
		expect(o.notes.get(ALPHA)).toContain('length: 61');
	});

	it('a format that two calendars of the same note share is still a refusal', async () => {
		const o = await open({ [ALPHA]: cycleNote('Alpha Count') }, { tree: { setLink: setLinkSpy() } });
		await press(o.c, '[data-focus="cal:add"]');
		lastMenu()!.item(CALENDAR_WINDOW_UI.kindCycles)!.click();
		await settleReal();
		typeInto(o.c, '1-name', 'Copy');
		typeInto(o.c, '1-formats', '{year} Year of the {cycle} Cycle');
		typeInto(o.c, '1-length', '10');
		const before = o.notes.get(ALPHA);
		await saveWindow(o.c);
		expect(o.notes.get(ALPHA)).toBe(before);
		expect(openModals).toHaveLength(1);
		expect(o.c.querySelectorAll('[data-refusal]').length).toBeGreaterThan(0);
	});
});

describe('the Edit button of a block opens with no tree (the index contract 4.3)', () => {
	it('opens on the note of the block, shows no line about a tree, and a Save with no change closes with no write and no key', async () => {
		const p = await prepare(FILES, { tree: null });
		const el = new FEl('div');
		const added: { onload?: () => void }[] = [];
		const source = FILES[BETA];
		const ctx = { sourcePath: BETA, addChild: (ch: { onload?: () => void }) => added.push(ch) };
		(calendarBlockProcessor as unknown as (app: unknown, index: CalIndexLike) => (src: string, el: unknown, ctx: unknown) => void)(p.app, p.index)(findBlocks(source, 'kin-calendar')[0].body, el, ctx);
		added[0].onload?.();
		await press(el, '.dynasty-cal-edit');
		expect(openModals).toHaveLength(1);
		const c = lastModal().contentEl;
		expect(firstCalendarName(c)).toBe('Beta Eras');
		expect(c.getText()).not.toContain(T.treeUsesNote('Beta'));
		const before = new Map(p.notes);
		await saveWindow(c);
		expect(p.notes).toEqual(before);
		expect(openModals).toHaveLength(0);
	});
});
