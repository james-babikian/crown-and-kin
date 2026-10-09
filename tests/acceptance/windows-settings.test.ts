import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { findBlocks } from '../../src/core/block-locate';
import { focusSubgraph } from '../../src/core/focus-subgraph';
import { parseDynasty } from '../../src/core/parse';
import { geometryFor } from '../../src/layout/geometry';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import DynastyTreePlugin from '../../src/obsidian/main';
import { DEFAULT_SETTINGS } from '../../src/obsidian/settings';
import { Popover } from '../../src/render/dom/widgets';
import { ADD_UI, INSERT_UI, RENAME_UI, SETTINGS_UI } from '../../src/render/ui-text';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, device, dispatch, dispatchWindow, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './fake-dom';
import { notices, resetObsidian, settingGroups, settingRows, type DropdownComponent, type Plugin as FakePlugin, type TextAreaComponent, type TextComponent, type ToggleComponent } from './fake-obsidian';
import { FAR, desktop, embed, fakeApp, fakeHandle, fullViews, openFullScreen, phone, phoneOnSide, type Host } from './tree-view-fakes';

const last = <T>(a: T[]): T | undefined => a[a.length - 1];

/*
 * WP6.3: the settings tab (spec §9, D33) wired into the views (D30 heights, dates, focus
 * generations), the command Insert family tree (spec §5.9, D34) and keyboard access (spec §5.2:
 * Tab order, Esc on the legend and the partner list). The real plugin (main.ts) and TreeView run on the fakes.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const TREE = `people:
  - id: aldric
    name: Aldric Valmont
    born: '1102'
    died: '1161'
  - id: roderick
    name: Roderick Valmont
    born: '1131'
    parents: [aldric]
`;

const withHeight = (h: number) => `options:\n  height: ${h}\n\n${TREE}`;

/** A line of nine generations p0 → p8, pinned on p4 (D18): focus mode with any number of generations. */
const LINE = `options:\n  focus: p4\n\npeople:\n${Array.from({ length: 9 }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n')}\n`;

/** The real plugin with `stored` as its data.json, loaded. */
async function loadPlugin(stored: unknown = null) {
	const app = fakeApp();
	const plugin = new DynastyTreePlugin(app as never, { id: 'dynasty-tree' } as never);
	const fake = plugin as unknown as FakePlugin;
	fake.stored = stored;
	await fake.load();
	return { plugin, fake, host: plugin as unknown as Host };
}

async function tree(source: string, host: Host) {
	return embed(source, { host, handle: fakeHandle('n.md', source) });
}

const height = (vp: FEl) => vp.styleProps.get('--dynasty-height');

/** The control of the setting with this name, from the settings tab. */
function control<T>(name: string): T {
	const row = settingRows.find((s) => s.nameEl.getText() === name);
	if (!row) throw new Error(`no setting "${name}"`);
	return row.components[0] as T;
}

function openTab(fake: FakePlugin): void {
	expect(fake.settingTabs).toHaveLength(1);
	(fake.settingTabs[0] as unknown as { display(): void }).display();
}

