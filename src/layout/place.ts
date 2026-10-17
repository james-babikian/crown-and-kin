/*
 * The placement stage (the architecture notes §4.2.2, stage S3). It gives every item of the plan an x: rows of rigid blocks, packed in order
 * (`packRows`), then rounds of "parents over children, children under parents" (pool-adjacent-violators per row, as the 0.3.0 sweeps:
 * `sweepRows`), then the compaction step of `compact.ts` run on the items (`compactStep`; passages are zero-height members of
 * their blocks, with a width), then `normalise`. The hang point of every family is a port or a bar dot, so the placement centres the children
 * under the point the route stage draws. The route stage works with ANY placement that keeps the order and the minimum gaps
 * (assumption A16); `placeItems` is one such placement, composed of the exported steps, and the tests compose others from them.
 * It writes `Item.x` and nothing else.
 */
import type { FamilyGraph } from '../core/derive';
import { compactor } from './compact';
import { foldExtent } from './fold-spots';
import { DEFAULT_LAYOUT_SETTINGS } from './layout';
import { isRoundel, lineMetrics } from './geometry';
import type { Geometry } from './model';
import { placeInOrder } from './pava';
import { portX, type Family, type Hang, type Plan } from './plan-model';

/** Several signs on one bar are spread at most this many sign sizes apart where the gap allows, never less than one (as in 0.3.0). */
const BAR_SPREAD_MAX = 2;

/** The x of a hang point for the current item positions. */
export function hangX(h: Hang, geo: Geometry): number {
	if (h.kind === 'port') return portX(h.port);
	const gap = h.right.x - h.left.x - h.left.w;
	const step = h.count > 1 ? Math.min(BAR_SPREAD_MAX * geo.unionSize, Math.max(geo.unionSize, (gap - geo.unionSize) / (h.count - 1))) : 0;
	return (h.left.x + h.left.w + h.right.x) / 2 + (h.slot - (h.count - 1) / 2) * step;
}

/** The block that carries a hang point. */
const hangBlock = (h: Hang): number => (h.kind === 'port' ? h.port.item.block : h.left.block);

/** The rigid shape of every block: each item's offset from the block's first item, the block's width, and the row's minimum left-to-left distances. */
export interface Shapes {
	offset: Map<string, number>;
	width: number[];
	/** Moves block `bi` so that its first item starts at `x`. */
	setLeft: (bi: number, x: number) => void;
	/** The smallest distance from each block's left to the previous block's left in row `r` (0 for the first). */
	rowMin: (r: number) => number[];
}

/** Reads the shapes of the blocks from the plan's minimum gaps. */
export function shapesOf(plan: Plan): Shapes {
	const { blocks, rowBlocks, minGap } = plan;
	const offset = new Map<string, number>();
	const width = blocks.map(() => 0);
	rowBlocks.forEach((list, r) => {
		for (const bi of list) {
			let at = 0;
			blocks[bi].forEach((it, i) => {
				if (i) at += minGap[r][it.at];
				offset.set(it.id, at);
			});
			width[bi] = at;
		}
	});
	const setLeft = (bi: number, x: number) => {
		for (const it of blocks[bi]) it.x = x + offset.get(it.id)!;
	};
	const rowMin = (r: number): number[] => rowBlocks[r].map((bi, i) => (i === 0 ? 0 : width[rowBlocks[r][i - 1]] + minGap[r][blocks[bi][0].at]));
	return { offset, width, setLeft, rowMin };
}

/** Packed rows: every block at its smallest distance from the one before, in order. */
export function packRows(plan: Plan, shapes = shapesOf(plan)): void {
	for (let r = 0; r < plan.rows.length; r++) {
		const mins = shapes.rowMin(r);
		let x = 0;
		plan.rowBlocks[r].forEach((bi, i) => {
			x += mins[i];
			shapes.setLeft(bi, x);
		});
	}
}

/** The families that have a shown child, grouped by the row of their children and by the block of their hang point. */
function familiesByRowAndBlock(plan: Plan): { byRow: Family[][]; byBlock: Family[][] } {
	// A folded family has no shown child: nothing to centre.
	const withKids = plan.families.filter((f) => f.kids.length);
	const byRow: Family[][] = plan.rows.map(() => []);
	for (const f of withKids) byRow[plan.items.get(f.kids[0])!.row].push(f);
	const byBlock: Family[][] = plan.blocks.map(() => []);
	for (const f of withKids) byBlock[hangBlock(f.hang)].push(f);
	return { byRow, byBlock };
}

