/*
 * The engine of the succession walks. The line is built from passes: the illegitimacy passes outside, the sex passes inside. Each pass
 * has its own climb, walk and sort (`succession-pass.ts`); everything that does not depend on the pass is made once (`succession-ctx.ts`).
 * `successionLine` builds the state with `makeContext`, calls `makeEngine` and asks it for the line, the people left out for want of a sex, the state of the first-holder switch
 * and the notes of the walks.
 */

import { mergeItems, type EngineCtx, type Item, type PassInherit } from './succession-ctx';
import { makePass } from './succession-pass';
import type { SuccessionNote } from './succession-types';

/** What the rest of `successionLine` needs from the walks. */
export interface Engine {
	line(): Item[];
	leftOutNoSex(inLine: ReadonlySet<string>): number;
	outsideBody(): boolean;
	/** The notes of the walks: D202 order notes, S3; only for people in the shown line (`shown`). */
	notes(shown: ReadonlySet<string>): SuccessionNote[];
}

/** The line of one sex pass: a house form runs two passes, the preferred sex only, then both sexes with that sex first. */
function sexPasses(e: EngineCtx, illOn: boolean): Item[] {
	const inherit = e.spec.inherit;
	const house = inherit === 'men-first-in-house' ? 'men' : inherit === 'women-first-in-house' ? 'women' : undefined;
	if (house === undefined) return makePass(e, illOn, inherit as PassInherit);
	const only = makePass(e, illOn, `${house}-only`);
	return mergeItems(only, makePass(e, illOn, `${house}-first`));
}

/** The notes of the walks for the people in the shown line. */
function walkNotes(e: EngineCtx, shown: ReadonlySet<string>): SuccessionNote[] {
	const out: SuccessionNote[] = [];
	// S3: a parent with no start year, when some of the children are in the shown line.
	for (const [parent, kids] of e.noFrom) {
		if (kids.some((id) => shown.has(id))) out.push({ kind: 'born-in-reign-no-from', params: { parent } });
	}
	// D202: a break shows for the people it names; a pair inside a break is part of that note.
	const inLoop = new Set<string>();
	for (const people of e.loops.values()) {
		if (people.filter((id) => shown.has(id)).length < 2) continue;
		out.push({ kind: 'order-contradiction', params: { people } });
		for (const id of people) inLoop.add(id);
	}
	for (const [a, b, same] of e.pairs.values()) {
		if (shown.has(a) && shown.has(b) && !(inLoop.has(a) && inLoop.has(b))) out.push({ kind: 'order-from-note', params: same ? { a, b, reason: 'same-year' } : { a, b } });
	}
	return out;
}

/** The walks of one line, over the state that `makeContext` built. */
export function makeEngine(e: EngineCtx): Engine {
	const { spec, body } = e;
	return {
		// `after` is the line without the flagged people, then the line with them.
		line: () => (spec.illegitimate === 'after' ? mergeItems(sexPasses(e, false), sexPasses(e, true)) : sexPasses(e, spec.illegitimate === 'equal')),
		// A person that another pass put in the line (the second pass of a house form) is not left out.
		outsideBody: () => body !== undefined && e.lapsed > 0 && e.reached === 0,
		leftOutNoSex: (inLine) => {
			let n = 0;
			for (const id of e.noSex) if (!inLine.has(id)) n++;
			return n;
		},
		notes: (shown) => walkNotes(e, shown),
	};
}
