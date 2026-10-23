/*
 * G2 check of the third D175 fix round (0b61282; scratch/d131-review3). It passes; it is here so that later
 * rounds keep it. `forget` drops the other lines of a candidate after its person's names are made: a line
 * read late (after more calls on the same graph) must equal the line of a fresh call. Full runs (scripts):
 * names, maybes, causes, lines (read late, second result first), finder results and lineSubgraph of 0b61282
 * equal a0725d8 on fixtures 01 to 15, seeds 1 to 1000 (three orders, both settings; 3000 trees, 4.9 million
 * output lines) and 6000 oracle trees; path calls, searches and second tests unchanged; memory kept by one
 * result as on 6860002 (dense birth 4.4 MB, rumoured 4.7 MB, 2000 people 17.9 MB, fixture 7 0.8 MB).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, lineSubgraph } from '../../src/core/relations';
import { genTree, yamlOf } from '../support/gen-tree';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

describe('review D131d: lines read late, after more calls on one graph, equal a fresh call', () => {
	it('60 generational trees, both settings', () => {
		const bad: string[] = [];
		let read = 0;
		for (let seed = 1; seed <= 60 && bad.length < 5; seed++) {
			const gen = genTree(seed);
			const y = yamlOf(gen, [...Array(gen.n).keys()]);
			const g = graph(y);
			for (const on of [true, false]) {
				const o = { oneParentUnknown: on };
				const kept = [...Array(gen.n).keys()].map((m) => computeRelations(g, `p${m}`, o));
				const again = [...Array(gen.n).keys()].map((m) => computeRelations(g, `p${m}`, o));
				for (let m = 0; m < gen.n; m += 2) for (let q = 0; q < gen.n; q += 3) findRelation(g, `p${m}`, `p${q}`, o);
				const fresh = graph(y);
				for (let m = gen.n - 1; m >= 0; m--) {
					const ref = computeRelations(fresh, `p${m}`, o);
					for (const res of [again[m], kept[m]])
						for (const [p, list] of res) {
							const want = ref.get(p)!;
							list.forEach((r, k) => {
								read++;
								if (JSON.stringify([r.text, r.maybe, r.line]) !== JSON.stringify([want[k].text, want[k].maybe, want[k].line])) bad.push(`seed ${seed} ${on} p${m}->${p} "${r.text}"`);
								const sub = lineSubgraph(g, r.line);
								if (!r.line.people.every((id) => sub.byId.has(id))) bad.push(`subgraph seed ${seed} p${m}->${p}`);
							});
						}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(read).toBeGreaterThan(50_000);
	}, 180_000);
});
