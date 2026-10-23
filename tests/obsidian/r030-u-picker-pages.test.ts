// WP-U (spec §0 D237): the person picker builds one page of 200 people when it opens and adds the next page when the reader scrolls near the end of the list.
// The fake `SuggestModal` (tests/acceptance/fake-obsidian.ts) has the row list of Obsidian: `chooser.addSuggestion`, `values`, `suggestions`, `selectedItem`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	// The fake search finds nothing; this one finds a text that contains the typed text.
	prepareFuzzySearch: (q: string) => (t: string) => (t.includes(q) ? { score: 0, matches: [] } : null),
}));

import { computeRelations, relationCallStats } from '../../src/core/relations';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { IDLE_CHUNK, PICKER_PAGE, pickPerson } from '../../src/obsidian/person-picker';
import { clearRelationCache } from '../../src/view/relation-cache';
import { cardRelationText } from '../../src/render/tree-info';
import { FEl, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHost } from '../acceptance/tree-view-fakes';
import { genModel, toText } from '../support/r028-gen';
import { useFakeDom } from '../support/fake-dom-setup';

useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	clearRelationCache();
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const N = 650;
const ME = 'p400';
const STEP_MS = 300;

let text: string | null = null;
function graph(): FamilyGraph {
	text ??= toText({ ...genModel(23, { n: N, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: ME } });
	const parsed = parseDynasty(text);
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
}

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: { id: string } };
interface Chooser {
	values: Item[] | null;
	suggestions: FEl[];
	selectedItem: number;
	addSuggestion?: (v: Item) => void;
}
interface Picker {
	chooser: Chooser;
	inputEl: FEl;
	resultContainerEl: FEl;
	limit: number;
	getSuggestions(q: string): Item[];
	updateSuggestions(): void;
	loadMore(): void;
	onSelectedChange(): void;
	close(): void;
}

function open(allowNew = false): Picker {
	void pickPerson(fakeHost().app as never, graph(), new Set(), 'Type a name', 'Find', allowNew, null, null, { sourcePath: 'n.md', me: ME });
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as Picker;
	p.updateSuggestions();
	return p;
}

const rowIds = (p: Picker): string[] => p.resultContainerEl.querySelectorAll('.suggestion-item').map((e) => e.attrs.get('data-person') ?? 'new');

