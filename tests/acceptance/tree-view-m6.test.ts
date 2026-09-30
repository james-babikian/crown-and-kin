import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

// Text widths: the fakes have no canvas, so measure.ts uses 0.6 em per character; `wide` scales that,
// as a web font that finished loading would.
const text = vi.hoisted(() => ({ wide: 1 }));
vi.mock('../../src/render/dom/measure', async (load) => {
	const real = await load<typeof import('../../src/render/dom/measure')>();
	return { ...real, measureText: (t: string, font: string) => real.measureText(t, font) * text.wide };
});

import { geometryFor, tallExtra } from '../../src/layout/geometry';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { TreeView } from '../../src/obsidian/tree-view';
import { HINT_UI } from '../../src/render/ui-text';
import { FEl, clock, device, dispatch, flushFrames, installDom, pointer, resetDom, resizeAll, runTimers, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { FAR, embed, fakeHandle, fakeHost, fullViews, type Host } from './tree-view-fakes';

/*
 * WP6.4 on the fakes: the D28 hint, D29 name measure and tall cards in the note preview, the D31 tag
 * tap area in `down`, and the note preview's `fitNarrow` with a box that has no height yet.
 */

const DOWN = geometryFor(16, 'normal');
const TALL_H = DOWN.cardH + tallExtra(DOWN);

beforeAll(() => installDom());

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	embeds.length = 0;
	text.wide = 1;
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------- devices and boxes (as in an internal test) ----------

function phonePortrait(): void {
	device.coarse = true;
	device.width = 390;
	device.height = 844;
}

interface Box {
	w: number;
	h: number;
	bar: { top: number; height: number; left: number; width: number };
}

/** The note preview's box on a 390 px phone (342 × 60vh), with the static toolbar at the top right. */
function previewBox(w = device.width - 48): Box {
	return { w, h: Math.round(0.6 * device.height), bar: { top: 6, height: 44, left: w - 6 - 96, width: 96 } };
}

/** The full-screen view on a phone: the toolbar is at the bottom (spec §7.5). */
function fullBox(): Box {
	return { w: device.width, h: device.height, bar: { top: device.height - 64, height: 64, left: 0, width: device.width } };
}

const embeds: { el: FEl; box: () => Box }[] = [];

function sizeRoot(root: FEl, box: Box): void {
	for (const vp of root.querySelectorAll('.dynasty-viewport')) {
		vp.clientWidth = box.w;
		vp.clientHeight = box.h;
		const tb = vp.querySelector('.dynasty-toolbar');
		if (tb) Object.assign(tb, { offsetTop: box.bar.top, offsetHeight: box.bar.height, offsetLeft: box.bar.left, offsetWidth: box.bar.width });
	}
}

function layoutAll(): void {
	for (let i = 0; i < 3; i++) {
		for (const e of embeds) sizeRoot(e.el, e.box());
		for (const m of fullViews()) sizeRoot(m.containerEl as unknown as FEl, fullBox());
		resizeAll();
		flushFrames();
	}
}

function registry(host: Host, handle: ReturnType<typeof fakeHandle>): void {
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => handle, resolve: async () => handle, resolveByBody: () => handle, inEditorOf: () => false });
}

async function preview(source: string, box: () => Box = () => previewBox()) {
	const host = fakeHost();
	const handle = fakeHandle('n.md', source);
	registry(host, handle);
	const el = new FEl('div');
	const info = { lineStart: 0, lineEnd: source.split('\n').length + 1, text: '' };
	const ctx = { sourcePath: 'n.md', getSectionInfo: () => info, addChild: () => {} };
	const view = new TreeView(host as never, el as unknown as HTMLElement, source, { kind: 'embed', ctx } as never);
	view.load();
	await settle();
	embeds.push({ el, box });
	layoutAll();
	return { el, view, host };
}

async function full(source: string) {
	const host = fakeHost();
	const handle = fakeHandle('n.md', source);
	const from = { key: 'n.md\u0000#0', sourcePath: 'n.md', source, handle, peeked: null, readOnly: false };
	const modal = new FullScreenModal(host as never, from as never, null, new FEl('div') as unknown as HTMLElement);
	modal.open();
	await settle();
	layoutAll();
	return { root: modal.containerEl as unknown as FEl, modal };
}

// ---------- reading the screen ----------

function screen(root: FEl) {
	const t = root.querySelector('.dynasty-scene')?.getAttribute('transform') ?? '';
	const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(t);
	if (!m) throw new Error(`transform ${t}`);
	const vp = root.querySelector('.dynasty-viewport')!;
	return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]), w: vp.clientWidth, h: vp.clientHeight, t };
}

