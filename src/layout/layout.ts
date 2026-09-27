import { placedChildren, type FamilyGraph } from '../core/derive';
import type { ModelOrder } from '../core/order';
import type { FarCoupleRule, FarTag, Geometry, LayoutSettings, PersonBox, Rect, TreeLayout, UnionPoint } from './model';
import { MIN_HIT, barClear, gapHeight, lineMetrics, sideTagDepth, sidewaysGeometry, tagTop, tallExtra, turnedGeometry } from './geometry';
import { planLines, type LinePlan } from './lines';
import { placeInOrder } from './pava';
import { soloFamiliesOutside } from './solo-side';
import { turnBox, turnUnion } from './turn';

/** Spec D10 defaults: far when more than 3 card widths apart, or more than one generation. */
export const DEFAULT_FAR_RULE: FarCoupleRule = { maxCardWidths: 3, maxGenerations: 1 };
export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = { sweeps: 4, far: DEFAULT_FAR_RULE };
export { MIN_HIT } from './geometry';

/**
 * Where each union's dot goes, given final card positions.
 * - Partners side by side: in the gap between them, on a bar.
 * - Partners in the same block (e.g. a third wife two cards along): below, halfway between.
 * - Partners from different families or generations: below the anchor partner, a quarter-card
 *   towards the other, so the children stay with the family they were drawn under. Far couples
 *   (D10) use the same spot, so the far rule never moves a card.
 */
function placeUnions(
	g: FamilyGraph,
	persons: Map<string, PersonBox>,
	rowIndex: Map<string, number>,
	order: ModelOrder,
	blockOf: Map<string, number>,
	geo: Geometry,
): Map<string, UnionPoint> {
	const unions = new Map<string, UnionPoint>();
	for (const fu of g.unions) {
		const [a, b] = fu.partners.map((p) => persons.get(p)!);
		const adjacent = a.gen === b.gen && Math.abs(rowIndex.get(a.id)! - rowIndex.get(b.id)!) === 1;
		const y = Math.max(a.y + a.h, b.y + b.h) + geo.rowGap * 0.2;
		if (adjacent) {
			const [l, r] = a.x < b.x ? [a, b] : [b, a];
			unions.set(fu.key, { key: fu.key, x: (l.x + l.w + r.x) / 2, y: l.y + l.h / 2, bar: true, far: false });
		} else if (blockOf.get(a.id) === blockOf.get(b.id)) {
			unions.set(fu.key, { key: fu.key, x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y, bar: false, far: false });
		} else {
			const anchor = persons.get(order.anchors.get(fu.key)!)!;
			const other = anchor === a ? b : a;
			const dir = other.x >= anchor.x ? 1 : -1;
			unions.set(fu.key, { key: fu.key, x: anchor.x + anchor.w / 2 + (dir * anchor.w) / 4, y, bar: false, far: false });
		}
	}
	return unions;
}

/**
 * Places every card. `initialX` (card centre x per person) optionally seeds the starting
 * positions and the order of blocks within each row; without it, rows start packed in model
 * order and the sweeps do all the positioning. The spike uses it to compare other arrangers.
 */
