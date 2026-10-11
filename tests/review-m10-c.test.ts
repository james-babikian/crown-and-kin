import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { HousesWindow } from '../src/obsidian/houses-window';
import { makePersonNote } from '../src/obsidian/make-note';
import { fakeHandle } from './acceptance/tree-view-fakes';
import { openCropTool } from '../src/obsidian/crop-tool';
import { FEl, dispatch, fakeWin, installDom, resetDom, fakeDoc } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';

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

function fakeApp(existing: string[] = []) {
	const files = new Map<string, string>([['Trees/Tree.md', ''], ...existing.map((p): [string, string] => [p, ''])]);
	const folders = new Set<string>(['/', 'Trees']);
	const calls: string[] = [];
	const file = (path: string): VaultFile => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		const dot = name.lastIndexOf('.');
		return Object.assign(new File(path, name.slice(dot + 1)), { name, basename: name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1 } }) as VaultFile;
	};
	const folder = (path: string) => ({
		path,
		name: path,
		isRoot: () => path === '/',
		children: [...files.keys()].filter((p) => (path === '/' ? !p.includes('/') : p.startsWith(`${path}/`))).map((p) => ({ name: p.slice(p.lastIndexOf('/') + 1), path: p })),
	});
	const app = {
		fileManager: { getNewFileParent: () => folder('/'), generateMarkdownLink: (f: VaultFile) => `[[${f.path.replace(/\.md$/, '')}]]` },
		vault: {
			create: vi.fn(async (path: string, data: string) => {
				calls.push(`create ${path}`);
				files.set(path, data);
				return file(path);
			}),
			createFolder: vi.fn(async (path: string) => {
				calls.push(`createFolder ${path}`);
				folders.add(path);
			}),
			getAbstractFileByPath: (path: string) => (files.has(path) ? file(path) : folders.has(path) ? folder(path) : null),
			getRoot: () => folder('/'),
		},
	};
	return { app, calls };
}

const base = { personId: 'a', name: 'Aldric', sourcePath: 'Trees/Tree.md', loadedBody: '', ready: () => true, alive: () => true };

describe('make the linked note', () => {
	it.each(['[[../Outside/Note]]', '[[./Note]]', '[[Sub/../../Note]]'])('a link with a dot segment (%s) never asks the vault for a "." or ".." folder', async (link) => {
		const { app, calls } = fakeApp();
		await makePersonNote({ ...base, app: app as never, mode: 'linked', link });
		expect(calls.filter((c) => /(^|[ /])\.\.?(\/|$)/.test(c))).toEqual([]);
	});
});

describe('crop tool', () => {
	it('puts the keyboard focus on the picture area when it opens, so the arrow keys work at once (spec 13.13)', async () => {
		const store = { transient: async () => null } as never;
		void openCropTool({ app: {} as never, file: new File('a.png', 'png') as never, store, personName: 'A', start: null });
		await tick();
		const modal = openModals[openModals.length - 1] as unknown as { contentEl: { querySelector(s: string): unknown } };
		expect(fakeDoc.activeElement).toBe(modal.contentEl.querySelector('.dynasty-crop-area'));
	});
});

describe('People in the Houses window', () => {
	const BODY = `houses:
  - id: valmont
    name: House Valmont
people:
  - id: aldric
    name: Aldric Valmont
    house: valmont
`;
	it('a tap on a name still shows the card when the edit page of a house is open in the Houses window', () => {
		const { app } = fakeApp();
		const shown: string[] = [];
		const win = HousesWindow.create(app as never, { handle: fakeHandle('Trees/Tree.md', BODY) as never, sourcePath: 'Trees/Tree.md', people: { show: (id) => shown.push(id), openNote: () => undefined } })!;
		win.open();
		const content = (win as unknown as { contentEl: FEl }).contentEl;
		// 0.2.5 (D134): People is on the edit page of the house.
		dispatch(content.querySelectorAll('button.dynasty-lw-row')[0], 'click');
		// 0.2.8 (D202): the people are a section of the page; a tap on a name closes the window and shows the card.
		dispatch(content.querySelectorAll('.dynasty-lw-page .dynasty-hp-row')[0], 'click');
		expect(shown).toEqual(['aldric']);
	});
});
