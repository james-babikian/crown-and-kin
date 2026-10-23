/*
 * G2 review of the second D175 fix round: the checks that held on b490657 (scratch/d131-review3). They
 * pass; they are here so that the next round keeps them. Full runs (scripts, not here):
 * (a) Generational trees of 3 to 5 rows (all link types, third parents, cousin marriages, remarriages),
 *     seeds 1 to 1000, three orders of the people, both settings: blood names 0 differences (f458add 0,
 *     94417fb 17 870); finder half and rumoured flags of blood names 0 (f458add 4); a blood name and its
 *     steps 0 disagreements beside the known "Rumoured half-X" (84 of 61 025; f458add 2 more). Names by
 *     marriage: 4 551 differences (f458add 4 695), all of the known kind (finding 3 of
 *     tests/core/review-d131b-findings.test.ts): with every passed-over pair kept as a line of its name they
 *     go to 0. Blood names equal to f458add on 689 040 pairs. Here 120 seeds.
 * (b) Random trees with cycles, self links and unknown ids: no throw, no hang (1500 seeds; here 300).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type Relation } from '../../src/core/relations';
import { rng } from '../support/rng';
import { genTree, yamlOf } from '../support/gen-tree';

function perm(n: number, rand: () => number): number[] {
	const p = [...Array(n).keys()];
	for (let i = p.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[p[i], p[j]] = [p[j], p[i]];
	}
	return p;
}

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

const blood = (r: readonly Relation[] | undefined) =>
	JSON.stringify(
		(r ?? [])
			.filter((x) => x.kind !== 'by-marriage')
			.map((x) => [x.text, x.maybe?.effect, x.maybe?.cause])
			.sort(),
	);

describe('review D131c (a): blood names, finder flags and steps do not depend on the order of the people (D2)', () => {
	it('120 generational trees, three orders, both settings', () => {
		const bad: string[] = [];
		let pairs = 0;
		for (let seed = 1; seed <= 120 && bad.length < 5; seed++) {
			const gen = genTree(seed);
			const id = [...Array(gen.n).keys()];
			const gs = [id, perm(gen.n, gen.rand), [...id].reverse()].map((o) => graph(yamlOf(gen, o)));
			for (const on of [true, false]) {
				const o = { oneParentUnknown: on };
				for (let m = 0; m < gen.n; m++) {
					const rs = gs.map((g) => computeRelations(g, `p${m}`, o));
					for (let q = 0; q < gen.n; q++) {
						pairs++;
						const a = blood(rs[0].get(`p${q}`));
						for (const r of rs.slice(1)) if (blood(r.get(`p${q}`)) !== a) bad.push(`names seed ${seed} ${on ? 'on' : 'off'} p${m}->p${q}`);
						if ((m * 7 + q) % 5) continue;
						const flags = gs.map((g) => {
							const f = findRelation(g, `p${m}`, `p${q}`, o);
							if (f.kind !== 'named') return f.kind;
							return JSON.stringify(
								f.relations
									.filter((x) => x.relation.kind === 'blood')
									.map((x) => [x.relation.text, x.steps.some((s) => s.word.includes('rumoured')), x.steps.some((s) => s.word.includes('half'))])
									.sort(),
							);
						});
						if (flags[1] !== flags[0] || flags[2] !== flags[0]) bad.push(`flags seed ${seed} ${on ? 'on' : 'off'} p${m}->p${q}: ${flags.join(' / ')}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(pairs).toBeGreaterThan(50_000);
	}, 180_000);
});

describe('review D131c (b): cycles, self links and unknown ids', () => {
	it('300 random trees: no throw, every line can be read', () => {
		let done = 0;
		for (let seed = 1; seed <= 300; seed++) {
			const rand = rng(seed);
			const n = 6 + Math.floor(rand() * 20);
			const types = ['', 'rumoured', 'adoptive', 'ward'];
			const lines: string[] = [];
			for (let i = 0; i < n; i++) {
				const refs: string[] = [];
				for (let j = Math.floor(rand() * 4); j > 0; j--) {
					const r = rand();
					const pid = r < 0.08 ? `ghost${Math.floor(rand() * 3)}` : r < 0.12 ? `p${i}` : `p${Math.floor(rand() * n)}`;
					const t = types[Math.floor(rand() * 4)];
					refs.push(t ? `{id: ${pid}, type: ${t}}` : pid);
				}
				lines.push(`  - {id: p${i}, name: p${i}, sex: ${['m', 'f', 'x'][i % 3]}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`);
			}
			const us: string[] = [];
			for (let k = 0; k < n / 2; k++) us.push(`  - {partners: [${rand() < 0.05 ? 'ghost9' : `p${Math.floor(rand() * n)}`}, p${Math.floor(rand() * n)}]${rand() < 0.3 ? ', type: affair' : ''}}`);
			const g = graph(`people:\n${lines.join('\n')}\nunions:\n${us.join('\n')}\n`);
			for (const on of [true, false]) {
				for (let i = 0; i < n; i++) {
					for (const list of computeRelations(g, `p${i}`, { oneParentUnknown: on }).values()) for (const x of list) expect(x.line.people.length).toBeGreaterThan(0);
					for (let j = 0; j < n; j += 3) findRelation(g, `p${i}`, `p${j}`, { oneParentUnknown: on });
				}
				expect(computeRelations(g, 'ghost0', { oneParentUnknown: on }).size).toBe(0);
				expect(findRelation(g, 'ghost0', 'p0', { oneParentUnknown: on }).kind).toBe('none');
			}
			done++;
		}
		expect(done).toBe(300);
	}, 180_000);
});
