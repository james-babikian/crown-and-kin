import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
// main.ts pulls in the Live Preview extension; its CodeMirror parts are not needed here.
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { PanZoom } from '../../src/render/dom/pan-zoom';
import { pinchView, transformFor, treeBounds, type View } from '../../src/render/view-math';
import { FEl, clock, dispatch, flushFrames, installDom, pointer, resetDom, runFrame, runTimers, settle, wheel } from './fake-dom';
import { events, notices, openModals, resetObsidian } from './fake-obsidian';
import { FAR, desktop, embed, fakeHandle, isOpen, loadPlugin, openFullScreen, openSheetOn, phone, sheets, shown, tabletDevice, type FakeApp, type FakeHandle } from './tree-view-fakes';

/*
 * Adopted from the code reviews of WP4.1/4.2 (round 1: scratch/review-4.1-4.2, 28fd3d8; round 2:
 * scratch/review-4.1-4.2-r2, 6f11701). These tests drive the real PanZoom, TreeView,
 * FullScreenModal, EditSheet and plugin on a fake DOM (fake-dom.ts), a fake `obsidian` module
 * (fake-obsidian.ts) and the plugin-side fakes of tree-view-fakes.ts. Each test names the behaviour the spec requires.
 */

beforeAll(() => installDom());

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------- PanZoom on its own ----------

// A 2000 × 1000 tree, shown at scale 1 near its right edge, in an 800 × 600 viewport.
const BOUNDS = treeBounds(2000, 1000);
const SIZE = { w: 800, h: 600 };

function fullPanZoom(vp: FEl, settled: { view: View; byUser: boolean }[] = []): PanZoom {
	const pz = new PanZoom({
		viewport: vp as unknown as HTMLElement,
		scene: new FEl('g') as unknown as SVGGElement,
		bounds: BOUNDS,
		fontPx: 16,
		interactive: true,
		mode: 'full',
		onSettle: (view, byUser) => settled.push({ view, byUser }),
		guard: (fn) => fn(),
	});
	pz.resize(SIZE);
	pz.setView({ scale: 1, cx: 1900, cy: 500 });
	flushFrames();
	return pz;
}

/** Screen px between two views at the scale of `b`. */
const jumpPx = (a: View, b: View) => Math.hypot(b.cx - a.cx, b.cy - a.cy) * b.scale;

/**
 * Two fingers down at (400, 300) and (600, 300), then both move 350 px to the left: a two-finger
 * pan towards the right edge of the tree that ends past the pan limit.
 */
function pinchPastLimit(bg: FEl, pz: PanZoom): View {
	const start = pz.view!;
	dispatch(bg, 'pointerdown', pointer('touch', 1, 400, 300));
	dispatch(bg, 'pointerdown', pointer('touch', 2, 600, 300, false));
	dispatch(bg, 'pointermove', pointer('touch', 1, 50, 300));
	dispatch(bg, 'pointermove', pointer('touch', 2, 250, 300, false));
	// Setup check, whatever the fix: the fingers asked for a view outside the pan limits.
	const asked = pinchView(start, [{ x: 400, y: 300 }, { x: 600, y: 300 }], [{ x: 50, y: 300 }, { x: 250, y: 300 }], SIZE, pz.limits);
	expect(asked.cx).toBeGreaterThan(BOUNDS.x + BOUNDS.w);
	return pz.view!;
}

