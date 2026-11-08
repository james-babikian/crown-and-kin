import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The fake `prepareFuzzySearch` never matches; a plain "contains" stands in for Obsidian's fuzzy match.
vi.mock('obsidian', async () => {
	const fake = await import('../acceptance/fake-obsidian');
	return { ...fake, prepareFuzzySearch: (q: string) => (t: string) => (t.includes(q) ? { score: 0, matches: [] } : null) };
});

import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { PICKER_PAGE, pickPerson } from '../../src/obsidian/person-picker';
import { TITLES_UI } from '../../src/render/ui-text';
import { FEl, dispatch, resetDom, settle } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D334 Q7: the row "A holder who is not in the tree" leaves the scrolling list and stands in a foot under it, always in view. The picker keeps the row in
 * Obsidian's chooser, so the order of the keys does not change (D330 O-20: Enter picks the first match). A picker with the plain row "Create a new person" is not changed.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: { id: string } };
interface Picker {
	modalEl: FEl;
	resultContainerEl: FEl;
	getSuggestions(q: string): Item[];
	updateSuggestions(): void;
	chooser: { suggestions: FEl[]; values: Item[] };
	inputEl: FEl;
}

function open(people: number, holder = true) {
	const rows = Array.from({ length: people }, (_, i) => `  - {id: p${i}, name: Aldric ${i}}`).join('\n');
	const r = parseDynasty(`people:\n${rows}\n`);
	if (!r.ok) throw new Error('does not parse');
	const result = pickPerson({} as never, deriveFamilies(r.tree), new Set(), 'Type', 'Find', true, null, holder ? TITLES_UI.notInTreeRow : null);
	const picker = openModals[openModals.length - 1] as unknown as Picker;
	// Obsidian keeps the list inside the prompt; the fake has no parent, so the test gives it one.
	picker.modalEl.appendChild(picker.resultContainerEl);
	return { picker, result };
}

describe('the row "A holder who is not in the tree" (D334 Q7)', () => {
	it('stands in the foot under the list, not in the list, and the prompt says so', () => {
		const { picker } = open(5);
		picker.inputEl.value = 'Aldric';
		picker.updateSuggestions();
		const foot = picker.modalEl.querySelector('.dynasty-picker-pinned')!;
		expect(foot.querySelector('.dynasty-picker-name')!.getText()).toBe(TITLES_UI.notInTreeRow('Aldric'));
		expect(picker.resultContainerEl.querySelector('.dynasty-picker-new')).toBeNull();
		expect(picker.modalEl.children.indexOf(foot)).toBe(picker.modalEl.children.indexOf(picker.resultContainerEl) + 1);
		expect(picker.modalEl.hasClass('has-pinned-row')).toBe(true);
	});

	it('keeps the order of the keys: the first match is first, the row is the last row of the chooser', () => {
		const { picker } = open(5);
		picker.inputEl.value = 'Aldric';
		picker.updateSuggestions();
		const items = picker.chooser.values;
		expect(items[0].kind).toBe('person');
		expect(items[items.length - 1].kind).toBe('new');
		expect(picker.chooser.suggestions[items.length - 1].hasClass('dynasty-picker-new')).toBe(true);
		expect(picker.chooser.suggestions).toHaveLength(items.length);
	});

	it('draws one foot row after the text changes, with the new typed text', () => {
		const { picker } = open(5);
		picker.inputEl.value = 'Ald';
		picker.updateSuggestions();
		picker.inputEl.value = 'Aldric 3';
		picker.updateSuggestions();
		const names = picker.modalEl.querySelectorAll('.dynasty-picker-pinned .dynasty-picker-name');
		expect(names.map((n) => n.getText())).toEqual([TITLES_UI.notInTreeRow('Aldric 3')]);
	});

	it('a tap on the row in the foot chooses it with the typed name', async () => {
		const { picker, result } = open(5);
		picker.inputEl.value = 'Isolde';
		picker.updateSuggestions();
		dispatch(picker.modalEl.querySelector('.dynasty-picker-pinned .dynasty-picker-new')!, 'click');
		await settle();
		expect(await result).toEqual({ kind: 'new', name: 'Isolde' });
	});

	it('is in the foot also when more than one page of people match and the page does not hold it', () => {
		const { picker } = open(PICKER_PAGE + 40);
		picker.inputEl.value = 'Aldric';
		picker.updateSuggestions();
		expect(picker.chooser.values.some((i) => i.kind === 'new')).toBe(false);
		expect(picker.modalEl.querySelector('.dynasty-picker-pinned .dynasty-picker-name')!.getText()).toBe(TITLES_UI.notInTreeRow('Aldric'));
	});

	it('leaves the plain row "Create a new person" in the list', () => {
		const { picker } = open(5, false);
		picker.inputEl.value = 'Aldric';
		picker.updateSuggestions();
		expect(picker.modalEl.querySelector('.dynasty-picker-pinned')).toBeNull();
		expect(picker.resultContainerEl.querySelector('.dynasty-picker-new')).not.toBeNull();
	});
});
