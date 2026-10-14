import { describe, expect, it } from 'vitest';
import { routeEdges, rumourWork } from '../src/layout/edges';
import { geometryFor } from '../src/layout/geometry';
import { layoutFamilies, unionWork } from '../src/layout/layout';
import type { LayoutSettings } from '../src/layout/model';
import { build, fixture } from './helpers';
import { rumourTree } from './random-trees';

// 0.2.4 layout-fix, the two speed fixes: `placeUnions` for the dots of one row, and the "?" search near its curve. Both keep every picture.
// 0.2.4 cards-b: the picture hashes were recorded again for the card geometry (card 61 px high, was 64). Checked: the code of the layout-fix head with only the card height
// changed (3.8 em) gives the same five hashes, so the speed fixes still keep every picture. The counters and the speed bounds are as they were.

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

function hash(s: string): string {
	let h = 0xdeadbeef;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
	return (h >>> 0).toString(16);
}

/** The whole picture of a tree (cards, dots, row gaps, size, lines) as one hash, with no cache and no folds. */
function picture(src: string, settings: LayoutSettings) {
	const { g, gen, order } = build(src);
	const layout = layoutFamilies(g, gen, order, { ...geometryFor(16) }, settings);
	const edges = routeEdges(g, layout, order.anchors);
	return { g, hash: hash(JSON.stringify([[...layout.persons], [...layout.unions], layout.rowGaps, layout.width, layout.height, edges])) };
}

describe('speed 1: only the dots a sweep reads are placed', () => {
	it('places a small share of the dots, with the same pictures as before', () => {
		const src = fixture('07');
		for (const [settings, hashed, most] of [
			[{ sweeps: 4, far: FAR }, '496d5c75', 0.15],
			[{ sweeps: 4, far: FAR, orientation: 'sideways' as const }, 'dad4ae0', 0.15],
		] as const) {
			unionWork.calls = 0;
			unionWork.placed = 0;
			const { g, hash: h } = picture(src, settings);
			// The old code placed every union at every call (15 219 and 23 085 placements here); a row needs about a twelfth.
			expect(unionWork.placed / (unionWork.calls * g.unions.length)).toBeLessThan(most);
			expect(h).toBe(hashed);
		}
	});
	it('keeps the picture of sample tree 6', () => {
		expect(picture(fixture('06'), { sweeps: 4, far: FAR }).hash).toBe('d185b38d');
	});
});

describe('speed 2: the "?" search looks only near its curve', () => {
	it('a 400-person tree with a rumoured link on every person: few distance tests, same pictures', () => {
		for (const [settings, hashed] of [
			[{ sweeps: 4, far: FAR }, 'a0235483'],
			// The speed fix alone gave 9b7d65c9 here (commit 8566006); the L2 fix then moved the exit of a few lines that touched a dot.
			// 0.2.6 (D177 item 9, cross): both hashes were recorded again (random tree: crossings 164 to 154 down, 74 to 58 sideways).
			// 0.3.0 (N05): both hashes were recorded again (a dot of partners on different rows now lies between its legs; random tree 400: cards keep their places along their rows). The G2 round of N05 recorded them a second time (a dot keeps clear of a folded sign and sits on the nearer leg when its span is full; a tie of the side of a leg now goes one way in both plans).
			// 0.2.5 (D140, WP-A1): both hashes were recorded again; the rows step keeps 2 moves of 207 tries and moves 14 people.
			[{ sweeps: 4, far: FAR, orientation: 'sideways' as const }, '35f93a7b'],
		] as const) {
			rumourWork.distances = 0;
			const { hash: h } = picture(rumourTree(400), settings);
			// The old search made 22 million tests (down) and 9.5 million (sideways); after the fix, under 100 000.
			expect(rumourWork.distances).toBeLessThan(1_000_000);
			expect(h).toBe(hashed);
		}
	});
});

