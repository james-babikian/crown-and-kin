import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { finderOrientation, fittedNamePx } from '../src/obsidian/focus-mode';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { COMPACT_NAME_EM } from '../src/render/dom/scene';
import { FINDER_UI, UI } from '../src/render/ui-text';
import { FEl, clock, dispatch, dispatchWindow, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { sample12 } from './acceptance/relations-support';
import { desktop, embed, fakeHandle, fakeHost, fullViews, openFullScreen, phone, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * M7 correction round, Obsidian side: D51 (the finder's small tree on an upright phone), D52 (Fit
 * and the legend in the More list on a phone), the result kept by Find with no line, the focus
 * after a cancelled second picker, and the phone rules of styles.css for the toolbar and result bar.
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
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const F12 = sample12().source;
const F12_FOCUS = F12.replace('options:\n  me: gwen\n', 'options:\n  focus: leo\n  me: gwen\n');
const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');

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

async function desk(source: string, host: Host = fakeHost()) {
	desktop();
	const e = await embed(source, { host, handle: noteHandle(source) });
	return { ...e, root: e.el };
}

const click = (el: FEl, detail = 1) => dispatch(el, 'click', { button: 0, clientX: 10, clientY: 10, detail });

async function press(root: FEl, sel: string): Promise<void> {
	const b = root.querySelector(sel);
	if (!b) throw new Error(`no ${sel}`);
	click(b);
	await settle();
	resizeAll();
	flushFrames();
}

const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();
const barText = (root: FEl) => root.querySelector('.dynasty-result-text')?.getText() ?? null;
const tools = (root: FEl) => root.querySelector('.dynasty-toolbar')!.children.map((c) => [...c.classes].find((x) => x.startsWith('dynasty-') && x !== 'dynasty-tool')!);
/** The cards that the view does not show whole, from the scene's transform and the viewport size. */
function outside(root: FEl): string[] {
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '');
	if (!m) throw new Error('no transform');
	const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const vp = root.querySelector('.dynasty-viewport')!;
	return root.querySelectorAll('.dynasty-card').flatMap((card) => {
		const bg = card.querySelector('.dynasty-card-bg')!;
		const x = tx + Number(bg.getAttribute('x')) * s;
		const y = ty + Number(bg.getAttribute('y')) * s;
		const whole = x >= -0.5 && y >= -0.5 && x + Number(bg.getAttribute('width')) * s <= vp.clientWidth + 0.5 && y + Number(bg.getAttribute('height')) * s <= vp.clientHeight + 0.5;
		return whole ? [] : [card.getAttribute('data-person')!];
	});
}
const orientation = (root: FEl) => (root.hasClass('dynasty-root') ? root : root.querySelector('.dynasty-root'))!.getAttribute('data-dynasty-orientation');

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

/** Chooses `id` in the open picker; the tree it draws has not had its first view yet. */
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
}

/** More → Relation → two people, then the first view in a viewport of `w` × `h` px. */
async function finder(root: FEl, first: string, second: string, w = 390, h = 700): Promise<void> {
	await press(root, '.dynasty-more');
	await press(root, '.dynasty-more-relation');
	await choose(first);
	await choose(second);
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = w;
	vp.clientHeight = h;
	resizeAll();
	flushFrames();
}

/** Nine people in one line, p0 … p8, each the child of the one before: a straight line. */
const LINE = `people:\n${Array.from({ length: 9 }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n')}\n`;
/** `n` people joined only by partnerships, one after the other: a wide line. */
const chain = (n: number) =>
	`people:\n${Array.from({ length: n }, (_, i) => `  - id: x${i}\n    name: X${i}\n    sex: ${i % 2 ? 'f' : 'm'}`).join('\n')}\nunions:\n${Array.from({ length: n - 1 }, (_, i) => `  - partners: [x${i}, x${i + 1}]`).join('\n')}\n`;

// =============================================================================================

describe('D51: the direction of the finder small tree (pure rule)', () => {
	const box = (w: number, h: number) => ({ x: 0, y: 0, w, h });
	const area = { w: 390, h: 600 };

	it('names on screen: Full as they are, Compact 1.5 times, Overview none (spec §5.4)', () => {
		expect(fittedNamePx(box(390, 600), area, 16)).toBe(16);
		// A tree twice the width: 8 px names are Compact (8 < 9), shown 12 px.
		expect(fittedNamePx(box(780, 600), area, 16)).toBeCloseTo(8 * COMPACT_NAME_EM);
		expect(fittedNamePx(box(390 * 8, 600), area, 16)).toBe(0);
	});

	it('the direction with the larger names wins; a tie stays sideways (D24)', () => {
		const f = 16;
		expect(finderOrientation(area, { bounds: box(2000, 100), fontPx: f }, { bounds: box(200, 900), fontPx: f })).toBe('down');
		expect(finderOrientation(area, { bounds: box(300, 500), fontPx: f }, { bounds: box(1600, 300), fontPx: f })).toBe('sideways');
		expect(finderOrientation(area, { bounds: box(100, 100), fontPx: f }, { bounds: box(100, 100), fontPx: f })).toBe('sideways');
		// Compact counts 1.5 times: 9.5 px Full (down) loses to 8.5 px Compact (12.75 px shown).
		expect(finderOrientation(area, { bounds: box(390 / (8.5 / f), 100), fontPx: f }, { bounds: box(390 / (9.5 / f), 100), fontPx: f })).toBe('sideways');
	});
});

