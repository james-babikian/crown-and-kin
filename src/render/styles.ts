import type { StrokeKind } from '../layout/model';

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
	/** D27, WP6.5: plain muted text, so the dates are as strong as the note's own muted text in any theme. */
	dates: '--text-muted',
	noHouse:'--background-modifier-border',
	adoptive: '--color-green',
	ward: '--color-blue',
	rumoured: '--color-red',
} as const;

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

export const THEME_VARS: { readonly [K in keyof typeof PLAIN_VARS | keyof typeof MIXED_VARS]: string | MixedRole } = { ...PLAIN_VARS, ...MIXED_VARS };

export type ThemeRole = keyof typeof THEME_VARS;
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
});

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
});

/** D27: in the dark theme a house strip is its colour moved this far towards the text colour. */
export const HOUSE_DARK_LIFT = 0.3;
/** D27: a dead person's house strip (spec §5.2 "slightly muted"). */
export const DEAD_STRIP_OPACITY = 0.8;

/** The drawn colour of a house strip (D27), for headless pictures and the contrast test. */
export function stripColour(house: string, p: Palette, dark: boolean): string {
	return dark ? mixHex(house, 1 - HOUSE_DARK_LIFT, p.text) : house;
}

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
	marriage: { role: 'line', width: 2.5, label: 'Marriage' },
	betrothal: { role: 'line', width: 2.5, dash: '0.1 5', cap: 'round', label: 'Betrothal' },
	concubinage: { role: 'lineSoft', width: 2, dash: '8 4', label: 'Concubinage' },
	affair: { role: 'lineSoft', width: 2, dash: '8 3 2 3', label: 'Affair' },
	implicit: { role: 'lineSoft', width: 1.25, label: 'Parents with no recorded partnership' },
	descent: { role: 'line', width: 1.5, label: 'Child' },
	illegitimate: { role: 'line', width: 1.5, dash: '5 4', label: 'Illegitimate child' },
	'birth-link': { role: 'lineSoft', width: 1.5, dash: '0.1 3.5', cap: 'round', label: 'Birth parent of a child shown under other parents' },
	adoptive: { role: 'adoptiveLine', width: 3, dash: '20 6', label: 'Adoptive parent' },
	ward: { role: 'ward', width: 3, dash: '3 5', label: 'Guardian of a ward' },
	rumoured: { role: 'rumoured', width: 1.5, dash: '4 4', opacity: 0.85, label: 'Rumoured parent' },
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
