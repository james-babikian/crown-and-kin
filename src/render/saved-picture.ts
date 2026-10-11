/*
 * The pure parts of "Save as picture" (spec §13.8, D70–D74; M9 contract P1–P6, B4, B5): what the
 * saved picture's legend lists (`savedLegend`), where its heading, tree and legend go
 * (`savedFrame`, `savedExtent`), the scale it is written at (`savedScale`) and its file name
 * (`savedFileName`). `svg-string.ts` draws the picture from `savedFrame`, so the extent that the save
 * flow (`src/obsidian`) computes first is the size `renderSvg` then draws. No DOM and no vault here.
 */

import type { FamilyGraph } from '../core/derive';
import type { FoldSet } from '../core/folds';
import { noteName } from '../core/titles';
import { illegitimateSigns } from '../layout/illegitimate-sign';
import type { LaidOut, StrokeKind } from '../layout/model';
import type { Measure, SceneFonts } from './dom/scene';
import { LEGEND_DEAD_SAMPLE_W, LEGEND_SAMPLE_H, LEGEND_SAMPLE_W, legendHouses, type LegendExtraKind, type LegendHouse } from './legend';
import { LEGEND_DEAD_DOUBT_LABEL, LEGEND_DEAD_LABEL, LEGEND_HOUSES_LABEL, LEGEND_LABELS, LEGEND_LINES_LABEL, LEGEND_ORDER, SIGN_LEGEND_LABEL } from './legend-text';
import { dateLine } from './tree-info';

/** What a saved picture's legend shows (P3): the line kinds drawn, the D14 sign when used, the houses of the drawn people. */
export interface SavedLegendContent {
	kinds: readonly StrokeKind[];
	sign: boolean;
	houses: readonly LegendHouse[];
	/** 0.2.8 (I19): the dead signs that a drawn date text carries ("†", "†?"), in legend order; absent when none is drawn. */
	dead?: readonly ('dead' | 'dead-doubt')[];
}

/** B9, B1: a picture map: `arms:<houseId>` / `portrait:<personId>` → a data URI, 'missing' (dashed frame) or null (another problem). */
export type PictureMap = ReadonlyMap<string, string | 'missing' | null>;

/** What only a saved picture has (P3–P5); `SvgOptions.saved`. */
export interface SavedParts {
	/** The note's name, drawn at the top (D74). */
	heading: string;
	legend: SavedLegendContent;
	/** The pictures to embed; a missing key is drawn like null. */
	pictures: PictureMap;
	/** Output px per layout px (P5, `savedScale`). */
	scale: number;
	/**
	 * M10 (F14, spec §13.10): the folds of the view that saves. Present = the picture draws the "+ N" signs of the folded
	 * families of `layout.folds` (never the "−" buttons, D71); the layout is made with the same hidden people as the view.
	 */
	folds?: FoldSet;
}

/** The legend content of a saved picture (P3): the kinds of `laid`'s lines in legend order, the D14 sign, the houses of the drawn people in list order. */
export function savedLegend(g: FamilyGraph, laid: LaidOut): SavedLegendContent {
	const used = new Set(laid.edges.paths.map((p) => p.kind));
	// I19: the legend explains a dead sign only when a drawn card has one; "†?" is a text with a question mark after the sign.
	let dead = false;
	let doubt = false;
	for (const id of laid.layout.persons.keys()) {
		const p = g.byId.get(id);
		const text = p ? dateLine(p) : undefined;
		if (!text?.includes('†')) continue;
		if (text.includes('†?')) doubt = true;
		else dead = true;
	}
	const marks: ('dead' | 'dead-doubt')[] = [...(dead ? (['dead'] as const) : []), ...(doubt ? (['dead-doubt'] as const) : [])];
	return {
		kinds: LEGEND_ORDER.filter((k) => used.has(k)),
		sign: illegitimateSigns(g, laid.edges).size > 0,
		houses: legendHouses(g, laid.layout.persons.keys()),
		...(marks.length ? { dead: marks } : {}),
	};
}

// R1: XML 1.0 forbids these characters; one of them in a name makes the whole saved SVG (and the
// PNG made from it) fail to load.
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** R1: `s` without the characters XML forbids, as a saved picture writes and measures it. */
export const xmlText = (s: string) => s.replace(NOT_XML, '');

