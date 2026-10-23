import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { App, TFile } from 'obsidian';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import type { Written } from '../../src/obsidian/block-handle';
import type { makePersonNote, MakePersonNoteInput, openMadeNote } from '../../src/obsidian/make-note';
import type { makeNote } from '../../src/obsidian/table-note';
import { NOTE_UI, REMOVE } from '../../src/render/ui-text';
import { TFile as VaultFile } from 'obsidian';
import { FEl, device, dispatch, resetDom } from './fake-dom';
import { noticeList, notices, resetObsidian } from './fake-obsidian';
import { fakeHandle, type FakeHandle } from './tree-view-fakes';
import { loadModule, noteMakeModule } from './m10-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Spec §13.11 (D60, D86, D87), §13.12 "Make a note with this table" (D55, D89) and the M10 rules
 * (core rules on note names and N1-N5 of the Obsidian side): the note names, the path of a linked note ("St.John" is a
 * note, "Report.pdf" is not), `makeNote` (folder, free name, vault root, never throws) and where a made
 * note opens (a new tab on the computer, the same place on a phone). The flow `makePersonNote` needs a
 * handle, the same-name question and the draft write, which `MakePersonNoteInput` does not carry; the
 * builder added them (`MakePersonNoteExtra` in make-note.ts) and the flow tests drive them. The busy flag
 * and the undo Notice belong to the edit sheet, so those two are tested through the real sheet.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

// ---------- Rules 28 and 29 (core) ----------

describe('rule 28: `personNoteName`', () => {
	it('the name as written, cleaned as §13.11 says', async () => {
		const { personNoteName } = await noteMakeModule();
		expect(personNoteName({ name: 'Aldric Valmont' })).toBe('Aldric Valmont');
		expect(personNoteName({ name: '  Aldric   of  Valmont ' })).toBe('Aldric of Valmont');
		expect(personNoteName({ name: 'Aldric: "the Great"?' })).toBe('Aldric the Great');
		expect(personNoteName({ name: 'A\\B/C*D<E>F|G#H^I[J]K' })).toBe('ABCDEFGHIJK');
		expect(personNoteName({ name: '.Aldric' })).toBe('Aldric');
		expect(personNoteName({ name: 'Ser Gareth\tOrsini' })).toBe('Ser Gareth Orsini');
	});

	it('an empty result is "Person"; the regnal name is not used (the name as written)', async () => {
		const { personNoteName } = await noteMakeModule();
		expect(personNoteName({ name: '' })).toBe('Person');
		expect(personNoteName({ name: '   ' })).toBe('Person');
		expect(personNoteName({ name: '???' })).toBe('Person');
		// "Aldric Valmont" with the number II on the card is still "Aldric Valmont".
		expect(personNoteName({ name: 'Aldric Valmont' })).not.toContain('II');
	});
});

