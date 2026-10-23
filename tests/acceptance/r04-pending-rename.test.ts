import { beforeEach, describe, expect, it } from 'vitest';
import { TFile as VaultFile } from 'obsidian';
import { findBlocks } from '../../src/core/block-locate';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { LinkUpdater, type RenameTiming } from '../../src/obsidian/rename-links';
import { RENAME_UI } from '../../src/render/ui-text';
import type { PendingRename } from '../../src/view/settings';
import { notices, resetObsidian } from './fake-obsidian';

/*
 * 0.4 WP-3a, step T0, package P: the rename scan with the fence notes (the index contract 2, test list 7.5) and the double run of one stored rename on two devices (the index contract 3).
 * `LinkHooks` gets `kinNotes?(): ReadonlySet<string> | null`. A set: the scan reads the files in the set, plus the notes of `known()` and of the open trees (`blocks.all()`), the notes
 * of `known()` and the open trees first. A null (the index is not complete, or no index): the code of today, with the same order. The scan itself is unchanged: it reads each
 * candidate and tests its text, so a wrong flag costs one read and never a wrong write. `report.notes` is the number of notes of the vault; `report.read` the number of candidates read.
 * The vault is a fake that counts reads. Written from the contract, before the code exists: the builder of package P removes the `.skip` below. These tests are expected to fail until package P is built.
 */

const FAST: RenameTiming = { resolved: 0, quiet: 0, cap: 50 };
const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

const tree = (...links: string[]) => ['```kin', 'people:', ...links.map((l, i) => `  - id: p${i}\n    name: P${i}\n    link: ${l}`), '```', ''].join('\n');
const treeOf = (people: { id: string; link?: string; portrait?: string }[]) =>
	['```kin', 'people:', ...people.flatMap((p) => [`  - id: ${p.id}`, `    name: ${p.id.toUpperCase()}`, ...(p.link ? [`    link: ${p.link}`] : []), ...(p.portrait ? [`    portrait: ${p.portrait}`] : [])]), '```', ''].join('\n');

function fileOf(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 100 } }) as VaultFile;
}

