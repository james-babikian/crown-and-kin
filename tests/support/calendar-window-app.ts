// A fake app for the Calendars window tests (WP-6 step 3): notes in a map, `read`, `process`, `create`, the root folder, and an index that reads the same notes that the window writes.
// The test file must mock the module `obsidian` with the fake of the acceptance folder before it imports this file.
import { vi } from 'vitest';
import { TFile as VaultFile } from 'obsidian';
import { openCalendars } from '../../src/obsidian/calendar-window';
import { createCalendarIndex } from '../../src/view/calendar-index';
import { FEl, dispatch } from '../acceptance/fake-dom';
import { lastMenu, openModals } from '../acceptance/fake-obsidian';
import { fakeVault as indexVault } from './calendar-vault';

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Lets pending promises and timers run. */
export async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) await tick();
}

/** An app with notes in a map. */
export function fakeApp(files: Record<string, string>) {
	const notes = new Map(Object.entries(files));
	const created: string[] = [];
	const file = (path: string): VaultFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		return Object.assign(new File(path, 'md'), { name, basename: name.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
	};
	const folders = new Set<string>();
	const root = () => ({ path: '/', name: '', isRoot: () => true, children: [...notes.keys()].filter((p) => !p.includes('/')).map((p) => ({ name: p, path: p })) });
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

/** The notes of a map that hold a `kin-calendar` fence, sorted: what the fence index gives the calendar index (`IndexOptions.notes`). */
export const calendarNotesOf = (notes: Map<string, string>): string[] => [...notes].filter(([, t]) => t.includes('```kin-calendar')).map(([p]) => p).sort();

/** The index of the notes, started. */
export async function indexOf(notes: Map<string, string>) {
	const vault = indexVault({});
	vault.notes = notes;
	const index = createCalendarIndex(vault, { notes: () => calendarNotesOf(notes) });
	await index.start();
	return index;
}

export interface Opened {
	win: { contentEl: FEl; modalEl: FEl };
	notes: Map<string, string>;
	created: string[];
	index: Awaited<ReturnType<typeof indexOf>>;
}

/** Opens the Calendars window on a fake vault. */
export async function openWindow(files: Record<string, string>, o: { link?: string; tree?: boolean } = {}): Promise<Opened> {
	const { app, notes, created } = fakeApp(files);
	const index = await indexOf(notes);
	await openCalendars(app as never, index, { tree: o.tree === false ? null : { treePath: 'tree.md', link: o.link, setLink: null } });
	await settle();
	const win = openModals[openModals.length - 1] as unknown as { contentEl: FEl; modalEl: FEl };
	return { win, notes, created, index };
}

/** The control with this `data-focus` name of the window. */
export const control = (c: FEl, name: string): FEl => {
	const el = c.querySelector(`[data-focus="${name}"]`);
	if (!el) throw new Error(`no control ${name}`);
	return el;
};

/** A field of the calendars part (`data-focus="cal:<name>"`). */
export const calField = (c: FEl, name: string): FEl => control(c, `cal:${name}`);

/** Writes a value into a field, as the user types it. */
export const typeInto = (c: FEl, name: string, value: string): void => {
	const el = calField(c, name);
	el.value = value;
	dispatch(el, 'input');
};

/** A click on the first element that matches, then the pending work. */
export const press = async (c: FEl, selector: string): Promise<void> => {
	const el = c.querySelector(selector);
	if (!el) throw new Error(`no ${selector}`);
	dispatch(el, 'click');
	await settle();
};

/** Presses Save. */
export const saveWindow = (c: FEl) => press(c, '.dynasty-sheet-save');

/** "Add calendar" and its menu, as a user does when the window has a calendar. */
export async function addKind(c: FEl, kind: 'cycles' | 'eras', kinds: { cycles: string; eras: string }): Promise<void> {
	await press(c, '[data-focus="cal:add"]');
	lastMenu()!.item(kind === 'cycles' ? kinds.cycles : kinds.eras)!.click();
	await settle();
}

/** True when the section of this key is open. */
export const isOpen = (c: FEl, key: string): boolean => c.querySelector(`[data-section="${key}"]`)?.hasClass('is-open') ?? false;

/** The text of the summary line of a section. */
export const summaryOf = (c: FEl, key: string): string => c.querySelector(`[data-section="${key}"] .dynasty-section-sum`)?.getText() ?? '';
