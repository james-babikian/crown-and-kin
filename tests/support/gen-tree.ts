/*
 * A random generational tree for the relation-name checks of the D131 review rounds (`review-d131b/c/d-checks`):
 * three to five rows of couples with remarriages, listed unions of several types, parent links of every type
 * (birth, rumoured, adoptive, ward), a third parent and cousin marriages. One seed gives one tree on every machine.
 */

import { rng } from './rng';

/** The tree as data: `n` people p0 to p(n-1), their parent links, their listed unions and the generator that is left. */
export interface Gen {
	n: number;
	parents: string[][];
	unions: string[];
	rand: () => number;
}

/** Makes the tree of one seed. */
export function genTree(seed: number): Gen {
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

/** The note text of the tree with the people (and, if given, the unions) in the given order. */
export function yamlOf(gen: Gen, order: number[], unionOrder?: number[]): string {
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
