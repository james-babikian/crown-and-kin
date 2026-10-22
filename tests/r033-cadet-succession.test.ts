/*
 * 0.3.3, owner decision D279 item 1: cadet branches and the line of succession (an internal study).
 *
 * The line of succession never reads the person key `house`. A cadet branch is a person with another `house:` value and
 * `parents: [founder]`; the walk follows birth and adoptive links only (spec §13.21 rules 10, 13, 15).
 *
 * Part A: the 58 hand-written cases of the genealogy vet (data in `r033-cadet-data.ts`). Each case runs three times, as
 *   written, with every `house:` removed, and with the `house:` values moved to other names. The three lines must be equal,
 *   and equal to the line written by hand from the spec.
 *   DOUBT and RISK cases keep the documented result and name the risk of the scope (R2 and so on). If a later rule change
 *   turns one of them red, send the change to the genealogy vet: the new line may be better, but it is a decision.
 * Part B: 300 seeded random trees with four metamorphic checks (house, list order, ids, sexes). The shape invariants of a line
 *   are in tests/acceptance/r027-succession-fuzz.test.ts and are not repeated here.
 *
 * Run: npx vitest run tests/r033-cadet-succession.test.ts
 */

import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../src/core/succession';
import { INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES } from '../src/core/succession-keys';
import { build, CASES, type Case, type HouseMode } from './r033-cadet-data';

function run(src: string, spec: Partial<SuccessionSpec>): SuccessionResult {
	const r = parseDynasty(src);
	if (!r.ok) throw new Error('parse ' + r.error.code);
	const g = deriveFamilies(r.tree);
	const title = g.titles[0];
	return successionLine(g, title, { ...specOf(title), ...spec }, 99, 0);
}

/** The result as one comparable text: heirs, grey rows, and the "not of the body" mark. */
function show(res: SuccessionResult): string {
	const heirs = res.kind === 'line' ? res.heirs.join(' ') : 'kind:' + res.kind;
	return heirs + (res.openBranches.length ? ' | rows ' + res.openBranches.map((x) => x.id).join(' ') : '') + (res.outsideBody ? ' | OUTSIDE' : '');
}

function wanted(c: Case): string {
	return c.want.join(' ') + (c.rows ? ' | rows ' + c.rows.join(' ') : '') + (c.outside ? ' | OUTSIDE' : '');
}

const MODES: HouseMode[] = ['as', 'none', 'shuffle'];

describe('Part A: the cadet cases (scope section 5)', () => {
	it('has the 58 cases of the table, each id once', () => {
		expect(CASES).toHaveLength(58);
		expect(new Set(CASES.map((c) => c.id)).size).toBe(58);
	});

	for (const c of CASES) {
		const tag = c.flag ? ` [${c.flag}${c.risk ? ' ' + c.risk : ''}]` : '';
		it(`${c.id}${tag}: ${c.what}`, () => {
			const lines = MODES.map((m) => show(run(build(c, m), c.spec)));
			// The line is the one that the spec rule gives. For a flagged case this is the documented result: a change here is a decision.
			expect(lines[0]).toBe(wanted(c));
			// The `house` key is not read: removed or moved, the line is the same.
			expect(lines[1]).toBe(lines[0]);
			expect(lines[2]).toBe(lines[0]);
		});
	}

	// Paper cases: the note format cannot express them (scope section 5 F, risks R5 and R14).
	it.todo('CB45 [R14]: a concubine union type does not matter, only the illegitimate flag does; wait for the owner to decide whether the union type should count');
	it.todo('CB46 [R5]: a bastard legitimised in 1160, line for 1150 and for 1170; the format has no date on the flag, so it cannot be written');
});

// ---------- Part B: metamorphic checks on seeded random trees ----------

/** A seeded random source (mulberry32). */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface P { id: string; sex: 'm' | 'f'; born: number; died?: number; parents: string[]; types: string[]; house: string; ill: boolean }
interface Model { people: P[]; holders: string[] }

