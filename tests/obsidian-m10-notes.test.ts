import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { deriveFamilies } from '../src/core/derive';
import type { Op } from '../src/core/edit';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { EditSheet } from '../src/obsidian/edit-sheet';
import { openHousePage } from '../src/obsidian/house-page-window';
import { HousesWindow } from '../src/obsidian/houses-window';
import { makePersonNote } from '../src/obsidian/make-note';
import { buildLegend } from '../src/render/dom/scene';
import { HOUSE_PAGE_UI, NOTE_UI, REMOVE, WRITE_TEXT } from '../src/render/ui-text';
import { FEl, device, dispatch, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { noticeList, notices, openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHandle, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * WP 10.3b (M10 rules N1–N5, H1–H4; spec §13.11, §13.12): the flow of "Make a note" through the real
 * edit sheet on a fake vault (the nine cases that the acceptance file skips), the house page window,
 * the People button of the Houses window, and the legend house rows.
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
	for (let i = 0; i < 8; i++) await tick();
}

const BODY = `houses:
  - id: valmont
    name: House Valmont
    color: "#8b1a1a"
  - id: orsini
    name: House Orsini
  - id: empty
    name: House Empty
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
    born: "1200"
  - id: bran
    name: Bran Valmont
    house: valmont
    link: "[[Bran Valmont]]"
  - id: cara
    name: Cara Valmont
    house: valmont
    link: "https://example.com/cara"
  - id: dora
    name: Dora Valmont
    house: valmont
    link: "[[People/Dora]]"
  - id: ines
    name: Ines Orsini
    house: orsini
    link: "[[Ines Orsini]]"
unions:
  - partners: [aldric, ines]
parents:
  - child: bran
    parent: aldric
  - child: dora
    parent: aldric
`;

function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('Trees/Tree.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	h.undo.mockImplementation((async () => ({ ok: true, body: body })) as never);
	return h;
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
		expect(notices).toContain(WRITE_TEXT.stale);
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

// ---------- the house page (H2–H4) ----------

const graph = () => {
	const parsed = parseDynasty(BODY);
	if (!parsed.ok) throw new Error('bad body');
	return deriveFamilies(parsed.tree);
};

function openPage(houseId: string, options: Options = {}) {
	const v = fakeVault(options);
	const shown: string[] = [];
	const notes: (() => Promise<void>)[] = [];
	let closed = 0;
	const win = openHousePage(v.app as never, {
		app: v.app as never,
		houseId,
		whole: graph(),
		sourcePath: 'Trees/Tree.md',
		show: (id) => shown.push(id),
		openNote: (open) => notes.push(open),
		onClosed: () => closed++,
	})!;
	const content = (win as unknown as { contentEl: FEl }).contentEl;
	return { ...v, win, content, shown, notes, closed: () => closed, rows: () => content.querySelectorAll('.dynasty-hp-row') };
}

describe('H2: the house page window', () => {
	it('shows the name, the number of people and one 44 px button for each person, in the order of the page', () => {
		device.width = 1280;
		const p = openPage('valmont');
		expect(p.content.querySelector('.dynasty-sheet-title')!.getText()).toBe('House Valmont');
		expect(p.content.querySelector('.dynasty-hp-count')!.getText()).toBe('4 people');
		expect(p.rows().map((r) => r.getAttribute('data-person'))).toEqual(['aldric', 'bran', 'cara', 'dora']);
		// RB2: the name of the row comes from its text (WCAG 2.5.3); the title only adds the action.
		expect(p.rows()[0].getAttribute('aria-label')).toBeNull();
		expect(p.rows()[0].getAttribute('title')).toBe(HOUSE_PAGE_UI.rowHint);
		expect(p.content.querySelector('.dynasty-hp-head')!.children.map((c) => c.getText())).toEqual(['Generation', 'Name', 'Title', 'Born', 'Died']);
		// The value is the plain number; the lead word shows only in the two-line layout (CSS).
		expect(p.rows()[0].querySelector('.dynasty-hp-gen .dynasty-hp-value')!.getText()).toBe('1');
		expect(p.rows()[0].querySelector('.dynasty-hp-gen .dynasty-hp-lead')!.getText()).toBe('Generation ');
	});

	it('"1 person" for one person', () => {
		const p = openPage('orsini');
		expect(p.content.querySelector('.dynasty-hp-count')!.getText()).toBe('1 person');
	});

	it('a house with no person: the text, no count, no table, no note button', () => {
		const p = openPage('empty');
		expect(p.content.querySelector('.dynasty-hp-none')!.getText()).toBe('No person in the tree has this house.');
		expect(p.content.querySelector('.dynasty-hp-count')).toBeNull();
		expect(p.content.querySelector('.dynasty-hp-table')).toBeNull();
		expect(p.content.querySelector('.dynasty-hp-make-note')).toBeNull();
	});

	it('a house that is not in the tree gives a Notice and no window', () => {
		const v = fakeVault();
		const win = openHousePage(v.app as never, { app: v.app as never, houseId: 'nobody', whole: graph(), sourcePath: 'x.md', show: () => {}, openNote: () => {} });
		expect(win).toBeNull();
		expect(openModals).toEqual([]);
		expect(lastNotice()).toBe(HOUSE_PAGE_UI.none);
	});

	it('below 600 px the window has the phone class; the text of a row is the same (the layout is CSS)', () => {
		device.width = 390;
		device.height = 844;
		const p = openPage('valmont');
		expect((p.win as unknown as { modalEl: FEl }).modalEl.hasClass('is-phone')).toBe(true);
		expect(p.rows()[0].querySelector('.dynasty-hp-gen')!.getText()).toBe('Generation 1');
	});

	it('H3: a tap on a row closes the window, then shows the card', () => {
		const p = openPage('valmont');
		dispatch(p.rows()[1], 'click');
		expect(openModals).toEqual([]);
		expect(p.shown).toEqual(['bran']);
		expect(p.closed()).toBe(1);
	});

	it('H4: Make a note with this table makes the note in the D60 folder, tells, closes and hands the opener over', async () => {
		const p = openPage('valmont', { parent: 'Notes', files: ['Notes/House Valmont, people.md'] });
		const b = p.content.querySelector('.dynasty-hp-make-note')!;
		expect(b.getText()).toBe('Make a note with this table');
		expect(b.getAttribute('aria-label')).toBe(HOUSE_PAGE_UI.makeNoteLabel('House Valmont'));
		dispatch(b, 'click');
		await settle();
		expect(p.created).toHaveLength(1);
		expect(p.created[0].path).toBe('Notes/House Valmont, people 1.md');
		expect(p.created[0].data.startsWith('| Generation | Name | Title | Born | Died |\n| --- | --- | --- | --- | --- |\n| 1 | Aldric Valmont |')).toBe(true);
		expect(p.created[0].data).not.toContain('#');
		expect(lastNotice()).toBe(HOUSE_PAGE_UI.noteMade('House Valmont, people 1'));
		expect(openModals).toEqual([]);
		expect(p.notes).toHaveLength(1);
		await p.notes[0]();
		expect(p.leaves[0].opened[0].path).toBe('Notes/House Valmont, people 1.md');
	});

	it('H4: a failed vault write gives the Notice and the window stays', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const p = openPage('valmont', { failCreate: true });
		dispatch(p.content.querySelector('.dynasty-hp-make-note')!, 'click');
		await settle();
		expect(lastNotice()).toBe(HOUSE_PAGE_UI.noteFailed('House Valmont, people'));
		expect(openModals).toHaveLength(1);
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
	const rowOf = (c: FEl, id: string) => c.querySelectorAll('.dynasty-house-row').find((r) => r.getAttribute('data-house') === id)!;

	it('each saved house has People with its label; a house new in the draft has none', () => {
		const h = openHouses();
		const b = rowOf(h.content, 'valmont').querySelector('.dynasty-house-people')!;
		expect(b.getText()).toBe('People');
		expect(b.getAttribute('aria-label')).toBe('People: show the people of House Valmont');
		dispatch(h.content.querySelector('.dynasty-house-add')!, 'click');
		const rows = h.content.querySelectorAll('.dynasty-house-row');
		expect(rows[rows.length - 1].querySelector('.dynasty-house-people')).toBeNull();
	});

	it('without the option there is no People button', () => {
		const v = fakeVault();
		const win = HousesWindow.create(v.app as never, { handle: writingHandle(BODY) as never })!;
		win.open();
		expect((win as unknown as { contentEl: FEl }).contentEl.querySelector('.dynasty-house-people')).toBeNull();
	});

	it('a tap on a name closes the page and this window, then shows the card', () => {
		const h = openHouses();
		dispatch(rowOf(h.content, 'valmont').querySelector('.dynasty-house-people')!, 'click');
		expect(openModals).toHaveLength(2);
		const page = openModals[1] as unknown as { contentEl: FEl };
		dispatch(page.contentEl.querySelectorAll('.dynasty-hp-row')[2], 'click');
		expect(openModals).toEqual([]);
		expect(h.shown).toEqual(['cara']);
	});

	it('with unsaved changes the window asks first; keep editing shows nothing, discard shows the card', () => {
		const h = openHouses();
		const name = rowOf(h.content, 'orsini').querySelector('input')!;
		(name as unknown as { value: string }).value = 'House Orsini II';
		dispatch(name, 'input');
		dispatch(rowOf(h.content, 'valmont').querySelector('.dynasty-house-people')!, 'click');
		const page = openModals[1] as unknown as { contentEl: FEl };
		dispatch(page.contentEl.querySelectorAll('.dynasty-hp-row')[0], 'click');
		expect(openModals).toHaveLength(1);
		expect(h.shown).toEqual([]);
		dispatch(h.content.closest?.('.modal') ? h.content : h.content, 'click');
		const modalEl = (h.win as unknown as { modalEl: FEl }).modalEl;
		dispatch(modalEl.querySelector('.dynasty-sheet-keep')!, 'click');
		expect(h.shown).toEqual([]);
		// Again, and discard.
		dispatch(rowOf(h.content, 'valmont').querySelector('.dynasty-house-people')!, 'click');
		const page2 = openModals[1] as unknown as { contentEl: FEl };
		dispatch(page2.contentEl.querySelectorAll('.dynasty-hp-row')[0], 'click');
		dispatch(modalEl.querySelector('.dynasty-sheet-discard')!, 'click');
		expect(openModals).toEqual([]);
		expect(h.shown).toEqual(['aldric']);
	});
});

describe('H1: the house rows of the legend', () => {
	const houses = [
		{ id: 'valmont', name: 'House Valmont', color: '#8b1a1a' },
		{ id: 'orsini', name: 'House Orsini' },
	];

	it('with a callback the rows are buttons with a tooltip; a tap gives the house id', () => {
		const list = new FEl('div') as unknown as HTMLElement;
		const seen: string[] = [];
		buildLegend(list, houses as never, (id) => seen.push(id));
		const rows = (list as unknown as FEl).querySelectorAll('.dynasty-legend-house');
		expect(rows.map((r) => r.hasClass('is-button'))).toEqual([true, true]);
		expect(rows[0].getAttribute('aria-label')).toBe('People: show the people of House Valmont');
		dispatch(rows[1], 'click');
		expect(seen).toEqual(['orsini']);
	});

	it('without a callback the rows stay plain (the static phone preview)', () => {
		const list = new FEl('div') as unknown as HTMLElement;
		buildLegend(list, houses as never);
		expect((list as unknown as FEl).querySelectorAll('button')).toEqual([]);
	});
});
