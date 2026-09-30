import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { App, TFile } from 'obsidian';
import { TFile as VaultFile } from 'obsidian';
import type { MakePersonNoteInput } from '../../src/obsidian/make-note';
import { makePersonNote } from '../../src/obsidian/make-note';
import { linkTarget } from '../../src/render/tree-info';
import { fakeWin, installDom, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';

/*
 * The M10 G5 spec review named "clicking the new note's links" as not covered (spec §13.11, D86, D87). A
 * click needs Obsidian, so this test does the part that can run without it: a fake vault that resolves a
 * link the way Obsidian does (a link with a folder names the path; a link with no folder names the first
 * note of that name; a relative link starts in the folder of the note that holds it) and a fake
 * `generateMarkdownLink` in three link styles. The link that the plugin writes into the tree, and the
 * link back that it writes into the new note, must each resolve to the right note.
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

const TREE = 'Trees/Valmont family.md';
const File = VaultFile as unknown as new (path: string, extension: string) => TFile;
type Style = 'shortest' | 'absolute' | 'relative';

const dirOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const noExt = (path: string) => path.replace(/\.md$/, '');

/** A vault with these notes, and a fake app that writes links in one of the styles of Obsidian's settings. */
function vaultOf(paths: string[], style: Style, parent: string) {
	const files = new Map<string, string>(paths.map((p) => [p, '']));
	const folders = new Set<string>(['/', parent, ...paths.map(dirOf).filter(Boolean)]);
	const fileOf = (path: string): TFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		return Object.assign(new File(path, 'md'), { name, basename: name.replace(/\.md$/, ''), stat: { mtime: 1, ctime: 1, size: 1 } });
	};
	const folderOf = (path: string) => {
		const inside = (p: string) => (path === '/' ? !p.includes('/') : p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
		return { path, name: path.slice(path.lastIndexOf('/') + 1), isRoot: () => path === '/', children: [...files.keys()].filter(inside).map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })) };
	};
	/** How Obsidian resolves the text of a link that is held in the note `from`. */
	const resolve = (target: string, from: string): string | null => {
		const clean = target.replace(/#.*$/, '').replace(/\.md$/, '');
		if (clean.startsWith('./') || clean.startsWith('../')) {
			const parts = dirOf(from).split('/').filter(Boolean);
			for (const seg of clean.split('/')) {
				if (seg === '..') parts.pop();
				else if (seg !== '.') parts.push(seg);
			}
			const path = `${parts.join('/')}.md`;
			return files.has(path) ? path : null;
		}
		if (clean.includes('/')) return files.has(`${clean}.md`) ? `${clean}.md` : null;
		return [...files.keys()].sort().find((p) => baseOf(p) === clean) ?? null;
	};
	const relativeTo = (path: string, from: string): string => {
		const a = dirOf(from).split('/').filter(Boolean);
		const b = noExt(path).split('/');
		let i = 0;
		while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
		return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
	};
	const generate = (f: TFile, from?: string): string => {
		const path = f.path;
		const unique = [...files.keys()].filter((p) => baseOf(p) === baseOf(path)).length === 1;
		if (style === 'absolute') return `[[${noExt(path)}]]`;
		if (style === 'relative') return `[[${relativeTo(path, from ?? '')}]]`;
		return `[[${unique ? baseOf(path) : noExt(path)}]]`;
	};
	const created: { path: string; data: string }[] = [];
	const app = {
		fileManager: { getNewFileParent: () => folderOf(parent), generateMarkdownLink: generate },
		vault: {
			create: async (path: string, data: string) => {
				if ([...files.keys()].some((p) => p.toLowerCase() === path.toLowerCase())) throw new Error('File already exists.');
				files.set(path, data);
				folders.add(dirOf(path));
				created.push({ path, data });
				return fileOf(path);
			},
			createFolder: async (path: string) => void folders.add(path),
			getAbstractFileByPath: (path: string) => (files.has(path) ? fileOf(path) : folders.has(path) ? folderOf(path) : null),
			getFolderByPath: (path: string) => (folders.has(path) ? folderOf(path) : null),
			getFileByPath: (path: string) => (files.has(path) ? fileOf(path) : null),
			getRoot: () => folderOf('/'),
			adapter: { exists: async (path: string) => files.has(path) || folders.has(path) },
		},
		metadataCache: { getFirstLinkpathDest: (target: string, from: string) => resolve(target, from) },
		workspace: { getLeaf: () => ({ openFile: async () => undefined }), openLinkText: async () => undefined },
	};
	return { app: app as unknown as App, created, files, resolve };
}

