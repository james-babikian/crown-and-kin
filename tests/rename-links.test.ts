import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { Transaction } from '@codemirror/state';
import { MarkdownView, TFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { LinkUpdater, nameForms, type LinkHooks, type RenameTiming } from '../src/obsidian/rename-links';
import { RENAME_UI } from '../src/render/ui-text';
import { VIEW_NOTICE } from '../src/render/view-text';
import { noticeList, notices, resetObsidian } from './acceptance/fake-obsidian';

/*
 * WP6.4: link maintenance after a rename (spec §6.9, D6, D35; the decision notes "M6 design gate", Rename).
 * The real HandleRegistry and LinkUpdater run on a small fake vault: notes are closed unless a test
 * opens one in a fake Live Preview editor.
 */

const FAST = { resolved: 0, quiet: 0, cap: 50 };

const tree = (...people: string[]) => ['```kin', 'people:', ...people, '```', ''].join('\n');
const person = (id: string, link?: string) => [`  - id: ${id}`, `    name: ${id.toUpperCase()}`, ...(link === undefined ? [] : [`    link: ${link}`])].join('\n');

interface Listener {
	name: string;
	fn: (...a: unknown[]) => void;
}

/** A vault of notes (path → text), the metadata cache parts the updater uses, and no open editor. */
function fakeApp(files: Record<string, string>) {
	const texts = new Map(Object.entries(files));
	// The fake TFile takes its path and extension (fake-obsidian.ts).
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const tfiles = new Map<string, TFile>([...texts.keys()].map((p) => [p, new File(p, 'md')]));
	const listeners: Listener[] = [];
	/** Runs inside `vault.process`, before the plugin's function reads the text. */
	let beforeProcess: ((path: string) => void) | null = null;
	const writes: string[] = [];
	/** Notes the updater read with `cachedRead`, in order. */
	const reads: string[] = [];
	/** The metadata cache of each note; a note that is not here has no cache entry yet. */
	const caches = new Map<string, unknown>();
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const leaves: unknown[] = [];
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			getMarkdownFiles: () => [...tfiles.values()],
			read: async (f: TFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: TFile) => {
				reads.push(f.path);
				return texts.get(f.path) ?? '';
			},
			process: async (f: TFile, fn: (t: string) => string) => {
				beforeProcess?.(f.path);
				const next = fn(texts.get(f.path) ?? '');
				if (next !== texts.get(f.path)) writes.push(f.path);
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on(name: string, fn: (...a: unknown[]) => void) {
				const l = { name, fn };
				listeners.push(l);
				return l;
			},
			offref(ref: Listener) {
				const i = listeners.indexOf(ref);
				if (i >= 0) listeners.splice(i, 1);
			},
			/** Obsidian's rule, simplified: the path, or the end of a path, without `.md`, case-insensitive. */
			getFirstLinkpathDest(linkpath: string) {
				const want = stem(linkpath.replace(/\\/g, '/'));
				for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext(file: TFile) {
				return file.path.replace(/\.md$/i, '').split('/').pop()!;
			},
			getFileCache: (f: TFile) => caches.get(f.path) ?? null,
		},
		workspace: { getLeavesOfType: () => leaves },
	};
	return {
		app,
		texts,
		writes,
		reads,
		caches,
		leaves,
		/** The metadata cache sends an event. */
		trigger(name: string, ...a: unknown[]) {
			for (const l of listeners.filter((x) => x.name === name)) l.fn(...a);
		},
		/** A new note (as Obsidian makes one for a tap on a link that opens no note). */
		create(path: string, text: string) {
			texts.set(path, text);
			tfiles.set(path, new File(path, 'md'));
		},
		file: (path: string) => tfiles.get(path)!,
		hook(fn: ((path: string) => void) | null) {
			beforeProcess = fn;
		},
		/** Obsidian renames a note: the file object keeps its identity and gets the new path. */
		rename(from: string, to: string) {
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

function setup(files: Record<string, string>, enabled = true, opts: { timing?: RenameTiming; hooks?: LinkHooks } = {}) {
	const v = fakeApp(files);
	const handles = new HandleRegistry(v.app as never);
	const on = { value: enabled };
	const updater = new LinkUpdater(v.app as never, handles, () => on.value, opts.timing ?? FAST, opts.hooks);
	/** What main.ts does on `vault.on('rename')`. */
	const rename = async (...pairs: [string, string][]) => {
		for (const [from, to] of pairs) {
			const f = v.rename(from, to);
			handles.renamed(from, to);
			updater.renamed(f, from);
		}
		await updater.idle();
	};
	return { ...v, move: v.rename, handles, updater, rename, on };
}

beforeEach(() => resetObsidian());

describe('Rename: tree links follow the renamed note (spec §6.9, D6)', () => {
	it('a closed note: every written form keeps its alias and heading, one write, and the D35 Notice', async () => {
		const note = tree(
			person('a', '"[[Old Hall]]"'),
			person('b', '"[[Old Hall|The hall]]"'),
			person('c', '"[[Old Hall#Rooms]]"'),
			person('d', '"[Hall](Old%20Hall.md)"'),
			person('e', '[[Old Hall]]'),
			person('f', '"[[Other]]"'),
		);
		const s = setup({ 'Trees.md': note, 'Old Hall.md': '# Hall\n', 'Other.md': '' });
		await s.rename(['Old Hall.md', 'New Hall.md']);
		const body = findBlocks(s.texts.get('Trees.md')!)[0].body;
		expect(body).toContain('link: "[[New Hall]]"');
		expect(body).toContain('link: "[[New Hall|The hall]]"');
		expect(body).toContain('link: "[[New Hall#Rooms]]"');
		expect(body).toContain('link: "[Hall](New%20Hall.md)"');
		expect(body).toContain('link: [[New Hall]]');
		expect(body).toContain('link: "[[Other]]"');
		expect(s.writes).toEqual(['Trees.md']);
		expect(notices).toEqual([RENAME_UI.updated(5, 1)]);
		expect(RENAME_UI.updated(5, 1)).toBe('The plugin changed 5 links in 1 tree.');
	});

	it('the target case does not matter, and a folder part of the old path counts', async () => {
		const s = setup({
			'Trees.md': tree(person('a', '"[[old hall]]"'), person('b', '"[[Places/OLD HALL.md|x]]"')),
			'Places/Old Hall.md': '',
		});
		await s.rename(['Places/Old Hall.md', 'Places/New Hall.md']);
		const body = findBlocks(s.texts.get('Trees.md')!)[0].body;
		expect(body).toContain('link: "[[New Hall]]"');
		expect(body).toContain('link: "[[New Hall.md|x]]"');
		expect(notices).toEqual([RENAME_UI.updated(2, 1)]);
	});

	it('every tree of every note, and a folder rename (one event per note) gives one Notice with the sums', async () => {
		const s = setup({
			'A.md': tree(person('a', '"[[North/Keep]]"')) + '\n' + tree(person('b', '"[[Tower]]"')),
			'B.md': tree(person('c', '"[[Keep]]"'), person('d', '"[[Tower|t]]"')),
			'North/Keep.md': '',
			'North/Tower.md': '',
		});
		await s.rename(['North/Keep.md', 'South/Keep2.md'], ['North/Tower.md', 'South/Tower2.md']);
		const a = findBlocks(s.texts.get('A.md')!);
		expect(a[0].body).toContain('"[[Keep2]]"');
		expect(a[1].body).toContain('"[[Tower2]]"');
		expect(findBlocks(s.texts.get('B.md')!)[0].body).toMatch(/"\[\[Keep2\]\]"[\s\S]*"\[\[Tower2\|t\]\]"/);
		expect(notices).toEqual([RENAME_UI.updated(4, 3)]);
	});

	it('a tree with blocking problems (duplicate ids) still gets its links', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('a', '"[[Old]]"')), 'Old.md': '' });
		await s.rename(['Old.md', 'New.md']);
		expect(findBlocks(s.texts.get('T.md')!)[0].body.match(/\[\[New\]\]/g)).toHaveLength(2);
		expect(notices).toEqual([RENAME_UI.updated(2, 1)]);
	});

	it('nothing to change: no write; a link that now finds another note of that name stays, and a Notice says why', async () => {
		const s = setup({
			'T.md': tree(person('a', '"[[Old]]"'), person('b', '"[[Elsewhere]]"')),
			'x/Old.md': '',
			'y/Old.md': '',
			'Unlinked.md': '',
		});
		await s.rename(['Unlinked.md', 'Renamed.md']);
		expect(notices).toEqual([]);
		// `Old` still leads to y/Old.md after x/Old.md moves: the link is not the plugin's to change.
		await s.rename(['x/Old.md', 'x/Newer.md']);
		expect(s.writes).toEqual([]);
		// Fix round after the M6 iPhone test: the tree named the old note, so a Notice gives the reason.
		expect(notices).toEqual([RENAME_UI.kept('Old', 'T', 'y/Old')]);
	});

	it('the setting off (D6): nothing changes', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' }, false);
		await s.rename(['Old.md', 'New.md']);
		expect(findBlocks(s.texts.get('T.md')!)[0].body).toContain('"[[Old]]"');
		expect(notices).toEqual([]);
	});

	it('a stale write (the tree changed in between) is read again and written once more', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		let once = true;
		s.hook((path) => {
			if (!once) return;
			once = false;
			// Someone edits another person of the tree just before the plugin writes.
			s.texts.set(path, s.texts.get(path)!.replace('name: B', 'name: Bea'));
		});
		await s.rename(['Old.md', 'New.md']);
		const body = findBlocks(s.texts.get('T.md')!)[0].body;
		expect(body).toContain('"[[New]]"');
		expect(body).toContain('name: Bea');
		expect(notices).toEqual([RENAME_UI.updated(1, 1)]);
	});

	it('a link the plugin cannot write in the new form: a Notice names the note and the link; other trees still change', async () => {
		const s = setup({ 'Bad.md': tree(person('a', '"[[Old]]"')), 'Good.md': tree(person('b', '"[[Keep]]"')), 'Old.md': '', 'Keep.md': '' });
		const mc = s.app.metadataCache;
		const plain = mc.fileToLinktext;
		// A `|` in the new text would make the rest an alias (WP6.1: the op refuses).
		mc.fileToLinktext = (f: TFile) => (f.path === 'Odd.md' ? 'Odd|name' : plain(f));
		await s.rename(['Old.md', 'Odd.md'], ['Keep.md', 'Kept.md']);
		expect(findBlocks(s.texts.get('Bad.md')!)[0].body).toContain('"[[Old]]"');
		expect(findBlocks(s.texts.get('Good.md')!)[0].body).toContain('"[[Kept]]"');
		expect(notices).toEqual([RENAME_UI.updated(1, 1), RENAME_UI.failed('Bad', 'Old', 'Odd|name')]);
		expect(notices[1]).toBe('The plugin cannot change the link “Old” in a tree in the note “Bad”. Replace “Old” with “Odd|name” by hand.');
	});

	it('a tree that stays stale: after one more try, the failure Notice', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b')), 'Old.md': '' });
		let n = 0;
		s.hook((path) => s.texts.set(path, s.texts.get(path)!.replace(/name: B\w*/, `name: B${n++}`)));
		await s.rename(['Old.md', 'New.md']);
		expect(findBlocks(s.texts.get('T.md')!)[0].body).toContain('"[[Old]]"');
		expect(notices).toEqual([RENAME_UI.failed('T', 'Old', 'New')]);
	});

	it('not on the undo stack: "Undo last tree edit" still undoes the user\'s own edit and keeps the new link', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'U.md': tree(person('u')), 'Old.md': '' });
		const h = (await s.handles.forBlock('T.md', 0))!;
		const u = (await s.handles.forBlock('U.md', 0))!;
		expect((await h.write({ kind: 'set-person-fields', id: 'a', fields: { title: 'Lord' } })).ok).toBe(true);
		expect((await u.write({ kind: 'set-person-fields', id: 'u', fields: { title: 'Lady' } })).ok).toBe(true);
		await s.rename(['Old.md', 'New.md']);
		// The rename wrote T.md, but U.md stays the last edit to undo.
		expect(s.handles.undoTarget(null)).toBe(u);
		expect(h.undoSize).toBe(1);
		expect(h.canUndo).toBe(true);
		expect((await h.undo()).ok).toBe(true);
		const body = findBlocks(s.texts.get('T.md')!)[0].body;
		expect(body).toContain('"[[New]]"');
		expect(body).not.toContain('Lord');
		expect(h.canUndo).toBe(false);
	});

	it('a note open in Live Preview: the change goes through its editor, outside the editor history', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' });
		let text = s.texts.get('T.md')!;
		const dispatched: { annotations?: unknown }[] = [];
		const cm = {
			get state() {
				return { doc: { length: text.length } };
			},
			dispatch(tr: { changes: { from: number; to: number; insert: string }; annotations?: unknown }) {
				dispatched.push(tr);
				text = text.slice(0, tr.changes.from) + tr.changes.insert + text.slice(tr.changes.to);
			},
		};
		const view = Object.assign(Object.create(MarkdownView.prototype), {
			file: { path: 'T.md' },
			getMode: () => 'source',
			editor: { getValue: () => text, cm },
		});
		s.leaves.push({ view });
		await s.rename(['Old.md', 'New.md']);
		expect(text).toContain('"[[New]]"');
		expect(dispatched).toHaveLength(1);
		const ann = dispatched[0].annotations as { type: unknown; value: unknown };
		expect(ann.type).toBe(Transaction.addToHistory);
		expect(ann.value).toBe(false);
	});

	it('a rename of the tree note itself: its own links to the old name follow too', async () => {
		const s = setup({ 'Old.md': tree(person('a', '"[[Old#Top]]"')) });
		await s.rename(['Old.md', 'New.md']);
		expect(findBlocks(s.texts.get('New.md')!)[0].body).toContain('"[[New#Top]]"');
	});
});

