/*
 * The middle class of the search for relation names, `KinBlood`: the blood candidates (shortest paths, the common ancestors, the second test), the views of the tree with
 * the rumoured links or some blood links left out, and the release of the memos. `Kin` (`relation-kin.ts`) adds the names on top. The rules are in the header of `relations.ts`.
 */

import { addVia, better, cousinCount, doubtRank, isRuleOne, joinCandidates, joinedSize, outcomesOf, ruleOneKey, unlistedForm } from './relation-candidates';
import type { Blood, Dag, Shape } from './relation-internal';
import { KinBase } from './relation-kin-base';
import { RANK, type RelationMaybe, relationRunStats } from './relation-types';

/** The middle layer of the relation search: the blood candidates, the views of the tree and the release of the memos. */
export class KinBlood extends KinBase {
	/** `blood` results by `f * n + p`. */
	private readonly bloodMemo = new Map<number, Blood[]>();
	/** `path` results without `blocked`, by `(v * n + t) * 3 + level`. Never changed after. */
	private readonly firstPaths = new Map<number, number[] | null>();
	/** `below` maps by `v * n + t`, kept for the people relations are counted from. */
	private readonly belowMemo = new Map<number, Map<number, number>>();
	/** `below` maps of the other people, by `v * n + t`; emptied for each new second person. */
	private readonly belowScratch = new Map<number, Map<number, number>>();
	/** `dagOf` results, kept like `belowMemo` and `belowScratch`. */
	private readonly dagMemo = new Map<number, Dag>();
	private readonly dagScratch = new Map<number, Dag>();
	/** D200 R1: the same tree seen with the sure links only, made the first time a pair needs it. */
	private sure?: KinBlood;
	/** Order repair: the tree seen without the blood links of one marked person (the key), made the first time a name by marriage needs it. */
	private readonly cutViews = new Map<number, KinBlood>();
	/** Order repair: the tree seen without the links from S down to the children that S has with M, with M's links too or not, by `(m * n + s) * 2 + cut`. */
	private readonly stepViews = new Map<number, KinBlood>();

	/**
	 * The first shortest path from `v` up to its ancestor `t` (both included) by the tie-break of
	 * the file header, using only links of `RANK` up to `level`: at each step, the first parent in the
	 * child's list that still lies on such a path. With `blocked`, only a path whose people after `v`
	 * are all outside `blocked`, if one exists. `av` is `anc(v)`; the length is always the shortest
	 * over all links.
	 */
	path(v: number, t: number, av: Map<number, number>, level: number, blocked?: { has(i: number): boolean }): number[] | undefined {
		const d = av.get(t);
		if (d === undefined) return undefined;
		const key = (v * this.ids.length + t) * 3 + level;
		if (!blocked) {
			const known = this.firstPaths.get(key);
			if (known !== undefined) return known ?? undefined;
		}
		const below = this.belowOf(v, t, av);
		// Depth-first in list order; on the shortest-path graph every person has one depth, so a
		// person that led nowhere once leads nowhere again.
		const dead = new Set<number>();
		const path = [v];
		const at = [0];
		while (path.length) {
			const cur = path[path.length - 1];
			if (cur === t) break;
			const depth = path.length;
			const ups = this.up[cur];
			let k = at[at.length - 1];
			for (; k < ups.length; k++) {
				const q = ups[k].p;
				if (RANK[ups[k].type] <= level && av.get(q) === depth && below.get(q) === d - depth && !dead.has(q) && !blocked?.has(q)) break;
			}
			if (k < ups.length) {
				at[at.length - 1] = k + 1;
				path.push(ups[k].p);
				at.push(0);
			} else {
				dead.add(cur);
				path.pop();
				at.pop();
			}
		}
		if (!blocked) this.firstPaths.set(key, path.length ? path : null);
		return path.length ? path : undefined;
	}

	/** The first path of `path` at the lowest level that has one: birth links only, then adoptive too, then all. */
	bestPath(v: number, t: number, av: Map<number, number>): number[] | undefined {
		for (let level = 0; level <= this.topRank[v]; level++) {
			const path = this.path(v, t, av, level);
			if (path) return path;
		}
		return undefined;
	}

	/** `below(t, anc(v))`, kept for the people relations are counted from. */
	private belowOf(v: number, t: number, av: Map<number, number>): Map<number, number> {
		const key = v * this.ids.length + t;
		const memo = this.fromAnc.has(v) ? this.belowMemo : this.belowScratch;
		let below = memo.get(key);
		if (!below) memo.set(key, (below = this.below(t, av)));
		return below;
	}

