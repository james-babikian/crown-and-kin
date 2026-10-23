import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { chooseCalendarNote } from '../../src/obsidian/calendar-note-choice';
import { CALENDAR_UI } from '../../src/render/calendar-text';
import { createCalendarIndex } from '../../src/view/calendar-index';
import { FEl, dispatch, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { cycleNote, fakeVault as indexVault } from '../support/calendar-vault';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Step 4.3 of WP-4: the real Calendars window on a fake vault: Add, Change and Remove, the refusals that stop a save, the warning that does not, the first save that makes
 * `Calendars.md`, the stale note, the test line, the More choice of a calendar note and the `kin-calendar` block in a note.
 */

useFakeDom({ window: true });

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
	const index = createCalendarIndex(vault, { notes: () => [...notes].filter(([, t]) => t.includes('```kin-calendar')).map(([p]) => p).sort() });
	await index.start();
	return index;
}

describe('review: the choice of a calendar note', () => {
	it('a tree that names a note that does not exist is not marked as using "No calendar"', async () => {
		const { app, notes } = fakeApp({ 'Calendars.md': cycleNote() });
		const index = await indexOf(notes);
		const done = chooseCalendarNote(app as never, index, { write: vi.fn(async () => ({ ok: true })) } as never, 'tree.md', '[[Gone]]');
		await settle();
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: FEl };
		const options = modal.contentEl.querySelectorAll('.dynasty-choice-option');
		expect(options[0].querySelector('.dynasty-choice-detail')?.getText()).not.toBe(CALENDAR_UI.inUse);
		dispatch(options[0], 'click');
		await done;
	});
});
