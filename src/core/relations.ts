/*
 * Relation names (spec §13.1) and the relation finder (spec §13.2; D40–D50). `computeRelations`
 * names every person's relation to the marked person ("This is me"); `findRelation` names the
 * relation of one person to another, or finds the shortest chain of links between them;
 * `lineSubgraph` builds the small tree that shows one relation (D47); `relationsKey` is the cache
 * key of the names. The names are English kinship words (exempt from the STE word rule, §13.0
 * item 5), all in the `WORDS` table below; `src/render/tree-info.ts` builds the sentences around them.
 *
 * Links. Every rule follows the parent links after validation and cycle breaking, from
 * `drawnParents` (placement links, then `g.secondary` in order), so a parent cycle can never make a
 * search loop. `writtenParents`, `ancestorsOf` and `person.parents` are not cycle-broken, so this
 * file never uses them.
 *
 * Lines (the `RelationLine` of each kind of relation):
 * - Blood (common ancestor X, M up a links, P up b links): M up to X, then (full relations only) X's
 *   partner in the couple, then down to P. The lengths a and b are always the shortest over all
 *   links. Among the shortest lines, one with only birth links wins, then one with birth and
 *   adoptive links, then any; then full before half; then list order: at each step up, the first
 *   parent in the child's `drawnParents` list that lies on such a line, and at X the first pair of
 *   children (c1, c2) in `down` order. For a full relation, X is the member of the couple first in
 *   c1's list, and the union is c1's `primaryUnion` if it is the couple's, else the couple's
 *   last-listed union, else their implicit key. A double relation takes the line of its first couple.
 * - Partner: M and P, with the pair's last-listed union, or their implicit key.
 * - Guardian and ward: M and P, with the one ward link.
 * - By marriage, rule 1: the blood line from M to R, then P, with the last-listed marriage of R and P.
 * - By marriage, rule 2: M, then M's spouse S, then S's blood line to P; the M–S marriage comes first.
 * - Step-sibling: M, N, Q, P, with the links N→M and Q→P and the N–Q marriage. N is the first
 *   parent of M (in `drawnParents` order) with such a marriage.
 * - Chain: the people of a breadth-first search in order. It counts raw links; from each person it
 *   visits the parents in `drawnParents` order, then the children in `g.people` order, then the
 *   partners in `unionsOf` order. The first chain found wins.
 *
 * Candidates (the §13.1 blood rules). A candidate (X, a, b) stays if at least one pair of shortest
 * paths leaves X through different children and does not have both paths pass through one other
 * common ancestor below X (spec §13.1 step 3). The search for such a pair is exact. Each distinct
 * full or half result at X (full: one per couple) is one candidate (D50), so the names never depend
 * on the order of siblings; each takes the line with the best link type, as above.
 *
 * Order. Names come best first by §13.1 "Which name wins", rules 1–4. A name by marriage of a person
 * who also has a blood name comes after all other names. The last tie-breaks are the document index
 * of the common ancestor (for a couple, its first member), then `lower`. Each distinct `lower` is
 * listed once (the first in the order is kept). Distances: self 0, partner 1, guardian and ward 1,
 * by marriage 1 + the blood distance, step-sibling 3, blood a + b.
 *
 * Steps (the finder and "Show the steps"). There is one step per link, except that a step up to a
 * parent followed by a step down to another child of that parent is one sibling step ("brother",
 * "half-brother" by the §13.1 half rule, "sibling"); a ward link never joins a sibling step. A step
 * carries the type of its links: "adoptive father", "adopted son", "rumoured father", "rumoured
 * son", "guardian", "ward", and for a sibling step "rumoured half-brother" if one of its two links is
 * rumoured, else "adoptive brother" if one is adoptive. A partner step uses the §13.1 partner table.
 * "Through N other people" counts `line.people.length − 2`.
 *
 * Results are deep-frozen, like layout results, because the views share them.
 */

import { deriveFamilies, drawnParentMap, type DrawnParent, type FamilyGraph, type FamilyUnion } from './derive';
import { isUnionType, PARENT_TYPES, type ParentType, type Tree, type Union } from './types';
import { push } from './validate';

/** The kinds of §13.1: which rule named the relation. */
export type RelationKind = 'self' | 'blood' | 'partner' | 'guardian' | 'ward' | 'by-marriage' | 'step-sibling';

/** One parent link that a line uses (a cycle-broken link, see the file header). */
export interface RelationLink {
	parent: string;
	child: string;
	type: ParentType;
}

/** What the result tree highlights for one relation (line rules in the file header). */
export interface RelationLine {
	/** No repeats; [0] is the first person, the last is the second person; order per the line rules. */
	people: string[];
	/** The parent links the line uses, in step order. */
	links: RelationLink[];
	/** Unions the line uses: a partner step, or the ancestor couple of a full relation. Both partners are in `people`. */
	unions: string[];
}

/** One name of a person's relation to the marked person (or to the finder's first person). */
export interface Relation {
	/** As a card shows it, first letter capital: "Second cousin once removed", "Wife's first cousin", "You". */
	text: string;
	/** The same name in lower case for sentences and "Also:" lists ("second cousin once removed"). */
	lower: string;
	kind: RelationKind;
	/** §13.1 "Which name wins", rule 3; the values per kind are in the file header. */
	distance: number;
	line: RelationLine;
}

/**
 * All relations of every person to `me`, best first. `me` itself maps to one `self` relation ("You").
 * A person with no relation of §13.1 is absent. Returns an empty map if `me` is not a person of `g`.
 * Pure; it always ends. Each `line` is built the first time it is read.
 */
export type ComputeRelations = (g: FamilyGraph, me: string) => ReadonlyMap<string, readonly Relation[]>;

/** One step of a chain or of "Show the steps": `person` is `of`'s `word` ("Isolde is Roderick's wife."). */
export interface RelationStep {
	person: string;
	of: string;
	/** Lower case: a parent, child, sibling or partner word with its link type (file header), following the person's `sex`. */
	word: string;
}

/** The finder's answer for an ordered pair: the second person as a relative of the first (§13.2). */
export type FinderResult =
	| {
			kind: 'named';
			first: string;
			second: string;
			/** Every distinct relation (D53; see `FINDER_LIMIT`), best first, each with its steps; "Other relation" cycles through them. */
			relations: { relation: Relation; steps: RelationStep[] }[];
	  }
	| {
			/** No relation of §13.1: the shortest chain of parent links (any type) and partnerships (any type, also implicit). */
			kind: 'chain';
			first: string;
			second: string;
			steps: RelationStep[];
			line: RelationLine;
	  }
	| { kind: 'none'; first: string; second: string };

