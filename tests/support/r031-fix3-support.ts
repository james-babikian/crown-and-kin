/*
 * Shared helpers of the 0.3.1 third repair round's view tests: the full-screen view of a block on a touch screen, with the bars and the
 * safe areas where the browser puts them (as r031-fix2-view.test.ts does), and screen places of layout boxes. The test files mock
 * `obsidian` and the CodeMirror parts before they import this file.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rect } from '../../src/layout/model';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/view/settings';
import type { View } from '../../src/render/view-math';
import { FEl, device, flushFrames, resizeAll, settle } from '../acceptance/fake-dom';
import { topLevelBlocks } from '../acceptance/load';
import { fakeHandle, fakeHost } from '../acceptance/tree-view-fakes';

/** The first block of a sample tree. */
export const sample = (file: string) => topLevelBlocks(readFileSync(fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url)), 'utf8'))[0];

/** The private parts of the tree view that the tests read. */
export interface Priv {
	panZoom: { view: View | null; size: { w: number; h: number }; setView(v: View, o?: unknown): void };
	laid: { layout: { persons: Map<string, Rect>; orientation: string; folds?: { parents: string[] }[] } };
	scene: {
		badges: { person: string; mark: Rect; hit: { getAttribute(n: string): string | null } }[];
		folds: { el: FEl; control: { parents: string[] } }[];
	} | null;
	focusId: string | null;
	insetTop: number;
	insetBottom: number;
	insetLeft: number;
	insetRight: number;
}

/** A touch screen with its bars and safe areas. */
export interface Screen {
	w: number;
	h: number;
	/** The safe area at the top, in px; the bar of focus mode starts there and is 52 px high. */
	safe: number;
	left: number;
	right: number;
	toolbar: { top: number; height: number };
	font: number;
}

/** An iPhone held sideways (the tree top to bottom): no safe area at the top, 47 px at each side, the bottom bar 64 px. */
export const side = (font: number): Screen => ({ w: 844, h: 390, safe: 0, left: 47, right: 47, toolbar: { top: 326, height: 64 }, font });
/** An iPhone held upright (the sideways tree): the safe area 47 px at the top, the bottom bar 64 px. */
export const upright = (font: number, w = 390, h = 844): Screen => ({ w, h, safe: 47, left: 0, right: 0, toolbar: { top: h - 64, height: 64 }, font });

/** The full-screen view of `source` on a touch `screen`, with the bars at their places and the safe areas in the probe; also its root element. */
export async function openFull(source: string, screen: Screen, settings?: Partial<DynastySettings>): Promise<{ view: Priv; root: FEl }> {
	Object.assign(device, { coarse: true, width: screen.w, height: screen.h });
	const probe = { fontSize: `${screen.font}px`, fontFamily: 'sans-serif', paddingTop: `${screen.safe}px`, paddingLeft: `${screen.left}px`, paddingRight: `${screen.right}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
	(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
	const host = fakeHost(settings ? { ...DEFAULT_SETTINGS, ...settings } : undefined);
	const handle = fakeHandle('n.md', source);
	const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	const root = modal.containerEl as unknown as FEl;
	const vp = root.querySelector('.dynasty-viewport')!;
	vp.clientWidth = screen.w;
	vp.clientHeight = screen.h;
	Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: screen.toolbar.top, offsetHeight: screen.toolbar.height, offsetLeft: 0, offsetWidth: screen.w });
	const b = vp.querySelector('.dynasty-focus-bar');
	if (b) Object.assign(b, { offsetTop: screen.safe, offsetHeight: 52, offsetLeft: 0, offsetWidth: screen.w });
	resizeAll();
	flushFrames();
	return { view: [...host.views].find((v) => v.isFull)! as unknown as Priv, root };
}

/** Where a layout box shows on `s` at the current view. */
export function onScreen(p: Priv, s: Screen, b: Rect) {
	const v = p.panZoom.view!;
	return { left: s.w / 2 + (b.x - v.cx) * v.scale, right: s.w / 2 + (b.x + b.w - v.cx) * v.scale, top: s.h / 2 + (b.y - v.cy) * v.scale, bottom: s.h / 2 + (b.y + b.h - v.cy) * v.scale };
}

/** The rectangle of an SVG rect from its attributes. */
export const rectOf = (el: { getAttribute(n: string): string | null }): Rect => ({ x: Number(el.getAttribute('x')), y: Number(el.getAttribute('y')), w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')) });
