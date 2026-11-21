/*
 * One pass of the succession walks: the line for one illegitimacy reading and one single-sex form of `inherit`. A pass climbs from the
 * ruler to the earlier holders and the ancestors that carry the claim, walks down from each of them with representation (the sort of the
 * children is in `succession-rank.ts`), and for the rules without representation puts the result in order by level or degree.
 * The two lazy sets of a pass (`descends` and `bodySet`) are made on the first need, as before the split.
 */

import { noClimb } from './derive';
import { carries, claimKids, lost, NONE_DRAWN, openBranch, passes, passesP, passRules, personOf, sexOk, stepOf, type EngineCtx, type Item, type PassCtx, type PassInherit } from './succession-ctx';
import { rank } from './succession-rank';
import type { Person } from './types';

/** The parents of x whose link carries a claim, once each, in drawn order. */
function claimParents(p: PassCtx, x: string): string[] {
	const out: string[] = [];
	for (const d of p.e.drawn.get(x) ?? NONE_DRAWN) if (carries(p.e, d, personOf(p.e, x), p.illOn) && !out.includes(d.id)) out.push(d.id);
	return out;
}

/**
 * The people who descend from an earlier holder through people who pass (the holder is not tested). Made on the
 * first need: the climb asks only when a person has several claim parents and none of them held the title.
 */
function descendsFrom(p: PassCtx, id: string): boolean {
	if (!p.descends) {
		const descends = new Set<string>();
		p.descends = descends;
		const opened = new Set<string>();
		for (const h of p.e.hold.earlier) {
			if (opened.has(h)) continue;
			opened.add(h);
			const stack = [h];
			while (stack.length) {
				for (const k of claimKids(p, stack.pop()!)) {
					if (descends.has(k.id)) continue;
					descends.add(k.id);
					if (!opened.has(k.id) && passesP(p, k)) {
						opened.add(k.id);
						stack.push(k.id);
					}
				}
			}
		}
	}
	return p.descends.has(id);
}

/**
 * The first holder and the people who descend from the first holder through people who pass (the holder is not
 * tested). Made on the first need; each pass has its own, as its reading of `illegitimacy` and its sex test can differ.
 */
function inBody(p: PassCtx, id: string): boolean {
	if (!p.bodySet) {
		const body = p.e.body!;
		const set = new Set([body]);
		p.bodySet = set;
		const stack = [body];
		while (stack.length) {
			for (const k of claimKids(p, stack.pop()!)) {
				if (set.has(k.id)) continue;
				set.add(k.id);
				if (passesP(p, k)) stack.push(k.id);
			}
		}
	}
	return p.bodySet.has(id);
}

/** The parents in the order of the note: the preferred sex first, then the order of `parents` in the note; the drawn order only lists the parents. */
function orderParents(p: PassCtx, x: string, ids: string[]): string[] {
	if (ids.length < 2) return ids;
	const written = personOf(p.e, x).parents;
	const at = (id: string) => {
		const i = written.findIndex((r) => r.id === id);
		return i < 0 ? Infinity : i;
	};
	const inNote = ids.slice().sort((a, b) => at(a) - at(b));
	const pref = p.parentPref;
	return pref === undefined ? inNote : [...inNote.filter((q) => personOf(p.e, q).sex === pref), ...inNote.filter((q) => personOf(p.e, q).sex !== pref)];
}

/** The parents followed from x. With the switch on, only parents in the body, over claim links. */
function nextParents(p: PassCtx, x: string): string[] {
	const e = p.e;
	const holders: string[] = [];
	for (const d of e.drawn.get(x) ?? []) {
		if (noClimb(d.type) || !e.hold.earlier.has(d.id) || holders.includes(d.id)) continue;
		if (e.body !== undefined && !(carries(e, d, personOf(e, x), p.illOn) && inBody(p, d.id))) continue;
		if (e.spec.inheritThrough === undefined || passes(p, d.id)) holders.push(d.id);
	}
	if (holders.length) return orderParents(p, x, holders);
	const followed = claimParents(p, x).filter((q) => passes(p, q)).filter((q) => e.body === undefined || inBody(p, q));
	const near = followed.length < 2 ? followed : followed.filter((q) => e.hold.earlier.has(q) || descendsFrom(p, q));
	return orderParents(p, x, near.length ? near : followed);
}