describe('rule 29: `linkedNotePath`', () => {
	const path = async (link: string | undefined) => (await noteMakeModule()).linkedNotePath(link);

	it('no link, an empty target, a target that is only a heading or an alias: null', async () => {
		for (const link of [undefined, '', '   ', '[[]]', '[[#Heading]]', '[[|alias]]', '[]()', '#']) expect(await path(link), String(link)).toBeNull();
	});

	it('a plain note name: the D60 folder (folder ""), the name, and ".md"', async () => {
		expect(await path('[[Aldric Valmont]]')).toEqual({ folder: '', name: 'Aldric Valmont', path: 'Aldric Valmont.md' });
		expect(await path('Aldric Valmont')).toEqual({ folder: '', name: 'Aldric Valmont', path: 'Aldric Valmont.md' });
		expect(await path('![[Aldric Valmont]]')).toEqual({ folder: '', name: 'Aldric Valmont', path: 'Aldric Valmont.md' });
	});

	it('the target without "#…" and "|…"', async () => {
		const want = { folder: '', name: 'Aldric', path: 'Aldric.md' };
		expect(await path('[[Aldric#Early years]]')).toEqual(want);
		expect(await path('[[Aldric|the duke]]')).toEqual(want);
		expect(await path('[[Aldric#Early years|the duke]]')).toEqual(want);
	});

	it('split at the last "/" into a folder and a name; a leading "/" is removed', async () => {
		expect(await path('[[People/Kings/Aldric]]')).toEqual({ folder: 'People/Kings', name: 'Aldric', path: 'People/Kings/Aldric.md' });
		expect(await path('[[People/Aldric]]')).toEqual({ folder: 'People', name: 'Aldric', path: 'People/Aldric.md' });
		expect(await path('[[/Aldric]]')).toEqual({ folder: '', name: 'Aldric', path: 'Aldric.md' });
		expect(await path('[[/People/Aldric]]')).toEqual({ folder: 'People', name: 'Aldric', path: 'People/Aldric.md' });
	});

	it('a Markdown link is read the way `linkTarget` reads it (percent-encoding decoded)', async () => {
		expect(await path('[Aldric](People/Aldric%20Valmont.md)')).toEqual({ folder: 'People', name: 'Aldric Valmont', path: 'People/Aldric Valmont.md' });
		expect(await path('[Aldric](<People/Aldric Valmont>)')).toEqual({ folder: 'People', name: 'Aldric Valmont', path: 'People/Aldric Valmont.md' });
	});

	it('".md" is added unless the path already ends with it (compared without case)', async () => {
		expect(await path('[[Notes/Aldric.md]]')).toEqual({ folder: 'Notes', name: 'Aldric', path: 'Notes/Aldric.md' });
		expect(await path('[[Aldric.MD]]')).toEqual({ folder: '', name: 'Aldric', path: 'Aldric.MD' });
		expect(await path('[[Aldric.md.md]]')).toEqual({ folder: '', name: 'Aldric.md', path: 'Aldric.md.md' });
	});

	it('any other extension is part of the name: "St.John" and "Dr. Smith" are notes', async () => {
		expect(await path('[[St.John]]')).toEqual({ folder: '', name: 'St.John', path: 'St.John.md' });
		expect(await path('[[Dr. Smith]]')).toEqual({ folder: '', name: 'Dr. Smith', path: 'Dr. Smith.md' });
		expect(await path('[[v1.2.3]]')).toEqual({ folder: '', name: 'v1.2.3', path: 'v1.2.3.md' });
		expect(await path('[[Notes/Ch. 1]]')).toEqual({ folder: 'Notes', name: 'Ch. 1', path: 'Notes/Ch. 1.md' });
	});

	it('a target whose extension is one of Obsidian\'s other file kinds names no note ("Report.pdf.md" is never made), compared without case', async () => {
		for (const link of ['[[Report.pdf]]', '[[Report.PDF]]', '[[photo.png]]', '[[photo.JPG]]', '[[Notes/scan.jpeg]]', '[[map.svg]]', '[[plan.canvas]]', '[[table.base]]', '[[song.mp3]]', '[[clip.mp4]]', '[[voice.m4a]]', '[[film.MOV]]', '[Report](files/Report.pdf)', '![[photo.webp]]']) {
			expect(await path(link), link).toBeNull();
		}
	});

	it('a web address is not a note', async () => {
		for (const link of ['https://example.com/aldric', 'http://example.com', '[Aldric](https://example.com/aldric)', '[[https://example.com/aldric]]']) expect(await path(link), link).toBeNull();
	});

	it('the list of extensions: lower case, no dot, no repeats, the kinds the spec names', async () => {
		const { NON_NOTE_EXTENSIONS } = await noteMakeModule();
		expect(new Set(NON_NOTE_EXTENSIONS).size).toBe(NON_NOTE_EXTENSIONS.length);
		for (const e of NON_NOTE_EXTENSIONS) expect(e).toMatch(/^[a-z0-9]+$/);
		for (const e of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf', 'canvas', 'base', 'mp3', 'wav', 'mp4', 'webm', 'mov']) expect(NON_NOTE_EXTENSIONS).toContain(e);
		expect(NON_NOTE_EXTENSIONS).not.toContain('md');
	});
});

// ---------- A fake app ----------

interface FakeOptions {
	/** Paths of the notes in the vault. */
	files?: string[];
	/** The D60 folder: '/' is the vault root. */
	parent?: string;
	/** Folders that exist besides the parent. */
	folders?: string[];
	/** `vault.create` fails with this message. */
	failCreate?: string;
	/** `getNewFileParent` throws. */
	failParent?: boolean;
}

const File = VaultFile as unknown as new (path: string, extension: string) => TFile;

function fakeApp(options: FakeOptions = {}) {
	const files = new Map<string, string>((options.files ?? []).map((p) => [p, '']));
	const folders = new Set<string>(['/', options.parent ?? '/', ...(options.folders ?? [])]);
	const created: { path: string; data: string }[] = [];
	const parentCalls: string[] = [];
	const createdFolders: string[] = [];
	const leaves: { how: unknown; opened: TFile[] }[] = [];
	const file = (path: string): TFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		const dot = name.lastIndexOf('.');
		return Object.assign(new File(path, dot < 0 ? '' : name.slice(dot + 1)), { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1 } });
	};
	const folder = (path: string) => {
		const inside = (p: string) => (path === '/' ? !p.includes('/') : p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
		return {
			path: path === '/' ? '/' : path,
			name: path === '/' ? '' : path.slice(path.lastIndexOf('/') + 1),
			isRoot: () => path === '/',
			children: [...files.keys()].filter(inside).map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })),
		};
	};
	const app = {
		fileManager: {
			getNewFileParent: vi.fn((source: string) => {
				parentCalls.push(source);
				if (options.failParent) throw new Error('no parent');
				return folder(options.parent ?? '/');
			}),
			generateMarkdownLink: vi.fn<(f: TFile, from?: string) => string>((f) => `[[${f.path.replace(/\.md$/, '')}]]`),
		},
		vault: {
			create: vi.fn(async (path: string, data: string) => {
				if (options.failCreate) throw new Error(options.failCreate);
				if ([...files.keys()].some((p) => p.toLowerCase() === path.toLowerCase())) throw new Error('File already exists.');
				files.set(path, data);
				created.push({ path, data });
				return file(path);
			}),
			createFolder: vi.fn(async (path: string) => {
				folders.add(path);
				createdFolders.push(path);
			}),
			getAbstractFileByPath: (path: string) => (files.has(path) ? file(path) : folders.has(path) ? folder(path) : null),
			getFolderByPath: (path: string) => (folders.has(path) ? folder(path) : null),
			getFileByPath: (path: string) => (files.has(path) ? file(path) : null),
			getRoot: () => folder('/'),
			adapter: { exists: async (path: string) => files.has(path) || folders.has(path) },
		},
		metadataCache: { getFirstLinkpathDest: vi.fn(() => null) },
		workspace: {
			getLeaf: vi.fn((how?: unknown) => {
				const leaf = { how, opened: [] as TFile[], openFile: vi.fn(async (f: TFile) => void leaf.opened.push(f)) };
				leaves.push(leaf);
				return leaf;
			}),
			openLinkText: vi.fn(),
		},
	};
	return { app: app as unknown as App, raw: app, files, created, createdFolders, parentCalls, leaves, file };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
	for (let i = 0; i < 8; i++) await tick();
}

