import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { makePersonNote, type MakePersonNoteInput, type SameNameAnswer } from '../src/obsidian/make-note';
import { pickPicture } from '../src/obsidian/picture-picker';
import { savePicture, type SaveSource } from '../src/obsidian/save-picture';
import { makeNote, makeTableNote } from '../src/obsidian/table-note';
import { NOTE_UI } from '../src/render/ui-text';
import { FEl, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { pngHead } from './acceptance/m9-support';
import { pick, rng } from './r028-advb-gen';

/*
 * 0.3 package D, W6 (the 0.3 contract D.3; the release plan worst case W6): every file the plugin creates gets a free name and
 * never overwrites a file of the user.
 *
 * Spec §13.8 (saved picture: "If the name exists, Obsidian's free-path helper adds ' 1', ' 2', ..."), §13.0 item 3 and
 * D69 (a picture copied from the device goes to the attachment folder), §13.11 (a new linked note: the decided flow
 * on a name clash, the three choices), §13.4 and §13.12 (a table note: the next free name, "Dukes of Valmont 1").
 *
 * The fake vault follows Obsidian: `getAvailablePathForAttachment` gives the first free path ("name 1.ext", "name 2.ext"),
 * `create` and `createBinary` throw "File already exists." for a path that exists (also in another case, as on Windows
 * and macOS), and `getAbstractFileByPath` is exact. Each test checks four things: the new file has a path that no file
 * had, no file that was there changed, exactly one file was made, and the answer of the flow is right.
 * Seeded; R028_DEEP=1 makes more rounds.
 */

const DEEP = process.env.R028_DEEP === '1';
const ROUNDS = DEEP ? 400 : 60;

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
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function tfile(path: string): VaultFile {
	const name = nameOf(path);
	const dot = name.lastIndexOf('.');
	return Object.assign(new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase()), { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1 } });
}

// ---------------------------------------------------------------------------------------------------------
// A fake vault with Obsidian's rules for new files

interface Vault {
	/** Path to content (text or bytes), exactly as the vault holds it. */
	files: Map<string, string | Uint8Array>;
	folders: Set<string>;
	created: string[];
	/** Attachments go here; '' is the vault root, '@' means the folder of the note. */
	attachments: string;
	/** `create` and `createBinary` treat paths without case, as on Windows and macOS. */
	insensitive: boolean;
	/** A path that appears in the vault just before `create`, for a race. */
	race: string | null;
	app: ReturnType<typeof makeApp>;
}

const lower = (s: string) => s.toLowerCase();

