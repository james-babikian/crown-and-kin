import { beforeEach, describe, expect, it } from 'vitest';

import { TFile } from 'obsidian';
import { findBlocks } from '../../src/core/block-locate';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { LinkUpdater } from '../../src/obsidian/rename-links';
import { notices, resetObsidian } from '../acceptance/fake-obsidian';

/*
 * Code review (scratch/review-rename-ios): the M6 phone test, "Rename a note" on the owner's iPhone.
 * The owner renamed "Dynasty Tree test/Castle Valmont.md" to "Castle Ardent" in the file list of a large
 * vault; the closed note "Rename test.md" never changed and no Notice came.
 *
 * Obsidian mobile (1.13.7 app.js, the Capacitor adapter `dC`) sends every `read`, `write` and `process`
 * through one serial promise queue (`this.queue`), each a call over the native bridge. The fake vault
 * below does the same: one read at a time, with a virtual clock of PHONE_READ_MS per read of a note that
 * is not in Obsidian's text cache. The notes are the phone test notes, byte for byte.
 */

const RENAME_TEST = [
	'# Rename test',
	'',
	'Use this tree for the rename test of the milestone 6 phone test.',
	'',
	'```kin',
	'people:',
	'  - id: aldric',
	'    name: Aldric Valmont',
	'    born: 1102',
	'    link: "[[Castle Valmont]]"',
	'  - id: roderick',
	'    name: Roderick Valmont',
	'    born: 1131',
	'    parents: [aldric]',
	'    link: "[[Castle Valmont#Towers|the castle]]"',
	'```',
	'',
].join('\n');
const CASTLE = '# Castle Valmont\n\nThe seat of House Valmont. Rename this note in the rename test.\n';

/** A low figure for one uncached note read on an iPhone (a native bridge call, one at a time). */
const PHONE_READ_MS = 2;
const FAST = { resolved: 0, quiet: 0, cap: 50 };

interface Listener {
	name: string;
	fn: (...a: unknown[]) => void;
}

/**
 * `indexed`: Obsidian's metadata cache knows every note (on a phone it is kept between starts), with a
 * `code` section for a note with a fence. `none`: no note has a cache entry yet (just after the first start).
 */
function phoneVault(files: [string, string][], cache: 'indexed' | 'none' = 'indexed') {
	const texts = new Map(files);
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const tfiles = new Map<string, TFile>(files.map(([p]) => [p, new File(p, 'md')]));
	const cached = new Set<string>();
	const listeners: Listener[] = [];
	const clock = { ms: 0, reads: 0 };
	const writes: { path: string; at: number }[] = [];
	let afterRead: ((reads: number) => void) | null = null;
	let tail: Promise<unknown> = Promise.resolve();
	/** Obsidian mobile's adapter queue: one file operation at a time. */
	const queue = <T>(fn: () => T): Promise<T> => {
		const run = tail.then(fn, fn);
		tail = run.catch(() => undefined);
		return run;
	};
	const read = (f: TFile) =>
		queue(() => {
			clock.ms += PHONE_READ_MS;
			clock.reads++;
			cached.add(f.path);
			afterRead?.(clock.reads);
			return texts.get(f.path) ?? '';
		});
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			getMarkdownFiles: () => [...tfiles.values()],
			read,
			cachedRead: (f: TFile) => (cached.has(f.path) ? Promise.resolve(texts.get(f.path) ?? '') : read(f)),
			process: (f: TFile, fn: (t: string) => string) =>
				queue(() => {
					const next = fn(texts.get(f.path) ?? '');
					if (next !== texts.get(f.path)) writes.push({ path: f.path, at: clock.ms });
					texts.set(f.path, next);
					return next;
				}),
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
			getFirstLinkpathDest(linkpath: string) {
				const want = stem(linkpath.split('#')[0].split('|')[0]);
				for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext(file: TFile) {
				return file.path.replace(/\.md$/i, '').split('/').pop()!;
			},
			getFileCache(file: TFile) {
				if (cache === 'none') return null;
				const text = texts.get(file.path) ?? '';
				return { sections: [{ type: text.includes('```') ? 'code' : 'paragraph' }] };
			},
		},
		workspace: { getLeavesOfType: () => [] },
	};
	const handles = new HandleRegistry(app as never);
	const updater = new LinkUpdater(app as never, handles, () => true, FAST);
	return {
		app,
		texts,
		clock,
		writes,
		updater,
		onRead(fn: ((reads: number) => void) | null) {
			afterRead = fn;
		},
		/** Obsidian creates a note (as `workspace.openLinkText` does for a link that leads to no note). */
		create(path: string, text: string) {
			texts.set(path, text);
			tfiles.set(path, new File(path, 'md'));
		},
		/** `vault.on('rename')` as main.ts handles it. */
		rename(from: string, to: string) {
			const f = tfiles.get(from)!;
			tfiles.delete(from);
			f.path = to;
			tfiles.set(to, f);
			texts.set(to, texts.get(from)!);
			texts.delete(from);
			handles.renamed(from, to);
			updater.renamed(f, from);
		},
	};
}