describe('D51: the finder small tree in the phone full-screen view', () => {
	async function phoneFull(source: string) {
		phone();
		const { root, handle } = await openFullScreen(source);
		return { root, handle };
	}

	it('a straight line is drawn top to bottom; the view keeps its orientation, so no turn follows', async () => {
		const { root } = await phoneFull(LINE);
		expect(orientation(root)).toBe('sideways');
		await finder(root, 'p0', 'p8');
		expect(barText(root)).not.toBeNull();
		expect(drawn(root)).toHaveLength(9);
		expect(orientation(root)).toBe('down');
		// A later resize (for example the keyboard) is not a turn of the phone: nothing is drawn again.
		const rootEl = root.querySelector('.dynasty-root');
		resizeAll();
		flushFrames();
		dispatchWindow('resize');
		expect(root.querySelector('.dynasty-root')).toBe(rootEl);
		expect(orientation(root)).toBe('down');
	});

	it('a wide line (a chain of partnerships) stays sideways', async () => {
		const { root } = await phoneFull(chain(11));
		await finder(root, 'x0', 'x10');
		expect(drawn(root)).toHaveLength(11);
		expect(orientation(root)).toBe('sideways');
	});

	it('the first view shows the whole line when its names are readable as Compact names (1.5 times, spec §5.4)', async () => {
		// 14 partners stacked: fitted, the Full names are about 8 px (under 11 px), the Compact names about 12 px.
		const { root } = await phoneFull(chain(14));
		await finder(root, 'x0', 'x13');
		expect(orientation(root)).toBe('sideways');
		const scale = Number(/scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')!.getAttribute('transform')!)![1]);
		expect(scale * 16).toBeLessThan(9);
		expect(scale * 16 * COMPACT_NAME_EM).toBeGreaterThanOrEqual(11);
		expect(outside(root)).toEqual([]);
	});

	it('"Show in the whole tree" uses the normal orientation of the phone (sideways)', async () => {
		const { root } = await phoneFull(LINE);
		await finder(root, 'p0', 'p8');
		expect(orientation(root)).toBe('down');
		await press(root, '.dynasty-result-whole');
		expect(root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder')).toBe('whole');
		expect(orientation(root)).toBe('sideways');
	});

	it('on the computer the small tree is always top to bottom', async () => {
		const { root } = await desk(LINE);
		await finder(root, 'p0', 'p8', 800, 600);
		expect(orientation(root)).toBe('down');
	});
});

describe('D52: on a phone, Fit and the legend are items of the More list', () => {
	it('the phone full-screen toolbar has no Fit and no Legend; More lists Relation, Titles (M8), Fit and the line styles', async () => {
		phone();
		const { root } = await openFullScreen(F12);
		const t = tools(root);
		expect(t).not.toContain('dynasty-fit');
		expect(t).not.toContain('dynasty-legend-button');
		expect(t).toContain('dynasty-more');
		expect(t[t.length - 1]).toBe('dynasty-close');
		await press(root, '.dynasty-more');
		const items = root.querySelectorAll('.dynasty-popover-more .dynasty-more-item');
		expect(items.map((i) => [...i.classes].find((c) => c.startsWith('dynasty-more-') && c !== 'dynasty-more-item'))).toEqual(['dynasty-more-relation', 'dynasty-more-titles', 'dynasty-more-save', 'dynasty-more-fit', 'dynasty-more-legend']);
		expect(items.map((i) => i.querySelector('.dynasty-more-text')!.getText())).toEqual([FINDER_UI.relation, 'Titles', 'Save as picture', UI.fit, UI.legend]);
		// The texts are the whole names: no label that differs from them.
		expect(items[3].getAttribute('aria-label')).toBeNull();
		expect(items[4].getAttribute('aria-label')).toBeNull();
	});

	it('Fit in the More list fits the tree; the line styles item opens the legend', async () => {
		phone();
		const { root } = await openFullScreen(F12);
		const before = root.querySelector('.dynasty-scene')!.getAttribute('transform');
		await press(root, '.dynasty-more');
		click(root.querySelector('.dynasty-more-fit')!);
		flushFrames();
		expect(root.querySelector('.dynasty-popover-more')).toBeNull();
		expect(root.querySelector('.dynasty-scene')!.getAttribute('transform')).not.toBe(before);
		await press(root, '.dynasty-more');
		click(root.querySelector('.dynasty-more-legend')!);
		expect(root.querySelector('.dynasty-popover-legend .dynasty-legend')).not.toBeNull();
	});

	it('a key press on a More item gives the focus back to More', async () => {
		phone();
		const { root } = await openFullScreen(F12);
		const more = root.querySelector('.dynasty-more')!;
		click(more, 0);
		click(root.querySelector('.dynasty-more-legend')!, 0);
		expect(fakeDoc.activeElement).toBe(more);
		expect(root.querySelector('.dynasty-popover-legend')).not.toBeNull();
	});

	it('the computer toolbar does not change: Fit and Legend stay, More lists Relation and Titles (M8)', async () => {
		desktop();
		const { root } = await openFullScreen(F12);
		expect(tools(root)).toEqual(['dynasty-add-person', 'dynasty-houses-button', 'dynasty-focus', 'dynasty-find', 'dynasty-fit', 'dynasty-legend-button', 'dynasty-more', 'dynasty-close']);
		await press(root, '.dynasty-more');
		// M9 (spec §13.8, O11): Relation, Titles and Save as picture.
		expect(root.querySelectorAll('.dynasty-popover-more .dynasty-more-item')).toHaveLength(3);
	});

	it('styles.css: the phone toolbar keeps one row and Close stays on the screen', () => {
		const rule = (sel: string) => {
			const i = css.indexOf(`${sel} {`);
			expect(i, sel).toBeGreaterThanOrEqual(0);
			return css.slice(i, css.indexOf('}', i));
		};
		const bar = rule('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar');
		expect(css).toMatch(/\.modal\.dynasty-fullscreen\.is-phone \.dynasty-full \.dynasty-toolbar \{[^}]*flex-wrap: nowrap/);
		expect(bar).toContain('bottom: 0');
		const close = rule('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar .dynasty-close');
		expect(close).toContain('position: sticky');
		expect(close).toContain('right: 0');
	});
});

describe('the result bar on a phone (styles.css)', () => {
	it('its buttons share one row; a long label breaks inside its button, which stays 44 px', () => {
		expect(css).toMatch(/\.modal\.dynasty-fullscreen\.is-phone \.dynasty-full \.dynasty-result-buttons \{[^}]*flex-wrap: nowrap/);
		expect(css).toMatch(/\.modal\.dynasty-fullscreen\.is-phone \.dynasty-full \.dynasty-result \.dynasty-result-button \{[^}]*white-space: normal/);
		expect(css).toMatch(/\.dynasty-result \.dynasty-result-button \{[^}]*min-height: 44px/);
	});
});

describe('Find keeps a result with no line (spec §6.10, §13.2)', () => {
	it('in focus mode, Find of a person outside the family shows all people with the bar', async () => {
		desktop();
		const { root: full, handle } = await openFullScreen(F12_FOCUS);
		expect(full.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus')).toBe('leo');
		await press(full, '.dynasty-more');
		await press(full, '.dynasty-more-relation');
		await choose('gwen');
		await choose('quill');
		resizeAll();
		flushFrames();
		expect(barText(full)).toBe('Gwen and Quill have no relation in this tree.');
		expect(drawn(full)).not.toContain('gwen');
		await press(full, '.dynasty-find');
		await choose('gwen');
		resizeAll();
		flushFrames();
		expect(drawn(full)).toContain('gwen');
		expect(barText(full)).toBe('Gwen and Quill have no relation in this tree.');
		expect(handle!.state.finder).not.toBeNull();
		expect(full.querySelectorAll('.dynasty-card.dynasty-highlight').length).toBeGreaterThan(0);
	});
});

describe('focus after a cancelled picker (spec §5.2)', () => {
	it('Esc in the second picker gives the focus back to More', async () => {
		const { root } = await desk(F12);
		const more = root.querySelector('.dynasty-more')!;
		click(more, 0);
		click(root.querySelector('.dynasty-more-relation')!, 0);
		await settle();
		await choose('leo');
		// Somewhere else first, as after a picker that took the focus.
		new FEl('div').focus();
		picker().close();
		runTimers(0);
		await settle();
		expect(fakeDoc.activeElement).toBe(more);
		expect(fullViews()).toHaveLength(0);
	});
});
