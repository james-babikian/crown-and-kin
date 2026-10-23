// The one rule of the fork (D228 idea 1, spec §5.1 step 5d, spec §10 "Version 0.3.1"): the two suite checks `lineProblems` (down: tests/support/random-trees.ts, sideways:
// tests/acceptance/sideways-checks.ts) report two families that share a stretch of line, and the fork shares a stretch by design. This file says
// exactly which share is the fork, so both checks exempt that and nothing else. An internal test proves with mutants that no
// other share is let through.
import type { EdgePath } from '../../src/layout/model';

/** A straight piece of a line. */
export interface ForkSeg {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

const COUPLE = new Set(['marriage', 'betrothal', 'concubinage', 'affair', 'implicit']);

/** How near two points are when the legs "leave the card at one point". */
const SAME_POINT = 0.05;

/**
 * True when the share of piece `ai` of line `a` and piece `bi` of line `b` is the fork: the two lines are legs of ONE person (each names that one
 * parent); of the SAME kind (a betrothal and a marriage of one couple keep two ports and two styles); they leave the card at the same point (one
 * port, so the same side of the card and the same gap); and the shared stretch is the first piece of both (the stem above the part). Any other
 * share, a piece below the part included, is a fault. The side a leg is for (its partner on the left or the right, or the side of its passage) is
 * the plan's business and is tested there (`layout-stage-ports`): from the drawing the shared start point is all that shows it.
 */
export function isForkShare(a: Pick<EdgePath, 'kind' | 'parents'>, b: Pick<EdgePath, 'kind' | 'parents'>, aSegs: readonly ForkSeg[], bSegs: readonly ForkSeg[], ai: number, bi: number): boolean {
	if (ai !== 0 || bi !== 0 || !COUPLE.has(a.kind) || a.kind !== b.kind) return false;
	if (a.parents?.length !== 1 || b.parents?.length !== 1 || a.parents[0] !== b.parents[0]) return false;
	const p = aSegs[0];
	const q = bSegs[0];
	return !!p && !!q && Math.abs(p.x1 - q.x1) <= SAME_POINT && Math.abs(p.y1 - q.y1) <= SAME_POINT;
}
