/**
 * The layout module's entry point. `layoutTree` runs the generations and then `arrangeTree` (the card-and-line
 * pipeline: walk, plan, place, route; `pipeline.ts`), behind a small in-memory cache keyed on everything that could
 * move a card or change a line (spec §5.1 step 6, D9). Renderers call `layoutTree`; they read the
 * shared shapes and helpers of `model.ts` and `geometry.ts` directly.
 */
import { deepFreeze } from '../core/deep-freeze';
import type { FamilyGraph } from '../core/derive';
import { computeGenerations } from '../core/generations';
import { hash } from '../core/hash';
import { foldControls, foldFamilies, hiddenPartners, pruneGraph, type FoldControl } from '../core/folds';
import type { FoldInput } from './fold-spots';
import { withRelationLine } from './geometry';
import type { Geometry, LaidOut, LayoutSettings, LayoutTree } from './model';
import { arrangeTree } from './pipeline';

export { geometryFor, NORMAL_GEOMETRY } from './geometry';
export { DEFAULT_FAR_RULE, DEFAULT_LAYOUT_SETTINGS, NEVER_FAR_RULE, armsCards, pictureSets } from './layout';
export { illegitimateSigns } from './illegitimate-sign';

/** Recent layouts. Layout is cheap (spec D9), so this only saves repeat work on re-render. */
export const LAYOUT_CACHE_SIZE = 16;

const cache = new Map<string, LaidOut>();

/**
 * The generations of each graph object whose layout finished: `measuredLayout` lays the same graph out a second time when the tall
 * cards need the first layout, and the generations depend on the graph only. Keyed by the object, never by a text: a graph is not changed after
 * `deriveFamilies` makes it, and an entry lives only as long as its graph. The layout only reads the map.
 */
const generationsByGraph = new WeakMap<FamilyGraph, Map<string, number>>();

/** Thrown by `layoutTree` when its `shouldStop` check answers true between two phases (spec §7.7, time budget). The caller shows the bar for a tree that took too long. */
export class LayoutStopped extends Error {
	constructor() {
		super('The layout stopped: it passed its time budget.');
		this.name = 'LayoutStopped';
	}
}

/**
 * Everything that can move a card or change a line, in a stable text form. Names, titles,
 * dates, links and notes are left out: they change what a card says, not where it sits.
 * House and sex stay in: they decide which parent anchors a family and which side a spouse sits.
 */
export function layoutKey(g: FamilyGraph, geo: Geometry, settings: LayoutSettings, fontFamily: string): string {
	// An absent orientation is `down`: equal layouts share a key.
	const sideways = settings.orientation === 'sideways';
	// D29, D37: only people of this tree count, once each, in a stable order; none leaves the key as before.
	const tall = [...new Set(settings.tallCards ?? [])].filter((id) => g.byId.has(id)).sort();
	// D81: the same for three-line names; none leaves the key as before.
	const long = [...new Set(settings.longNames ?? [])].filter((id) => g.byId.has(id)).sort();
	// D61: the same for two-line title text lines; none leaves the key as before.
	const tallT = [...new Set(settings.tallTitles ?? [])].filter((id) => g.byId.has(id)).sort();
	// The "You" tab counts only for a person of this graph, as the layout sees it; the card form is in `geo`.
	const youTab = settings.youTab !== undefined && g.byId.has(settings.youTab) ? settings.youTab : undefined;
	// The ordinal tabs are ids, once each and sorted, of people of this graph. An array, not a `Map` or `Set`: those serialise to `{}` and would drop out of the key.
	const ordinals = [...new Set(settings.ordinalCards ?? [])].filter((id) => g.byId.has(id)).sort();
	// D40: only a relation line changes the key; without one the key is as before.
	const rel = { ...(settings.relationLine ? { relationLine: true } : {}), ...(youTab !== undefined ? { youTab } : {}), ...(ordinals.length ? { ordinalCards: ordinals } : {}) };
	// The crown and the reach come from the picture lists as given (`drawnGeometry` has no graph), so a list of ids that are not in this graph still moves the layout.
	const drawn = withRelationLine(geo, { ...settings, youTab, ordinalCards: ordinals });
	const heights = { ...(drawn.crown ? { crown: drawn.crown } : {}), ...(drawn.textTop ? { textTop: drawn.textTop } : {}), ...(drawn.reach ? { reach: drawn.reach } : {}) };
	// The text card shows no picture, so the picture lists never change a sideways text layout.
	const textCard = geo.form === 'text';
	// The picture sets, filtered, once each and sorted; none leaves the key as it is without them.
	const arms = textCard ? [] : [...new Set(settings.arms ?? [])].filter((id) => g.houses.has(id)).sort();
	// The people with personal arms and the setting; absent leaves the key as before.
	const personalArms = textCard ? [] : [...new Set(settings.personalArms ?? [])].filter((id) => g.byId.has(id)).sort();
	const portraits = textCard ? [] : [...new Set(settings.portraits ?? [])].filter((id) => g.byId.has(id)).sort();
	// D206: a holder shows the arms of the house; the titles are not part of the people list below, so the holders go in with the setting.
	const holders = settings.armsOnCards === undefined ? [] : [...new Set(g.titles.flatMap((x) => x.holders.map((h) => h.person ?? '')))].filter(Boolean).sort();
	// The people that folds hide, the folded families and the controls; empty or absent leaves the key as before.
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
		...(personalArms.length ? { personalArms } : {}),
		...(!textCard && settings.armsOnCards !== undefined ? { armsOnCards: settings.armsOnCards, armsHolders: holders } : {}),
		...(portraits.length ? { portraits } : {}),
	};
	const parts: unknown[] = [
		fontFamily,
		geo,
		sideways
			? { sweeps: settings.sweeps, far: settings.far, orientation: 'sideways', ...tallParts, ...rel, ...heights }
			: { sweeps: settings.sweeps, far: settings.far, ...tallParts, ...rel, ...heights },
		g.people.map((p) => [p.id, p.sex ?? '', p.house ?? '', p.illegitimate ? 1 : 0, g.placementParents.get(p.id) ?? [], g.placementType.get(p.id) ?? '', g.primaryUnion.get(p.id) ?? '']),
		g.unions.map((u) => [u.key, u.partners, u.type, u.implicit ? 1 : 0, u.children]),
		[...g.unionsOf],
		[...g.soloChildren],
		g.secondary.map((s) => [s.child, s.type, s.parents, s.unionKey ?? '']),
	];
	// JSON writes Infinity, -Infinity and NaN all as null; a loose far rule must not share a key with another.
	return hash(JSON.stringify(parts, (_: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v)));
}

