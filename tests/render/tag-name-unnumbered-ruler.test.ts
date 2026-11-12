import { describe, expect, it } from 'vitest';
import { cardLabels } from '../../src/core/titles';
import { farTagLabel, farTagName } from '../../src/render/tree-info';
import { build } from '../support/helpers';

// D344 2 A, the owner's words: "The tag shows the name that the partner's card shows, for example "Ermengarde III". [...] A person with no number keeps
// the full name." A written `as` with no number changes the card (D131) but not the tag; a numbered ruler's tag shows the card's name.
const TREE = `people:
  - {id: a, name: Marta de Calvera, sex: f}
  - {id: b, name: Berthe}
  - {id: e, name: Ermengarde de Rais, sex: f}
titles:
  - id: crown
    name: Queen
    holders:
      - {person: a, as: Marta}
      - {person: e, as: Ermengarde, number: III}
`;

describe('D344 2 A: the tag name of a ruler with and without a number', () => {
	const s = build(TREE);
	const labels = cardLabels(s.g);

	it('as: Marta with no number: the card shows "Marta", the tag keeps "Marta de Calvera", and the spoken label follows', () => {
		expect(labels.get('a')!.name).toBe('Marta');
		expect(labels.get('a')!.numbered).toBeUndefined();
		expect(farTagName(s.g, ['a'], labels)).toBe('Marta de Calvera');
		expect(farTagLabel(s.g, ['a'], labels)).toBe('Show the partner Marta de Calvera.');
	});

	it('a numbered ruler: the tag shows the card\'s name "Ermengarde III", and the spoken label follows', () => {
		expect(labels.get('e')!.name).toBe('Ermengarde III');
		expect(farTagName(s.g, ['e'], labels)).toBe('Ermengarde III');
		expect(farTagLabel(s.g, ['e'], labels)).toBe('Show the partner Ermengarde III.');
	});

	it('a person with no title keeps the full name', () => {
		expect(farTagName(s.g, ['b'], labels)).toBe('Berthe');
	});
});
