import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { focusSubgraph } from '../src/core/focus-subgraph';
import { parseDynasty } from '../src/core/parse';
import { FullScreenModal } from '../src/obsidian/full-screen';
import DynastyTreePlugin from '../src/obsidian/main';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian, type Plugin as FakePlugin } from './acceptance/fake-obsidian';
import { desktop, embed, fakeApp, fakeHandle, type FakeHandle, type Host } from './acceptance/tree-view-fakes';

/*
 * Review of D22 ("a session focus lasts until the note closes"; main.ts endClosedSessions). The real
 * plugin runs on the fakes; its workspace reports its leaves and fires file-open and layout-change as
 * Obsidian does when a note closes because another note opens in the same tab. A handle stays in the
 * registry when its note closes (the real HandleRegistry keeps it), so the reopened note gets the
 * same handle and the same BlockState: only endClosedSessions can end the session.
 *
 * Harness proof (Obsidian 1.13.7, step `reviewd22` on scratch/review-d22): Obsidian keeps a tab
 * that is not shown yet (a deferred view: the Outgoing links and Outline tabs of the right sidebar,
 * behind Backlinks) with the view state it had when it was last loaded, so its state still names the
 * note after the note closed.
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

/** Nine generations p0 → p8, pinned on p4 (D18). */
const SRC = `options:\n  focus: p4\n\npeople:\n${Array.from({ length: 9 }, (_, i) => `  - id: p${i}\n    name: P${i}${i ? `\n    parents: [p${i - 1}]` : ''}`).join('\n')}\n`;

const tree = parseDynasty(SRC);
if (!tree.ok) throw new Error('SRC');
const PIN = [...new Set(focusSubgraph(tree.tree, 'p4', 3)!.tree.people.map((p) => p.id))].sort();
const ALL = [...new Set(tree.tree.people.map((p) => p.id))].sort();

const drawn = (root: FEl) => [...new Set(root.querySelectorAll('.dynasty-card').map((c) => c.getAttribute('data-person')!))].sort();

interface Leaf {
	type: string;
	file: string;
}

/** The real plugin on an app whose workspace has `leaves` and fires its events on request. */
async function plugin(leaves: Leaf[]) {
	const app = fakeApp();
	const on = new Map<string, (() => void)[]>();
	Object.assign(app.workspace, {
		on: (name: string, fn: () => void) => {
			on.set(name, [...(on.get(name) ?? []), fn]);
			return { name, fn };
		},
		iterateAllLeaves: (cb: (leaf: unknown) => void) => {
			for (const l of leaves) cb({ getViewState: () => ({ type: l.type, state: { file: l.file } }) });
		},
	});
	const p = new DynastyTreePlugin(app as never, { id: 'dynasty-tree' } as never);
	await (p as unknown as FakePlugin).load();
	const fire = (name: string) => {
		for (const fn of on.get(name) ?? []) fn();
	};
	return { plugin: p, host: p as unknown as Host, fire };
}

/** The note's tree in its tab, with the block handle the registry keeps for the note. */
async function openTree(host: Host, handle: FakeHandle) {
	desktop();
	const e = await embed(SRC, { host, handle });
	// endClosedSessions reads the registry's handles; the embed fakes replace only the lookups.
	Object.assign(host.handles, { all: () => [handle] });
	return e;
}

async function showAll(root: FEl): Promise<void> {
	const b = root.querySelector('.dynasty-show-all');
	if (!b) throw new Error('no Show all people');
	dispatch(b, 'click', { button: 0, clientX: 10, clientY: 10 });
	await settle();
	resizeAll();
	flushFrames();
}

/**
 * The user presses Show all people, opens another note in the same tab, and comes back: the order
 * of Obsidian's events that the harness recorded (the tree unloads and leaves the page; file-open;
 * layout-change with the tab on the other note; then the note again).
 */
async function showAllLeaveAndReturn(leaves: Leaf[]): Promise<string[]> {
	const { host, fire } = await plugin(leaves);
	const main = leaves[0];
	const handle = fakeHandle('n.md', SRC);
	const first = await openTree(host, handle);
	expect(drawn(first.el)).toEqual(PIN);
	await showAll(first.el);
	expect(drawn(first.el)).toEqual(ALL);

	main.file = 'other.md';
	first.view.unload();
	first.el.isConnected = false;
	fire('file-open');
	fire('layout-change');

	main.file = 'n.md';
	fire('file-open');
	const again = await openTree(host, handle);
	fire('layout-change');
	return drawn(again.el);
}

describe('D22: the session focus ends when the note closes', () => {
	it('control: with no other leaf that names the note, the pin applies again after the note closes and opens again', async () => {
		expect(await showAllLeaveAndReturn([{ type: 'markdown', file: 'n.md' }])).toEqual(PIN);
	});

	it('DEFECT: a sidebar tab not shown yet (deferred Outline) that still names the note keeps "Show all people" after the note closes', async () => {
		// Obsidian's default right sidebar: Backlinks shown (it follows the active note), Outgoing links
		// and Outline behind it, deferred, with the note they named when Obsidian last saved them.
		const leaves: Leaf[] = [
			{ type: 'markdown', file: 'n.md' },
			{ type: 'backlink', file: 'n.md' },
			{ type: 'outline', file: 'n.md' },
		];
		const follow = leaves[1];
		const main = leaves[0];
		// The loaded Backlinks tab follows the active note; the deferred Outline tab does not.
		const track = new Proxy(main, {
			set(t, k, v) {
				if (k === 'file') follow.file = v as string;
				return Reflect.set(t, k, v);
			},
		});
		leaves[0] = track;
		expect(await showAllLeaveAndReturn(leaves)).toEqual(PIN);
	});
});
