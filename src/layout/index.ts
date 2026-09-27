/**
 * The layout module's entry point. `layoutTree` runs generation and order finding, then
 * `layoutFamilies` and `routeEdges`, behind a small in-memory cache keyed on everything that could
 * move a card or change a line (spec §5.1 step 6, D9). Renderers call `layoutTree`; they read the
 * shared shapes and helpers of `model.ts` and `geometry.ts` directly.
 */
import type { FamilyGraph } from '../core/derive';
import { computeGenerations } from '../core/generations';
import { computeModelOrder } from '../core/order';
import { routeEdges } from './edges';
import { narrowWidth } from './geometry';
import { layoutFamilies } from './layout';
import type { Geometry, LaidOut, LayoutSettings, LayoutTree } from './model';

export { geometryFor, NORMAL_GEOMETRY } from './geometry';
export { DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS } from './layout';
export { illegitimateSigns } from './illegitimate-sign';

/** Recent layouts. Layout is cheap (spec D9), so this only saves repeat work on re-render. */
export const LAYOUT_CACHE_SIZE = 16;

const cache = new Map<string, LaidOut>();

/**
 * Everything that can move a card or change a line, in a stable text form. Names, titles,
 * dates, links and notes are left out: they change what a card says, not where it sits.
 * House and sex stay in: they decide which parent anchors a family and which side a spouse sits.
 */
export function layoutKey(g: FamilyGraph, geo: Geometry, settings: LayoutSettings, fontFamily: string): string {
	// An absent orientation is `down`, and card width only matters sideways: equal layouts share a key.
	// A narrow card's width goes in as the layout will use it (rounded to 0.5 px, clamped).
	const sideways = settings.orientation === 'sideways';
	const narrow = sideways && settings.sidewaysCards === 'narrow';
	// D29, D37: only people of this tree count, once each, in a stable order; none leaves the key as before.
	const tall = [...new Set(settings.tallCards ?? [])].filter((id) => g.byId.has(id)).sort();
	const parts: unknown[] = [
		fontFamily,
		geo,
		sideways
			? { sweeps: settings.sweeps, far: settings.far, orientation: 'sideways', sidewaysCards: narrow ? 'narrow' : 'normal', ...(narrow ? { narrowCardW: narrowWidth(geo, settings.narrowCardW) } : {}), ...(tall.length ? { tallCards: tall } : {}) }
			: { sweeps: settings.sweeps, far: settings.far, ...(tall.length ? { tallCards: tall } : {}) },
		g.people.map((p) => [p.id, p.sex ?? '', p.house ?? '', p.illegitimate ? 1 : 0, g.placementParents.get(p.id) ?? [], g.placementType.get(p.id) ?? '', g.primaryUnion.get(p.id) ?? '']),
		g.unions.map((u) => [u.key, u.partners, u.type, u.implicit ? 1 : 0, u.children]),
		[...g.unionsOf],
		[...g.soloChildren],
		g.secondary.map((s) => [s.child, s.type, s.parents, s.unionKey ?? '']),
	];
	// JSON writes Infinity, -Infinity and NaN all as null; a loose far rule must not share a key with another.
	return hash(JSON.stringify(parts, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v)));
}

/** cyrb53: a fast 53-bit string hash. Collisions among 16 cached entries are negligible. */
function hash(s: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Results are shared between callers through the cache, so they are read-only: every object is
 * frozen, and the maps throw on `set`, `delete` and `clear`. The layout keeps its own copy of
 * `geo`.
 */
export const layoutTree: LayoutTree = (g, geo, settings, fontFamily) => {
	const key = layoutKey(g, geo, settings, fontFamily);
	const hit = cache.get(key);
	if (hit) {
		// Move to the most recent end; Map keeps insertion order.
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const gen = computeGenerations(g);
	const order = computeModelOrder(g, gen);
	const layout = layoutFamilies(g, gen, order, { ...geo }, settings);
	const out: LaidOut = deepFreeze({ layout, edges: routeEdges(g, layout, order.anchors) });
	cache.set(key, out);
	while (cache.size > LAYOUT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
	return out;
};

const readOnly = () => {
	throw new TypeError('Layout results are read-only');
};

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	if (value instanceof Map) {
		for (const [k, v] of value) {
			deepFreeze(k);
			deepFreeze(v);
		}
		for (const method of ['set', 'delete', 'clear']) Object.defineProperty(value, method, { value: readOnly });
	} else {
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return Object.freeze(value);
}

/** Settings button "Clear layout cache" (spec §9). */
export function clearLayoutCache(): void {
	cache.clear();
}
