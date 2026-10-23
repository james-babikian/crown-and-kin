import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCalendars } from '../../src/obsidian/calendar-feature';
import { TreeView } from '../../src/obsidian/tree-view';
import { CALENDAR_UI } from '../../src/render/calendar-text';
import { calVault, calendarNotesOf, cycleNote, eraNote, fakeCalApp, firstCalendarName, lastModal, makeIndex, openModals, saveWindow, settleReal, hasField } from '../support/r04-calendar-fakes';
import { FEl, resetDom } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { embed, fakeHandle, fakeHost, type Host } from './tree-view-fakes';
import { settle } from './fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.4 WP-3a, step T0, package C: `TreeView.calendarTree()` and the command "Open the Calendars window" (the index contract 4.3, "When the key may be written"; test list 10).
 * `calendarTree()` gives { treePath, link, setLink }. `link` is undefined only for a parsed tree with no key. `setLink` is not null only then, and only when the tree can be written: a tree that
 * has not drawn, has a parse problem, is read-only, or names a note gets null. `setLink` reads the body of the handle at write time and answers 'has-key' if a key is there now, else writes
 * `set-option calendar`. The command uses `calendarTree()` of the tree of the active note only when the note has exactly one tree view; else it gives the window no way to write a key.
 * Written from the contract before the code existed; package C built the code and turned the tests on.
 */

