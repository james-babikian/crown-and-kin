import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../../src/obsidian/full-screen';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { clearRelationCache } from '../../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/obsidian/settings';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { FEl, clock, device, flushFrames, installDom, resetDom, runFrame, runTimers, settle, dispatch } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, openFullScreen, phone, shown as sceneOf } from './tree-view-fakes';

/*
 * 0.2.4, the view of the phone preview (WP phone-A): "Reduce movement" (D126 1, contract 3.3) in the tree view, on the fake DOM. The pictures of
 * the settings tab are in windows-settings.test.ts. 0.2.5 (D144): the card style (D119) and the height button (D120) of the phone preview are gone
 * with the preview; a tree in a note on a phone is a list (tests/s025-phone-list-view.test.ts).
 */

beforeAll(() => installDom());
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

/** Two people of one house, with arms and portraits; Ann is the marked person when `me` is on. Made-up names. */
const tree = (me: boolean) =>
	[
		...(me ? ['options:', '  me: ann'] : []),
		'houses:',
		'  - id: va',
		'    name: House Valmont',
		'    color: "#8b1e3f"',
		'    arms: "[[va-arms.png]]"',
		'people:',
		'  - {id: ann, name: Ann Valmont, house: va, born: 1100, portrait: "[[ann.png]]"}',
		'  - {id: bo, name: Bo Valmont, house: va, born: 1130, parents: [ann], portrait: "[[bo.png]]"}',
		'',
	].join('\n');

/**
 * What the screen shows: the scene transform and the wrapper transform.
 */
const shown = (root: FEl) => `${sceneOf(root)}|${root.querySelector('.dynasty-canvas')?.style.getPropertyValue('--dynasty-gesture-transform') ?? ''}`;

describe('D126 (1), D235: reduced movement in the tree view (the still outline of the highlight; no view change slides)', () => {
	const settingOf = (reduceMotion: DynastySettings['reduceMotion']): DynastySettings => ({ ...DEFAULT_SETTINGS, reduceMotion });

	/**
	 * The full-screen view of the tree, panned away; then `fit()`. Returns the view of the pan and zoom at once, what the scene shows after
	 * one frame, and what it shows when the frames have ended.
	 */
	async function fitFrom(reduceMotion: DynastySettings['reduceMotion']) {
		phone();
		const host = fakeHost(settingOf(reduceMotion));
		const { root, views } = await openFullScreen(tree(false), { host });
		const view = [...views][0] as unknown as { panZoom: { view: { scale: number; cx: number; cy: number }; setView(v: object): void }; fit(): void };
		const first = view.panZoom.view;
		view.panZoom.setView({ scale: first.scale * 3, cx: first.cx + 40, cy: first.cy });
		flushFrames();
		const away = shown(root);
		const awayView = view.panZoom.view;
		view.fit();
		const now = view.panZoom.view;
		runFrame();
		const oneFrame = shown(root);
		flushFrames();
		return { away, awayView, now, oneFrame, end: shown(root) };
	}

	it('On: Fit sets its view at once; the next frame draws it, and nothing moves after it', async () => {
		const r = await fitFrom('on');
		expect(r.now).not.toEqual(r.awayView);
		expect(r.oneFrame).not.toBe(r.away);
		expect(r.end).toBe(r.oneFrame);
	});

	it('Off, and Follow the device: Fit also sets its view at once (D235, no slide), whatever the setting or the device says', async () => {
		const on = await fitFrom('on');
		for (const [setting, prefers] of [['off', false], ['system', true], ['system', false]] as const) {
			resetDom();
			device.reduceMotion = prefers;
			const r = await fitFrom(setting);
			expect(r.now, setting).not.toEqual(r.awayView);
			expect(r.oneFrame, setting).toBe(r.end);
			expect(r.end, setting).toBe(on.end);
		}
	});

	/** A highlight on the card of `ann`, from the tree view. */
	async function lit(reduceMotion: DynastySettings['reduceMotion'], prefers = false) {
		desktop();
		device.reduceMotion = prefers;
		const src = tree(false);
		const { el, view } = await embed(src, { host: fakeHost(settingOf(reduceMotion)), handle: fakeHandle('n.md', src) });
		(view as unknown as { highlight(ids: string[]): void }).highlight(['ann']);
		return { el, view, root: el.querySelector('.dynasty-root')!, card: el.querySelector('.dynasty-card[data-person="ann"]')! };
	}

	it('On: the tree root has the class that stops the pulse; Off: it has not; Follow the device: it follows the device', async () => {
		expect((await lit('on')).root.hasClass('dynasty-reduce-motion')).toBe(true);
		resetDom();
		expect((await lit('off', true)).root.hasClass('dynasty-reduce-motion')).toBe(false);
		resetDom();
		expect((await lit('system', true)).root.hasClass('dynasty-reduce-motion')).toBe(true);
		resetDom();
		expect((await lit('system', false)).root.hasClass('dynasty-reduce-motion')).toBe(false);
	});

	it('the class goes when the setting goes, at the next highlight; the highlight itself still shows', async () => {
		const r = await lit('on');
		expect(r.card.hasClass('dynasty-highlight')).toBe(true);
		expect(r.root.hasClass('dynasty-reduce-motion')).toBe(true);
		const host = (r.view as unknown as { host: { settings: DynastySettings } }).host;
		host.settings = settingOf('off');
		(r.view as unknown as { highlight(ids: string[]): void }).highlight(['ann']);
		expect(r.root.hasClass('dynasty-reduce-motion')).toBe(false);
	});

	it('the Houses window gets the function that tells whether movement is reduced', async () => {
		desktop();
		let reduced: (() => boolean) | undefined;
		vi.spyOn(HousesWindow, 'create').mockImplementation((_app, o) => {
			reduced = (o as { reduced?: () => boolean }).reduced;
			return null;
		});
		const src = tree(false);
		const host = fakeHost(settingOf('on'));
		const { el } = await embed(src, { host, handle: Object.assign(fakeHandle('n.md', src), { write: vi.fn(async () => ({ ok: true })) }) });
		const houses = el.querySelector('.dynasty-houses-button')!;
		dispatch(houses, 'click');
		await settle();
		expect(reduced).toBeTypeOf('function');
		expect(reduced!()).toBe(true);
		host.settings = settingOf('off');
		expect(reduced!()).toBe(false);
		runTimers();
		runFrame();
	});
});

describe('M7: the highlight does not read the layout', () => {
	it('lighting a card, and the same card again, calls getBoundingClientRect on no card', async () => {
		desktop();
		const src = tree(false);
		const { el, view } = await embed(src, { host: fakeHost(DEFAULT_SETTINGS), handle: fakeHandle('n.md', src) });
		const reads: string[] = [];
		const real = FEl.prototype.getBoundingClientRect;
		vi.spyOn(FEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FEl) {
			reads.push([...this.classes].join(' '));
			return real.call(this);
		});
		const light = () => (view as unknown as { highlight(ids: string[]): void }).highlight(['ann']);
		light();
		const card = el.querySelector('.dynasty-card[data-person="ann"]')!;
		expect(card.hasClass('dynasty-highlight')).toBe(true);
		// The same card again: the pulse starts again, in the next frame.
		light();
		expect(card.hasClass('dynasty-highlight')).toBe(false);
		runFrame();
		expect(card.hasClass('dynasty-highlight')).toBe(true);
		expect(reads.filter((c) => c.includes('dynasty-card'))).toEqual([]);
		// It ends after two seconds, as it did.
		runTimers(2100);
		expect(card.hasClass('dynasty-highlight')).toBe(false);
	});
});
