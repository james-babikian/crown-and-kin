// Test round of 0.2.8 (X1): a seeded generator of family trees as a small model, written to tree text in any order of the people.
// It is built on the ideas of `tests/support/random-trees.ts` and an internal script, but keeps a model, so a test can move people in the text
// without changing the family (the order of the `people` list is the only thing that moves).

import { rng } from './rng';
export { rng };

export interface GenParent {
	id: string;
	type: 'birth' | 'adoptive' | 'ward' | 'rumoured';
}

export interface GenPerson {
	id: string;
	name: string;
	/** Written as is; undefined leaves the key out. */
	sex?: string;
	house?: string;
	born?: string;
	died?: string;
	parents: GenParent[];
	illegitimate?: boolean;
}

export interface GenUnion {
	a: string;
	b: string;
	type?: string;
}

export interface GenModel {
	people: GenPerson[];
	unions: GenUnion[];
	/** Option lines, for example `me: p3`. */
	options?: Record<string, string>;
	houses?: string[];
}

/** Tree text of a model. `order` lists indices of `model.people`; the default is the written order. */
export function toText(model: GenModel, order?: readonly number[]): string {
	const idx = order ?? model.people.map((_, i) => i);
	const lines: string[] = [];
	if (model.options && Object.keys(model.options).length) {
		lines.push('options:');
		for (const [k, v] of Object.entries(model.options)) lines.push(`  ${k}: ${v}`);
	}
	if (model.houses?.length) {
		lines.push('houses:');
		model.houses.forEach((h, i) => lines.push(`  - {id: ${h}, name: House ${h}, color: "#${((i * 2654435) % 0xffffff).toString(16).padStart(6, '0')}"}`));
	}
	lines.push('people:');
	for (const i of idx) {
		const p = model.people[i];
		const parts = [`id: ${p.id}`, `name: ${p.name}`];
		if (p.house) parts.push(`house: ${p.house}`);
		if (p.sex !== undefined) parts.push(`sex: ${p.sex}`);
		if (p.born) parts.push(`born: ${p.born}`);
		if (p.died) parts.push(`died: ${p.died}`);
		if (p.parents.length) parts.push(`parents: [${p.parents.map((x) => (x.type === 'birth' ? x.id : `{id: ${x.id}, type: ${x.type}}`)).join(', ')}]`);
		if (p.illegitimate) parts.push('illegitimate: true');
		lines.push(`  - {${parts.join(', ')}}`);
	}
	if (model.unions.length) {
		lines.push('unions:');
		for (const u of model.unions) lines.push(`  - {partners: [${u.a}, ${u.b}]${u.type ? `, type: ${u.type}` : ''}}`);
	}
	return lines.join('\n') + '\n';
}

export type SexMode = 'mf' | 'mixed' | 'none' | 'same';

export interface GenSpec {
	n: number;
	/** Chance that a person has parents (default 0.8). */
	linkP?: number;
	/** Chance that a person with parents has two (default 0.75). */
	twoP?: number;
	/** The parents come from the last `window` people (default: all); a small window makes a deep, narrow tree. */
	window?: number;
	/** Chance for each link to be adoptive, ward and rumoured (defaults 0). */
	adoptive?: number;
	ward?: number;
	rumoured?: number;
	/** Birth links only, at most 2 parents, no illegitimate flag (default false). */
	birthOnly?: boolean;
	sex?: SexMode;
	illegitimate?: number;
	/** Chance that a new person starts a union with an earlier person (default 0.3). */
	unionP?: number;
	houses?: number;
	dates?: boolean;
	/** Parent links that point forward in the list (cycles) and people who list themselves. */
	cycles?: number;
	selfParents?: number;
}

const UNION_TYPES = ['marriage', 'marriage', 'marriage', 'betrothal', 'concubinage', 'affair'];

