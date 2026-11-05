/*
 * 0.2.8 speed repair: the same look with less work in the first view. These tests hold what must not change: the size of a Compact name is the one that a walk down
 * from the top size gives (D203), and a name that fits is measured once.
 */
import { describe, expect, it } from 'vitest';
import { COMPACT_NAME_EM, COMPACT_NAME_MIN_EM, COMPACT_STEPS, compactNameStep } from '../../src/render/dom/scene';

/** The walk of 0.2.8 before the repair: from 1.5 em down in steps of 0.05 em to the first size that fits, else the smallest. */
function walk(widthAt: (em: number) => number, maxW: number): { em: number; measures: number } {
	let em = COMPACT_NAME_EM;
	let measures = 0;
	const measured = (e: number) => {
		measures++;
		return widthAt(e);
	};
	while (em > COMPACT_NAME_MIN_EM + 1e-9 && measured(em) > maxW) em = Math.max(COMPACT_NAME_MIN_EM, em - 0.05);
	return { em, measures };
}

describe('the sizes of a Compact name', () => {
	it('run from 1.5 em to 1.05 em in steps of 0.05 em', () => {
		expect(COMPACT_STEPS[0]).toBe(COMPACT_NAME_EM);
		expect(COMPACT_STEPS[COMPACT_STEPS.length - 1]).toBe(COMPACT_NAME_MIN_EM);
		expect(COMPACT_STEPS).toHaveLength(10);
	});

	it('give the same size as the walk down for every width and room (linear widths, and widths that grow a little faster than the size)', () => {
		let cases = 0;
		let fewer = 0;
		for (const power of [1, 1.07, 0.96]) {
			for (let c = 8; c <= 420; c += 3.7) {
				for (let room = 0; room <= 640; room += 7.3) {
					const widthAt = (em: number) => c * em ** power;
					const want = walk(widthAt, room);
					let measures = 0;
					const k = compactNameStep((i) => {
						measures++;
						return widthAt(COMPACT_STEPS[i]!);
					}, room);
					expect(COMPACT_STEPS[k]).toBe(want.em);
					cases++;
					if (measures <= want.measures) fewer++;
				}
			}
		}
		expect(cases).toBeGreaterThan(10000);
		// The guess keeps the number of measures at or under the walk's in nearly every case; a name much too wide takes one or two more than a walk of one step.
		expect(fewer / cases).toBeGreaterThan(0.9);
	});

	it('give the same size when the width jumps in steps (a measure that rounds to whole pixels)', () => {
		for (let c = 10; c <= 400; c += 5.3) {
			for (let room = 20; room <= 600; room += 11) {
				const widthAt = (em: number) => Math.round(c * em);
				expect(COMPACT_STEPS[compactNameStep((i) => widthAt(COMPACT_STEPS[i]!), room)]).toBe(walk(widthAt, room).em);
			}
		}
	});

	it('measure a name that fits once, and a name with no room at all down to the smallest size', () => {
		let n = 0;
		expect(
			compactNameStep(() => {
				n++;
				return 50;
			}, 80),
		).toBe(0);
		expect(n).toBe(1);
		expect(compactNameStep((i) => 100 * COMPACT_STEPS[i]!, -5)).toBe(COMPACT_STEPS.length - 1);
		expect(compactNameStep((i) => 100 * COMPACT_STEPS[i]!, 0)).toBe(COMPACT_STEPS.length - 1);
	});
});
