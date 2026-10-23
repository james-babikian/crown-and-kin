import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Geometry } from '../../src/layout/model';
import { FullScreenModal } from '../../src/obsidian/full-screen';
import { clearRelationCache, relationsFor } from '../../src/view/relation-cache';
import { makePicture, type SaveSource } from '../../src/obsidian/save-picture';
import { DEFAULT_SETTINGS, type DynastySettings } from '../../src/view/settings';
import { TreeView } from '../../src/obsidian/tree-view';
import { clearMeasureCache } from '../../src/render/dom/measure';
import { FEl, clock, flushFrames, resetDom, resizeAll } from '../acceptance/fake-dom';
import { resetObsidian } from '../acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, phone } from '../acceptance/tree-view-fakes';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * 0.2.5, WP-C2b, the hunks of section B in the tree view (CONTRACT B.3.4, B.3.11, B.4): the card form of the drawn orientation,
 * the plate that follows "Show relation names on cards" (it changes the layout), the "You" tab when the plate is off, the small
 * tree of the relation finder, and the geometry of the saved picture. The numbers are those of B.3.1 at a 16 px note font
 * (the fake DOM reads 16 px): a card in a tree with no picture is 61 px high, 77 px with the plate.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
	FullScreenModal.openViews.clear();
	clearRelationCache();
	clearMeasureCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

const PEOPLE = `people:
  - {id: ann, name: Ann Valmont, born: 1100}
  - {id: bo, name: Bo Valmont, born: 1130, parents: [ann]}
  - {id: cy, name: Cy Valmont, born: 1160, parents: [bo]}
`;
const MARKED = `options:\n  me: bo\n${PEOPLE}`;

interface Peek {
	saveSource(): SaveSource | null;
	lastLayout: { geo: Geometry; settings: { relationLine?: boolean; youTab?: string; orientation?: string }; opts: { relations?: { get(id: string): unknown } } };
}

const cardH = (root: FEl, id: string) => Number(root.querySelector(`.dynasty-card[data-person="${id}"] .dynasty-card-bg`)!.getAttribute('height'));
const count = (root: FEl, sel: string) => root.querySelectorAll(sel).length;
const tabs = (root: FEl) => root.querySelectorAll('.dynasty-r1-tab-group').length;

async function drawn(src: string, settings: DynastySettings = DEFAULT_SETTINGS) {
	desktop();
	const host = fakeHost(settings);
	const e = await embed(src, { host, handle: fakeHandle('n.md', src) });
	fillAllCards(e.el);
	return { ...e, host, peek: e.view as unknown as Peek };
}

