// 0.2.5 WP-B6: one function that draws a sample tree the way the saved picture does, with the Roundel (top to bottom) or the
// sideways text card, the plate on or off, in the light or the dark palette. The spike pictures (an internal script) and the golden
// hashes (`tests/scripts/s025-card-hashes.test.ts`, `scripts/s025-record-hashes.ts`) both call it, so a picture that a person looks at is
// exactly the picture that a hash protects. It uses the same steps as `makePicture` in `save-picture.ts`: card form, `measuredLayout`, `renderSvg`.
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations } from '../src/core/relations';
import { cardLabels } from '../src/core/titles';
import { cardForm, geometryFor } from '../src/layout/geometry';
import { DEFAULT_FAR_RULE } from '../src/layout/index';
import type { ArmsOutline } from '../src/layout/arms-outline';
import type { LaidOut, LayoutSettings } from '../src/layout/model';
import { measuredLayout } from '../src/view/measured-layout';
import type { PictureMap } from '../src/render/saved-picture';
import { DEFAULT_DARK, DEFAULT_LIGHT } from '../src/render/styles';
import type { Measure } from '../src/render/scene-model';
import { approxMeasure, renderSvg } from '../src/render/svg-string';

/** The four drawings of a tree: the direction (down = Roundel, side = text card) and the plate (on = relation words, off = the "You" tab). */
export type CardVariant = 'down-on' | 'down-off' | 'side-on' | 'side-off';
export const CARD_VARIANTS: readonly CardVariant[] = ['down-on', 'down-off', 'side-on', 'side-off'];
export type CardTheme = 'light' | 'dark';
export const CARD_THEMES: readonly CardTheme[] = ['light', 'dark'];

const FONTS = { text: 'Segoe UI, Helvetica, Arial, sans-serif', ui: 'Segoe UI, Helvetica, Arial, sans-serif', bold: '600' };

/** What `drawCard` needs besides the sample's text. */
export interface DrawOptions {
	variant: CardVariant;
	theme: CardTheme;
	/** Note font in px (default 16, as the older golden hashes). */
	px?: number;
	/** The pictures to embed (the spike); the hashes leave them out so that no picture file can move a hash. */
	pictures?: (g: FamilyGraph) => PictureMap;
	/** The outline of each arms picture, for the gap round the arms (D219); the spike passes it with `pictures`, the hashes pass neither. */
	outlines?: (pictures: PictureMap) => Map<string, ArmsOutline>;
	/** A title in the picture (the spike). */
	title?: string;
	/** A text measure for the pictures that people look at (the B7 pictures use a wider one, as the system font of the renderer is wider than `approxMeasure`); the hashes leave it out. */
	measure?: Measure;
}

/** What `drawCard` returns: the picture and the pieces that a caller may measure. */
export interface DrawnCard {
	svg: string;
	g: FamilyGraph;
	laid: LaidOut;
	/** The marked person: the first person in document order who has a parent (absent when nobody has one). */
	me: string | undefined;
}

/** The first person in document order who has a parent: the mark of every golden picture. */
export function markOf(g: FamilyGraph): string | undefined {
	return g.people.find((p) => g.placementParents.get(p.id)?.length)?.id;
}

/** The sample's graph, or undefined when the block does not parse (sample 05). */
export function graphOf(source: string): FamilyGraph | undefined {
	const parsed = parseDynasty(source);
	return parsed.ok ? deriveFamilies(parsed.tree) : undefined;
}

/** Draws the sample the way the saved picture does (light palette in the file, here also dark); undefined when the block does not parse. */
export function drawCard(source: string, o: DrawOptions): DrawnCard | undefined {
	const g = graphOf(source);
	if (!g) return undefined;
	const sideways = o.variant.startsWith('side');
	const on = o.variant.endsWith('-on');
	const me = markOf(g);
	const geo = cardForm(geometryFor(o.px ?? 16), sideways ? 'sideways' : 'down');
	const labels = cardLabels(g);
	const relations = me !== undefined && on ? new Map([...computeRelations(g, me)].filter(([, r]) => r.length).map(([id, r]) => [id, { text: r[0].text, lower: r[0].lower }])) : undefined;
	// As `saveSource`: the plate needs a mark; with no plate a marked person gets the tab.
	const relationLine = relations !== undefined;
	const base: LayoutSettings = {
		sweeps: 4,
		far: DEFAULT_FAR_RULE,
		...(sideways ? { orientation: 'sideways' as const } : {}),
		...(relationLine ? { relationLine: true } : {}),
		...(me !== undefined && !relationLine ? { youTab: me } : {}),
	};
	const { laid } = measuredLayout(g, geo, base, {
		fonts: FONTS,
		measure: o.measure ?? approxMeasure,
		labels,
		showDates: true,
		showPortraits: true,
		...(me !== undefined ? { marked: me } : {}),
	});
	const dark = o.theme === 'dark';
	const pictures = o.pictures?.(g);
	const outlines = pictures ? o.outlines?.(pictures) : undefined;
	const svg = renderSvg(g, laid.layout, laid.edges, {
		palette: dark ? DEFAULT_DARK : DEFAULT_LIGHT,
		dark,
		fontFamily: FONTS.text,
		labels,
		measure: o.measure ?? approxMeasure,
		fonts: FONTS,
		showDates: true,
		...(o.title !== undefined ? { title: o.title } : {}),
		...(me !== undefined ? { me } : {}),
		...(relations ? { relations } : {}),
		...(pictures ? { pictures } : {}),
		...(outlines ? { outlines } : {}),
	});
	return { svg, g, laid, me };
}
