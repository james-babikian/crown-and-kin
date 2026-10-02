import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { finderFirstView, finderLevel, finderOrientation } from '../src/obsidian/focus-mode';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { clearMeasureCache } from '../src/render/dom/measure';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { sample12 } from './acceptance/relations-support';
import { desktop, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * The M7 finishing round, view side (the decision notes "Supervisor rulings for the finishing round" 1 and 2):
 * the finder's first view on every device fits the whole line into the free area below the result
 * bar when the names are then at least 11 px (Compact names count 1.5 times), else it shows 14 px
 * names with the common ancestors in view, never under the bar; D51 compares the two directions by
 * level first, then by name size. Tested at 12 px text (the owner's size) and 16 px.
 */

const fontPx = { now: 16 };

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
	const base = g.getComputedStyle as (e: unknown) => Record<string, unknown>;
	g.getComputedStyle = (e: unknown) => ({ ...base(e), fontSize: `${fontPx.now}px` });
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	clearRelationCache();
	fontPx.now = 16;
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const block = (file: string) => /```dynasty\n([\s\S]*?)```/.exec(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), 'utf8'))![1];
const F03 = block('03-cousin-marriage.md');
const F12 = sample12().source;
/** Nine people in one line, p0 … p8, each the child of the one before: a tall line. */
const LINE = `people:\n${Array.from({ length: 9 }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n')}\n`;

interface PickerLike {
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
	onChooseSuggestion(item: unknown, evt: unknown): void;
	close(): void;
}

async function choose(id: string): Promise<void> {
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike | undefined;
	if (!p) throw new Error('no picker is open');
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

async function press(root: FEl, sel: string): Promise<void> {
	const b = root.querySelector(sel);
	if (!b) throw new Error(`no ${sel}`);
	dispatch(b, 'click', { button: 0, clientX: 10, clientY: 10, detail: 1 });
	await settle();
	resizeAll();
	flushFrames();
}

interface Frame {
	w: number;
	h: number;
	/** The result bar as the browser lays it out: its top and height in the viewport. */
	bar: { top: number; height: number };
	/** A toolbar at the bottom (the phone's full-screen view): its height. */
	bottomBar?: number;
}

/** More → Relation → two people, then the first view in `frame`. */
async function finder(root: FEl, first: string, second: string, frame: Frame): Promise<void> {
	await press(root, '.dynasty-more');
	await press(root, '.dynasty-more-relation');
	await choose(first);
	await choose(second);
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = frame.w;
	vp.clientHeight = frame.h;
	const result = root.querySelector('.dynasty-result')!;
	result.offsetTop = frame.bar.top;
	result.offsetHeight = frame.bar.height;
	if (frame.bottomBar) {
		const tools = root.querySelector('.dynasty-toolbar')!;
		tools.offsetTop = frame.h - frame.bottomBar;
		tools.offsetHeight = frame.bottomBar;
	}
	resizeAll();
	flushFrames();
}

/** Each card on the screen, from the scene's transform: its top, bottom, left and right in viewport px. */
function cardsOnScreen(root: FEl): Map<string, { top: number; bottom: number; left: number; right: number }> {
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '');
	if (!m) throw new Error('no transform');
	const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const out = new Map<string, { top: number; bottom: number; left: number; right: number }>();
	for (const card of root.querySelectorAll('.dynasty-card')) {
		const bg = card.querySelector('.dynasty-card-bg')!;
		const left = tx + Number(bg.getAttribute('x')) * s;
		const top = ty + Number(bg.getAttribute('y')) * s;
		out.set(card.getAttribute('data-person')!, { top, left, bottom: top + Number(bg.getAttribute('height')) * s, right: left + Number(bg.getAttribute('width')) * s });
	}
	return out;
}