describe('Full-screen gestures in PanZoom (spec §7.2, §7.6)', () => {
	it('a tap that stops an animation (Fit, Find, double-tap) still ends with a settled view', () => {
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const bg = vp.createSvg('svg', { cls: 'dynasty-svg' });
		const settled: { view: View; byUser: boolean }[] = [];
		const pz = fullPanZoom(vp, settled);
		settled.length = 0;
		pz.setView({ scale: 0.3, cx: 1000, cy: 500 }, { animate: true, byUser: true });
		runFrame(); // one frame of the animation
		dispatch(bg, 'pointerdown', pointer('touch', 3, 400, 300));
		dispatch(bg, 'pointerup', pointer('touch', 3, 400, 300));
		flushFrames();
		runTimers();
		// The view stops where the tap caught it (or ends the animation); the level of detail and
		// the shared view must follow the view on screen.
		expect(settled[settled.length - 1]).toEqual({ view: pz.view, byUser: true });
	});

	it('after a two-finger drag past the pan limit, lifting one finger does not make the view jump on the next 1 px move', () => {
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const bg = vp.createSvg('svg', { cls: 'dynasty-svg' });
		const pz = fullPanZoom(vp);
		const afterPinch = pinchPastLimit(bg, pz);
		// Finger 1 lifts; finger 2 goes on panning and moves 1 px.
		dispatch(bg, 'pointerup', pointer('touch', 1, 50, 300));
		dispatch(bg, 'pointermove', pointer('touch', 2, 249, 300, false));
		expect(jumpPx(afterPinch, pz.view!)).toBeLessThanOrEqual(2);
	});

	it('after a two-finger drag past the pan limit, a 1 px wheel pan does not make the view jump', () => {
		const vp = new FEl('div', { cls: 'dynasty-viewport' });
		const bg = vp.createSvg('svg', { cls: 'dynasty-svg' });
		const pz = fullPanZoom(vp);
		pinchPastLimit(bg, pz);
		dispatch(bg, 'pointerup', pointer('touch', 1, 50, 300));
		dispatch(bg, 'pointerup', pointer('touch', 2, 250, 300, false));
		const afterPinch = pz.view!;
		// A plain wheel of 1 px, back towards the tree (spec §7.2: in full screen a wheel pans).
		dispatch(bg, 'wheel', wheel(-1, 0));
		expect(jumpPx(afterPinch, pz.view!)).toBeLessThanOrEqual(2);
	});
});

// ---------- The full-screen modal with a real TreeView ----------

/** Event `a` happened before event `b` (fake-obsidian.ts `events`). */
const before = (a: string, b: string) => {
	const i = events.indexOf(a);
	const j = events.indexOf(b);
	return i >= 0 && j >= 0 && i < j;
};

const ONE = 'people:\n  - id: a\n    name: Aldous\n';
const LINKED = "people:\n  - id: a\n    name: Aldous\n    link: '[[Aldous Vane]]'\n  - id: b\n    name: Berta\n";
// options.start names nobody: a warning (spec §8), so the toolbar has the problem list.
const WITH_WARNING = 'options:\n  start: ghost\npeople:\n  - id: a\n    name: Aldous\n  - id: b\n    name: Berta\n';

