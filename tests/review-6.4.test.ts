import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { TFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { LinkUpdater } from '../src/obsidian/rename-links';
import { undoNotice } from '../src/obsidian/undo-notice';
import { RENAME_UI, WRITE_TEXT } from '../src/render/ui-text';
import { dispatch, installDom, type FEl } from './acceptance/fake-dom';
import { noticeList, notices, resetObsidian } from './acceptance/fake-obsidian';

/*
 * Review of WP6.4 (scratch/review-6.4): proofs for the rename handler. The fake vault is the one of
 * tests/rename-links.test.ts.
 */

const FAST = { resolved: 0, quiet: 0, cap: 50 };

const tree = (...people: string[]) => ['```kin', 'people:', ...people, '```', ''].join('\n');
const person = (id: string, link?: string) => [`  - id: ${id}`, `    name: ${id.toUpperCase()}`, ...(link === undefined ? [] : [`    link: ${link}`])].join('\n');

function fakeApp(files: Record<string, string>) {
	const texts = new Map(Object.entries(files));
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const tfiles = new Map<string, TFile>([...texts.keys()].map((p) => [p, new File(p, 'md')]));
	let beforeProcess: ((path: string) => void) | null = null;
	const writes: string[] = [];
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			getMarkdownFiles: () => [...tfiles.values()],
			read: async (f: TFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: TFile) => texts.get(f.path) ?? '',
			process: async (f: TFile, fn: (t: string) => string) => {
				beforeProcess?.(f.path);
				const next = fn(texts.get(f.path) ?? '');
				if (next !== texts.get(f.path)) writes.push(f.path);
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on: (name: string, fn: unknown) => ({ name, fn }),
			offref: () => {},
			// The parameters give the fake the shape a test replaces it with.
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			getFirstLinkpathDest(linkpath: string, _source?: string): TFile | null {
				const want = stem(linkpath.replace(/\\/g, '/'));
				for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			fileToLinktext(file: TFile, _source?: string, _omit?: boolean) {
				return file.path.replace(/\.md$/i, '').split('/').pop()!;
			},
		},
		workspace: { getLeavesOfType: () => [] },
	};
	return {
		app,
		texts,
		writes,
		tfiles,
		hook(fn: ((path: string) => void) | null) {
			beforeProcess = fn;
		},
		move(from: string, to: string) {
			const f = tfiles.get(from)!;
			tfiles.delete(from);
			f.path = to;
			tfiles.set(to, f);
			texts.set(to, texts.get(from)!);
			texts.delete(from);
			return f;
		},
	};
}

function setup(files: Record<string, string>) {
	const v = fakeApp(files);
	const handles = new HandleRegistry(v.app as never);
	const updater = new LinkUpdater(v.app as never, handles, () => true, FAST);
	/** What main.ts does on `vault.on('rename')`, without waiting. */
	const renameNow = (from: string, to: string) => {
		const f = v.move(from, to);
		handles.renamed(from, to);
		updater.renamed(f, from);
	};
	const rename = async (...pairs: [string, string][]) => {
		for (const [from, to] of pairs) renameNow(from, to);
		await updater.idle();
	};
	return { ...v, handles, updater, rename, renameNow };
}

const body = (s: { texts: Map<string, string> }, path: string, i = 0) => findBlocks(s.texts.get(path)!)[i].body;

beforeAll(() => installDom());
beforeEach(() => resetObsidian());

describe('review 6.4: rename finds the tree', () => {
	it('a Markdown link with a space in the name (written %20) is updated', async () => {
		// Obsidian writes Markdown links with %20; this form is the only link to the note in this tree.
		const s = setup({ 'Trees.md': tree(person('a', '"[Hall](Old%20Hall.md)"')), 'Old Hall.md': '' });
		await s.rename(['Old Hall.md', 'New Hall.md']);
		expect(body(s, 'Trees.md')).toContain('link: "[Hall](New%20Hall.md)"');
		expect(notices).toEqual([RENAME_UI.updated(1, 1)]);
	});

	it('a relative link (./ and ../) that led to the renamed note is updated', async () => {
		const s = setup({
			'Trees/T.md': tree(person('a', '"[[../People/Hall]]"'), person('b', '"[Hall](../People/Hall.md)"')),
			'People/U.md': tree(person('c', '"[[./Hall]]"')),
			'People/Hall.md': '',
		});
		const mc = s.app.metadataCache;
		const plain = mc.getFirstLinkpathDest.bind(mc);
		// Obsidian resolves ./ and ../ from the folder of the note that holds the link.
		mc.getFirstLinkpathDest = (link: string, source?: string) => {
			if (!/^\.\.?\//.test(link) || !source) return plain(link);
			const parts = source.split('/').slice(0, -1);
			for (const seg of link.replace(/\.md$/i, '').split('/')) {
				if (seg === '..') parts.pop();
				else if (seg !== '.') parts.push(seg);
			}
			return s.tfiles.get(`${parts.join('/')}.md`) ?? null;
		};
		// Before the rename, each of these links opens People/Hall.md.
		expect(mc.getFirstLinkpathDest('../People/Hall', 'Trees/T.md')?.path).toBe('People/Hall.md');
		expect(mc.getFirstLinkpathDest('./Hall', 'People/U.md')?.path).toBe('People/Hall.md');
		await s.rename(['People/Hall.md', 'People/Keep.md']);
		// Every link now names Keep; only the alias text "Hall" of the Markdown link stays.
		expect(body(s, 'Trees/T.md')).not.toMatch(/[/]Hall/);
		expect(body(s, 'People/U.md')).not.toMatch(/[/]Hall/);
	});
});

describe('review 6.4: undo entries and the rename', () => {
	it('"Undo last tree edit" after a rename does not bring back a link to the old name', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		const h = (await s.handles.forBlock('T.md', 0))!;
		expect((await h.write({ kind: 'delete-person', id: 'a' })).ok).toBe(true);
		await s.rename(['Old.md', 'New.md']);
		expect((await h.undo()).ok).toBe(true);
		// Person a is back; the link must lead to the renamed note.
		expect(body(s, 'T.md')).toContain('id: a');
		expect(body(s, 'T.md')).toContain('[[New]]');
	});

	it('the Undo button of the delete Notice still works after a rename changed a link in the same tree', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		const h = (await s.handles.forBlock('T.md', 0))!;
		const out = await h.write({ kind: 'delete-person', id: 'b' });
		expect(out.ok).toBe(true);
		undoNotice('The plugin deleted B.', h, out.ok ? out.body : '');
		await s.rename(['Old.md', 'New.md']);
		// The rename carried the undo entry: the command could still undo the delete.
		expect(h.canUndo).toBe(true);
		const button = noticeList[0].messageEl.querySelector('.dynasty-undo-button') as unknown as FEl;
		dispatch(button, 'click', {});
		for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
		expect(notices.slice(2)).toEqual([WRITE_TEXT.undoDone]);
		expect(body(s, 'T.md')).toContain('id: b');
	});
});