/** The largest PNG a save makes (spec §13.8): pixels in all, and px on each side (the iPhone's limit for one image). */
export const SAVED_PNG_MAX_PIXELS = 16_000_000;
export const SAVED_PNG_MAX_SIDE = 8192;
/** Spec §13.8, D71: names at 14 CSS px. */
export const SAVED_NAME_PX = 14;
/** Below this many CSS px, the Notice says the names are small (spec §13.8). */
export const SAVED_SMALL_PX = 8;

/**
 * P5, B5: the scale a picture of `extent` (layout px) is written at. The CSS scale gives 14 px
 * names. SVG: that scale; its pictures are embedded at 4 × their size. PNG: 2 image px for each CSS
 * px, made smaller until the image (rounded up to whole px) has at most 16 million px and 8192 px
 * on each side; pictures at their size in image px. `small` is true when the names are under 8 CSS
 * px (a PNG counts 2 image px as one CSS px).
 */
export function savedScale(extent: { w: number; h: number }, fontPx: number, kind: 'png' | 'svg'): { scale: number; pictureScale: number; small: boolean } {
	const css = SAVED_NAME_PX / (fontPx > 0 ? fontPx : 16);
	if (kind === 'svg') return { scale: css, pictureScale: 4 * css, small: fontPx * css < SAVED_SMALL_PX };
	const w = Math.max(1, extent.w);
	const h = Math.max(1, extent.h);
	// The canvas is ceil(w × s) by ceil(h × s): keep one px for the rounding on each side.
	const side = Math.min((SAVED_PNG_MAX_SIDE - 1) / w, (SAVED_PNG_MAX_SIDE - 1) / h);
	const b = w + h;
	const area = (-b + Math.sqrt(b * b + 4 * w * h * (SAVED_PNG_MAX_PIXELS - 1))) / (2 * w * h);
	const scale = Math.min(2 * css, side, area);
	return { scale, pictureScale: scale, small: (fontPx * scale) / 2 < SAVED_SMALL_PX };
}

/** P6: "NOTE tree.png", or in focus mode "NOTE tree, family of NAME.png"; both names cleaned like note names (§13.11). */
export function savedFileName(note: string, kind: 'png' | 'svg', focusName?: string): string {
	const base = `${noteName(note, 'Tree')} tree`;
	return focusName === undefined ? `${base}.${kind}` : `${base}, family of ${noteName(focusName, 'Person')}.${kind}`;
}

// The CSS named colours (CSS Color 4). `transparent`, `currentcolor` and system colours are not
// here: they depend on the page or draw nothing, and a saved file has no page.
const NAMED_COLOURS = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
		'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
		'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
		'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
		'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
		'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
		'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
		'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
		'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
		'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
		'whitesmoke yellow yellowgreen'
	).split(' '),
);

const NUM = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const PCT = `${NUM}%?`;
const HUE = `${NUM}(?:deg)?`;
/** `f(a, b, c[, alpha])` or `f(a b c[ / alpha])`, with the first argument's pattern `first`. */
const colourFunction = (names: string, first: string) =>
	new RegExp(`^(?:${names})\\(\\s*(?:${first}\\s*,\\s*${PCT}\\s*,\\s*${PCT}(?:\\s*,\\s*${PCT})?|${first}\\s+${PCT}\\s+${PCT}(?:\\s*\\/\\s*${PCT})?)\\s*\\)$`, 'i');
const RGB = colourFunction('rgba?', PCT);
const HSL = colourFunction('hsla?', HUE);
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * R2: `value` when it is a fixed colour (hex, `rgb()`/`hsl()` with numeric arguments, or a CSS
 * named colour); else undefined. A saved file has no page, so a `var()` or a word that is not a
 * colour would draw black or nothing there; the saved picture draws the no-house colour instead.
 */
export function fixedColour(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const v = value.trim();
	return HEX.test(v) || RGB.test(v) || HSL.test(v) || NAMED_COLOURS.has(v.toLowerCase()) ? v : undefined;
}

/** One text of the saved picture: where its baseline goes, its size, weight and family, as `renderSvg` writes them. */
export interface SavedText {
	text: string;
	x: number;
	y: number;
	size: number;
	weight: string;
	/** The CSS font string `measure` measured it with. */
	font: string;
}

/** One cell of the legend grid, in the legend's frame (layout px). */
export interface SavedCell<T> {
	item: T;
	x: number;
	y: number;
}

