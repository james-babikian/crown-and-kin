/*
 * The whole card-and-line pipeline: a graph, its generations, a geometry and the layout settings in; a
 * `LaidOut` (the cards and the lines) out. The stages: walk (core/order.ts), skeleton and plan (plan.ts), placement (place.ts; any
 * placement that keeps the order and the minimum gaps may stand in, assumption A16), the far-by-distance rounds, the ports again from
 * the positions, the route (route.ts, draw.ts). A sideways tree runs in the turned frame and is turned back at the end (D24).
 * `arrangeTree` is uncached and returns a `LaidOut`; `runStages` is the one path under it and also returns what the tests and tools look
 * into (the plan, the counts). `index.ts` calls `arrangeTree` behind the cache; the tests and scripts call it through an internal script.
 */
import type { FamilyGraph } from '../core/derive';
import { computeModelOrder } from '../core/order';
import { FOLD_EM, type FoldInput } from './fold-spots';
import { lineMetrics, MIN_HIT, sidewaysGeometry, sidewaysPartnerGap, tabbedCards, tagTop, TIE, turnedGeometry, withRelationLine } from './geometry';
import { sideTagHit } from './layout';
import type { FarTag, Geometry, LaidOut, LayoutSettings, PersonBox, TreeLayout, UnionPoint } from './model';
import { turnBox, turnEdges, turnUnion } from './turn';
import { farSpouses, routeTree, type Routed } from './draw';
import type { Plan } from './plan-model';
import { derive, farByDistance, markFar, nearAgain, planTree, walkSide, type PlanInput } from './plan';
import { hangX, shiftToMargin, placeItems, startMargin } from './place';
import { pairOf } from './ports';

/** A placement: gives every item of the plan an x, keeping the order of every row and its minimum gaps. */
export type Placement = (plan: Plan, g: FamilyGraph, geo: Geometry) => void;

/** The places where the time-budget hook is called (spec §7.7, D225): after the walk, after each plan, after each placement round, after the route. */
export type CheckSite = 'walk' | 'plan' | 'place' | 'route';

/** The options of `arrangeTree`; both are for the tests and the time budget, the plugin passes at most `check`. */
interface ArrangeOptions {
	/** The placement stage; the default placement (`placeItems` with the settings' sweeps) when absent. The one injection point of the tests of A16. */
	place?: Placement;
	/** The time-budget hook: called after each stage, never inside one. It may throw `LayoutStopped`; nothing here catches it and no partial result is returned. */
	check?: (site: CheckSite) => void;
}

/** What `runStages` returns: the result, the plan for the checks and the measures, and the counts of the bounded loops (I8). */
export interface Stages extends LaidOut {
	plan: Plan;
	/** The placement stage's record: the hang point of every family as the placement centred the children under it (in the working frame); the final ports give the same x (A4). */
	hangAtPlacement: Map<string, number>;
	/** How often `derive` ran, the first plan included: at most twice the number of partnerships plus 2. */
	derives: number;
	/** How many placement rounds ran: at most twice the number of partnerships plus 1. */
	rounds: number;
	/** The couples that were far by distance in a round and came back to near (the partners are within the limit again); sorted. They stay near (A15). */
	cameBack: string[];
	/** How often the route fell back to the clearest place: a passage line or a child slot with no place clear of every foreign vertical. */
	fallbacks: number;
}

