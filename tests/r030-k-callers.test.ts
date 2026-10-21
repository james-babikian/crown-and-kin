import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { relationCallStats } from '../src/core/relations';
import { FullScreenModal } from '../src/obsidian/full-screen';
import { pickPerson } from '../src/obsidian/person-picker';
import { clearRelationCache, relationsFor } from '../src/view/relation-cache';
import { DEFAULT_SETTINGS } from '../src/view/settings';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { desktop, embed, fakeHandle, fakeHost, phone } from './acceptance/tree-view-fakes';
import { genModel, toText } from './r028-gen';

// WP-K (K.2): a view asks for the relation names of the people it shows, not for the whole tree. `relationCallStats.calls` counts the people
// that were worked out; the whole computation of a tree of N people calls it N - 1 times.

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

afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const N = 80;
const ME = 'p40';
const BODY = toText({ ...genModel(17, { n: N, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: ME } });

/** The people of the tree who are neither the mark nor a person with a card or a row: the work that the old whole computation did and a view must not do. */
const OTHERS = N - 1;

describe('K.2: a view asks only for the people it shows', () => {
	it('the phone list works out its rows only (the person in the middle, the parents, the partners, the children)', async () => {
		phone();
		const start = relationCallStats.calls;
		const handle = fakeHandle('n.md', BODY);
		const { el } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle });
		const rows = el.querySelectorAll('.dynasty-list-row').length;
		const calls = relationCallStats.calls - start;
		expect(rows).toBeGreaterThan(1);
		// The row of the marked person is its own name ("You") and needs no call.
		expect(calls).toBeLessThanOrEqual(rows);
		expect(calls).toBeLessThan(OTHERS / 4);
	});

	it('a focus family on the computer works out its cards only', async () => {
		desktop();
		const handle = fakeHandle('n.md', BODY);
		// A person at the end of the list has a small family.
		handle.state.focus = { id: 'p70' };
		const start = relationCallStats.calls;
		const { el } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle });
		const cards = el.querySelectorAll('.dynasty-card').length;
		expect(cards).toBeGreaterThan(1);
		expect(cards).toBeLessThan(N / 4);
		expect(relationCallStats.calls - start).toBeLessThanOrEqual(cards);
	});

	it('the whole tree works out every drawn card, once', async () => {
		desktop();
		const start = relationCallStats.calls;
		const handle = fakeHandle('n.md', BODY);
		const { el } = await embed(BODY, { host: fakeHost({ ...DEFAULT_SETTINGS }), handle });
		const cards = el.querySelectorAll('.dynasty-card').length;
		expect(cards).toBe(N);
		expect(relationCallStats.calls - start).toBe(OTHERS);
	});

	it('the person picker works out the rows that it lists (12 of the 80 people), not the whole tree', async () => {
		const parsed = parseDynasty(BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		const keep = new Set(g.people.map((x) => x.id).slice(20, 32));
		void pickPerson(fakeHost().app as never, g, new Set(g.people.map((x) => x.id).filter((id) => !keep.has(id))), 'Type', 'Find', false, null, null, { sourcePath: 'n.md', me: ME });
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as { getSuggestions(q: string): unknown[]; renderSuggestion(item: unknown, el: FEl): void };
		const start = relationCallStats.calls;
		const items = p.getSuggestions('');
		for (const item of items) p.renderSuggestion(item, new FEl('div'));
		const listed = items.length;
		expect(listed).toBe(12);
		expect(relationCallStats.calls - start).toBeLessThanOrEqual(listed);
		// The same rows again cost nothing.
		for (const item of p.getSuggestions('')) p.renderSuggestion(item, new FEl('div'));
		expect(relationCallStats.calls - start).toBeLessThanOrEqual(listed);
	});

	it('the cache serves one lookup for a tree, a mark and a setting; a card asked twice is worked out once', () => {
		const parsed = parseDynasty(BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		const a = relationsFor(g, ME, { oneParentUnknown: true });
		expect(relationsFor(g, ME, { oneParentUnknown: true })).toBe(a);
		expect(relationsFor(g, ME, { oneParentUnknown: false })).not.toBe(a);
		const start = relationCallStats.calls;
		const first = a.cards.get('p41');
		const calls = relationCallStats.calls - start;
		expect(calls).toBeLessThanOrEqual(1);
		expect(a.cards.get('p41')).toBe(first);
		expect(a.cards.getMany(['p41', 'p42']).size).toBeLessThanOrEqual(2);
		expect(relationCallStats.calls - start).toBeLessThanOrEqual(2);
	});

	it('a card text is the first name of the person, with the same words as the whole computation', () => {
		const parsed = parseDynasty(BODY);
		if (!parsed.ok) throw new Error('parse');
		const g = deriveFamilies(parsed.tree);
		const r = relationsFor(g, ME);
		const some = g.people.map((p) => p.id).filter((id) => id !== ME).slice(0, 15);
		for (const id of some) {
			const rels = r.all.get(id);
			const card = r.cards.get(id);
			expect(card === undefined, id).toBe(rels === undefined);
			if (card && rels) expect(card.text).toBe(rels[0].text);
		}
		expect(r.cards.get(ME)?.text).toBe('You');
	});
});
