import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings, Rect } from '../src/layout/model';
import { badgeHit } from '../src/obsidian/focus-mode';
import { sampleSources } from './acceptance/m11-support';

// Contract 4.2 E1, "a fold control hit area may overlap the badge square": the square of `badgeHit` against the 44 px tap square of every fold
// control (foldControls on, nothing folded). The rule is: inside the disc `r + 6 px` the badge wins, elsewhere the fold control wins. So the
// overlaps are ALLOWED; the test counts them and holds them to a small share of the pairs, so a layout change that makes them common is seen.
// A fold control exists only on the computer and in the full-screen view; the tree view cuts its tap area back at the disc (`placeFolds`).
const F = 16;
const R = 0.6 * F;
const ov = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

describe('badge square and disc against the tap squares of the fold controls', () => {
	for (const orientation of ['down', 'sideways'] as const) {
		it(`${orientation}: the square overlaps a fold control's tap square in under 1 pair in 100 (allowed: the fold control wins outside the disc)`, () => {
			let controls = 0;
			let squareOverlaps = 0;
			for (const s of sampleSources()) {
				const parsed = parseDynasty(s.source);
				if (!parsed.ok) continue;
				const g = deriveFamilies(parsed.tree);
				clearLayoutCache();
				const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation, foldControls: true };
				const L = layoutTree(g, geometryFor(F, 'normal'), settings, 'font').layout;
				const tags = [...L.farTags.values()];
				for (const p of L.persons.values()) {
					const cap = orientation === 'sideways' ? L.geometry.nodeGap : p.h / 2;
					const mark = { x: p.x + p.w - R, y: p.y - R, w: 2 * R, h: 2 * R };
					const sq = badgeHit(mark, 14 / F, F, cap, tags.filter((t) => t.person !== p.id).map((t) => t.hit));
					for (const f of L.folds ?? []) {
						controls++;
						if (ov(sq, { x: f.spot.x - 22, y: f.spot.y - 22, w: 44, h: 44 })) squareOverlaps++;
					}
				}
			}
			console.log(`${orientation}: ${controls} control checks, ${squareOverlaps} square overlaps`);
			expect(controls).toBeGreaterThan(100);
			expect(squareOverlaps).toBeLessThan(controls / 100);
		}, 60000);
	}
});
