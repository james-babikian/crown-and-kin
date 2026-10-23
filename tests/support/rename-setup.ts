/*
 * A cut-down fake vault for the link update after a rename (spec §6.9) on names with accents and punctuation: notes in a map, the real
 * `HandleRegistry` and `LinkUpdater` (no waiting), and `rename`, which moves a note and waits for the updater. Used by `s113-d-rename` and
 * `r113-review-c-rename`, which each had a copy.
 */

import { TFile } from 'obsidian';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { LinkUpdater, type RenameTiming } from '../../src/obsidian/rename-links';

export const FAST: RenameTiming = { resolved: 0, quiet: 0, cap: 50 };
export const tree = (...links: string[]) => ['```kin', 'people:', ...links.map((l, i) => `  - id: p${i}\n    name: P${i}\n    link: ${l}`), '```', ''].join('\n');

export function setup(files: Record<string, string>) {
	const texts = new Map(Object.entries(files));
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const tfiles = new Map<string, TFile>([...texts.keys()].map((p) => [p, new File(p, 'md')]));
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			getMarkdownFiles: () => [...tfiles.values()],
			read: async (f: TFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: TFile) => texts.get(f.path) ?? '',
			process: async (f: TFile, fn: (t: string) => string) => {
				texts.set(f.path, fn(texts.get(f.path) ?? ''));
			},
		},
		metadataCache: {
			on: () => ({}),
			offref: () => undefined,
			getFirstLinkpathDest(linkpath: string) {
				const want = stem(linkpath.replace(/\\/g, '/'));
				for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext: (file: TFile) => file.path.replace(/\.md$/i, '').split('/').pop()!,
			getFileCache: () => null,
		},
		workspace: { getLeavesOfType: () => [] },
	};
	const handles = new HandleRegistry(app as never);
	const updater = new LinkUpdater(app as never, handles, () => true, FAST);
	const rename = async (from: string, to: string) => {
		const f = tfiles.get(from)!;
		tfiles.delete(from);
		f.path = to;
		tfiles.set(to, f);
		texts.set(to, texts.get(from)!);
		texts.delete(from);
		handles.renamed(from, to);
		updater.renamed(f, from);
		await updater.idle();
	};
	return { texts, rename };
}
