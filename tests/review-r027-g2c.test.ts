import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import type { Op } from '../src/core/edit';
import { applyOp } from '../src/core/yaml-edit';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/view/plugin-modals';
import { clearRelationCache } from '../src/view/relation-cache';
import { TreeView } from '../src/obsidian/tree-view';
import { carryState, newBlockState } from '../src/view/block-state';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fullViews, phone, type FakeHandle, type Host } from './acceptance/tree-view-fakes';
import { BODY_16 } from './r027-window-support';

// Review G2c of 0.2.7 WP4 (view). Each test fails on release-0.2.7 de013fc and shows one defect.

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	closePluginModals();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const DUKE = 'duke-of-carrowmere';
const LINE = ['fenwick-carrow', 'jasper-carrow', 'cedric-carrow', 'dunstan-carrow'];

function noteHandle(body: string): FakeHandle {
	const h = fakeHandle('n.md', body);
	h.write.mockImplementation((async (op: Op) => {
		const r = applyOp(h.body, op);
		if (!r.ok) return { ok: false, code: 'refused', refusal: r };
		h.change(r.body);
		return { ok: true, body: r.body, created: r.created, effects: r.effects ?? [] };
	}) as never);
	return h;
}

async function desk(body = BODY_16, host: Host = fakeHost()) {
	desktop();
	const handle = noteHandle(body);
	const e = await embed(body, { host, handle });
	return { ...e, handle, root: e.el, st: handle.state };
}

async function redrawn(): Promise<void> {
	await settle();
	resizeAll();
	flushFrames();
}

async function show(e: { host: Host; st: ReturnType<typeof noteHandle>['state']; view: TreeView }, title = DUKE): Promise<void> {
	TreeView.showSuccession(e.host as never, e.st, title, e.view);
	await redrawn();
}

const card = (root: FEl, id: string) => root.querySelector(`.dynasty-card[data-person="${id}"]`)!;

describe('F.2: the outline of an heir', () => {
	it('every heir card that the view has filled has the heir class and no second ring (0.2.8, D212: the outline is the border of the card)', async () => {
		const e = await desk();
		await show(e);
		const filled = LINE.filter((id) => card(e.root, id).querySelector('.dynasty-card-full'));
		expect(filled.length, 'the first view fills the heir cards').toBe(LINE.length);
		expect(filled.filter((id) => card(e.root, id).hasClass('dynasty-heir'))).toEqual(filled);
		expect(filled.filter((id) => card(e.root, id).querySelector('.dynasty-heir-ring'))).toEqual([]);
	});
});

describe('F.1: one temporary view at a time', () => {
	it('carryState never leaves both a finder and a Show view on one block state', () => {
		const from = newBlockState();
		from.succession = { title: DUKE };
		const to = newBlockState();
		to.finder = { first: 'a', second: 'b', index: 0, whole: false, steps: false };
		carryState(from, to);
		expect(to.finder !== null && to.succession !== null).toBe(false);
	});
});

describe('F.1, F.6: the phone list follows the block state', () => {
	it('a relation finder opened in the full-screen view ends the Show view in the list under it too', async () => {
		phone();
		const body = BODY_16.replace('options:\n', 'options:\n  me: bertram-carrow\n');
		const handle = fakeHandle('n.md', body);
		const host = fakeHost({ ...DEFAULT_SETTINGS });
		const o = await embed(body, { host, handle });
		const st = handle.state;
		TreeView.showSuccession(host as never, st, DUKE, o.view);
		await redrawn();
		expect(fullViews()).toHaveLength(1);
		expect(o.el.querySelector('.dynasty-list-succession'), 'the list shows the bar').not.toBeNull();
		const full = fullViews()[0] as unknown as { view?: TreeView; close(): void };
		// The relation finder in the full-screen view replaces the Show view (F.1).
		TreeView.showFinder(host as never, st, 'bertram-carrow', 'fenwick-carrow', [...host.views].find((v) => (v as unknown as { full?: unknown }).full) as never);
		await redrawn();
		expect(st.succession).toBeNull();
		full.close();
		await redrawn();
		expect(o.el.querySelector('.dynasty-list-succession'), 'the list still shows a Show view that has ended').toBeNull();
	});

	it('control: a focus choice in the full-screen view clears the bar in the list (this passes)', async () => {
		phone();
		const body = BODY_16.replace('options:\n', 'options:\n  me: bertram-carrow\n');
		const handle = fakeHandle('n.md', body);
		const host = fakeHost({ ...DEFAULT_SETTINGS });
		const o = await embed(body, { host, handle });
		const st = handle.state;
		TreeView.showSuccession(host as never, st, DUKE, o.view);
		await redrawn();
		const full = fullViews()[0] as unknown as { close(): void };
		TreeView.focusState(host as never, st, 'bertram-carrow', null, [...host.views].find((v) => (v as unknown as { full?: unknown }).full) as never);
		await redrawn();
		full.close();
		await redrawn();
		expect(o.el.querySelector('.dynasty-list-succession')).toBeNull();
	});
});
