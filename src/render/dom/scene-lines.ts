/*
 * The line layer and the marker layer of a scene (see `scene.ts`): the tree's lines, and the partnership signs and rumour marks.
 * Both share one way to build an item: into its layer at once, or, in a lazy scene, later at its reserved place (spec §13.15 rule 4).
 */

import type { Rect } from '../../layout/model';
import { pathAttr } from '../line-highlight';
import { RUMOUR_FONT_EM } from '../scene-model';
import { UNION_MARKS, unionMark, unionShape } from '../styles';
import { unionMarkClass } from '../legend';
import { pathBox } from '../view-math';
import type { SceneCtx } from './scene-ctx';
import { orderedLayer, stateCls } from './scene-parts';

/** Room added around a late line's box for its stroke and for the highlight's wider stroke, in px. */
const LATE_PAD = 4;

/** Makes one element of a marker, in the layer or (lazy) as a free element that the layer then takes. */
type Maker = <K extends 'circle' | 'path' | 'g'>(tag: K, info: { cls: string[]; attr?: Record<string, string | number | boolean | null> }) => SVGElementTagNameMap[K];

/** Makes a layer `<g>` and gives the way to build one item of it: into the layer at once, or (lazy) when its box comes near the view. */
function layerAt(ctx: SceneCtx, cls: string): (box: Rect | null, draw: (make: Maker) => void) => void {
	const el = ctx.parent.createSvg('g', { cls });
	const layer = ctx.lazy ? orderedLayer(el) : null;
	const plain: Maker = (tag, info) => el.createSvg(tag, info);
	return (box, draw) => {
		if (!layer) {
			draw(plain);
			return;
		}
		const slot = layer.reserve();
		ctx.lateLine(box, () =>
			draw((tag, info) => {
				const made = createSvg(tag, info);
				layer.put(slot, made);
				return made;
			}),
		);
	};
}

/** Draws the lines, then the markers, each in its own layer. */
export function buildLines(ctx: SceneCtx): void {
	const { look, edges, geo, f } = ctx;
	const lineAt = layerAt(ctx, 'dynasty-lines');
	for (const p of look.paths) {
		const info = { cls: ['dynasty-line', `dynasty-line-${p.kind}`, ...stateCls(p.state)], attr: pathAttr(p) };
		// Only a lazy scene places a line by its box; an eager one (Save as a picture, the headless renderer) skips the scan of the path.
		lineAt(ctx.lazy ? pathBox(p.d, LATE_PAD) : null, (make) => make('path', info));
	}

	const markerAt = layerAt(ctx, 'dynasty-markers');
	edges.markers.forEach((m, i) => {
		const state = stateCls(look.markers[i]);
		if (m.kind === 'union' || m.kind === 'implicit-union') {
			// D26, D38: the shape tells the kind of partnership; no recorded partnership has none.
			const shape = unionShape(m.kind, m.unionType);
			if (!shape) return;
			const size = UNION_MARKS[shape].size * geo.unionSize;
			const half = size + LATE_PAD;
			markerAt({ x: m.x - half, y: m.y - half, w: 2 * half, h: 2 * half }, (make) => {
				const mark = unionMark(shape, m.x, m.y, size);
				make(mark.tag, { cls: [...unionMarkClass(shape), ...state], attr: mark.attr });
			});
		} else {
			const r = 0.5 * f;
			const half = f + LATE_PAD;
			markerAt({ x: m.x - half, y: m.y - half, w: 2 * half, h: 2 * half }, (make) => {
				const q = make('g', { cls: ['dynasty-rumour-marker', ...state] });
				q.createSvg('circle', { attr: { cx: m.x, cy: m.y, r } });
				const size = RUMOUR_FONT_EM * f;
				q.createSvg('text', { attr: { x: m.x, y: m.y + 0.35 * size, 'text-anchor': 'middle' } }).setText('?');
			});
		}
	});
}
