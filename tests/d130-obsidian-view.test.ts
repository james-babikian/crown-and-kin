import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
// The two relation functions are wrapped, so the tests can read the options that each call got.
vi.mock('../src/core/relations', async (importOriginal) => {
	const m = await importOriginal<typeof import('../src/core/relations')>();
	return { ...m, computeRelations: vi.fn(m.computeRelations), findRelation: vi.fn(m.findRelation) };
});

import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, type RelationOptions } from '../src/core/relations';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { closePluginModals } from '../src/obsidian/plugin-modals';
import { clearRelationCache, relationsFor, type CardRelation } from '../src/obsidian/relation-cache';
import { DEFAULT_SETTINGS, type DynastySettings } from '../src/obsidian/settings';
import { TreeView } from '../src/obsidian/tree-view';
import { FEl, clock, fakeWin, flushFrames, installDom, resetDom, resizeAll, settle } from './acceptance/fake-dom';
import { resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, fillAllCards, openSheetOn, type Host } from './acceptance/tree-view-fakes';

// D174 in the plugin (spec §9, §13.1): the setting "Assume an unknown second parent" reaches every relation call of a view (the
// cards, the saved picture, the edit sheet, the finder), and a change of the setting draws the cards again with the new names.
// The tree is the D174 sample tree of the supervisor (all names are made up); the mark is on Helen.

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
	vi.mocked(computeRelations).mockClear();
	vi.mocked(findRelation).mockClear();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});

afterEach(() => {
	closePluginModals();
	vi.restoreAllMocks();
});

const SAMPLE = (me: string | null) =>
	[
		...(me ? ['options:', `  me: ${me}`] : []),
		'people:',
		'  - {id: p1, name: Mary, sex: f}',
		'  - {id: p7, name: David, sex: m}',
		'  - {id: p10, name: Yannick, sex: m}',
		'  - {id: p8, name: Eleanor, sex: f, parents: [p7, p1, {id: p10, type: rumoured}]}',
		'  - {id: p9, name: Fiona, sex: f, parents: [p7, p1]}',
		'  - {id: p12, name: Helen, sex: f, parents: [p1]}',
		'  - {id: p13, name: Ingrid, sex: f, parents: [p1]}',
		'unions:',
		'  - partners: [p1, p7]',
		'',
	].join('\n');

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

