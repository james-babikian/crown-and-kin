import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, relationCallStats } from '../../src/core/relations';
import { FIRST_ROWS, IDLE_CHUNK, PICKER_PAGE, pickPerson } from '../../src/obsidian/person-picker';
import { clearRelationCache } from '../../src/view/relation-cache';
import { cardRelationText } from '../../src/render/tree-info';
import { FEl, clock, resetDom, runTimers } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHost } from '../acceptance/tree-view-fakes';
import { genModel, toText } from '../support/r028-gen';
import { useFakeDom } from '../support/fake-dom-setup';

// WP-K fix round: the person picker works out the words of the first rows at once and the others in idle steps. D237: the list has one page of
// 200 people; the rest is in tests/obsidian/r030-u-picker-pages.test.ts. `relationCallStats.calls` counts the people who were worked out.

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

const N = 5000;
const ME = 'p2500';
/** The tree of `n` people, marked at the person in the middle; built once for each size. */
const bodies = new Map<number, string>();
function body(n: number): string {
	let text = bodies.get(n);
	if (text === undefined) bodies.set(n, (text = toText({ ...genModel(23, { n, linkP: 0.9, twoP: 0.8, unionP: 0.4, window: 12 }), options: { me: `p${n / 2}` } })));
	return text;
}

/** The delay of one idle step in the fake DOM (no idle callback there), so `runTimers(STEP_MS)` runs exactly one step. */
const STEP_MS = 300;

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: { id: string } };
interface Picker {
	getSuggestions(q: string): Item[];
	renderSuggestion(i: Item, el: HTMLElement): void;
	close(): void;
}

function graph(n = N): FamilyGraph {
	const parsed = parseDynasty(body(n));
	if (!parsed.ok) throw new Error('parse');
	return deriveFamilies(parsed.tree);
}

function open(g: FamilyGraph, allowNew = false, me = ME): Picker {
	void pickPerson(fakeHost().app as never, g, new Set(), 'Type', 'Find', allowNew, me, null, { sourcePath: 'n.md', me });
	return openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as Picker;
}

function render(p: Picker, items: Item[]): Map<string, FEl> {
	const rows = new Map<string, FEl>();
	for (const it of items) {
		const el = new FEl('div');
		p.renderSuggestion(it, el as unknown as HTMLElement);
		if (it.kind === 'person') rows.set(it.person.id, el);
	}
	return rows;
}

/** The relation word of a rendered row: the italic text, or '' when the row has none. */
const wordOf = (row: FEl): string => row.querySelector('i')?.getText() ?? '';

describe('K.2: the picker works out the first rows at once and the others when idle', () => {
	it('an empty query on a marked tree of 5 000 people asks for the first rows only, and the render works out no one', () => {
		const p = open(graph());
		const start = relationCallStats.calls;
		const items = p.getSuggestions('');
		const asked = relationCallStats.calls - start;
		expect(items.length).toBe(PICKER_PAGE);
		expect(asked).toBeLessThanOrEqual(FIRST_ROWS);
		const rows = render(p, items);
		expect(relationCallStats.calls - start).toBe(asked);
		// The later rows draw with no word until their step has run; the rows of the first batch have theirs.
		const ids = items.flatMap((i) => (i.kind === 'person' ? [i.person.id] : []));
		expect(wordOf(rows.get(ids[ids.length - 1])!)).toBe('');
		expect(rows.get(ME)).toBeDefined();
	});

	it('each idle step works out at most one chunk, and the words of every row equal the whole computation', () => {
		// A smaller tree: the whole computation of 5 000 people is what the picker no longer needs, and it is slow to hold in a test.
		const n = 600;
		const me = `p${n / 2}`;
		const g = graph(n);
		const all = computeRelations(g, me);
		const p = open(g, false, me);
		const items = p.getSuggestions('');
		const rows = render(p, items);
		let steps = 0;
		for (; steps < 200; steps++) {
			const before = relationCallStats.calls;
			runTimers(STEP_MS);
			const worked = relationCallStats.calls - before;
			expect(worked).toBeLessThanOrEqual(IDLE_CHUNK);
			if (worked === 0) break;
		}
		expect(steps).toBeGreaterThan(2);
		let withWord = 0;
		for (const [id, row] of rows) {
			const rels = all.get(id);
			const want = id === me ? '' : rels?.[0] ? cardRelationText(rels[0]) : '';
			expect(wordOf(row), id).toBe(want);
			if (want) withWord++;
			// The sentence for a screen reader follows the visible word.
			const sr = row.querySelector('.dynasty-sr-only')?.getText() ?? '';
			if (want) expect(sr.length, id).toBeGreaterThan(0);
		}
		expect(withWord).toBeGreaterThan(0);
	});

	it('the order and the number of the rows are the same as before (the search is not changed)', () => {
		const g = graph();
		const p = open(g, true);
		const items = p.getSuggestions('');
		expect(items[0].kind).toBe('new');
		expect(items.length).toBe(PICKER_PAGE + 1);
		expect((items[1] as { person: { id: string } }).person.id).toBe(ME);
	});

	it('a new query ends the old steps: the rows of the old list get no more work', () => {
		const p = open(graph());
		p.getSuggestions('');
		runTimers(STEP_MS);
		const before = relationCallStats.calls;
		expect(p.getSuggestions(' ').length).toBe(PICKER_PAGE);
		const mid = relationCallStats.calls;
		expect(mid - before).toBeLessThanOrEqual(0);
		// The fake search finds no one, so the new list is empty and its queue too.
		const narrow = p.getSuggestions('zzzzqqq');
		expect(narrow.length).toBe(0);
		runTimers(STEP_MS * 5);
		// The empty result has no steps; the words of the list before are not worked out any more.
		expect(relationCallStats.calls).toBe(mid);
	});

	it('closing the picker stops the steps', () => {
		const p = open(graph());
		p.getSuggestions('');
		runTimers(STEP_MS);
		p.close();
		const at = relationCallStats.calls;
		runTimers(STEP_MS * 20);
		expect(relationCallStats.calls).toBe(at);
		expect(clock.now).toBeGreaterThan(0);
	});
});
