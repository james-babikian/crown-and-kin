import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// 0.3.1 second fix round, view part (V1-V4): the side safe areas (the notch), a badge above the focus bar, the children of a narrow upright phone.

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../src/layout/model';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { keepTopCardWhole, sidewaysView } from '../src/view/focus-mode';
import { betweenSides, bringInView, centredOpening, treeBounds, type View } from '../src/render/view-math';
import { FEl, clock, device, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { topLevelBlocks } from './acceptance/load';
import { fakeHandle, fakeHost, fullViews } from './acceptance/tree-view-fakes';

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
	panZoom: { view: View | null; setView(v: View, o?: unknown): void };
	laid: { layout: { persons: Map<string, Rect>; geometry: { fontPx: number }; orientation: string } };
	scene: { badges: { person: string; mark: Rect }[] } | null;
	g: { placementParents: Map<string, string[]> };
	focusId: string | null;
	insetTop: number;
	insetBottom: number;
	reveal(b: Rect, badge?: boolean): void;
	bringIn(b: Rect): void;
}

/** A screen: the safe areas at the top and at the sides, the toolbar, and the note font. */
interface Screen {
	w: number;
	h: number;
	coarse: boolean;
	/** The safe area at the top, in px; the bar of focus mode starts there and is 52 px high. */
	safe: number;
	left: number;
	right: number;
	toolbar: { top: number; height: number; left: number; width: number };
	font?: number;
}

