import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { EditSheet, type SheetFolds } from '../src/obsidian/edit-sheet';
import { makePicture } from '../src/obsidian/save-picture';
import type { TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, dispatch, fakeDoc, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { block15, comments15 } from './acceptance/m10-support';
import { desktop, embed, fakeHandle, fullViews, openSheetOn, phone, sheets } from './acceptance/tree-view-fakes';

/*
 * WP 10.3c (M10 rules F7, F10–F12, F14, F15): the tree view's folds beyond the acceptance file
 * `m10-fold-view`: opening a hidden person for Find, Focus and a far-couple tag (only the folds that hide
 * them), the control staying at the same screen point, the tap areas, the unfold after a sheet write,
 * the sheet in the static phone preview, and the saved picture with the view's folds.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
	(globalThis as Record<string, unknown>).CSS = { supports: (_p: string, v: string) => /^#[0-9a-f]{6}$/i.test(v) };
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	desktop();
	// The animation that centres on a person runs on the fake clock.
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	// A full-screen view left open would hold the embeds of later tests back (they draw when it closes).
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	vi.restoreAllMocks();
});

const F = comments15();
const SOURCE = block15(0);
const key = (name: string) => F.folds.get(name)!.key;
const folds = (h: { state: unknown }) => (h.state as { folds: Set<string> }).folds;
const handleWith = (...names: string[]) => {
	const handle = fakeHandle('n.md', SOURCE);
	folds(handle).clear();
	for (const n of names) folds(handle).add(key(n));
	return handle;
};
const cardCount = (el: FEl) => el.querySelectorAll('.dynasty-card').length;
const inner = (view: TreeView) =>
	view as unknown as {
		showFound(id: string): void;
		focusOn(id: string | null): void;
		panZoom: { view: { scale: number; cx: number; cy: number }; size: { w: number; h: number } };
		laid: { layout: { folds?: { key: string; folded: boolean; spot: { x: number; y: number } }[] } };
		scene: { folds: { control: { key: string }; hit: FEl; filled: boolean; fill(): void; mark: { x: number; y: number; w: number; h: number } }[] };
		lod: string | null;
	};
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};
const press = async (c: FEl) => {
	dispatch(c, 'keydown', { key: 'Enter', code: 'Enter' });
	await run();
};
const controlWith = (el: FEl, label: string) => el.querySelectorAll('.dynasty-fold').find((c) => c.getAttribute('aria-label') === label);

describe('F11: a hidden person is shown by opening only the folds that hide them', () => {
	it('Find opens the outer and the nested fold that hide the person, and no other fold', async () => {
		const handle = handleWith('A', 'NEST', 'B');
		const { el, view } = await embed(SOURCE, { handle });
		expect(cardCount(el)).toBeLessThan(96 - 75);
		inner(view).showFound('bertha');
		await run();
		// Bertha is hidden by A and by NEST; B hides other people and stays.
		expect(folds(handle)).toEqual(new Set([key('B')]));
		expect(el.querySelector('.dynasty-card[data-person="bertha"]')).not.toBeNull();
	});

	it('Find centres on the person after the layout', async () => {
		const handle = handleWith('A');
		const { view } = await embed(SOURCE, { handle });
		inner(view).showFound('corwin');
		await run();
		expect(folds(handle).size).toBe(0);
		const box = (view as unknown as { laid: { layout: { persons: Map<string, { x: number; y: number; w: number; h: number }> } } }).laid.layout.persons.get('corwin')!;
		const v = inner(view).panZoom.view;
		expect(Math.abs(v.cx - (box.x + box.w / 2))).toBeLessThan(box.w);
		expect(Math.abs(v.cy - (box.y + box.h / 2))).toBeLessThan(box.h);
	});

	it('Focus on a hidden person opens the folds that hide them; other folds stay', async () => {
		const handle = handleWith('A', 'B');
		const { view } = await embed(SOURCE, { handle });
		inner(view).focusOn('corwin');
		await run();
		expect(folds(handle).has(key('A'))).toBe(false);
		expect(folds(handle).has(key('B'))).toBe(true);
	});

	it('a far-couple tag on a hidden partner opens the fold that hides the partner', async () => {
		const handle = handleWith('A');
		const { el } = await embed(SOURCE, { handle });
		// Wanda is shown; her partner Corwin is below fold A. The tag "⚭ Corwin" is the only one to a hidden partner.
		const hit = el.querySelector('.dynasty-tag-hit[data-person="wanda"]');
		expect(hit).not.toBeNull();
		dispatch(hit!, 'click', { button: 0 });
		await run();
		expect(folds(handle).size).toBe(0);
		expect(el.querySelector('.dynasty-card[data-person="corwin"]')).not.toBeNull();
	});

	it('a person that no fold hides changes no fold', async () => {
		const handle = handleWith('B');
		const { view } = await embed(SOURCE, { handle });
		inner(view).showFound('osric');
		await run();
		expect(folds(handle)).toEqual(new Set([key('B')]));
	});
});

describe('F10: the control stays at the same screen point', () => {
	it('after a tap, the sign is where the button was', async () => {
		const handle = handleWith();
		const { el, view } = await embed(SOURCE, { handle });
		const v = inner(view);
		const before = v.laid.layout.folds!.find((c) => c.key === key('A'))!;
		const screen = (view: { scale: number; cx: number; cy: number }, p: { x: number; y: number }) => ({ x: (p.x - view.cx) * view.scale, y: (p.y - view.cy) * view.scale });
		const a = screen(v.panZoom.view, before.spot);
		await press(controlWith(el, 'Hide the people below Osric Valmont and Mathilde Harrow')!);
		const after = inner(view).laid.layout.folds!.find((c) => c.key === key('A'))!;
		expect(after.folded).toBe(true);
		const b = screen(inner(view).panZoom.view, after.spot);
		expect(b.x).toBeCloseTo(a.x, 6);
		expect(b.y).toBeCloseTo(a.y, 6);
	});

	it('the keyboard focus stays on the control after Enter', async () => {
		const handle = handleWith();
		const { el } = await embed(SOURCE, { handle });
		const c = controlWith(el, 'Hide the people below Osric Valmont and Mathilde Harrow')!;
		c.focus();
		await press(c);
		expect(fakeDoc.activeElement?.getAttribute('data-fold')).toBe(key('A'));
		expect(el.querySelector('.dynasty-fold.is-folded')).not.toBeNull();
	});
});

describe('F10: a view with no size (the other mode of the note) draws when it shows', () => {
	it('a fold changes a hidden view later, at its next size; the visible view draws at once', async () => {
		const handle = handleWith();
		const { el, vp, view } = await embed(SOURCE, { handle });
		vp.clientWidth = 0;
		vp.clientHeight = 0;
		const st = (handle as unknown as { state: object }).state;
		const c = view.constructor as unknown as { changeFolds(host: unknown, st: unknown, next: Set<string>, o: object): void };
		c.changeFolds((view as unknown as { host: unknown }).host, st, new Set([key('A')]), {});
		await run();
		expect(cardCount(el)).toBe(96);
		vp.clientWidth = 360;
		vp.clientHeight = 400;
		resizeAll();
		await run();
		expect(cardCount(el)).toBe(96 - 75);
	});
});

describe('F7: the tap areas', () => {
	it('each tap area is at least 44 screen px each way and centred on its mark', async () => {
		const handle = handleWith('A');
		const { view } = await embed(SOURCE, { handle });
		const v = inner(view);
		const scale = v.panZoom.view.scale;
		expect(v.scene.folds.length).toBeGreaterThan(5);
		let wide = 0;
		// The tree view draws open controls as empty shells and fills them near the view, on focus and in idle time.
		for (const f of v.scene.folds) f.fill();
		(view as unknown as { placeFolds(view: unknown): void }).placeFolds(v.panZoom.view);
		for (const f of v.scene.folds) {
			const w = Number(f.hit.getAttribute('width'));
			const h = Number(f.hit.getAttribute('height'));
			// A hit area can be cut back where it meets a tag or a badge, so only most of them are whole.
			if (w * scale >= 44 - 1e-6 && h * scale >= 44 - 1e-6) wide++;
			expect(w).toBeGreaterThan(0);
			expect(h).toBeGreaterThan(0);
		}
		expect(wide).toBeGreaterThan(v.scene.folds.length / 2);
	});
});

describe('F15: the sheet in the static phone preview (D85)', () => {
	it('has Hide descendants and no Show descendants; it folds in the block state, opens the full-screen view and leaves the preview as it is', async () => {
		phone();
		const handle = handleWith('TWO1');
		const { el } = await embed(SOURCE, { handle });
		expect(cardCount(el)).toBe(96);
		const sheet = await openSheetOn(el, 'corwin', 'touch');
		const buttons = (sheet as unknown as { contentEl: FEl }).contentEl.querySelectorAll('button');
		const named = (t: string) => buttons.find((b) => b.getText().trim() === t);
		expect(named('Show descendants')).toBeUndefined();
		const hide = named('Hide descendants')!;
		expect(hide).toBeDefined();
		dispatch(hide, 'click', { button: 0 });
		await run();
		expect(folds(handle)).toEqual(new Set([key('TWO1'), key('TWO2')]));
		expect(sheets()).toHaveLength(0);
		expect(fullViews()).toHaveLength(1);
		expect(cardCount(el)).toBe(96);
		expect(handle.write).not.toHaveBeenCalled();
	});
});

describe('F12: after an ok write of the sheet', () => {
	function written(): { mock: SheetFolds; calls: string[][] } {
		const calls: string[][] = [];
		return {
			calls,
			mock: { mode: 'live', state: () => ({ open: [], folded: [] }), hide: () => {}, show: () => {}, written: (ids) => calls.push([...ids]) },
		};
	}

	it('the sheet tells the view about the person and the people the write added, after the write and not before', async () => {
		const { mock, calls } = written();
		const handle = fakeHandle('n.md', SOURCE);
		handle.write.mockImplementationOnce(async () => {
			expect(calls).toEqual([]);
			return { ok: true, body: SOURCE, created: ['newkid'], effects: [] } as never;
		});
		const sheet = EditSheet.create({ workspace: { openLinkText: vi.fn() }, metadataCache: { getFirstLinkpathDest: () => null } } as never, {
			handle: handle as never,
			personId: 'corwin',
			sourcePath: 'n.md',
			folds: mock,
		})!;
		sheet.open();
		await settle();
		const content = (sheet as unknown as { contentEl: FEl }).contentEl;
		const name = content.querySelector('input.dynasty-field-name, input[type="text"]')!;
		(name as unknown as { value: string }).value = 'Corwin Valmont the Elder';
		dispatch(name, 'input', {});
		const save = (sheet as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-sheet-save')!;
		dispatch(save, 'click', { button: 0 });
		await settle();
		expect(handle.write).toHaveBeenCalledTimes(1);
		expect(calls).toEqual([['corwin', 'newkid']]);
	});

	it('the tree view opens the folds that hide the people, using the new text, and nothing else', async () => {
		const handle = handleWith('A', 'B');
		const { view, el } = await embed(SOURCE, { handle });
		const st = (handle as unknown as { state: object }).state;
		const c = view.constructor as unknown as { unfoldAfterWrite(host: unknown, st: unknown, full: boolean, ids: string[], body: string): void };
		const host = (view as unknown as { host: unknown }).host;
		c.unfoldAfterWrite(host, st, false, ['corwin'], SOURCE);
		await run();
		expect(folds(handle)).toEqual(new Set([key('B')]));
		expect(el.querySelector('.dynasty-card[data-person="corwin"]')).not.toBeNull();
	});

	it('an id that is not in the new text changes no fold', async () => {
		const handle = handleWith('A');
		const { view } = await embed(SOURCE, { handle });
		const c = view.constructor as unknown as { unfoldAfterWrite(host: unknown, st: unknown, full: boolean, ids: string[], body: string): void };
		c.unfoldAfterWrite((view as unknown as { host: unknown }).host, (handle as unknown as { state: object }).state, false, ['nobody'], SOURCE);
		expect(folds(handle)).toEqual(new Set([key('A')]));
	});
});

describe('F14: the saved picture keeps the view\'s folds', () => {
	const source = (foldNames: string[]) => {
		const parsed = parseDynasty(SOURCE);
		if (!parsed.ok) throw new Error('does not parse');
		const g = deriveFamilies(parsed.tree);
		const set = F.sets.get(foldNames.join('+'))!;
		return {
			g,
			orientation: 'down' as const,
			geo: geometryFor(16, 'normal'),
			relationLine: false,
			fonts: { text: 'serif', ui: 'sans-serif', bold: '600' },
			showDates: true,
			showPortraits: false,
			sourcePath: 'n.md',
			note: 'Tree',
			folds: { hidden: [...set.hides].sort(), folded: set.folds.map((n) => key(n)).sort() },
		};
	};

	it('draws the "+ N" signs and the cards that show, and no fold button', async () => {
		const made = await makePicture(undefined, source(['A', 'B']), 'svg');
		const svg = new TextDecoder().decode(made.bytes);
		expect(svg).toContain('>+ 75</text>');
		expect(svg).toContain('>+ 14</text>');
		expect(svg.match(/data-item="fold:/g)).toHaveLength(2);
		const cards = svg.match(/data-item="card:/g) ?? [];
		expect(cards.length).toBe(96 - F.sets.get('A+B')!.hides.length);
	});

	it('a tree with no fold is drawn as before', async () => {
		const plain = { ...source(['A']), folds: undefined };
		const made = await makePicture(undefined, plain, 'svg');
		const svg = new TextDecoder().decode(made.bytes);
		expect(svg).not.toMatch(/>\+ \d+<\/text>/);
		expect(svg.match(/data-item="card:/g)).toHaveLength(96);
	});
});
