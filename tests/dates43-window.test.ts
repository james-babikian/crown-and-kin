import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { openCalendars } from '../src/obsidian/calendar-window';
import { chooseCalendarNote } from '../src/obsidian/calendar-note-choice';
import { calendarBlockProcessor } from '../src/obsidian/calendar-block-view';
import { CALENDAR_UI, CALENDAR_WINDOW_UI as T } from '../src/render/calendar-text';
import { createCalendarIndex } from '../src/view/calendar-index';
import { FEl, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { cycleNote, eraNote, fakeVault as indexVault } from './support/calendar-vault';

/*
 * Step 4.3 of WP-4: the real Calendars window on a fake vault: Add, Change and Remove, the refusals that stop a save, the warning that does not, the first save that makes
 * `Calendars.md`, the stale note, the test line, the More choice of a calendar note and the `kin-calendar` block in a note.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) await tick();
}

/** An app with notes in a map: `read`, `process`, `create`, the root folder and the link resolver. */
function fakeApp(files: Record<string, string>) {
	const notes = new Map(Object.entries(files));
	const created: string[] = [];
	const file = (path: string): VaultFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		return Object.assign(new File(path, 'md'), { name, basename: name.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
	};
	const root = () => ({ path: '/', name: '', isRoot: () => true, children: [...notes.keys()].filter((p) => !p.includes('/')).map((p) => ({ name: p, path: p })) });
	const folders = new Set<string>();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => (notes.has(p) ? file(p) : folders.has(p) ? { path: p, children: [], isRoot: () => false } : null),
			read: async (f: { path: string }) => notes.get(f.path) ?? '',
			cachedRead: async (f: { path: string }) => notes.get(f.path) ?? '',
			process: async (f: { path: string }, fn: (t: string) => string) => {
				const next = fn(notes.get(f.path) ?? '');
				notes.set(f.path, next);
				return next;
			},
			create: vi.fn(async (path: string, data: string) => {
				notes.set(path, data);
				created.push(path);
				return file(path);
			}),
			createFolder: vi.fn(async (p: string) => void folders.add(p)),
			getRoot: root,
			getFiles: () => [...notes.keys()].map(file),
		},
		metadataCache: { fileToLinktext: (f: { path: string }) => f.path.replace(/\.md$/, ''), getFirstLinkpathDest: () => null },
		workspace: { getActiveFile: () => null },
	};
	return { app, notes, created };
}

async function indexOf(notes: Map<string, string>, links: Record<string, string> = {}) {
	const vault = indexVault({});
	// The index reads the same notes that the window writes.
	vault.notes = notes;
	for (const [k, v] of Object.entries(links)) vault.links.set(k, v);
	const index = createCalendarIndex(vault, { pause: async () => undefined });
	await index.start();
	return index;
}

interface Opened {
	win: { contentEl: FEl; modalEl: FEl };
	notes: Map<string, string>;
	created: string[];
	index: Awaited<ReturnType<typeof indexOf>>;
}

async function open(files: Record<string, string>, o: { link?: string; links?: Record<string, string> } = {}): Promise<Opened> {
	const { app, notes, created } = fakeApp(files);
	const index = await indexOf(notes, o.links);
	await openCalendars(app as never, index, { treePath: 'tree.md', link: o.link });
	await settle();
	const win = openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, notes, created, index };
}

const field = (c: FEl, name: string): FEl => {
	const el = c.querySelector(`[data-focus="cal:${name}"]`);
	if (!el) throw new Error(`no field ${name}`);
	return el;
};
const type = (c: FEl, name: string, value: string): void => {
	const el = field(c, name);
	el.value = value;
	dispatch(el, 'input');
};
const press = async (c: FEl, selector: string): Promise<void> => {
	const el = c.querySelector(selector);
	if (!el) throw new Error(`no ${selector}`);
	dispatch(el, 'click');
	await settle();
};
const save = (c: FEl) => press(c, '.dynasty-sheet-save');
const errorText = (c: FEl) => c.querySelector('.dynasty-sheet-error')?.getText() ?? '';