export function layoutFamilies(
	g: FamilyGraph,
	coreGen: Map<string, number>,
	order: ModelOrder,
	given: Geometry,
	settings: LayoutSettings,
	initialX?: Map<string, number>,
): TreeLayout {
	// D24 sideways: everything below runs in the turned frame (`turn.ts`) and is turned at the end.
	const side = settings.orientation === 'sideways' ? sidewaysGeometry(given, settings.sidewaysCards ?? 'normal', settings.narrowCardW) : undefined;
	const geo = side ? turnedGeometry(side) : given;
	// D11 keeps its length in px: 3 widths of a `down` card, measured along the column.
	const farRule = side ? { ...settings.far, maxCardWidths: (settings.far.maxCardWidths * given.cardW) / side.cardH } : settings.far;
	// D29, D37: a card with a two-line name is one name text line taller. Sideways that is longer along
	// its column (in the turned frame, wider); in `down` the row takes the height of its tallest card.
	const tall = new Set((settings.tallCards ?? []).filter((id) => g.byId.has(id)));
	const extra = tall.size ? tallExtra(side ?? given) : 0;
	const wide = side ? extra : 0;
	const cw = (id: string) => (wide && tall.has(id) ? geo.cardW + wide : geo.cardW);
	const ch = (id: string) => (!side && extra && tall.has(id) ? geo.cardH + extra : geo.cardH);
	const { gen, blocks } = consistentRows(g, coreGen, soloFamiliesOutside(g, order));
	const blockOf = new Map<string, number>();
	blocks.forEach((b, i) => b.forEach((p) => blockOf.set(p, i)));
	const maxGen = Math.max(0, ...gen.values());
	const rowBlocks: number[][] = Array.from({ length: maxGen + 1 }, () => []);
	blocks.forEach((b, i) => rowBlocks[gen.get(b[0])!].push(i));

	// Starting block centres, and row order.
	const start = new Map<number, number>();
	if (initialX) {
		blocks.forEach((b, i) => start.set(i, b.reduce((s, p) => s + initialX.get(p)!, 0) / b.length));
		for (const row of rowBlocks) row.sort((a, b) => start.get(a)! - start.get(b)!);
	} else {
		for (const row of rowBlocks) {
			let x = 0;
			for (const bi of row) {
				const w = blocks[bi].reduce((s, p) => s + cw(p) + geo.coupleGap, 0);
				start.set(bi, x + w / 2);
				x += w + geo.nodeGap;
			}
		}
	}

	// Siblings keep document order: reassign each family's blocks to the slots they occupy.
	const families: string[][] = [...g.unions.map((u) => u.children), ...g.soloChildren.values()].filter((k) => k.length);
	for (const kids of families) {
		if (kids.length < 2) continue;
		const row = rowBlocks[gen.get(kids[0])!];
		const want = [...new Set(kids.map((k) => blockOf.get(k)!))];
		const slots = want.map((b) => row.indexOf(b)).sort((a, b) => a - b);
		slots.forEach((slot, i) => (row[slot] = want[i]));
	}

	const isCouple = (a: string, b: string) => (g.unionsOf.get(a) ?? []).some((k) => g.unionByKey.get(k)!.partners.includes(b));

	const persons = new Map<string, PersonBox>();
	const rows: string[][] = [];
	const rowIndex = new Map<string, number>();
	// Sideways: cards with a far tag, and the gap after them that holds the tag's whole hit area
	// (`sideTagDepth`) and room for one routed leg below it.
	const spaced = new Set<string>();
	const tagGap = side ? sideTagDepth(side) + lineMetrics(geo).exitStep : 0;

	const placeRow = (r: number, blockTargets: Map<number, number>) => {
		const ids: string[] = [];
		const targets: number[] = [];
		const gaps: number[] = [];
		for (const bi of rowBlocks[r]) {
			const members = blocks[bi];
			// A block's target is the mean of its members' centres (`blockCentre`); with cards of one
			// size that is the middle of the block. With tall cards (D29) it is not, and placing by the
			// middle would move the block a little on every sweep.
			let mean = (members.length * geo.cardW + (members.length - 1) * geo.coupleGap) / 2;
			if (wide) {
				let at = 0;
				mean = 0;
				for (const p of members) {
					mean += at + cw(p) / 2;
					at += cw(p) + geo.coupleGap;
				}
				mean /= members.length;
			}
			const left = blockTargets.get(bi)! - mean;
			let offset = 0;
			members.forEach((p, i) => {
				// Centre to centre: half of each card, then the gap between them.
				const reach = ids.length === 0 ? 0 : wide ? (cw(ids[ids.length - 1]) + cw(p)) / 2 : geo.cardW;
				let gap = ids.length === 0 ? 0 : reach + (i > 0 && isCouple(members[i - 1], p) ? geo.coupleGap : geo.nodeGap);
				if (spaced.size && spaced.has(ids[ids.length - 1])) gap = Math.max(gap, reach + tagGap);
				gaps.push(gap);
				ids.push(p);
				targets.push(wide ? left + offset + cw(p) / 2 : left + i * (geo.cardW + geo.coupleGap) + geo.cardW / 2);
				offset += cw(p) + geo.coupleGap;
			});
		}
		const centres = placeInOrder(targets, gaps);
		rows[r] = ids;
		ids.forEach((id, i) => {
			rowIndex.set(id, i);
			persons.set(id, { id, x: centres[i] - cw(id) / 2, y: r * (geo.cardH + geo.rowGap), w: cw(id), h: ch(id), gen: r });
		});
	};
	const blockCentre = (bi: number) => {
		const m = blocks[bi];
		return m.reduce((s, p) => s + persons.get(p)!.x + cw(p) / 2, 0) / m.length;
	};
	const currentTargets = (r: number) => new Map(rowBlocks[r].map((bi) => [bi, blockCentre(bi)]));

	const centreX = (id: string) => persons.get(id)!.x + cw(id) / 2;
	const span = (ids: string[]) => {
		const xs = ids.map(centreX);
		return (Math.min(...xs) + Math.max(...xs)) / 2;
	};

	/** Children under parents: shift each sibling group so it's centred under its union or single parent. */
	const downSweep = () => {
		for (let r = 1; r <= maxGen; r++) {
			const unions = placeUnions(g, persons, rowIndex, order, blockOf, geo);
			const targets = currentTargets(r);
			for (const kids of families) {
				if (gen.get(kids[0]) !== r) continue;
				const union = g.primaryUnion.get(kids[0]);
				const anchor = union ? unions.get(union)!.x : centreX(g.placementParents.get(kids[0])![0]);
				const shift = anchor - span(kids);
				for (const b of new Set(kids.map((k) => blockOf.get(k)!))) targets.set(b, targets.get(b)! + shift);
			}
			placeRow(r, targets);
		}
	};

	/** Parents over children: shift each block towards centring its unions over their children. */
	const upSweep = () => {
		for (let r = maxGen - 1; r >= 0; r--) {
			const unions = placeUnions(g, persons, rowIndex, order, blockOf, geo);
			const targets = currentTargets(r);
			for (const bi of rowBlocks[r]) {
				// Each family's wish counts once per child. The down sweep moves a crowded row as one pool
				// in which every child counts once; an unweighted mean here disagrees with it, and the
				// block and its children then drift sideways by the same amount on every sweep.
				let sum = 0;
				let weight = 0;
				for (const p of blocks[bi]) {
					for (const key of g.unionsOf.get(p) ?? []) {
						const fu = g.unionByKey.get(key)!;
						if (fu.children.length && fu.partners[0] === p) {
							sum += fu.children.length * (span(fu.children) - unions.get(key)!.x);
							weight += fu.children.length;
						}
					}
					const solo = g.soloChildren.get(p);
					if (solo?.length) {
						sum += solo.length * (span(solo) - centreX(p));
						weight += solo.length;
					}
				}
				if (weight) targets.set(bi, targets.get(bi)! + sum / weight);
			}
			placeRow(r, targets);
		}
	};

	let unions: Map<string, UnionPoint>;
	if (side) {
		// Couples far by generations alone are known before placement: most tags, found in one round.
		for (const fu of g.unions) {
			const [a, b] = fu.partners;
			if (blockOf.get(a) !== blockOf.get(b) && Math.abs(gen.get(a)! - gen.get(b)!) > farRule.maxGenerations) fu.partners.forEach((p) => spaced.add(p));
		}
	}
	for (let round = 0; ; round++) {
		// A later round goes on from where the last one ended: the new gaps open, and one sweep settles them.
		for (let r = 0; r <= maxGen; r++) placeRow(r, round ? currentTargets(r) : new Map(rowBlocks[r].map((bi) => [bi, start.get(bi)!])));
		for (let i = 0; i < (round ? Math.min(settings.sweeps, 1) : settings.sweeps); i++) {
			upSweep();
			downSweep();
		}
		// Normalise to start at 0,0.
		const minX = Math.min(...[...persons.values()].map((p) => p.x));
		for (const p of persons.values()) p.x -= minX;
		unions = placeUnions(g, persons, rowIndex, order, blockOf, geo);
		markFarCouples(g, persons, unions, blockOf, farRule, geo.cardW);
		if (!side) break;
		// A tag's gap moves the cards below it, which can make other couples far: arrange again until
		// every tagged card has its gap. The set only grows, so this ends.
		const more = g.unions.filter((fu) => unions.get(fu.key)!.far).flatMap((fu) => fu.partners.filter((p) => !spaced.has(p)));
		if (!more.length) break;
		for (const p of more) spaced.add(p);
	}
	const barAt = side ? sideBars(g, persons, unions, side) : new Map<string, number>();
	for (const [key, at] of barAt) unions.get(key)!.y = persons.get(g.unionByKey.get(key)!.partners[0])!.y + at;

	// Gaps between rows grow to hold the lanes their lines need; y is set only now. The plan may
	// move a dot sideways (never a card), so that no two trunks share a line.
	const plan = planLines({ g, persons, rows, unions, anchors: order.anchors, geo, side });
	for (const [key, x] of plan.dotX) unions.get(key)!.x = x;
	const m = lineMetrics(geo);
	// Cards in a row share their top edge; the gap below starts under the row's tallest card.
	const rowH = rows.map((ids) => (extra && !side ? Math.max(...ids.map(ch)) : geo.cardH));
	const rowTop: number[] = [0];
	for (let r = 1; r < rows.length; r++) rowTop[r] = rowTop[r - 1] + rowH[r - 1] + gapHeight(geo, plan.coupleLanes[r - 1], plan.barLanes[r - 1]);
	for (const p of persons.values()) p.y = rowTop[p.gen];
	const gapTop = (k: number) => rowTop[k] + rowH[k];
	for (const fu of g.unions) {
		const u = unions.get(fu.key)!;
		const dot = plan.dots.get(fu.key);
		const [a, b] = fu.partners.map((p) => persons.get(p)!);
		// A bar meets both cards halfway down the shorter one (D37: one partner can be taller).
		if (u.bar) u.y = a.y + (barAt.get(fu.key) ?? Math.min(a.h, b.h) / 2);
		else u.y = gapTop(dot?.gap ?? a.gen) + m.coupleLane0 + (dot?.lane ?? 0) * m.coupleLaneStep;
	}
	if (side) return turnLayout(g, persons, unions, rows, rows.slice(1).map((_, r) => ({ top: gapTop(r), bottom: rowTop[r + 1] })), plan, geo, side);
	const farTags = buildFarTags(g, persons, unions, plan, geo);

	const rowGaps = rows.slice(1).map((_, r) => ({ top: gapTop(r), bottom: rowTop[r + 1] }));
	const width = Math.max(0, plan.maxX + geo.nodeGap / 2, ...[...persons.values()].map((p) => p.x + p.w));
	// Union dots and tags below the last row are part of the drawing.
	const height = Math.max(
		0,
		...[...persons.values()].map((p) => p.y + p.h),
		...[...plan.dots.keys()].map((k) => unions.get(k)!.y + geo.unionSize / 2),
		...[...farTags.values()].map((t) => tagTop(geo, t.y) + geo.tagH),
	);
	return { persons, unions, rows, rowGaps, farTags, width, height, geometry: geo, orientation: 'down' };
}