/** The full-screen view of `source` on `screen`, with the bars at their places and the safe areas in the probe. */
async function open(source: string, screen: Screen) {
	Object.assign(device, { coarse: screen.coarse, width: screen.w, height: screen.h });
	const probe = { fontSize: `${screen.font ?? 16}px`, fontFamily: 'sans-serif', paddingTop: `${screen.safe}px`, paddingLeft: `${screen.left}px`, paddingRight: `${screen.right}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
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
	if (b) Object.assign(b, { offsetTop: screen.safe, offsetHeight: 52, offsetLeft: 0, offsetWidth: screen.w });
	resizeAll();
	flushFrames();
	return [...host.views].find((v) => v.isFull)! as unknown as Priv;
}

/** An iPhone on its side: no safe area at the top, 47 px at each side (the notch), the bottom bar 64 px. */
const SIDE: Screen = { w: 844, h: 390, coarse: true, safe: 0, left: 47, right: 47, toolbar: { top: 326, height: 64, left: 0, width: 844 } };

/** Where a layout box shows on `s` at the current view. */
function onScreen(p: Priv, s: Screen, b: Rect) {
	const v = p.panZoom.view!;
	return { left: s.w / 2 + (b.x - v.cx) * v.scale, right: s.w / 2 + (b.x + b.w - v.cx) * v.scale, top: s.h / 2 + (b.y - v.cy) * v.scale, bottom: s.h / 2 + (b.y + b.h - v.cy) * v.scale };
}

/** Whole on the screen, between the bars. */
function wholeOnScreen(p: Priv, s: Screen, b: Rect): boolean {
	const o = onScreen(p, s, b);
	return o.left >= -0.5 && o.right <= s.w + 0.5 && o.top >= p.insetTop - 0.5 && o.bottom <= s.h - p.insetBottom + 0.5;
}

/** Whole between the side safe areas. */
function clearOfSides(p: Priv, s: Screen, b: Rect): boolean {
	const o = onScreen(p, s, b);
	return o.left >= s.left - 0.5 && o.right <= s.w - s.right + 0.5;
}

const kidsOf = (p: Priv, id: string) => [...p.g.placementParents].filter(([, ps]) => ps.includes(id)).map(([k]) => k);

/** A couple and five children in one row: about 850 px wide at 14 px names, a little wider than the room between the notches of a phone on its side. */
const ROW_TEXT = [
	'people:',
	'  - id: a',
	'    name: Aldric Valmont',
	'  - id: b',
	'    name: Lianne Redfern',
	...[1, 2, 3, 4, 5].flatMap((i) => [`  - id: k${i}`, `    name: Child Number${i} Valmont`, '    parents: [a, b]']),
	'unions:',
	'  - partners: [a, b]',
	'',
].join('\n');

describe('V1: the views that the plugin chooses keep a card out of the side safe areas (the notch)', () => {
	it('a small tree on a phone on its side opens centred between the notches, with no card in a side safe area', async () => {
		const view = await open(ROW_TEXT, SIDE);
		const cards = [...view.laid.layout.persons.values()];
		expect(cards.length).toBe(7);
		for (const c of cards) {
			expect(wholeOnScreen(view, SIDE, c)).toBe(true);
			expect(clearOfSides(view, SIDE, c), JSON.stringify(onScreen(view, SIDE, c))).toBe(true);
		}
		expect(view.panZoom.view!.scale * view.laid.layout.geometry.fontPx).toBeGreaterThanOrEqual(11 - 1e-9);
	});

	it('sample tree 7 on a phone on its side: the start person is whole between the notches, and no child that the view shows whole lies in a side safe area', async () => {
		const view = await open(sample('07-four-hundred-people.md'), SIDE);
		expect(view.focusId).toBe('edmund-valmont');
		const persons = view.laid.layout.persons;
		const me = persons.get('edmund-valmont')!;
		expect(wholeOnScreen(view, SIDE, me) && clearOfSides(view, SIDE, me)).toBe(true);
		for (const k of kidsOf(view, 'edmund-valmont')) {
			const b = persons.get(k)!;
			if (wholeOnScreen(view, SIDE, b)) expect(clearOfSides(view, SIDE, b), `${k} ${JSON.stringify(onScreen(view, SIDE, b))}`).toBe(true);
		}
	});

	it('a reveal brings a card out of the left safe area, not only onto the screen', async () => {
		const view = await open(sample('07-four-hundred-people.md'), SIDE);
		const me = view.laid.layout.persons.get('edmund-valmont')!;
		const v0 = view.panZoom.view!;
		// The card whole on the screen, 10 px from the left edge: under the notch.
		view.panZoom.setView({ scale: v0.scale, cx: me.x - (10 - SIDE.w / 2) / v0.scale, cy: v0.cy }, { byUser: true });
		expect(onScreen(view, SIDE, me).left).toBeCloseTo(10, 6);
		view.reveal(me, false);
		expect(clearOfSides(view, SIDE, me), JSON.stringify(onScreen(view, SIDE, me))).toBe(true);
	});

	it('bringIn (D245) moves a new card only as far as the edge of the right safe area', async () => {
		const view = await open(sample('07-four-hundred-people.md'), SIDE);
		const me = view.laid.layout.persons.get('edmund-valmont')!;
		const v0 = view.panZoom.view!;
		const w = me.w * v0.scale;
		// The card whole on the screen, its right edge 10 px from the right edge: under the notch.
		view.panZoom.setView({ scale: v0.scale, cx: me.x - (SIDE.w - 10 - w - SIDE.w / 2) / v0.scale, cy: v0.cy }, { byUser: true });
		expect(onScreen(view, SIDE, me).right).toBeCloseTo(SIDE.w - 10, 6);
		view.bringIn(me);
		expect(onScreen(view, SIDE, me).right).toBeCloseTo(SIDE.w - SIDE.right, 6);
	});
});

describe('V1: the side insets in the view sums', () => {
	it('centredOpening centres a tree between the side insets, and makes it smaller when it fits the screen but not the room between them', () => {
		const b = treeBounds(800, 200);
		const size = { w: 844, h: 390 };
		expect(centredOpening(b, size, 1, { top: 0, bottom: 68 }, 16)!.scale).toBe(1);
		const sides = centredOpening(b, size, 1, { top: 0, bottom: 68, left: 47, right: 47 }, 16)!;
		expect(sides.scale).toBeCloseTo(750 / b.w, 9);
		expect(size.w / 2 + (b.x - sides.cx) * sides.scale).toBeCloseTo(47, 6);
		// One side only: the middle of the tree goes to the middle of the room.
		const small = treeBounds(200, 100);
		const one = centredOpening(small, size, 1, { top: 0, bottom: 0, left: 60, right: 0 }, 16)!;
		expect(size.w / 2 + (small.x + small.w / 2 - one.cx) * one.scale).toBeCloseTo(60 + (844 - 60) / 2, 6);
	});

	it('bringInView keeps the card out of the side insets', () => {
		const view: View = { scale: 1, cx: 0, cy: 0 };
		const area = { size: { w: 800, h: 400 }, free: { top: 0, bottom: 0, left: 40, right: 30 } };
		const left = bringInView(view, { x: -395, y: 0, w: 50, h: 20 }, area);
		expect(400 + (-395 - left.cx)).toBeCloseTo(40, 9);
		const right = bringInView(view, { x: 340, y: 0, w: 50, h: 20 }, area);
		expect(400 + (390 - right.cx)).toBeCloseTo(770, 9);
		expect(bringInView(view, { x: -300, y: 0, w: 50, h: 20 }, area)).toEqual(view);
	});

	it('betweenSides makes the view for the room between the insets and puts it there', () => {
		const make = (a: { w: number; h: number }): View => ({ scale: 2, cx: a.w / 4, cy: 0 });
		expect(betweenSides({ w: 800, h: 400 }, 0, 0, make)).toEqual(make({ w: 800, h: 400 }));
		const v = betweenSides({ w: 800, h: 400 }, 50, 10, make);
		// The room is 740 px wide and starts at 50: its centre is at screen x 420, 20 px right of the screen centre.
		expect(v.scale).toBe(2);
		expect(v.cx).toBeCloseTo(740 / 4 - 20 / 2, 9);
	});
});

/** An iPhone held upright, `w` points wide: the safe area 47 px at the top, the bottom bar 64 px. */
const upright = (w: number, h: number, font = 16): Screen => ({ w, h, coarse: true, safe: 47, left: 0, right: 0, toolbar: { top: h - 64, height: 64, left: 0, width: w }, font });

describe('V4: an upright phone 360 points wide shows the children of the start person whole (sideways tree)', () => {
	for (const font of [12, 16, 21, 28]) {
		it(`sample tree 7, note font ${font} px: the start card and the children's column are whole in width; the names stay at 11 px or more`, async () => {
			const s = upright(360, 780, font);
			const view = await open(sample('07-four-hundred-people.md'), s);
			expect(view.laid.layout.orientation).toBe('sideways');
			const persons = view.laid.layout.persons;
			const me = persons.get(view.focusId!)!;
			const kids = kidsOf(view, view.focusId!).map((k) => onScreen(view, s, persons.get(k)!));
			expect(kids.length).toBeGreaterThan(0);
			expect(onScreen(view, s, me).left).toBeGreaterThanOrEqual(-0.5);
			for (const k of kids) {
				expect(k.left, JSON.stringify(k)).toBeGreaterThanOrEqual(-0.5);
				expect(k.right, JSON.stringify(k)).toBeLessThanOrEqual(s.w + 0.5);
			}
			// At least one child is whole on the screen, between the bars.
			expect(kidsOf(view, view.focusId!).some((k) => wholeOnScreen(view, s, persons.get(k)!))).toBe(true);
			const names = view.panZoom.view!.scale * view.laid.layout.geometry.fontPx;
			expect(names).toBeGreaterThanOrEqual(11 - 1e-9);
			expect(names).toBeLessThan(14);
		});
	}

	it('sample tree 7 at 390 points: the children fit at 14 px names, but a "+ N" sign of a folded family would be cut, so the names go to about 12.5 px (D257)', async () => {
		const view = await open(sample('07-four-hundred-people.md'), upright(390, 844));
		const names = view.panZoom.view!.scale * view.laid.layout.geometry.fontPx;
		expect(names).toBeGreaterThanOrEqual(11);
		expect(names).toBeCloseTo(12.45, 1);
	});

	it('sidewaysView: a children column that needs names under 11 px keeps 14 px, as before', () => {
		const me: Rect = { x: 0, y: 300, w: 180, h: 61 };
		const near = sidewaysView({ w: 360, h: 780 }, 16, { me, partners: [], children: [{ card: { x: 245, y: 200, w: 180, h: 61 }, partners: [] }], parents: [] }, 103, 712, me);
		expect(near.view.scale * 16).toBeGreaterThanOrEqual(11 - 1e-9);
		expect(near.view.scale * 16).toBeLessThan(14);
		// The right edge of the child at 360 - 8 px.
		expect(180 + (425 - near.view.cx) * near.view.scale).toBeCloseTo(352, 4);
		const far = sidewaysView({ w: 360, h: 780 }, 16, { me, partners: [], children: [{ card: { x: 400, y: 200, w: 180, h: 61 }, partners: [] }], parents: [] }, 103, 712, me);
		expect(far.view.scale * 16).toBeCloseTo(14, 9);
	});
});

