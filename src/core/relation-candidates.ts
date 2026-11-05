/*
 * The helpers on lists of candidates for the relation names: joining two candidates of one key, the "double" test, the order of the names (`compareCands`) and the line of a walk. They
 * read only the candidates they get, not the graph.
 */

import type { Blood, BloodLine, Cand, Counted, Line, Via, Walk } from './relation-internal';
import { type RelationMaybe, WORD_RANK } from './relation-types';
import { sameList } from './same-list';

/** D200 R4: a child with two sure parents and a rumoured parent may have just the two sure parents (the rumour may be false). */
function hasSureAlone(s: Counted): boolean {
	return s.canLack && s.hasRumoured && s.sureList.length === 2;
}

/** D200 R4: the parent sets that a child could have, as outcomes: its choices, and the sure set alone when `hasSureAlone`. Only the maybe of a half pair reads the sure set alone; `choices` itself is unchanged (D174 item 4). */
export function outcomesOf(s: Counted): number[][] {
	return hasSureAlone(s) ? [...s.choices, s.sureList] : s.choices;
}

/** Rule D (D307): one name for one tie. A name that comes both with "former" and without (two marriages, one of them ended) keeps only the form without. */
export function withoutFormerTwins(cands: Cand[]): Cand[] {
	if (!cands.some((c) => c.base !== undefined)) return cands;
	const plain = new Set<string>();
	for (const c of cands) if (c.base === undefined) plain.add(c.lower);
	return cands.filter((c) => c.base === undefined || !plain.has(c.base));
}

/** Smaller a + b first, then the smaller removal, then the smaller first distance. */
export function better(d1: number, d2: number, b1: number, b2: number): boolean {
	if (d1 + d2 !== b1 + b2) return d1 + d2 < b1 + b2;
	if (Math.abs(d1 - d2) !== Math.abs(b1 - b2)) return Math.abs(d1 - d2) < Math.abs(b1 - b2);
	return d1 < b1;
}

/** Rule 6 order of a maybe: 'full' first, then a rumoured cause, then one with `some` (D176), so the flag never depends on the order of the people. */
export const doubtRank = (maybe: 'full' | 'half', cause: RelationMaybe['cause'], some?: true, form?: RelationMaybe['unlistedForm']) => (((maybe === 'full' ? 0 : 2) + (cause === 'rumoured' ? 0 : 1)) * 2 + (some ? 0 : 1)) * 2 + (form === 'other-parent' ? 1 : 0);

/**
 * Which sentence tells the user what to check. Two siblings that both list the same single parent (or any pair
 * above the sibling level, the known limit) read 'same-person'; if one lists both parents, the other's unlisted parent
 * is the question: 'other-parent'. The first kind wins when both are possible, so the answer never depends on the order.
 */
export function unlistedForm(sibling: boolean, s1: Counted, s2: Counted): RelationMaybe['unlistedForm'] {
	if (!sibling) return 'same-person';
	for (const a of s1.choices) for (const b of s2.choices) if (joinedSize(a, b) <= 2 && a.length === 1 && b.length === 1) return 'same-person';
	return 'other-parent';
}

/**
 * Two candidates with one key: the one with the better word (the first if equal), with the better
 * maybe of the two if their words are equal (rule 6), so the result never depends on their order.
 */
export function joinCandidates(old: Blood, c: Blood): Blood {
	const keep = WORD_RANK[c.word] < WORD_RANK[old.word] ? c : old;
	for (const v of (keep === c ? old : c).via) addVia(keep, v);
	if (WORD_RANK[c.word] !== WORD_RANK[old.word]) return keep;
	if (c.maybe && (!old.maybe || doubtRank(c.maybe, c.cause!, c.some, c.form) < doubtRank(old.maybe, old.cause!, old.some, old.form))) {
		old.maybe = c.maybe;
		old.cause = c.cause;
		if (c.some) old.some = true;
		else delete old.some;
		if (c.form) old.form = c.form;
		else delete old.form;
		const from = c.maybeFrom ?? c;
		old.maybeFrom = sameLine(old, from) ? undefined : (c.maybeFrom ?? lineOf(c));
	}
	addLines(old, c);
	return old;
}

/**
 * Adds the lines of `c`, which is dropped for `old`, to `old.also`: one flat list, each line once and not
 * `old`'s own (a full line is often found the same at both members of its couple), so the list stays short.
 */
export function addLines(old: Blood, c: Blood): void {
	if (isNewLine(old, c)) (old.also ??= []).push(lineOf(c));
	if (c.also) for (const d of c.also) if (isNewLine(old, d)) (old.also ??= []).push(d);
}

/** True if `d` is neither the line of `c` nor one of its other lines. */
function isNewLine(c: Blood, d: BloodLine): boolean {
	if (sameLine(c, d)) return false;
	if (c.also) for (const e of c.also) if (sameLine(e, d)) return false;
	return true;
}

/** The line of a candidate alone, so that a list of lines does not keep the rest of a dropped candidate. */
const lineOf = (c: BloodLine): BloodLine => ({ a: c.a, b: c.b, x: c.x, y: c.y, pathF: c.pathF, pathP: c.pathP });

/** True if two lines have the same people in the same places: `bloodWalk` makes the same walk of them. */
function sameLine(c: BloodLine, d: BloodLine): boolean {
	return c === d || (c.x === d.x && c.y === d.y && sameList(c.pathF, d.pathF) && sameList(c.pathP, d.pathP));
}