describe('Full-screen view: the TreeView in the modal', () => {
	it('control: a tree with people has a Close button that closes the view', async () => {
		phone();
		const { modal, root } = await openFullScreen(ONE);
		dispatch(root.querySelector('.dynasty-close')!, 'click');
		expect(isOpen(modal)).toBe(false);
	});

	it('has a Close button also when its tree has no people', async () => {
		// Spec §7.1: the full-screen view closes with the Close button; on a phone it is the only way out.
		phone();
		const { modal, root } = await openFullScreen('people: []\n');
		expect(isOpen(modal)).toBe(true);
		expect(root.querySelector('.dynasty-empty')).not.toBeNull(); // the "Add first person" box (spec §5.9)
		const close = root.querySelector('.dynasty-close');
		expect(close).not.toBeNull();
		dispatch(close!, 'click');
		expect(isOpen(modal)).toBe(false);
	});

	it('control: a touch tap on a card opens the edit sheet at once', async () => {
		// Spec §7.2: a tap on a card opens the edit sheet immediately.
		phone();
		const { root } = await openFullScreen(ONE);
		const card = root.querySelector('.dynasty-card[data-person="a"]')!;
		dispatch(card, 'pointerdown', pointer('touch', 7, 100, 100));
		dispatch(card, 'pointermove', pointer('touch', 7, 105, 100));
		dispatch(card, 'pointerup', pointer('touch', 7, 105, 100));
		await settle();
		expect(sheets()).toHaveLength(1);
	});

	it.each(['touch', 'pen'] as const)('a %s pan that starts on a card and comes back within 8 px of its start does not open the edit sheet', async (type) => {
		// Spec §7.2: tap vs pan uses an 8 px threshold, and a pan never opens a sheet.
		phone();
		const { root, vp, handle } = await openFullScreen(ONE);
		const card = root.querySelector('.dynasty-card[data-person="a"]')!;
		expect(card).not.toBeNull();
		const start = shown(root);
		dispatch(card, 'pointerdown', pointer(type, 7, 100, 100));
		dispatch(card, 'pointermove', pointer(type, 7, 160, 100));
		flushFrames();
		expect(shown(root)).not.toBe(start); // the tree panned by 60 px
		dispatch(card, 'pointermove', pointer(type, 7, 102, 100));
		dispatch(card, 'pointerup', pointer(type, 7, 102, 100));
		flushFrames();
		await settle();
		expect(vp).not.toBeNull();
		expect(handle!.state.view).not.toBeNull(); // the pan ended and the view was kept
		expect(sheets()).toHaveLength(0);
	});

	it('control: on a desktop, a plain wheel over the tree pans it', async () => {
		// Spec §7.2: full-screen, desktop: drag or wheel pans.
		desktop();
		const { root } = await openFullScreen(ONE);
		const start = shown(root);
		const e = dispatch(root.querySelector('.dynasty-svg')!, 'wheel', wheel(0, 100, 700, 100));
		flushFrames();
		expect(shown(root)).not.toBe(start);
		expect(e.defaultPrevented).toBe(true);
	});

	it.each([
		['legend', ONE, '.dynasty-legend-button', '.dynasty-legend-row'],
		['problem list', WITH_WARNING, '.dynasty-warning-badge', '.dynasty-problem'],
	])('a plain wheel over the open %s does not pan the tree and is left to the popover so the list scrolls', async (_name, source, button, row) => {
		// Spec §7.2: in full screen a wheel pans the tree; the popover is an HTML control on top of it.
		desktop();
		const { root } = await openFullScreen(source);
		dispatch(root.querySelector(button)!, 'click');
		const target = root.querySelector(`.dynasty-popover ${row}`);
		expect(target).not.toBeNull();
		const start = shown(root);
		const e = dispatch(target!, 'wheel', wheel(0, 100, 700, 100));
		flushFrames();
		runTimers();
		expect(shown(root)).toBe(start);
		expect(e.defaultPrevented).toBe(false);
	});

	/** D52: on a phone, Fit is an item of the More list. */
	const fitOnPhone = (root: FEl) => {
		expect(root.querySelector('.dynasty-fit')).toBeNull();
		dispatch(root.querySelector('.dynasty-more')!, 'click', { detail: 1 });
		dispatch(root.querySelector('.dynasty-more-fit')!, 'click', { detail: 1 });
	};

	it('control: a Fit animation that runs to its end stores the view on screen as the shared view', async () => {
		phone();
		const { root, handle } = await openFullScreen(ONE);
		fitOnPhone(root);
		flushFrames();
		const view = handle!.state.view;
		expect(view).not.toBeNull();
		const vp = root.querySelector('.dynasty-viewport')!;
		expect(shown(root)).toBe(transformFor(view!, { w: vp.clientWidth, h: vp.clientHeight }));
	});

	it.each(['Fit', 'double-tap'] as const)('a tap that stops the %s animation stores the view on screen as the shared view', async (kind) => {
		// Spec §7.1: the full-screen view shares the view state with the embed; spec §5.5 keeps the view.
		phone();
		const { root, handle } = await openFullScreen(ONE);
		const bg = root.querySelector('.dynasty-svg')!;
		if (kind === 'Fit') {
			fitOnPhone(root);
		} else {
			for (let i = 0; i < 2; i++) {
				dispatch(bg, 'pointerdown', pointer('touch', 10 + i, 400, 300));
				dispatch(bg, 'pointerup', pointer('touch', 10 + i, 400, 300));
			}
		}
		runFrame(); // one frame of the animation
		dispatch(bg, 'pointerdown', pointer('touch', 20, 200, 200));
		dispatch(bg, 'pointerup', pointer('touch', 20, 200, 200));
		flushFrames();
		runTimers();
		const view = handle!.state.view;
		expect(view).not.toBeNull();
		const vp = root.querySelector('.dynasty-viewport')!;
		expect(shown(root)).toBe(transformFor(view!, { w: vp.clientWidth, h: vp.clientHeight }));
	});

	it('on a desktop, a click on a linked name closes the full-screen view before the linked note opens', async () => {
		// Spec §5.2 (desktop): the name is an internal link, and a click opens it. In full screen the
		// note would open behind the modal, so the full-screen view closes first.
		desktop();
		const { app, modal, root } = await openFullScreen(LINKED);
		const name = root.querySelector('.dynasty-card[data-person="a"] .dynasty-name-link');
		expect(name).not.toBeNull();
		dispatch(name!, 'pointerdown', pointer('mouse', 1, 300, 200));
		dispatch(name!, 'pointerup', pointer('mouse', 1, 300, 200));
		dispatch(name!, 'click', { button: 0, clientX: 300, clientY: 200 });
		await settle();
		flushFrames();
		runTimers();
		expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1);
		expect(app.workspace.openLinkText.mock.calls[0].slice(0, 2)).toEqual(['Aldous Vane', 'n.md']);
		expect(isOpen(modal)).toBe(false);
		expect(before('close FullScreenModal', 'open-link Aldous Vane')).toBe(true);
		expect(sheets()).toHaveLength(0); // a click on the link is not a click to edit
	});

	it.each(['touch', 'mouse'] as const)('"Open linked note" in an edit sheet opened by %s closes the full-screen view before the note opens', async (type) => {
		// Spec §5.2: the edit sheet has an Open linked note button; in full screen the note would open
		// behind the modal, so the full-screen view closes first.
		if (type === 'touch') phone();
		else desktop();
		const { app, modal, root } = await openFullScreen(LINKED);
		const card = root.querySelector('.dynasty-card[data-person="a"]')!;
		if (type === 'touch') {
			dispatch(card, 'pointerdown', pointer('touch', 5, 300, 200));
			dispatch(card, 'pointerup', pointer('touch', 5, 300, 200));
		} else {
			dispatch(card, 'pointerdown', pointer('mouse', 1, 300, 200));
			dispatch(card, 'pointerup', pointer('mouse', 1, 300, 200));
			dispatch(card, 'click', { button: 0, clientX: 300, clientY: 200 });
		}
		await settle();
		expect(sheets()).toHaveLength(1);
		const sheet = sheets()[0];
		const open = (sheet.contentEl as unknown as FEl).querySelector('.dynasty-sheet-open-link');
		expect(open).not.toBeNull();
		clock.now += 1000; // past the ghost-click guard of a sheet opened by a tap
		dispatch(open!, 'click', { button: 0 });
		await settle();
		flushFrames();
		runTimers();
		expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1);
		expect(app.workspace.openLinkText.mock.calls[0][0]).toBe('Aldous Vane');
		expect(isOpen(modal)).toBe(false);
		expect(before('close FullScreenModal', 'open-link Aldous Vane')).toBe(true);
	});
});

