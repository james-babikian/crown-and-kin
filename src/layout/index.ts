/**
 * The layout module's entry point. `layoutTree` runs generation and order finding, then
 * `layoutFamilies` and `routeEdges`, behind a small in-memory cache keyed on everything that could
 * move a card or change a line (spec §5.1 step 6, D9). Renderers call `layoutTree`; they read the
 * shared shapes and helpers of `model.ts` and `geometry.ts` directly.
 */
import type { FamilyGraph } from '../core/derive';
import { computeGenerations } from '../core/generations';
import { foldControls, foldFamilies, hiddenPartners, pruneGraph, type FoldControl } from '../core/folds';
import { computeModelOrder } from '../core/order';
import { routeEdges } from './edges';
import type { FoldInput } from './fold-spots';
import { narrowWidth } from './geometry';
import { layoutFamilies } from './layout';
import type { Geometry, LaidOut, LayoutSettings, LayoutTree } from './model';

export { geometryFor, NORMAL_GEOMETRY } from './geometry';
export { DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, armsCards, pictureSets } from './layout';
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
	// D81: the same for three-line names; none leaves the key as before.
	const long = [...new Set(settings.longNames ?? [])].filter((id) => g.byId.has(id)).sort();
	// D61: the same for two-line title text lines; none leaves the key as before.
	const tallT = [...new Set(settings.tallTitles ?? [])].filter((id) => g.byId.has(id)).sort();
	// D40: only a relation line changes the key; without one the key is as before.
	const rel = settings.relationLine ? { relationLine: true } : {};
	// M9 (L3): the picture sets, filtered, once each and sorted; none leaves the key as in M8.
	const arms = [...new Set(settings.arms ?? [])].filter((id) => g.houses.has(id)).sort();
	const portraits = [...new Set(settings.portraits ?? [])].filter((id) => g.byId.has(id)).sort();
	// M10 (L3, F1): the people that folds hide, the folded families and the controls; empty or absent leaves the key as before.
	const hidden = [...new Set(settings.foldHidden ?? [])].filter((id) => g.byId.has(id)).sort();
	const folded = [...new Set(settings.foldedFamilies ?? [])].sort();
	const tallParts = {
		...(tall.length ? { tallCards: tall } : {}),
		...(tallT.length ? { tallTitles: tallT } : {}),
		...(long.length ? { longNames: long } : {}),
		...(hidden.length ? { foldHidden: hidden } : {}),
		...(folded.length ? { foldedFamilies: folded } : {}),
		...(settings.foldControls ? { foldControls: true } : {}),
		...(arms.length ? { arms } : {}),
		...(portraits.length ? { portraits } : {}),
	};
	const parts: unknown[] = [
		fontFamily,
		geo,
		sideways
			? { sweeps: settings.sweeps, far: settings.far, orientation: 'sideways', sidewaysCards: narrow ? 'narrow' : 'normal', ...(narrow ? { narrowCardW: narrowWidth(geo, settings.narrowCardW) } : {}), ...tallParts, ...rel }
			: { sweeps: settings.sweeps, far: settings.far, ...tallParts, ...rel },
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
 * M10 (F1–F5): what the layout needs to know about folds, or undefined for a tree with no folds and no controls (then
 * nothing differs from M9). `pruned` is the graph to arrange, without the people that folds hide (rule 7).
 */
function foldPlan(g: FamilyGraph, settings: LayoutSettings): { pruned: FamilyGraph; input: FoldInput } | undefined {
	const hidden = new Set((settings.foldHidden ?? []).filter((id) => g.byId.has(id)));
	if (!hidden.size && !settings.foldControls) return undefined;
	const partners = hiddenPartners(g, hidden);
	const controls = settings.foldControls ? foldControls(g, new Set(settings.foldedFamilies ?? []), hidden) : undefined;
	// A folded family keeps a stem only when none of its children shows; a fold that hides nobody has no sign.
	const byKey = new Map(foldFamilies(g).map((f) => [f.key, f]));
	const folded: FoldControl[] = (controls ?? []).filter((c) => c.folded && byKey.get(c.key)?.children.every((id) => hidden.has(id)));
	return { pruned: pruneGraph(g, hidden), input: { full: g, partners, controls, lines: { tagged: new Set(partners.keys()), folded, ...(controls ? { controls } : {}) } } };
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
	const fold = foldPlan(g, settings);
	// F2: the generations come from the whole graph; the arranger and the router get the graph without the hidden people.
	const shown = fold ? fold.pruned : g;
	const order = computeModelOrder(shown, gen);
	const layout = layoutFamilies(shown, gen, order, { ...geo }, settings, undefined, fold?.input);
	const out: LaidOut = deepFreeze({ layout, edges: routeEdges(shown, layout, order.anchors, fold?.input.lines) });
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
