/*
 * The first class of the search for relation names, `KinBase`: the people and links by index, the memos, the parent sets of the half and full tests, and the readers of unions and
 * partners. `KinBlood` (`relation-kin-blood.ts`) adds the blood search and `Kin` (`relation-kin.ts`) the names; the chain is one object with three layers, as `tree-view-base.ts`
 * to `tree-view.ts` are, and no member calls up the chain. The rules are in the header of `relations.ts`.
 */

import { drawnParentMap, type FamilyGraph, type FamilyUnion } from './derive';
import { bloodSet } from './blood-parents';
import { type CoupleKeys, legalParents, orderCouple } from './legal-parents';
import { MarriageYears } from './marriage-years';
import { addLines, anyPair, isFullCousin, notOneCouple, outcomesOf, twoCouples } from './relation-candidates';
import { type Blood, type BloodLine, type Counted, type Drop, FORMER, implicitKey, isMarriage, isStepLink, type Line, type Shape, type Up, YEARS } from './relation-internal';
import { DEFAULT_RELATION_OPTIONS, RANK, type RelationLine, type RelationLink, type RelationOptions, relationRunStats } from './relation-types';
import { childStepWord, cousinWord, parentStepWord, partnerWord, type Sex, shapeWord, WORDS } from './relation-words';
import { PARENT_LIMIT, PARENT_TYPES, type ParentType } from './types';
import { push } from './validate';

/** The base layer of the relation search: the graph by person index, the parent sets of the half and full tests, and the readers of unions and partners. */
export class KinBase {
	readonly ids: string[];
	readonly idx = new Map<string, number>();
	readonly sex: Sex[];
	/** Every drawn parent link, in `drawnParents` order. */
	readonly drawn: Up[][];
	/** The drawn links without the ward links, one per parent: the link of the lowest `RANK`, ties by the order of `PARENT_TYPES` (spec §0 D332). */
	readonly kept: Up[][];
	/** By person, 1 if it has a begetter link (D332); empty if the tree has none, so no pair takes the blood sets. */
	protected readonly begot: Uint8Array;
	/** Parent links that make blood relations (not ward), one per parent (the `kept` link). */
	readonly up: Up[][];
	/** The same for the whole tree: `up` itself, except in the sure view (`sureView`), where `up` leaves the rumoured links out. */
	protected readonly upAll: Up[][];
	/** Children through those links, in document order. */
	readonly down: number[][];
	/** Children through any drawn link, in document order, one per child (by the rule of `kept`, a ward link counted too). */
	readonly downAll: Up[][];
	/** A topological rank: every blood parent has a smaller one than its child. */
	protected readonly tau: Int32Array;
	/** The highest `RANK` of any blood link from the person up to its ancestors. */
	protected readonly topRank: Uint8Array;
	/** The marks of `mark`: a person is in the current set if its stamp is `stamp`. */
	private readonly stamps: Int32Array;
	private stamp = 0;
	protected readonly fromAnc = new Map<number, Map<number, number>>();
	private readonly spouseMemo: (number[] | undefined)[] = [];
	/** `sharesUnion`: by person, both partners of each of its unions (-1 for an unknown id). It runs for every full candidate. */
	protected readonly unionPeople: (number[] | undefined)[] = [];
	/** `parentsOfType` results by `(child * PARENT_TYPES.length + type) * 2 + plain`. */
	private readonly typedParents = new Map<number, { list: number[]; sig: string }>();
	/** `counted` results by `child * 2 + (adoptive ? 1 : 0)`. */
	private readonly countedMemo = new Map<number, Counted>();
	/** `incomplete` results by `child * PARENT_TYPES.length + type`: 0 not known yet, 1 no, 2 yes. It reads the setting, as does every `Kin`. */
	private readonly lackMemo: Uint8Array;
	/** `ownChildren` results by `m * n + s`. */
	protected readonly ownKids = new Map<number, number[]>();
	/** D332: `bloodParents` results by child. */
	private readonly bloodSets = new Map<number, { list: number[]; sig: string }>();
	/** D332: `bloodCounted` results by child. */
	private readonly bloodCountedMemo = new Map<number, Counted>();
	/** D332: `bloodIncomplete` results by child: 0 not known yet, 1 no, 2 yes. */
	private readonly bloodLack: Uint8Array;

