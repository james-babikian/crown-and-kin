import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseCalendarNote } from '../../src/obsidian/calendar-note-choice';
import { CALENDAR_UI } from '../../src/render/calendar-text';
import { calVault, calendarNotesOf, cycleNote, eraNote, fakeCalApp, lastModal, makeIndex, settleReal } from '../support/r04-calendar-fakes';
import { FEl, dispatch, resetDom } from './fake-dom';
import { notices, openModals, resetObsidian } from './fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-3a, step T0, package C: the More item "Calendar note" (the index contract 4.2, D289; test list 9; gate finding M4). The list is the notes of the fence index (plus the note
 * that the tree names, if it resolves and is not in the list). "No calendar" comes first; it is "In use" when the tree has no key, and choosing it removes the key (`set-option calendar null`).
 * A tree with a key and an empty list still opens the list, so that the key can be removed (M4). The empty-list Notice shows only when the tree has no key and the list is empty.
 * Written from the contract before the code existed; package C built the code and turned the tests on.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

/** The texts of the chooser after package C. The names are those of the index contract 4.2; the words are drafts, so the tests never copy them. */
interface ChooserUi {
	noCalendar: string;
	noCalendarDetail: string;
	noCalendarChosen: string;
	inUse: string;
	noNotes: string;
	noteText: string;
	noteChosen(name: string): string;
	noteFailed: string;
}
const UI = CALENDAR_UI as unknown as ChooserUi;