/**
 * Rows the lines can rely on: each block sits exactly one row below the lower placement parent
 * of its member with parents, and no row is empty. Generations from `core/generations` already
 * satisfy this, except when its iteration stops without settling (for example a founder who
 * marries his own granddaughter); then a trunk would cross rows or point upwards. A married-in
 * member who cannot share the row of their block (they are its ancestor) leaves the block.
 */
export function consistentRows(g: FamilyGraph, coreGen: Map<string, number>, modelBlocks: string[][]): { gen: Map<string, number>; blocks: string[][] } {
	const hasParents = (p: string) => g.placementParents.get(p)!.length > 0;
	const isAncestor = (a: string, of: string) => {
		const seen = new Set<string>();
		const stack = [a];
		while (stack.length) {
			for (const c of placedChildren(g, stack.pop()!)) {
				if (c === of) return true;
				if (!seen.has(c)) {
					seen.add(c);
					stack.push(c);
				}
			}
		}
		return false;
	};
	const split = (keep: (block: string[], p: string) => boolean) =>
		modelBlocks.flatMap((b) => {
			const stay = b.filter((p) => keep(b, p));
			return [...(stay.length ? [stay] : []), ...b.filter((p) => !keep(b, p)).map((p) => [p])];
		});
	const settle = (blocks: string[][]) => {
		const gen = new Map(coreGen);
		for (let pass = 0; pass <= blocks.length; pass++) {
			let changed = false;
			for (const block of blocks) {
				const blood = block.find(hasParents);
				const want = blood === undefined ? gen.get(block[0])! : Math.max(...g.placementParents.get(blood)!.map((p) => gen.get(p)!)) + 1;
				for (const p of block) {
					if (gen.get(p) !== want) {
						gen.set(p, want);
						changed = true;
					}
				}
			}
			if (!changed) return gen;
		}
		return undefined;
	};
	let blocks = split((b, p) => {
		const blood = b.find(hasParents);
		return blood === undefined || p === blood || !isAncestor(p, blood);
	});
	let gen = settle(blocks);
	if (!gen) {
		// Rare loops through two marriages: every married-in member stands alone.
		blocks = split((b, p) => hasParents(p) || b.length === 1);
		gen = settle(blocks)!;
	}
	const dense = new Map([...new Set(gen.values())].sort((a, b) => a - b).map((v, i) => [v, i]));
	for (const [id, v] of gen) gen.set(id, dense.get(v)!);
	return { gen, blocks };
}