/**
 * What the layout needs to know about folds, or undefined for a tree with no folds and no controls (then
 * nothing differs from a tree with no folds). `pruned` is the graph to arrange, without the people that folds hide (rule 7).
 */
function foldPlan(g: FamilyGraph, settings: LayoutSettings): { pruned: FamilyGraph; input: FoldInput } | undefined {
	const hidden = new Set((settings.foldHidden ?? []).filter((id) => g.byId.has(id)));
	if (!hidden.size && !settings.foldControls) return undefined;
	const partners = hiddenPartners(g, hidden);
	const controls = settings.foldControls ? foldControls(g, new Set(settings.foldedFamilies ?? []), hidden) : undefined;
	// A folded family keeps a stem only when none of its children shows; a fold that hides nobody has no sign.
	const byKey = new Map(foldFamilies(g).map((f) => [f.key, f]));
	const folded: FoldControl[] = (controls ?? []).filter((c) => c.folded && byKey.get(c.key)?.children.every((id) => hidden.has(id)));
	return { pruned: pruneGraph(g, hidden), input: { full: g, partners, controls, folded } };
}

/**
 * Results are shared between callers through the cache, so they are read-only: every object is
 * frozen, and the maps throw on `set`, `delete` and `clear`. The layout keeps its own copy of
 * `geo`.
 */
export const layoutTree: LayoutTree = (g, geo, settings, fontFamily, shouldStop) => {
	const key = layoutKey(g, geo, settings, fontFamily);
	const hit = cache.get(key);
	if (hit) {
		// Move to the most recent end; Map keeps insertion order.
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	// Only between the phases, never inside one: a stopped layout leaves no partial result, and nothing of it is cached. The sites inside
	// `arrangeTree` (after the walk, each plan, each placement round and the route) call the same check.
	const check = () => {
		if (shouldStop?.()) throw new LayoutStopped();
	};
	check();
	const gen = generationsByGraph.get(g) ?? computeGenerations(g);
	check();
	const fold = foldPlan(g, settings);
	// F2: the generations come from the whole graph; the arranger gets the graph without the hidden people.
	const shown = fold ? fold.pruned : g;
	const out: LaidOut = deepFreeze(arrangeTree(shown, gen, { ...geo }, settings, fold?.input, { check }));
	// Kept only now: a stopped layout leaves nothing behind.
	generationsByGraph.set(g, gen);
	cache.set(key, out);
	while (cache.size > LAYOUT_CACHE_SIZE) cache.delete(cache.keys().next().value!);
	return out;
};

/** Settings button "Clear layout cache" (spec §9). */
export function clearLayoutCache(): void {
	cache.clear();
}
