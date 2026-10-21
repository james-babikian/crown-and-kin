import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { DEFAULT_SETTINGS } from '../src/view/settings';
import { ME_WORD as SCENE_ME_WORD } from '../src/render/dom/scene';
import { ME_WORD, VIEW_NOTICE } from '../src/render/view-text';
import { fakeWin, installDom, resetDom, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, loadPlugin } from './acceptance/tree-view-fakes';

/*
 * Work package A1 of the 0.2.8 repair round: the small behaviour repairs of the tree view that the wiring proof
 * (review-r028-g2-wiring) does not cover.
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
});
afterEach(() => vi.restoreAllMocks());

const TREE = (options: string) => `${options}people:
  - {id: a, name: Ann, born: 1100}
  - {id: b, name: Bob, parents: [a], born: 1130}
  - {id: c, name: Cid, parents: [b], born: 1160}
  - {id: d, name: Dot, born: 1100}
`;

describe('item 6: the start person of a view on the computer (G.4)', () => {
	const startOf = async (options: string, lastEdited?: string) => {
		desktop();
		const src = TREE(options);
		const handle = fakeHandle('n.md', src);
		if (lastEdited) handle.state.lastEdited = lastEdited;
		const { view } = await embed(src, { host: undefined, handle });
		return (view as unknown as { startId(): string | null }).startId();
	};
	it('a note with no start opens on the marked person', async () => {
		expect(await startOf('options:\n  me: c\n')).toBe('c');
	});
	it('options.start still comes before the marked person', async () => {
		expect(await startOf('options:\n  start: b\n  me: c\n')).toBe('b');
	});
	it('the person edited last comes before both', async () => {
		expect(await startOf('options:\n  start: b\n  me: c\n', 'd')).toBe('d');
	});
	it('with no mark and no start the first root is the start', async () => {
		expect(await startOf('')).toBe('a');
	});
	it('a mark that names nobody is ignored', async () => {
		expect(await startOf('options:\n  me: nobody\n')).toBe('a');
	});
});

describe('item 5: the colour of the text on the accent', () => {
	it('is removed from the page when the plugin unloads', async () => {
		const body = (globalThis as unknown as { document: { body: { style: { setProperty(k: string, v: string): void; removeProperty(k: string): void } } } }).document.body;
		const { plugin } = await loadPlugin();
		body.style.setProperty('--dynasty-on-accent', '#000000');
		const remove = vi.spyOn(body.style, 'removeProperty');
		(plugin as unknown as { unload(): void }).unload();
		expect(remove).toHaveBeenCalledWith('--dynasty-on-accent');
	});
});

describe('item 7: a setting change reaches the open tree first', () => {
	it('trees that are on screen draw at once; trees that nobody sees draw in later timer turns, in order', async () => {
		const { plugin } = await loadPlugin();
		const calls: string[] = [];
		const view = (name: string, offScreen: boolean) => ({ offScreen, onSettingsChange: () => void calls.push(name) });
		const views = (plugin as unknown as { views: Set<unknown> }).views;
		views.add(view('hidden-1', true));
		views.add(view('shown', false));
		views.add(view('hidden-2', true));
		await plugin.changeSettings({ showPortraits: !DEFAULT_SETTINGS.showPortraits });
		expect(calls).toEqual(['shown']);
		await new Promise((r) => setTimeout(r, 30));
		expect(calls).toEqual(['shown', 'hidden-1', 'hidden-2']);
	});
	it('a tree in the page whose box has no parent for layout (display: none) counts as off screen, and so does a tree that is not in the page (the reading view of another tab)', async () => {
		desktop();
		const src = TREE('');
		const { view, el } = await embed(src, { handle: fakeHandle('n.md', src) });
		const v = view as unknown as { offScreen: boolean };
		expect(v.offScreen).toBe(false);
		Object.assign(el, { offsetParent: null });
		expect(v.offScreen).toBe(el.isConnected);
		Object.defineProperty(el, 'isConnected', { value: false, configurable: true });
		expect(v.offScreen).toBe(true);
	});
	it('a toggle in the settings tab reaches every tree in the same task, with no timer between', async () => {
		desktop();
		const src = TREE('options:\n  me: c\n');
		const { plugin, host } = await loadPlugin();
		const { el } = await embed(src, { host, handle: fakeHandle('n.md', src) as never });
		await settle();
		const before = plugin.lastTiming;
		void plugin.changeSettings({ warnManyParents: false });
		// No await: the redraw has happened in the call itself.
		expect(plugin.lastTiming).not.toBe(before);
		expect(el.querySelector('.dynasty-viewport')).toBeTruthy();
	});
});

describe('item 8: texts', () => {
	it('the word on the You tab lives in view-text and scene.ts still exports it', () => {
		expect(ME_WORD).toBe('You');
		expect(SCENE_ME_WORD).toBe(ME_WORD);
	});
	it('the notice of a link update that gave up reads as the owner asked', () => {
		expect(VIEW_NOTICE.renameGaveUp('Family', 'Old', 'New')).toBe(
			'After a rename, the plugin updates the links in the trees. In the note Family, this update took too long, and the plugin stopped it. If a tree in the note still has the link “Old”, replace it with “New”.',
		);
	});
});