describe('the settings tab (spec §9, D33)', () => {
	it('groups the settings under six short headings, in order', async () => {
		const { fake } = await loadPlugin();
		openTab(fake);
		const g = SETTINGS_UI.groups;
		expect(settingGroups.map((x) => x.heading)).toEqual([g.height, g.cards, g.housePage, g.focus, g.links, g.repair]);
		const names = (i: number) => settingGroups[i].listEl.querySelectorAll('.setting-item-name').map((n) => n.getText());
		// 0.2.5 (D144): a tree in a note on a phone is a list with its natural height, so only the computer row stays.
		expect(names(0)).toEqual([SETTINGS_UI.heightDesktop]);
		// M7 (spec §13.1): the relation names are in the Cards group. 0.2.7 (E.6, J.8): the settings of the line of succession come last.
		// 0.2.4 (D118, D126): 0.2.5 (D150): the direction row comes first, then the break list and "Reduce movement"; the card style of the phone preview is gone (D144), and 0.2.6 (D179) removes "Card size".
		expect(names(1)).toEqual([SETTINGS_UI.phoneDirection, SETTINGS_UI.breakWords, SETTINGS_UI.reduceMotion, SETTINGS_UI.dates, SETTINGS_UI.relations, SETTINGS_UI.oneParentUnknown, SETTINGS_UI.portraits, SETTINGS_UI.successionLength, SETTINGS_UI.oldAge, SETTINGS_UI.youngDeathAge]);
		// D113 item 4: the house page has its own group.
		expect(names(2)).toEqual([SETTINGS_UI.houseGeneration]);
		expect(names(3)).toEqual([SETTINGS_UI.generations]);
		expect(names(4)).toEqual([SETTINGS_UI.links]);
		expect(names(5)).toEqual([SETTINGS_UI.cache]);
		// Every setting has a description.
		expect(settingRows.every((r) => r.descEl.getText().length > 0)).toBe(true);
	});

	it('shows the stored values; a bad stored value shows its default', async () => {
		// The stored data of 0.2.4 still has the phone height and the card style: both are dropped (D144).
		const { fake, plugin } = await loadPlugin({ embedHeightDesktop: 640, embedHeightPhone: 70, phoneCardStyle: 'whole', cardSize: 'compact', showDates: false, focusGenerations: 99, updateLinks: false });
		expect(plugin.settings).toEqual({ embedHeightDesktop: 640, showDates: false, showRelations: true, oneParentUnknown: true, showPortraits: true, showHouseGeneration: true, focusGenerations: 3, updateLinks: false, breakWords: '', reduceMotion: 'system', phoneDirection: 'sideways', successionLength: 5, oldAge: 110, youngDeathAge: 0 });
		openTab(fake);
		expect(control<TextComponent>(SETTINGS_UI.heightDesktop).getValue()).toBe('640');
		expect(control<ToggleComponent>(SETTINGS_UI.dates).getValue()).toBe(false);
		expect(control<ToggleComponent>(SETTINGS_UI.relations).getValue()).toBe(true);
		expect(control<DropdownComponent>(SETTINGS_UI.generations).getValue()).toBe('3');
		expect(control<ToggleComponent>(SETTINGS_UI.links).getValue()).toBe(false);
		expect(control<ToggleComponent>(SETTINGS_UI.houseGeneration).getValue()).toBe(true);
	});

	it('every field and switch has its setting name as an accessible name (P4)', async () => {
		const { fake } = await loadPlugin();
		openTab(fake);
		expect(control<TextComponent>(SETTINGS_UI.heightDesktop).inputEl.getAttribute('aria-label')).toBe(SETTINGS_UI.heightDesktop);
		for (const name of [SETTINGS_UI.phoneDirection, SETTINGS_UI.generations]) expect(control<DropdownComponent>(name).selectEl.getAttribute('aria-label')).toBe(name);
		for (const name of [SETTINGS_UI.dates, SETTINGS_UI.relations, SETTINGS_UI.oneParentUnknown, SETTINGS_UI.portraits, SETTINGS_UI.houseGeneration, SETTINGS_UI.links]) expect(control<ToggleComponent>(name).toggleEl.getAttribute('aria-label')).toBe(name);
	});

	it('"Show generation on the house page" is on by default and stores its change', async () => {
		const { fake, plugin } = await loadPlugin();
		expect(plugin.settings.showHouseGeneration).toBe(true);
		openTab(fake);
		control<ToggleComponent>(SETTINGS_UI.houseGeneration).fire(false);
		await settle();
		expect(plugin.settings.showHouseGeneration).toBe(false);
		expect(last(fake.saved)).toEqual(plugin.settings);
	});

	it('stores each change', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		control<ToggleComponent>(SETTINGS_UI.links).fire(false);
		control<DropdownComponent>(SETTINGS_UI.generations).fire('5');
		await settle();
		expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, updateLinks: false, focusGenerations: 5 });
		expect(last(fake.saved)).toEqual(plugin.settings);
	});

	it('0.2.4: the break list and "Reduce movement" show their stored values, with the choices in the plugin words and an accessible name', async () => {
		const { fake } = await loadPlugin({ breakWords: 'Long-na-munda', reduceMotion: 'on' });
		openTab(fake);
		const motion = control<DropdownComponent>(SETTINGS_UI.reduceMotion);
		expect(motion.getValue()).toBe('on');
		expect(motion.options).toEqual([
			['system', SETTINGS_UI.reduceFollow],
			['on', SETTINGS_UI.reduceOn],
			['off', SETTINGS_UI.reduceOff],
		]);
		const area = control<TextAreaComponent>(SETTINGS_UI.breakWords);
		expect(area.getValue()).toBe('Long-na-munda');
		expect((area.inputEl as unknown as { rows: number }).rows).toBe(6);
		expect(area.inputEl.tag).toBe('textarea');
		for (const [c, name] of [[motion.selectEl, SETTINGS_UI.reduceMotion], [area.inputEl, SETTINGS_UI.breakWords]] as const) expect(c.getAttribute('aria-label')).toBe(name);
	});

	it('0.2.4: the defaults are an empty break list and "Follow the device"', async () => {
		const { fake } = await loadPlugin();
		openTab(fake);
		expect(control<TextAreaComponent>(SETTINGS_UI.breakWords).getValue()).toBe('');
		expect(control<DropdownComponent>(SETTINGS_UI.reduceMotion).getValue()).toBe('system');
	});

	it('0.2.4: the choice of Reduce movement stores its change; the break list stores the text as typed', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		control<DropdownComponent>(SETTINGS_UI.reduceMotion).fire('off');
		control<TextAreaComponent>(SETTINGS_UI.breakWords).fire('Long-na-munda\nVal-mont ');
		await settle();
		expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, reduceMotion: 'off', breakWords: 'Long-na-munda\nVal-mont ' });
		expect(last(fake.saved)).toEqual(plugin.settings);
	});

	it('0.2.4: the break list is stored when the field loses the focus, and when the tab closes with the typing not yet stored', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		const area = control<TextAreaComponent>(SETTINGS_UI.breakWords);
		// A key press changes the value but the store waits (the timer of the real tab is 400 ms): set the value without the change event.
		area.inputEl.value = 'Val-mont';
		dispatch(area.inputEl, 'blur');
		await settle();
		expect(plugin.settings.breakWords).toBe('Val-mont');
		area.inputEl.value = 'Val-mont\nAr-den';
		(fake.settingTabs[0] as unknown as { hide(): void }).hide();
		await settle();
		expect(plugin.settings.breakWords).toBe('Val-mont\nAr-den');
	});

	it('0.2.4: a blur with the stored text stores nothing', async () => {
		const { fake } = await loadPlugin({ breakWords: 'Val-mont' });
		openTab(fake);
		dispatch(control<TextAreaComponent>(SETTINGS_UI.breakWords).inputEl, 'blur');
		await settle();
		expect(fake.saved).toEqual([]);
	});

	it('a desktop height out of range is not stored, and the field shows the stored value again', async () => {
		const { fake, plugin } = await loadPlugin();
		openTab(fake);
		const text = control<TextComponent>(SETTINGS_UI.heightDesktop);
		text.fire('50');
		text.fire('abc');
		await settle();
		expect(plugin.settings.embedHeightDesktop).toBe(500);
		expect(fake.saved).toEqual([]);
		dispatch(text.inputEl, 'blur');
		expect(text.getValue()).toBe('500');
		text.fire('720 px');
		await settle();
		expect(plugin.settings.embedHeightDesktop).toBe(720);
	});

	it('Arrange again empties the layout cache and says so', async () => {
		const { fake, plugin } = await loadPlugin();
		const clear = vi.spyOn(plugin, 'clearCaches');
		openTab(fake);
		const row = settingRows.find((s) => s.nameEl.getText() === SETTINGS_UI.cache)!;
		expect((row.components[0] as unknown as { buttonEl: FEl }).buttonEl.getText()).toBe(SETTINGS_UI.cacheButton);
		(row.components[0] as unknown as { fire(): void }).fire();
		expect(clear).toHaveBeenCalledTimes(1);
		expect(notices).toEqual([SETTINGS_UI.cacheDone]);
	});
});

