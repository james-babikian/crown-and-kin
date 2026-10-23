import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { STROKES } from '../../src/render/styles';
import { LEGEND_LABELS, LEGEND_ORDER, cardLabel, partnersAndChildren, farTagLabel, farTagName, linkTarget, startPerson, timingText } from '../../src/render/tree-info';
import { PROBLEMS_HINT, UI, problemsLabel, problemsTitle } from '../../src/render/ui-text';

function graph(yaml: string) {
	const r = parseDynasty(yaml);
	if (!r.ok) throw new Error('parse failed');
	return deriveFamilies(r.tree);
}

const TREE = `
people:
  - id: child
    name: Child
    parents: [a, b]
  - id: a
    name: Aldric
    title: Duke
    born: "1102"
    died: "1161"
  - id: b
    name: Berthe
  - id: c
    name: Cora
    parents: [a]
`;

describe('start person (spec §5.5)', () => {
	it('uses options.start when that person exists', () => {
		expect(startPerson(graph(TREE), 'c')).toBe('c');
	});

	it('uses the first root in document order otherwise', () => {
		expect(startPerson(graph(TREE), undefined)).toBe('a');
		expect(startPerson(graph(TREE), 'nobody')).toBe('a');
	});

	it('is null for an empty tree', () => {
		expect(startPerson(graph('people: []'), undefined)).toBeNull();
	});
});

describe('family of the start person (spec §5.5, D13)', () => {
	it('lists partners and children, each once', () => {
		const g = graph(`${TREE}  - id: d
    name: Dora
  - id: e
    name: Edda
    parents: [a, d]
  - id: f
    name: Fulk
    parents: [d, a]
unions:
  - partners: [a, d]
`);
		const f = partnersAndChildren(g, 'a');
		expect(f.partners.sort()).toEqual(['b', 'd']);
		expect(f.children.sort()).toEqual(['c', 'child', 'e', 'f']);
		expect(partnersAndChildren(g, 'd')).toEqual({ partners: ['a'], children: ['e', 'f'] });
	});

	it('is empty for a person with no partner and no child', () => {
		expect(partnersAndChildren(graph(TREE), 'c')).toEqual({ partners: [], children: [] });
	});
});

describe('card text', () => {
	it('labels a card with name, title and dates', () => {
		const g = graph(TREE);
		expect(cardLabel(g.byId.get('a')!)).toBe('Aldric, Duke, 1102–1161');
		expect(cardLabel(g.byId.get('b')!)).toBe('Berthe');
	});

	it('names far partners', () => {
		const g = graph(TREE);
		expect(farTagLabel(g, ['b'])).toBe('Show the partner Berthe.');
		expect(farTagLabel(g, ['b', 'c'])).toBe('Show a list of 2 partners.');
	});

	it('gives the visible far-tag text after the sign: a name, or the number of partners', () => {
		const g = graph(TREE);
		expect(farTagName(g, ['b'])).toBe('Berthe');
		expect(farTagName(g, ['nobody'])).toBe('nobody');
		expect(farTagName(g, ['b', 'c', 'd'])).toBe('3 partners');
	});
});

describe('link targets (spec §5.2)', () => {
	it.each([
		['[[Wren of the Marches]]', 'Wren of the Marches'],
		['[[Wren|the Wren]]', 'Wren'],
		['[[Wren#Early life|Wren]]', 'Wren#Early life'],
		['Wren', 'Wren'],
		['  [[Wren]]  ', 'Wren'],
		['[Wren](Wren%20of%20the%20Marches.md)', 'Wren of the Marches.md'],
		['[Wren](<Wren of X.md>)', 'Wren of X.md'],
		['[Wren](bad%zz)', 'bad%zz'],
	])('%s → %s', (link, target) => {
		expect(linkTarget(link)).toBe(target);
	});

	it.each([[undefined], [''], ['[[]]'], ['[[ ]]'], ['#']])('%s is no link', (link) => {
		expect(linkTarget(link)).toBeNull();
	});
});

describe('plugin text obeys the word list', () => {
	const texts = [
		...Object.values(LEGEND_LABELS),
		...Object.values(UI),
		PROBLEMS_HINT,
		problemsLabel(1),
		problemsLabel(3),
		problemsTitle(1),
		problemsTitle(3),
		timingText(null),
		timingText({ path: 'a.md', people: 2, parseMs: 1, layoutMs: 2, drawMs: 3, totalMs: 6 }),
		timingText({ path: 'a.md', people: 2, parseMs: 1, layoutMs: 2, drawMs: 3, totalMs: 6, interactiveMs: 30, full: true }),
	];

	it.each(texts)('%s', (t) => {
		expect(t).not.toMatch(/\b(union|edge|node|graph|diagram|file|document|fixture|layer|rank)s?\b/i);
		expect(t).not.toMatch(/n't\b/);
		for (const sentence of t.split(/(?<=\.)\s+/)) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(20);
	});

	it('the legend has a label for every line style, in its order', () => {
		expect(Object.keys(LEGEND_LABELS).sort()).toEqual(Object.keys(STROKES).sort());
		expect([...LEGEND_ORDER].sort()).toEqual(Object.keys(STROKES).sort());
	});

	it('the timing text gives every part', () => {
		expect(timingText({ path: 'Big.md', people: 389, parseMs: 12.4, layoutMs: 5.6, drawMs: 80.2, totalMs: 98.2 })).toBe(
			'The last tree (Big.md, 389 people) took 98 ms. Time to read the text: 12 ms. Time to arrange the people: 6 ms. Time to draw the tree: 80 ms.',
		);
	});

	it('the timing text starts with the time until the tree was ready for use (spec §7.7)', () => {
		expect(timingText({ path: 'Big.md', people: 389, parseMs: 12.4, layoutMs: 5.6, drawMs: 80.2, totalMs: 98.2, interactiveMs: 161.8 })).toBe(
			'The last tree (Big.md, 389 people) was ready for use after 162 ms. Time to read the text: 12 ms. Time to arrange the people: 6 ms. Time to make the cards and lines: 80 ms. Time to show them on the screen: 64 ms.',
		);
		expect(timingText({ path: 'Big.md', people: 1, parseMs: 0, layoutMs: 0, drawMs: 1, totalMs: 1, interactiveMs: 20, full: true })).toMatch(/^The last tree \(Big\.md, 1 person, full-screen\) was ready for use after 20 ms\./);
	});

	it('in focus mode the timing text names the family and the whole tree (the decision notes WP5.2 fix round 2)', () => {
		expect(timingText({ path: 'Big.md', people: 38, of: 389, parseMs: 0, layoutMs: 0, drawMs: 1, totalMs: 1, interactiveMs: 20, full: true })).toMatch(
			/^The last tree \(Big\.md, the family, 38 of 389 people, full-screen\) was ready for use after 20 ms\./,
		);
		expect(timingText({ path: 'Big.md', people: 389, of: 389, parseMs: 0, layoutMs: 0, drawMs: 1, totalMs: 1 })).toMatch(/^The last tree \(Big\.md, 389 people\) took 1 ms\./);
	});
});
