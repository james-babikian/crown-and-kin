import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));

import { TFile } from 'obsidian';
import { findBlocks } from '../src/core/block-locate';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { LinkUpdater, nameForms, type RenameTiming } from '../src/obsidian/rename-links';
import { resetObsidian } from './acceptance/fake-obsidian';

/*
 * Search round 0.2.3, area D: the link update after a rename (spec §6.9) on names with accents and
 * punctuation. The vault fake is the one of tests/rename-links.test.ts, cut down.
 */

const FAST: RenameTiming = { resolved: 0, quiet: 0, cap: 50 };
const tree = (...links: string[]) => ['```dynasty', 'people:', ...links.map((l, i) => `  - id: p${i}\n    name: P${i}\n    link: ${l}`), '```', ''].join('\n');

function setup(files: Record<string, string>) {
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

beforeEach(() => resetObsidian());

describe('D4 (review C): a link written in another case than the note name is still found', () => {
	// Obsidian finds a note by a name in any case, and the link scan compares lower-case names (spec É6.9).
	// A percent-encoded accent written in lower case ("%C3%A9" for the É of "Émile") is such a link.
	it('"[her](%C3%A9mile.md)" is updated when "Émile.md" is renamed (0.2.2 found it)', async () => {
		const s = setup({ 'Trees.md': tree('"[her](%C3%A9mile.md)"'), 'Émile.md': '' });
		await s.rename('Émile.md', 'Emile Zola.md');
		expect(findBlocks(s.texts.get('Trees.md')!)[0].body).toContain('Emile%20Zola.md');
	});

	it('the filter has the forms of the name in both cases', () => {
		const forms = nameForms('Émile');
		expect(forms).toContain('%c3%a9mile');
		expect(forms).toContain('%c3%89mile');
	});
});