describe('height of a tree in a note (spec §7.5, §9, D30)', () => {
	it('computer: the setting in px; options.height wins', async () => {
		const { host } = await loadPlugin({ embedHeightDesktop: 640 });
		expect(height((await tree(TREE, host)).vp)).toBe('640px');
		expect(height((await tree(withHeight(300), host)).vp)).toBe('300px');
	});

	it('a narrow computer window is not a phone: px, and options.height', async () => {
		device.width = 390;
		device.height = 800;
		const { host } = await loadPlugin();
		expect(height((await tree(TREE, host)).vp)).toBe('500px');
		expect(height((await tree(withHeight(300), host)).vp)).toBe('300px');
	});

	it('D144: a tree in a note on a phone is a list with its natural height: no height is set, and options.height is ignored', async () => {
		phone();
		const { host } = await loadPlugin();
		const upright = await tree(TREE, host);
		expect(upright.vp.hasClass('dynasty-list-viewport')).toBe(true);
		expect(height(upright.vp)).toBeUndefined();
		expect(height((await tree(withHeight(300), host)).vp)).toBeUndefined();
		resetDom();
		phoneOnSide();
		expect(height((await tree(withHeight(300), host)).vp)).toBeUndefined();
	});

	it('D144: turning the phone keeps the list and sets no height', async () => {
		phone();
		const { host } = await loadPlugin();
		const { vp } = await tree(withHeight(300), host);
		phoneOnSide();
		dispatchWindow('resize');
		resizeAll();
		flushFrames();
		expect(vp.hasClass('dynasty-list-viewport')).toBe(true);
		expect(height(vp)).toBeUndefined();
	});

	it('a tablet (touch, both sides 600 px or more) is not a phone: px, and options.height', async () => {
		device.coarse = true;
		device.width = 1180;
		device.height = 820;
		const { host } = await loadPlugin({ embedHeightDesktop: 700 });
		expect(height((await tree(TREE, host)).vp)).toBe('700px');
		expect(height((await tree(withHeight(300), host)).vp)).toBe('300px');
	});

	it('a change in the settings tab changes the open trees at once', async () => {
		const { host, fake } = await loadPlugin();
		const a = await tree(TREE, host);
		const b = await tree(withHeight(300), host);
		openTab(fake);
		control<TextComponent>(SETTINGS_UI.heightDesktop).fire('900');
		await settle();
		expect(height(a.vp)).toBe('900px');
		expect(height(b.vp)).toBe('300px');
	});

});

