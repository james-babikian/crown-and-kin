import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../../src/layout/model';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import type { TreeView } from '../../src/obsidian/tree-view';
import type { View } from '../../src/render/view-math';
import { FEl, clock, device, dispatch, flushFrames, installDom, pointer, resetDom, resizeAll, runFrame, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { topLevelBlocks } from './load';
import { fakeHandle, fakeHost, fullViews, phone } from './tree-view-fakes';

/*
 * 0.3 WP-A on the real TreeView, the PanZoom and the full-screen view on the fakes (D222, N02, N03):
 *   A.4 a tree that fits between the bars opens centred in the free area (phone 390 x 844 with a safe area of 47 px and a bottom bar; computer 900 x 700 with a toolbar);
 *   A.5 a drag stops the tree at the edge of the free area;
 *   D235 after an edit the view changes at once (no slide) and the pulse starts in the frame that writes the new view.
 * The numbers of "keeps its 0.2.8 first view" were recorded by running the same cases on the tag v0.2.8.
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	frameNo = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	vi.restoreAllMocks();
});

const read = (name: string) => topLevelBlocks(readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf8'))[0];
const F06 = read('06-sixty-people.md');
const F07 = read('07-four-hundred-people.md');

const lines = (...l: string[]) => [...l, ''].join('\n');
const ONE = lines('people:', '  - id: oswin', '    name: Oswin Tarrant', '    born: 1204');
const THREE = lines('people:', '  - id: a', '    name: Aldous Hale', '  - id: b', '    name: Berta Hale', '  - id: c', '    name: Cedric Hale');
/** A small tree that is pinned to a focus: it keeps the focus view (D18) and is not centred. */
const PINNED = lines('options:', '  focus: a', 'people:', '  - id: a', '    name: Aldous Hale', '  - id: b', '    name: Berta Hale', '    parents: [a]');

let frameNo = 0;
/** One frame of the fake window; `frameNo` says which one, so that a test can say "the frame after". */
function step(n = 1): void {
	for (let i = 0; i < n; i++) {
		frameNo++;
		runFrame();
	}
}

interface Priv {
	panZoom: { view: View | null; size: { w: number; h: number }; setView(v: View, o?: object): void };
	laid: { layout: { persons: Map<string, Rect> } };
	bounds: Rect;
	insetTop: number;
	insetBottom: number;
	scene: { cards: Map<string, FEl> };
	showEdited(st: object): void;
	render(fonts: unknown): void;
	fonts: unknown;
	focusId: string | null;
}
const priv = (v: unknown) => v as Priv;

interface Screen {
	w: number;
	h: number;
	/** The toolbar box in viewport px, as a browser reports it. */
	bar: { top: number; height: number; left: number; width: number };
	/** The top safe area in px (the safe probe's padding). */
	safeTop: number;
}

const PHONE_SCREEN: Screen = { w: 390, h: 844, bar: { top: 780, height: 64, left: 0, width: 390 }, safeTop: 47 };
const COMPUTER_SCREEN: Screen = { w: 900, h: 700, bar: { top: 8, height: 44, left: 580, width: 312 }, safeTop: 0 };

/** The full-screen view of `source`, laid out in a viewport of `screen` with its toolbar in place before the first view is chosen. */
async function openFull(source: string, screen: Screen, o: { reduce?: boolean; views?: Record<string, { view: View; viewFor: string }> } = {}) {
	if (screen === PHONE_SCREEN) phone();
	else Object.assign(device, { coarse: false, width: screen.w, height: screen.h });
	const probe = { fontSize: '16px', fontFamily: 'sans-serif', paddingTop: `${screen.safeTop}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
	(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
	const host = fakeHost(o.reduce ? { ...DEFAULT_SETTINGS, reduceMotion: 'on' } : undefined);
	const handle = fakeHandle('n.md', source);
	if (o.views) Object.assign(handle.state.views, o.views);
	const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	const root = modal.containerEl as unknown as FEl;
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = screen.w;
	vp.clientHeight = screen.h;
	Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: screen.bar.top, offsetHeight: screen.bar.height, offsetLeft: screen.bar.left, offsetWidth: screen.bar.width });
	resizeAll();
	flushFrames();
	const view = [...host.views].find((v) => v.isFull)!;
	return { host, handle, modal, root, vp, view: view as TreeView, p: priv(view) };
}

/** Where the middle of the tree's bounds is on the screen, and the middle of the free area. */
function centres(p: Priv, screen: Screen) {
	const v = p.panZoom.view!;
	const b = p.bounds;
	return {
		x: screen.w / 2 + (b.x + b.w / 2 - v.cx) * v.scale,
		y: screen.h / 2 + (b.y + b.h / 2 - v.cy) * v.scale,
		freeX: screen.w / 2,
		freeY: (p.insetTop + (screen.h - p.insetBottom)) / 2,
	};
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const rounded = (v: View) => ({ scale: round(v.scale), cx: round(v.cx), cy: round(v.cy) });

/** First views recorded on the tag v0.2.8, by running `openFull` of this file on it. 0.3 (D231): the added step moves the cards of trees 06 and 07, so the first views of those two start elsewhere (re-recorded); the pinned view is as on v0.2.8. */
const BASE = {
	f06Phone: { scale: 0.875, cx: 213.714, cy: 404.571 },
	f06Computer: { scale: 0.875, cx: 490.286, cy: 312 },
	// D257 (0.3.2): the focus family of sample tree 7 starts with the far families folded, and the names go to 12.45 px so that the "+ N" sign is whole. 0.2.8 value: { scale: 0.875, cx: 213.714, cy: 787.071 }.
	f07Phone: { scale: 0.778, cx: 240.293, cy: 776.622 },
	pinnedPhone: { scale: 0.875, cx: 213.714, cy: 404.571 },
};

describe('A.4 (D222): a small tree opens centred in the free area of the full-screen view', () => {
	for (const [label, source] of [['one person', ONE], ['three people', THREE]] as const) {
		it(`phone 390 x 844, ${label}: the middle of the tree is at the middle between the top safe area and the bottom bar`, async () => {
			const { p } = await openFull(source, PHONE_SCREEN);
			expect(p.insetTop).toBe(47);
			expect(p.insetBottom).toBe(68);
			const c = centres(p, PHONE_SCREEN);
			expect(Math.abs(c.x - c.freeX)).toBeLessThan(0.5);
			expect(Math.abs(c.y - c.freeY)).toBeLessThan(0.5);
			// The 14 px names of D24 stay.
			expect(p.panZoom.view!.scale * 16).toBeCloseTo(14, 6);
		});

		it(`computer 900 x 700, ${label}: the same, below the toolbar`, async () => {
			const { p } = await openFull(source, COMPUTER_SCREEN);
			expect(p.insetTop).toBe(56);
			const c = centres(p, COMPUTER_SCREEN);
			expect(Math.abs(c.x - c.freeX)).toBeLessThan(0.5);
			expect(Math.abs(c.y - c.freeY)).toBeLessThan(0.5);
		});
	}

	it('a saved view still wins over the centred view', async () => {
		const saved: View = { scale: 1.5, cx: 10, cy: 20 };
		const { p } = await openFull(ONE, PHONE_SCREEN, { views: { sideways: { view: saved, viewFor: 'sideways|' } } });
		expect(p.panZoom.view).toEqual(saved);
	});

	it('a tree that does not fit keeps its 0.2.8 first view (sample tree 6 on a phone and on a computer)', async () => {
		const a = await openFull(F06, PHONE_SCREEN);
		expect(rounded(a.p.panZoom.view!)).toEqual(BASE.f06Phone);
		resetDom();
		const b = await openFull(F06, COMPUTER_SCREEN);
		expect(rounded(b.p.panZoom.view!)).toEqual(BASE.f06Computer);
	});

	it('a focus family keeps its 0.2.8 first view (sample tree 7 opens in focus mode on a phone; a pinned focus in a small tree)', async () => {
		const a = await openFull(F07, PHONE_SCREEN);
		expect(a.p.focusId).not.toBeNull();
		expect(rounded(a.p.panZoom.view!)).toEqual(BASE.f07Phone);
		resetDom();
		const b = await openFull(PINNED, PHONE_SCREEN);
		expect(b.p.focusId).toBe('a');
		expect(rounded(b.p.panZoom.view!)).toEqual(BASE.pinnedPhone);
	});
});

describe('A.5 (D222): a drag stops a small tree at the edge of the free area', () => {
	/** The bounds on screen: left, top, right, bottom in px. */
	const box = (p: Priv) => {
		const v = p.panZoom.view!;
		const b = p.bounds;
		const left = PHONE_SCREEN.w / 2 + (b.x - v.cx) * v.scale;
		const top = PHONE_SCREEN.h / 2 + (b.y - v.cy) * v.scale;
		return { left, top, right: left + b.w * v.scale, bottom: top + b.h * v.scale };
	};

	function drag(vp: FEl, dx: number, dy: number): void {
		dispatch(vp, 'pointerdown', pointer('touch', 9, 200, 400));
		for (let i = 1; i <= 10; i++) {
			dispatch(vp, 'pointermove', pointer('touch', 9, 200 + (dx * i) / 10, 400 + (dy * i) / 10));
			step();
		}
		dispatch(vp, 'pointerup', pointer('touch', 9, 200 + dx, 400 + dy));
		step(3);
	}

	it('phone, one person: the tree reaches each edge of the free area and goes no further (within 1 px)', async () => {
		const { vp, p } = await openFull(ONE, PHONE_SCREEN);
		const free = { top: p.insetTop, bottom: PHONE_SCREEN.h - p.insetBottom };
		drag(vp, 900, 1500);
		let b = box(p);
		expect(Math.abs(b.right - PHONE_SCREEN.w)).toBeLessThanOrEqual(1);
		expect(Math.abs(b.bottom - free.bottom)).toBeLessThanOrEqual(1);
		drag(vp, -1900, -3000);
		b = box(p);
		expect(Math.abs(b.left)).toBeLessThanOrEqual(1);
		expect(Math.abs(b.top - free.top)).toBeLessThanOrEqual(1);
		for (const [dx, dy] of [[-500, 0], [500, 0], [0, -900], [0, 900]] as const) {
			drag(vp, dx, dy);
			b = box(p);
			expect(b.left).toBeGreaterThanOrEqual(-1);
			expect(b.right).toBeLessThanOrEqual(PHONE_SCREEN.w + 1);
			expect(b.top).toBeGreaterThanOrEqual(free.top - 1);
			expect(b.bottom).toBeLessThanOrEqual(free.bottom + 1);
		}
	});

	it('the edge is the margin of 24 layout px short of the card: the card never touches a bar', async () => {
		const { vp, p } = await openFull(ONE, PHONE_SCREEN);
		drag(vp, -1900, -3000);
		const card = p.laid.layout.persons.get('oswin')!;
		const v = p.panZoom.view!;
		const top = PHONE_SCREEN.h / 2 + (card.y - v.cy) * v.scale;
		const left = PHONE_SCREEN.w / 2 + (card.x - v.cx) * v.scale;
		expect(top - p.insetTop).toBeCloseTo(24 * v.scale, 0);
		expect(left).toBeCloseTo(24 * v.scale, 0);
	});

	it('a tree larger than the free area keeps the 0.2.8 limits (sample tree 6)', async () => {
		const { vp, p } = await openFull(F06, PHONE_SCREEN);
		drag(vp, 0, 100000);
		const v = p.panZoom.view!;
		expect(v.cy).toBeCloseTo(p.bounds.y, 6);
	});
});

describe('D235: after an edit the view changes at once and the pulse starts after the card is drawn', () => {
	/** A person whose card lies wholly outside the first view but less than one view away, and one wholly inside. */
	function pick(p: Priv, size: { w: number; h: number }) {
		const v = p.panZoom.view!;
		const hw = size.w / 2 / v.scale;
		const hh = size.h / 2 / v.scale;
		let outside: string | null = null;
		let outside2: string | null = null;
		let inside: string | null = null;
		for (const [id, b] of p.laid.layout.persons) {
			const whole = b.x >= v.cx - hw && b.x + b.w <= v.cx + hw && b.y >= v.cy - hh && b.y + b.h <= v.cy + hh;
			const near = Math.abs(b.x + b.w / 2 - v.cx) < 2 * hw && Math.abs(b.y + b.h / 2 - v.cy) < 2 * hh;
			if (whole) inside ??= id;
			else if (near && (b.x > v.cx + hw || b.x + b.w < v.cx - hw)) {
				if (!outside) outside = id;
				else outside2 ??= id;
			}
		}
		if (!outside || !outside2 || !inside) throw new Error(`no cards to pick: ${outside} ${outside2} ${inside}`);
		return { outside, outside2, inside };
	}

	const mark = (id: string) => ({ highlight: { id, until: clock.now + 2000 } });
	const lit = (p: Priv, id: string) => p.scene.cards.get(id)!.hasClass('dynasty-highlight');

	/** The order of the writes of the scene transform and of the start of the ring on `card`, with the frame of each. */
	function watch(root: FEl, card: FEl): string[] {
		const events: string[] = [];
		const scene = root.querySelector('.dynasty-scene')!;
		const set = scene.setAttribute.bind(scene);
		scene.setAttribute = (name: string, value: string) => {
			if (name === 'transform') events.push(`write@${frameNo}`);
			return set(name, value);
		};
		const add = card.addClass.bind(card);
		card.addClass = (...c: string[]) => {
			if (c.includes('dynasty-highlight')) events.push(`ring@${frameNo}`);
			return add(...c);
		};
		return events;
	}

	/** The card on the screen, in px, for the view of the pan and zoom. */
	function onScreen(p: Priv, id: string, screen: Screen) {
		const v = p.panZoom.view!;
		const b = p.laid.layout.persons.get(id)!;
		const left = screen.w / 2 + (b.x - v.cx) * v.scale;
		const top = screen.h / 2 + (b.y - v.cy) * v.scale;
		return { left, top, right: left + b.w * v.scale, bottom: top + b.h * v.scale };
	}

	for (const [label, screen] of [['computer', COMPUTER_SCREEN], ['phone', PHONE_SCREEN]] as const) {
		it(`${label}: a card cut by the screen is at its place in the same call; the one scene write is in the next frame, and the ring starts after it`, async () => {
			const { root, p } = await openFull(F06, screen);
			const { outside } = pick(p, { w: screen.w, h: screen.h - p.insetTop });
			const events = watch(root, p.scene.cards.get(outside)!);
			step(3);
			events.length = 0;
			const before = p.panZoom.view!;
			p.showEdited(mark(outside));
			const after = p.panZoom.view!;
			// No slide: the view is the target before any frame runs, and nothing is lit yet.
			expect(after).not.toEqual(before);
			expect(after.scale).toBe(before.scale);
			expect(lit(p, outside)).toBe(false);
			frameNo = 0;
			step(60);
			expect(events).toEqual(['write@1', 'ring@1']);
			// The whole card is in the free area between the bars.
			const b = onScreen(p, outside, screen);
			expect(b.left).toBeGreaterThanOrEqual(0);
			expect(b.right).toBeLessThanOrEqual(screen.w);
			expect(b.top).toBeGreaterThanOrEqual(p.insetTop);
			expect(b.bottom).toBeLessThanOrEqual(screen.h - p.insetBottom);
		});
	}

	it('a card that is whole on the screen: the view does not change, and the ring starts in the next frame', async () => {
		const { p } = await openFull(F06, COMPUTER_SCREEN);
		const { inside } = pick(p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - p.insetTop });
		const before = p.panZoom.view;
		p.showEdited(mark(inside));
		expect(p.panZoom.view).toEqual(before);
		expect(lit(p, inside)).toBe(false);
		step(1);
		expect(lit(p, inside)).toBe(true);
	});

	it('with Reduce movement On the result is the same: the view at once, the ring (a still outline) in the next frame', async () => {
		const { root, p } = await openFull(F06, COMPUTER_SCREEN, { reduce: true });
		const { outside } = pick(p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - p.insetTop });
		const before = p.panZoom.view;
		p.showEdited(mark(outside));
		expect(p.panZoom.view).not.toEqual(before);
		step(1);
		expect(lit(p, outside)).toBe(true);
		expect(root.querySelector('.dynasty-root')?.hasClass('dynasty-reduce-motion') ?? root.hasClass('dynasty-reduce-motion')).toBe(true);
	});

	it('a second edit before the frame replaces the first: only the second card pulses', async () => {
		const { p } = await openFull(F06, COMPUTER_SCREEN);
		const { outside, outside2 } = pick(p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - p.insetTop });
		p.showEdited(mark(outside));
		p.showEdited(mark(outside2));
		step(60);
		expect(lit(p, outside)).toBe(false);
		expect(lit(p, outside2)).toBe(true);
	});

	it('nothing pulses after a new render of the tree, or when the view closes before the frame', async () => {
		const a = await openFull(F06, COMPUTER_SCREEN);
		const { outside } = pick(a.p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - a.p.insetTop });
		const old = a.p.scene.cards.get(outside)!;
		a.p.showEdited(mark(outside));
		a.p.render(a.p.fonts);
		resizeAll();
		step(60);
		expect(old.hasClass('dynasty-highlight')).toBe(false);
		resetDom();
		const b = await openFull(F06, COMPUTER_SCREEN);
		const pick2 = pick(b.p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - b.p.insetTop });
		const card = b.p.scene.cards.get(pick2.outside)!;
		b.p.showEdited(mark(pick2.outside));
		(b.view as unknown as { unload(): void }).unload();
		step(60);
		expect(card.hasClass('dynasty-highlight')).toBe(false);
	});
});
