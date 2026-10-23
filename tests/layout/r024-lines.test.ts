import { describe, expect, it } from 'vitest';
import { foldFamilies, foldHidden, pruneGraph } from '../../src/core/folds';
import { geometryFor } from '../../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { LayoutSettings } from '../../src/layout/model';
import { build } from '../support/helpers';
import { lineProblems, randomTree } from '../support/random-trees';
import { rng } from '../support/rng';

// 0.2.4 layout-fix: L1 (lines in a folded family) and L2 (a dot touched by a line that leaves a sideways card), on random trees.

const FAR = { maxCardWidths: 3, maxGenerations: 1 };

/**
 * The line problems of one random tree in 8 views: down and sideways, and four variants (plain, long names,
 * folds, both). The folds and the long names are drawn from one generator in a fixed order, so a key names the same picture every time.
 */
function problemsOf(seed: number): Map<string, string[]> {
	const { g } = build(randomTree(seed));
	const rand = rng(seed * 7919);
	const out = new Map<string, string[]>();
	for (const orientation of ['down', 'sideways'] as const) {
		for (const variant of ['plain', 'long', 'fold', 'both'] as const) {
			const folded = variant === 'fold' || variant === 'both' ? foldFamilies(g).filter(() => rand() < 0.4).map((f) => f.key) : [];
			const hidden = foldHidden(g, new Set(folded));
			const long = variant === 'long' || variant === 'both' ? g.people.map((p) => p.id).filter(() => rand() < 0.3) : [];
			const settings: LayoutSettings = {
				sweeps: 4,
				far: FAR,
				orientation,
				...(long.length ? { tallCards: long, longNames: long } : {}),
				...(variant === 'fold' || variant === 'both' ? { foldControls: true, foldHidden: [...hidden].sort(), foldedFamilies: folded } : {}),
			};
			clearLayoutCache();
			const { layout, edges } = layoutTree(g, geometryFor(16), settings, 'x');
			out.set(`${orientation} ${variant}`, lineProblems(folded.length ? pruneGraph(g, hidden) : g, layout, edges));
		}
	}
	return out;
}

describe('L1: a folded family keeps its lines apart', () => {
	// Found by a search over 6 000 random trees (96 000 pictures): 193 had a line problem, and after the fix none has.
	// Some had a sign or a stem on another trunk; some were planned twice with different places for a leg, because the
	// layout moved every card right by the room of a fold control after the first plan.
	const found: [number, string][] = [
		[12, 'down both'],
		[12, 'sideways fold'],
		[49, 'sideways fold'],
		[71, 'sideways both'],
		[15, 'down both'],
		[89, 'down fold'],
		[627, 'down both'],
		[1673, 'down fold'],
		[1985, 'down both'],
	];
	it.each(found)('seed %i, %s', (seed, key) => {
		expect(problemsOf(seed).get(key)).toEqual([]);
	});
});

describe('L1 and L2: 300 random trees, in every view and variant, have no line problem', () => {
	it('no tree has a stem, a sign, a leg or a dot on another line', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 300; seed++) for (const [key, problems] of problemsOf(seed)) if (problems.length) bad.push(`seed ${seed} ${key}: ${problems[0]}`);
		expect(bad).toEqual([]);
	}, 30_000);
});
