import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { FOCUS_UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, flushFrames, installDom, pointer, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fullViews, openFullScreen, phone, tabletDevice, type FakeHandle } from './acceptance/tree-view-fakes';

/*
 * WP-C3 of 0.2.5 (D132, the 0.2.5 contract C.3.3): the Focus button. 0.2.8 (G.13): a press always opens the Focus menu:
 * Choose a person, Focus on you (only with a marked person), and (only while a focus shows) Clear focus. Clear
 * focus writes nothing; the Show all people button is gone.
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
	closePluginModals();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Nine generations p0 to p8, one person in each, with the option lines given. */
function line(...options: string[]): string {
	const people = Array.from({ length: 9 }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n');
	return `options:\n  start: p0\n${options.map((o) => `  ${o}\n`).join('')}\npeople:\n${people}\n`;
}
const LINE = line();
const PINNED = line('focus: p4');
const ALL = Array.from({ length: 9 }, (_, i) => `p${i}`).sort();
const FAMILY = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

function noteHandle(body: string): FakeHandle {
	const h = fakeHandle('n.md', body);
	h.write.mockImplementation((async (op: Op) => {
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.change(r.body);
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
	}) as never);
	return h;
}

const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();
/** `detail` 0 is a key press (Enter or Space), 1 is a mouse or finger. */
const click = (el: FEl, detail = 1) => dispatch(el, 'click', { button: 0, clientX: 10, clientY: 10, detail });
const tools = (root: FEl) => root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);

async function press(root: FEl, sel: string, detail = 1): Promise<void> {
	const b = root.querySelector(sel);
	if (!b) throw new Error(`no ${sel}`);
	click(b, detail);
	await settle();
	resizeAll();
	flushFrames();
}

async function desk(source: string, handle: FakeHandle = noteHandle(source)) {
	desktop();
	const e = await embed(source, { handle });
	return { ...e, handle, root: e.el };
}

