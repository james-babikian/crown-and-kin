import type { FamilyGraph } from '../src/core/derive';
import type { EdgeDrawing, Rect, TreeLayout } from '../src/layout/model';
import { legCrossings } from './layout-legs';

export interface LayoutMetrics {
	people: number;
	generations: number;
	/** Couples in the same generation drawn side by side / all couples in the same generation. */
	couplesAdjacent: number;
	couplesSameRow: number;
	/** Families whose children are not left-to-right in document order (must be 0). */
	siblingOrderViolations: number;
	/** Crossings between parent→child drops of adjacent generations (a readability proxy). */
	crossings: number;
	/**
	 * D303 (0.5): crossings that the legs of couples on two rows make with the lines of other families, straight lines and side-link curves both
	 * (`legCrossings`, scripts/layout-legs.ts). `crossings` above does not count couple lines and its meaning does not change. Present only
	 * when the drawn lines are given to `measureLayout`.
	 */
	legCrossings?: number;
	width: number;
	height: number;
}

/** The metrics of a finished layout; pass its `edges` too to get `legCrossings`. */
export function measureLayout(g: FamilyGraph, layout: TreeLayout, edges?: EdgeDrawing): LayoutMetrics {
	const box = (id: string) => layout.persons.get(id)!;
	// Positions along a generation: x in rows, y in sideways columns (D24).
	const side = layout.orientation === 'sideways';
	const along = (r: Rect) => (side ? r.y : r.x);
	const mid = (r: Rect) => (side ? r.y + r.h / 2 : r.x + r.w / 2);
	const dot = (key: string) => (side ? layout.unions.get(key)!.y : layout.unions.get(key)!.x);
	let couplesAdjacent = 0;
	let couplesSameRow = 0;
	for (const fu of g.unions) {
		const [a, b] = fu.partners.map(box);
		if (a.gen !== b.gen) continue;
		couplesSameRow++;
		if (layout.unions.get(fu.key)!.bar) couplesAdjacent++;
	}

	let siblingOrderViolations = 0;
	for (const kids of [...g.unions.map((u) => u.children), ...g.soloChildren.values()]) {
		const xs = kids.map((k) => along(box(k)));
		if (xs.some((x, i) => i > 0 && x < xs[i - 1])) siblingOrderViolations++;
	}

	// Segments from a parent anchor to a child one generation down.
	const segs = new Map<number, [number, number][]>();
	const add = (gen: number, top: number, bottom: number) => {
		const arr = segs.get(gen) ?? [];
		arr.push([top, bottom]);
		segs.set(gen, arr);
	};
	for (const fu of g.unions) for (const c of fu.children) add(box(c).gen, dot(fu.key), mid(box(c)));
	for (const [p, kids] of g.soloChildren) for (const c of kids) add(box(c).gen, mid(box(p)), mid(box(c)));
	let crossings = 0;
	for (const list of segs.values()) {
		for (let i = 0; i < list.length; i++) {
			for (let j = i + 1; j < list.length; j++) {
				const [t1, b1] = list[i];
				const [t2, b2] = list[j];
				if ((t1 - t2) * (b1 - b2) < 0) crossings++;
			}
		}
	}

	return {
		people: layout.persons.size,
		generations: layout.rows.length,
		couplesAdjacent,
		couplesSameRow,
		siblingOrderViolations,
		crossings,
		...(edges ? { legCrossings: legCrossings(g, layout, edges) } : {}),
		width: Math.round(layout.width),
		height: Math.round(layout.height),
	};
}