/** A tree of up to five generations from one dead founder, with houses a, b, c; some flagged, adoptive, ward, rumoured, dead; a chain of one to three holders. */
function genTree(rand: () => number): Model {
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
	const people: P[] = [];
	let n = 0;
	const mk = (parents: P[], born: number): P => {
		const p: P = { id: 'p' + n++, sex: rand() < 0.5 ? 'm' : 'f', born, parents: parents.map((x) => x.id), types: parents.map(() => 'birth'), house: pick(['a', 'b', 'c']), ill: false };
		if (parents.length && rand() < 0.1) p.ill = true;
		if (rand() < 0.35) p.died = born + 20 + Math.floor(rand() * 40);
		people.push(p);
		return p;
	};
	const root = mk([], 1000);
	root.sex = 'm';
	root.died = 1060;
	let gen: P[] = [root];
	for (let g = 1; g <= 4 && gen.length; g++) {
		const next: P[] = [];
		for (const par of gen) {
			const k = Math.floor(rand() * 4);
			for (let i = 0; i < k; i++) next.push(mk([par], par.born + 22 + Math.floor(rand() * 15)));
		}
		gen = next;
	}
	for (const c of people.slice(5)) {
		if (rand() >= 0.08) continue;
		const others = people.filter((x) => x.born < c.born - 15 && !c.parents.includes(x.id));
		if (!others.length) continue;
		c.parents.push(pick(others).id);
		c.types.push(pick(['adoptive', 'ward', 'rumoured']));
	}
	const holders = [root.id];
	let cur = root;
	for (;;) {
		const kids = people.filter((x) => x.parents[0] === cur.id);
		if (!kids.length || holders.length >= 3 || rand() < 0.2) break;
		cur = pick(kids);
		holders.push(cur.id);
	}
	return { people, holders };
}

interface Variant { shuffleHouse?: boolean; reorder?: boolean; mirror?: boolean; rename?: (id: string) => string }

/**
 * The note of a tree, changed as `v` says. `reorder` writes the people in a random order that keeps the written order of
 * any two people who share a parent (the order of siblings is a rule, spec D2); every other order is free.
 */
function textOf(m: Model, v: Variant, rand: () => number): string {
	const id = v.rename ?? ((s: string) => s);
	const sex = (s: 'm' | 'f') => (v.mirror ? (s === 'm' ? 'f' : 'm') : s);
	let list = m.people.slice();
	if (v.reorder) {
		const after = new Map<number, number[]>();
		const indeg = list.map(() => 0);
		const byParent = new Map<string, number[]>();
		list.forEach((p, i) => p.parents.forEach((q) => byParent.set(q, [...(byParent.get(q) ?? []), i])));
		for (const arr of byParent.values()) {
			for (let k = 0; k + 1 < arr.length; k++) {
				after.set(arr[k], [...(after.get(arr[k]) ?? []), arr[k + 1]]);
				indeg[arr[k + 1]]++;
			}
		}
		const out: P[] = [];
		const ready: number[] = [];
		indeg.forEach((d, i) => { if (d === 0) ready.push(i); });
		while (ready.length) {
			const i = ready.splice(Math.floor(rand() * ready.length), 1)[0];
			out.push(list[i]);
			for (const nx of after.get(i) ?? []) if (--indeg[nx] === 0) ready.push(nx);
		}
		list = out;
	}
	const houses = ['a', 'b', 'c'];
	const rows = list.map((p) => {
		const parts = [`id: ${id(p.id)}`, `name: N${p.id}`, `sex: ${sex(p.sex)}`, `born: ${p.born}`];
		if (p.died !== undefined) parts.push(`died: ${p.died}`);
		parts.push(`house: ${v.shuffleHouse ? houses[Math.floor(rand() * 3)] : p.house}`);
		if (p.ill) parts.push('illegitimate: true');
		if (p.parents.length) parts.push(`parents: [${p.parents.map((x, i) => (p.types[i] === 'birth' ? id(x) : `{id: ${id(x)}, type: ${p.types[i]}}`)).join(', ')}]`);
		return `  - {${parts.join(', ')}}`;
	});
	const hs = m.holders.map((h, i) => `      - {person: ${id(h)}, from: ${1000 + 40 * i + 20}${i < m.holders.length - 1 ? `, to: ${1000 + 40 * (i + 1) + 20}` : ''}}`);
	return `people:\n${rows.join('\n')}\ntitles:\n  - id: t1\n    name: T\n    holders:\n${hs.join('\n')}\n`;
}