/** A random family. Parents come from earlier people, so the tree has no cycle unless `cycles` or `selfParents` ask for one. */
export function genModel(seed: number, spec: GenSpec): GenModel {
	const rand = rng(seed);
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
	const sexMode = spec.sex ?? 'mf';
	const people: GenPerson[] = [];
	const unions: GenUnion[] = [];
	const unionOf = new Map<string, number[]>();
	const houses = Array.from({ length: spec.houses ?? 0 }, (_, i) => `h${i}`);
	const sexOf = (): string | undefined => {
		if (sexMode === 'none') return undefined;
		const r = rand();
		if (sexMode === 'mixed') return r < 0.4 ? 'm' : r < 0.8 ? 'f' : r < 0.9 ? 'x' : r < 0.95 ? 'nonbinary' : undefined;
		return r < 0.5 ? 'm' : 'f';
	};
	for (let i = 0; i < spec.n; i++) {
		const id = `p${i}`;
		const person: GenPerson = { id, name: `P${i}`, parents: [] };
		const sex = sexOf();
		if (sex !== undefined) person.sex = sex;
		if (houses.length && rand() < 0.7) person.house = pick(houses);
		if (spec.dates) {
			const born = 1000 + Math.floor(i / 3) * 4 + Math.floor(rand() * 10);
			person.born = String(born);
			if (rand() < 0.6) person.died = String(born + 20 + Math.floor(rand() * 60));
		}
		const lo = spec.window ? Math.max(0, i - spec.window) : 0;
		if (i > 0 && rand() < (spec.linkP ?? 0.8)) {
			const first = lo + Math.floor(rand() * (i - lo));
			const one = people[first];
			const typeOf = (): GenParent['type'] => {
				if (spec.birthOnly) return 'birth';
				const r = rand();
				const a = spec.adoptive ?? 0;
				const w = spec.ward ?? 0;
				const u = spec.rumoured ?? 0;
				return r < a ? 'adoptive' : r < a + w ? 'ward' : r < a + w + u ? 'rumoured' : 'birth';
			};
			const t1 = typeOf();
			person.parents.push({ id: one.id, type: t1 });
			if (rand() < (spec.twoP ?? 0.75)) {
				// Prefer the partner of the first parent: the children of a couple are the usual case.
				const known = unionOf.get(one.id);
				let other: string | undefined;
				if (known && rand() < 0.8) {
					const u = unions[pick(known)];
					other = u.a === one.id ? u.b : u.a;
				} else if (i - lo > 1) {
					const c = people[lo + Math.floor(rand() * (i - lo))];
					if (c.id !== one.id) other = c.id;
				}
				if (other && !person.parents.some((x) => x.id === other)) {
					// A second parent of the same type as the first keeps the pair together; a mixed pair is the odd case.
					person.parents.push({ id: other, type: rand() < 0.85 ? t1 : typeOf() });
				}
			}
			if (!spec.birthOnly && spec.illegitimate && rand() < spec.illegitimate) person.illegitimate = true;
		}
		people.push(person);
		if (i > 0 && rand() < (spec.unionP ?? 0.3)) {
			let j = Math.floor(rand() * i);
			if (sexMode === 'same') {
				// Same-sex couples only: look a few times for a partner of the same sex.
				for (let k = 0; k < 12 && people[j].sex !== person.sex; k++) j = Math.floor(rand() * i);
				if (people[j].sex !== person.sex) continue;
			}
			unions.push({ a: person.id, b: people[j].id, ...(spec.birthOnly ? {} : { type: pick(UNION_TYPES) }) });
			for (const id2 of [person.id, people[j].id]) unionOf.set(id2, [...(unionOf.get(id2) ?? []), unions.length - 1]);
		}
	}
	// Cycles: a person lists a later person as a parent. Self-parents: a person lists themselves.
	for (let c = 0; c < (spec.cycles ?? 0) && people.length > 3; c++) {
		const a = Math.floor(rand() * (people.length - 2));
		const b = a + 1 + Math.floor(rand() * (people.length - a - 1));
		if (!people[a].parents.some((x) => x.id === people[b].id)) people[a].parents.push({ id: people[b].id, type: 'birth' });
	}
	for (let c = 0; c < (spec.selfParents ?? 0) && people.length; c++) {
		const a = Math.floor(rand() * people.length);
		people[a].parents.push({ id: people[a].id, type: 'birth' });
	}
	return { people, unions, ...(houses.length ? { houses } : {}) };
}

/** A line of descent: p0 is the parent of p1, p1 of p2, and so on; every fifth person has a partner who joins the family. */
export function chainModel(depth: number): GenModel {
	const people: GenPerson[] = [];
	const unions: GenUnion[] = [];
	for (let i = 0; i < depth; i++) {
		people.push({ id: `p${i}`, name: `P${i}`, sex: i % 2 ? 'f' : 'm', parents: i ? [{ id: `p${i - 1}`, type: 'birth' }] : [] });
		if (i % 5 === 2) {
			people.push({ id: `s${i}`, name: `S${i}`, sex: i % 2 ? 'm' : 'f', parents: [] });
			unions.push({ a: `p${i}`, b: `s${i}` });
		}
	}
	return { people, unions };
}

