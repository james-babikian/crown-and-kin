import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile as VaultFile } from 'obsidian';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { LinkUpdater } from '../src/obsidian/rename-links';
import { fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';

/*
 * code-reviewer, M9 core (WP 9.1). The finding of review-m9-core-links.test.ts, end to end: the real
 * LinkUpdater and the rewrite-links op (fake vault copied from m9-obsidian-a.test.ts, B16).
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
});

const File = VaultFile as unknown as new (path: string, extension: string) => VaultFile;

function file(path: string): VaultFile {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	const f = new File(path, dot < 0 ? '' : name.slice(dot + 1).toLowerCase());
	return Object.assign(f, { name, basename: dot < 0 ? name : name.slice(0, dot), stat: { mtime: 1, ctime: 1, size: 1000 } }) as VaultFile;
}

function vault(files: Record<string, string>, pictures: string[]) {
	const texts = new Map(Object.entries(files));
	const all = new Map<string, VaultFile>();
	for (const p of [...texts.keys(), ...pictures]) all.set(p, file(p));
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
		await updater.idle();
	};
	return { texts, rename };
}

const NOTE = ['```kin', 'people:', '  - id: a', '    name: A', '    link: "[[x.png.md]]"', '    portrait: "[[x.png]]"', '```', ''].join('\n');

describe('review M9 core: a rename in the vault, note "x.png.md" and picture "x.png"', () => {
	it('the rename of the note x.png.md keeps the portrait x.png', async () => {
		const v = vault({ 'Tree.md': NOTE, 'x.png.md': 'A note.' }, ['x.png']);
		await v.rename('x.png.md', 'y.md');
		expect(v.texts.get('Tree.md')).toContain('    portrait: "[[x.png]]"');
	});

	it('the rename of the picture x.png keeps the link to the note x.png.md', async () => {
		const v = vault({ 'Tree.md': NOTE, 'x.png.md': 'A note.' }, ['x.png']);
		await v.rename('x.png', 'z.png');
		expect(v.texts.get('Tree.md')).toContain('    link: "[[x.png.md]]"');
	});
});
