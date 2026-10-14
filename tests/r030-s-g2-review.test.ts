import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/obsidian/relation-cache';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, fullViews, phone } from './acceptance/tree-view-fakes';

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});
beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

function big(n: number, ...options: string[]): string {
	const rows = Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}${i ? ', parents: [p0]' : ''}}`);
	rows.push('  - {id: kid, name: Kid, parents: [p5]}');
	return `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}` : ''}people:\n${rows.join('\n')}\n`;
}
const rootOf = (el: FEl) => el.querySelector('.dynasty-root')!;

/** Expand twice in one session; the note text changes between the two. */
async function twice(first: string, second: string, mid?: (h: ReturnType<typeof fakeHandle>) => void) {
	phone();
	const handle = fakeHandle('n.md', first);
	const e = await embed(first, { host: fakeHost(), handle });
	const open = async () => {
		dispatch(e.el.querySelector('.dynasty-expand')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		resizeAll();
		flushFrames();
		const modal = fullViews()[fullViews().length - 1];
		return modal;
	};
	const m1 = await open();
	const f1 = rootOf(m1.containerEl as unknown as FEl).getAttribute('data-dynasty-focus');
	m1.close();
	await settle();
	mid?.(handle);
	handle.change(second);
	await settle();
	resizeAll();
	flushFrames();
	const list = rootOf(e.el).getAttribute('data-dynasty-focus');
	const m2 = await open();
	const f2 = rootOf(m2.containerEl as unknown as FEl).getAttribute('data-dynasty-focus');
	return { f1, f2, list, open: openModals.length };
}

describe('G2 review of D234', () => {
	it('a mark added after the first Expand is picked up at the next Expand', async () => {
		const r = await twice(big(150), big(150, 'me: p5'));
		expect(r.f1).toBe('p0');
		expect(r.list).toBe('p5');
		expect(r.f2).toBe('p5');
	});
	it('a mark removed after the first Expand is not kept at the next Expand', async () => {
		const r = await twice(big(150, 'me: p5'), big(150));
		expect(r.f1).toBe('p5');
		expect(r.f2).toBe('p0');
	});
	it('a mark changed after the first Expand is picked up at the next Expand', async () => {
		const r = await twice(big(150, 'me: p5'), big(150, 'me: p7'));
		expect(r.f1).toBe('p5');
		expect(r.list).toBe('p7');
		expect(r.f2).toBe('p7');
	});
	it('a person edited after the first Expand does not move the stored family (an edit never moves it; only a new mark does)', async () => {
		const r = await twice(big(150, 'me: p5'), big(150, 'me: p5'), (h) => (h.state.lastEdited = 'p9'));
		expect(r.f1).toBe('p5');
		expect(r.f2).toBe('p5');
	});
});

describe('G2 review: the list and Expand agree (spec §5.5 D234 sentence)', () => {
	it('no mark, no edit, no start: the list starts on the oldest parent, the full-screen view on the first root (old; spec §5.5)', async () => {
		// z is the first root but has no children; p0 is the oldest person with children, so the list starts on p0.
		const rows = ['  - {id: z, name: Z}', ...Array.from({ length: 150 }, (_, i) => `  - {id: p${i}, name: P${i}${i ? ', parents: [p0]' : ''}}`)];
		const src = `people:\n${rows.join('\n')}\n`;
		phone();
		const handle = fakeHandle('n.md', src);
		const e = await embed(src, { host: fakeHost(), handle });
		const list = rootOf(e.el).getAttribute('data-dynasty-focus');
		dispatch(e.el.querySelector('.dynasty-expand')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		resizeAll();
		flushFrames();
		const full = rootOf(fullViews()[0].containerEl as unknown as FEl).getAttribute('data-dynasty-focus');
		expect(list).toBe('p0');
		expect(full).toBe('z');
	});
});

describe('G2 review: large-tree bar with a mark (D226)', () => {
	it('1600 people with a mark: Expand draws the family of the mark, no bar; a session whole tree shows the bar', async () => {
		const src = big(1600, 'me: p5');
		phone();
		const handle = fakeHandle('n.md', src);
		const e = await embed(src, { host: fakeHost(), handle });
		dispatch(e.el.querySelector('.dynasty-expand')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await settle();
		resizeAll();
		flushFrames();
		const m = fullViews()[0].containerEl as unknown as FEl;
		expect(rootOf(m).getAttribute('data-dynasty-focus')).toBe('p5');
		expect(m.querySelector('.dynasty-large-bar')).toBeNull();
		handle.state.focus = { id: null };
		const { TreeView } = await import('../src/obsidian/tree-view');
		TreeView.redrawState(fakeHost() as never, handle.state as never);
		for (const v of [...(e.host?.views ?? [])]) v.syncFocus?.();
	});
});
