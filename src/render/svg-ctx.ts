/**
 * The shared base of the headless SVG drawing: the options of `renderSvg`, the context object that its
 * four parts (`svg-frame.ts`, `svg-cards.ts`, `svg-edges.ts`, `svg-folds.ts`) read, and the small text
 * helpers they all use. It imports nothing from `render/dom`: the headless picture and the screen share
 * only `scene-model.ts`. The parts import this file and never each other's insides, so `svg-string.ts`
 * can call them in order without a cycle.
 */
import type { FamilyGraph } from '../core/derive';
import type { CardLabel } from '../core/titles';
import type { ArmsOutline } from '../layout/arms-outline';
import type { EdgeDrawing, TreeLayout } from '../layout/model';
import { FADED_OPACITY, type Palette } from './styles';
import type { Measure, SceneFonts } from './scene-model';
import type { LineMarks, LineState } from './line-highlight';
import type { BreakList } from './break-words';
import type { PictureMap, SavedFrame, SavedParts } from './saved-picture';
import { xmlText } from './saved-picture';
import { closeIsolates, withoutBidiControls } from './bidi-controls';

/** The fade of a part beside the finder's line, as an SVG attribute (D47). */
export const fadeAttr = (s: LineState) => (s === 'faded' ? ` opacity="${FADED_OPACITY}"` : '');

/** Escapes text for an XML text node or attribute value; the controls that XML cannot hold are dropped first. */
export const esc = (s: string) => xmlText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Approximate advance of one character in em, for a sans-serif UI font. */
function charEm(ch: string): number {
	// The thin space around the dash of a date range with a name (D278).
	if (ch === String.fromCharCode(0x2009)) return 0.2;
	if ("iljt.,:;'|!()[] fr".includes(ch)) return 0.3;
	if ('mwMW'.includes(ch)) return 0.82;
	if (ch >= 'A' && ch <= 'Z') return 0.64;
	return 0.52;
}

/** Approximate text width in px; resvg cannot measure, the DOM renderer measures real text. */
export function textWidth(text: string, fontSize: number, bold = false): number {
	let em = 0;
	// The isolate controls draw nothing, so they have no width (the live card measures them the same way).
	for (const ch of withoutBidiControls(xmlText(text))) em += charEm(ch);
	return em * fontSize * (bold ? 1.06 : 1);
}

/** `textWidth` as a `Measure` of a CSS font string (`${weight} ${size}px ${family}`): the fallback when a saved picture gets no real measure. */
export const approxMeasure: Measure = (text, font) => {
	const size = /(\d+(?:\.\d+)?)px/.exec(font);
	const weight = /^(?:italic\s+)?(\d{3})\s/.exec(font);
	return textWidth(text, size ? Number(size[1]) : 16, !!weight && Number(weight[1]) >= 600);
};

/** Cuts `text` with "…" to fit `px` at `fontSize`, by the approximate width; the isolates stay closed. */
export function fit(text: string, px: number, fontSize: number, bold = false): string {
	if (textWidth(text, fontSize, bold) <= px) return text;
	const chars = [...text];
	const cut = () => closeIsolates(chars.join('') + '…');
	while (chars.length > 1 && textWidth(cut(), fontSize, bold) > px) chars.pop();
	return cut();
}

/** True for an embedded picture (a data URI); the markers `'missing'` and `null` are not. */
export const isUri = (v: string | null | undefined): v is string => typeof v === 'string' && v.startsWith('data:');

/** How the headless picture draws the fold controls of `layout.folds`. */
export interface SvgFolds {
	/** Draw the open "−" buttons too; false draws the "+ N" signs only. A saved picture never draws buttons (D71). */
	buttons: boolean;
}

/** Options for `renderSvg`; all optional. */
export interface SvgOptions {
	margin?: number;
	title?: string;
	palette?: Palette;
	/** The palette is a dark theme's (D27 lifts house strips). Default: the palette is `DEFAULT_DARK`. */
	dark?: boolean;
	fontFamily?: string;
	/** D40: the relation text of each card, as `SceneOptions.relations`. */
	relations?: { get(id: string): { text: string; lower: string } | undefined };
	/** D41: the marked person, as `SceneOptions.me`. */
	me?: string;
	/** D47: the relation finder's line, as `SceneOptions.line`. */
	line?: LineMarks;
	/** The card labels of the drawn graph, as `SceneOptions.labels`; absent = no card labels. */
	labels?: ReadonlyMap<string, CardLabel>;
	/**
	 * "Show dates on cards", as `SceneOptions.showDates`: `false` leaves the reign out of the title
	 * text line; with `saved` it also leaves the dates line out, as the class hides it on screen. Absent = true.
	 */
	showDates?: boolean;
	/** P2: measures text in a CSS font string; with `fonts`, all text is broken and cut with it. */
	measure?: Measure;
	/** P2: the font families and bold weight the text is measured and written in. */
	fonts?: SceneFonts;
	/** D219: the outlines of the arms pictures, by the keys of `pictures` (`arms:<house>`, `person-arms:<person>`); an arms picture without one is drawn without a gap, as on screen while its shape is not known. */
	outlines?: ReadonlyMap<string, ArmsOutline>;
	/** B9: arms and portraits to embed (data URIs), without the saved picture's heading and legend (the spike). */
	pictures?: PictureMap;
	/** P3: draw a saved picture: white ground, heading, tree and legend, colours from `palette`, and parity ids. */
	saved?: SavedParts;
	/** Draw the fold controls of the layout (the spike). A saved picture draws its signs from `saved.folds` and no buttons. Absent = none. */
	folds?: SvgFolds;
	/** D118: the user's break places for long names, as `SceneOptions.breaks`. */
	breaks?: BreakList;
	/** The heirs of the Show view, as `SceneOptions.heirs`; each gets the still outline (`HEIR_LOOK`) in the fixed colours. */
	heirs?: Iterable<string>;
	/** The ordinal texts, as `SceneOptions.ordinals`; the layout names the cards (`TreeLayout.ordinalCards`). */
	ordinals?: ReadonlyMap<string, string>;
	/** With `saved`, the bar sentence of the Show view ("Line of succession: Duke of Valmont, 1210"), the second text line under the heading. Pass the same text to `savedExtent`. */
	barSentence?: string;
}

/** What the four parts of `renderSvg` share: the inputs, the choices made once from the options, and the output list the parts append to in order. */
export interface SvgCtx {
	g: FamilyGraph;
	layout: TreeLayout;
	edges: EdgeDrawing;
	opts: SvgOptions;
	c: Palette;
	dark: boolean;
	saved: SavedParts | undefined;
	pics: PictureMap | undefined;
	family: string;
	/** The measure the picture's text is broken and cut with; absent in a plain headless picture. */
	measured: Measure | undefined;
	fonts: SceneFonts;
	cutWith: (text: string, px: number, font: string) => string;
	/** P4: the parity id of an element of a saved picture; nothing otherwise. */
	di: (item: string) => string;
	/** The colour of the page behind the tree: white in a saved picture. */
	ground: string;
	out: string[];
	/** The saved picture's places; set by the frame part, read by the legend at the end. */
	frame: SavedFrame | undefined;
	/** The count of portrait clips written, for their ids. */
	clips: number;
}