describe('dates and generations (spec §9)', () => {
	const cardW = (el: FEl) => Number(el.querySelector('.dynasty-card-bg')!.getAttribute('width'));

	it('a stored card size is ignored (D179): the cards have the width of the Normal size and the settings tab has no such row', async () => {
		const { host, fake, plugin } = await loadPlugin({ cardSize: 'compact' });
		expect('cardSize' in plugin.settings).toBe(false);
		const t = await tree(TREE, host);
		expect(cardW(t.el)).toBe(geometryFor(16).cardW);
		openTab(fake);
		expect(settingRows.some((r) => r.nameEl.getText() === 'Card size')).toBe(false);
	});

	it('dates off: the dates hide and the tree is not laid out again', async () => {
		const { host, fake, plugin } = await loadPlugin();
		const t = await tree(TREE, host);
		const root = t.el.querySelector('.dynasty-root')!;
		expect(root.hasClass('dynasty-no-dates')).toBe(false);
		expect(t.el.querySelectorAll('.dynasty-card-dates').length).toBeGreaterThan(0);
		const renders = plugin.renderCount;
		openTab(fake);
		control<ToggleComponent>(SETTINGS_UI.dates).fire(false);
		await settle();
		expect(t.el.querySelector('.dynasty-root')).toBe(root);
		expect(root.hasClass('dynasty-no-dates')).toBe(true);
		expect(plugin.renderCount).toBe(renders);
		// A tree drawn later starts with the setting.
		expect((await tree(TREE, host)).el.querySelector('.dynasty-root')!.hasClass('dynasty-no-dates')).toBe(true);
	});

	it('focus mode takes the generations setting; options.generations wins', async () => {
		const { host, fake } = await loadPlugin({ focusGenerations: 1 });
		const r = parseDynasty(LINE);
		if (!r.ok) throw new Error('parse');
		const people = (el: FEl) => Number(el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-people'));
		const t = await tree(LINE, host);
		expect(people(t.el)).toBe(focusSubgraph(r.tree, 'p4', 1)!.tree.people.length);
		openTab(fake);
		control<DropdownComponent>(SETTINGS_UI.generations).fire('2');
		await settle();
		expect(people(t.el)).toBe(focusSubgraph(r.tree, 'p4', 2)!.tree.people.length);
		const own = await tree(LINE.replace('  focus: p4\n', '  focus: p4\n  generations: 4\n'), host);
		expect(people(own.el)).toBe(focusSubgraph(r.tree, 'p4', 4)!.tree.people.length);
	});

	it('a whole tree (no focus) is not laid out again when the generations change', async () => {
		const { host, fake, plugin } = await loadPlugin();
		await tree(TREE, host);
		const renders = plugin.renderCount;
		openTab(fake);
		control<DropdownComponent>(SETTINGS_UI.generations).fire('6');
		await settle();
		expect(plugin.settings.focusGenerations).toBe(6);
		expect(plugin.renderCount).toBe(renders);
	});

	it('D23 wins in the static phone preview: 1 generation, whatever the setting', async () => {
		phone();
		const { host } = await loadPlugin({ focusGenerations: 4 });
		const r = parseDynasty(LINE);
		if (!r.ok) throw new Error('parse');
		const t = await tree(LINE, host);
		expect(Number(t.el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-people'))).toBe(focusSubgraph(r.tree, 'p4', 1)!.tree.people.length);
	});
});

describe('link updates in data.json and the command "Show the last link update" (M6 iPhone fix round)', () => {
	const entry = { oldPath: 'Old.md', newPath: 'New.md', others: [] };

	it('stored pending renames do not change the settings; with the setting off they are dropped, and data.json keeps its old shape', async () => {
		const { fake, plugin } = await loadPlugin({ ...DEFAULT_SETTINGS, updateLinks: false, pendingRenames: [entry] });
		expect(plugin.settings).toEqual({ ...DEFAULT_SETTINGS, updateLinks: false });
		await settle();
		expect(last(fake.saved)).toEqual(plugin.settings);
		expect(plugin.links.pendingList()).toEqual([]);
	});

	it('a settings change keeps the renames that wait for a link update in data.json', async () => {
		const { fake, plugin } = await loadPlugin();
		plugin.links.restore([entry]);
		openTab(fake);
		control<ToggleComponent>(SETTINGS_UI.dates).fire(false);
		await settle();
		expect(last(fake.saved)).toEqual({ ...plugin.settings, pendingRenames: [entry] });
	});

	it('the command shows what the last link update did', async () => {
		const { fake } = await loadPlugin();
		const cmd = fake.commands.find((c) => c.id === 'show-last-link-update')!;
		expect(cmd.name).toBe(RENAME_UI.command);
		cmd.callback!();
		expect(notices).toEqual([RENAME_UI.report(null, true)]);
	});
});

describe('the command Insert family tree (spec §5.9, D34)', () => {
	it('is registered as an editor command and inserts an empty tree at the cursor', async () => {
		const { fake } = await loadPlugin();
		const cmd = fake.commands.find((c) => c.id === 'insert-family-tree')!;
		expect(cmd.name).toBe(INSERT_UI.command);
		expect(cmd.editorCallback).toBeTypeOf('function');
		let text = 'Some text.\n';
		let cursor = { line: 0, ch: 0 };
		const editor = {
			getCursor: () => ({ line: 0, ch: 10 }),
			getLine: (n: number) => text.split('\n')[n],
			lineCount: () => text.split('\n').length,
			transaction: (t: { changes: { from: { line: number; ch: number }; to: { line: number; ch: number }; text: string }[]; selection: { from: { line: number; ch: number } } }) => {
				const lines = text.split('\n');
				const c = t.changes[0];
				text = [...lines.slice(0, c.from.line), c.text, ...lines.slice(c.to.line + 1)].join('\n');
				cursor = t.selection.from;
			},
		};
		cmd.editorCallback!(editor, {});
		const blocks = findBlocks(text);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].body.trimEnd()).toBe(`# ${INSERT_UI.noteHint}`);
		expect(cursor.line).toBe(blocks[0].closeLine! + 1);
	});

	it('the new tree shows "Add first person"', async () => {
		const { host } = await loadPlugin();
		const source = `# ${INSERT_UI.noteHint}\n`;
		const handle = fakeHandle('n.md', source);
		Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 3, text: '' }), addChild: () => {} };
		new TreeView(host as never, el as never, source, { kind: 'embed', ctx } as never).load();
		await settle();
		expect(el.querySelector('.dynasty-add-first')!.getText()).toBe(ADD_UI.addFirst);
		expect(el.querySelector('.dynasty-error')).toBeNull();
	});

	it('an error in the editor never reaches Obsidian', async () => {
		const { fake } = await loadPlugin();
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cmd = fake.commands.find((c) => c.id === 'insert-family-tree')!;
		expect(() => cmd.editorCallback!({ getCursor: () => { throw new Error('x'); } }, {})).not.toThrow();
		expect(err).toHaveBeenCalled();
	});
});

