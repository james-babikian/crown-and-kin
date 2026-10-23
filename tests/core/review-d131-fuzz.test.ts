/*
 * G2 review of D175: fuzz and oracle (scratch branch scratch/d131-review).
 * (a) Generational trees of 3 to 5 rows with rumoured and adoptive links, a third rumoured parent and
 *     cousin marriages, written in two orders of the people (D2), both settings. Seeds 43, 233 and 275
 *     (setting off) give other names in the second order on sibling-labels 6860002 and the same names
 *     on f60ebcf: finding 1 of tests/layout/review-d131-findings.test.ts. Seeds 1 to 400 were run; no other seed differs.
 * (b) An oracle of spec §13.1 "Double" with D175: couples x+z (some share a man or a woman), children
 *     that list x and z (z sure or rumoured), and two grandchildren. "Double" iff two full first-cousin
 *     lines of one word come from two different couples. Passes on 3000 seeds, both settings, both directions
 *     (fails on f60ebcf, which had the false "double" that D175 removes).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, type Relation } from '../../src/core/relations';
import { rng } from '../support/rng';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

/** Generational tree: rows of people; each child picks a couple from the row above (or a cousin pair), sometimes a third rumoured parent. */
function genTree(seed: number) {
	const rand = rng(seed);
	const gens = 3 + Math.floor(rand() * 3);
	const rows: number[][] = [];
	const parents: string[][] = [];
	let n = 0;
	for (let g = 0; g < gens; g++) {
		const w = g === 0 ? 3 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 4);
		const row: number[] = [];
		for (let k = 0; k < w; k++) {
			const i = n++;
			row.push(i);
			const ps: string[] = [];
			if (g > 0) {
				const above = rows[g - 1];
				const pool = rand() < 0.2 && g > 1 ? [...above, ...rows[g - 2]] : above;
				// a "couple": two people of the pool, re-used often to make siblings
				const a = pool[Math.floor(rand() * pool.length)];
				let b = pool[Math.floor(rand() * pool.length)];
				if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
				const t = () => {
					const r = rand();
					return r < 0.6 ? '' : r < 0.9 ? ':rumoured' : ':adoptive';
				};
				if (rand() < 0.9) ps.push(`p${a}${t()}`);
				if (rand() < 0.8 && b !== a) ps.push(`p${b}${t()}`);
				if (rand() < 0.12) {
					const c = pool[Math.floor(rand() * pool.length)];
					if (c !== a && c !== b) ps.push(`p${c}:rumoured`);
				}
			}
			parents.push(ps);
		}
		rows.push(row);
	}
	return { n, parents, rand };
}

function yamlOf(parents: string[][], order: number[], shuffleParents?: () => number) {
	const lineOf = (i: number) => {
		let ps = parents[i];
		if (shuffleParents) {
			ps = [...ps];
			for (let k = ps.length - 1; k > 0; k--) {
				const j = Math.floor(shuffleParents() * (k + 1));
				[ps[k], ps[j]] = [ps[j], ps[k]];
			}
		}
		const refs = ps.map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		return `  - {id: p${i}, name: p${i}, sex: ${i % 2 ? 'f' : 'm'}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`;
	};
	return 'people:\n' + order.map(lineOf).join('\n') + '\n';
}


interface Kid {
	id: string;
	couple: number;
	zType: 'birth' | 'rumoured';
	zFirst: boolean;
}

