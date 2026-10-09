import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import { specOf, successionLine, type SuccessionResult, type SuccessionSpec } from '../../src/core/succession';
import { INHERIT_RULES, INHERIT_THROUGH, SUCCESSION_RULES } from '../../src/core/succession-keys';

/*
 * Version 0.2.7, WP2: properties of `successionLine` on seeded random trees (with half-siblings, adoptions, wards,
 * rumoured parents, flagged children, dead people, early holders). The properties come from the contract and are
 * checked with code that does not use the engine:
 *  - the shape of every line (C.5, C.6, B.5, K.2): no repeats, not the ruler, no claim ancestor of the ruler, only
 *    people alive, a person of the right sex under a one-sex rule, a descendant of the ruler, of an ancestor or of
 *    an earlier holder;
 *  - the length (C.10): a short line is the start of the long line, and `more` tells whether people are left;
 *  - the two-pass rules (C.4a, C.8a): "after" is the line of "no", then the people that only "equal" has;
 *    "men first in the whole house" is the line of "men only", then the people that only "men first" has (and the
 *    mirror with women); the two together are nested as C.8a says (the illegitimacy passes are outside);
 *  - exclusion is personal (K.3): the line with an excluded person is the line without, minus that person;
 *  - the call is pure.
 * These tests wait for WP 2 (`src/core/succession.ts`).
 * Run: npx vitest run tests/acceptance/r027-succession-fuzz.test.ts
 */

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

interface Made {
	source: string;
	/** The ruler, and the earlier holder if there is one. */
	ruler: string;
	earlier?: string;
}

/** A random tree with one title `duke`: people with sex, birth and death years, parents of every type, flags. */
function made(seed: number): Made {
	const rand = rng(seed * 7919 + 13);
	const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
	const n = 6 + Math.floor(rand() * 17);
	const people: string[] = [];
	for (let i = 0; i < n; i++) {
		const parents: string[] = [];
		if (i > 1 && rand() < 0.75) {
			const before = Array.from({ length: i }, (_, k) => `p${k}`);
			const a = pick(before);
			parents.push(a);
			if (rand() < 0.6) {
				const b = pick(before.filter((x) => x !== a));
				if (b) parents.push(b);
			}
		}
		const typed = parents.map((p) => {
			const r = rand();
			return r < 0.82 ? p : r < 0.9 ? `{id: ${p}, type: adoptive}` : r < 0.95 ? `{id: ${p}, type: ward}` : `{id: ${p}, type: rumoured}`;
		});
		const sx = rand();
		const sex = sx < 0.45 ? ', sex: m' : sx < 0.9 ? ', sex: f' : sx < 0.95 ? ', sex: x' : '';
		const born = 1100 + i * 6 + Math.floor(rand() * 5);
		const died = rand() < 0.25 ? `, died: ${born + 20 + Math.floor(rand() * 40)}` : '';
		const ill = rand() < 0.12 ? ', illegitimate: true' : '';
		people.push(`  - {id: p${i}, name: P${i}${sex}, born: ${born}${died}${typed.length ? `, parents: [${typed.join(', ')}]` : ''}${ill}}`);
	}
	const r = 2 + Math.floor(rand() * (n - 2));
	const ruler = `p${r}`;
	const holders: string[] = [];
	let earlier: string | undefined;
	if (rand() < 0.4) {
		earlier = `p${Math.floor(rand() * r)}`;
		holders.push(`{person: ${earlier}, from: 1200, to: 1300}`);
	}
	holders.push(`{person: ${ruler}, from: 1300}`);
	return { source: ['people:', ...people, '', 'titles:', '  - id: duke', '    name: Duke', '    holders:', ...holders.map((h) => `      - ${h}`), ''].join('\n'), ruler, earlier };
}

function graphOf(source: string): FamilyGraph {
	const p = parseDynasty(source);
	if (!p.ok) throw new Error(`bad tree ${p.error.code}`);
	return deriveFamilies(p.tree);
}

const BIG = 1000;
const merge = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];