const MIRROR_INHERIT: Record<string, SuccessionSpec['inherit']> = {
	'men-only': 'women-only',
	'women-only': 'men-only',
	'men-first': 'women-first',
	'women-first': 'men-first',
	'men-first-in-house': 'women-first-in-house',
	'women-first-in-house': 'men-first-in-house',
	'no-preference': 'no-preference',
};
const MIRROR_THROUGH = { men: 'women', women: 'men', anyone: 'anyone' } as const;

/** The result with every id mapped back, so a renamed tree can be compared with the original. */
function outcome(src: string, spec: SuccessionSpec, back: (id: string) => string = (s) => s): string {
	const r = parseDynasty(src);
	if (!r.ok) return 'PARSE ' + r.error.code;
	const g = deriveFamilies(r.tree);
	const res = successionLine(g, g.titles[0], spec, 99, 0);
	const heirs = res.kind === 'line' ? res.heirs.map(back).join(',') : res.kind;
	return heirs + '|' + res.openBranches.map((x) => back(x.id) + '@' + x.before).join(',');
}

const TREES = 300;

describe('Part B: metamorphic checks on seeded random trees', () => {
	it(`${TREES} trees: house, list order, ids and sexes do not change the line`, () => {
		const failures: Record<string, string[]> = { house: [], order: [], rename: [], mirror: [] };
		let withHeirs = 0;
		for (let seed = 1; seed <= TREES; seed++) {
			const rand = rng(seed * 104729 + 7);
			const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
			const m = genTree(rand);
			const spec: SuccessionSpec = { rule: pick(SUCCESSION_RULES), inherit: pick(INHERIT_RULES), illegitimate: pick(['no', 'after', 'equal'] as const), adopted: rand() < 0.5 };
			if (rand() < 0.3) spec.body = true;
			const through = pick([undefined, ...INHERIT_THROUGH]);
			if (through) spec.inheritThrough = through;
			const base = outcome(textOf(m, {}, rand), spec);
			if (!base.startsWith('|')) withHeirs++;
			const rename = (s: string) => 'q' + s.split('').reverse().join('') + 'x';
			const unname = (s: string) => s.slice(1, -1).split('').reverse().join('');
			const checks: [string, string][] = [
				['house', outcome(textOf(m, { shuffleHouse: true }, rand), spec)],
				['order', outcome(textOf(m, { reorder: true }, rand), spec)],
				['rename', outcome(textOf(m, { rename }, rand), spec, unname)],
				['mirror', outcome(textOf(m, { mirror: true }, rand), { ...spec, inherit: MIRROR_INHERIT[spec.inherit], ...(spec.inheritThrough ? { inheritThrough: MIRROR_THROUGH[spec.inheritThrough] } : {}) })],
			];
			for (const [name, got] of checks) if (got !== base) failures[name].push(`seed ${seed} ${JSON.stringify(spec)}\n  base ${base}\n  got  ${got}`);
		}
		expect(failures.house.slice(0, 2)).toEqual([]);
		expect(failures.order.slice(0, 2)).toEqual([]);
		expect(failures.rename.slice(0, 2)).toEqual([]);
		expect(failures.mirror.slice(0, 2)).toEqual([]);
		// The checks must have something to compare: most trees have at least one heir.
		expect(withHeirs).toBeGreaterThan(TREES / 3);
	});
});
