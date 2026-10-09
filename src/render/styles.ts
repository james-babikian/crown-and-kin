/**
 * The tree's colours and line styles, as theme roles the plugin's CSS resolves and a fixed
 * palette the headless renderer and tests use instead. `StrokeKind` (`layout/model.ts`) and
 * `STROKES` here must list the same kinds; only `svg-string.ts` reads `STROKES` (styles.css holds
 * the same styles for the DOM). `scene.ts`, `svg-string.ts` and `legend.ts` draw union signs from
 * `unionShape`, `UNION_MARKS` and `unionMark`.
 */
import type { StrokeKind } from '../layout/model';
import { LEGEND_LABELS } from './tree-info';

/**
 * Colour roles used by the tree. In the plugin every role is an Obsidian CSS variable, or a mix of
 * two of them, so the tree follows the active theme, light/dark mode and CSS snippets live, with no
 * re-render. Colours must never be baked into SVG attributes in plugin code; use classes and these
 * variables in styles.css. The headless renderer substitutes a fixed palette.
 */
const PLAIN_VARS = {
	background: '--background-primary',
	cardFill: '--background-primary-alt',
	cardBorder: '--background-modifier-border',
	text: '--text-normal',
	textMuted: '--text-muted',
	textFaint: '--text-faint',
	line: '--text-muted',
	/** D27: plain muted text, so the dates are as strong as the note's own muted text in any theme. */
	dates: '--text-muted',
	noHouse: '--background-modifier-border',
	adoptive: '--color-green',
	ward: '--color-blue',
	rumoured: '--color-red',
	/** D47: the relation finder's line. The marked card does not use it (D153). */
	accent: '--interactive-accent',
} as const;

/** A colour role backed by a single Obsidian CSS variable. */
export type PlainRole = keyof typeof PLAIN_VARS;

/** `color-mix(in srgb, <first> <percent>%, <second>)` of two plain roles. */
export interface MixedRole {
	mix: readonly [PlainRole, number, PlainRole];
}

/**
 * D25: roles between two theme colours. Each line stays at least 3:1 on the note in both default
 * themes; the first colour of the mix is also the fallback that
 * styles.css writes before the `color-mix()` for engines without it (iOS before 16.2).
 */
const MIXED_VARS = {
	/** Between muted and faint: lighter than a marriage, still readable. */
	lineSoft: { mix: ['textMuted', 55, 'textFaint'] },
	/** The theme's green moved towards the text colour: darker on a light note, lighter on a dark one. */
	adoptiveLine: { mix: ['adoptive', 70, 'text'] },
} as const satisfies Record<string, MixedRole>;

/** Every colour role, plain and mixed, keyed by name. */
export const THEME_VARS: { readonly [K in keyof typeof PLAIN_VARS | keyof typeof MIXED_VARS]: string | MixedRole } = { ...PLAIN_VARS, ...MIXED_VARS };

/** The name of any colour role the tree uses. */
export type ThemeRole = keyof typeof THEME_VARS;
/** A resolved colour (a hex string) for every role, as the headless renderer and tests use it. */
export type Palette = Record<ThemeRole, string>;

/**
 * The values styles.css gives a property for `role`, in order: a plain role is one `var()`; a
 * mixed role is the fallback `var()` followed by the `color-mix()`.
 */
export function roleCss(role: ThemeRole): string[] {
	const v = THEME_VARS[role];
	if (typeof v === 'string') return [`var(${v})`];
	const [a, p, b] = v.mix;
	return [`var(${PLAIN_VARS[a]})`, `color-mix(in srgb, var(${PLAIN_VARS[a]}) ${p}%, var(${PLAIN_VARS[b]}))`];
}

const hexRgb = (hex: string): number[] => {
	const h = hex.replace('#', '');
	const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};

/** CSS `color-mix(in srgb, a p, b)` for hex colours (`p` from 0 to 1), for headless pictures. */
export function mixHex(a: string, p: number, b: string): string {
	const x = hexRgb(a);
	const y = hexRgb(b);
	return '#' + x.map((v, i) => Math.round(Math.min(255, Math.max(0, v * p + y[i] * (1 - p)))).toString(16).padStart(2, '0')).join('');
}

function withMixes(plain: Record<PlainRole, string>): Palette {
	const out = { ...plain } as Palette;
	for (const [role, { mix }] of Object.entries(MIXED_VARS) as [keyof typeof MIXED_VARS, MixedRole][]) out[role] = mixHex(plain[mix[0]], mix[1] / 100, plain[mix[2]]);
	return out;
}

/** Approximations of Obsidian's default theme, for headless pictures only. */
export const DEFAULT_LIGHT: Palette = withMixes({
	background: '#ffffff',
	cardFill: '#fafafa',
	cardBorder: '#e0e0e0',
	text: '#222222',
	textMuted: '#5c5c5c',
	textFaint: '#ababab',
	line: '#5c5c5c',
	dates: '#5c5c5c',
	noHouse: '#e0e0e0',
	adoptive: '#08b94e',
	ward: '#086ddd',
	rumoured: '#e93147',
	accent: '#8a5cf5',
});

