/*
 * 0.2.8 P4 (contract B.3, F-LAYOUT-03): the "?" search of `routeEdges` uses grids of lines, dots and cards. It must give the same marks as the search
 * that scanned everything: the hashes below are the marks of the made-up rumoured trees from before the change (md5 of "x,y;x,y;..."), so a change of one
 * mark fails. The speed proof is `review-r028-layout-speed.test.ts` (4 times the people take less than 10 times as long).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { routeEdges } from '../src/layout/edges';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, layoutFamilies } from '../src/layout/layout';
import { build } from './helpers';
import { rumourTree } from './random-trees';

function marksHash(source: string): string {
	const { g, gen, order } = build(source);
	const layout = layoutFamilies(g, gen, order, { ...cardForm(geometryFor(16), 'down') }, { ...DEFAULT_LAYOUT_SETTINGS });
	const marks = routeEdges(g, layout, order.anchors).markers.filter((m) => m.kind === 'rumour').map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)}`);
	return createHash('md5').update(marks.join(';')).digest('hex').slice(0, 10);
}

describe('the "?" marks of a tree with a rumoured parent on every person', () => {
	it('250 people: the marks of the full scan', () => expect(marksHash(rumourTree(250))).toBe('66b68681db'));
	it('1000 people: the marks of the full scan', () => expect(marksHash(rumourTree(1000))).toBe('edcbf23e71'));
});