function graph(src: string): FamilyGraph {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

interface Peek {
	lastLayout: { opts: { relations?: ReadonlyMap<string, CardRelation> } } | null;
	saveSource(): { relations?: ReadonlyMap<string, CardRelation> } | null;
	peekState(): unknown;
	onSettingsChange(prev: DynastySettings): void;
}

async function open(src: string, settings: DynastySettings = { ...DEFAULT_SETTINGS }) {
	desktop();
	const host = fakeHost(settings) as Host & { settings: DynastySettings };
	const handle = fakeHandle('n.md', src);
	const out = await embed(src, { host, handle });
	fillAllCards(out.el);
	return { ...out, host, peek: out.view as unknown as Peek };
}

/** Changes the settings of the host and tells the view, as the plugin does (spec §9). */
function change(host: Host & { settings: DynastySettings }, view: Peek, patch: Partial<DynastySettings>): void {
	const prev = { ...host.settings };
	host.settings = { ...host.settings, ...patch };
	view.onSettingsChange(prev);
}

const optionsOf = (fn: unknown, at: number) => vi.mocked(fn as (...a: unknown[]) => unknown).mock.calls.map((c) => c[at] as RelationOptions | undefined);
const card = (el: FEl, id: string) => el.querySelector(`.dynasty-card[data-person="${id}"]`)!;
const cardText = (el: FEl, id: string) => card(el, id).querySelector('.dynasty-card-relation')?.getText() ?? null;
/** The narrow cards of the note preview can cut the text with "…", or with "… ?" for a maybe (D176 5; the fakes measure 0.6 em per character): a cut text must start the whole text. */
function expectCard(el: FEl, peek: Peek, id: string, text: string): void {
	expect(peek.lastLayout!.opts.relations?.get(id)?.text).toBe(text);
	const shown = cardText(el, id)!;
	if (shown.endsWith('…') || shown.endsWith('… ?')) expect(text.startsWith(shown.replace(/ \?$/, '').slice(0, -1)), shown).toBe(true);
	else expect(shown).toBe(text);
}

describe('D174: the options reach every relation call of the view', () => {
	it('the cards and the saved picture use the setting of the host', async () => {
		const { peek } = await open(SAMPLE('p12'), { ...DEFAULT_SETTINGS, oneParentUnknown: false });
		expect(optionsOf(computeRelations, 2)).toEqual([OFF]);
		const g = graph(SAMPLE('p12'));
		const off = relationsFor(g, 'p12', OFF);
		// The same object: the view took the names of this setting from the cache, not those of the other setting.
		expect(peek.lastLayout!.opts.relations).toBe(off.cards);
		expect(peek.saveSource()!.relations).toBe(off.cards);
		expect(optionsOf(computeRelations, 2)).toEqual([OFF]);
	});

	it('the edit sheet uses the setting of the host', async () => {
		const { el } = await open(SAMPLE('p12'), { ...DEFAULT_SETTINGS, oneParentUnknown: false });
		const before = vi.mocked(computeRelations).mock.calls.length;
		await openSheetOn(el, 'p13', 'mouse');
		// The sheet asks the cache with the same options as the cards: no new computation, and no call with other options.
		expect(vi.mocked(computeRelations).mock.calls.length).toBe(before);
		expect(optionsOf(computeRelations, 2).every((o) => o?.oneParentUnknown === false)).toBe(true);
	});

	it('the finder uses the setting of the host, also after a change of the setting', async () => {
		const { view, host, peek } = await open(SAMPLE('p12'), { ...DEFAULT_SETTINGS, oneParentUnknown: false });
		TreeView.showFinder(host as never, peek.peekState() as never, 'p12', 'p13', view);
		await settle();
		resizeAll();
		flushFrames();
		expect(optionsOf(findRelation, 3).length).toBeGreaterThan(0);
		expect(optionsOf(findRelation, 3).every((o) => o?.oneParentUnknown === false)).toBe(true);
		vi.mocked(findRelation).mockClear();
		change(host, peek, { oneParentUnknown: true });
		expect(optionsOf(findRelation, 3).length).toBeGreaterThan(0);
		expect(optionsOf(findRelation, 3).every((o) => o?.oneParentUnknown === true)).toBe(true);
	});
});

describe('D174: a change of the setting draws the cards again', () => {
	it('the view lays out again with the names of the new setting; back again, it uses the first names', async () => {
		const { host, peek } = await open(SAMPLE('p12'));
		const g = graph(SAMPLE('p12'));
		const on = relationsFor(g, 'p12', ON);
		expect(peek.lastLayout!.opts.relations).toBe(on.cards);
		const renders = host.renders!;
		change(host, peek, { oneParentUnknown: false });
		expect(host.renders!).toBeGreaterThan(renders);
		const off = relationsFor(g, 'p12', OFF);
		expect(peek.lastLayout!.opts.relations).toBe(off.cards);
		expect(peek.saveSource()!.relations).toBe(off.cards);
		change(host, peek, { oneParentUnknown: true });
		expect(peek.lastLayout!.opts.relations).toBe(on.cards);
		expect(peek.saveSource()!.relations).toBe(on.cards);
	});

	it('a tree with no mark and no finder shows no names: the change draws nothing', async () => {
		const { host, peek } = await open(SAMPLE(null));
		const renders = host.renders!;
		change(host, peek, { oneParentUnknown: false });
		expect(host.renders).toBe(renders);
		expect(computeRelations).not.toHaveBeenCalled();
	});

	it('with "Show relation names on cards" off the view still draws again, so the names are right when the words show again', async () => {
		const { host, peek } = await open(SAMPLE('p12'), { ...DEFAULT_SETTINGS, showRelations: false });
		const renders = host.renders!;
		change(host, peek, { oneParentUnknown: false });
		expect(host.renders!).toBeGreaterThan(renders);
		change(host, peek, { showRelations: true });
		expect(peek.lastLayout!.opts.relations).toBe(relationsFor(graph(SAMPLE('p12')), 'p12', OFF).cards);
	});
});

// These tests read the names that the D174 rule of the core gives (branch d130/core). Before that branch is merged they fail.
describe('D174: the card texts in the view (needs the D174 rule of the core)', () => {
	it('Helen and Ingrid (both list only Mary): on, "Half-sister, maybe full"; off, "Sister"', async () => {
		const { el, host, peek } = await open(SAMPLE('p12'));
		expectCard(el, peek, 'p13', 'Half-sister, maybe full');
		expect(card(el, 'p13').getAttribute('aria-label')).toContain(', half-sister, or sister if the parent that the note does not name is the same person for both');
		change(host, peek, { oneParentUnknown: false });
		fillAllCards(el);
		expectCard(el, peek, 'p13', 'Sister');
		expect(card(el, 'p13').getAttribute('aria-label')).toMatch(/, sister$/);
	});

	it('Fiona marked: Eleanor (a rumoured third parent) is "Sister, maybe half" with the setting on or off', async () => {
		const { el, host, peek } = await open(SAMPLE('p9'));
		expectCard(el, peek, 'p8', 'Sister, maybe half');
		expect(card(el, 'p8').getAttribute('aria-label')).toContain(', sister, or half-sister if the rumoured links are true');
		change(host, peek, { oneParentUnknown: false });
		fillAllCards(el);
		expectCard(el, peek, 'p8', 'Sister, maybe half');
	});

	it('the edit sheet of Ingrid: the paragraph for a parent who is not listed', async () => {
		const { el } = await open(SAMPLE('p12'));
		const sheet = await openSheetOn(el, 'p13', 'mouse');
		const box = (sheet as unknown as { modalEl: FEl }).modalEl.querySelector('.dynasty-head-text')!;
		expect(box.querySelector('.dynasty-head-rel .dynasty-jitem')!.getText()).toBe('Your half-sister, maybe full');
		expect(box.querySelector('.dynasty-relation-maybe')!.getText()).toBe('If the parent that the note does not name is the same person for both, this person is your sister.');
	});
});