describe('the plate and the "You" tab follow the setting (D145, D148)', () => {
	it('with a mark and the setting on: Roundel cards with the plate, no tab', async () => {
		const { el, peek } = await drawn(MARKED);
		expect([cardH(el, 'ann'), cardH(el, 'bo'), cardH(el, 'cy')]).toEqual([77, 77, 77]);
		expect(count(el, '.dynasty-card-r1')).toBe(3);
		expect(count(el, '.dynasty-card-foot-line')).toBe(3); // 0.2.8: the foot hairline replaces the plate
		expect(tabs(el)).toBe(0);
		expect(peek.lastLayout.geo.form).toBe('roundel');
		expect(peek.lastLayout.settings.relationLine).toBe(true);
		expect(peek.lastLayout.settings.youTab).toBeUndefined();
		expect(el.querySelectorAll('.dynasty-card-relation').map((n) => n.getText()).sort()).toEqual(['Child', 'Parent', 'You']);
	});

	it('with a mark and the setting off: shorter cards, no plate, no word, the tab on the marked card, the label keeps the relation', async () => {
		const { el, peek } = await drawn(MARKED, { ...DEFAULT_SETTINGS, showRelations: false });
		expect([cardH(el, 'ann'), cardH(el, 'bo'), cardH(el, 'cy')]).toEqual([61, 61, 61]);
		expect(count(el, '.dynasty-card-foot-line')).toBe(0);
		expect(count(el, '.dynasty-card-relation')).toBe(0);
		expect(tabs(el)).toBe(1);
		expect(el.querySelector('.dynasty-card[data-person="bo"] .dynasty-r1-tab-group')).not.toBeNull();
		expect(peek.lastLayout.settings.youTab).toBe('bo');
		expect(peek.lastLayout.settings.relationLine).toBeUndefined();
		// The scene still gets the words, so the screen-reader label says how the person is related to you.
		const cards = relationsFor(build(MARKED).g, 'bo').cards;
		for (const id of ['ann', 'bo', 'cy']) expect(peek.lastLayout.opts.relations?.get(id), id).toEqual(cards.get(id));
		expect(el.querySelector('.dynasty-card[data-person="cy"]')!.getAttribute('aria-label')).toContain(cards.get('cy')!.lower);
		expect(el.querySelector('.dynasty-root')!.hasClass('dynasty-no-relations')).toBe(false);
	});

	it('with no mark: no plate and no tab, whatever the setting says', async () => {
		const { el } = await drawn(PEOPLE);
		expect([cardH(el, 'ann'), cardH(el, 'bo')]).toEqual([61, 61]);
		expect(count(el, '.dynasty-card-foot-line')).toBe(0);
		expect(tabs(el)).toBe(0);
	});

	it('a change of the setting lays the tree out again with the other card height', async () => {
		const settings = { ...DEFAULT_SETTINGS };
		const { el, view, host } = await drawn(MARKED, settings);
		const before = host.renders;
		const prev = { ...settings };
		settings.showRelations = false;
		view.onSettingsChange(prev);
		resizeAll();
		flushFrames();
		fillAllCards(el);
		expect(host.renders).toBe((before ?? 0) + 1);
		expect(cardH(el, 'ann')).toBe(61);
		expect(tabs(el)).toBe(1);
		const prev2 = { ...settings };
		settings.showRelations = true;
		view.onSettingsChange(prev2);
		resizeAll();
		flushFrames();
		fillAllCards(el);
		expect(cardH(el, 'ann')).toBe(77);
		expect(tabs(el)).toBe(0);
	});

	it('with no mark a change of the setting changes no layout', async () => {
		const settings = { ...DEFAULT_SETTINGS };
		const { view, host } = await drawn(PEOPLE, settings);
		const before = host.renders;
		const prev = { ...settings };
		settings.showRelations = false;
		view.onSettingsChange(prev);
		expect(host.renders).toBe(before);
	});

	it('a stored card size is ignored (D179): the tree draws the Roundel', async () => {
		const stored = { ...DEFAULT_SETTINGS, cardSize: 'compact', showRelations: false } as unknown as DynastySettings;
		const { el, peek } = await drawn(MARKED, stored);
		expect(peek.lastLayout.geo.form).toBe('roundel');
		expect(count(el, '.dynasty-card-r1')).toBeGreaterThan(0);
		expect(tabs(el)).toBe(1);
	});
});