/**
 * D10: partners in different blocks who are more than `maxCardWidths` card widths apart
 * (card centre to card centre) or more than `maxGenerations` generations apart. Partners drawn
 * side by side always keep their bar, whatever the rule says.
 */
export function isFarCouple(a: PersonBox, b: PersonBox, sameBlock: boolean, adjacent: boolean, rule: FarCoupleRule, cardW = a.w): boolean {
	if (sameBlock || adjacent) return false;
	const apart = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
	return apart > rule.maxCardWidths * cardW || Math.abs(a.gen - b.gen) > rule.maxGenerations;
}

// The card width the rule counts in is the usual one: a tall card (D29) must not change the far distance.
function markFarCouples(g: FamilyGraph, persons: Map<string, PersonBox>, unions: Map<string, UnionPoint>, blockOf: Map<string, number>, rule: FarCoupleRule, cardW: number) {
	for (const fu of g.unions) {
		const u = unions.get(fu.key)!;
		const [a, b] = fu.partners.map((p) => persons.get(p)!);
		u.far = isFarCouple(a, b, blockOf.get(a.id) === blockOf.get(b.id), u.bar, rule, cardW);
	}
}

/** Far spouses of each person, in union order. */
function farSpouses(g: FamilyGraph, unions: Map<string, UnionPoint>): Map<string, string[]> {
	const spouses = new Map<string, string[]>();
	for (const fu of g.unions) {
		if (!unions.get(fu.key)!.far) continue;
		for (const [p, other] of [fu.partners, [fu.partners[1], fu.partners[0]]]) {
			const list = spouses.get(p) ?? [];
			if (!list.includes(other)) list.push(other);
			spouses.set(p, list);
		}
	}
	return spouses;
}