const SHEET_BODY = `people:
  - id: aldric
    name: Aldric Valmont
    born: "1200"
`;

/** A handle whose writes and undo act on a real body, so the sheet shows what it would show. */
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
	h.undo.mockImplementation((async () => ({ ok: true, body })) as never);
	return h;
}

/** The real edit sheet of a person, on a fake vault. */
function sheetOn(id: string, options: FakeOptions = {}) {
	const v = fakeApp({ ...options, files: ['Trees/Tree.md', ...(options.files ?? [])], folders: ['Trees', ...(options.folders ?? [])] });
	const handle = writingHandle(SHEET_BODY);
	const sheet = EditSheet.create(v.app as never, { handle: handle as never, personId: id, sourcePath: 'Trees/Tree.md' })!;
	sheet.open();
	const content = (sheet as unknown as { contentEl: FEl }).contentEl;
	return { ...v, handle, sheet, content, button: () => content.querySelector('.dynasty-make-note') };
}

const makeNoteOf = async () => (await loadModule<{ makeNote: typeof makeNote }>('../../src/obsidian/table-note', 'src/obsidian/table-note.ts', 'WP 10.3b', ['makeNote'])).makeNote;
const makeModule = () => loadModule<{ makePersonNote: typeof makePersonNote; openMadeNote: typeof openMadeNote }>('../../src/obsidian/make-note', 'src/obsidian/make-note.ts', 'WP 10.3b', ['makePersonNote', 'openMadeNote']);

// ---------- N5: `makeNote` ----------