describe('V3: a "+" badge of the first view is not in the safe area above the focus bar, nor under the bar', () => {
	for (const font of [16, 21, 28]) {
		it(`sample tree 7 upright, focus Rosalind Veyle, note font ${font} px: every badge on the screen is wholly below the band of the safe area and the bar`, async () => {
			const s = upright(390, 844, font);
			const view = await open(`options:\n  focus: rosalind-veyle\n\n${sample('07-four-hundred-people.md')}`, s);
			expect(view.focusId).toBe('rosalind-veyle');
			const marks = (view.scene?.badges ?? []).map((b) => ({ id: b.person, ...onScreen(view, s, b.mark) })).filter((m) => m.right > 0 && m.left < s.w && m.bottom > 0 && m.top < s.h);
			expect(marks.length).toBeGreaterThan(0);
			for (const m of marks) expect(m.top >= view.insetTop - 0.5 || m.bottom <= 0.5, `badge of ${m.id} at ${m.top.toFixed(1)}..${m.bottom.toFixed(1)}, band 0..${view.insetTop}`).toBe(true);
			expect(wholeOnScreen(view, s, view.laid.layout.persons.get('rosalind-veyle')!)).toBe(true);
		});
	}

	it('keepTopCardWhole: a badge that reaches from under the band into the safe area moves the view down until it is below the band; a card wholly under the band does not', () => {
		const size = { w: 400, h: 800 };
		const v: View = { scale: 1, cx: 200, cy: 400 };
		const card: Rect = { x: 100, y: 50, w: 150, h: 50 };
		const mark: Rect = { x: 242, y: 42, w: 16, h: 16 };
		const key: Rect = { x: 100, y: 300, w: 150, h: 50 };
		// Without the badge the card stays wholly under the band of 103 px.
		expect(keepTopCardWhole(v, size, 103, 732, [card, key], [key])).toEqual(v);
		const out = keepTopCardWhole(v, size, 103, 732, [card, key], [key], [mark]);
		expect(size.h / 2 + (mark.y - out.cy) * out.scale).toBeCloseTo(103, 6);
		// When the move down would push the key card out at the foot, the badge goes above the screen instead.
		const low: Rect = { x: 100, y: 700, w: 150, h: 30 };
		const up = keepTopCardWhole(v, size, 103, 732, [card, low], [low], [mark]);
		expect(size.h / 2 + (mark.y + mark.h - up.cy) * up.scale).toBeLessThanOrEqual(0.5);
	});
});