describe('succession on random trees: the properties of the contract', () => {
	for (let seed = 1; seed <= 150; seed++) {
		it(`seed ${seed}`, () => {
			const m = made(seed);
			const rand = rng(seed * 104729 + 7);
			const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
			const g = graphOf(m.source);
			const title = g.titles[0];
			const titleJson = JSON.stringify(title);
			const ids = g.people.map((p) => p.id);
			const sexOf = (id: string) => g.byId.get(id)!.sex;
			const dead = (id: string) => g.byId.get(id)!.died !== undefined;

			for (let run = 0; run < 5; run++) {
				const spec: SuccessionSpec = {
					...specOf(title),
					rule: pick(SUCCESSION_RULES),
					inherit: pick(INHERIT_RULES),
					illegitimate: pick(['no', 'after', 'equal'] as const),
					adopted: rand() < 0.4,
				};
				if (rand() < 0.4) spec.inheritThrough = pick(INHERIT_THROUGH);
				const label = JSON.stringify(spec);
				const at = (s: SuccessionSpec, limit = BIG): SuccessionResult => successionLine(g, title, s, limit, 110);
				const full = at(spec);

				// ---- The shape of the line ----
				expect(full.kind, label).toBe('line');
				expect(full.ruler, label).toBe(m.ruler);
				const heirs = full.heirs;
				expect(new Set(heirs).size, label).toBe(heirs.length);
				expect(heirs, label).not.toContain(m.ruler);
				for (const h of heirs) {
					expect(ids, label).toContain(h);
					expect(dead(h), `${label}: ${h} is dead`).toBe(false);
				}

				// Claim ancestors of the ruler (children link to parents; birth, and adoptive when the switch is on). A flagged child
				// has no claim over its birth parents when the key is "no", so that link is not a claim link.
				const claimParents = (id: string, s: SuccessionSpec): string[] => {
					const p = g.byId.get(id)!;
					const flagged = p.illegitimate === true;
					return p.parents
						.filter((l) => {
							const type = l.type ?? 'birth';
							if (type === 'adoptive') return s.adopted;
							if (type === 'ward' || type === 'rumoured') return false;
							return !flagged || s.illegitimate !== 'no';
						})
						.map((l) => l.id)
						.filter((x) => g.byId.has(x));
				};
				// An upper bound for the roots of the walks: the ruler, the earlier holder, and everybody above them over any link.
				const above = (start: string): Set<string> => {
					const seen = new Set<string>([start]);
					const queue = [start];
					while (queue.length) {
						const x = queue.pop()!;
						for (const l of g.byId.get(x)!.parents) {
							if (!g.byId.has(l.id) || seen.has(l.id)) continue;
							seen.add(l.id);
							queue.push(l.id);
						}
					}
					return seen;
				};
				const roots = new Set<string>([...above(m.ruler), ...(m.earlier ? above(m.earlier) : [])]);
				const claimAbove = (start: string): Set<string> => {
					const seen = new Set<string>([start]);
					const queue = [start];
					while (queue.length) {
						const x = queue.pop()!;
						for (const q of claimParents(x, spec)) {
							if (seen.has(q)) continue;
							seen.add(q);
							queue.push(q);
						}
					}
					return seen;
				};
				const ancestors = claimAbove(m.ruler);
				const descendsFromRoot = (id: string): boolean => {
					const seen = new Set<string>();
					const queue = [id];
					while (queue.length) {
						const x = queue.pop()!;
						if (roots.has(x)) return true;
						for (const q of claimParents(x, spec)) {
							if (seen.has(q)) continue;
							seen.add(q);
							queue.push(q);
						}
					}
					return false;
				};
				for (const h of heirs) {
					expect(ancestors.has(h) && h !== m.ruler, `${label}: ${h} is an ancestor of the ruler`).toBe(false);
					expect(descendsFromRoot(h), `${label}: ${h} descends from nobody of the walks`).toBe(true);
					if (spec.inherit === 'men-only') expect(sexOf(h), `${label}: ${h}`).toBe('m');
					if (spec.inherit === 'women-only') expect(sexOf(h), `${label}: ${h}`).toBe('f');
					if (spec.illegitimate === 'no' && !spec.adopted) {
						expect(g.byId.get(h)!.illegitimate === true && g.byId.get(h)!.parents.every((l) => (l.type ?? 'birth') === 'birth'), `${label}: ${h} is flagged`).toBe(false);
					}
				}

				// ---- The length ----
				for (const limit of [1, 2, 3, 5]) {
					const cut = at(spec, limit);
					expect(cut.heirs, `${label} limit ${limit}`).toEqual(heirs.slice(0, limit));
					expect(cut.more, `${label} limit ${limit}`).toBe(heirs.length > limit);
				}

				// ---- The two-pass rules ----
				const pass = (change: Partial<SuccessionSpec>) => at({ ...spec, ...change }).heirs;
				if (spec.illegitimate === 'after') expect(heirs, `${label}: after = no, then equal`).toEqual(merge(pass({ illegitimate: 'no' }), pass({ illegitimate: 'equal' })));
				if (spec.inherit === 'men-first-in-house') {
					const house = (ill: SuccessionSpec['illegitimate']) => merge(pass({ inherit: 'men-only', illegitimate: ill }), pass({ inherit: 'men-first', illegitimate: ill }));
					expect(heirs, `${label}: house form`).toEqual(spec.illegitimate === 'after' ? merge(house('no'), house('equal')) : house(spec.illegitimate));
				}
				if (spec.inherit === 'women-first-in-house') {
					const house = (ill: SuccessionSpec['illegitimate']) => merge(pass({ inherit: 'women-only', illegitimate: ill }), pass({ inherit: 'women-first', illegitimate: ill }));
					expect(heirs, `${label}: house form`).toEqual(spec.illegitimate === 'after' ? merge(house('no'), house('equal')) : house(spec.illegitimate));
				}

				// ---- Exclusion is personal (K.3) ----
				if (heirs.length > 0) {
					const out = pick(heirs);
					expect(pass({ exclude: [out] }), `${label}: exclude ${out}`).toEqual(heirs.filter((x) => x !== out));
				}

				// ---- Named heirs come first, in order, once (K.3) ----
				const alive = ids.filter((id) => !dead(id) && id !== m.ruler);
				if (alive.length >= 2) {
					const named = [pick(alive), pick(alive), pick(alive)];
					const withNamed = at({ ...spec, heirs: named });
					const order = [...new Set(named)];
					expect(withNamed.heirs.slice(0, order.length), `${label}: named ${named}`).toEqual(order);
					expect(new Set(withNamed.heirs).size, label).toBe(withNamed.heirs.length);
					expect(withNamed.heirs.slice(order.length), label).toEqual(heirs.filter((x) => !order.includes(x)));
					expect(withNamed.namedHeirs.filter((n) => n.state === 'first').map((n) => n.id), label).toEqual(order);
				}

				// ---- Purity ----
				expect(at(spec), label).toEqual(full);
				expect(JSON.stringify(title), label).toBe(titleJson);
			}
		});
	}
});