	/** Distance down from `t` to each of `v`'s ancestors below it (`av` is `anc(v)`); the true distance, as every person between is one of them too. */
	private below(t: number, av: Map<number, number>): Map<number, number> {
		const out = new Map<number, number>([[t, 0]]);
		let frontier = [t];
		for (let k = 1; frontier.length; k++) {
			const next: number[] = [];
			for (const u of frontier) {
				for (const c of this.down[u]) {
					if (out.has(c) || !av.has(c)) continue;
					out.set(c, k);
					next.push(c);
				}
			}
			frontier = next;
		}
		return out;
	}

	/** Blood candidates of `p` as a relative of `f` (§13.1 blood rules), deduplicated, doubles merged. */
	blood(f: number, p: number, aP?: Map<number, number>): Blood[] {
		const memoKey = f * this.ids.length + p;
		const known = this.bloodMemo.get(memoKey);
		if (known) return known;
		const out = this.bloodOf(f, p, this.ancFrom(f), aP ?? this.anc(p));
		this.bloodMemo.set(memoKey, out);
		return out;
	}

	/**
	 * `blood` for the order repair, in the view of a marked person: only the common ancestors that are at most `reach` links from both
	 * people, which is all that a name with legs up to `reach` can use (a leg is never shorter than the distance to its ancestor,
	 * also in the sure view, whose legs are never shorter than the whole tree's). No memo.
	 */
	bloodNear(f: number, p: number, reach: number): Blood[] {
		const aF = this.ancFrom(f);
		const aP = this.anc(p);
		const near: number[] = [];
		for (const [x, d] of aF) {
			const e = aP.get(x);
			if (d <= reach && e !== undefined && e <= reach) near.push(x);
		}
		return near.length ? this.bloodOf(f, p, aF, aP, near) : [];
	}

	/** `blood` for the order repair, in the view of a marked person, for the common ancestors `xs` only (those that both people have in this view). No memo. */
	bloodAt(f: number, p: number, xs: number[]): Blood[] {
		const aF = this.ancFrom(f);
		const aP = this.anc(p);
		const only = xs.filter((x) => aF.has(x) && aP.has(x));
		return only.length ? this.bloodOf(f, p, aF, aP, only) : [];
	}

	/** The candidates of `blood` for the common ancestors `only` (all if absent). */
	private bloodOf(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, only?: number[]): Blood[] {
		const run = this.candidates(f, p, aF, aP, only);
		// D200 R1: the sure view may add candidates that a rumoured short line hid. All are merged for "double" together.
		const sure = this.sureRun(f, p, aF, aP, run.list, only);
		const list = sure ? [...run.list, ...sure.list] : run.list;
		// Most pairs of people have fewer than two full cousin names, so nothing can be "double".
		return cousinCount(list) < 2
			? list
			: this.mergeDoubles(list, (keys) => {
					this.searchPending(f, p, aF, aP, run.pending, list, keys);
					if (sure) sure.kin.searchPending(f, p, sure.aF, sure.aP, sure.pending, list, keys);
				});
	}

	/** The candidates of every common ancestor of `f` and `p`, one per key, before the doubles are merged; `pending` holds the cousin pairs passed over. */
	private candidates(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, only?: number[]): { list: Blood[]; pending: number[] } {
		const common: number[] = [];
		const [small, big] = aF.size <= aP.size ? [aF, aP] : [aP, aF];
		if (only) common.push(...only);
		else for (const x of small.keys()) if (big.has(x)) common.push(x);
		// Document order, so the same tree always keeps the same candidate of a couple.
		const ordered = Int32Array.from(common).sort();

		const found = new Map<string, Blood>();
		const pending: number[] = [];
		for (const x of ordered) {
			const cs = x === f ? [this.direct(f, p, aP, 0)] : x === p ? [this.direct(f, p, aF, 1)] : this.collateral(f, p, x, aF, aP, pending);
			for (const c of cs) {
				if (!c) continue;
				// A full relation is found at both members of its couple; keep the better word, and the better maybe (rule 6).
				const old = found.get(c.key);
				found.set(c.key, old ? joinCandidates(old, c) : c);
			}
		}
		return { list: [...found.values()], pending };
	}