/** `count` ordinary notes (no tree), then the phone test folder, as a folder synced in last is listed last. */
function ownerVault(count: number): [string, string][] {
	const notes: [string, string][] = [];
	for (let i = 0; i < count; i++) notes.push([`Notes/Note ${i}.md`, `# Note ${i}\n\nSome text about the world, with a [[link]] or two.\n`]);
	notes.push(['Dynasty Tree test/Castle Valmont.md', CASTLE], ['Dynasty Tree test/Rename test.md', RENAME_TEST]);
	return notes;
}

beforeEach(() => resetObsidian());

describe('review: rename on the iPhone (spec §6.9, D6, D35)', () => {
	it('small vault: the phone test notes alone are updated (the desktop harness result)', async () => {
		const v = phoneVault(ownerVault(0));
		v.rename('Dynasty Tree test/Castle Valmont.md', 'Dynasty Tree test/Castle Ardent.md');
		await v.updater.idle();
		const body = findBlocks(v.texts.get('Dynasty Tree test/Rename test.md')!)[0].body;
		expect(body).toContain('link: "[[Castle Ardent]]"');
		expect(body).toContain('link: "[[Castle Ardent#Towers|the castle]]"');
		expect(notices).toEqual(['The plugin changed 2 links in 1 tree.']);
	});

	it('a vault of 10 000 notes (was: the one tree is written only after every note was read): only the tree note is read', async () => {
		const v = phoneVault(ownerVault(10_000));
		v.rename('Dynasty Tree test/Castle Valmont.md', 'Dynasty Tree test/Castle Ardent.md');
		await v.updater.idle();
		const w = v.writes.find((x) => x.path === 'Dynasty Tree test/Rename test.md');
		expect(w).toBeDefined();
		// Fix round (the decision notes "M6 iPhone test"): the metadata cache (in memory) names the notes that can hold
		// a tree; only those are read. Budget: the tree note is read twice (the name filter, then its handle),
		// no other note is read, and the write comes after 2 phone reads (was: 10 003 reads, 20 s).
		expect(v.clock.reads, `notes read: ${v.clock.reads}; phone time at the write: ${w!.at} ms`).toBeLessThanOrEqual(2);
		expect(w!.at).toBeLessThanOrEqual(2 * PHONE_READ_MS);
		expect(notices).toEqual(['The plugin changed 2 links in 1 tree.']);
	}, 60_000);

	it('the same vault before Obsidian has a cache of its notes: every note is read, and the tree still changes', async () => {
		const v = phoneVault(ownerVault(10_000), 'none');
		v.rename('Dynasty Tree test/Castle Valmont.md', 'Dynasty Tree test/Castle Ardent.md');
		await v.updater.idle();
		// A note with no cache entry can hold a tree: it is read. This is the slow case of the review; the
		// progress Notice (after 2 s, not in this virtual time) tells the user that an update comes.
		expect(v.clock.reads).toBe(10_003);
		expect(v.writes.map((x) => x.path)).toEqual(['Dynasty Tree test/Rename test.md']);
		expect(notices).toEqual(['The plugin changed 2 links in 1 tree.']);
	}, 60_000);

	it('the user opens the stale link while the scan runs (phone test step 2): the new empty note does not stop the update', async () => {
		// No cache: the scan reads every note, so the new note comes in the middle of the scan (read 500).
		const v = phoneVault(ownerVault(2000), 'none');
		// Step 2 of the phone test: "Open the note Rename test, tap Aldric, tap Open linked note". The tree still
		// says [[Castle Valmont]], which leads to no note, so `workspace.openLinkText` creates "Castle Valmont.md"
		// (app.js 1.13.7: openLinkText -> fileManager.createNewFile when getFirstLinkpathDest is null).
		v.onRead((n) => {
			if (n === 500) v.create('Castle Valmont.md', '');
		});
		v.rename('Dynasty Tree test/Castle Valmont.md', 'Dynasty Tree test/Castle Ardent.md');
		await v.updater.idle();
		const body = findBlocks(v.texts.get('Dynasty Tree test/Rename test.md')!)[0].body;
		// At the rename, both links led to the renamed note; the plugin decides only when the scan reaches the
		// tree, and then "[[Castle Valmont]]" finds the new empty note: the tree keeps the old links, silently.
		expect({ body, notices: [...notices] }).toEqual({ body: expect.stringContaining('[[Castle Ardent]]'), notices: ['The plugin changed 2 links in 1 tree.'] });
	}, 60_000);

	it('the same with the cache: the new empty note comes before the one read of the tree note', async () => {
		const v = phoneVault(ownerVault(2000));
		v.onRead((n) => {
			if (n === 1) v.create('Castle Valmont.md', '');
		});
		v.rename('Dynasty Tree test/Castle Valmont.md', 'Dynasty Tree test/Castle Ardent.md');
		await v.updater.idle();
		const body = findBlocks(v.texts.get('Dynasty Tree test/Rename test.md')!)[0].body;
		expect(body).toContain('link: "[[Castle Ardent]]"');
		expect(body).toContain('link: "[[Castle Ardent#Towers|the castle]]"');
		expect(notices).toEqual(['The plugin changed 2 links in 1 tree.']);
	});
});
