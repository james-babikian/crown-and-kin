import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The fake `prepareFuzzySearch` never matches; a plain "contains" stands in for Obsidian's fuzzy match.
vi.mock('obsidian', async () => {
	const fake = await import('../acceptance/fake-obsidian');
	return { ...fake, prepareFuzzySearch: (q: string) => (t: string) => (t.includes(q) ? { score: 0, matches: [] } : null) };
});

import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { pickPerson } from '../../src/obsidian/person-picker';
import { FLOW } from '../../src/render/ui-text';
import { FEl, resetDom } from '../acceptance/fake-dom';
import { openModals, resetObsidian } from '../acceptance/fake-obsidian';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 O-20, L-03: in a person list, a typed text that matches a person puts the first match first (Enter picks it) and "Create a new person" last;
 * with no match, or with no text, "Create" stands first. The row is in the text colour with a quiet plus.
 */

useFakeDom({ window: true });

beforeEach(() => {
	resetDom();
	resetObsidian();
});

afterEach(() => vi.restoreAllMocks());

type Item = { kind: 'new'; text: string } | { kind: 'person'; person: { id: string } };
interface Picker {
	getSuggestions(q: string): Item[];
	renderSuggestion(item: Item, el: FEl): void;
}

function open(allowNew = true): Picker {
	const r = parseDynasty('people:\n  - {id: a, name: Aldric Valmont}\n  - {id: b, name: Bran Orsini}\n  - {id: c, name: Aldric Orsini}\n');
	if (!r.ok) throw new Error('does not parse');
	void pickPerson({} as never, deriveFamilies(r.tree), new Set(), 'Type', 'Find', allowNew);
	return openModals[openModals.length - 1] as unknown as Picker;
}
const shape = (items: Item[]) => items.map((i) => (i.kind === 'new' ? 'new' : i.person.id));

describe('the order of the row "Create" (O-20)', () => {
	it('with no text it stands first', () => {
		expect(shape(open().getSuggestions('')).slice(0, 1)).toEqual(['new']);
	});

	it('when the text matches a person it stands last, so the first match is the first row', () => {
		const out = shape(open().getSuggestions('aldric'));
		expect(out[out.length - 1]).toBe('new');
		expect(out[0]).not.toBe('new');
		expect(out.slice(0, -1).sort()).toEqual(['a', 'c']);
	});

	it('when nothing matches it is the one row, with the typed text', () => {
		expect(open().getSuggestions('zzzz')).toEqual([{ kind: 'new', text: 'zzzz' }]);
	});

	it('a picker that does not create (Find) has no such row in any state', () => {
		const p = open(false);
		expect(shape(p.getSuggestions('')).includes('new')).toBe(false);
		expect(shape(p.getSuggestions('aldric')).includes('new')).toBe(false);
	});
});

describe('the look of the row "Create" (L-03)', () => {
	it('is drawn with the plus in its own quiet span and the text of the row', () => {
		const el = new FEl('div');
		open().renderSuggestion({ kind: 'new', text: 'Isolde' }, el);
		expect(el.querySelector('.dynasty-picker-swatch.is-new')!.getText()).toBe('+');
		expect(el.querySelector('.dynasty-picker-name')!.getText()).toBe(FLOW.createNew('Isolde'));
	});

	it('takes the text colour and a muted plus in a 20 px column, with no accent', () => {
		const css = readFileSync(new URL('../../styles/13-person-picker.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		const rule = (sel: string) => css.slice(css.indexOf('{', css.indexOf(`${sel} {`)) + 1, css.indexOf('}', css.indexOf(`${sel} {`)));
		expect(rule('.dynasty-picker-new .dynasty-picker-name')).toContain('color: var(--text-normal)');
		const plus = rule('.dynasty-picker-swatch.is-new');
		expect(plus).toContain('width: 20px');
		expect(plus).toContain('var(--dynasty-muted)');
		expect(plus).not.toContain('accent');
	});
});
