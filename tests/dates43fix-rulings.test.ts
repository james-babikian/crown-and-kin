import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { parseCalendarBlock } from '../src/core/calendar-block';
import { compileCalendars } from '../src/core/dates';
import { calendarBlockProcessor } from '../src/obsidian/calendar-block-view';
import { openCalendars } from '../src/obsidian/calendar-window';
import { CALENDAR_WINDOW_UI as T } from '../src/render/calendar-text';
import { attachDateLine } from '../src/render/dom/date-line';
import { checkDraft, draftChanged, draftOf, newCalendar, opsOf } from '../src/view/calendar-draft';
import { createCalendarIndex, datesForTree } from '../src/view/calendar-index';
import { MAX_DATE_TEXT, capReader } from '../src/view/calendar-reader';
import { writeCalendars } from '../src/view/calendar-write';
import { FEl, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { cycleNote, eraNote, fakeVault as indexVault } from './support/calendar-vault';

/*
 * The fix round of step 4.3: the rulings that the reviewer's twelve tests do not pin. Each test names its ruling.
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

const NOTE = 'Calendars.md';
let n = 0;
const key = () => n++;
const readNote = (text: string) => findBlocks(text, 'kin-calendar').flatMap((b, i) => parseCalendarBlock(b.body, NOTE, i).calendars);
const bodies = (text: string) => findBlocks(text, 'kin-calendar').map((b) => b.body);

describe('ruling 1: a length that the note holds as text', () => {
	const LONG = ['```kin-calendar', 'calendars:', '  - name: Count', '    kind: cycles', '    length: long', '    start: 1', '    formats: ["{year} of {cycle}"]', '  - name: Two', '    kind: cycles', '    length: 10', '    start: 5', '    formats: ["{year} in {cycle}"]', '```', ''].join('\n');

	it('opens clean, is not refused and is not rewritten when another calendar changes', () => {
		const saved = readNote(LONG);
		const drafts = draftOf(saved, key);
		let checked = checkDraft(drafts, NOTE, []);
		expect(checked.refusals).toEqual([]);
		expect(draftChanged(saved, drafts, checked)).toBe(false);
		drafts[1].name = 'Two renamed';
		checked = checkDraft(drafts, NOTE, []);
		expect(checked.refusals).toEqual([]);
		const out = writeCalendars(LONG, bodies(LONG), opsOf(saved, drafts, checked));
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.text).toBe(LONG.replace('name: Two', 'name: Two renamed'));
	});

	it('is refused, next to the length field, as soon as the user edits that calendar', () => {
		const drafts = draftOf(readNote(LONG), key);
		drafts[0].name = 'Count renamed';
		const checked = checkDraft(drafts, NOTE, []);
		expect(checked.refusals.map((r) => r.field)).toContain('length');
	});
});

describe('ruling 2: a cycle of "Same year as" references', () => {
	it('refuses two new calendars that start from each other, and says so', () => {
		const a = Object.assign(newCalendar('cycles', key), { name: 'Alpha', formats: '{year} of the {cycle} A', length: '10' });
		const b = Object.assign(newCalendar('cycles', key), { name: 'Beta', formats: '{year} of the {cycle} B', length: '10' });
		Object.assign(a.start, { same: '1 of the 1 B', cycle: '1', year: '1' });
		Object.assign(b.start, { same: '1 of the 1 A', cycle: '1', year: '1' });
		const checked = checkDraft([a, b], NOTE, []);
		expect(checked.refusals.map((r) => r.text)).toContain(T.sameAsCycle);
		expect(checked.refusals.filter((r) => r.text === T.sameAsCycle).map((r) => r.key).sort()).toEqual([a.key, b.key].sort());
	});

	it('works a chain out in order, whatever the order of the cards', () => {
		const a = Object.assign(newCalendar('cycles', key), { name: 'Alpha', formats: '{year} of the {cycle} A', length: '10' });
		const b = Object.assign(newCalendar('cycles', key), { name: 'Beta', formats: '{year} of the {cycle} B', length: '10' });
		Object.assign(a.start, { same: '1 of the 1 B', cycle: '1', year: '1' });
		Object.assign(b.start, { same: '2000', cycle: '1', year: '1' });
		// Alpha is first in the window but reads Beta.
		const checked = checkDraft([a, b], NOTE, []);
		expect(checked.refusals).toEqual([]);
		expect(checked.calendars.map((c) => (c.kind as { start: number }).start)).toEqual([2000, 2000]);
	});
});

describe('ruling 3: the kin-calendar block keeps its events from the editor', () => {
	it('stops a click so that Live Preview does not open the source', () => {
		const el = new FEl('div');
		const outer = new FEl('div');
		outer.children.push(el);
		el.parentElement = outer;
		const reached = vi.fn();
		outer.addEventListener('click', reached);
		const added: { onload?: () => void }[] = [];
		const ctx = { sourcePath: NOTE, addChild: (child: { onload?: () => void }) => added.push(child) };
		const index = createCalendarIndex(indexVault({ [NOTE]: cycleNote() }), { pause: async () => undefined });
		calendarBlockProcessor({} as never, index)(findBlocks(cycleNote(), 'kin-calendar')[0].body, el as never, ctx as never);
		added[0].onload?.();
		const table = el.querySelector('.dynasty-cal-table')!;
		dispatch(table, 'click');
		dispatch(table, 'pointerdown');
		expect(reached).not.toHaveBeenCalled();
	});
});

describe('ruling 5: the grey line while the reader is not ready', () => {
	it('stays empty, and is painted again when the reader changes', () => {
		const row = new FEl('div');
		const input = row.createEl('input');
		input.value = 'Qinglong Emperor 3';
		let reader = compileCalendars([], false);
		let repaint: () => void = () => undefined;
		let stopped = 0;
		attachDateLine(
			row as unknown as HTMLElement,
			input as unknown as HTMLInputElement,
			() => reader,
			(cb) => {
				repaint = cb;
				return () => stopped++;
			},
			() => undefined,
		);
		const line = () => row.querySelector('[data-readout]')?.getText();
		expect(line()).toBe('');
		reader = compileCalendars(readNote(eraNote()), true);
		repaint();
		expect(line()).toBe('Reign names: Qinglong Emperor, Year 3 = year 132');
		// A line that left the page stops its own watch.
		input.isConnected = false;
		repaint();
		expect(stopped).toBe(1);
	});

	it('is told of a change by the index through `datesForTree`', async () => {
		const vault = indexVault({ [NOTE]: eraNote() });
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		const cb = vi.fn();
		const off = datesForTree(index, 'tree.md').onChange!(cb);
		await index.start();
		expect(cb).toHaveBeenCalled();
		off();
		index.dispose();
	});
});

describe('ruling 11: a calendar note that moved while the window was open', () => {
	const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
	const tick = () => new Promise<void>((r) => setTimeout(r, 0));
	const settle = async () => {
		for (let i = 0; i < 12; i++) await tick();
	};

	it('keeps the draft and says that the changes stay in the window', async () => {
		const notes = new Map([[NOTE, cycleNote()]]);
		const file = (path: string) => Object.assign(new File(path, 'md'), { name: path, basename: path.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (notes.has(p) ? file(p) : null),
				read: async (f: { path: string }) => notes.get(f.path) ?? '',
				process: async (f: { path: string }, fn: (t: string) => string) => fn(notes.get(f.path) ?? ''),
				getRoot: () => ({ path: '/', name: '', isRoot: () => true, children: [] }),
				getFiles: () => [],
			},
			metadataCache: { fileToLinktext: (f: { path: string }) => f.path, getFirstLinkpathDest: () => null },
			workspace: { getActiveFile: () => null },
		};
		const vault = indexVault({});
		vault.notes = notes;
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		await index.start();
		await openCalendars(app as never, index, { treePath: 'tree.md', link: undefined });
		await settle();
		const c = (openModals[openModals.length - 1] as unknown as { contentEl: FEl }).contentEl;
		const name = c.querySelector('[data-focus="cal:0-name"]')!;
		name.value = 'The Count';
		dispatch(name, 'input');
		notes.delete(NOTE);
		dispatch(c.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		expect(c.querySelector('.dynasty-sheet-error')?.getText()).toBe(T.stale);
		expect(T.stale).toContain('Your changes stay in this window until you close it.');
		expect(c.querySelector('[data-focus="cal:0-name"]')?.value).toBe('The Count');
	});
});

describe('ruling 12: the limit on the length of a date text', () => {
	const reader = capReader(compileCalendars(readNote(eraNote()), true));

	it('reads a date of 500 characters or fewer through the calendars', () => {
		expect(reader.read('Qinglong Emperor 3')?.calendar).toBe('Reign names');
		const padded = `Qinglong Emperor 3 ${'x'.repeat(MAX_DATE_TEXT - 19)}`;
		expect(padded.length).toBe(MAX_DATE_TEXT);
		expect(reader.read(padded)?.source).toBe('calendar');
	});

	it('gives a longer text to the plain reader', () => {
		const long = `Qinglong Emperor 3 ${'x'.repeat(MAX_DATE_TEXT)}`;
		expect(reader.read(long)?.source).not.toBe('calendar');
		expect(reader.ready).toBe(true);
	});
});

describe('polish: a refusal names its calendar and stands next to its field', () => {
	const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
	const tick = () => new Promise<void>((r) => setTimeout(r, 0));
	const settle = async () => {
		for (let i = 0; i < 12; i++) await tick();
	};

	it('shows the refusal under the field in error and names the calendar in the line at the top', async () => {
		const notes = new Map([[NOTE, cycleNote()]]);
		const file = (path: string) => Object.assign(new File(path, 'md'), { name: path, basename: path.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (notes.has(p) ? file(p) : null),
				read: async (f: { path: string }) => notes.get(f.path) ?? '',
				process: async (f: { path: string }, fn: (t: string) => string) => fn(notes.get(f.path) ?? ''),
				getRoot: () => ({ path: '/', name: '', isRoot: () => true, children: [] }),
				getFiles: () => [],
			},
			metadataCache: { fileToLinktext: (f: { path: string }) => f.path, getFirstLinkpathDest: () => null },
			workspace: { getActiveFile: () => null },
		};
		const vault = indexVault({});
		vault.notes = notes;
		const index = createCalendarIndex(vault, { pause: async () => undefined });
		await index.start();
		await openCalendars(app as never, index, { treePath: 'tree.md', link: undefined });
		await settle();
		const c = (openModals[openModals.length - 1] as unknown as { contentEl: FEl }).contentEl;
		const length = c.querySelector('[data-focus="cal:0-length"]')!;
		length.value = '0';
		dispatch(length, 'input');
		const scrolled = vi.spyOn(FEl.prototype, 'scrollIntoView');
		dispatch(c.querySelector('.dynasty-sheet-save')!, 'click');
		await settle();
		const top = c.querySelector('.dynasty-sheet-error')?.getText() ?? '';
		expect(top).toContain(T.refusalHead);
		expect(top).toContain('“The Long Count”');
		const row = c.querySelector('[data-field="0-length"]')!;
		expect(row.querySelector('.dynasty-cal-field-error [data-refusal]')?.getText()).toContain('The length of a cycle');
		expect(length.getAttribute('aria-invalid')).toBe('true');
		// The first refusal of a card is scrolled into view.
		expect(scrolled).toHaveBeenCalled();
	});
});
