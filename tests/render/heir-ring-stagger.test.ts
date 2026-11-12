/*
 * D338 point 1, D341 (1): at the smallest zoom level on a computer, a heir ring that would touch its neighbour stands a little higher (a stagger of `RING_LIFT` px,
 * with a hairline stem to its block); the 12 px number and the 17 px ring stay; a ring that touches none does not move. The owner's example is the computer Overview
 * of sample tree 07b with a line of 12 heirs (the `v07b12` capture of the 0.5.3 design check).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RING_CLEAR, RING_LIFT, RING_PX, ringLevels } from '../../src/render/dom/heir-ring';
import { allFixtures } from '../acceptance/load';
import { build } from '../support/helpers';
import { useFakeDom } from '../support/fake-dom-setup';
import { VALMONT_NOTE, overlaps, ringScene, type RingBox } from '../support/ring-scene';

useFakeDom({ css: true, createSvg: true });

const css = readFileSync('styles.css', 'utf8');
const g07b = build(VALMONT_NOTE).g;
const v07b12 = ringScene(g07b, 'duke-of-valmont', { limit: 12 })!;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const touching = (boxes: readonly RingBox[], scale: number): number => {
	let n = 0;
	boxes.forEach((a, i) => {
		for (const b of boxes.slice(i + 1)) if (overlaps(a.rect, b.rect, -RING_CLEAR / scale)) n++;
	});
	return n;
};

describe('the Overview rings of 07b with a line of 12 on a computer', () => {
	it('has 12 rings, and at the smallest sizes no two rings touch (before the change: 4 and 8 pairs overlapped or touched)', () => {
		expect(v07b12.scene.rings.map((r) => r.spec.text).sort((a, b) => Number(a) - Number(b))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
		for (const scale of [0.08, 0.05]) {
			const boxes = v07b12.place('overview', scale, false);
			expect(touching(boxes, scale), String(scale)).toBe(0);
			expect(boxes.filter((b) => b.lifted).length, String(scale)).toBeGreaterThan(0);
		}
	});

	it('a ring that touches none stands where it stood: the same transform as before, and no stem', () => {
		for (const scale of [0.12, 0.08, 0.05]) {
			const boxes = v07b12.place('overview', scale, false);
			const k = Number((1 / scale).toPrecision(9));
			const flat = v07b12.scene.rings.filter((_, i) => !boxes[i].lifted);
			expect(flat.length, String(scale)).toBeGreaterThan(0);
			for (const r of flat) {
				expect(r.el.getAttribute('transform')).toBe(`translate(${Math.round(r.spec.top.x * 1000) / 1000} ${Math.round(r.spec.top.y * 1000) / 1000}) scale(${k})`);
				expect(v07b12.scene.rings[0].stems.getAttribute('d')).not.toContain(`M${round3(r.spec.top.x)} ${round3(r.spec.top.y)}V`);
			}
		}
	});

	it('a lifted ring stands RING_LIFT screen px higher than its place, keeps its size, and has a stem down to its block (one path holds all stems)', () => {
		const scale = 0.08;
		const boxes = v07b12.place('overview', scale, false);
		const lifted = v07b12.scene.rings.filter((_, i) => boxes[i].lifted);
		expect(lifted.length).toBeGreaterThan(0);
		for (const r of lifted) {
			const [, y] = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(r.el.getAttribute('transform')!)!.slice(1).map(Number);
			const steps = Math.round(((r.spec.top.y - y) * scale) / RING_LIFT);
			expect(steps).toBeGreaterThanOrEqual(1);
			expect((r.spec.top.y - y) * scale).toBeCloseTo(steps * RING_LIFT, 2);
			const stem = `M${round3(r.spec.top.x)} ${round3(r.spec.top.y)}V${round3(r.spec.top.y - (steps * RING_LIFT - RING_PX.h / 2) / scale)}`;
			expect(v07b12.scene.rings[0].stems.getAttribute('d')).toContain(stem);
			expect(/scale\(([^)]+)\)/.exec(r.el.getAttribute('transform')!)![1]).toBe(String(Number((1 / scale).toPrecision(9))));
		}
		expect(RING_PX.h).toBe(17);
	});

	it('does not depend on the order of the rings (the order of the people)', () => {
		for (const scale of [0.12, 0.08, 0.05]) {
			const forward = v07b12.place('overview', scale, false);
			const back = v07b12.place('overview', scale, false, true);
			const text = (b: RingBox) => `${b.text}:${b.rect.x},${b.rect.y}`;
			expect(back.map(text).sort()).toEqual(forward.map(text).sort());
			expect(ringLevels([...v07b12.scene.rings].reverse(), scale).sort()).toEqual(ringLevels(v07b12.scene.rings, scale).sort());
		}
	});
});

describe('only the computer Overview is staggered', () => {
	it('the Compact level and a phone device lift nothing', () => {
		for (const [lod, scale, phone] of [['compact', 0.4, false], ['compact', 0.25, false], ['compact', 0.4, true], ['overview', 0.05, true]] as const) {
			const boxes = v07b12.place(lod, scale, phone);
			expect(boxes.filter((b) => b.lifted), `${lod} ${scale} ${phone}`).toEqual([]);
		}
	});

	it('a ring is lifted again to nothing when the zoom grows, and the stem is empty', () => {
		v07b12.place('overview', 0.05, false);
		expect(v07b12.scene.rings[0].stems.getAttribute('d')).not.toBe('');
		v07b12.place('overview', 0.2, false);
		expect(v07b12.scene.rings[0].stems.getAttribute('d')).toBe('');
	});

	it('the stem is a hairline in the text colour under the pill: the rule is in styles.css', () => {
		const i = css.indexOf('\n.dynasty-heir-number-stems {');
		expect(i).toBeGreaterThanOrEqual(0);
		const rule = css.slice(i, css.indexOf('}', i));
		expect(rule).toContain('stroke: var(--text-normal);');
		expect(rule).toContain('fill: none;');
		expect(rule).toContain('pointer-events: none;');
		expect(rule).toContain('vector-effect: non-scaling-stroke;');
	});
});

describe('the stagger over the sample trees', () => {
	it('no two rings touch at the smallest sizes, and a lifted ring leaves the others where a plain ring was (every sample tree with a rule, a line of 12)', () => {
		let rings = 0;
		let lifted = 0;
		for (const f of allFixtures()) {
			const g = build(f.id === '07b' ? VALMONT_NOTE : f.source).g;
			for (const t of g.titles) {
				const rs = ringScene(g, t.id, { limit: 12 });
				if (!rs || !rs.scene.rings.length) continue;
				for (const scale of [0.12, 0.08, 0.05]) {
					const boxes = rs.place('overview', scale, false);
					rings += boxes.length;
					lifted += boxes.filter((b) => b.lifted).length;
					expect(touching(boxes, scale), `${f.id} ${t.id} ${scale}`).toBe(0);
				}
			}
		}
		expect(rings).toBeGreaterThan(100);
		expect(lifted).toBeGreaterThan(0);
	});
});
