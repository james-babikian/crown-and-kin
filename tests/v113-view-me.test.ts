import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { chooseFocus, type FocusFacts } from '../src/view/focus-mode';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fullViews, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * Version 0.2.3, owner decision D111 item 4: a tree whose text has a valid `options.me` opens on the marked person. In 0.2.5 (D144) a tree in a
 * note on a phone is a list; its start chain is the session choice, the pin, the marked person, the person edited last, the oldest person who
 * has children, the first root (spec §5.5). `options.start` is not in the chain. The full-screen view keeps the rule of D20 and never uses the mark.
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
const family = (src: string, id: string) => {
	const tree = parse(src);
	return [...new Set(focusSubgraph(tree, id, 3)!.tree.people.map((p) => p.id))].sort();
};
const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();
/** The person that the list stands on, and the rung of the start chain that chose the person. */
const stands = (root: FEl) => {
	const r = root.querySelector('.dynasty-root')!;
	return [r.getAttribute('data-dynasty-focus'), r.getAttribute('data-dynasty-list-from')];
};

describe('chooseFocus: the mark has no part in it (D111 ended with the phone preview, D144)', () => {
	const facts = (o: Partial<Omit<FocusFacts, 'large' | 'start' | 'has'>> & { large?: boolean; start?: string | null }) => {
		const large = vi.fn(() => o.large ?? false);
		const start = vi.fn(() => (o.start === undefined ? 's' : o.start));
		const f: FocusFacts = { session: o.session ?? null, pin: o.pin, phone: o.phone ?? false, auto: o.auto ?? null, has: (id) => ['a', 'b', 's'].includes(id), large, start };
		return { f, large, start };
	};

	it('phone, small tree: the whole tree, and the start person is not asked', () => {
		const { f, start } = facts({ phone: true, start: 's' });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none' });
		expect(start).not.toHaveBeenCalled();
	});

	it('phone, large tree: the start person\'s family', () => {
		expect(chooseFocus(facts({ phone: true, large: true, start: 's' }).f)).toMatchObject({ id: 's', from: 'phone', auto: 's' });
	});

	it('not a phone: the whole tree, and the size of the tree is not asked', () => {
		const { f, large } = facts({ phone: false });
		expect(chooseFocus(f)).toMatchObject({ id: null, from: 'none' });
		expect(large).not.toHaveBeenCalled();
	});

	it('the session focus and the pin win over the phone rule', () => {
		expect(chooseFocus(facts({ phone: true, large: true, session: { id: 'a' } }).f)).toMatchObject({ id: 'a', from: 'session' });
		expect(chooseFocus(facts({ phone: true, large: true, session: { id: null } }).f)).toMatchObject({ id: null, from: 'session' });
		expect(chooseFocus(facts({ phone: true, large: true, pin: 'b' }).f)).toMatchObject({ id: 'b', from: 'pin' });
	});
});

describe('the list of a phone note stands on the marked person when nothing before it applies (D111 item 4, D144)', () => {
	it('no start person: the marked person', async () => {
		phone();
		const src = line(7, 'me: p3');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(stands(el)).toEqual(['p3', 'me']);
		expect(drawn(el)).toEqual([]);
		expect(el.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person'))).toEqual(['p3', 'p2', 'p4']);
	});

	it('options.start is not in the chain: the marked person comes first, and with no mark the oldest person who has children', async () => {
		phone();
		const marked = line(7, 'start: p5', 'me: p2');
		expect(stands((await embed(marked, { handle: fakeHandle('n.md', marked) })).el)).toEqual(['p2', 'me']);
		resetDom();
		phone();
		const plain = line(7, 'start: p5');
		expect(stands((await embed(plain, { handle: fakeHandle('n.md', plain) })).el)).toEqual(['p0', 'oldest']);
	});

	it('the marked person comes before the person last edited', async () => {
		phone();
		const src = line(7, 'start: p5', 'me: p2');
		const handle = fakeHandle('n.md', src);
		handle.state.lastSaved = 'p1';
		const { el } = await embed(src, { handle });
		expect(stands(el)).toEqual(['p2', 'me']);
	});

	it('with no mark the person last edited comes before the oldest person', async () => {
		phone();
		const src = line(7);
		const handle = fakeHandle('n.md', src);
		handle.state.lastSaved = 'p1';
		const { el } = await embed(src, { handle });
		expect(stands(el)).toEqual(['p1', 'edited']);
	});

	it('a marked person who is not in the tree is skipped', async () => {
		phone();
		const src = line(7, 'me: nobody');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(stands(el)).toEqual(['p0', 'oldest']);
	});

	it('the pin comes before the marked person', async () => {
		phone();
		const src = line(7, 'focus: p1', 'me: p5');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(stands(el)).toEqual(['p1', 'pin']);
	});

	it('the session choice comes before the marked person; "all people" (Clear focus) means nothing to a list', async () => {
		phone();
		const src = line(7, 'me: p3');
		const handle = fakeHandle('n.md', src);
		handle.state.focus = { id: 'p5' };
		expect(stands((await embed(src, { handle })).el)).toEqual(['p5', 'session']);
		resetDom();
		phone();
		const cleared = fakeHandle('n.md', src);
		cleared.state.focus = { id: null };
		expect(stands((await embed(src, { handle: cleared })).el)).toEqual(['p3', 'me']);
	});

	it('more than 100 people with a marked person: the marked person, as for a small tree', async () => {
		phone();
		const src = line(101, 'me: p50');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(stands(el)).toEqual(['p50', 'me']);
	});

	it('the desktop does not change: the whole tree', async () => {
		desktop();
		const src = line(7, 'me: p3');
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(drawn(el)).toEqual(everybody(src));
	});

	it('the full-screen view of a small tree does not use the mark: the whole tree, also from the list that stands on the marked person', async () => {
		phone();
		const src = line(7, 'me: p3');
		expect(drawn((await openFullScreen(src)).root)).toEqual(everybody(src));
		resetDom();
		resetObsidian();
		FullScreenModal.openViews.clear();
		phone();
		const { el } = await embed(src, { handle: fakeHandle('n.md', src) });
		expect(stands(el)).toEqual(['p3', 'me']);
		dispatch(el.querySelector('.dynasty-expand')!, 'click', { button: 0, clientX: 10, clientY: 10 });
		await settle();
		resizeAll();
		flushFrames();
		const full = fullViews()[0].containerEl as unknown as FEl;
		expect(drawn(full)).toEqual(everybody(src));
	});

	// D234: this test pinned the first root; the marked person now comes before it.
	it('a tree with more than 100 people opens the full-screen view on the family of the marked person when nobody was edited and options.start is not set (D20, D234)', async () => {
		phone();
		const src = line(101, 'me: p50');
		expect(drawn((await openFullScreen(src)).root)).toEqual(family(src, 'p50'));
	});
});