function card(root: FEl, id: string) {
	const bg = root.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`);
	if (!bg) throw new Error(`no card ${id}`);
	return { x: Number(bg.getAttribute('x')), y: Number(bg.getAttribute('y')), w: Number(bg.getAttribute('width')), h: Number(bg.getAttribute('height')) };
}

const names = (root: FEl, id: string) => root.querySelectorAll(`.dynasty-card[data-person="${id}"] .dynasty-card-name`).map((n) => n.getText());
const hint = (root: FEl, dir: 'up' | 'down') => root.querySelector(`.dynasty-hint-${dir}`);

/** D28 counted from the screen: children whose cards reach above `top` or below `bottom`. */
function outside(root: FEl, ids: string[], top: number, bottom: number) {
	const { ty, s } = screen(root);
	let up = 0;
	let down = 0;
	for (const id of ids) {
		const c = card(root, id);
		const y0 = ty + c.y * s;
		const y1 = y0 + c.h * s;
		if (y0 < top - 0.5) up++;
		else if (y1 > bottom + 0.5) down++;
	}
	return { up, down };
}

// ---------- trees ----------

/** A couple with `n` children, the start person Paul: in the sideways first view the children's column is taller than the box. */
function family(n: number): { source: string; kids: string[] } {
	const kids = Array.from({ length: n }, (_, i) => `k${i + 1}`);
	const source = [
		'options:',
		'  start: paul',
		'people:',
		'  - id: paul',
		'    name: Paul',
		'  - id: quin',
		'    name: Quin',
		'    sex: f',
		...kids.flatMap((k, i) => [`  - id: ${k}`, `    name: Kid ${i + 1}`, '    parents: [paul, quin]']),
		'unions:',
		'  - partners: [paul, quin]',
		'',
	].join('\n');
	return { source, kids };
}

const SMALL = family(2);

const NAMES = [
	'options:',
	'  start: will',
	'people:',
	'  - id: will',
	'    name: Wilhelmina Blackmere-Orsini',
	'  - id: bo',
	'    name: Bo',
	'    parents: [will]',
	// 13 characters: one text line in a 342 px box's cards, two in a 300 px box's.
	'  - id: anna',
	'    name: Anna Blackmer',
	'    parents: [will]',
	'',
].join('\n');

// =============================================================================================

describe('D28: the hint for children outside the first view (upright phone)', () => {
	it('note preview: "↑ n more child(ren)" and "↓ n more child(ren)" match the cards outside the box; a label left of the toolbar, not a button', async () => {
		phonePortrait();
		const { source, kids } = family(14);
		const { el } = await preview(source);
		const { h } = screen(el);
		const want = outside(el, kids, 0, h);
		expect(want.up + want.down).toBeGreaterThan(0);
		for (const dir of ['up', 'down'] as const) {
			const e = hint(el, dir);
			if (!want[dir]) {
				expect(e).toBeNull();
				continue;
			}
			expect(e?.getText()).toBe(HINT_UI[dir](want[dir]));
			expect(e!.hasClass('dynasty-hint')).toBe(true);
			// Not tappable: no button role, not in the Tab order, no listeners.
			expect(e!.tag).toBe('div');
			expect(e!.getAttribute('tabindex')).toBeNull();
			expect(e!.getAttribute('role')).toBeNull();
			expect(e!.listeners.size).toBe(0);
		}
		const up = hint(el, 'up');
		if (up) {
			const box = previewBox();
			expect(parseFloat(up.style.getPropertyValue('--dynasty-hint-right'))).toBeGreaterThanOrEqual(box.w - box.bar.left);
		}
	});

	it('the ↑ hint stays left of the toolbar when the toolbar gets wider later (Add person comes when the handle is known)', async () => {
		phonePortrait();
		const { source } = family(14);
		let barW = 44;
		const box = () => {
			const b = previewBox();
			return { ...b, bar: { ...b.bar, left: b.w - 6 - barW, width: barW } };
		};
		const { el } = await preview(source, box);
		expect(hint(el, 'up')).not.toBeNull();
		const right = () => parseFloat(hint(el, 'up')!.style.getPropertyValue('--dynasty-hint-right'));
		expect(right()).toBe(6 + 44 + 4);
		barW = 96;
		layoutAll();
		expect(right()).toBe(6 + 96 + 4);
	});

	it('the words (STE, ASD-STE100)', () => {
		expect([HINT_UI.up(1), HINT_UI.up(3), HINT_UI.down(1), HINT_UI.down(2)]).toEqual(['↑ 1 more child', '↑ 3 more children', '↓ 1 more child', '↓ 2 more children']);
	});

	it('no hint when every child shows whole', async () => {
		phonePortrait();
		const { el } = await preview(SMALL.source);
		const { h } = screen(el);
		expect(outside(el, SMALL.kids, 0, h)).toEqual({ up: 0, down: 0 });
		expect(el.querySelectorAll('.dynasty-hint')).toHaveLength(0);
	});

	it('full-screen view: the hint shows above the bottom toolbar at the first view and goes when the user moves the tree', async () => {
		phonePortrait();
		const { source, kids } = family(14);
		const { root } = await full(source);
		const { h } = screen(root);
		const want = outside(root, kids, 0, h - 68);
		expect(want.up + want.down).toBeGreaterThan(0);
		if (want.down) {
			expect(hint(root, 'down')?.getText()).toBe(HINT_UI.down(want.down));
			// 64 px toolbar + the 4 px band margin + 4 px.
			expect(hint(root, 'down')!.style.getPropertyValue('--dynasty-hint-bottom')).toBe('72px');
		}
		if (want.up) expect(hint(root, 'up')?.getText()).toBe(HINT_UI.up(want.up));
		const bg = root.querySelector('.dynasty-svg')!;
		dispatch(bg, 'pointerdown', pointer('touch', 1, 100, 400));
		for (let i = 1; i <= 6; i++) dispatch(bg, 'pointermove', pointer('touch', 1, 100, 400 - i * 20));
		dispatch(bg, 'pointerup', pointer('touch', 1, 100, 280));
		flushFrames();
		runTimers();
		expect(root.querySelectorAll('.dynasty-hint')).toHaveLength(0);
	});

	it('no hint in `down` (a phone on its side, a computer)', async () => {
		const { source } = family(14);
		for (const [w, hh, coarse] of [
			[844, 390, true],
			[1280, 800, false],
		] as const) {
			resetDom();
			device.coarse = coarse;
			device.width = w;
			device.height = hh;
			const { el } = await preview(source, () => ({ w: 700, h: 300, bar: { top: 6, height: 44, left: 700 - 6 - 200, width: 200 } }));
			expect(el.querySelector('.dynasty-root')?.getAttribute('data-dynasty-orientation')).toBe('down');
			expect(el.querySelectorAll('.dynasty-hint')).toHaveLength(0);
		}
	});
});

describe('D29: names measured with the real font make only their cards taller (note preview, upright phone)', () => {
	it('a name that does not fit uses two text lines on a taller card; a short name keeps one line and the normal height', async () => {
		phonePortrait();
		const { el } = await preview(NAMES);
		expect(card(el, 'will').h).toBe(DOWN.cardH + 2 * tallExtra(DOWN));
		expect(names(el, 'will')).toEqual(['Wilhelmina', 'Blackmere-Orsi', 'ni']);
		expect(card(el, 'bo').h).toBe(DOWN.cardH);
		expect(names(el, 'bo')).toEqual(['Bo']);
		expect(card(el, 'anna').h).toBe(DOWN.cardH);
		expect(names(el, 'anna')).toEqual(['Anna Blackmer']);
	});

	it('D37: the full-screen view on the phone uses two text lines too, on its normal cards; a short name keeps one line', async () => {
		phonePortrait();
		const { root } = await full(NAMES);
		expect(card(root, 'will').h).toBe(TALL_H);
		expect(names(root, 'will')).toEqual(['Wilhelmina', 'Blackmere-Orsini']);
		for (const id of ['bo', 'anna']) expect(card(root, id).h).toBe(DOWN.cardH);
	});

	it('D37: on the computer (down) a long name uses two text lines; after a web font loads, the tree is laid out again and keeps its centre', async () => {
		const box = (): Box => ({ w: 800, h: 500, bar: { top: 6, height: 44, left: 800 - 6 - 200, width: 200 } });
		const { el, view } = await preview(NAMES, box);
		expect(el.querySelector('.dynasty-root')?.getAttribute('data-dynasty-orientation')).toBe('down');
		expect(card(el, 'will').h).toBe(TALL_H);
		expect(names(el, 'will')).toEqual(['Wilhelmina', 'Blackmere-Orsini']);
		expect(card(el, 'anna').h).toBe(DOWN.cardH);
		expect(names(el, 'anna')).toEqual(['Anna Blackmer']);
		const centreOf = (id: string) => {
			const { tx, ty, s } = screen(el);
			const c = card(el, id);
			return { x: tx + (c.x + c.w / 2) * s, y: ty + (c.y + c.h / 2) * s };
		};
		const near = ['will', 'bo', 'anna'].map((id) => ({ id, d: Math.hypot(centreOf(id).x - 400, centreOf(id).y - 250) })).sort((a, b) => a.d - b.d)[0].id;
		const before = { ...screen(el), at: centreOf(near) };
		text.wide = 1.3;
		view.onFontsLoaded(['sans-serif']);
		flushFrames();
		expect(card(el, 'anna').h).toBe(TALL_H);
		expect(names(el, 'anna')).toEqual(['Anna', 'Blackmer']);
		expect(screen(el).s).toBe(before.s);
		expect(Math.abs(centreOf(near).x - before.at.x)).toBeLessThan(0.5);
		expect(Math.abs(centreOf(near).y - before.at.y)).toBeLessThan(0.5);
	});

	it('after fitNarrow (a narrower box) the names are measured again: a name that fitted now takes two text lines, and the preview shows its first view', async () => {
		phonePortrait();
		let w = 342;
		const { el } = await preview(NAMES, () => previewBox(w));
		expect(card(el, 'anna').h).toBe(DOWN.cardH);
		const narrowW = card(el, 'anna').w;
		w = 300;
		layoutAll();
		expect(card(el, 'anna').w).toBeLessThan(narrowW);
		expect(card(el, 'anna').h).toBe(TALL_H);
		expect(names(el, 'anna')).toEqual(['Anna', 'Blackmer']);
		// The same as a preview that opened in the 300 px box.
		const fresh = await preview(NAMES, () => previewBox(300));
		expect(screen(el).t).toBe(screen(fresh.el).t);
	});

	it('when a web font loads (wider text), the cards are measured again and the preview shows its first view of the new layout', async () => {
		phonePortrait();
		const { el, view } = await preview(NAMES);
		expect(card(el, 'anna').h).toBe(DOWN.cardH);
		text.wide = 1.2;
		view.onFontsLoaded(['sans-serif']);
		flushFrames();
		expect(card(el, 'anna').h).toBe(TALL_H);
		expect(names(el, 'anna')).toEqual(['Anna', 'Blackmer']);
		const fresh = await preview(NAMES);
		expect(screen(el).t).toBe(screen(fresh.el).t);
	});

	it('on css-change with the same fonts, a changed measure is picked up too; with no change nothing is drawn again', async () => {
		phonePortrait();
		const { el, view } = await preview(NAMES);
		const scene = el.querySelector('.dynasty-scene');
		view.onCssChange();
		expect(el.querySelector('.dynasty-scene')?.children[0]).toBe(scene?.children[0]);
		text.wide = 1.2;
		view.onCssChange();
		flushFrames();
		expect(card(el, 'anna').h).toBe(TALL_H);
	});
});

describe('fitNarrow with a box that has a width but no height yet (the decision notes WP5.5b open note)', () => {
	it('the next resize with a height shows the first view of the new layout', async () => {
		phonePortrait();
		let box: Box = previewBox(342);
		const { el } = await preview(NAMES, () => box);
		box = { ...previewBox(300), h: 0 };
		layoutAll();
		// No height: nothing to show yet. Then the height: a view that kept its centre from the 342 px box
		// would sit 21 px further left than the first view (8 px from the left edge).
		box = previewBox(300);
		layoutAll();
		const fresh = await preview(NAMES, () => previewBox(300));
		expect(screen(el).t).toBe(screen(fresh.el).t);
		expect(screen(el).tx).toBe(8);
	});
});

describe('D31: in `down` a far-couple tag\'s tap area hangs below its card, 44 px high', () => {
	const hits = (root: FEl) => {
		const { s } = screen(root);
		return root.querySelectorAll('.dynasty-tag-hit').map((r) => {
			const person = r.getAttribute('data-person')!;
			const c = card(root, person);
			return { person, top: Number(r.getAttribute('y')), cardBottom: c.y + c.h, h: Number(r.getAttribute('height')) * s, w: Number(r.getAttribute('width')) * s };
		});
	};

	it('on the computer at the first view and after Fit: top at the card\'s bottom edge, at least 44 × 44 screen px', async () => {
		device.coarse = false;
		const { el } = await embed(FAR, { handle: fakeHandle('n.md', FAR) });
		for (const step of ['first', 'fit']) {
			if (step === 'fit') {
				dispatch(el.querySelector('.dynasty-fit')!, 'click', {});
				flushFrames();
			}
			const list = hits(el);
			expect(list.length).toBeGreaterThan(0);
			for (const x of list) {
				expect({ step, person: x.person, top: x.top }).toEqual({ step, person: x.person, top: x.cardBottom });
				expect(x.h).toBeGreaterThanOrEqual(44 - 1e-6);
				expect(x.w).toBeGreaterThanOrEqual(44 - 1e-6);
			}
		}
	});

	it('the card still wins: the tap areas lie below the cards in paint order', async () => {
		device.coarse = false;
		const { el } = await embed(FAR, { handle: fakeHandle('n.md', FAR) });
		const scene = el.querySelector('.dynasty-scene')!;
		const order = (cls: string) => scene.children.findIndex((c) => c.hasClass(cls));
		expect(order('dynasty-tag-hits')).toBeLessThan(order('dynasty-cards'));
	});
});