/** `up`: R and the ancestors that carry the claim, breadth first, with their distance from R. */
function climbUp(p: PassCtx): { up: string[]; dist: Map<string, number> } {
	const R = p.e.R;
	const up = [R];
	const dist = new Map<string, number>([[R, 0]]);
	for (let i = 0; i < up.length; i++) {
		for (const q of nextParents(p, up[i])) {
			if (dist.has(q)) continue;
			dist.set(q, dist.get(up[i])! + 1);
			up.push(q);
		}
	}
	return { up, dist };
}

/** Everyone above R over claim links, passing or not: none of them is ever in the line. */
function ancestorsOf(p: PassCtx): Set<string> {
	const ancestors = new Set<string>();
	for (const stack = [p.e.R]; stack.length; ) {
		for (const q of claimParents(p, stack.pop()!)) {
			if (ancestors.has(q)) continue;
			ancestors.add(q);
			stack.push(q);
		}
	}
	return ancestors;
}

const REACHED = 1;
const WALKED = 2;
const BLOCKED = 4;

/** For each person: reached, walked, or never in the line (R, `up`, the ancestors, the excluded, and the people that S2 blocks). */
function initFlags(p: PassCtx, up: string[], ancestors: ReadonlySet<string>): Uint8Array {
	const e = p.e;
	const flags = new Uint8Array(e.size);
	const block = (id: string) => {
		const x = e.g.byId.get(id);
		if (x) flags[x.index] |= BLOCKED;
	};
	up.forEach(block);
	ancestors.forEach(block);
	e.excluded.forEach(block);
	// S2, D195: the co-rulers and the holder of a keyed entry are never in the line, but they still pass a claim.
	e.hold.blocked.forEach(block);
	return flags;
}

/** One entry of the walk: a person, or an open branch. */
interface Out {
	x: Person;
	branch: boolean;
}

/** May the walk go on to the children of a person? */
function walkOk(p: PassCtx, c: Person): boolean {
	if (p.needs === undefined || c.sex === p.needs) return true;
	if (claimKids(p, c.id).length) lost(p, c);
	return false;
}

/** Whether the walk follows the claim children of an ancestor of the ruler at all. */
const walkable = (p: PassCtx, u: string): boolean => p.e.spec.inheritThrough === undefined || passes(p, u);

/** The walk with representation from one person of `up`. Iterative: a house can be hundreds of generations deep. */
function walkFrom(p: PassCtx, flags: Uint8Array, outP: Out[], start: string): void {
	const e = p.e;
	const s0 = personOf(e, start);
	if (flags[s0.index] & WALKED) return;
	flags[s0.index] |= WALKED;
	const lists: Person[][] = [rank(p, start)];
	const at: number[] = [0];
	while (lists.length) {
		const top = lists.length - 1;
		const kids = lists[top];
		if (at[top] >= kids.length) {
			lists.pop();
			at.pop();
			continue;
		}
		const c = kids[at[top]++];
		const free = !(flags[c.index] & (REACHED | BLOCKED));
		if (free && e.life.alive(c)) {
			if (sexOk(p, c)) {
				flags[c.index] |= REACHED;
				outP.push({ x: c, branch: false });
			} else lost(p, c);
		} else if (free && sexOk(p, c)) e.life.reach(c);
		if (!(flags[c.index] & WALKED)) {
			if (walkOk(p, c)) {
				flags[c.index] |= WALKED;
				// A person who passes a claim and is an open branch stands here, where the children would be walked.
				if (openBranch(e, c)) outP.push({ x: c, branch: true });
				lists.push(rank(p, c.id));
				at.push(0);
			} else if (c.sex !== 'm' && c.sex !== 'f' && openBranch(e, c)) lost(p, c);
		}
	}
}

/**
 * The least value over the paths down from the sources, in one pass: each source starts with its own value, a child is one more than its
 * parent, and a person who does not pass a claim on (a source excepted) ends a path.
 */
