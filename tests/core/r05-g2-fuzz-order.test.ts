// G2 of 1a-B (fuzz), focus 5: words with years never depend on the order of the people, the parents or the unions.
import { describe, expect, it } from 'vitest';
import { rng } from '../support/rng';
import { graphOf, p, w, wordsOf, type Tree, type Who, type Wed } from './r05-marriage-years-trees';

function shuffled<T>(list: T[], rand: () => number): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** Founders, couples with kids, remarriages, rumoured and adoptive links, dates at random (some inexact, some missing). */
function randomTree(rand: () => number, rumours: boolean): Tree {
	const pick = <T>(l: T[]) => l[Math.floor(rand() * l.length)];
	const year = (lo: number, hi: number) => String(lo + Math.floor(rand() * (hi - lo + 1)));
	const date = (lo: number, hi: number, missing = 0.15) => { const r = rand(); if (r < missing) return undefined; const y = year(lo, hi); return r < missing + 0.07 ? `c. ${y}` : y; };
	const people: Who[] = [];
	const unions: Wed[] = [];
	const add = (id: string, born?: string, died?: string, parents: string[] = []) => people.push(p(id, rand() < 0.1 ? undefined : (rand() < 0.5 ? 'm' : 'f'), born, died, parents));
	const link = (id: string) => { const r = rand(); return !rumours || r > 0.2 ? id : r < 0.1 ? `${id}:rumoured` : `${id}:adoptive`; };
	const n0 = 4;
	for (let i = 0; i < n0; i++) add(`a${i}`, date(1000, 1040), date(1060, 1110, 0.4));
	const gen = (prev: string[], tag: string, count: number, lo: number): string[] => {
		const out: string[] = [];
		for (let i = 0; i < count; i++) {
			const par = shuffled(prev, rand).slice(0, 1 + Math.floor(rand() * 2)).map(link);
			const id = `${tag}${i}`;
			add(id, date(lo, lo + 30), date(lo + 40, lo + 90, 0.5), par);
			out.push(id);
		}
		return out;
	};
	const g1 = gen(['a0', 'a1', 'a2', 'a3'], 'b', 5, 1040);
	const g2 = gen(g1, 'c', 5, 1075);
	const g3 = gen(g2, 'd', 3, 1110);
	const all = [...['a0', 'a1', 'a2', 'a3'], ...g1, ...g2, ...g3];
	const nu = 4 + Math.floor(rand() * 5);
	for (let i = 0; i < nu; i++) {
		const a = pick(all);
		let b = pick(all);
		if (a === b) b = pick(all.filter((x) => x !== a));
		if (unions.some((u) => u.partners.includes(a) && u.partners.includes(b)) && rand() < 0.5) continue;
		const s = date(1030, 1140, 0.3);
		const e = rand() < 0.6 ? date(1040, 1160, 0.2) : undefined;
		const by = rand() < 0.35 ? pick(['divorce', 'death', 'annulment', 'separation']) : undefined;
		unions.push(w(a, b, { ...(s ? { start: s } : {}), ...(e ? { end: e } : {}), ...(by ? { endedBy: by } : {}) }));
	}
	return { people, unions };
}

const ids = (t: Tree) => t.people.map((x) => x.id);
const read = (t: Tree, g: ReturnType<typeof graphOf>, on: boolean) => ids(t).flatMap((a) => ids(t).filter((b) => b !== a).map((b) => `${a}>${b} ${wordsOf(g, a, b, { oneParentUnknown: on })}`));

describe('G2 1a-B focus 5: order independence (fuzz)', () => {
	for (const rumours of [false, true]) {
		it(`random trees, rumours ${rumours}`, () => {
			const rand = rng(rumours ? 5051 : 5050);
			const bad: string[] = [];
			let formers = 0;
			for (let round = 0; round < 25 && bad.length < 6; round++) {
				const t = randomTree(rand, rumours);
				let g;
				try { g = graphOf(t); } catch { continue; }
				for (const on of [true, false]) {
					const want = read(t, g, on);
					formers += want.filter((l) => /former/i.test(l)).length;
					for (let k = 0; k < 3; k++) {
						const people = shuffled(t.people, rand).map((x) => ({ ...x, parents: shuffled(x.parents ?? [], rand) }));
						// Union order only decides the word type when types differ; every union here has the same (unknown) type.
						const unions = shuffled(t.unions, rand);
						const got = read(t, graphOf(t, undefined, people, unions), on);
						const d = want.findIndex((l, i) => l !== got[i]);
						if (d >= 0) { bad.push(`round ${round} on=${on}: ${want[d]}  VS  ${got[d]}`); break; }
					}
				}
			}
			expect(bad).toEqual([]);
			expect(formers).toBeGreaterThan(0);
		}, 600000);
	}
});