async function setup(files: Record<string, string>, links: Record<string, string> = {}, fenceNotes?: string[]) {
	const { app, notes } = fakeCalApp(files);
	const vault = calVault({}, links);
	// The index reads the same notes that the app has.
	vault.notes = notes;
	const index = await makeIndex(vault, { notes: () => fenceNotes ?? calendarNotesOf(notes) });
	await index.start();
	const writes: unknown[] = [];
	const handle = { write: vi.fn(async (op: unknown) => (writes.push(op), { ok: true })) };
	return { app, notes, index, handle, writes };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const run = (s: Setup, link: string | undefined) => chooseCalendarNote(s.app as never, s.index as never, s.handle as never, 'tree.md', link);

/** The options of the open dialog as { label, detail }. */
function options(): { label: string; detail: string }[] {
	const modal = lastModal() as unknown as { contentEl: FEl };
	return modal.contentEl.querySelectorAll('.dynasty-choice-option').map((b) => ({ label: b.querySelector('.dynasty-choice-label')?.getText() ?? '', detail: b.querySelector('.dynasty-choice-detail')?.getText() ?? '' }));
}

async function pick(label: string): Promise<void> {
	const modal = lastModal() as unknown as { contentEl: FEl };
	const at = modal.contentEl.querySelectorAll('.dynasty-choice-option').findIndex((b) => b.querySelector('.dynasty-choice-label')?.getText() === label);
	if (at < 0) throw new Error(`no option ${label}`);
	dispatch(modal.contentEl.querySelectorAll('.dynasty-choice-option')[at], 'click');
}

const FILES = { 'Worlds/Alpha.md': cycleNote('Alpha Count'), 'Beta.md': eraNote(), 'tree.md': 'plain' };

describe('the list (the index contract 4.2)', () => {
	it('"No calendar" is the first item, then the fence notes sorted by file name; with no key "No calendar" is in use and the others show their path', async () => {
		const s = await setup(FILES);
		const done = run(s, undefined);
		await settleReal();
		expect(options()).toEqual([
			{ label: 'No calendar', detail: UI.inUse },
			{ label: 'Alpha', detail: 'Worlds/Alpha.md' },
			{ label: 'Beta', detail: 'Beta.md' },
		]);
		await pick('Beta');
		await done;
	});

	it('the label of the first item is the word of D289: "No calendar"', () => {
		expect(UI.noCalendar).toBe('No calendar');
		expect(typeof UI.noCalendarDetail).toBe('string');
		expect(typeof UI.noCalendarChosen).toBe('string');
	});

	it('the old words are gone: no "every calendar note" item and no "If you select none" sentence', () => {
		const ui = CALENDAR_UI as unknown as Record<string, unknown>;
		expect('everyNote' in ui).toBe(false);
		expect('everyNoteDetail' in ui).toBe(false);
		expect('everyChosen' in ui).toBe(false);
		expect(UI.noteText).not.toMatch(/uses every calendar note/i);
	});

	it('choosing a note writes the option calendar as a link and tells the user', async () => {
		const s = await setup(FILES);
		const done = run(s, undefined);
		await settleReal();
		await pick('Beta');
		await done;
		expect(s.writes).toEqual([{ kind: 'set-option', key: 'calendar', value: '[[Beta]]' }]);
		expect(notices).toContain(UI.noteChosen('Beta'));
	});

	it('with a key, the named note is "In use" and "No calendar" shows its own detail; choosing "No calendar" removes the key', async () => {
		const s = await setup(FILES, { '[[Beta]]': 'Beta.md' });
		const done = run(s, '[[Beta]]');
		await settleReal();
		expect(options()).toEqual([
			{ label: 'No calendar', detail: UI.noCalendarDetail },
			{ label: 'Alpha', detail: 'Worlds/Alpha.md' },
			{ label: 'Beta', detail: UI.inUse },
		]);
		await pick('No calendar');
		await done;
		expect(s.writes).toEqual([{ kind: 'set-option', key: 'calendar', value: null }]);
		expect(notices).toContain(UI.noCalendarChosen);
	});

	it('a Cancel writes nothing', async () => {
		const s = await setup(FILES, { '[[Beta]]': 'Beta.md' });
		const done = run(s, '[[Beta]]');
		await settleReal();
		(lastModal() as unknown as { close(): void }).close();
		await done;
		expect(s.writes).toEqual([]);
		expect(notices).toEqual([]);
	});

	it('a failed write gives the Notice of failure', async () => {
		const s = await setup(FILES);
		s.handle.write.mockImplementation(async () => ({ ok: false, code: 'stale' }) as never);
		const done = run(s, undefined);
		await settleReal();
		await pick('Alpha');
		await done;
		expect(notices).toContain(UI.noteFailed);
	});

	it('the list does not depend on a scan: five calendar notes in the fence list, none read by the chooser', async () => {
		const files: Record<string, string> = {};
		for (let i = 1; i <= 5; i++) files[`Cal${i}.md`] = cycleNote(`Count ${i}`);
		const s = await setup(files);
		const done = run(s, undefined);
		await settleReal();
		expect(options().map((o) => o.label)).toEqual(['No calendar', 'Cal1', 'Cal2', 'Cal3', 'Cal4', 'Cal5']);
		await pick('No calendar');
		await done;
	});
});

describe('the empty list and the key (the index contract 4.2, gate finding M4)', () => {
	it('a tree with a key and an empty list still opens the list, with "No calendar" first, so that the key can be removed', async () => {
		const s = await setup({ 'tree.md': 'plain' }, {}, []);
		const done = run(s, '[[Gone]]');
		await settleReal();
		expect(openModals).toHaveLength(1);
		expect(notices).not.toContain(UI.noNotes);
		// The key names a note that does not resolve: nothing is "In use".
		expect(options()).toEqual([{ label: 'No calendar', detail: UI.noCalendarDetail }]);
		await pick('No calendar');
		await done;
		expect(s.writes).toEqual([{ kind: 'set-option', key: 'calendar', value: null }]);
	});

	it('a tree with a key that resolves to a note which is not in the list: that note is listed too, and in use', async () => {
		const s = await setup({ 'Lore.md': '# Lore\nNo calendar block here.\n', 'tree.md': 'plain' }, { '[[Lore]]': 'Lore.md' }, []);
		const done = run(s, '[[Lore]]');
		await settleReal();
		expect(options()).toEqual([
			{ label: 'No calendar', detail: UI.noCalendarDetail },
			{ label: 'Lore', detail: UI.inUse },
		]);
		await pick('No calendar');
		await done;
	});

	it('a tree with no key and an empty list gets the Notice and no dialog', async () => {
		const s = await setup({ 'tree.md': 'plain' }, {}, []);
		await run(s, undefined);
		await settleReal();
		expect(openModals).toHaveLength(0);
		expect(notices).toEqual([UI.noNotes]);
		expect(s.writes).toEqual([]);
	});

	it('a tree with a key that names a missing note and a list of notes: nothing is marked "In use"', async () => {
		const s = await setup(FILES);
		const done = run(s, '[[Nowhere]]');
		await settleReal();
		const shown = options();
		expect(shown.map((o) => o.label)).toEqual(['No calendar', 'Alpha', 'Beta']);
		expect(shown.filter((o) => o.detail === UI.inUse)).toEqual([]);
		await pick('Alpha');
		await done;
	});

	it('a link of white space is no key', async () => {
		const s = await setup(FILES);
		const done = run(s, '   ');
		await settleReal();
		expect(options()[0]).toEqual({ label: 'No calendar', detail: UI.inUse });
		await pick('Beta');
		await done;
	});
});
