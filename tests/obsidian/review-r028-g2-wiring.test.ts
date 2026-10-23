import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache } from '../../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { FEl, clock, dispatch, flushFrames, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 review of 0.2.8 wave 2, integration of P5 (view) and P6 (windows).
 * Run: npx vitest run tests/obsidian/review-r028-g2-wiring.test.ts
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `options:
  me: a
houses:
  - {id: va, name: House Valmont, color: "#8b1e3f"}
people:
  - {id: a, name: Ann, house: va, born: 1100, portrait: "[[ann.png]]"}
  - {id: b, name: Bob, parents: [a], house: va, born: 1130, portrait: "[[bob.png]]"}
  - {id: c, name: Cid, parents: [b], house: va, born: 1160}
titles:
  - {id: t1, name: Crown}
`;

function store() {
	const asked: string[] = [];
	return {
		asked,
		resolve: (l: string) => ({ ok: true, file: { path: l.replace(/[[\]]/g, ''), name: l.replace(/[[\]]/g, '') }, format: 'png' }),
		check: async () => null,
		acquire: async (f: { path: string }) => {
			asked.push(f.path);
			return { url: 'blob:x', w: 1, h: 1, release: () => {} };
		},
		onChange: () => () => {},
		peek: () => null,
	};
}

interface PickerLike {
	modalEl: FEl;
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
}
const picker = () => openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike | undefined;

/** The text of the row of person `id` in the open picker. */
function row(id: string): FEl {
	const p = picker()!;
	const item = p.getSuggestions('').find((i) => {
		const el = new FEl('div');
		p.renderSuggestion(i, el);
		return el.getAttribute('data-person') === id;
	})!;
	const el = new FEl('div');
	p.renderSuggestion(item, el);
	return el;
}

describe('P5 x P6: the Find window gets the data it needs (G.3)', () => {
	it('Find: the second text line starts with the relation word to the marked person', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		(host as unknown as { pictures: unknown }).pictures = store();
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		dispatch(el.querySelector('.dynasty-find')!, 'click', { button: 0, detail: 1 });
		await settle();
		expect(picker()).toBeTruthy();
		const sub = row('b').querySelector('.dynasty-picker-sub')?.getText() ?? '';
		// Bob is Ann's child: "Child" (the card word) is expected before the years.
		expect(sub).toMatch(/^(Child|Son)/);
	});

	it('Find: the row asks the picture store for the portrait of the person', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		const s = store();
		(host as unknown as { pictures: unknown }).pictures = s;
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		s.asked.length = 0;
		dispatch(el.querySelector('.dynasty-find')!, 'click', { button: 0, detail: 1 });
		await settle();
		row('b');
		await settle();
		expect(s.asked).toContain('bob.png');
	});
});

describe('P5 x P6: the Titles window gets pictures and openPerson', () => {
	it('Titles: the holder picker and rows get the picture store (opened from the toolbar)', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		const s = store();
		(host as unknown as { pictures: unknown }).pictures = s;
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		const btn = el.querySelector('.dynasty-titles-button');
		expect(btn).toBeTruthy();
		dispatch(btn!, 'click', { button: 0, detail: 1 });
		await settle();
		const win = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-titles')) as unknown as { o: { pictures?: unknown; openPerson?: unknown } };
		expect(win).toBeTruthy();
		expect(win.o.pictures).toBe(s);
		expect(typeof win.o.openPerson).toBe('function');
	});

	it('Titles: closing the window gives the focus back to the Titles button (spec 5.2)', async () => {
		desktop();
		const host = fakeHost(DEFAULT_SETTINGS);
		const { el } = await embed(SRC, { host, handle: fakeHandle('n.md', SRC) });
		const btn = el.querySelector('.dynasty-titles-button') as unknown as FEl;
		dispatch(btn, 'click', { button: 0, detail: 1 });
		await settle();
		const win = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-titles'))!;
		(win as unknown as { close(): void }).close();
		await settle();
		const { runTimers } = await import('../acceptance/fake-dom');
		runTimers(1000);
		const active = (globalThis as unknown as { document: { activeElement: unknown } }).document.activeElement;
		expect([...((active as FEl | null)?.classes ?? [])]).toContain("dynasty-titles-button");
	});
});

describe('control: the picker itself works when it is given the data', () => {
	it('pickPerson with a PickerContext shows the portrait request and the relation word', async () => {
		desktop();
		const { pickPerson } = await import('../../src/obsidian/person-picker');
		const { deriveFamilies } = await import('../../src/core/derive');
		const { parseDynasty } = await import('../../src/core/parse');
		const parsed = parseDynasty(SRC) as unknown as { tree: never };
		const g = deriveFamilies(parsed.tree);
		const s = store();
		void pickPerson(fakeHost().app as never, g, new Set(), 'p', 't', false, null, null, { pictures: s as never, sourcePath: 'n.md', me: 'a' });
		await settle();
		const sub = row('b').querySelector('.dynasty-picker-sub')?.getText() ?? '';
		await settle();
		expect({ asked: s.asked.includes('bob.png'), sub: /^(Child|Son)/.test(sub) }).toEqual({ asked: true, sub: true });
	});
});

