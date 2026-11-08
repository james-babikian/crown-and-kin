import { describe, expect, it } from 'vitest';

import { orientation, relationView, setupRelationViewTests } from '../acceptance/relation-view-support';

/*
 * The first view of the relation finder's small tree must show both named people: the start person and the second person of the
 * sentence. Sample tree 12, Alan > Nils ("Nils is Alan's wife's first cousin"): on an upright iPhone (402 x 874 CSS px, the result
 * bar 62..114 px, the bottom toolbar from 789 px) the view centres the common ancestors Sigmund and Wilma and leaves Alan, who
 * stands left of his wife Dana on the bottom row, wholly off the screen.
 */

setupRelationViewTests();

describe('the relation finder first view keeps both named people on the screen', () => {
	it('sample tree 12, Alan > Nils on an upright iPhone (402 x 874): the small tree is top to bottom (D203) and Alan, the start person, is whole', async () => {
		const { root, where, msg } = await relationView('iphone', 'alan', 'nils');
		expect(root.querySelector('.dynasty-result-text')?.getText()).toBe('Nils is Alan’s wife’s first cousin.');
		expect(orientation(root)).toBe('down');
		expect(where.alan, msg).toBe('whole');
	});

	it('sample tree 12, Alan > Nils on an upright iPhone: Nils, the second person, is whole', async () => {
		const { where, msg } = await relationView('iphone', 'alan', 'nils');
		expect(where.nils, msg).toBe('whole');
	});

	it.each([
		['alan', 'thea'],
		['alan', 'rolf'],
		['gwen', 'orla'],
		['dana', 'fenna'],
	])('sample tree 12, %s > %s on an upright iPhone: both named people are whole', async (a, b) => {
		const { where, msg } = await relationView('iphone', a, b);
		expect(where[a], msg).toBe('whole');
		expect(where[b], msg).toBe('whole');
	});

	it.each(['ipad', 'computer'] as const)('sample tree 12, Alan > Nils on the %s: both named people are whole', async (kind) => {
		const { where, msg } = await relationView(kind, 'alan', 'nils');
		expect(where.alan, msg).toBe('whole');
		expect(where.nils, msg).toBe('whole');
	});
});