describe('N5: `makeNote(app, sourcePath, baseName, content, where)`', () => {
	it('makes the note in the D60 folder of the tree\'s note, with the content given', async () => {
		const makeNote = await makeNoteOf();
		const { app, created, parentCalls } = fakeApp({ parent: 'Notes' });
		const r = await makeNote(app, 'Trees/Valmont family.md', 'Aldric Valmont', 'Tree: [[Valmont family]]\n');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.name).toBe('Aldric Valmont');
		expect(r.file.path).toBe('Notes/Aldric Valmont.md');
		expect(created).toEqual([{ path: 'Notes/Aldric Valmont.md', data: 'Tree: [[Valmont family]]\n' }]);
		expect(parentCalls).toEqual(['Trees/Valmont family.md']);
	});

	it('the vault root folder "/" gives "Name.md", never "/Name.md" or "//Name.md"', async () => {
		const makeNote = await makeNoteOf();
		const { app, created } = fakeApp({ parent: '/' });
		const r = await makeNote(app, 'Valmont family.md', 'Aldric Valmont', 'x');
		expect(r.ok && r.file.path).toBe('Aldric Valmont.md');
		expect(created.map((c) => c.path)).toEqual(['Aldric Valmont.md']);
	});

	it('the first free name: "Name", "Name 1", "Name 2"…, compared without case; a note with that name in another folder does not count', async () => {
		const makeNote = await makeNoteOf();
		const { app } = fakeApp({ parent: 'Notes', files: ['Notes/aldric valmont.md', 'Notes/Aldric Valmont 1.md', 'Other/Aldric Valmont 2.md'] });
		const r = await makeNote(app, 'Trees/t.md', 'Aldric Valmont', 'x');
		expect(r.ok && r.name).toBe('Aldric Valmont 2');
		expect(r.ok && r.file.path).toBe('Notes/Aldric Valmont 2.md');
		const other = fakeApp({ parent: 'Notes', files: ['Other/Aldric Valmont.md'] });
		const r2 = await makeNote(other.app, 'Trees/t.md', 'Aldric Valmont', 'x');
		expect(r2.ok && r2.name).toBe('Aldric Valmont');
	});

	it('where.folder: the given vault folder ("" is the vault root) instead of the D60 folder', async () => {
		const makeNote = await makeNoteOf();
		const a = fakeApp({ parent: 'Notes', folders: ['People/Kings'] });
		const r = await makeNote(a.app, 'Trees/t.md', 'Aldric', 'x', { folder: 'People/Kings' });
		expect(r.ok && r.file.path).toBe('People/Kings/Aldric.md');
		const root = fakeApp({ parent: 'Notes' });
		const r2 = await makeNote(root.app, 'Trees/t.md', 'Aldric', 'x', { folder: '' });
		expect(r2.ok && r2.file.path).toBe('Aldric.md');
	});

	it('where.folder: a folder as typed by a user (backslashes, doubled or end slashes, "/" for the root) is cleaned before it is used (0.4, normalizePath)', async () => {
		const makeNote = await makeNoteOf();
		const a = fakeApp({ parent: 'Notes', folders: ['People/Kings'] });
		const r = await makeNote(a.app, 'Trees/t.md', 'Aldric', 'x', { folder: '/People\\Kings//' });
		expect(r.ok && r.file.path).toBe('People/Kings/Aldric.md');
		expect(a.createdFolders).toEqual([]);
		const fresh = fakeApp({ parent: 'Notes' });
		const r2 = await makeNote(fresh.app, 'Trees/t.md', 'Aldric', 'x', { folder: 'New\\Deep/' });
		expect(r2.ok && r2.file.path).toBe('New/Deep/Aldric.md');
		expect(fresh.createdFolders).toEqual(['New', 'New/Deep']);
		const root = fakeApp({ parent: 'Notes' });
		const r3 = await makeNote(root.app, 'Trees/t.md', 'Aldric', 'x', { folder: '/' });
		expect(r3.ok && r3.file.path).toBe('Aldric.md');
	});

	it('where.exact: exactly this name, no free name looked for (an existing note makes it fail, not a "Name 1")', async () => {
		const makeNote = await makeNoteOf();
		const { app, created } = fakeApp({ parent: 'Notes', files: ['Notes/Aldric.md'] });
		const r = await makeNote(app, 'Trees/t.md', 'Aldric', 'x', { exact: true });
		expect(r).toEqual({ ok: false, why: 'failed' });
		expect(created).toEqual([]);
		const free = fakeApp({ parent: 'Notes' });
		const r2 = await makeNote(free.app, 'Trees/t.md', 'Aldric', 'x', { exact: true });
		expect(r2.ok && r2.file.path).toBe('Notes/Aldric.md');
	});

	it('it never throws: a failing vault write, and a failing folder lookup give { ok: false, why: "failed" }', async () => {
		const makeNote = await makeNoteOf();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const create = fakeApp({ failCreate: 'disk full' });
		expect(await makeNote(create.app, 't.md', 'Aldric', 'x')).toEqual({ ok: false, why: 'failed' });
		const parent = fakeApp({ failParent: true });
		expect(await makeNote(parent.app, 't.md', 'Aldric', 'x')).toEqual({ ok: false, why: 'failed' });
		expect(create.created).toEqual([]);
		expect(parent.created).toEqual([]);
	});

	it('it does not open the note and does not touch the tree (the caller opens it, D87)', async () => {
		const makeNote = await makeNoteOf();
		const { app, raw, leaves } = fakeApp({ parent: 'Notes' });
		await makeNote(app, 't.md', 'Aldric', 'x');
		expect(raw.workspace.getLeaf).not.toHaveBeenCalled();
		expect(raw.workspace.openLinkText).not.toHaveBeenCalled();
		expect(leaves).toEqual([]);
	});
});

// ---------- N2 step 7 and D87: where the made note opens ----------