/** Drops the other lines of the candidates of `list` once the names of one person are made: their closures keep the line they show, and a result keeps every candidate it names. */
export function forget(list: Blood[]): void {
	// Only where set: a new property on every candidate would cost memory.
	for (const c of list) {
		if (c.also) c.also = undefined;
		if (c.maybeFrom) c.maybeFrom = undefined;
	}
}

/** Adds the line `v` to the candidate `c` once. */
export function addVia(c: Blood, v: Via): void {
	if (!c.via.some((w) => w.c1 === v.c1 && w.c2 === v.c2 && w.word === v.word)) c.via.push(v);
}

/**
 * §13.1 "Double" (D175): two full candidates of one name and one word come from two couples, unless
 * one is a couple of the second test (an FR key) and a couple of two or more people of one is part of
 * the couple of the other (a sure couple plus a rumoured parent), or every line of both, of that word,
 * leaves through the same two children. Two couples that share one person (a man with two wives) are
 * still two couples, and so are one parent alone and a couple with that parent (setting off).
 */
export function twoCouples(c: Blood, d: Blood): boolean {
	if (oneCouple(c, d)) return false;
	// Any two different lines will do: one line for each couple.
	const lines = [...c.via, ...d.via].filter((v) => v.word === c.word);
	return lines.some((v) => v.c1 !== lines[0].c1 || v.c2 !== lines[0].c2);
}

/** The couple test of `twoCouples`, which reads no line: one is a couple of the second test and a couple of two or more people of one is part of the couple of the other. */
function oneCouple(c: Blood, d: Blood): boolean {
	return (isFullRuleOne(c) || isFullRuleOne(d)) && (inside(c.couple, d.couple) || inside(d.couple, c.couple));
}

/** The negation of `oneCouple`, in the form `anyPair` takes. */
export const notOneCouple = (c: Blood, d: Blood) => !oneCouple(c, d);

/** True if `s` has two or more people and all are in `t`. */
function inside(s: number[], t: number[]): boolean {
	if (s.length < 2) return false;
	for (const v of s) if (!t.includes(v)) return false;
	return true;
}

/** True if `test` holds for two different candidates of `group` (the first before the second). */
export function anyPair(group: Blood[], test: (c: Blood, d: Blood) => boolean): boolean {
	for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) if (test(group[i], group[j])) return true;
	return false;
}

/** A full cousin candidate: only these can make a "double" name. */
export const isFullCousin = (c: Blood) => !c.half && c.a >= 2 && c.b >= 2;

/** The number of full cousin candidates of `list`, up to 2. */
export function cousinCount(list: Blood[]): number {
	let n = 0;
	for (const c of list) if (isFullCousin(c) && ++n === 2) break;
	return n;
}

/** True for a full candidate whose couple comes from the second test (rule 1, `ruleOneKey`). */
const isFullRuleOne = (c: Blood) => c.key.startsWith('FR');

/** True for a candidate that has a rule 1 key (`ruleOneKey`). */
export const isRuleOne = (c: Blood) => c.key.charCodeAt(1) === 82;

/**
 * The key of a rule 1 candidate whose half or full differs from the sure test: a half one passes `x`
 * alone; a full one is its couple of the second test (`set`, sorted), as a sure full key is its couple
 * (D175). The "R" keeps it apart from a sure key, so a rumoured line never joins a sure one.
 */
export const ruleOneKey = (half: boolean, x: number, set: string, a: number, b: number) => (half ? `HR:${x}:${a}:${b}` : `FR:${set}:${a}:${b}`);

/** The number of different people in two short lists (the two parent sets of D174 rule 2). */
export function joinedSize(a: number[], b: number[]): number {
	let n = a.length;
	for (const v of b) if (!a.includes(v)) n++;
	return n;
}

/** Which of two maybes of one name is kept: 'full' first, then a rumoured cause. */
export const maybeRank = (m: RelationMaybe) => doubtRank(m.effect, m.cause, m.some, m.unlistedForm);

/** The line of a walk: its people, its parent links and its partnerships, in step order. */
export function walkLine(walk: Walk): Line {
	const line: Line = { people: [...walk.nodes], links: [], unions: [] };
	walk.edges.forEach((e, i) => {
		const [a, b] = [walk.nodes[i], walk.nodes[i + 1]];
		if (e.k === 'partner') line.unions.push(e.union);
		else line.links.push(e.k === 'up' ? { parent: b, child: a, type: e.type } : { parent: a, child: b, type: e.type });
	});
	return line;
}

/**
 * §13.1 "Which name wins" with the eleven keys of D200 R3, every one a property of the name and none of the place in the note:
 * 1 partner names; 2 sure blood before by marriage (`after`); 3 smaller distance; 4 link kind (`cat`); 5 direct line;
 * 6 full before half; 7 smaller removal; 8 older generation first (larger `elder`); 9 by marriage: step, in-law, "by
 * marriage", possessive (`group`); 10 the name text by code unit (`<`, not `localeCompare`, so no locale decides);
 * 11 the common ancestor's index, only to choose which line a name shows.
 */
export function compareCands(x: Cand, y: Cand): number {
	const partner = (c: Cand) => (c.kind === 'partner' ? 0 : 1);
	// Without "former", so that the word never changes the order of names (D307).
	const xl = x.base ?? x.lower;
	const yl = y.base ?? y.lower;
	return (
		partner(x) - partner(y) ||
		(x.after ?? 0) - (y.after ?? 0) ||
		x.distance - y.distance ||
		x.cat - y.cat ||
		x.direct - y.direct ||
		x.half - y.half ||
		x.removal - y.removal ||
		y.elder - x.elder ||
		x.group - y.group ||
		(xl < yl ? -1 : xl > yl ? 1 : 0) ||
		x.anc - y.anc
	);
}
