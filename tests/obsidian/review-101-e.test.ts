import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TFile } from 'obsidian';
import { findBlocks } from '../../src/core/block-locate';
import { deriveFamilies } from '../../src/core/derive';
import type { Op } from '../../src/core/edit';
import { parseDynasty } from '../../src/core/parse';
import { applyOp } from '../../src/core/yaml-edit';
import { HandleRegistry } from '../../src/obsidian/block-handle';
import { EditSheet } from '../../src/obsidian/edit-sheet';
import { insertTree } from '../../src/obsidian/insert-tree';
import DynastyTreePlugin from '../../src/obsidian/main';
import { LinkUpdater } from '../../src/obsidian/rename-links';
import { undoNotice } from '../../src/obsidian/undo-notice';
import { INSERT_UI, SETTINGS_UI } from '../../src/render/ui-text';
import { FEl, clock, dispatch, resetDom, settle, untilDone } from '../acceptance/fake-dom';
import { noticeList, resetObsidian, settingRows, type Plugin as FakePlugin, type TextComponent } from '../acceptance/fake-obsidian';
import { fakeApp, fakeHandle, type FakeHandle } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Code review of version 0.1.1, area E (windows, flows and plugin plumbing): scratch/review-101-e.
 * Each describe block is one finding; every test here fails on release-0.1.1 (d23ba64).
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Edit sheet: a person with no `id` (a warning, spec §8) gets the generated id `~N` (its list
// position). The sheet uses that id as if it were written in the block.
// ---------------------------------------------------------------------------------------------

/** A handle whose writes apply the op to its body, as the real handle does. */
function writingHandle(body: string): FakeHandle & { ops: Op[] } {
	const h = fakeHandle('n.md', body) as FakeHandle & { ops: Op[] };
	h.ops = [];
	h.write.mockImplementation((async (op: Op) => {
		h.ops.push(op);
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.body = r.body;
		return { ok: true, body: r.body, created: r.created, effects: [] };
	}) as never);
	return h;
}

const NO_IDS = ['people:', '  - id: a', '    name: Aldric', '  - name: Bran', '    parents: [a]', '  - name: Cora', '    parents: [a]', ''].join('\n');

function sheetFor(h: FakeHandle, id: string): EditSheet {
	// The fake DOM has no `:not(:disabled)` (moveSibling puts the focus back with it); drop the pseudo-class.
	const qs = FEl.prototype.querySelector;
	vi.spyOn(FEl.prototype, 'querySelector').mockImplementation(function (this: FEl, sel: string) {
		return qs.call(this, sel.replace(':not(:disabled)', ''));
	});
	const s = EditSheet.create({} as never, { handle: h as never, personId: id, sourcePath: 'n.md' })!;
	s.open();
	return s;
}

const el = (s: EditSheet, sel: string) => (s as unknown as { modalEl: FEl }).modalEl.querySelector(sel)!;

function people(body: string) {
	const r = parseDynasty(body);
	if (!r.ok) throw new Error('parse');
	return { tree: r.tree, g: deriveFamilies(r.tree) };
}

describe('review 0.1.1 E: the sheet of a person with no id', () => {
	it('after Move earlier the sheet still shows the same person, and Save edits that person', async () => {
		const h = writingHandle(NO_IDS);
		// Cora is the third entry: generated id ~3.
		const sheet = sheetFor(h, '~3');
		expect((el(sheet, '[data-field="name"] input') as FEl).value).toBe('Cora');
		dispatch(el(sheet, '.dynasty-move-earlier'), 'click');
		await settle();
		// Cora moved to the second place. (Fix round: the move also gives her a written id, the decision notes
		// 0.1.1 area E ruling 1, so this checks her place, not a generated ~2.)
		expect(people(h.body).tree.people[1].name).toBe('Cora');
		// The user stays in Cora's sheet and adds a title.
		const title = el(sheet, '[data-field="title"] input') as FEl;
		title.value = 'Lady of the Marches';
		dispatch(title, 'input');
		dispatch(el(sheet, '.dynasty-sheet-save'), 'click');
		await settle();
		// The sheet reloaded `~3` after the move, so it showed Bran, and Save wrote the title on Bran.
		const after = people(h.body).tree.people;
		expect(after.find((p) => p.name === 'Bran')?.title).toBeUndefined();
		expect(after.find((p) => p.name === 'Cora')?.title).toBe('Lady of the Marches');
	});

	it('Pin focus here writes a focus that names the person (D18)', async () => {
		const h = writingHandle(NO_IDS);
		const sheet = sheetFor(h, '~3');
		dispatch(el(sheet, '.dynasty-pin'), 'click');
		await settle();
		const { tree, g } = people(h.body);
		// Written: `focus: ~3`. That value is now "written in the block", so Cora's generated id becomes ~~3
		// and the pin names nobody (a missing-focus warning); the sheet then says Cora left the tree.
		expect(tree.options.focus).toBeDefined();
		expect(g.byId.get(tree.options.focus!)?.name).toBe('Cora');
	});
});

// ---------------------------------------------------------------------------------------------
// Link update after a rename (spec §6.9): a fake vault, as in review-rename-ios.test.ts.
// ---------------------------------------------------------------------------------------------

const FAST = { resolved: 0, quiet: 0, cap: 20, progress: 60_000 };

function vault(files: [string, string][], enabled: () => boolean = () => true) {
	const texts = new Map(files);
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const tfiles = new Map<string, TFile>(files.map(([p]) => [p, new File(p, 'md')]));
	const writes: string[] = [];
	let afterRead: (() => void) | null = null;
	const stem = (p: string) => p.replace(/\.md$/i, '').toLowerCase();
	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => tfiles.get(p) ?? null,
			getMarkdownFiles: () => [...tfiles.values()],
			read: async (f: TFile) => texts.get(f.path) ?? '',
			cachedRead: async (f: TFile) => {
				afterRead?.();
				return texts.get(f.path) ?? '';
			},
			process: async (f: TFile, fn: (t: string) => string) => {
				const next = fn(texts.get(f.path) ?? '');
				if (next !== texts.get(f.path)) writes.push(f.path);
				texts.set(f.path, next);
				return next;
			},
		},
		metadataCache: {
			on: (name: string, fn: unknown) => ({ name, fn }),
			offref() {},
			getFirstLinkpathDest(linkpath: string) {
				let want = linkpath.split('#')[0].split('|')[0];
				try {
					want = decodeURIComponent(want);
				} catch {
					// as written
				}
				want = stem(want);
				for (const [p, f] of tfiles) if (stem(p) === want || stem(p).endsWith(`/${want}`)) return f;
				return null;
			},
			fileToLinktext: (file: TFile) => file.path.replace(/\.md$/i, '').split('/').pop()!,
			getFileCache: (file: TFile) => ({ sections: [{ type: (texts.get(file.path) ?? '').includes('```') ? 'code' : 'paragraph' }] }),
		},
		workspace: { getLeavesOfType: () => [] },
	};
	const handles = new HandleRegistry(app as never);
	const updater = new LinkUpdater(app as never, handles, enabled, FAST);
	return {
		texts,
		writes,
		updater,
		onRead(fn: (() => void) | null) {
			afterRead = fn;
		},
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
		body: (path: string) => findBlocks(texts.get(path)!)[0].body,
	};
}