describe('N2 step 7 (D87): `openMadeNote`', () => {
	it('on the computer: a new tab, so the tree stays open in its tab', async () => {
		const { openMadeNote } = await makeModule();
		device.coarse = false;
		device.width = 1280;
		device.height = 800;
		const a = fakeApp();
		const f = a.file('Notes/Aldric.md');
		await openMadeNote(a.app, f);
		expect(a.raw.workspace.getLeaf).toHaveBeenCalledTimes(1);
		expect(a.leaves[0].how).toBe('tab');
		expect(a.leaves[0].opened).toEqual([f]);
	});

	it('on a phone: the same place (getLeaf(false)), so Back returns to the tree', async () => {
		const { openMadeNote } = await makeModule();
		device.coarse = true;
		device.width = 390;
		device.height = 844;
		const a = fakeApp();
		const f = a.file('Notes/Aldric.md');
		await openMadeNote(a.app, f);
		expect(a.leaves[0].how).toBe(false);
		expect(a.leaves[0].opened).toEqual([f]);
	});

	it('a tablet is not a phone: a new tab', async () => {
		const { openMadeNote } = await makeModule();
		device.coarse = true;
		device.width = 1024;
		device.height = 768;
		const a = fakeApp();
		await openMadeNote(a.app, a.file('Notes/Aldric.md'));
		expect(a.leaves[0].how).toBe('tab');
	});
});

// ---------- N2, N3: the flow ----------

const input = (a: ReturnType<typeof fakeApp>, more: Partial<MakePersonNoteInput> = {}): MakePersonNoteInput => ({
	app: a.app,
	mode: 'new',
	personId: 'aldric',
	name: 'Aldric Valmont',
	link: '',
	sourcePath: 'Trees/Valmont family.md',
	loadedBody: 'people:\n  - id: aldric\n    name: Aldric Valmont\n',
	ready: () => true,
	alive: () => true,
	...more,
});

describe('N2 and N3: `makePersonNote` stops before `vault.create` when the sheet is not ready or not alive', () => {
	for (const mode of ['new', 'linked'] as const) {
		it(`mode ${mode}: \`ready()\` false at the start makes no note`, async () => {
			const { makePersonNote } = await makeModule();
			const a = fakeApp({ parent: 'Notes' });
			const r = await makePersonNote(input(a, { mode, link: mode === 'linked' ? '[[Aldric Valmont]]' : '', ready: () => false }));
			expect(r.kind).toBe('stopped');
			expect(a.created).toEqual([]);
			expect(a.raw.vault.create).not.toHaveBeenCalled();
		});

		it(`mode ${mode}: \`alive()\` false at the start makes no note`, async () => {
			const { makePersonNote } = await makeModule();
			const a = fakeApp({ parent: 'Notes' });
			const r = await makePersonNote(input(a, { mode, link: mode === 'linked' ? '[[Aldric Valmont]]' : '', alive: () => false }));
			expect(r.kind).toBe('stopped');
			expect(a.created).toEqual([]);
		});
	}

	it('the checks run again after each await and before `vault.create`: a sheet that closes during the flow makes no note', async () => {
		const { makePersonNote } = await makeModule();
		const a = fakeApp({ parent: 'Notes' });
		// `alive` is true for the first calls and false later; the flow must ask again before it creates the note.
		let calls = 0;
		const r = await makePersonNote(input(a, { alive: () => ++calls <= 1 }));
		expect(['stopped', 'stale']).toContain(r.kind);
		expect(a.created).toEqual([]);
	});

});

// The flow with the inputs that the sheet gives besides `MakePersonNoteInput`: the handle (N2 step 1), the
// same-name question (step 2) and the write of `link` with the draft (step 5). See `MakePersonNoteExtra`.
type Answer = 'link' | 'new' | 'cancel';
interface Extra {
	handle: { body: string; refresh: () => Promise<void> };
	ask: (name: string, freeName: string) => Promise<Answer>;
	write: (link: string) => Promise<Written | null>;
}
type FlowInput = MakePersonNoteInput & Partial<Extra>;

const WRITTEN = { body: 'written', created: [], effects: [] } as unknown as Written;
const TREE_FILE = 'Trees/Valmont family.md';

type AskFn = (name: string, freeName: string) => Promise<Answer>;
type WriteFn = (link: string) => Promise<Written | null>;

function extras(more: { ask?: AskFn; write?: WriteFn } = {}) {
	const refresh = vi.fn(async () => {});
	const ask = vi.fn<AskFn>(more.ask ?? (async () => 'new'));
	const write = vi.fn<WriteFn>(more.write ?? (async () => WRITTEN));
	const handle = { body: input(fakeApp()).loadedBody, refresh };
	return { handle, refresh, ask, write };
}

const flow = async (a: ReturnType<typeof fakeApp>, e: ReturnType<typeof extras>, more: Partial<FlowInput> = {}) => {
	const { makePersonNote } = await makeModule();
	return makePersonNote({ ...input(a), handle: e.handle, ask: e.ask, write: e.write, ...more } as MakePersonNoteInput);
};

