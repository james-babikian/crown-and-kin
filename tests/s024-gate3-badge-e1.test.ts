import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor, namesOnlyGeometry } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings, Rect } from '../src/layout/model';
import { badgeHit } from '../src/obsidian/focus-mode';
import { sampleSources } from './acceptance/m11-support';

// Contract 4.2, check E1 and the clip of `badgeHit(mark, scale, fontPx, capPx, avoid)`: the part of the tap square outside its own card (after
// the cap and the clip) holds no other card and no tag tap area of another person, on every card of every sample tree, down and sideways.
// The tap area in the clipped strip belongs to the tag (spec §7.5). 52 tag overlaps in 389 cards of trees 07 and 07b came from the first draft.
const ov = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;

const SAMPLES = sampleSources();
const scalesFor = (f: number) => [11 / f, 12 / f, 14 / f, 1, 1.25];

describe('badgeHit against cards and tag tap areas on real layouts (E1)', () => {
	for (const kind of ['whole', 'names-only'] as const) {
		for (const font of [8, 11, 12, 16, 20, 24, 32, 48]) {
			for (const orientation of ['down', 'sideways'] as const) {
				for (const cards of ['normal', 'narrow'] as const) {
					if (orientation === 'down' && cards === 'narrow') continue;
					it(`${kind} font ${font} ${orientation} ${cards}: every sample tree`, () => {
						const R = 0.6 * font;
						const report: string[] = [];
						let squares = 0;
						for (const s of SAMPLES) {
							const parsed = parseDynasty(s.source);
							if (!parsed.ok) continue;
							const g = deriveFamilies(parsed.tree);
							clearLayoutCache();
							const base = geometryFor(font, 'normal');
							const geo = kind === 'whole' ? base : namesOnlyGeometry(base);
							const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, orientation, sidewaysCards: cards };
							const L = layoutTree(g, geo, settings, 'font').layout;
							const persons = [...L.persons.values()];
							const tags = [...L.farTags.values()];
							for (const scale of scalesFor(font)) {
								for (const p of persons) {
									const cap = orientation === 'sideways' ? L.geometry.nodeGap : p.h / 2;
									const mark = { x: p.x + p.w - R, y: p.y - R, w: 2 * R, h: 2 * R };
									const sq = badgeHit(mark, scale, font, cap, tags.filter((t) => t.person !== p.id).map((t) => t.hit));
									squares++;
									for (const o of persons) if (o.id !== p.id && ov(sq, o)) report.push(`${s.id} ${orientation} ${cards} scale ${scale.toFixed(2)}: ${p.id} square meets card ${o.id}`);
									for (const t of tags) if (t.person !== p.id && ov(sq, t.hit)) report.push(`${s.id} ${orientation} ${cards} scale ${scale.toFixed(2)}: ${p.id} square meets the tag area of ${t.person}`);
									// E2: not more than half the own card in either direction at the part that lies over it.
									const overW = Math.min(sq.x + sq.w, p.x + p.w) - Math.max(sq.x, p.x);
									const overH = Math.min(sq.y + sq.h, p.y + p.h) - Math.max(sq.y, p.y);
									if (overW > p.w / 2 + 0.01 || overH > p.h / 2 + 0.01) report.push(`${s.id} ${orientation} ${cards} scale ${scale.toFixed(2)}: ${p.id} square covers ${overW.toFixed(1)} x ${overH.toFixed(1)} of a ${p.w} x ${p.h} card`);
								}
							}
						}
						expect(squares).toBeGreaterThan(300);
						expect(report.slice(0, 10), `${report.length} problems`).toEqual([]);
					}, 60000);
				}
			}
		}
	}
});
