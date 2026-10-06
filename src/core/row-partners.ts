/*
 * The row groups and the partner step of the generations (spec §5.1 step 1, D140 "partners on one row"). A group is a
 * set of people who must share a row. `generations.ts` builds the groups and the first rows; `equalisePartners` then
 * raises the upper partner of each partnership, with the people below, so that both partners stand on one row. A move is
 * kept only if fewer partnerships stand on two rows afterwards; else it is undone from a journal.
 */

import { placedChildren, type FamilyGraph } from './derive';

/** Counters of the last call of `equalisePartners`, for the tests (like `relationStats`); nothing in the plugin reads them. */
export const rowStats = {
	unequalBefore: 0,
	unequalAfter: 0,
	tries: 0,
	accepted: 0,
	rejected: 0,
	rolledBack: 0,
	repaired: 0,
	guard: 0,
	stepBudget: 0,
	maxRounds: 0,
	maxWork: 0,
	totalWork: 0,
	passes: 0,
};

/**
 * People who must share a row (a union-find), with the child links between them. It joins by size and never compresses a
 * path, so that a merge can be undone exactly.
 */
export class RowGroups {
	private readonly up: Map<string, string>;
	private readonly members: Map<string, string[]>;
	private readonly kids = new Map<string, string[]>();

	constructor(
		readonly g: FamilyGraph,
		ids: readonly string[],
	) {
		this.up = new Map(ids.map((id) => [id, id]));
		this.members = new Map(ids.map((id) => [id, [id]]));
	}

	/** The group of a person, named by one of its members. */
	find(id: string): string {
		let r = id;
		while (this.up.get(r) !== r) r = this.up.get(r)!;
		return r;
	}

	/** The people of a group (its name is the argument). */
	membersOf(rep: string): readonly string[] {
		return this.members.get(rep)!;
	}

	/** How many groups there are. */
	get size(): number {
		return this.members.size;
	}

	/** Children placed under a person (cached). */
	kidsOf(id: string): string[] {
		let k = this.kids.get(id);
		if (!k) this.kids.set(id, (k = placedChildren(this.g, id)));
		return k;
	}

	/** Joins two groups; returns a function that undoes the join, or nothing if they were one group already. */
	merge(a: string, b: string): (() => void) | undefined {
		let big = this.find(a);
		let small = this.find(b);
		if (big === small) return undefined;
		if (this.members.get(big)!.length < this.members.get(small)!.length) [big, small] = [small, big];
		const bigMembers = this.members.get(big)!;
		const smallMembers = this.members.get(small)!;
		const bigLength = bigMembers.length;
		this.up.set(small, big);
		for (const m of smallMembers) bigMembers.push(m);
		this.members.delete(small);
		return () => {
			this.up.set(small, small);
			bigMembers.length = bigLength;
			this.members.set(small, smallMembers);
		};
	}

	/** The groups that hold a child of the group, not counting the group itself. */
	childGroups(rep: string): Set<string> {
		const out = new Set<string>();
		for (const m of this.members.get(rep)!) for (const c of this.kidsOf(m)) if (this.find(c) !== rep) out.add(this.find(c));
		return out;
	}

	/** Whether somebody in the group has a placement parent outside it (else it is a group of founders). */
	hasParents(rep: string): boolean {
		return this.members.get(rep)!.some((m) => this.g.placementParents.get(m)!.some((p) => this.find(p) !== rep));
	}

	/** The row a group is drawn in: a group of founders sits directly above its nearest child group (spec §5.1). */
	finalRow(rep: string, row: ReadonlyMap<string, number>): number {
		if (this.hasParents(rep)) return row.get(rep)!;
		const kids = this.childGroups(rep);
		return kids.size ? Math.min(...[...kids].map((k) => row.get(k)!)) - 1 : row.get(rep)!;
	}
}

interface Solution {
	low: string;
	high: string;
	highRow: number;
	raised: Map<string, number>;
}

/**
 * The partner step of the rows: puts the two partners of each partnership on one row wherever the rule "a child sits one row
 * below the lower parent" allows, and never leaves more partnerships on two rows than before. `row` holds the raw row of each
 * group (by group name) and is changed in place; `groups` gets the merges. The people of a founder group are not yet lowered.
 */
