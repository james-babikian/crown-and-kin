/*
 * 0.2.8 P4 (contract B.3, F-LAYOUT-03): the "?" search (now `src/layout/rumour-spot.ts`, called by `routeTree`; was `routeEdges`) uses grids of lines, dots and cards. It must give the same marks as the search
 * that scanned everything: the hashes below are the marks of the made-up rumoured trees from before the change (md5 of "x,y;x,y;..."), so a change of one
 * mark fails. 0.3.0 (N05): both hashes were recorded again; a dot of partners on different rows now lies between its two legs, which moves the lines these trees' marks lie on (cards keep their place in their row; a row may move by whole lanes of 12 px). The G2 round of N05 recorded them a second time (a dot with no free place in its span goes onto the nearer leg; its couple lane follows the moved dot).
 * 0.3.1 (WP-4b): the call is `arrangeTree`; both hashes are golden values (class a) that the one record of the switch writes again.
 * 0.3.1 golden record (an internal study): both hashes were recorded again, once, for the new walk, passages and ports.
 * 0.3.1 fix round (item 5): the 250 people hash was recorded again (an internal study, "fix round").
 * 0.3.1 second fix round: both hashes were recorded again (an internal note, "Second fix round", items 1 and 3).
 * The speed proof is `review-r028-layout-speed.test.ts` (4 times the people take less than 10 times as long).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS } from '../../src/layout/layout';
import { arrangeTree } from '../../src/layout/pipeline';
import { build } from '../support/helpers';
import { rumourTree } from '../support/random-trees';

function marksHash(source: string): string {
	const { g, gen } = build(source);
	const marks = arrangeTree(g, gen, { ...cardForm(geometryFor(16), 'down') }, { ...DEFAULT_LAYOUT_SETTINGS }).edges.markers.filter((m) => m.kind === 'rumour').map((m) => `${m.x.toFixed(2)},${m.y.toFixed(2)}`);
	return createHash('md5').update(marks.join(';')).digest('hex').slice(0, 10);
}

describe('the "?" marks of a tree with a rumoured parent on every person', () => {
	it('250 people: the marks of the full scan', () => expect(marksHash(rumourTree(250))).toBe('941653eabc')); // 0.3.1 second fix round (an internal note)
	it('1000 people: the marks of the full scan', () => expect(marksHash(rumourTree(1000))).toBe('18ae8c22e1')); // 0.3.1 second fix round (an internal note)
});