function caseOf(seed: number) {
	const rand = rng(seed);
	const k = 2 + Math.floor(rand() * 2);
	const couples: [string, string][] = [];
	for (let j = 0; j < k; j++) {
		const r = rand();
		// a shared man or a shared woman with the couple before
		const x = j > 0 && r < 0.25 ? couples[j - 1][0] : `x${j}`;
		const z = j > 0 && r >= 0.25 && r < 0.4 ? couples[j - 1][1] : `z${j}`;
		couples.push([x, z]);
	}
	const kids: Kid[] = [];
	for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) kids.push({ id: `k${i}`, couple: Math.floor(rand() * k), zType: rand() < 0.4 ? 'rumoured' : 'birth', zFirst: rand() < 0.3 });
	const pick = [...kids.keys()];
	for (let i = pick.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[pick[i], pick[j]] = [pick[j], pick[i]];
	}
	const mP = [kids[pick[0]], kids[pick[1]]];
	const pP = [kids[pick[2]], kids[pick[3]]];
	const t = () => (rand() < 0.3 ? 'rumoured' : 'birth');
	const mT = [t(), t()];
	const pT = [t(), t()];
	const founders = [...new Set(couples.flat())];
	const ref = (id: string, type: string) => (type === 'birth' ? id : `{id: ${id}, type: ${type}}`);
	const lines = founders.map((f) => `  - {id: ${f}, name: ${f}, sex: ${f.startsWith('x') ? 'm' : 'f'}}`);
	for (const kd of kids) {
		const [x, z] = couples[kd.couple];
		const refs = [ref(x, 'birth'), ref(z, kd.zType)];
		if (kd.zFirst) refs.reverse();
		lines.push(`  - {id: ${kd.id}, name: ${kd.id}, sex: ${rand() < 0.5 ? 'm' : 'f'}, parents: [${refs.join(', ')}]}`);
	}
	lines.push(`  - {id: me, name: Me, sex: f, parents: [${ref(mP[0].id, mT[0])}, ${ref(mP[1].id, mT[1])}]}`);
	lines.push(`  - {id: pp, name: Pp, sex: f, parents: [${ref(pP[0].id, pT[0])}, ${ref(pP[1].id, pT[1])}]}`);
	// Oracle (spec §13.1 Double, D175): full first-cousin lines, by word, with their couple.
	const full: { word: string; couple: string; pair: string }[] = [];
	for (let a = 0; a < 2; a++)
		for (let b = 0; b < 2; b++) {
			const [u, v] = [mP[a], pP[b]];
			if (u.couple !== v.couple && couples[u.couple].join() !== couples[v.couple].join()) continue;
			const allBirth = mT[a] === 'birth' && pT[b] === 'birth' && u.zType === 'birth' && v.zType === 'birth';
			full.push({ word: allBirth ? 'birth' : 'rumoured', couple: [...couples[u.couple]].sort().join('+'), pair: `${u.id}/${v.id}` });
		}
	const dbl = (w: string) => new Set(full.filter((f) => f.word === w).map((f) => f.couple)).size >= 2;
	const want: string[] = [];
	if (dbl('birth')) want.push('Double first cousin');
	if (dbl('rumoured')) want.push('Rumoured double first cousin');
	return { yaml: `people:\n${lines.join('\n')}\n`, want, full };
}


const fmt = (r: readonly Relation[] | undefined) => JSON.stringify((r ?? []).map((x) => [x.text, x.maybe?.effect, x.maybe?.cause]).sort());

function mismatches(seed: number, on: boolean): string[] {
	const { n, parents, rand } = genTree(seed);
	const idx = [...Array(n).keys()];
	const perm = [...idx];
	for (let i = perm.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[perm[i], perm[j]] = [perm[j], perm[i]];
	}
	const g1 = graph(yamlOf(parents, idx));
	const g2 = graph(yamlOf(parents, perm));
	const out: string[] = [];
	for (let m = 0; m < n; m++) {
		const r1 = computeRelations(g1, `p${m}`, { oneParentUnknown: on });
		const r2 = computeRelations(g2, `p${m}`, { oneParentUnknown: on });
		for (let q = 0; q < n; q++) {
			const [a, b] = [fmt(r1.get(`p${q}`)), fmt(r2.get(`p${q}`))];
			if (a !== b) out.push(`p${m}->p${q}: ${a} vs ${b}`);
		}
	}
	return out;
}

describe('review D175 fuzz: names do not depend on the order of the people (D2)', () => {
	for (const seed of [43, 233, 275]) {
		it(`seed ${seed}, setting off: the same names in both orders`, () => {
			expect(mismatches(seed, false)).toEqual([]);
		});
	}
});

describe('review D175 oracle: "double" first cousins from two different couples (spec §13.1 Double)', () => {
	it('3000 trees, both settings, both directions: "double" iff two couples', () => {
		const bad: string[] = [];
		let doubles = 0;
		for (let seed = 1; seed <= 3000 && bad.length < 5; seed++) {
			const c = caseOf(seed);
			const g = graph(c.yaml);
			if (c.want.length) doubles++;
			for (const on of [true, false]) {
				for (const [m, p] of [
					['me', 'pp'],
					['pp', 'me'],
				]) {
					const got = (computeRelations(g, m, { oneParentUnknown: on }).get(p) ?? []).map((x) => x.text).filter((t) => t.includes('ouble'));
					if (JSON.stringify(got.sort()) !== JSON.stringify([...c.want].sort())) bad.push(`seed ${seed} ${on ? 'on' : 'off'} ${m}->${p}: ${JSON.stringify(got)} want ${JSON.stringify(c.want)}`);
				}
			}
		}
		expect(bad).toEqual([]);
		expect(doubles).toBeGreaterThan(200);
	}, 60_000);
});
