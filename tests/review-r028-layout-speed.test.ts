/*
 * Search round 0.2.8, area A3 (layout): speed with many rumoured lines.
 * Timing proof: median of 5 runs each, ratio between two sizes in the same process (the I34 lesson).
 */
import { describe, expect, it } from 'vitest';
import { routeEdges } from '../src/layout/edges';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, layoutFamilies } from '../src/layout/layout';
import { build } from './helpers';
import { rumourTree } from './random-trees';

function routeMs(source: string, runs: number): number {
	const { g, gen, order } = build(source);
	const layout = layoutFamilies(g, gen, order, { ...cardForm(geometryFor(16), 'down') }, { ...DEFAULT_LAYOUT_SETTINGS });
	routeEdges(g, layout, order.anchors); // warm up
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		routeEdges(g, layout, order.anchors);
		times.push(performance.now() - t0);
	}
	times.sort((a, b) => a - b);
	return times[Math.floor(runs / 2)];
}

describe('routeEdges with a rumoured parent on every person', () => {
	it('grows about linearly: 4 times the people take less than 10 times as long (rumoured lines: "?" search scans every line and card)', () => {
		const small = routeMs(rumourTree(250), 5);
		const big = routeMs(rumourTree(1000), 5);
		// Control in the same process: the same links as ward links need no "?" and grow with the people.
		const wardSmall = routeMs(rumourTree(250).replace(/type: rumoured/g, 'type: ward'), 5);
		const wardBig = routeMs(rumourTree(1000).replace(/type: rumoured/g, 'type: ward'), 5);
		const ratio = big / small;
		const control = wardBig / wardSmall;
		expect(ratio, `rumoured ${small.toFixed(0)} ms -> ${big.toFixed(0)} ms (x${ratio.toFixed(1)}); ward control ${wardSmall.toFixed(0)} ms -> ${wardBig.toFixed(0)} ms (x${control.toFixed(1)})`).toBeLessThan(10);
	}, 120_000);
});
