import { describe, expect, it } from 'vitest';
import { cardLabels, entryRulerText } from '../../src/core/titles';
import { build } from '../support/helpers';

// 0.2.5 (D131), contract A.2: `entryRulerText` gives the text of one entry; the card rule (WP-A3) sets `CardLabel.numbered` only for a numbered entry.

describe('entryRulerText', () => {
	it('gives the ruler name, then the number when the entry has one', () => {
		expect(entryRulerText({ index: 0, person: 'a', as: 'Aldric', number: 'II' }, 'Aldric Vale')).toBe('Aldric II');
		expect(entryRulerText({ index: 0, person: 'a', number: 'I' }, 'Marta de Calvera')).toBe('Marta I');
		expect(entryRulerText({ index: 0, person: 'a', as: 'Marta' }, 'Marta de Calvera')).toBe('Marta');
		expect(entryRulerText({ index: 0, person: 'a' }, 'Marta de Calvera')).toBe('Marta');
		expect(entryRulerText({ index: 0, name: 'Outsider' }, undefined)).toBe('Outsider');
	});
});

describe('CardLabel.numbered', () => {
	it('is set to true only for a numbered entry (a label with no number has no key, so toEqual tests of labels stay as they are)', () => {
		const { g } = build(`people:
  - {id: a, name: Aldric Vale}
titles:
  - id: crown
    name: King
    holders:
      - {person: a, number: II}
`);
		const label = cardLabels(g).get('a');
		expect(label?.name).toBe('Aldric II');
		expect(label?.numbered).toBe(true);
	});

	it('is absent for an entry with only a written `as`, and for a person with no holding', () => {
		const { g } = build(`people:
  - {id: a, name: Aldric Vale}
  - {id: b, name: Beric Vale}
titles:
  - id: crown
    name: King
    holders:
      - {person: a, as: Aldric}
`);
		expect(cardLabels(g).get('a')?.name).toBe('Aldric');
		expect('numbered' in cardLabels(g).get('a')!).toBe(false);
		expect('numbered' in cardLabels(g).get('b')!).toBe(false);
	});
});
