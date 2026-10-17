// Research placements of the card-and-line build (the architecture notes §4.2.2 `opts.place`, §6.4, A16): placement stages composed from the exported steps of
// `src/layout/place.ts` and given to the pipeline through `arrangeTree(..., { place })`. The system has no knob for them. Moved from
// `scripts/layout-fable/placements.ts`. Used by the tests of A16 (packed rows, random and jittered placements give 0 hard faults) and by the round-off
// tests (`jitteredPlacement`: +-1e-11 px must change nothing, I7).
// `CARD_LINE_PLACE=packed` or `CARD_LINE_PLACE=random:<max px>` selects one for the scripts (`placementFromEnv`, read by an internal script).
import { compactStep, normalise, packRows, shapesOf, sweepRows } from '../../src/layout/place';
import type { Placement } from '../../src/layout/pipeline';

export type { Placement };

/** Packed rows only (no sweeps, no compaction). */
export const packedPlacement: Placement = (plan) => {
	packRows(plan);
	normalise(plan);
};

/** A small deterministic random source (an LCG). */
function rng(seed: number): () => number {
	let a = seed;
	return () => ((a = (a * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** Packed rows with a random extra gap, up to `max` px, before each block; the order and the minimum gaps stay. */
export const randomPlacement =
	(seed: number, max: number): Placement =>
	(plan) => {
		const rand = rng(seed);
		const shapes = shapesOf(plan);
		for (let r = 0; r < plan.rows.length; r++) {
			const mins = shapes.rowMin(r);
			let x = 0;
			plan.rowBlocks[r].forEach((bi, i) => {
				x += mins[i] + (i ? rand() * max : 0);
				shapes.setLeft(bi, x);
			});
		}
		normalise(plan);
	};

/** The normal placement with a tiny move of each block's packed start (by the block's first item), for the noise tests (+-1e-11 px must change nothing). */
export const jitteredPlacement =
	(jitter: (id: string) => number, sweeps = 4): Placement =>
	(plan, g, geo) => {
		const shapes = shapesOf(plan);
		packRows(plan, shapes);
		for (const b of plan.blocks) {
			const dx = jitter(b[0].id);
			for (const it of b) it.x += dx;
		}
		sweepRows(plan, geo, sweeps, shapes);
		compactStep(plan, g, geo);
		normalise(plan);
	};

/** The placement the environment asks for (`CARD_LINE_PLACE`), or none (the normal placement). */
export function placementFromEnv(): { place?: Placement } {
	const want = process.env.CARD_LINE_PLACE;
	if (want === 'packed') return { place: packedPlacement };
	if (want?.startsWith('random')) return { place: randomPlacement(7, Number(want.split(':')[1] ?? 200)) };
	return {};
}
