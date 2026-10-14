import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { FEl, clock, device, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, openFullScreen, phone } from './acceptance/tree-view-fakes';

/*
 * Review round 0.2.3, area C, spec §13.18 rule 5 ("Start on me"), moved to 0.2.5 (D144): every combination of device, place, pin, session focus,
 * edited person, options.start, options.me and tree size against a model written from the spec. A tree in a note on a phone is a list that
 * stands on the person of the start chain (the session choice, the pin, the marked person, the person edited last, the oldest person who has
 * children, the first root; `options.start` is not in it). The full-screen view on a phone keeps the rule of D20 and D234 (the person edited last, `options.start`, the marked person, the first root); the computer and the tablet
 * show the whole tree or the pin.
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

function line(n: number, ...options: string[]): string {
	const people = Array.from({ length: n }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n');
	return `${options.length ? `options:\n${options.map((o) => `  ${o}\n`).join('')}\n` : ''}people:\n${people}\n`;
}
const tree = (src: string) => {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return r.tree;
};
const ids = (src: string) => [...new Set(tree(src).people.map((p) => p.id))].sort();
const family = (src: string, id: string, n: number) => [...new Set(focusSubgraph(tree(src), id, n)!.tree.people.map((p) => p.id))].sort();
const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();

type Device = 'phone' | 'tablet' | 'desktop';
const setDevice = (d: Device) => {
	if (d === 'phone') phone();
	else if (d === 'desktop') desktop();
	else {
		device.coarse = true;
		device.width = 820;
		device.height = 1180;
	}
};

type Case = { device: Device; place: 'preview' | 'full'; size: number; pin?: string; session?: 'all'; edited?: string; start?: string; me?: string };

/** The spec §5.5, §13.18 and D20: the person of the family that opens in a view that draws cards, or null for the whole tree. */
function expected(o: Case): string | null {
	const has = (id?: string) => id !== undefined && /^p\d+$/.test(id) && Number(id.slice(1)) < o.size;
	if (o.session === 'all') return null;
	if (has(o.pin)) return o.pin!;
	if (o.device !== 'phone') return null;
	if (o.size <= 100) return null;
	// D234: the marked person is on the chain after `options.start`; a mark that names nobody counts as no mark.
	return [o.edited, o.start, o.me].find(has) ?? 'p0';
}

/** D144: the person that the list of a phone note stands on, and the rung of the start chain that chose the person. */
function expectedList(o: Case): { id: string; from: string } {
	const has = (id?: string) => id !== undefined && /^p\d+$/.test(id) && Number(id.slice(1)) < o.size;
	if (has(o.pin)) return { id: o.pin!, from: 'pin' };
	if (has(o.me)) return { id: o.me!, from: 'me' };
	if (has(o.edited)) return { id: o.edited!, from: 'edited' };
	// A line has a child for every person but the last: p0 is the oldest parent, and a tree of one person starts at its first root.
	return { id: 'p0', from: o.size >= 2 ? 'oldest' : 'first' };
}

const SIZES = [1, 7, 100, 101];
const cases: Case[] = [];
for (const device of ['phone', 'tablet', 'desktop'] as Device[])
	for (const size of SIZES)
		for (const pin of [undefined, 'p2', 'nobody'])
			for (const start of [undefined, 'p3', 'nobody'])
				for (const me of [undefined, 'p5', 'nobody'])
					for (const edited of [undefined, 'p1'])
						cases.push({ device, place: 'preview', size, ...(pin ? { pin } : {}), ...(start ? { start } : {}), ...(me ? { me } : {}), ...(edited ? { edited } : {}) });
// The full-screen view opened with no preview drawn first (no remembered focus), on a phone.
for (const size of SIZES)
	for (const me of [undefined, 'p5']) for (const start of [undefined, 'p3']) cases.push({ device: 'phone', place: 'full', size, ...(me ? { me } : {}), ...(start ? { start } : {}) });

describe('spec §13.18 rule 5: the first view against a model of the spec', () => {
	const run = (list: typeof cases) => async () => {
		const bad: string[] = [];
		for (const c of list) {
			resetDom();
			resetObsidian();
			FullScreenModal.openViews.clear();
			setDevice(c.device);
			const opts = [c.pin ? `focus: ${c.pin}` : '', c.start ? `start: ${c.start}` : '', c.me ? `me: ${c.me}` : ''].filter(Boolean);
			const src = line(c.size, ...opts);
			if (c.place === 'preview' && c.device === 'phone') {
				const handle = fakeHandle('n.md', src);
				if (c.edited) handle.state.lastEdited = c.edited;
				const root = (await embed(src, { handle })).el.querySelector('.dynasty-root')!;
				const gotList = { id: root.getAttribute('data-dynasty-focus'), from: root.getAttribute('data-dynasty-list-from') };
				const wantList = expectedList(c);
				if (JSON.stringify(gotList) !== JSON.stringify(wantList)) bad.push(`${JSON.stringify(c)}: the list stands on ${JSON.stringify(gotList)}, the spec says ${JSON.stringify(wantList)}`);
				continue;
			}
			const want = expected(c);
			let got: string[];
			if (c.place === 'full') {
				got = drawn((await openFullScreen(src)).root as FEl);
			} else {
				const handle = fakeHandle('n.md', src);
				if (c.edited) handle.state.lastEdited = c.edited;
				got = drawn((await embed(src, { handle })).el);
			}
			const n = c.size;
			const exp = want === null ? ids(src) : family(src, want, 3);
			// On a tablet or the desktop the whole tree shows, unless it is cut by its own focus rules; compare whole-tree runs by size.
			if (JSON.stringify(got) !== JSON.stringify(exp)) bad.push(`${JSON.stringify(c)}: drew ${got.length} people ${got.slice(0, 4).join(',')}…, the spec says ${want === null ? 'the whole tree (' + n + ')' : 'the family of ' + want + ' (' + exp.join(',') + ')'}`);
		}
		expect(bad.join('\n')).toBe('');
	};
	it('every combination of the note opens the person that the spec names: the list stands on the start chain, the other devices draw the whole tree or the pin', run(cases.filter((c) => c.place === 'preview')), 120000);
	// D234: the full-screen view on a phone of a tree over 100 people starts on the marked person when nobody was edited and `options.start` is not set.
	it('the full-screen view on a phone uses the marked person as its start person, after the person edited last and options.start (D234)', run(cases.filter((c) => c.place === 'full')), 120000);
});
