import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { TFile } from 'obsidian';
import { HandleRegistry } from '../src/obsidian/block-handle';
import { TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, runTimers, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { fakeApp, fakeHost } from './acceptance/tree-view-fakes';

/*
 * Search round 0.2.3, area D: what a tree view keeps (session focus, folds, view) when its block's
 * handle is lost and found again.
 */

beforeAll(() => {
	installDom();
	const g = globalThis as Record<string, unknown>;
	g.window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const SRC = 'people:\n  - id: aldric\n    name: Aldric Valmont\n  - id: roderick\n    name: Roderick Valmont\n    parents: [aldric]\n';
const fence = (b: string) => ['```kin', b.trimEnd(), '```'].join('\n');

/** The real handle registry on a one-note vault, under the fake app of the tree view tests. */
function world(initial: string) {
	let text = initial;
	const File = TFile as unknown as new (path: string, extension: string) => TFile;
	const file = new File('n.md', 'md');
	const base = fakeApp();
	Object.assign(base.vault, {
		getAbstractFileByPath: (p: string) => (p === 'n.md' ? file : null),
		read: async () => text,
		process: async (_f: unknown, fn: (t: string) => string) => void (text = fn(text)),
	});
	Object.assign(base.workspace, { getLeavesOfType: () => [] });
	const reg = new HandleRegistry(base as never);
	return { app: base, reg, get: () => text, set: (t: string) => (text = t) };
}

describe('D7: a view that finds its block again after its handle was detached', () => {
	it('keeps the session focus, the folds and the saved view of the block (they live on the handle)', async () => {
		const t0 = fence(SRC) + '\n';
		const w = world(t0);
		const host = fakeHost();
		host.app = w.app as never;
		Object.assign(host, { handles: w.reg });
		const el = new FEl('div');
		let text = t0;
		const info = () => ({ lineStart: 0, lineEnd: 4, text });
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => info(), addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		const vp = el.querySelector('.dynasty-viewport')!;
		vp.clientWidth = 360;
		vp.clientHeight = 400;
		resizeAll();
		flushFrames();
		const first = w.reg.peek('n.md', 0)!;
		expect(first).not.toBeNull();
		first.state.focus = { id: 'aldric' };
		first.state.lastEdited = 'roderick';

		// The note gains a copy of the block (a paste in source mode): the handle cannot tell the two apart and is detached.
		text = fence(SRC) + '\n\n' + fence(SRC) + '\n';
		w.set(text);
		w.reg.applyText('n.md', text);
		await settle();
		expect(first.detached).toBe(true);
		// The copy is removed again; the view's later tries (250 ms, 1000 ms) find the block.
		text = t0;
		w.set(text);
		runTimers(2000);
		await settle();
		runTimers(2000);
		await settle();
		const second = w.reg.peek('n.md', 0)!;
		expect(second).not.toBeNull();
		if (second === first) throw new Error('the old handle came back: this test is about a new one');
		// The session of the block is what the owner sees: the focus and the start person follow the block, not the handle object.
		expect({ focus: second.state.focus, lastEdited: second.state.lastEdited }).toEqual({ focus: { id: 'aldric' }, lastEdited: 'roderick' });
	});
});

describe('D7b: a view that lost its block for longer than its two tries', () => {
	it('is editable again once the note holds its block only once more (no need to open the note again)', async () => {
		const t0 = fence(SRC) + '\n';
		const w = world(t0);
		const host = fakeHost();
		host.app = w.app as never;
		Object.assign(host, { handles: w.reg });
		const el = new FEl('div');
		let text = t0;
		const ctx = { sourcePath: 'n.md', getSectionInfo: () => ({ lineStart: 0, lineEnd: 4, text }), addChild: () => {} };
		const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
		view.load();
		await settle();
		const vp = el.querySelector('.dynasty-viewport')!;
		vp.clientWidth = 360;
		vp.clientHeight = 400;
		resizeAll();
		flushFrames();
		const root = () => el.querySelector('.dynasty-root')!;
		expect(root().hasClass('dynasty-read-only')).toBe(false);

		// A copy of the block is pasted below it: both blocks are the same text, so the view cannot tell which one it is.
		text = fence(SRC) + '\n\n' + fence(SRC) + '\n';
		w.set(text);
		w.reg.applyText('n.md', text);
		await settle();
		// The view tries again after 250 ms and after 1 000 ms (RESOLVE_RETRIES_MS), and gives up.
		const wait = async (ms: number) => {
			for (let t = 0; t < ms; t += 500) {
				runTimers(500);
				await settle();
			}
		};
		await wait(3000);
		expect(root().hasClass('dynasty-read-only')).toBe(true);

		// Five seconds later the owner deletes the copy. Obsidian saves the note: the `modify` event.
		await wait(5000);
		text = t0;
		w.set(text);
		w.reg.modified('n.md');
		await settle();
		await wait(3000);
		expect(root().hasClass('dynasty-read-only')).toBe(false);
	});
});