/** The most partnerships any one couple has: the sideways couple gap grows with it. */
function mostUnionsOfOneCouple(g: FamilyGraph): number {
	const counts = new Map<string, number>();
	for (const fu of g.unions) {
		const key = pairOf(fu);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return Math.max(0, ...counts.values());
}

/**
 * The turned frame's geometry for routing a sideways tree (D24). A fold control on a couple lane has a tap area `MIN_HIT` wide along the
 * generations. Seen from the real picture it stands between two columns of cards, and the tag tap areas hang inside both columns, at least
 * `tagInset` in from the card edge. At small fonts the first lane leaves less room than that (8 and 9 px: the area reaches 8 px into the
 * column before), so the tap area met a tag. When the tree has fold controls the first lane moves in, by the room a tag takes in the down
 * frame (none here), just enough for the area to start at the tag areas' edge. The gap after the lanes is `withTapRoom` (draw.ts). From
 * about 11 px on the font's own sizes are enough and nothing changes.
 */
function routingGeometry(side: Geometry, controls: boolean): Geometry {
	const turned = turnedGeometry(side);
	if (!controls) return turned;
	const m = lineMetrics(turned);
	const short = MIN_HIT / 2 - m.tagInset - (m.coupleLane0 + FOLD_EM.afterMarker * turned.fontPx);
	return short > 0 ? { ...turned, tagH: turned.tagH + Math.ceil(short) } : turned;
}

/** The sideways tree from the layout of the turned frame: cards and points turned, the tags put on the real bottom edges (D24). */
function turnLayout(routed: Routed, plan: Plan, g: FamilyGraph, side: Geometry, fold: FoldInput | undefined, youTab: string | undefined, ordinalCards: readonly string[]): LaidOut {
	const persons = new Map<string, PersonBox>();
	for (const b of routed.layout.persons.values()) persons.set(b.id, turnBox(b));
	const unions = new Map<string, UnionPoint>();
	for (const u of routed.layout.unions.values()) unions.set(u.key, turnUnion(u));
	const farTags = new Map<string, FarTag>();
	for (const id of plan.tagged) {
		const box = persons.get(id)!;
		const row = routed.layout.rows[box.gen];
		const next = row[row.indexOf(id) + 1];
		const y = box.y + box.h;
		const zone = routed.tagZones.get(id)!;
		const hit = sideTagHit({ x: box.x + zone.x, w: zone.w }, y, next === undefined ? Infinity : persons.get(next)!.y, side);
		farTags.set(id, { person: id, spouses: farSpouses(g, plan, id, fold), x: box.x + zone.x, y, hit, zoneW: zone.w });
	}
	const width = Math.max(0, routed.layout.height, ...[...persons.values()].map((p) => p.x + p.w), ...[...unions.values()].filter((u) => !u.bar).map((u) => u.x + side.unionSize / 2), ...[...farTags.values()].map((t) => t.hit.x + t.hit.w));
	const height = Math.max(0, routed.layout.width, ...[...persons.values()].map((p) => p.y + p.h), ...[...farTags.values()].map((t) => Math.max(tagTop(side, t.y) + side.tagH, t.hit.y + t.hit.h)));
	// The fold controls turned with the frame (x and y swapped).
	const folds = routed.folds?.map((c) => ({ ...c, spot: { x: c.spot.y, y: c.spot.x } }));
	const layout: TreeLayout = { persons, unions, rows: routed.layout.rows, rowGaps: routed.layout.rowGaps, farTags, width, height, geometry: side, orientation: 'sideways', ...(youTab !== undefined ? { youTab } : {}), ...(ordinalCards.length ? { ordinalCards } : {}), ...(folds ? { folds } : {}) };
	return { layout, edges: turnEdges(routed.edges) };
}

/**
 * Runs the stages on `g` and returns the result with the plan and the counts. `plain` is the geometry before the relation line, as
 * `layoutTree` takes it; `coreGen` the generations of the whole graph, so a fold never changes the order of the rows (spec §13.10).
 */
export function runStages(g: FamilyGraph, coreGen: Map<string, number>, plain: Geometry, given0: LayoutSettings, fold?: FoldInput, opts: ArrangeOptions = {}): Stages {
	const check = opts.check ?? (() => undefined);
	// A tab belongs to a person of the drawn graph; any other id gives no tab and no `reach` (the finder's small tree). The picture's
	// reach is made from the settings, so they are cleaned first.
	const youTab = given0.youTab !== undefined && g.byId.has(given0.youTab) ? given0.youTab : undefined;
	const ordinalCards = [...new Set(given0.ordinalCards ?? [])].filter((id) => g.byId.has(id)).sort();
	const settings: LayoutSettings = { ...given0, youTab, ...(given0.ordinalCards !== undefined ? { ordinalCards: ordinalCards.length ? ordinalCards : undefined } : {}) };
	const tabbed = tabbedCards(youTab, ordinalCards);
	const given = withRelationLine(plain, settings);
	const sideBase = settings.orientation === 'sideways' ? sidewaysGeometry(given) : undefined;
	const side = sideBase && g.unions.length > 1 ? { ...sideBase, coupleGap: sidewaysPartnerGap(sideBase, mostUnionsOfOneCouple(g)) } : sideBase;
	const geo = side ? routingGeometry(side, !!fold?.controls?.length) : given;
	const far = side ? { ...settings.far, maxCardWidths: (settings.far.maxCardWidths * given.cardW) / side.cardH } : settings.far;
	const order = computeModelOrder(g, coreGen, far.maxGenerations, fold?.full ?? g);
	check('walk');
	const place: Placement = opts.place ?? ((p, graph, frame) => placeItems(p, graph, frame, { sweeps: settings.sweeps }));

	const input: PlanInput = { g, coreGen, order, geo, far, settings, ...(side ? { side } : {}), ...(fold ? { fold } : {}) };
	let plan = planTree(input);
	let derives = 1;
	check('plan');
	// Far by distance (D11) is a fixed point of the placement: a couple that turns far loses its passages and legs and gets tags (sideways:
	// their room), which can move cards, make another couple far, or bring the couple itself within the limit. A couple that is within the
	// limit again goes back to near and stays near. So each couple changes at most twice (near to far, far to near for good) and the rounds
	// end after at most two per couple; when they end, every far couple is more than the limit apart in the finished layout (A15).
	const farKeys = new Set<string>();
	const stayNear = new Set<string>();
	let rounds = 0;
	for (let round = 0; round <= 2 * g.unions.length; round++) {
		place(plan, g, geo);
		rounds++;
		check('place');
		const more = farByDistance(plan, far, geo.cardW, stayNear);
		const back = nearAgain(plan, far, geo.cardW, farKeys);
		if (!more.length && !back.length) break;
		for (const k of back) {
			farKeys.delete(k);
			stayNear.add(k);
		}
		for (const k of more) farKeys.add(k);
		// A couple that comes back needs its passages and legs again: the skeleton is built again with the couples that are still far.
		if (back.length) plan = planTree({ ...input, farKeys });
		else {
			markFar(plan.spec, more);
			plan = derive(plan.spec, g, geo, side, walkSide(plan.spec));
		}
		derives++;
		check('plan');
	}
	shiftToMargin(plan, startMargin(plan, geo, side));
	const hangAtPlacement = new Map(plan.families.map((f) => [f.key, hangX(f.hang, geo)]));
	// The ports again, now with the side of every leg and side link taken from the positions; the hang ports keep their places.
	plan = derive(plan.spec, g, geo, side, (from, to) => (to.x + to.w / 2 - (from.x + from.w / 2) < -TIE ? 'left' : 'right'));
	derives++;
	check('plan');
	let fallbacks = 0;
	const routed = routeTree({ plan, g, geo, tabbed, youTab, ordinalCards, ...(side ? { side } : {}), ...(fold ? { fold } : {}) }, () => fallbacks++);
	check('route');
	const done: LaidOut = side ? turnLayout(routed, plan, g, side, fold, youTab, ordinalCards) : { layout: routed.layout, edges: routed.edges };
	return { ...done, plan, hangAtPlacement, derives, rounds, cameBack: [...stayNear].sort(), fallbacks };
}

/** Lays out and routes `g` (uncached): the cards and the lines of the card-and-line system. See `runStages` for the arguments. */
export function arrangeTree(g: FamilyGraph, coreGen: Map<string, number>, plain: Geometry, settings: LayoutSettings, fold?: FoldInput, opts: ArrangeOptions = {}): LaidOut {
	const { layout, edges } = runStages(g, coreGen, plain, settings, fold, opts);
	return { layout, edges };
}