describe('HandleRegistry.forBlock (M6 ForBlock)', () => {
	it('gives the handle of any block of a closed note, shares an existing handle, and null when the block or note is gone', async () => {
		const s = setup({ 'T.md': tree(person('a')) + '\n' + tree(person('b')) });
		const h1 = await s.handles.forBlock('T.md', 1);
		expect(h1?.body).toContain('id: b');
		expect(await s.handles.forBlock('T.md', 1)).toBe(h1);
		expect(await s.handles.forBlock('T.md', 2)).toBeNull();
		expect(await s.handles.forBlock('Missing.md', 0)).toBeNull();
		expect(await s.handles.forBlock('T.md', -1)).toBeNull();
	});
});

describe('Rename, fix round after the M6 iPhone test (the decision notes "M6 iPhone test")', () => {
	const code = { sections: [{ type: 'code' }] };
	const para = { sections: [{ type: 'paragraph' }] };
	const bodyOf = (s: ReturnType<typeof setup>, path: string) => findBlocks(s.texts.get(path)!)[0].body;

	/** What main.ts does on `vault.on('rename')`, without the wait for the end. */
	function renameNow(s: ReturnType<typeof setup>, from: string, to: string): void {
		const f = s.move(from, to);
		s.handles.renamed(from, to);
		s.updater.renamed(f, from);
	}

	describe('the stale-link rule is decided at the rename', () => {
		it('a note with the old name made after the rename (a tap on the old link) does not stop the update', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b', '"[[Old#Hall|the hall]]"')), 'Old.md': '' });
			renameNow(s, 'Old.md', 'New.md');
			// Obsidian makes an empty "Old" for a tap on the old link, before the plugin reads the tree.
			s.create('Old.md', '');
			await s.updater.idle();
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
			expect(bodyOf(s, 'T.md')).toContain('"[[New#Hall|the hall]]"');
			expect(notices).toEqual([RENAME_UI.updated(2, 1)]);
		});

		it('a link that opens the renamed note already (the note moved to another folder) stays, with no Notice', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[Keep]]"')), 'North/Keep.md': '' });
			await s.rename(['North/Keep.md', 'South/Keep.md']);
			expect(s.writes).toEqual([]);
			expect(notices).toEqual([]);
			expect(s.updater.last).toMatchObject({ state: 'done', trees: 1, links: 0, skipped: [] });
		});

		it('one Notice for each tree that kept a link, at most three, then one Notice with the rest', async () => {
			const files: Record<string, string> = { 'x/Old.md': '', 'y/Old.md': '' };
			for (const n of ['A', 'B', 'C', 'D', 'E']) files[`${n}.md`] = tree(person('a', '"[[Old]]"'));
			const s = setup(files);
			await s.rename(['x/Old.md', 'x/New.md']);
			expect(notices).toEqual([RENAME_UI.kept('Old', 'A', 'y/Old'), RENAME_UI.kept('Old', 'B', 'y/Old'), RENAME_UI.kept('Old', 'C', 'y/Old'), RENAME_UI.moreKept(2)]);
			expect(notices[0]).toBe('The plugin did not change the link “Old” in a tree in the note “A”. The link now opens a different note with the same name: “y/Old”.');
			expect(RENAME_UI.moreKept(2)).toBe('The plugin also did not change the links in 2 other trees for the same reason.');
		});

		it('a kept link is also named when other links of the same tree changed (owner, 2026-10-13)', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[x/Old]]"'), person('b', '"[[Old]]"')), 'x/Old.md': '', 'y/Old.md': '' });
			await s.rename(['x/Old.md', 'x/New.md']);
			// "[[x/Old]]" changes; "[[Old]]" now opens y/Old.md and stays.
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
			expect(bodyOf(s, 'T.md')).toContain('"[[Old]]"');
			expect(s.updater.last?.skipped).toHaveLength(1);
			expect(notices).toEqual([RENAME_UI.updated(1, 1), RENAME_UI.kept('Old', 'T', 'y/Old')]);
		});

		it('trees that changed and kept links count with the trees that only kept: three Notices, then one for the rest', async () => {
			const files: Record<string, string> = { 'x/Old.md': '', 'y/Old.md': '' };
			for (const n of ['A', 'B', 'C', 'D']) files[`${n}.md`] = tree(person('a', '"[[x/Old]]"'), person('b', '"[[Old]]"'));
			const s = setup(files);
			await s.rename(['x/Old.md', 'x/New.md']);
			expect(notices).toEqual([RENAME_UI.updated(4, 4), RENAME_UI.kept('Old', 'A', 'y/Old'), RENAME_UI.kept('Old', 'B', 'y/Old'), RENAME_UI.kept('Old', 'C', 'y/Old'), RENAME_UI.moreKept(1)]);
		});
	});

	describe('only notes that can hold a tree are read', () => {
		it('the metadata cache decides: a note that shows a tree first, then notes with a fence, callout, quote or list, then notes with no cache', async () => {
			const s = setup({
				'K.md': tree(person('k', '"[[Old]]"')),
				'T.md': tree(person('t', '"[[Old]]"')),
				'Q.md': '> [!note]\n> ```kin\n> people:\n>   - id: q\n>     name: Q\n>     link: "[[Old]]"\n> ```\n',
				'L.md': '- item\n',
				'Plain.md': 'Text about [[Old]] and kin.\n',
				'Fresh.md': 'No cache yet.\n',
				'Old.md': '',
			});
			s.caches.set('K.md', para);
			s.caches.set('T.md', code);
			s.caches.set('Q.md', { sections: [{ type: 'callout' }] });
			s.caches.set('L.md', { sections: [{ type: 'list' }] });
			s.caches.set('Plain.md', para);
			s.caches.set('New.md', para);
			// K.md shows a tree now: it has a handle (its stale cache does not matter).
			expect(await s.handles.forBlock('K.md', 0)).not.toBeNull();
			await s.rename(['Old.md', 'New.md']);
			expect(s.reads).toEqual(['K.md', 'T.md', 'Q.md', 'L.md', 'Fresh.md']);
			expect(bodyOf(s, 'Q.md')).toContain('"[[New]]"');
			expect(notices).toEqual([RENAME_UI.updated(3, 3)]);
			expect(s.updater.last).toMatchObject({ notes: 7, read: 5, trees: 3, links: 3, changedTrees: 3 });
		});
	});

	describe('the wait for Obsidian\'s own link update', () => {
		const slow: RenameTiming = { resolved: 400, quiet: 0, cap: 400 };

		it('a tree note with no normal link to the old name is written at once', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' }, true, { timing: slow });
			s.caches.set('T.md', code);
			const t0 = Date.now();
			await s.rename(['Old.md', 'New.md']);
			expect(Date.now() - t0).toBeLessThan(300);
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
		});

		it('a tree note that Obsidian can change (a normal link to the old name) waits for Obsidian', async () => {
			const s = setup({ 'T.md': `See [[Old]].\n\n${tree(person('a', '"[[Old]]"'))}`, 'Old.md': '' }, true, { timing: slow });
			s.caches.set('T.md', { ...code, links: [{ link: 'Old' }] });
			const t0 = Date.now();
			await s.rename(['Old.md', 'New.md']);
			expect(Date.now() - t0).toBeGreaterThanOrEqual(380);
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
		});

		it('… and stops the wait when the note\'s cache no longer shows the old name', async () => {
			const s = setup({ 'T.md': `See [[Old]].\n\n${tree(person('a', '"[[Old]]"'))}`, 'Old.md': '' }, true, { timing: slow });
			s.caches.set('T.md', { ...code, links: [{ link: 'Old#Part' }] });
			setTimeout(() => {
				s.caches.set('T.md', { ...code, links: [{ link: 'New#Part' }] });
				s.trigger('changed', s.file('T.md'));
			}, 50);
			const t0 = Date.now();
			await s.rename(['Old.md', 'New.md']);
			expect(Date.now() - t0).toBeLessThan(300);
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
		});
	});

	describe('pending renames are stored and continue after a restart', () => {
		const entry = { oldPath: 'Old.md', newPath: 'New.md', others: [] as string[] };

		function stored(files: Record<string, string>, enabled = true) {
			const saves: { list: unknown; writes: number }[] = [];
			const holder: { s?: ReturnType<typeof setup> } = {};
			const s = setup(files, enabled, {
				hooks: {
					save: async () => {
						saves.push({ list: holder.s!.updater.pendingList(), writes: holder.s!.writes.length });
					},
				},
			});
			holder.s = s;
			return { s, saves };
		}

		it('stored before the scan, removed when the update is done', async () => {
			const { s, saves } = stored({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' });
			await s.rename(['Old.md', 'New.md']);
			expect(saves[0]).toEqual({ list: [entry], writes: 0 });
			expect(saves[saves.length - 1]).toEqual({ list: [], writes: 1 });
		});

		it('a folder rename (one event per note) makes one save before the scan', async () => {
			const { s, saves } = stored({ 'T.md': tree(person('a', '"[[North/Keep]]"')), 'North/Keep.md': '', 'North/Tower.md': '' });
			await s.rename(['North/Keep.md', 'South/Keep.md'], ['North/Tower.md', 'South/Tower.md']);
			expect(saves).toHaveLength(2);
			expect((saves[0].list as unknown[]).length).toBe(2);
			expect(saves[1].list).toEqual([]);
		});

		it('resume() after a restart: the stored rename runs, and the store is empty after it', async () => {
			const { s, saves } = stored({ 'T.md': tree(person('a', '"[[Old]]"')), 'New.md': '' });
			s.updater.restore([entry]);
			expect(s.updater.pendingList()).toEqual([entry]);
			s.updater.resume();
			await s.updater.idle();
			expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
			expect(notices).toEqual([RENAME_UI.updated(1, 1)]);
			expect(s.updater.pendingList()).toEqual([]);
			expect(saves[saves.length - 1]?.list).toEqual([]);
		});

		it('a stored rename follows a later rename of the note before resume()', async () => {
			const { s } = stored({ 'T.md': tree(person('a', '"[[Old]]"')), 'New.md': '' });
			s.updater.restore([entry]);
			renameNow(s, 'New.md', 'Newer.md');
			expect(s.updater.pendingList()[0]).toEqual({ ...entry, newPath: 'Newer.md' });
			s.updater.resume();
			await s.updater.idle();
			expect(bodyOf(s, 'T.md')).toContain('"[[Newer]]"');
		});

		it('resume() drops a rename whose note is gone, and every rename if the setting is off', async () => {
			const a = stored({ 'T.md': tree(person('a', '"[[Old]]"')) });
			a.s.updater.restore([entry]);
			a.s.updater.resume();
			await a.s.updater.idle();
			expect(a.s.writes).toEqual([]);
			expect(a.s.updater.pendingList()).toEqual([]);
			expect(a.saves[a.saves.length - 1]?.list).toEqual([]);

			const b = stored({ 'T.md': tree(person('a', '"[[Old]]"')), 'New.md': '' }, false);
			b.s.updater.restore([entry]);
			b.s.updater.resume();
			await b.s.updater.idle();
			expect(b.s.writes).toEqual([]);
			expect(b.s.updater.pendingList()).toEqual([]);
			expect(notices).toEqual([]);
		});

		it('the plugin unloads during the update: the rename stays stored for the next start, with the notes of the old name', async () => {
			const { s } = stored({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '', 'y/Old.md': '' });
			renameNow(s, 'Old.md', 'New.md');
			s.updater.stop();
			await s.updater.idle();
			expect(s.writes).toEqual([]);
			expect(s.updater.pendingList()).toEqual([{ ...entry, others: ['y/Old.md'] }]);
		});
	});

	describe('Notices', () => {
		const now: RenameTiming = { ...FAST, progress: 0 };

		it('a progress Notice if the update takes longer than the limit; it closes at the end', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' }, true, { timing: now });
			await s.rename(['Old.md', 'New.md']);
			expect(notices).toEqual([RENAME_UI.progressFor('note'), RENAME_UI.updated(1, 1)]);
			expect(noticeList[0].hidden).toBe(true);
			expect(RENAME_UI.progressFor('note')).toBe('The plugin updates the tree links to the renamed note. This can take some time.');
		});

		it('after a progress Notice, a Notice also when no tree links to the renamed note', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[Other]]"')), 'A.md': '' }, true, { timing: now });
			await s.rename(['A.md', 'B.md']);
			expect(notices).toEqual([RENAME_UI.progressFor('note'), RENAME_UI.noLinksFor('note')]);
		});

		it('an error stops the update: a Notice, the report says so, and the rename is not stored again', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' });
			vi.spyOn(s.handles, 'forBlock').mockRejectedValue(new Error('disk'));
			await s.rename(['Old.md', 'New.md']);
			expect(notices).toEqual([RENAME_UI.stopped('“Old”')]);
			expect(notices[0]).toBe('The plugin cannot complete the update of the tree links to “Old”. Some trees can still have the old link. Change these links by hand.');
			expect(s.updater.last?.state).toBe('failed');
			expect(s.updater.pendingList()).toEqual([]);
			expect(err).toHaveBeenCalled();
			err.mockRestore();
		});
	});

	it('F-VIEW-04: a note that stays busy gives a Notice that names the note and the link, not a silent gap', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"')), 'Old.md': '' });
		vi.spyOn(s.handles, 'forBlock').mockImplementation(async (_p: string, _o: number, onBusy?: () => void) => {
			onBusy?.();
			return null;
		});
		await s.rename(['Old.md', 'New.md']);
		expect(notices).toEqual([VIEW_NOTICE.renameGaveUp('T', 'Old', 'New')]);
		expect(s.updater.last?.failed).toEqual(['T']);
	});

	describe('the command "Show the last link update"', () => {
		it('gives the counts and the reasons', async () => {
			const s = setup({ 'T.md': tree(person('a', '"[[x/Old]]"')), 'U.md': tree(person('b', '"[[Old]]"')), 'x/Old.md': '', 'y/Old.md': '' });
			await s.rename(['x/Old.md', 'x/New.md']);
			expect(notices).toEqual([RENAME_UI.updated(1, 1), RENAME_UI.kept('Old', 'U', 'y/Old')]);
			const last = { ...s.updater.last!, ms: 1200 };
			expect(RENAME_UI.report(last, true)).toBe(
				'The last link update was after the rename of “x/Old” to “x/New”. It took 1.2 seconds.\n\nNotes in the vault: 4. Notes that the plugin read: 4.\n\n' +
					'Trees with a link to the renamed note: 2. Changed links: 1. Changed trees: 1.\n\nLinks that the plugin did not change: 1. ' +
					'The link “Old” in the note “U” opens a different note with the same name: “y/Old”.',
			);
		});

		it('before any rename, and with the setting off', () => {
			expect(RENAME_UI.command).toBe('Show the last link update');
			expect(RENAME_UI.report(null, true)).toBe('The plugin did not update tree links after Obsidian started.');
			expect(RENAME_UI.report(null, false)).toBe('The plugin did not update tree links after Obsidian started. The setting “Update tree links when you rename a note or a picture” is off.');
		});

		it('a stopped, a failed and a running update, and trees that the plugin cannot change', () => {
			const base = { renames: [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }], ms: 0, notes: 10, read: 3, unread: 1, trees: 2, links: 0, changedTrees: 0, skipped: [], failed: ['N1', 'N2'] };
			expect(RENAME_UI.report({ ...base, state: 'running' }, true)).toBe(
				'The plugin still updates the tree links after the rename of 2 notes.\n\nNotes in the vault: 10. Notes that the plugin read: 3. Notes that the plugin cannot read: 1.\n\n' +
					'Trees with a link to the renamed note: 2. Changed links: 0. Changed trees: 0.\n\nTrees that the plugin cannot change: 2. ' +
					'The plugin cannot change a tree in the note “N1”. The plugin cannot change a tree in the note “N2”.',
			);
			expect(RENAME_UI.report({ ...base, state: 'stopped' }, true)).toContain('It stopped before the end. The plugin will continue it at the next start.');
			expect(RENAME_UI.report({ ...base, state: 'failed' }, true)).toContain('An error stopped it before the end.');
		});
	});
});

