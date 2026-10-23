/*
 * G2 re-review of the D175 fix round: the checks that held on f458add (scratch/d131-review2). They pass;
 * they are here so that the next round keeps them.
 * (a) An oracle of spec §13.1 "Double" with D175, first cousins: couples (some share a person), children
 *     with one parent, two parents (the second sure or rumoured, either order) or a third rumoured parent,
 *     listed unions or none, rumoured links to the two people; both settings, both directions. 3000 seeds;
 *     6860002 fails 18 cases, f60ebcf 3444.
 * (b) Generational trees of 3 to 5 rows: couples with remarriages, listed unions of several types, birth,
 *     rumoured, adoptive and ward links, a third parent, cousin marriages. Blood names in two orders of the
 *     people (D2), both settings (1000 seeds were run; here 150). Names by marriage are left out: their
 *     order dependence is older (finding 3 of tests/core/review-d131b-findings.test.ts).
 * (c) The same trees: every line obeys the contract (union keys of the tree, no gap), and a blood name
 *     with "half" or "rumoured" agrees with its finder steps, except the extra "Rumoured half-X" name
 *     (finding 2), 39 of 37 172 relations on seeds 1 to 400 (94417fb: 176 + 348 + 35 disagreements).
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies, drawnParents, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { computeRelations, findRelation, type Relation, type RelationLine } from '../../src/core/relations';
import { rng } from '../support/rng';
import { genTree, yamlOf } from '../support/gen-tree';

function graph(y: string): FamilyGraph {
	const r = parseDynasty(y);
	if (!r.ok) throw new Error(r.error.code);
	return deriveFamilies(r.tree);
}

// ---------------------------------------------------------------------------------------------
// (a) Oracle.

type T = 'birth' | 'rumoured';
interface Kid {
	id: string;
	refs: [string, T][];
}

function oracleCase(seed: number, on: boolean) {
	const rand = rng(seed);
	const k = 2 + Math.floor(rand() * 2);
	const couples: [string, string][] = [];
	for (let j = 0; j < k; j++) {
		const r = rand();
		const x = j > 0 && r < 0.25 ? couples[j - 1][0] : `x${j}`;
		const z = j > 0 && r >= 0.25 && r < 0.4 ? couples[j - 1][1] : `z${j}`;
		couples.push([x, z]);
	}
	const founders = [...new Set(couples.flat())];
	const kids: Kid[] = [];
	const nk = 4 + Math.floor(rand() * 3);
	for (let i = 0; i < nk; i++) {
		const [x, z] = couples[Math.floor(rand() * k)];
		const r = rand();
		const refs: [string, T][] = [];
		if (r < 0.15) refs.push([x, rand() < 0.2 ? 'rumoured' : 'birth']);
		else {
			refs.push([x, rand() < 0.1 ? 'rumoured' : 'birth'], [z, rand() < 0.4 ? 'rumoured' : 'birth']);
			if (rand() < 0.3) refs.reverse();
		}
		if (rand() < 0.2) {
			const w = founders[Math.floor(rand() * founders.length)];
			if (!refs.some((q) => q[0] === w)) refs.push([w, 'rumoured']);
		}
		kids.push({ id: `k${i}`, refs });
	}
	const order = [...kids.keys()];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	const t = (): T => (rand() < 0.3 ? 'rumoured' : 'birth');
	const mP: [Kid, T][] = [
		[kids[order[0]], t()],
		[kids[order[1]], t()],
	];
	const pP: [Kid, T][] = [
		[kids[order[2]], t()],
		[kids[order[3]], t()],
	];
	const unions: string[] = [];
	for (const [x, z] of couples) if (rand() < 0.5) unions.push(`  - {partners: [${x}, ${z}]}`);
	const ref = (id: string, type: T) => (type === 'birth' ? id : `{id: ${id}, type: ${type}}`);
	const lines = founders.map((f) => `  - {id: ${f}, name: ${f}, sex: ${f.startsWith('x') ? 'm' : 'f'}}`);
	for (const kd of kids) lines.push(`  - {id: ${kd.id}, name: ${kd.id}, sex: ${rand() < 0.5 ? 'm' : 'f'}, parents: [${kd.refs.map(([a, b]) => ref(a, b)).join(', ')}]}`);
	lines.push(`  - {id: me, name: Me, sex: f, parents: [${mP.map(([kd, ty]) => ref(kd.id, ty)).join(', ')}]}`);
	lines.push(`  - {id: pp, name: Pp, sex: f, parents: [${pP.map(([kd, ty]) => ref(kd.id, ty)).join(', ')}]}`);
	const yaml = `people:\n${lines.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;

	// Spec §13.1: sure test, second test, rule 1; one line per (pair of children, common grandparent).
	const typed = (kd: Kid, ty: T) =>
		kd.refs
			.filter((r) => r[1] === ty)
			.map((r) => r[0])
			.sort();
	const all = (kd: Kid) => kd.refs.map((r) => r[0]).sort();
	const incomplete = (kd: Kid, ty: T) => typed(kd, ty).length < 2 && (on || kd.refs.some((r) => r[1] === 'rumoured'));
	const typeOf = (kd: Kid, x: string) => kd.refs.find((r) => r[0] === x)![1];
	const eq = (a: string[], b: string[]) => a.join() === b.join();
	// D176: a child with at most one birth parent and three or more listed parents could have any pair of its rumoured parents
	// beside its birth parent, and also the whole set; every other child has the one set `all`.
	const choices = (kd: Kid): string[][] => {
		const [sure, rum] = [typed(kd, 'birth'), typed(kd, 'rumoured')];
		if (sure.length >= 2 || sure.length + rum.length <= 2) return [all(kd)];
		const out = [all(kd)];
		for (let mask = 0; mask < 1 << rum.length; mask++) {
			const q = rum.filter((_, i) => mask & (1 << i));
			if (sure.length + q.length === 2) out.push([...sure, ...q].sort());
		}
		return out;
	};
	// The second test: two equal choices of two people or more where the setting is on; the couple is the union of the equal choices.
	const matched = (u: Kid, v: Kid) => choices(u).filter((a) => choices(v).some((b) => eq(a, b)) && !(on && a.length < 2));
	const full: { word: T; pair: string; key: string; set: string[]; fr: boolean }[] = [];
	for (const [u, mt] of mP)
		for (const [v, pt] of pP) {
			if (u === v) continue;
			const equalSets = matched(u, v);
			const second = equalSets.length > 0;
			const secondSet = [...new Set(equalSets.flat())].sort();
			for (const x of all(u).filter((q) => all(v).includes(q))) {
				const [t1, t2] = [typeOf(u, x), typeOf(v, x)];
				const sure = eq(typed(u, t1), typed(v, t2)) && !incomplete(u, t1) && !incomplete(v, t2);
				const rumoured = mt === 'rumoured' || pt === 'rumoured' || t1 === 'rumoured' || t2 === 'rumoured';
				const pair = `${u.id}/${v.id}`;
				if (!rumoured) {
					if (sure) full.push({ word: 'birth', pair, key: `F:${typed(u, t1)}`, set: typed(u, t1), fr: false });
				} else if (second) {
					if (sure) full.push({ word: 'rumoured', pair, key: `F:${typed(u, t1)}`, set: typed(u, t1), fr: false });
					else full.push({ word: 'rumoured', pair, key: `FR:${secondSet}`, set: secondSet, fr: true });
				}
			}
		}
	// Two couples: two lines through two pairs of children, of two keys, and not a couple inside the same couple plus a rumoured parent.
	const inside = (s: string[], u: string[]) => s.length > 1 && s.every((v) => u.includes(v));
	const double = (w: T) => {
		const of = full.filter((l) => l.word === w);
		return of.some((a) => of.some((b) => a.pair !== b.pair && a.key !== b.key && !((a.fr || b.fr) && (inside(a.set, b.set) || inside(b.set, a.set)))));
	};
	const want: string[] = [];
	if (double('birth')) want.push('Double first cousin');
	if (double('rumoured')) want.push('Rumoured double first cousin');
	return { yaml, want };
}

describe('review D131b (a): "double" first cousins against an oracle', () => {
	it('3000 trees, both settings, both directions', () => {
		const bad: string[] = [];
		let doubles = 0;
		for (let seed = 1; seed <= 3000 && bad.length < 5; seed++) {
			for (const on of [true, false]) {
				const c = oracleCase(seed, on);
				const g = graph(c.yaml);
				if (c.want.length) doubles++;
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
		expect(doubles).toBeGreaterThan(300);
	}, 120_000);
});

// ---------------------------------------------------------------------------------------------
// (b), (c) Generational trees.

const blood = (r: readonly Relation[] | undefined) =>
	JSON.stringify(
		(r ?? [])
			.filter((x) => !x.text.includes('’s '))
			.map((x) => [x.text, x.maybe?.effect, x.maybe?.cause])
			.sort(),
	);

describe('review D131b (b): blood names do not depend on the order of the people (D2)', () => {
	it('150 generational trees, both settings', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 150 && bad.length < 5; seed++) {
			const gen = genTree(seed);
			const perm = [...Array(gen.n).keys()];
			for (let i = perm.length - 1; i > 0; i--) {
				const j = Math.floor(gen.rand() * (i + 1));
				[perm[i], perm[j]] = [perm[j], perm[i]];
			}
			const g1 = graph(yamlOf(gen, [...Array(gen.n).keys()]));
			const g2 = graph(yamlOf(gen, perm));
			for (const on of [true, false]) {
				for (let m = 0; m < gen.n; m++) {
					const [r1, r2] = [computeRelations(g1, `p${m}`, { oneParentUnknown: on }), computeRelations(g2, `p${m}`, { oneParentUnknown: on })];
					for (let q = 0; q < gen.n; q++) {
						const [a, b] = [blood(r1.get(`p${q}`)), blood(r2.get(`p${q}`))];
						if (a !== b) bad.push(`seed ${seed} ${on ? 'on' : 'off'} p${m}->p${q}: ${a} vs ${b}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
	}, 120_000);
});

function lineProblem(g: FamilyGraph, line: RelationLine, first: string, second: string): string | undefined {
	if (line.people[0] !== first || line.people[line.people.length - 1] !== second) return 'ends';
	if (new Set(line.people).size !== line.people.length) return 'repeat';
	const on = new Set(line.people);
	for (const l of line.links) if (!on.has(l.parent) || !on.has(l.child) || !drawnParents(g, l.child).some((d) => d.id === l.parent && d.type === l.type)) return `link ${l.parent}->${l.child}`;
	const pairs = new Set<string>();
	for (const key of line.unions) {
		const fu = g.unionByKey.get(key);
		if (!fu) return `unknown union ${key}`;
		if (!fu.partners.every((id) => on.has(id))) return `union partner off line ${key}`;
		pairs.add([...fu.partners].sort().join('|'));
	}
	for (let i = 0; i + 1 < line.people.length; i++) {
		const [a, b] = [line.people[i], line.people[i + 1]];
		if (!line.links.some((l) => (l.parent === a && l.child === b) || (l.parent === b && l.child === a)) && !pairs.has([a, b].sort().join('|'))) return `gap ${a} ${b}`;
	}
	return undefined;
}

describe('review D131b (c): lines and finder steps', () => {
	it('every line of 80 generational trees obeys the contract, both settings', () => {
		const bad: string[] = [];
		for (let seed = 1; seed <= 80 && bad.length < 5; seed++) {
			const gen = genTree(seed);
			const g = graph(yamlOf(gen, [...Array(gen.n).keys()]));
			for (const on of [true, false])
				for (let m = 0; m < gen.n; m++)
					for (const [id, rels] of computeRelations(g, `p${m}`, { oneParentUnknown: on }))
						for (const rel of rels) {
							const why = lineProblem(g, rel.line, `p${m}`, id);
							if (why) bad.push(`seed ${seed} p${m}->${id} "${rel.text}": ${why}`);
						}
		}
		expect(bad).toEqual([]);
	}, 120_000);

	it('a blood name and its steps agree on "rumoured" and "half" (the extra "Rumoured half-X" name aside)', () => {
		const bad: string[] = [];
		let checked = 0;
		for (let seed = 1; seed <= 200 && bad.length < 5; seed++) {
			const gen = genTree(seed);
			const g = graph(yamlOf(gen, [...Array(gen.n).keys()]));
			const rand = rng(seed * 7 + 1);
			for (const on of [true, false]) {
				for (let k = 0; k < 30; k++) {
					const [a, b] = [`p${Math.floor(rand() * gen.n)}`, `p${Math.floor(rand() * gen.n)}`];
					if (a === b) continue;
					const r = findRelation(g, a, b, { oneParentUnknown: on });
					if (r.kind !== 'named') continue;
					for (const { relation, steps } of r.relations) {
						if (relation.kind !== 'blood') continue;
						const words = steps.map((s) => s.word);
						const partner = steps.some((s, i) => i > 0 && /wife|husband|spouse|co-parent|lover|partner|betrothed/.test(s.word));
						const half = relation.lower.includes('half');
						// Finding 2 (older): the extra "Rumoured half-X" name runs through the couple of the sure name.
						if (partner && half) continue;
						checked++;
						const sib = words.filter((w) => /(brother|sister|sibling)$/.test(w));
						const tag = `seed ${seed} ${on ? 'on' : 'off'} ${a}->${b} "${relation.lower}": ${JSON.stringify(words)}`;
						if (relation.lower.includes('rumoured') !== words.some((w) => w.includes('rumoured'))) bad.push(`rumoured: ${tag}`);
						if (sib.length && sib.some((w) => w.includes('half')) !== half) bad.push(`half: ${tag}`);
					}
				}
			}
		}
		expect(bad).toEqual([]);
		expect(checked).toBeGreaterThan(5000);
	}, 120_000);
});