describe('review 6.4: rename during a write', () => {
	it('a note renamed while a write to it runs: later reads and link updates of that note still work', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		const h = (await s.handles.forBlock('T.md', 0))!;
		let once = true;
		s.hook(() => {
			if (!once) return;
			once = false;
			// The user renames the tree's note while vault.process runs (no link update is due for it).
			s.move('T.md', 'Trees.md');
			s.handles.renamed('T.md', 'Trees.md');
		});
		expect((await h.write({ kind: 'set-person-fields', id: 'b', fields: { title: 'Lord' } })).ok).toBe(true);
		s.hook(null);
		expect(await s.handles.forBlock('Trees.md', 0)).not.toBeNull();
	});

	it('after that, a rename of a linked note updates the tree, or at least says that it could not', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		const h = (await s.handles.forBlock('T.md', 0))!;
		let once = true;
		s.hook(() => {
			if (!once) return;
			once = false;
			s.move('T.md', 'Trees.md');
			s.handles.renamed('T.md', 'Trees.md');
		});
		expect((await h.write({ kind: 'set-person-fields', id: 'b', fields: { title: 'Lord' } })).ok).toBe(true);
		s.hook(null);
		await s.rename(['Old.md', 'New.md']);
		const updated = body(s, 'Trees.md').includes('[[New]]');
		expect({ updated, notices }).toEqual({ updated: true, notices: [RENAME_UI.updated(1, 1)] });
	});
});

describe('review 6.4: plugin unload during the link update', () => {
	it('no write after stop(): the second tree of the same note stays as it is', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')) + '\n' + tree(person('b', '"[[Old]]"')), 'Old.md': '' });
		let n = 0;
		s.hook(() => {
			// The plugin is turned off while the first tree is written.
			if (n++ === 0) s.updater.stop();
		});
		await s.rename(['Old.md', 'New.md']);
		expect(body(s, 'T.md', 1)).toContain('[[Old]]');
		expect(s.writes).toEqual(['T.md']);
	});
});
