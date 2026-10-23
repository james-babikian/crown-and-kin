import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile as VaultFile } from 'obsidian';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { makePersonNote } from '../../src/obsidian/make-note';
import { buildLegend } from '../../src/render/dom/scene';
import { HOUSE_PAGE_UI, NOTE_UI, REMOVE, WINDOW_UI, WRITE_TEXT } from '../../src/render/ui-text';
import { FEl, device, dispatch, resetDom } from '../acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { backButton, backToList, openPage as openListPage } from '../support/lw-support';
import { useFakeDom } from '../support/fake-dom-setup';
import { VALMONT_BODY as BODY, writingHandle } from '../support/writing-handle';

/*
 * WP 10.3b (M10 rules N1–N5, H1–H4; spec §13.11, §13.12): the flow of "Make a note" through the real
 * edit sheet on a fake vault (the nine cases that the acceptance file skips), the house page window,
 * the People button of the Houses window, and the legend house rows.
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
	for (let i = 0; i < 8; i++) await tick();
}

interface Options {
	files?: string[];
	parent?: string;
	failCreate?: boolean;
	resolves?: string[];
}

/** A vault of notes and folders, with the parts of the API that the flow uses. */
function fakeVault(options: Options = {}) {
	const files = new Map<string, string>([['Trees/Tree.md', ''], ...(options.files ?? []).map((p): [string, string] => [p, ''])]);
	const folders = new Set<string>(['/', 'Trees', options.parent ?? '/']);
	const created: { path: string; data: string }[] = [];
	const createdFolders: string[] = [];
	const leaves: { how: unknown; opened: VaultFile[] }[] = [];
	const file = (path: string): VaultFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		const dot = name.lastIndexOf('.');
		return Object.assign(new File(path, dot < 0 ? '' : name.slice(dot + 1)), { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
	};
	const folder = (path: string) => {
		const inside = (p: string) => (path === '/' ? !p.includes('/') : p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
		return { path, name: path.slice(path.lastIndexOf('/') + 1), isRoot: () => path === '/', children: [...files.keys()].filter(inside).map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })) };
	};
	const app = {
		fileManager: {
			getNewFileParent: () => folder(options.parent ?? '/'),
			generateMarkdownLink: (f: VaultFile) => `[[${f.path.replace(/\.md$/, '')}]]`,
		},
		vault: {
			create: vi.fn(async (path: string, data: string) => {
				if (options.failCreate) throw new Error('disk full');
				files.set(path, data);
				created.push({ path, data });
				return file(path);
			}),
			createFolder: vi.fn(async (path: string) => {
				folders.add(path);
				createdFolders.push(path);
			}),
			getAbstractFileByPath: (path: string) => (files.has(path) ? file(path) : folders.has(path) ? folder(path) : null),
			getRoot: () => folder('/'),
			getFiles: () => [],
		},
		metadataCache: { getFirstLinkpathDest: vi.fn((p: string) => ((options.resolves ?? []).includes(p) ? file(`${p}.md`) : null)) },
		workspace: {
			getLeaf: vi.fn((how?: unknown) => {
				const leaf = { how, opened: [] as VaultFile[], openFile: vi.fn(async (f: VaultFile) => void leaf.opened.push(f)) };
				leaves.push(leaf);
				return leaf;
			}),
			openLinkText: vi.fn(),
		},
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
	return { app, files, created, createdFolders, leaves, file };
}

function openSheet(id: string, options: Options = {}, body = BODY) {
	const v = fakeVault(options);
	const handle = writingHandle(body);
	const sheet = EditSheet.create(v.app as never, { handle: handle as never, personId: id, sourcePath: 'Trees/Tree.md' })!;
	sheet.open();
	const content = (sheet as unknown as { contentEl: FEl }).contentEl;
	const shown = () => (sheet as unknown as { shown: boolean }).shown;
	return { ...v, handle, sheet, content, shown, button: () => content.querySelector('.dynasty-make-note') };
}

const lastNotice = () => notices[notices.length - 1];

// ---------- N1: the offer ----------

