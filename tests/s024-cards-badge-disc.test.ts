import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { geometryFor } from '../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../src/layout/index';
import type { LayoutSettings, Rect } from '../src/layout/model';
import { BADGE_RADIUS_EM } from '../src/render/dom/scene';
import { UNION_MARKS, unionShape } from '../src/render/styles';
import { sampleSources } from './acceptance/m11-support';

// E1b (contract 4.2, D126 2): the drawn badge disc, grown by 2 px, holds no part of a drawn far-couple tag or union sign on any card of the
// sample trees, in `down` and sideways. A hit is REPORTED to the supervisor and the badge does not move; so the test records the hits
// and holds the count at the number found when this test was written (a new hit is a change that someone must look at).

const distToRect = (x: number, y: number, r: Rect) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));

function hits(): { tags: string[]; signs: string[]; cards: number } {
	const tags: string[] = [];
	const signs: string[] = [];
	let cards = 0;
	for (const s of sampleSources()) {
		const parsed = parseDynasty(s.source);
		if (!parsed.ok) continue;
		const g = deriveFamilies(parsed.tree);
		for (const view of ['down', 'sideways'] as const) {
			const settings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS, ...(view === 'down' ? {} : { orientation: 'sideways' }) } as LayoutSettings;
			clearLayoutCache();
			const geo = geometryFor(16);
			const { layout, edges } = layoutTree(g, geo, settings, 'font');
			const r = BADGE_RADIUS_EM * 16 + 2;
			for (const box of layout.persons.values()) {
				cards++;
				const cx = box.x + box.w;
				const cy = box.y;
				for (const tag of layout.farTags.values()) {
					const zone = tag.zoneW ?? tag.hit.w;
					const pill = { x: tag.x - zone / 2, y: tag.y - Math.round(0.1875 * 16), w: zone, h: layout.geometry.tagH };
					if (distToRect(cx, cy, pill) < r) tags.push(`${s.id} ${view} ${box.id} / tag of ${tag.person}`);
				}
				for (const m of edges.markers) {
					if (m.kind === 'rumour') continue;
					const shape = unionShape(m.kind, m.unionType);
					if (!shape) continue;
					const size = UNION_MARKS[shape].size * layout.geometry.unionSize;
					if (Math.hypot(m.x - cx, m.y - cy) - size < r) signs.push(`${s.id} ${view} ${box.id} / ${m.kind} at ${Math.round(m.x)},${Math.round(m.y)}`);
				}
			}
		}
	}
	return { tags, signs, cards };
}

describe('E1b: the badge disc and the far-couple tags and union signs near it (reported, the badge does not move)', () => {
	it('counts the hits on every card of the sample trees; none on a union sign', () => {
		const h = hits();
		console.log(`E1b: ${h.cards} cards, disc + 2 px meets a tag pill in ${h.tags.length} places, a union sign in ${h.signs.length} places`);
		expect(h.cards).toBeGreaterThan(300);
		// Union signs sit in the gap between rows, a full gap (6.25 em) from any corner in `down`, and clear of the corners in sideways.
		expect(h.signs.slice(0, 5)).toEqual([]);
	}, 60000);
});
