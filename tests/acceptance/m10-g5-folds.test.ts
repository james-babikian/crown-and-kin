import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, settle } from './fake-dom';
import { openModals, resetObsidian } from './fake-obsidian';
import { block15, comments15 } from './m10-support';
import DynastyTreePlugin from '../../src/obsidian/main';
import { newBlockState } from '../../src/obsidian/block-state';
import { desktop, embed, fakeApp, fakeHandle, fullViews } from './tree-view-fakes';

/*
 * The M10 G5 spec review named these flows as not covered (the decision notes, "M10 G5 spec review"): spec §13.10
 * says that a problem in the list, the relation finder, a tap on a house page row and Show all people treat
 * folds in a set way, and that a closed and opened note has no folds. Sample tree 15, block 1, gives the
 * folds. The sets of people that each fold hides are in its comments. Nothing here reads a result from
 * the code of `src/`.
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
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	for (const m of fullViews()) (m as unknown as { close(): void }).close();
	vi.restoreAllMocks();
});

const F = comments15();
const key = (name: string) => F.folds.get(name)!.key;
const folds = (h: { state: unknown }) => (h.state as { folds: Set<string> }).folds;
const cardCount = (el: FEl) => el.querySelectorAll('.dynasty-card').length;
const card = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"]`);
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};
const handleFor = (source: string, ...names: string[]) => {
	const handle = fakeHandle('n.md', source);
	folds(handle).clear();
	for (const n of names) folds(handle).add(key(n));
	return handle;
};

/** Lucan is hidden by fold A (his father Dorian) and by fold B (his mother Clarice), and by COUSIN. */
const WITH_PROBLEM = (() => {
	const source = block15(0);
	const at = source.indexOf('    parents: [dorian, clarice]');
	if (at < 0) throw new Error('sample tree 15 has no Lucan');
	// An unknown placement type: a problem that names Lucan (spec §8), so the problem list has a row for him.
	const end = at + '    parents: [dorian, clarice]'.length;
	return `${source.slice(0, end)}\n    placement: bogus${source.slice(end)}`;
})();

/** Where the view centres: the centre of the card in layout px, and the view's centre. */
const centreOf = (view: TreeView, id: string) => {
	const v = view as unknown as { laid: { layout: { persons: Map<string, { x: number; y: number; w: number; h: number }> } }; panZoom: { view: { cx: number; cy: number } } };
	const b = v.laid.layout.persons.get(id)!;
	return { card: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, view: v.panZoom.view };
};

describe('a row of the problem list on a hidden person (spec §13.10 "Showing a hidden person")', () => {
	it('opens only the folds that hide the person, and centres on the person', async () => {
		// A, B and NEST are folded. NEST is inside branch A and does not hide Lucan.
		const handle = handleFor(WITH_PROBLEM, 'A', 'B', 'NEST');
		const { el, view } = await embed(WITH_PROBLEM, { handle });
		expect(card(el, 'lucan')).toBeNull();
		const badge = el.querySelector('.dynasty-warning-badge')!;
		expect(badge).not.toBeNull();
		dispatch(badge, 'click', { detail: 1 });
		const rows = el.querySelectorAll('.dynasty-problem-button');
		expect(rows).toHaveLength(1);
		dispatch(rows[0], 'click');
		await run();
		expect(card(el, 'lucan')).not.toBeNull();
		// Both folds that hide Lucan are open; the nested fold that does not hide him stays folded.
		expect(folds(handle)).toEqual(new Set([key('NEST')]));
		expect(card(el, 'leofric')).toBeNull();
		const c = centreOf(view, 'lucan');
		expect(c.view.cx).toBeCloseTo(c.card.x, 0);
		expect(c.view.cy).toBeCloseTo(c.card.y, 0);
	});

	it('with no fold on the person, no fold changes', async () => {
		const handle = handleFor(WITH_PROBLEM, 'NEST');
		const { el } = await embed(WITH_PROBLEM, { handle });
		dispatch(el.querySelector('.dynasty-warning-badge')!, 'click', { detail: 1 });
		dispatch(el.querySelector('.dynasty-problem-button')!, 'click');
		await run();
		expect(folds(handle)).toEqual(new Set([key('NEST')]));
		expect(card(el, 'lucan')).not.toBeNull();
	});
});

describe('the relation finder and a hidden person (spec §13.10, §13.2)', () => {
	const SOURCE = block15(0);
	const showFinder = (view: TreeView, handle: { state: unknown }, a: string, b: string) => {
		const V = view.constructor as unknown as { showFinder(host: unknown, st: unknown, a: string, b: string, o: unknown): void };
		V.showFinder((view as unknown as { host: unknown }).host, handle.state, a, b, view);
	};

	it('"Show in the whole tree" keeps the people of the line, opens no fold in the block state, and other folds still hide their people', async () => {
		const handle = handleFor(SOURCE, 'A', 'B', 'NEST');
		const { el, view } = await embed(SOURCE, { handle });
		// Osric is the father of Dorian, who is the father of Lucan (hidden by A and by B).
		showFinder(view, handle, 'osric', 'lucan');
		await run();
		expect(card(el, 'lucan')).not.toBeNull();
		const whole = el.querySelector('.dynasty-result-whole')!;
		expect(whole).not.toBeNull();
		dispatch(whole, 'click');
		await run();
		expect(card(el, 'lucan')).not.toBeNull();
		expect(card(el, 'osric')).not.toBeNull();
		// The finder opens folds only while its result shows (§13.10): the block still owes A, B and NEST.
		expect(folds(handle)).toEqual(new Set([key('A'), key('B'), key('NEST')]));
		// A person that is not on the line stays hidden by NEST.
		expect(card(el, 'leofric')).toBeNull();
		// Close: the folds hide Lucan again.
		dispatch(el.querySelector('.dynasty-result-close')!, 'click');
		await run();
		expect(card(el, 'lucan')).toBeNull();
		expect(folds(handle)).toEqual(new Set([key('A'), key('B'), key('NEST')]));
	});
});