	constructor(
		readonly g: FamilyGraph,
		/** D174: the sibling rule switch; the half and full tests read it. */
		readonly options: Readonly<RelationOptions> = DEFAULT_RELATION_OPTIONS,
		/** D200 R1: the whole-tree `Kin` that this one is the sure view of (see `sureView`). */
		whole?: KinBase,
		/** Order repair: a person whose own up and down blood links this view leaves out (-1: none). Its marriages and its place in every parent set stay. */
		readonly cut: number = -1,
		/** Order repair: children whose link up to one parent this view leaves out (the children of S that are also M's own, rule 2 of the names by marriage). */
		readonly drop?: Drop,
		/** Order repair: the whole-tree `Kin` whose people and drawn links a cut or step view shares. */
		base?: KinBase,
	) {
		const n = g.people.length;
		this.stamps = new Int32Array(n);
		this.lackMemo = new Uint8Array(n * PARENT_TYPES.length);
		this.bloodLack = new Uint8Array(n);
		this.tau = new Int32Array(n);
		this.down = Array.from({ length: n }, () => []);
		this.up = [];
		if (whole || base) {
			// A view shares the people and the drawn links of the tree it is a view of; only `up` and `down` change. The sure view
			// leaves the rumoured links out, a cut or step view leaves out the links of `cut` and `drop`.
			const from = (whole ?? base)!;
			this.ids = from.ids;
			this.idx = from.idx;
			this.sex = from.sex;
			this.drawn = from.drawn;
			this.kept = from.kept;
			this.begot = from.begot;
			this.downAll = from.downAll;
			this.upAll = whole ? whole.up : this.up;
			this.topRank = whole ? whole.topRank : new Uint8Array(n);
			if (whole) this.shareLinks(true, whole.cut, whole.drop);
			else this.shareLinks(false, cut, drop);
			this.order();
			return;
		}
		this.ids = g.people.map((p) => p.id);
		this.ids.forEach((id, i) => this.idx.set(id, i));
		this.sex = g.people.map((p) => (p.sex === 'm' ? 0 : p.sex === 'f' ? 1 : 2));
		const map = drawnParentMap(g);
		this.drawn = [];
		this.kept = [];
		this.downAll = Array.from({ length: n }, () => []);
		let begot: Uint8Array | undefined;
		for (let i = 0; i < n; i++) {
			const links: Up[] = [];
			for (const d of map.get(this.ids[i]) ?? []) {
				const p = this.idx.get(d.id);
				if (p === undefined) continue;
				links.push({ p, type: d.type });
				if (d.type === 'begetter') (begot ??= new Uint8Array(n))[i] = 1;
			}
			this.drawn.push(links);
			for (const l of keepOne(links, true)) this.downAll[l.p].push({ p: i, type: l.type });
			const kept = keepOne(links, false);
			this.kept.push(kept);
			this.up.push(kept);
			for (const l of kept) this.down[l.p].push(i);
		}
		this.begot = begot ?? new Uint8Array(0);
		this.upAll = this.up;
		this.topRank = new Uint8Array(n);
		this.order();
	}

	/** Fills `up` and `down` of a view from the kept links (no ward link), leaving out the rumoured links if `noRumour`, the links of `cut` and the links `drop` names. */
	private shareLinks(noRumour: boolean, cut: number, drop: Drop | undefined): void {
		for (let i = 0; i < this.kept.length; i++) {
			const up: Up[] = [];
			for (const l of this.kept[i]) {
				if (noRumour && l.type === 'rumoured') continue;
				if (cut >= 0 && (i === cut || l.p === cut)) continue;
				if (drop && l.p === drop.parent && drop.kids.has(i)) continue;
				up.push(l);
				this.down[l.p].push(i);
			}
			this.up.push(up);
		}
	}

	/** Parents first (Kahn); the drawn links have no cycle, but a person left over still gets a rank. The sure view keeps the rank of the whole tree, which says if a rumour lies in the ancestry. */
	private order(): void {
		const n = this.ids.length;
		const waiting = this.up.map((u) => u.length);
		const order: number[] = [];
		for (let i = 0; i < n; i++) if (!waiting[i]) order.push(i);
		for (let head = 0; head < order.length; head++) for (const c of this.down[order[head]]) if (--waiting[c] === 0) order.push(c);
		for (let i = 0; i < n; i++) if (waiting[i] > 0) order.push(i);
		const own = this.upAll === this.up;
		order.forEach((v, k) => {
			this.tau[v] = k;
			if (!own) return;
			let top = waiting[v] > 0 ? 2 : 0;
			for (const l of this.up[v]) top = Math.max(top, RANK[l.type], this.topRank[l.p]);
			this.topRank[v] = top;
		});
	}

	/** Every blood ancestor of `i` (and `i` at 0) with the fewest parent links up to it. */
	anc(i: number): Map<number, number> {
		const out = new Map<number, number>([[i, 0]]);
		let frontier = [i];
		for (let d = 1; frontier.length; d++) {
			const next: number[] = [];
			for (const v of frontier) {
				for (const l of this.up[v]) {
					if (out.has(l.p)) continue;
					out.set(l.p, d);
					next.push(l.p);
				}
			}
			frontier = next;
		}
		return out;
	}

	/** `anc` of a person that relations are counted from (the marked person, their partners), kept. */
	ancFrom(i: number): Map<number, number> {
		let m = this.fromAnc.get(i);
		if (!m) this.fromAnc.set(i, (m = this.anc(i)));
		return m;
	}

	/** The type of `child`'s first blood link to `parent`. */
	typeOf(child: number, parent: number): ParentType {
		return this.up[child].find((l) => l.p === parent)?.type ?? 'birth';
	}