/** A vault of notes and pictures; `reads` lists every `cachedRead`; `caches` is the metadata cache of the notes (a note with no entry has no cache yet). */
function vault(files: Record<string, string>, pictures: string[] = []) {
	const texts = new Map(Object.entries(files));
	const all = new Map<string, VaultFile>();
	for (const p of [...texts.keys(), ...pictures]) all.set(p, fileOf(p));
	const reads: string[] = [];
	const writes: string[] = [];
	const caches = new Map<string, unknown>();
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => all.get(p) ?? null,
			getMarkdownFiles: () => [...all.values()].filter((f) => f.extension === 'md'),
			getFiles: () => [...all.values()],
			read: async (f: VaultFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: VaultFile) => {
				reads.push(f.path);
				return texts.get(f.path) ?? '';
			},
			process: async (f: VaultFile, fn: (t: string) => string) => {
				const next = fn(texts.get(f.path) ?? '');
				if (next !== texts.get(f.path)) writes.push(f.path);
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on: () => ({}),
			offref: () => undefined,
			getFirstLinkpathDest(linkpath: string) {
				const want = linkpath.replace(/\\/g, '/').toLowerCase();
				for (const [p, f] of all) if (p.toLowerCase() === want || p.toLowerCase().endsWith(`/${want}`) || stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext: (f: VaultFile) => (f.extension === 'md' ? f.path.replace(/\.md$/i, '') : f.path).split('/').pop()!,
			getFileCache: (f: VaultFile) => caches.get(f.path) ?? null,
		},
		workspace: { getLeavesOfType: () => [] },
	};
	const move = (from: string, to: string): VaultFile => {
		const f = all.get(from)!;
		all.delete(from);
		f.path = to;
		Object.assign(f, { name: to.split('/').pop(), extension: to.split('.').pop()!.toLowerCase() });
		all.set(to, f);
		if (texts.has(from)) {
			texts.set(to, texts.get(from)!);
			texts.delete(from);
		}
		return f;
	};
	return { app, texts, reads, writes, caches, move };
}

function setup(files: Record<string, string>, o: { pictures?: string[]; hooks?: Record<string, unknown> } = {}) {
	const v = vault(files, o.pictures);
	const handles = new HandleRegistry(v.app as never);
	// The hooks are passed as a variable so that this file compiles before `kinNotes` is in `LinkHooks`.
	const updater = new LinkUpdater(v.app as never, handles, () => true, FAST, o.hooks as never);
	const rename = async (...pairs: [string, string][]) => {
		for (const [from, to] of pairs) {
			const f = v.move(from, to);
			handles.renamed(from, to);
			updater.renamed(f, from);
		}
		await updater.idle();
	};
	return { ...v, handles, updater, rename };
}

type Setup = ReturnType<typeof setup>;
const bodyOf = (s: Setup, path: string) => findBlocks(s.texts.get(path)!)[0].body;
const sorted = (xs: Iterable<string>) => [...xs].sort();

beforeEach(() => resetObsidian());

describe('the rename scan with a set of fence notes (the index contract 2, test 7.5)', () => {
	const plain = (n: number): Record<string, string> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`text/n${i}.md`, `Note ${i} about [[Old]] and the kin.\n`]));

	it('reads only the notes of the set, the notes that show a tree (known) and the open trees; the others are not read', async () => {
		const files = {
			'Old.md': '',
			'K.md': tree('"[[Old]]"'),
			'O.md': tree('"[[Old]]"'),
			'T1.md': tree('"[[Old]]"'),
			'T2.md': tree('"[[Old]]"'),
			'Out.md': tree('"[[Old]]"'),
			...plain(40),
		};
		const hooks = { known: () => ['K.md'], kinNotes: () => new Set(['T1.md', 'T2.md']) };
		const s = setup(files, { hooks });
		// O.md shows a tree now: it has a handle (the open trees of `blocks.all()`).
		expect(await s.handles.forBlock('O.md', 0)).not.toBeNull();
		await s.rename(['Old.md', 'New.md']);
		expect(sorted(s.reads)).toEqual(['K.md', 'O.md', 'T1.md', 'T2.md']);
		// The notes that show a tree are read first.
		expect(s.reads.slice(0, 2).sort()).toEqual(['K.md', 'O.md']);
		for (const p of ['K.md', 'O.md', 'T1.md', 'T2.md']) expect(bodyOf(s, p)).toContain('"[[New]]"');
		// A tree in a note that the index does not list is not in the scan: the index is a hint the scan trusts.
		expect(bodyOf(s, 'Out.md')).toContain('"[[Old]]"');
		expect(s.writes.sort()).toEqual(['K.md', 'O.md', 'T1.md', 'T2.md']);
	});

	it('the notes of known() come first, then the rest of the set', async () => {
		const files = { 'Old.md': '', 'A.md': tree('"[[Old]]"'), 'B.md': tree('"[[Old]]"'), 'C.md': tree('"[[Old]]"'), 'D.md': tree('"[[Old]]"') };
		const s = setup(files, { hooks: { known: () => ['C.md', 'A.md'], kinNotes: () => new Set(['B.md', 'D.md']) } });
		await s.rename(['Old.md', 'New.md']);
		expect(sorted(s.reads.slice(0, 2))).toEqual(['A.md', 'C.md']);
		expect(sorted(s.reads.slice(2))).toEqual(['B.md', 'D.md']);
	});

	it('10 000 notes and 5 fence notes: five reads, and the report counts the vault and the reads', async () => {
		const files: Record<string, string> = { 'Old.md': '' };
		const trees = ['Trees/t1.md', 'Trees/t2.md', 'Trees/t3.md', 'Trees/t4.md', 'Trees/t5.md'];
		for (const t of trees) files[t] = tree('"[[Old]]"');
		for (let i = 0; i < 9994; i++) files[`text/n${i}.md`] = 'text\n';
		const s = setup(files, { hooks: { kinNotes: () => new Set(trees) } });
		await s.rename(['Old.md', 'New.md']);
		expect(s.reads.length).toBe(5);
		expect(sorted(s.reads)).toEqual(trees);
		expect(s.updater.last).toMatchObject({ notes: 10_000, read: 5, trees: 5, links: 5, changedTrees: 5 });
		expect(notices).toEqual([RENAME_UI.updated(5, 5)]);
	});

	it('a wrong flag never writes: a note in the set with no tree, or a calendar block, or a tree with other links, is read and left as it is', async () => {
		const calendar = '```kin-calendar\ncalendars: []\n# mentions [[Old]] and the kin\n```\n';
		const files = {
			'Old.md': '',
			'Wrong1.md': 'This note says kin and [[Old]] but holds no tree.\n',
			'Wrong2.md': calendar,
			'Wrong3.md': tree('"[[Elsewhere]]"'),
			'Right.md': tree('"[[Old]]"'),
			'Elsewhere.md': '',
		};
		const s = setup(files, { hooks: { kinNotes: () => new Set(['Wrong1.md', 'Wrong2.md', 'Wrong3.md', 'Right.md']) } });
		const before = new Map(s.texts);
		await s.rename(['Old.md', 'New.md']);
		expect(s.writes).toEqual(['Right.md']);
		for (const p of ['Wrong1.md', 'Wrong2.md', 'Wrong3.md']) expect(s.texts.get(p)).toBe(before.get(p));
		expect(sorted(s.reads)).toEqual(['Right.md', 'Wrong1.md', 'Wrong2.md', 'Wrong3.md']);
	});

	it('a set that lists a path which is not a note any more costs nothing and breaks nothing', async () => {
		const s = setup({ 'Old.md': '', 'T.md': tree('"[[Old]]"') }, { hooks: { kinNotes: () => new Set(['Gone.md', 'T.md']) } });
		await s.rename(['Old.md', 'New.md']);
		expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
		expect(s.reads).toEqual(['T.md']);
	});

	it('a set that is null gives the order of today: a note that shows a tree, then notes with a section that can hold a tree, then notes with no cache; notes with none are not read', async () => {
		const para = { sections: [{ type: 'paragraph' }] };
		const code = { sections: [{ type: 'code' }] };
		const files = {
			'K.md': tree('"[[Old]]"'),
			'T.md': tree('"[[Old]]"'),
			'Q.md': '> [!note]\n> ```kin\n> people:\n>   - id: q\n>     name: Q\n>     link: "[[Old]]"\n> ```\n',
			'L.md': '- item\n',
			'Plain.md': 'Text about [[Old]] and kin.\n',
			'Fresh.md': 'No cache yet.\n',
			'Old.md': '',
		};
		for (const hooks of [{ known: () => ['K.md'], kinNotes: () => null }, { known: () => ['K.md'] }]) {
			resetObsidian();
			const s = setup(files, { hooks });
			s.caches.set('K.md', para);
			s.caches.set('T.md', code);
			s.caches.set('Q.md', { sections: [{ type: 'callout' }] });
			s.caches.set('L.md', { sections: [{ type: 'list' }] });
			s.caches.set('Plain.md', para);
			s.caches.set('New.md', para);
			await s.rename(['Old.md', 'New.md']);
			expect(s.reads).toEqual(['K.md', 'T.md', 'Q.md', 'L.md', 'Fresh.md']);
			expect(bodyOf(s, 'Q.md')).toContain('"[[New]]"');
			expect(s.updater.last).toMatchObject({ notes: 7, read: 5, trees: 3, links: 3, changedTrees: 3 });
		}
	});

	it('a set is read at each rename: the same updater uses the set that is current then, and null after it', async () => {
		let set: ReadonlySet<string> | null = new Set(['T.md']);
		const s = setup({ 'T.md': tree('"[[A]]"', '"[[B]]"'), 'U.md': tree('"[[A]]"'), 'A.md': '', 'B.md': '', 'Pad.md': 'x\n' }, { hooks: { kinNotes: () => set } });
		await s.rename(['A.md', 'A2.md']);
		expect(s.reads).toEqual(['T.md']);
		expect(bodyOf(s, 'U.md')).toContain('"[[A]]"');
		set = null;
		s.reads.length = 0;
		await s.rename(['B.md', 'B2.md']);
		// No cache for any note: all five notes are candidates now.
		expect(s.reads.length).toBe(5);
		expect(bodyOf(s, 'T.md')).toContain('"[[B2]]"');
	});

	it('a folder of 200 notes renamed: one scan with the set, every link changed, a small number of saves', async () => {
		const files: Record<string, string> = { 'Index.md': 'index\n' };
		const people: { id: string; link: string }[] = [];
		for (let i = 0; i < 200; i++) {
			files[`old/n${i}.md`] = `Note ${i}\n`;
			people.push({ id: `p${i}`, link: `"[[n${i}]]"` });
		}
		files['T.md'] = treeOf(people);
		for (let i = 0; i < 100; i++) files[`text/x${i}.md`] = 'text\n';
		let saves = 0;
		const s = setup(files, { hooks: { kinNotes: () => new Set(['T.md']), save: async () => void saves++ } });
		await s.rename(...Array.from({ length: 200 }, (_, i): [string, string] => [`old/n${i}.md`, `new/m${i}.md`]));
		expect(s.reads).toEqual(['T.md']);
		const body = bodyOf(s, 'T.md');
		expect(body.match(/\[\[m\d+\]\]/g)).toHaveLength(200);
		expect(body).not.toContain('[[n');
		expect(s.writes).toEqual(['T.md']);
		expect(notices).toEqual([RENAME_UI.updated(200, 1)]);
		// The events of a folder rename make one save before the scan and one at the end.
		expect(saves).toBeLessThanOrEqual(3);
		expect(s.updater.pendingList()).toEqual([]);
	});

	it('a batch of three renamed pictures: the portrait links in the listed note follow, and nothing else is read', async () => {
		const files = {
			'T.md': treeOf([
				{ id: 'a', portrait: '"[[a1.png]]"' },
				{ id: 'b', portrait: '"[[a2.png]]"' },
				{ id: 'c', portrait: '"[[a3.png]]"' },
			]),
			'Other.md': treeOf([{ id: 'x', portrait: '"[[a1.png]]"' }]),
			...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`text/n${i}.md`, 'text\n'])),
		};
		const s = setup(files, { pictures: ['a1.png', 'a2.png', 'a3.png'], hooks: { kinNotes: () => new Set(['T.md']) } });
		await s.rename(['a1.png', 'b1.png'], ['a2.png', 'b2.png'], ['a3.png', 'b3.png']);
		const body = bodyOf(s, 'T.md');
		expect(body).toContain('portrait: "[[b1.png]]"');
		expect(body).toContain('portrait: "[[b2.png]]"');
		expect(body).toContain('portrait: "[[b3.png]]"');
		expect(s.reads).toEqual(['T.md']);
		expect(s.updater.last?.renames.every((r) => r.picture)).toBe(true);
	});

	it('the text of "Show the last link update" is the text of today, with the vault count and the read count', async () => {
		const files = { 'x/Old.md': '', 'T.md': tree('"[[x/Old]]"'), 'U.md': tree('"[[Old]]"'), 'y/Old.md': '', ...plain(6) };
		const s = setup(files, { hooks: { kinNotes: () => new Set(['T.md', 'U.md']) } });
		await s.rename(['x/Old.md', 'x/New.md']);
		const last = { ...s.updater.last!, ms: 1200 };
		expect(last).toMatchObject({ notes: 10, read: 2 });
		expect(RENAME_UI.report(last, true)).toBe(
			'The last link update was after the rename of “x/Old” to “x/New”. It took 1.2 seconds.\n\nNotes in the vault: 10. Notes that the plugin read: 2.\n\n' +
				'Trees with a link to the renamed note: 2. Changed links: 1. Changed trees: 1.\n\nLinks that the plugin did not change: 1. ' +
				'The link “Old” in the note “U” opens a different note with the same name: “y/Old”.',
		);
	});
});

