/*
 * D348 3 (owner, "0.5.4 design check: ... 6 Now"): "Where the ring touches a fold button, it stands at the top left corner of the card, as the last picture shows (from
 * 0.5.3). It already stands there when the edge place covers another card." On a phone with a sideways tree at the Compact level, the owner's example is ring 4 of
 * Dunstan Carrow in sample tree 16: it touched the fold button of the line into his card. A ring with no fold button near it keeps the edge place.
 */
import { describe, expect, it } from 'vitest';
import { ordinalTabRect } from '../../src/layout/geometry';
import { RING_CLEAR } from '../../src/render/dom/heir-ring';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';
import { BODY_16 } from '../support/titles-window-support';
import { overlaps, ringScene } from '../support/ring-scene';

useFakeDom({ css: true, createSvg: true });

const g16 = build(BODY_16).g;
const withFolds = ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'sideways', folds: true })!;
const noFolds = ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'sideways' })!;
const down = ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'down', folds: true })!;

/** True when the ring touches a fold mark, with the half of its 3 px halo on each side (the rule of `placeRings`). */
const touchesAFold = (rs: typeof withFolds, rect: { x: number; y: number; w: number; h: number }, scale: number): boolean => {
	const halo = (RING_CLEAR / 2) / scale;
	const grown = { x: rect.x - halo, y: rect.y - halo, w: rect.w + 2 * halo, h: rect.h + 2 * halo };
	return rs.scene.folds.some((f) => overlaps(grown, f.mark));
};

describe('the Compact ring on a phone with a sideways tree keeps off the fold buttons', () => {
	it('the sample draws fold buttons, and the ring 4 of Dunstan Carrow touched one on the edge place', () => {
		expect(withFolds.scene.folds.length).toBeGreaterThan(0);
		// The edge place of the ring, worked out without the rule: the tree without fold buttons shows where it stood.
		const before = noFolds.place('compact', 0.4, true).find((b) => b.text === '4')!;
		expect(before.id).toBe('dunstan-carrow');
		expect(touchesAFold(withFolds, before.rect, 0.4)).toBe(true);
	});

	it('after the repair, ring 4 stands at the corner of the word tab of its card, where the edge place covers a fold button', () => {
		for (const scale of [0.4, 0.3]) {
			const ring = withFolds.place('compact', scale, true).find((b) => b.text === '4')!;
			const box = withFolds.laid.layout.persons.get('dunstan-carrow')!;
			const tab = ordinalTabRect(withFolds.laid.layout.geometry, !!box.portrait, !!box.arms, 3);
			expect(ring.rect.x, String(scale)).toBeCloseTo(box.x + tab.x, 2);
			expect(ring.rect.y + ring.rect.h, String(scale)).toBeCloseTo(box.y + tab.y + tab.h, 2);
		}
	});

	it('a ring with no fold button near it keeps the edge place (the other three rings, and ring 4 at the sizes where it touches none)', () => {
		for (const scale of [0.7, 0.5, 0.4, 0.3]) {
			for (const b of withFolds.place('compact', scale, true)) {
				const card = withFolds.laid.layout.persons.get(b.id)!;
				const onEdge = Math.abs(b.rect.x + b.rect.w / 2 - card.x) < b.rect.w / 2 && Math.abs(b.rect.y + b.rect.h / 2 - (card.y + card.h / 2)) < 0.01;
				const edgeTouches = touchesAFold(withFolds, noFolds.place('compact', scale, true).find((n) => n.text === b.text)!.rect, scale);
				expect(onEdge, `${b.text} at ${scale}`).toBe(!edgeTouches);
			}
		}
	});

	it('no ring on an edge place touches a fold button, at any of the sizes', () => {
		for (const scale of [0.7, 0.6, 0.5, 0.4, 0.35, 0.3]) {
			for (const b of withFolds.place('compact', scale, true)) {
				const card = withFolds.laid.layout.persons.get(b.id)!;
				const onEdge = Math.abs(b.rect.y + b.rect.h / 2 - (card.y + card.h / 2)) < 0.01;
				if (onEdge) expect(touchesAFold(withFolds, b.rect, scale), `${b.text} at ${scale}`).toBe(false);
			}
		}
	});

	it('a tree without fold buttons keeps every ring on its edge, and the other devices and the other direction are unchanged', () => {
		for (const b of noFolds.place('compact', 0.4, true)) {
			const card = noFolds.laid.layout.persons.get(b.id)!;
			expect(b.rect.y + b.rect.h / 2, b.text).toBeCloseTo(card.y + card.h / 2, 2);
		}
		for (const [rs, phone] of [[withFolds, false], [down, true]] as const) {
			const boxes = rs.place('compact', 0.4, phone);
			const ref = (rs === withFolds ? noFolds : ringScene(g16, 'duke-of-carrowmere', { limit: 4, orientation: 'down' })!).place('compact', 0.4, phone);
			expect(boxes.map((b) => b.rect)).toEqual(ref.map((b) => b.rect));
		}
	});
});
