// Two families of one card hang side by side. Their sibling bars that end less than a couple gap apart read as one bar at one height (fix round, item 6,
// Opus design check, owner tree 2: two stems 23 px apart). `Net.owners` names the parents (second fix round: a list, so a family with two parents names both); bars that share a parent within `kinGap` of each other take two lanes.
import { describe, expect, it } from 'vitest';
import { net, orderNets, type Net } from '../../src/layout/lanes';

const bar = (key: string, lo: number, hi: number, owner?: string): Net => net({ gap: 0, lo, hi, key, kind: 'bar', topVerts: [lo], downVerts: [hi], ...(owner ? { owners: [owner] } : {}) });
const MARGIN = 12;
const KIN = 36;

describe('bars of two families of one card', () => {
	it('end 24 px apart: two lanes when the card is the same, one lane when it is not', () => {
		const same = [bar('a', 0, 100, 'p'), bar('b', 124, 224, 'p')];
		expect(orderNets(same, MARGIN, 7, 'up', 10, 22, [], KIN)).toBe(2);
		expect(same[0].lane).not.toBe(same[1].lane);
		const other = [bar('a', 0, 100, 'p'), bar('b', 124, 224, 'q')];
		expect(orderNets(other, MARGIN, 7, 'up', 10, 22, [], KIN)).toBe(1);
	});
	it('a family of two parents names both: its bar and the bar of either parent alone take two lanes (second fix round, item 3)', () => {
		const couple = (key: string, lo: number, hi: number) => net({ gap: 0, lo, hi, key, kind: 'bar', topVerts: [lo], downVerts: [hi], owners: ['p', 'q'] });
		for (const one of ['p', 'q']) expect(orderNets([couple('a', 0, 100), bar('b', 124, 224, one)], MARGIN, 7, 'up', 10, 22, [], KIN)).toBe(2);
		expect(orderNets([couple('a', 0, 100), bar('b', 124, 224, 'r')], MARGIN, 7, 'up', 10, 22, [], KIN)).toBe(1);
	});
	it('end a couple gap or more apart: one lane', () => {
		expect(orderNets([bar('a', 0, 100, 'p'), bar('b', 100 + KIN + 1, 300, 'p')], MARGIN, 7, 'up', 10, 22, [], KIN)).toBe(1);
	});
	it('no kin gap given: the margin only (the old packing)', () => {
		expect(orderNets([bar('a', 0, 100, 'p'), bar('b', 124, 224, 'p')], MARGIN, 7, 'up', 10, 22, [])).toBe(1);
	});
});