describe('the Calendars window', () => {
	it('shows the calendars of the note, and Save with no change writes nothing', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		expect(field(c, '0-name').value).toBe('The Long Count');
		expect(field(c, '0-formats').value).toBe('{year} Year of the {cycle} Cycle');
		expect(field(c, '0-length').value).toBe('60');
		const before = o.notes.get('Calendars.md');
		await save(c);
		expect(o.notes.get('Calendars.md')).toBe(before);
	});

	it('changes a length and a name; the rest of the note stays as written', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		type(c, '0-length', '70');
		type(c, '0-name', 'The Count');
		await save(c);
		const text = o.notes.get('Calendars.md')!;
		expect(text).toContain('length: 70');
		expect(text).toContain('name: The Count');
		expect(text.startsWith('# Calendars\n\n```kin-calendar')).toBe(true);
		expect(notices).toContain(T.saved);
		expect(openModals).toHaveLength(0);
		// The index has the new calendar at once.
		expect(o.index.calendarsOf('Calendars.md')[0].name).toBe('The Count');
	});

	it('adds an era calendar with an era; the start comes from the Same year as form', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-add-eras');
		type(c, '1-name', 'Houses');
		type(c, '1-formats', '{era} {year}');
		type(c, 'era-2-name', 'Aldric');
		type(c, 'era-2-same', '1500');
		type(c, 'era-2-year', '4');
		expect(c.querySelector('[data-readback="era-2"]')?.getText()).toContain('Start: year 1497');
		await save(c);
		const added = o.index.calendarsOf('Calendars.md').find((k) => k.name === 'Houses');
		expect(added?.kind).toMatchObject({ type: 'eras', eras: [{ name: 'Aldric', start: 1497 }] });
	});

	it('removes a calendar', async () => {
		const o = await open({ 'Calendars.md': `${cycleNote()}\n${cycleNote('Second', '{year} of {cycle}')}` });
		const c = o.win.contentEl;
		await press(c, '[data-focus="cal:remove:0"]');
		await save(c);
		expect(o.index.calendarsOf('Calendars.md').map((k) => k.name)).toEqual(['Second']);
	});

	it('refuses a format that two calendars share, names the other calendar and writes nothing', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-add-cycles');
		type(c, '1-name', 'Copy');
		type(c, '1-formats', '{year} year of the {cycle} cycle');
		type(c, '1-length', '10');
		const before = o.notes.get('Calendars.md');
		await save(c);
		expect(o.notes.get('Calendars.md')).toBe(before);
		expect(errorText(c)).toContain('The plugin cannot save yet.');
		expect(errorText(c)).toContain('“The Long Count”');
		expect(openModals).toHaveLength(1);
		// The refusal also stands under the calendar.
		expect(c.querySelector('[data-calendar="1"] [data-refusal]')).not.toBeNull();
	});

	it('refuses a bad format with the sentence of the rule, and a length below 1', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		type(c, '0-formats', '{year} only');
		type(c, '0-length', '0');
		await save(c);
		expect(errorText(c)).toContain('A cycle format needs {year} and {cycle}');
		expect(errorText(c)).toContain('The length of a cycle or an era is a number of years.');
	});

	it('warns about the same format in another calendar note and saves anyway', async () => {
		const o = await open({ 'Calendars.md': cycleNote(), 'Copy of Calendars.md': cycleNote('Copy') });
		const c = o.win.contentEl;
		expect(c.querySelector('[data-calendar="0"] [data-warning]')?.getText()).toContain('both have the calendar');
		type(c, '0-length', '61');
		await save(c);
		expect(o.notes.get('Calendars.md')).toContain('length: 61');
	});

	it('does not write over a note that changed while the window was open', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		type(c, '0-length', '70');
		o.notes.set('Calendars.md', cycleNote('Changed elsewhere'));
		await save(c);
		expect(o.notes.get('Calendars.md')).toContain('Changed elsewhere');
		expect(errorText(c)).toBe(T.stale);
		expect(openModals).toHaveLength(1);
	});

	it('shows the test line for a date and updates it as the draft changes', async () => {
		const o = await open({ 'Calendars.md': cycleNote('The Long Count', '{year} Year of the {cycle} Cycle', 100) });
		const c = o.win.contentEl;
		const line = () => c.querySelector('[data-calendar="0"] .dynasty-cal-test [data-readout]')?.getText();
		expect(line()).toBe('');
		const input = c.querySelector('[data-focus="test:0"]')!;
		input.value = '10 Year of the 3 Cycle';
		dispatch(input, 'input');
		expect(line()).toBe('The Long Count: Cycle 3, Year 10 = year 229');
		type(c, '0-length', '10');
		expect(line()).toBe('The Long Count: Cycle 3, Year 10 = year 129');
	});

	it('makes the note Calendars.md at the root of the vault at the first save', async () => {
		const o = await open({ 'other.md': 'text' });
		const c = o.win.contentEl;
		expect(c.getText()).toContain(T.noNoteMeta);
		expect(c.getText()).toContain(T.noNoteHint);
		await press(c, '.dynasty-cal-add-cycles');
		type(c, '0-name', 'Count');
		type(c, '0-formats', '{year} of {cycle}');
		type(c, '0-length', '12');
		await save(c);
		expect(o.created).toEqual(['Calendars.md']);
		expect(o.notes.get('Calendars.md')).toContain('name: Count');
		expect(o.notes.get('Calendars.md')).toContain('```kin-calendar');
		expect(notices).toContain(T.madeNote('Calendars'));
	});

	it('makes "Calendars 1" when Calendars is taken by a note that is not a calendar note', async () => {
		const o = await open({ 'Calendars.md': 'plain note' });
		const c = o.win.contentEl;
		expect(field(c, 'new-name').value).toBe('Calendars 1');
	});

	it('"New calendar note" starts an empty draft with a name and a folder to type', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-new-note');
		expect(field(c, 'new-name').value).toBe('Calendars 1');
		type(c, 'new-name', 'Far Land');
		type(c, 'new-folder', 'Worlds');
		await press(c, '.dynasty-cal-add-eras');
		// The draft items are numbered on: the new note starts empty, so its first calendar is not number 0.
		const k = Number(c.querySelector('.dynasty-cal-card')!.getAttribute('data-calendar'));
		type(c, `${k}-name`, 'Houses');
		type(c, `${k}-formats`, '{era} {year}');
		type(c, `era-${k + 1}-name`, 'Aldric');
		await save(c);
		expect(o.created).toEqual(['Worlds/Far Land.md']);
	});

	it('a tree that names a missing note makes that note at its first save', async () => {
		const o = await open({ 'Calendars.md': cycleNote() }, { link: '[[Worlds/Far Land]]' });
		const c = o.win.contentEl;
		expect(field(c, 'new-name').value).toBe('Far Land');
		expect(field(c, 'new-folder').value).toBe('Worlds');
	});

	it('asks before it closes with a change', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		type(c, '0-length', '70');
		(o.win as unknown as { close(): void }).close();
		expect(o.win.modalEl.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
		expect(o.win.modalEl.querySelector('.dynasty-sheet-confirm-text')?.getText()).toBe(T.discardText);
	});

	it('a block that cannot be read gives its message and no window', async () => {
		const bad = '```kin-calendar\ncalendars: not a list\n```\n';
		const { app } = fakeApp({ 'Calendars.md': bad });
		const vault = indexVault({ 'Calendars.md': bad });
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		await index.start();
		await openCalendars(app as never, index, { treePath: 'tree.md', link: undefined });
		expect(openModals).toHaveLength(0);
		expect(notices.join(' ')).toContain('has an error');
	});
});

