// Test round of 0.2.8, target X1 (5): a small independent derivation of the blood relation names of spec §13.1, for the trees where it is clear:
// layered trees (every parent link goes up exactly one generation), birth links only, no unions. It is written from the spec text (rules 1 to 4 of "Rules: blood relations",
// the name table, "Half" with the setting on and off), not from `relations.ts`. Where the spec leaves a choice that this small derivation does not make (a tie at the same
// distance, a "double" name, several children of one ancestor that lead to the same person) it answers `skip`, and the test counts those and asserts nothing about them.
import { rng, type GenModel, type GenPerson } from './r028-gen';

/** A layered tree: generation g has `width` people; each person of g > 0 has 1 or 2 birth parents from generation g - 1 (`twoP` is the chance of a second parent). */
export function layered(seed: number, gens: number, width: number, sexMode: 'mf' | 'mixed' = 'mf', twoP = 0.8): { model: GenModel; gen: Map<string, number> } {
	const rand = rng(seed);
	const people: GenPerson[] = [];
	const gen = new Map<string, number>();
	const byGen: string[][] = [];
	for (let g = 0; g < gens; g++) {
		byGen.push([]);
		for (let i = 0; i < width; i++) {
			const id = `g${g}_${i}`;
			const r = rand();
			const sex = sexMode === 'mf' ? (r < 0.5 ? 'm' : 'f') : r < 0.4 ? 'm' : r < 0.8 ? 'f' : r < 0.9 ? 'x' : undefined;
			const parents: GenPerson['parents'] = [];
			if (g > 0) {
				const prev = byGen[g - 1];
				const a = prev[Math.floor(rand() * prev.length)];
				parents.push({ id: a, type: 'birth' });
				if (rand() < twoP) {
					const b = prev[Math.floor(rand() * prev.length)];
					if (b !== a) parents.push({ id: b, type: 'birth' });
				}
			}
			people.push({ id, name: id.toUpperCase(), ...(sex ? { sex } : {}), parents });
			gen.set(id, g);
			byGen[g].push(id);
		}
	}
	return { model: { people, unions: [] }, gen };
}

