import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { chooseFocus, type FocusFacts } from '../src/obsidian/focus-mode';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fullViews, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * Version 0.2.3, owner decision D111 item 4: on a phone, a tree whose text has a valid `options.me`
 * opens on the family of the start person, also when it has 100 people or fewer. The start person is
 * the person last edited, then `options.start`, then the marked person, then the first root.
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
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** A line of `n` generations p0 → p1 → …, with the given text lines in `options`. */
function line(n: number, ...options: string[]): string {
	const people = Array.from({ length: n }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n');
	return `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}\n` : ''}people:\n${people}\n`;
}

const parse = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};
const everybody = (src: string) => [...new Set(parse(src).people.map((p) => p.id))].sort();
/** The people of the preview of the family of `id`: 1 generation up and down (D23). */
const family1 = (src: string, id: string) => [...new Set(focusSubgraph(parse(src), id, 1)!.tree.people.map((p) => p.id))].sort();
const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();

describe('chooseFocus: a marked person opens a small tree on a phone as a family (D111)', () => {
	const facts = (o: Partial<Omit<FocusFacts, 'large' | 'start' | 'has'>> & { large?: boolean; start?: string | null }) => {
		const large = vi.fn(() => o.large ?? false);
		const start = vi.fn(() => (o.start === undefined ? 's' : o.start));
		const f: FocusFacts = { session: o.session ?? null, pin: o.pin, phone: o.phone ?? false, auto: o.auto ?? null, marked: o.marked, has: (id) => ['a', 'b', 's'].includes(id), large, start };
		return { f, large, start };
	};

	it('phone, small tree, marked: the start person\'s family, and the size of the tree is not asked', () => {
		const { f, large } = facts({ phone: true, marked: true, start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: 's', from: 'phone', auto: 's' });
		expect(large).not.toHaveBeenCalled();
	});

	it('phone, small tree, not marked: the whole tree (as before)', () => {
		expect(chooseFocus(facts({ phone: true, marked: false, start: 's' }).f)).toMatchObject({ id: null, from: 'none' });
		expect(chooseFocus(facts({ phone: true, start: 's' }).f)).toMatchObject({ id: null, from: 'none' });
	});

	it('not a phone: marked changes nothing', () => {
		const { f, start } = facts({ phone: false, marked: true });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none' });
		expect(start).not.toHaveBeenCalled();
	});

	it('the session focus and the pin still win over a marked person', () => {
		expect(chooseFocus(facts({ phone: true, marked: true, session: { id: 'a' } }).f)).toMatchObject({ id: 'a', from: 'session' });
		expect(chooseFocus(facts({ phone: true, marked: true, session: { id: null } }).f)).toMatchObject({ id: null, from: 'session' });
		expect(chooseFocus(facts({ phone: true, marked: true, pin: 'b' }).f)).toMatchObject({ id: 'b', from: 'pin' });
	});
});

describe('a phone opens a small tree with a marked person on the marked person\'s family (D111 item 4)', () => {
	it('no start person: the family of the marked person, 1 generation (D23)', async () => {
		phone();
		const src = line(7, 'me: p3');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p3'));
		expect(drawn(el)).toEqual(['p2', 'p3', 'p4']);
		expect(el.querySelector('.dynasty-root')?.getAttribute('data-dynasty-focus')).toBe('p3');
	});

	it('options.start comes before the marked person', async () => {
		phone();
		const src = line(7, 'start: p5', 'me: p2');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p5'));
	});

	it('the person last edited in this session comes before options.start and the marked person', async () => {
		phone();
		const src = line(7, 'start: p5', 'me: p2');
		const handle = fakeHandle('n.md', src);
		handle.state.lastEdited = 'p1';
		const { el } = await embed(src, { handle });
		expect(drawn(el)).toEqual(family1(src, 'p1'));
	});

	it('an options.start that names nobody is skipped: the marked person follows', async () => {
		phone();
		const src = line(7, 'start: nobody', 'me: p4');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p4'));
	});

	it('a marked person who is not in the tree: nothing changes, the whole tree', async () => {
		phone();
		const src = line(7, 'me: nobody');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(everybody(src));
	});

	it('no marked person: the whole tree (as before)', async () => {
		phone();
		const src = line(7);
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(everybody(src));
	});

	it('the pin comes before the marked person', async () => {
		phone();
		const src = line(7, 'focus: p1', 'me: p5');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p1'));
	});

	it('the session focus (Show all people) comes before the marked person', async () => {
		phone();
		const src = line(7, 'me: p3');
		const handle = fakeHandle('n.md', src);
		handle.state.focus = { id: null };
		const { el } = await embed(src, { handle });
		expect(drawn(el)).toEqual(everybody(src));
	});

	it('more than 100 people with a marked person and no start person: the family of the marked person, before the first root', async () => {
		phone();
		const src = line(101, 'me: p50');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p50'));
	});

	it('more than 100 people with a marked person and options.start: the start person', async () => {
		phone();
		const src = line(101, 'start: p10', 'me: p50');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(family1(src, 'p10'));
	});

	it('the desktop does not change: the whole tree', async () => {
		desktop();
		const src = line(7, 'me: p3');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(everybody(src));
	});

	it('the full-screen view of a small tree does not change: the whole tree (also from the marked preview)', async () => {
		phone();
		const src = line(7, 'me: p3');
		expect(drawn((await openFullScreen(src)).root)).toEqual(everybody(src));
		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		phone();
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(['p2', 'p3', 'p4']);
		dispatch(el.querySelector('.dynasty-expand')!, 'click', { button: 0, clientX: 10, clientY: 10 });
		await settle();
		resizeAll();
		flushFrames();
		const full = fullViews()[0].containerEl as unknown as FEl;
		expect(drawn(full)).toEqual(everybody(src));
	});
});