describe('N1: which button the sheet offers', () => {
	it('no link: Make a note, with its label as the tooltip', () => {
		const s = openSheet('aldric');
		expect(s.button()!.getText()).toBe(NOTE_UI.make);
		expect(s.button()!.getAttribute('aria-label')).toBe('Make a note: the plugin makes a note for Aldric Valmont and links it to this card');
	});

	it('a link that opens no note: Make the linked note, with its label', () => {
		const s = openSheet('bran');
		expect(s.button()!.getText()).toBe(NOTE_UI.makeLinked);
		expect(s.button()!.getAttribute('aria-label')).toBe('Make the linked note: the plugin makes the note that the link of Bran Valmont names');
	});

	it('a link that opens a note, or a web address: no button', () => {
		expect(openSheet('bran', { resolves: ['Bran Valmont'] }).button()).toBeNull();
		expect(openSheet('cara').button()).toBeNull();
	});

	it('the button follows the draft link and the draft name', () => {
		const s = openSheet('aldric');
		const link = s.content.querySelector('[data-field="link"] input')!;
		(link as unknown as { value: string }).value = 'https://example.com';
		dispatch(link, 'input');
		expect(s.button()).toBeNull();
		(link as unknown as { value: string }).value = '[[Somewhere]]';
		dispatch(link, 'input');
		expect(s.button()!.getText()).toBe(NOTE_UI.makeLinked);
		(link as unknown as { value: string }).value = '';
		dispatch(link, 'input');
		const name = s.content.querySelector('[data-field="name"] input')!;
		(name as unknown as { value: string }).value = 'Aldric II';
		dispatch(name, 'input');
		expect(s.button()!.getText()).toBe(NOTE_UI.make);
		expect(s.button()!.getAttribute('aria-label')).toContain('for Aldric II and');
	});

	it('the sheet of a new person has none', () => {
		const v = fakeVault();
		const sheet = EditSheet.createNew(v.app as never, { handle: writingHandle(BODY) as never, sourcePath: 'Trees/Tree.md', newPerson: { kind: 'person' } } as never)!;
		sheet.open();
		expect((sheet as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-make-note')).toBeNull();
	});

	it('a read-only sheet (a blocking problem) has none', () => {
		const blocked = BODY.replace('  - id: bran\n', '  - id: aldric\n');
		const s = openSheet('cara', {}, blocked);
		expect(s.content.querySelector('.dynasty-make-note')).toBeNull();
	});
});

// ---------- N2: mode new ----------

describe('N2: Make a note', () => {
	it('makes the note, links it in one write, shows the Notice with Undo, closes the sheet and opens the note in a new tab', async () => {
		device.coarse = false;
		device.width = 1280;
		const s = openSheet('aldric', { parent: 'Notes' });
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toEqual([{ path: 'Notes/Aldric Valmont.md', data: 'Tree: [[Trees/Tree]]\n' }]);
		expect(s.handle.write).toHaveBeenCalledTimes(1);
		const written = s.handle.body;
		expect(written).toContain('link: "[[Notes/Aldric Valmont]]"');
		expect(lastNotice()).toBe(NOTE_UI.made('Aldric Valmont'));
		expect(noticeList[noticeList.length - 1].noticeEl.querySelector('.dynasty-undo-button')).not.toBeNull();
		expect(s.shown()).toBe(false);
		expect(s.leaves).toHaveLength(1);
		expect(s.leaves[0].how).toBe('tab');
		expect(s.leaves[0].opened[0].path).toBe('Notes/Aldric Valmont.md');
	});

	it('on a phone the note opens in the same place', async () => {
		device.coarse = true;
		device.width = 390;
		device.height = 844;
		const s = openSheet('aldric');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.leaves[0].how).toBe(false);
	});

	it('uses the open sheet\'s tree opener when the view gives one (the full-screen view closes first)', async () => {
		const v = fakeVault();
		const handle = writingHandle(BODY);
		const order: string[] = [];
		const sheet = EditSheet.create(v.app as never, { handle: handle as never, personId: 'aldric', sourcePath: 'Trees/Tree.md', openNote: (open: () => Promise<void>) => { order.push('leave'); void open(); } } as never)!;
		sheet.open();
		dispatch((sheet as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-make-note')!, 'click');
		await settle();
		expect(order).toEqual(['leave']);
		expect(v.leaves).toHaveLength(1);
	});

	it('writes the unsaved draft in the same write, with the draft name in the note name', async () => {
		const s = openSheet('aldric');
		const name = s.content.querySelector('[data-field="name"] input')!;
		(name as unknown as { value: string }).value = 'Aldric: "the Great"';
		dispatch(name, 'input');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created.map((c) => c.path)).toEqual(['Aldric the Great.md']);
		expect(s.handle.write).toHaveBeenCalledTimes(1);
		expect(s.handle.body).toContain('name: "Aldric: \\"the Great\\""');
		expect(s.handle.body).toContain('link: "[[Aldric the Great]]"');
	});

	it('a second tap during the flow does nothing', async () => {
		const s = openSheet('aldric');
		const b = s.button()!;
		dispatch(b, 'click');
		dispatch(b, 'click');
		await settle();
		expect(s.created).toHaveLength(1);
		expect(s.handle.write).toHaveBeenCalledTimes(1);
	});

	it('a changed tree makes no note and shows the stale text', async () => {
		const s = openSheet('aldric');
		s.handle.body = `${BODY}# changed\n`;
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toEqual([]);
		expect(s.handle.write).not.toHaveBeenCalled();
		expect(notices).toContain(WRITE_TEXT.staleWindow);
	});

	it('a failed vault write gives the Notice, changes nothing and keeps the sheet', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const s = openSheet('aldric', { failCreate: true });
		dispatch(s.button()!, 'click');
		await settle();
		expect(lastNotice()).toBe(NOTE_UI.cannot('Aldric Valmont'));
		expect(s.handle.write).not.toHaveBeenCalled();
		expect(s.shown()).toBe(true);
		expect(s.leaves).toEqual([]);
		// The busy flag is free again.
		expect((s.sheet as unknown as { noteBusy: boolean }).noteBusy).toBe(false);
	});

	it('a tree write that fails after the note was made keeps the note, says so, and opens nothing', async () => {
		const s = openSheet('aldric');
		s.handle.write.mockImplementation((async () => ({ ok: false, code: 'missing' })) as never);
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toHaveLength(1);
		expect(notices).toContain(NOTE_UI.linkNotAdded('Aldric Valmont'));
		expect(s.leaves).toEqual([]);
		expect(s.shown()).toBe(true);
	});

	it('the undo button reverts the write and says that the note is still in the vault', async () => {
		const s = openSheet('aldric');
		dispatch(s.button()!, 'click');
		await settle();
		const undo = noticeList[noticeList.length - 1].noticeEl.querySelector('.dynasty-undo-button')!;
		dispatch(undo, 'click');
		await settle();
		expect(s.handle.undo).toHaveBeenCalledTimes(1);
		expect(notices).toContain(NOTE_UI.undone('Aldric Valmont'));
		expect(s.files.has('Aldric Valmont.md')).toBe(true);
	});

	it('the Notice says that Undo also removes the other saved changes when the draft had changes', async () => {
		const s = openSheet('aldric');
		const born = s.content.querySelector('[data-field="born"] input')!;
		(born as unknown as { value: string }).value = '1201';
		dispatch(born, 'input');
		dispatch(s.button()!, 'click');
		await settle();
		expect(lastNotice()).toBe(`${NOTE_UI.made('Aldric Valmont')} ${REMOVE.undoAlso}`);
	});
});

describe('N2 step 2: a note with that name exists', () => {
	const question = (s: ReturnType<typeof openSheet>) => (s.sheet as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-confirm');

	it('asks with three choices; a note with that name in another folder does not count', async () => {
		const other = openSheet('aldric', { parent: 'Notes', files: ['Other/Aldric Valmont.md'] });
		dispatch(other.button()!, 'click');
		await settle();
		expect(other.created).toHaveLength(1);

		const s = openSheet('aldric', { parent: 'Notes', files: ['Notes/aldric valmont.md'] });
		dispatch(s.button()!, 'click');
		await settle();
		const q = question(s)!;
		expect(q.querySelector('.dynasty-sheet-confirm-title')!.getText()).toBe('The vault has a note with the name “Aldric Valmont”.');
		expect(q.querySelectorAll('button').map((b) => b.getText())).toEqual(['Cancel', 'Link to this note', 'Make a new note “Aldric Valmont 1”']);
		expect(s.created).toEqual([]);
	});

	it('Link to this note writes the link only and makes no note', async () => {
		const s = openSheet('aldric', { parent: 'Notes', files: ['Notes/Aldric Valmont.md'] });
		dispatch(s.button()!, 'click');
		await settle();
		dispatch(question(s)!.querySelector('.dynasty-note-ask-link')!, 'click');
		await settle();
		expect(s.created).toEqual([]);
		expect(s.handle.body).toContain('link: "[[Notes/Aldric Valmont]]"');
		expect(lastNotice()).toBe(NOTE_UI.linkedTo('Aldric Valmont'));
		expect(s.leaves[0].opened[0].path).toBe('Notes/Aldric Valmont.md');
	});

	it('Make a new note uses the free name and links it', async () => {
		const s = openSheet('aldric', { parent: 'Notes', files: ['Notes/Aldric Valmont.md'] });
		dispatch(s.button()!, 'click');
		await settle();
		dispatch(question(s)!.querySelector('.dynasty-note-ask-new')!, 'click');
		await settle();
		expect(s.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont 1.md']);
		expect(s.handle.body).toContain('link: "[[Notes/Aldric Valmont 1]]"');
	});

	it('Cancel and Escape make no note, write nothing and free the button', async () => {
		const s = openSheet('aldric', { parent: 'Notes', files: ['Notes/Aldric Valmont.md'] });
		dispatch(s.button()!, 'click');
		await settle();
		dispatch(question(s)!.querySelector('.dynasty-sheet-keep')!, 'click');
		await settle();
		expect(s.created).toEqual([]);
		expect(s.handle.write).not.toHaveBeenCalled();
		expect(question(s)).toBeNull();
		dispatch(s.button()!, 'click');
		await settle();
		expect(question(s)).not.toBeNull();
		s.sheet.close();
		await settle();
		expect(question(s)).toBeNull();
		expect(s.created).toEqual([]);
		expect((s.sheet as unknown as { noteBusy: boolean }).noteBusy).toBe(false);
	});
});

// ---------- N3: mode linked ----------

describe('N3: Make the linked note', () => {
	it('makes the note of the link\'s name in the D60 folder, changes no tree text, and opens it', async () => {
		const s = openSheet('bran', { parent: 'Notes' });
		const before = s.handle.body;
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toEqual([{ path: 'Notes/Bran Valmont.md', data: 'Tree: [[Trees/Tree]]\n' }]);
		expect(s.handle.write).not.toHaveBeenCalled();
		expect(s.handle.body).toBe(before);
		expect(lastNotice()).toBe(NOTE_UI.madeOnly('Bran Valmont'));
		expect(s.leaves[0].opened[0].path).toBe('Notes/Bran Valmont.md');
		expect(s.shown()).toBe(false);
	});

	it('makes the missing folders of the link one by one', async () => {
		const s = openSheet('dora');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.createdFolders).toEqual(['People']);
		expect(s.created.map((c) => c.path)).toEqual(['People/Dora.md']);
	});

	it('an existing file is not made again', async () => {
		const s = openSheet('dora', { files: ['People/Dora.md'] });
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toEqual([]);
		expect(s.handle.write).not.toHaveBeenCalled();
	});

	it('with unsaved changes the sheet asks before it closes for the note', async () => {
		const s = openSheet('bran');
		const born = s.content.querySelector('[data-field="born"] input')!;
		(born as unknown as { value: string }).value = '1201';
		dispatch(born, 'input');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created).toHaveLength(1);
		expect(s.leaves).toEqual([]);
		expect(s.shown()).toBe(true);
	});
});

// ---------- the flow on its own ----------

describe('makePersonNote: checks before vault.create', () => {
	it('a sheet that closes during the same-name question makes no note', async () => {
		const v = fakeVault({ parent: 'Notes', files: ['Notes/Aldric Valmont.md'] });
		let alive = true;
		const r = await makePersonNote({
			app: v.app as never,
			mode: 'new',
			personId: 'aldric',
			name: 'Aldric Valmont',
			link: '',
			sourcePath: 'Trees/Tree.md',
			loadedBody: 'x',
			ready: () => true,
			alive: () => alive,
			handle: { body: 'x', refresh: async () => {} },
			ask: async () => {
				alive = false;
				return 'new';
			},
			write: async () => null,
		});
		expect(r.kind).toBe('stopped');
		expect(v.created).toEqual([]);
	});

	it('a changed body gives stale before any folder is looked at', async () => {
		const v = fakeVault();
		const r = await makePersonNote({
			app: v.app as never,
			mode: 'new',
			personId: 'a',
			name: 'A',
			link: '',
			sourcePath: 'Trees/Tree.md',
			loadedBody: 'old',
			ready: () => true,
			alive: () => true,
			handle: { body: 'new', refresh: async () => {} },
			ask: async () => 'cancel',
			write: async () => null,
		});
		expect(r.kind).toBe('stale');
		expect(v.created).toEqual([]);
	});
});

// ---------- the People button (H1) ----------

describe('H1: People in the Houses window', () => {
	function openHouses() {
		const v = fakeVault();
		const handle = writingHandle(BODY);
		const shown: string[] = [];
		const notes: unknown[] = [];
		const win = HousesWindow.create(v.app as never, { handle: handle as never, sourcePath: 'Trees/Tree.md', people: { show: (id) => shown.push(id), openNote: (open) => notes.push(open) } })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		return { ...v, win, content, shown, handle };
	}
	// 0.2.5 (D134): People is on the edit page of a house; this opens the page (back to the list first when another page is open).
	const rowOf = (c: FEl, id: string) => {
		if (backButton(c)) backToList(c);
		return openListPage(c, id);
	};

	it('each saved house has a People section with its rows and a button for the note; a house new in the draft has none (D202)', () => {
		const h = openHouses();
		const page = rowOf(h.content, 'valmont');
		const section = page.querySelector('[data-section="people"]')!;
		expect(section.querySelector('.dynasty-sheet-section-title, .dynasty-section-title')?.getText() ?? section.getText()).toContain(WINDOW_UI.sectionPeople);
		const b = section.querySelector('.dynasty-house-people')!;
		expect(b.getText()).toBe(HOUSE_PAGE_UI.makeNote);
		expect(b.getAttribute('aria-label')).toBe(HOUSE_PAGE_UI.makeNoteLabel('House Valmont'));
		backToList(h.content);
		dispatch(h.content.querySelector('.dynasty-house-add')!, 'click');
		expect(h.content.querySelector('.dynasty-lw-page')!.querySelector('[data-section="people"]')).toBeNull();
	});

	it('without the option there is no button for the note, and the rows stay', () => {
		const v = fakeVault();
		const win = HousesWindow.create(v.app as never, { handle: writingHandle(BODY) as never })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		const page = openListPage(content, 'valmont');
		expect(page.querySelector('.dynasty-house-people')).toBeNull();
		expect(page.querySelectorAll('.dynasty-hp-row').length).toBe(4);
	});

	it('the rows show the name, the title, and a second text line with the generation and the years', () => {
		const h = openHouses();
		const rows = rowOf(h.content, 'valmont').querySelectorAll('.dynasty-hp-row');
		expect(rows.map((r) => r.querySelector('.dynasty-hp-name')!.getText())).toEqual(['Aldric Valmont', 'Bran Valmont', 'Cara Valmont', 'Dora Valmont']);
		expect(rows[0]!.querySelector('.dynasty-row-sub')!.getText()).toBe(WINDOW_UI.personRowSub(1, '1200', ''));
	});

	it('without a way to show the card, the rows are plain text', () => {
		const v = fakeVault();
		const win = HousesWindow.create(v.app as never, { handle: writingHandle(BODY) as never })!;
		win.open();
		const rows = openListPage((win as unknown as { contentEl: FEl }).contentEl, 'valmont').querySelectorAll('.dynasty-hp-row');
		expect(rows.every((r) => r.tag !== 'button')).toBe(true);
	});

	it('a tap on a name closes the window, then shows the card', () => {
		const h = openHouses();
		dispatch(rowOf(h.content, 'valmont').querySelectorAll('.dynasty-hp-row')[2], 'click');
		expect(openModals).toEqual([]);
		expect(h.shown).toEqual(['cara']);
	});

	it('with unsaved changes the window asks first; keep editing shows nothing, discard shows the card', () => {
		const h = openHouses();
		const name = rowOf(h.content, 'orsini').querySelector('textarea')!;
		(name as unknown as { value: string }).value = 'House Orsini II';
		dispatch(name, 'input');
		dispatch(rowOf(h.content, 'valmont').querySelectorAll('.dynasty-hp-row')[0], 'click');
		expect(openModals).toHaveLength(1);
		expect(h.shown).toEqual([]);
		const modalEl = (h.win as unknown as { modalEl: FEl }).modalEl;
		dispatch(modalEl.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(h.shown).toEqual([]);
		// Again, and discard.
		dispatch(rowOf(h.content, 'valmont').querySelectorAll('.dynasty-hp-row')[0], 'click');
		dispatch(modalEl.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(openModals).toEqual([]);
		expect(h.shown).toEqual(['aldric']);
	});

	it('the button for the note asks first, too, when the window has unsaved changes', async () => {
		const h = openHouses();
		const name = rowOf(h.content, 'orsini').querySelector('textarea')!;
		(name as unknown as { value: string }).value = 'House Orsini II';
		dispatch(name, 'input');
		dispatch(rowOf(h.content, 'valmont').querySelector('.dynasty-house-people')!, 'click');
		await settle();
		const modalEl = (h.win as unknown as { modalEl: FEl }).modalEl;
		expect(modalEl.querySelector('.dynasty-sheet-keep')).not.toBeNull();
		dispatch(modalEl.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(openModals).toHaveLength(1);
	});
});

// 0.2.8 (D196 item 3): the live legend has no house rows.
describe('H1: the house rows of the legend (gone in 0.2.8)', () => {
	it('no house row is drawn, and no button', () => {
		const list = new FEl('div') as unknown as HTMLElement;
		buildLegend(list);
		expect((list as unknown as FEl).querySelectorAll('.dynasty-legend-house')).toEqual([]);
		expect((list as unknown as FEl).querySelectorAll('button')).toEqual([]);
	});
});