describe('the choice of a calendar note (More)', () => {
	it('writes the option calendar as a link, and removes it for every calendar note', async () => {
		const { app, notes } = fakeApp({ 'Calendars.md': cycleNote(), 'Far Land.md': eraNote() });
		const index = await indexOf(notes);
		const writes: unknown[] = [];
		const handle = { write: vi.fn(async (op: unknown) => (writes.push(op), { ok: true })) };
		const done = chooseCalendarNote(app as never, index, handle as never, 'tree.md', undefined);
		await settle();
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		const options = modal.contentEl.querySelectorAll('.dynasty-choice-option');
		expect(options.map((b) => b.querySelector('.dynasty-choice-label')?.getText())).toEqual([CALENDAR_UI.everyNote, 'Calendars', 'Far Land']);
		dispatch(options[2], 'click');
		await done;
		expect(writes).toEqual([{ kind: 'set-option', key: 'calendar', value: '[[Far Land]]' }]);
		expect(notices).toContain(CALENDAR_UI.noteChosen('Far Land'));
	});

	it('removes the key with "Every calendar note"', async () => {
		const { app, notes } = fakeApp({ 'Calendars.md': cycleNote() });
		const index = await indexOf(notes, { '[[Calendars]]': 'Calendars.md' });
		const handle = { write: vi.fn(async () => ({ ok: true })) };
		const done = chooseCalendarNote(app as never, index, handle as never, 'tree.md', '[[Calendars]]');
		await settle();
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		const options = modal.contentEl.querySelectorAll('.dynasty-choice-option');
		expect(options[1].querySelector('.dynasty-choice-detail')?.getText()).toBe(CALENDAR_UI.inUse);
		dispatch(options[0], 'click');
		await done;
		expect(handle.write).toHaveBeenCalledWith({ kind: 'set-option', key: 'calendar', value: null });
	});

	it('says so when no calendar note exists', async () => {
		const { app, notes } = fakeApp({});
		const index = await indexOf(notes);
		await chooseCalendarNote(app as never, index, { write: vi.fn() } as never, 'tree.md', undefined);
		expect(notices).toContain(CALENDAR_UI.noNotes);
	});

	it('a failed write gives a Notice', async () => {
		const { app, notes } = fakeApp({ 'Calendars.md': cycleNote() });
		const index = await indexOf(notes);
		const handle = { write: vi.fn(async () => ({ ok: false, code: 'stale' })) };
		const done = chooseCalendarNote(app as never, index, handle as never, 'tree.md', undefined);
		await settle();
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		dispatch(modal.contentEl.querySelectorAll('.dynasty-choice-option')[1], 'click');
		await done;
		expect(notices).toContain(CALENDAR_UI.noteFailed);
	});
});

