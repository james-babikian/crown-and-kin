import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { TreeView } from '../../src/obsidian/tree-view';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, settle } from './fake-dom';
import { resetObsidian } from './fake-obsidian';
import { block15, comments15 } from './m10-support';
import { desktop, embed, fakeHandle, fullViews, phone } from './tree-view-fakes';

/*
 * Adopted from the M10 review B (`m10/review-b`): folds in the Obsidian views (spec §13.10, F11, F12).
 * The first two cases wait for the fix round (B1: a view that cannot fold must not open the block's
 * folds). This file is separate from `m10-fold-view.test.ts` on purpose: views left open by the cases
 * of that file make the finder and Find cases fail when both run in one file.
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
const SOURCE = block15(0);
const key = (name: string) => F.folds.get(name)!.key;
const folds = (h: { state: unknown }) => (h.state as { folds: Set<string> }).folds;
const handleWith = (...names: string[]) => {
	const handle = fakeHandle('n.md', SOURCE);
	folds(handle).clear();
	for (const n of names) folds(handle).add(key(n));
	return handle;
};
const run = async () => {
	await settle();
	clock.now += 2000;
	flushFrames();
};
const cardCount = (el: FEl) => el.querySelectorAll('.dynasty-card').length;
const inner = (view: TreeView) => view as unknown as { focusOn(id: string | null): void; showFound(id: string): void };

describe('static phone preview never applies folds, so it must not end them', () => {
	it('Focus on a person in the static preview leaves the block folds (made in the full-screen view) as they are', async () => {
		phone();
		const handle = handleWith('A');
		const { el, view } = await embed(SOURCE, { handle });
		expect(cardCount(el)).toBe(96);
		inner(view).focusOn('corwin');
		await run();
		// The preview shows no fold; the full-screen view of the same block still owes the user fold A.
		expect(folds(handle)).toEqual(new Set([key('A')]));
	});
});

describe('static phone preview: a sheet write', () => {
	it('an ok write in the static preview leaves the block folds as they are (the preview shows none)', async () => {
		phone();
		const handle = handleWith('A');
		const { view } = await embed(SOURCE, { handle });
		const c = view.constructor as unknown as { unfoldAfterWrite(host: unknown, st: unknown, full: boolean, ids: string[], body: string): void };
		c.unfoldAfterWrite((view as unknown as { host: unknown }).host, (handle as unknown as { state: object }).state, false, ['corwin'], SOURCE);
		await run();
		expect(folds(handle)).toEqual(new Set([key('A')]));
	});
});

describe('finder and folds', () => {
	it('while a result shows the line people show; after Close the fold hides them again and st.folds never changed', async () => {
		const handle = handleWith('A');
		const { el, view } = await embed(SOURCE, { handle });
		const V = view.constructor as unknown as {
			showFinder(host: unknown, st: unknown, a: string, b: string, o: unknown): void;
			redrawState(host: unknown, st: unknown, o: object): void;
		};
		const host = (view as unknown as { host: unknown }).host;
		const st = (handle as unknown as { state: { finder: unknown } }).state;
		V.showFinder(host, st, 'osric', 'corwin', view);
		await run();
		expect(el.querySelector('.dynasty-card[data-person="corwin"]')).not.toBeNull();
		expect(folds(handle)).toEqual(new Set([key('A')]));
		st.finder = null;
		V.redrawState(host, st, {});
		await run();
		expect(el.querySelector('.dynasty-card[data-person="corwin"]')).toBeNull();
		expect(folds(handle)).toEqual(new Set([key('A')]));
	});
});

describe('F11: Find outside the focus family', () => {
	it('shows a hidden person that lies outside the focus family, and opens only the fold that hides them', async () => {
		const handle = handleWith('A', 'B');
		const { el, view } = await embed(SOURCE, { handle });
		inner(view).focusOn('wanda');
		await run();
		expect(el.querySelector('.dynasty-card[data-person="bertha"]')).toBeNull();
		inner(view).showFound('bertha');
		await run();
		expect(el.querySelector('.dynasty-card[data-person="bertha"]')).not.toBeNull();
		expect(folds(handle).has(key('B'))).toBe(true);
	});
});
