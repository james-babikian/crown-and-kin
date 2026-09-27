/**
 * What the tree view reads from the theme as the engine computed it (WP6.5), where one CSS formula
 * cannot follow every theme:
 * - Spec §5.8, §10: the embedded tree is transparent, so a callout's background shows through it; its
 *   toolbar must hide the cards under it, so it is opaque and paints the callout's background itself.
 *   Themes paint callouts in different ways (Obsidian 1.13 mixes --callout-color with color-mix(),
 *   older versions and some themes use rgba(), Minimal's outlined callouts have no background).
 * - The `+` badge: the theme's --text-on-accent can be too weak on a pale accent (AnuPpuccin light).
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

/**
 * The `+` on the badge keeps the theme's own pair (--text-on-accent on the accent, as on the theme's
 * buttons) unless that pair is below 3:1 and the text colour does better on the accent.
 */
export function plusInText(accent: readonly number[], onAccent: readonly number[], text: readonly number[]): boolean {
	const own = contrastRatio(onAccent, accent);
	return own < MARK_CONTRAST && contrastRatio(text, accent) > own;
}

/** The three theme roles of the `+` badge, as custom properties. */
export const PLUS_ROLES = ['--interactive-accent', '--text-on-accent', '--text-normal'] as const;

/**
 * The `+` choice from the three role colours (in `PLUS_ROLES` order) as CSS text; null when one of
 * them cannot be read as a colour.
 */
export function plusFrom(colours: readonly (string | undefined)[], parse: (css: string) => number[] | null = srgb): boolean | null {
	// A canvas reads currentcolor as its own colour, not the tree's: that value needs a probe.
	const [accent, onAccent, text] = colours.map((raw) => {
		const c = (raw ?? '').trim();
		return c && !/currentcolor/i.test(c) ? parse(c) : null;
	});
	return accent && onAccent && text ? plusInText(accent, onAccent, text) : null;
}

/**
 * G5 fix round: a probe element added to the page makes the engine compute the style of every
 * element again (Obsidian's `:has()` rules), about 0.35 s for sample tree 7 on a slow phone. So the
 * tree reads the roles from its own computed custom properties, which costs nothing once the page is
 * drawn. Only a value the canvas cannot read (a theme can write a colour as any CSS) falls back to
 * probes, and those run once for the whole plugin until the next `css-change`.
 */
let generation = 0;
let probed: { generation: number; on: boolean } | null = null;

/** Called by the plugin on `css-change` (and its later check): the probes may read other colours now. */
export function themeChanged(): void {
	generation++;
}

/** The `+` choice for a tree whose root is `root` (connected, with its style computed). */
export function plusChoice(root: HTMLElement): boolean {
	const cs = getComputedStyle(root);
	const own = plusFrom(PLUS_ROLES.map((p) => cs.getPropertyValue(p)));
	if (own !== null) return own;
	if (probed?.generation === generation) return probed.on;
	// All three probes first, then all three reads: one style pass, not three.
	const probes = ['dynasty-probe-accent', 'dynasty-probe-on-accent', 'dynasty-probe-text'].map((cls) => root.createDiv({ cls: ['dynasty-colour-probe', cls] }));
	try {
		probed = { generation, on: plusFrom(probes.map((p) => getComputedStyle(p).color)) ?? false };
	} finally {
		for (const p of probes) p.remove();
	}
	return probed.on;
}

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
