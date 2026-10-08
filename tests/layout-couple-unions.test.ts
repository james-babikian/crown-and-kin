import { describe, expect, it } from 'vitest';
import { geometryFor } from '../src/layout/geometry';
import { clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings } from '../src/layout/model';
import { build } from './helpers';

// Review 0.1.1 C2: a couple with several unions side by side (the decision notes "Second union for a couple").

const FAR = { maxCardWidths: 3, maxGenerations: 1 };
const SRC = `people:
  - {id: a, name: A, sex: m}
  - {id: b, name: B, sex: f}
  - {id: c1, name: C1, parents: [a, b], union: first}
  - {id: c2, name: C2, parents: [a, b], union: second}
unions:
  - {id: first, partners: [a, b], type: betrothal}
  - {id: second, partners: [a, b], type: marriage}
`;

function lay(settings: LayoutSettings, font = 16) {
	const { g } = build(SRC);
	clearLayoutCache();
	return { g, ...layoutTree(g, geometryFor(font), settings, 'test') };
}

describe('two unions of one side-by-side couple', () => {
	for (const orientation of ['down', 'sideways'] as const) {
		for (const font of [8, 16]) {
			it(`${orientation}, ${font} px: one bar, a dot for each union in list order, a trunk from each dot`, () => {
				const { g, layout, edges } = lay({ sweeps: 4, far: FAR, orientation }, font);
				const [first, second] = g.unions.map((u) => layout.unions.get(u.key)!);
				const [a, b] = ['a', 'b'].map((id) => layout.persons.get(id)!);
				// Along the gap: x in `down`, y sideways (the partners are stacked).
				const along = (p: { x: number; y: number }) => (orientation === 'down' ? p.x : p.y);
				const [lo, hi] = orientation === 'down' ? [a.x + a.w, b.x] : [a.y + a.h, b.y];
				for (const u of [first, second]) {
					expect(along(u)).toBeGreaterThan(lo);
					expect(along(u)).toBeLessThan(hi);
				}
				expect(along(first)).toBeLessThan(along(second));
				expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThanOrEqual(layout.geometry.unionSize);

				const couple = edges.paths.filter((p) => p.people.length === 2 && p.people.includes('a') && p.people.includes('b'));
				expect(couple).toHaveLength(1);
				// The last-listed union (the marriage) gives the bar its style.
				expect(couple[0].kind).toBe('marriage');

				for (const [u, kid] of [
					[first, 'c1'],
					[second, 'c2'],
				] as const) {
					const trunk = edges.paths.find((p) => p.people.length === 3 && p.people.includes(kid) && p.people[0] !== kid)!;
					const [, x, y] = /^M([-\d.]+) ([-\d.]+)/.exec(trunk.d)!.map(Number);
					expect(Math.hypot(x - u.x, y - u.y)).toBeLessThan(0.1);
				}
			});
		}
	}
});