/** Cousin marriages in every generation: two couples, each with a son and a daughter; the cousins of the two couples marry (for `gens` generations). */
export function collapseModel(gens: number): GenModel {
	const people: GenPerson[] = [];
	const unions: GenUnion[] = [];
	const add = (id: string, sex: string, parents: string[]) => people.push({ id, name: id.toUpperCase(), sex, parents: parents.map((p) => ({ id: p, type: 'birth' as const })) });
	// Generation 0: two couples whose children are first cousins would need a shared grandparent couple; start with one couple and their four children.
	add('a0', 'm', []);
	add('b0', 'f', []);
	unions.push({ a: 'a0', b: 'b0' });
	let couples: [string, string][] = [['a0', 'b0']];
	// The first couple has two sons and two daughters; their pairs form the two couples of generation 1 (siblings marry once, then cousins follow).
	for (let g = 1; g <= gens; g++) {
		const kids: { m: string; f: string }[] = [];
		couples.forEach(([m, f], c) => {
			const sons = g === 1 ? 2 : 1;
			const daughters = g === 1 ? 2 : 1;
			const mk = (sex: string, k: number) => {
				const id = `${sex}${g}_${c}_${k}`;
				add(id, sex, [m, f]);
				return id;
			};
			const son = Array.from({ length: sons }, (_, k) => mk('m', k));
			const dau = Array.from({ length: daughters }, (_, k) => mk('f', k));
			kids.push({ m: son[0], f: dau[0] });
			if (g === 1) kids.push({ m: son[1], f: dau[1] });
		});
		// Cross the pairs: the son of one couple marries the daughter of the other.
		const next: [string, string][] = [];
		if (kids.length === 1) {
			next.push([kids[0].m, kids[0].f]);
		} else {
			next.push([kids[0].m, kids[1].f]);
			next.push([kids[1].m, kids[0].f]);
		}
		for (const [m, f] of next) unions.push({ a: m, b: f });
		couples = next;
	}
	return { people, unions };
}

/** One person with `k` partners (unions in list order), each with one or two children. */
export function manyPartnersModel(k: number): GenModel {
	const people: GenPerson[] = [{ id: 'h', name: 'Hub', sex: 'm', parents: [] }];
	const unions: GenUnion[] = [];
	for (let i = 0; i < k; i++) {
		people.push({ id: `w${i}`, name: `W${i}`, sex: 'f', parents: [] });
		unions.push({ a: 'h', b: `w${i}`, ...(i % 4 === 3 ? { type: 'concubinage' } : {}) });
		const kids = 1 + (i % 2);
		for (let c = 0; c < kids; c++) people.push({ id: `c${i}_${c}`, name: `C${i}.${c}`, sex: c % 2 ? 'f' : 'm', parents: [{ id: 'h', type: 'birth' }, { id: `w${i}`, type: 'birth' }] });
	}
	return { people, unions };
}

/** A person (`k`) with two birth parents and `n` rumoured parents (3 to 12), over a small family. */
export function rumouredModel(n: number): GenModel {
	const people: GenPerson[] = [
		{ id: 'f', name: 'Father', sex: 'm', parents: [] },
		{ id: 'm', name: 'Mother', sex: 'f', parents: [] },
	];
	for (let i = 0; i < n; i++) people.push({ id: `r${i}`, name: `R${i}`, sex: i % 2 ? 'f' : 'm', parents: [] });
	people.push({
		id: 'k',
		name: 'Kid',
		sex: 'f',
		parents: [{ id: 'f', type: 'birth' }, { id: 'm', type: 'birth' }, ...Array.from({ length: n }, (_, i) => ({ id: `r${i}`, type: 'rumoured' as const }))],
	});
	people.push({ id: 'sib', name: 'Sibling', sex: 'm', parents: [{ id: 'f', type: 'birth' }, { id: 'm', type: 'birth' }] });
	people.push({ id: 'kk', name: 'Kids Kid', sex: 'm', parents: [{ id: 'k', type: 'birth' }] });
	return { people, unions: [{ a: 'f', b: 'm' }] };
}

/** Tree text that is a deliberate mix of odd things: a cycle of three, a self-parent, a missing parent, a duplicate parent entry. */
export function oddText(): string {
	return [
		'people:',
		'  - {id: a, name: A, parents: [c]}',
		'  - {id: b, name: B, parents: [a]}',
		'  - {id: c, name: C, parents: [b]}',
		'  - {id: s, name: Self, parents: [s]}',
		'  - {id: m, name: Missing, parents: [nobody]}',
		'  - {id: d, name: Dup, parents: [a, a, {id: a, type: adoptive}]}',
		'unions:',
		'  - {partners: [a, a]}',
		'  - {partners: [a, nobody]}',
		'',
	].join('\n');
}

/** A cheap hash of text (cyrb53) for "the same layout twice". */
export function hashText(s: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Fisher-Yates with the seeded generator. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
	const rand = rng(seed);
	const out = [...xs];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
