/**
 * Draws a finished tree layout to a standalone SVG string, for the spike (`npm run spike`), test
 * snapshots and (spec §13.8) the saved picture. This is the only place plugin code may bake
 * colours into SVG attributes: it takes a fixed `Palette` (`styles.ts`) instead of the CSS variables
 * the DOM renderer uses, since a headless SVG and a saved file have no page theme to read from.
 * `pictures` embeds arms and portraits as data URIs (the spike); `saved` adds the white
 * ground, the heading, the legend and the parity ids of a saved picture, placed by
 * `savedFrame` in `saved-picture.ts`; `measure` and `fonts` break and cut the text with the font a
 * canvas really draws. With none of them, the output is exactly the drawing with no options.
 * In a saved picture every drawn element has a `data-item` (`card:`, `line:`, `union:`, `rumour`,
 * `sign:`, `tag:`, `relation:`, `arms:`, `portrait:`, `frame:`, `heading`, `legend-line:`,
 * `legend-sign`, `legend-house:`, `legend-arms:`); the tests compare this list with the one they
 * derive from the DOM scene, so the file and the screen draw the same things.
 * The work is in four parts that `renderSvg` calls in order and that share one context (`svg-ctx.ts`): `svg-frame.ts`, `svg-edges.ts`, `svg-cards.ts` and `svg-folds.ts`.
 * The card form follows `Geometry.form`. The Roundel and the sideways text card are drawn from the same
 * `cardText`, `roundelPics` and `youTabRect` as the live scene (`dom/scene.ts`), in the same element order, so the saved picture
 * has the plate, the medallion and the "You" tab that the screen has, at the Full level only. A text card has no picture at all.
 * The look numbers of the plate and the tab are `ROUNDEL_LOOK` (`styles.ts`); the colours are the palette's.
 */
import type { FamilyGraph } from '../core/derive';
import type { EdgeDrawing, TreeLayout } from '../layout/model';
import type { Measure } from './scene-model';
import { lineLook } from './line-highlight';
import { xmlText } from './saved-picture';
import { DEFAULT_DARK, DEFAULT_LIGHT } from './styles';
import { truncateClosed } from './bidi-controls';
import { approxMeasure, esc, type SvgCtx, type SvgOptions } from './svg-ctx';
import { closeFrame, openFrame } from './svg-frame';
import { drawLines, drawMarkers, drawTags } from './svg-edges';
import { drawCards } from './svg-cards';
import { drawFolds } from './svg-folds';

// The names that other files import from here stay here, so the 80 importers of `renderSvg` keep their paths.
export { approxMeasure, textWidth, type SvgFolds, type SvgOptions } from './svg-ctx';
export { SAVED_SIGN_EM } from './svg-edges';

/** Draws `layout` and `edges` to a complete `<svg>...</svg>` string, with cards, lines, signs and far-couple tags. */
export function renderSvg(g: FamilyGraph, layout: TreeLayout, edges: EdgeDrawing, opts: SvgOptions = {}): string {
	const c = opts.palette ?? DEFAULT_LIGHT;
	const saved = opts.saved;
	const family = opts.fontFamily ?? 'Segoe UI, Helvetica, Arial, sans-serif';
	// P2: with a real measure every text is broken and cut with it; a saved picture without one uses the approximation.
	const real = opts.measure;
	const measured: Measure | undefined = real && opts.fonts ? (s, font) => real(xmlText(s), font) : saved ? approxMeasure : undefined;
	const ctx: SvgCtx = {
		g, layout, edges, opts, c, saved, family, measured,
		dark: opts.dark ?? c === DEFAULT_DARK,
		pics: saved?.pictures ?? opts.pictures,
		fonts: opts.fonts ?? { text: family, ui: family, bold: '600' },
		cutWith: (text, px, font) => truncateClosed(text, px, (s) => measured!(s, font)),
		// P4: the parity id of an element of a saved picture; nothing otherwise.
		di: (item) => (saved ? ` data-item="${esc(item)}"` : ''),
		ground: saved ? '#ffffff' : c.background,
		out: [],
		frame: undefined,
		clips: 0,
	};
	openFrame(ctx);
	const look = lineLook(g, layout, edges, opts.line);
	drawLines(ctx, look);
	drawCards(ctx, look);
	drawMarkers(ctx, look);
	drawFolds(ctx);
	drawTags(ctx, look);
	closeFrame(ctx);
	return ctx.out.join('\n');
}