function reachFrom(size: number, sources: { x: Person; v: number }[], claimKidsOf: (id: string) => readonly Person[], passesOf: (x: Person) => boolean): Int32Array {
	const best = new Int32Array(size);
	const done = new Uint8Array(size);
	const starts = sources.slice().sort((a, b) => a.v - b.v);
	const isSource = new Uint8Array(size);
	for (const st of starts) isSource[st.x.index] = 1;
	const qx: Person[] = [];
	const qv: number[] = [];
	let s = 0;
	let h = 0;
	while (s < starts.length || h < qx.length) {
		const fromQueue = h < qx.length && (s >= starts.length || qv[h] <= starts[s].v);
		const x = fromQueue ? qx[h] : starts[s].x;
		const v = fromQueue ? qv[h++] : starts[s++].v;
		if (done[x.index]) continue;
		done[x.index] = 1;
		best[x.index] = v;
		if (!isSource[x.index] && !passesOf(x)) continue;
		for (const k of claimKidsOf(x.id)) {
			if (done[k.index]) continue;
			qx.push(k);
			qv.push(v + 1);
		}
	}
	return best;
}

const asItem = (o: Out): Item => (o.branch ? { id: o.x.id, branch: true } : { id: o.x.id });

/** Descendants of R: those reached from R alone through people who pass. */
function fromRFlags(p: PassCtx): Uint8Array {
	const R = p.e.R;
	const fromR = new Uint8Array(p.e.size);
	if (walkable(p, R)) {
		for (const stack = [R]; stack.length; ) {
			for (const k of claimKids(p, stack.pop()!)) {
				if (fromR[k.index]) continue;
				fromR[k.index] = 1;
				if (passesP(p, k)) stack.push(k.id);
			}
		}
	}
	return fromR;
}

/** The rules without representation: level and degree from one pass over all people of `up`. */
function byLevelOrDegree(p: PassCtx, outP: Out[], up: string[], dist: Map<string, number>): Item[] {
	const e = p.e;
	const sources = up.filter((u) => walkable(p, u));
	const reach = (sign: 1 | -1) => reachFrom(e.size, sources.map((u) => ({ x: personOf(e, u), v: sign * dist.get(u)! })), (id) => claimKids(p, id), (x) => passesP(p, x));
	if (e.rule === 'siblings-first') {
		const level = reach(-1);
		const keyed = outP.map((o, i) => ({ o, i, a: level[o.x.index] + (o.branch ? 1 : 0), b: o.branch ? 0 : stepOf(p, o.x) }));
		keyed.sort((m, n) => m.a - n.a || m.b - n.b || m.i - n.i);
		return keyed.map((k) => asItem(k.o));
	}
	const degree = reach(1);
	const fromR = fromRFlags(p);
	const keyed = outP.map((o, i) => ({ o, i, a: degree[o.x.index] + (o.branch ? 1 : 0), b: fromR[o.x.index] ? 0 : 1, c: o.branch ? 0 : stepOf(p, o.x) }));
	keyed.sort((m, n) => m.a - n.a || m.b - n.b || m.c - n.c || m.i - n.i);
	return keyed.map((k) => asItem(k.o));
}

/** One pass: the line for one illegitimacy reading and one single-sex form of `inherit`. */
export function makePass(e: EngineCtx, illOn: boolean, inh: PassInherit): Item[] {
	const p = passRules(e, illOn, inh);
	const { up, dist } = climbUp(p);
	// A pass whose climb does not reach the first holder has no line.
	if (e.body !== undefined) {
		if (!dist.has(e.body)) {
			e.lapsed++;
			return [];
		}
		e.reached++;
	}
	const flags = initFlags(p, up, ancestorsOf(p));
	const outP: Out[] = [];
	for (const u of up) if (walkable(p, u)) walkFrom(p, flags, outP, u);
	if (e.rule !== 'siblings-first' && e.rule !== 'nearest-relative') return outP.map(asItem);
	return byLevelOrDegree(p, outP, up, dist);
}