const input = (app: App, more: Partial<MakePersonNoteInput> = {}): MakePersonNoteInput => ({
	app,
	mode: 'new',
	personId: 'aldric',
	name: 'Aldric Valmont',
	link: '',
	sourcePath: TREE,
	loadedBody: 'people:\n  - id: aldric\n    name: Aldric Valmont\n',
	ready: () => true,
	alive: () => true,
	...more,
});

/** The parts of the flow that the sheet gives (the handle, the question, the write of `link`). */
const run = async (app: App, more: Partial<MakePersonNoteInput> = {}) => {
	let written: string | null = null;
	const extra = {
		handle: { body: input(app).loadedBody, refresh: async () => {} },
		ask: async () => 'new' as const,
		write: async (link: string) => {
			written = link;
			return { body: 'written', created: [], effects: [] };
		},
	};
	const outcome = await makePersonNote({ ...input(app, more), ...extra } as MakePersonNoteInput);
	return { outcome, written: written as string | null };
};

/** The note a link in the tree resolves to (the link is the text in the `link` field of the person). */
const target = (link: string | null) => linkTarget(link === null ? undefined : link.replace(/^!/, ''));

describe('a made note and the links to and from it resolve to the right notes (spec §13.11, D86)', () => {
	for (const style of ['shortest', 'absolute', 'relative'] as const) {
		describe(`link style "${style}"`, () => {
			it('the link in the tree opens the new note and the link back in the new note opens the tree', async () => {
				const v = vaultOf([TREE, 'Notes/Other person.md'], style, 'Notes');
				const { outcome, written } = await run(v.app);
				expect(outcome.kind).toBe('made');
				expect(v.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont.md']);
				// From the tree, the person's link opens the new note.
				expect(v.resolve(target(written)!, TREE)).toBe('Notes/Aldric Valmont.md');
				// From the new note, "Tree: <link>" opens the tree.
				const back = /^Tree: (.+)\n$/.exec(v.created[0].data);
				expect(back).not.toBeNull();
				expect(v.resolve(linkTarget(back![1])!, 'Notes/Aldric Valmont.md')).toBe(TREE);
			});

			it('when another folder holds a note of the same name, both links still open the right notes', async () => {
				const v = vaultOf([TREE, 'Old/Aldric Valmont.md', 'Old/Valmont family.md'], style, 'Notes');
				const { written } = await run(v.app);
				expect(v.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont.md']);
				expect(v.resolve(target(written)!, TREE)).toBe('Notes/Aldric Valmont.md');
				const back = /^Tree: (.+)\n$/.exec(v.created[0].data)!;
				// A tree note with the same name as another note: the link back names the tree, not the note in "Old".
				expect(v.resolve(linkTarget(back[1])!, 'Notes/Aldric Valmont.md')).toBe(TREE);
			});

			it('a taken name gives the next free name, and the link opens that note', async () => {
				const v = vaultOf([TREE, 'Notes/Aldric Valmont.md'], style, 'Notes');
				const { written } = await run(v.app);
				expect(v.created.map((c) => c.path)).toEqual(['Notes/Aldric Valmont 1.md']);
				expect(v.resolve(target(written)!, TREE)).toBe('Notes/Aldric Valmont 1.md');
			});

			it('the vault root: the new note is at the root, and both links resolve', async () => {
				const v = vaultOf([TREE], style, '/');
				const { written } = await run(v.app);
				expect(v.created.map((c) => c.path)).toEqual(['Aldric Valmont.md']);
				expect(v.resolve(target(written)!, TREE)).toBe('Aldric Valmont.md');
				const back = /^Tree: (.+)\n$/.exec(v.created[0].data)!;
				expect(v.resolve(linkTarget(back[1])!, 'Aldric Valmont.md')).toBe(TREE);
			});

			it('mode linked: the note is made at the path of the link that the person has, and the link back opens the tree', async () => {
				const v = vaultOf([TREE], style, 'Notes');
				const link = '[[People/Kings/Aldric Valmont]]';
				const { outcome, written } = await run(v.app, { mode: 'linked', link });
				expect(outcome.kind).toBe('made-linked');
				expect(written).toBeNull();
				expect(v.created.map((c) => c.path)).toEqual(['People/Kings/Aldric Valmont.md']);
				// The link of the person is not changed, and it opens the note that was made.
				expect(v.resolve(linkTarget(link)!, TREE)).toBe('People/Kings/Aldric Valmont.md');
				const back = /^Tree: (.+)\n$/.exec(v.created[0].data)!;
				expect(v.resolve(linkTarget(back[1])!, 'People/Kings/Aldric Valmont.md')).toBe(TREE);
			});
		});
	}
});