const scaleOf = (root: FEl) => Number(/scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')!.getAttribute('transform')!)![1]);
const orientation = (root: FEl) => root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-orientation');

/** The cards that are not whole in the free area between the result bar and the bottom of the view (or a bottom toolbar). */
function notWhole(root: FEl, frame: Frame): string[] {
	const top = frame.bar.top + frame.bar.height;
	const bottom = frame.h - (frame.bottomBar ?? 0);
	return [...cardsOnScreen(root)].filter(([, c]) => c.top < top - 0.5 || c.bottom > bottom + 0.5 || c.left < -0.5 || c.right > frame.w + 0.5).map(([id]) => id);
}

/** The cards under the result bar: any part of the card is above the bar's bottom edge while the card is on the screen. */
function underBar(root: FEl, frame: Frame): string[] {
	const bottom = frame.bar.top + frame.bar.height;
	return [...cardsOnScreen(root)].filter(([, c]) => c.bottom > 0 && c.top < bottom - 0.5 && c.right > 0 && c.left < frame.w).map(([id]) => id);
}

// =============================================================================================

describe('the finder first view and D51 (pure rules)', () => {
	const box = (w: number, h: number) => ({ x: 0, y: 0, w, h });
	const area = { w: 390, h: 600 };

	it('finderLevel: 2 = the whole line at Full level, 1 = at Compact level, 0 = names under 11 px', () => {
		expect(finderLevel(box(390, 600), area, 12)).toBe(2);
		// 9.5 px Full names: under 11 px, so the first view zooms and the line is not whole.
		expect(finderLevel(box(390 * (16 / 9.5), 100), area, 16)).toBe(0);
		// 8 px Full names are Compact names of 12 px.
		expect(finderLevel(box(390 * 2, 100), area, 16)).toBe(1);
		// 6 px Full names are Compact names of 9 px.
		expect(finderLevel(box(390 * (16 / 6), 100), area, 16)).toBe(0);
	});

	it('D51: the level counts first; a whole line at Full level wins over larger Compact names', () => {
		// 12 px text: down fits at 12 px Full; sideways shows 8.7 px Full names, drawn as 13 px Compact names.
		const down = { bounds: box(360, 400), fontPx: 12 };
		const sideways = { bounds: box(390 / 0.726, 200), fontPx: 12 };
		expect(finderOrientation(area, sideways, down)).toBe('down');
		// Equal levels: the larger names win; a tie stays sideways (D24).
		expect(finderOrientation(area, { bounds: box(390, 100), fontPx: 16 }, { bounds: box(300, 100), fontPx: 16 })).toBe('sideways');
		expect(finderOrientation(area, { bounds: box(500, 100), fontPx: 16 }, { bounds: box(400, 100), fontPx: 16 })).toBe('down');
		// A Full level under 11 px does not show the whole line: a whole line at Compact level wins.
		expect(finderOrientation(area, { bounds: box(390 / (8.5 / 16), 100), fontPx: 16 }, { bounds: box(390 / (9.5 / 16), 100), fontPx: 16 })).toBe('sideways');
	});

	it('finderFirstView: a line with names of 11 px or more is fitted below the bar', () => {
		const v = finderFirstView(box(600, 300), { w: 700, h: 500 }, 16, 164, [box(180, 64)], 'down');
		const top = 250 + (0 - v.cy) * v.scale;
		expect(v.scale).toBeCloseTo(1);
		expect(top).toBeGreaterThanOrEqual(164 - 0.01);
	});

	it('finderFirstView: else 14 px names, with the oldest cards at the top of the free area (down) or at the left (sideways)', () => {
		const bounds = { x: -24, y: -24, w: 2000, h: 3000 };
		const oldest = [{ x: 800, y: 0, w: 180, h: 64 }];
		const v = finderFirstView(bounds, { w: 700, h: 500 }, 16, 164, oldest, 'down');
		expect(v.scale).toBeCloseTo(14 / 16);
		const top = 250 + (0 - v.cy) * v.scale;
		const left = 350 + (800 - v.cx) * v.scale;
		expect(top).toBeGreaterThanOrEqual(164);
		expect(top).toBeLessThan(164 + 30);
		expect(left).toBeGreaterThanOrEqual(0);
		expect(left + 180 * v.scale).toBeLessThanOrEqual(700);
		const s = finderFirstView(bounds, { w: 390, h: 700 }, 16, 92, [{ x: 0, y: 1400, w: 180, h: 64 }], 'sideways');
		const sLeft = 195 + (0 - s.cx) * s.scale;
		const sTop = 350 + (1400 - s.cy) * s.scale;
		expect(sLeft).toBeGreaterThanOrEqual(0);
		expect(sLeft).toBeLessThan(30);
		expect(sTop).toBeGreaterThanOrEqual(92);
		expect(sTop + 64 * s.scale).toBeLessThanOrEqual(700);
	});
});

describe('the finder first view on a phone (D51 at 12 px and 16 px text)', () => {
	// The phone's full-screen view: the result bar at the top (one row, 92 px), the toolbar at the bottom.
	const frame: Frame = { w: 390, h: 760, bar: { top: 0, height: 92 }, bottomBar: 52 };

	for (const px of [12, 16])
		it(`Conrad > Ulric (sample tree 3) at ${px} px: top to bottom, every card whole between the bar and the toolbar`, async () => {
			fontPx.now = px;
			clearMeasureCache();
			phone();
			const { root } = await openFullScreen(F03);
			await finder(root, 'conrad', 'ulric', frame);
			expect(root.querySelector('.dynasty-result-text')!.getText()).toBe("Ulric Veyle is Conrad Castellane’s first cousin.");
			expect(orientation(root)).toBe('down');
			expect(cardsOnScreen(root).size).toBe(6);
			expect(notWhole(root, frame)).toEqual([]);
			// Full level: the names are drawn at 11 px or more.
			expect(scaleOf(root) * px).toBeGreaterThanOrEqual(11);
		});

	it('Leo > Wynn (sample tree 12) at 12 px: every card whole, Harold not under the bar', async () => {
		fontPx.now = 12;
		clearMeasureCache();
		phone();
		const { root } = await openFullScreen(F12);
		await finder(root, 'leo', 'wynn', frame);
		expect(notWhole(root, frame)).toEqual([]);
		expect(underBar(root, frame)).toEqual([]);
	});
});

describe('the finder first view on the computer (a tree in a note, 700 × 500, a result bar of two rows)', () => {
	const frame: Frame = { w: 700, h: 500, bar: { top: 60, height: 104 } };

	it('Conrad > Ulric at 16 px: the whole line fitted below the bar (names of 11 px or more), no card under it', async () => {
		desktop();
		const { root } = await openFullScreen(F03);
		await finder(root, 'conrad', 'ulric', frame);
		expect(scaleOf(root) * 16).toBeGreaterThanOrEqual(11);
		expect(underBar(root, frame)).toEqual([]);
		expect(notWhole(root, frame)).toEqual([]);
	});

	it('Conrad > Ulric at 12 px: fitted, the names would be under 11 px, so 14 px names with Aurel and Viviane whole below the bar', async () => {
		fontPx.now = 12;
		clearMeasureCache();
		desktop();
		const { root } = await openFullScreen(F03);
		await finder(root, 'conrad', 'ulric', frame);
		expect(scaleOf(root) * 12).toBeCloseTo(14);
		expect(underBar(root, frame)).toEqual([]);
		const cut = notWhole(root, frame);
		expect(cut).not.toContain('aurel');
		expect(cut).not.toContain('viviane');
	});

	it('Leo > Wynn (sample tree 12, the Harold case): Harold and the line below the bar', async () => {
		desktop();
		const { root } = await openFullScreen(F12);
		await finder(root, 'leo', 'wynn', frame);
		expect(underBar(root, frame)).toEqual([]);
		expect(notWhole(root, frame)).toEqual([]);
	});

	it('a line too tall to fit with 11 px names: 14 px names, and the common ancestor at the top of the free area', async () => {
		desktop();
		const { root } = await openFullScreen(LINE);
		await finder(root, 'p8', 'p0', frame);
		expect(scaleOf(root) * 16).toBeCloseTo(14);
		expect(underBar(root, frame)).toEqual([]);
		const p0 = cardsOnScreen(root).get('p0')!;
		expect(p0.top).toBeGreaterThanOrEqual(164);
		expect(p0.top).toBeLessThan(164 + 40);
		expect(notWhole(root, frame)).not.toContain('p0');
	});

	it('"Show in the whole tree": the line fitted below the bar, no card of the line under it', async () => {
		desktop();
		const { root } = await openFullScreen(F03);
		await finder(root, 'conrad', 'ulric', frame);
		dispatch(root.querySelector('.dynasty-result-whole')!, 'click', { button: 0, clientX: 10, clientY: 10, detail: 1 });
		await settle();
		// The bar is drawn again, with the same size, before the first view of the whole tree.
		const result = root.querySelector('.dynasty-result')!;
		result.offsetTop = frame.bar.top;
		result.offsetHeight = frame.bar.height;
		resizeAll();
		flushFrames();
		expect(root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder')).toBe('whole');
		const line = ['aurel', 'viviane', 'bastien', 'giselle', 'conrad', 'ulric'];
		expect(underBar(root, frame).filter((id) => line.includes(id))).toEqual([]);
	});
});

describe('the result bar on the computer is as wide as the tree (owner, 2026-09-27)', () => {
	const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
	/** The body of the rule whose selector is exactly `sel`, at the start of a text line. */
	const rule = (sel: string) => {
		const m = new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm').exec(css);
		expect(m, sel).not.toBeNull();
		return m![1];
	};

	it('styles.css: the bar spans the tree between the side margins; its buttons wrap only when they do not fit', () => {
		const bar = rule('.dynasty-result');
		expect(bar).toContain('left: var(--size-4-1);');
		expect(bar).toContain('right: var(--size-4-1);');
		expect(bar).toContain('width: auto;');
		expect(bar).not.toMatch(/460px/);
		const full = rule('.dynasty-full .dynasty-result');
		expect(full).toContain('left: max(var(--size-4-1), env(safe-area-inset-left));');
		expect(full).toContain('right: max(var(--size-4-1), env(safe-area-inset-right));');
		expect(rule('.dynasty-result-buttons')).toContain('flex-wrap: wrap;');
	});

	it('styles.css: the phone bar does not change (one row of buttons inside the safe area)', () => {
		const phoneBar = rule('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-result');
		expect(phoneBar).toContain('left: max(var(--size-4-2), env(safe-area-inset-left));');
		expect(phoneBar).toContain('right: max(var(--size-4-2), env(safe-area-inset-right));');
		expect(phoneBar).toContain('width: auto;');
		expect(rule('.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-result-buttons')).toContain('flex-wrap: nowrap;');
	});

	// The bar as Obsidian 1.13 draws it in a tree of 700 × 500 in a note at 16 px text (harness
	// `m7 first view`): the sentence, then one row of buttons, 102 px high, its bottom 161 px into the tree.
	const frame: Frame = { w: 700, h: 500, bar: { top: 59, height: 102 } };
	/** The old bar, 460 px wide: the sentence and two rows of buttons, 155 px high. */
	const old: Frame = { w: 700, h: 500, bar: { top: 59, height: 155 } };

	it('Conrad > Ulric at 16 px: below the one-row bar the whole line fits with names of 11 px or more (below the old bar it did not)', async () => {
		desktop();
		const { root } = await openFullScreen(F03);
		await finder(root, 'conrad', 'ulric', frame);
		expect(scaleOf(root) * 16).toBeGreaterThanOrEqual(11);
		expect(underBar(root, frame)).toEqual([]);
		expect(notWhole(root, frame)).toEqual([]);

		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		clearRelationCache();
		const again = await openFullScreen(F03);
		await finder(again.root, 'conrad', 'ulric', old);
		expect(scaleOf(again.root) * 16).toBeCloseTo(14);
		expect(notWhole(again.root, old).length).toBeGreaterThan(0);
	});

	it('Conrad > Ulric at 12 px below the one-row bar: no card under the bar; the whole line, or 14 px names with Aurel and Viviane whole', async () => {
		fontPx.now = 12;
		clearMeasureCache();
		desktop();
		const { root } = await openFullScreen(F03);
		await finder(root, 'conrad', 'ulric', frame);
		expect(underBar(root, frame)).toEqual([]);
		const namePx = scaleOf(root) * 12;
		const cut = notWhole(root, frame);
		const fits = namePx >= 11 - 0.01 && cut.length === 0;
		const zoomed = Math.abs(namePx - 14) < 0.01 && !cut.includes('aurel') && !cut.includes('viviane');
		expect(fits || zoomed, `${namePx} px, not whole: ${cut.join(',')}`).toBe(true);
	});
});