const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const degree = (k: number) => (k <= 10 ? ORD[k - 1] : `${k}th`);
const removal = (r: number) => (r === 1 ? 'once removed' : r === 2 ? 'twice removed' : `${r} times removed`);
const great = (n: number) => (n <= 0 ? '' : n === 1 ? 'great-' : n === 2 ? 'great-great-' : `${n}th great-`.replace(/^(\d+)th/, (_, d) => `${d}${suffix(+d)}`));
function suffix(n: number) { return n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'; }

/** The spec §13.1 table, for P (with sex) in relation (a, b) to M. `half` adds the prefix. */
export function nameFor(a: number, b: number, sex: string | undefined, half: boolean): string {
	const s = sex === 'm' ? 'm' : sex === 'f' ? 'f' : 'n';
	const pick = (m: string, f: string, n: string) => (s === 'm' ? m : s === 'f' ? f : n);
	const h = half ? 'half-' : '';
	if (a === 0) {
		const gr = b - 2; // child b=1, grandchild b=2, great-grandchild b=3
		const base = b === 1 ? pick('son', 'daughter', 'child') : b === 2 ? pick('grandson', 'granddaughter', 'grandchild') : `${great(gr)}${pick('grandson', 'granddaughter', 'grandchild')}`;
		return base;
	}
	if (b === 0) {
		const base = a === 1 ? pick('father', 'mother', 'parent') : a === 2 ? pick('grandfather', 'grandmother', 'grandparent') : `${great(a - 2)}${pick('grandfather', 'grandmother', 'grandparent')}`;
		return base;
	}
	if (a === 1 && b === 1) return pick(`${h}brother`, `${h}sister`, `${h}sibling`);
	if (b === 1 && a >= 2) {
		const gr = a - 2;
		if (s === 'n') return gr === 0 ? `parent’s ${h}sibling` : `${great(gr - 1)}grandparent’s ${h}sibling`.replace('great-grandparent’s', 'great-grandparent’s');
		return `${great(gr)}${h}${pick('uncle', 'aunt', '')}`;
	}
	if (a === 1 && b >= 2) {
		const gr = b - 2;
		if (s === 'n') return gr === 0 ? `${h}sibling’s child` : `${h}sibling’s ${great(gr - 1)}grandchild`;
		return `${great(gr)}${h}${pick('nephew', 'niece', '')}`;
	}
	const k = Math.min(a, b) - 1;
	const r = Math.abs(a - b);
	return `${h}${degree(k)} cousin${r ? ` ${removal(r)}` : ''}`;
}
export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function oracle(model: GenModel, gen: Map<string, number>, mId: string, pId: string, unknown = false): { text: string } | { kind: 'co-parent' } | { skip: string } | undefined {
	const parents = new Map(model.people.map((p) => [p.id, p.parents.map((x) => x.id)]));
	const sexOf = new Map(model.people.map((p) => [p.id, p.sex]));
	const children = new Map<string, string[]>();
	for (const [c, ps] of parents) for (const x of ps) children.set(x, [...(children.get(x) ?? []), c]);
	const ancestorsOrSelf = (id: string) => {
		const out = new Set<string>([id]);
		const stack = [id];
		while (stack.length) {
			for (const x of parents.get(stack.pop()!) ?? []) {
				if (out.has(x)) continue;
				out.add(x);
				stack.push(x);
			}
		}
		return out;
	};
	const am = ancestorsOrSelf(mId);
	const ap = ancestorsOrSelf(pId);
	// Co-parents: share a child.
	if ((children.get(mId) ?? []).some((c) => (parents.get(c) ?? []).includes(pId))) return { kind: 'co-parent' };
	const cands: { x: string; a: number; b: number; c1?: string; c2?: string }[] = [];
	for (const x of am) {
		if (!ap.has(x)) continue;
		const a = gen.get(mId)! - gen.get(x)!;
		const b = gen.get(pId)! - gen.get(x)!;
		if (x === mId || x === pId) {
			cands.push({ x, a, b });
			continue;
		}
		const c1s = (children.get(x) ?? []).filter((c) => am.has(c));
		const c2s = (children.get(x) ?? []).filter((c) => ap.has(c));
		const pairs = c1s.flatMap((c1) => c2s.filter((c2) => c2 !== c1).map((c2) => [c1, c2] as const));
		if (!pairs.length) continue;
		if (c1s.length !== 1 || c2s.length !== 1) return { skip: 'several children of X lead to M or P' };
		cands.push({ x, a, b, c1: c1s[0], c2: c2s[0] });
	}
	if (!cands.length) return undefined;
	const min = Math.min(...cands.map((c) => c.a + c.b));
	const best = cands.filter((c) => c.a + c.b === min);
	const keyOf = (c: (typeof cands)[number]) => {
		const p1 = parents.get(c.c1 ?? '') ?? [];
		const p2 = parents.get(c.c2 ?? '') ?? [];
		// §13.1 "Half": the sure sets differ, or (setting on) a child lists fewer than two parents.
		const half = c.c1 && c.c2 ? [...p1].sort().join(',') !== [...p2].sort().join(',') || (unknown && (p1.length < 2 || p2.length < 2)) : false;
		return `${c.a},${c.b},${half}`;
	};
	const keys = [...new Set(best.map(keyOf))];
	if (keys.length > 1) return { skip: 'tie at the same distance' };
	// Two different couples of ancestors give a "double" name (§13.1): left out here.
	if (new Set(best.map((c) => `${c.c1}|${c.c2}`)).size > 1 && best[0].c1) return { skip: 'double' };
	const [a, b, half] = keys[0].split(',').map((v, i) => (i < 2 ? Number(v) : v === 'true')) as [number, number, boolean];
	return { text: cap(nameFor(a, b, sexOf.get(pId), half)) };
}

const BY_MARRIAGE_WORD: Record<'sibling' | 'parent' | 'child' | 'stepparent' | 'stepchild', [string, string, string]> = {
	sibling: ['Brother-in-law', 'Sister-in-law', 'Sibling-in-law'],
	parent: ['Father-in-law', 'Mother-in-law', 'Parent-in-law'],
	child: ['Son-in-law', 'Daughter-in-law', 'Child-in-law'],
	stepparent: ['Stepfather', 'Stepmother', 'Step-parent'],
	stepchild: ['Stepson', 'Stepdaughter', 'Stepchild'],
};

/**
 * A layered tree with marriages between people of one generation who have no common ancestor (the `seed` decides), and for the marked person `me` the names that
 * spec §13.1 "Relations by marriage" rules 1 and 2 give for the six plain cases: the spouse of a sibling, a sibling of the spouse, a parent of the spouse (the sibling-in-law and
 * parent-in-law names), the spouse of a child (child-in-law), the spouse of a parent who is not a parent (step-parent) and a child of the spouse who is not a child of `me` (stepchild).
 * The names must be among the names of that person ("Also" list); which one wins is rule 3 and is not asserted here.
 */
export function byMarriageCases(seed: number): { model: GenModel; expected: Map<string, Map<string, Set<string>>> } {
	const rand = rng(seed * 101);
	const { model, gen } = layered(seed, 5, 5, seed % 2 ? 'mf' : 'mixed', 0.8);
	const parents = new Map(model.people.map((p) => [p.id, p.parents.map((x) => x.id)]));
	const ancestors = (id: string) => {
		const out = new Set([id]);
		const stack = [id];
		while (stack.length) {
			for (const x of parents.get(stack.pop()!) ?? []) {
				if (out.has(x)) continue;
				out.add(x);
				stack.push(x);
			}
		}
		return out;
	};
	const anc = new Map(model.people.map((p) => [p.id, ancestors(p.id)]));
	const related = (x: string, y: string) => [...anc.get(x)!].some((z) => anc.get(y)!.has(z));
	const unions: GenModel['unions'] = [];
	const spouse = new Map<string, string[]>();
	for (let tries = 0; tries < 12; tries++) {
		const x = model.people[Math.floor(rand() * model.people.length)];
		const y = model.people[Math.floor(rand() * model.people.length)];
		if (x.id === y.id || gen.get(x.id) !== gen.get(y.id) || related(x.id, y.id)) continue;
		if (unions.some((u) => (u.a === x.id && u.b === y.id) || (u.a === y.id && u.b === x.id))) continue;
		unions.push({ a: x.id, b: y.id });
		spouse.set(x.id, [...(spouse.get(x.id) ?? []), y.id]);
		spouse.set(y.id, [...(spouse.get(y.id) ?? []), x.id]);
	}
	const sexOf = new Map(model.people.map((p) => [p.id, p.sex]));
	const kids = new Map<string, string[]>();
	for (const [c, ps] of parents) for (const x of ps) kids.set(x, [...(kids.get(x) ?? []), c]);
	const sibsOf = (x: string) => new Set((parents.get(x) ?? []).flatMap((p) => kids.get(p) ?? []).filter((c) => c !== x));
	const word = (kind: keyof typeof BY_MARRIAGE_WORD, id: string) => BY_MARRIAGE_WORD[kind][sexOf.get(id) === 'm' ? 0 : sexOf.get(id) === 'f' ? 1 : 2];
	const expected = new Map<string, Map<string, Set<string>>>();
	for (const me of model.people.map((p) => p.id)) {
		const mine = new Map<string, Set<string>>();
		const add = (p: string, w: string) => {
			// Rule 1 and 2: the relative by marriage is not a blood relative of the marked person.
			if (p === me || related(p, me)) return;
			const set = mine.get(p) ?? new Set<string>();
			set.add(w);
			mine.set(p, set);
		};
		for (const s of sibsOf(me)) for (const p of spouse.get(s) ?? []) add(p, word('sibling', p));
		for (const sp of spouse.get(me) ?? []) {
			for (const s of sibsOf(sp)) add(s, word('sibling', s));
			for (const par of parents.get(sp) ?? []) add(par, word('parent', par));
			for (const c of kids.get(sp) ?? []) if (!(parents.get(c) ?? []).includes(me)) add(c, word('stepchild', c));
		}
		for (const c of kids.get(me) ?? []) for (const p of spouse.get(c) ?? []) add(p, word('child', p));
		for (const par of parents.get(me) ?? []) for (const p of spouse.get(par) ?? []) if (!(parents.get(me) ?? []).includes(p)) add(p, word('stepparent', p));
		expected.set(me, mine);
	}
	return { model: { ...model, unions }, expected };
}
