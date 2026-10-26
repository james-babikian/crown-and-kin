// G2 of 1a-B (fuzz), focus 5: words with years never depend on the order of the people, the parents or the unions.
import { describe, expect, it } from 'vitest';
import { rng } from '../support/rng';
import { graphOf, p, w, type Tree, type Who, type Wed } from './r05-marriage-years-trees';
import { computeRelations } from '../../src/core/relations';

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


// An independent oracle for rule 1 step-parents and their possessive forms, written from RULES §A and §2.1 only (no rumoured or adoptive links).
const ex = (t?: string) => (t !== undefined && /^-?\d{1,4}$/.test(t.trim()) ? Number(t.trim()) : undefined);
function oracle(t: Tree, m: string, pp: string): string[] {
	const who = new Map(t.people.map((x) => [x.id, x]));
	const sexWord = (id: string, a: string, b: string, c: string) => (who.get(id)?.sex === 'm' ? a : who.get(id)?.sex === 'f' ? b : c);
	const out = new Set<string>();
	const parents = (who.get(m)?.parents ?? []).filter((x) => !x.includes(':'));
	for (const r of parents) {
		const us = t.unions.filter((u) => u.partners.includes(r) && u.partners.includes(pp));
		if (!us.length) continue;
		const info = (u: Wed) => {
			const [a, b] = u.partners;
			const end = ex(u.end), start = ex(u.start), da = ex(who.get(a)?.died), db = ex(who.get(b)?.died);
			const by = u.endedBy?.trim().toLowerCase();
			const ended = by === 'divorce' || by === 'annulment' || (by !== 'death' && end !== undefined && da !== undefined && db !== undefined && end < da && end < db);
			const stops = [end, da, db].filter((v): v is number => v !== undefined);
			const starts = [start, ex(who.get(a)?.born), ex(who.get(b)?.born)].filter((v): v is number => v !== undefined);
			return { ended, end, stop: stops.length ? Math.min(...stops) : undefined, start: starts.length ? Math.max(...starts) : undefined };
		};
		const infos = us.map(info);
		const born = ex(who.get(m)?.born), died = ex(who.get(m)?.died);
		const apart = (i: ReturnType<typeof info>) => (i.stop !== undefined && born !== undefined && i.stop < born) || (i.start !== undefined && died !== undefined && i.start > died);
		const former = (i: ReturnType<typeof info>) => i.ended && (i.end === undefined || !(died !== undefined && died < i.end));
		const passing = infos.filter((i) => !apart(i));
		const parentWord = sexWord(r, 'Father', 'Mother', 'Parent');
		const spouse = sexWord(pp, 'husband', 'wife', 'spouse');
		if (passing.length) {
			const isFormer = passing.every(former);
			out.add(isFormer ? `Former ${sexWord(pp, 'stepfather', 'stepmother', 'step-parent')}` : sexWord(pp, 'Stepfather', 'Stepmother', 'Step-parent'));
		} else {
			out.add(`${parentWord}’s ${infos.every((i) => i.ended) ? 'former ' : ''}${spouse}`);
		}
	}
	// Rule D: one name for one tie.
	const list = [...out];
	return list.filter((x) => !(/^Former /.test(x) && list.includes(x.slice(7).replace(/^./, (c) => c.toUpperCase()))) && !(/’s former /.test(x) && list.includes(x.replace('former ', ''))));
}

describe('G2 1a-B focus 5: rule 1 step-parent oracle (fuzz, no rumours)', () => {
	it('step-parent and possessive names agree with an independent oracle', () => {
		const rand = rng(9091);
		const bad: string[] = [];
		let checked = 0;
		for (let round = 0; round < 600 && bad.length < 6; round++) {
			const t = randomTree(rand, false);
			let g;
			try { g = graphOf(t); } catch { continue; }
			for (const m of t.people.map((x) => x.id)) {
				const rels = computeRelations(g, m);
				for (const pp of t.people.map((x) => x.id)) {
					if (pp === m) continue;
					const list = rels.get(pp) ?? [];
					if (list.some((r) => r.kind === 'blood')) continue;
					const actual = list.filter((r) => r.kind === 'by-marriage' && /^(Former )?(Stepmother|Stepfather|Step-parent)$|^(Father|Mother|Parent)’s (former )?(wife|husband|spouse)$/i.test(r.text)).map((r) => r.text).sort();
					const want = oracle(t, m, pp).sort();
					checked++;
					if (JSON.stringify(actual) !== JSON.stringify(want)) bad.push(`round ${round} ${m}>${pp}: actual ${JSON.stringify(actual)} want ${JSON.stringify(want)}`);
				}
			}
		}
		expect(bad).toEqual([]);
		expect(checked).toBeGreaterThan(0);
	}, 600000);
});