const focusButton = (root: FEl) => root.querySelector('.dynasty-focus')!;
const list = (root: FEl) => root.querySelector('.dynasty-popover-focus');
const items = (root: FEl) => root.querySelectorAll('.dynasty-popover-focus .dynasty-popover-item');
const pickerOpen = () => openModals.some((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker'));

interface PickerLike {
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
	onChooseSuggestion(item: unknown, evt: unknown): void;
	close(): void;
}

function picker(): PickerLike {
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker'));
	if (!p) throw new Error('no picker is open');
	return p as unknown as PickerLike;
}

async function choose(id: string): Promise<void> {
	const p = picker();
	const item = p.getSuggestions('').find((i) => {
		const el = new FEl('div');
		p.renderSuggestion(i, el);
		return el.getAttribute('data-person') === id;
	});
	if (!item) throw new Error(`the picker does not offer ${id}`);
	p.onChooseSuggestion(item, {});
	p.close();
	runTimers(0);
	await settle();
	resizeAll();
	flushFrames();
}

describe('the Focus button with no focus on', () => {
	it('opens the menu with one item, Choose a person; the choice draws the family', async () => {
		const { root } = await desk(LINE);
		const b = focusButton(root);
		expect(b.getAttribute('aria-haspopup')).toBe('true');
		expect(b.getAttribute('aria-expanded')).toBe('false');
		expect(b.getAttribute('aria-label')).toBe(FOCUS_UI.focus);
		expect(b.getAttribute('aria-pressed')).toBe('false');
		await press(root, '.dynasty-focus');
		expect(pickerOpen()).toBe(false);
		expect(list(root)).not.toBeNull();
		expect(items(root).map((i) => i.querySelector('.dynasty-more-text')!.getText())).toEqual([FOCUS_UI.choose]);
		await press(root, '.dynasty-popover-focus .dynasty-popover-item');
		expect(pickerOpen()).toBe(true);
		await choose('p4');
		expect(drawn(root)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
	});

	it('has no Show all people button, with or without a focus', async () => {
		const { root } = await desk(PINNED);
		expect(root.querySelector('.dynasty-show-all')).toBeNull();
		expect(tools(root)).not.toContain('dynasty-show-all');
		const none = await desk(LINE);
		expect(none.root.querySelector('.dynasty-show-all')).toBeNull();
	});

	it('a picker closed with no choice gives the keyboard focus back to the Focus button', async () => {
		const { root } = await desk(LINE);
		await press(root, '.dynasty-focus', 0);
		click(items(root)[0], 0);
		await settle();
		new FEl('div').focus();
		picker().close();
		runTimers(0);
		await settle();
		expect(fakeDoc.activeElement).toBe(focusButton(root));
	});
});

describe('the Focus button while a focus shows', () => {
	it('has the menu attributes and the label "Focus is on"', async () => {
		const { root } = await desk(PINNED);
		const b = focusButton(root);
		expect(b.getAttribute('aria-haspopup')).toBe('true');
		expect(b.getAttribute('aria-expanded')).toBe('false');
		expect(b.getAttribute('aria-label')).toBe(FOCUS_UI.focusOn);
		expect(b.getAttribute('aria-pressed')).toBe('true');
		expect(b.hasClass('is-active')).toBe(true);
	});

	it('a press opens a list with two items, and no picker', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus');
		expect(pickerOpen()).toBe(false);
		expect(list(root)).not.toBeNull();
		expect(items(root).map((i) => i.querySelector('.dynasty-more-text')!.getText())).toEqual([FOCUS_UI.choose, FOCUS_UI.clear]);
		expect(items(root).map((i) => i.getAttribute('aria-label'))).toEqual([FOCUS_UI.chooseLabel, FOCUS_UI.clearLabel]);
		expect(focusButton(root).getAttribute('aria-expanded')).toBe('true');
	});

	it('a second press closes the list and aria-expanded follows', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus');
		expect(list(root)).not.toBeNull();
		await press(root, '.dynasty-focus');
		expect(list(root)).toBeNull();
		expect(focusButton(root).getAttribute('aria-expanded')).toBe('false');
		expect(pickerOpen()).toBe(false);
	});

	it('Esc closes the list and gives the focus back to the Focus button', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus', 0);
		expect(fakeDoc.activeElement).toBe(items(root)[0]);
		dispatch(fakeDoc.activeElement!, 'keydown', { key: 'Escape' });
		expect(list(root)).toBeNull();
		expect(fakeDoc.activeElement).toBe(focusButton(root));
		expect(focusButton(root).getAttribute('aria-expanded')).toBe('false');
	});

	it('a key press on the button puts the focus on the first item; a mouse press does not', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus', 0);
		expect(fakeDoc.activeElement).toBe(items(root)[0]);
		await press(root, '.dynasty-focus', 0);
		new FEl('div').focus();
		await press(root, '.dynasty-focus', 1);
		expect(list(root)).not.toBeNull();
		expect(fakeDoc.activeElement).not.toBe(items(root)[0]);
	});

	it('Choose a person closes the list and opens the picker; the choice moves the focus', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus');
		await press(root, '.dynasty-popover-focus .dynasty-popover-item');
		expect(list(root)).toBeNull();
		expect(pickerOpen()).toBe(true);
		await choose('p7');
		expect(drawn(root)).toEqual(['p4', 'p5', 'p6', 'p7', 'p8']);
	});

	it('a picker closed with no choice (from the list) gives the focus back to the Focus button', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus', 0);
		click(items(root)[0], 0);
		await settle();
		new FEl('div').focus();
		picker().close();
		runTimers(0);
		await settle();
		expect(fakeDoc.activeElement).toBe(focusButton(root));
		expect(drawn(root)).toEqual(FAMILY);
	});

	it('Clear focus shows all people, builds the button again with its menu attributes and writes nothing', async () => {
		const { root, handle } = await desk(PINNED);
		expect(drawn(root)).toEqual(FAMILY);
		await press(root, '.dynasty-focus');
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(list(root)).toBeNull();
		expect(drawn(root)).toEqual(ALL);
		const b = focusButton(root);
		expect(b.getAttribute('aria-haspopup')).toBe('true');
		expect(b.getAttribute('aria-expanded')).toBe('false');
		expect(b.getAttribute('aria-label')).toBe(FOCUS_UI.focus);
		expect(b.hasClass('is-active')).toBe(false);
		expect(handle.write).not.toHaveBeenCalled();
		expect(handle.body).toBe(PINNED);
		expect(handle.state.focus).toEqual({ id: null });
	});

	it('after Clear focus with a key, the keyboard focus is on the new Focus button', async () => {
		const { root } = await desk(PINNED);
		await press(root, '.dynasty-focus', 0);
		click(items(root)[1], 0);
		await settle();
		resizeAll();
		flushFrames();
		expect(fakeDoc.activeElement).toBe(focusButton(root));
	});

	it('after Clear focus the menu has one item again, and a choice shows that family; the pin stays in the note', async () => {
		const { root, handle } = await desk(PINNED);
		await press(root, '.dynasty-focus');
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		await press(root, '.dynasty-focus');
		expect(items(root)).toHaveLength(1);
		await press(root, '.dynasty-popover-focus .dynasty-popover-item');
		expect(pickerOpen()).toBe(true);
		await choose('p7');
		expect(drawn(root)).toEqual(['p4', 'p5', 'p6', 'p7', 'p8']);
		expect(handle.write).not.toHaveBeenCalled();
		expect(handle.body).toBe(PINNED);
	});

	it('a focus that the session chose also opens the list, and Clear focus shows all people', async () => {
		const { root, handle } = await desk(LINE);
		await press(root, '.dynasty-focus');
		await press(root, '.dynasty-popover-focus .dynasty-popover-item');
		await choose('p4');
		expect(drawn(root)).toEqual(FAMILY);
		await press(root, '.dynasty-focus');
		expect(items(root)).toHaveLength(2);
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(drawn(root)).toEqual(ALL);
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('what Clear focus resets', () => {
	it('it ends the result of the relation finder and shows all people', async () => {
		const { root, handle } = await desk(PINNED);
		handle.state.finder = { first: 'p3', second: 'p5', index: 0, whole: false, steps: false };
		await press(root, '.dynasty-focus');
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(handle.state.finder).toBeNull();
		expect(root.querySelector('.dynasty-result')).toBeNull();
		expect(drawn(root)).toEqual(ALL);
	});

	it('it also clears a pending "show the saved person"', async () => {
		const { root, handle } = await desk(PINNED);
		handle.state.shown = { id: 'p6', place: 'embed' } as never;
		await press(root, '.dynasty-focus');
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(handle.state.shown).toBeNull();
	});

	it('the full-screen view of the block (a pin, a phone) shows all people, writes nothing and stays open', async () => {
		phone();
		const { root, handle, modal } = await openFullScreen(PINNED);
		expect(drawn(root)).toEqual(FAMILY);
		expect(tools(root)).toContain('dynasty-focus');
		expect(tools(root)).not.toContain('dynasty-show-all');
		await press(root, '.dynasty-focus');
		expect(items(root).map((i) => i.querySelector('.dynasty-more-text')!.getText())).toEqual([FOCUS_UI.choose, FOCUS_UI.clear]);
		click(items(root)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(drawn(root)).toEqual(ALL);
		expect(handle!.write).not.toHaveBeenCalled();
		expect(fullViews()).toContain(modal);
	});

	it('the D21 focus of a full-screen view opened from a badge ends with Clear focus', async () => {
		tabletDevice();
		const src = line('focus: p4');
		const handle = noteHandle(src);
		const { el } = await embed(src, { handle });
		const badge = el.querySelector('.dynasty-focus-badge')!;
		dispatch(badge, 'pointerdown', pointer('touch', 4, 100, 100));
		dispatch(badge, 'pointerup', pointer('touch', 4, 100, 100));
		click(badge);
		await settle();
		resizeAll();
		flushFrames();
		expect(fullViews()).toHaveLength(1);
		const full = fullViews()[0].containerEl as unknown as FEl;
		const before = drawn(full);
		expect(before).not.toEqual(ALL);
		await press(full, '.dynasty-focus');
		click(items(full)[1]);
		await settle();
		resizeAll();
		flushFrames();
		expect(drawn(full)).toEqual(ALL);
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('styles.css and the texts', () => {
	it('the Focus menu has the rule of the toolbar menus (0.2.8: one rule for More and Focus)', () => {
		const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
		expect(css).toMatch(/\.dynasty-popover-more,\s*\.dynasty-popover-focus \{/);
	});

	it('FOCUS_UI has no Show all people text now', () => {
		expect(Object.keys(FOCUS_UI)).not.toContain('showAll');
		expect(JSON.stringify(FOCUS_UI)).not.toContain('Show all people');
	});
});
