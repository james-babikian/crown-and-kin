/**
 * What the tree view reads from the theme as the engine computed it, where one CSS formula
 * cannot follow every theme:
 * - Spec §5.8, §10: the embedded tree is transparent, so a callout's background shows through it; its
 *   toolbar must hide the cards under it, so it is opaque and paints the callout's background itself.
 *   Themes paint callouts in different ways (Obsidian 1.13 mixes --callout-color with color-mix(),
 *   older versions and some themes use rgba(), Minimal's outlined callouts have no background).
 * The tree view reads these only after the first frame of a tree (spec §7.7).
 */

/** The alpha of a computed CSS colour: 0 for `transparent` or an empty value, 1 with no alpha part. */
export function colourAlpha(css: string): number {
	const c = css.trim().toLowerCase();
	if (c === '' || c === 'transparent' || c === 'none') return 0;
	// rgb(r g b / a), color(srgb r g b / a), oklch(l c h / a), …
	const slash = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(c);
	if (slash) return clamp(Number(slash[1]) / (slash[2] ? 100 : 1));
	// rgba(r, g, b, a)
	const comma = /^rgba?\(([^)]*)\)$/.exec(c);
	if (comma) {
		const parts = comma[1].split(',');
		if (parts.length === 4) {
			const a = parts[3].trim();
			return clamp(a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a));
		}
	}
	return 1;
}

const clamp = (a: number) => (Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1);

/** The part of an element this module reads (an HTML element in Obsidian, a fake one in tests). */
export interface BackdropEl {
	parentElement: BackdropEl | null;
	hasClass(cls: string): boolean;
}

/**
 * The backgrounds from `start` out to its outermost enclosing callout, as CSS background layers
 * (innermost on top), for `--dynasty-callout-bg`. Stops at the first opaque one. Null when `start`
 * is not in a callout; `none` when the callout paints no background (the note shows through).
 */
export function calloutBackdrop<E extends BackdropEl>(start: E, background: (el: E) => string): string | null {
	let outer: BackdropEl | null = null;
	for (let e: BackdropEl | null = start; e; e = e.parentElement) if (e.hasClass('callout')) outer = e;
	if (!outer) return null;
	const layers: string[] = [];
	for (let e: BackdropEl | null = start; e; e = e.parentElement) {
		const c = (background(e as E) ?? '').trim();
		const a = colourAlpha(c);
		if (a > 0) {
			layers.push(`linear-gradient(${c}, ${c})`);
			if (a >= 1) break;
		}
		if (e === outer) break;
	}
	return layers.length ? layers.join(', ') : 'none';
}

