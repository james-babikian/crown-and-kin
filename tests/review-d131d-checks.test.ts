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
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, lineSubgraph } from '../src/core/relations';

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
