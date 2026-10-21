import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { forgetHeights, lastHeight, rememberHeight } from '../src/obsidian/block-height';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { START_LIMIT_MS, STYLES_LIMIT_MS, TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, dispatch, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, openFullScreen, phone, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * 0.2.8, package P5: the cold start (D183, I07), the toolbar and its menus (G.13), the banner, the settings that the view hands to the
 * layout (D206, A.5) and the phone list's large row (D198), on the fakes.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	forgetHeights();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const TREE = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;

/** An embedded tree that is NOT sized yet (a cold start: the box is a placeholder), as the plugin's processor makes it. */
async function coldEmbed(source: string, host: Host, handle: FakeHandle | null, inNote = false) {
	const registry = handle ? { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false } : { inEditorOf: () => false };
	Object.assign(host.handles, registry);
	const el = new FEl('div');
	// A block in a note's own view (its editor may not be ready yet) waits; one in the side view of another plugin does not (A1 item 4).
	if (inNote) new FEl('div', { cls: 'markdown-source-view' }).appendChild(el);
	const info = { lineStart: 0, lineEnd: source.split(String.fromCharCode(10)).length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => (handle ? info : null), addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	return { el, view };
}

/** The tree drew: the test gives its box a size, as the browser would. */
function sized(el: FEl): void {
	const vp = el.querySelector('.dynasty-viewport')!;
	vp.clientWidth = 360;
	vp.clientHeight = 400;
	resizeAll();
	flushFrames();
}

/** A host that has a cold start: the styles and the cache are "not in" until the test says so. */
function coldHost() {
	const state = { ready: false, cache: false };
	const host = fakeHost() as ReturnType<typeof fakeHost> & { startedUp: { ready(el: unknown): boolean; cache(): boolean } };
	host.startedUp = { ready: () => state.ready, cache: () => state.cache };
	return { host, state };
}

describe('D183: the cold start draws a box of the last known height, not a tree with no style', () => {
	it('shows the box while the styles are not in, and the tree once they are', async () => {
		desktop();
		const { host, state } = coldHost();
		const { el, view } = await coldEmbed(TREE, host, fakeHandle('n.md', TREE));
		const box = el.querySelector('.dynasty-placeholder');
		expect(box).not.toBeNull();
		expect(el.querySelector('.dynasty-viewport')).toBeNull();
		expect(el.querySelector('.dynasty-read-only-label')).toBeNull();
		expect(el.querySelector('.dynasty-warning-badge')).toBeNull();
		// The box has the height of the setting where no height of the block is known. An svg: a style attribute is not allowed.
		expect(box!.querySelector('.dynasty-placeholder-box')!.getAttribute('height')).toBe(String(DEFAULT_SETTINGS.embedHeightDesktop));
		state.ready = true;
		view.startUpDone();
		sized(el);
		expect(el.querySelector('.dynasty-placeholder')).toBeNull();
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
	});

	it('a timer looks again, not only the resize observer: the tree comes with no other event', async () => {
		desktop();
		const { host, state } = coldHost();
		const { el } = await coldEmbed(TREE, host, fakeHandle('n.md', TREE));
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		state.ready = true;
		runTimers(200);
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
	});

	it('draws as it is after the cap of 8 s for the styles (D183 fix: the 2 s limit is for the settings and the place)', async () => {
		desktop();
		const { host } = coldHost();
		const { el } = await coldEmbed(TREE, host, fakeHandle('n.md', TREE));
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		runTimers(STYLES_LIMIT_MS + 100);
		expect(el.querySelector('.dynasty-placeholder')).toBeNull();
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
	});

	it('the box has the last known height of the same block', async () => {
		desktop();
		const { host } = coldHost();
		rememberHeight(host.app as never, 'n.md\u0000#0', 377);
		expect(lastHeight(host.app as never, 'n.md\u0000#0')).toBe(377);
		const { el } = await coldEmbed(TREE, host, fakeHandle('n.md', TREE));
		expect(el.querySelector('.dynasty-placeholder-box')!.getAttribute('height')).toBe('377');
	});

	it('a block with no place that is in a note view but not yet in its editor waits for the limit', async () => {
		desktop();
		const { host, state } = coldHost();
		state.ready = true;
		const { el } = await coldEmbed(TREE, host, null, true);
		// No handle: Obsidian gave no section. The container is in a note view and in no editor yet, so the place is not known yet; the limit decides.
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		runTimers(START_LIMIT_MS + 100);
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
		// The place is still asked for, so nothing says "Read only" yet (D183 fix); the last ask at 5 s ends it.
		expect(el.querySelector('.dynasty-read-only-label')).toBeNull();
		runTimers(3500);
		expect(el.querySelector('.dynasty-read-only-label')).not.toBeNull();
	});

	it('a host with no cold start (the unit fakes) draws at once', async () => {
		desktop();
		const { el } = await embed(TREE, { handle: fakeHandle('n.md', TREE) });
		expect(el.querySelector('.dynasty-placeholder')).toBeNull();
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
	});

	it('a picture that the metadata cache does not know yet is no warning until the cache has finished', async () => {
		desktop();
		const { host, state } = coldHost();
		state.ready = true;
		const PICS = `houses:\n  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}\npeople:\n  - {id: ann, name: Ann, house: va}\n`;
		(host as unknown as { pictures: unknown }).pictures = {
			resolve: (link: string) => ({ ok: false, code: 'missing-picture', file: link }),
			check: async () => null,
			acquire: async () => null,
			onChange: () => () => {},
		};
		const { el, view } = await embed(PICS, { host, handle: fakeHandle('n.md', PICS) });
		flushFrames();
		await settle();
		expect(el.querySelector('.dynasty-viewport')).not.toBeNull();
		expect(el.querySelector('.dynasty-warning-badge')).toBeNull();
		state.cache = true;
		view.startUpDone();
		expect(el.querySelector('.dynasty-warning-badge .dynasty-warning-count')?.getText()).toBe('1');
	});
});

describe('the toolbar of the computer (G.13)', () => {
	const kinds = (root: FEl) => root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);

	it('is Add person, Find, Focus, Fit | Houses, Titles | More … Expand, with the two bars between the groups', async () => {
		desktop();
		const { el } = await embed(TREE, { handle: fakeHandle('n.md', TREE) });
		expect(kinds(el)).toEqual(['dynasty-add-person', 'dynasty-find', 'dynasty-focus', 'dynasty-fit', 'dynasty-sep', 'dynasty-houses-button', 'dynasty-titles-button', 'dynasty-sep', 'dynasty-more', 'dynasty-grow', 'dynasty-expand']);
		expect(el.querySelector('.dynasty-toolbar')!.getAttribute('role')).toBe('toolbar');
		// Add person has its word.
		expect(el.querySelector('.dynasty-add-person .dynasty-tool-text')!.getText()).toBe('Add person');
	});

	it('a tree that cannot be edited has no Houses, no Titles and no bar between the groups', async () => {
		desktop();
		const { el } = await embed(TREE);
		expect(el.querySelector('.dynasty-houses-button')).toBeNull();
		expect(el.querySelector('.dynasty-titles-button')).toBeNull();
		const sepA = el.querySelectorAll('.dynasty-sep')[0];
		expect(sepA.hidden).toBe(true);
	});

	it('the phone bar is Add person, Houses, Focus, Find, More, Close with no bar between and no free room', async () => {
		phone();
		const { root } = await openFullScreen(TREE);
		expect(kinds(root)).toEqual(['dynasty-add-person', 'dynasty-houses-button', 'dynasty-focus', 'dynasty-find', 'dynasty-more', 'dynasty-close']);
		// The word is for the computer: the phone shows the icon.
		expect(root.querySelector('.dynasty-add-person .dynasty-tool-text')).toBeNull();
	});
});

describe('the Focus menu (G.13)', () => {
	const ME = `options:\n  me: bo\n${TREE}`;
	const press = async (root: FEl, sel: string) => {
		dispatch(root.querySelector(sel)!, 'click', { button: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
	};
	const labels = (root: FEl) => root.querySelectorAll('.dynasty-popover-focus .dynasty-more-text').map((x) => x.getText());

	it('has "Focus on you" only for a tree with a marked person; it shows the family of that person', async () => {
		desktop();
		const plain = await embed(TREE, { handle: fakeHandle('n.md', TREE) });
		await press(plain.el, '.dynasty-focus');
		expect(labels(plain.el)).toEqual(['Choose a person']);
		resetDom();
		desktop();
		const marked = await embed(ME, { handle: fakeHandle('n.md', ME) });
		await press(marked.el, '.dynasty-focus');
		expect(labels(marked.el)).toEqual(['Choose a person', 'Focus on you']);
		await press(marked.el, '.dynasty-focus-me');
		expect(marked.el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus')).toBe('bo');
		// With a focus the menu has Clear focus after a separator.
		await press(marked.el, '.dynasty-focus');
		expect(labels(marked.el)).toEqual(['Choose a person', 'Focus on you', 'Clear focus']);
		expect(marked.el.querySelector('.dynasty-popover-focus .dynasty-menu-sep')).not.toBeNull();
	});

	it('on a phone the menus are sheets with a grip, and a tap on the cover closes them', async () => {
		phone();
		const { root } = await openFullScreen(TREE);
		await press(root, '.dynasty-more');
		const sheet = root.querySelector('.dynasty-popover-more')!;
		expect(sheet.hasClass('is-sheet')).toBe(true);
		expect(sheet.querySelector('.dynasty-sheet-grip')).not.toBeNull();
		expect(root.querySelector('.dynasty-cover')).not.toBeNull();
		// Fit and Titles are in More on the phone.
		expect(sheet.querySelectorAll('.dynasty-more-text').map((x) => x.getText()).slice(0, 2)).toEqual(['Fit the tree in the view', 'Titles']);
		dispatch(root.querySelector('.dynasty-cover')!, 'click', {});
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
		expect(root.querySelector('.dynasty-cover')).toBeNull();
	});

	it('the legend is the line styles only; on a phone a sheet with Close', async () => {
		phone();
		const { root } = await openFullScreen(TREE);
		await press(root, '.dynasty-more');
		await press(root, '.dynasty-more-legend');
		const sheet = root.querySelector('.dynasty-popover-legend')!;
		expect(sheet.querySelector('.dynasty-legend-row')).not.toBeNull();
		expect(sheet.querySelector('.dynasty-legend-houses')).toBeNull();
		await press(root, '.dynasty-popover-legend .dynasty-sheet-close');
		expect(root.querySelector('.dynasty-popover-legend')).toBeNull();
	});
});

describe('the banner (G.13, I37)', () => {
	const press = async (root: FEl, sel: string) => {
		dispatch(root.querySelector(sel)!, 'click', { button: 0, detail: 1 });
		await settle();
		resizeAll();
		flushFrames();
	};
	const FAM = `people:
  - {id: a, name: Aldric}
  - {id: b, name: Bera}
  - {id: c, name: Cael, parents: [a, b]}
  - {id: d, name: Dag, parents: [a, b]}
unions:
  - {partners: [a, b], type: marriage}
`;

	it('Close is a link with its word on the computer', async () => {
		desktop();
		const handle = fakeHandle('n.md', FAM);
		const { el, view, host } = await embed(FAM, { handle });
		TreeView.showFinder(host as never, handle.state, 'c', 'd', view);
		await settle();
		resizeAll();
		flushFrames();
		const close = el.querySelector('.dynasty-result-close')!;
		expect(close.getText()).toBe('Close');
		expect(close.hasClass('dynasty-link')).toBe(true);
		expect(close.hasClass('dynasty-bar-x')).toBe(false);
	});

	it('Close is an X with the full label on the phone, and the other links are in the menu of the link "Options"', async () => {
		phone();
		const handle = fakeHandle('n.md', FAM);
		const { root, host, modal } = await openFullScreen(FAM);
		void modal;
		void handle;
		const view = [...(host.views as Set<TreeView>)].find((v) => v.isFull)!;
		const st = (view as unknown as { peekState(): { finder: unknown } }).peekState() as never;
		TreeView.showFinder(host as never, st, 'c', 'd', view);
		await settle();
		resizeAll();
		flushFrames();
		const close = root.querySelector('.dynasty-result-close')!;
		expect(close.hasClass('dynasty-bar-x')).toBe(true);
		expect(close.getText()).toBe('');
		expect(close.getAttribute('aria-label')).toBe('Close: show the tree as it was before');
		// D212 (phone-banner-row): one row, the sentence, the link Options with its chevron, and the X; the actions are in the menu.
		expect(root.querySelector('.dynasty-result-whole')).toBeNull();
		const options = root.querySelector('.dynasty-result-options')!;
		expect(options.getText()).toBe('Options');
		expect(options.getAttribute('aria-label')).toBe('Options: open a list of actions for this relation');
		expect(options.querySelector('.dynasty-tool-icon')).not.toBeNull();
		const row = root.querySelector('.dynasty-result-buttons')!;
		expect(row.children.map((e) => [...e.classes].find((k) => k === 'dynasty-result-options' || k === 'dynasty-result-close'))).toEqual(['dynasty-result-options', 'dynasty-result-close']);
		await press(root, '.dynasty-result-options');
		const items = root.querySelectorAll('.dynasty-popover-options .dynasty-more-item').map((i) => i.querySelector('.dynasty-more-text')!.getText());
		expect(items).toContain('Show in the whole tree');
		expect(items[0]).toBe('Show the steps');
	});
});

describe('the settings that the view hands on (D206, A.5)', () => {
	const ARMS = `houses:
  - {id: va, name: House Valmont, color: "#8b1e3f", arms: "[[va-arms.png]]"}
people:
  - {id: ann, name: Ann Valmont, house: va, born: 1100}
  - {id: bo, name: Bo Valmont, house: va, born: 1130, parents: [ann]}
`;
	const armsOf = (root: FEl, id: string) => root.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-arms`);

	it('"Arms on cards" few: the first of the house has the arms room, its child does not; every card with "all"', async () => {
		desktop();
		const few = await embed(ARMS, { handle: fakeHandle('n.md', ARMS), host: fakeHost({ ...DEFAULT_SETTINGS, armsOnCards: 'few' }) });
		fillAllCards(few.el);
		expect(armsOf(few.el, 'ann')).not.toBeNull();
		expect(armsOf(few.el, 'bo')).toBeNull();
		resetDom();
		desktop();
		const all = await embed(ARMS, { handle: fakeHandle('n.md', ARMS), host: fakeHost({ ...DEFAULT_SETTINGS, armsOnCards: 'all' }) });
		fillAllCards(all.el);
		expect(armsOf(all.el, 'bo')).not.toBeNull();
	});

	it('a person with personal arms always has the arms room', async () => {
		desktop();
		const src = `${ARMS}  - {id: cy, name: Cy Valmont, house: va, born: 1160, parents: [bo], arms: "[[cy.png]]"}\n`;
		const { el } = await embed(src, { handle: fakeHandle('n.md', src), host: fakeHost({ ...DEFAULT_SETTINGS, armsOnCards: 'few' }) });
		fillAllCards(el);
		expect(armsOf(el, 'cy')).not.toBeNull();
	});

	it('"Warn about more than 2 parents of a type" off takes the warning off the badge', async () => {
		desktop();
		const MANY = `people:
  - {id: p1, name: One}
  - {id: p2, name: Two}
  - {id: p3, name: Three}
  - {id: kid, name: Kid, parents: [p1, p2, p3]}
`;
		const on = await embed(MANY, { handle: fakeHandle('n.md', MANY), host: fakeHost({ ...DEFAULT_SETTINGS, warnManyParents: true }) });
		expect(on.el.querySelector('.dynasty-warning-badge')).not.toBeNull();
		resetDom();
		desktop();
		const off = await embed(MANY, { handle: fakeHandle('n.md', MANY), host: fakeHost({ ...DEFAULT_SETTINGS, warnManyParents: false }) });
		expect(off.el.querySelector('.dynasty-warning-badge')).toBeNull();
	});
});

describe('the large row of the phone list (D198)', () => {
	const SRC = `options:
  me: ann
people:
  - {id: ann, name: Ann Valmont, born: 1100, title: Duchess}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;

	it('the person in the centre has a large row with no picture place and no initials disc (D213), the others a house strip', async () => {
		phone();
		const { el } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		const hero = el.querySelectorAll('.dynasty-list-hero');
		expect(hero).toHaveLength(1);
		expect(hero[0].getAttribute('data-person')).toBe('ann');
		expect(hero[0].querySelector('.dynasty-hero-col')).toBeNull();
		expect(hero[0].querySelector('.dynasty-mono')).toBeNull();
		expect(hero[0].querySelector('.dynasty-hero-title')!.getText()).toBe('Duchess');
		const bo = el.querySelector('.dynasty-list-row[data-person="bo"]')!;
		expect(bo.querySelector('.dynasty-list-strip')).not.toBeNull();
		expect(bo.querySelector('.dynasty-list-pics')).toBeNull();
	});

	it('the bar is the row of the computer: Add person, the tree text, free room, Find, Expand', async () => {
		phone();
		const { el } = await embed(SRC, { handle: fakeHandle('n.md', SRC) });
		const kinds = el.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);
		expect(kinds).toEqual(['dynasty-add-person', 'dynasty-show-text', 'dynasty-grow', 'dynasty-list-find', 'dynasty-expand']);
		expect(openModals).toHaveLength(0);
	});
});
