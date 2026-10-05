import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { namesOnlyCardH } from '../../src/layout/geometry';
import { carryState, endSessionFocus, newBlockState } from '../../src/obsidian/block-state';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { HousesWindow } from '../../src/obsidian/houses-window';
import { clearRelationCache } from '../../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/obsidian/settings';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { HEIGHT_UI } from '../../src/render/ui-text';
import { FEl, clock, device, flushFrames, installDom, resetDom, resizeAll, runFrame, runTimers, settle, dispatch } from './fake-dom';
import { iconCalls, knownIcons, resetObsidian } from './fake-obsidian';
import { wholeCardSettings } from './phone-style';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, loadPlugin, openFullScreen, phone, phoneOnSide, shown } from './tree-view-fakes';

/*
 * 0.2.4, the view of the phone preview (WP phone-A): the card style (D119), the height button (D120, contract 3.2) and "Reduce movement"
 * (D126 1, contract 3.3) in the tree view, on the fake DOM. The pictures of the settings tab are in windows-settings.test.ts.
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

const style = (phoneCardStyle: DynastySettings['phoneCardStyle'], more: Partial<DynastySettings> = {}): DynastySettings => ({ ...DEFAULT_SETTINGS, phoneCardStyle, ...more });
const bgHeight = (el: FEl, id: string) => Number(el.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`)!.getAttribute('height'));
const count = (el: FEl, sel: string) => el.querySelectorAll(sel).length;
const words = (el: FEl) => el.querySelectorAll('.dynasty-card-relation').map((n) => n.getText());

async function preview(src: string, settings: DynastySettings) {
	const host = fakeHost(settings);
	const r = await embed(src, { host, handle: fakeHandle('n.md', src) });
	fillAllCards(r.el);
	return r;
}

describe('D119: the card style of the phone preview', () => {
	it('names only with the arms (the default): 51 px cards, the arms and no portrait, no relation word but "You"', async () => {
		phoneOnSide();
		const { el } = await preview(tree(true), DEFAULT_SETTINGS);
		expect(bgHeight(el, 'ann')).toBe(namesOnlyCardH(16));
		expect(bgHeight(el, 'bo')).toBe(51);
		expect(count(el, '.dynasty-card-full .dynasty-arms')).toBe(2);
		expect(count(el, '.dynasty-portrait')).toBe(0);
		expect(words(el)).toEqual(['You']);
	});

	it('names only with the portrait: the portrait and no arms', async () => {
		phoneOnSide();
		const { el } = await preview(tree(true), style('names-portrait'));
		expect(bgHeight(el, 'bo')).toBe(51);
		expect(count(el, '.dynasty-card-full .dynasty-arms')).toBe(0);
		expect(count(el, '.dynasty-portrait')).toBe(2);
		expect(words(el)).toEqual(['You']);
	});

	it('names only with the portrait and "Show portraits on cards" off: no picture at all', async () => {
		phoneOnSide();
		const { el } = await preview(tree(false), style('names-portrait', { showPortraits: false }));
		expect(count(el, '.dynasty-card-full .dynasty-arms')).toBe(0);
		expect(count(el, '.dynasty-portrait')).toBe(0);
	});

	it('whole card: the arms and the portrait, the relation line (77 px) and the relation words', async () => {
		phoneOnSide();
		const { el } = await preview(tree(true), wholeCardSettings());
		expect(bgHeight(el, 'bo')).toBe(77);
		expect(count(el, '.dynasty-card-full .dynasty-arms')).toBe(2);
		expect(count(el, '.dynasty-portrait')).toBe(2);
		expect(words(el).sort()).toEqual(['Child', 'You']);
	});

	it('a tree with no mark: 51 px names only, 61 px whole', async () => {
		phoneOnSide();
		expect(bgHeight((await preview(tree(false), DEFAULT_SETTINGS)).el, 'bo')).toBe(51);
		resetDom();
		phoneOnSide();
		expect(bgHeight((await preview(tree(false), wholeCardSettings())).el, 'bo')).toBe(61);
	});

	it('the upright phone (sideways layout) draws the style too', async () => {
		phone();
		const { el } = await preview(tree(true), DEFAULT_SETTINGS);
		expect(count(el, '.dynasty-card-full .dynasty-arms')).toBe(2);
		expect(count(el, '.dynasty-portrait')).toBe(0);
		expect(words(el)).toEqual(['You']);
	});

	it('the computer draws whole cards whatever the style says', async () => {
		desktop();
		const { el } = await preview(tree(true), style('names-shield'));
		expect(bgHeight(el, 'bo')).toBe(77);
		expect(count(el, '.dynasty-portrait')).toBe(2);
		expect(words(el).sort()).toEqual(['Child', 'You']);
	});

	it('the full-screen view on a phone draws whole cards, with the relation words, whatever the style says', async () => {
		phone();
		const host = fakeHost(DEFAULT_SETTINGS);
		const { root } = await openFullScreen(tree(true), { host });
		fillAllCards(root);
		expect(bgHeight(root, 'bo')).toBe(77);
		expect(count(root, '.dynasty-portrait')).toBe(2);
		expect(words(root).sort()).toEqual(['Child', 'You']);
	});

	it('the relations are not computed for a names-only card pass, and the saved picture computes them on demand', async () => {
		phoneOnSide();
		const { view } = await preview(tree(true), DEFAULT_SETTINGS);
		const peek = view as unknown as { lastLayout: { opts: { relations?: unknown }; geo: { namesOnly?: true } }; saveSource(): { relations?: ReadonlyMap<string, { text: string }>; geo: { namesOnly?: true }; relationLine: boolean } | null };
		expect(peek.lastLayout.geo.namesOnly).toBe(true);
		expect(peek.lastLayout.opts.relations).toBeUndefined();
		const src = peek.saveSource()!;
		expect(src.geo.namesOnly).toBeUndefined();
		expect(src.relationLine).toBe(true);
		expect(src.relations?.get('bo')?.text).toBe('Child');
	});

	it('the card style changes at once when the setting changes; the computer and the full-screen view stay as they are', async () => {
		phoneOnSide();
		const { plugin, host } = await loadPlugin();
		const src = tree(true);
		const note = await embed(src, { host, handle: fakeHandle('n.md', src) });
		fillAllCards(note.el);
		const full = await openFullScreen(src, { host });
		const fullRoot = full.root.querySelector('.dynasty-root')!;
		const root = note.el.querySelector('.dynasty-root')!;
		expect(bgHeight(note.el, 'bo')).toBe(51);
		await plugin.changeSettings({ phoneCardStyle: 'whole' });
		await settle();
		resizeAll();
		flushFrames();
		expect(note.el.querySelector('.dynasty-root')).not.toBe(root);
		expect(bgHeight(note.el, 'bo')).toBe(77);
		expect(full.root.querySelector('.dynasty-root')).toBe(fullRoot);
		await plugin.changeSettings({ phoneCardStyle: 'names-portrait' });
		await settle();
		resizeAll();
		flushFrames();
		expect(bgHeight(note.el, 'bo')).toBe(51);
		fillAllCards(note.el);
		expect(count(note.el, '.dynasty-card-full .dynasty-arms')).toBe(0);
		expect(count(note.el, '.dynasty-portrait')).toBe(2);
	});

	it('a change of the style on the computer draws nothing again; a change of the break list does', async () => {
		desktop();
		const { plugin, host } = await loadPlugin();
		const src = tree(false);
		const note = await embed(src, { host, handle: fakeHandle('n.md', src) });
		const root = note.el.querySelector('.dynasty-root')!;
		await plugin.changeSettings({ phoneCardStyle: 'whole' });
		await settle();
		expect(note.el.querySelector('.dynasty-root')).toBe(root);
		await plugin.changeSettings({ breakWords: 'Va-l-mont' });
		await settle();
		expect(note.el.querySelector('.dynasty-root')).not.toBe(root);
	});

	it('a change of "Reduce movement" draws nothing again', async () => {
		phoneOnSide();
		const { plugin, host } = await loadPlugin();
		const src = tree(false);
		const note = await embed(src, { host, handle: fakeHandle('n.md', src) });
		const root = note.el.querySelector('.dynasty-root')!;
		await plugin.changeSettings({ reduceMotion: 'on' });
		await plugin.changeSettings({ reduceMotion: 'off' });
		await settle();
		expect(note.el.querySelector('.dynasty-root')).toBe(root);
	});

	it('the layout keeps the same people and the same order in the three styles (the style changes the cards, not the tree)', async () => {
		phoneOnSide();
		const out: string[][] = [];
		for (const s of ['names-shield', 'names-portrait', 'whole'] as const) {
			resetDom();
			phoneOnSide();
			const { el } = await preview(tree(false), style(s));
			out.push(el.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!));
		}
		expect(out[1]).toEqual(out[0]);
		expect(out[2]).toEqual(out[0]);
	});
});

describe('D120: the height button', () => {
	const button = (el: FEl) => el.querySelector('.dynasty-height');
	const height = (vp: FEl) => vp.styleProps.get('--dynasty-height');
	const tap = (vp: FEl) => dispatch(vp.querySelector('.dynasty-height')!, 'click');

	it('is in the toolbar of the preview on a phone, left of Expand, with its name; not on the computer, a tablet or the full-screen view', async () => {
		phoneOnSide();
		const src = tree(false);
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		const b = button(el)!;
		expect(b.tag).toBe('button');
		expect(b.getAttribute('aria-label')).toBe(HEIGHT_UI.button);
		const bar = el.querySelector('.dynasty-toolbar')!;
		const names = bar.children.map((c) => c.classes);
		const at = (cls: string) => names.findIndex((c) => c.has(cls));
		expect(at('dynasty-height')).toBe(at('dynasty-expand') - 1);
		resetDom();
		desktop();
		expect(button((await embed(src, { handle: fakeHandle('n.md', src) })).el)).toBeNull();
		resetDom();
		device.coarse = true;
		device.width = 1180;
		device.height = 820;
		expect(button((await embed(src, { handle: fakeHandle('n.md', src) })).el)).toBeNull();
		resetDom();
		phone();
		expect(button((await openFullScreen(src)).root)).toBeNull();
	});

	it('the icon is chevrons-up-down; an Obsidian that does not have it gets move-vertical', async () => {
		phoneOnSide();
		const src = tree(false);
		knownIcons.add('chevrons-up-down');
		await embed(src, { handle: fakeHandle('n.md', src) });
		expect(iconCalls).toContain('chevrons-up-down');
		expect(iconCalls).not.toContain('move-vertical');
		resetObsidian();
		resetDom();
		phoneOnSide();
		await embed(src, { handle: fakeHandle('n.md', src) });
		expect(iconCalls).toContain('chevrons-up-down');
		expect(iconCalls).toContain('move-vertical');
	});

	it('a read-only preview on a phone has it too (the height does not write anything)', async () => {
		phoneOnSide();
		expect(button((await embed(tree(false))).el)).not.toBeNull();
	});

	it('the taps go lower, start, upper, lower: 40, 60 and 80 per cent at the default', async () => {
		phoneOnSide();
		const src = tree(false);
		const { vp } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(height(vp)).toBe('60vh');
		for (const want of ['80vh', '40vh', '60vh', '80vh']) {
			tap(vp);
			expect(height(vp)).toBe(want);
		}
	});

	it('the steps follow the start height and keep within 30 and 90', async () => {
		for (const [start, want] of [
			[40, ['60vh', '30vh', '40vh']],
			[80, ['90vh', '60vh', '80vh']],
			[70, ['90vh', '50vh', '70vh']],
		] as const) {
			resetDom();
			phoneOnSide();
			const src = tree(false);
			const { vp } = await embed(src, { host: fakeHost({ ...DEFAULT_SETTINGS, embedHeightPhone: start }), handle: fakeHandle('n.md', src) });
			expect(height(vp)).toBe(`${start}vh`);
			for (const h of want) {
				tap(vp);
				expect(height(vp)).toBe(h);
			}
		}
	});

	it('the step lives on the block state; a note that was not touched has none; the note closing clears it', () => {
		const st = newBlockState();
		expect(st.heightStep).toBeUndefined();
		st.heightStep = 2;
		endSessionFocus(st);
		expect(st.heightStep).toBeUndefined();
	});

	it('carryState takes the step of the old handle only when the new state has none', () => {
		const from = newBlockState();
		from.heightStep = 0;
		const fresh = newBlockState();
		carryState(from, fresh);
		expect(fresh.heightStep).toBe(0);
		const chosen = newBlockState();
		chosen.heightStep = 1;
		carryState(from, chosen);
		expect(chosen.heightStep).toBe(1);
		const other = newBlockState();
		other.heightStep = 2;
		carryState(from, other);
		expect(other.heightStep).toBe(2);
	});

	it('another preview of the same block takes the new height too; a new preview starts at the step', async () => {
		phoneOnSide();
		const src = tree(false);
		const handle = fakeHandle('n.md', src);
		const host = fakeHost(DEFAULT_SETTINGS);
		const a = await embed(src, { host, handle });
		const b = await embed(src, { host, handle });
		tap(a.vp);
		expect(height(a.vp)).toBe('80vh');
		expect(height(b.vp)).toBe('80vh');
		const c = await embed(src, { host, handle });
		expect(height(c.vp)).toBe('80vh');
	});

	it('the settings tab changes the start height; the step stays', async () => {
		phoneOnSide();
		const { plugin, host } = await loadPlugin();
		const src = tree(false);
		const { vp } = await embed(src, { host, handle: fakeHandle('n.md', src) });
		tap(vp);
		expect(height(vp)).toBe('80vh');
		await plugin.changeSettings({ embedHeightPhone: 50 });
		expect(height(vp)).toBe('70vh');
	});

	it('the view keeps its centre when the box changes height', async () => {
		phoneOnSide();
		const src = tree(false);
		const { el, vp } = await embed(src, { handle: fakeHandle('n.md', src) });
		const centre = () => {
			const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(shown(el)!)!;
			const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
			return { x: (vp.clientWidth / 2 - tx) / s, y: (vp.clientHeight / 2 - ty) / s, s };
		};
		const before = centre();
		tap(vp);
		// The box is now higher (the real layout does this from `--dynasty-height`).
		vp.clientHeight = Math.round((vp.clientHeight * 80) / 60);
		resizeAll();
		flushFrames();
		const after = centre();
		expect(Math.abs(after.x - before.x) * after.s).toBeLessThanOrEqual(2);
		expect(Math.abs(after.y - before.y) * after.s).toBeLessThanOrEqual(2);
		tap(vp);
		vp.clientHeight = Math.round((vp.clientHeight * 40) / 80);
		resizeAll();
		flushFrames();
		const low = centre();
		expect(Math.abs(low.x - before.x) * low.s).toBeLessThanOrEqual(2);
		expect(Math.abs(low.y - before.y) * low.s).toBeLessThanOrEqual(2);
	});

	it('the toolbar is five buttons wide: the first view keeps every card clear of it', async () => {
		phoneOnSide();
		const src = tree(true);
		const { el, vp, view } = await embed(src, { handle: fakeHandle('n.md', src) });
		const bar = vp.querySelector('.dynasty-toolbar')!;
		// The fake DOM does not measure: five buttons of 44 px at the right edge of the 360 px box, as the browser would report them.
		Object.assign(bar, { offsetLeft: vp.clientWidth - 4 - 220, offsetWidth: 220, offsetHeight: 44, offsetTop: 4 });
		resizeAll();
		flushFrames();
		const box = (view as unknown as { barBox: { left: number; right: number; top: number; bottom: number } | null }).barBox!;
		expect(box.right - box.left).toBe(220);
		const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(shown(el)!)!;
		const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
		for (const bg of el.querySelectorAll('.dynasty-card-bg')) {
			const x = tx + Number(bg.getAttribute('x')) * s;
			const y = ty + Number(bg.getAttribute('y')) * s;
			const w = Number(bg.getAttribute('width')) * s;
			const h = Number(bg.getAttribute('height')) * s;
			const overlaps = x < box.right && x + w > box.left && y < box.bottom && y + h > 0;
			expect(overlaps, `card at ${x},${y}`).toBe(false);
		}
	});
});

describe('D126 (1): reduced movement in the tree view', () => {
	const settingOf = (reduceMotion: DynastySettings['reduceMotion']) => wholeCardSettings({ reduceMotion });

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

	it('Off: Fit animates, so one frame later the scene is still near the old view and the end is another', async () => {
		const r = await fitFrom('off');
		expect(r.now).toEqual(r.awayView);
		expect(r.end).not.toBe(r.oneFrame);
	});

	it('Follow the device: the phone setting decides, read each time', async () => {
		device.reduceMotion = true;
		const on = await fitFrom('system');
		expect(on.end).toBe(on.oneFrame);
		resetDom();
		device.reduceMotion = false;
		const off = await fitFrom('system');
		expect(off.end).not.toBe(off.oneFrame);
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