describe('N2 and N3: the rest of the flow (spec §13.11)', () => {
	it('a second tap during the flow does nothing (the busy flag covers the whole flow, from the tap to the call of step 7)', async () => {
		const s = sheetOn('aldric', { parent: 'Notes' });
		const button = s.button()!;
		dispatch(button, 'click');
		dispatch(button, 'click');
		dispatch(button, 'click');
		await settle();
		expect(s.created).toHaveLength(1);
		expect(s.handle.write).toHaveBeenCalledTimes(1);
		expect(s.leaves).toHaveLength(1);
	});

	it('the busy flag is free again after a question that is cancelled', async () => {
		const s = sheetOn('aldric', { parent: 'Notes', files: ['Notes/Aldric Valmont.md'] });
		dispatch(s.button()!, 'click');
		dispatch(s.button()!, 'click');
		await settle();
		const q = (s.sheet as unknown as { modalEl: FEl }).modalEl;
		expect(q.querySelectorAll('.dynasty-sheet-confirm')).toHaveLength(1);
		dispatch(q.querySelector('.dynasty-sheet-keep')!, 'click');
		await settle();
		expect(s.created).toEqual([]);
		dispatch(s.button()!, 'click');
		await settle();
		expect(q.querySelector('.dynasty-sheet-confirm')).not.toBeNull();
	});

	it('the stale check runs first: the handle reads the note again, a changed tree makes no note and gives outcome `stale`', async () => {
		const a = fakeApp({ parent: 'Notes' });
		const e = extras();
		e.refresh.mockImplementation(async () => {
			e.handle.body = 'people:\n  - id: aldric\n    name: Someone else\n';
		});
		const r = await flow(a, e);
		expect(r.kind).toBe('stale');
		expect(e.refresh).toHaveBeenCalledTimes(1);
		expect(a.created).toEqual([]);
		expect(a.parentCalls).toEqual([]);
		expect(e.ask).not.toHaveBeenCalled();
		expect(e.write).not.toHaveBeenCalled();
	});

	it('an unchanged tree passes the stale check (the same text, line ends and shared indent aside)', async () => {
		const a = fakeApp({ parent: 'Notes' });
		const e = extras();
		e.handle.body = input(a).loadedBody.replace(/\n/g, '\r\n');
		const r = await flow(a, e);
		expect(r.kind).toBe('made');
	});

	it('the note holds "Tree: " and the link back made by fileManager.generateMarkdownLink(treeFile, newPath), one line break, no heading (D86)', async () => {
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
		const r = await flow(a, extras());
		expect(r.kind).toBe('made');
		expect(a.created).toEqual([{ path: 'Notes/Aldric Valmont.md', data: 'Tree: [[Trees/Valmont family]]\n' }]);
		const back = a.raw.fileManager.generateMarkdownLink.mock.calls.find((c) => (c[0] as TFile).path === TREE_FILE);
		expect(back).toBeDefined();
		expect(back![1]).toBe('Notes/Aldric Valmont.md');
		expect(a.created[0].data).not.toMatch(/^#/m);
	});

	it('the vault root folder gives "Name.md" and a link back computed for that path', async () => {
		const a = fakeApp({ parent: '/', files: [TREE_FILE] });
		await flow(a, extras());
		expect(a.created.map((c) => c.path)).toEqual(['Aldric Valmont.md']);
		const back = a.raw.fileManager.generateMarkdownLink.mock.calls.find((c) => (c[0] as TFile).path === TREE_FILE);
		expect(back![1]).toBe('Aldric Valmont.md');
	});

	it('the write of `link` is one write with the unsaved draft: `write` is called once with the link of the new note, without a leading "!", and the outcome is `made` with `written`', async () => {
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
		a.raw.fileManager.generateMarkdownLink.mockImplementation((f: TFile) => `${f.path.startsWith('Notes/') ? '!' : ''}[[${f.path.replace(/\.md$/, '')}]]`);
		const e = extras();
		const r = await flow(a, e);
		expect(e.write).toHaveBeenCalledTimes(1);
		expect(e.write).toHaveBeenCalledWith('[[Notes/Aldric Valmont]]');
		expect(a.raw.fileManager.generateMarkdownLink.mock.calls.some((c) => (c[0] as TFile).path === 'Notes/Aldric Valmont.md' && c[1] === 'Trees/Valmont family.md')).toBe(true);
		expect(r).toMatchObject({ kind: 'made', written: WRITTEN });
		if (r.kind === 'made') expect(r.file.path).toBe('Notes/Aldric Valmont.md');
		// The note exists before the link is written.
		expect(a.raw.vault.create.mock.invocationCallOrder[0]).toBeLessThan(e.write.mock.invocationCallOrder[0]);
	});

	it('the draft name and the draft link go into one write through the sheet, and a link typed in the draft is replaced', async () => {
		const s = sheetOn('aldric', { parent: 'Notes' });
		const name = s.content.querySelector('[data-field="name"] input')!;
		(name as unknown as { value: string }).value = 'Aldric: "the Great"';
		dispatch(name, 'input');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.created.map((c) => c.path)).toEqual(['Notes/Aldric the Great.md']);
		expect(s.handle.write).toHaveBeenCalledTimes(1);
		expect(s.handle.body).toContain('name: "Aldric: \\"the Great\\""');
		expect(s.handle.body).toContain('link: "[[Notes/Aldric the Great]]"');
	});

	describe('a note with that path (compared without case) exists', () => {
		const setup = () => fakeApp({ parent: 'Notes', files: ['Notes/aldric valmont.md', TREE_FILE, 'Other/Aldric Valmont 1.md'] });

		it('asks the question with the name and the free name', async () => {
			const a = setup();
			const e = extras({ ask: async () => 'cancel' });
			await flow(a, e);
			expect(e.ask).toHaveBeenCalledTimes(1);
			expect(e.ask).toHaveBeenCalledWith('Aldric Valmont', 'Aldric Valmont 1');
			expect(a.created).toEqual([]);
		});

		it('a note with that name in another folder does not count: no question', async () => {
			const a = fakeApp({ parent: 'Notes', files: ['Other/Aldric Valmont.md', TREE_FILE] });
			const e = extras();
			const r = await flow(a, e);
			expect(e.ask).not.toHaveBeenCalled();
			expect(r.kind).toBe('made');
		});

		it('Link to this note writes `link` for that note only and makes no note', async () => {
			const a = setup();
			const e = extras({ ask: async () => 'link' });
			const r = await flow(a, e);
			expect(a.created).toEqual([]);
			expect(e.write).toHaveBeenCalledTimes(1);
			expect(e.write).toHaveBeenCalledWith('[[Notes/aldric valmont]]');
			expect(r).toMatchObject({ kind: 'linked-existing', written: WRITTEN });
			if (r.kind === 'linked-existing') expect(r.file.path).toBe('Notes/aldric valmont.md');
		});

		it('Make a new note "X 1" makes the note with the free name and links it', async () => {
			const a = setup();
			const e = extras({ ask: async () => 'new' });
			const r = await flow(a, e);
			expect(a.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont 1.md']);
			expect(e.write).toHaveBeenCalledWith('[[Notes/Aldric Valmont 1]]');
			expect(r.kind).toBe('made');
		});

		it('Cancel gives `question-cancelled`: no note, no write', async () => {
			const a = setup();
			const e = extras({ ask: async () => 'cancel' });
			const r = await flow(a, e);
			expect(r.kind).toBe('question-cancelled');
			expect(a.created).toEqual([]);
			expect(e.write).not.toHaveBeenCalled();
		});
	});

	it('a failed `vault.create` gives the outcome `failed`, and no write and no opening follow (the tree does not change)', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE], failCreate: 'disk full' });
		const e = extras();
		const r = await flow(a, e);
		expect(r.kind).toBe('failed');
		expect(e.write).not.toHaveBeenCalled();
		expect(a.leaves).toEqual([]);
	});

	it('a write that fails after `vault.create` gives `link-not-added` (the note stays in the vault)', async () => {
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
		const e = extras({ write: async () => null });
		const r = await flow(a, e);
		expect(r.kind).toBe('link-not-added');
		expect(a.files.has('Notes/Aldric Valmont.md')).toBe(true);
		if (r.kind === 'link-not-added') expect(r.file.path).toBe('Notes/Aldric Valmont.md');
		expect(a.leaves).toEqual([]);
	});

	it('a sheet that closes after the note was made gives `link-not-added`, not a second note', async () => {
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
		let alive = true;
		const e = extras();
		a.raw.vault.create.mockImplementation(async (path: string, data: string) => {
			alive = false;
			a.files.set(path, data);
			a.created.push({ path, data });
			return a.file(path);
		});
		const r = await flow(a, e, { alive: () => alive });
		expect(r.kind).toBe('link-not-added');
		expect(e.write).not.toHaveBeenCalled();
		expect(a.created).toHaveLength(1);
	});

	describe('mode linked (N3)', () => {
		const linked = (link: string) => ({ mode: 'linked' as const, link });

		it('missing folders of the link are made one by one with vault.createFolder, the note is made in the last one, and the outcome is `made-linked`', async () => {
			const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
			const e = extras();
			const r = await flow(a, e, linked('[[People/Kings/Aldric Valmont]]'));
			expect(a.createdFolders).toEqual(['People', 'People/Kings']);
			expect(a.created.map((c) => c.path)).toEqual(['People/Kings/Aldric Valmont.md']);
			expect(a.created[0].data.startsWith('Tree: ')).toBe(true);
			expect(r.kind).toBe('made-linked');
			expect(e.write).not.toHaveBeenCalled();
			expect(a.raw.vault.createFolder.mock.invocationCallOrder[0]).toBeLessThan(a.raw.vault.create.mock.invocationCallOrder[0]);
		});

		it('a folder that exists is not made again', async () => {
			const a = fakeApp({ parent: 'Notes', files: [TREE_FILE], folders: ['People'] });
			await flow(a, extras(), linked('[[People/Kings/Aldric]]'));
			expect(a.createdFolders).toEqual(['People/Kings']);
		});

		it('a link with no folder uses the D60 folder', async () => {
			const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
			await flow(a, extras(), linked('[[Aldric Valmont]]'));
			expect(a.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont.md']);
			expect(a.createdFolders).toEqual([]);
		});

		it('an existing file with that path is not made again, and no tree text is written', async () => {
			const a = fakeApp({ parent: 'Notes', files: [TREE_FILE, 'People/Aldric.md'], folders: ['People'] });
			const e = extras();
			const r = await flow(a, e, linked('[[People/Aldric]]'));
			expect(a.created).toEqual([]);
			expect(a.createdFolders).toEqual([]);
			expect(e.write).not.toHaveBeenCalled();
			expect(r.kind).not.toBe('failed');
		});

		it('the stale check and the alive check apply as in mode new', async () => {
			const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
			const e = extras();
			e.handle.body = 'changed';
			expect((await flow(a, e, linked('[[Aldric]]'))).kind).toBe('stale');
			expect((await flow(a, extras(), { ...linked('[[Aldric]]'), alive: () => false })).kind).toBe('stopped');
			expect(a.created).toEqual([]);
		});
	});
});