const treeNote = (links: string[]) =>
	['# Tree', '', '```kin', 'people:', ...links.flatMap((l, i) => [`  - id: p${i}`, `    name: P${i}`, `    link: ${JSON.stringify(l)}`]), '```', ''].join('\n');

describe('review 0.1.1 E: link update after a rename', () => {
	it('two notes swap names in quick succession: each tree link still opens the note it opened before', async () => {
		const v = vault([
			['Castle.md', '# The castle\n'],
			['Keep.md', '# The keep\n'],
			['Tree.md', treeNote(['[[Castle]]', '[[Keep]]'])],
		]);
		// A swap by hand in the file list: Castle → Tmp, Keep → Castle, Tmp → Keep (one batch).
		v.rename('Castle.md', 'Tmp.md');
		v.rename('Keep.md', 'Castle.md');
		v.rename('Tmp.md', 'Keep.md');
		await untilDone(v.updater.idle());
		// P0 linked the castle note, which is now Keep.md; P1 linked the keep note, which is now Castle.md.
		const body = v.body('Tree.md');
		expect(body).toContain('link: "[[Keep]]"\n  - id: p1');
		expect(body).toMatch(/id: p1\n {4}name: P1\n {4}link: "\[\[Castle\]\]"/);
	});

	it('a Markdown link the plugin itself wrote for a name with brackets is found at the next rename', async () => {
		const v = vault([
			['Keep.md', '# The keep\n'],
			['Tree.md', treeNote(['[the seat](Keep.md)'])],
		]);
		v.rename('Keep.md', 'Castle (old).md');
		await untilDone(v.updater.idle());
		// The plugin writes the new target percent-encoded (the decision notes WP6.1: %, space, ( and )).
		expect(v.body('Tree.md')).toContain('(Castle%20%28old%29.md)');
		v.rename('Castle (old).md', 'Castle.md');
		await untilDone(v.updater.idle());
		// The first filter looks only for "castle (old)" and "castle%20(old)": the note is skipped and the link breaks.
		expect(v.body('Tree.md')).toContain('[the seat](Castle.md)');
	});

	it('the setting is turned off while an update runs: no tree is written after that (note)', async () => {
		let on = true;
		const v = vault(
			[
				['Castle.md', '# The castle\n'],
				['A tree.md', treeNote(['[[Castle]]'])],
				['B tree.md', treeNote(['[[Castle]]'])],
			],
			() => on,
		);
		v.rename('Castle.md', 'Keep.md');
		// The user turns "Update tree links" off as soon as the scan reads its first note.
		v.onRead(() => (on = false));
		await untilDone(v.updater.idle());
		expect(v.writes).toEqual([]);
	});
});

// ---------------------------------------------------------------------------------------------
// Insert family tree (spec §5.9, D34)
// ---------------------------------------------------------------------------------------------

