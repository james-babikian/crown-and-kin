/*
 * What the years and the `ended-by` key say about a marriage (0.5 step 1a, D304 to D309; an internal study §A and §4).
 * `relations.ts` asks four things: is the marriage ENDED (a divorce or annulment, or an exact end year before both exact death years),
 * are its years APART from the life of one person (so a step word does not hold), is it FORMER for the person on the blood side of a
 * word (ENDED, and that person did not die before the exact end year: D309, rule F4), and what the exact years of a person are. A year
 * counts only if `exactYear` says it is exact; every comparison is strict, so equal years never decide. One `MarriageYears` serves one
 * graph. Pure; it never throws.
 */

import { exactYear } from './exact-year';
import type { FamilyGraph, FamilyUnion } from './derive';
import { readEndedBy } from './types';

/** The exact years of one marriage, worked out once. */
interface UnionYears {
	/** ENDED (RULES §A): the marriage ended by a divorce or an annulment, or (no `ended-by: death`) by an exact end year before both exact death years. */
	ended: boolean;
	/** The exact year of `end`. */
	end?: number;
	/** E(U): the smallest exact year of `end` and of the two deaths. */
	stop?: number;
	/** S(U): the largest exact year of `start` and of the two births. */
	start?: number;
}

export class MarriageYears {
	private readonly births = new Map<string, number | undefined>();
	private readonly deaths = new Map<string, number | undefined>();
	private readonly unions = new Map<FamilyUnion, UnionYears>();

	constructor(private readonly g: FamilyGraph) {}

	/** The exact year of the birth of a person (by id), or undefined. */
	born(id: string): number | undefined {
		if (!this.births.has(id)) this.births.set(id, exactYear(this.g.byId.get(id)?.born, this.g.dates.reader));
		return this.births.get(id);
	}

	/** The exact year of the death of a person (by id), or undefined. */
	died(id: string): number | undefined {
		if (!this.deaths.has(id)) this.deaths.set(id, exactYear(this.g.byId.get(id)?.died, this.g.dates.reader));
		return this.deaths.get(id);
	}

	/** The exact years of a marriage (the caller passes a marriage; a union of any other type never gets "former"). */
	private of(fu: FamilyUnion): UnionYears {
		let out = this.unions.get(fu);
		if (out) return out;
		const reader = this.g.dates.reader;
		const [a, b] = fu.partners;
		const end = exactYear(fu.end, reader);
		const start = exactYear(fu.start, reader);
		const [deadA, deadB] = [this.died(a), this.died(b)];
		const smallest = (list: (number | undefined)[]) => list.reduce<number | undefined>((s, v) => (v !== undefined && (s === undefined || v < s) ? v : s), undefined);
		const largest = (list: (number | undefined)[]) => list.reduce<number | undefined>((s, v) => (v !== undefined && (s === undefined || v > s) ? v : s), undefined);
		const why = readEndedBy(fu.endedBy);
		// The fallback needs the end and both deaths, all exact. An explicit `death` stops it, and an explicit divorce or annulment needs no year.
		const inLife = end !== undefined && deadA !== undefined && deadB !== undefined && end < deadA && end < deadB;
		const ended = why === 'divorce' || why === 'annulment' || (why !== 'death' && inLife);
		out = { ended, end, stop: smallest([end, deadA, deadB]), start: largest([start, this.born(a), this.born(b)]) };
		this.unions.set(fu, out);
		return out;
	}

	/** ENDED (RULES §A) for a marriage. */
	ended(fu: FamilyUnion): boolean {
		return this.of(fu).ended;
	}

	/** True if every marriage of the list is ENDED. An empty list is not. */
	allEnded(list: readonly FamilyUnion[]): boolean {
		return list.length > 0 && list.every((fu) => this.of(fu).ended);
	}

	/**
	 * APART(U, K): the marriage ended before K was born, or began after K died, by exact years. A side counts only when both of its years
	 * exist. If it is not apart the two may overlap, and the step word stays.
	 */
	apart(fu: FamilyUnion, k: string): boolean {
		const u = this.of(fu);
		const [born, died] = [this.born(k), this.died(k)];
		return (u.stop !== undefined && born !== undefined && u.stop < born) || (u.start !== undefined && died !== undefined && u.start > died);
	}

	/**
	 * The years' verdict on a word of a pair, from every marriage of the partners (RULES §2.1): `[step, former]`. `step` says if the step
	 * word holds: the word kinds 'step' hold if some marriage may overlap the life of one person of `ks` (not APART). `former` says if
	 * the name gets "former": a 'step' word and a 'named' word (an in-law or "by marriage" name) when every marriage that counts is FORMER
	 * for the people of `blood`; a possessive form, and a step word that fails, when every marriage is ENDED (rule P).
	 */
	verdict(marriages: readonly FamilyUnion[], kind: 'step' | 'named' | 'possessive', blood: readonly string[], ks: readonly string[] = []): [step: boolean, former: boolean] {
		if (kind === 'possessive') return [true, this.allEnded(marriages)];
		const counting = kind === 'step' ? marriages.filter((u) => ks.some((k) => !this.apart(u, k))) : marriages;
		if (kind === 'step' && !counting.length) return [false, this.allEnded(marriages)];
		return [true, counting.every((u) => this.former(u, blood))];
	}

	/**
	 * FORMER(U, W), with F4 (D309): the marriage is ENDED, and no person of `blood` (the person of the pair who is not a partner of the
	 * marriage: M, P, or both for a step-sibling) died, by an exact year, before the exact end year. A death that came first ended the tie,
	 * so the word keeps no "former".
	 */
	former(fu: FamilyUnion, blood: readonly string[]): boolean {
		const u = this.of(fu);
		if (!u.ended) return false;
		return u.end === undefined || !blood.some((id) => {
			const died = this.died(id);
			return died !== undefined && died < u.end!;
		});
	}
}
