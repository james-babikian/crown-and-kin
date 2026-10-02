import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { computeRelations, findRelation, lineSubgraph, relationsKey } from '../src/core/relations';
import type { RelationLine } from '../src/core/relations';
import { geometryFor } from '../src/layout/geometry';
import { layoutTree } from '../src/layout/index';

const NEVER_FAR = { sweeps: 4, far: { maxCardWidths: Infinity, maxGenerations: Infinity } };

// Adversarial review of M7 core (code-reviewer, scratch branch). An independent oracle of the
// §13.1 blood rules on random birth-only trees, and targeted cases.

function graph(yaml: string): FamilyGraph {
	const r = parseDynasty(yaml);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

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

/** Random birth-only tree: people p0..pn-1, parents from earlier people, sexes m/f/x/none. */
function randomBirthTree(seed: number, n: number): { yaml: string; parents: string[][]; sex: (string | undefined)[] } {
	const rand = rng(seed);
	const parents: string[][] = [];
	const sex: (string | undefined)[] = [];
	const lines: string[] = [];
	for (let i = 0; i < n; i++) {
		const ps: string[] = [];
		if (i > 1 && rand() < 0.8) {
			const a = Math.floor(rand() * i);
			ps.push(`p${a}`);
			if (rand() < 0.75) {
				let b = Math.floor(rand() * i);
				if (b === a) b = (a + 1) % i;
				if (b !== a) ps.push(`p${b}`);
			}
		}
		const r = rand();
		const s = r < 0.4 ? 'm' : r < 0.8 ? 'f' : r < 0.9 ? 'x' : undefined;
		parents.push(ps);
		sex.push(s);
		lines.push(`  - {id: p${i}, name: P${i}${s ? `, sex: ${s}` : ''}${ps.length ? `, parents: [${ps.join(', ')}]` : ''}}`);
	}
	return { yaml: `people:\n${lines.join('\n')}\n`, parents, sex };
}

// ---------------------------------------------------------------------------------------------
// Oracle, written from spec §13.1 only.

type S = 0 | 1 | 2;
const sexOf = (s: string | undefined): S => (s === 'm' ? 0 : s === 'f' ? 1 : 2);
function nth(n: number): string {
	const t = n % 100;
	if (t >= 11 && t <= 13) return `${n}th`;
	const d = n % 10;
	return `${n}${d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}`;
}
function great(n: number): string {
	if (n === 0) return '';
	if (n === 1) return 'great-';
	if (n === 2) return 'great-great-';
	return `${nth(n)} great-`;
}
const PARENT = ['father', 'mother', 'parent'];
const CHILD = ['son', 'daughter', 'child'];
const SIB = ['brother', 'sister', 'sibling'];
const up = (a: number, s: S) => (a === 1 ? PARENT[s] : `${great(a - 2)}grand${PARENT[s]}`);
const down = (b: number, s: S) => (b === 1 ? CHILD[s] : `${great(b - 2)}grand${CHILD[s]}`);
const withHalf = (w: string, half: boolean) => (!half ? w : w.includes(' ') ? `half ${w}` : `half-${w}`);
const DEG = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function oracleName(a: number, b: number, s: S, half: boolean): string {
	if (a === 0) return down(b, s);
	if (b === 0) return up(a, s);
	if (a === 1 && b === 1) return withHalf(SIB[s], half);
	if (b === 1) return s === 2 ? `${up(a - 1, 2)}’s ${withHalf('sibling', half)}` : withHalf(`${great(a - 2)}${s === 0 ? 'uncle' : 'aunt'}`, half);
	if (a === 1) return s === 2 ? `${withHalf('sibling', half)}’s ${down(b - 1, 2)}` : withHalf(`${great(b - 2)}${s === 0 ? 'nephew' : 'niece'}`, half);
	const deg = Math.min(a, b) - 1;
	const rem = Math.abs(a - b);
	let w = `${deg <= 10 ? DEG[deg - 1] : nth(deg)} cousin`;
	if (rem === 1) w += ' once removed';
	else if (rem === 2) w += ' twice removed';
	else if (rem > 2) w += ` ${rem} times removed`;
	return withHalf(w, half);
}

/** All blood names of p to m, by brute-force path enumeration (§13.1 steps 1–3, D50, doubles). */
function oracle(parents: number[][], sex: S[], m: number, p: number): Set<string> {
	const n = parents.length;
	const children: number[][] = Array.from({ length: n }, () => []);
	parents.forEach((ps, c) => ps.forEach((q) => children[q].push(c)));
	const pathsTo = new Map<string, number[][]>();
	/** Every upward path from v to t, both included. */
	const all = (v: number, t: number): number[][] => {
		const key = `${v}:${t}`;
		const k = pathsTo.get(key);
		if (k) return k;
		const out: number[][] = [];
		if (v === t) out.push([v]);
		else for (const q of parents[v]) for (const rest of all(q, t)) out.push([v, ...rest]);
		pathsTo.set(key, out);
		return out;
	};
	const ancestors = (v: number) => {
		const s = new Set<number>([v]);
		const st = [v];
		while (st.length) {
			for (const q of parents[st.pop()!]) {
				if (s.has(q)) continue;
				s.add(q);
				st.push(q);
			}
		}
		return s;
	};
	const aM = ancestors(m);
	const aP = ancestors(p);
	type C = { key: string; a: number; b: number; half: boolean; couple: string };
	const cands = new Map<string, C>();
	const names = new Set<string>();
	for (let x = 0; x < n; x++) {
		if (!aM.has(x) || !aP.has(x)) continue;
		if (x === m) {
			names.add(oracleName(0, Math.min(...all(p, m).map((q) => q.length - 1)), sex[p], false));
			continue;
		}
		if (x === p) {
			names.add(oracleName(Math.min(...all(m, p).map((q) => q.length - 1)), 0, sex[p], false));
			continue;
		}
		const pm = all(m, x);
		const pp = all(p, x);
		let best: [number, number] | undefined;
		for (const u of pm) for (const v of pp) {
			if (u[u.length - 2] === v[v.length - 2]) continue;
			const [a, b] = [u.length - 1, v.length - 1];
			if (!best || a + b < best[0] + best[1] || (a + b === best[0] + best[1] && (Math.abs(a - b) < Math.abs(best[0] - best[1]) || (Math.abs(a - b) === Math.abs(best[0] - best[1]) && a < best[0])))) best = [a, b];
		}
		if (!best) continue;
		// Every (c1, c2) that has a disjoint pair of best lengths; each distinct full or half result is
		// one candidate (supervisor ruling on D50: the names must not depend on the order of children).
		for (const c1 of children[x]) for (const c2 of children[x]) {
			if (c1 === c2) continue;
			let ok = false;
			for (const u of pm) {
				if (ok || u.length - 1 !== best[0] || u[u.length - 2] !== c1) continue;
				for (const v of pp) {
					if (v.length - 1 !== best[1] || v[v.length - 2] !== c2) continue;
					const su = new Set(u.slice(0, -1));
					if (v.slice(0, -1).some((q) => su.has(q))) continue;
					ok = true;
					break;
				}
			}
			if (!ok) continue;
			const set = (c: number) => [...new Set(parents[c])].sort((i, j) => i - j).join(',');
			const half = set(c1) !== set(c2);
			const couple = half ? `${x}` : set(c1);
			const key = `${half ? 'H' : 'F'}:${couple}:${best[0]}:${best[1]}`;
			if (!cands.has(key)) cands.set(key, { key, a: best[0], b: best[1], half, couple });
		}
	}
	// Doubles: the same full cousin name from two different couples.
	const byName = new Map<string, C[]>();
	for (const c of cands.values()) {
		const w = oracleName(c.a, c.b, sex[p], c.half);
		if (!c.half && c.a >= 2 && c.b >= 2) byName.set(w, [...(byName.get(w) ?? []), c]);
		else names.add(w);
	}
	for (const [w, cs] of byName) names.add(new Set(cs.map((c) => c.couple)).size >= 2 ? `double ${w}` : w);
	return names;
}

describe('oracle: blood names on random birth-only trees', () => {
	it('every name of every pair matches the §13.1 oracle (600 trees)', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 600 && bad.length < 5; seed++) {
			const size = 6 + (seed % 30);
			const t = randomBirthTree(seed, size);
			const g = graph(t.yaml);
			const idx = new Map(g.people.map((p, i) => [p.id, i]));
			const parents = t.parents.map((ps) => [...new Set(ps.map((q) => idx.get(q)!))]);
			const sex = t.sex.map(sexOf);
			for (let m = 0; m < size && bad.length < 5; m++) {
				const rels = computeRelations(g, `p${m}`);
				for (let p = 0; p < size; p++) {
					if (p === m) continue;
					// Implicit unions (co-parents) are partners; leave them out of the comparison.
					const got = new Set((rels.get(`p${p}`) ?? []).filter((r) => r.kind === 'blood').map((r) => r.lower));
					const want = oracle(parents, sex, m, p);
					const same = got.size === want.size && [...got].every((w) => want.has(w));
					if (!same) bad.push(`seed ${seed} me p${m} p${p}: got [${[...got].join('; ')}] want [${[...want].join('; ')}]`);
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);

	// Closed populations make the two first paths meet often, so these trees reach the exact search
	// for a disjoint pair (both first paths change) hundreds of times, with and without a result.
	it('every name of every pair matches the §13.1 oracle (40 small inbred populations)', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 40 && bad.length < 5; seed++) {
			const rand = rng(seed);
			const [gens, width] = [6, 5];
			const parents: number[][] = [];
			const lines: string[] = [];
			for (let gen = 0; gen < gens; gen++) {
				for (let i = 0; i < width; i++) {
					const ps: number[] = [];
					if (gen > 0) {
						const a = Math.floor(rand() * width);
						let b = Math.floor(rand() * width);
						if (b === a) b = (a + 1) % width;
						ps.push((gen - 1) * width + a);
						if (rand() < 0.85) ps.push((gen - 1) * width + b);
					}
					parents.push(ps);
					lines.push(`  - {id: p${gen * width + i}, name: P, sex: m${ps.length ? `, parents: [${ps.map((q) => `p${q}`).join(', ')}]` : ''}}`);
				}
			}
			const g = graph(`people:\n${lines.join('\n')}\n`);
			const n = gens * width;
			const sex = parents.map(() => 0 as S);
			for (let m = 0; m < n && bad.length < 5; m++) {
				const rels = computeRelations(g, `p${m}`);
				for (let p = 0; p < n; p++) {
					if (p === m) continue;
					const got = new Set((rels.get(`p${p}`) ?? []).filter((r) => r.kind === 'blood').map((r) => r.lower));
					const want = oracle(parents, sex, m, p);
					const same = got.size === want.size && [...got].every((w) => want.has(w));
					if (!same) bad.push(`inbred seed ${seed} me p${m} p${p}: got [${[...got].join('; ')}] want [${[...want].join('; ')}]`);
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);
});

// ---------------------------------------------------------------------------------------------
// Random trees with every link type and union type: the contract's line rules, the small tree,
// and the finder's chain.

function randomAnyTree(seed: number, n: number): string {
	const rand = rng(seed);
	const people: string[] = [];
	const unions: string[] = [];
	const TYPES = ['marriage', 'betrothal', 'concubinage', 'affair', 'handfast', ''];
	for (let i = 0; i < n; i++) {
		const ps: string[] = [];
		if (i > 1 && rand() < 0.8) {
			const count = 1 + Math.floor(rand() * 3);
			for (let k = 0; k < count; k++) {
				const q = Math.floor(rand() * i);
				const r = rand();
				const type = r < 0.65 ? '' : r < 0.78 ? 'adoptive' : r < 0.88 ? 'ward' : r < 0.96 ? 'rumoured' : 'oddtype';
				ps.push(type ? `{id: p${q}, type: ${type}}` : `p${q}`);
			}
		}
		const r = rand();
		const s = r < 0.45 ? 'm' : r < 0.9 ? 'f' : 'x';
		const placement = rand() < 0.15 ? `, placement: ${['adoptive', 'ward', 'rumoured', 'birth'][Math.floor(rand() * 4)]}` : '';
		const union = rand() < 0.1 && unions.length ? `, union: u${Math.floor(rand() * unions.length)}` : '';
		people.push(`  - {id: p${i}, name: P${i}, sex: ${s}${ps.length ? `, parents: [${ps.join(', ')}]` : ''}${placement}${union}}`);
		if (i > 0 && rand() < 0.35) {
			const t = TYPES[Math.floor(rand() * TYPES.length)];
			const other = Math.floor(rand() * i);
			const times = rand() < 0.2 ? 2 : 1;
			for (let k = 0; k < times; k++) unions.push(`  - {id: u${unions.length}, partners: [p${i}, p${other}]${t ? `, type: ${k ? 'affair' : t}` : ''}}`);
		}
	}
	return `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;
}

/** Contract line rules; returns the first broken rule, or undefined. */
function lineProblem(g: FamilyGraph, line: RelationLine, first: string, second: string): string | undefined {
	if (line.people[0] !== first || line.people[line.people.length - 1] !== second) return 'ends';
	if (new Set(line.people).size !== line.people.length) return `repeat ${line.people.join(' ')}`;
	const on = new Set(line.people);
	for (const l of line.links) {
		if (!on.has(l.parent) || !on.has(l.child)) return 'link off line';
		if (!drawnParents(g, l.child).some((d) => d.id === l.parent && d.type === l.type)) return `not a drawn link ${l.parent}->${l.child} ${l.type}`;
	}
	const pairs = new Set<string>();
	for (const key of line.unions) {
		const fu = g.unionByKey.get(key);
		if (!fu) return `unknown union ${key}`;
		if (!fu.partners.every((id) => on.has(id))) return `union partner off line ${key}`;
		pairs.add([...fu.partners].sort().join('|'));
	}
	for (let i = 0; i + 1 < line.people.length; i++) {
		const [a, b] = [line.people[i], line.people[i + 1]];
		const joined = line.links.some((l) => (l.parent === a && l.child === b) || (l.parent === b && l.child === a)) || pairs.has([a, b].sort().join('|'));
		if (!joined) return `gap ${a} ${b}`;
	}
	return undefined;
}

/** Independent BFS over every drawn link and every union (listed or implicit): the number of links on a shortest chain. */
function chainLength(g: FamilyGraph, from: string, to: string): number | undefined {
	const adj = new Map<string, Set<string>>();
	const add = (a: string, b: string) => {
		if (!adj.has(a)) adj.set(a, new Set());
		adj.get(a)!.add(b);
	};
	const both = (a: string, b: string) => {
		add(a, b);
		add(b, a);
	};
	for (const p of g.people) for (const d of drawnParents(g, p.id)) both(p.id, d.id);
	for (const u of g.unions) both(u.partners[0], u.partners[1]);
	const dist = new Map([[from, 0]]);
	const q = [from];
	while (q.length) {
		const v = q.shift()!;
		for (const w of adj.get(v) ?? []) {
			if (dist.has(w)) continue;
			dist.set(w, dist.get(v)! + 1);
			q.push(w);
		}
	}
	return dist.get(to);
}

describe('random trees with every link and union type', () => {
	it('every relation line obeys the contract line rules and its small tree lays out', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 150 && bad.length < 5; seed++) {
			const g = graph(randomAnyTree(seed, 8 + (seed % 18)));
			for (const me of g.people) {
				for (const [id, rels] of computeRelations(g, me.id)) {
					for (const rel of rels) {
						const why = lineProblem(g, rel.line, me.id, id);
						if (why) bad.push(`seed ${seed} me ${me.id} ${id} "${rel.lower}": ${why}`);
						const { layout } = layoutTree(lineSubgraph(g, rel.line), geometryFor(16, 'normal'), NEVER_FAR, 'sans-serif');
						if (layout.persons.size !== new Set(rel.line.people).size) bad.push(`seed ${seed} me ${me.id} ${id} "${rel.lower}": small tree has ${layout.persons.size} cards`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);

	it('the finder chain is a shortest chain and obeys the line rules', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 150 && bad.length < 5; seed++) {
			const g = graph(randomAnyTree(seed, 8 + (seed % 18)));
			for (const a of g.people) {
				for (const b of g.people) {
					if (a === b) continue;
					const r = findRelation(g, a.id, b.id);
					const want = chainLength(g, a.id, b.id);
					if (r.kind === 'none' && want !== undefined) bad.push(`seed ${seed} ${a.id} ${b.id}: none, but a chain of ${want}`);
					if (r.kind !== 'chain') continue;
					if (r.line.people.length - 1 !== want) bad.push(`seed ${seed} ${a.id} ${b.id}: chain of ${r.line.people.length - 1}, shortest ${want}`);
					const why = lineProblem(g, r.line, a.id, b.id);
					if (why) bad.push(`seed ${seed} ${a.id} ${b.id} chain: ${why}`);
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);
});

// ---------------------------------------------------------------------------------------------
// Targeted cases.

/** Compact people lines "id parent parent…", all sex m, as a block. */
function birthTree(lines: string[]): string {
	return `people:\n${lines
		.map((l) => {
			const [id, ...ps] = l.split(' ');
			return `  - {id: ${id}, name: ${id}, sex: m${ps.length ? `, parents: [${ps.join(', ')}]` : ''}}`;
		})
		.join('\n')}\n`;
}

describe('D50 / ruling 5: PATH_CAP drops a candidate that has a disjoint pair of shortest paths', () => {
	// X has children c1, c2; T1 and T2 are children of both; M's only parent Q is a child of T1 and T2.
	// P's first parent V1 reaches Q through 3 diamonds (8 paths, x2 at the top = 16 shortest paths to
	// c2, all through Q, so all meet M's path). P's second parent V2 reaches T1 by a private chain of
	// the same length. The pair M-Q-T2-c1-X / P-V2-w1..w6-T1-c2-X shares nobody below X, so spec §13.1
	// step 3 and D50 keep the candidate (X, 4, 10): "third cousin 6 times removed".
	const lines = [
		'X',
		'c1 X',
		'c2 X',
		'T1 c1 c2',
		'T2 c1 c2',
		'Q T1 T2',
		'M Q',
		'a3 Q',
		'b3 Q',
		'j2 a3 b3',
		'a2 j2',
		'b2 j2',
		'j1 a2 b2',
		'a1 j1',
		'b1 j1',
		'V1 a1 b1',
		'w6 T1',
		'w5 w6',
		'w4 w5',
		'w3 w4',
		'w2 w3',
		'w1 w2',
		'V2 w1',
		'P V1 V2',
	];
	it('the oracle keeps "third cousin 6 times removed"; computeRelations must list it', () => {
		const g = graph(birthTree(lines));
		const idx = new Map(g.people.map((p, i) => [p.id, i]));
		const parents = lines.map((l) => l.split(' ').slice(1).map((q) => idx.get(q)!));
		const want = oracle(parents, lines.map(() => 0 as S), idx.get('M')!, idx.get('P')!);
		expect(want.has('third cousin 6 times removed')).toBe(true);
		const got = (computeRelations(g, 'M').get('P') ?? []).map((r) => r.lower);
		expect(got).toContain('third cousin 6 times removed');
	});
});

describe('the names must not depend on the order of siblings (D2 "move sibling" changes only the order)', () => {
	/** Typed compact lines "id sex parent[:type]…". */
	const typed = (lines: string[]) =>
		`people:\n${lines
			.map((l) => {
				const [id, sex, ...ps] = l.split(' ');
				const refs = ps.map((p) => (p.includes(':') ? `{id: ${p.split(':')[0]}, type: ${p.split(':')[1]}}` : p));
				return `  - {id: ${id}, name: ${id}, sex: ${sex}${refs.length ? `, parents: [${refs.join(', ')}]` : ''}}`;
			})
			.join('\n')}\n`;
	const lowers = (yaml: string, me: string, p: string) => (computeRelations(graph(yaml), me).get(p) ?? []).map((r) => r.lower);

	it('a birth cousin shows "First cousin once removed", not "Adoptive first cousin once removed", whichever sibling is listed first', () => {
		// X adopted c2 and fathered c1 and c3. M is c1's son. P's parents are c2's son and c3's
		// daughter (a first-cousin marriage), so P is M's first cousin once removed through c3 by
		// birth links only, at the same distance as through c2 (rule 4: birth before adoptive).
		const rest = ['M m c1', 'c2s m c2', 'c3d f c3', 'P m c2s c3d'];
		const c2First = typed(['X m', 'c1 m X', 'c2 f X:adoptive', 'c3 m X', ...rest]);
		const c3First = typed(['X m', 'c1 m X', 'c3 m X', 'c2 f X:adoptive', ...rest]);
		expect(lowers(c3First, 'M', 'P')[0]).toBe('first cousin once removed');
		expect(lowers(c2First, 'M', 'P')[0]).toBe('first cousin once removed');
	});

	it('a parent listed first by "placement: adoptive" does not make a birth cousin "adoptive"', () => {
		// K has a birth father A2 and an adoptive father B2, both sons of c2; K's placement is adoptive,
		// so B2 is first in drawnParents. P (K's son) is M's first cousin twice removed by birth links
		// through A2, at the same distance as through B2.
		const yaml =
			typed(['X m', 'c1 m X', 'c2 m X', 'M m c1', 'A2 m c2', 'B2 m c2', 'P m K']) +
			'  - {id: K, name: K, sex: m, parents: [A2, {id: B2, type: adoptive}], placement: adoptive}\n';
		expect(lowers(yaml, 'M', 'P')[0]).toBe('first cousin twice removed');
	});

	it('a birth grandson adopted by his uncle ("placement: adoptive") is "Grandson", not "Adopted grandson"', () => {
		// G's sons A and B; K is A's son by birth and B's adopted son, drawn under B.
		const yaml =
			typed(['G m', 'A m G', 'B m G']) + '  - {id: K, name: K, sex: m, parents: [A, {id: B, type: adoptive}], placement: adoptive}\n';
		expect(lowers(yaml, 'G', 'K')).toContain('grandson');
		expect(lowers(yaml, 'K', 'G')).toContain('grandfather');
	});

	it('the list of names of a cousin is the same whichever sibling is listed first', () => {
		// c1 and c2 are children of X and Y; c3 is a child of X and Z. P's parents are c2's son and
		// c3's daughter.
		const rest = ['M m c1', 'c2s m c2', 'c3d f c3', 'P m c2s c3d'];
		const c2First = typed(['X m', 'Y f', 'Z f', 'c1 m X Y', 'c2 f X Y', 'c3 m X Z', ...rest]);
		const c3First = typed(['X m', 'Y f', 'Z f', 'c1 m X Y', 'c3 m X Z', 'c2 f X Y', ...rest]);
		expect(lowers(c3First, 'M', 'P')).toEqual(lowers(c2First, 'M', 'P'));
	});
});

describe('frozen results (contract: "Results are deep-frozen, like layout results")', () => {
	it('the map computeRelations returns cannot be changed by one of the views that share it', () => {
		const g = graph(birthTree(['a', 'b a']));
		const rels = computeRelations(g, 'a');
		expect(() => (rels as Map<string, never>).set('b', [] as never)).toThrow();
		expect(rels.get('b')?.[0]?.lower).toBe('son');
	});
});

// ---------------------------------------------------------------------------------------------
// Timing (not a pass/fail test): REVIEW_PERF=1 npx vitest run tests/review-m7-core.test.ts -t timing --silent=false

/** A closed population: `gens` generations of `width` people, each child of a random couple of the generation above. */
function inbred(gens: number, width: number, seed: number, unions: boolean): string {
	const rand = rng(seed);
	const lines: string[] = [];
	const us: string[] = [];
	for (let gen = 0; gen < gens; gen++) {
		for (let i = 0; i < width; i++) {
			let parents = '';
			if (gen > 0) {
				const f = 2 * Math.floor((rand() * width) / 2);
				const m = 2 * Math.floor((rand() * width) / 2) + 1;
				parents = `, parents: [g${gen - 1}_${f}, g${gen - 1}_${m}]`;
				if (unions) us.push(`  - {partners: [g${gen - 1}_${f}, g${gen - 1}_${m}]}`);
			}
			lines.push(`  - {id: g${gen}_${i}, name: G, sex: ${i % 2 === 0 ? 'm' : 'f'}${parents}}`);
		}
	}
	return `people:\n${lines.join('\n')}\n${us.length ? `unions:\n${[...new Set(us)].join('\n')}\n` : ''}`;
}

describe.skipIf(!process.env.REVIEW_PERF)('timing', () => {
	it('computeRelations on 1000-person intermarried trees', () => {
		for (const [gens, width, unions] of [[25, 40, true], [25, 40, false], [10, 100, true], [50, 20, true]] as const) {
			const g = graph(inbred(gens, width, 7, unions));
			for (const me of [`g${gens - 1}_0`, `g${Math.floor(gens / 2)}_3`, 'g0_0']) {
				const t0 = performance.now();
				const rels = computeRelations(g, me);
				const t1 = performance.now();
				let names = 0;
				for (const v of rels.values()) names += v.length;
				let worst = 0;
				for (let k = 0; k < 20; k++) {
					const s = performance.now();
					findRelation(g, g.people[(k * 37) % g.people.length].id, g.people[(k * 91 + 5) % g.people.length].id);
					worst = Math.max(worst, performance.now() - s);
				}
				const k0 = performance.now();
				relationsKey(g, me);
				console.log(`${gens}x${width} unions=${unions} me=${me}: computeRelations ${(t1 - t0).toFixed(0)} ms, ${names} names; relationsKey ${(performance.now() - k0).toFixed(1)} ms; findRelation worst ${worst.toFixed(0)} ms`);
			}
		}
	}, 600_000);
});
