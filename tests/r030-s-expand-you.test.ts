import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fullViews, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * D234 (0.3.0): in a tree of more than 100 people the phone full-screen view starts on the family of the marked person
 * ("You") when no person was edited and `options.start` is not set. The start chain is: the person edited last,
 * `options.start`, the marked person, the first root. A pin and a session focus win, as before. The computer is not changed.
 * Adopted from the proof test of the cause report (G5 flow review): `expand-focus-cause.test.ts` on `scratch/expand-focus`.
 */

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

/** n people: p0 is the oldest root, p1..p(n-1) are its children, p5 has a child of its own. */
function big(n: number, ...options: string[]): string {
	const rows = Array.from({ length: n }, (_, i) => `  - {id: p${i}, name: P${i}${i ? ', parents: [p0]' : ''}}`);
	rows.push('  - {id: kid, name: Kid, parents: [p5]}');
	return `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}` : ''}people:\n${rows.join('\n')}\n`;
}

const rootOf = (el: FEl) => el.querySelector('.dynasty-root')!;
async function expandFocus(src: string, state: { lastEdited?: string; focus?: { id: string | null } } = {}): Promise<{ list: string | null; from: string | null; full: string | null }> {
	// Each call is a new session: the same test may open several windows.
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	phone();
	const handle = fakeHandle('n.md', src);
	Object.assign(handle.state, state);
	const e = await embed(src, { host: fakeHost(), handle });
	const r = rootOf(e.el);
	const list = r.getAttribute('data-dynasty-focus');
	const from = r.getAttribute('data-dynasty-list-from');
	dispatch(e.el.querySelector('.dynasty-expand')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
	await settle();
	resizeAll();
	flushFrames();
	const modal = fullViews()[0].containerEl as unknown as FEl;
	return { list, from, full: rootOf(modal).getAttribute('data-dynasty-focus') };
}

describe('Expand on a phone, tree over 100 people (D234)', () => {
	it('with a marked person and nothing else, Expand opens the family of the marked person, as the list does', async () => {
		const r = await expandFocus(big(150, 'me: p5'));
		expect(r).toEqual({ list: 'p5', from: 'me', full: 'p5' });
	});

	it('options.start comes before the marked person', async () => {
		expect((await expandFocus(big(150, 'me: p5', 'start: p7'))).full).toBe('p7');
	});

	it('the person edited last comes before options.start and the marked person', async () => {
		expect((await expandFocus(big(150, 'me: p5', 'start: p7'), { lastEdited: 'p9' })).full).toBe('p9');
		expect((await expandFocus(big(150, 'me: p5'), { lastEdited: 'p9' })).full).toBe('p9');
	});

	it('a pin wins over the marked person', async () => {
		expect((await expandFocus(big(150, 'me: p5', 'focus: p3'))).full).toBe('p3');
	});

	it('a session focus wins over the marked person, and the whole tree stays whole', async () => {
		expect((await expandFocus(big(150, 'me: p5'), { focus: { id: 'p8' } })).full).toBe('p8');
		expect((await expandFocus(big(150, 'me: p5'), { focus: { id: null } })).full).toBeNull();
	});

	it('a mark that names nobody counts as no mark: the first root', async () => {
		expect((await expandFocus(big(150, 'me: nobody'))).full).toBe('p0');
	});

	it('no mark: the first root, as before', async () => {
		expect((await expandFocus(big(150))).full).toBe('p0');
	});
});

describe('what D234 does not change', () => {
	it('a small tree (30 people) with a mark: Expand opens the whole tree', async () => {
		const r = await expandFocus(big(30, 'me: p5'));
		expect(r).toEqual({ list: 'p5', from: 'me', full: null });
	});

	it('the computer: the full-screen view of a large tree with a mark opens the whole tree', async () => {
		desktop();
		const { root } = await openFullScreen(big(150, 'me: p5'));
		expect((root as FEl).getAttribute('data-dynasty-focus')).toBeNull();
	});
});
