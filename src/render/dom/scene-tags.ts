/*
 * The far-couple tags of a scene (see `scene.ts`). Each tag is a shell with its tap areas and three pills, one for each level of
 * detail; in a lazy scene the pills wait in a holder until a fill attaches them (spec §13.15 rule 1).
 */

import { tagTop } from '../../layout/geometry';
import { farTagSigns } from '../../layout/far-tag-sign';
import { TAG_FONT_EM, fullTagPill, unionShape } from '../styles';
import { farTagLabel, farTagName, farTagPair } from '../tree-info';
import type { TagRef } from './scene-types';
import type { SceneCtx } from './scene-ctx';
import { TAG_COMPACT_FONT_EM, TAG_SIGN_FONT_EM, stateCls } from './scene-parts';
import { drawTagPill, tagLead } from './tag-pill';

/** Height of the Compact tag pill, in em. It grows up into the card, below the Compact name. */
const TAG_COMPACT_PILL_EM = 1.5;
/** Height of the Overview sign pill, in em. */
const TAG_SIGN_PILL_EM = 2;

/** Draws the tags last: their pills sit on the card's bottom edge and show over it (D10). `hitsEl` holds the tap areas below the cards. */
export function buildTags(ctx: SceneCtx, hitsEl: SVGGElement): TagRef[] {
	const { g, layout, edges, geo, f, opts, look, lazy } = ctx;
	const tagsEl = ctx.parent.createSvg('g', { cls: 'dynasty-tags' });
	const tags: TagRef[] = [];
	const tagFont = (em: number) => `400 ${em * f}px ${opts.fonts.ui}`;
	// A far couple with no children has no union dot, so its tag carries the partnership sign.
	const farSigns = farTagSigns(g, layout, edges);
	for (const tag of layout.farTags.values()) {
		// D353 3 A: two far partners show their two short names where they fit (`farTagPair`), else "2 partners".
		const [rest, pair] = [farTagName(g, tag.spouses, opts.labels), farTagPair(g, tag.spouses, opts.labels)];
		const top = tagTop(geo, tag.y);
		const bottom = top + geo.tagH;
		const tagState = stateCls(look.tag(tag));
		const el = tagsEl.createSvg('g', {
			cls: tagState.length ? ['dynasty-tag', ...tagState] : 'dynasty-tag',
			attr: { tabindex: 0, role: 'button', 'aria-label': farTagLabel(g, tag.spouses, opts.labels), 'data-person': tag.person },
		});
		const over = el.createSvg('rect', { cls: 'dynasty-tag-over', attr: { x: tag.hit.x, y: tag.hit.y, width: 0, height: 0 } });
		const pills = ctx.holderFor(el);
		const hit = hitsEl.createSvg('rect', { cls: 'dynasty-tag-hit', attr: { x: tag.hit.x, y: tag.hit.y, width: tag.hit.w, height: tag.hit.h, 'data-person': tag.person } });
		// The pill never grows past its zone (FarTag.zoneW): in `sideways` the tap area can be wider than the card's edge.
		const zone = tag.zoneW ?? tag.hit.w;
		// One rendering per level of detail, like the cards; a class on the <svg> shows one.
		const shape = farSigns.has(tag.person) ? (unionShape('union', farSigns.get(tag.person)) ?? undefined) : undefined;
		// D377 step 8: the Compact and the sign pill are hidden at the Full level, so their text is made when their level first shows (`whenShown`).
		const hidden: [string, () => void][] = [];
		const pill = (cls: string, em: number, h: number, named: boolean, level?: string) => {
			const font = tagFont(em);
			const spec = { cls, font, fontPx: em * f, h, bottom, x: tag.x, zone, measure: (t: string) => opts.measure(t, font), fit: (t: string, w: number) => ctx.fit(t, w, font), later: level !== undefined };
			const run = drawTagPill(pills, named ? { ...spec, lead: tagLead(tag.spouses.length), name: rest, pair, shape } : { ...spec, lead: '⚭' });
			if (level) hidden.push([level, run]);
			else ctx.addFit(run);
		};
		const place = () => {
			for (const [level, run] of hidden)
				ctx.whenShown(level, () => {
					run();
					ctx.fitters.push(run);
				});
		};
		ctx.pendingFits = lazy ? [] : null;
		// D353 2 A: the Full pill is the layout's tag band, with its 0.85 em text centred in it (`fullTagPill`).
		pill('dynasty-tag-full', TAG_FONT_EM, fullTagPill(geo, tag.y).h, true);
		pill('dynasty-tag-compact', TAG_COMPACT_FONT_EM, TAG_COMPACT_PILL_EM * f, true, 'compact');
		pill('dynasty-tag-sign', TAG_SIGN_FONT_EM, TAG_SIGN_PILL_EM * f, false, 'overview');
		const tagFits = ctx.fitsOnAttach();
		if (lazy)
			ctx.delay(tag.person, tag.hit, false, () => {
				tagFits();
				place();
				ctx.attachChildren(pills, el);
			});
		else place();
		tags.push({ tag, el, hit, over });
	}
	return tags;
}
