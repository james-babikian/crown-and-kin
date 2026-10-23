import { describe, expect, it } from 'vitest';
import { housePage } from '../../src/core/house-page';
import { withSobriquet } from '../../src/core/sobriquet';
import { cardLabels, holderTable, pickerSuffix, searchNames } from '../../src/core/titles';
import { cardLabel } from '../../src/render/tree-info';
import { build } from '../support/helpers';

// 0.2.5 (D131, conservative reading, supervisor ruling R-D131): the card shows the ruler name only for an entry with a number or a written `as`.

const graph = (holders: string) =>
	build(`people:
  - {id: a, name: Marta de Calvera, sobriquet: the Bear, sex: f, house: v}
  - {id: g, name: Ser Gareth Orsini, sex: m, house: v}
titles:
  - id: crown
    name: Queen
    holders:
${holders}
houses:
  - {id: v, name: Vale}
`);

const labelOf = (source: ReturnType<typeof graph>, id: string) => cardLabels(source.g).get(id)!;

describe('D131: the ruler name on the card', () => {
	it('(1) an entry with `as` and no number shows the ruler name, with no `numbered` key; the sobriquet stays apart', () => {
		const l = labelOf(graph('      - {person: a, as: Marta}'), 'a');
		expect(l.name).toBe('Marta');
		expect('numbered' in l).toBe(false);
		expect(l.sobriquet).toBe('the Bear');
		expect(withSobriquet(l.name, l.sobriquet)).toBe('Marta “the Bear”');
	});

	it('(2) no `as` and no number keeps the full name', () => {
		const s = graph('      - {person: g}\n      - {person: a}');
		expect(labelOf(s, 'g').name).toBe('Ser Gareth Orsini');
		expect(labelOf(s, 'a').name).toBe('Marta de Calvera');
	});

	it('(3) a number and no `as` gives the first word and the number, and sets `numbered`', () => {
		const l = labelOf(graph('      - {person: g, number: I}'), 'g');
		expect(l.name).toBe('Ser I');
		expect(l.numbered).toBe(true);
	});

	it('(4) a numbered entry later in the list wins over an unnumbered first entry with `as`; with two unnumbered entries the first with `as` counts', () => {
		const s = graph('      - {person: a, as: Marta}\n      - {person: a, as: Aldric, number: II}');
		const l = labelOf(s, 'a');
		expect(l.name).toBe('Aldric II');
		expect(l.numbered).toBe(true);
		const t = graph('      - {person: a}\n      - {person: a, as: Marta}');
		expect(labelOf(t, 'a').name).toBe('Marta');
	});

	it('(5) the name comes from the shown title (`card-title`)', () => {
		const s = build(`people:
  - {id: a, name: Marta de Calvera, card-title: duchy}
titles:
  - id: crown
    name: Queen
    holders:
      - {person: a, as: Marta}
  - id: duchy
    name: Duchess
    holders:
      - {person: a, as: Mar}
`);
		expect(labelOf(s, 'a').name).toBe('Mar');
	});

	it('(6) no holding keeps the full name; an empty `as` keeps the full name', () => {
		const s = graph('      - {person: g, as: "  "}');
		expect(labelOf(s, 'a').name).toBe('Marta de Calvera');
		expect(labelOf(s, 'g').name).toBe('Ser Gareth Orsini');
	});

	it('(7) Find and the picker: an unnumbered `as` is matched once; the suffix is only for a numbered entry', () => {
		const s = graph('      - {person: a, as: Marta}\n      - {person: a, as: Marta}');
		const l = labelOf(s, 'a');
		expect(searchNames(l, 'Marta de Calvera')).toEqual(['Marta']);
		expect(pickerSuffix(l, 'Marta de Calvera')).toBeUndefined();
		const n = graph('      - {person: a, as: Marta}\n      - {person: a, number: II}');
		expect(searchNames(labelOf(n, 'a'), 'Marta de Calvera')).toEqual(['Marta', 'Marta II']);
		expect(pickerSuffix(labelOf(n, 'a'), 'Marta de Calvera')).toBe('(Marta II)');
		// No `as` and no number: nothing extra to find.
		expect(searchNames(labelOf(graph('      - {person: a}'), 'a'), 'Marta de Calvera')).toEqual([]);
	});

	it('(8) the house page: the ruler name with the number for a numbered entry; the full name for an unnumbered one, also with `as`', () => {
		const s = graph('      - {person: a, as: Marta}\n      - {person: g, number: I, as: Gareth}');
		const names = Object.fromEntries(housePage(s.g, 'v')!.rows.map((r) => [r.id, r.name]));
		expect(names).toEqual({ a: 'Marta de Calvera “the Bear”', g: 'Gareth I' });
	});

	it('(9) the screen-reader label uses the card name; the table note and the full name elsewhere stay full', () => {
		const s = graph('      - {person: a, as: Marta}');
		const l = labelOf(s, 'a');
		const p = s.g.byId.get('a')!;
		expect(cardLabel(p, 'Brother', l)).toBe('Marta, Queen, Brother');
		const title = s.g.titles![0];
		expect(holderTable(s.g, title)).toContain('| Marta | Marta de Calvera |');
		expect(p.name).toBe('Marta de Calvera');
	});
});