describe('the card form follows the direction (D150)', () => {
	async function full(src: string, settings: DynastySettings = DEFAULT_SETTINGS) {
		const { openFullScreen } = await import('../acceptance/tree-view-fakes');
		const host = fakeHost(settings);
		const r = await openFullScreen(src, { host });
		fillAllCards(r.root);
		const view = [...host.views][0] as unknown as Peek;
		return { ...r, host, peek: view };
	}

	it('a phone held upright draws the text card, sideways', async () => {
		phone();
		const { root, peek } = await full(MARKED);
		expect(root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-orientation')).toBe('sideways');
		expect(peek.lastLayout.geo.form).toBe('text');
		expect(count(root, '.dynasty-card-tc')).toBe(3);
		expect(count(root, '.dynasty-card-r1')).toBe(0);
	});

	it('"Like the computer" draws the Roundel top to bottom on the same phone', async () => {
		phone();
		const { root, peek } = await full(MARKED, { ...DEFAULT_SETTINGS, phoneDirection: 'down' });
		expect(root.querySelector('.dynasty-root')!.getAttribute('data-dynasty-orientation')).toBe('down');
		expect(peek.lastLayout.geo.form).toBe('roundel');
		expect(count(root, '.dynasty-card-r1')).toBe(3);
	});

	it('a sideways tree with the setting off has the tab and shorter cards', async () => {
		phone();
		const { root } = await full(MARKED, { ...DEFAULT_SETTINGS, showRelations: false });
		expect(tabs(root)).toBe(1);
		expect(count(root, '.dynasty-card-foot-line')).toBe(0);
	});
});

describe('the saved picture takes the card form, the plate and the tab of the view (D148 2A, D150 5)', () => {
	it('on a computer: Roundel geometry, the relation line and the words', async () => {
		const { peek } = await drawn(MARKED);
		const src = peek.saveSource()!;
		expect(src.geo.form).toBe('roundel');
		expect(src.relationLine).toBe(true);
		expect(src.youTab).toBeUndefined();
		expect(src.relations?.get('cy')?.text).toBe('Child');
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect(svg).toMatch(/data-item="relation:cy"[^>]*>Child</);
	});

	it('with the setting off: no relation line, no words, the tab for the marked person', async () => {
		const { peek } = await drawn(MARKED, { ...DEFAULT_SETTINGS, showRelations: false });
		const src = peek.saveSource()!;
		expect(src.relationLine).toBe(false);
		expect(src.relations).toBeUndefined();
		expect(src.youTab).toBe('bo');
		expect(src.geo.form).toBe('roundel');
		const svg = new TextDecoder().decode((await makePicture(undefined, src, 'svg')).bytes);
		expect(svg).not.toMatch(/data-item="relation:/);
	});

	it('on a phone held upright (sideways): the text card; with "Like the computer": the Roundel', async () => {
		phone();
		const { openFullScreen } = await import('../acceptance/tree-view-fakes');
		const sideways = await openFullScreen(MARKED);
		const a = ([...(sideways.host.views as Set<unknown>)][0] as Peek).saveSource()!;
		expect([a.orientation, a.geo.form]).toEqual(['sideways', 'text']);
		resetDom();
		phone();
		const down = await openFullScreen(MARKED, { host: fakeHost({ ...DEFAULT_SETTINGS, phoneDirection: 'down' }) });
		const b = ([...(down.host.views as Set<unknown>)][0] as Peek).saveSource()!;
		expect([b.orientation, b.geo.form]).toEqual(['down', 'roundel']);
	});
});

describe('the small tree of the relation finder (D47, D51)', () => {
	// Ann to Cy: the line holds all three. A mark on a person outside the line leaves the tab out.
	const SIDE = `options:\n  me: dee\npeople:\n  - {id: ann, name: Ann, born: 1100}\n  - {id: bo, name: Bo, born: 1130, parents: [ann]}\n  - {id: cy, name: Cy, born: 1160, parents: [bo]}\n  - {id: dee, name: Dee, born: 1131, parents: [ann]}\n`;

	it('has no plate (it has no relation words) and gives the marked person on the line the tab', async () => {
		desktop();
		const src = MARKED;
		const handle = fakeHandle('n.md', src);
		handle.state.finder = { first: 'ann', second: 'cy', index: 0, whole: false, steps: false };
		const { el, view } = await embed(src, { handle });
		fillAllCards(el);
		const peek = view as unknown as Peek;
		expect(el.querySelector('.dynasty-root')!.getAttribute('data-dynasty-finder')).toBe('line');
		expect(peek.lastLayout.settings.relationLine).toBeUndefined();
		expect(peek.lastLayout.settings.youTab).toBe('bo');
		expect(tabs(el)).toBe(1);
		expect(count(el, '.dynasty-card-foot-line')).toBe(0);
		expect(cardH(el, 'ann')).toBe(61);
	});

	it('a mark on a person who is not on the line gives no tab', async () => {
		desktop();
		const handle = fakeHandle('n.md', SIDE);
		handle.state.finder = { first: 'ann', second: 'cy', index: 0, whole: false, steps: false };
		const { el } = await embed(SIDE, { handle });
		fillAllCards(el);
		expect(el.querySelector('.dynasty-card[data-person="dee"]')).toBeNull();
		expect(tabs(el)).toBe(0);
	});

	it('the other direction on an upright phone has its own card form and its own tab', async () => {
		phone();
		const { openFullScreen } = await import('../acceptance/tree-view-fakes');
		const host = fakeHost();
		const r = await openFullScreen(MARKED, { host });
		TreeView.showFinder(host as never, r.handle!.state, 'ann', 'cy', null);
		// A phone-sized box for the first view of the small tree, which picks the direction that shows the line larger.
		const vp = r.root.querySelector('.dynasty-viewport')!;
		vp.clientWidth = 390;
		vp.clientHeight = 700;
		resizeAll();
		flushFrames();
		fillAllCards(r.root);
		const root = r.root.querySelector('.dynasty-root')!;
		const peek = [...host.views][0] as unknown as Peek;
		expect(root.getAttribute('data-dynasty-finder')).toBe('line');
		expect(root.getAttribute('data-dynasty-orientation')).toBe('down');
		expect(peek.lastLayout.geo.form).toBe('roundel');
		expect(peek.lastLayout.settings.youTab).toBe('bo');
		expect(count(r.root, '.dynasty-card-r1')).toBe(3);
		expect(tabs(r.root)).toBe(1);
		expect(count(r.root, '.dynasty-card-foot-line')).toBe(0);
	});
});

describe('Titles window gets the Reduce movement answer of the view', () => {
	it('openTitles passes `reduced` (a window that moves only when the view may move)', async () => {
		const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../src/obsidian/tree-view-actions.ts', import.meta.url), 'utf8'));
		const at = src.indexOf('TitlesWindow.create(');
		expect(src.slice(at, at + 500)).toContain('reduced: () => this.reduced()');
	});
});