	/**
	 * D200 R1: a rumoured link can make the shortest line to an ancestor shorter than every sure line, and the search keeps the
	 * shortest, so the sure line would be lost ("Great-grandfather" beside "Rumoured father"). The sure view finds the
	 * candidates of the sure links alone; the run holds those whose key `list` (the whole tree's candidates) does not have.
	 * It exists only when a rumoured link lies in the ancestry of either person and the sure distances differ from the whole
	 * ones: if they are equal, the sure view can give no key that the search has not given.
	 */
	private sureRun(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, list: Blood[], only?: number[]): { kin: KinBlood; list: Blood[]; pending: number[]; aF: Map<number, number>; aP: Map<number, number> } | undefined {
		if (this.upAll !== this.up || (this.topRank[f] < 2 && this.topRank[p] < 2)) return undefined;
		const kin = this.sureView();
		// A person with no rumoured link in the ancestry has the same ancestors in both views.
		if (this.topRank[f] < 2 && !kin.fromAnc.has(f)) kin.fromAnc.set(f, aF);
		const sureF = kin.ancFrom(f);
		const sureP = this.topRank[p] < 2 ? aP : kin.anc(p);
		const all = this.sureDiffering(aF, aP, sureF, sureP);
		const wanted = only && new Set(only);
		const differing = wanted ? all.filter((x) => wanted.has(x)) : all;
		if (!differing.length) return undefined;
		const keys = new Set(list.map((c) => c.key));
		// The common ancestors where the distances are the same give the same candidates in both views: only the others are searched.
		const run = kin.candidates(f, p, sureF, sureP, differing);
		const more = run.list.filter((c) => !keys.has(c.key));
		return more.length ? { kin, list: more, pending: run.pending, aF: sureF, aP: sureP } : undefined;
	}

	/**
	 * The common ancestors where the sure ancestors of `f` or `p` are at other distances than the whole tree's, at the
	 * ancestor or at a child of it: only there can the sure view give a candidate whose key the whole tree did not give.
	 */
	private sureDiffering(aF: Map<number, number>, aP: Map<number, number>, sureF: Map<number, number>, sureP: Map<number, number>): number[] {
		const out: number[] = [];
		if (aF === sureF && aP === sureP) return out;
		const [small, big] = aF.size <= aP.size ? [aF, aP] : [aP, aF];
		for (const x of small.keys()) {
			if (!big.has(x)) continue;
			if (aF.get(x) !== sureF.get(x) || aP.get(x) !== sureP.get(x) || this.down[x].some((c) => aF.get(c) !== sureF.get(c) || aP.get(c) !== sureP.get(c))) out.push(x);
		}
		return out.sort((i, j) => i - j);
	}

	/** The tree with the rumoured links left out, made once. */
	private sureView(): KinBlood {
		return (this.sure ??= new KinBlood(this.g, this.options, this));
	}

	/** The tree without the blood links of `m` (order repair, rule 2 of the names by marriage), made once for each `m`. */
	protected cutView(m: number): KinBlood {
		let view = this.cutViews.get(m);
		if (!view) {
			view = new KinBlood(this.g, this.options, undefined, m, undefined, this);
			this.cutViews.set(m, view);
		}
		return view;
	}

	/**
	 * The tree without the links from `s` down to `kids` (the children that `s` has with `m`), and also without the blood links of
	 * `m` if `cutM`; made once for each `m`, `s` and `cutM`. A descendant of `s` is a step-descendant of `m` only by a child of `s`
	 * that is not `m`'s own, so only this tree can name it.
	 */
	protected stepView(m: number, s: number, kids: number[], cutM: boolean): KinBlood {
		const key = (m * this.ids.length + s) * 2 + (cutM ? 1 : 0);
		let view = this.stepViews.get(key);
		if (!view) {
			view = new KinBlood(this.g, this.options, undefined, cutM ? m : -1, { parent: s, kids: new Set(kids) }, this);
			this.stepViews.set(key, view);
		}
		return view;
	}

	/**
	 * The lines from `f` down to `p` (a = 0, key `D:0:b`): the shortest of this tree, and the shortest of the sure links if a rumoured
	 * link made the whole one shorter. `blood` gives the same two, with every other candidate that this one does not need.
	 */
	descent(f: number, p: number): Blood[] {
		const aP = this.anc(p);
		const whole = aP.has(f) ? this.direct(f, p, aP, 0) : undefined;
		const out = whole ? [whole] : [];
		if (this.upAll === this.up && this.topRank[p] === 2) {
			const sure = this.sureView();
			const sureP = sure.anc(p);
			const line = sureP.has(f) && sureP.get(f) !== aP.get(f) ? sure.direct(f, p, sureP, 0) : undefined;
			if (line) out.push(line);
		}
		return out;
	}

