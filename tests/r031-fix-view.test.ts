import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../src/layout/model';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { focusView } from '../src/obsidian/focus-mode';
import { TreeView } from '../src/obsidian/tree-view';
import { centredOpening, treeBounds, type View } from '../src/render/view-math';
import { FEl, clock, device, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { topLevelBlocks } from './acceptance/load';
import { fakeHandle, fakeHost, fullViews } from './acceptance/tree-view-fakes';
import { fixture, nextIdFor } from './helpers';

// 0.3.1 WP-8 fix round, view part (G3 F3, G2 S3, G2 note 8, G3 F4): the first view and the bars, on the fakes.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
});

const sample = (file: string) => topLevelBlocks(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), 'utf8'))[0];

interface Priv {
	panZoom: { view: View | null };
	laid: { layout: { persons: Map<string, Rect>; geometry: { fontPx: number } } };
	scene: { badges: { person: string; mark: Rect }[] } | null;
	insetTop: number;
	insetBottom: number;
}

interface Screen {
	w: number;
	h: number;
	coarse: boolean;
	/** The safe area at the top, in px. */
	safe: number;
	/** The toolbar: at the foot on a phone, at the top right on a computer. */
	toolbar: { top: number; height: number; left: number; width: number };
	/** The foot of the focus bar, when there is one (it starts at the safe area and is 52 px high). */
	bar: boolean;
}