describe('keyboard (spec §5.2)', () => {
	/** Every element that Tab stops at, in document order. */
	const tabStops = (root: FEl) => root.all().filter((e) => (e.tag === 'button' && !e.hidden) || e.getAttribute('tabindex') === '0');
	const kind = (e: FEl) => (e.closest('.dynasty-toolbar') ? 'tool' : e.hasClass('dynasty-card') ? 'card' : e.hasClass('dynasty-focus-badge') ? 'badge' : e.hasClass('dynasty-tag') ? 'tag' : e.hasClass('dynasty-fold') ? 'fold' : 'other');

	/** A fold control (spec §13.10) is a Tab stop after the card of the later of its parents. */
	const foldsFollowParents = (stops: FEl[]) => {
		stops.forEach((e, i) => {
			if (kind(e) !== 'fold') return;
			const ids = (e.getAttribute('data-fold') ?? '').match(/[^"\[\],]+/g) ?? [];
			const at = ids.map((id) => stops.findIndex((c) => kind(c) === 'card' && c.getAttribute('data-person') === id)).filter((n) => n >= 0);
			if (at.length) expect(i, e.getAttribute('data-fold') ?? '').toBeGreaterThan(Math.max(...at));
		});
	};

	it('Tab reaches every toolbar button first, then the cards, then the tags', async () => {
		const { el } = await embed(FAR, { handle: fakeHandle('n.md', FAR) });
		const stops = tabStops(el);
		const kinds: string[] = stops.map(kind);
		expect(kinds.filter((k) => k === 'other')).toEqual([]);
		foldsFollowParents(stops);
		const lastAt = (k: string) => kinds.lastIndexOf(k);
		const first = (k: string) => kinds.indexOf(k);
		expect(first('tool')).toBe(0);
		expect(lastAt('tool')).toBeLessThan(first('card'));
		expect(lastAt('card')).toBeLessThan(first('tag'));
		expect(kinds.filter((k) => k === 'tool').length).toBe(el.querySelector('.dynasty-toolbar')!.querySelectorAll('button').length);
		expect(kinds.filter((k) => k === 'tag').length).toBeGreaterThan(0);
	});

	it('the same in the full-screen view; in focus mode each badge follows its own card', async () => {
		const { root } = await openFullScreen(LINE);
		const stops = tabStops(root);
		const kinds: string[] = stops.map(kind);
		foldsFollowParents(stops);
		expect(kinds[0]).toBe('tool');
		expect(kinds.lastIndexOf('tool')).toBeLessThan(kinds.indexOf('card'));
		const badges = stops.filter((e) => kind(e) === 'badge');
		expect(badges.length).toBeGreaterThan(0);
		for (const b of badges) {
			const before = stops[stops.indexOf(b) - 1];
			expect(kind(before)).toBe('card');
			expect(before.getAttribute('data-person')).toBe(b.getAttribute('data-person'));
		}
	});

	it('Esc closes the legend and gives the focus back to the Legend button', async () => {
		desktop();
		const { el } = await embed(TREE, { handle: fakeHandle('n.md', TREE) });
		const legend = el.querySelector('.dynasty-legend-button')!;
		legend.focus();
		dispatch(legend, 'click');
		expect(el.querySelector('.dynasty-popover-legend')).not.toBeNull();
		const e = dispatch(legend, 'keydown', { key: 'Escape' });
		expect(el.querySelector('.dynasty-popover-legend')).toBeNull();
		expect(fakeDoc.activeElement).toBe(legend);
		// Obsidian does not see the Esc: a full-screen view around the tree stays open.
		expect(e.defaultPrevented).toBe(true);
	});

	it('full-screen view: Esc (Obsidian closes with no text) closes an open legend first, then the view', async () => {
		const { root, modal } = await openFullScreen(TREE);
		const legend = root.querySelector('.dynasty-legend-button')!;
		legend.focus();
		dispatch(legend, 'click');
		expect(root.querySelector('.dynasty-popover-legend')).not.toBeNull();
		modal.close();
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
		expect(fullViews()).toContain(modal);
		expect(fakeDoc.activeElement).toBe(legend);
		modal.close();
		expect(fullViews()).not.toContain(modal);
		// The toolbar Close (an explicit close) never stops at a popover.
		const again = await openFullScreen(TREE);
		dispatch(again.root.querySelector('.dynasty-legend-button')!, 'click');
		dispatch(again.root.querySelector('.dynasty-close')!, 'click');
		expect(fullViews()).not.toContain(again.modal);
	});

	it('full-screen view: Obsidian 1.13 closes with the event (close(evt)): no Notice "[object PointerEvent]", and an open legend closes first', async () => {
		// M6 iPhone test: a phone showed the Notice "[object PointerEvent]" (the decision notes "M6 iPhone test").
		const evt = { type: 'pointerup', pointerType: 'touch', toString: () => '[object PointerEvent]' };
		const { root, modal } = await openFullScreen(TREE);
		dispatch(root.querySelector('.dynasty-legend-button')!, 'click');
		expect(root.querySelector('.dynasty-popover-legend')).not.toBeNull();
		modal.close(evt);
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
		expect(fullViews()).toContain(modal);
		modal.close(evt);
		expect(fullViews()).not.toContain(modal);
		expect(notices).toEqual([]);
		// Only a non-empty string is a Notice text.
		for (const arg of ['', 0, true, new Error('x')]) {
			const v = await openFullScreen(TREE);
			v.modal.close(arg);
			expect(fullViews()).not.toContain(v.modal);
		}
		expect(notices).toEqual([]);
		const gone = await openFullScreen(TREE);
		gone.modal.close('The tree is gone.');
		expect(notices).toEqual(['The tree is gone.']);
	});

	it('Esc in the partner list closes it and gives the focus back to the tag', () => {
		const host = new FEl('div');
		const tag = host.createSvg('g', { attr: { tabindex: 0 } });
		const pop = new Popover(host as never);
		pop.open('spouses', (el) => (el as unknown as FEl).createEl('button', { text: 'A' }).focus(), tag as never);
		expect(fakeDoc.activeElement?.getText()).toBe('A');
		dispatch(fakeDoc.activeElement!, 'keydown', { key: 'Escape' });
		expect(pop.isOpen).toBe(false);
		expect(fakeDoc.activeElement).toBe(tag);
	});

	it('an Esc with the focus outside the tree does not close the popover', () => {
		const host = new FEl('div');
		const opener = host.createEl('button');
		const pop = new Popover(host as never);
		pop.open('legend', () => {}, opener as never);
		const other = new FEl('input');
		other.focus();
		const e = dispatch(other, 'keydown', { key: 'Escape' });
		expect(pop.isOpen).toBe(true);
		expect(e.defaultPrevented).toBe(false);
		pop.close();
	});
});