/** Approximations of Obsidian's default dark theme, for headless pictures only. */
export const DEFAULT_DARK: Palette = withMixes({
	background: '#1e1e1e',
	cardFill: '#262626',
	cardBorder: '#363636',
	text: '#dadada',
	textMuted: '#b3b3b3',
	textFaint: '#666666',
	line: '#b3b3b3',
	dates: '#b3b3b3',
	noHouse: '#363636',
	adoptive: '#44cf6e',
	ward: '#027aff',
	rumoured: '#fb464c',
	accent: '#7f6df2',
});

/** D32: the 12 house colours offered in the Houses window, in this order. Names are in `ui-text.ts`. */
export const HOUSE_PALETTE = [
	'#8c2041',
	'#c62828',
	'#d87620',
	'#af8d22',
	'#7c8b2a',
	'#2e7d32',
	'#00897b',
	'#3a8fd6',
	'#1e4f8b',
	'#6d209c',
	'#795548',
	'#78909c',
] as const;

/** D27: in the dark theme a house strip is its colour moved this far towards the text colour. */
export const HOUSE_DARK_LIFT = 0.3;
/** D27: a dead person's house strip (spec §5.2 "slightly muted"). */
export const DEAD_STRIP_OPACITY = 0.8;

/** The drawn colour of a house strip (D27), for headless pictures and the contrast test. */
export function stripColour(house: string, p: Palette, dark: boolean): string {
	return dark ? mixHex(house, 1 - HOUSE_DARK_LIFT, p.text) : house;
}

/** How one `StrokeKind` is drawn: colour role, width, dash pattern and legend label. */
export interface StrokeStyle {
	role: ThemeRole;
	width: number;
	dash?: string;
	/** Round caps turn a 0.1 px dash into a dot. */
	cap?: 'round';
	/** 0–1; lighter relationships are drawn partly transparent. */
	opacity?: number;
	label: string;
}

/**
 * Line styles (§5.3, D25, D38): every kind has its own pattern, and every line is at least 3:1 on the
 * note. D38: the ward line is bold square dots (butt caps), the adoptive line longer, thicker dashes.
 */
export const STROKES: Record<StrokeKind, StrokeStyle> = {
	marriage: { role: 'line', width: 2.5, label: LEGEND_LABELS.marriage },
	betrothal: { role: 'line', width: 2.5, dash: '0.1 5', cap: 'round', label: LEGEND_LABELS.betrothal },
	concubinage: { role: 'lineSoft', width: 2, dash: '8 4', label: LEGEND_LABELS.concubinage },
	affair: { role: 'lineSoft', width: 2, dash: '8 3 2 3', label: LEGEND_LABELS.affair },
	implicit: { role: 'lineSoft', width: 1.25, label: LEGEND_LABELS.implicit },
	descent: { role: 'line', width: 1.5, label: LEGEND_LABELS.descent },
	illegitimate: { role: 'line', width: 1.5, dash: '5 4', label: LEGEND_LABELS.illegitimate },
	'birth-link': { role: 'lineSoft', width: 1.5, dash: '0.1 3.5', cap: 'round', label: LEGEND_LABELS['birth-link'] },
	adoptive: { role: 'adoptiveLine', width: 3, dash: '20 6', label: LEGEND_LABELS.adoptive },
	ward: { role: 'ward', width: 3, dash: '3 5', label: LEGEND_LABELS.ward },
	rumoured: { role: 'rumoured', width: 1.5, dash: '4 4', opacity: 0.85, label: LEGEND_LABELS.rumoured },
};

/** D26, D38: the union point tells the kind of partnership. */
export type UnionShape = 'dot' | 'ring' | 'diamond' | 'open-triangle';

/**
 * The shape of a union marker: from its `unionType` (missing or unknown = marriage). An implicit
 * union (two parents with no recorded partnership) has no sign (D38): null.
 */
export function unionShape(kind: 'union' | 'implicit-union', unionType?: string): UnionShape | null {
	if (kind === 'implicit-union') return null;
	switch (unionType) {
		case 'betrothal':
			return 'ring';
		case 'concubinage':
			return 'diamond';
		case 'affair':
			return 'open-triangle';
		default:
			return 'dot';
	}
}

/**
 * Size of each shape as a fraction of `Geometry.unionSize` (circle radius, the diamond's half
 * diagonal, or the triangle's `s`), and its outline width in px (styles.css sets the same widths).
 * Every shape takes the marriage line's colour; open shapes are filled with the page colour.
 */
export const UNION_MARKS: Record<UnionShape, { size: number; stroke?: number }> = {
	dot: { size: 0.4 },
	ring: { size: 0.6, stroke: 2.5 },
	diamond: { size: 0.55 },
	'open-triangle': { size: 0.65, stroke: 1.6 },
};

/**
 * 0.2.1: the partnership sign inside a far-couple tag. `unit` is the sign's size unit as a fraction of the
 * tag's text size (it replaces the union size of a near couple's sign, so the sign fits the pill); `slot` is
 * the room of the dot only, in text sizes, with a small gap on each side (0.2.2: `tagMarkSlot` gives the room of
 * each shape, wider for the ring, the diamond and the triangle). The shapes and outline widths are those of
 * `UNION_MARKS`.
 */
