import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rect } from '../../src/layout/model';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import type { TreeView } from '../../src/obsidian/tree-view';
import type { View } from '../../src/render/view-math';
import { FEl, clock, device, flushFrames, resetDom, resizeAll, runFrame, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { topLevelBlocks } from './load';
import { fakeHandle, fakeHost, fullViews, phone } from './tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.3 WP-A on the real TreeView, the PanZoom and the full-screen view on the fakes (D222, N02, N03):
 *   A.4 a tree that fits between the bars opens centred in the free area (phone 390 x 844 with a safe area of 47 px and a bottom bar; computer 900 x 700 with a toolbar);
 *   A.5 a drag stops the tree at the edge of the free area;
 *   D235 the pulse of an edited card starts in the frame that writes the new view (F2: also after an in-place redraw).
 * The numbers of "keeps its 0.2.8 first view" were recorded by running the same cases on the tag v0.2.8.
 */

useFakeDom();
/** n frames of the fake window. */
function step(n = 1): void {
	for (let i = 0; i < n; i++) {
		runFrame();
	}
}

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	vi.restoreAllMocks();
});

const read = (name: string) => topLevelBlocks(readFileSync(fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url)), 'utf8'))[0];
const F06 = read('06-sixty-people.md');

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



/** The people of F06: one wholly inside the first view, two wholly outside and less than a view away. */
function pick(p: Priv, size: { w: number; h: number }) {
	const v = p.panZoom.view!;
	const hw = size.w / 2 / v.scale;
	const hh = size.h / 2 / v.scale;
	let outside: string | null = null;
	let inside: string | null = null;
	for (const [id, b] of p.laid.layout.persons) {
		const whole = b.x >= v.cx - hw && b.x + b.w <= v.cx + hw && b.y >= v.cy - hh && b.y + b.h <= v.cy + hh;
		const near = Math.abs(b.x + b.w / 2 - v.cx) < 2 * hw && Math.abs(b.y + b.h / 2 - v.cy) < 2 * hh;
		if (whole) inside ??= id;
		else if (near && (b.x > v.cx + hw || b.x + b.w < v.cx - hw)) outside ??= id;
	}
	return { outside: outside!, inside: inside! };
}
const mark = (id: string) => ({ highlight: { id, until: clock.now + 3000 } });
const lit = (p: Priv, id: string) => p.scene.cards.get(id)!.hasClass('dynasty-highlight');

describe('G2 review WP-A', () => {
	it('F2: an in-place redraw after an edit pulses the card of the new drawing, in the frame after the new view is written', async () => {
		const { p, view, handle } = await openFull(F06, COMPUTER_SCREEN);
		const a = pick(p, { w: COMPUTER_SCREEN.w, h: COMPUTER_SCREEN.h - p.insetTop });
		p.showEdited(mark(a.outside));
		step(3);
		(handle as unknown as { state: { highlight: unknown } }).state.highlight = mark(a.outside).highlight;
		// A web font loads: the tree is laid out again in place and the first view is chosen again (recheckTall -> redraw -> resized).
		const q = view as unknown as { redraw(g: unknown, l: unknown): void; resized(): void; g: unknown };
		q.redraw(q.g, p.laid);
		q.resized();
		// The card of the new drawing is not lit before the frame that writes the view; it is lit in that frame, and no view change is left running.
		expect(lit(p, a.outside)).toBe(false);
		step(1);
		expect({ busy: (p.panZoom as unknown as { busy: boolean }).busy, on: lit(p, a.outside) }).toEqual({ busy: false, on: true });
	});
});