	/** The direct line: `p` descends from `f` (`side` 0) or `p` is an ancestor of `f` (`side` 1). */
	private direct(f: number, p: number, av: Map<number, number>, side: 0 | 1): Blood | undefined {
		const [from, to] = side === 0 ? [p, f] : [f, p];
		const path = this.bestPath(from, to, av);
		if (!path) return undefined;
		const pathF = side === 0 ? [f] : path;
		const pathP = side === 0 ? path : [p];
		const a = pathF.length - 1;
		const b = pathP.length - 1;
		return { a, b, x: to, y: -1, half: false, double: false, word: this.wordOf(pathF, pathP, -1), pathF, pathP, key: `D:${a}:${b}`, couple: [to], via: [] };
	}

	/**
	 * The candidates at a common ancestor `x` that is neither person: the shortest pairs of paths
	 * through different children of `x`. §13.1 rule 3 drops a pair when both paths pass through one
	 * other common ancestor below `x`; it stays if one pair of shortest paths shares nobody below
	 * `x` (a person on both paths is a common ancestor, or one of the two people). Each distinct
	 * full or half result is one candidate (D50), so the names never depend on the order of the
	 * children; each takes the pair with the lowest link rank, then the first in list order. A cousin pair
	 * that is passed over because its key is taken goes to `pending` (x, c1, c2): the "double" test may need its line.
	 */
	private collateral(f: number, p: number, x: number, aF: Map<number, number>, aP: Map<number, number>, pending: number[]): Blood[] {
		const kids = this.down[x];
		let bestF = -1;
		let bestP = -1;
		for (const c1 of kids) {
			const d1 = aF.get(c1);
			if (d1 === undefined) continue;
			for (const c2 of kids) {
				const d2 = aP.get(c2);
				if (d2 === undefined || c1 === c2) continue;
				if (bestF < 0 || better(d1, d2, bestF, bestP)) {
					bestF = d1;
					bestP = d2;
				}
			}
		}
		if (bestF < 0) return [];
		const pairs: { c1: number; c2: number; lo: number; hi: number; shape?: Shape; done: boolean }[] = [];
		for (const c1 of kids) {
			if (aF.get(c1) !== bestF) continue;
			for (const c2 of kids) {
				if (aP.get(c2) !== bestP || c1 === c2) continue;
				pairs.push({ c1, c2, lo: this.pairRank(x, c1, c2), hi: -1, done: false });
			}
		}
		const shapeOf = (pair: (typeof pairs)[number]) => (pair.shape ??= this.pairShape(x, pair.c1, pair.c2, bestF + 1, bestP + 1));
		// D123: a rumoured link can matter only if one lies in the blood ancestry of either person (that covers c1 and c2 too).
		const rumour = this.topRank[f] === 2 || this.topRank[p] === 2;
		const out: Blood[] = [];
		const has = (key: string) => out.some((b) => b.key === key);
		// Only a cousin name can be "double".
		const cousins = bestF >= 1 && bestP >= 1;
		for (let level = 0; level <= 2; level++) {
			for (const pair of pairs) {
				const { c1, c2, lo } = pair;
				// A pair that gave a candidate gives no better one at a higher level. Rule 1 can give it a key other
				// than its sure shape's (D174 makes that common), so the key test alone would search it again.
				if (level < lo || pair.done) continue;
				// With one pair (nearly always) the key is needed only for a found candidate. A pair whose sure key
				// another pair took is searched only if it could add to the names (rule 6): a better maybe, or a
				// rule 1 name that no pair gave yet. So the names never depend on the order of the children (D2).
				if (pairs.length > 1 || pair.shape) {
					const shape = shapeOf(pair);
					const taken = out.find((b) => b.key === shape.key);
					if (taken && !this.couldAdd(taken, shape, x, c1, c2, rumour, has)) {
						// Neither can change later: the taken maybe only gets better, and keys are only added.
						pair.done = true;
						if (cousins) pending.push(x, c1, c2);
						continue;
					}
				}
				// A line found at level 2 has a rumoured link (no lower level had one), so it takes rule 1 and its key is known now.
				if (level === 2 && pairs.length > 1 && out.some(isRuleOne) && has(this.ruleOneKey(shapeOf(pair), x, c1, c2, bestF + 1, bestP + 1))) {
					if (cousins) pending.push(x, c1, c2);
					continue;
				}
				// A higher level changes the answer only if the shortest-path graphs have a link of that rank.
				if (level > lo) {
					if (level > Math.max(lo, this.topRank[f], this.topRank[p])) continue;
					if (pair.hi < 0) pair.hi = Math.max(lo, this.dagRank(f, c1, aF), this.dagRank(p, c2, aP));
					if (level > pair.hi) continue;
				}
				const paths = this.disjointPair(f, c1, aF, p, c2, aP, level);
				if (!paths) continue;
				pair.done = true;
				const c = this.collateralCandidate(shapeOf(pair), paths[0], paths[1], x, c1, c2, rumour);
				const k = out.findIndex((b) => b.key === c.key);
				if (k < 0) out.push(c);
				else out[k] = joinCandidates(out[k], c);
			}
		}
		return out;
	}