function makeApp(v: Omit<Vault, 'app'>, newFileFolder: string, helper: boolean) {
	const has = (path: string) => [...v.files.keys()].some((p) => (v.insensitive ? lower(p) === lower(path) : p === path)) || v.folders.has(path);
	const folderObj = (path: string) => {
		const root = path === '/';
		const inside = (p: string) => (root ? !p.includes('/') : p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
		// `children` is live, as in Obsidian: a file made later shows in it.
		return { path: root ? '/' : path, name: root ? '' : nameOf(path), isRoot: () => root, get children() { return [...v.files.keys()].filter(inside).map((p) => ({ name: nameOf(p), path: p })); } };
	};
	const add = (path: string, data: string | Uint8Array) => {
		if (v.race) {
			v.files.set(v.race, 'someone else');
			v.race = null;
		}
		if (has(path)) throw new Error('File already exists.');
		v.files.set(path, data);
		v.created.push(path);
		return tfile(path);
	};
	const fileManager: Record<string, unknown> = {
		getNewFileParent: () => folderObj(newFileFolder === '' ? '/' : newFileFolder),
		generateMarkdownLink: (f: VaultFile) => `[[${f.path.replace(/\.md$/, '')}]]`,
	};
	if (helper) {
		// Obsidian's helper: the attachment folder, the first free name with " 1", " 2", ….
		fileManager.getAvailablePathForAttachment = async (name: string, source?: string) => {
			const dir = v.attachments === '@' ? folderOf(source ?? '') : v.attachments;
			const dot = name.lastIndexOf('.');
			const stem = dot > 0 ? name.slice(0, dot) : name;
			const ext = dot > 0 ? name.slice(dot) : '';
			const at = (n: string) => (dir ? `${dir}/${n}` : n);
			let path = at(name);
			for (let i = 1; has(path); i++) path = at(`${stem} ${i}${ext}`);
			return path;
		};
	}
	return {
		fileManager,
		vault: {
			create: async (path: string, content: string) => add(path, content),
			createBinary: async (path: string, data: ArrayBuffer) => add(path, new Uint8Array(data.slice(0))),
			createFolder: async (path: string) => void v.folders.add(path),
			getAbstractFileByPath: (path: string) => (v.files.has(path) ? tfile(path) : v.folders.has(path) ? folderObj(path) : null),
			getFolderByPath: (path: string) => (v.folders.has(path) ? folderObj(path) : null),
			getFileByPath: (path: string) => (v.files.has(path) ? tfile(path) : null),
			getRoot: () => folderObj('/'),
			getFiles: () => [...v.files.keys()].map(tfile),
			adapter: { exists: async (path: string) => has(path) },
		},
		metadataCache: { getFirstLinkpathDest: () => null },
		workspace: { getLeaf: () => ({ openFile: async () => {} }) },
		loadLocalStorage: () => null,
		saveLocalStorage: () => {},
	};
}

function makeVault(o: { files?: Record<string, string | Uint8Array>; folders?: string[]; attachments?: string; insensitive?: boolean; newFileFolder?: string; helper?: boolean } = {}): Vault {
	const base = {
		files: new Map(Object.entries(o.files ?? {})),
		folders: new Set(['/', ...(o.folders ?? [])]),
		created: [] as string[],
		attachments: o.attachments ?? 'Attachments',
		insensitive: o.insensitive ?? true,
		race: null as string | null,
	};
	const v = base as unknown as Vault;
	v.app = makeApp(base as never, o.newFileFolder ?? '', o.helper ?? true);
	return v;
}

/** What the vault held before, as text, to compare after. */
const snapshot = (v: Vault) => new Map([...v.files].map(([p, d]) => [p, typeof d === 'string' ? d : Array.from(d).join(',')] as const));
const same = (v: Vault, before: Map<string, string>) => {
	const now = snapshot(v);
	for (const [p, d] of before) if (now.get(p) !== d) return `${p} changed or is gone`;
	return null;
};

// ---------------------------------------------------------------------------------------------------------
// The saved picture (spec §13.8)

const TREE = `people:
  - id: a
    name: Aldric Valmont
  - id: b
    name: Berta Valmont
    parents: [a]
`;

function saveSource(): SaveSource {
	const parsed = parseDynasty(TREE);
	if (!parsed.ok) throw new Error('the sample tree does not parse');
	return {
		g: deriveFamilies(parsed.tree),
		orientation: 'down',
		geo: cardForm(geometryFor(16), 'down'),
		relationLine: false,
		fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
		showDates: true,
		showPortraits: true,
		sourcePath: 'Trees/Valmont.md',
		note: 'Valmont',
	};
}

describe('W6 a saved picture gets a free name and never overwrites (spec §13.8)', () => {
	const NAME = 'Valmont tree.svg';

	it('the name is free: the picture is made in the attachment folder with that name, once', async () => {
		const v = makeVault({ files: { 'Trees/Valmont.md': 'x' } });
		const f = await savePicture(v.app as never, undefined, saveSource(), 'svg');
		expect(f?.path).toBe(`Attachments/${NAME}`);
		expect(v.created).toEqual([`Attachments/${NAME}`]);
	});

	it('the name exists: " 1", " 2", … and the file that was there keeps its bytes', async () => {
		const v = makeVault({ files: { [`Attachments/${NAME}`]: 'mine 0', 'Attachments/Valmont tree 1.svg': 'mine 1', 'Trees/Valmont.md': 'x' } });
		const before = snapshot(v);
		const f = await savePicture(v.app as never, undefined, saveSource(), 'svg');
		expect(f?.path).toBe('Attachments/Valmont tree 2.svg');
		expect(same(v, before)).toBeNull();
		expect(v.created).toEqual(['Attachments/Valmont tree 2.svg']);
	});

	it(`${ROUNDS} random vaults: save 1 to 3 times; every file is new, the user's files are the same, the answer is the file made`, async () => {
		const rand = rng(61);
		for (let round = 0; round < ROUNDS; round++) {
			const dir = pick(rand, ['Attachments', '', '@', 'Media/Pics']);
			const files: Record<string, string> = { 'Trees/Valmont.md': 'tree' };
			const where = dir === '@' ? 'Trees' : dir;
			const at = (n: string) => (where ? `${where}/${n}` : n);
			// The user's files: the name, some numbers, the name in another folder, a similar name.
			if (rand() < 0.6) files[at(NAME)] = 'user 0';
			for (let i = 1; i <= 4; i++) if (rand() < 0.35) files[at(`Valmont tree ${i}.svg`)] = `user ${i}`;
			if (rand() < 0.3) files[`Other/${NAME}`] = 'other folder';
			if (rand() < 0.3) files[at('Valmont tree.png')] = 'png';
			const v = makeVault({ files, attachments: dir, folders: ['Trees', 'Attachments', 'Media/Pics'] });
			const before = snapshot(v);
			const times = 1 + Math.floor(rand() * 3);
			const made: string[] = [];
			for (let t = 0; t < times; t++) {
				resetObsidian();
				const f = await savePicture(v.app as never, undefined, saveSource(), 'svg');
				const msg = `round ${round}, save ${t + 1}, folder "${dir}", before: ${[...before.keys()].join(' | ')}`;
				expect(f, msg).not.toBeNull();
				expect(before.has(f!.path), `${msg}: the picture got the path of a file that was there: ${f!.path}`).toBe(false);
				expect(made.includes(f!.path), `${msg}: two saves got ${f!.path}`).toBe(false);
				made.push(f!.path);
			}
			expect(same(v, before), `round ${round}`).toBeNull();
			expect(v.created, `round ${round}`).toEqual(made);
		}
	});

	it('Obsidian before 1.5.7 has no free-path helper: the plugin numbers the name in the folder of the note, and takes no path that exists', async () => {
		const v = makeVault({ files: { 'Trees/Valmont tree.svg': 'user', 'Trees/Valmont tree 1.svg': 'user 1', 'Trees/Valmont.md': 'x' }, helper: false });
		const before = snapshot(v);
		const f = await savePicture(v.app as never, undefined, saveSource(), 'svg');
		expect(f?.path).toBe('Trees/Valmont tree 2.svg');
		expect(same(v, before)).toBeNull();
	});

	// The vault of Windows and macOS sees "valmont tree.svg" and "Valmont tree.svg" as one name. The helper of Obsidian knows;
	// the plugin's own numbering looks up the exact path, finds none, and the write is refused by the vault: no file is
	// overwritten, but the owner gets "cannot save" while a free name exists (the plugin supports Obsidian 1.5.0 and later).
	it.fails('F6 before 1.5.7 on a vault that ignores case: a file "valmont tree.svg" makes the save fail instead of giving "Valmont tree 1.svg"', async () => {
		const v = makeVault({ files: { 'Trees/valmont tree.svg': 'user', 'Trees/Valmont.md': 'x' }, helper: false, insensitive: true });
		const before = snapshot(v);
		const f = await savePicture(v.app as never, undefined, saveSource(), 'svg');
		expect(same(v, before)).toBeNull();
		expect(f, 'the picture was not saved').not.toBeNull();
		expect(f!.path.toLowerCase()).not.toBe('trees/valmont tree.svg');
	});
});

// ---------------------------------------------------------------------------------------------------------
// A picture copied from the device (spec D69, §13.0 item 3)

describe('W6 a picture copied from the device gets a free name and never overwrites (D69)', () => {
	type Picker = { contentEl: FEl; close(): void; fromDevice(f: unknown): Promise<void> };
	const open = (v: Vault) => {
		const got = pickPicture(v.app as never, { sourcePath: 'Trees/Valmont.md', title: 'Select' });
		return { got, picker: openModals[openModals.length - 1] as unknown as Picker };
	};
	const copy = async (v: Vault, name: string, fill: number) => {
		const png = pngHead(400, 600);
		const bytes = new Uint8Array(png);
		bytes[bytes.length - 1] = fill;
		const { got, picker } = open(v);
		await picker.fromDevice({ name, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) });
		const r = await got;
		return { r, bytes };
	};

	it('the same device file twice: two files, the first is not overwritten', async () => {
		const v = makeVault({ files: { 'Trees/Valmont.md': 'x' } });
		const a = await copy(v, 'me.png', 1);
		const b = await copy(v, 'me.png', 2);
		expect(a.r.kind).toBe('choose');
		expect(b.r.kind).toBe('choose');
		expect(v.created).toEqual(['Attachments/me.png', 'Attachments/me 1.png']);
		expect(Array.from(v.files.get('Attachments/me.png') as Uint8Array).pop()).toBe(1);
		expect(Array.from(v.files.get('Attachments/me 1.png') as Uint8Array).pop()).toBe(2);
	});

	it(`${ROUNDS} random vaults: the copy gets a path that no file had; the files that were there are the same`, async () => {
		const rand = rng(62);
		for (let round = 0; round < ROUNDS; round++) {
			const dir = pick(rand, ['Attachments', '', '@']);
			const where = dir === '@' ? 'Trees' : dir;
			const at = (n: string) => (where ? `${where}/${n}` : n);
			const files: Record<string, string> = { 'Trees/Valmont.md': 'x' };
			for (const n of ['IMG_0001.png', 'IMG_0001 1.png', 'IMG_0001 2.png', 'img_0001.png']) if (rand() < 0.4) files[at(n)] = `user ${n}`;
			const v = makeVault({ files, attachments: dir });
			const before = snapshot(v);
			const name = pick(rand, ['IMG_0001.png', 'IMG_0001.png', 'img_0001.png', 'IMG_0002.png']);
			const { r } = await copy(v, name, 7);
			const msg = `round ${round}, folder "${dir}", name ${name}, before: ${[...before.keys()].join(' | ')}`;
			expect(r.kind, msg).toBe('choose');
			expect(v.created.length, msg).toBe(1);
			expect(before.has(v.created[0]), `${msg}: the copy took the path of a file that was there: ${v.created[0]}`).toBe(false);
			expect(same(v, before), msg).toBeNull();
		}
	});

	it('Obsidian before 1.5.7 has no helper: the copy goes next to the note with a free number', async () => {
		const v = makeVault({ files: { 'Trees/Valmont.md': 'x', 'Trees/me.png': 'user', 'Trees/me 1.png': 'user 1' }, helper: false });
		const before = snapshot(v);
		const { r } = await copy(v, 'me.png', 3);
		expect(r.kind).toBe('choose');
		expect(v.created).toEqual(['Trees/me 2.png']);
		expect(same(v, before)).toBeNull();
	});

	it.fails('F6b before 1.5.7 on a vault that ignores case: a file "ME.png" makes the copy fail instead of giving "me 1.png"', async () => {
		const v = makeVault({ files: { 'Trees/Valmont.md': 'x', 'Trees/ME.png': 'user' }, helper: false, insensitive: true });
		const before = snapshot(v);
		const { r } = await copy(v, 'me.png', 3);
		expect(same(v, before)).toBeNull();
		expect(r.kind, 'the picture was not copied').toBe('choose');
	});
});