	/** The parents of `child` whose link has `type`, in `drawnParents` order, and the same set as a sorted text (kept). A birth or adoptive link gives the legal parents of D293 when the child has them, unless `plain` (the birth parents that the rumoured choices of the second test add to). */
	parentsOfType(child: number, type: ParentType, plain = false): { list: number[]; sig: string } {
		const key = (child * PARENT_TYPES.length + PARENT_TYPES.indexOf(type)) * 2 + (plain ? 1 : 0);
		let out = this.typedParents.get(key);
		if (!out) {
			const list = (plain ? undefined : legalParents(this.drawn[child], type, this.legalShare)) ?? [...new Set(this.drawn[child].filter((l) => l.type === type).map((l) => l.p))];
			this.typedParents.set(key, (out = { list, sig: [...list].sort((i, j) => i - j).join(',') }));
		}
		return out;
	}

	/** True if `child` has a rumoured parent who is not also a birth parent (spec §13.1 "Half": that parent does not count). */
	private hasRumouredBeyondBirth(child: number): boolean {
		const birth = this.parentsOfType(child, 'birth').list;
		return this.kept[child].some((l) => l.type === 'rumoured' && !birth.includes(l.p));
	}

	/**
	 * D174, the sure test: `child`, linked to the common ancestor by `t`, may have a parent that the
	 * tree does not list. An adoptive or ward link never; else fewer than two parents of the link's
	 * type (its sure set), and the setting is on or the child has a rumoured parent.
	 */
	incomplete(child: number, t: ParentType): boolean {
		const key = child * PARENT_TYPES.length + PARENT_TYPES.indexOf(t);
		if (!this.lackMemo[key]) {
			const lacks = t !== 'adoptive' && t !== 'ward' && this.parentsOfType(child, t).list.length < 2 && (this.options.oneParentUnknown || this.hasRumouredBeyondBirth(child));
			this.lackMemo[key] = lacks ? 2 : 1;
		}
		return this.lackMemo[key] === 2;
	}

	/** §13.1 half rule, the sure test: `c1` (linked by `t1`) and `c2` (by `t2`) have different parents of their link's type, or one of them is incomplete (D174). */
	isHalf(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		if (this.byBlood(c1, t1, c2, t2)) return !this.bloodFull(c1, c2);
		return this.parentsOfType(c1, t1).sig !== this.parentsOfType(c2, t2).sig || this.incomplete(c1, t1) || this.incomplete(c2, t2);
	}

	/** D123: the parent sets of `child` for a link of type `t` (an adoptive link counts adoptive parents only; birth and rumoured links count birth parents and rumoured parents). */
	counted(child: number, t: ParentType): Counted {
		const adoptive = t === 'adoptive';
		const key = child * 2 + (adoptive ? 1 : 0);
		let out = this.countedMemo.get(key);
		if (!out) {
			const text = (list: number[]) => [...list].sort((i, j) => i - j).join(',');
			const sure = this.parentsOfType(child, adoptive ? 'adoptive' : 'birth', true);
			out = this.countedFrom(child, sure, adoptive);
			const legal = this.parentsOfType(child, adoptive ? 'adoptive' : 'birth');
			// D293: the two legal parents are the set of the second test too. A rumoured parent can only add a set of the birth parent and
			// the rumoured parents (a "maybe full"); it never makes the legal pair "maybe half", since an adoption holds whoever the birth father was.
			// The doubt of a parent who is not listed still reads the birth parents (`plain`): the unknown birth parent is the one not listed.
			if (legal.sig !== sure.sig) out = { ...out, sure: legal.sig, sureList: legal.list, all: legal.sig, allList: legal.list, rumoured: '', choices: out.hasRumoured ? [legal.list, ...out.choices] : [legal.list], plain: out };
			else if (this.drawn[child].some((l) => l.type === 'rumoured')) {
				// D293 in the second test: every rumoured link counts as a birth link, and then the legal-parent rule holds. A child adopted by
				// one partner with a rumoured birth link to the other has the two legal parents if the rumour is true, as a sure birth link would give.
				const ifTrue = legalParents(this.drawn[child].map((l) => (l.type === 'rumoured' ? { p: l.p, type: 'birth' as const } : l)), adoptive ? 'adoptive' : 'birth', this.legalShare);
				if (ifTrue) out = { ...out, all: text(ifTrue), allList: ifTrue, choices: [ifTrue], plain: out, byRumour: true };
			}
			this.countedMemo.set(key, out);
		}
		return out;
	}