	/**
	 * Rule 6 for a pair whose sure key the candidate `taken` already has: true if the pair could add to
	 * the names, so it must be searched. Its sure line could bring a better maybe (not to a rumoured
	 * line, which has no maybe; a pair with a sure line was found before a rumoured one at a higher
	 * level), or its rumoured line a rule 1 key that no pair gave yet.
	 */
	private couldAdd(taken: Blood, shape: Shape, x: number, c1: number, c2: number, rumour: boolean, has: (key: string) => boolean): boolean {
		if (!rumour && !(shape.half && this.options.oneParentUnknown)) return false;
		const doubt = this.doubtOf(shape, x, c1, c2, taken.a === 1 && taken.b === 1);
		if (doubt && taken.word !== 'rumoured' && (!taken.maybe || doubtRank(doubt.maybe, doubt.cause, doubt.some, doubt.form) < doubtRank(taken.maybe, taken.cause!, taken.some, taken.form))) return true;
		return rumour && !has(this.ruleOneKey(shape, x, c1, c2, taken.a, taken.b));
	}

	/**
	 * D175: searches the cousin pairs that `collateral` passed over (`pending`: x, c1, c2) whose key could
	 * be one of `keys`, as it would have searched them, and adds each line found to the candidate of `list`
	 * with its key. Only the "double" test reads these lines, and only for a group of `keys` that the lines
	 * it has cannot decide, so the result never depends on which pair of children was searched first.
	 */
	private searchPending(f: number, p: number, aF: Map<number, number>, aP: Map<number, number>, pending: number[], list: Blood[], keys: Set<string>): void {
		const rumour = this.topRank[f] === 2 || this.topRank[p] === 2;
		for (let k = 0; k < pending.length; k += 3) {
			const [x, c1, c2] = [pending[k], pending[k + 1], pending[k + 2]];
			if (x < 0) continue;
			// A line takes the sure key of its pair, or on a rumoured line the key of the second test: no other.
			const [a, b] = [aF.get(c1)! + 1, aP.get(c2)! + 1];
			const shape = this.pairShape(x, c1, c2, a, b);
			if (!keys.has(shape.key) && !(rumour && keys.has(this.ruleOneKey(shape, x, c1, c2, a, b)))) continue;
			pending[k] = -1;
			for (let level = this.pairRank(x, c1, c2, shape); level <= 2; level++) {
				const paths = this.disjointPair(f, c1, aF, p, c2, aP, level);
				if (!paths) continue;
				const c = this.collateralCandidate(shape, paths[0], paths[1], x, c1, c2, rumour);
				const owner = list.find((d) => d.key === c.key);
				if (owner) for (const v of c.via) addVia(owner, v);
				break;
			}
		}
	}

	/** The first pair of shortest paths `f`…`c1` and `p`…`c2` with links up to `level` that share no person, if any. */
	private disjointPair(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>, level: number): [number[], number[]] | undefined {
		const pf = this.path(f, c1, aF, level);
		const pp = this.path(p, c2, aP, level);
		if (!pf || !pp) return undefined;
		const onP = this.mark(pp);
		if (!pf.some((v) => onP.has(v))) return [pf, pp];
		const altF = onP.has(f) ? undefined : this.path(f, c1, aF, level, onP);
		if (altF) return [altF, pp];
		const onF = this.mark(pf);
		const altP = onF.has(p) ? undefined : this.path(p, c2, aP, level, onF);
		if (altP) return [pf, altP];
		// Rare (heavy inbreeding): both first paths must change.
		return this.sharedCut(f, c1, aF, p, c2, aP) ? undefined : this.pebbles(f, c1, aF, p, c2, aP, level);
	}