type Pos = { line: number; ch: number };

/** The small editor of tests/obsidian/insert-tree.test.ts. */
function editor(text: string, from: Pos, to: Pos = from) {
	const state = { text, cursor: from as Pos };
	const lines = () => state.text.split('\n');
	const offset = (p: Pos) => lines().slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
	return {
		state,
		getCursor: (which?: 'from' | 'to') => (which === 'to' ? to : from),
		getLine: (n: number) => lines()[n] ?? '',
		lineCount: () => lines().length,
		transaction(t: { changes: { from: Pos; to: Pos; text: string }[]; selection: { from: Pos } }) {
			const c = t.changes[0];
			state.text = state.text.slice(0, offset(c.from)) + c.text + state.text.slice(offset(c.to));
			state.cursor = t.selection.from;
		},
	};
}

const HINT = `# ${INSERT_UI.noteHint}`;
const emptyTrees = (text: string) => findBlocks(text).filter((b) => b.body.trimEnd() === HINT);

describe('review 0.1.1 E: Insert family tree', () => {
	it('with the cursor in a code block that never closes, the note gets a new empty tree', () => {
		const e = editor('Intro\n```js\nlet a = 1;', { line: 2, ch: 3 });
		insertTree(e as never);
		// The tree goes after the end of the note, which is still inside the open ```js block: the
		// "```kin" line is code, and the tree's closing fence closes the js block.
		expect(emptyTrees(e.state.text)).toHaveLength(1);
	});

	it('with the cursor in the note properties (source mode), the properties stay valid', () => {
		const e = editor('---\ntitle: Valmont\ntags: [house]\n---\nBody', { line: 1, ch: 3 });
		insertTree(e as never);
		const lines = e.state.text.split('\n');
		// The fence and the help comment are put between "tit" and "le: Valmont", inside the properties.
		expect(lines.slice(0, 4)).toEqual(['---', 'title: Valmont', 'tags: [house]', '---']);
		expect(emptyTrees(e.state.text)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------------------------
// Plugin unload (main.ts onunload): nothing of the plugin may write after it is turned off.
// ---------------------------------------------------------------------------------------------

describe('review 0.1.1 E: settings (note)', () => {
	it('typing 1200 in the desktop height field stores 1200 only, not 120 on the way', async () => {
		const plugin = new DynastyTreePlugin(fakeApp() as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		await fake.load();
		(fake.settingTabs[0] as unknown as { display(): void }).display();
		const row = settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.heightDesktop)!;
		const text = row.components[0] as TextComponent;
		const heights: number[] = [];
		for (const v of ['1', '12', '120', '1200']) {
			text.fire(v);
			heights.push(plugin.settings.embedHeightDesktop);
		}
		await settle();
		// Each key press that makes a value in range (here "120") becomes the setting at once: every open
		// tree is drawn 120 px high, and data.json is written once per such key press.
		expect(heights).not.toContain(120);
		expect(fake.saved).toHaveLength(1);
	});
});

describe('review 0.1.1 E: a rename while the plugin loads (note)', () => {
	it('a rename before data.json is read neither uses the default "update links" nor stores the default settings', async () => {
		const app = fakeApp();
		Object.assign(app.vault, { getMarkdownFiles: () => [], getAbstractFileByPath: () => null });
		const plugin = new DynastyTreePlugin(app as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		const stored = { embedHeightDesktop: 800, embedHeightPhone: 60, cardSize: 'compact', showDates: false, focusGenerations: 3, updateLinks: false };
		let read!: (v: unknown) => void;
		fake.loadData = () => new Promise((r) => (read = r));
		const loading = fake.load();
		// Obsidian Sync or another plugin renames a note while data.json is still being read.
		const File = TFile as unknown as new (path: string, extension: string) => TFile;
		(app.vault as unknown as { fire(n: string, ...a: unknown[]): void }).fire('rename', new File('Keep.md', 'md'), 'Castle.md');
		await settle();
		read(stored);
		await loading;
		await untilDone(plugin.links.idle());
		// The user turned "Update tree links" off, so no rename waits; data.json keeps the user's settings.
		expect(plugin.links.pendingList()).toEqual([]);
		for (const s of fake.saved as Record<string, unknown>[]) expect(s.embedHeightDesktop).toBe(800);
	});
});

describe('review 0.1.1 E: after unload (note)', () => {
	it('the Undo button of a delete Notice does nothing after the plugin is turned off', async () => {
		const plugin = new DynastyTreePlugin(fakeApp() as never, { id: 'crown-and-kin' } as never);
		const fake = plugin as unknown as FakePlugin;
		await fake.load();
		const h = fakeHandle('n.md', NO_IDS);
		// A delete from the edit sheet shows this Notice (edit-sheet.ts deletePerson); it stays 10 s.
		undoNotice('Aldric was deleted.', h as never, NO_IDS);
		fake.unload();
		const notice = noticeList[noticeList.length - 1];
		dispatch(notice.noticeEl.querySelector('.dynasty-undo-button')!, 'click');
		await settle();
		expect(h.undo).not.toHaveBeenCalled();
	});
});