describe('N4: undo of the whole write, through the sheet', () => {
	it('the Undo button reverts the write and shows one Notice: the link removed, the note still in the vault; the note stays', async () => {
		const s = sheetOn('aldric', { parent: 'Notes' });
		dispatch(s.button()!, 'click');
		await settle();
		const made = noticeList[noticeList.length - 1];
		expect(made.noticeEl.querySelector('.dynasty-undo-button')).not.toBeNull();
		const before = notices.length;
		dispatch(made.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(s.handle.undo).toHaveBeenCalledTimes(1);
		expect(notices.slice(before)).toEqual([NOTE_UI.undone('Aldric Valmont')]);
		expect(s.files.has('Notes/Aldric Valmont.md')).toBe(true);
	});

	it('the unsaved sheet changes are in the same write, so the success Notice says that Undo also removes them', async () => {
		const s = sheetOn('aldric', { parent: 'Notes' });
		const born = s.content.querySelector('[data-field="born"] input')!;
		(born as unknown as { value: string }).value = '1201';
		dispatch(born, 'input');
		dispatch(s.button()!, 'click');
		await settle();
		expect(s.handle.write).toHaveBeenCalledTimes(1);
		expect(s.handle.body).toContain('1201');
		expect(notices[notices.length - 1]).toBe(`${NOTE_UI.made('Aldric Valmont')} ${REMOVE.undoAlso}`);
	});
});

/* Adopted from the M10 review C (`m10/review-c`, finding 3). Waits for the fix round (C1). */
describe('review C: a linked note path never names "." or ".." (spec §13.11, contract rule 29)', () => {
	it.each(['[[../Outside/Note]]', '[[./Note]]', '[[Sub/../../Note]]'])('mode linked with %s never asks the vault for a "." or ".." folder or note', async (link) => {
		const a = fakeApp({ parent: 'Notes', files: [TREE_FILE] });
		const e = extras();
		await flow(a, e, { mode: 'linked', link });
		const asked = [...a.raw.vault.createFolder.mock.calls, ...a.raw.vault.create.mock.calls].map((c) => String(c[0]));
		expect(asked.filter((p) => /(^|\/)\.\.?(\/|$)/.test(p))).toEqual([]);
	});

	it('`linkedNotePath` drops "." segments and gives null for any ".." (no button, no note)', async () => {
		const { linkedNotePath } = await noteMakeModule();
		expect(linkedNotePath('[[./Note]]')).toEqual({ folder: '', name: 'Note', path: 'Note.md' });
		expect(linkedNotePath('[[People/./Note]]')).toEqual({ folder: 'People', name: 'Note', path: 'People/Note.md' });
		expect(linkedNotePath('[[../Outside/Note]]')).toBeNull();
		expect(linkedNotePath('[[Sub/../../Note]]')).toBeNull();
	});

	it('`makeNote` refuses a folder path with a ".." segment and makes nothing', async () => {
		const makeNote = await makeNoteOf();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const a = fakeApp({ parent: 'Notes' });
		const r = await makeNote(a.app, 'Trees/t.md', 'Note', 'x', { folder: '../Outside' });
		expect(r).toEqual({ ok: false, why: 'failed' });
		expect(a.created).toEqual([]);
		expect(a.createdFolders).toEqual([]);
	});
});
