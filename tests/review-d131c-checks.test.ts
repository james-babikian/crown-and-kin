/*
 * G2 review of the second D175 fix round: the checks that held on b490657 (scratch/d131-review3). They
 * pass; they are here so that the next round keeps them. Full runs (scripts, not here):
 * (a) Generational trees of 3 to 5 rows (all link types, third parents, cousin marriages, remarriages),
 *     seeds 1 to 1000, three orders of the people, both settings: blood names 0 differences (f458add 0,
 *     94417fb 17 870); finder half and rumoured flags of blood names 0 (f458add 4); a blood name and its
 *     steps 0 disagreements beside the known "Rumoured half-X" (84 of 61 025; f458add 2 more). Names by
 *     marriage: 4 551 differences (f458add 4 695), all of the known kind (finding 3 of
 *     tests/review-d131b-findings.test.ts): with every passed-over pair kept as a line of its name they
 *     go to 0. Blood names equal to f458add on 689 040 pairs. Here 120 seeds.
 * (b) Random trees with cycles, self links and unknown ids: no throw, no hang (1500 seeds; here 300).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, type Relation } from '../src/core/relations';

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


interface Gen {
	n: number;
	parents: string[][];
	unions: string[];
	rand: () => number;
}

function genTree(seed: number): Gen {
	const rand = rng(seed);
	const gens = 3 + Math.floor(rand() * 3);
	const rows: number[][] = [];
	const couplesByRow: [number, number][][] = [];
	const parents: string[][] = [];
	const unions: string[] = [];
	let n = 0;
	const pick = <V>(a: V[]) => a[Math.floor(rand() * a.length)];
	const t = () => {
		const r = rand();
		return r < 0.55 ? '' : r < 0.8 ? ':rumoured' : r < 0.93 ? ':adoptive' : ':ward';
	};
	for (let g = 0; g < gens; g++) {
		const w = 3 + Math.floor(rand() * 4);
		const row: number[] = [];
		for (let k = 0; k < w; k++) {
			const i = n++;
			row.push(i);
			const ps: string[] = [];
			if (g > 0) {
				const cs = rand() < 0.15 && g > 1 ? [...couplesByRow[g - 1], ...couplesByRow[g - 2]] : couplesByRow[g - 1];
				const [a, b] = pick(cs);
				const r = rand();
				if (r < 0.1) ps.push(`p${a}${t()}`);
				else if (r < 0.15) ps.push(`p${b}${t()}`);
				else if (r < 0.95) {
					ps.push(`p${a}${t()}`, `p${b}${t()}`);
					if (rand() < 0.3) ps.reverse();
				}
				if (rand() < 0.12) {
					const c = pick(g > 1 ? [...rows[g - 1], ...rows[g - 2]] : rows[g - 1]);
					if (c !== a && c !== b) ps.push(`p${c}:${rand() < 0.8 ? 'rumoured' : 'adoptive'}`);
				}
			}
			parents.push(ps);
		}
		rows.push(row);
		const cs: [number, number][] = [];
		const nc = 2 + Math.floor(rand() * 3);
		for (let k = 0; k < nc; k++) {
			let a: number;
			let b: number;
			if (k > 0 && rand() < 0.3) {
				a = cs[k - 1][Math.floor(rand() * 2)];
				b = pick(row);
			} else {
				a = pick(row);
				b = pick(row);
			}
			if (a === b) b = row[(row.indexOf(a) + 1) % row.length];
			if (a === b) continue;
			cs.push([a, b]);
			if (rand() < 0.6) unions.push(`  - {partners: [p${a}, p${b}]${rand() < 0.8 ? '' : `, type: ${pick(['affair', 'betrothal', 'concubinage'])}`}}`);
		}
		couplesByRow.push(cs);
	}
	return { n, parents, unions, rand };
}

function yamlOf(gen: Gen, order: number[], unionOrder?: number[]): string {
	const lineOf = (i: number) => {
		const refs = gen.parents[i].map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		return `  - {id: p${i}, name: p${i}, sex: ${['m', 'f', 'x'][i % 3]}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`;
	};
	const us = unionOrder ? unionOrder.map((k) => gen.unions[k]) : gen.unions;
	return `people:\n${order.map(lineOf).join('\n')}\n${us.length ? `unions:\n${us.join('\n')}\n` : ''}`;
}

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