describe('the kin-calendar block in a note', () => {
	const render = (source: string) => {
		const { app, notes } = fakeApp({ 'Calendars.md': source });
		const el = new FEl('div');
		const added: { onload?: () => void }[] = [];
		const ctx = { sourcePath: 'Calendars.md', addChild: (child: { onload?: () => void }) => added.push(child) };
		const index = createCalendarIndex(indexVault(Object.fromEntries(notes)), { pause: async () => undefined });
		calendarBlockProcessor(app as never, index)(findBlocks(source, 'kin-calendar')[0].body, el as never, ctx as never);
		added[0].onload?.();
		return { el, index };
	};

	it('shows each calendar as a table with its test line and an Edit button', () => {
		const { el } = render(cycleNote());
		expect(el.querySelector('.dynasty-cal-block b')?.getText()).toBe('The Long Count');
		const cells = el.querySelectorAll('.dynasty-cal-table td').map((td) => td.getText());
		// The kind stands after the name (look round 0.3.2), so the table has no row for it.
		expect(cells).toEqual(['{year} Year of the {cycle} Cycle', '60', 'year 1']);
		expect(el.querySelector('.dynasty-cal-edit')?.getText()).toBe('Edit');
		const input = el.querySelector('.dynasty-cal-test input')!;
		input.value = '3 Year of the 2 Cycle';
		dispatch(input, 'input');
		expect(el.querySelector('[data-readout]')?.getText()).toBe('The Long Count: Cycle 2, Year 3 = year 63');
	});

	it('shows the eras of an era calendar', () => {
		const { el } = render(eraNote());
		const rows = el.querySelectorAll('.dynasty-cal-eras tr').map((tr) => tr.querySelectorAll('td').map((td) => td.getText()));
		expect(rows[1]).toEqual(['Qinglong Emperor', 'year 130', '11']);
	});

	it('shows the message of a block that cannot be read, and nothing throws', () => {
		const { el } = render('```kin-calendar\ncalendars: not a list\n```\n');
		expect(el.querySelector('.dynasty-cal-block-error')?.getText()).toContain('has an error');
	});

	it('an empty block says so and has the Edit button', () => {
		const { el } = render('```kin-calendar\ncalendars: []\n```\n');
		expect(el.getText()).toContain('This calendar note has no calendar yet.');
		expect(el.querySelector('.dynasty-cal-edit')).not.toBeNull();
	});
});