/** The places of a saved picture's parts, in layout px (the SVG's viewBox). */
export interface SavedFrame {
	w: number;
	h: number;
	heading: SavedText;
	/** 0.2.7 (F.5): the bar sentence of the Show view, a second text line under the heading; absent when there is none. */
	sentence?: SavedText;
	/** The tree's top left corner. */
	tree: { x: number; y: number };
	/** The legend's top left corner and its parts; absent when there is nothing to explain. */
	legend?: {
		x: number;
		y: number;
		rowH: number;
		/** Size of a line sample (the screen legend's sample, scaled with the font). */
		sample: { w: number; h: number; scale: number };
		labelSize: number;
		/** The x of a row's label, from the row's left edge. */
		labelX: number;
		/** House rows: the strip and the arms box, from the row's left edge. */
		strip: { x: number; w: number; h: number };
		arms: { x: number; w: number; h: number };
		houseLabelX: number;
		lines?: { title: SavedText; rows: SavedCell<StrokeKind | LegendExtraKind>[] };
		houses?: { title: SavedText; rows: SavedCell<LegendHouse>[] };
	};
}

// Sizes in em of the note font. The preview the owner chose (q8e-A) set the heading at 26 px and
// the legend in two parts side by side under the tree, line styles in up to 3 columns and houses in 2.
const PAD_EM = 2;
const GAP_EM = 1.25;
const HEADING_EM = 1.625;
const TITLE_EM = 1;
const LABEL_EM = 0.875;
const ROW_EM = 2;
const COL_GAP_EM = 1.75;
const PART_GAP_EM = 3;

/** The font string a saved text is measured with and written in (P2): `${weight} ${size}px ${family}`. */
export const fontOf = (weight: string, size: number, family: string) => `${weight} ${size}px ${family}`;

/**
 * P3, B4: the places of the heading, the tree and the legend of a saved picture of a `treeW` ×
 * `treeH` tree. Text is measured with `measure` in the interface font (heading and legend). A heading
 * wider than the tree makes the picture wider; with `scale`, it is cut with "…" only where the
 * picture would pass 8192 px. 0.2.7 (F.5): with `barSentence` the Show view's sentence is a second, smaller text line under the heading (cut the same way).
 */