describe('Rename, review 0.1.1 area E', () => {
	it('nameForms: as typed, with %20, as the plugin encodes it, as encodeURIComponent does, and fully decoded', () => {
		expect(nameForms('castle (old)')).toEqual(['castle (old)', 'castle%20(old)', 'castle%20%28old%29']);
		expect(nameForms('100%25 keep')).toEqual(['100%25 keep', '100%25%20keep', '100%2525%20keep', '100% keep']);
		// A bad escape has no decoded form; nothing throws.
		expect(nameForms('50% off')).toEqual(['50% off', '50%%20off', '50%25%20off']);
	});

	it('a note renamed twice in one batch: links to both old names get the last name', async () => {
		const s = setup({ 'T.md': tree(person('a', '"[[Old]]"'), person('b', '"[[Mid]]"')), 'Old.md': '' });
		await s.rename(['Old.md', 'Mid.md'], ['Mid.md', 'New.md']);
		const body = findBlocks(s.texts.get('T.md')!)[0].body;
		expect(body).toContain('link: "[[New]]"\n  - id: b');
		expect(body).toMatch(/id: b\n {4}name: B\n {4}link: "\[\[New\]\]"/);
	});

	it('the setting is turned off during an update: no write, the report says stopped, and the rename stays stored', async () => {
		const s = setup({ 'A.md': tree(person('a', '"[[Old]]"')), 'B.md': tree(person('b', '"[[Old]]"')), 'Old.md': '' });
		// The user turns the setting off when the update reads its first note.
		const read = s.app.vault.cachedRead;
		s.app.vault.cachedRead = async (file) => {
			s.on.value = false;
			return read(file);
		};
		await s.rename(['Old.md', 'New.md']);
		expect(s.writes).toEqual([]);
		expect(s.updater.last?.state).toBe('stopped');
		expect(s.updater.pendingList()).toEqual([{ oldPath: 'Old.md', newPath: 'New.md', others: [] }]);
		expect(notices).toEqual([]);
	});
});
