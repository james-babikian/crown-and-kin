/*
 * The couple test of a child with three or more parents of one kind (spec §0 D365 (2); contract "Three own lines" §1.2, §1.3). A leaf
 * with no import of the family graph, so `derive.ts` can use it while `parent-groups.ts` (which reads graphs) re-exports it. `pairKey` lives
 * here for the same reason: it is the one key of a couple, and `derive.ts` exports it from here as before.
 */

/** Order-free key for a couple. JSON keeps ids that contain "|" apart and cannot throw. */
export const pairKey = (a: string, b: string) => {
	const [x, y] = a < b ? [a, b] : [b, a];
	return JSON.stringify([x, y]);
};

/** The least number of parents of one kind that make a child a case (contract §1.1). */
export const GROUP_MIN = 3;

/** The key of a set of parents: the sorted ids as JSON, so the order of a list never matters. */
export const groupKey = (parents: readonly string[]): string => JSON.stringify([...new Set(parents)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

/** What the couple test found for one child: the one couple it stands under, or a group with no couple. */
export type ParentVerdict = { verdict: 'couple'; parentKind: 'birth' | 'adoptive'; pair: readonly [string, string] } | { verdict: 'group'; parentKind: 'birth' | 'adoptive' };

/** The pairs behind `coParentKeys`: the two distinct parents of each child that has exactly two of its placement kind, a kind that is not ward. */
export function coParentPairs(children: Iterable<{ kind: 'birth' | 'adoptive' | 'ward'; ids: readonly string[] }>): [string, string][] {
	const out: [string, string][] = [];
	for (const c of children) {
		if (c.kind === 'ward') continue;
		const distinct = [...new Set(c.ids)];
		if (distinct.length === 2) out.push([distinct[0], distinct[1]]);
	}
	return out;
}

/** Each person's partners in `pairs`, for `parentVerdict` to find the couples among very many parents without trying every pair. */
export function partnerIndex(pairs: Iterable<readonly [string, string]>): (id: string) => readonly string[] {
	const by = new Map<string, string[]>();
	for (const [a, b] of pairs) {
		(by.get(a) ?? by.set(a, []).get(a)!).push(b);
		(by.get(b) ?? by.set(b, []).get(b)!).push(a);
	}
	return (id) => by.get(id) ?? [];
}

/**
 * The verdict for a child whose parents of one kind are `ids` (note order). `isCouple` says whether two of them are a couple; `partnersOf`, when
 * given, lists the people a person is a couple with, so a child with very many parents is read in linear time. Exactly one couple among them
 * gives that couple; with two or more, the couple that `union` names, else a group; with none, a group. The result never depends on the order
 * of `ids` except that a couple is returned with its partners in note order.
 */
export function parentVerdict(parentKind: 'birth' | 'adoptive', ids: readonly string[], isCouple: (a: string, b: string) => boolean, union?: { namesPair: (a: string, b: string) => boolean }, partnersOf?: (id: string) => readonly string[]): ParentVerdict {
	const distinct = [...new Set(ids)];
	const place = new Map(distinct.map((id, i) => [id, i] as const));
	const couples: [string, string][] = [];
	let named: [string, string] | undefined;
	// Without a `union` key a second couple already decides, so a child with very many parents stops early.
	for (let i = 0; i < distinct.length && (union ? !named : couples.length < 2); i++) {
		const a = distinct[i];
		const near = partnersOf?.(a);
		// Whichever side is shorter is walked: the partners of `a`, or the parents after it.
		const later = near && near.length < distinct.length - i - 1 ? [...new Set(near)].filter((b) => (place.get(b) ?? -1) > i).sort((x, y) => place.get(x)! - place.get(y)!) : distinct.slice(i + 1).filter((b) => isCouple(a, b));
		for (const b of later) {
			couples.push([a, b]);
			if (union?.namesPair(a, b)) named ??= [a, b];
		}
	}
	if (couples.length === 1) return { verdict: 'couple', parentKind, pair: couples[0] };
	if (named) return { verdict: 'couple', parentKind, pair: named };
	return { verdict: 'group', parentKind };
}

/**
 * The couples that a union drawn without the child proves: the key of the two parents of each child that has exactly two distinct parents of
 * its placement kind, a kind that is not ward (an implicit union is drawn for them). A ward pair is no couple (D354 1 B). Pure; `derive` calls it on
 * the raw parents before any child is placed.
 */
export function coParentKeys(children: Iterable<{ kind: 'birth' | 'adoptive' | 'ward'; ids: readonly string[] }>): ReadonlySet<string> {
	return new Set(coParentPairs(children).map(([a, b]) => pairKey(a, b)));
}