// ---------------------------------------------------------------------------------------------------------
// A new linked note (spec §13.11)

const input = (v: Vault, more: Partial<MakePersonNoteInput> = {}): MakePersonNoteInput => ({
	app: v.app as never,
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

interface Flow {
	asked: [string, string][];
	written: string[];
}

function flow(answer: SameNameAnswer) {
	const log: Flow = { asked: [], written: [] };
	return {
		log,
		extra: {
			handle: { body: 'people:\n  - id: aldric\n    name: Aldric Valmont\n', refresh: async () => {} },
			ask: async (name: string, free: string) => {
				log.asked.push([name, free]);
				return answer;
			},
			write: async (link: string) => {
				log.written.push(link);
				return { ok: true, body: 'written', created: [], effects: [] } as never;
			},
		},
	};
}

describe('W6 a new linked note (spec §13.11, D86)', () => {
	const make = (v: Vault, answer: SameNameAnswer, more: Partial<MakePersonNoteInput> = {}) => {
		const f = flow(answer);
		return makePersonNote({ ...input(v, more), ...f.extra } as never).then((out) => ({ out, ...f }));
	};
	const treeNote = { 'Trees/Valmont family.md': 'tree' };

	it('no note with the name: the note is made in the folder for new notes, with the link back, and no question is asked', async () => {
		const v = makeVault({ files: treeNote, newFileFolder: 'Notes', folders: ['Notes'] });
		const r = await make(v, 'cancel');
		expect(r.out.kind).toBe('made');
		expect(v.created).toEqual(['Notes/Aldric Valmont.md']);
		expect(v.files.get('Notes/Aldric Valmont.md')).toBe('Tree: [[Trees/Valmont family]]\n');
		expect(r.log.asked).toEqual([]);
		expect(r.log.written).toEqual(['[[Notes/Aldric Valmont]]']);
	});

	it('a note with the name is in another folder: it does not count (spec §13.11)', async () => {
		const v = makeVault({ files: { ...treeNote, 'Other/Aldric Valmont.md': 'other' }, newFileFolder: 'Notes', folders: ['Notes', 'Other'] });
		const r = await make(v, 'cancel');
		expect(r.out.kind).toBe('made');
		expect(r.log.asked).toEqual([]);
		expect(v.files.get('Other/Aldric Valmont.md')).toBe('other');
	});

	it('the question names the note and the free name: "Aldric Valmont" and "Aldric Valmont 1"', async () => {
		const v = makeVault({ files: { ...treeNote, 'Notes/Aldric Valmont.md': 'mine' }, newFileFolder: 'Notes', folders: ['Notes'] });
		const r = await make(v, 'cancel');
		expect(r.log.asked).toEqual([['Aldric Valmont', 'Aldric Valmont 1']]);
	});

	it('answer "Link to this note": no note is made, the existing note is not changed, the link names the existing note', async () => {
		const v = makeVault({ files: { ...treeNote, 'Notes/Aldric Valmont.md': 'mine' }, newFileFolder: 'Notes', folders: ['Notes'] });
		const r = await make(v, 'link');
		expect(r.out.kind).toBe('linked-existing');
		expect(v.created).toEqual([]);
		expect(v.files.get('Notes/Aldric Valmont.md')).toBe('mine');
		expect(r.log.written).toEqual(['[[Notes/Aldric Valmont]]']);
	});

	it('answer "Make a new note Aldric Valmont 1": the note gets the free name, the existing note is not changed, the link names the new note', async () => {
		const v = makeVault({ files: { ...treeNote, 'Notes/Aldric Valmont.md': 'mine' }, newFileFolder: 'Notes', folders: ['Notes'] });
		const r = await make(v, 'new');
		expect(r.out.kind).toBe('made');
		expect(v.created).toEqual(['Notes/Aldric Valmont 1.md']);
		expect(v.files.get('Notes/Aldric Valmont.md')).toBe('mine');
		expect(r.log.written).toEqual(['[[Notes/Aldric Valmont 1]]']);
	});

	it('answer "Cancel": nothing is made, nothing is written to the tree', async () => {
		const v = makeVault({ files: { ...treeNote, 'Notes/Aldric Valmont.md': 'mine' }, newFileFolder: 'Notes', folders: ['Notes'] });
		const before = snapshot(v);
		const r = await make(v, 'cancel');
		expect(r.out.kind).toBe('question-cancelled');
		expect(v.created).toEqual([]);
		expect(r.log.written).toEqual([]);
		expect(same(v, before)).toBeNull();
	});

	it(`${ROUNDS} random clashes, each answer: the free name is the first number that no note has (also in another case); nothing that was there changes`, async () => {
		const rand = rng(63);
		for (const answer of ['new', 'link', 'cancel'] as const) {
			for (let round = 0; round < ROUNDS; round++) {
				const folder = pick(rand, ['Notes', '', 'People/Kings']);
				const at = (n: string) => (folder ? `${folder}/${n}` : n);
				const name = pick(rand, ['Aldric Valmont', 'Ælfric of Éu', 'Dr. Who', 'Smith, John']);
				const files: Record<string, string> = { ...treeNote };
				const taken: number[] = [];
				// The base name (any case) and a run of numbers with gaps.
				if (rand() < 0.85) files[at(`${rand() < 0.3 ? name.toLowerCase() : name}.md`)] = 'user base';
				for (let i = 1; i <= 5; i++) if (rand() < 0.45) {
					files[at(`${rand() < 0.2 ? name.toUpperCase() : name} ${i}.md`)] = `user ${i}`;
					taken.push(i);
				}
				if (rand() < 0.3) files[`Elsewhere/${name}.md`] = 'elsewhere';
				if (rand() < 0.3) files[at(`${name}.txt`)] = 'not a note';
				const v = makeVault({ files, newFileFolder: folder, folders: [folder, 'Elsewhere', 'Notes'].filter(Boolean) });
				const before = snapshot(v);
				const clash = [...before.keys()].some((p) => p.startsWith(at('')) && lower(p) === lower(at(`${name}.md`)));
				const r = await make(v, answer, { name });
				const msg = `round ${round}, answer ${answer}, folder "${folder}", name ${name}, before: ${[...before.keys()].join(' | ')}`;
				expect(same(v, before), msg).toBeNull();
				if (!clash) {
					expect(r.log.asked, msg).toEqual([]);
					expect(v.created, msg).toEqual([at(`${name}.md`)]);
					continue;
				}
				// The first number n >= 1 such that no note "name n" is there (compared without case).
				let n = 1;
				while ([...before.keys()].some((p) => lower(p) === lower(at(`${name} ${n}.md`)))) n++;
				expect(r.log.asked, msg).toEqual([[name, `${name} ${n}`]]);
				if (answer === 'new') expect(v.created, msg).toEqual([at(`${name} ${n}.md`)]);
				else expect(v.created, msg).toEqual([]);
				expect(r.log.written.length, msg).toBe(answer === 'cancel' ? 0 : 1);
			}
		}
	});

	it('another writer takes the name between the look and the write: the flow ends, nothing is overwritten', async () => {
		const v = makeVault({ files: treeNote, newFileFolder: 'Notes', folders: ['Notes'] });
		v.race = 'Notes/Aldric Valmont.md';
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await make(v, 'cancel');
		expect(r.out.kind).toBe('failed');
		expect(v.files.get('Notes/Aldric Valmont.md')).toBe('someone else');
		expect(v.created).toEqual([]);
		expect(r.log.written).toEqual([]);
	});

	it('"Make the linked note" for a link to a note that is not there makes exactly that note; if the note is there, none is made and none is overwritten', async () => {
		const a = makeVault({ files: treeNote, newFileFolder: 'Notes', folders: ['Notes'] });
		const made = await make(a, 'cancel', { mode: 'linked', link: '[[People/Kings/Aldric]]' });
		expect(made.out.kind).toBe('made-linked');
		expect(a.created).toEqual(['People/Kings/Aldric.md']);
		const b = makeVault({ files: { ...treeNote, 'People/Kings/Aldric.md': 'mine' }, newFileFolder: 'Notes', folders: ['Notes', 'People/Kings'] });
		const there = await make(b, 'cancel', { mode: 'linked', link: '[[People/Kings/Aldric]]' });
		expect(there.out.kind).toBe('linked-existing');
		expect(b.created).toEqual([]);
		expect(b.files.get('People/Kings/Aldric.md')).toBe('mine');
	});

	it('the texts of the question are the words of the spec', () => {
		expect(NOTE_UI.askLink).toBe('Link to this note');
		expect(NOTE_UI.askNew('Aldric Valmont 1')).toMatch(/^Make a new note .Aldric Valmont 1.$/);
		expect(NOTE_UI.askTitle('Aldric Valmont')).toMatch(/^The vault has a note with the name .Aldric Valmont.\.$/);
	});
});

// ---------------------------------------------------------------------------------------------------------
// The table note (spec §13.4, §13.12) and `makeNote`

describe('W6 a table note and makeNote get the next free name (spec §13.4, §13.12)', () => {
	const BODY = `people:
  - id: a
    name: Aldric
titles:
  - id: duke
    name: Duke of Valmont
    plural: Dukes of Valmont
    holders:
      - person: a
        from: 1100
`;

	it('the name exists: "Dukes of Valmont 1", then "… 2"; the notes that were there are the same', async () => {
		const v = makeVault({ files: { 'Dukes of Valmont.md': 'mine', 'Trees/Valmont.md': 'x' }, newFileFolder: '' });
		const before = snapshot(v);
		const a = await makeTableNote(v.app as never, BODY, 'duke', 'Trees/Valmont.md');
		const b = await makeTableNote(v.app as never, BODY, 'duke', 'Trees/Valmont.md');
		expect(a).toMatchObject({ ok: true, name: 'Dukes of Valmont 1' });
		expect(b).toMatchObject({ ok: true, name: 'Dukes of Valmont 2' });
		expect(same(v, before)).toBeNull();
	});

	it(`${ROUNDS} random folders: makeNote makes one note with a path that no note had, whatever the case of the notes that are there`, async () => {
		const rand = rng(64);
		for (let round = 0; round < ROUNDS; round++) {
			const folder = pick(rand, ['', 'Notes', 'A/B']);
			const at = (n: string) => (folder ? `${folder}/${n}` : n);
			const files: Record<string, string> = {};
			const base = pick(rand, ['House Valmont, people', 'Table', 'Éowyn']);
			if (rand() < 0.8) files[at(`${rand() < 0.3 ? base.toUpperCase() : base}.md`)] = 'user';
			for (let i = 1; i <= 4; i++) if (rand() < 0.4) files[at(`${base} ${i}.md`)] = `user ${i}`;
			const v = makeVault({ files, newFileFolder: folder, folders: [folder].filter(Boolean) });
			const before = snapshot(v);
			const r = await makeNote(v.app as never, 'Trees/x.md', base, 'content');
			const msg = `round ${round}, folder "${folder}", before: ${[...before.keys()].join(' | ')}`;
			expect(r.ok, msg).toBe(true);
			expect(v.created.length, msg).toBe(1);
			expect([...before.keys()].some((p) => lower(p) === lower(v.created[0])), `${msg}: took ${v.created[0]}`).toBe(false);
			expect(same(v, before), msg).toBeNull();
			// It is the first free name.
			let n = 0;
			while ([...before.keys()].some((p) => lower(p) === lower(at(n === 0 ? `${base}.md` : `${base} ${n}.md`)))) n++;
			expect(v.created[0], msg).toBe(at(n === 0 ? `${base}.md` : `${base} ${n}.md`));
		}
	});

	it('another writer takes the name between the look and the write: the next name is tried, nothing is overwritten', async () => {
		const v = makeVault({ files: {}, newFileFolder: '' });
		v.race = 'Table.md';
		const r = await makeNote(v.app as never, 'x.md', 'Table', 'content');
		expect(r).toMatchObject({ ok: true, name: 'Table 1' });
		expect(v.files.get('Table.md')).toBe('someone else');
	});

	it('an exact name that exists is not made again and nothing is written', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const v = makeVault({ files: { 'Table.md': 'mine' }, newFileFolder: '' });
		const r = await makeNote(v.app as never, 'x.md', 'Table', 'content', { exact: true });
		expect(r.ok).toBe(false);
		expect(v.created).toEqual([]);
		expect(v.files.get('Table.md')).toBe('mine');
	});
});