describe('Full-screen view: the note behind it', () => {
	it('control: a read-only full-screen view closes with a Notice when its note is deleted', async () => {
		// Spec §7.1: if the block disappears while the view is open, close it with a Notice.
		const { app, modal } = await openFullScreen('people: []\n', { readOnly: true, path: 'old.md' });
		app.vault.fire('delete', { path: 'old.md' });
		expect(isOpen(modal)).toBe(false);
		expect(notices).toHaveLength(1);
	});

	it('a read-only full-screen view closes with a Notice when its note is deleted after a rename', async () => {
		// Spec §7.1 and §6.1 (a renamed note keeps its blocks): the view must follow the new path.
		const { app, modal, views } = await openFullScreen('people: []\n', { readOnly: true, path: 'old.md' });
		expect(views.size).toBe(1);
		// Obsidian reports the rename; the plugin tells every view (main.ts `renamed`).
		app.vault.fire('rename', { path: 'new.md' }, 'old.md');
		for (const v of views) v.renamed('old.md', 'new.md');
		app.vault.fire('delete', { path: 'new.md' });
		expect(isOpen(modal)).toBe(false);
		expect(notices).toHaveLength(1);
	});
});

// ---------- Round 2 ----------

type CloseUnder = (o: { app: FakeApp; handle: FakeHandle | null }) => void;

describe('"Open linked note" after the full-screen view closed under the edit sheet (spec §5.2, §7.1)', () => {
	it.each<[string, CloseUnder]>([
		['the block text got a hard error from an outside edit', (o) => o.handle!.change('people: [\n')],
		['its note was deleted', (o) => o.app.vault.fire('delete', { path: 'n.md' })],
	])('still opens the note when the full-screen view closed because %s', async (_why, closeUnder) => {
		desktop();
		const opened = await openFullScreen(LINKED);
		const { app, modal, root } = opened;
		const sheet = await openSheetOn(root, 'a', 'mouse');
		closeUnder(opened);
		expect(isOpen(modal)).toBe(false); // the full-screen view closed (spec §7.1) ...
		expect(isOpen(sheet)).toBe(true); // ... and the sheet it opened is still open
		const open = (sheet.contentEl as unknown as FEl).querySelector('.dynasty-sheet-open-link')!;
		dispatch(open, 'click', { button: 0 });
		await settle();
		flushFrames();
		runTimers();
		expect(isOpen(sheet)).toBe(false); // the sheet closed on the press
		expect(app.workspace.openLinkText).toHaveBeenCalledTimes(1); // ... and the note must open
		expect(app.workspace.openLinkText.mock.calls[0][0]).toBe('Aldous Vane');
	});
});