	/**
	 * The exact search for two shortest paths `f`…`c1` and `p`…`c2` (links up to `level`) that share
	 * no person. Two pebbles climb the two shortest-path graphs; the pebble lower in `tau` moves. If
	 * two paths share a person, the first pebble there waits for the other, which cannot pass above
	 * it, so the pebbles meet: a search that never puts both pebbles on one person finds exactly the
	 * disjoint pairs. The states are pairs of people, so the search is at most quadratic.
	 */
	private pebbles(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>, level: number): [number[], number[]] | undefined {
		const n = this.ids.length;
		const dF = aF.get(c1)!;
		const dP = aP.get(c2)!;
		const bF = this.belowOf(f, c1, aF);
		const bP = this.belowOf(p, c2, aP);
		const next = (v: number, av: Map<number, number>, below: Map<number, number>, d: number) => {
			const depth = av.get(v)! + 1;
			const out: number[] = [];
			for (const l of this.up[v]) if (RANK[l.type] <= level && av.get(l.p) === depth && below.get(l.p) === d - depth) out.push(l.p);
			return out;
		};
		const prev = new Map<number, number>();
		const stack: [number, number][] = [[f * n + p, -1]];
		while (stack.length) {
			const [s, from] = stack.pop()!;
			if (prev.has(s)) continue;
			prev.set(s, from);
			const u = Math.floor(s / n);
			const v = s % n;
			if (u === c1 && v === c2) {
				const pf: number[] = [];
				const pp: number[] = [];
				for (let k = s; k >= 0; k = prev.get(k)!) {
					const [ku, kv] = [Math.floor(k / n), k % n];
					if (pf[pf.length - 1] !== ku) pf.push(ku);
					if (pp[pp.length - 1] !== kv) pp.push(kv);
				}
				return [pf.reverse(), pp.reverse()];
			}
			const moveF = v === c2 || (u !== c1 && this.tau[u] > this.tau[v]);
			const steps = moveF ? next(u, aF, bF, dF) : next(v, aP, bP, dP);
			// Reversed, so the first parent in the list is tried first.
			for (let k = steps.length - 1; k >= 0; k--) {
				const [nu, nv] = moveF ? [steps[k], v] : [u, steps[k]];
				if (nu !== nv && !prev.has(nu * n + nv)) stack.push([nu * n + nv, s]);
			}
		}
		return undefined;
	}

	/**
	 * True if one person is on every shortest path `f`…`c1` and on every shortest path `p`…`c2`:
	 * then no pair of them is disjoint. On a shortest-path graph such a person is the only one at
	 * its distance, so the check is linear; it spares the full search most of the pairs it would fail.
	 */
	private sharedCut(f: number, c1: number, aF: Map<number, number>, p: number, c2: number, aP: Map<number, number>): boolean {
		const soleF = this.dagOf(f, c1, aF).sole;
		for (const w of this.dagOf(p, c2, aP).sole) if (w >= 0 && soleF[aF.get(w) ?? -1] === w) return true;
		return false;
	}

	/** The shortest paths `v`…`t` as a whole: for each distance from `v`, the one person at it, or -1 if there are more. */
	private dagOf(v: number, t: number, av: Map<number, number>): Dag {
		const key = v * this.ids.length + t;
		const memo = this.fromAnc.has(v) ? this.dagMemo : this.dagScratch;
		const known = memo.get(key);
		if (known) return known;
		const d = av.get(t)!;
		const sole = new Int32Array(d + 1).fill(-2);
		for (const [w, k] of this.belowOf(v, t, av)) {
			const j = av.get(w)!;
			if (j + k === d) sole[j] = sole[j] === -2 ? w : -1;
		}
		const out: Dag = { sole, rank: -1 };
		memo.set(key, out);
		return out;
	}

	/** The highest `RANK` of a link on the shortest paths `v`…`t`. */
	private dagRank(v: number, t: number, av: Map<number, number>): number {
		const dag = this.dagOf(v, t, av);
		if (dag.rank >= 0) return dag.rank;
		const d = av.get(t)!;
		const below = this.belowOf(v, t, av);
		let rank = 0;
		for (const [w, k] of below) {
			const j = av.get(w)!;
			if (j + k !== d) continue;
			for (const l of this.up[w]) if (av.get(l.p) === j + 1 && below.get(l.p) === k - 1) rank = Math.max(rank, RANK[l.type]);
		}
		return (dag.rank = rank);
	}