describe('D183: the kept height of a block', () => {
	it('the full-screen view does not store its own height under the key of the note block', async () => {
		desktop();
		const { lastHeight, forgetHeights } = await import('../../src/obsidian/block-height');
		forgetHeights();
		// The fake DOM has no layout: give every tree root the height that the test names.
		const H = { now: 300 };
		const make = FEl.prototype.createEl;
		vi.spyOn(FEl.prototype, 'createEl').mockImplementation(function (this: FEl, tag: string, o?: never) {
			const e = make.call(this, tag, o);
			if (e.hasClass('dynasty-root')) e.offsetHeight = H.now;
			return e;
		} as never);
		const host = fakeHost(DEFAULT_SETTINGS);
		const h = fakeHandle('n.md', SRC);
		await embed(SRC, { host, handle: h });
		expect(lastHeight(host.app as never, 'n.md\u0000#0')).toBe(300);
		// The user expands the block: the full-screen view is as high as the window.
		H.now = 900;
		await openFullScreen(SRC, { host, path: 'n.md' });
		expect(lastHeight(host.app as never, 'n.md\u0000#0')).toBe(300);
	});
});

describe('D183: a block with no section that is not in an editor', () => {
	it('a tree that another plugin renders in a side view draws at once, not after the 2 s limit', async () => {
		desktop();
		const { TreeView } = await import('../../src/obsidian/tree-view');
		const host = fakeHost(DEFAULT_SETTINGS);
		Object.assign(host, { startedUp: { ready: () => true, cache: () => true } });
		Object.assign(host.handles, { inEditorOf: () => false });
		const el = new FEl('div');
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => null, addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		flushFrames();
		// No section, not in the note's editor, not an embed or a canvas: nothing will ever make this block known, but the tree waits.
		expect({ drawn: !!el.querySelector('.dynasty-viewport'), placeholder: !!el.querySelector('.dynasty-placeholder') }).toEqual({ drawn: true, placeholder: false });
	});
});

describe('D183 control: the cold start wait', () => {
	function waitingView(ready: { v: boolean }, handle: boolean) {
		const host = fakeHost(DEFAULT_SETTINGS);
		Object.assign(host, { startedUp: { ready: () => ready.v, cache: () => ready.v } });
		const h = fakeHandle('n.md', SRC);
		const registry: Record<string, () => unknown> = handle
			? { quickOrdinal: () => 0, peek: () => h, resolve: async () => h, resolveByBody: () => h, inEditorOf: () => false }
			: { inEditorOf: () => false };
		Object.assign(host.handles, registry);
		return { host, h };
	}
	it('shows the placeholder, draws when the plugin is ready, and a second plugin call changes nothing', async () => {
		desktop();
		const { TreeView } = await import('../../src/obsidian/tree-view');
		const ready = { v: false };
		const { host } = waitingView(ready, true);
		const el = new FEl('div');
		const info = { lineStart: 0, lineEnd: 10, text: '' };
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		expect(!!el.querySelector('.dynasty-placeholder')).toBe(true);
		expect(el.querySelector('.dynasty-read-only-label')).toBeNull();
		ready.v = true;
		(view as never as { startUpDone(): void }).startUpDone();
		(view as never as { startUpDone(): void }).startUpDone();
		await settle();
		flushFrames();
		expect({ placeholder: !!el.querySelector('.dynasty-placeholder'), tree: !!el.querySelector('.dynasty-viewport') }).toEqual({ placeholder: false, tree: true });
		// The old 50 ms timer fires later and must not draw again.
		const { runTimers } = await import('../acceptance/fake-dom');
		const renders = host.renders;
		runTimers(3000);
		expect(host.renders).toBe(renders);
	});
	it('the cap of 8 s draws a tree that never got ready; unload while waiting draws nothing', async () => {
		desktop();
		const { TreeView, STYLES_LIMIT_MS } = await import('../../src/obsidian/tree-view');
		const { runTimers } = await import('../acceptance/fake-dom');
		const ready = { v: false };
		const { host } = waitingView(ready, true);
		const mk = () => {
			const el = new FEl('div');
			const info = { lineStart: 0, lineEnd: 10, text: '' };
			const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
			const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
			view.load();
			return { el, view };
		};
		const a = mk();
		await settle();
		// A start condition that never comes: the cap of the styles (8 s) ends the wait, not the 2 s limit (D183 fix).
		runTimers(2100);
		expect(!!a.el.querySelector('.dynasty-viewport')).toBe(false);
		runTimers(STYLES_LIMIT_MS);
		await settle();
		expect(!!a.el.querySelector('.dynasty-viewport')).toBe(true);
		const b = mk();
		await settle();
		(b.view as never as { unload(): void }).unload();
		clock.now += 3000;
		const errors: unknown[][] = [];
		vi.spyOn(console, 'error').mockImplementation((...x) => void errors.push(x));
		runTimers(3000);
		await settle();
		expect({ drawn: !!b.el.querySelector('.dynasty-viewport'), errors }).toEqual({ drawn: false, errors: [] });
	});
});

describe('G.7: a row of the line of succession in the Titles window opened from the toolbar', () => {
	it('opens that person in the person window, not only closes the Titles window', async () => {
		desktop();
		const { fixtureNote, topLevelBlocks } = await import('../acceptance/load');
		const { EditSheet } = await import('../../src/obsidian/edit-sheet');
		const { rowOf, backButton } = await import('../support/lw-support');
		const body16 = topLevelBlocks(fixtureNote('16'))[0];
		const host = fakeHost(DEFAULT_SETTINGS);
		const h = fakeHandle('n.md', body16);
		const { el } = await embed(body16, { host, handle: h });
		dispatch(el.querySelector('.dynasty-titles-button')!, 'click', { button: 0, detail: 1 });
		await settle();
		const win = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-titles')) as unknown as { contentEl: FEl };
		expect(win).toBeTruthy();
		dispatch(rowOf(win.contentEl, 'duke-of-carrowmere'), 'click');
		const first = win.contentEl.querySelector('.dynasty-succ-item');
		expect(first).toBeTruthy();
		void backButton;
		dispatch(first!, 'click');
		await settle();
		expect(openModals.some((m) => m instanceof EditSheet)).toBe(true);
	});
});