	/**
	 * The sets of `counted` from the sure parents `sure` of `child`: the rumoured parents beside them and the D176 choices. An adoptive link
	 * counts no rumoured parent and never lacks one.
	 */
	private countedFrom(child: number, sure: { list: number[]; sig: string }, adoptive: boolean): Counted {
		// Read from the drawn links, so a view that leaves a person out still offers every rumoured choice of the whole tree (D176).
		const rumoured = adoptive ? [] : this.rumouredChoices(child, sure.list);
		const text = (list: number[]) => [...list].sort((i, j) => i - j).join(',');
		const allList = [...sure.list, ...rumoured];
		let choices: number[][] = [allList];
		// With more rumoured parents than PARENT_LIMIT the sets would grow too fast, so the one set stays (the relation words can then miss a "maybe"; the `too-many-parents` warning says so).
		if (!adoptive && sure.list.length < 2 && allList.length > 2 && rumoured.length <= PARENT_LIMIT.rumoured) {
			const need = 2 - sure.list.length;
			choices = [];
			const pick = (start: number, acc: number[]) => {
				if (acc.length === need) {
					choices.push([...sure.list, ...acc]);
					return;
				}
				for (let i = start; i < rumoured.length; i++) pick(i + 1, [...acc, rumoured[i]]);
			};
			pick(0, []);
			// The whole set stays a choice: without it a person who lists all three parents loses a maybe.
			choices.push(allList);
		}
		return { sure: sure.sig, sureList: sure.list, all: text(allList), rumoured: text(rumoured), hasRumoured: rumoured.length > 0, allList, canLack: !adoptive, rumouredList: rumoured, choices };
	}

	/**
	 * D332: true if the pair `c1`, `c2` under a common ancestor (links `t1`, `t2`) compares blood sets: no link to it is adoptive (a ward
	 * link makes no blood line), and `c1` or `c2` has a begetter link. Every other pair keeps the sets of its link type and D293.
	 */
	protected byBlood(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		return this.begot.length > 0 && (this.begot[c1] === 1 || this.begot[c2] === 1) && t1 !== 'adoptive' && t2 !== 'adoptive';
	}

	/** D332: the blood set B(c) of `child`, its distinct birth parents and begetters in `drawnParents` order, and the same set as a sorted text (kept). */
	bloodParents(child: number): { list: number[]; sig: string } {
		let out = this.bloodSets.get(child);
		if (!out) {
			const list = bloodSet(this.drawn[child]);
			this.bloodSets.set(child, (out = { list, sig: [...list].sort((i, j) => i - j).join(',') }));
		}
		return out;
	}

	/** D332, the sure test of blood sets: fewer than two parents by blood, and the setting is on or the child has a rumoured parent outside its blood set. */
	bloodIncomplete(child: number): boolean {
		if (!this.bloodLack[child]) {
			const blood = this.bloodParents(child).list;
			const lacks = blood.length < 2 && (this.options.oneParentUnknown || this.kept[child].some((l) => l.type === 'rumoured' && !blood.includes(l.p)));
			this.bloodLack[child] = lacks ? 2 : 1;
		}
		return this.bloodLack[child] === 2;
	}

	/** D332: drops the memos of the blood sets, with the other memos of a batch (`release`). */
	protected releaseBlood(): void {
		this.bloodSets.clear();
		this.bloodCountedMemo.clear();
		if (this.begot.length) this.bloodLack.fill(0);
	}

	/** D332, the second test of blood sets: the blood set and the rumoured parents outside it, with the D176 choices; never the D293 legal set (kept). */
	bloodCounted(child: number): Counted {
		let out = this.bloodCountedMemo.get(child);
		if (!out) this.bloodCountedMemo.set(child, (out = this.countedFrom(child, this.bloodParents(child), false)));
		return out;
	}

	/** The sets of the second test for the pair `c1`, `c2` under a common ancestor (links `t1`, `t2`): the blood sets for a pair of `byBlood` (D332), else `counted`. */
	protected countedPair(c1: number, t1: ParentType, c2: number, t2: ParentType): [Counted, Counted] {
		return this.byBlood(c1, t1, c2, t2) ? [this.bloodCounted(c1), this.bloodCounted(c2)] : [this.counted(c1, t1), this.counted(c2, t2)];
	}

	/** D332: the sure test of blood sets says full (equal blood sets, neither child lacks a parent by blood). */
	private bloodFull(c1: number, c2: number): boolean {
		return this.bloodParents(c1).sig === this.bloodParents(c2).sig && !this.bloodIncomplete(c1) && !this.bloodIncomplete(c2);
	}

	/** The rumoured parents of `child` that no sure link of its type lists, one each, in `drawnParents` order (a parent whose kept link is rumoured, D332). */
	private rumouredChoices(child: number, sureList: number[]): number[] {
		const out: number[] = [];
		for (const l of this.kept[child]) if (l.type === 'rumoured' && !sureList.includes(l.p)) out.push(l.p);
		return out;
	}

	/** D123 rule 1: half or full for two children with a link of `t1` and `t2`, every rumoured parent counted as a birth parent; with the setting on, a set of fewer than two people is half (D174). */
	halfCounted(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		relationRunStats.second++;
		return this.secondHalf(c1, t1, c2, t2);
	}