describe('LinkHooks.save and the stored renames (the index contract 3: LinkUpdater keeps its fields and the coalescing of persist())', () => {
	const entry: PendingRename = { oldPath: 'Old.md', newPath: 'New.md', others: [] };

	it('a folder rename of 200 notes asks for one save before the scan and one after it', async () => {
		const files: Record<string, string> = { 'T.md': tree('"[[old/n0]]"') };
		for (let i = 0; i < 200; i++) files[`old/n${i}.md`] = '';
		const lists: PendingRename[][] = [];
		const holder: { s?: Setup } = {};
		const s = setup(files, { hooks: { save: async () => void lists.push(holder.s!.updater.pendingList()), kinNotes: () => new Set(['T.md']) } });
		holder.s = s;
		await s.rename(...Array.from({ length: 200 }, (_, i): [string, string] => [`old/n${i}.md`, `new/n${i}.md`]));
		expect(lists).toHaveLength(2);
		expect(lists[0]).toHaveLength(200);
		expect(lists[1]).toEqual([]);
	});

	it('a save hook that does not return a promise (the local storage is written at once) works, and the list is stored before the scan', async () => {
		const lists: PendingRename[][] = [];
		const holder: { s?: Setup } = {};
		const hooks = { save: () => void lists.push(holder.s!.updater.pendingList()) };
		const s = setup({ 'T.md': tree('"[[Old]]"'), 'Old.md': '' }, { hooks });
		holder.s = s;
		await s.rename(['Old.md', 'New.md']);
		expect(lists[0]).toEqual([entry]);
		expect(lists[lists.length - 1]).toEqual([]);
		expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
	});

	it('a save hook that throws does not stop the update: the links are still changed', async () => {
		const hooks = {
			save: () => {
				throw new Error('storage full');
			},
		};
		const s = setup({ 'T.md': tree('"[[Old]]"'), 'Old.md': '' }, { hooks });
		await s.rename(['Old.md', 'New.md']);
		expect(bodyOf(s, 'T.md')).toContain('"[[New]]"');
	});
});

