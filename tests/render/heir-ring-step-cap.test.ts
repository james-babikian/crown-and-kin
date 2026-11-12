// The Overview stagger of heir rings stops at MAX_RING_STEPS (D343 4 A: the owner's page said "up to 4 steps higher (one step is 20 pixels, so 80 pixels)").
// Ten rings on one spot would otherwise climb one step each; with the cap the highest stands 4 steps up and the rest accept a touch.
import { describe, expect, it } from 'vitest';
import { MAX_RING_STEPS, RING_PX, ringLevels, type HeirRing } from '../../src/render/dom/heir-ring';

/** A ring at one place, with no cards around it (only the stagger decides). */
const ringAt = (n: number, x: number, y: number): HeirRing =>
	({
		el: undefined as unknown as SVGGElement,
		spec: { text: String(n), tab: { x, y, left: false }, top: { x, y }, block: { x: x - 50, y, w: 100, h: 60 }, edge: { x, y, room: 0 } },
		w: RING_PX.h,
		cards: [],
		stems: undefined as unknown as SVGPathElement,
		stamp: '',
	}) as unknown as HeirRing;

describe('the Overview stagger of heir rings', () => {
	it('lifts a ring at most MAX_RING_STEPS steps (4), also in a crowded place', () => {
		expect(MAX_RING_STEPS).toBe(4);
		const rings = Array.from({ length: 10 }, (_, i) => ringAt(i + 1, 100, 100));
		const levels = ringLevels(rings, 1);
		expect(Math.max(...levels)).toBe(MAX_RING_STEPS);
		expect(levels.filter((l) => l > 0).length).toBeGreaterThan(0);
	});

	it('leaves rings that touch no other ring where they are', () => {
		const rings = [ringAt(1, 0, 0), ringAt(2, 400, 0)];
		expect(ringLevels(rings, 1)).toEqual([0, 0]);
	});
});