/** The sweeps: `rounds` rounds of an up sweep (parents over their children) and a down sweep (children under their hang point), each row kept in order by pool-adjacent-violators. */
export function sweepRows(plan: Plan, geo: Geometry, rounds: number, shapes = shapesOf(plan)): void {
	const { blocks, rowBlocks } = plan;
	const R = plan.rows.length;
	const leftOf = (bi: number) => blocks[bi][0].x;
	const placeRow = (r: number, targets: number[]) => {
		const xs = placeInOrder(targets, shapes.rowMin(r));
		rowBlocks[r].forEach((bi, i) => shapes.setLeft(bi, xs[i]));
	};
	const centre = (id: string) => {
		const it = plan.items.get(id)!;
		return it.x + it.w / 2;
	};
	/** The middle of the stretch the children span. */
	const span = (ids: string[]) => {
		let lo = Infinity;
		let hi = -Infinity;
		for (const id of ids) {
			const c = centre(id);
			lo = Math.min(lo, c);
			hi = Math.max(hi, c);
		}
		return (lo + hi) / 2;
	};
	const { byRow, byBlock } = familiesByRowAndBlock(plan);
	const downSweep = () => {
		for (let r = 1; r < R; r++) {
			const targets = rowBlocks[r].map(leftOf);
			const index = new Map(rowBlocks[r].map((bi, i) => [bi, i]));
			for (const f of byRow[r]) {
				const shift = hangX(f.hang, geo) - span(f.kids);
				for (const b of new Set(f.kids.map((k) => plan.items.get(k)!.block))) targets[index.get(b)!] += shift;
			}
			placeRow(r, targets);
		}
	};
	const upSweep = () => {
		for (let r = R - 2; r >= 0; r--) {
			const targets = rowBlocks[r].map((bi) => {
				let sum = 0;
				let weight = 0;
				for (const f of byBlock[bi]) {
					sum += f.kids.length * (span(f.kids) - hangX(f.hang, geo));
					weight += f.kids.length;
				}
				return leftOf(bi) + (weight ? sum / weight : 0);
			});
			placeRow(r, targets);
		}
	};
	for (let i = 0; i < rounds; i++) {
		upSweep();
		downSweep();
	}
}

/**
 * The compaction step on the items (the architecture notes §4.2). `compactor` reads the items through `Placed`: a passage is a card of its block with
 * its own width; the gaps are centre distances; the dots are the hang points of the union families. Returns how many of the three
 * passes spent their whole walk budget (0 on every real tree). `snaps` limits part (c) to that many snaps, for the test of that part.
 */
export function compactStep(plan: Plan, g: FamilyGraph, geo: Geometry, snaps = Infinity): number {
	const blocks = plan.blocks.map((b) => b.map((it) => it.id));
	const withKids = plan.families.filter((f) => f.kids.length);
	// A family of one parent alone hangs from the item that carries its hang point, so the step reads that item and the port's x.
	const anchors = new Map(plan.anchors);
	for (const f of withKids) if (!f.union) anchors.set(f.key, f.hang.kind === 'port' ? f.hang.port.item.id : f.anchor);
	const step = compactor(g, anchors, plan.items, blocks, plan.rowBlocks, withKids.map((f) => f.kids), isRoundel(geo) ? undefined : lineMetrics(geo).tagInset);
	// Centre-to-centre distances of consecutive items of a row (the first is 0), as `placeRow` records them.
	const gaps = plan.rows.map((row, r) => row.map((it, i) => (i === 0 ? 0 : plan.minGap[r][i] - row[i - 1].w / 2 + it.w / 2)));
	const dots = new Map<string, number>();
	for (const f of withKids) dots.set(f.union ?? f.key, hangX(f.hang, geo));
	return step(gaps, dots, snaps);
}

/** Moves every item so that the leftmost one starts at `margin` (0 by default). */
export function normalise(plan: Plan, margin = 0): void {
	let min = Infinity;
	for (const it of plan.items.values()) min = Math.min(min, it.x);
	if (!Number.isFinite(min)) return;
	for (const it of plan.items.values()) it.x += margin - min;
}

/**
 * Spec §13.10 (F5b): the room a fold control needs left of its stem, beyond the leftmost item: its largest mark and its hit area can
 * reach left of the first card. The caller normalises the items to this margin, so nothing is shifted after the drawing. Above the
 * first row no control can reach: a control hangs below its parents' cards.
 */
export function foldMargin(plan: Plan, geo: Geometry, side: Geometry | undefined): number {
	let margin = 0;
	let left = Infinity;
	for (const it of plan.items.values()) left = Math.min(left, it.x);
	for (const f of plan.families) {
		if (!f.control) continue;
		// The extent across the stem, in the working frame: along x top to bottom; sideways the real frame's y, turned.
		const r = side ? foldExtent(f.control, { x: 0, y: 0 }, geo.fontPx, true) : foldExtent(f.control, { x: 0, y: 0 }, geo.fontPx);
		const reach = side ? -r.y : -r.x;
		margin = Math.max(margin, reach - (hangX(f.hang, geo) - left));
	}
	return margin;
}

/**
 * The room the first card of a row needs before it along the row (the stack axis sideways): the fold controls' (`foldMargin`) and, sideways,
 * the `reach` for the tab above the first card of a stack (the 0.3.0 rule: "the first card of a stack starts `reach` in"). Down, the reach is
 * above the first row (the route stage), not before the first card.
 */
export function startMargin(plan: Plan, geo: Geometry, side: Geometry | undefined): number {
	return Math.max(foldMargin(plan, geo, side), side ? (geo.reach ?? 0) : 0);
}

/** The configuration of the placement: the number of sweep rounds (`LayoutSettings.sweeps`; 0 keeps the packed rows, as today) and whether the compaction step runs (D231; on by default). */
export interface PlaceOptions {
	sweeps?: number;
	compact?: boolean;
}

/** Today's placement: packed rows, the sweeps, the compaction step (when `sweeps` is at least 1, as today), then the items normalised. */
export function placeItems(plan: Plan, g: FamilyGraph, geo: Geometry, opts: PlaceOptions = {}): void {
	const sweeps = opts.sweeps ?? DEFAULT_LAYOUT_SETTINGS.sweeps;
	const shapes = shapesOf(plan);
	packRows(plan, shapes);
	if (sweeps >= 1) {
		sweepRows(plan, geo, sweeps, shapes);
		if (opts.compact !== false) compactStep(plan, g, geo);
	}
	normalise(plan);
}
