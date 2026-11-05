import { describe, expect, it } from 'vitest';

import { geometryFor } from '../../src/layout/geometry';
import type { Rect } from '../../src/layout/model';
import { READABLE_CARD_TEXT_PX, READABLE_NAME_PX, SIDEWAYS_NAME_PX } from '../../src/render/view-math';
import { sidewaysView } from '../../src/view/focus-mode';

/*
 * D330 fix round, package A, C1-07: the readable zoom aims at 12 / 0.85 px of note font, so the card text on screen is 12 px. The sideways first view of a phone keeps
 * its 14 px names and its 16 px start (D24, D247, D330 O-07), so that the parents' column or the children's column fits beside the person on a 390 pt phone.
 */

describe('the readable zoom shows card text of 12 px (C1-07)', () => {
	it('aims at 12 / 0.85 = 14.12 px of note font', () => {
		expect(READABLE_CARD_TEXT_PX).toBe(12);
		expect(READABLE_NAME_PX).toBeCloseTo(12 / 0.85, 5);
	});

	it('gives card text of at least 12 px on screen at every note font size, and not a hair more than 12.001', () => {
		for (const note of [12, 14, 16, 17, 20, 24]) {
			const geo = geometryFor(note);
			const textOnScreen = 0.85 * geo.fontPx * (READABLE_NAME_PX / geo.fontPx);
			expect(textOnScreen).toBeGreaterThanOrEqual(12);
			expect(textOnScreen).toBeLessThan(12.001);
		}
	});
});

describe('the sideways first view of a phone keeps 14 px names and a first card 16 px from the left edge', () => {
	const phone = { w: 390, h: 844 };
	const box = (x: number, y = 0): Rect => ({ x, y, w: 180, h: 61 });

	it('names of 14 px, not 14.12 px', () => {
		expect(SIDEWAYS_NAME_PX).toBe(14);
		const me = box(300);
		const { view } = sidewaysView(phone, 16, { me, partners: [], children: [], parents: [] }, 91, 754, me);
		expect(view.scale * 16).toBeCloseTo(14, 6);
		// The left edge of the card is 16 px in.
		expect(phone.w / 2 + (me.x - view.cx) * view.scale).toBeCloseTo(16, 6);
	});

	it('the parents column and a childless person beside it fit on a 390 pt phone: 416 x 0.875 + 16 + 8 = 388', () => {
		const me = { x: 708, y: 0, w: 180, h: 61 };
		const parents = [{ x: 472, y: 85, w: 180, h: 61 }, { x: 472, y: 170, w: 180, h: 61 }];
		const { view } = sidewaysView(phone, 16, { me, partners: [], children: [], parents }, 91, 754, me);
		// The parents' column is the left one: its card starts 16 px in.
		expect(phone.w / 2 + (472 - view.cx) * view.scale).toBeCloseTo(16, 6);
	});
});
