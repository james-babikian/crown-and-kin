import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { pickPerson } from '../../src/obsidian/person-picker';
import { clearRelationCache } from '../../src/view/relation-cache';
import { FEl, clock, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { fakeHost } from '../acceptance/tree-view-fakes';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * G2 review of the 0.2.8 part-A repairs: the picker context. Run: npx vitest run tests/obsidian/finder-marked-person-row.test.ts
 */
useFakeDom({ window: true });
beforeEach(() => {
	resetDom();
	resetObsidian();
	clearRelationCache();
	vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
});
afterEach(() => {
	for (const m of [...openModals]) m.close();
	vi.restoreAllMocks();
});

const SRC = 'options:\n  me: a\npeople:\n  - {id: a, name: Ann, born: 1100}\n  - {id: b, name: Bob, parents: [a], born: 1130}\n';

interface PickerLike {
	modalEl: FEl;
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
}

describe('the relation finder: the row of the marked person', () => {
	it('D346 item 4: the marked person shows the name, then "You · b. 1100" under it, as in the Find list', () => {
		const r = parseDynasty(SRC);
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		const host = fakeHost();
		// What TreeView.finder passes for the first pick: `you` = me (7th argument) and the context with me.
		void pickPerson(host.app as never, g, new Set(), 'Type', 'First', false, 'a', null, { sourcePath: 'n.md', me: 'a' });
		const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike;
		const el = new FEl('div');
		p.renderSuggestion(p.getSuggestions('')[0], el);
		const name = el.querySelector('.dynasty-picker-name')!.getText();
		const sub = el.querySelector('.dynasty-picker-sub')?.getText() ?? '';
		expect({ name, sub }).toEqual({ name: 'Ann', sub: 'You · b. 1100' });
	});

	it('the Find list (no `you` argument, the mark in the context) shows the same two text lines and the same spoken label', () => {
		const r = parseDynasty(SRC);
		if (!r.ok) throw new Error('parse');
		const g = deriveFamilies(r.tree);
		const rowOf = (you: string | null): { name: string; sub: string; spoken: string } => {
			openModals.length = 0;
			void pickPerson(fakeHost().app as never, g, new Set(), 'Type', 'First', false, you, null, { sourcePath: 'n.md', me: 'a' });
			const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike;
			const item = p.getSuggestions('').find((i) => (i as { person?: { id: string } }).person?.id === 'a');
			const el = new FEl('div');
			p.renderSuggestion(item, el);
			return {
				name: el.querySelector('.dynasty-picker-name')!.getText(),
				sub: el.querySelector('.dynasty-picker-sub')?.getText() ?? '',
				spoken: el.querySelector('.dynasty-sr-only')?.getText() ?? '',
			};
		};
		const finder = rowOf('a');
		expect(finder).toEqual({ name: 'Ann', sub: 'You · b. 1100', spoken: expect.any(String) });
		expect(finder).toEqual(rowOf(null));
	});
});