describe('two devices that migrate the same stored rename (the index contract 3, "The other device")', () => {
	const entry: PendingRename = { oldPath: 'Old.md', newPath: 'New.md', others: [] };

	it('the second run finds no link that names the old note, and writes nothing; the text is the same as after the first run', async () => {
		const v = vault({ 'T.md': tree('"[[Old]]"', '"[[Old|the old hall]]"'), 'New.md': '', 'Pad.md': 'x\n' });
		const device = () => {
			const handles = new HandleRegistry(v.app as never);
			return new LinkUpdater(v.app as never, handles, () => true, FAST, { kinNotes: () => new Set(['T.md']) } as never);
		};
		const one = device();
		one.restore([entry]);
		one.resume();
		await one.idle();
		expect(v.writes).toEqual(['T.md']);
		const after = v.texts.get('T.md');
		expect(findBlocks(after!)[0].body).toContain('"[[New]]"');
		expect(findBlocks(after!)[0].body).toContain('"[[New|the old hall]]"');

		const two = device();
		two.restore([entry]);
		two.resume();
		await two.idle();
		expect(v.writes).toEqual(['T.md']);
		expect(v.texts.get('T.md')).toBe(after);
		expect(two.pendingList()).toEqual([]);
		expect(two.last).toMatchObject({ links: 0, changedTrees: 0 });
	});

	it('an entry whose new path is gone on this device is dropped and writes nothing', async () => {
		const v = vault({ 'T.md': tree('"[[Old]]"') });
		const updater = new LinkUpdater(v.app as never, new HandleRegistry(v.app as never), () => true, FAST, {} as never);
		updater.restore([entry]);
		updater.resume();
		await updater.idle();
		expect(v.writes).toEqual([]);
		expect(updater.pendingList()).toEqual([]);
	});
});
