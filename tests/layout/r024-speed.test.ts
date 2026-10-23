import { describe, expect, it } from 'vitest';
import { speedTest } from '../support/speed-test';
import { geometryFor } from '../../src/layout/geometry';
import { arrangeTree } from '../../src/layout/pipeline';
import type { LayoutSettings } from '../../src/layout/model';
import { build, fixture } from '../support/helpers';
import { rumourTree } from '../support/random-trees';

// 0.2.4 layout-fix, the two speed fixes: `placeUnions` for the dots of one row, and the "?" search near its curve. Both keep every picture.
// 0.2.4 cards-b: the picture hashes were recorded again for the card geometry (card 61 px high, was 64). Checked: the code of the layout-fix head with only the card height
// changed (3.8 em) gives the same five hashes, so the speed fixes still keep every picture. The counters and the speed bounds are as they were.
// 0.3.1 (WP-4b, the speed protocol, the architecture notes §6.4): the call is `arrangeTree`. The counters `unionWork` and `rumourWork` do not exist any more (`placeUnions` and the
// old "?" search are gone: the dots hang on ports, the "?" search is `rumour-spot.ts` without counters), so the two bounds on counts became ratios of
// time in one process (the I34 lesson). The picture hashes are golden values (class a): the one record of the switch writes them again.
// 0.3.1 golden record (an internal study): the five picture hashes were recorded again, once, for the new walk, passages and ports.

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

function hash(s: string): string {
	let h = 0xdeadbeef;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
	return (h >>> 0).toString(16);
}

/** The whole picture of a tree (cards, dots, row gaps, size, lines) as one hash, with no cache and no folds. */
function picture(src: string, settings: LayoutSettings) {
	const { g, gen } = build(src);
	const { layout, edges } = arrangeTree(g, gen, { ...geometryFor(16) }, settings);
	return { g, hash: hash(JSON.stringify([[...layout.persons], [...layout.unions], layout.rowGaps, layout.width, layout.height, edges])) };
}

/** The median of `runs` timed layouts of `src` (after one warm-up), in ms. */
function medianMs(src: string, settings: LayoutSettings, runs: number): number {
	picture(src, settings);
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		picture(src, settings);
		times.push(performance.now() - t0);
	}
	times.sort((a, b) => a - b);
	return times[Math.floor(runs / 2)];
}

/** A tree of `n` couples, each with one child who marries the next couple's child: many dots in every row. */
function manyDots(n: number): string {
	const people: string[] = [];
	for (let i = 0; i < n; i++) {
		const root = i < 4 ? '' : `, parents: [c${i % 4}a, c${i % 4}b]`;
		people.push(`  - {id: c${i}a, name: A${i}${root}}`, `  - {id: c${i}b, name: B${i}}`);
	}
	const unions = Array.from({ length: n }, (_, i) => `  - {partners: [c${i}a, c${i}b]}`);
	return `people:\n${people.join('\n')}\nunions:\n${unions.join('\n')}\n`;
}

describe('speed 1: the dots of one row cost about as much as the people (was the counter `unionWork`)', () => {
	speedTest('grows about linearly: 4 times the couples take less than 10 times as long', () => {
		const settings: LayoutSettings = { sweeps: 4, far: FAR };
		const small = medianMs(manyDots(250), settings, 5);
		const big = medianMs(manyDots(1000), settings, 5);
		expect(big / small, `${small.toFixed(0)} ms -> ${big.toFixed(0)} ms`).toBeLessThan(10);
	}, 120_000);

	it('keeps the picture of sample tree 07, down and sideways', () => {
		const src = fixture('07');
		for (const [settings, hashed] of [
			[{ sweeps: 4, far: FAR }, 'fb023097'],
			[{ sweeps: 4, far: FAR, orientation: 'sideways' as const }, 'e4022e54'],
		] as const) expect(picture(src, settings).hash).toBe(hashed);
	});
	it('keeps the picture of sample tree 6', () => {
		expect(picture(fixture('06'), { sweeps: 4, far: FAR }).hash).toBe('3d451ef7');
	});
});

describe('speed 2: the "?" search looks only near its curve', () => {
	speedTest('a rumoured link on every person: 4 times the people take less than 10 times as long (was the counter `rumourWork`; the ratio test is review-r028-layout-speed)', () => {
		const settings: LayoutSettings = { sweeps: 4, far: FAR };
		const small = medianMs(rumourTree(250), settings, 5);
		const big = medianMs(rumourTree(1000), settings, 5);
		expect(big / small, `${small.toFixed(0)} ms -> ${big.toFixed(0)} ms`).toBeLessThan(10);
	}, 120_000);

	it('a 400-person tree with a rumoured link on every person: same pictures', () => {
		for (const [settings, hashed] of [
			[{ sweeps: 4, far: FAR }, '36b798db'], // 0.3.1 second fix round (an internal note)
			[{ sweeps: 4, far: FAR, orientation: 'sideways' as const }, '47ee646'], // 0.3.1 second fix round, as above
		] as const) expect(picture(rumourTree(400), settings).hash).toBe(hashed);
	});
});