/** WCAG 2 contrast ratio of two sRGB colours [r, g, b] (0–255). */
export function contrastRatio(a: readonly number[], b: readonly number[]): number {
	const lin = (v: number) => {
		const x = v / 255;
		return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
	};
	const lum = (c: readonly number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
	const x = lum(a);
	const y = lum(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** WCAG 2 1.4.11: a graphical object needs 3:1 against the colour next to it. */
export const MARK_CONTRAST = 3;

let paint: CanvasRenderingContext2D | null | undefined;

/**
 * A computed CSS colour as sRGB [r, g, b] (0–255), drawn on a 1 × 1 canvas so every syntax the
 * engine knows (rgb(), color(srgb …), oklch(), …) comes out the same way. Null without a canvas or
 * for a colour the canvas cannot draw.
 */
export function srgb(css: string): number[] | null {
	if (paint === undefined) {
		try {
			const c = createEl('canvas');
			c.width = 1;
			c.height = 1;
			paint = c.getContext('2d', { willReadFrequently: true });
		} catch {
			paint = null;
		}
	}
	const ctx = paint;
	if (!ctx) return null;
	try {
		ctx.clearRect(0, 0, 1, 1);
		// A value the canvas cannot read leaves this one, which draws nothing.
		ctx.fillStyle = 'transparent';
		ctx.fillStyle = css;
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		return d[3] === 0 ? null : [d[0], d[1], d[2]];
	} catch {
		// A canvas that cannot be read back (a strict privacy setting): the theme's own pair stays.
		return null;
	}
}

/** The least contrast of text on the accent (WCAG 2 level AA, normal text). */
export const TEXT_CONTRAST = 4.5;

/**
 * The text colour on the accent: `null` keeps the theme's own pair (`--text-on-accent` on `--interactive-accent`) when it reaches 4.5:1;
 * otherwise black or white, whichever has the larger contrast on the accent.
 */
export function onAccentFrom(accent: readonly number[], onAccent: readonly number[] | null): '#000000' | '#ffffff' | null {
	if (onAccent && contrastRatio(onAccent, accent) >= TEXT_CONTRAST) return null;
	return contrastRatio([0, 0, 0], accent) >= contrastRatio([255, 255, 255], accent) ? '#000000' : '#ffffff';
}

/**
 * The value of the custom property `--dynasty-on-accent` for the page that `el` is in, or null to keep the base token (the theme's own pair). Needs a connected
 * element; null too when a role cannot be read as a colour. Only the two role values are read, so the cost is two style reads and two canvas draws.
 */
export function onAccentChoice(el: Element, parse: (css: string) => number[] | null = srgb): '#000000' | '#ffffff' | null {
	const cs = getComputedStyle(el);
	const accent = parse(cs.getPropertyValue('--interactive-accent').trim());
	if (!accent) return null;
	const on = parse(cs.getPropertyValue('--text-on-accent').trim());
	return onAccentFrom(accent, on);
}

/** The least contrast of a line or a control edge against the colour next to it (WCAG 2.1 1.4.11). */
export const EDGE_CONTRAST = MARK_CONTRAST;

/**
 * The run-time colours of the plugin's grey text, link, control edge and error text (D212 `contrast-tokens`). Each starts from the static
 * token of `01-base.css` (read from the page; else the plain theme role in `role`) and keeps it when it already reaches `min` on every surface in `on`.
 * Otherwise it is pulled toward `--text-normal` in 5 % steps until it does.
 */
export const CONTRAST_TOKENS = [
	{ token: '--dynasty-muted', role: '--text-muted', min: TEXT_CONTRAST, on: ['--background-primary', '--background-primary-alt', '--background-secondary', '--modal-background'] },
	{ token: '--dynasty-link', role: '--text-accent', min: TEXT_CONTRAST, on: ['--background-primary', '--background-secondary', '--modal-background'] },
	{ token: '--dynasty-edge', role: '--text-muted', min: EDGE_CONTRAST, on: ['--background-primary', '--background-primary-alt', '--modal-background'] },
	// Also the button fills: a phone paints `button.mod-warning` with --interactive-normal, and error text sits on it (contrast 3.4 to 4.0 on "Delete person").
	{ token: '--dynasty-error', role: '--text-error', min: TEXT_CONTRAST, on: ['--background-primary', '--background-primary-alt', '--background-secondary', '--modal-background', '--interactive-normal', '--interactive-hover'] },
] as const;

/** `base` moved `t` (0 to 1) of the way to `toward`, channel by channel in sRGB, as `color-mix(in srgb, …)` does. */
export function mixRgb(base: readonly number[], toward: readonly number[], t: number): number[] {
	return base.map((v, i) => Math.round(v + (toward[i] - v) * t));
}

/**
 * The first colour on the way from `base` to `toward` (steps of 5 %) that reaches `min` contrast on every surface; `base` itself when it already does;
 * `toward` when no step does (the text colour is then the best the theme allows).
 */
export function pullToward(base: readonly number[], toward: readonly number[], surfaces: readonly (readonly number[])[], min: number): number[] {
	for (let step = 0; step <= 20; step++) {
		const c = mixRgb(base, toward, step / 20);
		if (surfaces.every((s) => contrastRatio(c, s) >= min)) return c;
	}
	return [...toward];
}

/**
 * The value that each contrast token needs on this page: `rgb(r, g, b)` where the static token is too faint, `null` to keep the static token. `read` gives the
 * computed value of a custom property of the page (the inline overrides must be off while it is read). A token whose text colour, base or surfaces cannot
 * be read as colours stays static (null). Cost: a few style reads and canvas draws, once for each theme change.
 */
export function contrastChoices(read: (name: string) => string, parse: (css: string) => number[] | null = srgb): Record<string, string | null> {
	const out: Record<string, string | null> = {};
	const text = parse(read('--text-normal').trim());
	for (const t of CONTRAST_TOKENS) {
		out[t.token] = null;
		if (!text) continue;
		const base = parse(read(t.token).trim()) ?? parse(read(t.role).trim());
		const surfaces = t.on.map((r) => parse(read(r).trim())).filter((s): s is number[] => s !== null);
		if (!base || !surfaces.length) continue;
		const pick = pullToward(base, text, surfaces, t.min);
		if (pick.some((v, i) => v !== base[i])) out[t.token] = `rgb(${pick[0]}, ${pick[1]}, ${pick[2]})`;
	}
	return out;
}
