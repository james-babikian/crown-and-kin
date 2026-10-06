/*
 * Assigns every person a generation, the row they are drawn in (spec §5.1 step 1). The layout code
 * calls `computeGenerations` with the family graph from `derive.ts`, before `order.ts` works out
 * the left-to-right order within each row. The partner step is in `row-partners.ts` and the rule
 * for a lone rumoured parent is in `rumoured-roots.ts`.
 */

import { partnerOf, type FamilyGraph } from './derive';
import { equalisePartners, RowGroups } from './row-partners';
import { loneRumouredRoots } from './rumoured-roots';

/**
 * Assigns each person a generation (0 = top row), using placement parents only (spec §5.1 step 1).
 *
 * - Someone with placement parents sits exactly one generation below the lower of them.
 * - Someone without (a "root") who married a person with parents takes that partner's
 *   generation, so married-in spouses sit beside their partner, unless that would put the
 *   root at or below one of their own descendants (a founder who married his daughter, or a
 *   loop through two marriages). Then the next such partner is tried.
 * - Other roots with children sit directly above their nearest child; childless ones beside
 *   their first partner.
 *
 * Roots that share a row are merged into one group with their partner, and each merge is
 * accepted only if the groups stay acyclic. A longest-path pass over that acyclic graph then
 * settles every row in one go, so there is no iteration to stop early.
 *
 * Then two steps of 0.2.5 (D140): the two partners of a partnership are put on one row where
 * this can be solved (`equalisePartners`), and a man who is only a rumoured parent sits in the
 * row of his child's lower placement parent.
 *
 * Cycles in the parent links must already be broken (deriveFamilies does this).
 */
export function computeGenerations(g: FamilyGraph): Map<string, number> {
	const ids = g.people.map((p) => p.id);
	const isRoot = (id: string) => g.placementParents.get(id)!.length === 0;
	const partnersOf = (id: string) => (g.unionsOf.get(id) ?? []).map((k) => partnerOf(g.unionByKey.get(k)!, id));

	// A group is a set of people who must share a row (a union-find that can undo a merge).
	const groups = new RowGroups(g, ids);
	const find = (id: string) => groups.find(id);

	/** Whether a group lies above another: some member of `from` is an ancestor of a member of `to`. */
	const reaches = (from: string, to: string): boolean => {
		const target = find(to);
		const seen = new Set([find(from)]);
		const stack = [find(from)];
		while (stack.length) {
			for (const m of groups.membersOf(stack.pop()!)) {
				for (const c of groups.kidsOf(m)) {
					const rc = find(c);
					if (rc === target) return true;
					if (!seen.has(rc)) {
						seen.add(rc);
						stack.push(rc);
					}
				}
			}
		}
		return false;
	};

	for (const id of ids) {
		if (!isRoot(id)) continue;
		const partners = partnersOf(id);
		const blood = partners.find((s) => !isRoot(s) && find(s) !== find(id) && !reaches(id, s));
		if (blood !== undefined) groups.merge(id, blood);
		else if (!groups.kidsOf(id).length && partners.length) groups.merge(id, partners[0]);
	}

	// Longest path over the groups, in topological order (Kahn). Each group holds at most one
	// person with parents, so its row is exactly one below that person's lower parent.
	const names = [...new Set(ids.map(find))];
	const preds = new Map(names.map((r) => [r, new Set<string>()]));
	const succs = new Map(names.map((r) => [r, new Set<string>()]));
	for (const id of ids) {
		for (const p of g.placementParents.get(id)!) {
			const [a, b] = [find(p), find(id)];
			if (a === b) continue;
			preds.get(b)!.add(a);
			succs.get(a)!.add(b);
		}
	}
	const row = new Map<string, number>();
	const waiting = new Map(names.map((r) => [r, preds.get(r)!.size]));
	const queue = names.filter((r) => waiting.get(r) === 0);
	for (let done = 0; done < names.length; ) {
		if (!queue.length) {
			// Not reachable on a tree whose cycles were broken; a safety net so nothing throws.
			queue.push(names.find((r) => !row.has(r) && !queue.includes(r))!);
		}
		const r = queue.shift()!;
		if (row.has(r)) continue;
		row.set(r, Math.max(-1, ...[...preds.get(r)!].map((p) => row.get(p) ?? -1)) + 1);
		done++;
		for (const s of succs.get(r)!) {
			waiting.set(s, waiting.get(s)! - 1);
			if (waiting.get(s) === 0) queue.push(s);
		}
	}

	// D140: put the two partners of each partnership on one row where this can be solved.
	equalisePartners(groups, row);

	// A group of roots only sits directly above its nearest child. Lowering it never changes a
	// child's row: each child already sits one row below its lowest parent. The child groups are
	// found again from the members, because the partner step has merged groups.
	for (const r of new Set(ids.map(find))) {
		if (!groups.hasParents(r) && groups.childGroups(r).size) row.set(r, groups.finalRow(r, row));
	}
	const out = new Map(ids.map((id) => [id, row.get(find(id))!]));

	// D140: a man who is only a rumoured parent sits in the row of his child's lower placement parent.
	for (const [root, kids] of loneRumouredRoots(g)) out.set(root, Math.max(0, Math.min(...kids.map((k) => out.get(k)!)) - 1));

	// The two steps can leave a row empty; squeeze it out.
	const rank = new Map([...new Set(out.values())].sort((a, b) => a - b).map((v, i) => [v, i]));
	return new Map([...out].map(([id, v]) => [id, rank.get(v)!]));
}
