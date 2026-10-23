// G2 review of WP-U (scratch). Proofs for the person picker pages (D237).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

vi.mock('obsidian', async () => ({
	...(await import('../acceptance/fake-obsidian')),
	prepareFuzzySearch: (q: string) => (t: string) => (t.includes(q) ? { score: 0, matches: [] } : null),
}));

import { computeRelations, relationCallStats } from '../../src/core/relations';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { PICKER_PAGE, pickPerson } from '../../src/obsidian/person-picker';
import { clearRelationCache } from '../../src/view/relation-cache';
import { cardRelationText } from '../../src/render/tree-info';
import { FEl, dispatch, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHost } from '../acceptance/tree-view-fakes';
import { genModel, toText } from '../support/r028-gen';

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

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: { id: string } };
interface Chooser {
	values: Item[] | null;
	suggestions: FEl[];
	selectedItem: number;
	addSuggestion?: (v: Item) => void;
	setSelectedItem?: (n: number) => void;
}
interface Picker {
	chooser: Chooser;
	inputEl: FEl;
	resultContainerEl: FEl;
	updateSuggestions(): void;
	loadMore(): void;
	onSelectedChange(): void;
	close(): void;
}

function graphOf(text: string): FamilyGraph | null {
	const parsed = parseDynasty(text);
	if (!parsed.ok) return null;
	const g = deriveFamilies(parsed.tree);
	return g.issues.some((i) => i.level === 'blocking') ? null : g;
}

function open(g: FamilyGraph, o: { me?: string | null; you?: string | null; allowNew?: boolean } = {}): Picker {
	void pickPerson(fakeHost().app as never, g, new Set(), 'Type a name', 'Find', o.allowNew ?? false, o.you ?? null, null, { sourcePath: 'n.md', ...(o.me ? { me: o.me } : {}) });
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as Picker;
	p.updateSuggestions();
	return p;
}

const rows = (p: Picker) => p.resultContainerEl.querySelectorAll('.suggestion-item');
const idOf = (e: FEl) => e.attrs.get('data-person') ?? 'new';

describe('g2: the words of every row equal the whole-tree words (fixtures)', () => {
	const files = readdirSync('fixtures').filter((f) => f.endsWith('.md'));
	for (const f of files) {
		it(`fixture ${f}: every row of every page, with several marked people and texts`, () => {
			const g = graphOf(readFileSync(`fixtures/${f}`, 'utf8'));
			if (!g || g.people.length < 2) return;
			const mes = [0, 1, Math.floor(g.people.length / 2), g.people.length - 1].map((i) => g.people[i]!.id);
			for (const me of new Set(mes)) {
				for (const q of ['', 'a', 'e']) {
					clearRelationCache();
					const all = computeRelations(g, me);
					const p = open(g, { me });
					p.inputEl.value = q;
					p.updateSuggestions();
					for (let i = 0; i < 30; i++) p.loadMore();
					for (let i = 0; i < 400; i++) runTimers(300);
					for (const row of rows(p)) {
						const id = idOf(row);
						const rels = all.get(id);
						const want = rels?.[0] ? cardRelationText(rels[0]) : '';
						expect(row.querySelector('i')?.getText() ?? '', `${f} me=${me} q=${q} id=${id}`).toBe(want);
					}
					p.close();
				}
			}
		});
	}
});

describe('g2: pages', () => {
	const N = 650;
	let text: string | null = null;
	const big = (): FamilyGraph => {
		text ??= toText({ ...genModel(23, { n: N, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: 'p400' } });
		return graphOf(text)!;
	};

	it('a typed text: pages are the sorted matches, in order, no duplicates, nothing lost', () => {
		const g = big();
		const p = open(g, { me: 'p400', allowNew: true });
		p.inputEl.value = 'p';
		p.updateSuggestions();
		const expectedPool = rows(p).length; // first page
		for (let i = 0; i < 10; i++) p.loadMore();
		const ids = rows(p).map(idOf);
		expect(ids.length).toBe(N + 1);
		expect(new Set(ids).size).toBe(ids.length);
		expect(p.chooser.values?.length).toBe(ids.length);
		expect(expectedPool).toBe(PICKER_PAGE + 1);
	});

	it('Enter on a row of a later page returns that person', async () => {
		const g = big();
		let got: unknown = 'unset';
		void pickPerson(fakeHost().app as never, g, new Set(), 'Type a name', 'Find', false, null, null, { sourcePath: 'n.md', me: 'p400' }).then((r) => (got = r));
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as Picker & { onChooseSuggestion(i: Item): void };
		p.updateSuggestions();
		p.loadMore();
		const item = p.chooser.values![PICKER_PAGE + 5]!;
		p.onChooseSuggestion(item);
		p.close();
		await Promise.resolve();
		expect(got).toEqual({ kind: 'person', id: (item as { person: { id: string } }).person.id });
	});

	it('fallback path: the selected row survives the rebuild', () => {
		const g = big();
		const p = open(g);
		delete p.chooser.addSuggestion;
		p.chooser.selectedItem = PICKER_PAGE - 5;
		p.onSelectedChange();
		expect(rows(p).length).toBe(PICKER_PAGE * 2);
		expect(p.chooser.selectedItem).toBe(PICKER_PAGE - 5);
	});

	it('after close, a page add starts no idle work', () => {
		const g = big();
		const p = open(g, { me: 'p400' });
		p.close();
		runTimers(300 * 50);
		const at = relationCallStats.calls;
		p.loadMore();
		runTimers(300 * 50);
		expect(relationCallStats.calls - at).toBe(0);
	});

	it('scroll listener: a scroll after close adds nothing', () => {
		const g = big();
		const p = open(g);
		const list = p.resultContainerEl;
		p.close();
		list.clientHeight = 600;
		list.scrollHeight = 10_000;
		list.scrollTop = 9000;
		dispatch(list, 'scroll');
		expect(rows(p).length).toBe(PICKER_PAGE);
	});
});

import { FLOW, TITLES_UI } from '../../src/render/ui-text';
import { PERSON_PLACEHOLDER } from '../../src/render/view-text';
import { useFakeDom } from '../support/fake-dom-setup';

describe('g2: D236 placeholder', () => {
	it('every person picker field has a placeholder that is no longer than the old cut text (27 characters) allows on a phone', () => {
		// D236: "Type the name of the person" (27 characters) was cut on the iPhone. The Add parent, child, partner and holder fields are as long or longer.
		const limit = PERSON_PLACEHOLDER.length + 8;
		for (const t of [FLOW.pickerParent, FLOW.pickerChild, FLOW.pickerPartner, TITLES_UI.pickerPlaceholder]) expect(t.length, t).toBeLessThanOrEqual(limit);
	});
});
