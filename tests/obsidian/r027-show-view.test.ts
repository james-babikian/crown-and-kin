import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { foldFamilies } from '../../src/core/folds';
import type { Op } from '../../src/core/edit';
import { applyOp } from '../../src/core/yaml-edit';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { closePluginModals } from '../../src/view/plugin-modals';
import { clearRelationCache } from '../../src/view/relation-cache';
import { makePicture } from '../../src/obsidian/save-picture';
import { DEFAULT_SETTINGS } from '../../src/view/settings';
import { TitlesWindow, type TitlesOptions } from '../../src/obsidian/titles-window';
import { TreeView } from '../../src/obsidian/tree-view';
import { SUCCESSION_UI as T } from '../../src/render/ui-text';
import { FEl, clock, dispatch, fakeDoc, fakeWin, flushFrames, resetDom, resizeAll, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, openFullScreen, phone, type FakeHandle, type Host } from '../acceptance/tree-view-fakes';
import { build } from '../support/helpers';
import { BODY_16 } from '../support/r027-window-support';
import { sample12 } from '../acceptance/relations-support';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * Version 0.2.7, WP4 view (contract F, M.9): the Show view of the line of succession in the tree view. The real views run on the fake
 * DOM with sample tree 16: the Duke of Carrowmere has the line fenwick-carrow, jasper-carrow, cedric-carrow, dunstan-carrow.
 */

useFakeDom({ window: true });