	/** `halfCounted` without the count, for the search to know a key before it looks for paths. This is the one place that decides the second test (D176). */
	protected secondHalf(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		const [s1, s2] = this.countedPair(c1, t1, c2, t2);
		if (s1.choices.length === 1 && s2.choices.length === 1) return s1.all !== s2.all || this.lacks(s1) || this.lacks(s2);
		return this.matches(s1, s2, true).length === 0;
	}

	/**
	 * D176: the sets that both children could have (a choice of one equal to a choice of the other). `sure`: a set of
	 * fewer than two people does not count where the setting says it lacks a parent (the second test); else any size
	 * (the maybe of a half pair).
	 */
	private matches(s1: Counted, s2: Counted, sure: boolean): number[][] {
		const sig = (l: number[]) => [...l].sort((i, j) => i - j).join(',');
		const other = new Set(s2.choices.map(sig));
		return s1.choices.filter((t) => other.has(sig(t)) && !(sure && t.length < 2 && (this.lacks(s1, t) || this.lacks(s2, t))));
	}

	/**
	 * D200 R4: the sets that both children could have as outcomes: a set of one equal to a set of the other, where a child with two
	 * sure parents and a rumoured parent also has the two sure parents alone (the rumour may be false). Only the maybe of a half
	 * pair reads this. `secondHalf` and rule 1 keep the `choices` (D174 item 4: Eleanor and Fiona stay "Sister, maybe half").
	 */
	protected outcomeMatches(s1: Counted, s2: Counted): number[][] {
		const sig = (l: number[]) => [...l].sort((i, j) => i - j).join(',');
		const other = new Set(outcomesOf(s2).map(sig));
		return outcomesOf(s1).filter((t) => other.has(sig(t)));
	}

	/** The people of all the matching sets, for the couple and key of a full line of rule 1 (the sets of one choice: A1, as before D176). */
	protected matchedPeople(s1: Counted, s2: Counted): number[] {
		if (s1.choices.length === 1 && s2.choices.length === 1) return s1.allList;
		return [...new Set(this.matches(s1, s2, true).flat())].sort((i, j) => i - j);
	}

	/** D174, the second test: a set of fewer than two people is incomplete when the setting is on. */
	private lacks(s: Counted, set: number[] = s.allList): boolean {
		return this.options.oneParentUnknown && s.canLack && set.length < 2;
	}

	/**
	 * The lowest level at which a pair below `x` can give a line. It is the rank of the links of `c1` and `c2` to `x`; for
	 * an adoptive pair (rank 1) it is read where the word reads it: the drawn line of a full pair runs up through the first
	 * member of its couple (`wordOf`), so birth links there make a birth pair (§13.1: one with only birth links wins).
	 * Never above 1: a rumoured link keeps its rank. It builds no `Shape` (that is left to the pairs that give a line), only
	 * the first member of the couple of an adoptive pair.
	 */
	protected pairRank(x: number, c1: number, c2: number, shape?: Shape): number {
		const t1 = this.typeOf(c1, x);
		const t2 = this.typeOf(c2, x);
		const lo = Math.max(RANK[t1], RANK[t2]);
		if (lo !== 1) return lo;
		const top = shape ? shape.couple[0] : this.isHalf(c1, t1, c2, t2) ? x : this.orderedCouple(c1, c2, this.parentsOfType(c1, t1).list)[0];
		return top === x ? lo : Math.min(1, Math.max(RANK[this.typeOf(c1, top)], RANK[this.typeOf(c2, top)]));
	}

	/** The parents of a full pair in the order of its line (`orderCouple`); the two closures are made only for a couple of two people. */
	private orderedCouple(c1: number, c2: number, list: number[]): number[] {
		return list.length === 2 ? orderCouple(list, (v) => RANK[this.typeOf(c1, v)], (v) => RANK[this.typeOf(c2, v)], this.coupleKeys(c1, c2, list)) : list;
	}

	/**
	 * D332, the keys of `orderCouple` for a couple of a full pair where `c1` or `c2` has a begetter link; none for every other pair, so its line
	 * stays as it was. When the sure test of blood sets is not full, the couple is a legal one (D293) and the word is "adoptive", so a member
	 * to whom a child has an adoptive link comes first. After a tie: the member linked by birth to both children, then to `c1`, then the
	 * smaller id; they apply when a child has a begetter link to a member, or with the adoptive key.
	 */
	private coupleKeys(c1: number, c2: number, list: number[]): CoupleKeys | undefined {
		if (!this.begot.length || (this.begot[c1] !== 1 && this.begot[c2] !== 1)) return undefined;
		const type = (c: number, v: number) => this.typeOf(c, v);
		const adoptive = this.bloodFull(c1, c2) ? undefined : (v: number) => type(c1, v) === 'adoptive' || type(c2, v) === 'adoptive';
		if (!adoptive && !list.some((v) => type(c1, v) === 'begetter' || type(c2, v) === 'begetter')) return undefined;
		return { adoptive, birth1: (v) => type(c1, v) === 'birth', birth2: (v) => type(c2, v) === 'birth', id: (v) => this.ids[v] };
	}

