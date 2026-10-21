import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => import('./acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));

import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { pickPerson } from '../src/obsidian/person-picker';
import { clearRelationCache } from '../src/view/relation-cache';
import { FEl, clock, fakeWin, installDom, resetDom } from './acceptance/fake-dom';
import { openModals, resetObsidian } from './acceptance/fake-obsidian';
import { fakeHost } from './acceptance/tree-view-fakes';

/*
 * G2 review of the 0.2.8 part-A repairs: the picker context. Run: npx vitest run tests/review-r028-g2a-picker.test.ts
 */
beforeAll(() => {
	installDom();
	(globalThis as Record<string, unknown>).window ??= fakeWin;
});
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
	it('"You: Ann" does not repeat "You" in its second text line', () => {
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
		expect({ name, sub }).toEqual({ name: 'You: Ann', sub: 'b. 1100' });
	});
});