	/**
	 * The blood candidate of one pair of paths, with the second test of D123 and D174 (file header):
	 * it runs if a rumoured link lies in the ancestry (`rumour`), or if the setting is on and the
	 * sure test gives half. Else the candidate is the sure one, as in a tree with no doubt.
	 */
	private collateralCandidate(shape: Shape, pf: number[], pp: number[], x: number, c1: number, c2: number, rumour: boolean): Blood {
		const lx = shape.couple[0];
		// A couple with no union in the tree (two rumoured parents, an adoptive couple beside birth parents) is not
		// drawn: the line passes `lx` alone. Every member has the same link type, so the word stays the same. A couple
		// that a begetter link joins is never on a line either, also when its members share a union (D332).
		const y = shape.couple.length > 1 && this.sharesUnion(lx, shape.couple[1]) && !this.begotCouple(c1, c2, shape.couple) ? shape.couple[1] : -1;
		const pathF = [...pf, lx];
		const pathP = [...pp, lx];
		const word = this.wordOf(pathF, pathP, y);
		const out: Blood = { a: pathF.length - 1, b: pathP.length - 1, x: lx, y, half: shape.half, double: false, word, pathF, pathP, key: shape.key, couple: shape.couple, via: [{ c1, c2, word }] };
		if (!rumour && !(shape.half && this.options.oneParentUnknown)) return out;
		const [t1, t2] = [this.typeOf(c1, x), this.typeOf(c2, x)];
		if (word === 'rumoured') {
			// Rule 1. When the result changes, the new key keeps the line apart from the sure shape of the pair.
			const half = this.halfCounted(c1, t1, c2, t2);
			if (half !== shape.half) {
				const [s1, s2] = this.countedPair(c1, t1, c2, t2);
				out.half = half;
				// A half key holds no set, so the set of the matching choices is built only for a full line.
				const setList = half ? [x] : this.matchedPeople(s1, s2);
				out.key = ruleOneKey(half, x, half ? '' : setList === s1.allList ? s1.all : setList.join(','), out.a, out.b);
				out.couple = setList;
				// A half line passes `x` alone. A full line passes the couple of the second test (D175), the same at
				// each of its members, so a couple with a rumoured parent stays one couple and never makes a "double".
				// Siblings keep `x` alone: their one sibling step shows the rumoured link (D174), and they are never double.
				const [nx, ny] = half || (out.a === 1 && out.b === 1) ? [x, -1] : this.ruleOneTop(pf, pp, x, c1, c2, setList);
				if (nx !== lx || ny !== y) {
					out.x = nx;
					out.y = ny;
					out.pathF = [...pf, nx];
					out.pathP = [...pp, nx];
				}
			} else if (!half && shape.couple.length < 2) {
				// A full pair whose sure couple is one parent, where a rumour makes the legal pair (D293), has the couple of the second
				// test (D175): it and a line through that couple are one couple, never a "double". The key and the line stay.
				const [s1, s2] = this.countedPair(c1, t1, c2, t2);
				if (s1.byRumour || s2.byRumour) out.couple = this.matchedPeople(s1, s2);
			}
			return out;
		}
		// Rule 5: no maybe where the link of c1 or c2 to `x` is adoptive (ward links make no blood line).
		if (t1 === 'adoptive' || t2 === 'adoptive') return out;
		relationRunStats.second++;
		const doubt = this.doubtOf(shape, x, c1, c2, pf.length === 1 && pp.length === 1);
		if (doubt) {
			out.maybe = doubt.maybe;
			out.cause = doubt.cause;
			if (doubt.some) out.some = true;
			if (doubt.form) out.form = doubt.form;
		}
		return out;
	}

	/**
	 * Rule 1, a full line through the couple `set` of the second test (D175): the top of the line, `x`
	 * and `y` of the candidate. Two members of the couple, in c1's list order, that have a union in the
	 * tree, such that the line keeps a rumoured link (below c1 and c2, or from c1 up to the first member,
	 * or from the second member down to c2): the name says "rumoured", so its steps must too (§13.2).
	 * Else the first member with a rumoured link to c1 or c2, alone: the line then has a sibling step
	 * through a rumoured link and draws no couple that the tree does not have.
	 */
	private ruleOneTop(pf: number[], pp: number[], x: number, c1: number, c2: number, set: number[]): [number, number] {
		const below = this.hasRumouredLink(pf) || this.hasRumouredLink(pp);
		const members = this.up[c1].filter((l) => set.includes(l.p));
		for (const top of members) {
			for (const other of members) {
				if (other === top || (!below && top.type !== 'rumoured' && this.typeOf(c2, other.p) !== 'rumoured')) continue;
				if (this.sharesUnion(top.p, other.p) && !this.begotCouple(c1, c2, [top.p, other.p])) return [top.p, other.p];
			}
		}
		const alone = members.find((l) => l.type === 'rumoured' || this.typeOf(c2, l.p) === 'rumoured');
		return [alone ? alone.p : x, -1];
	}

