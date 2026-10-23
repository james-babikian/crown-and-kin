/*
 * 0.3 package D (T4): runs random renames on a random vault with the real `LinkUpdater` and the real handles, on a fake
 * vault. Not a test file: the test files that import it mock `obsidian` with `./acceptance/fake-obsidian`.
 */

import { TFile } from 'obsidian';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { LinkUpdater, type RenameTiming } from '../../src/obsidian/rename-links';
import { rng } from './r028-advb-gen';
import { checkNotes, expectedKind, extOf, genVault, linkTextFor, movesOf, PICTURE_EXTENSIONS, randomRename, render, resolveLink, type Vault } from './r030-d-vault-gen';

const FAST: RenameTiming = { resolved: 0, quiet: 0, cap: 50 };

export function fakeApp(v: Vault) {
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const byId = new Map<number, TFile>();
	const byPath = new Map<string, TFile>();
	const ids = new Map<TFile, number>();
	const texts = new Map<string, string>();
	const writes: string[] = [];
	for (const f of v.files) {
		const t = new File(f.path, extOf(f.path));
		byId.set(f.id, t);
		byPath.set(f.path, t);
		ids.set(t, f.id);
		const note = v.notes.get(f.id);
		if (note) texts.set(f.path, render(note));
	}
	const allPaths = () => [...byPath.keys()];
	const mdFiles = () => [...byPath.values()].filter((f) => f.extension.toLowerCase() === 'md');
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getMarkdownFiles: mdFiles,
			getFiles: () => [...byPath.values()],
			read: async (f: TFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: TFile) => texts.get(f.path) ?? '',
			process: async (f: TFile, fn: (t: string) => string) => {
				const next = fn(texts.get(f.path) ?? '');
				if (next !== texts.get(f.path)) writes.push(f.path);
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on: () => ({}),
			offref: () => {},
			getFirstLinkpathDest: (link: string) => {
				const p = resolveLink(allPaths(), link);
				return p ? (byPath.get(p) ?? null) : null;
			},
			fileToLinktext: (f: TFile) => linkTextFor(allPaths(), f.path, v.absolute),
			getFileCache: (f: TFile) => {
				const note = v.notes.get(ids.get(f) ?? -1);
				return note?.sections ? { sections: note.sections.map((type) => ({ type })) } : null;
			},
		},
		workspace: { getLeavesOfType: () => [] as unknown[] },
	};
	return {
		app,
		texts,
		writes,
		/** Obsidian renames a file: the object stays, the path changes, the text goes with it. */
		move(id: number, to: string) {
			const t = byId.get(id)!;
			const from = t.path;
			byPath.delete(from);
			t.path = to;
			t.extension = extOf(to);
			byPath.set(to, t);
			const text = texts.get(from);
			texts.delete(from);
			if (text !== undefined) texts.set(to, text);
			return { file: t, from };
		},
	};
}

export interface Outcome {
	problems: string[];
	steps: number;
	written: number;
}

export interface RunStats {
	kinds: Map<string, number>;
	changedValues: number;
	features: Map<string, number>;
}

/** A vault with a real `LinkUpdater`; `rename` makes Obsidian's moves, sends the events, waits, and checks every note. */
export function session(v: Vault, enabledAtStart = true) {
	const fake = fakeApp(v);
	const handles = new HandleRegistry(fake.app as never);
	const enabled = { value: enabledAtStart };
	const updater = new LinkUpdater(fake.app as never, handles, () => enabled.value, FAST);
	return {
		fake,
		handles,
		updater,
		enabled,
		/** One rename step. Returns the problems found and the number of notes the plugin wrote. */
		async rename(moves: { id: number; from: string; to: string }[], label: string, stats?: RunStats): Promise<{ problems: string[]; written: number }> {
			// Obsidian moves every file, then sends one event for each.
			const pathsBefore = new Map(v.files.map((f) => [f.id, f.path] as const));
			const events = moves.map((m) => fake.move(m.id, m.to));
			for (const m of moves) {
				const k = expectedKind(m.from, m.to) ?? 'none';
				stats?.kinds.set(k, (stats.kinds.get(k) ?? 0) + 1);
			}
			for (const [i, e] of events.entries()) {
				handles.renamed(e.from, moves[i].to);
				updater.renamed(e.file, e.from);
			}
			await updater.idle();
			// The vault as the generator knows it now.
			const updated = new Set<number>();
			for (const m of moves) {
				const f = v.files.find((x) => x.id === m.id)!;
				f.path = m.to;
				const e = extOf(m.to);
				f.kind = e === 'md' ? 'note' : PICTURE_EXTENSIONS.includes(e) ? 'picture' : 'other';
				if (expectedKind(m.from, m.to) !== null && enabled.value) updated.add(m.id);
			}
			const now = new Map(v.files.map((f) => [f.id, f.path] as const));
			const beforeLines = new Map([...v.notes].map(([id, n]) => [id, n.lines.map((l) => ('exact' in l ? '' : l.val.written)).join('\u0000')]));
			const problems = checkNotes(v, fake.texts, now, { updated, setting: enabled.value, label, pathsBefore });
			for (const [id, n] of v.notes) {
				if (n.lines.map((l) => ('exact' in l ? '' : l.val.written)).join('\u0000') !== beforeLines.get(id)) {
					if (stats) stats.changedValues++;
					stats?.features.set('note with changed links', (stats.features.get('note with changed links') ?? 0) + 1);
				}
			}
			// A rename that the setting or the extension rules out writes nothing at all.
			if (updated.size === 0 && fake.writes.length !== 0) problems.push(`${label}: no update was due and the plugin wrote ${fake.writes.join(', ')}`);
			const written = fake.writes.length;
			fake.writes.length = 0;
			return { problems, written };
		},
	};
}

export async function runVaultAsync(seed: number, stats: RunStats): Promise<Outcome> {
	const rand = rng(seed * 31 + 7);
	const v = genVault(seed);
	const s = session(v, rand() > 0.08);
	const out: Outcome = { problems: [], steps: 0, written: 0 };
	const steps = 1 + Math.floor(rand() * 3);
	const bump = (k: string) => stats.features.set(k, (stats.features.get(k) ?? 0) + 1);
	if (v.absolute) bump('absolute links');
	if (!s.enabled.value) bump('setting off');
	for (let n = 1; n <= steps; n++) {
		const step = randomRename(rand, v);
		const moves = movesOf(v, step);
		if (moves.length === 0) continue;
		bump(step.what);
		const label = `seed ${seed} step ${n} (${step.what === 'folder' ? `folder ${step.from} -> ${step.to}` : `${moves[0].from} -> ${moves[0].to}`})`;
		const r = await s.rename(moves, label, stats);
		out.steps++;
		out.problems.push(...r.problems);
		out.written += r.written;
		if (out.problems.length) break;
	}
	s.updater.stop();
	return out;
}
