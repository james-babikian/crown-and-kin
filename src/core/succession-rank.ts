/*
 * The sort of the succession walks: the claim children of one parent in sibling rank. It holds the birth-year order of brothers and
 * sisters (D193, slot-fill), the groups of the gender step and the reign step, the reversal of `youngest-child`, and the notes that the
 * order leaves for the window (D202, S3). The walk (`succession-pass.ts`) calls `rank` for each parent it follows.
 */

import { claimKids, sameParents, sexOk, stepOf, type PassCtx } from './succession-ctx';
import type { Life } from './succession-dates';
import type { Person } from './types';

/**
 * D193 key 3 (slot-fill): the children with a birth year are put in year order, the earlier first, and fill the places
 * that the dated children hold in the written order; a child with no year keeps its place and equal years keep the written order.
 */
function slotFill(life: Life, group: Person[]): Person[] {
	const yearAt = life.born;
	let last = -Infinity;
	let sorted = true;
	let dated = 0;
	for (let i = 0; i < group.length; i++) {
		const y = yearAt(group[i]);
		if (y === undefined) continue;
		dated++;
		if (y < last) sorted = false;
		last = y;
	}
	if (dated < 2 || sorted) return group;
	const slots: number[] = [];
	const people: { x: Person; y: number; i: number }[] = [];
	group.forEach((x, i) => {
		const y = yearAt(x);
		if (y === undefined) return;
		slots.push(i);
		people.push({ x, y, i });
	});
	people.sort((a, b) => a.y - b.y || a.i - b.i);
	const out = group.slice();
	slots.forEach((slot, k) => {
		out[slot] = people[k].x;
	});
	return out;
}

/** D202: a dated child that crossed a child with no year breaks the order of the note: the data does not agree with itself. */
function noteBreak(p: PassCtx, group: Person[], final: Person[]): void {
	const yearAt = p.e.life.born;
	const place = new Map(final.map((x, i) => [x.id, i]));
	const involved = new Set<string>();
	group.forEach((u, i) => {
		if (yearAt(u) !== undefined) return;
		group.forEach((w, j) => {
			// w stood on one side of u in the note; it is a break when w stands on the other side now.
			const wasBefore = j < i;
			const isBefore = place.get(w.id)! < i;
			if (yearAt(w) !== undefined && wasBefore !== isBefore) {
				involved.add(u.id);
				involved.add(w.id);
			}
		});
	});
	if (involved.size) p.e.loops.set([...involved].sort().join('\0'), group.filter((x) => involved.has(x.id)).map((x) => x.id));
}

/** D202: the notes of one group. `final` is the group in rank order (before `youngest-child` reverses it). */
function noteGroup(p: PassCtx, group: Person[], final: Person[]): void {
	const e = p.e;
	const born = e.life.born;
	for (let k = 0; k + 1 < final.length; k++) {
		const a = final[k];
		const b = final[k + 1];
		const ya = born(a);
		const yb = born(b);
		// Two years that differ put the pair in order; every other pair stands in the order of the note.
		if (ya !== undefined && yb !== undefined && ya !== yb) continue;
		// Brothers and sisters of the same parents can move in the edit sheet; the note is for the other case.
		if (sameParents(e, a.id, b.id)) continue;
		const [first, second] = (e.rule === 'youngest-child') ? [b.id, a.id] : [a.id, b.id];
		e.pairs.set(`${first}\0${second}`, [first, second, ya !== undefined && ya === yb]);
	}
	if (final === group) return;
	noteBreak(p, group, final);
}

/**
 * One group in rank order: slot-fill and the notes. With `after` the illegitimate children are a group of their own (the pass that reads
 * the flag): a legitimate child with a year never moves them, and the notes name only the people of one tier.
 */
function tierFill(p: PassCtx, eligible: Person[]): Person[] {
	const life = p.e.life;
	const tiered = p.illOn && p.e.spec.illegitimate === 'after';
	const legit = eligible.filter((x) => !x.illegitimate);
	if (!tiered || legit.length === 0 || legit.length === eligible.length) {
		const sorted = slotFill(life, eligible);
		noteGroup(p, eligible, sorted);
		return sorted;
	}
	const tiers = [legit, eligible.filter((x) => x.illegitimate)];
	const out = eligible.slice();
	let changed = false;
	for (const tier of tiers) {
		const sorted = slotFill(life, tier);
		noteGroup(p, tier, sorted);
		if (sorted === tier) continue;
		changed = true;
		const inTier = new Set(tier);
		let next = 0;
		eligible.forEach((x, i) => {
			if (inTier.has(x)) out[i] = sorted[next++];
		});
	}
	return changed ? out : eligible;
}

/**
 * One group in rank order: slot-fill, the notes, and the reversal of `youngest-child`.
 * Only the children who pass the sex test of the pass take part: under "women-only" a brother with a year must not move his
 * sisters. A child left out keeps his place in the written order.
 */
function rankGroup(p: PassCtx, group: Person[]): Person[] {
	const eligible = p.only === undefined ? group : group.filter((x) => sexOk(p, x));
	const sorted = tierFill(p, eligible);
	let final = group;
	if (sorted !== eligible) {
		let next = 0;
		final = eligible === group ? sorted : group.map((x) => (sexOk(p, x) ? sorted[next++] : x));
	}
	return p.e.rule === 'youngest-child' ? final.slice().reverse() : final;
}

/** Was the child born during a reign of the parent? */
function reignOk(p: PassCtx, parent: string, child: Person): boolean {
	const by = p.e.life.born(child);
	return by !== undefined && (p.e.reigns.get(parent) ?? []).some((r) => by >= r.from && (r.to === undefined || by <= r.to));
}

/** The claim children of one person in sibling rank. */
export function rank(p: PassCtx, parent: string): Person[] {
	const e = p.e;
	const kids = claimKids(p, parent);
	if (kids.length < 2) return kids;
	const reigning = e.rule === 'born-in-reign';
	// S3: with this rule a holder with no start year gives the children no precedence. A parent who never held the title is not a holder.
	if (reigning && e.unstarted.has(parent) && !e.reigns.has(parent) && !e.noFrom.has(parent)) e.noFrom.set(parent, kids.map((k) => k.id));
	if (p.stepPref === undefined && !reigning) return rankGroup(p, kids);
	// The gender step, then the reign step make the groups; the written order and the birth years decide inside a group.
	const code = (x: Person) => stepOf(p, x) * 2 + (reigning && !reignOk(p, parent, x) ? 1 : 0);
	const first = code(kids[0]);
	if (kids.every((x) => code(x) === first)) return rankGroup(p, kids);
	const buckets: Person[][] = [[], [], [], []];
	for (const x of kids) buckets[code(x)].push(x);
	return ([] as Person[]).concat(...buckets.filter((b) => b.length).map((b) => rankGroup(p, b)));
}