/** The keydown listeners of the window, so a test can send Esc to the view (the fake window cannot carry a key). */
const keyListeners: ((e: unknown) => void)[] = [];
const sendKey = (key: string) => {
	const e = { type: 'keydown', key, target: fakeWin, defaultPrevented: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
	for (const fn of [...keyListeners]) fn(e);
};

beforeEach(() => {
	keyListeners.length = 0;
	const add = fakeWin.addEventListener.bind(fakeWin);
	vi.spyOn(fakeWin, 'addEventListener').mockImplementation(((type: string, fn: never, o?: never) => {
		if (type === 'keydown') keyListeners.push(fn);
		add(type, fn, o);
	}) as never);
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

/** A computer embed on `body` with a handle that can be edited. */
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

/** Opens the Show view as the Titles window does after Show. */
async function show(e: { host: Host; st: ReturnType<typeof noteHandle>['state']; view: TreeView }, title = DUKE): Promise<void> {
	TreeView.showSuccession(e.host as never, e.st, title, e.view);
	await redrawn();
}

const card = (root: FEl, id: string) => root.querySelector(`.dynasty-card[data-person="${id}"]`);
const heirs = (root: FEl) => root.querySelectorAll('.dynasty-card.dynasty-heir').map((c) => c.getAttribute('data-person')!);
const tabs = (root: FEl) => root.querySelectorAll('.dynasty-card').flatMap((c) => c.querySelectorAll('.dynasty-ordinal-tab-text').map((t) => [c.getAttribute('data-person')!, t.getText()] as const));
const bar = (root: FEl) => root.querySelector('.dynasty-succession-text')?.getText() ?? null;
const scale = (root: FEl) => Number(/scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')!.getAttribute('transform')!)![1]);
const press = async (root: FEl, sel: string) => {
	dispatch(root.querySelector(sel)!, 'click', { button: 0, detail: 1 });
	await redrawn();
};

describe('F.1, F.2, F.3: the Show view on the computer', () => {
	it('shows the whole tree with the bar, the outlines and the tabs of the heirs', async () => {
		const e = await desk();
		await show(e);
		fillAllCards(e.root);
		const root = e.root.querySelector('.dynasty-root')!;
		expect(root.getAttribute('data-dynasty-succession')).toBe(DUKE);
		expect(bar(e.root)).toBe('Line of succession: Duke of Carrowmere, now');
		expect(bar(e.root)).toBe(T.bar('Duke of Carrowmere', null));
		expect(heirs(e.root).sort()).toEqual([...LINE].sort());
		// The ordinal texts are the order of the line; the ruler has no tab.
		expect(tabs(e.root).sort()).toEqual(LINE.map((id, i) => [id, ['1st', '2nd', '3rd', '4th'][i]] as const).sort());
		expect(card(e.root, 'bertram-carrow')!.hasClass('dynasty-heir')).toBe(false);
		// The whole tree: no focus family, so every person of the tree has a card (the finder's small tree would have a few).
		const people = build(BODY_16).g.people.length;
		expect(root.getAttribute('data-dynasty-people')).toBe(String(people));
	});

	it('the Close button ends the view and the focus goes to More', async () => {
		const e = await desk();
		await show(e);
		const close = e.root.querySelector('.dynasty-succession-close')!;
		expect(close.getText()).toBe('Close');
		expect(close.getAttribute('aria-label')).toBe('Close the line of succession');
		await press(e.root, '.dynasty-succession-close');
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
		expect(e.root.querySelectorAll('.dynasty-card.dynasty-heir')).toHaveLength(0);
		expect(e.root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-succession')).toBeNull();
	});

	it('Esc ends the view when the focus is inside the tree', async () => {
		const e = await desk();
		await show(e);
		const viewport = e.root.querySelector('.dynasty-viewport') as FEl;
		const inside = e.root.querySelector('.dynasty-card') as FEl;
		fakeDoc.activeElement = inside;
		expect(viewport.contains(inside)).toBe(true);
		sendKey('Escape');
		await redrawn();
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
	});

	it('the first view shows the ruler and the heirs below the bar; the view is not stored as the family view', async () => {
		const e = await desk();
		const before = e.st.view;
		await show(e);
		const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(e.root.querySelector('.dynasty-scene')!.getAttribute('transform')!)!;
		const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const vp = e.root.querySelector('.dynasty-viewport') as FEl;
		for (const id of ['bertram-carrow', ...LINE]) {
			const bg = card(e.root, id)!.querySelector('.dynasty-card-bg')!;
			const x = tx + Number(bg.getAttribute('x')) * s;
			const y = ty + Number(bg.getAttribute('y')) * s;
			expect(x, id).toBeGreaterThanOrEqual(-0.5);
			expect(x + Number(bg.getAttribute('width')) * s, id).toBeLessThanOrEqual(vp.clientWidth + 0.5);
			expect(y, id).toBeGreaterThanOrEqual(-0.5);
			expect(y + Number(bg.getAttribute('height')) * s, id).toBeLessThanOrEqual(vp.clientHeight + 0.5);
		}
		expect(e.st.view).toBe(before);
	});

	it('a focus choice ends the view', async () => {
		const e = await desk();
		await show(e);
		TreeView.focusState(e.host as never, e.st, 'bertram-carrow', null, e.view);
		await redrawn();
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
	});

	it('the relation finder replaces the view, and the view replaces the finder', async () => {
		const e = await desk();
		await show(e);
		TreeView.showFinder(e.host as never, e.st, 'bertram-carrow', 'fenwick-carrow', e.view);
		await redrawn();
		expect(e.st.succession).toBeNull();
		expect(e.root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder')).toBe('line');
		expect(bar(e.root)).toBeNull();
		await show(e);
		expect(e.st.finder).toBeNull();
		expect(bar(e.root)).not.toBeNull();
		expect(e.root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder')).toBeNull();
	});

	it('an edit that leaves no line closes the view; an edit that keeps it keeps the view', async () => {
		const e = await desk();
		await show(e);
		e.handle.change(BODY_16.replace('name: Fenwick Carrow', 'name: Fenwick Carrow II'));
		await redrawn();
		expect(e.st.succession).toEqual({ title: DUKE });
		expect(bar(e.root)).not.toBeNull();
		const noRule = BODY_16.replace(/(id: duke-of-carrowmere\n(?:.*\n)*?)    succession: eldest-child\n/, '$1');
		expect(noRule).not.toBe(BODY_16);
		e.handle.change(noRule);
		await redrawn();
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
	});

	it('a title that is gone closes the view', async () => {
		const e = await desk();
		await show(e, 'no-such-title');
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
	});

	it('a title with no heir shows the sentence with "No heir in the tree." and no tab', async () => {
		const body = ['titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    holders:', '      - {person: rex, from: 1100}', 'people:', '  - {id: rex, name: Rex Ardent, sex: m, born: 1070}', ''].join('\n');
		const e = await desk(body);
		await show(e, 'crown');
		expect(bar(e.root)).toBe('Line of succession: Crown, now. No heir in the tree.');
		expect(bar(e.root)).toBe(T.barNoHeir('Crown', null));
		expect(e.root.querySelectorAll('.dynasty-ordinal-tab-text')).toHaveLength(0);
		expect(e.st.succession).toEqual({ title: 'crown' });
	});

	it('the setting "Length of the line" redraws an open view', async () => {
		const host = fakeHost({ ...DEFAULT_SETTINGS });
		const e = await desk(BODY_16, host);
		await show(e);
		expect(heirs(e.root)).toHaveLength(4);
		const prev = host.settings!;
		host.settings = { ...prev, successionLength: 2 };
		e.view.onSettingsChange(prev);
		await redrawn();
		expect(heirs(e.root).sort()).toEqual(['fenwick-carrow', 'jasper-carrow']);
		// The age of the warning needs no redraw.
		const root = e.root.querySelector('.dynasty-root');
		const p2 = host.settings;
		host.settings = { ...p2, oldAge: 50 };
		e.view.onSettingsChange(p2);
		expect(e.root.querySelector('.dynasty-root')).toBe(root);
	});
});

describe('the card label (F.4)', () => {
	it('adds ", 2nd in line" for an heir and nothing for the ruler', async () => {
		const e = await desk();
		await show(e);
		expect(card(e.root, 'jasper-carrow')!.getAttribute('aria-label')).toMatch(/, 2nd in line$/);
		expect(card(e.root, 'fenwick-carrow')!.getAttribute('aria-label')).toMatch(/, 1st in line$/);
		expect(card(e.root, 'bertram-carrow')!.getAttribute('aria-label')).not.toContain('in line');
		await press(e.root, '.dynasty-succession-close');
		expect(card(e.root, 'jasper-carrow')!.getAttribute('aria-label')).not.toContain('in line');
	});
});

describe('F.2: folds open for the ruler and the heirs', () => {
	it('a fold that hides an heir is open while the view shows and applies again after Close', async () => {
		const e = await desk();
		const g = build(BODY_16).g;
		const keys = foldFamilies(g).map((f) => f.key);
		expect(keys.length).toBeGreaterThan(0);
		e.st.folds = new Set(keys);
		TreeView.redrawState(e.host as never, e.st);
		await redrawn();
		const hiddenBefore = LINE.filter((id) => !card(e.root, id));
		expect(hiddenBefore.length).toBeGreaterThan(0);
		await show(e);
		expect(LINE.filter((id) => !card(e.root, id))).toEqual([]);
		expect(card(e.root, 'bertram-carrow')).not.toBeNull();
		await press(e.root, '.dynasty-succession-close');
		expect(LINE.filter((id) => !card(e.root, id))).toEqual(hiddenBefore);
	});
});

describe('the key of the view', () => {
	it('the family key has the prefix, so the saved view of the family stays', async () => {
		const e = await desk();
		(e.view as unknown as { familyKey: string | null }).familyKey = null;
		await show(e);
		const v = e.view as unknown as { familyKey: string; drawnKey: string };
		expect(v.familyKey.startsWith(`succession:${DUKE}|`)).toBe(true);
		expect(v.drawnKey.startsWith(`succession:${DUKE}|`)).toBe(true);
	});
});

describe('E.4, K.10: the Titles window opens the view', () => {
	it('More, Titles gives the window showLine and the settings; showLine opens the view', async () => {
		const e = await desk();
		const created: TitlesOptions[] = [];
		const real = TitlesWindow.create.bind(TitlesWindow);
		vi.spyOn(TitlesWindow, 'create').mockImplementation(((app: never, o: TitlesOptions) => {
			created.push(o);
			return real(app, o);
		}) as never);
		await press(e.root, '.dynasty-titles-button');
		expect(created).toHaveLength(1);
		const o = created[0];
		expect([o.succession?.limit(), o.succession?.oldAge(), o.succession?.youngDeathAge?.()]).toEqual([5, 110, 0]);
		for (const m of [...openModals]) m.close();
		o.showLine!(DUKE);
		await redrawn();
		expect(e.st.succession).toEqual({ title: DUKE });
		expect(bar(e.root)).toBe(T.bar('Duke of Carrowmere', null));
	});

	it('the settings come from the host at the moment of the call', async () => {
		const host = fakeHost({ ...DEFAULT_SETTINGS, successionLength: 3, oldAge: 60, youngDeathAge: 12 });
		const e = await desk(BODY_16, host);
		const created: TitlesOptions[] = [];
		const real = TitlesWindow.create.bind(TitlesWindow);
		vi.spyOn(TitlesWindow, 'create').mockImplementation(((app: never, o: TitlesOptions) => {
			created.push(o);
			return real(app, o);
		}) as never);
		await press(e.root, '.dynasty-titles-button');
		expect([created[0].succession?.limit(), created[0].succession?.oldAge(), created[0].succession?.youngDeathAge?.()]).toEqual([3, 60, 12]);
		host.settings = { ...host.settings!, successionLength: 7 };
		expect(created[0].succession?.limit()).toBe(7);
	});
});

describe('F.2: the first view on a phone', () => {
	it('keeps a scale of 0.75 or more and starts at the ruler', async () => {
		phone();
		const { root, handle, host } = await openFullScreen(BODY_16);
		TreeView.showSuccession(host as never, handle!.state, DUKE, null);
		await redrawn();
		expect(root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-succession')).toBe(DUKE);
		expect(bar(root)).toBe(T.bar('Duke of Carrowmere', null));
		expect(scale(root)).toBeGreaterThanOrEqual(0.75 - 1e-9);
		// The ruler's card lies in the view.
		const m = /translate\(([-\d.e]+)[ ,]([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(root.querySelector('.dynasty-scene')!.getAttribute('transform')!)!;
		const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
		const bg = card(root, 'bertram-carrow')!.querySelector('.dynasty-card-bg')!;
		const vp = root.querySelector('.dynasty-viewport') as FEl;
		const x = tx + Number(bg.getAttribute('x')) * s;
		const y = ty + Number(bg.getAttribute('y')) * s;
		expect(x).toBeGreaterThanOrEqual(-0.5);
		expect(x + Number(bg.getAttribute('width')) * s).toBeLessThanOrEqual(vp.clientWidth + 0.5);
		expect(y).toBeGreaterThanOrEqual(-0.5);
		expect(y + Number(bg.getAttribute('height')) * s).toBeLessThanOrEqual(vp.clientHeight + 0.5);
	});

	it('Close ends the view in the full-screen view', async () => {
		phone();
		const { root, handle, host } = await openFullScreen(BODY_16);
		TreeView.showSuccession(host as never, handle!.state, DUKE, null);
		await redrawn();
		await press(root, '.dynasty-succession-close');
		expect(handle!.state.succession).toBeNull();
		expect(bar(root)).toBeNull();
	});
});

describe('F.5: the saved picture', () => {
	it('gets the tabs, the outlines and the sentence while the view is open', async () => {
		const e = await desk();
		await show(e);
		const src = (e.view as unknown as { saveSource(): { succession?: { sentence: string; ordinalCards: string[]; heirs: string[] } } & Record<string, unknown> }).saveSource();
		expect(src.succession?.sentence).toBe(T.bar('Duke of Carrowmere', null));
		expect(src.succession?.heirs).toEqual(LINE);
		const svg = new TextDecoder().decode((await makePicture(undefined, src as never, 'svg')).bytes);
		expect(svg).toContain('Line of succession: Duke of Carrowmere, now');
		for (const id of LINE) {
			expect(svg).toContain(`data-item="heir:${id}"`);
			expect(svg).toContain(`data-item="ordinal:${id}"`);
		}
		expect(svg).not.toContain('data-item="heir:bertram-carrow"');
	});

	it('has none of it when the view is closed', async () => {
		const e = await desk();
		const src = (e.view as unknown as { saveSource(): Record<string, unknown> }).saveSource();
		expect(src.succession).toBeUndefined();
		const svg = new TextDecoder().decode((await makePicture(undefined, src as never, 'svg')).bytes);
		expect(svg).not.toContain('data-item="heir:');
		expect(svg).not.toContain('Line of succession');
	});
});

describe('the layout and the scene get the heirs (F.4)', () => {
	it('the layout of the view has the ordinal cards; the scene has the tabs; a marked heir has no "You" tab', async () => {
		const marked = BODY_16.replace('options:\n', 'options:\n  me: jasper-carrow\n');
		const e = await desk(marked);
		await show(e);
		fillAllCards(e.root);
		const laid = (e.view as unknown as { laid: { layout: { ordinalCards?: readonly string[]; youTab?: string } } }).laid;
		expect([...(laid.layout.ordinalCards ?? [])].sort()).toEqual([...LINE].sort());
		const jasper = card(e.root, 'jasper-carrow')!;
		expect(jasper.querySelectorAll('.dynasty-r1-tab-group')).toHaveLength(0);
		expect(jasper.querySelector('.dynasty-ordinal-tab-text')!.getText()).toBe('2nd');
	});
});

describe('the sample tree 12 has no title: the view cannot open', () => {
	it('a block with no titles keeps its normal tree', async () => {
		const e = await desk(sample12().source);
		await show(e, 'duke');
		expect(e.st.succession).toBeNull();
		expect(bar(e.root)).toBeNull();
	});
});