export function savedFrame(tree: { width: number; height: number }, legend: SavedLegendContent, heading: string, fontPx: number, rawMeasure: Measure, fonts: SceneFonts, scale?: number, cut?: (text: string, maxW: number, font: string) => string, barSentence?: string): SavedFrame {
	// R1: measure the text as it is written, so `savedExtent` and `renderSvg` get the same size.
	const measure: Measure = (text, font) => rawMeasure(xmlText(text), font);
	const f = fontPx;
	const pad = PAD_EM * f;
	const gap = GAP_EM * f;
	const headSize = HEADING_EM * f;
	const headFont = fontOf(fonts.bold, headSize, fonts.ui);
	let headText = heading;
	let headW = measure(heading, headFont);
	if (scale && scale > 0 && cut) {
		const max = SAVED_PNG_MAX_SIDE / scale - 2 * pad;
		if (headW > max) {
			headText = cut(heading, max, headFont);
			headW = measure(headText, headFont);
		}
	}
	const treeW = Math.max(0, tree.width);
	const treeH = Math.max(0, tree.height);
	const headH = 1.25 * headSize;
	// F.5: the sentence is 1 em, regular, 0.25 em under the heading's line box; the tree starts below it.
	let sentence: SavedText | undefined;
	let sentW = 0;
	let sentH = 0;
	if (barSentence) {
		const size = TITLE_EM * f;
		const font = fontOf('400', size, fonts.ui);
		let text = barSentence;
		sentW = measure(text, font);
		if (scale && scale > 0 && cut) {
			const max = SAVED_PNG_MAX_SIDE / scale - 2 * pad;
			if (sentW > max) {
				text = cut(text, max, font);
				sentW = measure(text, font);
			}
		}
		const lineH = 1.25 * size;
		const top = pad + headH + 0.25 * f;
		sentence = { text, x: pad, y: top + lineH / 2 + 0.35 * size, size, weight: '400', font };
		sentH = 0.25 * f + lineH;
	}
	const treeTop = pad + headH + sentH + gap;
	const content = Math.max(treeW, headW, sentW);

	const k = f / 16;
	const rowH = ROW_EM * f;
	const labelSize = LABEL_EM * f;
	const labelFont = fontOf('400', labelSize, fonts.ui);
	const titleSize = TITLE_EM * f;
	const titleFont = fontOf(fonts.bold, titleSize, fonts.ui);
	const titleH = 1.5 * titleSize;
	// The labels stand in one column, so a picture with a dead sign gives every sample the wider slot.
	const sample = { w: (legend.dead?.length ? LEGEND_DEAD_SAMPLE_W : LEGEND_SAMPLE_W) * k, h: LEGEND_SAMPLE_H * k, scale: k };
	const labelX = sample.w + 0.5 * f;
	const strip = { x: 0, w: 0.4375 * f, h: 1.625 * f };
	const arms = { x: strip.w + 0.375 * f, w: 1.375 * f, h: 1.625 * f };
	const houseLabelX = arms.x + arms.w + 0.5 * f;
	const colGap = COL_GAP_EM * f;

	/** A grid of equal columns, filled row by row, no wider than `room` if one column allows it. */
	const grid = <T>(items: readonly T[], cellW: number, maxCols: number, room: number) => {
		const cols = Math.max(1, Math.min(maxCols, items.length, Math.floor((room + colGap) / (cellW + colGap))));
		const rows = items.map((item, i) => ({ item, x: (i % cols) * (cellW + colGap), y: titleH + Math.floor(i / cols) * rowH }));
		return { rows, w: cols * cellW + (cols - 1) * colGap, h: titleH + Math.ceil(items.length / cols) * rowH };
	};
	const lineItems: (StrokeKind | LegendExtraKind)[] = [...legend.kinds, ...(legend.sign ? (['sign'] as const) : []), ...(legend.dead ?? [])];
	const labelOf = (kind: StrokeKind | LegendExtraKind) => (kind === 'sign' ? SIGN_LEGEND_LABEL : kind === 'dead' ? LEGEND_DEAD_LABEL : kind === 'dead-doubt' ? LEGEND_DEAD_DOUBT_LABEL : LEGEND_LABELS[kind]);
	const lineCell = Math.max(0, ...lineItems.map((kind) => labelX + measure(labelOf(kind), labelFont)));
	const houseCell = Math.max(0, ...legend.houses.map((h) => houseLabelX + measure(h.name, labelFont)));
	const titleText = (text: string, x: number, y: number): SavedText => ({ text, x, y: y + titleSize, size: titleSize, weight: fonts.bold, font: titleFont });

	let legendPart: SavedFrame['legend'];
	let legendW = 0;
	let legendH = 0;
	if (lineItems.length || legend.houses.length) {
		const lines = lineItems.length ? grid(lineItems, lineCell, 3, content) : undefined;
		const partGap = PART_GAP_EM * f;
		// The two parts side by side when both fit in the tree's width; else the houses under the lines.
		const beside = lines && legend.houses.length ? grid(legend.houses, houseCell, 2, content - lines.w - partGap) : undefined;
		const side = !!beside && lines!.w + partGap + beside.w <= content;
		const houses = legend.houses.length ? (side ? beside! : grid(legend.houses, houseCell, 2, content)) : undefined;
		const housesX = side ? lines!.w + partGap : 0;
		const housesY = !side && lines ? lines.h + gap : 0;
		legendW = side ? housesX + houses!.w : Math.max(lines?.w ?? 0, houses?.w ?? 0);
		legendH = side ? Math.max(lines!.h, houses!.h) : housesY + (houses?.h ?? 0);
		legendPart = {
			x: pad,
			y: treeTop + treeH + gap,
			rowH,
			sample,
			labelSize,
			labelX,
			strip,
			arms,
			houseLabelX,
			...(lines ? { lines: { title: titleText(LEGEND_LINES_LABEL, 0, 0), rows: lines.rows } } : {}),
			...(houses ? { houses: { title: titleText(LEGEND_HOUSES_LABEL, housesX, housesY), rows: houses.rows.map((r) => ({ ...r, x: r.x + housesX, y: r.y + housesY })) } } : {}),
		};
	}
	const w = Math.ceil(2 * pad + Math.max(content, legendW));
	const h = Math.ceil(treeTop + treeH + (legendPart ? gap + legendH : 0) + pad);
	return {
		w,
		h,
		heading: { text: headText, x: pad, y: pad + headH / 2 + 0.35 * headSize, size: headSize, weight: fonts.bold, font: headFont },
		...(sentence ? { sentence } : {}),
		tree: { x: pad, y: treeTop },
		...(legendPart ? { legend: legendPart } : {}),
	};
}

/** B4: the size in layout px of the whole saved picture (heading, tree and legend), as `renderSvg` draws it with `saved`. */
export function savedExtent(laid: LaidOut, legend: SavedLegendContent, heading: string, fontPx: number, measure: Measure, fonts: SceneFonts, barSentence?: string): { w: number; h: number } {
	const frame = savedFrame(laid.layout, legend, heading, fontPx, measure, fonts, undefined, undefined, barSentence);
	return { w: frame.w, h: frame.h };
}
