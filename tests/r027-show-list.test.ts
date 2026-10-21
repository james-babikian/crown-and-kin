import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { carryState, endSessionFocus, newBlockState } from '../src/view/block-state';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { clearRelationCache } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { TreeView } from '../src/obsidian/tree-view';
import { SUCCESSION_UI as T } from '../src/render/ui-text';
import { FEl, clock, dispatch, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { embed, fakeHandle, fakeHost, fullViews, phone } from './acceptance/tree-view-fakes';
import { BODY_16 } from './r027-window-support';
import { accName } from './acceptance/accessible-name';

/*
 * Version 0.2.7, WP4 view (contract F.1, F.6, D185 item 5): the phone list while the Show view is open, and the block state. The list shows the
 * bar at its top with an icon-only Close; the row of each heir says "2nd in line" in place of the relation word; after Close the list is as before.
 */

beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => vi.restoreAllMocks());

const DUKE = 'duke-of-carrowmere';

async function openList(body = BODY_16.replace('options:\n', 'options:\n  me: bertram-carrow\n')) {
	phone();
	const handle = fakeHandle('n.md', body);
	const host = fakeHost({ ...DEFAULT_SETTINGS });
	const e = await embed(body, { host, handle });
	return { ...e, handle, host, st: handle.state, root: e.el };
}

async function redrawn(): Promise<void> {
	await settle();
	resizeAll();
	flushFrames();
}

/** Opens the view in the state and draws the list, with no full-screen view over it (a full-screen view over the note makes the list wait until it closes). */
async function showList(o: Awaited<ReturnType<typeof openList>>, title = DUKE): Promise<void> {
	o.st.succession = { title };
	TreeView.redrawState(o.host as never, o.st);
	await redrawn();
}

const row = (el: FEl, id: string) => el.querySelector(`.dynasty-list-row[data-person="${id}"]`);
const word = (el: FEl, id: string) => row(el, id)?.querySelector('.dynasty-list-word')?.getText() ?? null;
const listBar = (el: FEl) => el.querySelector('.dynasty-list-succession');