/** The full-screen view of `source` on `screen`, with the bars at their places. */
async function open(source: string, screen: Screen) {
	Object.assign(device, { coarse: screen.coarse, width: screen.w, height: screen.h });
	const probe = { fontSize: '16px', fontFamily: 'sans-serif', paddingTop: `${screen.safe}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
	(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
	const host = fakeHost();
	const handle = fakeHandle('n.md', source);
	const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	const root = modal.containerEl as unknown as FEl;
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = screen.w;
	vp.clientHeight = screen.h;
	Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: screen.toolbar.top, offsetHeight: screen.toolbar.height, offsetLeft: screen.toolbar.left, offsetWidth: screen.toolbar.width });
	const b = vp.querySelector('.dynasty-focus-bar');
	if (screen.bar) expect(b).not.toBeNull();
	if (b) Object.assign(b, { offsetTop: screen.safe, offsetHeight: 52, offsetLeft: 0, offsetWidth: screen.w });
	resizeAll();
	flushFrames();
	const view = [...host.views].find((v) => v.isFull)! as unknown as Priv;
	return { view, root, host, handle };
}

const UPRIGHT: Screen = { w: 390, h: 844, coarse: true, safe: 47, toolbar: { top: 780, height: 64, left: 0, width: 390 }, bar: true };

describe('G3 F3: a "+" badge is whole under the focus bar', () => {
	/** The foot of the bar and the lowest edge that a badge may not cross: the first view keeps every badge on screen below it. */
	const barFoot = (s: Screen) => s.safe + 52;
	const marks = (p: Priv, s: Screen) => {
		const v = p.panZoom.view!;
		return (p.scene?.badges ?? [])
			.map((b) => ({ id: b.person, left: s.w / 2 + (b.mark.x - v.cx) * v.scale, right: s.w / 2 + (b.mark.x + b.mark.w - v.cx) * v.scale, top: s.h / 2 + (b.mark.y - v.cy) * v.scale, bottom: s.h / 2 + (b.mark.y + b.mark.h - v.cy) * v.scale }))
			.filter((m) => m.right > 0 && m.left < s.w && m.bottom > 0 && m.top < s.h);
	};

	it('a phone held upright, sample tree 7 on Thea Valmont: no badge is cut by the bar', async () => {
		const source = `options:\n  focus: thea-valmont\n\n${sample('07-four-hundred-people.md')}`;
		const { view } = await open(source, UPRIGHT);
		const shown = marks(view, UPRIGHT);
		expect(shown.length).toBeGreaterThan(1);
		for (const m of shown) {
			// A badge that reaches into the band of the bar is the fault; a badge wholly under the foot or wholly above it is not.
			expect(m.top >= barFoot(UPRIGHT) - 0.5 || m.bottom <= UPRIGHT.safe + 0.5, `badge of ${m.id} at ${m.top.toFixed(1)}..${m.bottom.toFixed(1)}`).toBe(true);
		}
	});

	it('a reveal does not leave the badge of the card under the bar: the card is brought in until its badge shows', async () => {
		const source = `options:\n  focus: thea-valmont\n\n${sample('07-four-hundred-people.md')}`;
		const { view } = await open(source, UPRIGHT);
		const lucan = view.laid.layout.persons.get('lucan-greymane')!;
		const v0 = view.panZoom.view!;
		// The card stands 1 px under the band that the view keeps free (the foot of the bar and 4 px): the card is whole, its badge reaches into the bar.
		const put: View = { scale: v0.scale, cx: v0.cx, cy: lucan.y + UPRIGHT.h / 2 / v0.scale - (view.insetTop + 1) / v0.scale };
		(view.panZoom as unknown as { setView(v: View, o?: unknown): void }).setView(put, { byUser: true });
		const mark = view.scene!.badges.find((b) => b.person === 'lucan-greymane')!.mark;
		const top = (y: number) => UPRIGHT.h / 2 + (y - view.panZoom.view!.cy) * view.panZoom.view!.scale;
		expect(top(mark.y)).toBeLessThan(barFoot(UPRIGHT));
		(view as unknown as { reveal(b: Rect): void }).reveal(lucan);
		expect(top(mark.y)).toBeGreaterThanOrEqual(barFoot(UPRIGHT) - 0.5);
	});
});

describe('G2 S3: one bar at a time over the tree', () => {
	const lines = (...l: string[]) => [...l, ''].join('\n');
	/** A chain of three and two people who are no kin to them. The focus is pinned on Cedric. */
	const PINNED = lines('options:', '  focus: c', '  generations: 1', 'people:', '  - id: a', '    name: Aldous Hale', '  - id: b', '    name: Berta Hale', '    parents: [a]', '  - id: c', '    name: Cedric Hale', '    parents: [b]', '  - id: x', '    name: Xaver Stone', '  - id: y', '    name: Yara Stone');
	const COMPUTER: Screen = { w: 1000, h: 700, coarse: false, safe: 0, toolbar: { top: 8, height: 44, left: 600, width: 392 }, bar: true };

	it('the finder says "not related" while a focus shows: the focus bar gives way, and the finder bar has its Close', async () => {
		const { view, root, handle } = await open(PINNED, COMPUTER);
		expect(root.querySelectorAll('.dynasty-focus-bar').length).toBe(1);
		(handle.state as { finder?: unknown }).finder = { first: 'x', second: 'c', index: 0, steps: false, whole: false };
		(view as unknown as { syncFocus(on: boolean): void }).syncFocus(true);
		await settle();
		resizeAll();
		flushFrames();
		const bars = root.querySelectorAll('.dynasty-result');
		// Two bars at one place cover each other (both are absolute at the same top): only the finder's stays.
		expect(bars.length).toBe(1);
		expect(root.querySelector('.dynasty-focus-bar')).toBeNull();
		expect(root.querySelector('.dynasty-result-close')).not.toBeNull();
	});

	it('the focus bar comes back when the finder closes', async () => {
		const { view, root, handle } = await open(PINNED, COMPUTER);
		(handle.state as { finder?: unknown }).finder = { first: 'x', second: 'c', index: 0, steps: false, whole: false };
		(view as unknown as { syncFocus(on: boolean): void }).syncFocus(true);
		await settle();
		resizeAll();
		flushFrames();
		(handle.state as { finder?: unknown }).finder = undefined;
		(view as unknown as { syncFocus(on: boolean): void }).syncFocus(true);
		await settle();
		resizeAll();
		flushFrames();
		expect(root.querySelectorAll('.dynasty-result').length).toBe(1);
		expect(root.querySelector('.dynasty-focus-bar')).not.toBeNull();
	});
});

describe('G2 S4 and G3: the centred opening at other note fonts', () => {
	// The couple with three children is 416 layout px wide at a note font of 16 px; the bounds hold 24 px more at each side.
	const bounds = (px: number) => treeBounds((416 * px) / 16, 200);

	for (const [px, names] of [
		[16, 12.414],
		[12, 12],
	] as const) {
		it(`a 360 px screen, note font ${px} px: the whole bounds go in, the names are ${names} px`, () => {
			const b = bounds(px);
			const v = centredOpening(b, { w: 360, h: 780 }, 14 / px, { top: 47, bottom: 64 }, px)!;
			expect(v).not.toBeNull();
			// The names are the font times the width of the screen over the width of the bounds: the check of the harness expects this, not a fixed 12.4.
			expect(v.scale * px).toBeCloseTo((px * 360) / b.w, 9);
			expect(v.scale * px).toBeCloseTo(names, 2);
		});
	}

	it('at the normal scale a part of the margin may be cut, at a smaller scale less of it (the margin is in layout px)', () => {
		const size = { w: 390, h: 800 };
		const free = { top: 0, bottom: 0 };
		// The bounds are 20 screen px wider than the screen. At the scale 0.875 the allowed cut is 28 px (2 x 16 x 0.875): the tree opens at that scale.
		const wide = (scale: number) => ({ x: 0, y: 0, w: (size.w + 20) / scale, h: 100 });
		expect(centredOpening(wide(0.875), size, 0.875, free, 16)!.scale).toBe(0.875);
		// At the scale 0.5 (names 14 px on a note font of 28 px) the allowed cut is 16 px: 20 px is too much, so the tree opens smaller and whole.
		const small = centredOpening(wide(0.5), size, 0.5, free, 28)!;
		expect(small.scale).toBeLessThan(0.5);
		expect(small.scale * wide(0.5).w).toBeLessThanOrEqual(size.w + 1e-9);
	});
});

describe('G2 note 8: the keep-place window counts from the end of the render', () => {
	const COMPUTER: Screen = { w: 1280, h: 900, coarse: false, safe: 0, toolbar: { top: 8, height: 44, left: 880, width: 392 }, bar: false };

	/** Where the card of `id` stands on the screen, in px. */
	const screenOf = (view: Priv, id: string, s: Screen) => {
		const b = view.laid.layout.persons.get(id)!;
		const v = view.panZoom.view!;
		return { x: s.w / 2 + (b.x + b.w / 2 - v.cx) * v.scale, y: s.h / 2 + (b.y + b.h / 2 - v.cy) * v.scale };
	};

	/** An edit of sample tree 6 that moves the card of the edited person (a new parent above it), the render of which takes `renderMs`. */
	async function edit(renderMs: number) {
		const src = fixture('06');
		const { view, handle } = await open(src, COMPUTER);
		const parsed = parseDynasty(src);
		if (!parsed.ok) throw new Error('sample 6 does not parse');
		// A card in the middle of the tree with a parent and a child: its place changes when a person is added above it.
		const g = deriveFamilies(parsed.tree);
		const parents = (id: string) => g.placementParents.get(id) ?? [];
		const withKin = g.people.filter((p) => parents(p.id).length > 0 && g.people.some((c) => parents(c.id).includes(p.id)));
		const who = withKin[Math.floor(withKin.length / 2)].id;
		const box = view.laid.layout.persons.get(who)!;
		const pz = view.panZoom as unknown as { setView(v: View, o?: unknown): void };
		pz.setView({ scale: 2, cx: box.x + box.w / 2 + 90, cy: box.y + box.h / 2 - 40 }, { byUser: true });
		flushFrames();
		const was = screenOf(view, who, COMPUTER);
		const newId = nextIdFor(src);
		const out = applyOp(src, { kind: 'batch', ops: [{ kind: 'add-person', id: newId, fields: { name: 'New Parent' } }, { kind: 'add-parent', child: who, parent: newId, type: 'rumoured' }] });
		if (!out.ok) throw new Error(out.code);
		// What the edit sheet leaves when it saves: the person of the sheet and the highlight, both for 3 s.
		const state = handle.state as { highlight: { id: string; until: number } | null };
		(TreeView as unknown as { sheetPerson: WeakMap<object, { id: string; until: number }> }).sheetPerson.set(state, { id: who, until: clock.now + 3000 });
		state.highlight = { id: who, until: clock.now + 3000 };
		const proto = TreeView.prototype as unknown as { layOut(...a: unknown[]): unknown };
		const original = proto.layOut;
		vi.spyOn(proto, 'layOut').mockImplementation(function (this: unknown, ...a: unknown[]) {
			clock.now += renderMs;
			return original.apply(this, a);
		});
		handle.change(out.body);
		await settle();
		resizeAll();
		flushFrames();
		return { was, now: screenOf(view, who, COMPUTER) };
	}

	it('a render of 6 s (a large tree on a phone): the edited card still keeps its place', async () => {
		const { was, now } = await edit(6000);
		expect(Math.abs(now.x - was.x)).toBeLessThan(1e-6);
		expect(Math.abs(now.y - was.y)).toBeLessThan(1e-6);
	});

	it('a quick render keeps the place as before', async () => {
		const { was, now } = await edit(10);
		expect(Math.abs(now.x - was.x)).toBeLessThan(1e-6);
		expect(Math.abs(now.y - was.y)).toBeLessThan(1e-6);
	});
});

describe('G3 F4: a phone held sideways opens on the start person with a child in sight', () => {
	/** An iPhone on its side: the safe area is 0 at the top, the bar of focus mode is 52 px high, the bottom bar 64 px. */
	const SIDE: Screen = { w: 844, h: 390, coarse: true, safe: 0, toolbar: { top: 326, height: 64, left: 0, width: 844 }, bar: true };

	it('sample tree 7, the automatic focus on the start person: a child card is whole in the free area, next to the whole card of the start person', async () => {
		const { view } = await open(sample('07-four-hundred-people.md'), SIDE);
		const p = view as unknown as Priv & { focusId: string | null; g: { placementParents: Map<string, string[]> } };
		expect(p.focusId).toBe('edmund-valmont');
		const v = p.panZoom.view!;
		const screen = (b: Rect) => ({ left: SIDE.w / 2 + (b.x - v.cx) * v.scale, right: SIDE.w / 2 + (b.x + b.w - v.cx) * v.scale, top: SIDE.h / 2 + (b.y - v.cy) * v.scale, bottom: SIDE.h / 2 + (b.y + b.h - v.cy) * v.scale });
		const inFree = (b: Rect) => {
			const s = screen(b);
			return s.left >= -1e-6 && s.right <= SIDE.w + 1e-6 && s.top >= p.insetTop - 0.5 && s.bottom <= SIDE.h - p.insetBottom + 0.5;
		};
		expect(inFree(p.laid.layout.persons.get('edmund-valmont')!)).toBe(true);
		const kids = [...p.g.placementParents].filter(([, ps]) => ps.includes('edmund-valmont')).map(([id]) => id);
		expect(kids.length).toBeGreaterThan(0);
		expect(kids.filter((id) => inFree(p.laid.layout.persons.get(id)!))).not.toEqual([]);
		// The names stay at the floor or above.
		expect(v.scale * p.laid.layout.geometry.fontPx).toBeGreaterThanOrEqual(11 - 1e-9);
	});
});

describe('G3 F4: focusView goes to smaller names, not under 11 px, to show a child', () => {
	const bounds = { x: 0, y: 0, w: 6000, h: 1200 };
	const area = { w: 844, h: 266 };
	const focus: Rect = { x: 3000, y: 100, w: 180, h: 61 };
	const whole = (v: View, b: Rect) => {
		const l = area.w / 2 + (b.x - v.cx) * v.scale;
		const t = area.h / 2 + (b.y - v.cy) * v.scale;
		return l >= -1e-6 && l + b.w * v.scale <= area.w + 1e-6 && t >= -1e-6 && t + b.h * v.scale <= area.h + 1e-6;
	};

	it('a child 900 px to the left does not fit at 14 px names: the names get smaller and the child shows whole beside the focus card', () => {
		const child: Rect = { x: 2100, y: 240, w: 180, h: 61 };
		const v = focusView(bounds, area, 16, focus, 0, [child], true);
		expect(v.scale * 16).toBeLessThan(14);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11 - 1e-9);
		expect(whole(v, focus)).toBe(true);
		expect(whole(v, child)).toBe(true);
	});

	it('a child that fits at 14 px keeps the 14 px names', () => {
		const v = focusView(bounds, area, 16, focus, 0, [{ x: 3300, y: 240, w: 180, h: 61 }], true);
		expect(v.scale * 16).toBeCloseTo(14, 9);
	});

	it('a child that does not fit even at 11 px names leaves the view as it was: 14 px names', () => {
		const v = focusView(bounds, area, 16, focus, 0, [{ x: 1500, y: 240, w: 180, h: 61 }], true);
		expect(v.scale * 16).toBeCloseTo(14, 9);
	});

	it('a child below the area at any such size does not shrink the names for nothing', () => {
		const v = focusView(bounds, area, 16, focus, 0, [{ x: 2100, y: 900, w: 180, h: 61 }], true);
		expect(v.scale * 16).toBeCloseTo(14, 9);
	});

	it('the couple is whole beside the child when that fits at 11 px names or more', () => {
		const partner: Rect = { x: 3200, y: 100, w: 180, h: 61 };
		// The child is 800 px left of the focus card (1180 px with the couple): the couple and the child span 1080 layout px; the screen shows 828 / 0.7 = 1183 at 11.2 px names.
		const child: Rect = { x: 2200, y: 240, w: 180, h: 61 };
		const v = focusView(bounds, area, 16, focus, 0, [child], true, [], [partner]);
		expect(v.scale * 16).toBeLessThan(14);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11 - 1e-9);
		expect(whole(v, focus)).toBe(true);
		expect(whole(v, partner)).toBe(true);
		expect(whole(v, child)).toBe(true);
	});

	it('the couple cannot fit beside the child: the child shows beside the focus card as before', () => {
		const partner: Rect = { x: 3200, y: 100, w: 180, h: 61 };
		const child: Rect = { x: 2150, y: 240, w: 180, h: 61 };
		const v = focusView(bounds, area, 16, focus, 0, [child], true, [], [partner]);
		expect(v.scale * 16).toBeGreaterThanOrEqual(11 - 1e-9);
		expect(whole(v, focus)).toBe(true);
		expect(whole(v, child)).toBe(true);
		expect(whole(v, partner)).toBe(false);
	});
});