describe('Plugin unload: no edit sheet of the plugin stays open (spec §8)', () => {
	// Once the plugin is off, nothing of it may stay on screen or write to a note; an open sheet
	// could still write on Save.
	it('after the plugin unloads, no edit sheet opened from the full-screen view stays open', async () => {
		desktop();
		const { plugin, host } = await loadPlugin();
		const { modal, root } = await openFullScreen(LINKED, { host });
		await openSheetOn(root, 'a', 'mouse');
		plugin.unload();
		await settle();
		flushFrames();
		runTimers();
		expect(isOpen(modal)).toBe(false);
		expect(sheets()).toHaveLength(0);
	});

	it.each(['mouse', 'touch'] as const)('after the plugin unloads, no edit sheet opened from an embedded tree (%s) stays open', async (type) => {
		if (type === 'touch') tabletDevice();
		else desktop();
		const { plugin, host } = await loadPlugin();
		const { el } = await embed(LINKED, { host, handle: fakeHandle('n.md', LINKED) });
		await openSheetOn(el, 'a', type);
		plugin.unload();
		await settle();
		flushFrames();
		runTimers();
		expect(sheets()).toHaveLength(0);
	});
});

describe('Static touch embed: the focus after a tap never moves the embed (D1, spec §7.2)', () => {
	/**
	 * Taps each far-couple tag of a static touch embed. The tap opens the full-screen view centred
	 * on the partner (D17); Close there `later` ms after the tap gives the focus back to the tag.
	 * Returns the embed's transform before, and after each focus.
	 */
	async function tagTapThenFocus(later: number) {
		tabletDevice();
		const { el } = await embed(FAR);
		expect(el.querySelector('.dynasty-root')?.hasClass('dynasty-static')).toBe(true);
		const tags = el.querySelectorAll('.dynasty-tag');
		expect(tags.length).toBeGreaterThan(0);
		const start = shown(el);
		const seen: (string | null)[] = [];
		for (const tag of tags) {
			dispatch(tag, 'pointerdown', pointer('touch', 1, 20, 20));
			dispatch(tag, 'pointerup', pointer('touch', 1, 20, 20));
			dispatch(tag, 'click', { button: 0, clientX: 20, clientY: 20 });
			await settle();
			const full = openModals.find((m) => (m as unknown) instanceof FullScreenModal);
			expect(full).toBeDefined();
			clock.now += later;
			dispatch((full!.containerEl as unknown as FEl).querySelector('.dynasty-close')!, 'click');
			expect(isOpen(full)).toBe(false);
			dispatch(tag, 'focus', { bubbles: false });
			flushFrames();
			seen.push(shown(el));
		}
		return { start, seen };
	}

	/** The same with each card: the tap opens the edit sheet, and Cancel `later` ms after the tap gives the focus back. */
	async function cardTapThenFocus(later: number) {
		tabletDevice();
		const { el } = await embed(FAR, { handle: fakeHandle('n.md', FAR) });
		expect(el.querySelector('.dynasty-root')?.hasClass('dynasty-static')).toBe(true);
		const start = shown(el);
		const seen: (string | null)[] = [];
		for (const card of el.querySelectorAll('.dynasty-card')) {
			dispatch(card, 'pointerdown', pointer('touch', 1, 20, 20));
			dispatch(card, 'pointerup', pointer('touch', 1, 20, 20));
			await settle();
			expect(sheets()).toHaveLength(1);
			const sheet = sheets()[0];
			clock.now += later;
			dispatch((sheet.contentEl as unknown as FEl).querySelector('.dynasty-sheet-cancel')!, 'click');
			expect(isOpen(sheet)).toBe(false);
			dispatch(card, 'focus', { bubbles: false });
			flushFrames();
			seen.push(shown(el));
		}
		return { start, seen };
	}

	it('control: the focus back on a tag 0.4 s after the tap does not move the embed', async () => {
		const { start, seen } = await tagTapThenFocus(400);
		expect(seen).toEqual(seen.map(() => start));
	});

	it('the focus back on a tag 3 s after the tap (Close after 3 s in the full-screen view, D17) does not move the embed', async () => {
		const { start, seen } = await tagTapThenFocus(3000);
		expect(seen).toEqual(seen.map(() => start));
	});

	it('control: the focus back on a card 0.4 s after the tap does not move the embed', async () => {
		const { start, seen } = await cardTapThenFocus(400);
		expect(seen).toEqual(seen.map(() => start));
	});

	it('the focus back on a card 3 s after the tap (Cancel after 3 s in the edit sheet) does not move the embed', async () => {
		const { start, seen } = await cardTapThenFocus(3000);
		expect(seen).toEqual(seen.map(() => start));
	});
});