/** Pure. `first` and `second` are different people of `g`; otherwise `kind: 'none'`. */
export type FindRelation = (g: FamilyGraph, first: string, second: string) => FinderResult;

/**
 * The small tree of D47: a `FamilyGraph` with only the people of `line.people`, ready for
 * `layoutTree` with `NEVER_FAR_RULE` (`src/layout/layout.ts`), so a couple on the line is never split.
 * It runs `deriveFamilies` on a `Tree` whose people are the line's people with `parents` = the line's
 * links among them (never the raw `person.parents`) and whose unions are the original union objects
 * of `line.unions` (same keys), then makes two patches: a child whose only line link to a parent is
 * `rumoured` gets `placementParents = [parent]` and `placementType = 'rumoured'` (`edges.ts` draws it
 * with the rumoured stroke and the "?" marker); an implicit union of `line.unions` with no shared
 * child stays as an implicit `FamilyUnion` with `children: []` (a plain connector). Pure.
 */
export type LineSubgraph = (g: FamilyGraph, line: RelationLine) => FamilyGraph;

/**
 * Cache key of `computeRelations(g, me)`: ids, `sex`, the primary unions, the cycle-broken parent
 * links with their types, the unions (key, partners, type, order) and `me`; not names. The view
 * keeps one result per key of the WHOLE tree and never uses a focus subgraph for names.
 */
export type RelationsKey = (g: FamilyGraph, me: string) => string;

/** The most relations the finder cycles through (§13.2): no limit, as the owner decided (D53). A number caps the list. */
export const FINDER_LIMIT: number = Infinity;

/**
 * The rank of a blood link for the choice of lines: a line with only birth links (0) comes before
 * one with adoptive links (1), before one with rumoured links (2), as §13.1 "Which name wins" rule 4
 * orders the words. Ward links make no blood line.
 */
const RANK: Record<ParentType, number> = { birth: 0, adoptive: 1, rumoured: 2, ward: 2 };
const WORD_RANK: Record<'birth' | 'adoptive' | 'rumoured', number> = { birth: 0, adoptive: 1, rumoured: 2 };

// ---------------------------------------------------------------------------------------------
// Words

/** 0 = male (`sex: m`), 1 = female (`sex: f`), 2 = neutral (any other value, or none; D12). */
type Sex = 0 | 1 | 2;

/** Every kinship word the plugin shows, by sex where it changes: [male, female, neutral]. */
const WORDS = {
	you: 'you',
	parent: ['father', 'mother', 'parent'],
	child: ['son', 'daughter', 'child'],
	sibling: ['brother', 'sister', 'sibling'],
	uncle: ['uncle', 'aunt'],
	nephew: ['nephew', 'niece'],
	grand: 'grand',
	great: 'great-',
	half: 'half',
	double: 'double',
	adoptive: 'adoptive',
	adopted: 'adopted',
	rumoured: 'rumoured',
	cousin: 'cousin',
	degrees: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'],
	once: 'once removed',
	twice: 'twice removed',
	times: (n: number) => `${n} times removed`,
	possessive: "'s",
	spouse: ['husband', 'wife', 'spouse'],
	betrothed: 'betrothed',
	concubinage: 'partner in concubinage',
	lover: 'lover',
	coParent: 'co-parent',
	guardian: 'guardian',
	ward: 'ward',
	byMarriage: 'by marriage',
	parentInLaw: ['father-in-law', 'mother-in-law', 'parent-in-law'],
	grandparentInLaw: ['grandfather-in-law', 'grandmother-in-law', 'grandparent-in-law'],
	childInLaw: ['son-in-law', 'daughter-in-law', 'child-in-law'],
	grandchildInLaw: ['grandson-in-law', 'granddaughter-in-law', 'grandchild-in-law'],
	siblingInLaw: ['brother-in-law', 'sister-in-law', 'sibling-in-law'],
	stepParent: ['stepfather', 'stepmother', 'step-parent'],
	stepGrandparent: ['step-grandfather', 'step-grandmother', 'step-grandparent'],
	stepChild: ['stepson', 'stepdaughter', 'stepchild'],
	stepGrandchild: ['step-grandson', 'step-granddaughter', 'step-grandchild'],
	stepSibling: ['stepbrother', 'stepsister', 'step-sibling'],
} as const;

