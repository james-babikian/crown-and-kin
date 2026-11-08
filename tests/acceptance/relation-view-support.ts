import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache } from '../../src/view/relation-cache';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { FEl, clock, device, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { sample12 } from './relations-support';
import { desktop, fakeHost, openFullScreen, phone, tabletDevice } from './tree-view-fakes';

/*
 * Shared by the tests of the first view of the relation finder (0.5.3, D334 Q1 B): the fake DOM set-up, the finder run on sample
 * tree 12 with the owner's settings, and the place of a card in the free area of a device frame.
 */

const fontPx = { now: 16 };

/** A clean state for the next run (also called between the runs of a sweep in one test). */
export function resetRelationView(): void {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	clearRelationCache();
	fontPx.now = 16;
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
}

/** Installs the fake DOM before the tests of the calling file, and a clean state around each test. */
export function setupRelationViewTests(): void {
	beforeAll(() => {
		installDom();
		const g = globalThis as Record<string, unknown>;
		g.window ??= fakeWin;
		const base = g.getComputedStyle as (e: unknown) => Record<string, unknown>;
		g.getComputedStyle = (e: unknown) => ({ ...base(e), fontSize: `${fontPx.now}px` });
	});
	beforeEach(resetRelationView);
	afterEach(() => {
		vi.restoreAllMocks();
	});
}

export const F12 = sample12().source;
/** The owner's plugin settings (read from the owner's data.json): the defaults, with one break word. */
export const OWNER = { ...DEFAULT_SETTINGS, breakWords: 'Es-clara-munda' };

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

export interface Frame {
	w: number;
	h: number;
	bar: { top: number; height: number };
	bottomBar?: number;
}

/** The owner's iPhone, upright, from the screenshot (1206 x 2622 px at 3x): the result bar and the bottom toolbar as drawn there. */
export const IPHONE: Frame = { w: 402, h: 874, bar: { top: 62, height: 52 }, bottomBar: 85 };
/** A smaller iPhone (390 x 844), the same bars. */
export const IPHONE_SMALL: Frame = { w: 390, h: 844, bar: { top: 62, height: 52 }, bottomBar: 85 };
/** An iPad held upright (820 x 1180): the toolbar at the top, then the result bar. */
export const IPAD: Frame = { w: 820, h: 1180, bar: { top: 60, height: 60 } };
/** A computer full-screen view. */
export const COMPUTER: Frame = { w: 1280, h: 800, bar: { top: 59, height: 60 } };

export type Kind = 'iphone' | 'iphone-small' | 'ipad' | 'computer';
export const FRAMES: Record<Kind, Frame> = { iphone: IPHONE, 'iphone-small': IPHONE_SMALL, ipad: IPAD, computer: COMPUTER };

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

type Box = { top: number; bottom: number; left: number; right: number };

export function sceneTransform(root: FEl): string {
	return root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '';
}

function cardsOnScreen(root: FEl): Map<string, Box> {
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(sceneTransform(root));
	if (!m) throw new Error('no transform');
	const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const out = new Map<string, Box>();
	for (const card of root.querySelectorAll('.dynasty-card')) {
		const bg = card.querySelector('.dynasty-card-bg')!;
		const left = tx + Number(bg.getAttribute('x')) * s;
		const top = ty + Number(bg.getAttribute('y')) * s;
		out.set(card.getAttribute('data-person')!, { top, left, bottom: top + Number(bg.getAttribute('height')) * s, right: left + Number(bg.getAttribute('width')) * s });
	}
	return out;
}

/** How the card of `id` stands in the free area of `frame`: whole, cut, or off (no part of it in the area). */
function placeOf(root: FEl, id: string, frame: Frame): 'whole' | 'cut' | 'off' | 'absent' {
	const c = cardsOnScreen(root).get(id);
	if (!c) return 'absent';
	const top = frame.bar.top + frame.bar.height;
	const bottom = frame.h - (frame.bottomBar ?? 0);
	const seen = c.right > 0 && c.left < frame.w && c.bottom > top && c.top < bottom;
	if (!seen) return 'off';
	const whole = c.left >= -0.5 && c.right <= frame.w + 0.5 && c.top >= top - 0.5 && c.bottom <= bottom + 0.5;
	return whole ? 'whole' : 'cut';
}

export const orientation = (root: FEl) => root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-orientation');
export const scaleOf = (root: FEl) => Number(/scale\(([-\d.e]+)\)/.exec(sceneTransform(root))![1]);

/** Opens sample tree 12 full screen on `kind` with the owner's settings, runs the finder for `a` > `b`, and gives the place of each named person. */
export async function relationView(kind: Kind, a: string, b: string) {
	const frame = FRAMES[kind];
	if (kind === 'iphone' || kind === 'iphone-small') phone();
	else if (kind === 'ipad') tabletDevice();
	else desktop();
	device.width = frame.w;
	device.height = frame.h;
	const { root } = await openFullScreen(F12, { host: fakeHost(OWNER) });
	await finder(root, a, b, frame);
	const where = { [a]: placeOf(root, a, frame), [b]: placeOf(root, b, frame) };
	const msg = `names ${(scaleOf(root) * 16).toFixed(1)} px; ${JSON.stringify(where)}`;
	return { root, where, msg, hasLine: root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder') !== 'none', lod: [...root.querySelector('.dynasty-svg')!.classes].find((c) => c.startsWith('dynasty-lod-')) ?? null };
}