	/** The people of `list` as a set, valid until the next call; this runs for most pairs, so it builds no `Set`. */
	protected mark(list: number[]): { has(i: number): boolean } {
		const stamp = ++this.stamp;
		for (const v of list) this.stamps[v] = stamp;
		return { has: (i) => this.stamps[i] === stamp };
	}

	/** Half or full for the children `c1` and `c2` of `x` (§13.1 half rule), the couple, and the candidate key. */
	protected pairShape(x: number, c1: number, c2: number, a: number, b: number): Shape {
		const t1 = this.typeOf(c1, x);
		const t2 = this.typeOf(c2, x);
		// D332: a pair that compares blood sets has the blood set as its couple and key.
		const own = this.byBlood(c1, t1, c2, t2) ? this.bloodParents(c1) : this.parentsOfType(c1, t1);
		const half = this.isHalf(c1, t1, c2, t2);
		return half ? { half, couple: [x], key: `H:${x}:${a}:${b}` } : { half, couple: this.orderedCouple(c1, c2, own.list), key: `F:${own.sig}:${a}:${b}` };
	}

	/**
	 * D293: true if `a` and `b` are partners for a legal pair: they share a listed union, or an implicit union that a child makes by listing
	 * exactly these two parents of its placement type. A child with three such parents makes an implicit union of the first two it lists
	 * only, so that union would make the names depend on the order of its list; it does not count.
	 */
	private readonly legalShare = (a: number, b: number): boolean => {
		for (const key of this.g.unionsOf.get(this.ids[a]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu || (fu.partners[0] !== this.ids[b] && fu.partners[1] !== this.ids[b])) continue;
			if (!fu.implicit) return true;
			for (const id of fu.children) {
				const k = this.idx.get(id);
				if (k === undefined) continue;
				const type = this.drawn[k].find((l) => l.p === a)?.type;
				if (type !== undefined && new Set(this.drawn[k].filter((l) => l.type === type).map((l) => l.p)).size === 2) return true;
			}
		}
		return false;
	};