export const TAG_MARK = { unit: 0.5, slot: 1.1 } as const;

/** Half the width of a union shape drawn at size `s` px, with its outline (the side corners of the triangle are 0.95 s from its centre). */
function shapeHalfWidth(shape: UnionShape, s: number): number {
	const { stroke } = UNION_MARKS[shape];
	return (shape === 'open-triangle' ? 0.95 * s : s) + (stroke ?? 0) / 2;
}

/** 0.2.2 (D108): half the drawn width of the sign of `shape` in a far-couple tag of text size `font` px, outline included. */
export function tagMarkHalfWidth(shape: UnionShape, font: number): number {
	return shapeHalfWidth(shape, UNION_MARKS[shape].size * TAG_MARK.unit * font);
}

/**
 * 0.2.2 (D108): the clear gap G between the right edge of the partnership sign and the start of the name in a
 * far-couple tag, for text size `font` px. It is the gap that the dot always had (the dot sits in the middle of the
 * 1.1 text-size slot), and every shape gets the same one: the shapes differ in width, so a fixed centred slot
 * left the ring and the open triangle 1 to 2 px from the first letter.
 */
export function tagMarkGap(font: number): number {
	return (TAG_MARK.slot * font) / 2 - tagMarkHalfWidth('dot', font);
}

/**
 * 0.2.2 (D108): the room a sign of `shape` takes in a far-couple tag, in px: the gap G on each side of the shape.
 * The sign sits in the middle of this room. For the dot it is `TAG_MARK.slot` text sizes, as in 0.2.1; wider shapes
 * take more room, so the gap before the name is the same and the shape never touches the marriage sign.
 */
export function tagMarkSlot(shape: UnionShape, font: number): number {
	return TAG_MARK.slot * font + 2 * (tagMarkHalfWidth(shape, font) - tagMarkHalfWidth('dot', font));
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The SVG shape of a union mark at `x, y` with size `s` (px): a circle, a diamond, or a triangle with
 * its point up (corners (0, −s) and (±0.95 s, 0.7 s) from the union point, in every orientation).
 */
export function unionMark(shape: UnionShape, x: number, y: number, s: number): { tag: 'circle'; attr: { cx: number; cy: number; r: number } } | { tag: 'path'; attr: { d: string } } {
	if (shape === 'diamond') return { tag: 'path', attr: { d: `M${r2(x)} ${r2(y - s)}L${r2(x + s)} ${r2(y)}L${r2(x)} ${r2(y + s)}L${r2(x - s)} ${r2(y)}Z` } };
	if (shape === 'open-triangle') return { tag: 'path', attr: { d: `M${r2(x)} ${r2(y - s)}L${r2(x + 0.95 * s)} ${r2(y + 0.7 * s)}L${r2(x - 0.95 * s)} ${r2(y + 0.7 * s)}Z` } };
	return { tag: 'circle', attr: { cx: x, cy: y, r: s } };
}

/** D47: a line on the relation finder's line is this much wider than its kind (styles.css `.dynasty-on-line`). */
export const ON_LINE_EXTRA = 1.5;
/** D47: the opacity of every part beside the finder's line in "Show in the whole tree" (`.dynasty-faded`). */
export const FADED_OPACITY = 0.25;
/**
 * D41, D153: the marked card has one border in the text colour, `border` px wide (`.dynasty-card-me .dynasty-card-bg`). It is the same stroke
 * in the live scene and the saved picture; no theme accent colour is used, so the mark never clashes with a house colour.
 */
export const ME_LOOK = { border: 3 } as const;
/**
 * 0.2.5 (B.3.4, D153): how the Roundel's footer plate and "You" tab look in the saved picture, which has no page CSS. Each number repeats
 * a rule in the block of styles.css that starts at the marker comment "roundel: card"; `tests/s025-roundel-svg.test.ts` pins that they agree. `plate` is the fill
 * opacity in the light theme and in the dark theme; the marked card's plate and the tab use the same numbers, in the house colour. `corner` is the radius of the plate's
 * bottom-right corner, the same number `scene.ts` draws. `tabStroke` is the card-colour gap round the tab, drawn by the base rect under it.
 */
export const ROUNDEL_LOOK = {
	plate: { light: 0.17, dark: 0.26 },
	hairline: { opacity: 0.55, width: 1 },
	corner: 3,
	tabStroke: 1.5,
} as const;
/**
 * 0.2.7 (F.2, F.4, F.5): how the heir's outline and the ordinal tab look in the saved picture, which has no page CSS. `ring` is the width of the ring in the
 * text colour round an heir's card and `border` the width of its accent border (the numbers of `.dynasty-highlight` in styles.css, held still); `tabBorder` is the ordinal tab's 1 px border.
 */
export const HEIR_LOOK = { ring: 6, border: 3, tabBorder: 1 } as const;
/** D96, D153: how far the marked card's border edge lies inside the card's edge, in px: half the border (the stroke is centred on the edge). */
export const ME_RING_INNER = ME_LOOK.border / 2;

