/*
 * G2 review of the second D175 fix round (scratch branch scratch/d131-review3, on sibling-labels b490657).
 * Proof of the finding; the test fails on b490657 and passes on f458add and 6860002.
 * 1. Memory: each name of a `computeRelations` result keeps its blood candidate alive (the lazy line),
 *    and since 4528323 the candidate keeps `also` (every candidate joined into it, and their own `also`
 *    again, so with repeats) and `maybeFrom`. These are needed only while the names are computed. On
 *    the 400-person dense tree of tests/d123-relations-maybe.test.ts (birth links only, no rumour) one
 *    result keeps about 14.2 MB (f458add 4.3 MB, 6860002 4.1 MB); with a rumoured link on every person
 *    14.5 MB (f458add 4.7 MB); on a 2000-person tree of the same kind (10 rows of 200) 103 MB
 *    (f458add 17.8 MB). The plugin keeps 8 results (`RELATION_CACHE_SIZE`). Fixture 7 is unchanged
 *    (0.8 MB). The same tree takes 10 to 16 % longer than on 6860002 with the same path searches.
 */

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations } from '../src/core/relations';

function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The dense tree of tests/d123-relations-maybe.test.ts "timing": `gens` rows of `width`, each person a child of a couple of the row above. */
function dense(second: 'rumoured' | 'birth', gens = 10, width = 40): FamilyGraph {
	const rand = rng(77);
	const out = ['people:'];
	for (let g = 0; g < gens; g++) {
		for (let i = 0; i < width; i++) {
			const id = `n${g}x${i}`;
			const sex = i % 2 ? 'f' : 'm';
			if (g === 0) {
				out.push(`  - {id: ${id}, name: ${id}, sex: ${sex}}`);
				continue;
			}
			const couple = Math.floor(rand() * (width / 2));
			const a1 = `n${g - 1}x${couple * 2}`;
			const a2 = `n${g - 1}x${couple * 2 + 1}`;
			out.push(`  - {id: ${id}, name: ${id}, sex: ${sex}, parents: [${a1}, ${second === 'rumoured' ? `{id: ${a2}, type: rumoured}` : a2}]}`);
		}
	}
	const r = parseDynasty(out.join('\n') + '\n');
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Heap in bytes kept by one `computeRelations` result (mean of 5 kept results, after full collections). */
function retainedPerResult(g: FamilyGraph, me: string): number {
	setFlagsFromString('--expose-gc');
	const gc = runInNewContext('gc') as () => void;
	const collect = () => {
		for (let k = 0; k < 3; k++) gc();
	};
	computeRelations(g, me);
	collect();
	const before = process.memoryUsage().heapUsed;
	const keep: unknown[] = [];
	for (let k = 0; k < 5; k++) keep.push(computeRelations(g, me));
	collect();
	const after = process.memoryUsage().heapUsed;
	expect(keep).toHaveLength(5);
	return (after - before) / 5;
}

describe('review D131c finding 1: a relation result keeps no candidates it no longer needs', () => {
	it('400 people, birth links only: one result keeps at most 7 MB (f458add 4.3 MB, b490657 14.2 MB)', () => {
		const bytes = retainedPerResult(dense('birth'), 'n9x0');
		console.log(`dense birth tree, 400 people: ${(bytes / 1024 / 1024).toFixed(1)} MB per result`);
		expect(bytes).toBeLessThan(7 * 1024 * 1024);
	}, 60_000);

	it('400 people, a rumoured link on every person: one result keeps at most 7 MB (f458add 4.7 MB, b490657 14.5 MB)', () => {
		const bytes = retainedPerResult(dense('rumoured'), 'n9x0');
		console.log(`dense rumoured tree, 400 people: ${(bytes / 1024 / 1024).toFixed(1)} MB per result`);
		expect(bytes).toBeLessThan(7 * 1024 * 1024);
	}, 60_000);
});