function oracle2(t: Tree, m: string, pp: string): string[] {
	const who = new Map(t.people.map((x) => [x.id, x]));
	const sexWord = (id: string, a: string, b: string, c: string) => (who.get(id)?.sex === 'm' ? a : who.get(id)?.sex === 'f' ? b : c);
	const out = new Set<string>();
	const pars = (who.get(pp)?.parents ?? []).filter((x) => !x.includes(':'));
	if (pars.includes(m)) return [];
	for (const sp of pars) {
		const us = t.unions.filter((u) => u.partners.includes(m) && u.partners.includes(sp));
		if (!us.length) continue;
		const info = (u: Wed) => {
			const [a, b] = u.partners;
			const end = ex(u.end), start = ex(u.start), da = ex(who.get(a)?.died), db = ex(who.get(b)?.died);
			const by = u.endedBy?.trim().toLowerCase();
			const ended = by === 'divorce' || by === 'annulment' || (by !== 'death' && end !== undefined && da !== undefined && db !== undefined && end < da && end < db);
			const stops = [end, da, db].filter((v): v is number => v !== undefined);
			const starts = [start, ex(who.get(a)?.born), ex(who.get(b)?.born)].filter((v): v is number => v !== undefined);
			return { ended, end, stop: stops.length ? Math.min(...stops) : undefined, start: starts.length ? Math.max(...starts) : undefined };
		};
		const infos = us.map(info);
		const born = ex(who.get(pp)?.born), died = ex(who.get(pp)?.died);
		const apart = (i: ReturnType<typeof info>) => (i.stop !== undefined && born !== undefined && i.stop < born) || (i.start !== undefined && died !== undefined && i.start > died);
		const former = (i: ReturnType<typeof info>) => i.ended && (i.end === undefined || !(died !== undefined && died < i.end));
		const passing = infos.filter((i) => !apart(i));
		if (passing.length) out.add(passing.every(former) ? `Former ${sexWord(pp, 'stepson', 'stepdaughter', 'stepchild')}` : sexWord(pp, 'Stepson', 'Stepdaughter', 'Stepchild'));
		else out.add(`${infos.every((i) => i.ended) ? 'Former ' : ''}${sexWord(sp, 'husband', 'wife', 'spouse')}’s ${sexWord(pp, 'son', 'daughter', 'child')}`);
	}
	const list = [...out];
	return list.filter((x) => !(/^Former /.test(x) && list.includes(x.slice(7).replace(/^./, (c) => c.toUpperCase()))) && !(/^Former /.test(x) && list.includes(x.slice(7))));
}

describe('G2 1a-B focus 5: rule 2 stepchild oracle (fuzz, no rumours)', () => {
	it('stepchild and possessive names agree with an independent oracle', () => {
		const rand = rng(9092);
		const bad: string[] = [];
		let nonEmpty = 0;
		for (let round = 0; round < 600 && bad.length < 6; round++) {
			const t = randomTree(rand, false);
			let g;
			try { g = graphOf(t); } catch { continue; }
			for (const m of t.people.map((x) => x.id)) {
				const rels = computeRelations(g, m);
				for (const pp of t.people.map((x) => x.id)) {
					if (pp === m) continue;
					const list = rels.get(pp) ?? [];
					if (list.some((r) => r.kind === 'blood')) continue;
					const actual = list.filter((r) => r.kind === 'by-marriage' && /^(Former )?(Stepson|Stepdaughter|Stepchild)$|^(Former )?(husband|wife|spouse)’s (son|daughter|child)$/i.test(r.text)).map((r) => r.text).sort();
					const want = oracle2(t, m, pp).map((x) => x.replace(/^(husband|wife|spouse)/, (c) => c[0].toUpperCase() + c.slice(1))).sort();
					if (want.length) nonEmpty++;
					if (JSON.stringify(actual) !== JSON.stringify(want)) bad.push(`round ${round} ${m}>${pp}: actual ${JSON.stringify(actual)} want ${JSON.stringify(want)}`);
				}
			}
		}
		expect(bad).toEqual([]);
		expect(nonEmpty).toBeGreaterThan(0);
	}, 600000);
});