/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, … */
function ordinal(n: number): string {
	const tens = n % 100;
	if (tens >= 11 && tens <= 13) return `${n}th`;
	return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** 0 → "", 1 → "great-", 2 → "great-great-", 3 or more → "3rd great-", "4th great-", … */
function greats(n: number): string {
	if (n <= 0) return '';
	if (n <= 2) return WORDS.great.repeat(n);
	return `${ordinal(n)} ${WORDS.great}`;
}

/** "half-uncle", but "half first cousin" and "half 3rd great-uncle" when the word has a space. */
const halfOf = (word: string) => (word.includes(' ') ? `${WORDS.half} ${word}` : `${WORDS.half}-${word}`);

/** Parent (1), grandparent (2), great-grandparent (3), …, with the word for `sex`. */
const ancestorWord = (a: number, sex: Sex) => (a === 1 ? WORDS.parent[sex] : `${greats(a - 2)}${WORDS.grand}${WORDS.parent[sex]}`);
/** Child (1), grandchild (2), great-grandchild (3), …, with the word for `sex`. */
const descendantWord = (b: number, sex: Sex) => (b === 1 ? WORDS.child[sex] : `${greats(b - 2)}${WORDS.grand}${WORDS.child[sex]}`);
const siblingWord = (sex: Sex, half: boolean) => (half ? `${WORDS.half}-${WORDS.sibling[sex]}` : WORDS.sibling[sex]);

/** Uncle or aunt with `a` − 2 "great"; the neutral form puts "great" and "half" on the inner word. */
function uncleWord(a: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${ancestorWord(a - 1, 2)}${WORDS.possessive} ${siblingWord(2, half)}`;
	const word = `${greats(a - 2)}${WORDS.uncle[sex]}`;
	return half ? halfOf(word) : word;
}

/** Nephew or niece with `b` − 2 "great"; the neutral form puts "great" and "half" on the inner word. */
function nephewWord(b: number, sex: Sex, half: boolean): string {
	if (sex === 2) return `${siblingWord(2, half)}${WORDS.possessive} ${descendantWord(b - 1, 2)}`;
	const word = `${greats(b - 2)}${WORDS.nephew[sex]}`;
	return half ? halfOf(word) : word;
}

/** "first cousin", "second cousin once removed", "11th cousin 3 times removed". */
function cousinWord(a: number, b: number, half: boolean): string {
	const degree = Math.min(a, b) - 1;
	const removal = Math.abs(a - b);
	let word = `${WORDS.degrees[degree - 1] ?? ordinal(degree)} ${WORDS.cousin}`;
	if (removal === 1) word += ` ${WORDS.once}`;
	else if (removal === 2) word += ` ${WORDS.twice}`;
	else if (removal > 2) word += ` ${WORDS.times(removal)}`;
	return half ? halfOf(word) : word;
}

/** The §13.1 table name of P for M up `a` and P up `b` to the common ancestor, without type words. */
function shapeWord(a: number, b: number, sex: Sex, half: boolean): string {
	if (a === 0) return descendantWord(b, sex);
	if (b === 0) return ancestorWord(a, sex);
	if (a === 1 && b === 1) return siblingWord(sex, half);
	if (b === 1) return uncleWord(a, sex, half);
	if (a === 1) return nephewWord(b, sex, half);
	return cousinWord(a, b, half);
}

/** A union type's partner word (§13.1 partner table); `implicit` is a couple with a child and no union. */
function partnerWord(type: string, implicit: boolean, sex: Sex): string {
	if (implicit) return WORDS.coParent;
	if (type === 'betrothal') return WORDS.betrothed;
	if (type === 'concubinage') return WORDS.concubinage;
	if (type === 'affair') return WORDS.lover;
	return WORDS.spouse[sex];
}

/** A sibling step's word: "rumoured" if one of its two links is rumoured, else "adoptive" if one is adoptive (as a blood name). */
function siblingStepWord(sex: Sex, half: boolean, up: ParentType, down: ParentType): string {
	const word = siblingWord(sex, half);
	if (up === 'rumoured' || down === 'rumoured') return `${WORDS.rumoured} ${word}`;
	if (up === 'adoptive' || down === 'adoptive') return `${WORDS.adoptive} ${word}`;
	return word;
}

const parentStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.guardian : type === 'adoptive' ? `${WORDS.adoptive} ${WORDS.parent[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.parent[sex]}` : WORDS.parent[sex];
const childStepWord = (type: ParentType, sex: Sex) =>
	type === 'ward' ? WORDS.ward : type === 'adoptive' ? `${WORDS.adopted} ${WORDS.child[sex]}` : type === 'rumoured' ? `${WORDS.rumoured} ${WORDS.child[sex]}` : WORDS.child[sex];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------------------------
// The graph by person index

interface Up {
	/** The parent's index. */
	p: number;
	type: ParentType;
}

/** One step of a walk from the first person to the second. */
type Edge = { k: 'up' | 'down'; type: ParentType } | { k: 'partner'; union: string };

/** The people of a relation in step order, and the edge between each two (`edges[i]` joins `nodes[i]` and `nodes[i + 1]`). */
interface Walk {
	nodes: number[];
	edges: Edge[];
}

interface Line {
	people: number[];
	links: { parent: number; child: number; type: ParentType }[];
	unions: string[];
}

/** One blood candidate (X, a, b) of §13.1, with the two paths its line uses. */
interface Blood {
	a: number;
	b: number;
	/** The common ancestor on the line: for a full relation, the member of the couple first in c1's list. */
	x: number;
	/** The other member of the couple of a full relation, or -1. */
	y: number;
	half: boolean;
	double: boolean;
	word: 'birth' | 'adoptive' | 'rumoured';
	/** From the first person up to `x`, both included. */
	pathF: number[];
	/** From the second person up to `x`, both included. */
	pathP: number[];
	key: string;
}

/** Half or full for two children of a common ancestor, the couple of a full relation (else the ancestor), and the candidate key. */
interface Shape {
	half: boolean;
	couple: number[];
	key: string;
}

/** The shortest paths between two people as a whole (`Kin.dagOf`); `rank` is -1 until `Kin.dagRank` sets it. */
interface Dag {
	sole: Int32Array;
	rank: number;
}

/** A named relation before it becomes a `Relation`, with the values the order of §13.1 needs. */
interface Cand {
	lower: string;
	kind: RelationKind;
	distance: number;
	/** Birth 0, adoptive 1, guardian or ward 2, by marriage 3, rumoured 4 ("Which name wins" rule 4). */
	cat: number;
	direct: number;
	half: number;
	removal: number;
	/** Document index of the common ancestor, for the final tie-break. */
	anc: number;
	/** 1 for a name by marriage of a person who also has a blood name: it comes after every other name. */
	after?: number;
	/** Builds the line and the walk; only the names that are kept need them. */
	make: () => { line: Line; walk: Walk };
}

/** Supervisor ruling on rule 3: step-siblings come through birth and adoptive parents only. */
const isStepLink = (l: Up) => l.type === 'birth' || l.type === 'adoptive';
const implicitKey = (a: string, b: string) => `i:${JSON.stringify(a < b ? [a, b] : [b, a])}`;
const isMarriage = (u: FamilyUnion) => !u.implicit && (u.type === 'marriage' || !isUnionType(u.type));

class Kin {
	readonly ids: string[];
	readonly idx = new Map<string, number>();
	readonly sex: Sex[];
	/** Every drawn parent link, in `drawnParents` order. */
	readonly drawn: Up[][];
	/** Parent links that make blood relations (not ward), one per parent (its first type). */
	readonly up: Up[][];
	/** Children through those links, in document order. */
	readonly down: number[][];
	/** Children through any drawn link, in document order, one per child (its first type). */
	readonly downAll: Up[][];
	/** A topological rank: every blood parent has a smaller one than its child. */
	private readonly tau: Int32Array;
	/** The highest `RANK` of any blood link from the person up to its ancestors. */
	private readonly topRank: Uint8Array;
	/** The marks of `mark`: a person is in the current set if its stamp is `stamp`. */
	private readonly stamps: Int32Array;
	private stamp = 0;
	private readonly fromAnc = new Map<number, Map<number, number>>();
	/** `blood` results by `f * n + p`. */
	private readonly bloodMemo = new Map<number, Blood[]>();
	private readonly spouseMemo: (number[] | undefined)[] = [];
	/** `path` results without `blocked`, by `(v * n + t) * 3 + level`. Never changed after. */
	private readonly firstPaths = new Map<number, number[] | null>();
	/** `below` maps by `v * n + t`, kept for the people relations are counted from. */
	private readonly belowMemo = new Map<number, Map<number, number>>();
	/** `below` maps of the other people, by `v * n + t`; emptied for each new second person. */
	private readonly belowScratch = new Map<number, Map<number, number>>();
	/** `parentsOfType` results by `child * 4 + type`. */
	private readonly typedParents = new Map<number, { list: number[]; sig: string }>();
	/** `dagOf` results, kept like `belowMemo` and `belowScratch`. */
	private readonly dagMemo = new Map<number, Dag>();
	private readonly dagScratch = new Map<number, Dag>();

	constructor(readonly g: FamilyGraph) {
		const n = g.people.length;
		this.ids = g.people.map((p) => p.id);
		this.ids.forEach((id, i) => this.idx.set(id, i));
		this.sex = g.people.map((p) => (p.sex === 'm' ? 0 : p.sex === 'f' ? 1 : 2));
		const map = drawnParentMap(g);
		this.drawn = [];
		this.up = [];
		this.down = Array.from({ length: n }, () => []);
		this.downAll = Array.from({ length: n }, () => []);
		for (let i = 0; i < n; i++) {
			const links: Up[] = [];
			for (const d of map.get(this.ids[i]) ?? []) {
				const p = this.idx.get(d.id);
				if (p !== undefined) links.push({ p, type: d.type });
			}
			this.drawn.push(links);
			const up: Up[] = [];
			const seen = new Set<number>();
			const seenAll = new Set<number>();
			for (const l of links) {
				if (!seenAll.has(l.p)) {
					seenAll.add(l.p);
					this.downAll[l.p].push({ p: i, type: l.type });
				}
				if (l.type === 'ward' || seen.has(l.p)) continue;
				seen.add(l.p);
				up.push(l);
				this.down[l.p].push(i);
			}
			this.up.push(up);
		}
		// Parents first (Kahn); the drawn links have no cycle, but a person left over still gets a rank.
		this.tau = new Int32Array(n);
		this.topRank = new Uint8Array(n);
		this.stamps = new Int32Array(n);
		const waiting = this.up.map((u) => u.length);
		const order: number[] = [];
		for (let i = 0; i < n; i++) if (!waiting[i]) order.push(i);
		for (let head = 0; head < order.length; head++) for (const c of this.down[order[head]]) if (--waiting[c] === 0) order.push(c);
		for (let i = 0; i < n; i++) if (waiting[i] > 0) order.push(i);
		order.forEach((v, k) => {
			this.tau[v] = k;
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

	/** The parents of `child` whose link has `type`, in `drawnParents` order, and the same set as a sorted text (kept). */
	parentsOfType(child: number, type: ParentType): { list: number[]; sig: string } {
		const key = child * 4 + PARENT_TYPES.indexOf(type);
		let out = this.typedParents.get(key);
		if (!out) {
			const list = [...new Set(this.drawn[child].filter((l) => l.type === type).map((l) => l.p))];
			out = { list, sig: [...list].sort((i, j) => i - j).join(',') };
			this.typedParents.set(key, out);
		}
		return out;
	}

	/** §13.1 half rule: `c1` (linked by `t1`) and `c2` (by `t2`) have different parents of their link's type. */
	isHalf(c1: number, t1: ParentType, c2: number, t2: ParentType): boolean {
		return this.parentsOfType(c1, t1).sig !== this.parentsOfType(c2, t2).sig;
	}

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
		const aF = this.ancFrom(f);
		aP ??= this.anc(p);
		const common: number[] = [];
		const [small, big] = aF.size <= aP.size ? [aF, aP] : [aP, aF];
		for (const x of small.keys()) if (big.has(x)) common.push(x);
		// Document order, so the same tree always keeps the same candidate of a couple.
		const ordered = Int32Array.from(common).sort();

		const found = new Map<string, Blood>();
		for (const x of ordered) {
			const cs = x === f ? [this.direct(f, p, aP, 0)] : x === p ? [this.direct(f, p, aF, 1)] : this.collateral(f, p, x, aF, aP);
			for (const c of cs) {
				if (!c) continue;
				// A full relation is found at both members of its couple; keep the better word.
				const old = found.get(c.key);
				if (!old || WORD_RANK[c.word] < WORD_RANK[old.word]) found.set(c.key, c);
			}
		}
		const out = this.mergeDoubles([...found.values()]);
		this.bloodMemo.set(memoKey, out);
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
		return { a, b, x: to, y: -1, half: false, double: false, word: this.wordOf(pathF, pathP, -1), pathF, pathP, key: `D:${a}:${b}` };
	}

	/**
	 * The candidates at a common ancestor `x` that is neither person: the shortest pairs of paths
	 * through different children of `x`. §13.1 rule 3 drops a pair when both paths pass through one
	 * other common ancestor below `x`; it stays if one pair of shortest paths shares nobody below
	 * `x` (a person on both paths is a common ancestor, or one of the two people). Each distinct
	 * full or half result is one candidate (D50), so the names never depend on the order of the
	 * children; each takes the pair with the lowest link rank, then the first in list order.
	 */
	private collateral(f: number, p: number, x: number, aF: Map<number, number>, aP: Map<number, number>): Blood[] {
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
		const pairs: { c1: number; c2: number; lo: number; hi: number; shape?: Shape }[] = [];
		for (const c1 of kids) {
			if (aF.get(c1) !== bestF) continue;
			for (const c2 of kids) {
				if (aP.get(c2) !== bestP || c1 === c2) continue;
				pairs.push({ c1, c2, lo: Math.max(RANK[this.typeOf(c1, x)], RANK[this.typeOf(c2, x)]), hi: -1 });
			}
		}
		const shapeOf = (pair: (typeof pairs)[number]) => (pair.shape ??= this.pairShape(x, pair.c1, pair.c2, bestF + 1, bestP + 1));
		const out: Blood[] = [];
		const has = (key: string) => out.some((b) => b.key === key);
		for (let level = 0; level <= 2; level++) {
			for (const pair of pairs) {
				const { c1, c2, lo } = pair;
				// With one pair (nearly always) the key is needed only for a found candidate.
				if (level < lo || ((pairs.length > 1 || pair.shape) && has(shapeOf(pair).key))) continue;
				// A higher level changes the answer only if the shortest-path graphs have a link of that rank.
				if (level > lo) {
					if (level > Math.max(lo, this.topRank[f], this.topRank[p])) continue;
					if (pair.hi < 0) pair.hi = Math.max(lo, this.dagRank(f, c1, aF), this.dagRank(p, c2, aP));
					if (level > pair.hi) continue;
				}
				const paths = this.disjointPair(f, c1, aF, p, c2, aP, level);
				if (paths) out.push(this.collateralCandidate(shapeOf(pair), paths[0], paths[1]));
			}
		}
		return out;
	}

	/** The people of `list` as a set, valid until the next call; this runs for most pairs, so it builds no `Set`. */
	private mark(list: number[]): { has(i: number): boolean } {
		const stamp = ++this.stamp;
		for (const v of list) this.stamps[v] = stamp;
		return { has: (i) => this.stamps[i] === stamp };
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

	/** Half or full for the children `c1` and `c2` of `x` (§13.1 half rule), the couple, and the candidate key. */
	private pairShape(x: number, c1: number, c2: number, a: number, b: number): Shape {
		const t1 = this.typeOf(c1, x);
		const own = this.parentsOfType(c1, t1);
		const half = own.sig !== this.parentsOfType(c2, this.typeOf(c2, x)).sig;
		return half ? { half, couple: [x], key: `H:${x}:${a}:${b}` } : { half, couple: own.list, key: `F:${own.sig}:${a}:${b}` };
	}

	private collateralCandidate(shape: Shape, pf: number[], pp: number[]): Blood {
		const { half, couple, key } = shape;
		const lx = couple[0];
		const y = couple.length > 1 ? couple[1] : -1;
		const pathF = [...pf, lx];
		const pathP = [...pp, lx];
		return { a: pathF.length - 1, b: pathP.length - 1, x: lx, y, half, double: false, word: this.wordOf(pathF, pathP, y), pathF, pathP, key };
	}

	/** "rumoured" if a link of the line is rumoured, else "adoptive" if one is adoptive, else "birth". */
	private wordOf(pathF: number[], pathP: number[], y: number): Blood['word'] {
		let adoptive = false;
		const check = (child: number, parent: number) => {
			const t = this.typeOf(child, parent);
			if (t === 'adoptive') adoptive = true;
			return t === 'rumoured';
		};
		for (const path of [pathF, pathP]) {
			for (let i = 0; i + 1 < path.length; i++) if (check(path[i], path[i + 1])) return 'rumoured';
			if (y >= 0 && path.length >= 2 && check(path[path.length - 2], y)) return 'rumoured';
		}
		return adoptive ? 'adoptive' : 'birth';
	}

	/** §13.1 "Double": one cousin name from two different couples is one "double" name, with the first couple's line. */
	private mergeDoubles(list: Blood[]): Blood[] {
		const groups = new Map<string, Blood[]>();
		for (const c of list) if (!c.half && c.a >= 2 && c.b >= 2) push(groups, `${c.word}:${cousinWord(c.a, c.b, false)}`, c);
		const drop = new Set<Blood>();
		for (const group of groups.values()) {
			if (group.length < 2) continue;
			group.sort((i, j) => i.x - j.x);
			group[0].double = true;
			for (const c of group.slice(1)) drop.add(c);
		}
		return list.filter((c) => !drop.has(c));
	}

	/** The name of a blood candidate, with the words for the second person's `sex`. */
	bloodLower(c: Blood, sex: Sex): string {
		let word = shapeWord(c.a, c.b, sex, c.half);
		if (c.double) word = `${WORDS.double} ${word}`;
		if (c.word === 'rumoured') word = `${WORDS.rumoured} ${word}`;
		else if (c.word === 'adoptive') word = `${c.a === 0 ? WORDS.adopted : WORDS.adoptive} ${word}`;
		return word;
	}

	/**
	 * The walk of a blood candidate (file header, "Lines", blood): up from the first person to `x`;
	 * for a full relation across the couple to `x`'s partner; then down to the second person.
	 */
	bloodWalk(c: Blood): Walk {
		const nodes = [...c.pathF];
		const edges: Edge[] = [];
		for (let i = 0; i + 1 < c.pathF.length; i++) edges.push({ k: 'up', type: this.typeOf(c.pathF[i], c.pathF[i + 1]) });
		let top = c.x;
		if (c.y >= 0 && c.a > 0 && c.b > 0) {
			nodes.push(c.y);
			edges.push({ k: 'partner', union: this.coupleUnion(c.pathF[c.pathF.length - 2], c.x, c.y) });
			top = c.y;
		}
		for (let i = c.pathP.length - 2; i >= 0; i--) {
			nodes.push(c.pathP[i]);
			edges.push({ k: 'down', type: this.typeOf(c.pathP[i], i === c.pathP.length - 2 ? top : c.pathP[i + 1]) });
		}
		return { nodes, edges };
	}

	/** The line of a blood candidate. */
	bloodLine(c: Blood): Line {
		return walkLine(this.bloodWalk(c));
	}

	/** c1's primary union if it is the couple's, else the couple's last-listed union, else the implicit key. */
	private coupleUnion(c1: number, x: number, y: number): string {
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

	/** Every named relation of `p` to `m` (§13.1), best first, one per name. */
	relationsFor(m: number, p: number): Cand[] {
		this.belowScratch.clear();
		this.dagScratch.clear();
		const cands: Cand[] = [];
		const sexP = this.sex[p];
		const aP = this.anc(p);

		const pu = this.pairUnion(m, p);
		if (pu) {
			const walk: Walk = { nodes: [m, p], edges: [{ k: 'partner', union: pu.key }] };
			cands.push({ lower: partnerWord(pu.type, pu.implicit, sexP), kind: 'partner', distance: 1, cat: 0, direct: 1, half: 0, removal: 0, anc: -1, make: () => ({ line: walkLine(walk), walk }) });
		}

		if (this.drawn[m].some((l) => l.p === p && l.type === 'ward')) cands.push(this.wardCand(m, p, 'guardian'));
		if (this.drawn[p].some((l) => l.p === m && l.type === 'ward')) cands.push(this.wardCand(m, p, 'ward'));

		const blood = this.blood(m, p, aP);
		for (const c of blood) {
			cands.push({
				lower: this.bloodLower(c, sexP),
				kind: 'blood',
				distance: c.a + c.b,
				cat: c.word === 'rumoured' ? 4 : c.word === 'adoptive' ? 1 : 0,
				direct: c.a === 0 || c.b === 0 ? 0 : 1,
				half: c.half ? 1 : 0,
				removal: Math.abs(c.a - c.b),
				anc: c.x,
				make: () => ({ line: this.bloodLine(c), walk: this.bloodWalk(c) }),
			});
		}

		// By marriage, rule 1: P is married to a blood relative R of M, and P is not one.
		if (!blood.length) {
			for (const r of this.spouses(p)) {
				if (r === m) continue;
				const marriage = this.lastUnion(r, p, true)!;
				for (const c of this.blood(m, r)) {
					cands.push(
						this.marriageCand(this.rule1Word(c, this.sex[r], sexP), c, () => {
							const line = this.bloodLine(c);
							line.people.push(p);
							line.unions.push(marriage.key);
							const walk = this.bloodWalk(c);
							walk.nodes.push(p);
							walk.edges.push({ k: 'partner', union: marriage.key });
							return { line, walk };
						}),
					);
				}
			}
		}

		// By marriage, rule 2: P is a blood relative of M's spouse S.
		for (const s of this.spouses(m)) {
			if (s === p) continue;
			const marriage = this.lastUnion(m, s, true)!;
			for (const c of this.blood(s, p, aP)) {
				// A descendant of S through M's own child is M's own descendant, not a step-relation.
				if (c.a === 0 && this.up[c.pathP[c.pathP.length - 2]].some((l) => l.p === m)) continue;
				// The line lists each person once, so a relation to S that runs through M is not one by marriage.
				if (c.y === m || c.pathF.includes(m) || c.pathP.includes(m)) continue;
				cands.push(
					this.marriageCand(this.rule2Word(c, sexP, this.sex[s]), c, () => {
						const inner = this.bloodLine(c);
						const walk = this.bloodWalk(c);
						return {
							line: { people: [m, ...inner.people], links: inner.links, unions: [marriage.key, ...inner.unions] },
							walk: { nodes: [m, ...walk.nodes], edges: [{ k: 'partner', union: marriage.key }, ...walk.edges] },
						};
					}),
				);
			}
		}

		const step = this.stepSibling(m, p);
		if (step) cands.push(step);

		// Supervisor ruling: a name by marriage (rules 1 and 2) never wins over a blood name.
		if (blood.length) for (const c of cands) if (c.kind === 'by-marriage') c.after = 1;
		cands.sort(compareCands);
		const seen = new Set<string>();
		return cands.filter((c) => {
			if (seen.has(c.lower)) return false;
			seen.add(c.lower);
			return true;
		});
	}

	private wardCand(m: number, p: number, kind: 'guardian' | 'ward'): Cand {
		const [parent, child] = kind === 'guardian' ? [p, m] : [m, p];
		const walk: Walk = { nodes: [m, p], edges: [{ k: kind === 'guardian' ? 'up' : 'down', type: 'ward' }] };
		const line: Line = { people: [m, p], links: [{ parent, child, type: 'ward' }], unions: [] };
		return { lower: kind === 'guardian' ? WORDS.guardian : WORDS.ward, kind, distance: 1, cat: 2, direct: 1, half: 0, removal: 0, anc: -1, make: () => ({ line, walk }) };
	}

	private marriageCand(lower: string, c: Blood, make: Cand['make']): Cand {
		return {
			lower,
			kind: 'by-marriage',
			distance: 1 + c.a + c.b,
			cat: 3,
			direct: c.a === 0 || c.b === 0 ? 0 : 1,
			half: c.half ? 1 : 0,
			removal: Math.abs(c.a - c.b),
			anc: c.x,
			make,
		};
	}

	/** Rule 1 names, by R's relation `c` to M; P has `sexP`, R has `sexR`. */
	private rule1Word(c: Blood, sexR: Sex, sexP: Sex): string {
		const { a, b } = c;
		if (b === 0 && a === 1) return WORDS.stepParent[sexP];
		if (b === 0 && a === 2) return WORDS.stepGrandparent[sexP];
		if (a === 0 && b === 1) return WORDS.childInLaw[sexP];
		if (a === 0 && b === 2) return WORDS.grandchildInLaw[sexP];
		if (a === 1 && b === 1) return WORDS.siblingInLaw[sexP];
		if (a >= 2 && b === 1) return `${uncleWord(a, sexP, false)} ${WORDS.byMarriage}`;
		if (a === 1 && b >= 2) return `${nephewWord(b, sexP, false)} ${WORDS.byMarriage}`;
		if (a >= 2 && b >= 2) return `${cousinWord(a, b, false)} ${WORDS.byMarriage}`;
		return `${this.bloodLower(c, sexR)}${WORDS.possessive} ${WORDS.spouse[sexP]}`;
	}

	/** Rule 2 names, by P's relation `c` to M's spouse S. */
	private rule2Word(c: Blood, sexP: Sex, sexS: Sex): string {
		const { a, b } = c;
		if (b === 0 && a === 1) return WORDS.parentInLaw[sexP];
		if (b === 0 && a === 2) return WORDS.grandparentInLaw[sexP];
		if (a === 1 && b === 1) return WORDS.siblingInLaw[sexP];
		if (a === 0 && b === 1) return WORDS.stepChild[sexP];
		if (a === 0 && b === 2) return WORDS.stepGrandchild[sexP];
		return `${WORDS.spouse[sexS]}${WORDS.possessive} ${this.bloodLower(c, sexP)}`;
	}

	/** Rule 3: P is a child of Q, Q is married to M's parent N, and P and M share no parent (birth and adoptive parents only). */
	private stepSibling(m: number, p: number): Cand | undefined {
		const mine = this.up[m].filter(isStepLink);
		const theirs = this.up[p].filter(isStepLink);
		if (mine.some((l) => theirs.some((t) => t.p === l.p))) return undefined;
		for (const n of mine) {
			for (const q of this.spouses(n.p)) {
				const link = theirs.find((t) => t.p === q);
				if (!link || new Set([m, n.p, q, p]).size < 4) continue;
				const marriage = this.lastUnion(n.p, q, true)!;
				const walk: Walk = {
					nodes: [m, n.p, q, p],
					edges: [
						{ k: 'up', type: n.type },
						{ k: 'partner', union: marriage.key },
						{ k: 'down', type: link.type },
					],
				};
				return { lower: WORDS.stepSibling[this.sex[p]], kind: 'step-sibling', distance: 3, cat: 3, direct: 1, half: 0, removal: 0, anc: -1, make: () => ({ line: walkLine(walk), walk }) };
			}
		}
		return undefined;
	}

	/** The shortest chain of links of any type and partnerships (§13.2), by the search order of the file header. */
	chain(f: number, t: number): Walk | undefined {
		const n = this.ids.length;
		const prev = new Int32Array(n).fill(-1);
		const via: (Edge | undefined)[] = new Array(n);
		prev[f] = f;
		const queue = [f];
		for (let head = 0; head < queue.length && prev[t] < 0; head++) {
			const v = queue[head];
			const visit = (w: number, e: Edge) => {
				if (prev[w] >= 0) return;
				prev[w] = v;
				via[w] = e;
				queue.push(w);
			};
			for (const l of this.drawn[v]) visit(l.p, { k: 'up', type: l.type });
			for (const c of this.downAll[v]) visit(c.p, { k: 'down', type: c.type });
			for (const w of this.partners(v)) visit(w, { k: 'partner', union: this.pairUnion(v, w)?.key ?? implicitKey(this.ids[v], this.ids[w]) });
		}
		if (prev[t] < 0) return undefined;
		const nodes = [t];
		const edges: Edge[] = [];
		for (let cur = t; cur !== f; cur = prev[cur]) {
			nodes.push(prev[cur]);
			edges.push(via[cur]!);
		}
		return { nodes: nodes.reverse(), edges: edges.reverse() };
	}

	/** The steps of a walk (file header, "Steps"): an up step then a down step to another child is one sibling step (not through a ward link). */
	steps(walk: Walk): RelationStep[] {
		const out: RelationStep[] = [];
		const { nodes, edges } = walk;
		for (let i = 0; i < edges.length; i++) {
			const e = edges[i];
			const from = nodes[i];
			const to = nodes[i + 1];
			const after = edges[i + 1];
			// A ward is not a sibling: a ward link stays a step of its own.
			if (e.k === 'up' && after?.k === 'down' && nodes[i + 2] !== from && e.type !== 'ward' && after.type !== 'ward') {
				const sib = nodes[i + 2];
				const half = this.isHalf(from, e.type, sib, after.type);
				out.push({ person: this.ids[sib], of: this.ids[from], word: siblingStepWord(this.sex[sib], half, e.type, after.type) });
				i++;
				continue;
			}
			let word: string;
			if (e.k === 'partner') {
				const fu = this.g.unionByKey.get(e.union);
				word = partnerWord(fu?.type ?? 'implicit', fu ? fu.implicit : true, this.sex[to]);
			} else word = e.k === 'up' ? parentStepWord(e.type, this.sex[to]) : childStepWord(e.type, this.sex[to]);
			out.push({ person: this.ids[to], of: this.ids[from], word });
		}
		return out;
	}

	/** A `Relation` with ids in place of indices. */
	relation(c: Cand, line: Line): Relation {
		return { text: capital(c.lower), lower: c.lower, kind: c.kind, distance: c.distance, line: this.lineIds(line) };
	}

	/**
	 * A frozen `Relation` whose line is built (and frozen) the first time it is read: a tree of
	 * hundreds of people has thousands of names, and the cards need only the text.
	 */
	lazyRelation(c: Cand): Relation {
		let line: RelationLine | undefined;
		const make = () => (line ??= deepFreeze(this.lineIds(c.make().line)));
		return Object.freeze({
			text: capital(c.lower),
			lower: c.lower,
			kind: c.kind,
			distance: c.distance,
			get line() {
				return make();
			},
		});
	}

	/** Drops the search memos; the lines built later need only the graph and the candidates. */
	release(): void {
		this.fromAnc.clear();
		this.bloodMemo.clear();
		this.firstPaths.clear();
		this.belowMemo.clear();
		this.belowScratch.clear();
		this.dagMemo.clear();
		this.dagScratch.clear();
	}

	lineIds(line: Line): RelationLine {
		return {
			people: line.people.map((i) => this.ids[i]),
			links: line.links.map((l): RelationLink => ({ parent: this.ids[l.parent], child: this.ids[l.child], type: l.type })),
			unions: [...line.unions],
		};
	}
}

/** Smaller a + b first, then the smaller removal, then the smaller first distance. */
function better(d1: number, d2: number, b1: number, b2: number): boolean {
	if (d1 + d2 !== b1 + b2) return d1 + d2 < b1 + b2;
	if (Math.abs(d1 - d2) !== Math.abs(b1 - b2)) return Math.abs(d1 - d2) < Math.abs(b1 - b2);
	return d1 < b1;
}

/** The line of a walk: its people, its parent links and its partnerships, in step order. */
function walkLine(walk: Walk): Line {
	const line: Line = { people: [...walk.nodes], links: [], unions: [] };
	walk.edges.forEach((e, i) => {
		const [a, b] = [walk.nodes[i], walk.nodes[i + 1]];
		if (e.k === 'partner') line.unions.push(e.union);
		else line.links.push(e.k === 'up' ? { parent: b, child: a, type: e.type } : { parent: a, child: b, type: e.type });
	});
	return line;
}

/** §13.1 "Which name wins": partner first, then distance, kind of link, direct line, full, removal; then the tie-break of the file header. */
function compareCands(x: Cand, y: Cand): number {
	const partner = (c: Cand) => (c.kind === 'partner' ? 0 : 1);
	return (
		partner(x) - partner(y) ||
		(x.after ?? 0) - (y.after ?? 0) ||
		x.distance - y.distance ||
		x.cat - y.cat ||
		x.direct - y.direct ||
		x.half - y.half ||
		x.removal - y.removal ||
		x.anc - y.anc ||
		(x.lower < y.lower ? -1 : x.lower > y.lower ? 1 : 0)
	);
}

const readOnly = () => {
	throw new TypeError('Relation results are read-only');
};

/** Blocks `set`, `delete` and `clear` too: `Object.freeze` does not stop them on a Map, and the views share the result. */
function freezeMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
	for (const method of ['set', 'delete', 'clear']) Object.defineProperty(map, method, { value: readOnly });
	return Object.freeze(map);
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	if (Array.isArray(value)) for (const v of value) deepFreeze(v);
	else for (const key in value) deepFreeze(value[key]);
	return Object.freeze(value);
}

// ---------------------------------------------------------------------------------------------
// Public functions

/** Implements `ComputeRelations`: every person's relations to `me`, best first. */
export const computeRelations: ComputeRelations = (g, me) => {
	const out = new Map<string, readonly Relation[]>();
	const kin = new Kin(g);
	const m = kin.idx.get(me);
	if (m === undefined) return freezeMap(out);
	const self: Relation = { text: capital(WORDS.you), lower: WORDS.you, kind: 'self', distance: 0, line: { people: [me], links: [], unions: [] } };
	for (let p = 0; p < kin.ids.length; p++) {
		if (p === m) {
			out.set(me, deepFreeze([self]));
			continue;
		}
		const cands = kin.relationsFor(m, p);
		if (cands.length) out.set(kin.ids[p], Object.freeze(cands.map((c) => kin.lazyRelation(c))));
	}
	kin.release();
	return freezeMap(out);
};

/** Implements `FindRelation`: the second person as a relative of the first (§13.2). */
export const findRelation: FindRelation = (g, first, second) => {
	const none: FinderResult = { kind: 'none', first, second };
	const kin = new Kin(g);
	const f = kin.idx.get(first);
	const s = kin.idx.get(second);
	if (f === undefined || s === undefined || f === s) return deepFreeze(none);
	const cands = kin.relationsFor(f, s);
	if (cands.length) {
		const relations = cands.slice(0, FINDER_LIMIT).map((c) => {
			const { line, walk } = c.make();
			return { relation: kin.relation(c, line), steps: kin.steps(walk) };
		});
		return deepFreeze({ kind: 'named', first, second, relations });
	}
	const walk = kin.chain(f, s);
	if (!walk) return deepFreeze(none);
	return deepFreeze({ kind: 'chain', first, second, steps: kin.steps(walk), line: kin.lineIds(walkLine(walk)) });
};

/** Implements `LineSubgraph`: the small tree of one relation line (D47). */
export const lineSubgraph: LineSubgraph = (g, line) => {
	const on = new Set(line.people.filter((id) => g.byId.has(id)));
	const own = new Map<string, RelationLink[]>();
	const has = (l: RelationLink) => (own.get(l.child) ?? []).some((k) => k.parent === l.parent && k.type === l.type);
	for (const l of line.links) if (on.has(l.parent) && on.has(l.child) && !has(l)) push(own, l.child, l);
	// Supervisor ruling: a full relation's couple keeps its shared trunk. A child on the line with a
	// link to one partner of a couple of the line also keeps its drawn link of the same type to the other.
	const drawn = drawnParentMap(g);
	for (const key of line.unions) {
		const pair = g.unionByKey.get(key)?.partners ?? (key.startsWith('i:') ? parsePair(key.slice(2)) : undefined);
		if (!pair || !pair.every((id) => on.has(id))) continue;
		for (const l of [...line.links]) {
			const other = l.parent === pair[0] ? pair[1] : l.parent === pair[1] ? pair[0] : undefined;
			if (other === undefined || !on.has(l.child) || !(drawn.get(l.child) ?? []).some((d) => d.id === other && d.type === l.type)) continue;
			const link: RelationLink = { parent: other, child: l.child, type: l.type };
			if (!has(link)) push(own, l.child, link);
		}
	}
	// Parents in the order the whole tree lists them, so the small tree places a child as it does.
	const order = (id: string, links: RelationLink[]) => {
		const rank = (l: RelationLink) => {
			const k = (drawn.get(id) ?? []).findIndex((d) => d.id === l.parent && d.type === l.type);
			return k < 0 ? Infinity : k;
		};
		return [...links].sort((a, b) => rank(a) - rank(b));
	};
	for (const [id, links] of own) own.set(id, order(id, links));
	const people = g.people.filter((p) => on.has(p.id)).map((p) => ({ ...p, parents: (own.get(p.id) ?? []).map((l) => ({ id: l.parent, type: l.type })) }));

	const unions: Union[] = [];
	for (const key of new Set(line.unions)) {
		const fu = g.unionByKey.get(key);
		if (!fu || fu.implicit || fu.unionIndex === undefined || !fu.partners.every((id) => on.has(id))) continue;
		const u: Union = { partners: [...fu.partners], type: fu.type, index: fu.unionIndex };
		if (fu.id !== undefined) u.id = fu.id;
		if (fu.start !== undefined) u.start = fu.start;
		if (fu.end !== undefined) u.end = fu.end;
		if (fu.text !== undefined) u.text = fu.text;
		unions.push(u);
	}
	unions.sort((a, b) => a.index - b.index);
	const tree: Tree = { options: {}, houses: [...g.houses.values()], people, unions, issues: [] };
	const sub = deriveFamilies(tree);
	// Spec §13.4, titles rule 3 (`titles.ts` header): the whole tree's titles, unchanged, so the cards show the same texts.
	sub.titles = g.titles;
	sub.writtenTitles = g.writtenTitles;

	// A child on the line only through rumoured links hangs from its first rumoured parent (drawn
	// with the rumoured line and its "?"), not as a separate root.
	for (const p of sub.people) {
		if ((sub.placementParents.get(p.id) ?? []).length) continue;
		const links = own.get(p.id) ?? [];
		if (!links.length || links.some((l) => l.type !== 'rumoured')) continue;
		const parent = links[0].parent;
		sub.placementParents.set(p.id, [parent]);
		sub.placementType.set(p.id, 'rumoured');
		const solo = sub.soloChildren.get(parent) ?? [];
		solo.push(p.id);
		solo.sort((a, b) => sub.byId.get(a)!.index - sub.byId.get(b)!.index);
		sub.soloChildren.set(parent, solo);
		sub.secondary = sub.secondary.flatMap((e) => {
			if (e.child !== p.id || e.type !== 'rumoured' || !e.parents.includes(parent)) return [e];
			const rest = e.parents.filter((q) => q !== parent);
			return rest.length ? [{ child: e.child, type: e.type, parents: rest }] : [];
		});
	}

	// An implicit couple of the line with no shared child on it stays as a plain connector.
	for (const key of line.unions) {
		if (!key.startsWith('i:') || sub.unionByKey.has(key)) continue;
		const pair = parsePair(key.slice(2));
		if (!pair || !pair.every((id) => on.has(id))) continue;
		const fu: FamilyUnion = { key, partners: pair, type: 'implicit', implicit: true, children: [] };
		sub.unions.push(fu);
		sub.unionByKey.set(key, fu);
		for (const id of pair) push(sub.unionsOf, id, key);
	}
	return { ...sub, issues: [] };
};

function parsePair(json: string): [string, string] | undefined {
	try {
		const v: unknown = JSON.parse(json);
		if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && v[0] !== v[1]) return [v[0], v[1]];
	} catch {
		// Not a key this module made.
	}
	return undefined;
}

/** Implements `RelationsKey`: what `computeRelations(g, me)` depends on, not names. */
export const relationsKey: RelationsKey = (g, me) => {
	const drawn = drawnParentMap(g);
	const people = g.people.map((p) => [p.id, p.sex ?? null, g.primaryUnion.get(p.id) ?? null, (drawn.get(p.id) ?? []).map((d: DrawnParent) => [d.id, d.type])]);
	const unions = g.unions.map((u) => [u.key, u.partners, u.type]);
	return JSON.stringify([me, people, unions]);
};