export function equalisePartners(groups: RowGroups, row: Map<string, number>): void {
	const g = groups.g;
	Object.assign(rowStats, { unequalBefore: 0, unequalAfter: 0, tries: 0, accepted: 0, rejected: 0, rolledBack: 0, repaired: 0, guard: 0, stepBudget: 0, maxRounds: 0, maxWork: 0, totalWork: 0, passes: 0 });

	const journal: (() => void)[] = [];
	const setRow = (k: string, v: number) => {
		const old = row.get(k);
		journal.push(() => (old === undefined ? row.delete(k) : row.set(k, old)));
		row.set(k, v);
	};
	type Union = (typeof g.unions)[number];
	const onOneRow = (u: Union) => {
		const a = groups.find(u.partners[0]);
		const b = groups.find(u.partners[1]);
		return a === b || groups.finalRow(a, row) === groups.finalRow(b, row);
	};
	const unequalCount = () => g.unions.reduce((n, u) => n + (onOneRow(u) ? 0 : 1), 0);

	// Work left for the whole step: a hostile tree keeps the rows of 0.2.4 for the unions not yet tried.
	let stepWork = 200 * groups.size + 5000;

	/** Finds the raised rows that bring two groups to one row, or nothing. It changes nothing either way. */
	const solve = (ga: string, gb: string): Solution | undefined => {
		if (stepWork <= 0) {
			rowStats.stepBudget++;
			return undefined;
		}
		rowStats.tries++;
		const [low, high] = row.get(ga)! <= row.get(gb)! ? [ga, gb] : [gb, ga];
		const highRow = row.get(high)!;
		const raised = new Map<string, number>(); // the new raw rows of the groups raised in this try
		const cur = (k: string) => raised.get(k) ?? row.get(k)!;
		const pending: string[] = []; // raised, children not yet pushed
		const touched = new Set<string>(); // raised since the last pull; only these can need a pull
		const budget = 8 * groups.size + 100;
		let work = 0;
		let fail = false;
		let rounds = 0;
		const lift = (k: string, to: number) => {
			if (fail || to <= cur(k)) return;
			// The lower partner would have to move the upper one: a line of tight rows joins them, so the gap never closes.
			if (k === high || (k === low && to > highRow)) {
				fail = true;
				return;
			}
			if (++work > budget) {
				fail = true;
				rowStats.guard++;
				return;
			}
			raised.set(k, to);
			pending.push(k);
			touched.add(k);
		};
		lift(low, highRow);
		while (!fail && pending.length) {
			// Push: a child group is at least one row below each raised parent group. The result does not depend on the order.
			while (pending.length && !fail) {
				const k = pending.pop()!;
				for (const c of groups.childGroups(k)) lift(c, cur(k) + 1);
			}
			if (fail) break;
			rounds++;
			// Pull: a person with parents in a raised group must stay exactly one row below the lower parent. All pulls of a
			// round are found first; then the parents on the top row are raised.
			const pulls: [string, number][] = [];
			for (const k of touched) {
				for (const b of groups.membersOf(k)) {
					const ps = g.placementParents.get(b)!;
					if (!ps.length) continue;
					const parentGroups = ps.map((p) => groups.find(p));
					const top = Math.max(...parentGroups.map(cur));
					if (cur(k) > top + 1) for (const p of parentGroups) if (cur(p) === top) pulls.push([p, cur(k) - 1]);
				}
			}
			touched.clear();
			for (const [p, to] of pulls) lift(p, to);
		}
		rowStats.maxRounds = Math.max(rowStats.maxRounds, rounds);
		rowStats.maxWork = Math.max(rowStats.maxWork, work);
		stepWork -= work;
		rowStats.totalWork += work;
		return fail ? undefined : { low, high, highRow, raised };
	};

	const apply = (s: Solution) => {
		for (const [k, v] of s.raised) setRow(k, v);
		const undo = groups.merge(s.low, s.high);
		if (undo) journal.push(undo);
		setRow(groups.find(s.high), s.highRow);
	};

	/** One move: the try for the partnership, repairs for the partnerships it breaks; kept only if the whole count falls. */
	const move = (fu: Union): boolean => {
		const first = solve(groups.find(fu.partners[0]), groups.find(fu.partners[1]));
		if (!first) {
			rowStats.rejected++;
			return false;
		}
		const held = g.unions.filter(onOneRow); // on one row now, so they must be on one row after the move
		const before = g.unions.length - held.length;
		journal.length = 0;
		apply(first);
		for (let loop = 0; loop <= g.unions.length; loop++) {
			const broken = held.filter((u) => !onOneRow(u));
			if (!broken.length) break;
			let stuck = false;
			for (const u of broken) {
				if (onOneRow(u)) continue; // an earlier repair of this round mended it
				const fix = solve(groups.find(u.partners[0]), groups.find(u.partners[1]));
				if (!fix) {
					stuck = true;
					break;
				}
				apply(fix);
				rowStats.repaired++;
			}
			if (stuck) break;
		}
		if (unequalCount() < before) {
			rowStats.accepted++;
			return true;
		}
		while (journal.length) journal.pop()!();
		rowStats.rolledBack++;
		return false;
	};

	rowStats.unequalBefore = unequalCount();
	// A union that failed on the present rows fails again, so only a kept move (a new version of the rows) lets it be tried again.
	const triedAt = new Map<Union, number>();
	let version = 0;
	for (let pass = 0, kept = true; kept && pass <= g.unions.length; pass++) {
		kept = false;
		rowStats.passes++;
		for (const fu of g.unions) {
			if (onOneRow(fu) || triedAt.get(fu) === version) continue;
			triedAt.set(fu, version);
			if (move(fu)) {
				kept = true;
				version++;
			}
		}
	}
	rowStats.unequalAfter = unequalCount();
}