/** One tag per person with far spouses, listed in union order. */
function buildFarTags(g: FamilyGraph, persons: Map<string, PersonBox>, unions: Map<string, UnionPoint>, plan: LinePlan, geo: Geometry): Map<string, FarTag> {
	const tags = new Map<string, FarTag>();
	for (const [person, list] of farSpouses(g, unions)) {
		const box = persons.get(person)!;
		const zone = plan.tagZones.get(person)!;
		const y = box.y + box.h;
		tags.set(person, { person, spouses: list, x: zone.x, y, hit: tagHit(zone, y, geo) });
	}
	return tags;
}

/**
 * The tag hangs from the card's bottom edge (see `tagTop`), in the part of the edge that no other
 * line leaves from. `hit.w` is also the widest the visible tag may be: renderers truncate the
 * text to fit it. Its hit area is at least 44×44 px and sits mostly below the card, so it takes
 * as little of the card's own tap area as possible. Nothing about it depends on names (names are
 * not part of the layout cache key).
 */
export function tagHit(zone: { x: number; w: number }, y: number, geo: Geometry): Rect {
	const w = Math.max(MIN_HIT, zone.w);
	const top = tagTop(geo, y) - 2;
	return { x: zone.x - w / 2, y: top, w, h: Math.max(MIN_HIT, geo.tagH + 4) };
}

