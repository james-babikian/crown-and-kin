/*
 * Text measurement with a canvas in the resolved font (spec §5.8), shared by every tree.
 * Results are cached: a 400-person tree measures many prefixes of the same names while it
 * truncates, and a re-render with the same font measures the same strings again.
 */

let ctx: CanvasRenderingContext2D | null | undefined;
let current = '';
const cache = new Map<string, number>();
const CACHE_MAX = 50_000;

/** `family` if the canvas accepts it as a font-family list, else `sans-serif`. */
export function usableFamily(family: string): string {
	const c = context();
	if (!c || !family.trim()) return family.trim() || 'sans-serif';
	c.font = '10px monospace';
	c.font = `10px ${family}`;
	const ok = !/^10px monospace$/.test(c.font) || /monospace/.test(family);
	current = '';
	return ok ? family : 'sans-serif';
}

function context(): CanvasRenderingContext2D | null {
	if (ctx === undefined) {
		try {
			ctx = createEl('canvas').getContext('2d');
		} catch {
			ctx = null;
		}
		current = '';
	}
	return ctx;
}

export function measureText(text: string, font: string): number {
	const key = `${font}\u0000${text}`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	const c = context();
	let w: number;
	if (c) {
		if (font !== current) {
			c.font = font;
			current = font;
		}
		w = c.measureText(text).width;
	} else {
		// No canvas: a rough width, so truncation still keeps text inside the card.
		const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
		w = Array.from(text).length * 0.6 * size;
	}
	if (cache.size >= CACHE_MAX) cache.clear();
	cache.set(key, w);
	return w;
}

/** After a font change the old widths are wrong for any font string that stays the same. */
export function clearMeasureCache(): void {
	cache.clear();
	current = '';
}