useFakeDom({ window: true, css: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

type SetLinkResult = 'ok' | 'has-key' | 'failed';
interface CalendarTreeShape {
	treePath: string;
	link: string | undefined;
	setLink: ((link: string) => Promise<SetLinkResult>) | null;
}
const calendarTreeOf = (view: unknown): CalendarTreeShape => (view as { calendarTree(): CalendarTreeShape }).calendarTree();

const PEOPLE = ['people:', '  - id: a', '    name: A', ''].join('\n');
const PLAIN_TREE = PEOPLE;
const KEYED_TREE = ['options:', '  calendar: "[[Cal]]"', PEOPLE].join('\n');

async function mount(source: string, o: { writable?: boolean; index?: boolean } = {}) {
	const host = fakeHost();
	if (o.index !== false) (host as unknown as { dates: unknown }).dates = await makeIndex(calVault({}));
	const handle = o.writable === false ? null : fakeHandle('n.md', source);
	const m = await embed(source, { host, handle });
	return { ...m, handle };
}

/** A tree view that has loaded, with no size set: a tree that shows an error has no viewport (`embed` needs one). */
async function mountRaw(source: string, handle: ReturnType<typeof fakeHandle> | null, host: Host = fakeHost()) {
	const registry: Record<string, () => unknown> = handle ? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false } : { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	(host as unknown as { dates: unknown }).dates = await makeIndex(calVault({}));
	const info = { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => undefined };
	const view = new TreeView(host as never, new FEl('div') as never, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	return { view, handle, host };
}

describe('TreeView.calendarTree (the index contract 4.3)', () => {
	it('a parsed tree with no key that can be written: the link is undefined and setLink is a function', async () => {
		const m = await mount(PLAIN_TREE);
		const t = calendarTreeOf(m.view);
		expect(t.treePath).toBe('n.md');
		expect(t.link).toBeUndefined();
		expect(typeof t.setLink).toBe('function');
	});

	it('setLink writes set-option calendar through the handle and says "ok"', async () => {
		const m = await mount(PLAIN_TREE);
		const write = vi.fn<(op: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
		(m.handle as unknown as { write: unknown }).write = write;
		const result = await calendarTreeOf(m.view).setLink!('[[Cal]]');
		expect(result).toBe('ok');
		expect(write).toHaveBeenCalledTimes(1);
		expect(write.mock.calls[0][0]).toMatchObject({ kind: 'set-option', key: 'calendar', value: '[[Cal]]' });
	});

	it('setLink says "failed" when the write fails', async () => {
		const m = await mount(PLAIN_TREE);
		(m.handle as unknown as { write: unknown }).write = vi.fn(async () => ({ ok: false, code: 'stale' }));
		expect(await calendarTreeOf(m.view).setLink!('[[Cal]]')).toBe('failed');
	});

	it('setLink reads the body at write time: a key that a sync added meanwhile gives "has-key", and nothing is written', async () => {
		const m = await mount(PLAIN_TREE);
		const write = vi.fn<(op: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
		(m.handle as unknown as { write: unknown }).write = write;
		const t = calendarTreeOf(m.view);
		// The note changes after the window opened: the handle now holds a body with a key.
		m.handle!.body = KEYED_TREE;
		expect(await t.setLink!('[[Other]]')).toBe('has-key');
		expect(write).not.toHaveBeenCalled();
	});

	it('a tree that names a note: the link as written, and setLink is null', async () => {
		const m = await mount(KEYED_TREE);
		const t = calendarTreeOf(m.view);
		expect(t.link).toBe('[[Cal]]');
		expect(t.setLink).toBeNull();
	});

	it('a read-only tree (no handle: a transclusion or a Canvas card): setLink is null', async () => {
		const m = await mount(PLAIN_TREE, { writable: false });
		const t = calendarTreeOf(m.view);
		expect(t.treePath).toBe('n.md');
		expect(t.setLink).toBeNull();
	});

	it('a tree with a parse problem: setLink is null', async () => {
		const bad = ['people:', '  - id: a', '   name: [oops', ''].join('\n');
		const m = await mountRaw(bad, fakeHandle('n.md', bad));
		expect(calendarTreeOf(m.view).setLink).toBeNull();
	});

	it('a tree with a blocking problem (the same id two times): setLink is null', async () => {
		const m = await mount(['people:', '  - id: a', '    name: A', '  - id: a', '    name: B', ''].join('\n'));
		expect(calendarTreeOf(m.view).setLink).toBeNull();
	});

	it('a tree that has not drawn yet: setLink is null', () => {
		const host = fakeHost();
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => null, addChild: () => undefined };
		const view = new TreeView(host as never, el as never, PLAIN_TREE, { kind: 'embed', ctx } as never);
		const t = calendarTreeOf(view);
		expect(t.setLink).toBeNull();
	});

	it('an empty key (calendar: with no value) counts as no key', async () => {
		const m = await mount(['options:', '  calendar:', PEOPLE].join('\n'));
		const t = calendarTreeOf(m.view);
		expect(t.link === undefined || t.link === '').toBe(true);
	});
});

describe('the command "Open the Calendars window" (the index contract 4.3)', () => {
	const ALPHA = 'Worlds/Alpha.md';
	const BETA = 'Beta.md';
	const FILES = { [ALPHA]: cycleNote('Alpha Count'), [BETA]: eraNote('Beta Eras', 'Aldric', 100), 'tree.md': 'plain' };

	interface FakeView {
		notePath: string;
		isFull: boolean;
		offScreen: boolean;
		stateKey: string;
		datesChanged(): void;
		calendarTree(): CalendarTreeShape;
	}

	async function setup(views: (spy: ReturnType<typeof vi.fn>) => FakeView[], links: Record<string, string> = {}) {
		const { app, notes } = fakeCalApp(FILES);
		app.workspace.getActiveFile = () => ({ path: 'tree.md' });
		const vault = calVault({}, links);
		vault.notes = notes;
		const index = await makeIndex(vault, { notes: () => calendarNotesOf(notes) });
		await index.start();
		const spy = vi.fn<(link: string) => Promise<SetLinkResult>>(async () => 'ok');
		const commands: { id: string; name: string; callback: () => void }[] = [];
		const plugin = {
			app,
			views: new Set(views(spy)),
			register: () => undefined,
			addCommand: (c: { id: string; name: string; callback: () => void }) => void commands.push(c),
			registerMarkdownCodeBlockProcessor: () => undefined,
		};
		registerCalendars(plugin as never, index as never);
		const command = commands.find((c) => c.id === 'open-calendars')!;
		return { plugin, command, spy, notes, index };
	}

	// Each fake view is a block of its own unless a test gives two views the same state key.
	let blockNumber = 0;
	const view = (tree: (spy: ReturnType<typeof vi.fn>) => CalendarTreeShape, o: Partial<FakeView> = {}) => (spy: ReturnType<typeof vi.fn>): FakeView => ({
		notePath: 'tree.md',
		isFull: false,
		offScreen: false,
		stateKey: `block-${blockNumber++}`,
		datesChanged: () => undefined,
		calendarTree: () => tree(spy),
		...o,
	});
	const noKey = (spy: ReturnType<typeof vi.fn>): CalendarTreeShape => ({ treePath: 'tree.md', link: undefined, setLink: spy as never });

	it('the command is there, with its name', async () => {
		const s = await setup(() => []);
		expect(s.command).toBeDefined();
		expect(s.command.name).toBe(CALENDAR_UI.command);
	});

	it('the active note has one tree view: the window gets its calendarTree(), and a Save writes the key to the first note', async () => {
		const s = await setup((spy) => [view(noKey)(spy)]);
		s.command.callback();
		await settleReal();
		expect(openModals).toHaveLength(1);
		await saveWindow(lastModal().contentEl);
		expect(s.spy).toHaveBeenCalledTimes(1);
		expect(s.spy).toHaveBeenCalledWith('[[Alpha]]');
	});

	it('Reading view: the hidden editor draws the same block, so it is one tree and a Save writes the key', async () => {
		const s = await setup((spy) => [view(noKey, { stateKey: 'same' })(spy), view(noKey, { stateKey: 'same', offScreen: true })(spy)]);
		s.command.callback();
		await settleReal();
		await saveWindow(lastModal().contentEl);
		expect(s.spy).toHaveBeenCalledTimes(1);
	});

	it('the active note has two tree views: the window opens, and it has no way to write a key', async () => {
		const s = await setup((spy) => [view(noKey)(spy), view(noKey)(spy)]);
		s.command.callback();
		await settleReal();
		expect(openModals).toHaveLength(1);
		await saveWindow(lastModal().contentEl);
		expect(s.spy).not.toHaveBeenCalled();
	});

	it('the active note has no tree: the window opens on the first note, and no key is written', async () => {
		const s = await setup(() => []);
		s.command.callback();
		await settleReal();
		expect(openModals).toHaveLength(1);
		const c = lastModal().contentEl;
		expect(firstCalendarName(c)).toBe('Alpha Count');
		await saveWindow(c);
		expect(s.spy).not.toHaveBeenCalled();
	});

	it('a tree view of another note does not count', async () => {
		const s = await setup((spy) => [view(noKey, { notePath: 'other.md' })(spy)]);
		s.command.callback();
		await settleReal();
		expect(openModals).toHaveLength(1);
		await saveWindow(lastModal().contentEl);
		expect(s.spy).not.toHaveBeenCalled();
	});

	it('the tree of the note names a calendar note: the window shows that note only, and Save keeps the key', async () => {
		const s = await setup((spy) => [view(() => ({ treePath: 'tree.md', link: '[[Beta]]', setLink: spy as never }))(spy)], { '[[Beta]]': BETA });
		s.command.callback();
		await settleReal();
		const c = lastModal().contentEl;
		expect(hasField(c, 'note')).toBe(false);
		expect(firstCalendarName(c)).toBe('Beta Eras');
		await saveWindow(c);
		expect(s.spy).not.toHaveBeenCalled();
	});
});
