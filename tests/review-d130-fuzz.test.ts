/*
 * G2 review of D174: the relation names of a tree must not depend on the order of the people in
 * the note (D2; relations.ts header: "the names never depend on the order of the children").
 * Small random trees (made-up ids) are written in two orders. These five seeds give the same names
 * in both orders on main (v0.2.4) and different names on the branch sibling-labels, all with the
 * setting on (the maybe "full/unlisted" or a "Rumoured X" name comes and goes).
 */

import { expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, type Relation, type RelationOptions } from '../src/core/relations';

function rng(seed: number) {
	let x = seed;
	return () => {
		x = (x * 1103515245 + 12345) % 2147483648;
		return x / 2147483648;
	};
}

function graphOf(lines: string[]): FamilyGraph | null {
	const r = parseDynasty('people:\n' + lines.join('\n') + '\n');
	return r.ok ? deriveFamilies(r.tree) : null;
}

const TYPES = ['', '', '', ':rumoured', ':adoptive'];
const fmt = (r: readonly Relation[] | undefined) => JSON.stringify((r ?? []).map((x) => [x.text, x.maybe?.effect, x.maybe?.cause]).sort());

/** The pairs whose names differ between the two orders of the tree of `seed`. */
function mismatches(seed: number, o: RelationOptions): string[] {
	const rand = rng(seed);
	const n = 7 + Math.floor(rand() * 5);
	const parentsOf: string[][] = [];
	for (let i = 0; i < n; i++) {
		const ps: string[] = [];
		if (i >= 2) {
			const k = Math.floor(rand() * 4);
			for (let j = 0; j < k; j++) ps.push(`p${Math.floor(rand() * i)}${TYPES[Math.floor(rand() * TYPES.length)]}`);
		}
		parentsOf.push(ps);
	}
	const lineOf = (i: number) => {
		const refs = parentsOf[i].map((p) => {
			const [pid, type] = p.split(':');
			return type ? `{id: ${pid}, type: ${type}}` : pid;
		});
		return `  - {id: p${i}, name: p${i}, sex: ${i % 2 ? 'f' : 'm'}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`;
	};
	const idx = [...Array(n).keys()];
	const perm = [...idx];
	for (let i = perm.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[perm[i], perm[j]] = [perm[j], perm[i]];
	}
	const g1 = graphOf(idx.map(lineOf));
	const g2 = graphOf(perm.map(lineOf));
	if (!g1 || !g2) return [];
	const out: string[] = [];
	for (let m = 0; m < n; m++) {
		const r1 = computeRelations(g1, `p${m}`, o);
		const r2 = computeRelations(g2, `p${m}`, o);
		for (let q = 0; q < n; q++) {
			const [a, b] = [fmt(r1.get(`p${q}`)), fmt(r2.get(`p${q}`))];
			if (a !== b) out.push(`p${m}->p${q}: ${a} vs ${b}; tree ${parentsOf.map((p, i) => `p${i}<${p.join(',')}>`).join(' ')}; order ${perm.join(',')}`);
		}
	}
	return out;
}

for (const seed of [57, 65, 115, 258, 313]) {
	it(`seed ${seed}, setting on: the names are the same in both orders of the people`, () => {
		expect(mismatches(seed, { oneParentUnknown: true })).toEqual([]);
	});
}
