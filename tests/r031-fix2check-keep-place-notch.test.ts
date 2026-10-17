import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Rect } from '../src/layout/model';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { TreeView } from '../src/obsidian/tree-view';
import type { View } from '../src/render/view-math';
import { FEl, clock, device, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { topLevelBlocks } from './acceptance/load';
import { fakeHandle, fakeHost, fullViews } from './acceptance/tree-view-fakes';

// Fix2 view check (V1 and D244): `showEdited` calls `reveal(box, false)` after the D244 keep-place view. V1 made `reveal` treat the side safe area (the notch) as
// off screen, so a saved sheet of a card that is whole on the screen but reaches into the notch now moves the card to the centre: the kept place is lost.
// The same flow with the badge under the bar was ruled "D244 wins" (r031-viewcheck-item2).

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
	laid: { layout: { persons: Map<string, Rect> } };
	insetTop: number;
}

// An iPhone on its side: no safe area at the top, the notch 47 px at each side, the bottom bar 64 px.
const W = 844;
const H = 390;
const SIDE = 47;

function bars(root: FEl): void {
	const vp = root.querySelector('.dynasty-viewport')!;
	Object.assign(vp, { clientWidth: W, clientHeight: H });
	Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: H - 64, offsetHeight: 64, offsetLeft: 0, offsetWidth: W });
	const bar = vp.querySelector('.dynasty-focus-bar');
	if (bar) Object.assign(bar, { offsetTop: 0, offsetHeight: 52, offsetLeft: 0, offsetWidth: W });
}

describe('fix2 check: keep place (D244) after a rename on a phone held sideways', () => {
	it('a card that is whole on the screen but reaches into the left notch stays where it was after its sheet is saved', async () => {
		const source = sample('07-four-hundred-people.md');
		Object.assign(device, { coarse: true, width: W, height: H });
		const probe = { fontSize: '16px', fontFamily: 'sans-serif', paddingTop: '0px', paddingLeft: `${SIDE}px`, paddingRight: `${SIDE}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
		(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
		const host = fakeHost();
		const handle = fakeHandle('n.md', source);
		const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
		const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
		modal.open();
		await settle();
		const root = modal.containerEl as unknown as FEl;
		bars(root);
		resizeAll();
		flushFrames();
		const view = [...host.views].find((v) => v.isFull)! as unknown as Priv;
		const who = 'edmund-valmont';
		const card = view.laid.layout.persons.get(who)!;
		const v0 = view.panZoom.view!;
		// The user drags the card to the left: whole on the screen, its left edge 20 px from the screen edge (inside the 47 px notch band), vertically in the free area.
		view.panZoom.setView({ scale: v0.scale, cx: card.x + (W / 2 - 20) / v0.scale, cy: card.y + card.h / 2 }, { byUser: true });
		flushFrames();
		const screenY = (y: number) => H / 2 + (y - view.panZoom.view!.cy) * view.panZoom.view!.scale;
		const screenX = (x: number) => W / 2 + (x - view.panZoom.view!.cx) * view.panZoom.view!.scale;
		expect(screenX(card.x)).toBeCloseTo(20, 6);
		const was = { x: screenX(card.x + card.w / 2), y: screenY(card.y + card.h / 2) };
		// The sheet of Edmund saves (the same short edit as the keep-place tests: the card size does not change).
		const out = applyOp(source, { kind: 'set-person-fields', id: who, fields: { notes: 'A note.' } });
		if (!out.ok) throw new Error(out.code);
		const state = handle.state as { highlight: { id: string; until: number } | null };
		(TreeView as unknown as { sheetPerson: WeakMap<object, { id: string; until: number }> }).sheetPerson.set(state, { id: who, until: clock.now + 3000 });
		state.highlight = { id: who, until: clock.now + 3000 };
		handle.change(out.body);
		await settle();
		bars(root);
		resizeAll();
		flushFrames();
		const now = view.laid.layout.persons.get(who)!;
		const after = { x: screenX(now.x + now.w / 2), y: screenY(now.y + now.h / 2) };
		const moved = Math.hypot(after.x - was.x, after.y - was.y);
		expect(moved, `the card moved ${moved.toFixed(1)} px (from ${was.x.toFixed(0)},${was.y.toFixed(0)} to ${after.x.toFixed(0)},${after.y.toFixed(0)})`).toBeLessThanOrEqual(1.5);
	});
});
