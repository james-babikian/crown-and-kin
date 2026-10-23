/*
 * A small fake vault of notes and pictures for the real `LinkUpdater` (the rename of a note or a picture rewrites the tree links).
 * Used by `m9-obsidian-a` and `review-m9-core-rename`, which each had a copy. The notes are in a map; `rename` moves a file the way
 * Obsidian does and waits until the updater is idle.
 */

import { TFile as VaultFile } from 'obsidian';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { LinkUpdater } from '../../src/obsidian/rename-links';
import { untilDone } from '../acceptance/fake-dom';

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

/** A vault file as the store sees it. */
export function vaultFile(path: string, size = 1000, mtime = 1): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime, ctime: 1, size } }) as VaultFile;
}

/** A small vault of notes and pictures for the real LinkUpdater. */
export function renameVault(files: Record<string, string>, pictures: string[]) {
	const texts = new Map(Object.entries(files));
	const all = new Map<string, VaultFile>();
	for (const p of [...texts.keys(), ...pictures]) all.set(p, vaultFile(p));
	const stemOf = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => all.get(p) ?? null,
			getMarkdownFiles: () => [...all.values()].filter((f) => f.extension === 'md'),
			getFiles: () => [...all.values()],
			read: async (f: VaultFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: VaultFile) => texts.get(f.path) ?? '',
			process: async (f: VaultFile, fn: (t: string) => string) => {
				const next = fn(texts.get(f.path) ?? '');
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on: () => ({}),
			offref: () => {},
			getFirstLinkpathDest(linkpath: string) {
				const want = linkpath.toLowerCase();
				for (const [p, f] of all) if (p.toLowerCase() === want || p.toLowerCase().endsWith(`/${want}`) || stemOf(p) === want || stemOf(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext: (f: VaultFile) => (f.extension === 'md' ? f.path.replace(/\.md$/i, '') : f.path).split('/').pop()!,
			getFileCache: () => null,
		},
		workspace: { getLeavesOfType: () => [] },
	};
	const handles = new HandleRegistry(app as never);
	const updater = new LinkUpdater(app as never, handles, () => true, { resolved: 0, quiet: 0, cap: 50 });
	const rename = async (from: string, to: string) => {
		const f = all.get(from)!;
		all.delete(from);
		f.path = to;
		Object.assign(f, { name: to.split('/').pop(), extension: to.split('.').pop() });
		all.set(to, f);
		if (texts.has(from)) {
			texts.set(to, texts.get(from)!);
			texts.delete(from);
		}
		handles.renamed(from, to);
		updater.renamed(f, from);
		await untilDone(updater.idle());
	};
	return { texts, rename };
}