describe('a tap on a row of a house page (spec §13.12 H3)', () => {
	it('opens only the folds that hide the person, and centres on the person', async () => {
		const source = block15(0);
		const handle = handleFor(source, 'A', 'B', 'NEST');
		const { el, view } = await embed(source, { handle });
		expect(card(el, 'lucan')).toBeNull();
		dispatch(el.querySelector('.dynasty-legend-button')!, 'click');
		const houseRow = el.querySelector('.dynasty-legend-house[data-house="valmont"]');
		expect(houseRow).not.toBeNull();
		dispatch(houseRow!, 'click');
		await settle();
		const page = openModals.find((m) => (m as unknown as { contentEl?: FEl }).contentEl?.querySelector('.dynasty-hp-row')) as unknown as { contentEl: FEl };
		expect(page).toBeDefined();
		const row = page.contentEl.querySelector('.dynasty-hp-row[data-person="lucan"]');
		expect(row).not.toBeNull();
		dispatch(row!, 'click');
		await run();
		expect(card(el, 'lucan')).not.toBeNull();
		expect(folds(handle)).toEqual(new Set([key('NEST')]));
		const c = centreOf(view, 'lucan');
		expect(c.view.cx).toBeCloseTo(c.card.x, 0);
		expect(c.view.cy).toBeCloseTo(c.card.y, 0);
	});
});

describe('Clear focus keeps the folds (spec §13.10 "Focus mode")', () => {
	it('after Focus and Clear focus the block still owes its folds, and the folded people stay hidden', async () => {
		const source = block15(0);
		const handle = handleFor(source, 'B');
		const { el, view } = await embed(source, { handle });
		expect(cardCount(el)).toBe(96 - 14);
		(view as unknown as { focusOn(id: string | null): void }).focusOn('osric');
		await run();
		expect(folds(handle)).toEqual(new Set([key('B')]));
		// D132: Focus opens a small list while a focus shows; Clear focus is its second item.
		expect(el.querySelector('.dynasty-show-all')).toBeNull();
		dispatch(el.querySelector('.dynasty-focus')!, 'click', { detail: 1 });
		const clear = el.querySelectorAll('.dynasty-popover-focus .dynasty-popover-item')[1];
		expect(clear).toBeDefined();
		dispatch(clear, 'click', { detail: 1 });
		await run();
		expect(folds(handle)).toEqual(new Set([key('B')]));
		expect(cardCount(el)).toBe(96 - 14);
		expect(card(el, 'lucan')).toBeNull();
	});
});

describe('the note closed and opened again has no folds (main.ts `endClosedSessions`, spec §13.10, D22)', () => {
	const fold = (st: { folds: Set<string> }) => st.folds.add(key('A'));
	const leaf = (file: string) => ({ getViewState: () => ({ type: 'markdown', state: { file } }) });

	it('the layout change and the file open events end the folds of a block whose note has no open tab, and keep those of an open note', async () => {
		const app = fakeApp();
		const handlers = new Map<string, () => void>();
		(app.workspace as unknown as { on: (n: string, f: () => void) => object }).on = (name, fn) => {
			handlers.set(name, fn);
			return { name, fn };
		};
		const open: string[] = ['Open.md'];
		(app.workspace as unknown as { iterateAllLeaves: (fn: (l: unknown) => void) => void }).iterateAllLeaves = (fn) => open.forEach((f) => fn(leaf(f)));
		const plugin = new DynastyTreePlugin(app as never, { id: 'dynasty-tree' } as never);
		await (plugin as unknown as { load(): Promise<void> }).load();
		const looseStates = (plugin as unknown as { looseStates: Map<string, { folds: Set<string> }> }).looseStates;
		const kept = newBlockState();
		const ended = newBlockState();
		fold(kept);
		fold(ended);
		looseStates.set('Open.md #0', kept);
		looseStates.set('Closed.md #0', ended);
		expect([...handlers.keys()].sort()).toEqual(expect.arrayContaining(['file-open', 'layout-change']));
		handlers.get('layout-change')!();
		expect(kept.folds.size).toBe(1);
		expect(ended.folds.size).toBe(0);
		// The file-open event ends them too.
		fold(ended);
		handlers.get('file-open')!();
		expect(ended.folds.size).toBe(0);
	});

	it('a view of the same block, drawn again after the note closed, shows every person', async () => {
		const source = block15(0);
		const handle = handleFor(source, 'A');
		const first = await embed(source, { handle });
		expect(cardCount(first.el)).toBe(96 - 75);
		const { endSessionFocus } = await import('../../src/obsidian/block-state');
		endSessionFocus(handle.state as never);
		resetDom();
		const second = await embed(source, { handle });
		expect(cardCount(second.el)).toBe(96);
	});
});