/**
 * D24 sideways: the hit area hangs from the card's bottom edge `y` into the gap that placement
 * left for it before the next card (`limit`, that card's top), `sideTagDepth` deep. `span` is the
 * part of the edge it may use, which the layout keeps at least that wide.
 */
export function sideTagHit(span: { x: number; w: number }, y: number, limit: number, geo: Geometry): Rect {
	const w = Math.max(MIN_HIT, span.w);
	return { x: span.x - w / 2, y, w, h: Math.min(sideTagDepth(geo), limit - y) };
}

/**
 * D24, in the turned frame: where the bar of a partner stacked directly below a tagged card meets
 * the cards, measured from their real left edge, when the middle leaves the tag's hit area less
 * than its width (small note fonts). The bar and its union point then move right; the visible tag
 * stays in the left half. The default is the middle.
 */
function sideBars(g: FamilyGraph, persons: Map<string, PersonBox>, unions: Map<string, UnionPoint>, side: Geometry): Map<string, number> {
	const tagged = new Set(g.unions.filter((fu) => unions.get(fu.key)!.far).flatMap((fu) => fu.partners));
	const out = new Map<string, number>();
	const need = lineMetrics(side).tagInset + sideTagDepth(side) + barClear(side);
	for (const fu of g.unions) {
		if (!unions.get(fu.key)!.bar) continue;
		const [a, b] = fu.partners.map((p) => persons.get(p)!);
		const upper = a.x < b.x ? a : b;
		if (tagged.has(upper.id) && need > upper.h / 2) out.set(fu.key, Math.min(need, upper.h - barClear(side)));
	}
	return out;
}

/** D24: the turned layout mirrored into a sideways one, with the tags on the real bottom edges. */
function turnLayout(
	g: FamilyGraph,
	turnedPersons: Map<string, PersonBox>,
	turnedUnions: Map<string, UnionPoint>,
	rows: string[][],
	rowGaps: { top: number; bottom: number }[],
	plan: LinePlan,
	geo: Geometry,
	side: Geometry,
): TreeLayout {
	const persons = new Map<string, PersonBox>();
	for (const b of turnedPersons.values()) persons.set(b.id, turnBox(b));
	const unions = new Map<string, UnionPoint>();
	for (const u of turnedUnions.values()) unions.set(u.key, turnUnion(u));
	const farTags = new Map<string, FarTag>();
	for (const [person, list] of farSpouses(g, unions)) {
		const box = persons.get(person)!;
		const row = rows[box.gen];
		const next = row[row.indexOf(person) + 1];
		const y = box.y + box.h;
		const own = plan.tagZones.get(person)!;
		const span = own.hit ?? own;
		const hit = sideTagHit({ x: box.x + span.x, w: span.w }, y, next === undefined ? Infinity : persons.get(next)!.y, side);
		farTags.set(person, { person, spouses: list, x: box.x + own.x, y, hit, zoneW: own.w });
	}
	// Tag hit areas count too: a tapped spot is always inside the drawing.
	const width = Math.max(
		0,
		...[...persons.values()].map((p) => p.x + p.w),
		...[...plan.dots.keys()].map((k) => unions.get(k)!.x + geo.unionSize / 2),
		...[...farTags.values()].map((t) => t.hit.x + t.hit.w),
	);
	const height = Math.max(
		0,
		plan.maxX + geo.nodeGap / 2,
		...[...persons.values()].map((p) => p.y + p.h),
		...[...farTags.values()].map((t) => Math.max(tagTop(side, t.y) + side.tagH, t.hit.y + t.hit.h)),
	);
	return { persons, unions, rows, rowGaps, farTags, width, height, geometry: side, orientation: 'sideways' };
}