	/** The maybe of a sure line of the pair (`c1`, `c2`) at `x` (file header, rules 2 to 5), if any. `sibling`: the two are children of the common ancestor themselves (the unlisted-parent sentence has two forms only for them). */
	private doubtOf(shape: Shape, x: number, c1: number, c2: number, sibling: boolean): { maybe: 'full' | 'half'; cause: RelationMaybe['cause']; some?: true; form?: RelationMaybe['unlistedForm'] } | undefined {
		const [t1, t2] = [this.typeOf(c1, x), this.typeOf(c2, x)];
		if (t1 === 'adoptive' || t2 === 'adoptive') return undefined;
		const [s1, s2] = this.countedPair(c1, t1, c2, t2);
		const rumoured = s1.hasRumoured || s2.hasRumoured;
		if (shape.half) {
			// Rule 2: the rumour gives equal sets (the second test says full), or (setting on) an unknown parent could make them equal.
			if (rumoured) {
				// One choice each (nearly always): the sets are equal or not, and equal sets hold every rumoured parent.
				const single = s1.choices.length === 1 && s2.choices.length === 1;
				if (single && s1.all === s2.all) return { maybe: 'full', cause: 'rumoured' };
				// D200 R4: a child with two sure parents may also have just those two, if the rumoured link is false.
				const equal = this.outcomeMatches(s1, s2);
				if (equal.length) {
					// D176: the sheet says "one of the links" if some matching set leaves out a rumoured parent of either person.
					const all = [...s1.rumouredList, ...s2.rumouredList];
					return { maybe: 'full', cause: 'rumoured', ...(equal.some((t) => all.some((r) => !t.includes(r))) ? { some: true as const } : {}) };
				}
			}
			const [u1, u2] = [s1.plain ?? s1, s2.plain ?? s2];
			if (this.options.oneParentUnknown && outcomesOf(u1).some((a) => outcomesOf(u2).some((b) => joinedSize(a, b) <= 2))) {
				return { maybe: 'full', cause: 'unlisted', form: unlistedForm(sibling, u1, u2) };
			}
			return undefined;
		}
		return s1.rumoured !== s2.rumoured ? { maybe: 'half', cause: 'rumoured' } : undefined;
	}

	/** The key of a candidate on a rumoured line of the pair (`c1`, `c2`) at `x`: its sure key, or the rule 1 key if the second test differs. */
	private ruleOneKey(shape: Shape, x: number, c1: number, c2: number, a: number, b: number): string {
		const [t1, t2] = [this.typeOf(c1, x), this.typeOf(c2, x)];
		const half = this.secondHalf(c1, t1, c2, t2);
		if (half === shape.half) return shape.key;
		if (half) return ruleOneKey(true, x, '', a, b);
		const [q1, q2] = this.countedPair(c1, t1, c2, t2);
		const setList = this.matchedPeople(q1, q2);
		return ruleOneKey(false, x, setList === q1.allList ? q1.all : setList.join(','), a, b);
	}

	/** The scratch maps of the people that the last call worked out, in this tree and in its views. */
	protected clearScratch(): void {
		if (this.belowScratch.size) this.belowScratch.clear();
		if (this.dagScratch.size) this.dagScratch.clear();
		if (this.sure?.belowScratch.size) this.sure.belowScratch.clear();
		if (this.sure?.dagScratch.size) this.sure.dagScratch.clear();
		for (const view of this.cutViews.values()) view.clearScratch();
		for (const view of this.stepViews.values()) view.clearScratch();
	}

	/** Drops the search memos; the lines built later need only the graph and the candidates. */
	release(): void {
		this.sure?.release();
		for (const view of this.cutViews.values()) view.release();
		this.cutViews.clear();
		for (const view of this.stepViews.values()) view.release();
		this.stepViews.clear();
		this.ownKids.clear();
		this.releaseBlood();
		this.fromAnc.clear();
		this.bloodMemo.clear();
		this.firstPaths.clear();
		this.belowMemo.clear();
		this.belowScratch.clear();
		this.dagMemo.clear();
		this.dagScratch.clear();
		this.unionPeople.length = 0;
	}
}
