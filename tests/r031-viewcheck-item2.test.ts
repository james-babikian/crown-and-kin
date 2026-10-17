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

// Check of the WP-8 view fix, item 2 (G3 F3): `reveal` now counts the "+" badge as part of the card. `showEdited` calls `reveal` after the
// D244 keep-place view, so a saved sheet of a card whose badge reaches under the focus bar moves the card to the centre: the kept place is lost.

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
	scene: { badges: { person: string; mark: Rect }[] } | null;
	insetTop: number;
}

const W = 390;
const H = 844;
const SAFE = 47;

describe('item 2: keep place after a rename of a card whose badge reaches under the focus bar', () => {
	it('the renamed card stays where it was (D244), as on 23e8f1b6', async () => {
		const source = `options:\n  focus: thea-valmont\n\n${sample('07-four-hundred-people.md')}`;
		Object.assign(device, { coarse: true, width: W, height: H });
		const probe = { fontSize: '16px', fontFamily: 'sans-serif', paddingTop: `${SAFE}px`, getPropertyValue: (n: string) => (n === '--dynasty-css-ready' ? '1' : '') };
		(globalThis as Record<string, unknown>).getComputedStyle = () => probe;
		const host = fakeHost();
		const handle = fakeHandle('n.md', source);
		const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
		const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
		modal.open();
		await settle();
		const root = modal.containerEl as unknown as FEl;
		const vp = root.querySelector('.dynasty-viewport')!;
		vp.clientWidth = W;
		vp.clientHeight = H;
		Object.assign(vp.querySelector('.dynasty-toolbar')!, { offsetTop: H - 64, offsetHeight: 64, offsetLeft: 0, offsetWidth: W });
		const bar = vp.querySelector('.dynasty-focus-bar');
		expect(bar).not.toBeNull();
		Object.assign(bar!, { offsetTop: SAFE, offsetHeight: 52, offsetLeft: 0, offsetWidth: W });
		resizeAll();
		flushFrames();
		const view = [...host.views].find((v) => v.isFull)! as unknown as Priv;
		const who = 'lucan-greymane';
		const card = view.laid.layout.persons.get(who)!;
		const v0 = view.panZoom.view!;
		// The user leaves the card whole, 1 px under the band that the view keeps free: its badge reaches into the bar.
		view.panZoom.setView({ scale: v0.scale, cx: v0.cx, cy: card.y + H / 2 / v0.scale - (view.insetTop + Number(process.env.OFF ?? 1)) / v0.scale }, { byUser: true });
		flushFrames();
		const mark = view.scene!.badges.find((b) => b.person === who)!.mark;
		const screenY = (y: number) => H / 2 + (y - view.panZoom.view!.cy) * view.panZoom.view!.scale;
		const screenX = (x: number) => W / 2 + (x - view.panZoom.view!.cx) * view.panZoom.view!.scale;
		if (!process.env.OFF) expect(screenY(mark.y)).toBeLessThan(SAFE + 52);
		const was = { x: screenX(card.x + card.w / 2), y: screenY(card.y + card.h / 2) };
		// The sheet of Lucan saves a new name (the same text as the keep-place tests: a short rename that does not change the card size).
		const out = applyOp(source, { kind: 'set-person-fields', id: who, fields: { notes: 'A note.' } });
		if (!out.ok) throw new Error(out.code);
		const state = handle.state as { highlight: { id: string; until: number } | null };
		(TreeView as unknown as { sheetPerson: WeakMap<object, { id: string; until: number }> }).sheetPerson.set(state, { id: who, until: clock.now + 3000 });
		state.highlight = { id: who, until: clock.now + 3000 };
		handle.change(out.body);
		await settle();
		// The redraw builds the bars again: they get their sizes as on the screen.
		const vp2 = root.querySelector('.dynasty-viewport')!;
		Object.assign(vp2, { clientWidth: W, clientHeight: H });
		Object.assign(vp2.querySelector('.dynasty-toolbar')!, { offsetTop: H - 64, offsetHeight: 64, offsetLeft: 0, offsetWidth: W });
		const bar2 = vp2.querySelector('.dynasty-focus-bar');
		if (bar2) Object.assign(bar2, { offsetTop: SAFE, offsetHeight: 52, offsetLeft: 0, offsetWidth: W });
		resizeAll();
		flushFrames();
		const now = view.laid.layout.persons.get(who)!;
		const after = { x: screenX(now.x + now.w / 2), y: screenY(now.y + now.h / 2) };
		const moved = Math.hypot(after.x - was.x, after.y - was.y);
		expect(moved, `the card moved ${moved.toFixed(1)} px (from ${was.x.toFixed(0)},${was.y.toFixed(0)} to ${after.x.toFixed(0)},${after.y.toFixed(0)})`).toBeLessThanOrEqual(1.5);
	});
});