describe('r030-u: the picker shows one page of people and adds the next page on scroll (D237)', () => {
	it('opens with 200 people of the list order, not all of them', () => {
		const p = open();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		expect(rowIds(p)[0]).toBe('p0');
		expect(p.chooser.values?.length).toBe(PICKER_PAGE);
		expect(p.limit).toBeGreaterThanOrEqual(PICKER_PAGE + 1);
	});

	it('with the first row "new person", the 200 people come after it', () => {
		const p = open(true);
		const ids = rowIds(p);
		expect(ids.length).toBe(PICKER_PAGE + 1);
		expect(ids[0]).toBe('new');
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2 + 1);
		expect(rowIds(p).filter((i) => i === 'new').length).toBe(1);
	});

	it('loadMore adds 200 rows, in order, until all people are there; the old rows stay', () => {
		const p = open();
		const first = p.resultContainerEl.querySelectorAll('.suggestion-item')[0];
		p.chooser.selectedItem = 7;
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 3);
		p.loadMore();
		expect(rowIds(p).length).toBe(N);
		p.loadMore();
		expect(rowIds(p).length).toBe(N);
		expect(rowIds(p)).toEqual(Array.from({ length: N }, (_, i) => `p${i}`));
		// The same row elements, the same selected row, and the keyboard list is as long as the rows.
		expect(p.resultContainerEl.querySelectorAll('.suggestion-item')[0]).toBe(first);
		expect(p.chooser.selectedItem).toBe(7);
		expect(p.chooser.suggestions.length).toBe(N);
		expect(p.chooser.values?.length).toBe(N);
	});

	it('a scroll near the end of the list adds a page; a scroll far from the end does not', () => {
		const p = open();
		const list = p.resultContainerEl;
		list.clientHeight = 600;
		list.scrollHeight = 10_000;
		list.scrollTop = 6000;
		dispatch(list, 'scroll');
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		list.scrollTop = 8700;
		dispatch(list, 'scroll');
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
	});

	it('the arrow key near the last row adds a page, so it does not wrap to the top', () => {
		const p = open();
		p.chooser.selectedItem = 40;
		p.onSelectedChange();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		p.chooser.selectedItem = PICKER_PAGE - 3;
		p.onSelectedChange();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
	});

	it('a later Obsidian without `chooser` or `onInput` (private members): the rows stay, nothing throws, typing still searches', () => {
		const p = open();
		const redraw = p.updateSuggestions;
		Object.assign(p, { chooser: undefined, onInput: undefined });
		expect(() => p.loadMore()).not.toThrow();
		expect(() => p.onSelectedChange()).not.toThrow();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		// With `onInput` back, the list is drawn again with one more page.
		Object.assign(p, { chooser: { values: [], suggestions: [], selectedItem: 0 }, onInput: redraw });
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
	});

	it('a typed text searches every person: the first 200 matches show, the rest on scroll', () => {
		const p = open();
		p.inputEl.value = 'p';
		p.updateSuggestions();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		p.loadMore();
		p.loadMore();
		p.loadMore();
		expect(rowIds(p).length).toBe(N);
		// A text with few matches shows them all and has no page to add. "p60" names P60 and P600 to P609.
		p.inputEl.value = 'p60';
		p.updateSuggestions();
		const few = rowIds(p);
		expect(few.length).toBe(11);
		expect(few).toContain('p605');
		p.loadMore();
		expect(rowIds(p).length).toBe(11);
	});

	it('a person far down the list (after page 1) is found by typing', () => {
		const p = open();
		expect(rowIds(p)).not.toContain('p640');
		p.inputEl.value = 'p640';
		p.updateSuggestions();
		expect(rowIds(p)).toEqual(['p640']);
	});

	it('a new text starts again at the first page', () => {
		const p = open();
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
		p.inputEl.value = 'p';
		p.updateSuggestions();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
		p.inputEl.value = '';
		p.updateSuggestions();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
	});

	it('without addSuggestion in the Obsidian list, the list is built again with one more page and the scroll position stays', () => {
		const p = open();
		delete p.chooser.addSuggestion;
		p.resultContainerEl.scrollTop = 1234;
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 2);
		expect(p.resultContainerEl.scrollTop).toBe(1234);
		p.loadMore();
		expect(rowIds(p).length).toBe(PICKER_PAGE * 3);
		// A new text goes back to one page.
		p.inputEl.value = 'p';
		p.updateSuggestions();
		expect(rowIds(p).length).toBe(PICKER_PAGE);
	});

	it('closing the picker removes the scroll listener', () => {
		const p = open();
		const list = p.resultContainerEl;
		expect((list.listeners.get('scroll') ?? []).length).toBe(1);
		p.close();
		expect((list.listeners.get('scroll') ?? []).length).toBe(0);
	});
});

describe('r030-u: relation words are worked out only for the rows that exist', () => {
	it('page 1 works out at most its 200 people, and page 2 adds at most 200 more', () => {
		const start = relationCallStats.calls;
		const p = open();
		const drain = () => {
			for (let i = 0; i < 100; i++) {
				const before = relationCallStats.calls;
				runTimers(STEP_MS);
				const worked = relationCallStats.calls - before;
				expect(worked).toBeLessThanOrEqual(IDLE_CHUNK);
				if (worked === 0) break;
			}
		};
		drain();
		const afterOne = relationCallStats.calls - start;
		expect(afterOne).toBeLessThanOrEqual(PICKER_PAGE);
		p.loadMore();
		// Adding a page does not work anyone out in the same task.
		expect(relationCallStats.calls - start).toBe(afterOne);
		drain();
		const afterTwo = relationCallStats.calls - start;
		expect(afterTwo).toBeGreaterThan(afterOne);
		expect(afterTwo).toBeLessThanOrEqual(PICKER_PAGE * 2);
	});

	it('the rows of page 2 get the same words as the whole computation', () => {
		const g = graph();
		const all = computeRelations(g, ME);
		const p = open();
		p.loadMore();
		for (let i = 0; i < 100; i++) runTimers(STEP_MS);
		let withWord = 0;
		for (const row of p.resultContainerEl.querySelectorAll('.suggestion-item')) {
			const id = row.attrs.get('data-person')!;
			const rels = all.get(id);
			const want = id === ME ? '' : rels?.[0] ? cardRelationText(rels[0]) : '';
			expect(row.querySelector('i')?.getText() ?? '', id).toBe(want);
			if (want) withWord++;
		}
		// The marked person stands in page 2, so people of page 2 have words.
		expect(withWord).toBeGreaterThan(5);
	});

	it('a new text ends the idle steps of the old list', () => {
		const p = open();
		p.inputEl.value = 'p640';
		p.updateSuggestions();
		const at = relationCallStats.calls;
		runTimers(STEP_MS * 20);
		// One row: its word comes from the first request, and no step has more to do.
		expect(relationCallStats.calls - at).toBeLessThanOrEqual(1);
	});
});
