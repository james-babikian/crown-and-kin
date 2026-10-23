import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations } from '../../src/core/relations';
import { relationSummary, spokenRelation } from '../../src/render/tree-info';

// Review U finding 1: the sheet text of `maybe.some` says "If one of the rumoured links is true", but for row 2 of D176 (4)
// (Ada: Mark, ~Xavier, ~Yves; Cal: Mark, ~Xavier) one link is never enough: Ada-Xavier and Cal-Xavier must both be true.

const build = (lines: string[]) => {
	const r = parseDynasty(['people:', ...lines].join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
};
const person = (id: string, sex: string, parents: string[]) => `  - {id: ${id}, name: ${id}, sex: ${sex}${parents.length ? `, parents: [${parents.join(', ')}]` : ''}}`;
const base = ['m', 'x', 'y'].map((p) => person(p, 'm', []));

/** The smallest number of rumoured links that must be true (the others false) for ada and cal to be full sisters. */
function fewestLinks(rumoured: [string, string][], sure: Record<string, string[]>): number {
	let best = Infinity;
	for (let mask = 0; mask < 1 << rumoured.length; mask++) {
		const parents: Record<string, string[]> = { ada: [...sure.ada], cal: [...sure.cal] };
		rumoured.forEach(([child, p], i) => {
			if (mask & (1 << i)) parents[child].push(p);
		});
		const g = build([...base, person('ada', 'f', parents.ada), person('cal', 'f', parents.cal)]);
		const rel = computeRelations(g, 'ada', { oneParentUnknown: true }).get('cal')![0];
		if (rel.text === 'Sister') best = Math.min(best, [...Array(rumoured.length).keys()].filter((i) => mask & (1 << i)).length);
	}
	return best;
}

describe('review U: the sheet text of maybe.some', () => {
	it('row 2 (Ada: Mark, ~Xavier, ~Yves; Cal: Mark, ~Xavier): the sheet must not say that one link is enough', () => {
		const g = build([...base, person('ada', 'f', ['m', '{id: x, type: rumoured}', '{id: y, type: rumoured}']), person('cal', 'f', ['m', '{id: x, type: rumoured}'])]);
		const rels = computeRelations(g, 'ada', { oneParentUnknown: true }).get('cal')!;
		expect(rels[0].maybe?.some).toBe(true);
		const needed = fewestLinks([['ada', 'x'], ['ada', 'y'], ['cal', 'x']], { ada: ['m'], cal: ['m'] });
		expect(needed).toBe(2);
		const sheet = relationSummary(rels, false).maybe!;
		// One link is not enough, so the text "If one of the rumoured links is true" is false.
		expect(sheet).not.toMatch(/one of the rumoured links/);
		expect(spokenRelation(rels[0])).not.toMatch(/if a rumoured link is true/);
	});
});
