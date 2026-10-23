import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetHeights } from '../../src/obsidian/block-height';
import { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, resetDom, runTimers, settle } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHandle, fakeHost, phone } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Review r028-g2-ios-start. Findings:
 *  1. The section arrives between the constructor and `onload` (askSection runs inside begin(), while `started` is still false): no watchNote is registered.
 *  2. Sound: the 8 s cap draws a tree when the styles never load; unload clears the timers; a Canvas card stays read only.
 *  3. Number: getSectionInfo calls for a block that never gets a section.
 */

useFakeDom();
beforeEach(() => {
	resetDom();
	resetObsidian();
	forgetHeights();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => vi.restoreAllMocks());

const SRC = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
`;
const info = { lineStart: 0, lineEnd: 4, text: '' };

function build(opts: { ready?: () => boolean; known: () => boolean; cls?: string; calls?: { n: number } }) {
	phone();
	const h = fakeHandle('n.md', SRC);
	const host = fakeHost();
	const watch = vi.fn(() => () => {});
	Object.assign(host, { startedUp: { ready: opts.ready ?? (() => true), cache: () => true } });
	Object.assign(host.handles, { quickOrdinal: () => 0, peek: () => h, resolve: async () => h, resolveByBody: () => h, inEditorOf: () => false, watchNote: watch });
	const el = new FEl('div');
	new FEl('div', { cls: opts.cls ?? 'markdown-reading-view' }).appendChild(el);
	const ctx = {
		sourcePath: 'n.md',
		getSectionInfo: () => {
			if (opts.calls) opts.calls.n++;
			return opts.known() ? info : null;
		},
		addChild: () => {},
	};
	const view = new TreeView(host as never, el as unknown as HTMLElement, SRC, { kind: 'embed', ctx } as never);
	return { view, el, watch };
}

describe('finding 1: a section that comes between the constructor and onload', () => {
	it('registers watchNote for the view (D7: a view that gave up finding its block tries again when the note changes)', async () => {
		const known = { v: false };
		const { view, watch } = build({ known: () => known.v });
		// Obsidian answers null in the constructor and a section when the container is in the page (onload).
		known.v = true;
		view.load();
		await settle();
		expect(watch).toHaveBeenCalledTimes(1);
	});
});

describe('sound checks', () => {
	it('the 8 s cap draws the tree when the styles never load, and nothing is left after unload', async () => {
		const { view, el } = build({ ready: () => false, known: () => true });
		view.load();
		await settle();
		runTimers(7000);
		await settle();
		expect(el.querySelector('.dynasty-placeholder')).not.toBeNull();
		runTimers(1500);
		await settle();
		expect(el.querySelector('.dynasty-placeholder')).toBeNull();
		view.unload();
	});

	it('a view unloaded during the wait leaves no timer that runs', async () => {
		const calls = { n: 0 };
		const { view } = build({ ready: () => false, known: () => false, calls });
		view.load();
		await settle();
		view.unload();
		const before = calls.n;
		runTimers(9000);
		await settle();
		expect(calls.n).toBe(before);
	});

	it('a Canvas card whose section comes late stays read only and says so at once', async () => {
		const known = { v: false };
		const { view, el } = build({ known: () => known.v, cls: 'canvas-node' });
		view.load();
		await settle();
		runTimers(300);
		known.v = true;
		runTimers(3000);
		await settle();
		expect(el.querySelector('.dynasty-add-person')).toBeNull();
		expect(el.querySelector('.dynasty-read-only-label')).not.toBeNull();
	});
});

describe('number: getSectionInfo calls for a block that never gets a section (Canvas card, embed)', () => {
	it('counts the asks over the start wait and the 5 s look', async () => {
		const calls = { n: 0 };
		const { view } = build({ ready: () => false, known: () => false, calls });
		view.load();
		await settle();
		runTimers(8500);
		await settle();
		console.log('getSectionInfo calls per view, styles late (8 s):', calls.n);
		view.unload();
		const c2 = { n: 0 };
		const b = build({ ready: () => true, known: () => false, cls: 'markdown-reading-view', calls: c2 });
		b.view.load();
		await settle();
		runTimers(8500);
		await settle();
		console.log('getSectionInfo calls per view, styles ready, no section (6 s):', c2.n);
		// 30 trees in one note: 30 x calls. A block with a known section asks 1 time.
		expect(c2.n).toBeLessThanOrEqual(40);
	});
});
