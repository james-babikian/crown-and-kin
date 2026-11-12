/*
 * D338 point 5, D341 (3): several begetter lines of one person into one row of children keep a small gap on the long run and share one dash phase. The owner's
 * example is sample tree 20: Oswin Thorne is the begetter of Ada, Ivo and Linnet. A single begetter line, and every other line, is drawn as before.
 */
import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { BEGETTER_DASH_PERIOD, BUNDLE_GAP_PX, bundleBegetters, type BundleLine } from '../../src/layout/begetter-bundle';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import type { EdgePath } from '../../src/layout/model';
import { STROKES } from '../../src/render/styles';
import { allFixtures } from '../acceptance/load';

function sample(id: string, orientation: 'down' | 'sideways' = 'down') {
	const f = allFixtures().find((x) => x.id === id)!;
	const parsed = parseDynasty(f.source);
	if (!parsed.ok) throw new Error('sample does not parse');
	const g = deriveFamilies(parsed.tree);
	clearLayoutCache();
	return layoutTree(g, cardForm(geometryFor(16), orientation), DEFAULT_LAYOUT_SETTINGS, 'font');
}

/** `M x0 y0 V sy C x0 my tx my tx ty`, read from the path text (the test does not use the code that wrote it). */
function curve(p: EdgePath) {
	const m = /^M(-?[\d.]+) (-?[\d.]+)V(-?[\d.]+)C(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/.exec(p.d);
	if (!m) throw new Error(`not a begetter curve: ${p.d}`);
	const [x0, y0, sy, , my, tx, , , ty] = m.slice(1).map(Number);
	return { x0, y0, sy, my, tx, ty };
}

/** The point of the curve at u, and the length from the path start (the stub included) to it, by a fine polyline. */
function walk(c: ReturnType<typeof curve>, u: number): { x: number; y: number; s: number } {
	const at = (t: number) => {
		const v = 1 - t;
		return { x: c.x0 * (v * v * v + 3 * v * v * t) + c.tx * (3 * v * t * t + t * t * t), y: c.sy * v * v * v + 3 * c.my * v * v * t + 3 * c.my * v * t * t + c.ty * t * t * t };
	};
	let s = c.sy - c.y0;
	let prev = at(0);
	const N = 2000;
	for (let i = 1; i <= N; i++) {
		const p = at((u * i) / N);
		s += Math.hypot(p.x - prev.x, p.y - prev.y);
		prev = p;
	}
	return { ...prev, s };
}

const oswin = (laid: ReturnType<typeof sample>) => laid.edges.paths.filter((p) => p.kind === 'begetter' && p.parents?.join() === 'oswin');
const byChild = (paths: EdgePath[], child: string) => paths.find((p) => p.child === child)!;

describe('the lines of Oswin to Ada, Ivo and Linnet (sample tree 20)', () => {
	const laid = sample('20');
	const lines = oswin(laid);

	it('are three curves that all start at the bottom of the begetter card', () => {
		expect(lines.map((p) => p.child).sort()).toEqual(['ada', 'ivo', 'linnet']);
		const card = laid.layout.persons.get('oswin')!;
		for (const p of lines) {
			const c = curve(p);
			expect(c.y0).toBe(card.y + card.h);
			expect(c.x0).toBeGreaterThan(card.x);
			expect(c.x0).toBeLessThan(card.x + card.w);
			expect(p.union).toBeUndefined();
		}
	});

	it('run 4 px apart at the middle of the long run, the nearest child lowest and no two lines crossing', () => {
		const mid = (child: string) => walk(curve(byChild(lines, child)), 0.5).y;
		const [ada, ivo, linnet] = [mid('ada'), mid('ivo'), mid('linnet')];
		expect(ada - ivo).toBeCloseTo(BUNDLE_GAP_PX, 1);
		expect(ivo - linnet).toBeCloseTo(BUNDLE_GAP_PX, 1);
		// No crossing: the order of the heights on the long run is the order of the targets, at every x that two lines share.
		const ys = (child: string, u: number) => walk(curve(byChild(lines, child)), u);
		for (let u = 0.2; u <= 0.8; u += 0.05) {
			expect(ys('ada', u).y).toBeGreaterThan(ys('ivo', u).y);
			expect(ys('ivo', u).y).toBeGreaterThan(ys('linnet', u).y);
		}
	});

	it('share one dash phase on the long run: the same place in the dash pattern at the same x', () => {
		const cs = lines.map((p) => ({ c: curve(p), off: p.dashOffset ?? 0 }));
		const from = Math.max(...cs.map((x) => x.c.x0));
		const to = Math.min(...cs.map((x) => x.c.tx));
		const xRef = (from + to) / 2;
		const phases = cs.map(({ c, off }) => {
			let lo = 0;
			let hi = 1;
			for (let i = 0; i < 50; i++) {
				const m = (lo + hi) / 2;
				if (walk(c, m).x < xRef) lo = m;
				else hi = m;
			}
			return (walk(c, (lo + hi) / 2).s + off) % BEGETTER_DASH_PERIOD;
		});
		const d = (a: number, b: number) => Math.min(Math.abs(a - b), BEGETTER_DASH_PERIOD - Math.abs(a - b));
		expect(d(phases[0], phases[1])).toBeLessThan(0.3);
		expect(d(phases[0], phases[2])).toBeLessThan(0.3);
		// Without the offsets the three lines were out of step (this is what the owner saw).
		const raw = cs.map(({ c }) => walk(c, 0.5).s % BEGETTER_DASH_PERIOD);
		expect(Math.max(d(raw[0], raw[1]), d(raw[0], raw[2]))).toBeGreaterThan(1);
	});

	it('the dash period is that of the begetter stroke', () => {
		expect(STROKES.begetter.dash!.split(' ').map(Number).reduce((a, b) => a + b, 0)).toBe(BEGETTER_DASH_PERIOD);
	});
});

describe('a single begetter line, and every other line, is drawn as before', () => {
	const laid = sample('20');

	it('Hugo to Corin and Esme to Rafe keep their exact path and have no dash offset', () => {
		const one = laid.edges.paths.filter((p) => p.kind === 'begetter' && p.parents?.join() !== 'oswin');
		// D343 1 C: Hugo's curve to Corin ran over Tristan Merrow's card (it was 'M2026.7 61V83C2026.7 202.5 1730.4 202.5 1730.4 322'); it now goes
		// through the gap between Brisen and Tristan. Esme's line goes one row down and crosses no card, so it stays. Its last bend stands between the flat
		// middles of the other side links in that gap (the lines of Oswin's bundle among them), at 249.8, no longer on the gap's middle (257).
		expect(one.map((p) => [p.child, p.d, p.dashOffset])).toEqual([
			['corin', 'M2026.7 61V83C2026.7 107 1831.5 107 1831.5 161V222C1831.5 249.8 1730.4 249.8 1730.4 322', undefined],
			['rafe', 'M2642.7 61V83C2642.7 122 2281.1 122 2281.1 161', undefined],
		]);
	});

	it('the count of lines is the same, and a sample tree with no begetter has no offset anywhere', () => {
		expect(laid.edges.paths.filter((p) => p.kind === 'begetter')).toHaveLength(5);
		for (const id of ['01', '08', '13', '16']) expect(sample(id).edges.paths.filter((p) => p.dashOffset !== undefined)).toEqual([]);
	});

	it('a bundled curve stays between the two rows: its heights lie between the stub end and the child top, so it never crosses a card', () => {
		for (const p of oswin(laid)) {
			const c = curve(p);
			expect(c.my).toBeGreaterThan(c.sy);
			expect(c.my).toBeLessThan(c.ty);
		}
	});

	it('a tree turned sideways keeps the same offsets (the offset is a length, not a place)', () => {
		const side = oswin(sample('20', 'sideways'));
		expect(side.map((p) => p.child).sort()).toEqual(['ada', 'ivo', 'linnet']);
		expect(side.filter((p) => p.dashOffset !== undefined)).toHaveLength(2);
	});
});

describe('bundleBegetters', () => {
	const L = (child: string, x0: number, tx: number, group = 'g'): BundleLine => ({ group, child, x0, y0: 100, sy: 120, my: 160, tx, ty: 200 });

	it('gives each line of a group its own height, nearest lowest, and keeps a group of one as it is', () => {
		const lines = [L('c', 10, 700), L('a', 20, 300), L('b', 30, 500), L('solo', 5, 900, 'other')];
		const out = bundleBegetters(lines);
		expect(out[3]).toEqual({ my: 160, phase: 0 });
		expect(out[1].my).toBeGreaterThan(out[2].my);
		expect(out[2].my).toBeGreaterThan(out[0].my);
		expect(out[1].my - out[2].my).toBeCloseTo((BUNDLE_GAP_PX / 0.75), 6);
	});

	it('does not depend on the order of the lines', () => {
		const lines = [L('c', 10, 700), L('a', 20, 300), L('b', 30, 500), L('d', 40, 600)];
		const forward = bundleBegetters(lines);
		const back = bundleBegetters([...lines].reverse()).reverse();
		expect(back).toEqual(forward);
		const ties = [L('x', 10, 400), L('y', 10, 400)];
		expect(bundleBegetters([...ties].reverse()).reverse()).toEqual(bundleBegetters(ties));
	});

	it('lines that run to the left keep a gap too, nearest lowest, and a left and a right line of one begetter are two groups', () => {
		const lines = [L('far', 500, 100), L('near', 490, 300), L('right', 500, 900)];
		const out = bundleBegetters(lines);
		expect(out[1].my).toBeGreaterThan(out[0].my);
		expect(out[2]).toEqual({ my: 160, phase: 0 });
	});

	it('no offset where the group has no common run, and a lift stays between the stub end and the child top', () => {
		const tight = bundleBegetters([L('a', 100, 102), L('b', 101, 103)]);
		expect(tight.map((o) => o.phase)).toEqual([0, 0]);
		const crowded = bundleBegetters(Array.from({ length: 30 }, (_, i) => L(`k${String(i).padStart(2, '0')}`, 10 + i, 300 + 10 * i)));
		for (const o of crowded) {
			expect(o.my).toBeGreaterThanOrEqual(120);
			expect(o.my).toBeLessThanOrEqual(200);
		}
	});
});