describe('the look round of 0.3.2: the Calendars window and the block', () => {
	const kids = (el: FEl) => el.children.map((c) => c.classes);

	it('starts with a head: the title, a text line with the note and its folder, and "New calendar note" as a link', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const c = o.win.contentEl;
		const head = c.querySelector('.dynasty-head')!;
		expect(head.querySelector('.dynasty-head-name')!.getText()).toBe(T.title);
		expect(head.querySelector('.dynasty-head-meta')!.getText()).toBe(`Calendars · ${T.folder('')}`);
		const link = head.querySelector('.dynasty-cal-new-note')!;
		expect(link.hasClass('dynasty-link')).toBe(true);
		expect(link.hasClass('dynasty-btn')).toBe(false);
		expect(link.getText()).toBe(T.newNote);
		const intro = c.querySelector('.dynasty-cal-intro')!;
		expect(intro.getText()).toBe(T.intro);
		expect(intro.hasClass('dynasty-sheet-hint')).toBe(true);
		expect(c.querySelector('.dynasty-choice-text')).toBeNull();
	});

	it('with no note, the text line says so and the hint names the note that the save makes', async () => {
		const o = await open({ 'other.md': 'text' });
		const c = o.win.contentEl;
		expect(c.querySelector('.dynasty-head-meta')!.getText()).toBe('No calendar note exists.');
		expect(c.querySelector('.dynasty-cal-note .dynasty-sheet-hint')!.getText()).toBe('The plugin makes the note “Calendars” when you save.');
		expect(c.querySelector('.dynasty-cal-new-note')).toBeNull();
	});

	it('a phone shows the title in its bar only: the head has the text line and the link, and no second title', async () => {
		device.coarse = true;
		device.width = 390;
		try {
			const o = await open({ 'Calendars.md': cycleNote() });
			const c = o.win.contentEl;
			expect(o.win.modalEl.hasClass('is-phone')).toBe(true);
			expect(c.querySelector('.dynasty-head-name')).toBeNull();
			expect(c.querySelector('.dynasty-head-meta')!.getText()).toContain('Calendars');
			expect(c.querySelector('.dynasty-cal-new-note')).not.toBeNull();
		} finally {
			device.coarse = false;
			device.width = 1280;
		}
	});

	it('an era calendar has one "Eras" heading, and each era has Remove on the line of its name', async () => {
		const o = await open({ 'Calendars.md': eraNote() });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-add-era');
		const card = c.querySelector('.dynasty-cal-card')!;
		const heads = card.querySelectorAll('.dynasty-cal-subhead').filter((e) => e.getText() === T.erasLabel);
		expect(heads).toHaveLength(1);
		expect(card.querySelectorAll('.dynasty-cal-era')).toHaveLength(2);
		for (const era of card.querySelectorAll('.dynasty-cal-era')) {
			expect(era.querySelector('.dynasty-cal-head')).toBeNull();
			const line = era.querySelector('.dynasty-cal-labelrow')!;
			expect(line.querySelector('label')!.getText()).toBe(T.eraName);
			expect(line.querySelector('.dynasty-cal-remove')!.getText()).toBe(T.remove);
		}
		// The "Eras" heading stands before the first era.
		const order = card.children.map((e) => (e.hasClass('dynasty-cal-subhead') ? e.getText() : e.hasClass('dynasty-cal-era') ? 'era' : ''));
		expect(order.indexOf(T.erasLabel)).toBeLessThan(order.indexOf('era'));
	});

	it('removes one era with the Remove of its name line', async () => {
		const o = await open({ 'Calendars.md': eraNote() });
		const c = o.win.contentEl;
		await press(c, '.dynasty-cal-add-era');
		await press(c, '.dynasty-cal-era .dynasty-cal-labelrow .dynasty-cal-remove');
		expect(c.querySelectorAll('.dynasty-cal-era')).toHaveLength(1);
	});

	it('the start has a sub-heading, the readback, one row of Cycle, Year, "=" and Same year as, then the hint', async () => {
		const o = await open({ 'Calendars.md': cycleNote() });
		const start = o.win.contentEl.querySelector('.dynasty-cal-start')!;
		expect(kids(start).map((k) => [...k][0])).toEqual(['dynasty-cal-subhead', 'dynasty-sheet-hint', 'dynasty-cal-start-row', 'dynasty-sheet-hint', 'dynasty-sheet-error']);
		expect(start.children[0].getText()).toBe(T.startLabel);
		const row = start.querySelector('.dynasty-cal-start-row')!;
		expect(row.children.map((e) => e.getAttribute('data-field') ?? e.getText())).toEqual(['0-cycle', '0-year', '=', '0-same']);
		const hint = start.children[3];
		expect(hint.getText()).toBe(T.exampleHintCycles);
		// Every field of the row is described by the hint under the row.
		for (const input of row.querySelectorAll('input')) expect(input.getAttribute('aria-describedby')).toBe(hint.getAttribute('id'));
	});

	it('an era start has Year, "=" and Same year as; a refusal of the row stands under the hint, not in the row', async () => {
		const o = await open({ 'Calendars.md': eraNote() });
		const c = o.win.contentEl;
		const start = c.querySelector('.dynasty-cal-era .dynasty-cal-start')!;
		const row = start.querySelector('.dynasty-cal-start-row')!;
		expect(row.children.map((e) => e.getAttribute('data-field') ?? e.getText())).toEqual(['era-1-year', '=', 'era-1-same']);
		type(c, 'era-1-same', 'no year in these words');
		await save(c);
		expect(row.querySelector('[data-refusal]')).toBeNull();
		expect(start.querySelector('.dynasty-cal-field-error [data-refusal]')).not.toBeNull();
	});

	it('the block shows the kind after the name and has no row "Kind"', () => {
		const { app, notes } = fakeApp({ 'Calendars.md': eraNote() });
		const el = new FEl('div');
		const added: { onload?: () => void }[] = [];
		const index = createCalendarIndex(indexVault(Object.fromEntries(notes)), { pause: async () => undefined });
		const source = eraNote();
		calendarBlockProcessor(app as never, index)(findBlocks(source, 'kin-calendar')[0].body, el as never, { sourcePath: 'Calendars.md', addChild: (ch: { onload?: () => void }) => added.push(ch) } as never);
		added[0].onload?.();
		const title = el.querySelector('.dynasty-cal-block-title')!;
		expect(title.querySelector('b')!.getText()).toBe('Reign names');
		expect(title.getText()).toBe(`Reign names · ${T.kindEras}`);
		expect(el.querySelectorAll('th').map((th) => th.getText())).not.toContain('Kind');
	});
});
