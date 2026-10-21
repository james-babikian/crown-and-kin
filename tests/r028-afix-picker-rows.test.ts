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
 * 0.2.8 part-A fix round, items 1 and 2: the second text line of the marked person's row, and the spoken label of every picker row.
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

const SRC = 'options:\n  me: a\npeople:\n  - {id: a, name: Ann, born: 1100}\n  - {id: b, name: Bob, parents: [a], born: 1130, died: 1190, title: Count}\n';

interface PickerLike {
	getSuggestions(q: string): unknown[];
	renderSuggestion(item: unknown, el: FEl): void;
}

function rows(you: string | null) {
	const r = parseDynasty(SRC);
	if (!r.ok) throw new Error('parse');
	const g = deriveFamilies(r.tree);
	void pickPerson(fakeHost().app as never, g, new Set(), 'Type', 'Find', false, you, null, { sourcePath: 'n.md', me: 'a' });
	const p = openModals.find((m) => (m.modalEl as unknown as FEl).hasClass('dynasty-picker')) as unknown as PickerLike;
	return p.getSuggestions('').map((item) => {
		const el = new FEl('div');
		p.renderSuggestion(item, el);
		return { sub: el.querySelector('.dynasty-picker-sub')?.getText() ?? '', label: el.querySelector('.dynasty-sr-only')?.getText() ?? null, tip: el.getAttribute('aria-label') };
	});
}

describe('the rows of the picker', () => {
	it('a plain Find row of the marked person keeps the word "You" in the second text line', () => {
		expect(rows(null)[0]).toEqual({ sub: 'You · b. 1100', label: 'Ann, b. 1100, you', tip: null });
	});

	it('the marked row of the relation finder leaves the word out, and a spoken label names the relation', () => {
		const [ann, bob] = rows('a');
		expect(ann).toEqual({ sub: 'b. 1100', label: 'Ann, b. 1100, you', tip: null });
		expect(bob?.sub).toBe('Child · 1130–1190 · Count');
		expect(bob?.label).toBe('Bob, Count, 1130–1190, child');
	});
});