	/** True if `x` and `y` share a union of the tree, listed or implicit: then `coupleUnion` gives a key of the tree. */
	protected sharesUnion(x: number, y: number): boolean {
		let partners = this.unionPeople[x];
		if (!partners) {
			partners = [];
			for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
				const fu = this.g.unionByKey.get(key);
				if (fu) for (const id of fu.partners) partners.push(this.idx.get(id) ?? -1);
			}
			this.unionPeople[x] = partners;
		}
		return partners.includes(y);
	}

	/** True if a link of the path (each person up to the next) is rumoured. */
	protected hasRumouredLink(path: number[]): boolean {
		for (let i = 0; i + 1 < path.length; i++) if (this.typeOf(path[i], path[i + 1]) === 'rumoured') return true;
		return false;
	}

	/** "rumoured" if a link of the line is rumoured, else "adoptive" if one is adoptive, else "birth". */
	protected wordOf(pathF: number[], pathP: number[], y: number): Blood['word'] {
		let adoptive = false;
		// The link to the second member of the couple can only make the word rumoured: with the legal parents of D293 it can be adoptive while the first member's links are birth, and the word stays "Brother".
		const check = (child: number, parent: number, second = false) => {
			const t = this.typeOf(child, parent);
			adoptive ||= t === 'adoptive' && !second;
			return t === 'rumoured';
		};
		for (const path of [pathF, pathP]) {
			for (let i = 0; i + 1 < path.length; i++) if (check(path[i], path[i + 1])) return 'rumoured';
			if (y >= 0 && path.length >= 2 && check(path[path.length - 2], y, true)) return 'rumoured';
		}
		return adoptive ? 'adoptive' : 'birth';
	}

	/**
	 * §13.1 "Double": one cousin name from two different couples is one "double" name, with the first
	 * couple's line; the other lines stay in `also`. `more(keys)` adds the lines of the pairs that the
	 * search passed over and that could have one of `keys`; it runs for a group only if the lines found
	 * so far say "one couple" and the couple test alone does not (D175).
	 */
	protected mergeDoubles(list: Blood[], more: (keys: Set<string>) => void): Blood[] {
		const groups = new Map<string, Blood[]>();
		for (const c of list) if (isFullCousin(c)) push(groups, `${c.word}:${cousinWord(c.a, c.b, false)}`, c);
		const drop = new Set<Blood>();
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			if (!anyPair(group, twoCouples)) {
				// More lines change nothing where every pair of the group is one couple by the couple test alone.
				if (!anyPair(group, notOneCouple)) continue;
				more(new Set(group.map((c) => c.key)));
				if (!anyPair(group, twoCouples)) continue;
			}
			group.sort((i, j) => i.x - j.x);
			group[0].double = true;
			// A double name is one name from two couples; no rumour is compared against it (rule 5).
			delete group[0].maybe;
			delete group[0].cause;
			delete group[0].some;
			delete group[0].form;
			group[0].maybeFrom = undefined;
			for (const c of group.slice(1)) {
				drop.add(c);
				addLines(group[0], c);
			}
		}
		return list.filter((c) => !drop.has(c));
	}

	/** The name of a blood candidate, with the words for the second person's `sex`. The direct pair over a begetter link has its own words (D332). */
	bloodLower(c: Blood, sex: Sex): string {
		if (this.begetterStep(c)) return c.a === 1 ? parentStepWord('begetter', sex) : childStepWord('begetter', sex);
		let word = shapeWord(c.a, c.b, sex, c.half);
		if (c.double) word = `${WORDS.double} ${word}`;
		if (c.word === 'rumoured') word = `${WORDS.rumoured} ${word}`;
		else if (c.word === 'adoptive') word = `${c.a === 0 ? WORDS.adopted : WORDS.adoptive} ${word}`;
		return word;
	}

	/** D332: true if `c1` or `c2` has a begetter link to a member of `couple`: such a couple is never on a line. */
	protected begotCouple(c1: number, c2: number, couple: readonly number[]): boolean {
		return this.begot.length > 0 && couple.some((v) => this.typeOf(c1, v) === 'begetter' || this.typeOf(c2, v) === 'begetter');
	}

	/**
	 * D332: true if `d` is a line of a pair that is full by its blood sets and `m` is in their couple. A begetter link keeps the couple off
	 * the line (no partnership from a begetter), so the line shows one member, but the full name runs through every member, as the couple of a birth line does.
	 */
	protected bloodCoupleHas(d: BloodLine, m: number): boolean {
		if (!this.begot.length || d.y >= 0 || d.pathF.length < 2 || d.pathP.length < 2) return false;
		const [c1, c2] = [d.pathF[d.pathF.length - 2], d.pathP[d.pathP.length - 2]];
		return this.byBlood(c1, this.typeOf(c1, d.x), c2, this.typeOf(c2, d.x)) && this.bloodFull(c1, c2) && this.bloodParents(c1).list.includes(m);
	}

	/** D332: true for a birth line of one step whose link is a begetter link ("Begetter", "Begotten daughter"). */
	protected begetterStep(c: BloodLine & { word: Blood['word'] }): boolean {
		if (!this.begot.length || c.word !== 'birth' || c.a + c.b !== 1) return false;
		const path = c.a === 1 ? c.pathF : c.pathP;
		return this.typeOf(path[0], path[1]) === 'begetter';
	}

	/**
	 * D332: a begetter step of a name by marriage (rule 1 with R one step from M, rule 2 with P one step from S) is not "parent" or
	 * "child", so the name is the possessive form. Not when the same parent also has a birth or adoptive link to the child.
	 */
	protected begotStep(c: Blood): boolean {
		if (!this.begetterStep(c)) return false;
		const path = c.a === 1 ? c.pathF : c.pathP;
		return !this.stepLinked(path[0], path[1]);
	}

	/**
	 * True if `child` has a birth or adoptive link to `parent`, any of its links (D332: the by-marriage rules read every link of the kept
	 * parent). For a rumoured name (`sure` false) a rumoured link counts too, but never a begetter link alone.
	 */
	protected stepLinked(child: number, parent: number, sure = true): boolean {
		return this.drawn[child].some((l) => l.p === parent && (isStepLink(l) || (!sure && l.type === 'rumoured')));
	}

	/** c1's primary union if it is the couple's, else the couple's last-listed union, else the implicit key. */
	protected coupleUnion(c1: number, x: number, y: number): string {
		const primary = this.g.primaryUnion.get(this.ids[c1]);
		const fu = primary === undefined ? undefined : this.g.unionByKey.get(primary);
		const pair = new Set([this.ids[x], this.ids[y]]);
		if (fu && pair.has(fu.partners[0]) && pair.has(fu.partners[1])) return fu.key;
		return this.lastUnion(x, y, false)?.key ?? implicitKey(this.ids[x], this.ids[y]);
	}

	/** The last-listed union of a pair (only marriage-type ones if `marriage`). */
	lastUnion(x: number, y: number, marriage: boolean): FamilyUnion | undefined {
		let out: FamilyUnion | undefined;
		const other = this.ids[y];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu || fu.implicit || (fu.partners[0] !== other && fu.partners[1] !== other)) continue;
			if (!marriage || isMarriage(fu)) out = fu;
		}
		return out;
	}

	/** Every marriage of a pair (a union of type marriage or of an unknown type), in `unionsOf` order. The words read all of them; the line shows the last-listed one. */
	marriagesOf(x: number, y: number): FamilyUnion[] {
		const out: FamilyUnion[] = [];
		const other = this.ids[y];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (fu && isMarriage(fu) && (fu.partners[0] === other || fu.partners[1] === other)) out.push(fu);
		}
		return out;
	}

	/** The years of the marriages of the tree (D304 to D309), the same for every mark of one graph. */
	protected get years(): MarriageYears {
		let years = YEARS.get(this.g);
		if (!years) YEARS.set(this.g, (years = new MarriageYears(this.g)));
		return years;
	}

	/**
	 * The partner word of a pair from its union `fu` (§13.1 table), with "former" when `fu` is a marriage and every marriage of the pair
	 * is ENDED (D305). The type of the word comes from `fu`, the pair's last-listed union; a union that is not a marriage never gets "former".
	 * The name of a partner and every partner step of the finder read it, so they agree.
	 */
	protected partnerOf(fu: FamilyUnion | undefined, x: number, y: number): { lower: string; base?: string } {
		const word = partnerWord(fu?.type ?? 'implicit', fu ? fu.implicit : true, this.sex[y]);
		return fu && isMarriage(fu) && this.years.allEnded(this.marriagesOf(x, y)) ? { lower: `${FORMER}${word}`, base: word } : { lower: word };
	}

	/** The union a partner step uses: the pair's last-listed union, or their implicit union. */
	pairUnion(x: number, y: number): FamilyUnion | undefined {
		const listed = this.lastUnion(x, y, false);
		if (listed) return listed;
		const key = implicitKey(this.ids[x], this.ids[y]);
		return (this.g.unionsOf.get(this.ids[x]) ?? []).includes(key) ? this.g.unionByKey.get(key) : undefined;
	}

	/** Partners in a marriage (or a union of unknown type), in `unionsOf` order. */
	spouses(x: number): number[] {
		const known = this.spouseMemo[x];
		if (known) return known;
		const out: number[] = [];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu || !isMarriage(fu)) continue;
			const other = this.idx.get(fu.partners[0] === this.ids[x] ? fu.partners[1] : fu.partners[0]);
			if (other !== undefined && other !== x && !out.includes(other)) out.push(other);
		}
		this.spouseMemo[x] = out;
		return out;
	}

	/** Partners in any union, also implicit, in `unionsOf` order. */
	partners(x: number): number[] {
		const out: number[] = [];
		for (const key of this.g.unionsOf.get(this.ids[x]) ?? []) {
			const fu = this.g.unionByKey.get(key);
			if (!fu) continue;
			const other = this.idx.get(fu.partners[0] === this.ids[x] ? fu.partners[1] : fu.partners[0]);
			if (other !== undefined && other !== x && !out.includes(other)) out.push(other);
		}
		return out;
	}

	/** The children of `s` who are also `m`'s own by a birth or adoptive link (a rumoured link to `m` does not make a child his own), kept for each pair. */
	protected ownChildren(m: number, s: number): number[] {
		const key = m * this.ids.length + s;
		let own = this.ownKids.get(key);
		if (!own) this.ownKids.set(key, (own = this.down[s].filter((k) => this.up[k].some((l) => l.p === m && l.type !== 'rumoured'))));
		return own;
	}

	/**
	 * The children of `s` on a shortest line down to P (`p`), who stands `b` generations below S (`aP` is `anc(P)`). For a confirmed name (`sure`)
	 * only a child with a birth or adoptive link from S, and (b = 2) a birth or adoptive link to P, counts: a rumour never changes a confirmed
	 * result. A rumoured name keeps the rumoured links too. A begetter link alone never counts (D332).
	 */
	protected lineKids(s: number, p: number, aP: Map<number, number>, b: number, sure: boolean): number[] {
		const linked = (child: number, parent: number) => this.stepLinked(child, parent, sure);
		return this.down[s].filter((k) => aP.get(k) === b - 1 && linked(k, s) && (b === 1 || linked(p, k)));
	}

	lineIds(line: Line): RelationLine {
		return {
			people: line.people.map((i) => this.ids[i]),
			links: line.links.map((l): RelationLink => ({ parent: this.ids[l.parent], child: this.ids[l.child], type: l.type })),
			unions: [...line.unions],
		};
	}
}

/**
 * One link per parent of a child's drawn `links` (spec §0 D332): the link of the lowest `RANK`, ties by the order of `PARENT_TYPES`, in the
 * place of the parent's first link. A ward link is left out (`ward` false: a ward link makes no blood line and keeps its own name), or
 * counted like the others (the children of `downAll`, which the chain follows).
 */
function keepOne(links: readonly Up[], ward: boolean): Up[] {
	const out: Up[] = [];
	// A huge parents list (spec §8) finds a parent's place through a map; the usual short list scans, which allocates nothing.
	const at = links.length > SHORT_LIST ? new Map<number, number>() : undefined;
	for (const l of links) {
		if (!ward && l.type === 'ward') continue;
		const k = at ? (at.get(l.p) ?? -1) : out.findIndex((o) => o.p === l.p);
		if (k < 0) {
			at?.set(l.p, out.length);
			out.push(l);
		} else if (RANK[l.type] < RANK[out[k].type] || (RANK[l.type] === RANK[out[k].type] && PARENT_TYPES.indexOf(l.type) < PARENT_TYPES.indexOf(out[k].type))) out[k] = l;
	}
	return out;
}

/** The longest parents list that `keepOne` scans without a map. */
const SHORT_LIST = 16;