describe('F.6: the phone list while the view is open', () => {
	it('shows the bar at the top of the list with an icon-only Close, and the place of each heir in place of the relation word', async () => {
		const o = await openList();
		TreeView.focusState(o.host as never, o.st, 'bertram-carrow', null, o.view);
		await redrawn();
		// Before: the relation words of the list (the marked person is Bertram).
		expect(listBar(o.root)).toBeNull();
		expect(word(o.root, 'jasper-carrow')).toBe('Son');
		await showList(o);
		const bar = listBar(o.root)!;
		expect(bar).not.toBeNull();
		expect(bar.querySelector('.dynasty-succession-text')!.getText()).toBe('Line of succession: Duke of Carrowmere, now');
		const close = bar.querySelector('.dynasty-succession-close')!;
		// D182: an icon, no text, a name for the screen reader.
		expect(close.getText()).toBe('');
		expect(close.getAttribute('aria-label')).toBe(T.barCloseLabel);
		expect(close.querySelector('.dynasty-tool-icon')).not.toBeNull();
		expect(o.root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-succession')).toBe(DUKE);
		expect(word(o.root, 'jasper-carrow')).toBe('2nd in line');
		expect(accName(row(o.root, 'jasper-carrow')!.querySelector('.dynasty-list-go')!)).toContain('2nd in line');
		// A person who is not in the line keeps the relation word (Edwin died; his son is the 1st in line); the marked person is not in the line.
		expect(word(o.root, 'edwin-carrow')).toBe('Son');
		expect(word(o.root, 'harriet-carrow')).toBe('Daughter');
		expect(word(o.root, 'bertram-carrow')).toBe('You');
		// The list still has its rows and its toolbar.
		expect(o.root.querySelector('.dynasty-toolbar')).not.toBeNull();
	});

	it('Close ends the view, the list is as before and the centre person does not change', async () => {
		const o = await openList();
		TreeView.focusState(o.host as never, o.st, 'bertram-carrow', null, o.view);
		await redrawn();
		const before = ids(o.root);
		await showList(o);
		dispatch(listBar(o.root)!.querySelector('.dynasty-succession-close')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await redrawn();
		expect(o.st.succession).toBeNull();
		expect(listBar(o.root)).toBeNull();
		expect(word(o.root, 'jasper-carrow')).toBe('Son');
		expect(ids(o.root)).toEqual(before);
		expect(o.root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-focus')).toBe('bertram-carrow');
	});

	it('a tap on a name of the list moves the list and ends the view (a focus choice)', async () => {
		const o = await openList();
		TreeView.focusState(o.host as never, o.st, 'bertram-carrow', null, o.view);
		await redrawn();
		await showList(o);
		dispatch(row(o.root, 'jasper-carrow')!.querySelector('.dynasty-list-go')!, 'click', { button: 0, detail: 1, pointerType: 'touch' });
		await redrawn();
		expect(o.st.succession).toBeNull();
		expect(listBar(o.root)).toBeNull();
	});

	it('a line with no heir shows the sentence with "No heir in the tree." in the bar', async () => {
		const body = ['titles:', '  - id: crown', '    name: Crown', '    succession: eldest-child', '    holders:', '      - {person: rex, from: 1100}', 'people:', '  - {id: rex, name: Rex Ardent, sex: m, born: 1070}', ''].join('\n');
		const o = await openList(body);
		await showList(o, 'crown');
		expect(listBar(o.root)!.querySelector('.dynasty-succession-text')!.getText()).toBe('Line of succession: Crown, now. No heir in the tree.');
	});

	it('the setting "Length of the line" redraws the list', async () => {
		const o = await openList();
		TreeView.focusState(o.host as never, o.st, 'bertram-carrow', null, o.view);
		await redrawn();
		await showList(o);
		expect(word(o.root, 'jasper-carrow')).toBe('2nd in line');
		const prev = o.host.settings!;
		o.host.settings = { ...prev, successionLength: 1 };
		o.view.onSettingsChange(prev);
		await redrawn();
		expect(word(o.root, 'jasper-carrow')).toBe('Son');
	});

	it('a row of an open branch says "Open branch"', async () => {
		const body = [
			'titles:',
			'  - id: crown',
			'    name: Crown',
			'    succession: eldest-child',
			'    holders:',
			'      - {person: rex, from: 1100}',
			'people:',
			'  - {id: rex, name: Rex Ardent, sex: m, born: 1070}',
			'  - {id: kid, name: Kid Ardent, sex: m, born: 1100, parents: [rex]}',
			'  - {id: lost, name: Lost Ardent, sex: m, born: 1103, died: 1112, parents: [rex]}',
			'',
		].join('\n');
		const o = await openList(body);
		TreeView.focusState(o.host as never, o.st, 'rex', null, o.view);
		await redrawn();
		await showList(o, 'crown');
		expect(word(o.root, 'kid')).toBe('1st in line');
		expect(word(o.root, 'lost')).toBe('Open branch');
	});
});

const ids = (el: FEl) => el.querySelectorAll('.dynasty-list-row').map((r) => r.getAttribute('data-person')!);

describe('E.4: Show with only a phone list on the page', () => {
	it('opens the full-screen view with the bar, as the finder does', async () => {
		const o = await openList();
		TreeView.showSuccession(o.host as never, o.st, DUKE, o.view);
		await redrawn();
		expect(fullViews()).toHaveLength(1);
		const full = (fullViews()[0] as unknown as { containerEl: FEl }).containerEl;
		expect(full.querySelector('.dynasty-succession-text')!.getText()).toBe('Line of succession: Duke of Carrowmere, now');
		expect(full.querySelector('.dynasty-root')!.getAttribute('data-dynasty-succession')).toBe(DUKE);
	});
});

describe('F.1: the block state', () => {
	it('starts empty, ends with the note, and moves to a new handle', () => {
		const a = newBlockState();
		expect(a.succession).toBeNull();
		a.succession = { title: DUKE };
		const b = newBlockState();
		carryState(a, b);
		expect(b.succession).toEqual({ title: DUKE });
		// A field that the new state already holds stays.
		const c = newBlockState();
		c.succession = { title: 'other' };
		carryState(a, c);
		expect(c.succession).toEqual({ title: 'other' });
		endSessionFocus(b);
		expect(b.succession).toBeNull();
	});
});
